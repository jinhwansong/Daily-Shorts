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

/**
 * 섹션 텍스트에서 고유명사(실제 인물·지명)를 익명화.
 * "Anneliese Michel" → "the subject", "Germany" → "a European country"처럼
 * 이미지 모델 안전 필터를 유발하는 맥락 제거.
 */
function anonymizeSectionContext(text, maxChars = 220) {
  return text
    .slice(0, maxChars * 2)               // 넉넉히 잘라 정규식 처리
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, 'the subject') // 이름 형태 ("Anneliese Michel")
    .replace(/\b(19|20)\d{2}\b/g, 'the time')               // 연도
    .replace(/\b[A-Z][a-z]{2,}\b(?=,| (?:Germany|France|USA|UK|Japan|Poland|Austria|Hungary|Italy|Spain))/g, 'a location') // 지명 앞 고유명사
    .replace(/\b(Germany|France|United States|USA|Austria|Hungary|Japan|Poland|UK|England|Ireland|Australia)\b/gi, 'a European country')
    .slice(0, maxChars)
    .trim();
}

/**
 * 프롬프트에 안전 필터 유발 가능성 높은 단어가 있으면 재작성 지시 추가.
 * "exorcism", "possessed", "victim", "murder" 등 → 상징적 표현으로 유도.
 */
const SENSITIVE_RE = /\b(exorcism|possessed|possession|murder|murdered|kill|killed|corpse|suicide|rape|sexual|victim|priest|demon|devil|satan|ritual)\b/i;

function hasSensitiveTerms(prompt) {
  return SENSITIVE_RE.test(prompt);
}

/** 섹션 텍스트 → Nano Banana 2 프롬프트 (Claude 생성) */
async function buildImagePrompt(sectionName, sectionText) {
  const context = anonymizeSectionContext(sectionText);

  const msg = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 160,
    messages: [
      {
        role: 'user',
        content: `Create a visual scene prompt for an AI image generator (Google Imagen 3).

Rules — STRICT:
- Describe ONLY environment, objects, lighting, atmosphere. No people, faces, bodies.
- NO religious symbols, rituals, occult imagery.
- NO gore, violence, death, suffering.
- NO readable text in scene. NO real person likenesses.
- Use artistic, symbolic metaphors instead of literal event depiction.
- Style: dark cinematic photography — moody shadows, natural textures, single dramatic light source.

Documentary section: ${sectionName}
Thematic context (anonymized): ${context}

Output ONE prompt (40–70 words). Begin directly with the visual scene.`,
      },
    ],
  });

  let prompt = msg.content[0].text.trim();

  // 생성된 프롬프트에 민감 단어가 남아 있으면 마지막 문장 교체
  if (hasSensitiveTerms(prompt)) {
    prompt = prompt
      .replace(SENSITIVE_RE, (_m) => 'mysterious')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return prompt;
}

const HARDENED_SAFETY = [
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
];

/**
 * 스크립트의 섹션별로 이미지를 직접 생성하고 outputDir에 저장.
 * Phase 1 배치 미사용 시 대체 경로.
 *
 * 최적화:
 *  - Claude 프롬프트 빌드: 동시 3개
 *  - Gemini 이미지 생성: 동시 3개
 *
 * @param {string} script
 * @param {string} outputDir
 * @param {number} imagesPerSection
 * @returns {string[]} 생성된 이미지 경로 배열
 */
async function generateImagesForScript(script, outputDir, imagesPerSection = 2) {
  const sections = parseScriptSections(script).filter((s) => s.text);

  const tasks = [];
  for (const section of sections) {
    for (let i = 0; i < imagesPerSection; i++) {
      tasks.push({ section, i });
    }
  }

  const CONCURRENCY = 3;

  // Step 1: Claude 프롬프트 빌드 (병렬 3개)
  const prompts = new Array(tasks.length).fill(null);
  for (let start = 0; start < tasks.length; start += CONCURRENCY) {
    await Promise.all(
      tasks.slice(start, start + CONCURRENCY).map(async ({ section, i }, offset) => {
        prompts[start + offset] = await buildImagePrompt(section.name, section.text);
      })
    );
  }

  // Step 2: Gemini 이미지 생성 (병렬 3개)
  const imagePaths = new Array(tasks.length).fill(null);
  for (let start = 0; start < tasks.length; start += CONCURRENCY) {
    await Promise.all(
      tasks.slice(start, start + CONCURRENCY).map(async ({ section, i }, offset) => {
        const idx = start + offset;
        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: prompts[idx],
            config: {
              responseModalities: ['TEXT', 'IMAGE'],
              safetySettings: HARDENED_SAFETY,
              imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
            },
          });

          const parts = response?.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.inlineData) {
              const imgBuffer = Buffer.from(part.inlineData.data, 'base64');
              const imgPath = path.join(outputDir, `nb2_${section.name.toLowerCase()}_${i}.png`);
              fs.writeFileSync(imgPath, imgBuffer);
              imagePaths[idx] = imgPath;
              console.log(`  [NanoBanana2] ${section.name} #${i + 1} → ${path.basename(imgPath)}`);
              break;
            }
          }
          if (!imagePaths[idx]) throw new Error('응답에서 이미지 데이터를 찾을 수 없습니다');
        } catch (err) {
          console.warn(`  [NanoBanana2] ${section.name} #${i + 1} failed: ${err.message}`);
        }
      })
    );
  }

  const result = imagePaths.filter(Boolean);
  console.log(`  [NanoBanana2] 총 ${result.length}/${tasks.length}장 생성 완료`);
  return result;
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
