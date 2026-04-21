require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { GoogleGenAI } = require('@google/genai');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GCS_BUCKET = process.env.GCS_BUCKET || 'short-mystery-ai';
const STATE_OBJECT = 'pipeline-state/longform_state.json';

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
}

function getStorage() {
  const keyPath = process.env.GOOGLE_CLOUD_SA_JSON_PATH;
  if (keyPath && String(keyPath).trim()) {
    return new Storage({ keyFilename: path.resolve(keyPath.trim()) });
  }
  const raw = process.env.GOOGLE_CLOUD_SA_JSON;
  if (raw && String(raw).trim()) {
    try {
      return new Storage({ credentials: JSON.parse(raw) });
    } catch (e) {
      throw new Error(
        `GOOGLE_CLOUD_SA_JSON 파싱 실패 (${e.message}). ` +
          '서비스 계정 JSON은 큰따옴표 표준 JSON이어야 합니다. ' +
          '한 줄에 넣기 어렵다면 .env에 GOOGLE_CLOUD_SA_JSON_PATH=절대경로\\key.json 을 쓰세요.'
      );
    }
  }
  return new Storage(); // Application Default Credentials
}

// ── Batch API ──────────────────────────────────────────────────────────────

/**
 * 이미지 프롬프트 배열을 Gemini Batch API에 제출 (50% 할인)
 * @param {string[]} prompts — 이미지 프롬프트 배열
 * @param {string|number} jobId
 * @returns {{ batchJobName: string, gcsDestination: string }}
 */
async function submitImageBatch(prompts, jobId) {
  const ai = getAI();
  const gcsDestination = `gs://${GCS_BUCKET}/batch-results/${jobId}/`;

  const requests = prompts.map((prompt) => ({
    contents: prompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }],
      imageConfig: {
        aspectRatio: '16:9',
        imageSize: '1K',
      },
    },
  }));

  const batchJob = await ai.batches.create({
    model: 'gemini-3.1-flash-image-preview',
    src: requests,
    config: { destination: gcsDestination },
  });

  console.log(`[Batch] 제출 완료: ${batchJob.name}`);
  console.log(`[Batch] 결과 위치: ${gcsDestination}`);
  return { batchJobName: batchJob.name, gcsDestination };
}

/**
 * 배치 작업 상태 확인
 * @returns {string} JobState 문자열
 */
async function getBatchStatus(batchJobName) {
  const ai = getAI();
  const job = await ai.batches.get({ name: batchJobName });
  return job.state;
}

/**
 * 배치 완료까지 폴링 (최대 maxWaitMin분)
 * @returns {boolean} 성공 여부
 */
async function waitForBatch(batchJobName, maxWaitMin = 30) {
  const DONE_STATES = ['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED'];
  const intervalMs = 60_000;
  const maxAttempts = Math.ceil((maxWaitMin * 60_000) / intervalMs);

  for (let i = 0; i < maxAttempts; i++) {
    const state = await getBatchStatus(batchJobName);
    console.log(`[Batch] 상태: ${state} (${i + 1}/${maxAttempts})`);
    if (state === 'JOB_STATE_SUCCEEDED') return true;
    if (DONE_STATES.includes(state)) {
      console.error(`[Batch] 실패 상태: ${state}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error(`[Batch] ${maxWaitMin}분 내 완료되지 않음`);
  return false;
}

/**
 * JSONL 텍스트 파싱 — **위치(position)** 기반.
 * 성공: imageSlots[pos] = path, 실패: imageSlots[pos] = null + failedIndices에 추가.
 * @param {string} jsonlText
 * @param {(string|null)[]} imageSlots — 전체 크기의 배열 (null로 초기화)
 * @param {number[]} failedIndices — 실패 위치 누적
 * @param {string} outputDir
 * @param {number} offset — JSONL이 여러 파일일 때 시작 위치
 * @returns {number} 파싱된 줄 수
 */
function parseJsonlIntoSlots(jsonlText, imageSlots, failedIndices, outputDir, offset = 0) {
  const lines = String(jsonlText).split('\n').filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const pos = offset + i;
    try {
      const result = JSON.parse(lines[i]);
      const parts = result.candidates?.[0]?.content?.parts || [];
      let saved = false;
      for (const part of parts) {
        if (part.inlineData) {
          const buf = Buffer.from(part.inlineData.data, 'base64');
          const imgPath = path.join(outputDir, `batch_img_${pos}.png`);
          fs.writeFileSync(imgPath, buf);
          imageSlots[pos] = imgPath;
          saved = true;
          break;
        }
      }
      if (!saved) failedIndices.push(pos);
    } catch (e) {
      console.warn(`[GCS] 위치 ${pos} 파싱 실패: ${e.message}`);
      failedIndices.push(pos);
    }
  }
  return lines.length;
}

/** inlinedResponses 한 행에서 이미지를 못 꺼낸 이유 (진단 로그용) */
function describeBatchInlineRowSkip(row) {
  if (row == null) return 'row=null';
  if (row.error !== undefined && row.error !== null) {
    const e = row.error;
    const s = typeof e === 'string' ? e : e?.message || JSON.stringify(e);
    return `row.error: ${String(s).slice(0, 280)}`;
  }
  const res = row.response != null ? row.response : row;
  if (!res || typeof res !== 'object') return `response 없음 (${typeof row.response})`;
  if (res.error !== undefined && res.error !== null) {
    const e = res.error;
    const s = typeof e === 'string' ? e : e?.message || JSON.stringify(e);
    return `response.error: ${String(s).slice(0, 280)}`;
  }
  const pf = res.promptFeedback;
  if (pf?.blockReason) return `promptFeedback.blockReason: ${pf.blockReason}`;
  const cands = res.candidates;
  if (!Array.isArray(cands) || !cands.length) return 'candidates 없음';
  const c0 = cands[0];
  if (c0?.finishReason && c0.finishReason !== 'STOP') return `finishReason: ${c0.finishReason}`;
  const parts = c0?.content?.parts || [];
  if (!parts.length) return 'content.parts 비어 있음';
  const hasInline = parts.some((p) => p.inlineData);
  if (!hasInline) {
    const hasText = parts.some((p) => p.text);
    return hasText ? 'inlineData 없음(텍스트만)' : 'inlineData 없음';
  }
  return '알 수 없음(파서 불일치 가능)';
}

/**
 * Developer API 배치 결과 다운로드 — 위치 기반.
 * @returns {{ imageSlots: (string|null)[], failedIndices: number[] }}
 */
async function downloadBatchImagesFromBatchJobDest(ai, batchJobName, outputDir, expectedCount) {
  const job = await ai.batches.get({ name: batchJobName });
  if (job.state !== 'JOB_STATE_SUCCEEDED') throw new Error(`배치 상태 ${job.state}`);

  const imageSlots = new Array(expectedCount).fill(null);
  const failedIndices = [];
  const dest = job.dest || {};
  const fileName = dest.fileName || dest.file_name;

  if (fileName) {
    const tmp = path.join(os.tmpdir(), `gemini-batch-${Date.now()}.jsonl`);
    await ai.files.download({ file: fileName, downloadPath: tmp });
    try {
      const lineCount = parseJsonlIntoSlots(fs.readFileSync(tmp, 'utf-8'), imageSlots, failedIndices, outputDir, 0);
      const saved = imageSlots.filter(Boolean).length;
      console.log(`[Batch] File API JSONL: ${lineCount}줄 → 이미지 ${saved}/${expectedCount}장, 실패 ${failedIndices.length}개`);
      if (!saved) throw new Error('JSONL에 inlineData 이미지 없음');
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
    return { imageSlots, failedIndices };
  }

  const inlined = dest.inlinedResponses || dest.inlined_responses;
  if (inlined?.length) {
    console.log(`[Batch] inlinedResponses ${inlined.length}행 (기대 ${expectedCount}개)`);
    for (let i = 0; i < inlined.length; i++) {
      const row = inlined[i];
      const res = row.response != null ? row.response : row;
      const parts = res?.candidates?.[0]?.content?.parts || [];
      let saved = false;
      for (const part of parts) {
        if (part.inlineData) {
          const buf = Buffer.from(part.inlineData.data, 'base64');
          const imgPath = path.join(outputDir, `batch_img_${i}.png`);
          fs.writeFileSync(imgPath, buf);
          imageSlots[i] = imgPath;
          saved = true;
          break;
        }
      }
      if (!saved) {
        const why = describeBatchInlineRowSkip(row);
        console.warn(`[Batch]  #${i + 1}/${inlined.length} 실패: ${why}`);
        failedIndices.push(i);
      }
    }
    const ok = imageSlots.filter(Boolean).length;
    console.log(`[Batch] inline → 이미지 ${ok}/${expectedCount}장, 실패 ${failedIndices.length}개`);
    if (!ok) throw new Error('inlinedResponses에 inlineData 없음');
    return { imageSlots, failedIndices };
  }

  throw new Error('dest에 fileName·inlinedResponses 없음');
}

/**
 * GCS 배치 결과에서 이미지 다운로드.
 * @returns {{ imageSlots: (string|null)[], failedIndices: number[] }}
 */
async function downloadBatchImages(gcsDestination, outputDir, expectedCount, batchJobName = null) {
  const storage = getStorage();
  const prefix = gcsDestination.replace(`gs://${GCS_BUCKET}/`, '');
  const [files] = await storage.bucket(GCS_BUCKET).getFiles({ prefix });
  const jsonlFiles = files.filter((f) => f.name.endsWith('.jsonl')).sort((a, b) => a.name.localeCompare(b.name));

  if (!jsonlFiles.length) {
    const hint =
      files.length === 0
        ? ' 이 prefix에 객체가 없습니다. Gemini Developer API는 결과를 GCS가 아니라 File API(files/…)에 둘 수 있어, batchJobName이 있으면 그쪽에서 받습니다.'
        : ` (다른 파일 ${files.length}개: ${files.slice(0, 8).map((f) => f.name).join(', ')}${files.length > 8 ? '…' : ''})`;
    if (batchJobName) {
      console.warn(`[GCS] JSONL 없음${hint} → File API 폴백 시도`);
      try {
        return await downloadBatchImagesFromBatchJobDest(getAI(), batchJobName, outputDir, expectedCount);
      } catch (e) {
        throw new Error(`[GCS] 결과 없음: ${gcsDestination}. File API 폴백 실패: ${e.message}`);
      }
    }
    throw new Error(`[GCS] 결과 JSONL 파일 없음: ${gcsDestination}${hint}`);
  }

  const imageSlots = new Array(expectedCount).fill(null);
  const failedIndices = [];
  let offset = 0;
  for (const file of jsonlFiles) {
    const [content] = await file.download();
    const parsed = parseJsonlIntoSlots(content.toString(), imageSlots, failedIndices, outputDir, offset);
    offset += parsed;
  }
  const ok = imageSlots.filter(Boolean).length;
  console.log(`[GCS] 이미지 ${ok}/${expectedCount}장 다운로드 완료, 실패 ${failedIndices.length}개`);
  return { imageSlots, failedIndices };
}

/**
 * 배치 실패 이미지를 direct API로 재시도 (최대 3회, 병렬 최대 3개).
 * @param {number[]} failedIndices
 * @param {string[]} imagePrompts — Phase1 state의 전체 프롬프트 배열
 * @param {(string|null)[]} imageSlots — in-place 수정
 * @param {string} outputDir
 */
async function retryFailedImages(failedIndices, imagePrompts, imageSlots, outputDir) {
  if (!failedIndices.length) return;
  const ai = getAI();
  const MAX_RETRIES = 3;
  const CONCURRENCY = 3;

  console.log(`[Retry] 실패 ${failedIndices.length}개 direct API 재시도 (최대 ${MAX_RETRIES}회, 동시 ${CONCURRENCY}개)...`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const retryOne = async (idx) => {
    const prompt = imagePrompts[idx];
    if (!prompt) { console.warn(`[Retry] #${idx}: 프롬프트 없음`); return; }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 1) await sleep(1000 * Math.pow(2, attempt - 1)); // 2s, 4s
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-image-preview',
          contents: prompt,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }],
            imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
          },
        });
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            const buf = Buffer.from(part.inlineData.data, 'base64');
            const imgPath = path.join(outputDir, `batch_img_${idx}.png`);
            fs.writeFileSync(imgPath, buf);
            imageSlots[idx] = imgPath;
            console.log(`[Retry] #${idx} 시도 ${attempt} 성공`);
            return;
          }
        }
        console.warn(`[Retry] #${idx} 시도 ${attempt}: 이미지 없음 (텍스트만)`);
      } catch (e) {
        console.warn(`[Retry] #${idx} 시도 ${attempt} 오류: ${e.message}`);
      }
    }
    console.warn(`[Retry] #${idx} 최종 실패 (${MAX_RETRIES}회 모두 실패)`);
  };

  // 슬라이딩 윈도우 병렬 실행
  for (let start = 0; start < failedIndices.length; start += CONCURRENCY) {
    await Promise.all(failedIndices.slice(start, start + CONCURRENCY).map((idx) => retryOne(idx)));
  }

  const recovered = failedIndices.filter((i) => imageSlots[i] != null).length;
  console.log(`[Retry] 완료: ${recovered}/${failedIndices.length}개 복구`);
}

/** GCS 배치 결과 정리 */
async function cleanupGCSResults(gcsDestination) {
  try {
    const storage = getStorage();
    const prefix = gcsDestination.replace(`gs://${GCS_BUCKET}/`, '');
    const [files] = await storage.bucket(GCS_BUCKET).getFiles({ prefix });
    await Promise.all(files.map((f) => f.delete()));
    console.log(`[GCS] 배치 결과 정리 완료: ${gcsDestination}`);
  } catch (e) {
    console.warn(`[GCS] 정리 실패 (무시): ${e.message}`);
  }
}

// ── State (GCS) ────────────────────────────────────────────────────────────

/** Phase 1 state를 GCS에 저장 */
async function saveState(state) {
  const storage = getStorage();
  await storage.bucket(GCS_BUCKET).file(STATE_OBJECT).save(JSON.stringify(state, null, 2), {
    contentType: 'application/json',
  });
  console.log(`[GCS] State 저장: gs://${GCS_BUCKET}/${STATE_OBJECT}`);
}

/** GCS에서 state 읽기 */
async function loadState() {
  const storage = getStorage();
  const file = storage.bucket(GCS_BUCKET).file(STATE_OBJECT);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [content] = await file.download();
  return JSON.parse(content.toString());
}

/** Phase 2 완료 후 state 삭제 */
async function deleteState() {
  try {
    const storage = getStorage();
    await storage.bucket(GCS_BUCKET).file(STATE_OBJECT).delete();
    console.log(`[GCS] State 삭제 완료`);
  } catch (e) {
    console.warn(`[GCS] State 삭제 실패 (무시): ${e.message}`);
  }
}

module.exports = {
  submitImageBatch,
  getBatchStatus,
  waitForBatch,
  downloadBatchImages,
  retryFailedImages,
  cleanupGCSResults,
  saveState,
  loadState,
  deleteState,
};
