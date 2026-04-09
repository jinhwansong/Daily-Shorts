const path = require('path');

// 장르별 설정 중앙 관리
// 새 장르 추가: 여기에 항목 추가 + prompts/<key>.txt 생성
const GENRES = {
  mystery: {
    label: 'Mystery & Horror',
    channelName: 'Noctivault',
    promptFile: path.join(__dirname, '../prompts/mystery.txt'),
    topicInstruction: `Generate exactly {count} unique, real-life mystery topics for YouTube Shorts aimed at a US / English-speaking audience.
Each topic must be a DOCUMENTED true case only: real crime, disappearance, unexplained death, or historical anomaly. No fiction, no urban legends, no creepypasta.
Prioritize cases that are RECOGNIZABLE to viewers who watch popular US true-crime and mystery Shorts (widely covered in news, documentaries, or major podcasts)—the kind of name or incident people might search on YouTube. Famous unsolved or iconic unexplained events work well.
Each topic line must include a specific person name, place, or year so the script can stay concrete.
Add one sharp "hook angle" in the topic line when possible: eerie evidence, impossible detail, last known fact, or paradox—something that supports a 2-second scroll-stopping hook.
Avoid hyper-obscure local stories unknown outside that region unless they already broke big online. Avoid generic legends with no documented victims or sources.`,
    videoQueries: [
      'police tape crime scene', // 실제 미스터리 느낌 강화
      'security camera footage eerie', // CCTV 느낌은 몰입감이 높음
      'person running dark woods', // 긴박함 추가
      'hand writing on dusty glass', // 미스터리한 분위기
      'old polaroid photos', // 실화 사건 느낌
      'old newspaper clippings', // 미스터리한 분위기
      'old photo album', // 실화 사건 느낌
      'old diary entry', // 미스터리한 분위기
      'old letter', // 실화 사건 느낌
      'old document', // 미스터리한 분위기
      'old photo', // 실화 사건 느낌
      'old photo album', // 미스터리한 분위기
      'dark forest night',
      'abandoned building',
      'foggy road',
      'empty hallway',
      'dark tunnel',
      'old mansion',
      'dark water reflection',
      'shadow silhouette',
    ],
    thumbnailColor: '#0a0a0a',
    thumbnailAccent: '#c0392b',
    /** 미스터리용 로컬 BGM 풀 — 이 안의 .mp3 중 하나를 무작위 (Freesound 실패 시) */
    bgmDir: path.join(__dirname, '../assets/bgm/dark'),
    /** 단일 파일 폴백 (bgmDir 이 비어 있을 때만) */
    bgmFile: path.join(__dirname, '../assets/bgm/mystery.mp3'),
    /** Freesound 검색어 (CC0만 자동 선택) */
    freesoundBgmQuery: 'dark cinematic tension heart beat ticking clock',
  },
};

const DEFAULT_GENRE = 'mystery';

function getGenre(key) {
  const genre = GENRES[key];
  if (!genre) {
    throw new Error(`Unknown genre: "${key}". Available: ${Object.keys(GENRES).join(', ')}`);
  }
  return genre;
}

function listGenres() {
  return Object.entries(GENRES).map(([key, g]) => ({ key, label: g.label }));
}

module.exports = { GENRES, DEFAULT_GENRE, getGenre, listGenres };
