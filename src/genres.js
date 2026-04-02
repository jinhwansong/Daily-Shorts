const path = require('path');

// 장르별 설정 중앙 관리
// 새 장르 추가: 여기에 항목 추가 + prompts/<key>.txt 생성
const GENRES = {
  mystery: {
    label: 'Mystery & Horror',
    channelName: 'Noctivault',
    promptFile: path.join(__dirname, '../prompts/mystery.txt'),
    topicInstruction: `Generate exactly {count} unique, real-life mystery topics for YouTube Shorts. 
Focus on obscure but documented true crime, unsolved disappearances, and disturbing historical anomalies. 
Each topic must include a specific name, location, or year (e.g., "The 1977 Girl Scout Camp Murders" or "The Disappearance of Lars Mittank"). 
Prioritize cases with "unexplainable evidence" like eerie last photos, strange phone calls, or impossible crime scenes to maximize curiosity. 
Avoid generic urban legends; stick to creepy reality that feels 100% authentic.`,
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

  psychology: {
    label: 'Dark Psychology',
    promptFile: path.join(__dirname, '../prompts/psychology.txt'),
    topicInstruction: `Generate exactly {count} unique dark psychology or human behavior topics for YouTube Shorts.
Each topic should be based on real psychological research and make people question themselves.
Draw from: cognitive biases, manipulation tactics, disturbing experiments, social psychology, subconscious behavior, dark personality traits.`,
    videoQueries: [
      'human silhouette dark',
      'brain scan glow',
      'mirror reflection dark',
      'crowd people blur',
      'shadow person',
      'dark room single light',
      'eye closeup dramatic',
    ],
    thumbnailColor: '#0a0a1a',
    thumbnailAccent: '#8e44ad',
    /** 심리학용 로컬 BGM 풀 — mp3만 넣으면 Freesound 실패 시 무작위 */
    bgmDir: path.join(__dirname, '../assets/bgm/psychology'),
    bgmFile: path.join(__dirname, '../assets/bgm/psychology.mp3'),
    freesoundBgmQuery: 'calm ambient soft subtle meditation',
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
