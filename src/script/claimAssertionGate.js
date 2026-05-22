/**
 * Post-generation fact assertion gate — strict claims in script/title must
 * be supported by Wikipedia extract and/or fact bullets (deterministic, no LLM).
 */

const STRICT_MARKERS = [
  'officially',
  'confirmed',
  'unconfirmed',
  'never',
  'always',
  'only',
  'first',
  'largest',
  'worst',
];

const STOPWORDS = new Set([
  'that',
  'this',
  'with',
  'from',
  'were',
  'was',
  'have',
  'been',
  'their',
  'about',
  'which',
  'when',
  'where',
  'what',
  'into',
  'over',
  'after',
  'before',
  'still',
  'there',
  'they',
  'them',
  'then',
  'than',
  'also',
  'just',
  'only',
  'very',
  'some',
  'such',
  'would',
  'could',
  'should',
  'being',
  'while',
  'during',
  'under',
  'between',
  'through',
  'without',
  'within',
  'along',
  'against',
  'among',
  'around',
  'because',
  'until',
  'since',
  'although',
  'though',
  'these',
  'those',
  'other',
  'another',
  'every',
  'years',
  'year',
  'case',
  'death',
  'body',
  'found',
  'never',
  'officially',
  'confirmed',
  'unconfirmed',
  'first',
  'largest',
  'worst',
  'always',
]);

const STATUS_DENIAL = /\b(unconfirmed|not confirmed|never confirmed|officially unconfirmed|death unconfirmed)\b/i;
const STATUS_AFFIRMATION =
  /\b(officially declared|declared dead|death was confirmed|confirmed dead|listed as dead|presumed dead|declared dead in absentia|missing in action.*declared)\b/i;

const NEVER_NOT_FOUND =
  /\b(never found|never been found|not found|no wreckage|wreckage was never|wreckage has never|remains were never|body was never|never located|never recovered|never identified)\b/i;
const FOUND_AFFIRMATION =
  /\b(body was found|remains were found|remains were recovered|wreckage was found|wreckage was located|identified the remains|confirmed the death)\b/i;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function markerInText(text) {
  const lower = normalize(text);
  for (const m of STRICT_MARKERS) {
    if (new RegExp(`\\b${m}\\b`, 'i').test(lower)) return m;
  }
  return null;
}

function splitSegments(text) {
  return String(text || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

function contentTokens(text) {
  return normalize(text)
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function stripAvoidLines(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !/^AVOID:/i.test(t) && !/\bdo not (say|claim)\b/i.test(t);
    })
    .join('\n');
}

function parseAvoidPhrases(factBullets) {
  const phrases = [];
  const raw = String(factBullets || '');
  const avoidLine = raw.match(/^AVOID:\s*(.+)$/im);
  if (avoidLine) phrases.push(avoidLine[1].trim());

  for (const line of raw.split('\n')) {
    const m = line.match(/do not say\s+(.+)/i);
    if (m) phrases.push(m[1].trim());
    const m2 = line.match(/do not claim\s+(.+)/i);
    if (m2) phrases.push(m2[1].trim());
  }
  return phrases.filter(Boolean);
}

function avoidViolated(claim, avoidPhrases) {
  const c = normalize(claim);
  for (const phrase of avoidPhrases) {
    const p = normalize(phrase);
    if (!p) continue;
    const tokens = contentTokens(p);
    if (tokens.length >= 2 && tokens.every((t) => c.includes(t))) return phrase;
    if (p.length >= 12 && c.includes(p.slice(0, Math.min(p.length, 40)))) return phrase;
  }
  return null;
}

function statusContradiction(claim, corpus) {
  if (!STATUS_DENIAL.test(claim)) return null;
  if (STATUS_AFFIRMATION.test(corpus)) {
    return 'status claim contradicts source (unconfirmed vs declared/confirmed dead)';
  }
  return null;
}

function foundContradiction(claim, corpus) {
  const c = normalize(claim);
  if (!/\bnever\b/i.test(c) && !/\bno wreckage\b/i.test(c)) return null;
  if (NEVER_NOT_FOUND.test(c) && FOUND_AFFIRMATION.test(corpus)) {
    return 'never-found claim contradicts source saying remains/wreckage were found';
  }
  return null;
}

function hasCorpusSupport(claim, corpus) {
  if (NEVER_NOT_FOUND.test(claim) && NEVER_NOT_FOUND.test(corpus)) return true;

  const tokens = contentTokens(claim);
  if (tokens.length === 0) return false;

  const hits = tokens.filter((t) => corpus.includes(t));
  if (hits.length >= 2) return true;
  if (tokens.length <= 2 && hits.length >= 1) return true;
  if (hits.length / tokens.length >= 0.5) return true;

  const marker = markerInText(claim);
  if (marker) {
    const words = normalize(claim).split(/\s+/);
    const idx = words.findIndex((w) => w === marker || w.startsWith(marker));
    if (idx >= 0) {
      const window = words.slice(Math.max(0, idx - 3), idx + 4).join(' ');
      if (window.length >= 10 && corpus.includes(window)) return true;
    }
  }

  return false;
}

/**
 * @param {{ script: string, title?: string }} input
 * @returns {{ claim: string, source: string, strict: boolean, marker: string }[]}
 */
function extractClaims({ script, title }) {
  const out = [];
  const sources = [
    { source: 'title', text: title },
    { source: 'script', text: script },
  ];

  for (const { source, text } of sources) {
    for (const segment of splitSegments(text)) {
      const marker = markerInText(segment);
      if (!marker) continue;
      out.push({
        claim: segment.replace(/\s+/g, ' ').trim(),
        source,
        strict: true,
        marker,
      });
    }
  }

  const seen = new Set();
  return out.filter((c) => {
    const k = normalize(c.claim);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * @param {{ claims: object[], wikiText?: string, factBullets?: string }} input
 */
function assertClaimsAgainstWiki({ claims, wikiText, factBullets }) {
  const corpus = normalize([wikiText, factBullets].filter(Boolean).join('\n'));
  const sourceCorpus = normalize([wikiText, stripAvoidLines(factBullets)].filter(Boolean).join('\n'));
  const avoidPhrases = parseAvoidPhrases(factBullets);
  const failures = [];
  const checks = [];

  if (!corpus && claims.some((c) => c.strict)) {
    return {
      passed: false,
      failures: claims.map((c) => ({
        claim: c.claim,
        source: c.source,
        reason: 'no_wiki_or_fact_bullets_for_strict_claim',
      })),
      checks,
    };
  }

  for (const item of claims) {
    if (!item.strict) continue;

    const avoidHit = avoidViolated(item.claim, avoidPhrases);
    if (avoidHit) {
      failures.push({
        claim: item.claim,
        source: item.source,
        reason: `violates AVOID: ${avoidHit}`,
      });
      checks.push({ claim: item.claim, passed: false, detail: 'avoid' });
      continue;
    }

    const statusHit = statusContradiction(item.claim, sourceCorpus);
    if (statusHit) {
      failures.push({ claim: item.claim, source: item.source, reason: statusHit });
      checks.push({ claim: item.claim, passed: false, detail: 'status_contradiction' });
      continue;
    }

    const foundHit = foundContradiction(item.claim, sourceCorpus);
    if (foundHit) {
      failures.push({ claim: item.claim, source: item.source, reason: foundHit });
      checks.push({ claim: item.claim, passed: false, detail: 'found_contradiction' });
      continue;
    }

    const supported = hasCorpusSupport(item.claim, sourceCorpus);
    checks.push({ claim: item.claim, passed: supported, detail: supported ? 'supported' : 'unsupported' });
    if (!supported) {
      failures.push({
        claim: item.claim,
        source: item.source,
        reason: 'strict claim not supported by Wikipedia/fact bullets',
      });
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    checks,
  };
}

function isClaimGateEnabled() {
  const v = (process.env.CLAIM_GATE ?? '1').toString().trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** block = skip run on fail; warn = log only */
function getClaimGateMode() {
  const v = (process.env.CLAIM_GATE_MODE || 'block').toString().trim().toLowerCase();
  return v === 'warn' ? 'warn' : 'block';
}

function runClaimGate({ script, title, wikiText, factBullets }) {
  if (!isClaimGateEnabled()) {
    return { passed: true, skipped: true, failures: [], checks: [], claims: [] };
  }

  const claims = extractClaims({ script, title });
  const result = assertClaimsAgainstWiki({ claims, wikiText, factBullets });
  return { ...result, claims, mode: getClaimGateMode() };
}

module.exports = {
  STRICT_MARKERS,
  extractClaims,
  assertClaimsAgainstWiki,
  runClaimGate,
  isClaimGateEnabled,
  getClaimGateMode,
};
