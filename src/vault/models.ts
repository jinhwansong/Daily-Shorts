export type Format = "shorts" | "longform";
export type ContentStatus =
  | "reserved"
  | "draft"
  | "verified"
  | "rendered"
  | "uploading"
  | "uploaded_private"
  // Legacy states are read for Studio synchronization; new runs never approve or publish.
  | "approved"
  | "publishing"
  | "published"
  | "failed"
  | "reconciliation_required";
export type Category = "research" | "tts" | "image" | "video" | "other";

export interface EvidenceSource {
  id: string;
  url: string;
  title: string;
  text: string;
  verifiedAt: string;
  kind: "official" | "primary" | "report" | "reference";
}

export interface Claim {
  id: string;
  text: string;
  classification: "Fact" | "Reported" | "Hypothesis" | "Unverified";
  sourceId: string;
  quote: string;
}

export interface CaseRecord {
  id: string;
  canonicalKey: string;
  name: string;
  date: string;
  location: string;
  aliases: string[];
  externalIds: string[];
  sources: EvidenceSource[];
  claims: Claim[];
  status: string;
  legacyReviewRequired?: boolean;
  createdAt: string;
}

export interface AssetRecord {
  id: string;
  contentId: string;
  kind: "video" | "image" | "audio" | "map" | "document";
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  credit: string;
  rightsConfirmed: boolean;
  aiGenerated: boolean;
  localPath?: string;
  storageKey?: string;
  providerTaskId?: string;
}

export interface Verification {
  hash: string;
  passed: boolean;
  failures: string[];
  checkedAt: string;
}

export interface ContentRecord {
  imported?: boolean;
  id: string;
  caseId: string;
  format: Format;
  angleId: string;
  editionId: string;
  coreClaimIds: string[];
  derivedFromId?: string;
  updateReason?: string;
  script: string;
  title: string;
  description: string;
  thumbnailText: string;
  status: ContentStatus;
  revision: number;
  assets: AssetRecord[];
  assetIds: string[];
  verification?: Verification;
  renderHash?: string;
  renderInputHash?: string;
  thumbnailHash?: string;
  thumbnailUploaded?: boolean;
  finalPath?: string;
  outputDir?: string;
  storagePrefix?: string;
  youtubeId?: string;
  youtubeVisibility?: string;
  youtubeSyncedAt?: string;
  uploadedAt?: string;
  noUploadConfirmedAt?: string;
  publishedAt?: string;
  currentStep?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyRecord {
  id: string;
  externalKey: string;
  title: string;
  hook: string;
  thumbnail: string;
  videoId?: string;
  uploadedAt?: string;
  mappedContent?: ContentRecord;
  ignoredReason?: string;
  createdAt: string;
}

export interface BudgetEntry {
  created?: boolean;
  operation_key: string;
  content_id: string;
  month: string;
  category: Category;
  reserved_micros: number;
  spent_micros: number;
  state: "reserved" | "settled" | "released";
  provider_task_id?: string;
  created_at: string;
}

export interface RunRecord {
  id: string;
  contentId: string;
  step: string;
  status: "running" | "completed" | "failed" | "unknown";
  message?: string;
  startedAt: string;
  finishedAt?: string;
}
