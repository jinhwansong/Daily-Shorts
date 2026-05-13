/**
 * Supabase topic_key 비교용 정규화 (단일 규칙).
 */
function normalizeTopicKey(topic) {
  if (topic == null) return '';
  let s = String(topic).normalize('NFC').trim().toLowerCase();
  s = s.replace(/\s+/g, ' ');
  return s;
}

module.exports = { normalizeTopicKey };
