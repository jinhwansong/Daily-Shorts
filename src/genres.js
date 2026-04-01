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
