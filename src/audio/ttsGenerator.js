/**
 * TTS 생성 — OpenAI TTS-1 (onyx) 기본 사용.
 * TTS_PROVIDER=edge 로 설정하면 edge-tts(무료)로 전환 가능.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── OpenAI TTS 설정 ────────────────────────────────────────────────
const TTS_VOICE = process.env.TTS_OPENAI_VOICE || 'onyx';
const TTS_MODEL = 'tts-1';

// ── edge-tts 설정 (TTS_PROVIDER=edge 시) ──────────────────────────
const EDGE_VOICE = process.env.TTS_EDGE_VOICE || 'en-US-GuyNeural';
const EDGE_RATE = process.env.TTS_EDGE_RATE || '-8%';
const EDGE_VOLUME = process.env.TTS_EDGE_VOLUME || '+0%';

const TTS_MAX_CHARS = 4096;
const TTS_SAFE_CHUNK = 4000;

/**
 * edge-tts 사용 여부: TTS_PROVIDER=edge 이고 바이너리 존재할 때만
 */
function isEdgeTtsAvailable() {
  if (process.env.TTS_PROVIDER !== 'edge') return false;
  const r = spawnSync('edge-tts', ['--version'], { encoding: 'utf-8' });
  return r.status === 0;
}

/**
 * edge-tts로 단일 청크 생성
 * @param {string} text
 * @param {string} outputPath
 */
function edgeTtsChunk(text, outputPath) {
  const tmpText = path.join(os.tmpdir(), `edge-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpText, text, 'utf-8');
  try {
    const r = spawnSync(
      'edge-tts',
      [
        '--voice', EDGE_VOICE,
        '--rate', EDGE_RATE,
        '--volume', EDGE_VOLUME,
        '--file', tmpText,
        '--write-media', outputPath,
      ],
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
    );
    if (r.status !== 0) {
      throw new Error(`edge-tts 실패: ${(r.stderr || r.stdout || '').slice(0, 400)}`);
    }
  } finally {
    try { fs.unlinkSync(tmpText); } catch (_) {}
  }
}

// ── 청크 분할 (긴 스크립트용) ────────────────────────────────────────
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

function concatMp3Files(partPaths, outputPath) {
  if (partPaths.length === 0) throw new Error('concatMp3Files: no parts');
  if (partPaths.length === 1) {
    fs.copyFileSync(partPaths[0], outputPath);
    try { fs.unlinkSync(partPaths[0]); } catch (_) {}
    return;
  }
  const bufs = partPaths.map((p) => fs.readFileSync(p));
  fs.writeFileSync(outputPath, Buffer.concat(bufs));
  for (const p of partPaths) {
    try { fs.unlinkSync(p); } catch (_) {}
  }
}

// ── OpenAI TTS (폴백) ─────────────────────────────────────────────
async function openaiTtsChunk(client, text, outputPath) {
  const response = await client.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    speed: 0.92,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function generateTTS(script, outputDir) {
  const chunks = splitTextForTts(script);
  if (!chunks.length) throw new Error('TTS: 스크립트가 비어 있습니다.');

  const outputPath = path.join(outputDir, 'audio.mp3');
  const useEdge = isEdgeTtsAvailable();
  const provider = useEdge ? 'edge-tts' : 'OpenAI TTS-1';

  if (chunks.length > 1) {
    console.log(`  [TTS:${provider}] ${chunks.length}개 청크 (스크립트 ${script.length}자)`);
  } else {
    console.log(`  [TTS:${provider}]`);
  }

  if (useEdge) {
    if (chunks.length === 1) {
      edgeTtsChunk(chunks[0], outputPath);
    } else {
      // 병렬 생성 후 순서대로 concat
      const partPaths = chunks.map((_, i) => path.join(outputDir, `_tts_part_${i}.mp3`));
      await Promise.all(chunks.map((chunk, i) => Promise.resolve(edgeTtsChunk(chunk, partPaths[i]))));
      concatMp3Files(partPaths, outputPath);
    }
    return outputPath;
  }

  // OpenAI 폴백
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (chunks.length === 1) {
    await openaiTtsChunk(client, chunks[0], outputPath);
  } else {
    // 청크 병렬 요청 (OpenAI TTS rate-limit은 넉넉함)
    const partPaths = chunks.map((_, i) => path.join(outputDir, `_tts_part_${i}.mp3`));
    await Promise.all(chunks.map((chunk, i) => openaiTtsChunk(client, chunk, partPaths[i])));
    concatMp3Files(partPaths, outputPath);
  }
  return outputPath;
}

module.exports = { generateTTS, splitTextForTts, TTS_MAX_CHARS };
