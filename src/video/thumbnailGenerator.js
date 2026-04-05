const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');

const WIDTH = 1280;
const HEIGHT = 720;

// Bebas Neue 폰트 등록
const FONT_PATH = path.join(__dirname, '../../assets/fonts/BebasNeue-Regular.ttf');
if (fs.existsSync(FONT_PATH)) {
  GlobalFonts.registerFromPath(FONT_PATH, 'BebasNeue');
}
const TITLE_FONT = fs.existsSync(FONT_PATH) ? 'BebasNeue' : 'Arial';

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
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/.test(f));
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
 * @param {string} hookText
 * @param {string} outputDir
 * @param {string} genreKey
 * @param {string|null} thumbnailQuery
 * @returns {Promise<string>}
 */
async function generateThumbnail(hookText, outputDir, genreKey = DEFAULT_GENRE, thumbnailQuery = null) {
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

  // 5. Hook 텍스트 — 중앙 배치
  const maxTextWidth = WIDTH - 160;
  const fontSize = hookText.length > 80 ? 72 : hookText.length > 50 ? 84 : 96;
  ctx.font = `bold ${fontSize}px ${TITLE_FONT}`;
  ctx.textAlign = 'center';

  const lines = wrapText(ctx, hookText.toUpperCase(), maxTextWidth);
  const lineHeight = fontSize * 1.15;
  const totalHeight = lines.length * lineHeight;
  const startY = (HEIGHT - totalHeight) / 2 + fontSize * 0.4;

  // 텍스트 뒤 반투명 박스
  const boxPadding = 24;
  const boxX = 80 - boxPadding;
  const boxY = startY - fontSize - boxPadding;
  const boxW = WIDTH - 160 + boxPadding * 2;
  const boxH = totalHeight + boxPadding * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 8);
  ctx.fill();

  // 텍스트 외곽선
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    ctx.strokeText(line, WIDTH / 2, y);
  });

  // 텍스트 본문 — 흰색 + 강조색 그라디언트
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    if (i === 0 && lines.length > 1) {
      // 첫 줄 강조색
      ctx.fillStyle = genre.thumbnailAccent;
    } else {
      ctx.fillStyle = '#FFFFFF';
    }
    ctx.fillText(line, WIDTH / 2, y);
  });

  // 6. 하단 워터마크
  ctx.font = `18px ${TITLE_FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(channelName.toUpperCase(), WIDTH - 40, HEIGHT - 24);

  // 7. 좌측 강조 바 (얇게)
  ctx.fillStyle = genre.thumbnailAccent;
  ctx.fillRect(0, 0, 5, HEIGHT);

  const outputPath = path.join(outputDir, 'thumbnail.png');
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  return outputPath;
}

module.exports = { generateThumbnail };

if (require.main === module) {
  require('dotenv').config();
  const outDir = path.join(__dirname, '../../output/test');
  fs.mkdirSync(outDir, { recursive: true });

  const samples = {
    mystery: {
      text: 'LIGHTHOUSE KEEPERS VANISHED',           // 짧게
      query: 'dark lighthouse foggy night ocean'     // 분위기 맞는 쿼리
    },
    psychology: {
      text: 'YOUR BRAIN LIES TO YOU',                // 짧게
      query: 'dark corridor shadow human silhouette' // 분위기 맞는 쿼리
    },
  };

  (async () => {
    for (const genre of ['mystery', 'psychology']) {
      const p = await generateThumbnail(
        samples[genre].text,
        outDir,
        genre,
        samples[genre].query
      );
      console.log(`${genre}: ${p}`);
    }
  })();
}