const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('mystery.txt includes BOOKEND open/close tie-back section', () => {
  const p = path.join(__dirname, '../prompts/mystery.txt');
  const txt = fs.readFileSync(p, 'utf-8');
  assert.ok(/BOOKEND \(mandatory — opening and closing must connect\)/i.test(txt));
  assert.ok(/explicitly call back/i.test(txt));
});
