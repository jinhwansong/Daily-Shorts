const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getGenre, DEFAULT_GENRE } = require('../genres');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';

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

async function generateTopics(count = 1, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  const usedTopics = loadUsedTopics(genreKey);
  const recentSample = usedTopics.slice(-30);

  const avoidContext =
    recentSample.length > 0
      ? `\nAvoid these recently used topics:\n${recentSample.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
      : '';

  const instruction = genre.topicInstruction.replace('{count}', count);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: `${instruction}
${avoidContext}
Rules:
- Each topic must be distinct in setting, theme, and tone
- Write each as one punchy sentence (max 20 words)
- No numbering, no bullets, no explanation
- One topic per line, exactly ${count} lines`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  const topics = raw
    .split('\n')
    .map((line) => line.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, count);

  saveUsedTopics(genreKey, [...usedTopics, ...topics]);
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
