const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TTS_VOICE = 'onyx';
const TTS_MODEL = 'tts-1';

async function generateTTS(script, outputDir) {
  const outputPath = path.join(outputDir, 'audio.mp3');
  const response = await client.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: script,
    speed: 0.92,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

module.exports = { generateTTS };
