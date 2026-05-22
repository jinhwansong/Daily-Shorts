const path = require('path');

// 장르별 설정 중앙 관리
// 새 장르 추가: 여기에 항목 추가 + prompts/<key>.txt 생성
const GENRES = {
  'mystery-long': {
    label: 'Mystery & Horror (Longform)',
    format: 'longform',
    channelName: 'Noctivault',
    promptFile: path.join(__dirname, '../prompts/mystery-long.txt'),
    topicInstruction: `Generate exactly {count} unique, real-life mystery topics for YouTube longform videos (10–15 minutes) aimed at a US / English-speaking audience.
Each topic must be a DOCUMENTED true case only: real crime, disappearance, unexplained death, or historical anomaly. No fiction, no urban legends.
The topic must have enough documented detail to sustain a 10-minute narrative — multiple witnesses, timeline gaps, conflicting evidence, or unresolved aftermath.
Each topic line must include a specific person name, place, or year so the script can stay concrete.
Prioritize cases with a layered story: something that seems simple at first but becomes more disturbing the deeper you go.`,
    videoQueries: [
      'dark foggy road night',
      'abandoned house interior',
      'old police station corridor',
      'dark forest path',
      'empty highway night',
      'old newspaper archive',
      'detective office dark',
      'rainy window night city',
      'old photograph sepia',
      'crime scene tape',
      'dark lake reflection',
      'empty field dusk',
      'old clock ticking',
      'shadow figure silhouette',
      'vintage car abandoned',
    ],
    bgmDir: path.join(__dirname, '../assets/bgm/dark'),
    bgmFile: path.join(__dirname, '../assets/bgm/mystery.mp3'),
    freesoundBgmQuery: 'dark cinematic atmospheric drone mystery',
    freesoundBlockWords: [
      'water', 'rain', 'forest', 'bird', 'nature', 'wind', 'ocean', 'river',
      'stream', 'brook', 'thunder', 'storm', 'leaves', 'pond', 'jungle',
      'outdoor', 'farm', 'fire', 'cricket', 'frog', 'insect', 'wave',
    ],
  },
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
    bgmDir: path.join(__dirname, '../assets/bgm/dark'),
    /** 단일 파일 폴백 (bgmDir 이 비어 있을 때만) */
    bgmFile: path.join(__dirname, '../assets/bgm/mystery.mp3'),
    /** Freesound 검색어 (CC0만 자동 선택) */
    freesoundBgmQuery: 'dark cinematic tension heart beat ticking clock',
    /** 이름/태그에 이 단어가 들어간 결과 제외 (자연음·효과음 방지) */
    freesoundBlockWords: [
      'water', 'rain', 'forest', 'bird', 'nature', 'wind', 'ocean', 'river',
      'stream', 'brook', 'thunder', 'storm', 'leaves', 'pond', 'jungle',
      'outdoor', 'farm', 'fire', 'cricket', 'frog', 'insect', 'wave',
    ],
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
