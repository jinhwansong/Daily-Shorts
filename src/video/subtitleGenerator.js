const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { resolveSubtitleFontFamily } = require('../utils/fontRoles');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** ASS &HAABBGGRR — env 에서 6~8자리 16진만 허용 (앞 &H 생략 가능) */
function assColorFromEnv(key, defaultAbgr) {
  const raw = (process.env[key] || '').trim().replace(/^&H/i, '');
  if (/^[0-9A-Fa-f]{8}$/.test(raw)) return `&H${raw}`;
  if (/^[0-9A-Fa-f]{6}$/.test(raw)) return `&H00${raw}`;
  return defaultAbgr;
}

function intEnv(key, def, min, max) {
  const n = parseInt(process.env[key] || String(def), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/**
 * ASS Alignment: 2 = bottom center, 8 = top center. Shorts/TikTok 모바일은 하단에 제목·채널명 등이 겹쳐 기본은 상단.
 * @returns {{ alignment: number, defaultMarginV: number }}
 */
function subtitlePlacement() {
  const raw = (process.env.SUBTITLE_PLACEMENT || 'top').trim().toLowerCase();
  if (raw === 'bottom') return { alignment: 2, defaultMarginV: 135 };
  return { alignment: 8, defaultMarginV: 150 };
}

/**
 * 쇼츠/틱톡 스타일: 굵은 글꼴·굵은 외곽선·기본 순흰 글자(밝은 배경·상단 자막에서도 대비 확보)
 * BorderStyle 3 + SUBTITLE_BACK_BOX: 글 뒤 반투명 박스(선택)
 */
function buildAssStyleLine() {
  const font = resolveSubtitleFontFamily() || 'Arial';
  const size = intEnv('SUBTITLE_FONT_SIZE', 78, 48, 120);
  const rawBox = (process.env.SUBTITLE_BACK_BOX || '').trim().toLowerCase();
  const useBackBox = rawBox === '1' || rawBox === 'true' || rawBox === 'yes';
  const borderStyle = useBackBox ? 3 : 1;
  const backDefault = useBackBox ? '&HAA000000' : '&H80000000';
  const primary = assColorFromEnv('SUBTITLE_PRIMARY_ABGR', '&H00FFFFFF');
  const secondary = assColorFromEnv('SUBTITLE_SECONDARY_ABGR', '&H000000FF');
  const outlineCol = assColorFromEnv('SUBTITLE_OUTLINE_ABGR', '&H00000000');
  const back = assColorFromEnv('SUBTITLE_BACK_ABGR', backDefault);
  const outlineW = intEnv('SUBTITLE_OUTLINE', 6, 0, 12);
  const shadow = intEnv('SUBTITLE_SHADOW', 4, 0, 8);
  const { alignment, defaultMarginV } = subtitlePlacement();
  const marginV = intEnv('SUBTITLE_MARGIN_V', defaultMarginV, 60, 280);
  const marginH = intEnv('SUBTITLE_MARGIN_LR', 48, 20, 200);
  const spacing = intEnv('SUBTITLE_SPACING', 1, 0, 20);
  const bold = process.env.SUBTITLE_BOLD === '0' ? 0 : -1;

  return `Style: Default,${font},${size},${primary},${secondary},${outlineCol},${back},${bold},0,0,0,100,100,${spacing},0,${borderStyle},${outlineW},${shadow},${alignment},${marginH},${marginH},${marginV},1`;
}

async function generateSubtitles(audioPath, outputDir) {
  const audioStream = fs.createReadStream(audioPath);
  const transcription = await client.audio.transcriptions.create({
    file: audioStream,
    model: 'whisper-1',
    response_format: 'srt',
  });
  const srtPath = path.join(outputDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, transcription);
  return srtPath;
}

function srtToAss(srtPath, outputDir) {
  const srt = fs.readFileSync(srtPath, 'utf-8');
  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${buildAssStyleLine()}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const blocks = srt.trim().split(/\n\n+/);
  const events = blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const timeLine = lines[1];
      const text = lines
        .slice(2)
        .join(' ')
        .replace(/\n/g, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/{/g, '\\{')
        .replace(/}/g, '\\}');
      const [start, end] = timeLine.split(' --> ').map(srtTimeToAss);
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    })
    .filter(Boolean);

  const assPath = path.join(outputDir, 'subtitles.ass');
  fs.writeFileSync(assPath, assHeader + events.join('\n'));
  return assPath;
}

function srtTimeToAss(srtTime) {
  return srtTime
    .replace(',', '.')
    .replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/, (_, h, m, s, ms) => {
      return `${parseInt(h, 10)}:${m}:${s}.${ms.slice(0, 2)}`;
    });
}

module.exports = { generateSubtitles, srtToAss, buildAssStyleLine, subtitlePlacement };
