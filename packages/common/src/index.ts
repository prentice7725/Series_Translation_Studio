export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type ProjectId = Brand<string, "ProjectId">;
export type BookId = Brand<string, "BookId">;
export type ChapterId = Brand<string, "ChapterId">;
export type BlockId = Brand<string, "BlockId">;
export type JobId = Brand<string, "JobId">;
export type SegmentId = Brand<string, "SegmentId">;
export type ReferenceBlockId = Brand<string, "ReferenceBlockId">;
export type AlignmentPairId = Brand<string, "AlignmentPairId">;
export type Timestamp = Brand<string, "Timestamp">;

export type TranslationSegmentStatus =
  | "pending"
  | "translating"
  | "translated"
  | "editorial_pending"
  | "editorial_running"
  | "editorial_approved"
  | "needs_review"
  | "reviewed"
  | "approved"
  | "post_read_corrected"
  | "editorial_error"
  | "error";

export type TranslationJobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type EditorialJobStatus = TranslationJobStatus | "completed_with_warnings";
export type EditorialDecisionType = "approve" | "needs_review" | "reject";

export interface AppError {
  code: string;
  message: string;
  cause?: unknown;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export interface Project {
  id: ProjectId;
  name: string;
  seriesName?: string;
  sourceLang: string;
  targetLang: string;
  workspacePath: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Book {
  id: BookId;
  projectId: ProjectId;
  title: string;
  originalTitle?: string;
  author?: string;
  seriesIndex?: number;
  sourceLang: string;
  targetLang: string;
  spoilerSafeEnabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SourceDocument {
  id: string;
  bookId: BookId;
  filePath: string;
  fileType: string;
  fileHash: string;
  role: "source_original" | "reference_translation" | "generated_translation";
  importedAt: Timestamp;
}

export interface Chapter {
  id: ChapterId;
  bookId: BookId;
  documentId: string;
  chapterIndex: number;
  title?: string;
  spineHref: string;
  createdAt: Timestamp;
}

export interface TextBlock {
  id: BlockId;
  chapterId: ChapterId;
  documentId: string;
  blockIndex: number;
  xpath: string;
  htmlTag: string;
  sourceText: string;
  normalizedText: string;
  textHash: string;
  createdAt: Timestamp;
}

export interface TranslationJob {
  id: JobId;
  projectId: ProjectId;
  bookId: BookId;
  provider: string;
  model: string;
  status: TranslationJobStatus;
  configJson: string;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface EditorialJob {
  id: JobId;
  projectId: ProjectId;
  bookId: BookId;
  translationJobId: JobId;
  provider: string;
  model: string;
  status: EditorialJobStatus;
  configJson: string;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TranslationSegment {
  id: SegmentId;
  jobId: JobId;
  blockId: BlockId;
  sourceText: string;
  aiTranslation?: string;
  editorialTranslation?: string;
  reviewedTranslation?: string;
  finalTranslation?: string;
  status: TranslationSegmentStatus;
  responseJson?: string;
  editorialResponseJson?: string;
  errorMessage?: string;
  sourceHash: string;
  promptHash: string;
  editorialPromptHash?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type GlossaryConfidence = "gold" | "silver" | "candidate";
export type TmGrade = "gold" | "gold_candidate" | "silver" | "reference" | "rejected";
export type TmOrigin =
  | "user_approved"
  | "ai_editorial_approved"
  | "alignment_auto"
  | "reference_translation"
  | "post_read_correction"
  | "manual";

export interface GlossaryTerm {
  id: string;
  projectId: ProjectId;
  sourceTerm: string;
  canonicalKo: string;
  category: string;
  aliases?: string;
  forbiddenTargets?: string;
  contextRules?: string;
  notes?: string;
  confidence: GlossaryConfidence;
  doNotTranslate: boolean;
  needsReview: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GlossaryHit {
  termId: string;
  sourceTerm: string;
  canonicalKo: string;
  category: string;
  confidence: GlossaryConfidence;
  notes?: string;
  doNotTranslate: boolean;
  forbiddenTargets: string[];
}

export interface GlossaryIssue {
  type: "glossary_mismatch" | "forbidden_term";
  severity: "warning" | "error";
  sourceTerm: string;
  message: string;
  suggestion?: string;
}

export interface TmUnit {
  id: string;
  projectId: ProjectId;
  bookId?: BookId;
  sourceText: string;
  targetText: string;
  sourceHash: string;
  grade: TmGrade;
  origin: TmOrigin;
  confidence?: number;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TmMatch {
  unit: TmUnit;
  score: number;
  weightedScore: number;
  matchType: "exact" | "fuzzy";
}

export interface QaFlag {
  type: string;
  severity: "info" | "warning" | "error" | "blocking";
  message: string;
}

export interface UsedReferencePart {
  text: string;
  purpose?: string;
}

export interface EditorialDecision {
  id: string;
  editorialJobId: JobId;
  segmentId: SegmentId;
  sourceText: string;
  aiTranslation: string;
  referenceTranslation?: string;
  editorialTranslation?: string;
  decision: EditorialDecisionType;
  tmGrade: "gold_candidate" | "none" | "rejected";
  confidence: number;
  rationale?: string;
  qaFlagsJson: string;
  responseJson: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PostReadCorrection {
  id: string;
  projectId: ProjectId;
  bookId: BookId;
  segmentId: SegmentId;
  sourceText: string;
  beforeText: string;
  correctedText: string;
  note?: string;
  promotedTmUnitId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type AlignmentPairStatus = "candidate" | "approved" | "rejected";
export type StylebookEntryType = "voice" | "pacing" | "punctuation" | "terminology" | "note";

export interface ReferenceBlock {
  id: ReferenceBlockId;
  projectId: ProjectId;
  bookId: BookId;
  documentId: string;
  blockIndex: number;
  chapterIndex?: number;
  spineHref?: string;
  title?: string;
  referenceText: string;
  normalizedText: string;
  textHash: string;
  createdAt: Timestamp;
}

export interface AlignmentPreviewChapter {
  chapterId?: ChapterId;
  chapterIndex: number;
  spineHref?: string;
  title?: string;
  blockStartIndex: number;
  blockCount: number;
  previewText: string;
  candidateType?: string;
  confidence?: number;
  reason?: string;
}

export interface AlignmentPreview {
  sourceChapters: AlignmentPreviewChapter[];
  referenceChapters: AlignmentPreviewChapter[];
  suggestedSourceChapterId?: ChapterId;
  suggestedReferenceBlockStartIndex?: number;
}

export interface AlignmentRunOptions {
  sourceChapterId?: ChapterId;
  referenceBlockStartIndex?: number;
}

export interface AlignmentPair {
  id: AlignmentPairId;
  projectId: ProjectId;
  bookId: BookId;
  sourceBlockId: BlockId;
  referenceBlockId: ReferenceBlockId;
  sourceText: string;
  referenceText: string;
  confidence: number;
  status: AlignmentPairStatus;
  promotedTmUnitId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AlignmentRunSummary {
  book: Book;
  referenceDocument?: SourceDocument;
  sourceBlockCount: number;
  referenceBlockCount: number;
  pairCount: number;
  averageConfidence: number;
  debugLogPath?: string;
}

export interface StylebookEntry {
  id: string;
  projectId: ProjectId;
  entryType: StylebookEntryType;
  title: string;
  body: string;
  priority: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CharacterProfile {
  id: string;
  projectId: ProjectId;
  name: string;
  aliases?: string;
  description?: string;
  speechStyle?: string;
  translationNotes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ChapterMemory {
  id: string;
  projectId: ProjectId;
  bookId: BookId;
  chapterId: ChapterId;
  summary: string;
  termNotes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GlossaryImportSummary {
  importedCount: number;
  skippedCount: number;
}

export interface ImportedBookSummary {
  book: Book;
  document: SourceDocument;
  chapterCount: number;
  blockCount: number;
  extractedDir: string;
}

export type TranslationExportMode = "draft" | "reviewed" | "final";

export interface ExportedBookSummary {
  book: Book;
  outputPath: string;
  replacementCount: number;
  mode?: TranslationExportMode;
  manifestPath?: string;
  reportPath?: string;
  validation?: {
    ok: boolean;
    fileSize: number;
    errors: string[];
  };
}

export interface TranslationRunSummary {
  book: Book;
  job: TranslationJob;
  translatedCount: number;
  errorCount: number;
  segmentCount: number;
  cacheHitCount: number;
}

export interface ProviderValidationSummary {
  provider: string;
  ok: boolean;
  message?: string;
  configSource: ".env";
}

export type ProviderIssueCategory =
  | "config"
  | "auth"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "network"
  | "response_format"
  | "unknown";

export interface ProviderIssueSummary {
  category: ProviderIssueCategory;
  code: string;
  retryable: boolean;
  count: number;
  message: string;
  userAction: string;
}

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  segmentCount: number;
  estimatedCostUsd?: number;
  costSource?: string;
}

export interface TranslationJobProgress {
  job: TranslationJob;
  segmentCount: number;
  translatedCount: number;
  errorCount: number;
  cacheHitCount: number;
  statusCounts: Record<string, number>;
  providerIssues: ProviderIssueSummary[];
  usage: TokenUsageSummary;
}

export interface EditorialJobProgress {
  job: EditorialJob;
  segmentCount: number;
  processedCount: number;
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  goldCandidateCount: number;
  errorCount: number;
  statusCounts: Record<string, number>;
}

export interface EditorialRunSummary {
  book: Book;
  job: EditorialJob;
  segmentCount: number;
  processedCount: number;
  approvedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  goldCandidateCount: number;
  errorCount: number;
}

export interface SpoilerSafeSummary {
  bookId: BookId;
  totalSegments: number;
  translatedSegments: number;
  editorialApproved: number;
  needsReview: number;
  rejected: number;
  blockingErrors: number;
  goldCandidates: number;
  glossaryWarnings: number;
  newTermCandidates: number;
  canExport: boolean;
  summary: string;
}

export interface ReviewSegmentSummary {
  segment: TranslationSegment;
  block: TextBlock;
  chapter: Chapter;
  displayIndex: number;
  qaIssues: string[];
}

export type ExternalTransferTask = "translation" | "editorial" | "alignment" | "other";

export interface ExternalTransferConsent {
  id: string;
  projectId: ProjectId;
  bookId?: BookId;
  task: ExternalTransferTask;
  provider: string;
  model: string;
  scope: string;
  sourceLang: string;
  targetLang: string;
  consentText: string;
  accepted: boolean;
  createdAt: Timestamp;
}

export interface SegmentSearchResult {
  segment: TranslationSegment;
  chapter: Chapter;
  displayIndex: number;
  matchedText: string;
  score: number;
}

export function nowTimestamp(): Timestamp {
  return new Date().toISOString() as Timestamp;
}
