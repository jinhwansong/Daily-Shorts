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
  isMysteryColorGradeOn,
} = require('../utils/videoPipelineEnv');
const { HOOK_CLIP_DURATION } = require('./hookImageGenerator');
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
  if (!fs.existsSync(resolved)) {
    throw new Error(`Audio file not found: ${resolved}`);
  }
  const size = fs.statSync(resolved).size;
  if (size < 64) {
    throw new Error(`Audio file empty or too small (${size} B): ${resolved}`);
  }
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
    const fromSpawn = r.error ? String(r.error.message || r.error) : '';
    const fromFf = (r.stderr || '').trim();
    const detail = [fromFf, fromSpawn].filter(Boolean).join(' | ') || 'no stderr';
    const winHint =
      process.platform === 'win32'
        ? ' Windows에서는 FFmpeg 전체를 설치하고 PATH에 ffprobe.exe 가 잡혀야 합니다. (winget install ffmpeg 또는 https://www.gyan.dev/ffmpeg/builds/ )'
        : '';
    throw new Error(`ffprobe failed: ${resolved} — ${detail}${winHint}`);
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
  if (isMysteryColorGradeOn()) {
    // 미스터리 색보정: curves(어둡게) + eq(대비↑ 채도↓) + vignette(영화적 가장자리)
    return `curves=all='0/0 0.3/0.15 1/0.8',eq=contrast=1.3:brightness=-0.05:saturation=0.6,vignette=PI/4`;
  }
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

/** TTS+패딩 총 길이(TD)를 n등분 (끝 구간이 부동소수 누적 오차를 흡수) */
function splitEqualDurationsStr(TD, n) {
  const t = parseFloat(TD, 10);
  if (n <= 1) return [String(TD)];
  if (n <= 0) return [String(TD)];
  const d = t / n;
  const out = [];
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    const s = d;
    out.push(s.toFixed(3));
    sum += s;
  }
  out.push((t - sum).toFixed(3));
  return out;
}

/**
 * @param {string} assPathEscaped
 * @param {string} TD_pexels  Pexels 클립 총 커버 시간 (hook 제외)
 * @param {number} nSeg       Pexels 배경 클립 수
 * @param {boolean} hasHook   훅 이미지 클립 사용 여부 (입력 [0])
 *
 * hook 있을 때 입력 순서: [0]=hook_clip, [1..N]=bgList
 * hook 없을 때 입력 순서: [0..N-1]=bgList
 */
function buildVideoFilterGraph(assPathEscaped, TD_pexels, nSeg, hasHook) {
  const sub = buildSubtitlesFilter(assPathEscaped);
  const bgStart = hasHook ? 1 : 0;
  const totalN = hasHook ? nSeg + 1 : nSeg;

  const parts = [];
  const concatInputs = [];

  if (hasHook) {
    // 훅 클립: scale/crop만 적용, 색보정 없음
    parts.push(
      `[0:v]trim=duration=${HOOK_CLIP_DURATION},setpts=PTS-STARTPTS,` +
        `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1,format=yuv420p[hpre]`
    );
    concatInputs.push('[hpre]');
  }

  if (nSeg === 1) {
    const base = scaleTrimColorInput(`[${bgStart}:v]`, TD_pexels, '[vpre0]');
    parts.push(base);
    concatInputs.push('[vpre0]');
  } else {
    const durs = splitEqualDurationsStr(TD_pexels, nSeg);
    for (let i = 0; i < nSeg; i++) {
      parts.push(scaleTrimColorInput(`[${bgStart + i}:v]`, durs[i], `[vpre${i}]`));
      concatInputs.push(`[vpre${i}]`);
    }
  }

  let vForKB;
  if (totalN === 1) {
    vForKB = '[vpre0]';
  } else {
    parts.push(`${concatInputs.join('')}concat=n=${totalN}:v=1:a=0[vcat]`);
    vForKB = '[vcat]';
  }

  parts.push(kenBurnsSegment(vForKB, '[vkb]'));
  parts.push(`[vkb]${sub}[burned]`);

  return parts.join(';');
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
 * @param {{ bgmPath?: string | null, backgroundPath2?: string | null, backgroundPaths?: string[] | null, hookClipPath?: string | null }} [options]
 */
async function composeVideo(backgroundPath, audioPath, assPath, outputDir, options = {}) {
  const { bgmPath: bgmPathOpt, backgroundPath2, backgroundPaths: bgPathsIn, hookClipPath: hookClipOpt } = options;
  const bgmPath =
    bgmPathOpt && fs.existsSync(path.resolve(bgmPathOpt)) ? path.resolve(bgmPathOpt) : null;
  const hookClipPath =
    hookClipOpt && fs.existsSync(path.resolve(hookClipOpt)) ? path.resolve(hookClipOpt) : null;
  const hasHook = !!hookClipPath;

  const duration = await getAudioDuration(audioPath);
  // Pexels 클립이 커버할 시간 (hook 제외)
  const TD_pexels = (duration + 1.5).toFixed(3);
  // 전체 영상 길이 (hook 있으면 1.5초 추가)
  const totalDuration = duration + 1.5 + (hasHook ? HOOK_CLIP_DURATION : 0);
  const TD = totalDuration.toFixed(3);

  const outputPath = path.resolve(path.join(outputDir, 'final.mp4'));

  const tmpAss = path.join(os.tmpdir(), `shorts-burn-${Date.now()}.ass`);
  fs.copyFileSync(assPath, tmpAss);
  const subPath = escapeSubtitlesPath(tmpAss);

  const audioResolved = path.resolve(audioPath);

  let bgList;
  if (Array.isArray(bgPathsIn) && bgPathsIn.length > 0) {
    bgList = bgPathsIn.map((p) => path.resolve(p)).filter((p) => fs.existsSync(p));
  } else if (
    backgroundPath2 &&
    fs.existsSync(path.resolve(backgroundPath2)) &&
    path.resolve(backgroundPath) !== path.resolve(backgroundPath2)
  ) {
    bgList = [path.resolve(backgroundPath), path.resolve(backgroundPath2)];
  } else {
    bgList = [path.resolve(backgroundPath)];
  }
  if (bgList.length < 1) {
    throw new Error('No background video file for composeVideo');
  }
  const nSeg = bgList.length;
  const vol = bgmVolume();
  const bgmVol = vol.toFixed(3);

  const crf = String(videoCrf());
  const preset = videoPreset();

  const vFilter = buildVideoFilterGraph(subPath, TD_pexels, nSeg, hasHook);

  // 입력 인덱스: hook(있으면 0) → bgList → audio → bgm
  const audioIdx = nSeg + (hasHook ? 1 : 0);
  const bgmIdx = audioIdx + 1;
  const voiceIn = String(audioIdx);
  const bgmIn = String(bgmIdx);

  let args;
  let filterComplex;

  if (bgmPath) {
    const bgmResolved = bgmPath;
    const ai = voiceIn;
    const bi = bgmIn;

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

    args = ['-hide_banner', '-y'];
    if (hookClipPath) args.push('-i', hookClipPath);
    for (const p of bgList) {
      args.push('-stream_loop', '-1', '-i', p);
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
    const audioLabel = `[${voiceIn}:a]`;
    filterComplex = [vFilter, ';', buildVoiceOnlyAudioChain(audioLabel, TD)].join('');

    args = ['-hide_banner', '-y'];
    if (hookClipPath) args.push('-i', hookClipPath);
    for (const p of bgList) {
      args.push('-stream_loop', '-1', '-i', p);
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
