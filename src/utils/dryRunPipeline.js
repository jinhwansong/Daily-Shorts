const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');
const { srtToAss } = require('../video/subtitleGenerator');
const { composeVideo } = require('../video/videoComposer');
const { generateThumbnail } = require('../video/thumbnailGenerator');

const FIXTURE_SCRIPT = path.join(__dirname, '../../fixtures/dry-run-script.txt');

function ffmpegOk() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function formatSrtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function scriptToSrt(script, totalSec) {
  const parts = script
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const n = Math.max(1, parts.length);
  const chunk = totalSec / n;
  let out = '';
  let t = 0;
  parts.forEach((line, i) => {
    const start = formatSrtTime(t);
    const end = formatSrtTime(Math.min(t + chunk - 0.05, totalSec));
    out += `${i + 1}\n${start} --> ${end}\n${line}\n\n`;
    t += chunk;
  });
  return out;
}

function estimateDurationSec(script) {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.min(40, Math.max(28, Math.round(words * 0.42)));
}

function createSilentMp3(outPath, durationSec) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-t',
      String(durationSec),
      '-c:a',
      'libmp3lame',
      '-q:a',
      '6',
      outPath,
    ],
    { stdio: 'pipe' }
  );
}

function createBlackBackground(outPath, durationSec) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=1080x1920:r=30`,
      '-t',
      String(durationSec),
      '-pix_fmt',
      'yuv420p',
      outPath,
    ],
    { stdio: 'pipe' }
  );
}

/**
 * Claude / OpenAI / Pexels / YouTube 호출 없음. FFmpeg + canvas만 사용.
 */
async function runDryRunPipeline(genreKey = DEFAULT_GENRE) {
  if (!ffmpegOk()) {
    throw new Error('ffmpeg 를 찾을 수 없습니다. PATH에 등록했는지 확인하세요.');
  }

  const genre = getGenre(genreKey);
  const jobId = `dry-run_${Date.now()}`;
  const outputDir = path.join(__dirname, `../../output/${jobId}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const script = fs.readFileSync(FIXTURE_SCRIPT, 'utf-8').trim();
  const durationSec = estimateDurationSec(script);

  fs.writeFileSync(path.join(outputDir, 'script.txt'), script);
  fs.writeFileSync(
    path.join(outputDir, 'metadata.json'),
    JSON.stringify(
      {
        title: `[DRY RUN] ${genre.label}`,
        description: '로컬 테스트 — API 비용 없음. 업로드 안 함.',
        tags: ['dry-run', 'test'],
      },
      null,
      2
    )
  );

  const audioPath = path.join(outputDir, 'audio.mp3');
  const videoPath = path.join(outputDir, 'background.mp4');
  console.log(`\n[DRY RUN] ${genre.label} — FFmpeg로 무음·검은 배경 생성 (${durationSec}s)`);
  createSilentMp3(audioPath, durationSec);
  createBlackBackground(videoPath, durationSec);

  const srtContent = scriptToSrt(script, durationSec);
  const srtPath = path.join(outputDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srtContent);
  const assPath = srtToAss(srtPath, outputDir);

  const hookText = script.split('\n')[0];
  const [finalPath, thumbnailPath] = await Promise.all([
    composeVideo(videoPath, audioPath, assPath, outputDir),
    Promise.resolve(generateThumbnail(hookText, outputDir, genreKey)),
  ]);

  fs.writeFileSync(
    path.join(outputDir, 'dry-run.json'),
    JSON.stringify(
      {
        ok: true,
        genreKey,
        finalMp4: finalPath,
        thumbnail: thumbnailPath,
        note: 'YouTube 업로드·API 호출 없음',
      },
      null,
      2
    )
  );

  console.log(`\n✅ DRY RUN 완료 (비용 없음)`);
  console.log(`   영상: ${finalPath}`);
  console.log(`   썸네일: ${thumbnailPath}`);
  console.log(`   로컬 플레이어로 final.mp4 재생해 보세요.\n`);
  return { finalPath, thumbnailPath, outputDir };
}

module.exports = { runDryRunPipeline };
