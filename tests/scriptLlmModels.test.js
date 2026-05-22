const { test } = require('node:test');
const assert = require('node:assert');
const { defaultModel, shortsScriptModel } = require('../src/script/scriptLlm');

test('shortsScriptModel: anthropic default is Sonnet', () => {
  const prevScript = process.env.CLAUDE_SCRIPT_MODEL;
  const prevHelper = process.env.SCRIPT_LLM_SCRIPT_MODEL;
  delete process.env.CLAUDE_SCRIPT_MODEL;
  delete process.env.SCRIPT_LLM_SCRIPT_MODEL;
  try {
    assert.match(shortsScriptModel('anthropic'), /sonnet/i);
    assert.match(defaultModel('anthropic'), /haiku/i);
  } finally {
    if (prevScript === undefined) delete process.env.CLAUDE_SCRIPT_MODEL;
    else process.env.CLAUDE_SCRIPT_MODEL = prevScript;
    if (prevHelper === undefined) delete process.env.SCRIPT_LLM_SCRIPT_MODEL;
    else process.env.SCRIPT_LLM_SCRIPT_MODEL = prevHelper;
  }
});

test('shortsScriptModel: CLAUDE_SCRIPT_MODEL overrides default', () => {
  const prev = process.env.CLAUDE_SCRIPT_MODEL;
  process.env.CLAUDE_SCRIPT_MODEL = 'claude-haiku-4-5-20251001';
  try {
    assert.strictEqual(shortsScriptModel('anthropic'), 'claude-haiku-4-5-20251001');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_SCRIPT_MODEL;
    else process.env.CLAUDE_SCRIPT_MODEL = prev;
  }
});
