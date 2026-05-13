const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTopicKey } = require('../src/utils/topicKey');

test('normalizeTopicKey: trim, NFC, lower, collapse spaces', () => {
  assert.strictEqual(normalizeTopicKey('  The  Dyatlov Pass  '), 'the dyatlov pass');
});

test('normalizeTopicKey: null/empty → empty string', () => {
  assert.strictEqual(normalizeTopicKey(null), '');
  assert.strictEqual(normalizeTopicKey('   '), '');
});

test('normalizeTopicKey: composed vs decomposed unicode same', () => {
  const composed = '\u00e9';
  const decomposed = 'e\u0301';
  assert.strictEqual(normalizeTopicKey(composed), normalizeTopicKey(decomposed));
});
