/**
 * 운영 실패 케이스: 저작권 가드가 업로드를 막아야 하는 조건.
 * 실행: npm test
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runCopyrightGuard } = require('../src/utils/copyrightGuard');

const LONG_SCRIPT = 'x'.repeat(25);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'copyright-guard-'));
}

function guardFails(dir, opts) {
  assert.throws(
    () => runCopyrightGuard(dir, opts),
    (err) => err instanceof Error && /Copyright guard failed/i.test(err.message),
    `expected guard to throw, dir=${dir}`
  );
}

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('운영 실패: 배경 파일명이 Pexels 규칙이 아님 → 차단', () => {
  const dir = tmpDir();
  try {
    const badBg = path.join(dir, 'random_clip.mp4');
    fs.writeFileSync(badBg, '');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), '');
    fs.writeFileSync(path.join(dir, 'script.txt'), LONG_SCRIPT);
    fs.writeFileSync(path.join(dir, 'thumbnail.png'), '');
    guardFails(dir, {
      videoPath: badBg,
      audioPath: path.join(dir, 'audio.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
  } finally {
    rm(dir);
  }
});

test('운영 실패: 음성이 audio.mp3 가 아님 → 차단', () => {
  const dir = tmpDir();
  try {
    const bg = path.join(dir, 'background.mp4');
    fs.writeFileSync(bg, '');
    fs.writeFileSync(path.join(dir, 'voice_from_youtube.mp3'), '');
    fs.writeFileSync(path.join(dir, 'script.txt'), LONG_SCRIPT);
    fs.writeFileSync(path.join(dir, 'thumbnail.png'), '');
    guardFails(dir, {
      videoPath: bg,
      audioPath: path.join(dir, 'voice_from_youtube.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
  } finally {
    rm(dir);
  }
});

test('운영 실패: 허용되지 않은 추가 음원 → 차단', () => {
  const dir = tmpDir();
  try {
    const bg = path.join(dir, 'background.mp4');
    fs.writeFileSync(bg, '');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), '');
    fs.writeFileSync(path.join(dir, 'riaa_favorite.mp3'), '');
    fs.writeFileSync(path.join(dir, 'script.txt'), LONG_SCRIPT);
    fs.writeFileSync(path.join(dir, 'thumbnail.png'), '');
    guardFails(dir, {
      videoPath: bg,
      audioPath: path.join(dir, 'audio.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
  } finally {
    rm(dir);
  }
});

test('운영 실패: script.txt 없음 → 차단', () => {
  const dir = tmpDir();
  try {
    const bg = path.join(dir, 'background.mp4');
    fs.writeFileSync(bg, '');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), '');
    fs.writeFileSync(path.join(dir, 'thumbnail.png'), '');
    guardFails(dir, {
      videoPath: bg,
      audioPath: path.join(dir, 'audio.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
  } finally {
    rm(dir);
  }
});

test('운영 실패: script.txt 너무 짧음 → 차단', () => {
  const dir = tmpDir();
  try {
    const bg = path.join(dir, 'background.mp4');
    fs.writeFileSync(bg, '');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), '');
    fs.writeFileSync(path.join(dir, 'script.txt'), 'short');
    fs.writeFileSync(path.join(dir, 'thumbnail.png'), '');
    guardFails(dir, {
      videoPath: bg,
      audioPath: path.join(dir, 'audio.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
  } finally {
    rm(dir);
  }
});

test('운영 실패: 썸네일 없음 → 차단', () => {
  const dir = tmpDir();
  try {
    const bg = path.join(dir, 'background.mp4');
    fs.writeFileSync(bg, '');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), '');
    fs.writeFileSync(path.join(dir, 'script.txt'), LONG_SCRIPT);
    guardFails(dir, {
      videoPath: bg,
      audioPath: path.join(dir, 'audio.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
  } finally {
    rm(dir);
  }
});

test('운영 실패: Freesound BGM + NonCommercial 메타 → 차단', () => {
  const dir = tmpDir();
  try {
    const bg = path.join(dir, 'background.mp4');
    fs.writeFileSync(bg, '');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), '');
    fs.writeFileSync(path.join(dir, 'script.txt'), LONG_SCRIPT);
    fs.writeFileSync(path.join(dir, 'thumbnail.png'), '');
    fs.writeFileSync(path.join(dir, 'freesound_bgm.mp3'), '');
    fs.writeFileSync(
      path.join(dir, 'freesound_bgm.json'),
      JSON.stringify({
        source: 'freesound',
        license: 'Attribution NonCommercial',
      })
    );
    guardFails(dir, {
      videoPath: bg,
      audioPath: path.join(dir, 'audio.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
  } finally {
    rm(dir);
  }
});

test('운영 성공: 단일 배경(background.mp4) + 필수 파일 충족 → 통과', () => {
  const dir = tmpDir();
  try {
    const bg = path.join(dir, 'background.mp4');
    fs.writeFileSync(bg, '');
    fs.writeFileSync(path.join(dir, 'audio.mp3'), '');
    fs.writeFileSync(path.join(dir, 'script.txt'), LONG_SCRIPT);
    fs.writeFileSync(path.join(dir, 'thumbnail.png'), '');
    const audit = runCopyrightGuard(dir, {
      videoPath: bg,
      audioPath: path.join(dir, 'audio.mp3'),
      thumbnailPath: path.join(dir, 'thumbnail.png'),
    });
    assert.strictEqual(audit.passed, true);
    assert.ok(fs.existsSync(path.join(dir, 'copyright_audit.json')));
  } finally {
    rm(dir);
  }
});
