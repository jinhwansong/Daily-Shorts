const { test } = require('node:test');
const assert = require('node:assert');
const { buildTierPlan, formatTierBatchBlock } = require('../src/script/topicTier');

test('buildTierPlan: 길이와 rng 고정 시 전부 A', () => {
  const plan = buildTierPlan(4, { rng: () => 0, weightA: 0.5 });
  assert.strictEqual(plan.length, 4);
  assert.ok(plan.every((p) => p.tier === 'A'));
});

test('buildTierPlan: rng 1이면 전부 B', () => {
  const plan = buildTierPlan(3, { rng: () => 0.99, weightA: 0.5 });
  assert.ok(plan.every((p) => p.tier === 'B'));
});

test('buildTierPlan: count 0이면 빈 배열', () => {
  assert.deepStrictEqual(buildTierPlan(0, { rng: () => 0.1, weightA: 0.5 }), []);
});

test('formatTierBatchBlock: mystery가 아니면 빈 문자열', () => {
  assert.strictEqual(formatTierBatchBlock([{ tier: 'A' }], 'mystery-long'), '');
});

test('formatTierBatchBlock: mystery면 TIER A/B 문구 포함', () => {
  const block = formatTierBatchBlock([{ tier: 'A' }, { tier: 'B' }], 'mystery');
  assert.match(block, /TIER A/);
  assert.match(block, /TIER B/);
  assert.match(block, /Line 1/);
  assert.match(block, /Line 2/);
});
