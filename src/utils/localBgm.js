const fs = require('fs');
const path = require('path');

function listMp3InDir(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.mp3$/i.test(f));
}

/**
 * 장르에 bgmDir 이 있으면 그 안의 mp3 중 하나를 무작위로 고름.
 * 폴더가 비어 있으면 bgmFile 단일 파일로 폴백.
 * @returns {{ path: string, fileName: string, poolKind: 'folder'|'single', poolPath: string } | null}
 */
function pickRandomLocalBgm(genre) {
  const dir = genre.bgmDir;
  const files = listMp3InDir(dir);
  if (files.length > 0) {
    const name = files[Math.floor(Math.random() * files.length)];
    const abs = path.resolve(path.join(dir, name));
    return {
      path: abs,
      fileName: name,
      poolKind: 'folder',
      poolPath: path.resolve(dir),
    };
  }
  if (genre.bgmFile && fs.existsSync(genre.bgmFile)) {
    const abs = path.resolve(genre.bgmFile);
    return {
      path: abs,
      fileName: path.basename(genre.bgmFile),
      poolKind: 'single',
      poolPath: abs,
    };
  }
  return null;
}

module.exports = { pickRandomLocalBgm, listMp3InDir };
