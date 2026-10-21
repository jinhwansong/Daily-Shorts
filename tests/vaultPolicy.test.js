const { test } = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../dist/vault/policy");

test("same case allows a longform with genuinely additional core claims", () => {
  const previous = {
    id: "old",
    caseId: "case",
    format: "shorts",
    angleId: "last-seen",
    editionId: "original",
    coreClaimIds: ["a"],
  };
  assert.equal(
    policy.isDuplicate(previous, {
      ...previous,
      id: "new",
      format: "longform",
      angleId: "timeline",
      coreClaimIds: ["a", "b"],
    }),
    false,
  );
  assert.equal(
    policy.isDuplicate(previous, {
      ...previous,
      id: "new",
      angleId: "renamed",
    }),
    true,
  );
});

test("a reviewed short can focus on one fact from its parent longform", () => {
  const previous = {
    id: "long",
    caseId: "case",
    format: "longform",
    angleId: "timeline",
    editionId: "original",
    coreClaimIds: ["a", "b"],
  };
  const next = {
    ...previous,
    id: "short",
    format: "shorts",
    angleId: "last-seen",
    coreClaimIds: ["a"],
    derivedFromId: "long",
  };
  assert.equal(policy.isDuplicate(previous, next), false);
  assert.equal(
    policy.isDuplicate({ ...previous, format: "shorts" }, next),
    true,
  );
});

test("matching its own reservation is a resume, not a second publication", () => {
  const content = {
    id: "same",
    caseId: "case",
    format: "shorts",
    angleId: "clue",
    editionId: "original",
    coreClaimIds: ["a"],
  };
  assert.equal(policy.isDuplicate(content, content), false);
});

test("source URL without a matching quote cannot verify a claim", () => {
  const claim = {
    id: "a",
    text: "The ship sailed on Monday.",
    classification: "Fact",
    sourceId: "s",
    quote: "The ship sailed on Monday.",
  };
  assert.deepEqual(
    policy.evidenceFailures(
      [claim],
      [
        {
          id: "s",
          url: "https://example.org/record",
          text: "The ship sailed on Monday.",
          verifiedAt: "2026-10-19",
        },
      ],
    ),
    [],
  );
  assert.ok(
    policy.evidenceFailures(
      [claim],
      [
        {
          id: "s",
          url: "https://example.org/record",
          text: "No sailing date is known.",
          verifiedAt: "2026-10-19",
        },
      ],
    ).length,
  );
});

test("unknown upload outcome cannot transition back to upload or render", () => {
  assert.throws(
    () => policy.assertTransition("reconciliation_required", "uploading"),
    /transition/i,
  );
  assert.throws(
    () => policy.assertTransition("reconciliation_required", "rendered"),
    /transition/i,
  );
  assert.doesNotThrow(() =>
    policy.assertTransition("reconciliation_required", "uploaded_private"),
  );
});

test("document fingerprint changes when verified metadata changes", () => {
  const content = {
    script: "A fact.",
    title: "A title",
    description: "Sources",
    thumbnailText: "A title",
    assetIds: ["a"],
    renderHash: "video",
    coreClaimIds: ["claim"],
  };
  const original = policy.documentHash(content);
  assert.notEqual(
    original,
    policy.documentHash({ ...content, title: "Changed claim" }),
  );
  assert.notEqual(
    original,
    policy.documentHash({ ...content, coreClaimIds: ["different-claim"] }),
  );
  assert.doesNotThrow(() =>
    policy.assertTransition("uploaded_private", "published"),
  );
  assert.throws(
    () => policy.assertTransition("uploaded_private", "approved"),
    /transition/i,
  );
});

test("currency conversion rejects negative and nonfinite costs", () => {
  assert.equal(policy.toMicros(0.42), 420000);
  assert.throws(() => policy.toMicros(-1));
  assert.throws(() => policy.toMicros(NaN));
});
