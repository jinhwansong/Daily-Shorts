const { createClient } = require('@supabase/supabase-js');
const { normalizeTopicKey } = require('./topicKey');
const { generateTopics } = require('../script/topicGenerator');

/** Node < 22 에는 전역 WebSocket 이 없음 — Supabase Realtime 초기화 시 오류 방지 (@supabase/realtime-js) */
function patchGlobalWebSocketIfNeeded() {
  if (typeof globalThis.WebSocket !== 'undefined') return;
  try {
    globalThis.WebSocket = require('ws');
  } catch {
    /* ws 미설치 시 createClient 단계에서 원본 에러 유지 */
  }
}

function getCooldownMonths() {
  const n = parseInt(process.env.TOPIC_PUBLISHED_COOLDOWN_MONTHS || '6', 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

function getMaxDedupRetries() {
  const n = parseInt(process.env.TOPIC_DEDUP_MAX_RETRIES || '8', 10);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

function cooldownCutoffIso(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

function isSupabaseDedupConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseClient() {
  if (!isSupabaseDedupConfigured()) return null;
  patchGlobalWebSocketIfNeeded();
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hasRecentPublishedDuplicate(client, genreKey, topicKey, options = {}) {
  const months = options.cooldownMonths ?? getCooldownMonths();
  const cutoff = cooldownCutoffIso(months);
  const { data, error } = await client
    .from('published_topics')
    .select('id')
    .eq('genre_key', genreKey)
    .eq('topic_key', topicKey)
    .gte('uploaded_at', cutoff)
    .limit(1);

  if (error) {
    console.warn(`[Supabase dedup] duplicate check failed: ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function insertPublishedTopicRow(client, row) {
  const payload = {
    genre_key: row.genreKey,
    topic_key: row.topicKey,
    video_id: row.videoId ?? null,
    raw_topic: row.rawTopic ?? null,
  };
  const { error } = await client.from('published_topics').insert([payload]);
  if (error) {
    console.error(`[Supabase dedup] insert failed after upload: ${error.message}`);
  }
}

function getDedupClient() {
  return getSupabaseClient();
}

async function resolveTopicForUpload(genreKey, candidateTopic) {
  const client = getDedupClient();
  if (!client) return candidateTopic || null;

  let topic = candidateTopic;
  const max = getMaxDedupRetries();

  for (let attempt = 0; attempt <= max; attempt++) {
    const key = normalizeTopicKey(topic);
    if (!key) {
      const one = await generateTopics(1, genreKey);
      topic = one[0];
      continue;
    }

    let duplicate;
    try {
      duplicate = await hasRecentPublishedDuplicate(client, genreKey, key, {
        cooldownMonths: getCooldownMonths(),
      });
    } catch (e) {
      console.warn(`[Supabase dedup] duplicate check threw: ${e.message}`);
      duplicate = false;
    }

    if (!duplicate) return topic;

    if (attempt === max) {
      console.warn(`[Supabase dedup] exhausted ${max} re-picks for genre=${genreKey}`);
      return null;
    }

    const one = await generateTopics(1, genreKey);
    topic = one[0];
  }

  return null;
}

async function recordPublishedTopic({ genreKey, topic, videoId }) {
  const client = getDedupClient();
  if (!client) return;

  const topicKey = normalizeTopicKey(topic);
  if (!topicKey) return;

  try {
    await insertPublishedTopicRow(client, {
      genreKey,
      topicKey,
      videoId: videoId ?? null,
      rawTopic: topic,
    });
  } catch (e) {
    console.error(`[Supabase dedup] recordPublishedTopic: ${e.message}`);
  }
}

module.exports = {
  isSupabaseDedupConfigured,
  getDedupClient,
  getCooldownMonths,
  getMaxDedupRetries,
  cooldownCutoffIso,
  hasRecentPublishedDuplicate,
  insertPublishedTopicRow,
  resolveTopicForUpload,
  recordPublishedTopic,
};
