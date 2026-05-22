const { test } = require('node:test');
const assert = require('node:assert');
const {
  extractClaims,
  assertClaimsAgainstWiki,
  runClaimGate,
  isClaimGateEnabled,
} = require('../src/script/claimAssertionGate');

test('extractClaims: strict marker in script', () => {
  const claims = extractClaims({
    script: 'Glenn Miller vanished in 1944. His death remains officially unconfirmed.',
    title: 'Glenn Miller Vanished',
  });
  assert.ok(claims.some((c) => /officially unconfirmed/i.test(c.claim)));
  assert.ok(claims.every((c) => c.strict));
});

test('extractClaims: title with never found', () => {
  const claims = extractClaims({
    script: 'He flew into fog and was never seen again.',
    title: 'No wreckage. Never found.',
  });
  assert.ok(claims.some((c) => /never found/i.test(c.claim)));
});

test('assertClaimsAgainstWiki: unconfirmed vs declared dead → fail', () => {
  const claims = extractClaims({
    script: 'Death officially unconfirmed decades later.',
    title: 'Miller Case',
  });
  const result = assertClaimsAgainstWiki({
    claims,
    wikiText:
      'Miller disappeared over the English Channel in 1944. On December 15, 1945, he was declared dead in absentia.',
    factBullets: '',
  });
  assert.strictEqual(result.passed, false);
  assert.ok(result.failures.length >= 1);
});

test('assertClaimsAgainstWiki: never found supported by wiki → pass', () => {
  const claims = extractClaims({
    script: 'The plane vanished. Wreckage was never found.',
    title: 'Vanished Over the Channel',
  });
  const result = assertClaimsAgainstWiki({
    claims,
    wikiText: 'The aircraft wreckage has never been found despite extensive searches.',
    factBullets: '• Wreckage never located\nAVOID: claiming remains were recovered',
  });
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.failures.length, 0);
});

test('assertClaimsAgainstWiki: AVOID violation → fail', () => {
  const claims = extractClaims({
    script: 'Police confirmed the body was found in the river.',
    title: 'Cold Case',
  });
  const result = assertClaimsAgainstWiki({
    claims,
    wikiText: 'The victim disappeared in 1987.',
    factBullets: 'AVOID: do not say body was found or remains were recovered',
  });
  assert.strictEqual(result.passed, false);
});

test('assertClaimsAgainstWiki: no strict claims → pass', () => {
  const result = assertClaimsAgainstWiki({
    claims: extractClaims({
      script: 'He vanished on a foggy night over the sea.',
      title: 'The Foggy Flight',
    }),
    wikiText: 'A bandleader disappeared in 1944.',
    factBullets: '',
  });
  assert.strictEqual(result.passed, true);
});

test('runClaimGate: disabled when CLAIM_GATE=0', () => {
  const prev = process.env.CLAIM_GATE;
  process.env.CLAIM_GATE = '0';
  try {
    assert.strictEqual(isClaimGateEnabled(), false);
    const gate = runClaimGate({
      script: 'Death officially unconfirmed.',
      title: 'Test',
      wikiText: 'declared dead in absentia',
      factBullets: '',
    });
    assert.strictEqual(gate.skipped, true);
    assert.strictEqual(gate.passed, true);
  } finally {
    if (prev === undefined) delete process.env.CLAIM_GATE;
    else process.env.CLAIM_GATE = prev;
  }
});
