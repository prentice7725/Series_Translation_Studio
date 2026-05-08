import { randomUUID } from "node:crypto";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { config as loadDotenv } from "dotenv";
import {
  BookRepository,
  ChapterRepository,
  GlossaryTermRepository,
  openProjectDatabase,
  ProjectRepository,
  SourceDocumentRepository,
  TextBlockRepository,
  TmUnitRepository,
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
import {
  buildGlossaryPromptSection,
  exportGlossaryCsv,
  findGlossaryHits,
  glossaryVersionHash,
  parseGlossaryCsv,
  validateGlossaryTranslation
} from "@sts/glossary-core";
import { buildTmPromptSection, findTmMatches, tmSourceHash, tmVersionHash } from "@sts/tm-core";
import {
  createTranslationCacheKey,
  literaryKoPrompt,
  literaryKoPromptVersion,
  MockTranslationProvider,
  sha256,
  translateTextBlock
} from "@sts/translator-core";
import { VertexTranslationProvider } from "@sts/vertex-provider";
import type {
  Book,
  BookId,
  Chapter,
  ExportedBookSummary,
  GlossaryImportSummary,
  GlossaryTerm,
  ImportedBookSummary,
  JobId,
  ProviderValidationSummary,
  Project,
  ProjectId,
  ReviewSegmentSummary,
  SegmentId,
  SourceDocument,
  TmGrade,
  TmOrigin,
  TmUnit,
  TranslationJob,
  TranslationJobProgress,
  TranslationRunSummary
} from "@sts/common";
import { nowTimestamp } from "@sts/common";

interface CreateProjectRequest {
  name: string;
  seriesName?: string;
}

interface SaveGlossaryTermRequest {
  sourceTerm: string;
  canonicalKo: string;
  category?: string;
  aliases?: string;
  forbiddenTargets?: string;
  contextRules?: string;
  notes?: string;
  confidence?: GlossaryTerm["confidence"];
  doNotTranslate?: boolean;
  needsReview?: boolean;
}

interface SaveTmUnitRequest {
  bookId?: BookId;
  sourceText: string;
  targetText: string;
  grade?: TmGrade;
  origin?: TmOrigin;
  confidence?: number;
  notes?: string;
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

function sendTranslationProgress(progress: TranslationJobProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("translation:progress", progress);
  }
}

function readCacheHit(segment: { responseJson?: string }): boolean {
  if (!segment.responseJson) {
    return false;
  }

  try {
    return (JSON.parse(segment.responseJson) as { cacheHit?: unknown }).cacheHit === true;
  } catch {
    return false;
  }
}

function buildProgress(input: {
  job: TranslationJob;
  segments: Array<{ status: string; responseJson?: string }>;
  segmentCount: number;
}): TranslationJobProgress {
  const statusCounts = input.segments.reduce<Record<string, number>>((counts, segment) => {
    counts[segment.status] = (counts[segment.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    job: input.job,
    segmentCount: input.segmentCount,
    translatedCount: statusCounts.translated ?? 0,
    errorCount: statusCounts.error ?? 0,
    cacheHitCount: input.segments.filter(readCacheHit).length,
    statusCounts
  };
}

function listGlossaryTerms(projectId: ProjectId): GlossaryTerm[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new GlossaryTermRepository(db).list(projectId);
  } finally {
    db.close();
  }
}

function saveGlossaryTerm(
  projectId: ProjectId,
  input: SaveGlossaryTermRequest
): GlossaryTerm {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  const now = nowTimestamp();
  try {
    return new GlossaryTermRepository(db).upsert({
      term: {
        id: randomUUID(),
        projectId,
        sourceTerm: input.sourceTerm.trim(),
        canonicalKo: input.canonicalKo.trim(),
        category: input.category?.trim() || "term",
        aliases: input.aliases?.trim() || undefined,
        forbiddenTargets: input.forbiddenTargets?.trim() || undefined,
        contextRules: input.contextRules?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        confidence: input.confidence ?? "candidate",
        doNotTranslate: Boolean(input.doNotTranslate),
        needsReview: Boolean(input.needsReview),
        createdAt: now,
        updatedAt: now
      }
    });
  } finally {
    db.close();
  }
}

function deleteGlossaryTerm(projectId: ProjectId, termId: string): void {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    new GlossaryTermRepository(db).delete(projectId, termId);
  } finally {
    db.close();
  }
}

function listTmUnits(projectId: ProjectId): TmUnit[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new TmUnitRepository(db).list(projectId);
  } finally {
    db.close();
  }
}

function saveTmUnit(projectId: ProjectId, input: SaveTmUnitRequest): TmUnit {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  const now = nowTimestamp();
  const sourceText = input.sourceText.trim();
  const targetText = input.targetText.trim();
  if (!sourceText || !targetText) {
    throw new Error("TM source and target are required.");
  }

  try {
    return new TmUnitRepository(db).upsert({
      unit: {
        id: randomUUID(),
        projectId,
        bookId: input.bookId,
        sourceText,
        targetText,
        sourceHash: tmSourceHash(sourceText),
        grade: input.grade ?? "gold",
        origin: input.origin ?? "manual",
        confidence: input.confidence,
        notes: input.notes?.trim() || undefined,
        createdAt: now,
        updatedAt: now
      }
    });
  } finally {
    db.close();
  }
}

function deleteTmUnit(projectId: ProjectId, unitId: string): void {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    new TmUnitRepository(db).delete(projectId, unitId);
  } finally {
    db.close();
  }
}

function promoteTmUnit(projectId: ProjectId, unitId: string): TmUnit {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new TmUnitRepository(db).promoteGoldCandidateToGold(projectId, unitId);
  } finally {
    db.close();
  }
}

function rejectTmUnit(projectId: ProjectId, unitId: string): TmUnit {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new TmUnitRepository(db).reject(projectId, unitId);
  } finally {
    db.close();
  }
}

async function importGlossaryForProject(projectId: ProjectId): Promise<GlossaryImportSummary> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Glossary CSV import",
    properties: ["openFile"],
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });

  if (canceled || !filePaths[0]) {
    return { importedCount: 0, skippedCount: 0 };
  }

  const parsed = parseGlossaryCsv(readFileSync(filePaths[0], "utf8"));
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const repository = new GlossaryTermRepository(db);
    for (const term of parsed.terms) {
      const now = nowTimestamp();
      repository.upsert({
        term: {
          id: randomUUID(),
          projectId,
          ...term,
          createdAt: now,
          updatedAt: now
        }
      });
    }
    return { importedCount: parsed.terms.length, skippedCount: parsed.skippedCount };
  } finally {
    db.close();
  }
}

async function exportGlossaryForProject(projectId: ProjectId): Promise<string | undefined> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Glossary CSV export",
    defaultPath: "series.glossary.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });

  if (canceled || !filePath) {
    return undefined;
  }

  writeFileSync(filePath, exportGlossaryCsv(listGlossaryTerms(projectId)));
  return filePath;
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
    const jobRepository = new TranslationJobRepository(db);
    const glossaryTerms = new GlossaryTermRepository(db).list(projectId);
    const glossaryVersion = glossaryVersionHash(glossaryTerms);
    const tmUnits = new TmUnitRepository(db).listUsable(projectId);
    const tmVersion = tmVersionHash(tmUnits);
    const now = nowTimestamp();
    const existingJob = jobRepository
      .listByBook(bookId)
      .find(
        (candidate) =>
          ["running", "paused", "failed"].includes(candidate.status) &&
          candidate.provider === provider.name &&
          candidate.model === currentProviderModel()
      );
    const job: TranslationJob =
      existingJob ??
      jobRepository.create({
        job: {
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
        }
      });

    if (job.status !== "running") {
      job.status = "running";
      jobRepository.updateStatus({ jobId: job.id, status: "running" });
    }

    const segmentRepository = new TranslationSegmentRepository(db);
    let translatedCount = 0;
    let errorCount = 0;
    let cacheHitCount = 0;

    for (const block of blocks) {
      const latestJob = jobRepository.get(job.id);
      if (latestJob?.status === "paused" || latestJob?.status === "cancelled") {
        job.status = latestJob.status;
        break;
      }

      const glossaryHits = findGlossaryHits(block.sourceText, glossaryTerms);
      const tmMatches = findTmMatches({ sourceText: block.sourceText, units: tmUnits });
      const tmContext = buildTmPromptSection(tmMatches);
      const tmContextHash = sha256(tmContext);
      const prompt = [
        literaryKoPrompt,
        buildGlossaryPromptSection(glossaryHits),
        tmContext,
        "When TM and glossary conflict, glossary and gold TM take priority. Use lower-grade TM only as style/context."
      ].join("\n\n");
      const sourceHash = sha256(block.sourceText);
      const promptHash = sha256(`${literaryKoPromptVersion}\n${prompt}`);
      const cacheKey = createTranslationCacheKey({
        sourceHash,
        provider: job.provider,
        model: job.model,
        promptVersion: literaryKoPromptVersion,
        promptHash,
        glossaryVersion,
        tmContextHash: `${tmVersion}:${tmContextHash}`
      });
      const existingSegment = segmentRepository
        .listByJob(job.id)
        .find((segment) => segment.blockId === block.id && segment.status === "translated");
      const cachedSegment =
        existingSegment ??
        segmentRepository.findCached({
          bookId,
          blockId: block.id,
          sourceHash,
          promptHash,
          provider: job.provider,
          model: job.model
        });
      const segment = cachedSegment
        ? {
            ...cachedSegment,
            id: randomUUID() as typeof cachedSegment.id,
            jobId: job.id,
            responseJson: JSON.stringify({
              cacheHit: true,
              cacheKey,
              sourceSegmentId: cachedSegment.id
            }),
            createdAt: nowTimestamp(),
            updatedAt: nowTimestamp()
          }
        : await translateTextBlock({
            jobId: job.id,
            block,
            provider,
            prompt
          });

      if (!cachedSegment && segment.responseJson) {
        const glossaryIssues =
          segment.aiTranslation || segment.finalTranslation
            ? validateGlossaryTranslation({
                hits: glossaryHits,
                translation: segment.finalTranslation ?? segment.aiTranslation ?? ""
              })
            : [];
        if (glossaryIssues.length > 0) {
          segment.status = "needs_review";
          segment.errorMessage = glossaryIssues.map((issue) => issue.message).join("\n");
        }
        segment.responseJson = JSON.stringify({
          cacheHit: false,
          cacheKey,
          glossaryHits,
          glossaryIssues,
          tmMatches,
          response: JSON.parse(segment.responseJson)
        });
      }

      segmentRepository.upsert({ segment });
      if (segment.status === "translated" || segment.status === "needs_review") {
        translatedCount += 1;
      } else {
        errorCount += 1;
      }
      if (cachedSegment) {
        cacheHitCount += 1;
      }

      sendTranslationProgress(
        buildProgress({
          job,
          segments: segmentRepository.listByJob(job.id),
          segmentCount: blocks.length
        })
      );
    }

    if (job.status === "running") {
      const completedAt = nowTimestamp();
      job.status = errorCount > 0 && translatedCount === 0 ? "failed" : "completed";
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      jobRepository.updateStatus({
        jobId: job.id,
        status: job.status,
        completedAt
      });
    }

    return {
      book,
      job,
      translatedCount,
      errorCount,
      segmentCount: blocks.length,
      cacheHitCount
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

function listTranslationProgress(projectId: ProjectId, bookId: BookId): TranslationJobProgress[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const chapters = new ChapterRepository(db).listByBook(bookId);
    const blocks = new TextBlockRepository(db).listByChapterIds(
      chapters.map((chapter) => chapter.id)
    );
    const segmentRepository = new TranslationSegmentRepository(db);
    return new TranslationJobRepository(db).listByBook(bookId).map((job) =>
      buildProgress({
        job,
        segments: segmentRepository.listByJob(job.id),
        segmentCount: blocks.length
      })
    );
  } finally {
    db.close();
  }
}

function updateTranslationJobStatus(
  projectId: ProjectId,
  jobId: JobId,
  status: TranslationJob["status"]
): TranslationJobProgress {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const jobRepository = new TranslationJobRepository(db);
    jobRepository.updateStatus({ jobId, status });
    const job = jobRepository.get(jobId);
    if (!job) {
      throw new Error(`Translation job not found: ${jobId}`);
    }

    const chapters = new ChapterRepository(db).listByBook(job.bookId);
    const blocks = new TextBlockRepository(db).listByChapterIds(
      chapters.map((chapter) => chapter.id)
    );
    return buildProgress({
      job,
      segments: new TranslationSegmentRepository(db).listByJob(job.id),
      segmentCount: blocks.length
    });
  } finally {
    db.close();
  }
}

function parseQaIssues(segment: { errorMessage?: string; responseJson?: string }): string[] {
  const issues = new Set<string>();
  if (segment.errorMessage?.trim()) {
    for (const line of segment.errorMessage.split(/\r?\n/)) {
      if (line.trim()) {
        issues.add(line.trim());
      }
    }
  }

  if (segment.responseJson) {
    try {
      const parsed = JSON.parse(segment.responseJson) as {
        glossaryIssues?: Array<{ message?: unknown }>;
      };
      for (const issue of parsed.glossaryIssues ?? []) {
        if (typeof issue.message === "string" && issue.message.trim()) {
          issues.add(issue.message.trim());
        }
      }
    } catch {
      // Older cached responses may not have the M4 wrapper shape.
    }
  }

  return [...issues];
}

function buildReviewSegments(db: ReturnType<typeof openProjectDb>, bookId: BookId): ReviewSegmentSummary[] {
  const chapters = new ChapterRepository(db).listByBook(bookId);
  const blocks = new TextBlockRepository(db).listByChapterIds(
    chapters.map((chapter) => chapter.id)
  );
  const segments = new TranslationSegmentRepository(db).listByBook(bookId);
  const latestSegmentByBlockId = new Map(segments.map((segment) => [segment.blockId, segment]));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));

  return blocks.flatMap((block, index) => {
    const segment = latestSegmentByBlockId.get(block.id);
    const chapter = chapterById.get(block.chapterId);
    if (!segment || !chapter) {
      return [];
    }

    return [
      {
        segment,
        block,
        chapter,
        displayIndex: index + 1,
        qaIssues: parseQaIssues(segment)
      }
    ];
  });
}

function listReviewSegments(projectId: ProjectId, bookId: BookId): ReviewSegmentSummary[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return buildReviewSegments(db, bookId);
  } finally {
    db.close();
  }
}

function updateReviewFinalTranslation(
  projectId: ProjectId,
  segmentId: SegmentId,
  finalTranslation: string
): ReviewSegmentSummary {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const repository = new TranslationSegmentRepository(db);
    const segment = repository.updateFinalTranslation({
      segmentId,
      finalTranslation: finalTranslation.trim(),
      status: "reviewed"
    });
    const job = new TranslationJobRepository(db).get(segment.jobId);
    if (!job) {
      throw new Error(`Translation job not found: ${segment.jobId}`);
    }

    const updated = buildReviewSegments(db, job.bookId).find(
      (candidate) => candidate.segment.id === segment.id
    );
    if (!updated) {
      throw new Error(`Review segment not found after update: ${segment.id}`);
    }

    return updated;
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

  ipcMain.handle("glossary:list", (_event, projectId: ProjectId) =>
    listGlossaryTerms(projectId)
  );

  ipcMain.handle(
    "glossary:save",
    (_event, projectId: ProjectId, input: SaveGlossaryTermRequest) =>
      saveGlossaryTerm(projectId, input)
  );

  ipcMain.handle("glossary:delete", (_event, projectId: ProjectId, termId: string) => {
    deleteGlossaryTerm(projectId, termId);
  });

  ipcMain.handle("glossary:importCsv", (_event, projectId: ProjectId) =>
    importGlossaryForProject(projectId)
  );

  ipcMain.handle("glossary:exportCsv", (_event, projectId: ProjectId) =>
    exportGlossaryForProject(projectId)
  );

  ipcMain.handle("tm:list", (_event, projectId: ProjectId) => listTmUnits(projectId));

  ipcMain.handle("tm:save", (_event, projectId: ProjectId, input: SaveTmUnitRequest) =>
    saveTmUnit(projectId, input)
  );

  ipcMain.handle("tm:delete", (_event, projectId: ProjectId, unitId: string) => {
    deleteTmUnit(projectId, unitId);
  });

  ipcMain.handle("tm:promote", (_event, projectId: ProjectId, unitId: string) =>
    promoteTmUnit(projectId, unitId)
  );

  ipcMain.handle("tm:reject", (_event, projectId: ProjectId, unitId: string) =>
    rejectTmUnit(projectId, unitId)
  );

  ipcMain.handle("translation:listJobs", (_event, projectId: ProjectId, bookId: BookId) =>
    listTranslationProgress(projectId, bookId)
  );

  ipcMain.handle("translation:pause", (_event, projectId: ProjectId, jobId: JobId) =>
    updateTranslationJobStatus(projectId, jobId, "paused")
  );

  ipcMain.handle("translation:resume", (_event, projectId: ProjectId, bookId: BookId) =>
    translateFirstChapterForProject(projectId, bookId)
  );

  ipcMain.handle("translation:cancel", (_event, projectId: ProjectId, jobId: JobId) =>
    updateTranslationJobStatus(projectId, jobId, "cancelled")
  );

  ipcMain.handle("review:listSegments", (_event, projectId: ProjectId, bookId: BookId) =>
    listReviewSegments(projectId, bookId)
  );

  ipcMain.handle(
    "review:updateFinalTranslation",
    (_event, projectId: ProjectId, segmentId: SegmentId, finalTranslation: string) =>
      updateReviewFinalTranslation(projectId, segmentId, finalTranslation)
  );
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
