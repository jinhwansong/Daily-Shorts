require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { GoogleGenAI } = require('@google/genai');
const { Storage } = require('@google-cloud/storage');
const fs = require('fs');
const path = require('path');

const GCS_BUCKET = process.env.GCS_BUCKET || 'short-mystery-ai';
const STATE_OBJECT = 'pipeline-state/longform_state.json';

function getAI() {
  return new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
}

function getStorage() {
  if (process.env.GOOGLE_CLOUD_SA_JSON) {
    return new Storage({ credentials: JSON.parse(process.env.GOOGLE_CLOUD_SA_JSON) });
  }
  return new Storage(); // 로컬: Application Default Credentials
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
      safetySettings: [
        { category: 'HARM_CATEGORY_VIOLENCE', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
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
  const job = await ai.batches.get({ batchJob: batchJobName });
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
 * GCS 배치 결과에서 이미지 다운로드
 * @returns {string[]} 저장된 이미지 경로 배열
 */
async function downloadBatchImages(gcsDestination, outputDir, expectedCount) {
  const storage = getStorage();
  const prefix = gcsDestination.replace(`gs://${GCS_BUCKET}/`, '');

  const [files] = await storage.bucket(GCS_BUCKET).getFiles({ prefix });
  const jsonlFiles = files
    .filter((f) => f.name.endsWith('.jsonl'))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!jsonlFiles.length) throw new Error(`[GCS] 결과 JSONL 파일 없음: ${gcsDestination}`);

  const imagePaths = [];

  for (const file of jsonlFiles) {
    const [content] = await file.download();
    const lines = content.toString().split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const result = JSON.parse(line);
        const parts = result.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            const buf = Buffer.from(part.inlineData.data, 'base64');
            const imgPath = path.join(outputDir, `batch_img_${imagePaths.length}.png`);
            fs.writeFileSync(imgPath, buf);
            imagePaths.push(imgPath);
            break;
          }
        }
      } catch (e) {
        console.warn(`[GCS] 결과 파싱 실패: ${e.message}`);
      }
    }
  }

  console.log(`[GCS] 이미지 ${imagePaths.length}/${expectedCount}장 다운로드 완료`);
  return imagePaths;
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
  cleanupGCSResults,
  saveState,
  loadState,
  deleteState,
};
