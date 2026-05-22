const { test } = require('node:test');
const assert = require('node:assert');
const {
  extractClaimsFromScript,
  assertClaimsAgainstWiki,
  runClaimGate,
  isClaimGateEnabled,
} = require('../src/script/claimAssertionGate');
const { validateTopicWithWiki } = require('../src/script/scriptGenerator');

test('extractClaimsFromScript: strict marker in script', () => {
  const claims = extractClaimsFromScript(
    'Glenn Miller vanished in 1944. His death remains officially unconfirmed.'
  );
  assert.ok(claims.some((c) => /officially unconfirmed/i.test(c.claim)));
  assert.ok(claims.every((c) => c.source === 'script'));
});

test('assertClaimsAgainstWiki: unconfirmed vs declared dead → fail', () => {
  const claims = extractClaimsFromScript('Death officially unconfirmed decades later.');
  const result = assertClaimsAgainstWiki({
    claims,
    wikiText:
      'Miller disappeared over the English Channel in 1944. On December 15, 1945, he was declared dead in absentia.',
  });
  assert.strictEqual(result.passed, false);
});

test('assertClaimsAgainstWiki: never found supported by wiki → pass', () => {
  const claims = extractClaimsFromScript('The plane vanished. Wreckage was never found.');
  const result = assertClaimsAgainstWiki({
    claims,
    wikiText: 'The aircraft wreckage has never been found despite extensive searches.',
  });
  assert.strictEqual(result.passed, true);
});

test('assertClaimsAgainstWiki: body found claim vs missing person wiki → fail', () => {
  const claims = extractClaimsFromScript('Police confirmed the body was found in the river.');
  const result = assertClaimsAgainstWiki({
    claims,
    wikiText: 'The victim disappeared in 1987 and remains were never recovered.',
  });
  assert.strictEqual(result.passed, false);
});

test('validateTopicWithWiki: wiki article title matches', () => {
  const r = validateTopicWithWiki('Gaius Gracchus', {
    found: true,
    title: 'Gaius Gracchus',
    extract: 'Roman politician',
    categories: ['Murder victims'],
  });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.reason, 'wiki_title_match');
});

test('runClaimGate: disabled when CLAIM_GATE=0', () => {
  const prev = process.env.CLAIM_GATE;
  process.env.CLAIM_GATE = '0';
  try {
    assert.strictEqual(isClaimGateEnabled(), false);
    const gate = runClaimGate({
      script: 'Death officially unconfirmed.',
      wikiText: 'declared dead in absentia',
    });
    assert.strictEqual(gate.skipped, true);
    assert.strictEqual(gate.passed, true);
  } finally {
    if (prev === undefined) delete process.env.CLAIM_GATE;
    else process.env.CLAIM_GATE = prev;
  }
});
