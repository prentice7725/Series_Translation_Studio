import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Book,
  BookId,
  Chapter,
  Project,
  ProjectId,
  SourceDocument,
  TextBlock,
  TranslationJob,
  TranslationSegment
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
