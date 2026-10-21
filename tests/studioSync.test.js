const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PublishingService } = require("../dist/vault/publishing.service");

const initial = {
  id: "content",
  youtubeId: "video",
  status: "uploaded_private",
  revision: 1,
};
function service(video) {
  const saved = [];
  const publishing = new PublishingService(
    {
      saveContent: async (content) => {
        saved.push(content);
        return content;
      },
    },
    {},
  );
  publishing.client = () => ({
    videos: { list: async () => ({ data: { items: video ? [video] : [] } }) },
  });
  return { publishing, saved };
}
const remote = (visibility) => ({
  id: "video",
  snippet: { description: "[Noctivault:content]" },
  status: { privacyStatus: visibility },
});

test("Studio publication sync reads remote state without publishing or requiring board approval", async () => {
  const { publishing, saved } = service(remote("public"));
  const content = await publishing.syncStatus(initial);
  assert.equal(content.status, "published");
  assert.equal(content.youtubeVisibility, "public");
  assert.ok(content.publishedAt);
  assert.ok(content.youtubeSyncedAt);
  assert.equal(saved.length, 1);
  assert.equal(typeof publishing.publish, "undefined");
});

test("private and unlisted states retain the permanent publication history", async () => {
  for (const visibility of ["private", "unlisted"]) {
    const { publishing } = service(remote(visibility));
    const published = await publishing.syncStatus({
      ...initial,
      status: "published",
      publishedAt: "2026-10-20T00:00:00Z",
    });
    assert.equal(published.status, "published");
    assert.equal(published.publishedAt, "2026-10-20T00:00:00Z");
    assert.equal(published.youtubeVisibility, visibility);
    const pending = await publishing.syncStatus(initial);
    assert.equal(pending.status, "uploaded_private");
  }
});

test("missing or mismatched remote video cannot overwrite local history", async () => {
  for (const video of [
    undefined,
    {
      ...remote("public"),
      snippet: { description: "[Noctivault:someone-else]" },
    },
  ]) {
    const { publishing, saved } = service(video);
    await assert.rejects(publishing.syncStatus(initial), /식별자|영상/);
    assert.equal(saved.length, 0);
  }
});

test("lost upload can be reconciled after the operator already published it in Studio", async () => {
  const { publishing } = service(remote("public"));
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
    playlistItems: {
      list: async () => ({
        data: { items: [{ contentDetails: { videoId: "video" } }] },
      }),
    },
    videos: { list: async () => ({ data: { items: [remote("public")] } }) },
  });
  const content = await publishing.reconcile(
    { ...initial, youtubeId: undefined, status: "reconciliation_required" },
    {},
  );
  assert.equal(content.youtubeId, "video");
  assert.equal(content.status, "published");
});
