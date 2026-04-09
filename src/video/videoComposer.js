const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isAudioLoudnormOn,
  isKenBurnsOn,
  kenBurnsZoomInc,
  kenBurnsMaxZoom,
  loudnormI,
  loudnormTP,
  loudnormLRA,
} = require('../utils/videoPipelineEnv');
const {
  videoEqBrightness,
  videoEqSaturation,
  videoSharpenOn,
  bgmVolume,
  videoCrf,
  videoPreset,
} = require('../utils/pipelineDefaults');

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

function escapeSubtitlesPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return normalized.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

const DEFAULT_FONTS_DIR = path.join(__dirname, '../../assets/fonts');

function resolvedSubtitleFontsDir() {
  const override = (process.env.SUBTITLE_FONTS_DIR || '').trim();
  if (override && fs.existsSync(override)) return path.resolve(override);
  return DEFAULT_FONTS_DIR;
}

function buildSubtitlesFilter(assPathEscaped) {
  let fontsOpt = '';
  const dir = resolvedSubtitleFontsDir();
  if (fs.existsSync(dir)) {
    const hasFont = fs.readdirSync(dir).some((f) => /\.(ttf|otf|ttc)$/i.test(f));
    if (hasFont) {
      const fd = escapeSubtitlesPath(dir);
      fontsOpt = `:fontsdir='${fd}'`;
    }
  }
  return `subtitles='${assPathEscaped}'${fontsOpt}`;
}

function parseEqParams() {
  return { brightness: videoEqBrightness(), saturation: videoEqSaturation() };
}

function buildColorChain() {
  const { brightness, saturation } = parseEqParams();
  const eq = `eq=brightness=${brightness}:saturation=${saturation}`;
  if (videoSharpenOn()) {
    return `${eq},unsharp=5:5:0.6:3:3:0.0`;
  }
  return eq;
}

function scaleTrimColorInput(inputLabel, durationStr, outLabel) {
  const color = buildColorChain();
  return [
    `${inputLabel}loop=-1:size=300,trim=duration=${durationStr},setpts=PTS-STARTPTS,`,
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},`,
    `${color}${outLabel}`,
  ].join('');
}

function kenBurnsSegment(inLabel, outLabel) {
  if (!isKenBurnsOn()) {
    return `${inLabel}format=yuv420p${outLabel}`;
  }
  const inc = kenBurnsZoomInc();
  const maxZ = kenBurnsMaxZoom();
  return `${inLabel}zoompan=z='min(zoom+${inc},${maxZ})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:fps=30${outLabel}`;
}

function buildVideoFilterGraph(assPathEscaped, TD, dual) {
  const sub = buildSubtitlesFilter(assPathEscaped);

  if (!dual) {
    const base = scaleTrimColorInput('[0:v]', TD, '[vbase]');
    return [
      `${base};`,
      `${kenBurnsSegment('[vbase]', '[vkb]')};`,
      `[vkb]${sub}[burned]`,
    ].join('');
  }

  const half = (parseFloat(TD) / 2).toFixed(3);
  const a = scaleTrimColorInput('[0:v]', half, '[v1]');
  const b = scaleTrimColorInput('[1:v]', half, '[v2]');
  return [
    `${a};`,
    `${b};`,
    `[v1][v2]concat=n=2:v=1:a=0[vcat];`,
    `${kenBurnsSegment('[vcat]', '[vkb]')};`,
    `[vkb]${sub}[burned]`,
  ].join('');
}

function buildVoiceOnlyAudioChain(audioInputLabel, TD) {
  const delay = `${audioInputLabel}adelay=1000|1000[vo_del];`;
  if (!isAudioLoudnormOn()) {
    return `${delay}[vo_del]atrim=start=0:duration=${TD},asetpts=PTS-STARTPTS[aout]`;
  }
  const I = loudnormI();
  const TP = loudnormTP();
  const LRA = loudnormLRA();
  return [
    delay,
    `[vo_del]loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:linear=true:print_format=summary[vo_ln];`,
    `[vo_ln]atrim=start=0:duration=${TD},asetpts=PTS-STARTPTS[aout]`,
  ].join('');
}

/**
 * @param {string} backgroundPath
 * @param {string} audioPath
 * @param {string} assPath
 * @param {string} outputDir
 * @param {{ bgmPath?: string | null, backgroundPath2?: string | null }} [options]
 */
async function composeVideo(backgroundPath, audioPath, assPath, outputDir, options = {}) {
  const { bgmPath: bgmPathOpt, backgroundPath2 } = options;
  const bgmPath =
    bgmPathOpt && fs.existsSync(path.resolve(bgmPathOpt)) ? path.resolve(bgmPathOpt) : null;

  const dual =
    !!(backgroundPath2 && fs.existsSync(path.resolve(backgroundPath2))) &&
    path.resolve(backgroundPath) !== path.resolve(backgroundPath2);

  const duration = await getAudioDuration(audioPath);
  const totalDuration = duration + 1.5;
  const TD = totalDuration.toFixed(3);
  const outputPath = path.resolve(path.join(outputDir, 'final.mp4'));

  const tmpAss = path.join(os.tmpdir(), `shorts-burn-${Date.now()}.ass`);
  fs.copyFileSync(assPath, tmpAss);
  const subPath = escapeSubtitlesPath(tmpAss);

  const bgResolved = path.resolve(backgroundPath);
  const bg2Resolved = dual ? path.resolve(backgroundPath2) : null;
  const audioResolved = path.resolve(audioPath);

  const vol = bgmVolume();
  const bgmVol = vol.toFixed(3);

  const crf = String(videoCrf());
  const preset = videoPreset();

  const vFilter = buildVideoFilterGraph(subPath, TD, dual);

  let args;
  let filterComplex;

  if (bgmPath) {
    const bgmResolved = bgmPath;
    const ai = dual ? '2' : '1';
    const bi = dual ? '3' : '2';

    const mixToOut = isAudioLoudnormOn()
      ? [
          `[a_mix]loudnorm=I=${loudnormI()}:TP=${loudnormTP()}:LRA=${loudnormLRA()}:linear=true:print_format=summary[a_ln];`,
          `[a_ln]atrim=start=0:duration=${TD},asetpts=PTS-STARTPTS[aout]`,
        ].join('')
      : `[a_mix]atrim=start=0:duration=${TD},asetpts=PTS-STARTPTS[aout]`;

    filterComplex = [
      vFilter,
      `;[${ai}:a]adelay=1000|1000,aformat=sample_rates=44100:channel_layouts=stereo[voice];`,
      `[${bi}:a]atrim=start=0:duration=${TD},asetpts=PTS-STARTPTS,volume=${bgmVol},aformat=sample_rates=44100:channel_layouts=stereo[bgm];`,
      `[voice][bgm]amix=inputs=2:duration=longest:dropout_transition=2[a_mix];`,
      mixToOut,
    ].join('');

    args = ['-hide_banner', '-y', '-stream_loop', '-1', '-i', bgResolved];
    if (dual) {
      args.push('-stream_loop', '-1', '-i', bg2Resolved);
    }
    args.push(
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
      preset,
      '-crf',
      crf,
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath
    );
  } else {
    const ai = dual ? '2' : '1';
    const audioLabel = `[${ai}:a]`;
    filterComplex = [vFilter, ';', buildVoiceOnlyAudioChain(audioLabel, TD)].join('');

    args = ['-hide_banner', '-y', '-stream_loop', '-1', '-i', bgResolved];
    if (dual) {
      args.push('-stream_loop', '-1', '-i', bg2Resolved);
    }
    args.push(
      '-i',
      audioResolved,
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
      preset,
      '-crf',
      crf,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath
    );
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
