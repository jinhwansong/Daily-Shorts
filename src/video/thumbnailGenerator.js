const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');
const { resolveThumbnailFont } = require('../utils/fontRoles');

const WIDTH = 1280;
const HEIGHT = 720;

const _thumbFont = resolveThumbnailFont();
if (_thumbFont.exists) {
  GlobalFonts.registerFromPath(_thumbFont.filePath, _thumbFont.family);
}
const TITLE_FONT = _thumbFont.exists ? _thumbFont.family : 'Arial';

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function getRandomBackground(genreKey) {
  const dir = path.join(__dirname, `../../assets/images/${genreKey}`);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /\.(jpg|jpeg|png)$/.test(f));
  if (!files.length) return null;
  return path.join(dir, files[Math.floor(Math.random() * files.length)]);
}

async function fetchPexelsImage(query, outputDir) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey || !query) return null;

  try {
    const res = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: apiKey },
      params: { query, per_page: 10, orientation: 'landscape' },
      timeout: 15000,
    });

    const photos = res.data?.photos;
    if (!photos?.length) return null;

    const pick = photos[Math.floor(Math.random() * photos.length)];
    const imgUrl = pick.src.large;
    const imgPath = path.join(outputDir, 'thumbnail_bg.jpg');

    const imgRes = await axios.get(imgUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    fs.writeFileSync(imgPath, Buffer.from(imgRes.data));
    return imgPath;
  } catch (e) {
    console.warn(`  ⚠ Pexels 썸네일 이미지 실패: ${e.message}`);
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {'center'|'corner'} [options.layout='center'] — corner: 짧은 훅 우하단 (롱폼용)
 */
async function generateThumbnail(
  hookText,
  outputDir,
  genreKey = DEFAULT_GENRE,
  thumbnailQuery = null,
  options = {},
) {
  const layout = options.layout === 'corner' ? 'corner' : 'center';
  const genre = getGenre(genreKey);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // 1. 배경 이미지
  let bgImagePath = null;
  if (thumbnailQuery) {
    bgImagePath = await fetchPexelsImage(thumbnailQuery, outputDir);
  }
  if (!bgImagePath) {
    bgImagePath = getRandomBackground(genreKey);
  }

  if (bgImagePath) {
    try {
      const bgImage = await loadImage(bgImagePath);
      ctx.drawImage(bgImage, 0, 0, WIDTH, HEIGHT);
    } catch (e) {
      ctx.fillStyle = genre.thumbnailColor;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  } else {
    ctx.fillStyle = genre.thumbnailColor;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // 2. 하단 → 상단 그라디언트 오버레이 (영화 포스터 느낌)
  const gradientOverlay = ctx.createLinearGradient(0, HEIGHT, 0, 0);
  gradientOverlay.addColorStop(0, 'rgba(0,0,0,0.95)');
  gradientOverlay.addColorStop(0.4, 'rgba(0,0,0,0.75)');
  gradientOverlay.addColorStop(0.7, 'rgba(0,0,0,0.4)');
  gradientOverlay.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = gradientOverlay;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 3. 상단 어두운 그라디언트 (채널명 가독성)
  const topGradient = ctx.createLinearGradient(0, 0, 0, 120);
  topGradient.addColorStop(0, 'rgba(0,0,0,0.7)');
  topGradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, WIDTH, 120);

  // 4. 채널명 (상단 중앙)
  const channelName = genre.channelName || genre.label;
  ctx.font = `bold 26px ${TITLE_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = genre.thumbnailAccent;
  ctx.letterSpacing = '4px';
  ctx.fillText(channelName.toUpperCase(), WIDTH / 2, 48);

  // 채널명 하단 라인
  const lineWidth = ctx.measureText(channelName.toUpperCase()).width + 40;
  ctx.fillStyle = genre.thumbnailAccent;
  ctx.fillRect((WIDTH - lineWidth) / 2, 56, lineWidth, 2);

  ctx.letterSpacing = '0px';

  if (layout === 'corner') {
    // 5. Hook — 우하단 (짧은 문구, YouTube UI 여백 확보)
    const padR = 56;
    const padB = 64;
    const maxTextWidth = Math.floor(WIDTH * 0.46);
    const upper = hookText.toUpperCase();
    const fontSize = upper.length > 48 ? 32 : upper.length > 32 ? 36 : 40;
    ctx.font = `bold ${fontSize}px ${TITLE_FONT}`;
    ctx.textAlign = 'right';
    let lines = wrapText(ctx, upper, maxTextWidth);
    if (lines.length > 2) {
      lines = [lines[0], `${lines.slice(1).join(' ').slice(0, 44)}…`];
    }

    const lineHeight = fontSize * 1.12;
    const totalH = lines.length * lineHeight;
    let maxLineW = 0;
    lines.forEach((ln) => {
      maxLineW = Math.max(maxLineW, ctx.measureText(ln).width);
    });
    const boxPad = 14;
    const boxW = maxLineW + boxPad * 2;
    const boxH = totalH + boxPad * 2;
    const rightX = WIDTH - padR;
    const lastBaseline = HEIGHT - padB;
    const boxY = lastBaseline - (lines.length - 1) * lineHeight - fontSize * 0.85 - boxPad;

    const cornerShade = ctx.createRadialGradient(WIDTH - 40, HEIGHT - 40, 20, WIDTH, HEIGHT, 520);
    cornerShade.addColorStop(0, 'rgba(0,0,0,0.82)');
    cornerShade.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    cornerShade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cornerShade;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.roundRect(rightX - boxW, boxY, boxW, boxH, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    lines.forEach((line, i) => {
      const y = lastBaseline - (lines.length - 1 - i) * lineHeight;
      ctx.strokeText(line, rightX, y);
    });
    lines.forEach((line, i) => {
      const y = lastBaseline - (lines.length - 1 - i) * lineHeight;
      ctx.fillStyle = i === 0 ? genre.thumbnailAccent : '#FFFFFF';
      ctx.fillText(line, rightX, y);
    });
  } else {
    // 5. Hook 텍스트 — 중앙 배치 (숏폼 등)
    const maxTextWidth = WIDTH - 160;
    const fontSize = hookText.length > 80 ? 72 : hookText.length > 50 ? 84 : 96;
    ctx.font = `bold ${fontSize}px ${TITLE_FONT}`;
    ctx.textAlign = 'center';

    const lines = wrapText(ctx, hookText.toUpperCase(), maxTextWidth);
    const lineHeight = fontSize * 1.15;
    const totalHeight = lines.length * lineHeight;
    const startY = (HEIGHT - totalHeight) / 2 + fontSize * 0.4;

    const boxPadding = 24;
    const boxX = 80 - boxPadding;
    const boxY = startY - fontSize - boxPadding;
    const boxW = WIDTH - 160 + boxPadding * 2;
    const boxH = totalHeight + boxPadding * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';

    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      ctx.strokeText(line, WIDTH / 2, y);
    });

    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      if (i === 0 && lines.length > 1) {
        ctx.fillStyle = genre.thumbnailAccent;
      } else {
        ctx.fillStyle = '#FFFFFF';
      }
      ctx.fillText(line, WIDTH / 2, y);
    });
  }

  // 6. 하단 워터마크 (corner: 좌하단 — 훅과 겹침 방지)
  ctx.font = `18px ${TITLE_FONT}`;
  ctx.textAlign = layout === 'corner' ? 'left' : 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  const wmY = HEIGHT - 24;
  if (layout === 'corner') {
    ctx.fillText(channelName.toUpperCase(), 40, wmY);
  } else {
    ctx.fillText(channelName.toUpperCase(), WIDTH - 40, wmY);
  }

  // 7. 좌측 강조 바 (얇게)
  ctx.fillStyle = genre.thumbnailAccent;
  ctx.fillRect(0, 0, 5, HEIGHT);

  const outputPath = path.join(outputDir, 'thumbnail.png');
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  return outputPath;
}

/** 롱폼 썸네일용: metadata.thumbnailHook 우선, 없으면 스크립트 첫 유효 줄, 마지막으로 제목 축약 */
function pickLongformThumbnailHook(metadata, script) {
  const hook = metadata.thumbnailHook && String(metadata.thumbnailHook).trim();
  if (hook) return hook.slice(0, 80);
  const body = script
    .replace(/^\[[A-Z_]+\]\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const firstLine = body.split(/\n/).map((l) => l.trim()).find((l) => l.length > 15);
  if (firstLine) {
    const cut = firstLine.slice(0, 52).trim();
    return firstLine.length > 52 ? `${cut}…` : cut;
  }
  const title = (metadata.title || '').trim();
  return title.length > 42 ? `${title.substring(0, 42).trim()}…` : title;
}

module.exports = { generateThumbnail, pickLongformThumbnailHook };

if (require.main === module) {
  require('dotenv').config();
  const outDir = path.join(__dirname, '../../output/test');
  fs.mkdirSync(outDir, { recursive: true });

  const samples = {
    mystery: {
      text: 'LIGHTHOUSE KEEPERS VANISHED',
      query: 'dark lighthouse foggy night ocean',
    },
  };

  (async () => {
    const genre = 'mystery';
    const p = await generateThumbnail(
      samples[genre].text,
      outDir,
      genre,
      samples[genre].query,
    );
    console.log(`${genre}: ${p}`);
  })();
}
