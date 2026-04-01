const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';

const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '../../prompts/scriptPrompt.txt'),
  'utf-8'
);

async function generateScript(topic) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Topic: ${topic}` }],
  });
  return message.content[0].text.trim();
}

async function generateMetadata(script, topic) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Based on this YouTube Shorts mystery script, generate:
1. A compelling title (under 60 chars, no clickbait words like "SHOCKING")
2. A short description (2-3 sentences)
3. 10 relevant hashtags

Script:
${script}

Output in this exact format:
TITLE: <title>
DESCRIPTION: <description>
TAGS: <tag1>,<tag2>,...`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  const titleMatch = raw.match(/TITLE:\s*(.+)/);
  const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]+?)(?=TAGS:|$)/);
  const tagsMatch = raw.match(/TAGS:\s*(.+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : topic,
    description: descMatch ? descMatch[1].trim() : '',
    tags: tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : ['mystery', 'shorts'],
  };
}

module.exports = { generateScript, generateMetadata };
