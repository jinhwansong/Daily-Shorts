/**
 * Longform Phase 2 — 이미지 다운로드 + FFmpeg 합성 + YouTube 업로드
 *
 * 흐름:
 *   1. GCS에서 Phase 1 state 읽기
 *   2. 배치 완료 대기 (폴링, 최대 30분)
 *   3. GCS에서 이미지 다운로드
 *   4. TTS + 자막 생성 (스크립트에서 섹션 헤더 제거 후)
 *   5. Pexels landscape 클립 다운로드
 *   6. FFmpeg 합성 (16:9)
 *   7. YouTube 비공개 업로드
 *   8. GCS 정리
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

async function runPhase2() {
  console.log('\n=== Longform Phase 2 ===');

  // 1. State 읽기
  const state = await loadState();
  if (!state) {
    console.log('⚠ Phase 1 state 없음. Phase 1을 먼저 실행하세요.');
    process.exit(0);
  }

  const { batchJobName, gcsDestination, imageCount, imagesPerSection: ipsSaved, video } = state;
  const { jobId, topic, genreKey, script, metadata, chapters } = video;
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

  // 3. 이미지 다운로드 + TTS + Pexels 클립 + BGM — 모두 병렬 시작
  console.log('  이미지·TTS·Pexels·BGM 병렬 처리 중...');
  const ttsScript = stripSectionHeaders(script);
  const clipCount = 8;

  const [{ imageSlots, failedIndices }, audioPath, clipPaths, freesound] = await Promise.all([
    downloadBatchImages(gcsDestination, outputDir, imageCount, batchJobName),
    generateTTS(ttsScript, outputDir),
    fetchLandscapeClips(outputDir, genreKey, clipCount),
    fetchFreesoundBgm(outputDir, genreKey),
  ]);

  // 1차 재시도: 배치 실패 프롬프트를 direct API로 복구
  if (failedIndices.length > 0 && state.imagePrompts?.length) {
    await retryFailedImages(failedIndices, state.imagePrompts, imageSlots, outputDir);
  }

  // 2차 폴백: 여전히 null인 슬롯을 Pexels 스틸로 채움
  const sections = parseScriptSections(script).filter((s) => s.text && s.text.trim());
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

  // 자막 (TTS 완료 후 순차 처리)
  const srtPathFinal = await generateSubtitles(audioPath, outputDir);
  const assPath = srtToAss(srtPathFinal, outputDir);

  // 5. BGM 메타 처리
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

  // Phase1 이전 state: imagesPerSection 없으면 이미지 수÷섹션 수로 추정
  let imagesPerSection = ipsSaved != null && Number.isFinite(Number(ipsSaved))
    ? Math.max(1, Math.min(3, Number(ipsSaved)))
    : null;
  if (imagesPerSection == null) {
    const secs = parseScriptSections(script).filter((s) => s.text && s.text.trim());
    imagesPerSection =
      secs.length > 0 && imageCount > 0
        ? Math.max(1, Math.min(3, Math.round(imageCount / secs.length)))
        : 1;
  }

  // 6. 썸네일 훅 (우하단 짧은 문구 — pickLongformThumbnailHook)
  const hookText = pickLongformThumbnailHook(metadata, script);

  // 7. FFmpeg 합성 + 썸네일 병렬 (스크립트 섹션 순 = 클립→해당 섹션 이미지)
  console.log(
    `  FFmpeg 합성 중… (편집: 스크립트 섹션 순 · 섹션당 이미지 ${imagesPerSection}장, Pexels 클립 ${clipPaths.length}개)`
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

  console.log(`  FFmpeg 완료: ${finalPath}`);

  // 8. 저작권 가드
  runCopyrightGuard(outputDir, {
    videoPath: clipPaths[0],
    videoPath2: null,
    audioPath,
    thumbnailPath,
    script,
  });

  // 9. YouTube 비공개 업로드 (롱폼은 항상 private)
  const savedPrivacy = process.env.YOUTUBE_PRIVACY_STATUS;
  process.env.YOUTUBE_PRIVACY_STATUS = 'private';

  const { videoId, videoUrl } = await uploadVideo(finalPath, metadata, genreKey);
  await setThumbnail(videoId, thumbnailPath, genreKey);

  if (savedPrivacy !== undefined) process.env.YOUTUBE_PRIVACY_STATUS = savedPrivacy;
  else delete process.env.YOUTUBE_PRIVACY_STATUS;

  const result = { jobId, genreKey, topic, metadata, videoId, videoUrl };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`  Uploaded (private): ${videoUrl}`);
  console.log(`  → 스튜디오에서 확인 후 공개 전환하세요.`);

  // 10. GCS 정리
  await cleanupGCSResults(gcsDestination);
  await deleteState();

  console.log('\n✅ Phase 2 완료');
  return result;
}

runPhase2().catch((e) => {
  console.error('Phase 2 실패:', e.message);
  process.exit(1);
});
