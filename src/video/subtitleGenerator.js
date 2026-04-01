const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateSubtitles(audioPath, outputDir) {
  const audioStream = fs.createReadStream(audioPath);
  const transcription = await client.audio.transcriptions.create({
    file: audioStream,
    model: 'whisper-1',
    response_format: 'srt',
  });
  const srtPath = path.join(outputDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, transcription);
  return srtPath;
}

function srtToAss(srtPath, outputDir) {
  const srt = fs.readFileSync(srtPath, 'utf-8');
  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,60,60,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const blocks = srt.trim().split(/\n\n+/);
  const events = blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.length < 3) return null;
      const timeLine = lines[1];
      const text = lines.slice(2).join(' ').replace(/\n/g, ' ');
      const [start, end] = timeLine.split(' --> ').map(srtTimeToAss);
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    })
    .filter(Boolean);

  const assPath = path.join(outputDir, 'subtitles.ass');
  fs.writeFileSync(assPath, assHeader + events.join('\n'));
  return assPath;
}

function srtTimeToAss(srtTime) {
  return srtTime
    .replace(',', '.')
    .replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/, (_, h, m, s, ms) => {
      return `${parseInt(h, 10)}:${m}:${s}.${ms.slice(0, 2)}`;
    });
}

module.exports = { generateSubtitles, srtToAss };
