/**
 * "자극적 소재" (이 파이프라인에서의 의미)
 * ─────────────────────────────────────────
 * - 문서화된 실제 사건 안에서 스크롤을 멈추게 하는 훅·긴장·역설을 강하게 잡는 것.
 * - 유튜브/일반 윤리상 피해야 할 것은 자동화로 유도하지 않음:
 *   허위 사실, 피해자 조롱·노골적 고어·성폭력을 관음으로 소비하게 하는 묘사,
 *   해결된 사건을 미해결인 것처럼 속이기 등.
 *
 * CONTENT_HOOK_LEVEL=strong 일 때만 아래 addon 문구가 Claude 요청에 붙습니다.
 */

function normalizeLevel() {
  const raw = (process.env.CONTENT_HOOK_LEVEL || 'normal').trim().toLowerCase();
  if (raw === 'strong' || raw === 'high' || raw === 'aggressive') return 'strong';
  return 'normal';
}

function isStrongHook() {
  return normalizeLevel() === 'strong';
}

/** 주제(topic) 생성 user 메시지 끝에 붙임 */
function topicPromptAddon() {
  if (!isStrongHook()) return '';
  return `

HOOK INTENSITY — STRONG (still factual & platform-safe):
- Pick angles where documented public facts naturally support a sharp "wait—what?" or uneasy curiosity (timeline oddity, eerie last detail, evidence that never fit, famous paradox).
- The one-line topic should feel punchy and tension-forward; still one real case per line, no invented victims or dates.
- Do not optimize for shock at the cost of truth: no claiming solved cases are open, no fake quotes, no sensational lies.
- Avoid graphic step-by-step violence or sexual crime as spectacle; imply gravity without lurid play-by-play.
- Do not mock victims or survivors; keep a cold-documentary Shorts tone, not cruelty for engagement.`;
}

/** 스크립트 생성 user 메시지에 붙임 */
function scriptUserMessageAddon() {
  if (!isStrongHook()) return '';
  return `

(Intensity: STRONG — Open with the hardest fact-based hook the case allows within the word limit. Stack unsettling documented details fast. No filler empathy lines. Still: no fake facts, no gore porn, no victim mockery.)`;
}

/** 메타데이터(제목·썸네일 라인) user 메시지에 붙임 */
function metadataPromptAddon() {
  if (!isStrongHook()) return '';
  return `

Packaging intensity — STRONG:
- TITLE and THUMBNAIL_LINE may use a sharper curiosity gap and colder fragments typical of top US mystery Shorts—still must not assert anything the script does not support.
- Do not drop the main searchable proper name from the TITLE just to sound edgier—keep early name/keyword + sharp fragment within the char limit.
- THUMBNAIL_LINE: favor an unfinished or jarring phrase over a polite summary; stay under char limits.
- No slurs; no misleading "police confirmed" unless the script says so.`;
}

module.exports = {
  normalizeLevel,
  isStrongHook,
  topicPromptAddon,
  scriptUserMessageAddon,
  metadataPromptAddon,
};
