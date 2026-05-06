/**
 * 미스터리 토픽 A/B 티어: A = 인지도·검색 친화, B = 딥컷(여전히 출처 규율 준수).
 * TOPIC_TIER_A_WEIGHT: 0~1, 기본 0.65
 */

function getWeightA(options = {}) {
  if (options.weightA !== undefined) {
    const w = Number(options.weightA);
    return Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.65;
  }
  const env = parseFloat(process.env.TOPIC_TIER_A_WEIGHT || '0.65', 10);
  return Number.isFinite(env) ? Math.min(1, Math.max(0, env)) : 0.65;
}

/**
 * @param {number} count
 * @param {{ rng?: () => number, weightA?: number }} [options] rng for tests
 * @returns {{ tier: 'A' | 'B' }[]}
 */
function buildTierPlan(count, options = {}) {
  const n = Math.max(0, parseInt(count, 10) || 0);
  const wA = getWeightA(options);
  const rng = typeof options.rng === 'function' ? options.rng : Math.random;
  const plan = [];
  for (let i = 0; i < n; i += 1) {
    plan.push({ tier: rng() < wA ? 'A' : 'B' });
  }
  return plan;
}

function formatTierBatchBlock(plan, genreKey) {
  if (genreKey !== 'mystery' || !plan || plan.length === 0) return '';

  const lines = plan.map((p, i) => {
    const n = i + 1;
    if (p.tier === 'A') {
      return `Line ${n} — TIER A (high recognition): Pick a case widely covered in US true-crime Shorts, major English news, or big podcasts—searchable names or incident labels viewers might type in YouTube. Still unresolved per SOURCE DISCIPLINE.`;
    }
    return `Line ${n} — TIER B (deep cut): Pick a documented unresolved case that is real but less mainstream for average US Shorts viewers—still must have Wikipedia or major news grounding; do not invent detail to sound edgy.`;
  });

  return `

TIER ASSIGNMENT (exactly one topic per line; follow the tier for that line number):
${lines.join('\n')}
`;
}

module.exports = { buildTierPlan, formatTierBatchBlock };
