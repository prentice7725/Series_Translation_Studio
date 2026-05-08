import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Book,
  BookId,
  Chapter,
  GlossaryTerm,
  Project,
  ProjectId,
  SourceDocument,
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
}

export interface UpsertTranslationSegmentInput {
  segment: TranslationSegment;
}

export interface CreateTranslationJobInput {
  job: TranslationJob;
}

export interface UpsertGlossaryTermInput {
  term: GlossaryTerm;
}

export interface UpsertTmUnitInput {
  unit: TmUnit;
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
      createdAt,
      updatedAt: createdAt
    };

    this.db
      .prepare(
        `INSERT INTO books (
          id, project_id, title, original_title, author, series_index,
          source_lang, target_lang, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM books
        WHERE project_id = ?
        ORDER BY created_at DESC`
      )
      .all(projectId) as unknown as Book[];
  }
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
