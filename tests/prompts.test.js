const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { AiService } = require("../dist/vault/ai.service");

test("generation, factcheck and dedup use editable prompt files without provider requests", async () => {
  const ai = new AiService({});
  const record = {
    name: "Test vessel",
    status: "unresolved",
    claims: [
      {
        id: "claim",
        text: "The crew was absent.",
        classification: "Reported",
        sourceId: "source",
        quote: "The vessel had no crew.",
      },
    ],
    sources: [
      {
        id: "source",
        title: "Record",
        kind: "primary",
        url: "https://example.org/record",
        text: "The vessel had no crew.",
        verifiedAt: "2026-10-19",
      },
    ],
  };
  const content = {
    id: "candidate",
    format: "shorts",
    coreClaimIds: ["claim"],
    script: "The crew was absent.",
    title: "The crew",
    description: "Documentary",
    thumbnailText: "The crew",
    assets: [],
  };
  const tasks = [];
  ai.json = async (_content, step, payload) => {
    tasks.push(JSON.parse(payload).task);
    if (step === "factcheck") return { passed: true, failures: [] };
    if (step === "semantic-dedup")
      return { duplicate: false, reason: "New evidence" };
    return { ...content, claimIds: ["claim"] };
  };
  await ai.generate(content, record);
  await ai.generate({ ...content, format: "longform" }, record);
  assert.equal((await ai.verify(content, record)).passed, true);
  await ai.compare(content, [{ ...content, id: "previous" }]);
  assert.deepEqual(
    tasks,
    ["mystery", "mystery-long", "factcheck", "dedup"].map((name) =>
      readFileSync(
        path.join(__dirname, "../prompts", name + ".txt"),
        "utf8",
      ).trim(),
    ),
  );
});
