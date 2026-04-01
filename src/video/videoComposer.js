const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
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

async function composeVideo(backgroundPath, audioPath, assPath, outputDir) {
  const duration = await getAudioDuration(audioPath);
  const totalDuration = duration + 1.5;
  const outputPath = path.join(outputDir, 'final.mp4');
  const assEscaped = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const filterComplex = [
    `[0:v]loop=-1:size=300,trim=duration=${totalDuration},setpts=PTS-STARTPTS,`,
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},`,
    `eq=brightness=-0.15:saturation=0.7[bg];`,
    `[bg]ass='${assEscaped}',setpts=PTS+1/TB[burned]`,
  ].join('');

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(backgroundPath)
      .inputOptions(['-stream_loop -1'])
      .input(audioPath)
      .inputOptions(['-itsoffset 1.0'])
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
        '-shortest',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run();
  });
}

module.exports = { composeVideo, getAudioDuration };
