import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Book,
  BookId,
  Chapter,
  Project,
  ProjectId,
  SourceDocument,
  TextBlock
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

  const migrationPath = [
    join(currentDir, "migrations", "0001_initial.sql"),
    join(currentDir, "..", "migrations", "0001_initial.sql")
  ].find((candidate) => existsSync(candidate));

  if (!migrationPath) {
    throw new Error("Migration file 0001_initial.sql was not found.");
  }

  const migrationId = "0001_initial";
  const existing = db
    .prepare("SELECT id FROM schema_migrations WHERE id = ?")
    .get(migrationId);

  if (!existing) {
    db.exec("BEGIN;");
    try {
      db.exec(readFileSync(migrationPath, "utf8"));
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
