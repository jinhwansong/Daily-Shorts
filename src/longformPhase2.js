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
const { generateThumbnail } = require('./video/thumbnailGenerator');
const { fetchLandscapeClips } = require('./video/longformVideoFetcher');
const { uploadVideo, setThumbnail } = require('./upload/youtubeUploader');
const { runCopyrightGuard } = require('./utils/copyrightGuard');
const { getAttributionFooter } = require('./utils/attributionFooter');
const { pickRandomLocalBgm } = require('./utils/localBgm');
const { getGenre } = require('./genres');
const {
  waitForBatch,
  downloadBatchImages,
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

  const { batchJobName, gcsDestination, imageCount, video } = state;
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

  // 3. GCS에서 이미지 다운로드
  console.log('  이미지 다운로드 중...');
  const imagePaths = await downloadBatchImages(gcsDestination, outputDir, imageCount);

  // 4. TTS + Pexels + 자막 병렬 처리
  console.log('  TTS + Pexels 클립 + 자막 처리 중...');
  const ttsScript = stripSectionHeaders(script);

  const [audioPath, clipPaths, srtPath] = await Promise.all([
    generateTTS(ttsScript, outputDir),
    fetchLandscapeClips(outputDir, genreKey, 8),
    // 자막은 TTS 완료 후에 생성해야 해서 순차 처리
    (async () => null)(),
  ]);

  const srtPathFinal = await generateSubtitles(audioPath, outputDir);
  const assPath = srtToAss(srtPathFinal, outputDir);

  // 5. BGM (Freesound → 로컬 폴백)
  let bgmPath = null;
  const freesound = await fetchFreesoundBgm(outputDir, genreKey);
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

  // 6. 썸네일 텍스트
  const hookText =
    metadata.title.length > 42 ? `${metadata.title.substring(0, 42).trim()}…` : metadata.title;

  // 7. FFmpeg 합성 + 썸네일 병렬
  console.log('  FFmpeg 합성 중...');
  const [finalPath, thumbnailPath] = await Promise.all([
    composeLongformVideo(clipPaths, imagePaths, audioPath, assPath, outputDir, { bgmPath }),
    generateThumbnail(hookText, outputDir, genreKey, metadata.thumbnailQuery || null),
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
