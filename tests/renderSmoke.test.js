const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const exec = promisify(execFile);
const { MediaService, fileHash } = require("../dist/vault/media.service");
const { documentHash } = require("../dist/vault/policy");

// Test-only portable binaries can be installed under ignored output/media-test-tools.
let binaries;
try {
  binaries = require("../output/media-test-tools/node_modules/ffmpeg-ffprobe-static");
} catch {}
if (binaries)
  process.env.PATH =
    path.dirname(binaries.ffmpegPath) + path.delimiter + process.env.PATH;
test(
  "cached speech renders real vertical and landscape videos, AI disclosure and a longform thumbnail",
  { skip: !binaries, timeout: 120000 },
  async () => {
    process.env.OPENAI_API_KEY = "test-never-sent";
    const { default: OpenAI } = require("openai");
    const testClient = new OpenAI({ apiKey: "test-never-sent" });
    const speechType = Object.getPrototypeOf(testClient.audio.speech),
      transcriptionType = Object.getPrototypeOf(
        testClient.audio.transcriptions,
      );
    const speech = speechType.create,
      transcription = transcriptionType.create;
    speechType.create = transcriptionType.create = async () => {
      throw new Error("Paid API must never be called in smoke test");
    };
    try {
      for (const format of ["shorts", "longform"]) {
        let state = {
          id: randomUUID(),
          caseId: randomUUID(),
          format,
          angleId: "evidence",
          editionId: "original",
          coreClaimIds: ["claim"],
          title: "A quiet record",
          script: "The surviving record leaves this question open.",
          description: "An illustrative documentary.",
          thumbnailText: "THE OPEN QUESTION",
          assets: [],
          assetIds: [],
          status: "verified",
          revision: 1,
        };
        if (format === "longform")
          state.script = (state.script + " ").repeat(200);
        state.verification = { passed: true, hash: documentHash(state) };
        const assetId = randomUUID();
        state.assets = [
          {
            id: assetId,
            contentId: state.id,
            kind: "image",
            sourceUrl: "https://upload.wikimedia.org/not-fetched.jpg",
            license: "test fixture",
            licenseUrl: "https://example.org/license",
            credit: "Synthetic test image",
            rightsConfirmed: true,
            aiGenerated: true,
          },
        ];
        state.assetIds = [assetId];
        const uploads = [],
          costs = [],
          cloud = new Map();
        let speechRequests = 0;
        const store = {
          content: async () => structuredClone(state),
          saveContent: async (next) => {
            assert.equal(next.revision, state.revision);
            state = structuredClone({ ...next, revision: next.revision + 1 });
            return structuredClone(state);
          },
          budgets: async () => structuredClone(costs),
          reserveCost: async (id, step, category, dollars) => {
            assert.equal(format, "longform");
            const operation_key = `${id}:${step}`;
            const existing = costs.find(
              (item) => item.operation_key === operation_key,
            );
            if (existing) return { ...existing, created: false };
            const item = {
              operation_key,
              state: "reserved",
              category,
              reserved_micros: Math.ceil(dollars * 1000000),
            };
            costs.push(item);
            return { ...item, created: true };
          },
          settleCost: async (key, dollars) => {
            const item = costs.find((item) => item.operation_key === key);
            assert.ok(item);
            item.state = "settled";
            item.spent_micros = Math.ceil(dollars * 1000000);
          },
        };
        const media = new MediaService(store);
        media.bucket = () => ({
          getMetadata: async () => [],
          upload: async (filename, options) => {
            cloud.set(options.destination, await fs.readFile(filename));
            uploads.push(options.destination);
          },
          file: (key) => ({
            download: async ({ destination }) => {
              if (!cloud.has(key)) throw new Error("Not found");
              await fs.writeFile(destination, cloud.get(key));
            },
          }),
        });
        const directory = media.directory(state.id);
        assert.ok(
          directory.startsWith(path.resolve(__dirname, "../output") + path.sep),
        );
        await fs.mkdir(directory, { recursive: true });
        try {
          const audio = path.join(directory, "audio.mp3");
          await exec("ffmpeg", [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:duration=1.2",
            "-c:a",
            "libmp3lame",
            audio,
          ]);
          await fs.writeFile(
            path.join(directory, "audio-manifest.json"),
            JSON.stringify({
              input: documentHash(state),
              hash: await fileHash(audio),
            }),
          );
          await fs.writeFile(
            path.join(directory, "subtitles.srt"),
            "1\n00:00:00,000 --> 00:00:01,100\nA quiet test record.\n",
          );
          await fs.writeFile(
            path.join(directory, "subtitle-manifest.json"),
            JSON.stringify({ audio: await fileHash(audio) }),
          );
          if (format === "longform") {
            const wave = path.join(directory, "fixture.wav");
            await exec("ffmpeg", [
              "-y",
              "-f",
              "lavfi",
              "-i",
              "sine=frequency=220:duration=0.4",
              wave,
            ]);
            await Promise.all(
              [
                "audio.mp3",
                "audio-manifest.json",
                "subtitles.srt",
                "subtitle-manifest.json",
              ].map((name) => fs.rm(path.join(directory, name))),
            );
            speechType.create = async (input) => {
              speechRequests++;
              assert.equal(input.response_format, "wav");
              assert.equal(input.voice, "onyx");
              assert.equal(input.speed, 0.92);
              const data = await fs.readFile(wave);
              return {
                arrayBuffer: async () =>
                  data.buffer.slice(
                    data.byteOffset,
                    data.byteOffset + data.byteLength,
                  ),
              };
            };
            transcriptionType.create = async () =>
              "1\n00:00:00,000 --> 00:00:01,100\nA quiet test record.\n";
          }
          await exec("ffmpeg", [
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x17263d:s=640x360",
            "-frames:v",
            "1",
            "-update",
            "1",
            path.join(directory, `${assetId}.jpg`),
          ]);
          const record = {
            claims: [
              {
                id: "claim",
                sourceId: "source",
                text: "An open question.",
                classification: "Reported",
                quote: "The question remains open.",
              },
            ],
            sources: [
              {
                id: "source",
                url: "https://example.org/record",
                verifiedAt: "2026-10-19",
                text: "The question remains open.",
              },
            ],
          };
          const rendered = await media.render(structuredClone(state), record);
          assert.equal(rendered.status, "rendered");
          assert.equal(rendered.renderHash, await fileHash(rendered.finalPath));
          const probe = await exec("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "stream=width,height",
            "-select_streams",
            "v:0",
            "-of",
            "json",
            rendered.finalPath,
          ]);
          const dimensions = JSON.parse(probe.stdout).streams[0];
          assert.deepEqual(
            dimensions,
            format === "shorts"
              ? { width: 1080, height: 1920 }
              : { width: 1920, height: 1080 },
          );
          assert.match(
            await fs.readFile(path.join(directory, "subtitles.ass"), "utf8"),
            /AI reenactment - not original footage/,
          );
          assert.ok(uploads.some((item) => item.endsWith("/final.mp4")));
          if (format === "longform") {
            assert.equal(
              rendered.thumbnailHash,
              await fileHash(path.join(directory, "thumbnail.jpg")),
            );
            assert.ok(speechRequests >= 3);
            assert.ok(costs.every((item) => item.state === "settled"));
            const calls = speechRequests;
            for (const name of [
              "audio.mp3",
              "audio-manifest.json",
              "subtitles.srt",
              "subtitle-manifest.json",
            ])
              await fs.rm(path.join(directory, name));
            state.status = "verified";
            await media.render(structuredClone(state), record);
            assert.equal(
              speechRequests,
              calls,
              "cloud-restored results must not generate paid speech again",
            );
          }
        } finally {
          await fs.rm(directory, { recursive: true, force: true });
        }
      }
    } finally {
      speechType.create = speech;
      transcriptionType.create = transcription;
      delete process.env.OPENAI_API_KEY;
    }
  },
);
