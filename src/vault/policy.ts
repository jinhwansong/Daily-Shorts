import { createHash } from "node:crypto";
import type {
  CaseRecord,
  Claim,
  ContentRecord,
  ContentStatus,
  EvidenceSource,
} from "./models";

export const normalizeKey = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const canonicalKey = (name: string, date: string, location: string) =>
  fingerprint([name, date, location].map(normalizeKey));
export const claimKey = (text: string) => fingerprint(normalizeKey(text));

type ContentIdentity = Pick<
  ContentRecord,
  | "id"
  | "caseId"
  | "format"
  | "angleId"
  | "editionId"
  | "coreClaimIds"
  | "derivedFromId"
>;

export function isDuplicate(
  previous: ContentIdentity,
  next: ContentIdentity,
): boolean {
  if (previous.id === next.id || previous.caseId !== next.caseId) return false;
  if (previous.editionId !== next.editionId) return false;
  if (
    previous.format === next.format &&
    normalizeKey(previous.angleId) === normalizeKey(next.angleId)
  )
    return true;
  const oldClaims = new Set(previous.coreClaimIds);
  const subset =
    next.coreClaimIds.length > 0 &&
    next.coreClaimIds.every((id) => oldClaims.has(id));
  if (!subset) return false;
  return !(
    previous.format === "longform" &&
    next.format === "shorts" &&
    next.derivedFromId === previous.id &&
    next.coreClaimIds.length < oldClaims.size
  );
}

export function evidenceFailures(
  claims: Claim[],
  sources: EvidenceSource[],
): string[] {
  const failures: string[] = [];
  if (!claims.length) failures.push("No verified claims selected.");
  for (const claim of claims) {
    const source = sources.find((item) => item.id === claim.sourceId);
    if (!source || !/^https:\/\//i.test(source.url) || !source.verifiedAt) {
      failures.push(`Claim ${claim.id}: missing dated HTTPS source.`);
      continue;
    }
    if (
      !claim.quote?.trim() ||
      !normalizeKey(source.text).includes(normalizeKey(claim.quote))
    ) {
      failures.push(
        `Claim ${claim.id}: quote is absent from the recorded source.`,
      );
    }
    if (claim.classification === "Unverified")
      failures.push(
        `Claim ${claim.id}: unverified claims cannot be a factual core.`,
      );
    if (!claim.text?.trim()) failures.push(`Claim ${claim.id}: empty claim.`);
  }
  return failures;
}

export function selectedClaims(content: ContentRecord, record: CaseRecord) {
  const claims = content.coreClaimIds.map((id) =>
    record.claims.find((claim) => claim.id === id),
  );
  if (claims.some((claim) => !claim))
    throw new Error(
      "Selected claim was changed or removed; select verified claims again.",
    );
  return claims as Claim[];
}

export function documentHash(
  content: Pick<
    ContentRecord,
    "script" | "title" | "description" | "thumbnailText" | "coreClaimIds"
  >,
) {
  return fingerprint([
    content.script,
    content.title,
    content.description,
    content.thumbnailText,
    [...content.coreClaimIds].sort(),
  ]);
}

const transitions: Record<ContentStatus, ContentStatus[]> = {
  reserved: ["draft", "failed"],
  draft: ["verified", "failed"],
  verified: ["draft", "rendered", "failed"],
  rendered: ["draft", "verified", "uploading", "failed"],
  uploading: ["uploaded_private", "reconciliation_required"],
  uploaded_private: ["published"],
  approved: ["published", "uploaded_private"],
  publishing: ["published", "uploaded_private", "reconciliation_required"],
  published: [],
  failed: ["draft", "verified", "rendered"],
  reconciliation_required: ["uploaded_private", "published"],
};

export function assertTransition(from: ContentStatus, to: ContentStatus) {
  if (!transitions[from]?.includes(to))
    throw new Error(`Invalid content transition: ${from} -> ${to}`);
}

export function toMicros(dollars: number): number {
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1000000)
    throw new Error("Cost must be a finite, nonnegative dollar amount.");
  return Math.ceil(dollars * 1000000);
}

export function budgetMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
