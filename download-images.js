const { downloadBatchImages, loadState } = require('./src/utils/gcsBatchManager');
const path = require('path');
const fs = require('fs');

async function downloadImages() {
  try {
    // 1. state 읽기
    const state = await loadState();
    if (!state) {
      console.error("❌ state.json 없음 (Phase 1 실행 안 됨)");
      return;
    }

    console.log("배치 이름:", state.batchJobName);
    console.log("GCS 경로:", state.gcsDestination);

    // 2. 출력 디렉토리 생성
    const outputDir = path.join(__dirname, 'output', `mystery-long_${state.video.jobId}`);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 3. 이미지 다운로드
    const imagePaths = await downloadBatchImages(
      state.gcsDestination,
      outputDir,
      state.imageCount,
      state.batchJobName
    );

    console.log(`\n✓ 이미지 ${imagePaths.length}장 다운로드 완료`);
    console.log("저장 위치:", outputDir);
    
  } catch (error) {
    console.error("❌ 다운로드 실패:", error.message);
  }
}

downloadImages();