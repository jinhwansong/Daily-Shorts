const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const { getGenre, DEFAULT_GENRE } = require('../genres');
const { scriptUserMessageAddon, metadataPromptAddon } = require('../utils/contentIntensity');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// 숏폼 스크립트·메타: 빠른 Haiku 사용
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
// 롱폼 스크립트: 2-step grounding으로 Haiku도 사실성 개선. Sonnet 원하면 CLAUDE_LONGFORM_MODEL=claude-sonnet-4-5-20251001
const LONGFORM_SCRIPT_MODEL = process.env.CLAUDE_LONGFORM_MODEL || process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

/** 쇼츠 TTS 길이 상한(단어). mystery 등 숏폼만 적용 — env SHORTS_MAX_WORDS 로 조정 가능 */
const SHORTS_MAX_WORDS = Math.max(
  55,
  Math.min(120, parseInt(process.env.SHORTS_MAX_WORDS || '95', 10))
);

/** YouTube API snippet.title hard limit; 파싱 실패 시 토픽 폴백도 잘릴 수 있게 */
const YOUTUBE_TITLE_MAX = 100;
const SHORTS_TITLE_SOFT_MAX = 55;
const THUMBNAIL_ONIMAGE_MAX = 40;

function collapseWhitespace(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadPrompt(genreKey) {
  const genre = getGenre(genreKey);
  return fs.readFileSync(genre.promptFile, 'utf-8');
}

/**
 * 모델이 길이 지시를 어겼을 때 TTS·영상 길이 폭주 방지 — 단어 수 상한 + 가능하면 문장 끝에서 자름
 */
function clampShortsScript(text, maxWords = SHORTS_MAX_WORDS) {
  const s = String(text || '').trim();
  if (!s) return s;
  const words = s.split(/\s+/);
  if (words.length <= maxWords) return s;

  const head = words.slice(0, maxWords).join(' ');
  const lastPeriod = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('? '),
    head.lastIndexOf('! ')
  );
  if (lastPeriod >= Math.floor(head.length * 0.35)) {
    return head.slice(0, lastPeriod + 1).trim();
  }
  return head;
}

async function generateScript(topic, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  if (genre.format === 'longform') {
    throw new Error('generateScript() is for Shorts only; use generateLongformScript() for longform.');
  }
  const systemPrompt = loadPrompt(genreKey);
  const message = await client.messages.create({
    model: MODEL,
    // 숏폼은 90단어 전후면 충분 — 400이면 150~250단어까지 나와 1분+ TTS 가능
    max_tokens: 260,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Topic: ${topic}${scriptUserMessageAddon()}` }],
  });
  const raw = message.content[0].text.trim();
  const wcBefore = raw.split(/\s+/).filter(Boolean).length;
  const clamped = clampShortsScript(raw, SHORTS_MAX_WORDS);
  const wcAfter = clamped.split(/\s+/).filter(Boolean).length;
  if (wcAfter < wcBefore) {
    console.warn(
      `  [Shorts] 스크립트 길이 제한: ${wcBefore} → ${wcAfter} words (max ${SHORTS_MAX_WORDS})`
    );
  }
  return clamped;
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
1. YouTube title — US mystery/true-crime Shorts, SHORT and high-arousal: curiosity, dread, "how is this possible?" energy (aim ${SHORTS_TITLE_SOFT_MAX} characters or less; never exceed ${YOUTUBE_TITLE_MAX} characters including spaces). Not a long documentary sentence; not a copy-paste of the topic line.
2. Thumbnail on-image line (THUMBNAIL_LINE) — the *second beat* of the hook: a phrase that *pairs with* the title (completes the thought, adds the twist, or names the shock detail). It must feel like a continuation of the title, not a separate brand tag. Max ${THUMBNAIL_ONIMAGE_MAX} characters. Still no slurs; no false claims about real people beyond what the script implies. NEVER include a channel name, "subscribe", "Shorts", or any branding.
3. A short description (2-3 sentences, NO spoilers, build curiosity only)
4. 5 relevant hashtags
5. A Pexels VIDEO/image search query (2-5 words, dark, cinematic, matches the story mood — used for background footage)

YouTube TITLE rules:
- Open with a hook: mystery, impossibility, a number, a name, or a place — whichever hits hardest first
- Use specific names or places when it fits, within the character budget
- Normal Title Case or sentence case — not ALL CAPS for the whole title
- Prefer ${SHORTS_TITLE_SOFT_MAX} characters or less; always stay under ${YOUTUBE_TITLE_MAX} characters
- Tight, provocative fragments — never paste the long topic line verbatim

SEARCH + Shorts FEED (both matter for this genre):
- If the script is about a real, named case (person, place, ship, flight, well-known nickname), put that EXACT searchable name or phrase as EARLY as possible in the TITLE (ideally in the first half, still within ${SHORTS_TITLE_SOFT_MAX} chars). Many viewers type the name in YouTube search, not a documentary-style phrase alone.
- Do NOT bury the only recognizable search token at the very end or hide it behind vague wording only (e.g. if the script is clearly about one famous missing person, the title should contain their name or the case name viewers search, not only generic words like "The Vanishing" with no name).
- THUMBNAIL_LINE: complements the title (e.g. title sets who/where, line delivers the eerie detail). Not a second title; not a channel name.

DESCRIPTION rules:
- First sentence must naturally include the same core name or case identifier the script is about (one clear phrase—no keyword stuffing). Helps search previews and viewers who clicked from search see they are in the right video.

TAGS rules:
- Include 2–3 tags that are literal searchable phrases or proper names from the script (when applicable), plus broader mystery/true-crime tags.

THUMBNAIL_LINE rules (on-image text, very short):
- MAXIMUM ${THUMBNAIL_ONIMAGE_MAX} characters (HARD LIMIT)
- 2–6 words ideal; can feel more aggressive than TITLE (e.g. unfinished thought, one shocking detail)
- No hashtags; no quotes in the line; no channel or platform names

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
  const titleMatch = raw.match(/^TITLE:\s*([^\n]+)/m);
  const thumbLineMatch = raw.match(/^THUMBNAIL_LINE:\s*([^\n]+)/m);
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

  const rawTitle = titleMatch ? collapseWhitespace(titleMatch[1]) : '';
  const title =
    (rawTitle || collapseWhitespace(topic) || 'Mystery Short').slice(0, YOUTUBE_TITLE_MAX) ||
    'Mystery Short';
  const thumbnailLineRaw = thumbLineMatch ? collapseWhitespace(thumbLineMatch[1]) : null;
  const thumbnailLineClamped = thumbnailLineRaw
    ? thumbnailLineRaw.slice(0, THUMBNAIL_ONIMAGE_MAX) || null
    : null;

  return {
    title,
    thumbnailLine: thumbnailLineClamped || undefined,
    description: baseDesc + channelCredit,
    tags: [...new Set(allTags)],
    thumbnailQuery: thumbnailMatch ? thumbnailMatch[1].trim() : null,
  };
}

/**
 * 롱폼 스크립트 생성 — 2단계:
 *   1) 사실 추출: topic에서 검증 가능한 구체적 사실 목록 확보
 *   2) 스크립트: 그 사실 목록만 사용해 작성 (추가 지어내기 금지)
 */
async function generateLongformScript(topic, genreKey = DEFAULT_GENRE) {
  const systemPrompt = loadPrompt(genreKey);

  // --- 1단계: 사실 추출 ---
  const factsMsg = await client.messages.create({
    model: LONGFORM_SCRIPT_MODEL,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: `You are a documentary researcher. List ONLY verified, publicly documented facts about this topic.

Topic: ${topic}

Rules:
- 10–16 bullet points, each a single concrete fact (name, date, place, event, official finding, or documented contradiction)
- ONLY include facts you are confident are in the public record. If uncertain about a specific date or detail, omit it entirely — do NOT guess.
- No speculation, no theory, no invented detail
- Use exact years, names, and figures only when you are certain
- Format: one bullet per line starting with "• "`,
      },
    ],
  });

  const facts = factsMsg.content[0].text.trim();

  // --- 2단계: 스크립트 작성 (추출된 사실만 허용) ---
  const scriptMsg = await client.messages.create({
    model: LONGFORM_SCRIPT_MODEL,
    max_tokens: 2200,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Topic: ${topic}

VERIFIED FACTS (use ONLY these — do not add any detail not in this list):
${facts}

Write the script now. Every specific claim (date, name, location, number, official finding) must be traceable to one of the bullet points above. If the facts list does not contain a specific detail, describe that aspect in general terms or omit it.`,
      },
    ],
  });

  return scriptMsg.content[0].text.trim();
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
5. THUMBNAIL_HOOK — ONE short on-image line for the thumbnail (NOT the full title). Pairs with the title as a "second line" of the hook. Provocative curiosity fragment (max 52 characters). No channel name, "subscribe", or platform branding. Documentary tone; no false claims; can be punchier than TITLE but still serious.

THUMBNAIL_HOOK rules:
- Max 52 characters, single line, no quotes; never a channel or brand name
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
  const titleMatch = raw.match(/^TITLE:\s*([^\n]+)/m);
  const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]+?)(?=TAGS:|$)/);
  const tagsMatch = raw.match(/TAGS:\s*(.+)/);
  const thumbnailMatch = raw.match(/^THUMBNAIL:\s*([^\n]+)/m);
  const hookMatch = raw.match(/^THUMBNAIL_HOOK:\s*([^\n]+)/m);

  const channelTag = genre.channelName ? genre.channelName.toLowerCase() : '';
  const baseTags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim()) : ['mystery'];
  const allTags = channelTag ? [channelTag, ...baseTags] : baseTags;

  const baseDesc = descMatch ? descMatch[1].trim() : '';
  const chapterBlock = chapters.length ? `\n\n${chapters.join('\n')}` : '';
  const channelCredit = genre.channelName ? `\n\n— ${genre.channelName}` : '';

  const rawLfTitle = titleMatch ? collapseWhitespace(titleMatch[1]) : '';
  const lfTitle =
    (rawLfTitle || collapseWhitespace(topic) || 'Mystery Documentary').slice(0, YOUTUBE_TITLE_MAX) ||
    'Mystery Documentary';

  return {
    title: lfTitle,
    description: baseDesc + chapterBlock + channelCredit,
    tags: [...new Set(allTags)],
    thumbnailQuery: thumbnailMatch ? collapseWhitespace(thumbnailMatch[1]) : null,
    thumbnailHook: hookMatch ? collapseWhitespace(hookMatch[1]).slice(0, 52) : null,
  };
}

module.exports = { generateScript, generateMetadata, generateLongformScript, generateLongformMetadata };
