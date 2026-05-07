import { randomUUID } from "node:crypto";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { config as loadDotenv } from "dotenv";
import {
  BookRepository,
  ChapterRepository,
  openProjectDatabase,
  ProjectRepository,
  SourceDocumentRepository,
  TextBlockRepository,
  TranslationJobRepository,
  TranslationSegmentRepository
} from "@sts/db";
import {
  copyEpubToWorkspace,
  extractTextBlocks,
  parseOpf,
  rebuildEpub,
  unpackEpub
} from "@sts/epub-core";
import { MockTranslationProvider, translateTextBlock } from "@sts/translator-core";
import { VertexTranslationProvider } from "@sts/vertex-provider";
import type {
  Book,
  BookId,
  Chapter,
  ExportedBookSummary,
  ImportedBookSummary,
  JobId,
  ProviderValidationSummary,
  Project,
  ProjectId,
  SourceDocument,
  TranslationJob,
  TranslationRunSummary
} from "@sts/common";
import { nowTimestamp } from "@sts/common";

interface CreateProjectRequest {
  name: string;
  seriesName?: string;
}

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const currentDir = dirname(fileURLToPath(import.meta.url));

loadEnvironment();

function loadEnvironment(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(currentDir, "..", "..", ".env"),
    resolve(currentDir, "..", "..", "..", ".env")
  ];
  const loaded = new Set<string>();

  for (const path of candidates) {
    if (!loaded.has(path) && existsSync(path)) {
      loadDotenv({ path, override: false });
      loaded.add(path);
    }
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "Series Translation Studio",
    backgroundColor: "#f7f5f1",
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
  }
}

function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "project";
}

function projectsRoot(): string {
  return process.env.STS_WORKSPACE_DIR ?? join(app.getPath("userData"), "projects");
}

function projectSqlitePath(projectDir: string): string {
  return join(projectDir, "project.sqlite");
}

function createProjectWorkspace(name: string): string {
  const root = projectsRoot();
  mkdirSync(root, { recursive: true });

  const baseName = slugifyProjectName(name);
  let projectDir = join(root, baseName);
  let suffix = 2;

  while (existsSync(projectDir)) {
    projectDir = join(root, `${baseName}-${suffix}`);
    suffix += 1;
  }

  mkdirSync(projectDir, { recursive: true });
  for (const child of ["source", "extracted", "cache", "output", "exports", "logs"]) {
    mkdirSync(join(projectDir, child), { recursive: true });
  }

  return projectDir;
}

function readProjects(): Project[] {
  const root = projectsRoot();
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const sqlitePath = projectSqlitePath(join(root, entry.name));
      if (!existsSync(sqlitePath)) {
        return [];
      }

      const db = openProjectDatabase({ sqlitePath });
      try {
        return new ProjectRepository(db).list();
      } finally {
        db.close();
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function findProject(projectId: ProjectId): Project {
  const project = readProjects().find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return project;
}

function openProjectDb(project: Project) {
  return openProjectDatabase({ sqlitePath: projectSqlitePath(project.workspacePath) });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\s+/g, " ").trim() || "book";
}

function createTranslationProvider() {
  return process.env.STS_TRANSLATION_PROVIDER === "vertex"
    ? new VertexTranslationProvider()
    : new MockTranslationProvider();
}

function currentProviderName(): "mock" | "vertex" {
  return process.env.STS_TRANSLATION_PROVIDER === "vertex" ? "vertex" : "mock";
}

function currentProviderModel(): string {
  return currentProviderName() === "vertex"
    ? (process.env.VERTEX_MODEL ?? "gemini-2.5-flash")
    : "mock";
}

function currentProviderConfigJson(): string {
  return JSON.stringify({
    provider: currentProviderName(),
    projectId: process.env.VERTEX_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? undefined,
    location: process.env.VERTEX_LOCATION ?? "us-central1",
    model: currentProviderModel(),
    timeoutMs: Number(process.env.VERTEX_TIMEOUT_MS ?? 60000)
  });
}

async function validateTranslationProvider(): Promise<ProviderValidationSummary> {
  const provider = createTranslationProvider();
  const result = await provider.validateConfig();

  return {
    provider: provider.name,
    ok: result.ok,
    message: result.message,
    configSource: ".env"
  };
}

async function importEpubForProject(projectId: ProjectId): Promise<ImportedBookSummary | undefined> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "EPUB 원서 추가",
    properties: ["openFile"],
    filters: [{ name: "EPUB", extensions: ["epub"] }]
  });

  if (canceled || !filePaths[0]) {
    return undefined;
  }

  const epubPath = filePaths[0];
  const project = findProject(projectId);
  const bookId = randomUUID() as BookId;
  const documentId = randomUUID();
  const copied = copyEpubToWorkspace({
    epubPath,
    workspaceSourceDir: join(project.workspacePath, "source", "en"),
    bookId
  });
  const unpacked = await unpackEpub({
    epubPath: copied.copiedPath,
    outputDir: join(project.workspacePath, "extracted", bookId)
  });
  const opf = parseOpf({
    extractedDir: unpacked.extractedDir,
    opfPath: unpacked.rootfilePath
  });
  const chapters = await extractTextBlocks({
    documentId,
    spineItems: opf.spineItems,
    extractedDir: unpacked.extractedDir,
    opfPath: unpacked.rootfilePath
  });

  const db = openProjectDb(project);
  try {
    const book = new BookRepository(db).create({
      id: bookId,
      projectId,
      title: opf.title || parsePath(basename(epubPath)).name,
      originalTitle: opf.title,
      sourceLang: project.sourceLang,
      targetLang: project.targetLang
    });
    const document: SourceDocument = {
      id: documentId,
      bookId,
      filePath: copied.copiedPath,
      fileType: "epub",
      fileHash: copied.fileHash,
      role: "source_original",
      importedAt: nowTimestamp()
    };
    new SourceDocumentRepository(db).create(document);

    new ChapterRepository(db).createMany(
      chapters.map(
        (chapter): Chapter => ({
          id: chapter.id,
          bookId,
          documentId,
          chapterIndex: chapter.chapterIndex,
          title: chapter.title,
          spineHref: chapter.spineHref,
          createdAt: nowTimestamp()
        })
      )
    );
    const blocks = chapters.flatMap((chapter) => chapter.blocks);
    new TextBlockRepository(db).createMany(blocks);

    return {
      book,
      document,
      chapterCount: chapters.length,
      blockCount: blocks.length,
      extractedDir: unpacked.extractedDir
    };
  } finally {
    db.close();
  }
}

async function exportBookForProject(
  projectId: ProjectId,
  bookId: BookId
): Promise<ExportedBookSummary> {
  const project = findProject(projectId);
  const db = openProjectDb(project);

  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const chapters = new ChapterRepository(db).listByBook(bookId);
    const blocks = new TextBlockRepository(db).listByChapterIds(
      chapters.map((chapter) => chapter.id)
    );
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const outputPath = join(
      project.workspacePath,
      "output",
      `${sanitizeFileName(book.title)}.m1-export.epub`
    );

    await rebuildEpub({
      extractedDir: join(project.workspacePath, "extracted", book.id),
      outputPath,
      replacements: blocks.map((block) => {
        const chapter = chapterById.get(block.chapterId);
        if (!chapter?.spineHref) {
          throw new Error(`Chapter not found for text block: ${block.id}`);
        }

        return {
          spineHref: chapter.spineHref,
          xpath: block.xpath,
          text: `[M1 export] ${block.sourceText}`
        };
      })
    });

    return {
      book,
      outputPath,
      replacementCount: blocks.length
    };
  } finally {
    db.close();
  }
}

async function translateFirstChapterForProject(
  projectId: ProjectId,
  bookId: BookId
): Promise<TranslationRunSummary> {
  const project = findProject(projectId);
  const db = openProjectDb(project);

  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const firstChapter = new ChapterRepository(db).listByBook(bookId)[0];
    if (!firstChapter) {
      throw new Error(`No imported chapters found for book: ${book.title}`);
    }

    const blocks = new TextBlockRepository(db).listByChapterIds([firstChapter.id]);
    const provider = createTranslationProvider();
    const now = nowTimestamp();
    const job: TranslationJob = {
      id: randomUUID() as JobId,
      projectId,
      bookId,
      provider: provider.name,
      model: currentProviderModel(),
      status: "running",
      configJson: currentProviderConfigJson(),
      startedAt: now,
      createdAt: now,
      updatedAt: now
    };
    new TranslationJobRepository(db).create({ job });
    const segmentRepository = new TranslationSegmentRepository(db);
    let translatedCount = 0;
    let errorCount = 0;

    for (const block of blocks) {
      const segment = await translateTextBlock({
        jobId: job.id,
        block,
        provider
      });
      segmentRepository.upsert({ segment });
      if (segment.status === "translated") {
        translatedCount += 1;
      } else {
        errorCount += 1;
      }
    }

    const completedAt = nowTimestamp();
    job.status = errorCount > 0 && translatedCount === 0 ? "failed" : "completed";
    job.completedAt = completedAt;
    job.updatedAt = completedAt;
    new TranslationJobRepository(db).updateStatus({
      jobId: job.id,
      status: job.status,
      completedAt
    });

    return {
      book,
      job,
      translatedCount,
      errorCount,
      segmentCount: blocks.length
    };
  } finally {
    db.close();
  }
}

async function exportTranslatedBookForProject(
  projectId: ProjectId,
  bookId: BookId
): Promise<ExportedBookSummary> {
  const project = findProject(projectId);
  const db = openProjectDb(project);

  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const chapters = new ChapterRepository(db).listByBook(bookId);
    const blocks = new TextBlockRepository(db).listByChapterIds(
      chapters.map((chapter) => chapter.id)
    );
    const segments = new TranslationSegmentRepository(db).listByBook(bookId);
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const segmentByBlockId = new Map(segments.map((segment) => [segment.blockId, segment]));
    const outputPath = join(
      project.workspacePath,
      "output",
      `${sanitizeFileName(book.title)}.ko-draft.epub`
    );

    await rebuildEpub({
      extractedDir: join(project.workspacePath, "extracted", book.id),
      outputPath,
      metadata: {
        title: `${book.title} KO Draft`
      },
      replacements: blocks.map((block) => {
        const chapter = chapterById.get(block.chapterId);
        if (!chapter?.spineHref) {
          throw new Error(`Chapter not found for text block: ${block.id}`);
        }

        const segment = segmentByBlockId.get(block.id);
        return {
          spineHref: chapter.spineHref,
          xpath: block.xpath,
          text: segment?.finalTranslation ?? segment?.aiTranslation ?? block.sourceText
        };
      })
    });

    return {
      book,
      outputPath,
      replacementCount: segments.filter((segment) => segment.finalTranslation ?? segment.aiTranslation)
        .length
    };
  } finally {
    db.close();
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle("project:create", (_event, input: CreateProjectRequest): Project => {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Project name is required.");
    }

    const workspacePath = createProjectWorkspace(name);
    const db = openProjectDatabase({ sqlitePath: projectSqlitePath(workspacePath) });
    try {
      return new ProjectRepository(db).create({
        id: randomUUID() as ProjectId,
        name,
        seriesName: input.seriesName?.trim() || undefined,
        workspacePath
      });
    } finally {
      db.close();
    }
  });

  ipcMain.handle("project:list", (): Project[] => readProjects());

  ipcMain.handle("book:list", (_event, projectId: ProjectId): Book[] => {
    const project = findProject(projectId);
    const db = openProjectDb(project);
    try {
      return new BookRepository(db).list(projectId);
    } finally {
      db.close();
    }
  });

  ipcMain.handle("book:importEpub", (_event, projectId: ProjectId) =>
    importEpubForProject(projectId)
  );

  ipcMain.handle("book:exportM1", (_event, projectId: ProjectId, bookId: BookId) =>
    exportBookForProject(projectId, bookId)
  );

  ipcMain.handle("book:translateM2", (_event, projectId: ProjectId, bookId: BookId) =>
    translateFirstChapterForProject(projectId, bookId)
  );

  ipcMain.handle("book:exportTranslated", (_event, projectId: ProjectId, bookId: BookId) =>
    exportTranslatedBookForProject(projectId, bookId)
  );

  ipcMain.handle("settings:validateProvider", () => validateTranslationProvider());
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
