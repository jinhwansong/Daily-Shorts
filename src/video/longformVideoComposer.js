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
const { parseScriptSections } = require('./dalleImageGenerator');

const W = 1920;
const H = 1080;
const OUT_FPS = 30;

// 세그먼트 고정 길이 (초)
const CLIP_SEG = 40;
const IMG_SEG = 30;

const MIN_SEG_SEC = 5; // 세그먼트 최소 길이(초) — 너무 짧으면 concat 불안정

/**
 * 레거시 교차 패턴 (스크립트 미전달 시): [clip, img_a, img_b] × cycles
 * 고정 duration 사용 (CLIP_SEG / IMG_SEG).
 */
function buildSegmentListLegacy(clipPaths, imagePaths) {
  if (!clipPaths.length && !imagePaths.length) return [];
  if (!clipPaths.length) {
    return imagePaths.map((_, idx) => ({ type: 'img', idx, duration: IMG_SEG }));
  }
  const segments = [];
  const cycles = Math.max(clipPaths.length, Math.ceil(imagePaths.length / 2));
  for (let c = 0; c < cycles; c++) {
    const clipIdx = c % clipPaths.length;
    segments.push({ type: 'clip', idx: clipIdx, duration: CLIP_SEG });
    const i0 = (c * 2) % imagePaths.length;
    const i1 = (c * 2 + 1) % imagePaths.length;
    segments.push({ type: 'img', idx: i0, duration: IMG_SEG });
    if (imagePaths.length > 1) {
      segments.push({ type: 'img', idx: i1, duration: IMG_SEG });
    }
  }
  return segments;
}

/**
 * 섹션별 단어 수 비율 → 해당 섹션이 차지해야 할 영상 시간 계산
 * @returns {{ section, duration }[]}
 */
function calcSectionDurations(script, audioDuration) {
  const TD = audioDuration + 1.5;
  const sections = parseScriptSections(script).filter((s) => s.text && s.text.trim());
  if (!sections.length) return [];
  const wordCounts = sections.map((s) => s.text.split(/\s+/).filter(Boolean).length);
  const total = wordCounts.reduce((a, b) => a + b, 0) || 1;
  return sections.map((s, i) => ({
    section: s,
    duration: (wordCounts[i] / total) * TD,
  }));
}

/**
 * 스크립트 섹션 순서 + 비율 기반 duration 배분.
 *
 * 각 섹션:
 *   - 1 Pexels 클립 + ips 장의 AI 이미지
 *   - 세그먼트 하나당 duration = sectionDur / (1 + ips)  (균등 분배)
 *   - 최소 MIN_SEG_SEC 보장
 *
 * 이미지가 남으면 끝에 추가 (클립 1 + 이미지 1 pair, 각 10/15초).
 *
 * @param {string} script
 * @param {string[]} clipPaths
 * @param {string[]} imagePaths
 * @param {number} imagesPerSection
 * @param {number} audioDuration  — TTS 오디오 길이(초)
 */
function buildSegmentListFromScript(script, clipPaths, imagePaths, imagesPerSection, audioDuration) {
  const ips = Math.max(1, Math.min(3, Number(imagesPerSection) || 1));
  if (!script || !clipPaths.length || !imagePaths.length) {
    return buildSegmentListLegacy(clipPaths, imagePaths);
  }
  const sectionDurs = calcSectionDurations(script, audioDuration);
  if (!sectionDurs.length) return buildSegmentListLegacy(clipPaths, imagePaths);

  const segments = [];
  let imgCursor = 0;

  for (let si = 0; si < sectionDurs.length; si++) {
    const secDur = sectionDurs[si].duration;
    const available = imagePaths.length - imgCursor;
    const ipsActual = Math.min(ips, available);
    const segCount = 1 + ipsActual; // clip + images
    // 각 세그먼트가 균등하게 섹션 시간 소화, 최소 보장
    const perSeg = Math.max(MIN_SEG_SEC, secDur / segCount);
    const clipDur = Math.round(perSeg * 10) / 10;
    const imgDur = Math.round(perSeg * 10) / 10;

    segments.push({ type: 'clip', idx: si % clipPaths.length, duration: clipDur });
    for (let k = 0; k < ipsActual; k++) {
      segments.push({ type: 'img', idx: imgCursor, duration: imgDur });
      imgCursor++;
    }
  }

  // 남은 이미지 소비
  let extra = 0;
  while (imgCursor < imagePaths.length) {
    segments.push({ type: 'clip', idx: (sectionDurs.length + extra) % clipPaths.length, duration: 10 });
    segments.push({ type: 'img', idx: imgCursor, duration: 15 });
    imgCursor++;
    extra++;
  }

  return segments.length ? segments : buildSegmentListLegacy(clipPaths, imagePaths);
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
 * @param {{ bgmPath?: string|null, script?: string, imagesPerSection?: number }} [options]
 *   script + imagesPerSection — 섹션 순서대로 클립→이미지 배치 (없으면 레거시 교차 패턴)
 * @returns {string} 출력 MP4 경로
 */
async function composeLongformVideo(clipPaths, imagePaths, audioPath, assPath, outputDir, options = {}) {
  const { bgmPath: bgmPathOpt, script, imagesPerSection } = options;
  const bgmPath = bgmPathOpt && fs.existsSync(path.resolve(bgmPathOpt)) ? path.resolve(bgmPathOpt) : null;

  const audioDuration = await getAudioDuration(audioPath);
  const TD = (audioDuration + 1.5).toFixed(3);

  const tmpAss = path.join(os.tmpdir(), `longform-burn-${Date.now()}.ass`);
  fs.copyFileSync(assPath, tmpAss);
  const subEscaped = escapeSubtitlesPath(tmpAss);

  const useScriptOrder =
    String(script || '').trim().length > 0 &&
    imagesPerSection != null &&
    Number(imagesPerSection) > 0;
  const segments = useScriptOrder
    ? buildSegmentListFromScript(script, clipPaths, imagePaths, imagesPerSection, audioDuration)
    : buildSegmentListLegacy(clipPaths, imagePaths);
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
  // 핵심: 동일 이미지가 세그먼트에서 여러 번 재사용될 수 있음.
  // named 출력 패드는 concat 입력으로 한 번만 쓸 수 있으므로,
  // 이미지/클립 인덱스별이 아닌 **세그먼트 순번별** 출력 패드를 생성한다.
  const filterParts = [];
  const norm = normalizeForConcat();

  for (let k = 0; k < totalSegs; k++) {
    const seg = segments[k];
    const dur = Math.max(MIN_SEG_SEC, seg.duration ?? (seg.type === 'clip' ? CLIP_SEG : IMG_SEG));
    if (seg.type === 'clip') {
      filterParts.push(
        `[${seg.idx}:v]trim=0:${dur},setpts=PTS-STARTPTS,` +
          `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
          `${colorFilter},${norm}[sv${k}]`
      );
    } else {
      // zoompan d: 이미지 duration × fps 프레임 동안 줌 적용
      const zpFrames = Math.round(dur * OUT_FPS);
      filterParts.push(
        `[${N + seg.idx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
          `zoompan=z='min(zoom+${inc},${maxZ})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${zpFrames}:s=${W}x${H}:fps=${OUT_FPS},` +
          `trim=0:${dur},setpts=PTS-STARTPTS,${norm}[sv${k}]`
      );
    }
  }

  // 각 세그먼트 패드가 모두 고유 → concat 입력 중복 없음
  const segLabels = Array.from({ length: totalSegs }, (_, k) => `[sv${k}]`).join('');
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
  // GitHub Actions: ubuntu-latest는 CPU 2코어 — 스레드 수 자동(0)으로 두면 FFmpeg가 최적 결정
  const threads = String(parseInt(process.env.FFMPEG_THREADS || '0', 10));

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-threads',
    threads,
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
    '-pix_fmt',
    'yuv420p',
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
