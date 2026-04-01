const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;

function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

/** filter_complex에 넣을 경로 (Linux/Windows 공통) */
function escapeSubtitlesPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  // 콜론·작은따옴표 이스케이프 (ffmpeg subtitles 필터)
  return normalized.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function composeVideo(backgroundPath, audioPath, assPath, outputDir) {
  const duration = await getAudioDuration(audioPath);
  const totalDuration = duration + 1.5;
  const outputPath = path.join(outputDir, 'final.mp4');

  // 긴 경로·하이픈 등으로 ass 필터가 깨지는 경우 방지 → 짧은 임시 파일
  const tmpAss = path.join(os.tmpdir(), `shorts-burn-${Date.now()}.ass`);
  fs.copyFileSync(assPath, tmpAss);
  const subPath = escapeSubtitlesPath(tmpAss);

  // subtitles= 가 ass보다 경로 처리에 안정적 (libass)
  // 비디오 setpts=PTS+1/TB 는 일부 ffmpeg에서 문법 오류 → 제거 (오디오는 -itsoffset으로 정렬)
  const filterComplex = [
    `[0:v]loop=-1:size=300,trim=duration=${totalDuration},setpts=PTS-STARTPTS,`,
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},`,
    `eq=brightness=-0.15:saturation=0.7[bg];`,
    `[bg]subtitles='${subPath}'[burned]`,
  ].join('');

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(backgroundPath)
      .inputOptions(['-stream_loop', '-1'])
      .input(audioPath)
      .inputOptions(['-itsoffset', '1.0'])
      .complexFilter(filterComplex, 'burned')
      .outputOptions([
        `-t ${totalDuration}`,
        '-map [burned]',
        '-map 1:a',
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-c:a aac',
        '-b:a 128k',
        '-movflags +faststart',
        '-y',
      ])
      .output(outputPath)
      .on('end', () => {
        try {
          fs.unlinkSync(tmpAss);
        } catch (_) {
          /* ignore */
        }
        resolve(outputPath);
      })
      .on('error', (err) => {
        try {
          fs.unlinkSync(tmpAss);
        } catch (_) {
          /* ignore */
        }
        reject(err);
      })
      .run();
  });
}

module.exports = { composeVideo, getAudioDuration };
