/**
 * 영상·오디오 후처리 플래그 (환경변수)
 */

const { VIDEO } = require('./pipelineDefaults');

function isTruthyEnv(key, defaultVal = false) {
  const raw = (process.env[key] ?? (defaultVal ? '1' : '0')).toString().trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(raw)) return false;
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true;
  return defaultVal;
}

function isAudioLoudnormOn() {
  return isTruthyEnv('AUDIO_LOUDNORM', true);
}

function isKenBurnsOn() {
  return isTruthyEnv('VIDEO_KEN_BURNS', true);
}

function isDualBackgroundOn() {
  return isTruthyEnv('VIDEO_DUAL_BACKGROUND', VIDEO.DUAL_BACKGROUND);
}

/** zoompan 프레임당 zoom 증가 (작을수록 미세) */
function kenBurnsZoomInc() {
  const n = parseFloat(process.env.VIDEO_KEN_ZOOM_INC || '0.00007');
  return Number.isFinite(n) && n > 0 && n < 0.01 ? n : 0.00007;
}

function kenBurnsMaxZoom() {
  const n = parseFloat(process.env.VIDEO_KEN_MAX_ZOOM || '1.08');
  return Number.isFinite(n) && n >= 1 && n <= 1.25 ? n : 1.08;
}

function loudnormI() {
  const n = parseFloat(process.env.AUDIO_LOUDNORM_I || '-16');
  return Number.isFinite(n) ? n : -16;
}

function loudnormTP() {
  const n = parseFloat(process.env.AUDIO_LOUDNORM_TP || '-1.5');
  return Number.isFinite(n) ? n : -1.5;
}

function loudnormLRA() {
  const n = parseFloat(process.env.AUDIO_LOUDNORM_LRA || '11');
  return Number.isFinite(n) ? n : 11;
}

module.exports = {
  isAudioLoudnormOn,
  isKenBurnsOn,
  isDualBackgroundOn,
  kenBurnsZoomInc,
  kenBurnsMaxZoom,
  loudnormI,
  loudnormTP,
  loudnormLRA,
};
