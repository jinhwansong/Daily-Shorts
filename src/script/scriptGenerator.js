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

SEARCH + Shorts FEED (both matter for this genre):
- If the script is about a real, named case (person, place, ship, flight, well-known nickname), put that EXACT searchable name or phrase as EARLY as possible in the TITLE (ideally in the first half, still within 55 chars). Many viewers type the name in YouTube search, not a documentary-style phrase alone.
- Do NOT bury the only recognizable search token at the very end or hide it behind vague wording only (e.g. if the script is clearly about one famous missing person, the title should contain their name or the case name viewers search, not only generic words like "The Vanishing" with no name).
- THUMBNAIL_LINE can stay more emotional or fragmentary; let the TITLE carry the literal name/keyword when the case has one.

DESCRIPTION rules:
- First sentence must naturally include the same core name or case identifier the script is about (one clear phrase—no keyword stuffing). Helps search previews and viewers who clicked from search see they are in the right video.

TAGS rules:
- Include 2–3 tags that are literal searchable phrases or proper names from the script (when applicable), plus broader mystery/true-crime tags.

THUMBNAIL_LINE rules (on-image text, very short):
- MAXIMUM 34 characters (HARD LIMIT)
- 2–6 words ideal; can feel more aggressive than TITLE (e.g. unfinished thought, single shocking phrase)
- No hashtags; no quotes in the line

Topic line (source of truth for names/places—TITLE and tags should align with it when the script matches):
${topic}

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

async function generateLongformScript(topic, genreKey = DEFAULT_GENRE) {
  const systemPrompt = loadPrompt(genreKey);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Topic: ${topic}` }],
  });
  return message.content[0].text.trim();
}

async function generateLongformMetadata(script, topic, genreKey = DEFAULT_GENRE, chapters = []) {
  const genre = getGenre(genreKey);
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Based on this YouTube longform mystery documentary script, generate metadata.

Topic: ${topic}
Script (first 600 chars): ${script.slice(0, 600)}

Generate:
1. YouTube TITLE — documentary/true-crime longform style (max 70 characters). Include the real case name/person early. Use "The [Case] | Documentary" or "[Name]: [What Happened]" style.
2. A description (3–4 sentences, builds curiosity without spoiling, NO hashtags in body)
3. 6 relevant tags (real case names, genre tags)
4. A Pexels search query (2–4 words, dark atmospheric, for thumbnail background)
5. THUMBNAIL_HOOK — ONE short on-image line for the thumbnail (NOT the full title). Pull wording or vibe from the script: a provocative curiosity fragment (max 52 characters). Documentary tone; no false claims; can be punchier than TITLE but still serious.

THUMBNAIL_HOOK rules:
- Max 52 characters, single line, no quotes
- Different from TITLE — tease / tension, not the episode headline
- Prefer a striking phrase that appears in or is clearly implied by the script

TITLE rules:
- Max 70 characters
- Include the case name or person's name
- Serious documentary tone (not clickbait)

Output in this exact format:
TITLE: <title>
DESCRIPTION: <description>
TAGS: <tag1>,<tag2>,...
THUMBNAIL: <pexels query>
THUMBNAIL_HOOK: <short hook line>`,
      },
    ],
  });

  const raw = message.content[0].text.trim();
  const titleMatch = raw.match(/TITLE:\s*(.+)/);
  const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]+?)(?=TAGS:|$)/);
  const tagsMatch = raw.match(/TAGS:\s*(.+)/);
  const thumbnailMatch = raw.match(/THUMBNAIL:\s*(.+)/);
  const hookMatch = raw.match(/THUMBNAIL_HOOK:\s*(.+)/);

  const channelTag = genre.channelName ? genre.channelName.toLowerCase() : '';
  const baseTags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : ['mystery'];
  const allTags = channelTag ? [channelTag, ...baseTags] : baseTags;

  const baseDesc = descMatch ? descMatch[1].trim() : '';
  const chapterBlock = chapters.length ? `\n\n${chapters.join('\n')}` : '';
  const channelCredit = genre.channelName ? `\n\n— ${genre.channelName}` : '';

  return {
    title: titleMatch ? titleMatch[1].trim() : topic,
    description: baseDesc + chapterBlock + channelCredit,
    tags: [...new Set(allTags)],
    thumbnailQuery: thumbnailMatch ? thumbnailMatch[1].trim() : null,
    thumbnailHook: hookMatch ? hookMatch[1].trim().slice(0, 52) : null,
  };
}

module.exports = { generateScript, generateMetadata, generateLongformScript, generateLongformMetadata };
