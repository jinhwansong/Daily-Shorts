const fs = require('fs');
const path = require('path');

/**
 * 업로드 직전 저작권 안전 조건을 검증하고 감사 로그를 반환합니다.
 * 파이프라인 구조상 조건이 이미 충족되어 있지만,
 * 조건이 깨진 경우(파일 누락, 외부 오디오 삽입 등) 업로드를 차단합니다.
 */
function runCopyrightGuard(outputDir, { videoPath, audioPath, thumbnailPath, script }) {
  const checks = [];
  const errors = [];

  function check(label, passed, detail = '') {
    checks.push({ label, passed, detail });
    if (!passed) errors.push(`❌ ${label}${detail ? ': ' + detail : ''}`);
  }

  // 1. 배경 영상: Pexels API 다운로드 결과물인지 (파일명 확인)
  const bgExists = videoPath && fs.existsSync(videoPath);
  check(
    'Pexels CC0 배경 영상',
    bgExists && path.basename(videoPath) === 'background.mp4',
    bgExists ? '' : '파일 없음'
  );

  // 2. 음성: OpenAI TTS 결과물인지 (파일명 확인)
  const audioExists = audioPath && fs.existsSync(audioPath);
  check(
    'OpenAI TTS 음성 (상업 이용 허가)',
    audioExists && path.basename(audioPath) === 'audio.mp3',
    audioExists ? '' : '파일 없음'
  );

  // 3. output 안에 허용되지 않은 음원이 없는지 (Freesound CC0는 freesound_bgm.json으로 검증)
  const allowedExtraAudio = new Set(['freesound_bgm.mp3']);
  const musicFiles = fs.readdirSync(outputDir).filter(
    (f) =>
      /\.(mp3|wav|flac|ogg|aac)$/.test(f) &&
      f !== 'audio.mp3' &&
      !allowedExtraAudio.has(f)
  );
  check('output 폴더에 허용되지 않은 음원 미삽입', musicFiles.length === 0, musicFiles.join(', ') || '');

  const fsBgm = path.join(outputDir, 'freesound_bgm.mp3');
  const fsMeta = path.join(outputDir, 'freesound_bgm.json');
  if (fs.existsSync(fsBgm)) {
    let ok = false;
    let detail = '';
    try {
      if (fs.existsSync(fsMeta)) {
        const m = JSON.parse(fs.readFileSync(fsMeta, 'utf-8'));
        const allowed =
          m.source === 'freesound' &&
          (m.license === 'Creative Commons 0' || m.license === 'Attribution');
        const blockedNc = m.license === 'Attribution NonCommercial';
        ok = allowed && !blockedNc;
        if (!ok) detail = blockedNc ? 'NonCommercial 라이선스 불가' : `라이선스: ${m.license || '?'}`;
      } else {
        detail = 'freesound_bgm.json 없음';
      }
    } catch (e) {
      detail = e.message;
    }
    check('Freesound BGM 메타(CC0 또는 Attribution)', ok, detail);
  }

  // 4. 스크립트 AI 생성: script.txt 존재 + 내용 있음
  const scriptPath = path.join(outputDir, 'script.txt');
  const scriptExists = fs.existsSync(scriptPath) && fs.readFileSync(scriptPath, 'utf-8').trim().length > 20;
  check('AI 생성 스크립트', scriptExists);

  // 5. 썸네일: canvas 자체 생성 (thumbnail.png)
  const thumbExists = thumbnailPath && fs.existsSync(thumbnailPath);
  check(
    'canvas 자체 생성 썸네일 (외부 이미지 없음)',
    thumbExists && path.basename(thumbnailPath) === 'thumbnail.png',
    thumbExists ? '' : '파일 없음'
  );

  // 감사 로그 저장
  const audit = {
    timestamp: new Date().toISOString(),
    passed: errors.length === 0,
    checks,
    errors,
  };
  fs.writeFileSync(path.join(outputDir, 'copyright_audit.json'), JSON.stringify(audit, null, 2));

  if (errors.length > 0) {
    console.error('\n⚠️  저작권 가드 실패 — 업로드 차단');
    errors.forEach((e) => console.error('  ' + e));
    throw new Error('Copyright guard failed. Upload blocked.');
  }

  console.log('  ✅ 저작권 가드 통과');
  return audit;
}

module.exports = { runCopyrightGuard };
