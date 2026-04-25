/**
 * 스크립트·토픽·메타데이터 생성용 텍스트 LLM 라우터.
 * SCRIPT_LLM_PROVIDER=anthropic|openai|google (기본 anthropic)
 *
 * 팩트체크 전용 키(FACTCHECK_*) 는 루트 .env 를 직접 읽어 process.env 에 반영한다.
 * 이유: (1) dotenv 기본 동작은 “이미 있는 환경 변수는 덮어쓰지 않음” — 셸/IDE에
 *      SCRIPT_LLM_* 만 있어도 FACTCHECK 가 무시될 수 있음.
 *     (2) index.js 가 dotenv 하기 전에 이 파일이 require 되는 경로가 있을 수 있음.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const rootEnvPath = path.join(__dirname, '../../.env');
if (fs.existsSync(rootEnvPath)) {
  try {
    const parsed = dotenv.parse(fs.readFileSync(rootEnvPath, 'utf8'));
    const factcheckKeys = [
      'FACTCHECK_LLM_PROVIDER',
      'FACTCHECK_LLM_MODEL',
      'CLAUDE_FACTCHECK_MODEL',
      'OPENAI_FACTCHECK_MODEL',
      'GEMINI_FACTCHECK_MODEL',
    ];
    for (const k of factcheckKeys) {
      if (Object.prototype.hasOwnProperty.call(parsed, k)) {
        const v = String(parsed[k] ?? '').trim();
        if (v) process.env[k] = v;
      }
    }
  } catch (_) {
    /* ignore */
  }
}

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

/**
 * 팩트체크 전용 프로바이더.
 * FACTCHECK_LLM_PROVIDER 가 없으면 SCRIPT_LLM_PROVIDER 를 따름.
 * 생성 모델과 달리 설정하면 서로 다른 학습 편향으로 검증 → 환각 누락 감소.
 */
function getFactcheckProvider() {
  const raw = (
    process.env.FACTCHECK_LLM_PROVIDER ||
    process.env.SCRIPT_LLM_PROVIDER ||
    'anthropic'
  ).toString().trim().toLowerCase();
  if (!PROVIDERS.has(raw)) {
    throw new Error(
      `FACTCHECK_LLM_PROVIDER must be one of: anthropic, openai, google (got "${raw}")`
    );
  }
  return raw;
}

function defaultModel(provider) {
  if (process.env.SCRIPT_LLM_MODEL && String(process.env.SCRIPT_LLM_MODEL).trim()) {
    return String(process.env.SCRIPT_LLM_MODEL).trim();
  }
  if (provider === 'openai') return process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
  if (provider === 'google') return process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash';
  return process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
}

/**
 * 팩트체크 전용 모델.
 * FACTCHECK_LLM_MODEL 이 없으면 프로바이더별 기본 검증 모델을 사용.
 * 생성(Haiku 등)보다 한 단계 위 모델을 기본으로 설정해 두어 검증 정확도를 높임.
 */
function factcheckModel(provider) {
  if (process.env.FACTCHECK_LLM_MODEL && String(process.env.FACTCHECK_LLM_MODEL).trim()) {
    return String(process.env.FACTCHECK_LLM_MODEL).trim();
  }
  if (provider === 'anthropic') {
    return process.env.CLAUDE_FACTCHECK_MODEL || 'claude-haiku-4-5-20251001';
  }
  if (provider === 'openai') return process.env.OPENAI_FACTCHECK_MODEL || 'gpt-4o-mini';
  if (provider === 'google') return process.env.GEMINI_FACTCHECK_MODEL || 'gemini-2.0-flash';
  return defaultModel(provider);
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

function logFactcheck(provider, model) {
  console.log(`  [LLM] 팩트체크: ${provider} / ${model}`);
}

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
 * 팩트체크 전용 LLM 호출.
 * FACTCHECK_LLM_PROVIDER / FACTCHECK_LLM_MODEL 로 생성 모델과 독립 설정 가능.
 * 미설정 시 생성 모델과 같은 프로바이더·모델을 사용하므로 기존 동작과 호환됨.
 */
async function completeLlmFactcheck(p) {
  const provider = getFactcheckProvider();
  const model = p.model || factcheckModel(provider);
  logFactcheck(provider, model);

  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required for factcheck (FACTCHECK_LLM_PROVIDER=anthropic)');
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
      throw new Error('OPENAI_API_KEY is required for factcheck (FACTCHECK_LLM_PROVIDER=openai)');
    }
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

  if (provider === 'google') {
    if (!process.env.GOOGLE_AI_API_KEY) {
      throw new Error('GOOGLE_AI_API_KEY is required for factcheck (FACTCHECK_LLM_PROVIDER=google)');
    }
    const body =
      p.system && p.system.trim()
        ? `Follow these system instructions exactly.\n\n${p.system}\n\n---\n\n${p.user}`
        : p.user;
    const res = await getGoogleGenAI().models.generateContent({
      model,
      contents: body,
      config: { maxOutputTokens: p.maxTokens, temperature: 0.1 },
    });
    const text = geminiExtractText(res);
    if (!text) throw new Error('Gemini factcheck: empty response');
    return text.trim();
  }

  throw new Error(`Unhandled FACTCHECK_LLM_PROVIDER: ${provider}`);
}

module.exports = {
  completeLlm,
  completeLlmLongform,
  completeLlmFactcheck,
  getProvider,
  getFactcheckProvider,
  defaultModel,
  factcheckModel,
  longformModel,
};
