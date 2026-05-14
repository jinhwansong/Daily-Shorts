/**
 * 배경 클립 비주얼 북엔드(첫 클립 재등장) 경로 조합 단위 테스트
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { applyBookendBackgroundPaths } = require('../src/utils/videoPipelineEnv');

test('applyBookendBackgroundPaths: single → duplicate', () => {
  assert.deepStrictEqual(applyBookendBackgroundPaths(['/a.mp4']), ['/a.mp4', '/a.mp4']);
});

test('applyBookendBackgroundPaths: two → a,b,a', () => {
  assert.deepStrictEqual(applyBookendBackgroundPaths(['/a.mp4', '/b.mp4']), [
    '/a.mp4',
    '/b.mp4',
    '/a.mp4',
  ]);
});

test('applyBookendBackgroundPaths: four → last replaced with first', () => {
  assert.deepStrictEqual(
    applyBookendBackgroundPaths(['/a.mp4', '/b.mp4', '/c.mp4', '/d.mp4']),
    ['/a.mp4', '/b.mp4', '/c.mp4', '/a.mp4']
  );
});

test('applyBookendBackgroundPaths: empty unchanged', () => {
  assert.deepStrictEqual(applyBookendBackgroundPaths([]), []);
});
