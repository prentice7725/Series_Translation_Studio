import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AlignmentPair,
  Book,
  BookId,
  CharacterProfile,
  Chapter,
  ChapterMemory,
  EditorialDecision,
  EditorialJob,
  GlossaryTerm,
  PostReadCorrection,
  Project,
  ProjectId,
  ReferenceBlock,
  SourceDocument,
  StylebookEntry,
  TextBlock,
  TranslationJob,
  TranslationSegment,
  SegmentId,
  TmUnit
} from "@sts/common";
import { nowTimestamp } from "@sts/common";

export interface OpenProjectDatabaseInput {
  sqlitePath: string;
}

export interface CreateProjectInput {
  id: ProjectId;
  name: string;
  seriesName?: string;
  sourceLang?: string;
  targetLang?: string;
  workspacePath: string;
}

export interface CreateBookInput {
  id: BookId;
  projectId: ProjectId;
  title: string;
  originalTitle?: string;
  author?: string;
  seriesIndex?: number;
  sourceLang?: string;
  targetLang?: string;
  spoilerSafeEnabled?: boolean;
}

export interface UpsertTranslationSegmentInput {
  segment: TranslationSegment;
}

export interface CreateTranslationJobInput {
  job: TranslationJob;
}

export interface CreateEditorialJobInput {
  job: EditorialJob;
}

export interface UpsertEditorialDecisionInput {
  decision: EditorialDecision;
}

export interface UpsertGlossaryTermInput {
  term: GlossaryTerm;
}

export interface UpsertTmUnitInput {
  unit: TmUnit;
}

export interface CreatePostReadCorrectionInput {
  correction: PostReadCorrection;
}

export interface CreateReferenceBlocksInput {
  blocks: ReferenceBlock[];
}

export interface UpsertAlignmentPairsInput {
  pairs: AlignmentPair[];
}

export interface UpsertStylebookEntryInput {
  entry: StylebookEntry;
}

export interface UpsertCharacterProfileInput {
  profile: CharacterProfile;
}

export interface UpsertChapterMemoryInput {
  memory: ChapterMemory;
}

export type ProjectDatabase = DatabaseSync;

const currentDir = dirname(fileURLToPath(import.meta.url));

export function openProjectDatabase(input: OpenProjectDatabaseInput): ProjectDatabase {
  mkdirSync(dirname(input.sqlitePath), { recursive: true });
  const db = new DatabaseSync(input.sqlitePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  return db;
}

export class BookRepository {
  constructor(private readonly db: ProjectDatabase) {}

  create(input: CreateBookInput): Book {
    const createdAt = nowTimestamp();
    const book: Book = {
      id: input.id,
      projectId: input.projectId,
      title: input.title,
      originalTitle: input.originalTitle,
      author: input.author,
      seriesIndex: input.seriesIndex,
      sourceLang: input.sourceLang ?? "en",
      targetLang: input.targetLang ?? "ko",
      spoilerSafeEnabled: input.spoilerSafeEnabled ?? true,
      createdAt,
      updatedAt: createdAt
    };

    this.db
      .prepare(
        `INSERT INTO books (
          id, project_id, title, original_title, author, series_index,
          source_lang, target_lang, spoiler_safe_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        book.id,
        book.projectId,
        book.title,
        book.originalTitle ?? null,
        book.author ?? null,
        book.seriesIndex ?? null,
        book.sourceLang,
        book.targetLang,
        book.spoilerSafeEnabled ? 1 : 0,
        book.createdAt,
        book.updatedAt
      );

    return book;
  }

  list(projectId: ProjectId): Book[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          title,
          original_title AS originalTitle,
          author,
          series_index AS seriesIndex,
          source_lang AS sourceLang,
          target_lang AS targetLang,
          spoiler_safe_enabled AS spoilerSafeEnabled,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM books
        WHERE project_id = ?
        ORDER BY created_at DESC`
      )
      .all(projectId)
      .map(normalizeBook);
  }

  updateSpoilerSafe(input: {
    projectId: ProjectId;
    bookId: BookId;
    enabled: boolean;
  }): Book {
    this.db
      .prepare(
        `UPDATE books
        SET spoiler_safe_enabled = ?, updated_at = ?
        WHERE project_id = ? AND id = ?`
      )
      .run(input.enabled ? 1 : 0, nowTimestamp(), input.projectId, input.bookId);

    const book = this.list(input.projectId).find((candidate) => candidate.id === input.bookId);
    if (!book) {
      throw new Error(`Book not found: ${input.bookId}`);
    }
    return book;
  }
}

function normalizeBook(row: unknown): Book {
  const book = row as Omit<Book, "spoilerSafeEnabled"> & {
    spoilerSafeEnabled: number;
  };
  return {
    ...book,
    spoilerSafeEnabled: Boolean(book.spoilerSafeEnabled)
  };
}

export class SourceDocumentRepository {
  constructor(private readonly db: ProjectDatabase) {}

  create(input: SourceDocument): SourceDocument {
    this.db
      .prepare(
        `INSERT INTO source_documents (
          id, book_id, file_path, file_type, file_hash, role, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.bookId,
        input.filePath,
        input.fileType,
        input.fileHash,
        input.role,
        input.importedAt
      );

    return input;
  }

  findByProjectFileHash(input: {
    projectId: ProjectId;
    fileHash: string;
    role: SourceDocument["role"];
  }): SourceDocument | undefined {
    return this.db
      .prepare(
        `SELECT
          d.id,
          d.book_id AS bookId,
          d.file_path AS filePath,
          d.file_type AS fileType,
          d.file_hash AS fileHash,
          d.role,
          d.imported_at AS importedAt
        FROM source_documents d
        JOIN books b ON b.id = d.book_id
        WHERE b.project_id = ?
          AND d.file_hash = ?
          AND d.role = ?
        ORDER BY d.imported_at ASC
        LIMIT 1`
      )
      .get(input.projectId, input.fileHash, input.role) as SourceDocument | undefined;
  }

  findLatestByBookRole(input: {
    bookId: BookId;
    role: SourceDocument["role"];
  }): SourceDocument | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          book_id AS bookId,
          file_path AS filePath,
          file_type AS fileType,
          file_hash AS fileHash,
          role,
          imported_at AS importedAt
        FROM source_documents
        WHERE book_id = ?
          AND role = ?
        ORDER BY imported_at DESC
        LIMIT 1`
      )
      .get(input.bookId, input.role) as SourceDocument | undefined;
  }
}

export class ChapterRepository {
  constructor(private readonly db: ProjectDatabase) {}

  createMany(chapters: Chapter[]): void {
    const insert = this.db.prepare(
      `INSERT INTO chapters (
        id, book_id, document_id, chapter_index, title, spine_href, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    dbTransaction(this.db, () => {
      for (const chapter of chapters) {
        insert.run(
          chapter.id,
          chapter.bookId,
          chapter.documentId,
          chapter.chapterIndex,
          chapter.title ?? null,
          chapter.spineHref,
          chapter.createdAt
        );
      }
    });
  }

  listByBook(bookId: BookId): Chapter[] {
    return this.db
      .prepare(
        `SELECT
          id,
          book_id AS bookId,
          document_id AS documentId,
          chapter_index AS chapterIndex,
          title,
          spine_href AS spineHref,
          created_at AS createdAt
        FROM chapters
        WHERE book_id = ?
        ORDER BY chapter_index ASC`
      )
      .all(bookId) as unknown as Chapter[];
  }
}

export class TextBlockRepository {
  constructor(private readonly db: ProjectDatabase) {}

  createMany(blocks: TextBlock[]): void {
    const insert = this.db.prepare(
      `INSERT INTO text_blocks (
        id, chapter_id, document_id, block_index, xpath, html_tag,
        source_text, normalized_text, text_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    dbTransaction(this.db, () => {
      for (const block of blocks) {
        insert.run(
          block.id,
          block.chapterId,
          block.documentId,
          block.blockIndex,
          block.xpath,
          block.htmlTag,
          block.sourceText,
          block.normalizedText,
          block.textHash,
          block.createdAt
        );
      }
    });
  }

  countByDocument(documentId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM text_blocks WHERE document_id = ?")
      .get(documentId) as { count: number };
    return row.count;
  }

  listByChapterIds(chapterIds: string[]): TextBlock[] {
    if (chapterIds.length === 0) {
      return [];
    }

    const placeholders = chapterIds.map(() => "?").join(", ");
    return this.db
      .prepare(
        `SELECT
          id,
          chapter_id AS chapterId,
          document_id AS documentId,
          block_index AS blockIndex,
          xpath,
          html_tag AS htmlTag,
          source_text AS sourceText,
          normalized_text AS normalizedText,
          text_hash AS textHash,
          created_at AS createdAt
        FROM text_blocks
        WHERE chapter_id IN (${placeholders})
        ORDER BY created_at ASC, block_index ASC`
      )
      .all(...chapterIds) as unknown as TextBlock[];
  }
}

export class TranslationJobRepository {
  constructor(private readonly db: ProjectDatabase) {}

  create(input: CreateTranslationJobInput): TranslationJob {
    const job = input.job;
    this.db
      .prepare(
        `INSERT INTO translation_jobs (
          id, project_id, book_id, provider, model, status, config_json,
          started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.projectId,
        job.bookId,
        job.provider,
        job.model,
        job.status,
        job.configJson,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.createdAt,
        job.updatedAt
      );

    return job;
  }

  updateStatus(input: {
    jobId: string;
    status: TranslationJob["status"];
    completedAt?: string;
  }): void {
    this.db
      .prepare(
        `UPDATE translation_jobs
        SET status = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(input.status, input.completedAt ?? null, nowTimestamp(), input.jobId);
  }

  get(jobId: string): TranslationJob | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          provider,
          model,
          status,
          config_json AS configJson,
          started_at AS startedAt,
          completed_at AS completedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM translation_jobs
        WHERE id = ?`
      )
      .get(jobId) as TranslationJob | undefined;
  }

  latestByBook(bookId: BookId): TranslationJob | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          provider,
          model,
          status,
          config_json AS configJson,
          started_at AS startedAt,
          completed_at AS completedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM translation_jobs
        WHERE book_id = ?
        ORDER BY created_at DESC
        LIMIT 1`
      )
      .get(bookId) as TranslationJob | undefined;
  }

  listByBook(bookId: BookId): TranslationJob[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          provider,
          model,
          status,
          config_json AS configJson,
          started_at AS startedAt,
          completed_at AS completedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM translation_jobs
        WHERE book_id = ?
        ORDER BY created_at DESC`
      )
      .all(bookId) as unknown as TranslationJob[];
  }
}

export class EditorialJobRepository {
  constructor(private readonly db: ProjectDatabase) {}

  create(input: CreateEditorialJobInput): EditorialJob {
    const job = input.job;
    this.db
      .prepare(
        `INSERT INTO editorial_jobs (
          id, project_id, book_id, translation_job_id, provider, model, status, config_json,
          started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        job.id,
        job.projectId,
        job.bookId,
        job.translationJobId,
        job.provider,
        job.model,
        job.status,
        job.configJson,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.createdAt,
        job.updatedAt
      );

    return job;
  }

  updateStatus(input: {
    jobId: string;
    status: EditorialJob["status"];
    completedAt?: string;
  }): void {
    this.db
      .prepare(
        `UPDATE editorial_jobs
        SET status = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(input.status, input.completedAt ?? null, nowTimestamp(), input.jobId);
  }

  get(jobId: string): EditorialJob | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          translation_job_id AS translationJobId,
          provider,
          model,
          status,
          config_json AS configJson,
          started_at AS startedAt,
          completed_at AS completedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM editorial_jobs
        WHERE id = ?`
      )
      .get(jobId) as EditorialJob | undefined;
  }

  listByBook(bookId: BookId): EditorialJob[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          translation_job_id AS translationJobId,
          provider,
          model,
          status,
          config_json AS configJson,
          started_at AS startedAt,
          completed_at AS completedAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM editorial_jobs
        WHERE book_id = ?
        ORDER BY created_at DESC`
      )
      .all(bookId) as unknown as EditorialJob[];
  }
}

export class EditorialDecisionRepository {
  constructor(private readonly db: ProjectDatabase) {}

  upsert(input: UpsertEditorialDecisionInput): EditorialDecision {
    const decision = input.decision;
    this.db
      .prepare(
        `INSERT INTO editorial_decisions (
          id, editorial_job_id, segment_id, source_text, ai_translation,
          reference_translation, editorial_translation, decision, tm_grade,
          confidence, rationale, qa_flags_json, response_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(editorial_job_id, segment_id) DO UPDATE SET
          source_text = excluded.source_text,
          ai_translation = excluded.ai_translation,
          reference_translation = excluded.reference_translation,
          editorial_translation = excluded.editorial_translation,
          decision = excluded.decision,
          tm_grade = excluded.tm_grade,
          confidence = excluded.confidence,
          rationale = excluded.rationale,
          qa_flags_json = excluded.qa_flags_json,
          response_json = excluded.response_json,
          updated_at = excluded.updated_at`
      )
      .run(
        decision.id,
        decision.editorialJobId,
        decision.segmentId,
        decision.sourceText,
        decision.aiTranslation,
        decision.referenceTranslation ?? null,
        decision.editorialTranslation ?? null,
        decision.decision,
        decision.tmGrade,
        decision.confidence,
        decision.rationale ?? null,
        decision.qaFlagsJson,
        decision.responseJson,
        decision.createdAt,
        decision.updatedAt
      );

    return decision;
  }

  listByJob(jobId: string): EditorialDecision[] {
    return this.db
      .prepare(
        `SELECT
          id,
          editorial_job_id AS editorialJobId,
          segment_id AS segmentId,
          source_text AS sourceText,
          ai_translation AS aiTranslation,
          reference_translation AS referenceTranslation,
          editorial_translation AS editorialTranslation,
          decision,
          tm_grade AS tmGrade,
          confidence,
          rationale,
          qa_flags_json AS qaFlagsJson,
          response_json AS responseJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM editorial_decisions
        WHERE editorial_job_id = ?
        ORDER BY created_at ASC`
      )
      .all(jobId) as unknown as EditorialDecision[];
  }
}

export class TranslationSegmentRepository {
  constructor(private readonly db: ProjectDatabase) {}

  upsert(input: UpsertTranslationSegmentInput): TranslationSegment {
    const segment = input.segment;
    this.db
      .prepare(
        `INSERT INTO translation_segments (
          id, job_id, block_id, source_text, ai_translation, editorial_translation,
          reviewed_translation, final_translation, status, response_json,
          editorial_response_json, error_message, source_hash, prompt_hash,
          editorial_prompt_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, block_id, prompt_hash) DO UPDATE SET
          source_text = excluded.source_text,
          ai_translation = excluded.ai_translation,
          editorial_translation = excluded.editorial_translation,
          reviewed_translation = excluded.reviewed_translation,
          final_translation = excluded.final_translation,
          status = excluded.status,
          response_json = excluded.response_json,
          editorial_response_json = excluded.editorial_response_json,
          error_message = excluded.error_message,
          source_hash = excluded.source_hash,
          editorial_prompt_hash = excluded.editorial_prompt_hash,
          updated_at = excluded.updated_at`
      )
      .run(
        segment.id,
        segment.jobId,
        segment.blockId,
        segment.sourceText,
        segment.aiTranslation ?? null,
        segment.editorialTranslation ?? null,
        segment.reviewedTranslation ?? null,
        segment.finalTranslation ?? null,
        segment.status,
        segment.responseJson ?? null,
        segment.editorialResponseJson ?? null,
        segment.errorMessage ?? null,
        segment.sourceHash,
        segment.promptHash,
        segment.editorialPromptHash ?? null,
        segment.createdAt,
        segment.updatedAt
      );

    return segment;
  }

  listByBook(bookId: BookId): TranslationSegment[] {
    return this.db
      .prepare(
        `SELECT
          id,
          job_id AS jobId,
          block_id AS blockId,
          source_text AS sourceText,
          ai_translation AS aiTranslation,
          editorial_translation AS editorialTranslation,
          reviewed_translation AS reviewedTranslation,
          final_translation AS finalTranslation,
          status,
          response_json AS responseJson,
          editorial_response_json AS editorialResponseJson,
          error_message AS errorMessage,
          source_hash AS sourceHash,
          prompt_hash AS promptHash,
          editorial_prompt_hash AS editorialPromptHash,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM translation_segments
        WHERE job_id IN (
          SELECT id FROM translation_jobs WHERE book_id = ?
        )
        ORDER BY created_at ASC`
      )
      .all(bookId) as unknown as TranslationSegment[];
  }

  listByJob(jobId: string): TranslationSegment[] {
    return this.db
      .prepare(
        `SELECT
          id,
          job_id AS jobId,
          block_id AS blockId,
          source_text AS sourceText,
          ai_translation AS aiTranslation,
          editorial_translation AS editorialTranslation,
          reviewed_translation AS reviewedTranslation,
          final_translation AS finalTranslation,
          status,
          response_json AS responseJson,
          editorial_response_json AS editorialResponseJson,
          error_message AS errorMessage,
          source_hash AS sourceHash,
          prompt_hash AS promptHash,
          editorial_prompt_hash AS editorialPromptHash,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM translation_segments
        WHERE job_id = ?
        ORDER BY created_at ASC`
      )
      .all(jobId) as unknown as TranslationSegment[];
  }

  updateFinalTranslation(input: {
    segmentId: SegmentId;
    finalTranslation: string;
    status: TranslationSegment["status"];
  }): TranslationSegment {
    this.db
      .prepare(
        `UPDATE translation_segments
        SET final_translation = ?, reviewed_translation = ?, status = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        input.finalTranslation,
        input.finalTranslation,
        input.status,
        nowTimestamp(),
        input.segmentId
      );

    const segment = this.get(input.segmentId);
    if (!segment) {
      throw new Error(`Translation segment not found: ${input.segmentId}`);
    }

    return segment;
  }

  updateEditorialResult(input: {
    segmentId: SegmentId;
    editorialTranslation?: string;
    finalTranslation?: string;
    status: TranslationSegment["status"];
    editorialResponseJson?: string;
    editorialPromptHash?: string;
    errorMessage?: string;
  }): TranslationSegment {
    this.db
      .prepare(
        `UPDATE translation_segments
        SET editorial_translation = ?,
            final_translation = COALESCE(?, final_translation),
            status = ?,
            editorial_response_json = ?,
            editorial_prompt_hash = ?,
            error_message = ?,
            updated_at = ?
        WHERE id = ?`
      )
      .run(
        input.editorialTranslation ?? null,
        input.finalTranslation ?? null,
        input.status,
        input.editorialResponseJson ?? null,
        input.editorialPromptHash ?? null,
        input.errorMessage ?? null,
        nowTimestamp(),
        input.segmentId
      );

    const segment = this.get(input.segmentId);
    if (!segment) {
      throw new Error(`Translation segment not found: ${input.segmentId}`);
    }

    return segment;
  }

  get(segmentId: SegmentId): TranslationSegment | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          job_id AS jobId,
          block_id AS blockId,
          source_text AS sourceText,
          ai_translation AS aiTranslation,
          editorial_translation AS editorialTranslation,
          reviewed_translation AS reviewedTranslation,
          final_translation AS finalTranslation,
          status,
          response_json AS responseJson,
          editorial_response_json AS editorialResponseJson,
          error_message AS errorMessage,
          source_hash AS sourceHash,
          prompt_hash AS promptHash,
          editorial_prompt_hash AS editorialPromptHash,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM translation_segments
        WHERE id = ?`
      )
      .get(segmentId) as TranslationSegment | undefined;
  }

  findCached(input: {
    bookId: BookId;
    blockId: string;
    sourceHash: string;
    promptHash: string;
    provider: string;
    model: string;
  }): TranslationSegment | undefined {
    return this.db
      .prepare(
        `SELECT
          s.id,
          s.job_id AS jobId,
          s.block_id AS blockId,
          s.source_text AS sourceText,
          s.ai_translation AS aiTranslation,
          s.editorial_translation AS editorialTranslation,
          s.reviewed_translation AS reviewedTranslation,
          s.final_translation AS finalTranslation,
          s.status,
          s.response_json AS responseJson,
          s.editorial_response_json AS editorialResponseJson,
          s.error_message AS errorMessage,
          s.source_hash AS sourceHash,
          s.prompt_hash AS promptHash,
          s.editorial_prompt_hash AS editorialPromptHash,
          s.created_at AS createdAt,
          s.updated_at AS updatedAt
        FROM translation_segments s
        JOIN translation_jobs j ON j.id = s.job_id
        WHERE j.book_id = ?
          AND s.block_id = ?
          AND s.source_hash = ?
          AND s.prompt_hash = ?
          AND j.provider = ?
          AND j.model = ?
          AND s.status = 'translated'
          AND COALESCE(s.final_translation, s.ai_translation) IS NOT NULL
        ORDER BY s.updated_at DESC
        LIMIT 1`
      )
      .get(
        input.bookId,
        input.blockId,
        input.sourceHash,
        input.promptHash,
        input.provider,
        input.model
      ) as TranslationSegment | undefined;
  }
}

export class GlossaryTermRepository {
  constructor(private readonly db: ProjectDatabase) {}

  upsert(input: UpsertGlossaryTermInput): GlossaryTerm {
    const term = input.term;
    this.db
      .prepare(
        `INSERT INTO glossary_terms (
          id, project_id, source_term, canonical_ko, category, aliases,
          forbidden_targets, context_rules, notes, confidence, do_not_translate,
          needs_review, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, source_term) DO UPDATE SET
          canonical_ko = excluded.canonical_ko,
          category = excluded.category,
          aliases = excluded.aliases,
          forbidden_targets = excluded.forbidden_targets,
          context_rules = excluded.context_rules,
          notes = excluded.notes,
          confidence = excluded.confidence,
          do_not_translate = excluded.do_not_translate,
          needs_review = excluded.needs_review,
          updated_at = excluded.updated_at`
      )
      .run(
        term.id,
        term.projectId,
        term.sourceTerm,
        term.canonicalKo,
        term.category,
        term.aliases ?? null,
        term.forbiddenTargets ?? null,
        term.contextRules ?? null,
        term.notes ?? null,
        term.confidence,
        term.doNotTranslate ? 1 : 0,
        term.needsReview ? 1 : 0,
        term.createdAt,
        term.updatedAt
      );

    return term;
  }

  list(projectId: ProjectId): GlossaryTerm[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          source_term AS sourceTerm,
          canonical_ko AS canonicalKo,
          category,
          aliases,
          forbidden_targets AS forbiddenTargets,
          context_rules AS contextRules,
          notes,
          confidence,
          do_not_translate AS doNotTranslate,
          needs_review AS needsReview,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM glossary_terms
        WHERE project_id = ?
        ORDER BY source_term ASC`
      )
      .all(projectId)
      .map(normalizeGlossaryTerm);
  }

  delete(projectId: ProjectId, termId: string): void {
    this.db
      .prepare("DELETE FROM glossary_terms WHERE project_id = ? AND id = ?")
      .run(projectId, termId);
  }
}

export class TmUnitRepository {
  constructor(private readonly db: ProjectDatabase) {}

  upsert(input: UpsertTmUnitInput): TmUnit {
    const unit = input.unit;
    this.db
      .prepare(
        `INSERT INTO tm_units (
          id, project_id, book_id, source_text, target_text, source_hash,
          grade, origin, confidence, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          book_id = excluded.book_id,
          source_text = excluded.source_text,
          target_text = excluded.target_text,
          source_hash = excluded.source_hash,
          grade = excluded.grade,
          origin = excluded.origin,
          confidence = excluded.confidence,
          notes = excluded.notes,
          updated_at = excluded.updated_at`
      )
      .run(
        unit.id,
        unit.projectId,
        unit.bookId ?? null,
        unit.sourceText,
        unit.targetText,
        unit.sourceHash,
        unit.grade,
        unit.origin,
        unit.confidence ?? null,
        unit.notes ?? null,
        unit.createdAt,
        unit.updatedAt
      );

    return unit;
  }

  list(projectId: ProjectId): TmUnit[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          source_text AS sourceText,
          target_text AS targetText,
          source_hash AS sourceHash,
          grade,
          origin,
          confidence,
          notes,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM tm_units
        WHERE project_id = ?
        ORDER BY updated_at DESC`
      )
      .all(projectId) as unknown as TmUnit[];
  }

  listUsable(projectId: ProjectId): TmUnit[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          source_text AS sourceText,
          target_text AS targetText,
          source_hash AS sourceHash,
          grade,
          origin,
          confidence,
          notes,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM tm_units
        WHERE project_id = ?
          AND grade != 'rejected'
        ORDER BY updated_at DESC`
      )
      .all(projectId) as unknown as TmUnit[];
  }

  promoteGoldCandidateToGold(projectId: ProjectId, unitId: string): TmUnit {
    this.db
      .prepare(
        `UPDATE tm_units
        SET grade = 'gold', origin = 'user_approved', updated_at = ?
        WHERE project_id = ? AND id = ? AND grade = 'gold_candidate'`
      )
      .run(nowTimestamp(), projectId, unitId);

    const unit = this.get(projectId, unitId);
    if (!unit) {
      throw new Error(`TM unit not found: ${unitId}`);
    }
    return unit;
  }

  reject(projectId: ProjectId, unitId: string): TmUnit {
    this.db
      .prepare(
        `UPDATE tm_units
        SET grade = 'rejected', updated_at = ?
        WHERE project_id = ? AND id = ?`
      )
      .run(nowTimestamp(), projectId, unitId);

    const unit = this.get(projectId, unitId);
    if (!unit) {
      throw new Error(`TM unit not found: ${unitId}`);
    }
    return unit;
  }

  delete(projectId: ProjectId, unitId: string): void {
    this.db.prepare("DELETE FROM tm_units WHERE project_id = ? AND id = ?").run(projectId, unitId);
  }

  get(projectId: ProjectId, unitId: string): TmUnit | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          source_text AS sourceText,
          target_text AS targetText,
          source_hash AS sourceHash,
          grade,
          origin,
          confidence,
          notes,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM tm_units
        WHERE project_id = ? AND id = ?`
      )
      .get(projectId, unitId) as TmUnit | undefined;
  }
}

export class PostReadCorrectionRepository {
  constructor(private readonly db: ProjectDatabase) {}

  create(input: CreatePostReadCorrectionInput): PostReadCorrection {
    const correction = input.correction;
    this.db
      .prepare(
        `INSERT INTO post_read_corrections (
          id, project_id, book_id, segment_id, source_text, before_text,
          corrected_text, note, promoted_tm_unit_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        correction.id,
        correction.projectId,
        correction.bookId,
        correction.segmentId,
        correction.sourceText,
        correction.beforeText,
        correction.correctedText,
        correction.note ?? null,
        correction.promotedTmUnitId ?? null,
        correction.createdAt,
        correction.updatedAt
      );

    return correction;
  }

  listByBook(projectId: ProjectId, bookId: BookId): PostReadCorrection[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          segment_id AS segmentId,
          source_text AS sourceText,
          before_text AS beforeText,
          corrected_text AS correctedText,
          note,
          promoted_tm_unit_id AS promotedTmUnitId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM post_read_corrections
        WHERE project_id = ? AND book_id = ?
        ORDER BY created_at DESC`
      )
      .all(projectId, bookId) as unknown as PostReadCorrection[];
  }

  get(projectId: ProjectId, correctionId: string): PostReadCorrection | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          segment_id AS segmentId,
          source_text AS sourceText,
          before_text AS beforeText,
          corrected_text AS correctedText,
          note,
          promoted_tm_unit_id AS promotedTmUnitId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM post_read_corrections
        WHERE project_id = ? AND id = ?`
      )
      .get(projectId, correctionId) as PostReadCorrection | undefined;
  }

  markPromoted(input: {
    projectId: ProjectId;
    correctionId: string;
    tmUnitId: string;
  }): PostReadCorrection {
    this.db
      .prepare(
        `UPDATE post_read_corrections
        SET promoted_tm_unit_id = ?, updated_at = ?
        WHERE project_id = ? AND id = ?`
      )
      .run(input.tmUnitId, nowTimestamp(), input.projectId, input.correctionId);

    const correction = this.get(input.projectId, input.correctionId);
    if (!correction) {
      throw new Error(`Post-read correction not found: ${input.correctionId}`);
    }
    return correction;
  }
}

export class ReferenceBlockRepository {
  constructor(private readonly db: ProjectDatabase) {}

  replaceForDocument(input: CreateReferenceBlocksInput): void {
    if (input.blocks.length === 0) {
      return;
    }

    const first = input.blocks[0]!;
    const deleteAlignmentPairs = this.db.prepare(
      "DELETE FROM alignment_pairs WHERE project_id = ? AND book_id = ?"
    );
    const deleteReferenceBlocks = this.db.prepare(
      "DELETE FROM reference_blocks WHERE project_id = ? AND book_id = ?"
    );
    const insert = this.db.prepare(
      `INSERT INTO reference_blocks (
        id, project_id, book_id, document_id, block_index, chapter_index, spine_href, title, reference_text,
        normalized_text, text_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    dbTransaction(this.db, () => {
      deleteAlignmentPairs.run(first.projectId, first.bookId);
      deleteReferenceBlocks.run(first.projectId, first.bookId);

      for (const block of input.blocks) {
        insert.run(
          block.id,
          block.projectId,
          block.bookId,
          block.documentId,
          block.blockIndex,
          block.chapterIndex ?? null,
          block.spineHref ?? null,
          block.title ?? null,
          block.referenceText,
          block.normalizedText,
          block.textHash,
          block.createdAt
        );
      }
    });
  }

  listByBook(projectId: ProjectId, bookId: BookId): ReferenceBlock[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          document_id AS documentId,
          block_index AS blockIndex,
          chapter_index AS chapterIndex,
          spine_href AS spineHref,
          title,
          reference_text AS referenceText,
          normalized_text AS normalizedText,
          text_hash AS textHash,
          created_at AS createdAt
        FROM reference_blocks
        WHERE project_id = ? AND book_id = ?
        ORDER BY block_index ASC`
      )
      .all(projectId, bookId) as unknown as ReferenceBlock[];
  }
}

export class AlignmentPairRepository {
  constructor(private readonly db: ProjectDatabase) {}

  replaceCandidatesForBook(input: UpsertAlignmentPairsInput): void {
    if (input.pairs.length === 0) {
      return;
    }

    const first = input.pairs[0]!;
    this.db
      .prepare("DELETE FROM alignment_pairs WHERE project_id = ? AND book_id = ? AND status = 'candidate'")
      .run(first.projectId, first.bookId);

    const insert = this.db.prepare(
      `INSERT INTO alignment_pairs (
        id, project_id, book_id, source_block_id, reference_block_id,
        source_text, reference_text, confidence, status, promoted_tm_unit_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, book_id, source_block_id, reference_block_id) DO UPDATE SET
        source_text = excluded.source_text,
        reference_text = excluded.reference_text,
        confidence = excluded.confidence,
        status = excluded.status,
        updated_at = excluded.updated_at`
    );

    dbTransaction(this.db, () => {
      for (const pair of input.pairs) {
        insert.run(
          pair.id,
          pair.projectId,
          pair.bookId,
          pair.sourceBlockId,
          pair.referenceBlockId,
          pair.sourceText,
          pair.referenceText,
          pair.confidence,
          pair.status,
          pair.promotedTmUnitId ?? null,
          pair.createdAt,
          pair.updatedAt
        );
      }
    });
  }

  listByBook(projectId: ProjectId, bookId: BookId): AlignmentPair[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          source_block_id AS sourceBlockId,
          reference_block_id AS referenceBlockId,
          source_text AS sourceText,
          reference_text AS referenceText,
          confidence,
          status,
          promoted_tm_unit_id AS promotedTmUnitId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM alignment_pairs
        WHERE project_id = ? AND book_id = ?
        ORDER BY created_at ASC`
      )
      .all(projectId, bookId) as unknown as AlignmentPair[];
  }

  get(projectId: ProjectId, pairId: string): AlignmentPair | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          source_block_id AS sourceBlockId,
          reference_block_id AS referenceBlockId,
          source_text AS sourceText,
          reference_text AS referenceText,
          confidence,
          status,
          promoted_tm_unit_id AS promotedTmUnitId,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM alignment_pairs
        WHERE project_id = ? AND id = ?`
      )
      .get(projectId, pairId) as AlignmentPair | undefined;
  }

  updateStatus(input: {
    projectId: ProjectId;
    pairId: string;
    status: AlignmentPair["status"];
    tmUnitId?: string;
  }): AlignmentPair {
    this.db
      .prepare(
        `UPDATE alignment_pairs
        SET status = ?, promoted_tm_unit_id = COALESCE(?, promoted_tm_unit_id), updated_at = ?
        WHERE project_id = ? AND id = ?`
      )
      .run(input.status, input.tmUnitId ?? null, nowTimestamp(), input.projectId, input.pairId);

    const pair = this.get(input.projectId, input.pairId);
    if (!pair) {
      throw new Error(`Alignment pair not found: ${input.pairId}`);
    }
    return pair;
  }
}

export class StylebookEntryRepository {
  constructor(private readonly db: ProjectDatabase) {}

  upsert(input: UpsertStylebookEntryInput): StylebookEntry {
    const entry = input.entry;
    this.db
      .prepare(
        `INSERT INTO stylebook_entries (
          id, project_id, entry_type, title, body, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          entry_type = excluded.entry_type,
          title = excluded.title,
          body = excluded.body,
          priority = excluded.priority,
          updated_at = excluded.updated_at`
      )
      .run(
        entry.id,
        entry.projectId,
        entry.entryType,
        entry.title,
        entry.body,
        entry.priority,
        entry.createdAt,
        entry.updatedAt
      );
    return entry;
  }

  list(projectId: ProjectId): StylebookEntry[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          entry_type AS entryType,
          title,
          body,
          priority,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM stylebook_entries
        WHERE project_id = ?
        ORDER BY priority DESC, updated_at DESC`
      )
      .all(projectId) as unknown as StylebookEntry[];
  }
}

export class CharacterProfileRepository {
  constructor(private readonly db: ProjectDatabase) {}

  upsert(input: UpsertCharacterProfileInput): CharacterProfile {
    const profile = input.profile;
    this.db
      .prepare(
        `INSERT INTO character_profiles (
          id, project_id, name, aliases, description, speech_style,
          translation_notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          aliases = excluded.aliases,
          description = excluded.description,
          speech_style = excluded.speech_style,
          translation_notes = excluded.translation_notes,
          updated_at = excluded.updated_at`
      )
      .run(
        profile.id,
        profile.projectId,
        profile.name,
        profile.aliases ?? null,
        profile.description ?? null,
        profile.speechStyle ?? null,
        profile.translationNotes ?? null,
        profile.createdAt,
        profile.updatedAt
      );
    return profile;
  }

  list(projectId: ProjectId): CharacterProfile[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          name,
          aliases,
          description,
          speech_style AS speechStyle,
          translation_notes AS translationNotes,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM character_profiles
        WHERE project_id = ?
        ORDER BY name ASC`
      )
      .all(projectId) as unknown as CharacterProfile[];
  }
}

export class ChapterMemoryRepository {
  constructor(private readonly db: ProjectDatabase) {}

  upsert(input: UpsertChapterMemoryInput): ChapterMemory {
    const memory = input.memory;
    this.db
      .prepare(
        `INSERT INTO chapter_memories (
          id, project_id, book_id, chapter_id, summary, term_notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, chapter_id) DO UPDATE SET
          summary = excluded.summary,
          term_notes = excluded.term_notes,
          updated_at = excluded.updated_at`
      )
      .run(
        memory.id,
        memory.projectId,
        memory.bookId,
        memory.chapterId,
        memory.summary,
        memory.termNotes ?? null,
        memory.createdAt,
        memory.updatedAt
      );
    return memory;
  }

  listByBook(projectId: ProjectId, bookId: BookId): ChapterMemory[] {
    return this.db
      .prepare(
        `SELECT
          id,
          project_id AS projectId,
          book_id AS bookId,
          chapter_id AS chapterId,
          summary,
          term_notes AS termNotes,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM chapter_memories
        WHERE project_id = ? AND book_id = ?
        ORDER BY updated_at DESC`
      )
      .all(projectId, bookId) as unknown as ChapterMemory[];
  }
}

function normalizeGlossaryTerm(row: unknown): GlossaryTerm {
  const term = row as Omit<GlossaryTerm, "doNotTranslate" | "needsReview"> & {
    doNotTranslate: number;
    needsReview: number;
  };

  return {
    ...term,
    doNotTranslate: Boolean(term.doNotTranslate),
    needsReview: Boolean(term.needsReview)
  };
}

function dbTransaction(db: ProjectDatabase, callback: () => void): void {
  db.exec("BEGIN;");
  try {
    callback();
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function runMigrations(db: ProjectDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationDir = [join(currentDir, "migrations"), join(currentDir, "..", "migrations")].find(
    (candidate) => existsSync(candidate)
  );

  if (!migrationDir) {
    throw new Error("Migration directory was not found.");
  }

  const migrationFiles = readdirSync(migrationDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b));

  for (const file of migrationFiles) {
    const migrationId = file.replace(/\.sql$/, "");
    const existing = db
      .prepare("SELECT id FROM schema_migrations WHERE id = ?")
      .get(migrationId);

    if (!existing) {
      db.exec("BEGIN;");
      try {
        db.exec(readFileSync(join(migrationDir, file), "utf8"));
        db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
          migrationId,
          nowTimestamp()
        );
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    }
  }
}

export class ProjectRepository {
  constructor(private readonly db: ProjectDatabase) {}

  create(input: CreateProjectInput): Project {
    const createdAt = nowTimestamp();
    const project: Project = {
      id: input.id,
      name: input.name,
      seriesName: input.seriesName,
      sourceLang: input.sourceLang ?? "en",
      targetLang: input.targetLang ?? "ko",
      workspacePath: input.workspacePath,
      createdAt,
      updatedAt: createdAt
    };

    this.db
      .prepare(
        `INSERT INTO projects (
          id, name, series_name, source_lang, target_lang, workspace_path, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?
        )`
      )
      .run(
        project.id,
        project.name,
        project.seriesName ?? null,
        project.sourceLang,
        project.targetLang,
        project.workspacePath,
        project.createdAt,
        project.updatedAt
      );

    return project;
  }

  list(): Project[] {
    return this.db
      .prepare(
        `SELECT
          id,
          name,
          series_name AS seriesName,
          source_lang AS sourceLang,
          target_lang AS targetLang,
          workspace_path AS workspacePath,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM projects
        ORDER BY updated_at DESC`
      )
      .all() as unknown as Project[];
  }

  get(projectId: ProjectId): Project | undefined {
    return this.db
      .prepare(
        `SELECT
          id,
          name,
          series_name AS seriesName,
          source_lang AS sourceLang,
          target_lang AS targetLang,
          workspace_path AS workspacePath,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM projects
        WHERE id = ?`
      )
      .get(projectId) as Project | undefined;
  }
}
