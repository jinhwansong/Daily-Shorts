/**
 * Longform Phase 2 — 이미지 다운로드 + FFmpeg 합성 + YouTube 업로드
 *
 * 흐름:
 *   1. GCS state 읽기
 *   2. 배치 완료 대기 (폴링, 최대 30분)
 *   3. 병렬: 이미지 다운로드 / TTS / Pexels 클립 / Freesound BGM
 *            └─ TTS 완료 즉시 Whisper 자막 시작 (Pexels 기다리지 않음)
 *   4. 이미지 실패 재시도 (direct API) → Pexels 스틸 폴백
 *   5. FFmpeg 합성 + 썸네일 (병렬)
 *   6. YouTube 비공개 업로드
 *   7. GCS 정리
 *
 * 예상 실행 시간: ~5-8분 (10분 영상 기준, GitHub Actions 2코어)
 *
 * 실행: node src/longformPhase2.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');

const { generateTTS } = require('./audio/ttsGenerator');
const {
  fetchFreesoundBgm,
  mustAppendFreesoundCredit,
  buildFreesoundAttributionLine,
} = require('./audio/freesoundBgm');
const { generateSubtitles, srtToAss } = require('./video/subtitleGenerator');
const { composeLongformVideo } = require('./video/longformVideoComposer');
const { parseScriptSections } = require('./video/dalleImageGenerator');
const { generateThumbnail, pickLongformThumbnailHook } = require('./video/thumbnailGenerator');
const { fetchLandscapeClips } = require('./video/longformVideoFetcher');
const { uploadVideo, setThumbnail } = require('./upload/youtubeUploader');
const { recordPublishedTopic } = require('./utils/publishedTopics');
const { runCopyrightGuard } = require('./utils/copyrightGuard');
const { getAttributionFooter } = require('./utils/attributionFooter');
const { pickRandomLocalBgm } = require('./utils/localBgm');
const { getGenre } = require('./genres');
const {
  waitForBatch,
  downloadBatchImages,
  retryFailedImages,
  cleanupGCSResults,
  loadState,
  deleteState,
} = require('./utils/gcsBatchManager');

const REPO_ROOT = path.join(__dirname, '..');

/** 스크립트에서 섹션 헤더([COLD_OPEN] 등) 제거 — TTS용 */
function stripSectionHeaders(script) {
  return script
    .replace(/^\[[A-Z_]+\]\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function elapsed(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function runPhase2() {
  const t0 = Date.now();
  console.log('\n=== Longform Phase 2 ===');

  // 1. State 읽기
  const state = await loadState();
  if (!state) {
    console.log('⚠ Phase 1 state 없음. Phase 1을 먼저 실행하세요.');
    process.exit(0);
  }

  const { batchJobName, gcsDestination, imageCount, imagesPerSection: ipsSaved, video } = state;
  const { jobId, topic, genreKey, script, metadata } = video;
  const genre = getGenre(genreKey);

  console.log(`  Topic: ${topic}`);
  console.log(`  Batch: ${batchJobName}`);

  // 2. 배치 완료 대기
  const success = await waitForBatch(batchJobName, 30);
  if (!success) {
    console.error('❌ 배치 미완료. 나중에 다시 Phase 2를 실행하세요.');
    process.exit(1);
  }

  // 출력 디렉토리
  const outputDir = path.join(REPO_ROOT, video.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'script.txt'), script);
  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // 섹션 파싱 (한 번만)
  const sections = parseScriptSections(script).filter((s) => s.text && s.text.trim());

  // 클립 수: 섹션 수 + 2 여유분 (최대 8), Pexels 불필요 다운로드 방지
  const clipCount = Math.min(8, Math.max(sections.length + 2, 4));

  // 3. 병렬: 이미지 다운로드 / TTS / Pexels / BGM
  //    + TTS 완료 즉시 Whisper 자막 시작 (Pexels 완료를 기다리지 않음)
  console.log(`  이미지·TTS·Pexels(${clipCount}개)·BGM 병렬 처리 중...`);
  const ttsScript = stripSectionHeaders(script);

  const tStepStart = Date.now();
  const ttsPromise = generateTTS(ttsScript, outputDir);
  const subtitlesPromise = ttsPromise.then(async (ap) => {
    console.log(`  [TTS 완료 ${elapsed(tStepStart)}] Whisper 자막 시작...`);
    const srt = await generateSubtitles(ap, outputDir);
    return srtToAss(srt, outputDir);
  });

  const [{ imageSlots, failedIndices }, audioPath, clipPaths, freesound, assPath] = await Promise.all([
    downloadBatchImages(gcsDestination, outputDir, imageCount, batchJobName),
    ttsPromise,
    fetchLandscapeClips(outputDir, genreKey, clipCount),
    fetchFreesoundBgm(outputDir, genreKey),
    subtitlesPromise,
  ]);
  console.log(`  [병렬 완료 ${elapsed(tStepStart)}] 이미지:${imageSlots.length} 클립:${clipPaths.length}`);

  // 1차 재시도: 배치 실패 프롬프트를 direct API로 복구
  if (failedIndices.length > 0 && state.imagePrompts?.length) {
    console.log(`  이미지 재시도 ${failedIndices.length}개...`);
    await retryFailedImages(failedIndices, state.imagePrompts, imageSlots, outputDir);
  }

  // 2차 폴백: 여전히 null인 슬롯을 Pexels 스틸로 채움
  const stillFailed = imageSlots.map((v, i) => (v == null ? i : -1)).filter((i) => i >= 0);
  if (stillFailed.length > 0) {
    console.warn(`  ⚠ ${stillFailed.length}개 재시도 후에도 실패 → Pexels 스틸 폴백`);
    const { fetchPexelsStillForFallback } = require('./video/longformVideoFetcher');
    for (const idx of stillFailed) {
      const query = sections[idx % sections.length]?.name?.toLowerCase().replace(/_/g, ' ') || 'dark mystery';
      const stillPath = await fetchPexelsStillForFallback(outputDir, query, idx);
      if (stillPath) imageSlots[idx] = stillPath;
    }
  }

  // 최종 이미지 배열: 위치 순, null 제거
  const imagePaths = imageSlots.filter(Boolean);

  // BGM 메타 처리
  let bgmPath = null;
  if (freesound) {
    bgmPath = freesound.path;
    if (mustAppendFreesoundCredit(freesound.meta) && freesound.attributionLine) {
      metadata.description = `${metadata.description}\n\n${freesound.attributionLine}`;
    }
  } else {
    const local = pickRandomLocalBgm(genre);
    if (local) bgmPath = local.path;
  }

  // Attribution footer
  const footer = getAttributionFooter();
  if (footer) metadata.description = `${metadata.description}\n\n${footer}`;

  // Freesound 업로드 전 출처 보강
  const fsMetaPath = path.join(outputDir, 'freesound_bgm.json');
  if (fs.existsSync(fsMetaPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(fsMetaPath, 'utf-8'));
      const line = buildFreesoundAttributionLine(m);
      const url = m.url || `https://freesound.org/s/${m.soundId}/`;
      if (mustAppendFreesoundCredit(m) && line && !metadata.description.includes(url)) {
        metadata.description = `${metadata.description}\n\n${line}`;
      }
    } catch (_) {}
  }

  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // imagesPerSection 결정 (구 state 호환: sections 재사용)
  let imagesPerSection = ipsSaved != null && Number.isFinite(Number(ipsSaved))
    ? Math.max(1, Math.min(3, Number(ipsSaved)))
    : null;
  if (imagesPerSection == null) {
    imagesPerSection =
      sections.length > 0 && imageCount > 0
        ? Math.max(1, Math.min(3, Math.round(imageCount / sections.length)))
        : 1;
  }

  // 썸네일 훅 (우하단 짧은 문구)
  const hookText = pickLongformThumbnailHook(metadata, script);

  // FFmpeg 합성 + 썸네일 병렬
  const tFFmpeg = Date.now();
  console.log(
    `  FFmpeg 합성 중… (섹션:${sections.length} · 이미지:${imagePaths.length} · 클립:${clipPaths.length} · imagesPerSection:${imagesPerSection})`
  );
  const [finalPath, thumbnailPath] = await Promise.all([
    composeLongformVideo(clipPaths, imagePaths, audioPath, assPath, outputDir, {
      bgmPath,
      script,
      imagesPerSection,
    }),
    generateThumbnail(hookText, outputDir, genreKey, metadata.thumbnailQuery || null, {
      layout: 'corner',
    }),
  ]);

  console.log(`  FFmpeg 완료 [${elapsed(tFFmpeg)}]: ${finalPath}`);

  // 저작권 가드
  runCopyrightGuard(outputDir, {
    videoPath: clipPaths[0],
    videoPath2: null,
    audioPath,
    thumbnailPath,
    script,
  });

  // YouTube 비공개 업로드
  const tUpload = Date.now();
  const savedPrivacy = process.env.YOUTUBE_PRIVACY_STATUS;
  process.env.YOUTUBE_PRIVACY_STATUS = 'private';

  const { videoId, videoUrl } = await uploadVideo(finalPath, metadata, genreKey);
  await setThumbnail(videoId, thumbnailPath, genreKey);

  await recordPublishedTopic({ genreKey, topic, videoId, script, thumbnailLine: metadata.thumbnailLine });

  if (savedPrivacy !== undefined) process.env.YOUTUBE_PRIVACY_STATUS = savedPrivacy;
  else delete process.env.YOUTUBE_PRIVACY_STATUS;

  console.log(`  업로드 완료 [${elapsed(tUpload)}]: ${videoUrl}`);
  console.log(`  → 스튜디오에서 확인 후 공개 전환하세요.`);

  const result = { jobId, genreKey, topic, metadata, videoId, videoUrl };

  // 10. GCS 정리
  await cleanupGCSResults(gcsDestination);
  await deleteState();

  console.log(`\n✅ Phase 2 완료 [총 ${elapsed(t0)}]`);
  return result;
}

runPhase2().catch((e) => {
  console.error('Phase 2 실패:', e.message);
  process.exit(1);
});
