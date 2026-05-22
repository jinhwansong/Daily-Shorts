const fs = require('fs');
const { getGenre, DEFAULT_GENRE } = require('../genres');
const { scriptUserMessageAddon, metadataPromptAddon } = require('../utils/contentIntensity');
const { completeLlm, completeLlmLongform, getProvider, shortsScriptModel } = require('./scriptLlm');

/**
 * 쇼츠 TTS 길이 상한(단어). mystery 등 숏폼만 적용 — env SHORTS_MAX_WORDS 로 조정 가능.
 * 기본 80: 140 wpm 기준 약 34초 TTS → 30~44초 목표 범위 중심.
 *  30초 ≈ 70 words / 44초 ≈ 103 words (130~150 wpm 기준)
 */
const SHORTS_MAX_WORDS = Math.max(
  55,
  Math.min(120, parseInt(process.env.SHORTS_MAX_WORDS || '80', 10))
);

/** YouTube API snippet.title hard limit; 파싱 실패 시 토픽 폴백도 잘릴 수 있게 */
const YOUTUBE_TITLE_MAX = 100;
const SHORTS_TITLE_SOFT_MAX = 55;

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
 * 토픽이 실존하는 미스터리/범죄 사건인지 결정론적으로 검증.
 * LLM 없이 위키 데이터만으로 판단.
 *
 * @param {string} topic
 * @param {{ title?: string, extract?: string, categories?: string[], found?: boolean }} wikiResult
 * @returns {{ valid: boolean, score: number, reason: string }}
 */
function validateTopicWithWiki(topic, wikiResult) {
  if (!wikiResult || !wikiResult.found) {
    return { valid: false, score: 0, reason: 'no_wiki' };
  }

  let score = 0;

  const cleanToken = (t) => t.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');

  // 토픽에서 고유명사(대문자 시작)만 추출 — 문장 첫 단어(The/A/An 등)는 제외
  const topicWords = String(topic || '').split(/\s+/);
  const properNouns = topicWords
    .slice(1) // 문장 첫 단어 제외
    .map(cleanToken)
    .filter((t) => t.length > 0 && /^[A-Z]/.test(t))
    .map((t) => t.toLowerCase());

  // 위키 제목 토큰 (소문자 정규화)
  const wikiTokens = String(wikiResult.title || '')
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  if (!properNouns.length || !wikiTokens.length) {
    return { valid: false, score: 0, reason: 'title_mismatch' };
  }

  const wikiSet = new Set(wikiTokens);
  const overlap = properNouns.filter((t) => wikiSet.has(t)).length;

  if (overlap >= 1) score += 2;
  else return { valid: false, score, reason: 'title_mismatch' };

  const GOOD_CATEGORIES = [
    'murder',
    'disappearance',
    'unsolved',
    'missing person',
    'homicide',
    'crime',
    'death',
    'serial killer',
    'cold case',
    'accident',
    'disaster',
    'conspiracy',
    'assassination',
    'kidnapping',
    'robbery',
  ];
  const catsJoined = (wikiResult.categories || []).join(' ').toLowerCase();
  const categoryHits = GOOD_CATEGORIES.filter((k) => catsJoined.includes(k)).length;
  if (categoryHits >= 2) score += 2;
  else if (categoryHits === 1) score += 1;

  const extract = (wikiResult.extract || '').toLowerCase();
  const extractHits = properNouns.filter((t) => t.length > 3 && extract.includes(t)).length;
  if (extractHits >= 2) score += 1;

  return {
    valid: score >= 4,
    score,
    reason: score >= 4 ? 'passed' : 'low_score',
  };
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

  const wikiResult = options.wikiResult;
  if (wikiResult) {
    const validation = validateTopicWithWiki(topic, wikiResult);
    if (!validation.valid) {
      console.warn(
        `  [Topic] 토픽 검증 실패 (score: ${validation.score}, reason: ${validation.reason}) — 스킵`
      );
      return null;
    }
    console.log(`  [Topic] 토픽 검증 통과 (score: ${validation.score})`);
  }

  const wiki = options.wikiContext && String(options.wikiContext).trim();
  const hasWiki = !!wiki;
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

  // wiki가 없을 때: 토픽 라인 자체가 환각일 수 있으므로 수치 사용 전면 금지
  const noWikiWarning = !hasWiki
    ? `

⚠ NO VERIFIED SOURCE: No Wikipedia article was found for this topic. The topic line has NOT been independently verified — it may contain hallucinated years, names, or events. You MUST treat every specific number and year in the topic line as UNVERIFIED. DO NOT use any year, monetary amount, count, or superlative from the topic line in the script. Replace all specifics with vague phrasing (e.g. "decades ago", "at the turn of the century", "a large sum"). Only the person's name and the general type of mystery (disappearance, death, etc.) are safe to use.`
    : '';

  const claimGateBlock =
    options.claimGateFeedback && String(options.claimGateFeedback).trim()
      ? `

## CLAIM GATE REWRITE (required)
Your previous script/title was rejected because these strict claims lacked Wikipedia/fact-bullet support or contradicted AVOID:
${String(options.claimGateFeedback).trim()}
Remove or rephrase unsupported superlatives and legal/status claims. Only assert what the sources allow.`
      : '';

  const systemPrompt = loadPrompt(genreKey);
  const raw = await completeLlm({
    system: systemPrompt,
    user: `Topic: ${topic}${wikiBlock}${factBlock}${noWikiWarning}${claimGateBlock}${scriptUserMessageAddon()}

SOURCE DISCIPLINE — apply before writing a single word:
Before writing the script, mentally note the specific years, names, and numbers that appear in the Wikipedia block and fact bullets above. You are ONLY allowed to use those exact values. If a year, name, or number is not visible in the sources above, do NOT write it — write vaguely instead (e.g. "decades later", "in the early twentieth century", "a significant sum") or omit it.

BALANCED GROUNDING (read carefully):
(1) Do **not** invent or imply facts, dates, or outcomes that are not in the Wikipedia and fact bullets above. No extra names, years, or "body found" if not allowed.
(2) You **must** still sound like a real Short, not a hollow teaser: at least **two** concrete, allowed details in the first half—short declarative sentences, not only inside a final question. If KEY ANCHORS is present, weave those phrases in early. If there is no fact-bullet section and no Wikipedia, use only the person/case name and the general nature of the mystery — no specific numbers.
(3) Do not write a script that is *only* vague atmosphere + one rhetorical question. The ending can ask an open question, but the middle should add **at least one more** allowed beat (documented paradox, reversal, or unknown—only if in the sources).
(4) If sources are thin, anchor with the case/victim from the topic; keep sentences cold and fast; the closing question should point at a **documented** gap, not a made-up hook.
(5) English only; respect the word limit for Shorts.
(6) BOOKEND: The closing question or paradox must explicitly recall one concrete element from your opening sentences—the same evidence, sound, place, object, or last-known detail—not a new topic introduced only at the end.`,
    maxTokens: 280,
    model: shortsScriptModel(getProvider()),
    llmRole: 'script',
  });
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
  const raw = await completeLlm({
    maxTokens: 420,
    user: `Based on this YouTube Shorts script (genre: ${genre.label}), generate:
1. YouTube title — US mystery/true-crime Shorts, SHORT and high-arousal: curiosity, dread, "how is this possible?" energy (aim ${SHORTS_TITLE_SOFT_MAX} characters or less; never exceed ${YOUTUBE_TITLE_MAX} characters including spaces). Not a long documentary sentence; not a copy-paste of the topic line.
2. 5 relevant hashtags
3. A Pexels VIDEO search query (2-5 words, dark, cinematic, matches the story mood — used for background footage)

YouTube TITLE rules:
- Open with a hook: mystery, impossibility, a number, a name, or a place — whichever hits hardest first
- Use specific names or places when it fits, within the character budget
- Normal Title Case or sentence case — not ALL CAPS for the whole title
- Prefer ${SHORTS_TITLE_SOFT_MAX} characters or less; always stay under ${YOUTUBE_TITLE_MAX} characters
- Tight, provocative fragments — never paste the long topic line verbatim

SEARCH + Shorts FEED (both matter for this genre):
- If the script is about a real, named case (person, place, ship, flight, well-known nickname), put that EXACT searchable name or phrase as EARLY as possible in the TITLE (ideally in the first half, still within ${SHORTS_TITLE_SOFT_MAX} chars). Many viewers type the name in YouTube search, not a documentary-style phrase alone.
- Do NOT bury the only recognizable search token at the very end or hide it behind vague wording only (e.g. if the script is clearly about one famous missing person, the title should contain their name or the case name viewers search, not only generic words like "The Vanishing" with no name).

TAGS rules:
- Include 2–3 tags that are literal searchable phrases or proper names from the script (when applicable), plus broader mystery/true-crime tags.

Topic line (source of truth for names/places—TITLE and tags should align with it when the script matches):
${topic}

Script:
${script}

Output in this exact format (one line each field after the colon):
TITLE: <youtube title>
TAGS: <tag1>,<tag2>,...
BACKGROUND: <pexels video search query>${metadataPromptAddon()}`,
  });

  const titleMatch = raw.match(/^TITLE:\s*([^\n]+)/m);
  const tagsMatch = raw.match(/TAGS:\s*(.+)/);
  const backgroundMatch = raw.match(/^BACKGROUND:\s*([^\n]+)/m);
  const channelTag = genre.channelName ? genre.channelName.toLowerCase() : '';
  const baseTags = tagsMatch
    ? tagsMatch[1].split(',').map((t) => t.trim())
    : ['shorts'];
  const allTags = channelTag ? [channelTag, ...baseTags] : baseTags;

  const rawTitle = titleMatch ? collapseWhitespace(titleMatch[1]) : '';
  const title =
    (rawTitle || collapseWhitespace(topic) || 'Mystery Short').slice(0, YOUTUBE_TITLE_MAX) ||
    'Mystery Short';
  return {
    title,
    description: String(script || '').trim(),
    tags: [...new Set(allTags)],
    backgroundQuery: backgroundMatch ? backgroundMatch[1].trim() : null,
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

TITLE rules:
- Max 70 characters
- Include the case name or person's name
- Serious documentary tone (not clickbait)

Output in this exact format:
TITLE: <title>
DESCRIPTION: <description>
TAGS: <tag1>,<tag2>,...`,
  });
  const titleMatch = raw.match(/^TITLE:\s*([^\n]+)/m);
  const descMatch = raw.match(/DESCRIPTION:\s*([\s\S]+?)(?=TAGS:|$)/);
  const tagsMatch = raw.match(/TAGS:\s*(.+)/);

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
  };
}

module.exports = {
  generateScript,
  generateMetadata,
  generateLongformScript,
  generateLongformMetadata,
  generateShortsFactBullets,
  isShortsFactsStepEnabled,
  validateTopicWithWiki,
};
