const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { OperationsService } = require("../dist/vault/operations.service");
const { KlingService } = require("../dist/vault/kling.service");
const { PublishingService } = require("../dist/vault/publishing.service");
const { documentHash } = require("../dist/vault/policy");
const clone = (value) => JSON.parse(JSON.stringify(value));
const record = {
  id: "case",
  sources: [
    {
      id: "source",
      url: "https://example.org/report",
      verifiedAt: "2026-10-19",
      text: "The vessel was found without its crew.",
    },
  ],
  claims: [
    {
      id: "claim",
      text: "The crew was absent.",
      sourceId: "source",
      quote: "The vessel was found without its crew.",
      classification: "Reported",
    },
  ],
};
const initial = {
  id: "content",
  caseId: "case",
  format: "shorts",
  status: "rendered",
  revision: 1,
  angleId: "crew",
  editionId: "original",
  coreClaimIds: ["claim"],
  title: "The missing crew",
  script: "The vessel was found.",
  description: "Documentary",
  thumbnailText: "An empty vessel",
  assets: [],
  assetIds: [],
};

function fakeStore(content) {
  const state = { content: clone(content), runs: [] };
  return {
    state,
    content: async () => clone(state.content),
    case: async () => clone(record),
    previousContents: async () => [clone(state.content)],
    withRun: (_id, fn) => fn(),
    assertIdle: async () => {},
    run: async (_id, step) => {
      const run = { id: "run", contentId: "content", step, status: "running" };
      state.runs.push(run);
      return run;
    },
    saveRun: async (run) => {
      state.runs[0] = run;
    },
    saveContent: async (next) => {
      assert.equal(next.revision, state.content.revision);
      state.content = clone({ ...next, revision: next.revision + 1 });
      return clone(state.content);
    },
  };
}
test("upload response loss becomes reconciliation_required and cannot retry upload", async () => {
  const store = fakeStore(initial);
  let uploads = 0;
  const publishing = {
    upload: async (content) => {
      uploads++;
      await store.saveContent({
        ...content,
        status: "uploading",
        currentStep: "upload",
      });
      throw new Error("response lost");
    },
  };
  const operations = new OperationsService(store, {}, {}, {}, publishing);
  await operations.action("content", "upload");
  await assert.rejects(operations.waitForContent("content"), /response lost/);
  const result = await store.content("content");
  assert.equal(result.status, "reconciliation_required");
  assert.equal(store.state.runs[0].status, "unknown");
  await assert.rejects(operations.action("content", "upload"), /현재 상태/);
  assert.equal(uploads, 1);
});

test('successful upload always requests private visibility and stores its video ID', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'noctivault-upload-'));
  const file=path.join(dir,'final.mp4');
  const bytes=Buffer.from('synthetic test video bytes');
  await fs.writeFile(file,bytes);
  const content={...initial,renderHash:createHash('sha256').update(bytes).digest('hex'),renderInputHash:documentHash(initial),verification:{passed:true,hash:documentHash(initial)},assets:[{id:'asset',rightsConfirmed:true,license:'CC BY',licenseUrl:'https://example.org/cc',credit:'Test fixture'}]};
  const store=fakeStore(content),publishing=new PublishingService(store,{restore:async()=>file});
  publishing.client=()=>({videos:{insert:async request=>{
    assert.equal(request.requestBody.status.privacyStatus,'private');
    assert.ok(request.requestBody.snippet.description.includes('[Noctivault:content]'));
    request.media.body.destroy();
    return {data:{id:'private-video'}};
  }}});
  try {
    const uploaded=await publishing.upload(content,record);
    assert.equal(uploaded.status,'uploaded_private');
    assert.equal(uploaded.youtubeId,'private-video');
    assert.equal(uploaded.publishedAt,undefined);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test("private upload still rejects stale verification and missing asset rights before contacting YouTube", async () => {
  const publishing = new PublishingService({}, {});
  publishing.client = () => {
    throw new Error("Must not contact YouTube");
  };
  await assert.rejects(
    publishing.upload(initial, record),
    (error) =>
      error.getStatus() === 409 &&
      error
        .getResponse()
        .message.some((message) => /검증 원고|자산 사용 권리/.test(message)),
  );
  const content = {
    ...initial,
    renderHash: "file",
    renderInputHash: documentHash(initial),
    verification: { passed: true, hash: documentHash(initial) },
    assets: [
      {
        id: "asset",
        rightsConfirmed: false,
        licenseUrl: "https://example.org/cc",
      },
    ],
  };
  await assert.rejects(
    publishing.upload(content, record),
    (error) =>
      error.getStatus() === 409 &&
      error
        .getResponse()
        .message.some((message) => /자산 사용 권리/.test(message)),
  );
});
test("Kling reserves exact 3.0 silent five-second ceiling and never repeats an unknown submission", async () => {
  let created = true,
    requests = 0;
  const store = {
    reserveCost: async (_id, step, category, amount) => {
      assert.match(step, /kling/);
      assert.equal(category, "video");
      assert.equal(amount, 0.42);
      const result = { operation_key: "key", created };
      created = false;
      return result;
    },
    trackProvider: async () => {},
  };
  const kling = new KlingService(store);
  kling.request = async (url, body) => {
    requests++;
    assert.match(url, /kling-video\/v3\/standard\/image-to-video$/);
    assert.equal(body.duration, "5");
    assert.equal(body.generate_audio, false);
    return {
      request_id: "task",
      status_url: "https://queue.fal.run/status",
      response_url: "https://queue.fal.run/result",
    };
  };
  process.env.FAL_KEY = "test-only";
  await kling.submit(
    initial,
    "https://upload.wikimedia.org/input.jpg",
    "A quiet illustrative scene",
  );
  await assert.rejects(
    kling.submit(
      initial,
      "https://upload.wikimedia.org/input.jpg",
      "same scene",
    ),
    /이미|기존/,
  );
  assert.equal(requests, 1);
  delete process.env.FAL_KEY;
});

test("Kling missing key cannot reserve money", async () => {
  delete process.env.FAL_KEY;
  const kling = new KlingService({
    reserveCost: async () => {
      throw new Error("Money must not be reserved");
    },
  });
  await assert.rejects(
    kling.submit(initial, "https://upload.wikimedia.org/input.jpg", "scene"),
    /FAL_KEY/,
  );
});

test("worker cannot approve or publish even legacy approved records", async () => {
  const operations = new OperationsService(
    fakeStore({ ...initial, status: "approved" }),
    {},
    {},
    {},
    {},
  );
  await assert.rejects(operations.action("content", "publish"), /현재 상태/);
  await assert.rejects(operations.action("content", "reopen"), /현재 상태/);
  assert.equal(typeof operations.approve, "undefined");
});

test("public credits never contain private signed download tokens", () => {
  const publishing = new PublishingService({}, {});
  const description = publishing.uploadDescription({
    ...initial,
    assets: [
      {
        sourceUrl:
          "https://storage.googleapis.com/private/image.jpg?X-Goog-Signature=secret-token",
        credit: "Operator-owned illustration",
        licenseUrl: "https://example.org/rights",
      },
    ],
  });
  assert.equal(description.includes("secret-token"), false);
  assert.match(description, /AI-generated voice/);
});

test("absent upload stays blocked unless remote scan and explicit delayed human confirmation agree", async () => {
  const content = {
    ...initial,
    status: "reconciliation_required",
    currentStep: "upload",
    uploadedAt: new Date(Date.now() - 7200000).toISOString(),
  };
  const store = fakeStore(content),
    publishing = new PublishingService(store, {});
  publishing.client = () => ({
    channels: {
      list: async () => ({
        data: {
          items: [
            { contentDetails: { relatedPlaylists: { uploads: "playlist" } } },
          ],
        },
      }),
    },
    playlistItems: { list: async () => ({ data: { items: [] } }) },
  });
  await assert.rejects(publishing.reconcile(content, {}), /일치 영상 0건/);
  const result = await publishing.reconcile(content, {
    confirmedNoUpload: true,
  });
  assert.equal(result.status, "rendered");
  assert.ok(result.noUploadConfirmedAt);
});
