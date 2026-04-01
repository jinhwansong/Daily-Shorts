const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';

const USED_TOPICS_FILE = path.join(__dirname, '../../output/used_topics.json');

function loadUsedTopics() {
  if (!fs.existsSync(USED_TOPICS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USED_TOPICS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveUsedTopics(topics) {
  fs.mkdirSync(path.dirname(USED_TOPICS_FILE), { recursive: true });
  const trimmed = topics.slice(-200);
  fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(trimmed, null, 2));
}

async function generateTopics(count = 5) {
  const usedTopics = loadUsedTopics();
  const recentSample = usedTopics.slice(-30);

  const usedContext =
    recentSample.length > 0
      ? `\nAvoid these recently used topics:\n${recentSample.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
      : '';

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: `Generate exactly ${count} unique and diverse mystery or dark-facts topics for YouTube Shorts scripts.
Each topic should feel real and unsettling.
Draw from: unexplained disappearances, strange true crime angles, creepy historical events, urban legends, paranormal incidents, dark scientific facts, or eerie coincidences.
${usedContext}
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

  saveUsedTopics([...usedTopics, ...topics]);
  return topics;
}

async function generateTopic() {
  const topics = await generateTopics(1);
  return topics[0];
}

module.exports = { generateTopic, generateTopics };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '../../.env') });
  const count = parseInt(process.argv[2] || '5', 10);
  generateTopics(count).then((topics) => topics.forEach((t, i) => console.log(`[${i + 1}] ${t}`)));
}
