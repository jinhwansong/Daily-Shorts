/**
 * Longform Phase 1 — 스크립트 생성 + Gemini Batch 이미지 제출
 *
 * 흐름:
 *   1. 주제 선정 (topicGenerator)
 *   2. 롱폼 스크립트 생성 (Claude)
 *   3. 섹션별 이미지 프롬프트 생성 (Claude × 12)
 *   4. Gemini Batch API 제출 (50% 할인, 비동기)
 *   5. 메타데이터 생성 (제목/설명/챕터)
 *   6. State → GCS 저장
 *
 * 실행: node src/longformPhase1.js [--genre=mystery-long]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');

const { getGenre } = require('./genres');
const { generateTopics } = require('./script/topicGenerator');
const { generateLongformScript, generateLongformMetadata } = require('./script/scriptGenerator');
const {
  parseScriptSections,
  estimateChapterTimestamps,
} = require('./video/dalleImageGenerator');
const { buildImagePrompt } = require('./video/dalleImageGenerator');
const { submitImageBatch, saveState } = require('./utils/gcsBatchManager');

const IMAGES_PER_SECTION = 2;

async function buildAllImagePrompts(script) {
  const sections = parseScriptSections(script);
  const prompts = [];
  for (const section of sections) {
    if (!section.text) continue;
    for (let i = 0; i < IMAGES_PER_SECTION; i++) {
      const prompt = await buildImagePrompt(section.name, section.text);
      prompts.push(prompt);
      console.log(`  [Prompt] ${section.name} #${i + 1} 생성`);
    }
  }
  return prompts;
}

async function runPhase1(genreKey = 'mystery-long') {
  console.log(`\n=== Longform Phase 1 (${genreKey}) ===`);
  const genre = getGenre(genreKey);
  const jobId = Date.now();
  const outputDir = path.join(__dirname, `../output/${genreKey}_${jobId}`);
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. 주제 선정
  const [topic] = await generateTopics(1, genreKey);
  console.log(`  Topic: ${topic}`);

  // 2. 롱폼 스크립트 생성
  console.log('  스크립트 생성 중...');
  const script = await generateLongformScript(topic, genreKey);
  fs.writeFileSync(path.join(outputDir, 'script.txt'), script);

  // 3. 챕터 타임스탬프 + 메타데이터
  const chapters = estimateChapterTimestamps(script);
  const metadata = await generateLongformMetadata(script, topic, genreKey, chapters);
  fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(`  Title: ${metadata.title}`);

  // 4. 이미지 프롬프트 생성 (섹션별)
  console.log('  이미지 프롬프트 생성 중...');
  const imagePrompts = await buildAllImagePrompts(script);
  console.log(`  총 ${imagePrompts.length}개 프롬프트 완료`);

  // 5. Gemini Batch API 제출
  console.log('  Batch API 제출 중...');
  const { batchJobName, gcsDestination } = await submitImageBatch(imagePrompts, jobId);

  // 6. State를 GCS에 저장
  const state = {
    version: 1,
    batchJobName,
    gcsDestination,
    imageCount: imagePrompts.length,
    imagePrompts,
    submittedAt: new Date().toISOString(),
    video: {
      jobId,
      topic,
      genreKey,
      outputDir: `output/${genreKey}_${jobId}`,
      script,
      metadata,
      chapters,
    },
  };

  await saveState(state);

  console.log(`\n✅ Phase 1 완료 (스크립트·배치 제출·state 저장까지)`);
  console.log(`   배치 Job: ${batchJobName}`);
  console.log(
    `   이미지 ${imagePrompts.length}장은 Gemini Batch가 비동기 생성 → 완료 후에만 ${gcsDestination} 에 JSONL이 생깁니다.`
  );
  console.log(`   지금 당장은 batch-results 폴더가 비어 있어도 정상일 수 있습니다.`);
  console.log(`   Phase 2는 배치가 SUCCEEDED 된 뒤 실행하세요 (보통 1~6시간).`);
  console.log(`   Phase 1을 다시 돌리면 새 job으로 state가 덮어써져 이 배치와 경로가 바뀝니다.`);

  return state;
}

const args = process.argv.slice(2);
const genreArg =
  (args.find((a) => a.startsWith('--genre=')) || '').replace('--genre=', '') || 'mystery-long';

runPhase1(genreArg).catch((e) => {
  console.error('Phase 1 실패:', e.message);
  process.exit(1);
});
