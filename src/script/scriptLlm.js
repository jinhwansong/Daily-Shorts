/**
 * 스크립트·토픽·메타데이터 생성용 텍스트 LLM 라우터.
 * SCRIPT_LLM_PROVIDER=anthropic|openai|google (기본 anthropic)
 */
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');

const PROVIDERS = new Set(['anthropic', 'openai', 'google']);

function getProvider() {
  const raw = (process.env.SCRIPT_LLM_PROVIDER || 'anthropic').toString().trim().toLowerCase();
  if (!PROVIDERS.has(raw)) {
    throw new Error(
      `SCRIPT_LLM_PROVIDER must be one of: anthropic, openai, google (got "${raw}")`
    );
  }
  return raw;
}

function defaultModel(provider) {
  if (process.env.SCRIPT_LLM_MODEL && String(process.env.SCRIPT_LLM_MODEL).trim()) {
    return String(process.env.SCRIPT_LLM_MODEL).trim();
  }
  return process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
}

function longformModel(provider) {
  if (process.env.SCRIPT_LLM_LONGFORM_MODEL && String(process.env.SCRIPT_LLM_LONGFORM_MODEL).trim()) {
    return String(process.env.SCRIPT_LLM_LONGFORM_MODEL).trim();
  }
  if (provider === 'anthropic') {
    return process.env.CLAUDE_LONGFORM_MODEL || process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  }
  return defaultModel(provider);
}

/** Shorts TTS 각본 전용 — fact bullets·메타·토픽보다 강한 모델 (기본 Sonnet) */
function shortsScriptModel(provider) {
  const explicit =
    (process.env.SCRIPT_LLM_SCRIPT_MODEL && String(process.env.SCRIPT_LLM_SCRIPT_MODEL).trim()) ||
    (process.env.CLAUDE_SCRIPT_MODEL && String(process.env.CLAUDE_SCRIPT_MODEL).trim()) ||
    '';
  if (explicit) return explicit;
  if (provider === 'anthropic') {
    return 'claude-sonnet-4-5-20250929';
  }
  return defaultModel(provider);
}

const _loggedRoles = new Set();

function logModelOnce(role, provider, model) {
  if (_loggedRoles.has(role)) return;
  _loggedRoles.add(role);
  const label = role === 'script' ? '스크립트' : 'fact·meta·topic';
  console.log(`  [LLM] ${label}: ${provider} / ${model}`);
}

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let openaiClient;
let googleGenAI;

function getOpenAI() {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function getGoogleGenAI() {
  if (!googleGenAI) googleGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return googleGenAI;
}

function geminiExtractText(response) {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text)
    .filter(Boolean)
    .join('');
}

/**
 * @param {object} p
 * @param {string} [p.system]
 * @param {string} p.user
 * @param {number} p.maxTokens
 * @param {string} [p.model] — explicit model (e.g. longform vs default)
 */
async function completeLlm(p) {
  const provider = getProvider();
  const model = p.model || defaultModel(provider);
  const role = p.llmRole === 'script' ? 'script' : 'helper';
  logModelOnce(role, provider, model);

  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required when SCRIPT_LLM_PROVIDER=anthropic');
    }
    const payload = {
      model,
      max_tokens: p.maxTokens,
      messages: [{ role: 'user', content: p.user }],
    };
    if (p.system && String(p.system).trim()) payload.system = p.system;
    const msg = await anthropicClient.messages.create(payload);
    return msg.content[0].text.trim();
  }

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when SCRIPT_LLM_PROVIDER=openai');
    }
    const messages = [];
    if (p.system) messages.push({ role: 'system', content: p.system });
    messages.push({ role: 'user', content: p.user });
    const r = await getOpenAI().chat.completions.create({
      model,
      messages,
      max_tokens: p.maxTokens,
      temperature: 0.35,
    });
    const text = r.choices[0]?.message?.content;
    if (!text) throw new Error('OpenAI: empty response');
    return String(text).trim();
  }

  if (provider === 'google') {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required when SCRIPT_LLM_PROVIDER=google');
    }
    const body =
      p.system && p.system.trim()
        ? `Follow these system instructions exactly.\n\n${p.system}\n\n---\n\n${p.user}`
        : p.user;
    const res = await getGoogleGenAI().models.generateContent({
      model,
      contents: body,
      config: {
        maxOutputTokens: p.maxTokens,
        temperature: 0.35,
      },
    });
    const text = geminiExtractText(res);
    if (!text) throw new Error('Gemini: empty response (check model name and GEMINI_API_KEY)');
    return text.trim();
  }

  throw new Error(`Unhandled SCRIPT_LLM_PROVIDER: ${provider}`);
}

async function completeLlmLongform(p) {
  const prov = getProvider();
  return completeLlm({ ...p, model: p.model || longformModel(prov) });
}

module.exports = {
  completeLlm,
  completeLlmLongform,
  getProvider,
  defaultModel,
  longformModel,
  shortsScriptModel,
};
