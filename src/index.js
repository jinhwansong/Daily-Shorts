require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { DEFAULT_GENRE, getGenre } = require('./genres');
const { generateTopics } = require('./script/topicGenerator');
const { generateScript, generateMetadata } = require('./script/scriptGenerator');
const { generateTTS } = require('./audio/ttsGenerator');
const { fetchBackgroundVideo } = require('./video/videoFetcher');
const { generateSubtitles, srtToAss } = require('./video/subtitleGenerator');
const { composeVideo } = require('./video/videoComposer');
const { generateThumbnail } = require('./video/thumbnailGenerator');
const { uploadVideo, setThumbnail } = require('./upload/youtubeUploader');
const { runCopyrightGuard } = require('./utils/copyrightGuard');

const UPLOAD_COUNT = parseInt(process.env.DAILY_UPLOAD_COUNT || '1', 10);

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

  // 썸네일 생성 (FFmpeg 합성과 병렬)
  const hookText = script.split('\n')[0];
  const [finalPath, thumbnailPath] = await Promise.all([
    composeVideo(videoPath, audioPath, assPath, outputDir),
    Promise.resolve(generateThumbnail(hookText, outputDir, genreKey)),
  ]);

  // 저작권 가드 (업로드 전 자동 검증)
  runCopyrightGuard(outputDir, { videoPath, audioPath, thumbnailPath, script });

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

if (args.includes('--run-once')) {
  // 장르 1개 영상 즉시 실행
  runBatch(genreArg, 1).catch((e) => { console.error(e); process.exit(1); });
} else if (args.includes('--run-daily')) {
  // 장르 N개 영상 배치 실행
  runBatch(genreArg, countArg).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.log('Usage:');
  console.log('  node src/index.js --run-once [--genre=mystery]');
  console.log('  node src/index.js --run-daily [--genre=dark-animals] [--count=1]');
  console.log('Genres: mystery | dark-animals | psychology');
}

module.exports = { runPipeline, runBatch };
