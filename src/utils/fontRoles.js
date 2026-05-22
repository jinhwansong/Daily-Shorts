const fs = require('fs');
const path = require('path');

const FONTS_DIR = path.join(__dirname, '../../assets/fonts');
const CONFIG_PATH = path.join(FONTS_DIR, 'fonts.json');

const DEFAULTS = {
  subtitle: { file: 'Oswald-SemiBold.ttf', family: 'Oswald' },
};

function loadConfig() {
  const cfg = {
    subtitle: { ...DEFAULTS.subtitle },
  };
  if (!fs.existsSync(CONFIG_PATH)) return cfg;
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (j.subtitle && typeof j.subtitle === 'object') {
      cfg.subtitle = { ...cfg.subtitle, ...j.subtitle };
    }
  } catch (_) {
    /* ignore */
  }
  return cfg;
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
  resolveSubtitleFontFamily,
};
