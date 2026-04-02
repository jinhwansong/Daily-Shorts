const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');

const WIDTH = 1280;
const HEIGHT = 720;
const MAX_LINE_WIDTH = WIDTH - 120;

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
 * Hook 첫 문장을 장르 색상 기반 템플릿 썸네일로 렌더링
 * @param {string} hookText
 * @param {string} outputDir
 * @param {string} genreKey
 * @param {string|null} thumbnailQuery - Claude가 생성한 Pexels 검색어
 * @returns {Promise<string>} 저장된 PNG 경로
 */
async function generateThumbnail(hookText, outputDir, genreKey = DEFAULT_GENRE, thumbnailQuery = null) {
  const genre = getGenre(genreKey);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // 배경: Pexels(thumbnailQuery) → 로컬 랜덤 → 단색 순서로 폴백
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
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    } catch (e) {
      ctx.fillStyle = genre.thumbnailColor;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  } else {
    ctx.fillStyle = genre.thumbnailColor;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // 좌측 강조 바
  ctx.fillStyle = genre.thumbnailAccent;
  ctx.fillRect(0, 0, 10, HEIGHT);

  // 채널명 (상단)
  ctx.font = 'bold 28px Arial';
  ctx.fillStyle = genre.thumbnailAccent;
  const brandText = genre.channelName
    ? genre.channelName.toUpperCase()
    : genre.label.toUpperCase();
  ctx.fillText(brandText, 40, 60);

  // Hook 텍스트 (중앙)
  const fontSize = hookText.length > 80 ? 52 : hookText.length > 50 ? 60 : 68;
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = '#FFFFFF';

  const lines = wrapText(ctx, hookText, MAX_LINE_WIDTH);
  const lineHeight = fontSize * 1.25;
  const totalHeight = lines.length * lineHeight;
  const startY = (HEIGHT - totalHeight) / 2 + fontSize * 0.8;

  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    ctx.strokeText(line, 40, startY + i * lineHeight);
    ctx.fillText(line, 40, startY + i * lineHeight);
  });

  // 하단 워터마크
  const watermark = genre.channelName || 'SHORTS';
  ctx.font = '22px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText(watermark, WIDTH - watermark.length * 13, HEIGHT - 24);

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
    mystery: 'A man checked into Room 113. The next morning, the hotel had no record of him.',
    psychology: 'You have made up your mind before you think you have — and your brain hides this from you.',
  };

  (async () => {
    for (const genre of ['mystery', 'psychology']) {
      const p = await generateThumbnail(samples[genre], outDir, genre, 'dark abandoned hallway');
      console.log(`${genre}: ${p}`);
    }
  })();
}