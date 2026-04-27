const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');
const { topicPromptAddon } = require('../utils/contentIntensity');
const { completeLlm } = require('./scriptLlm');

const TOPIC_HISTORY_FILE = path.join(__dirname, '../../output/topic_history.json');

/** TOPIC_DEDUP_DAYS 환경변수 (기본 14일) */
function getDedupDays() {
  const n = parseInt(process.env.TOPIC_DEDUP_DAYS || '14', 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/** topic_history.json 로드. { topics: [{ topic, date }] } */
function loadTopicHistory() {
  if (!fs.existsSync(TOPIC_HISTORY_FILE)) return { topics: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(TOPIC_HISTORY_FILE, 'utf-8'));
    if (Array.isArray(parsed?.topics)) return parsed;
    return { topics: [] };
  } catch {
    return { topics: [] };
  }
}

/** topic_history.json에 새 토픽 append (최근 500개 유지) */
function appendTopicHistory(newTopics) {
  const history = loadTopicHistory();
  const today = new Date().toISOString().slice(0, 10);
  history.topics = [
    ...history.topics,
    ...newTopics.map((topic) => ({ topic, date: today })),
  ].slice(-500);
  fs.mkdirSync(path.dirname(TOPIC_HISTORY_FILE), { recursive: true });
  fs.writeFileSync(TOPIC_HISTORY_FILE, JSON.stringify(history, null, 2));
}

/** 최근 N일 내 사용된 토픽 목록 반환 */
function getRecentTopicsFromHistory(dedupDays) {
  const history = loadTopicHistory();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dedupDays);
  return history.topics
    .filter((entry) => {
      const d = new Date(entry.date);
      return !isNaN(d.getTime()) && d >= cutoff;
    })
    .map((entry) => entry.topic);
}

function usedTopicsFile(genreKey) {
  return path.join(__dirname, `../../output/used_topics_${genreKey}.json`);
}

function loadUsedTopics(genreKey) {
  const file = usedTopicsFile(genreKey);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function saveUsedTopics(genreKey, topics) {
  const file = usedTopicsFile(genreKey);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(topics.slice(-200), null, 2));
}

/** mystery 전용: 생성 토픽이 실제로 미해결·미설명으로 남은 사건인지 모델에 강제 */
function mysteryUnresolvedTopicsAddon(genreKey) {
  if (genreKey !== 'mystery') return '';
  return `
SOURCE DISCIPLINE (non-negotiable — apply BEFORE writing each topic):
- Only write a topic if you are confident the CORE EVENT has a Wikipedia article or is documented in major English-language news archives (BBC, NYT, AP, etc.).
- The specific event described must be real and documented, not a plausible-sounding composite or a known person paired with an invented incident. Example of what NOT to do: naming a real historical figure and inventing an event about them (e.g. "Colonel X's crew vanished from a sealed hangar" when no such event exists in sources).
- If you are not certain a specific detail (year, name, outcome) is documented, omit that detail entirely — write the topic with fewer specifics rather than risk hallucination.
- If you are unsure whether a case is real and documented, skip it entirely and choose a different case you are confident about.

Unresolved cases only (non-negotiable):
- Each topic must describe a real case that is still unresolved in reputable public sources: perpetrator not identified or not convicted for the crime, person still missing, or the core incident still lacks a widely accepted explanation.
- Do NOT use cases that are clearly solved, closed, or fully explained (accepted conviction, missing person found with an established account, mystery debunked by mainstream investigation).
- If you are unsure whether a case remains unresolved, omit it and choose a different well-documented unsolved case.`;
}

async function generateTopics(count = 1, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  const usedTopics = loadUsedTopics(genreKey);
  const recentSample = usedTopics.slice(-30);

  // 날짜 기반 dedup: 최근 N일 내 history에서 중복 방지
  const dedupDays = getDedupDays();
  const recentFromHistory = getRecentTopicsFromHistory(dedupDays);

  const allAvoid = [
    ...new Set([...recentSample, ...recentFromHistory]),
  ];

  let avoidContext = '';
  if (allAvoid.length > 0) {
    avoidContext =
      `\nAVOID these topics already used in the last ${dedupDays} days:\n` +
      `${allAvoid.map((t) => `- ${t}`).join('\n')}\n` +
      `Do NOT generate any topic about the same person, case, or event.\n`;
  }

  const instruction = genre.topicInstruction.replace('{count}', count);

  const raw = await completeLlm({
    maxTokens: 600,
    user: `${instruction}
${mysteryUnresolvedTopicsAddon(genreKey)}${topicPromptAddon()}${avoidContext}
Rules:
- Each topic must be distinct in setting, theme, and tone
- Write each as one punchy sentence (max 20 words)
- No numbering, no bullets, no explanation
- One topic per line, exactly ${count} lines`,
  });
  const topics = raw
    .split('\n')
    .map((line) => line.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, count);

  saveUsedTopics(genreKey, [...usedTopics, ...topics]);
  appendTopicHistory(topics);
  return topics;
}

module.exports = { generateTopics };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  const genreKey = process.argv[2] || DEFAULT_GENRE;
  const count = parseInt(process.argv[3] || '3', 10);
  console.log(`Genre: ${genreKey} | Count: ${count}\n`);
  generateTopics(count, genreKey).then((topics) =>
    topics.forEach((t, i) => console.log(`[${i + 1}] ${t}`))
  );
}
