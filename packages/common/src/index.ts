export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type ProjectId = Brand<string, "ProjectId">;
export type BookId = Brand<string, "BookId">;
export type ChapterId = Brand<string, "ChapterId">;
export type BlockId = Brand<string, "BlockId">;
export type JobId = Brand<string, "JobId">;
export type SegmentId = Brand<string, "SegmentId">;
export type Timestamp = Brand<string, "Timestamp">;

export type TranslationSegmentStatus =
  | "pending"
  | "translated"
  | "needs_review"
  | "reviewed"
  | "approved"
  | "error";

export type TranslationJobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

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

export interface ImportedBookSummary {
  book: Book;
  document: SourceDocument;
  chapterCount: number;
  blockCount: number;
  extractedDir: string;
}

export interface ExportedBookSummary {
  book: Book;
  outputPath: string;
  replacementCount: number;
}

export interface TranslationRunSummary {
  book: Book;
  job: TranslationJob;
  translatedCount: number;
  errorCount: number;
  segmentCount: number;
}

export interface ProviderValidationSummary {
  provider: string;
  ok: boolean;
  message?: string;
  configSource: ".env";
}

export function nowTimestamp(): Timestamp {
  return new Date().toISOString() as Timestamp;
}
