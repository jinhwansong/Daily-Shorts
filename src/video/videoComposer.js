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

function buildVideoFilter(assPathEscaped, totalDurationStr) {
  return [
    `[0:v]loop=-1:size=300,trim=duration=${totalDurationStr},setpts=PTS-STARTPTS,`,
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},`,
    `eq=brightness=-0.15:saturation=0.7[bg];`,
    `[bg]subtitles='${assPathEscaped}'[burned]`,
  ].join('');
}

/**
 * @param {string} backgroundPath
 * @param {string} audioPath - TTS mp3
 * @param {string} assPath
 * @param {string} outputDir
 * @param {{ bgmPath?: string | null }} [options]
 */
async function composeVideo(backgroundPath, audioPath, assPath, outputDir, options = {}) {
  const { bgmPath: bgmPathOpt } = options;
  const bgmPath =
    bgmPathOpt && fs.existsSync(path.resolve(bgmPathOpt)) ? path.resolve(bgmPathOpt) : null;

  const duration = await getAudioDuration(audioPath);
  const totalDuration = duration + 1.5;
  const TD = totalDuration.toFixed(3);
  const outputPath = path.resolve(path.join(outputDir, 'final.mp4'));

  const tmpAss = path.join(os.tmpdir(), `shorts-burn-${Date.now()}.ass`);
  fs.copyFileSync(assPath, tmpAss);
  const subPath = escapeSubtitlesPath(tmpAss);

  const bgResolved = path.resolve(backgroundPath);
  const audioResolved = path.resolve(audioPath);

  const rawVol = parseFloat(process.env.BGM_VOLUME || '0.14');
  const bgmVol =
    Number.isFinite(rawVol) && rawVol >= 0 && rawVol <= 2 ? rawVol.toFixed(3) : '0.140';

  let args;
  let filterComplex;

  if (bgmPath) {
    const bgmResolved = bgmPath;
    filterComplex = [
      buildVideoFilter(subPath, TD),
      `;[1:a]adelay=1000|1000,aformat=sample_rates=44100:channel_layouts=stereo[voice];`,
      `[2:a]atrim=start=0:duration=${TD},asetpts=PTS-STARTPTS,volume=${bgmVol},aformat=sample_rates=44100:channel_layouts=stereo[bgm];`,
      `[voice][bgm]amix=inputs=2:duration=longest:dropout_transition=2[a_mix];`,
      `[a_mix]atrim=start=0:duration=${TD},asetpts=PTS-STARTPTS[aout]`,
    ].join('');

    args = [
      '-hide_banner',
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      bgResolved,
      '-i',
      audioResolved,
      '-stream_loop',
      '-1',
      '-i',
      bgmResolved,
      '-filter_complex',
      filterComplex,
      '-map',
      '[burned]',
      '-map',
      '[aout]',
      '-t',
      TD,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath,
    ];
  } else {
    filterComplex = [
      `[0:v]loop=-1:size=300,trim=duration=${TD},setpts=PTS-STARTPTS,`,
      `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,`,
      `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},`,
      `eq=brightness=-0.15:saturation=0.7[bg];`,
      `[bg]subtitles='${subPath}'[burned]`,
    ].join('');

    args = [
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
      TD,
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
  }

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
