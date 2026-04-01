require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const { generateTopics } = require('./script/topicGenerator');
const { generateScript, generateMetadata } = require('./script/scriptGenerator');
const { generateTTS } = require('./audio/ttsGenerator');
const { fetchBackgroundVideo } = require('./video/videoFetcher');
const { generateSubtitles, srtToAss } = require('./video/subtitleGenerator');
const { composeVideo } = require('./video/videoComposer');
const { uploadVideo } = require('./upload/youtubeUploader');

const DAILY_UPLOAD_COUNT = parseInt(process.env.DAILY_UPLOAD_COUNT || '5', 10);
const UPLOAD_TIME_CRON = process.env.UPLOAD_TIME_CRON || '0 22 * * *';

async function runPipeline(topic) {
  const jobId = Date.now();
  const outputDir = path.join(__dirname, `../output/${jobId}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const script = await generateScript(topic);
  const metadata = await generateMetadata(script, topic);
  fs.writeFileSync(path.join(outputDir, 'script.txt'), script);
  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  const audioPath = await generateTTS(script, outputDir);
  const videoPath = await fetchBackgroundVideo(outputDir);
  const srtPath = await generateSubtitles(audioPath, outputDir);
  const assPath = srtToAss(srtPath, outputDir);
  const finalPath = await composeVideo(videoPath, audioPath, assPath, outputDir);
  const { videoId, videoUrl } = await uploadVideo(finalPath, metadata);

  const result = { jobId, topic, metadata, videoId, videoUrl, outputDir };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

async function runDaily() {
  const topics = await generateTopics(DAILY_UPLOAD_COUNT);
  const results = [];
  for (let i = 0; i < topics.length; i++) {
    try {
      results.push(await runPipeline(topics[i]));
    } catch (err) {
      console.error(`Video ${i + 1} failed:`, err.message);
      results.push({ error: err.message, topic: topics[i] });
    }
    if (i < topics.length - 1) {
      await new Promise((r) => setTimeout(r, 3 * 60 * 1000));
    }
  }
  return results;
}

const args = process.argv.slice(2);

if (args.includes('--run-once')) {
  generateTopics(1).then(([topic]) => runPipeline(topic)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (args.includes('--run-daily')) {
  runDaily().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.log(`Scheduler: ${UPLOAD_TIME_CRON}`);
  cron.schedule(UPLOAD_TIME_CRON, () => runDaily().catch(console.error));
}

module.exports = { runPipeline, runDaily };
