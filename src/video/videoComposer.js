const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;

function getAudioDuration(audioPath) {
  const resolved = path.resolve(audioPath);
  const r = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      resolved,
    ],
    { encoding: 'utf-8' }
  );
  if (r.status !== 0) {
    throw new Error(r.stderr || `ffprobe failed: ${resolved}`);
  }
  const sec = parseFloat(String(r.stdout).trim());
  if (Number.isNaN(sec)) throw new Error('Could not parse audio duration');
  return sec;
}

/** subtitles 필터용 — 콜론·작은따옴표 이스케이프 (Windows 드라이브 등) */
function escapeSubtitlesPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return normalized.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function composeVideo(backgroundPath, audioPath, assPath, outputDir) {
  const duration = await getAudioDuration(audioPath);
  const totalDuration = duration + 1.5;
  const outputPath = path.resolve(path.join(outputDir, 'final.mp4'));

  const tmpAss = path.join(os.tmpdir(), `shorts-burn-${Date.now()}.ass`);
  fs.copyFileSync(assPath, tmpAss);
  const subPath = escapeSubtitlesPath(tmpAss);

  const bgResolved = path.resolve(backgroundPath);
  const audioResolved = path.resolve(audioPath);

  const filterComplex = [
    `[0:v]loop=-1:size=300,trim=duration=${totalDuration},setpts=PTS-STARTPTS,`,
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},`,
    `eq=brightness=-0.15:saturation=0.7[bg];`,
    `[bg]subtitles='${subPath}'[burned]`,
  ].join('');

  // fluent-ffmpeg는 -map 등 인자 분리가 깨지는 경우가 있어 ffmpeg 직접 호출 (CI 안정)
  const args = [
    '-hide_banner',
    '-y',
    '-stream_loop',
    '-1',
    '-i',
    bgResolved,
    '-itsoffset',
    '1.0',
    '-i',
    audioResolved,
    '-filter_complex',
    filterComplex,
    '-map',
    '[burned]',
    '-map',
    '1:a',
    '-t',
    String(totalDuration),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  const r = spawnSync('ffmpeg', args, {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });

  try {
    fs.unlinkSync(tmpAss);
  } catch (_) {
    /* ignore */
  }

  if (r.status !== 0) {
    const msg = [r.stderr, r.stdout].filter(Boolean).join('\n') || `exit ${r.status}`;
    throw new Error(`ffmpeg failed: ${msg}`);
  }

  return outputPath;
}

module.exports = { composeVideo, getAudioDuration };
