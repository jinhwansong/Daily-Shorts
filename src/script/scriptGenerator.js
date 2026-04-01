const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const { getGenre, DEFAULT_GENRE } = require('../genres');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';

function loadPrompt(genreKey) {
  const genre = getGenre(genreKey);
  return fs.readFileSync(genre.promptFile, 'utf-8');
}

async function generateScript(topic, genreKey = DEFAULT_GENRE) {
  const systemPrompt = loadPrompt(genreKey);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Topic: ${topic}` }],
  });
  return message.content[0].text.trim();
}

async function generateMetadata(script, topic, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Based on this YouTube Shorts script (genre: ${genre.label}), generate:
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

  const channelTag = genre.channelName ? genre.channelName.toLowerCase() : '';
  const baseTags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : ['shorts'];
  const allTags = channelTag ? [channelTag, ...baseTags] : baseTags;

  const baseDesc = descMatch ? descMatch[1].trim() : '';
  const channelCredit = genre.channelName ? `\n\n— ${genre.channelName}` : '';

  return {
    title: titleMatch ? titleMatch[1].trim() : topic,
    description: baseDesc + channelCredit,
    tags: [...new Set(allTags)],
  };
}

module.exports = { generateScript, generateMetadata };
