require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { DEFAULT_GENRE, getGenre } = require('./genres');
const { generateTopics } = require('./script/topicGenerator');
const { generateScript, generateMetadata } = require('./script/scriptGenerator');
const { generateTTS } = require('./audio/ttsGenerator');
const {
  fetchFreesoundBgm,
  mustAppendFreesoundCredit,
  buildFreesoundAttributionLine,
} = require('./audio/freesoundBgm');
const { fetchBackgroundVideo } = require('./video/videoFetcher');
const { generateSubtitles, srtToAss } = require('./video/subtitleGenerator');
const { composeVideo } = require('./video/videoComposer');
const { generateThumbnail } = require('./video/thumbnailGenerator');
const { uploadVideo, setThumbnail } = require('./upload/youtubeUploader');
const { runCopyrightGuard } = require('./utils/copyrightGuard');
const { getAttributionFooter } = require('./utils/attributionFooter');
const { pickRandomLocalBgm, listMp3InDir } = require('./utils/localBgm');
const { runDryRunPipeline } = require('./utils/dryRunPipeline');

const UPLOAD_COUNT = parseInt(process.env.DAILY_UPLOAD_COUNT || '5', 10);
const REPO_ROOT = path.join(__dirname, '..');

async function runPipeline(topic, genreKey) {
  const genre = getGenre(genreKey);
  const jobId = Date.now();
  const outputDir = path.join(__dirname, `../output/${genreKey}_${jobId}`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n[${genre.label}] Topic: ${topic}`);

  // 스크립트 + 메타데이터
  const script = await generateScript(topic, genreKey);
  const metadata = await generateMetadata(script, topic, genreKey);
  fs.writeFileSync(path.join(outputDir, 'script.txt'), script);
  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(`  Title: ${metadata.title}`);

  // TTS + 배경 영상 (병렬)
  const [audioPath, videoPath] = await Promise.all([
    generateTTS(script, outputDir),
    fetchBackgroundVideo(outputDir, genreKey),
  ]);

  // 자막
  const srtPath = await generateSubtitles(audioPath, outputDir);
  const assPath = srtToAss(srtPath, outputDir);

  // 배경음: Freesound CC0 자동 (FREESOUND_API_KEY) → 없으면 로컬 assets/bgm/<장르>.mp3
  let bgmPath = null;
  const freesound = await fetchFreesoundBgm(outputDir, genreKey);
  if (freesound) {
    bgmPath = freesound.path;
    // CC BY(Attribution)는 표기 의무 → FREESOUND_APPEND_CREDIT=0 이라도 설명에 출처 포함
    if (mustAppendFreesoundCredit(freesound.meta) && freesound.attributionLine) {
      metadata.description = `${metadata.description}\n\n${freesound.attributionLine}`;
      fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    }
  } else {
    const local = pickRandomLocalBgm(genre);
    if (local) {
      bgmPath = local.path;
      const poolRel = path.relative(REPO_ROOT, local.poolPath).replace(/\\/g, '/');
      const n = genre.bgmDir ? listMp3InDir(genre.bgmDir).length : 0;
      const how =
        local.poolKind === 'folder'
          ? `폴더 "${poolRel}" (${n}곡 중 무작위 1곡 — 영상마다 다른 곡이 나올 수 있음)`
          : `단일 파일만 사용 → ${poolRel}`;
      console.log(`  ▶ 실제 배경음은 위 Freesound와 합쳐지지 않고, 아래 로컬 파일 1개만 TTS와 믹싱됩니다.`);
      console.log(`     파일명: ${local.fileName}`);
      console.log(`     ${how}`);
      metadata.bgmLocal = {
        source: 'local',
        genre: genreKey,
        poolKind: local.poolKind,
        poolPath: poolRel,
        fileName: local.fileName,
        note: 'Freesound 실패 시 로컬 풀에서 선택',
      };
      fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    }
  }
  if (!bgmPath) {
    console.warn(
      '  ⚠ 배경음 없음: FREESOUND_API_KEY 또는 assets/bgm/dark 등(미스터리) / 로컬 mp3 를 준비하면 TTS와 믹싱됩니다.'
    );
  }

  const attributionFooter = getAttributionFooter();
  if (attributionFooter) {
    metadata.description = `${metadata.description}\n\n${attributionFooter}`;
    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  }

  // 썸네일 생성 (FFmpeg 합성과 병렬)
  const hookText = metadata.title.length > 35
  ? metadata.title.substring(0, 35).trim() + '...'
  : metadata.title;

  const [finalPath, thumbnailPath] = await Promise.all([
  composeVideo(videoPath, audioPath, assPath, outputDir, { bgmPath }),
  generateThumbnail(hookText, outputDir, genreKey, metadata.thumbnailQuery || null),
]);

  // 저작권 가드 (업로드 전 자동 검증)
  runCopyrightGuard(outputDir, { videoPath, audioPath, thumbnailPath, script });

  // 업로드 직전: 메타 JSON 기준으로 출처가 설명에 없으면 보강 (CC BY는 필수)
  const fsMetaPath = path.join(outputDir, 'freesound_bgm.json');
  if (fs.existsSync(fsMetaPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(fsMetaPath, 'utf-8'));
      const line = buildFreesoundAttributionLine(m);
      const url = m.url || `https://freesound.org/s/${m.soundId}/`;
      if (mustAppendFreesoundCredit(m) && line && !metadata.description.includes(url)) {
        metadata.description = `${metadata.description}\n\n${line}`;
        fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
        console.log('  ℹ Freesound 출처를 설명에 보강했습니다.');
      }
    } catch (_) {
      /* ignore */
    }
  }

  // YouTube 업로드
  const { videoId, videoUrl } = await uploadVideo(finalPath, metadata, genreKey);
  await setThumbnail(videoId, thumbnailPath, genreKey);

  const result = { jobId, genreKey, topic, metadata, videoId, videoUrl };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`  Uploaded: ${videoUrl}`);
  return result;
}

async function runBatch(genreKey, count = UPLOAD_COUNT) {
  console.log(`\n=== ${getGenre(genreKey).label} | ${count} video(s) ===`);
  const topics = await generateTopics(count, genreKey);

  const results = [];
  for (let i = 0; i < topics.length; i++) {
    try {
      results.push(await runPipeline(topics[i], genreKey));
    } catch (err) {
      console.error(`  Video ${i + 1} failed:`, err.message);
      results.push({ error: err.message, topic: topics[i] });
    }
    if (i < topics.length - 1) {
      await new Promise((r) => setTimeout(r, 3 * 60 * 1000));
    }
  }

  const ok = results.filter((r) => r.videoId).length;
  console.log(`\n=== Done: ${ok}/${topics.length} uploaded ===`);
  return results;
}

// CLI 파싱
const args = process.argv.slice(2);
const genreArg = (args.find((a) => a.startsWith('--genre=')) || '').replace('--genre=', '') || DEFAULT_GENRE;
const countArg = parseInt((args.find((a) => a.startsWith('--count=')) || '').replace('--count=', '') || String(UPLOAD_COUNT), 10);

if (args.includes('--dry-run')) {
  // Claude/OpenAI/Pexels/YouTube 호출 없음 — FFmpeg·canvas만 (비용 없음)
  runDryRunPipeline(genreArg).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (args.includes('--run-once')) {
  runBatch(genreArg, 1).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (args.includes('--run-daily')) {
  runBatch(genreArg, countArg).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.log('Usage:');
  console.log('  node src/index.js --dry-run [--genre=mystery]   # 비용 없음 (FFmpeg 필요)');
  console.log('  node src/index.js --run-once [--genre=mystery]');
  console.log('  node src/index.js --run-daily [--genre=psychology] [--count=5]');
  console.log('Genres: mystery | psychology');
}

module.exports = { runPipeline, runBatch, runDryRunPipeline };
