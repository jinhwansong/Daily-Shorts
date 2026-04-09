const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '../../assets/fonts');
const CONFIG_PATH = path.join(FONTS_DIR, 'fonts.json');

/** fonts.json 없을 때 기본: 썸네일=압축 헤드라인, 자막=읽기 쉬운 산세리프 */
const DEFAULTS = {
  thumbnail: { file: 'Anton-Regular.ttf', family: 'Anton' },
  subtitle: { file: 'Oswald-SemiBold.ttf', family: 'Oswald' },
};

function loadConfig() {
  const cfg = {
    thumbnail: { ...DEFAULTS.thumbnail },
    subtitle: { ...DEFAULTS.subtitle },
  };
  if (!fs.existsSync(CONFIG_PATH)) return cfg;
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (j.thumbnail && typeof j.thumbnail === 'object') {
      cfg.thumbnail = { ...cfg.thumbnail, ...j.thumbnail };
    }
    if (j.subtitle && typeof j.subtitle === 'object') {
      cfg.subtitle = { ...cfg.subtitle, ...j.subtitle };
    }
  } catch (_) {
    /* ignore */
  }
  return cfg;
}

/**
 * 썸네일(canvas)용 — registerFromPath 에 쓸 경로와 ctx.font 패밀리명
 * THUMBNAIL_FONT_FILE / THUMBNAIL_FONT_FAMILY 가 있으면 fonts.json 보다 우선
 */
function resolveThumbnailFont() {
  const cfg = loadConfig();
  const fileFromEnv = (process.env.THUMBNAIL_FONT_FILE || '').trim();
  const file = fileFromEnv || (cfg.thumbnail.file || DEFAULTS.thumbnail.file).trim();
  const filePath = path.join(FONTS_DIR, path.basename(file));
  const family = (
    process.env.THUMBNAIL_FONT_FAMILY ||
    cfg.thumbnail.family ||
    DEFAULTS.thumbnail.family
  ).trim();
  return {
    filePath,
    family,
    exists: fs.existsSync(filePath),
  };
}

/**
 * ASS 자막 Style 의 Fontname — SUBTITLE_FONT_NAME 이 있으면 최우선, 없으면 fonts.json
 */
function resolveSubtitleFontFamily() {
  const env = (process.env.SUBTITLE_FONT_NAME || '').trim();
  if (env) return env;
  const cfg = loadConfig();
  return (cfg.subtitle.family || DEFAULTS.subtitle.family).trim();
}

module.exports = {
  FONTS_DIR,
  loadConfig,
  resolveThumbnailFont,
  resolveSubtitleFontFamily,
};
