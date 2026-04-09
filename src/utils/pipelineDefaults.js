/**
 * 영상·Freesound 튜닝 기본값 — 여기만 고치면 로컬 기본 동작이 바뀝니다.
 * CI나 일회성 실험만 env 로 덮어쓰면 됩니다 (미설정이면 아래 상수 사용).
 */

const VIDEO = {
  EQ_BRIGHTNESS: -0.06,
  EQ_SATURATION: 0.88,
  CRF: 21,
  PRESET: 'medium',
  BGM_VOLUME: 0.14,
};

const FREESOUND = {
  /** false 이면 설명에 CC0 출처 덜 붙임 (CC BY 는 의무 표기로 여전히 붙을 수 있음) */
  APPEND_CREDIT: true,
  /** true 이면 Attribution 라이선스 음원도 검색 허용 */
  ALLOW_ATTRIBUTION: false,
};

function envTrim(key) {
  const v = process.env[key];
  if (v === undefined) return '';
  return String(v).trim();
}

function videoEqBrightness() {
  const raw = envTrim('VIDEO_EQ_BRIGHTNESS');
  if (!raw) return VIDEO.EQ_BRIGHTNESS;
  const b = parseFloat(raw);
  return Number.isFinite(b) ? b : VIDEO.EQ_BRIGHTNESS;
}

function videoEqSaturation() {
  const raw = envTrim('VIDEO_EQ_SATURATION');
  if (!raw) return VIDEO.EQ_SATURATION;
  const s = parseFloat(raw);
  return Number.isFinite(s) && s > 0 ? s : VIDEO.EQ_SATURATION;
}

/** 1 또는 true 일 때만 약한 샤픈 */
function videoSharpenOn() {
  const s = envTrim('VIDEO_SHARPEN');
  return s === '1' || s.toLowerCase() === 'true';
}

function bgmVolume() {
  const raw = envTrim('BGM_VOLUME');
  if (!raw) return VIDEO.BGM_VOLUME;
  const v = parseFloat(raw);
  return Number.isFinite(v) && v >= 0 && v <= 2 ? v : VIDEO.BGM_VOLUME;
}

function videoCrf() {
  const raw = envTrim('VIDEO_CRF');
  if (!raw) return VIDEO.CRF;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 18 && n <= 28 ? n : VIDEO.CRF;
}

function videoPreset() {
  const raw = envTrim('VIDEO_PRESET');
  if (!raw) return VIDEO.PRESET;
  return /^[a-z][a-z0-9]*$/i.test(raw) ? raw : VIDEO.PRESET;
}

/** env 가 '0' 이면 끔. 그 외 명시 값은 켬. 미설정이면 FREESOUND.APPEND_CREDIT */
function freesoundAppendCredit() {
  const e = envTrim('FREESOUND_APPEND_CREDIT');
  if (e === '0') return false;
  if (e === '') return FREESOUND.APPEND_CREDIT;
  return true;
}

/** env 가 '1' 이면 켬. 미설정·그 외는 FREESOUND.ALLOW_ATTRIBUTION */
function freesoundAllowAttribution() {
  const e = envTrim('FREESOUND_ALLOW_ATTRIBUTION');
  if (e === '1') return true;
  if (e === '') return FREESOUND.ALLOW_ATTRIBUTION;
  return false;
}

module.exports = {
  VIDEO,
  FREESOUND,
  videoEqBrightness,
  videoEqSaturation,
  videoSharpenOn,
  bgmVolume,
  videoCrf,
  videoPreset,
  freesoundAppendCredit,
  freesoundAllowAttribution,
};
