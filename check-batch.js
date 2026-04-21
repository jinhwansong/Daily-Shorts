const { getBatchStatus } = require('./src/utils/gcsBatchManager'); // 위 파일 경로로 수정

async function checkNow() {
  const batchJobName = "batches/hcqaob22mnlaszoaxd2b98tv7e1t1rqsrohm";
  const state = await getBatchStatus(batchJobName);
  console.log("현재 상태:", state);
}

checkNow().catch(console.error);