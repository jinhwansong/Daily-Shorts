const { GoogleGenAI } = require('@google/genai');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK_CLIP_DURATION = 1.5;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;

async function generateHookImage(topic, thumbnailQuery) {
  const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

  const subject = thumbnailQuery || topic;
  const prompt =
    `Cinematic dark mystery scene: ${subject}. ` +
    `Dramatic lighting, dark atmosphere, high contrast, photorealistic, ` +
    `cinematic composition, eerie mood, no text, no watermark. ` +
    `Style: dark true crime documentary still frame.`;

  const response = await genai.models.generateContent({
    model: 'gemini-2.5-flash-preview-04-17',
    contents: prompt,
    config: {
      responseModalities: ['IMAGE'],
    },
  });

  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart) throw new Error('Nano Banana: 이미지 생성 실패 (inlineData 없음)');

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}

/**
 * Nano Banana 훅 이미지를 생성하고 1.5초짜리 세로(9:16) 클립으로 변환.
 * 실패 시 null 반환 (파이프라인 중단 없음).
 *
 * @param {string} outputDir
 * @param {string} topic
 * @param {string|null} thumbnailQuery
 * @returns {Promise<string|null>} hook_clip.mp4 경로 또는 null
 */
async function createHookClip(outputDir, topic, thumbnailQuery) {
  try {
    const { base64, mimeType } = await generateHookImage(topic, thumbnailQuery);

    const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
    const imagePath = path.join(outputDir, `hook_image.${ext}`);
    const clipPath = path.join(outputDir, 'hook_clip.mp4');

    fs.writeFileSync(imagePath, Buffer.from(base64, 'base64'));

    execFileSync('ffmpeg', [
      '-hide_banner',
      '-y',
      '-loop',
      '1',
      '-i',
      imagePath,
      '-t',
      String(HOOK_CLIP_DURATION),
      '-vf',
      `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1`,
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      clipPath,
    ]);

    console.log('[Hook] Nano Banana 훅 이미지 클립 생성 완료');
    return clipPath;
  } catch (err) {
    console.warn('[Hook] Nano Banana 이미지 생성 실패 — 스킵', err.message);
    return null;
  }
}

module.exports = { createHookClip, HOOK_CLIP_DURATION };
