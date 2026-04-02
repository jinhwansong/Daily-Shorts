const fs = require('fs');
const path = require('path');

/** 프로젝트 루트 기준 선택 파일 (여러 줄 가능) */
const FOOTER_FILE = path.join(__dirname, '../../assets/attribution_footer.txt');

/**
 * 업로드 설명란 맨 아래(해시태그·#Shorts 전에 붙는 본문 기준)에 덧붙일 고정 문구.
 * - assets/attribution_footer.txt 가 있으면 내용 사용
 * - YOUTUBE_ATTRIBUTION_FOOTER 환경변수가 있으면 추가 (\\n 은 줄바꿈으로 처리)
 * 둘 다 있으면 파일 내용 다음에 env 내용을 이어 붙입니다.
 */
function getAttributionFooter() {
  const parts = [];
  if (fs.existsSync(FOOTER_FILE)) {
    const fromFile = fs.readFileSync(FOOTER_FILE, 'utf-8').trim();
    if (fromFile) parts.push(fromFile);
  }
  const fromEnv = (process.env.YOUTUBE_ATTRIBUTION_FOOTER || '').trim();
  if (fromEnv) {
    parts.push(fromEnv.replace(/\\n/g, '\n'));
  }
  if (parts.length === 0) return '';
  return parts.join('\n\n');
}

module.exports = { getAttributionFooter, FOOTER_FILE };
