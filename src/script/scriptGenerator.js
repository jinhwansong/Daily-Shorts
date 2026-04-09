const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const { getGenre, DEFAULT_GENRE } = require('../genres');
const { scriptUserMessageAddon, metadataPromptAddon } = require('../utils/contentIntensity');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

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
    messages: [{ role: 'user', content: `Topic: ${topic}${scriptUserMessageAddon()}` }],
  });
  return message.content[0].text.trim();
}

async function generateMetadata(script, topic, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 420,
    messages: [
      {
        role: 'user',
        content: `Based on this YouTube Shorts script (genre: ${genre.label}), generate:
1. YouTube title — scroll-stopping, US mystery/true-crime Shorts style (max 55 characters, count spaces)
2. Thumbnail headline — SEPARATE from the title: shorter, bolder, more "rage click" / curiosity (max 34 characters). Can be more intense than the title; still no slurs, no false claims about real people beyond what the script implies.
3. A short description (2-3 sentences, NO spoilers, build curiosity only)
4. 5 relevant hashtags
5. A Pexels VIDEO/image search query (2-5 words, dark, cinematic, matches the story mood — used for background footage)

YouTube TITLE rules:
- Start with action, impossibility, shock, or a number
- Use specific names or places when it fits
- Normal Title Case or sentence case — not ALL CAPS for the whole title
- MAXIMUM 55 characters (HARD LIMIT)
- Punchy fragments beat long explanations

THUMBNAIL_LINE rules (on-image text, very short):
- MAXIMUM 34 characters (HARD LIMIT)
- 2–6 words ideal; can feel more aggressive than TITLE (e.g. unfinished thought, single shocking phrase)
- No hashtags; no quotes in the line

Script:
${script}

Output in this exact format (one line each field after the colon, except DESCRIPTION can wrap):
TITLE: <youtube title>
THUMBNAIL_LINE: <thumbnail headline only>
DESCRIPTION: <description>
TAGS: <tag1>,<tag2>,...
THUMBNAIL: <pexels search query>${metadataPromptAddon()}`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  const titleMatch = raw.match(/TITLE:\s*(.+)/);
  const thumbLineMatch = raw.match(/THUMBNAIL_LINE:\s*(.+)/);
  const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]+?)(?=TAGS:|$)/);
  const tagsMatch = raw.match(/TAGS:\s*(.+)/);
  const thumbnailMatch = raw.match(/THUMBNAIL:\s*(.+)/);
  const channelTag = genre.channelName ? genre.channelName.toLowerCase() : '';
  const baseTags = tagsMatch
    ? tagsMatch[1].split(',').map((t) => t.trim())
    : ['shorts'];
  const allTags = channelTag ? [channelTag, ...baseTags] : baseTags;

  const baseDesc = descMatch ? descMatch[1].trim() : '';
  const channelCredit = genre.channelName ? `\n\n— ${genre.channelName}` : '';

  const thumbnailLine = thumbLineMatch ? thumbLineMatch[1].trim() : null;

  return {
    title: titleMatch ? titleMatch[1].trim() : topic,
    thumbnailLine: thumbnailLine || undefined,
    description: baseDesc + channelCredit,
    tags: [...new Set(allTags)],
    thumbnailQuery: thumbnailMatch ? thumbnailMatch[1].trim() : null,
  };
}

module.exports = { generateScript, generateMetadata };
