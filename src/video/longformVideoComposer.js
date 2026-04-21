const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getAudioDuration } = require('./videoComposer');
const {
  isAudioLoudnormOn,
  loudnormI,
  loudnormTP,
  loudnormLRA,
} = require('../utils/videoPipelineEnv');
const { videoEqBrightness, videoEqSaturation, bgmVolume, videoCrf, videoPreset } =
  require('../utils/pipelineDefaults');

const W = 1920;
const H = 1080;
const OUT_FPS = 30;

// 세그먼트 고정 길이 (초)
const CLIP_SEG = 40;
const IMG_SEG = 30;

// 패턴: [clip, img, img] 반복
function buildSegmentList(clipPaths, imagePaths) {
  const segments = [];
  const cycles = Math.max(clipPaths.length, Math.ceil(imagePaths.length / 2));

  for (let c = 0; c < cycles; c++) {
    const clipIdx = c % clipPaths.length;
    segments.push({ type: 'clip', idx: clipIdx });

    const i0 = (c * 2) % imagePaths.length;
    const i1 = (c * 2 + 1) % imagePaths.length;
    segments.push({ type: 'img', idx: i0 });
    if (imagePaths.length > 1) {
      segments.push({ type: 'img', idx: i1 });
    }
  }
  return segments;
}

function escapeSubtitlesPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return normalized.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function buildColorFilter() {
  const brightness = videoEqBrightness();
  const saturation = videoEqSaturation();
  return `eq=brightness=${brightness}:saturation=${saturation}`;
}

/** concat 전에 클립/이미지 스트림을 동일 fps·SAR·pix_fmt로 맞춤 (불일치 시 concat 실패·이상한 에러 유발) */
function normalizeForConcat() {
  return `fps=${OUT_FPS},setsar=1,format=yuv420p`;
}

/**
 * 롱폼 영상 합성: 16:9, Pexels 클립 + DALL-E 이미지 (Ken Burns) 교차 편집
 *
 * @param {string[]} clipPaths — Pexels landscape MP4 경로 배열
 * @param {string[]} imagePaths — DALL-E PNG 경로 배열
 * @param {string} audioPath — TTS MP3
 * @param {string} assPath — 자막 ASS
 * @param {string} outputDir
 * @param {{ bgmPath?: string|null }} [options]
 * @returns {string} 출력 MP4 경로
 */
async function composeLongformVideo(clipPaths, imagePaths, audioPath, assPath, outputDir, options = {}) {
  const { bgmPath: bgmPathOpt } = options;
  const bgmPath = bgmPathOpt && fs.existsSync(path.resolve(bgmPathOpt)) ? path.resolve(bgmPathOpt) : null;

  const audioDuration = await getAudioDuration(audioPath);
  const TD = (audioDuration + 1.5).toFixed(3);

  const tmpAss = path.join(os.tmpdir(), `longform-burn-${Date.now()}.ass`);
  fs.copyFileSync(assPath, tmpAss);
  const subEscaped = escapeSubtitlesPath(tmpAss);

  const segments = buildSegmentList(clipPaths, imagePaths);
  const totalSegs = segments.length;

  const colorFilter = buildColorFilter();
  const inc = 0.00007;
  const maxZ = 1.08;

  // ── 입력 인덱스 계산 ──────────────────────────────────────────────
  // 0 .. N-1       : Pexels 클립 (stream_loop -1)
  // N .. N+M-1     : DALL-E 이미지 (loop 1, framerate 30)
  // N+M            : TTS 오디오
  // N+M+1          : BGM (있을 때)
  const N = clipPaths.length;
  const M = imagePaths.length;
  const audioIdx = N + M;
  const bgmIdx = N + M + 1;

  // ── FFmpeg 입력 인수 ─────────────────────────────────────────────
  const inputArgs = [];
  for (const p of clipPaths) {
    inputArgs.push('-stream_loop', '-1', '-i', path.resolve(p));
  }
  for (const p of imagePaths) {
    inputArgs.push('-framerate', '30', '-loop', '1', '-i', path.resolve(p));
  }
  inputArgs.push('-i', path.resolve(audioPath));
  if (bgmPath) {
    inputArgs.push('-stream_loop', '-1', '-i', bgmPath);
  }

  // ── filter_complex 구축 ──────────────────────────────────────────
  const filterParts = [];

  // 각 Pexels 클립: trim + scale/crop + eq + fps/pix_fmt 통일 → [vc_i]
  const norm = normalizeForConcat();
  for (let i = 0; i < N; i++) {
    filterParts.push(
      `[${i}:v]trim=0:${CLIP_SEG},setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
        `${colorFilter},${norm}[vc${i}]`
    );
  }

  // 각 이미지: Ken Burns + trim + fps/pix_fmt 통일 → [im_j] (lf 접두사는 일부 빌드에서 파싱 혼동 보고 있어 짧은 라벨 사용)
  const zd = Math.max(1, Math.round(OUT_FPS / 4));
  for (let j = 0; j < M; j++) {
    filterParts.push(
      `[${N + j}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
        `zoompan=z='min(zoom+${inc},${maxZ})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${zd}:s=${W}x${H}:fps=${OUT_FPS},` +
        `trim=0:${IMG_SEG},setpts=PTS-STARTPTS,${norm}[im${j}]`
    );
  }

  // 세그먼트 순서대로 concat 입력 레이블 조합
  const segLabels = segments
    .map((s) => (s.type === 'clip' ? `[vc${s.idx}]` : `[im${s.idx}]`))
    .join('');
  filterParts.push(`${segLabels}concat=n=${totalSegs}:v=1:a=0[vcat]`);

  // 자막 오버레이
  filterParts.push(`[vcat]subtitles='${subEscaped}'[burned]`);

  // 오디오 체인
  const vol = bgmVolume().toFixed(3);
  const I = loudnormI();
  const TP = loudnormTP();
  const LRA = loudnormLRA();

  if (bgmPath) {
    filterParts.push(
      `[${audioIdx}:a]adelay=1000|1000,aformat=sample_rates=44100:channel_layouts=stereo[voice]`,
      `[${bgmIdx}:a]atrim=0:${TD},asetpts=PTS-STARTPTS,volume=${vol},aformat=sample_rates=44100:channel_layouts=stereo[bgm]`,
      `[voice][bgm]amix=inputs=2:duration=longest:dropout_transition=2[a_mix]`
    );
    if (isAudioLoudnormOn()) {
      filterParts.push(
        `[a_mix]loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:linear=true:print_format=summary[a_ln]`,
        `[a_ln]atrim=0:${TD},asetpts=PTS-STARTPTS[aout]`
      );
    } else {
      filterParts.push(`[a_mix]atrim=0:${TD},asetpts=PTS-STARTPTS[aout]`);
    }
  } else {
    const delayChain = `[${audioIdx}:a]adelay=1000|1000[a_del]`;
    filterParts.push(delayChain);
    if (isAudioLoudnormOn()) {
      filterParts.push(
        `[a_del]loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:linear=true:print_format=summary[a_ln]`,
        `[a_ln]atrim=0:${TD},asetpts=PTS-STARTPTS[aout]`
      );
    } else {
      filterParts.push(`[a_del]atrim=0:${TD},asetpts=PTS-STARTPTS[aout]`);
    }
  }

  const filterComplex = filterParts.join(';');

  // 긴 그래프는 argv 한도로 잘려 Invalid stream specifier(미정의 패드)가 날 수 있음 → 파일로 전달
  const fcScriptPath = path.join(os.tmpdir(), `longform-fc-${Date.now()}.txt`);
  fs.writeFileSync(fcScriptPath, filterComplex, 'utf8');

  const outputPath = path.resolve(path.join(outputDir, 'final.mp4'));
  const crf = String(videoCrf());
  const preset = videoPreset();

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...inputArgs,
    '-filter_complex_script',
    fcScriptPath,
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
    outputPath,
  ];

  const r = spawnSync('ffmpeg', args, {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });

  try {
    fs.unlinkSync(tmpAss);
  } catch (_) {
    /* ignore */
  }
  try {
    fs.unlinkSync(fcScriptPath);
  } catch (_) {
    /* ignore */
  }

  if (r.status !== 0) {
    const raw = [r.stderr, r.stdout].filter(Boolean).join('\n') || '';
    const errObj = r.error && String(r.error.message || r.error);
    const tail = raw.length > 16000 ? raw.slice(-16000) : raw;
    const msg = tail || errObj || `exit ${r.status}`;
    throw new Error(`ffmpeg (longform) failed: ${msg}`);
  }

  return outputPath;
}

module.exports = { composeLongformVideo };
