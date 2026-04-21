const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TTS_VOICE = 'onyx';
const TTS_MODEL = 'tts-1';

/** OpenAI TTS: input 최대 4096자 — 롱폼은 청크 분할 */
const TTS_MAX_CHARS = 4096;
const TTS_SAFE_CHUNK = 4000;

/**
 * 문장/줄바꿈 우선으로 잘라 TTS 청크 배열 생성
 * @returns {string[]}
 */
function splitTextForTts(text) {
  const s = String(text || '').trim();
  if (!s.length) return [];
  if (s.length <= TTS_SAFE_CHUNK) return [s];

  const chunks = [];
  let rest = s;
  while (rest.length > TTS_SAFE_CHUNK) {
    const window = rest.slice(0, TTS_SAFE_CHUNK);
    let cut = TTS_SAFE_CHUNK;
    const br = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' ')
    );
    if (br > TTS_SAFE_CHUNK * 0.2) cut = br + 1;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

/** 동일 TTS 설정으로 만든 MP3는 순차 이어붙이기로 재생 가능한 경우가 많음 (ffmpeg 불필요) */
function concatMp3Files(partPaths, outputPath) {
  if (partPaths.length === 0) throw new Error('concatMp3Files: no parts');
  if (partPaths.length === 1) {
    fs.copyFileSync(partPaths[0], outputPath);
    try {
      fs.unlinkSync(partPaths[0]);
    } catch (_) {}
    return;
  }
  const bufs = partPaths.map((p) => fs.readFileSync(p));
  fs.writeFileSync(outputPath, Buffer.concat(bufs));
  for (const p of partPaths) {
    try {
      fs.unlinkSync(p);
    } catch (_) {}
  }
}

async function generateTTS(script, outputDir) {
  const chunks = splitTextForTts(script);
  if (!chunks.length) {
    throw new Error('TTS: 스크립트가 비어 있습니다.');
  }

  const outputPath = path.join(outputDir, 'audio.mp3');

  if (chunks.length === 1) {
    const response = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: chunks[0],
      speed: 0.92,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }

  console.log(`  [TTS] ${chunks.length}개 청크 (스크립트 ${script.length}자, API 한도 ${TTS_MAX_CHARS}자)`);
  const partPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    const partPath = path.join(outputDir, `_tts_part_${i}.mp3`);
    const response = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: chunks[i],
      speed: 0.92,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(partPath, buffer);
    partPaths.push(partPath);
  }
  concatMp3Files(partPaths, outputPath);
  return outputPath;
}

module.exports = { generateTTS, splitTextForTts, TTS_MAX_CHARS };
