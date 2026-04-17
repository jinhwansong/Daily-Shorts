const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// .env에 GOOGLE_AI_API_KEY가 있어야 합니다.
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

const SECTION_LABELS = ['COLD_OPEN', 'SETUP', 'ESCALATION', 'TURN', 'LANDING', 'OUTRO'];

/** 스크립트에서 [SECTION] 블록별로 텍스트를 분리 */
function parseScriptSections(script) {
  const sections = [];
  let currentSection = null;
  let currentLines = [];

  for (const line of script.split('\n')) {
    const match = line.trim().match(/^\[([A-Z_]+)\]$/);
    if (match && SECTION_LABELS.includes(match[1])) {
      if (currentSection) {
        sections.push({ name: currentSection, text: currentLines.join('\n').trim() });
      }
      currentSection = match[1];
      currentLines = [];
    } else if (currentSection) {
      currentLines.push(line);
    }
  }
  if (currentSection && currentLines.length) {
    sections.push({ name: currentSection, text: currentLines.join('\n').trim() });
  }
  return sections;
}

/** 섹션 텍스트 → Nano Banana 2 프롬프트 (Claude 생성) */
async function buildImagePrompt(sectionName, sectionText) {
  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 160,
    messages: [
      {
        role: 'user',
        content: `Create an image generation prompt for a mystery documentary video.
Target Model: Nano Banana 2 (Google's latest image model).

Style: dark, cinematic, noir, moody atmospheric photography style.
Constraints: NO faces, NO readable text, NO real person likenesses, NO gore.
Focus on: location, objects, lighting, mood — things that visually represent the section without depicting people.

Section type: ${sectionName}
Scene context (first 250 chars): ${sectionText.slice(0, 250)}

Write ONE image prompt only (max 80 words). Start directly with the visual description.`,
      },
    ],
  });
  return msg.content[0].text.trim();
}

/**
 * 스크립트의 섹션별로 Nano Banana 2 이미지를 생성하고 outputDir에 저장.
 * @param {string} script — 섹션 헤더([COLD_OPEN] 등)가 포함된 롱폼 스크립트
 * @param {string} outputDir
 * @param {number} imagesPerSection — 섹션당 이미지 수 (기본 2)
 * @returns {string[]} 생성된 이미지 경로 배열
 */
async function generateImagesForScript(script, outputDir, imagesPerSection = 2) {
  const sections = parseScriptSections(script);
  const imagePaths = [];

  for (const section of sections) {
    if (!section.text) continue;

    for (let i = 0; i < imagesPerSection; i++) {
      try {
        const prompt = await buildImagePrompt(section.name, section.text);

        // Nano Banana 2 공식 문서 기준 호출 방식
        // 모델: gemini-3.1-flash-image-preview
        // responseModalities에 "IMAGE" 포함 필수
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-image-preview',
          contents: prompt,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            // 미스터리 콘텐츠(어두운 분위기)를 위해 안전 필터 완화 (폭력/혐오 묘사 없음)
            safetySettings: [
              { category: 'HARM_CATEGORY_VIOLENCE', threshold: 'BLOCK_ONLY_HIGH' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
            ],
            imageConfig: {
              aspectRatio: '16:9',
              imageSize: '1K', // 2K 대비 비용 절반, Ken Burns 영상 위 화질 차이 미미
            },
          },
        });

        // 응답에서 이미지 파트 추출
        let saved = false;
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const imgBuffer = Buffer.from(part.inlineData.data, 'base64');
            const imgPath = path.join(outputDir, `nb2_${section.name.toLowerCase()}_${i}.png`);
            fs.writeFileSync(imgPath, imgBuffer);
            imagePaths.push(imgPath);
            console.log(`  [NanoBanana2] ${section.name} #${i + 1} → ${path.basename(imgPath)}`);
            saved = true;
            break;
          }
        }
        if (!saved) throw new Error('응답에서 이미지 데이터를 찾을 수 없습니다');
      } catch (err) {
        console.warn(`  [NanoBanana2] ${section.name} #${i + 1} failed: ${err.message}`);
      }
    }
  }

  console.log(`  [NanoBanana2] 총 ${imagePaths.length}장 생성 완료`);
  return imagePaths;
}

/** 섹션별 단어 수 기반 타임스탬프 추정 (130 wpm) */
function estimateChapterTimestamps(script) {
  const sections = parseScriptSections(script);
  const WPM = 130;
  let elapsed = 0;
  const chapters = [];

  for (const s of sections) {
    const mm = Math.floor(elapsed / 60);
    const ss = Math.floor(elapsed % 60);
    const label = s.name.replace(/_/g, ' ');
    chapters.push(`${mm}:${String(ss).padStart(2, '0')} ${label}`);
    const words = s.text.split(/\s+/).filter(Boolean).length;
    elapsed += (words / WPM) * 60;
  }

  return chapters;
}

module.exports = { generateImagesForScript, parseScriptSections, estimateChapterTimestamps, buildImagePrompt };
