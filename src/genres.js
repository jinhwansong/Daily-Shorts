const path = require('path');

// 장르별 설정 중앙 관리
// 새 장르 추가: 여기에 항목 추가 + prompts/<key>.txt 생성
const GENRES = {
  mystery: {
    label: 'Mystery & Horror',
    channelName: 'Noctivault',
    promptFile: path.join(__dirname, '../prompts/mystery.txt'),
    topicInstruction: `Generate exactly {count} unique mystery or horror topics for YouTube Shorts.
Each topic should feel real and unsettling.
Draw from: unexplained disappearances, strange true crime, creepy historical events, urban legends, paranormal incidents, eerie coincidences.`,
    videoQueries: [
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
    freesoundBgmQuery: 'dark ambient drone atmospheric tension',
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
