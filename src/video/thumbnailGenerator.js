const { createCanvas } = require('@napi-rs/canvas');
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

/**
 * Hook 첫 문장을 장르 색상 기반 템플릿 썸네일로 렌더링
 * @param {string} hookText - 영상 Hook 첫 문장
 * @param {string} outputDir - 저장 경로
 * @param {string} genreKey - 장르 키
 * @returns {string} 저장된 PNG 경로
 */
function generateThumbnail(hookText, outputDir, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // 배경: 진한 단색
  ctx.fillStyle = genre.thumbnailColor;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // 좌측 강조 바
  ctx.fillStyle = genre.thumbnailAccent;
  ctx.fillRect(0, 0, 10, HEIGHT);

  // 채널명 or 장르 레이블 (상단)
  ctx.font = 'bold 28px Arial';
  ctx.fillStyle = genre.thumbnailAccent;
  const brandText = genre.channelName ? genre.channelName.toUpperCase() : genre.label.toUpperCase();
  ctx.fillText(brandText, 40, 60);

  // Hook 텍스트 (중앙)
  const fontSize = hookText.length > 80 ? 52 : hookText.length > 50 ? 60 : 68;
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.fillStyle = '#FFFFFF';

  const lines = wrapText(ctx, hookText, MAX_LINE_WIDTH);
  const lineHeight = fontSize * 1.25;
  const totalHeight = lines.length * lineHeight;
  const startY = (HEIGHT - totalHeight) / 2 + fontSize * 0.8;

  // 텍스트 외곽선 (가독성)
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    ctx.strokeText(line, 40, startY + i * lineHeight);
    ctx.fillText(line, 40, startY + i * lineHeight);
  });

  // 하단 채널명 워터마크
  const watermark = genre.channelName || 'SHORTS';
  ctx.font = '22px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText(watermark, WIDTH - (watermark.length * 13), HEIGHT - 24);

  const outputPath = path.join(outputDir, 'thumbnail.png');
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  return outputPath;
}

module.exports = { generateThumbnail };

if (require.main === module) {
  require('dotenv').config();
  const outDir = path.join(__dirname, '../../output/test');
  fs.mkdirSync(outDir, { recursive: true });

  ['mystery', 'psychology'].forEach((genre) => {
    const samples = {
      mystery: 'A man checked into Room 113. The next morning, the hotel had no record of him.',
      psychology: 'You have made up your mind before you think you have — and your brain hides this from you.',
    };
    const p = generateThumbnail(samples[genre], outDir, genre);
    console.log(`${genre}: ${p}`);
  });
}
