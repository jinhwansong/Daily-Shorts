const fs = require('fs');
const path = require('path');

function listMp3InDir(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.mp3$/i.test(f));
}

/**
 * 장르에 bgmDir 이 있으면 그 안의 mp3 중 하나를 무작위로 고름.
 * 폴더가 비어 있으면 bgmFile 단일 파일로 폴백.
 * @returns {string|null} 절대 경로
 */
function pickRandomLocalBgm(genre) {
  const dir = genre.bgmDir;
  const files = listMp3InDir(dir);
  if (files.length > 0) {
    const name = files[Math.floor(Math.random() * files.length)];
    return path.resolve(path.join(dir, name));
  }
  if (genre.bgmFile && fs.existsSync(genre.bgmFile)) {
    return path.resolve(genre.bgmFile);
  }
  return null;
}

module.exports = { pickRandomLocalBgm, listMp3InDir };
