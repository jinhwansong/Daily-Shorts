const fs = require('fs');
const { getGenre, DEFAULT_GENRE } = require('../genres');
const { scriptUserMessageAddon, metadataPromptAddon } = require('../utils/contentIntensity');
const { completeLlm, completeLlmLongform } = require('./scriptLlm');

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

/** 하이쿠 1회: 위키+토픽에서만 불릿 추출 → 본문은 불릿+위키 밖의 구체 주장 금지 */
function isShortsFactsStepEnabled() {
  return (process.env.SHORTS_FACTS_STEP || '1').toString().trim() !== '0';
}

/**
 * @param {string|undefined} wikiText
 */
async function generateShortsFactBullets(topic, wikiText, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  const wikiBlock =
    wikiText && String(wikiText).trim().length > 0
      ? `Wikipedia extract (grounding, may be incomplete):\n${String(wikiText).slice(0, 12000)}`
      : 'No English Wikipedia article was retrieved. You MUST NOT invent years, ages, "first to", trial counts, body recovery, or locations. Use only the topic line; say what is not known rather than guess.';

  const raw = await completeLlm({
    maxTokens: 560,
    user: `You are a fact-list assistant for a US ${genre.label} YouTube Short. No narrative, no story voice, no closing question.

## Topic
${topic}

## Wikipedia / sources
${wikiBlock}

## Your output
- First: 5–12 lines in English. Each line starts with "• " and states ONE checkable fact (a name, a year, a place, a documented outcome, or "do not say X" if the sources contradict a common myth).
- If Wikipedia is present: every year, name, legal outcome, and whether remains were found must come from that text. If a year is not in the text, do not add years. If a body was never found, add a bullet that forbids claiming remains were found.
- If there is no Wikipedia: do not invent numbers or court details; 3–5 bullets from the topic line only, plus what is unknown.
- No speculation, no "probably" in the bullets.
- **After the bullets**, add EXACTLY these two lines (not bullet lines):
  KEY ANCHORS: <comma-separated, max 3 short phrases; each must already appear in the bullet lines above—names, year, or place the script must state clearly in plain English>
  AVOID: <one short line: wrong claims to block, e.g. wrong decade, "body found" if not in source; or "keep vague on dates" if year absent in sources>
`,
  });
  return raw.trim();
}

/**
 * 스크립트에서 4자리 연도(1500-2029) 집합을 추출 (빠른 사전 검사용)
 */
function extractYears(text) {
  return new Set((String(text || '')).match(/\b(1[5-9]\d{2}|20[012]\d)\b/g) || []);
}

/**
 * 소스(위키+불릿)를 기준으로 스크립트의 구체적 주장을 검증·수정.
 *
 * 동작:
 *  1) 소스가 없으면 즉시 원문 반환 (비용 0)
 *  2) 연도만 있고 모두 소스에 있으면 검증 패스를 건너뛰는 빠른 경로 없음
 *     — 연도 외 다른 사실도 틀릴 수 있으므로 소스가 있으면 항상 1회 실행
 *  3) LLM이 "ALL_CORRECT" 를 반환하면 원문 유지, 그 외엔 수정본 사용
 */
async function factCheckAndFixScript(script, wikiText, factBullets) {
  const sourceText = [wikiText, factBullets].filter(Boolean).join('\n');
  if (!sourceText.trim()) return script; // 소스 없으면 검증 불가

  // 빠른 연도 사전 검사 — 소스에 없는 연도가 있으면 무조건 수정 패스 실행
  const scriptYears = extractYears(script);
  const sourceYears = extractYears(sourceText);
  const badYears = [...scriptYears].filter((y) => !sourceYears.has(y));
  if (badYears.length) {
    console.warn(`  [Fact-check] 소스에 없는 연도: ${badYears.join(', ')}`);
  }

  console.log('  [Fact-check] 스크립트 사실 검증 중...');

  const fixed = await completeLlm({
    maxTokens: 320,
    user: `You are a fact-checker for a short video script. Compare every specific claim in the SCRIPT against the VERIFIED SOURCES below.

VERIFIED SOURCES:
${sourceText.slice(0, 5000)}

SCRIPT:
${script}

Check for errors in:
- Years / dates (e.g. wrong decade or century)
- Names of people, places, ships, cases
- Monetary amounts or numbers stated as fact
- Outcomes: arrests, convictions, acquittals, whether a body/remains were found
- "First", "largest", "only" superlatives not supported by sources

Rules for your response:
- If ALL specific claims in the script are supported by the sources (or are vague enough not to be checkable), output exactly: ALL_CORRECT
- If ANY claim is unsupported or contradicts sources:
  - Fix it using the sources (correct year, correct name, etc.)
  - If you cannot find the correct value in sources, remove the specific claim or rephrase vaguely (e.g. "at some point" instead of a wrong year)
  - Do NOT add new specific facts not in the sources
  - Output ONLY the corrected script, nothing else — no explanation, no preamble
- Keep the script voice, tone, and word count as close to the original as possible.`,
  });

  const result = fixed.trim();
  if (result === 'ALL_CORRECT' || result.toUpperCase().startsWith('ALL_CORRECT')) {
    console.log('  [Fact-check] 이상 없음 ✓');
    return script;
  }

  console.warn('  [Fact-check] 수정 적용됨');
  return clampShortsScript(result, SHORTS_MAX_WORDS);
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

async function generateScript(topic, genreKey = DEFAULT_GENRE, options = {}) {
  const genre = getGenre(genreKey);
  if (genre.format === 'longform') {
    throw new Error('generateScript() is for Shorts only; use generateLongformScript() for longform.');
  }
  const wiki = options.wikiContext && String(options.wikiContext).trim();
  const wikiBlock = wiki
    ? `

## English Wikipedia (grounding)
Use for names, years, places, legal outcomes, and "whether a body was found" only as stated here. It may be incomplete. If something is not here, do not add it. **Never** invent: years, "first" claims, number of trials, body/remains in a location, unless they appear in the fact bullets and/or this block.

${wiki}
`
    : '';
  const fact = options.factBullets && String(options.factBullets).trim();
  const factBlock = fact
    ? `

## Fact bullets (HARD) + KEY ANCHORS / AVOID
- Every **specific** claim in the script (dates, names, legal outcomes, body/remains, trial counts, "first" superlatives) must match what is allowed in the Wikipedia block and/or the bullet lines. If a line says "do not say X", never say X.
- The **KEY ANCHORS** line lists phrases you must work into the **first half** of the script in clear, plain sentences (not all hidden inside questions). That gives viewers something searchable before the unknown lands.
- Follow **AVOID** literally.

${fact}
`
    : '';
  const systemPrompt = loadPrompt(genreKey);
  const raw = await completeLlm({
    system: systemPrompt,
    user: `Topic: ${topic}${wikiBlock}${factBlock}${scriptUserMessageAddon()}

BALANCED GROUNDING (read carefully):
(1) Do **not** invent or imply facts, dates, or outcomes that are not in the Wikipedia and fact bullets above. No extra names, years, or "body found" if not allowed.
(2) You **must** still sound like a real Short, not a hollow teaser: at least **two** concrete, allowed details in the first half—short declarative sentences, not only inside a final question. If KEY ANCHORS is present, weave those phrases in early. If there is no fact-bullet section, take two clear details from the Wikipedia block; if no Wikipedia, from the topic line only (no new numbers).
(3) Do not write a script that is *only* vague atmosphere + one rhetorical question. The ending can ask an open question, but the middle should add **at least one more** allowed beat (documented paradox, reversal, or unknown—only if in the sources).
(4) If sources are thin, anchor with the case/victim from the topic; keep sentences cold and fast; the closing question should point at a **documented** gap, not a made-up hook.
(5) English only; respect the word limit for Shorts.`,
    maxTokens: 280,
  });
  const wcBefore = raw.split(/\s+/).filter(Boolean).length;
  const clamped = clampShortsScript(raw, SHORTS_MAX_WORDS);
  const wcAfter = clamped.split(/\s+/).filter(Boolean).length;
  if (wcAfter < wcBefore) {
    console.warn(
      `  [Shorts] 스크립트 길이 제한: ${wcBefore} → ${wcAfter} words (max ${SHORTS_MAX_WORDS})`
    );
  }

  // 종합 팩트-체크: 소스가 있으면 연도·이름·결과 등 모든 구체적 주장 검증
  const checked = await factCheckAndFixScript(clamped, wiki, fact);
  return checked;
}

async function generateMetadata(script, topic, genreKey = DEFAULT_GENRE) {
  const genre = getGenre(genreKey);
  const raw = await completeLlm({
    maxTokens: 420,
    user: `Based on this YouTube Shorts script (genre: ${genre.label}), generate:
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
  });

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
  const facts = await completeLlmLongform({
    maxTokens: 600,
    user: `You are a documentary researcher. List ONLY verified, publicly documented facts about this topic.

Topic: ${topic}

Rules:
- 10–16 bullet points, each a single concrete fact (name, date, place, event, official finding, or documented contradiction)
- ONLY include facts you are confident are in the public record. If uncertain about a specific date or detail, omit it entirely — do NOT guess.
- No speculation, no theory, no invented detail
- Use exact years, names, and figures only when you are certain
- Format: one bullet per line starting with "• "`,
  });

  // --- 2단계: 스크립트 작성 (추출된 사실만 허용) ---
  return completeLlmLongform({
    system: systemPrompt,
    maxTokens: 2200,
    user: `Topic: ${topic}

VERIFIED FACTS (use ONLY these — do not add any detail not in this list):
${facts}

Write the script now. Every specific claim (date, name, location, number, official finding) must be traceable to one of the bullet points above. If the facts list does not contain a specific detail, describe that aspect in general terms or omit it.`,
  });
}

async function generateLongformMetadata(script, topic, genreKey = DEFAULT_GENRE, chapters = []) {
  const genre = getGenre(genreKey);
  const raw = await completeLlmLongform({
    maxTokens: 500,
    user: `Based on this YouTube longform mystery documentary script, generate metadata.

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
  });
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

module.exports = {
  generateScript,
  generateMetadata,
  generateLongformScript,
  generateLongformMetadata,
  generateShortsFactBullets,
  isShortsFactsStepEnabled,
};
