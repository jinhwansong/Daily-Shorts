/**
 * 스크립트·토픽·메타데이터 생성용 텍스트 LLM 라우터.
 * SCRIPT_LLM_PROVIDER=anthropic|openai|google (기본 anthropic)
 *
 * Shorts 팩트체크(completeLlmFactcheck)는 항상 OpenAI gpt-4o-mini — CI/로컬 env 혼선 방지.
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

let _logged = false;

function logOnce(provider, model) {
  if (_logged) return;
  _logged = true;
  console.log(`  [LLM] 스크립트·토픽: ${provider} / ${model}`);
}

function logFactcheck(model) {
  console.log(`  [LLM] 팩트체크: openai / ${model}`);
}

/** Shorts 사실 검증(도메인·연도) 전용. CI/로컬에서 모델 혼선 없이 고정. */
const FACTCHECK_OPENAI_MODEL = 'gpt-4o-mini';
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
let openaiClient;
let googleGenAI;

function getOpenAI() {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function getGoogleGenAI() {
  if (!googleGenAI) googleGenAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
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
  logOnce(provider, model);

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
    if (!process.env.GOOGLE_AI_API_KEY) {
      throw new Error('GOOGLE_AI_API_KEY is required when SCRIPT_LLM_PROVIDER=google');
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
    if (!text) throw new Error('Gemini: empty response (check model name and GOOGLE_AI_API_KEY)');
    return text.trim();
  }

  throw new Error(`Unhandled SCRIPT_LLM_PROVIDER: ${provider}`);
}

async function completeLlmLongform(p) {
  const prov = getProvider();
  return completeLlm({ ...p, model: p.model || longformModel(prov) });
}

/**
 * Shorts 팩트체크·연도 수정 전용. 항상 OpenAI gpt-4o-mini(고정) — GitHub/로컬 env 로 모델이 바뀌지 않음.
 * OPENAI_API_KEY 필요(스크립트 생성이 Anthropic only여도 TTS/팩트체크에 쓰는 키와 동일).
 */
async function completeLlmFactcheck(p) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is required for Shorts fact-checking (OpenAI gpt-4o-mini, fixed)'
    );
  }
  const model = p.model || FACTCHECK_OPENAI_MODEL;
  logFactcheck(model);

  const messages = [];
  if (p.system) messages.push({ role: 'system', content: p.system });
  messages.push({ role: 'user', content: p.user });
  const r = await getOpenAI().chat.completions.create({
    model,
    messages,
    max_tokens: p.maxTokens,
    temperature: 0.1,
  });
  const text = r.choices[0]?.message?.content;
  if (!text) throw new Error('OpenAI factcheck: empty response');
  return String(text).trim();
}

module.exports = {
  completeLlm,
  completeLlmLongform,
  completeLlmFactcheck,
  getProvider,
  defaultModel,
  longformModel,
  FACTCHECK_OPENAI_MODEL,
};
