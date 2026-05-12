import { randomUUID } from "node:crypto";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { config as loadDotenv } from "dotenv";
import {
  AlignmentPairRepository,
  BookRepository,
  CharacterProfileRepository,
  ChapterRepository,
  ChapterMemoryRepository,
  EditorialDecisionRepository,
  EditorialJobRepository,
  ExternalTransferConsentRepository,
  GlossaryTermRepository,
  openProjectDatabase,
  PostReadCorrectionRepository,
  ProjectRepository,
  ReferenceBlockRepository,
  SourceDocumentRepository,
  StylebookEntryRepository,
  TextBlockRepository,
  TmUnitRepository,
  TranslationJobRepository,
  TranslationSegmentRepository
} from "@sts/db";
import {
  copyEpubToWorkspace,
  extractTextBlocks,
  extractReferenceTextBlocks,
  findRootfilePath,
  parseOpf,
  rebuildEpub,
  sha256 as hashEpubBytes,
  unpackEpub,
  validateEpubFile
} from "@sts/epub-core";
import {
  editorialPrompt,
  editorialPromptVersion,
  MockEditorialProvider,
  shouldRegisterGoldCandidate,
  type EditorialProvider
} from "@sts/editorial-core";
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
  AlignmentPair,
  AlignmentPairId,
  AlignmentPreview,
  AlignmentPreviewChapter,
  AlignmentRunOptions,
  AlignmentRunSummary,
  Book,
  BookId,
  CharacterProfile,
  Chapter,
  ChapterMemory,
  EditorialJob,
  EditorialJobProgress,
  EditorialRunSummary,
  ExternalTransferConsent,
  ExternalTransferTask,
  ExportedBookSummary,
  GlossaryImportSummary,
  GlossaryTerm,
  ImportedBookSummary,
  JobId,
  PostReadCorrection,
  ProviderIssueCategory,
  ProviderIssueSummary,
  ProviderValidationSummary,
  Project,
  ProjectId,
  ReferenceBlock,
  ReferenceBlockId,
  ReviewSegmentSummary,
  SegmentSearchResult,
  SegmentId,
  SourceDocument,
  SpoilerSafeSummary,
  StylebookEntry,
  StylebookEntryType,
  TextBlock,
  TmGrade,
  TmOrigin,
  TmUnit,
  TokenUsageSummary,
  TranslationExportMode,
  TranslationJob,
  TranslationJobProgress,
  TranslationSegment,
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

interface SavePostReadCorrectionRequest {
  segmentId: SegmentId;
  correctedText: string;
  note?: string;
}

interface PromoteAlignmentPairRequest {
  pairId: AlignmentPairId;
  grade?: TmGrade;
}

interface SaveStylebookEntryRequest {
  entryType?: StylebookEntryType;
  title: string;
  body: string;
  priority?: number;
}

interface SaveCharacterProfileRequest {
  name: string;
  aliases?: string;
  description?: string;
  speechStyle?: string;
  translationNotes?: string;
}

interface SaveChapterMemoryRequest {
  chapterId: Chapter["id"];
  summary: string;
  termNotes?: string;
}

interface SaveExternalTransferConsentRequest {
  bookId?: BookId;
  task: ExternalTransferTask;
  scope: string;
  consentText: string;
  accepted?: boolean;
}

interface AlignmentGroup {
  sourceBlocks: TextBlock[];
  referenceBlocks: ReferenceBlock[];
  sourceText: string;
  referenceText: string;
  confidence: number;
}

interface ReferenceAlignmentCandidate {
  startBlockIndex: number;
  blocks: ReferenceBlock[];
  text: string;
}

interface LocalAlignmentStepCandidate {
  sourceSpan: number;
  referenceSpan: number;
  sourceText: string;
  referenceText: string;
}

interface LocalAlignmentJudgeResult {
  best_candidate_index: number | null;
  match_type: "exact" | "partial" | "merged" | "split" | "wrong";
  confidence: number;
  reason?: string;
}

interface TextSectionCandidate {
  chapterId?: Chapter["id"];
  chapterIndex: number;
  spineHref?: string;
  title?: string;
  blockStartIndex: number;
  blockCount: number;
  previewText: string;
  candidateType: string;
  confidence: number;
  reason: string;
}

interface AlignmentDebugLogger {
  step(name: string, details?: Record<string, unknown>): void;
  finish(details?: Record<string, unknown>): string;
}

interface AlignmentFingerprint {
  anchors: Set<string>;
  numbers: Set<string>;
  dialogueRatio: number;
  lengthBucket: number;
}

interface AlignmentAnchor {
  sourceIndex: number;
  referenceIndex: number;
  score: number;
  uniqueness: number;
}

interface FileManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

interface RoundTripArtifactInput {
  project: Project;
  book: Book;
  sourceDocument?: SourceDocument;
  sourceExtractedDir: string;
  outputPath: string;
  replacementCount: number;
  replacementSpineHrefs: string[];
  validation: ExportedBookSummary["validation"];
  mode: "roundtrip" | "translated" | "spoiler_safe";
}

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const currentDir = dirname(fileURLToPath(import.meta.url));

loadEnvironment();

function loadEnvironment(): void {
  const candidates = [...envCandidates(process.cwd()), ...envCandidates(currentDir)];
  const loaded = new Set<string>();

  for (const path of candidates) {
    if (!loaded.has(path) && existsSync(path)) {
      loadDotenv({ path, override: false });
      loaded.add(path);
    }
  }
}

function envCandidates(startDir: string): string[] {
  const candidates: string[] = [];
  let cursor = resolve(startDir);

  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(join(cursor, ".env"));
    const parent = dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return candidates;
}

function createAlignmentDebugLogger(project: Project, bookId: BookId): AlignmentDebugLogger {
  const enabled = !["0", "false", "off"].includes(
    (process.env.ALIGNMENT_DEBUG_LOG ?? "true").toLowerCase()
  );
  const startedAt = Date.now();
  let lastAt = startedAt;
  const lines: string[] = [
    `# Alignment Debug Log`,
    ``,
    `- book_id: ${bookId}`,
    `- started_at: ${new Date(startedAt).toISOString()}`,
    ``
  ];

  return {
    step(name, details = {}) {
      if (!enabled) {
        return;
      }
      const now = Date.now();
      const elapsedMs = now - startedAt;
      const stepMs = now - lastAt;
      lastAt = now;
      lines.push(`## ${name}`);
      lines.push(`- elapsed_ms: ${elapsedMs}`);
      lines.push(`- step_ms: ${stepMs}`);
      if (Object.keys(details).length > 0) {
        lines.push("```json");
        lines.push(JSON.stringify(details, null, 2));
        lines.push("```");
      }
      lines.push("");
    },
    finish(details = {}) {
      if (!enabled) {
        return "";
      }
      const now = Date.now();
      lines.push(`## finish`);
      lines.push(`- elapsed_ms: ${now - startedAt}`);
      if (Object.keys(details).length > 0) {
        lines.push("```json");
        lines.push(JSON.stringify(details, null, 2));
        lines.push("```");
      }
      const debugDir = join(project.workspacePath, "debug_logs", "alignment");
      mkdirSync(debugDir, { recursive: true });
      const path = join(
        debugDir,
        `alignment_${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}_${bookId}.md`
      );
      writeFileSync(path, lines.join("\n"));
      return path;
    }
  };
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
  return process.env.STS_WORKSPACE_DIR?.trim() || join(app.getPath("userData"), "projects");
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

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function jsonCell(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function reportTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function fileManifest(rootDir: string): FileManifestEntry[] {
  const root = resolve(rootDir);

  function walk(dir: string): FileManifestEntry[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(absolutePath);
      }
      if (!entry.isFile()) {
        return [];
      }

      const data = readFileSync(absolutePath);
      return [
        {
          path: normalizeReportPath(relativePath(root, absolutePath)),
          size: statSync(absolutePath).size,
          sha256: hashEpubBytes(data)
        }
      ];
    });
  }

  return walk(root).sort((a, b) => a.path.localeCompare(b.path));
}

function relativePath(root: string, absolutePath: string): string {
  const relative = absolutePath.slice(root.length).replace(/^[/\\]+/, "");
  return relative || ".";
}

function normalizeReportPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function ensurePathInsideProjectsRoot(path: string): string {
  const resolvedPath = resolve(path);
  const root = resolve(projectsRoot());
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}\\`) && !resolvedPath.startsWith(`${root}/`)) {
    throw new Error("Report path is outside the STS workspace.");
  }
  return resolvedPath;
}

function readReportJson(path: string): unknown {
  const reportPath = ensurePathInsideProjectsRoot(path);
  if (!/\.json$/i.test(reportPath)) {
    throw new Error("Only JSON report files can be read.");
  }
  return JSON.parse(readFileSync(reportPath, "utf8"));
}

function compareFileManifests(source: FileManifestEntry[], output: FileManifestEntry[]) {
  const sourceByPath = new Map(source.map((entry) => [entry.path, entry]));
  const outputByPath = new Map(output.map((entry) => [entry.path, entry]));
  const missing = source.filter((entry) => !outputByPath.has(entry.path)).map((entry) => entry.path);
  const added = output.filter((entry) => !sourceByPath.has(entry.path)).map((entry) => entry.path);
  const changed = output
    .filter((entry) => {
      const sourceEntry = sourceByPath.get(entry.path);
      return sourceEntry && sourceEntry.sha256 !== entry.sha256;
    })
    .map((entry) => entry.path);

  return { missing, added, changed };
}

function mediaTypeCounts(manifest: Array<{ mediaType: string }>): Record<string, number> {
  return manifest.reduce<Record<string, number>>((counts, item) => {
    counts[item.mediaType] = (counts[item.mediaType] ?? 0) + 1;
    return counts;
  }, {});
}

async function writeRoundTripArtifacts(input: RoundTripArtifactInput): Promise<{
  manifestPath: string;
  reportPath: string;
}> {
  const timestamp = reportTimestamp();
  const reportDir = join(input.project.workspacePath, "reports", "roundtrip", input.book.id, timestamp);
  const verifyDir = join(reportDir, "verify-output");
  mkdirSync(reportDir, { recursive: true });

  const unpackedOutput = await unpackEpub({
    epubPath: input.outputPath,
    outputDir: verifyDir
  });

  try {
    const sourceRootfilePath = findRootfilePath(input.sourceExtractedDir);
    const sourceOpf = parseOpf({
      extractedDir: input.sourceExtractedDir,
      opfPath: sourceRootfilePath
    });
    const outputOpf = parseOpf({
      extractedDir: unpackedOutput.extractedDir,
      opfPath: unpackedOutput.rootfilePath
    });
    const sourceFiles = fileManifest(input.sourceExtractedDir);
    const outputFiles = fileManifest(unpackedOutput.extractedDir);
    const fileComparison = compareFileManifests(sourceFiles, outputFiles);
    const replacementFiles = [...new Set(input.replacementSpineHrefs.map(normalizeReportPath))].sort();
    const unexpectedChangedFiles = fileComparison.changed.filter(
      (path) =>
        !replacementFiles.includes(path) &&
        path !== sourceRootfilePath &&
        path !== unpackedOutput.rootfilePath
    );
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: input.mode,
      project: {
        id: input.project.id,
        name: input.project.name,
        workspacePath: input.project.workspacePath
      },
      book: {
        id: input.book.id,
        title: input.book.title,
        sourceLang: input.book.sourceLang,
        targetLang: input.book.targetLang
      },
      sourceDocument: input.sourceDocument
        ? {
            id: input.sourceDocument.id,
            filePath: input.sourceDocument.filePath,
            fileHash: input.sourceDocument.fileHash,
            importedAt: input.sourceDocument.importedAt
          }
        : undefined,
      output: {
        epubPath: input.outputPath,
        validation: input.validation
      },
      structure: {
        sourceRootfilePath,
        outputRootfilePath: unpackedOutput.rootfilePath,
        sourceSpineCount: sourceOpf.spineItems.length,
        outputSpineCount: outputOpf.spineItems.length,
        sourceManifestCount: sourceOpf.manifest.length,
        outputManifestCount: outputOpf.manifest.length,
        sourceHasNav: Boolean(sourceOpf.navItem),
        outputHasNav: Boolean(outputOpf.navItem),
        sourceHasToc: Boolean(sourceOpf.tocItem),
        outputHasToc: Boolean(outputOpf.tocItem),
        mediaTypeCounts: {
          source: mediaTypeCounts(sourceOpf.manifest),
          output: mediaTypeCounts(outputOpf.manifest)
        }
      },
      textReplacement: {
        replacementCount: input.replacementCount,
        replacementFiles,
        inlineMarkupPreservationLevel: 0
      },
      files: {
        sourceCount: sourceFiles.length,
        outputCount: outputFiles.length,
        missing: fileComparison.missing,
        added: fileComparison.added,
        changed: fileComparison.changed,
        unexpectedChanged: unexpectedChangedFiles
      },
      result: {
        ok:
          Boolean(input.validation?.ok) &&
          fileComparison.missing.length === 0 &&
          fileComparison.added.length === 0 &&
          unexpectedChangedFiles.length === 0,
        errors: [
          ...(input.validation?.errors ?? []),
          ...fileComparison.missing.map((path) => `Missing file after rebuild: ${path}`),
          ...fileComparison.added.map((path) => `Unexpected file after rebuild: ${path}`),
          ...unexpectedChangedFiles.map((path) => `Unexpected changed file after rebuild: ${path}`)
        ]
      }
    };
    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      bookId: input.book.id,
      outputPath: input.outputPath,
      sourceFiles,
      outputFiles
    };
    const manifestPath = join(reportDir, "manifest.json");
    const reportPath = join(reportDir, "roundtrip_report.json");
    writeFileSync(manifestPath, jsonCell(manifest));
    writeFileSync(reportPath, jsonCell(report));

    return { manifestPath, reportPath };
  } finally {
    rmSync(verifyDir, { recursive: true, force: true });
  }
}

function createTranslationProvider() {
  return currentProviderName() === "vertex"
    ? new VertexTranslationProvider()
    : new MockTranslationProvider();
}

function createEditorialProvider(): EditorialProvider {
  return currentProviderName() === "vertex"
    ? new VertexTranslationProvider()
    : new MockEditorialProvider();
}

function currentProviderName(): "mock" | "vertex" {
  return process.env.STS_TRANSLATION_PROVIDER?.trim().toLowerCase() === "vertex"
    ? "vertex"
    : "mock";
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

function saveExternalTransferConsent(
  projectId: ProjectId,
  input: SaveExternalTransferConsentRequest
): ExternalTransferConsent {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const book = input.bookId
      ? new BookRepository(db).list(projectId).find((candidate) => candidate.id === input.bookId)
      : undefined;
    if (input.bookId && !book) {
      throw new Error(`Book not found: ${input.bookId}`);
    }

    const consent: ExternalTransferConsent = {
      id: randomUUID(),
      projectId,
      bookId: input.bookId,
      task: input.task,
      provider: currentProviderName(),
      model: currentProviderModel(),
      scope: input.scope,
      sourceLang: book?.sourceLang ?? project.sourceLang,
      targetLang: book?.targetLang ?? project.targetLang,
      consentText: input.consentText,
      accepted: input.accepted ?? true,
      createdAt: nowTimestamp()
    };

    return new ExternalTransferConsentRepository(db).create({ consent });
  } finally {
    db.close();
  }
}

function listExternalTransferConsents(projectId: ProjectId): ExternalTransferConsent[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new ExternalTransferConsentRepository(db).listByProject(projectId);
  } finally {
    db.close();
  }
}

function sendTranslationProgress(progress: TranslationJobProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("translation:progress", progress);
  }
}

function sendEditorialProgress(progress: EditorialJobProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("editorial:progress", progress);
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
  segments: Array<{ status: string; responseJson?: string; errorMessage?: string }>;
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
    statusCounts,
    providerIssues: summarizeProviderIssues(input.segments),
    usage: summarizeTokenUsage(input.segments)
  };
}

function summarizeTokenUsage(
  segments: Array<{ status: string; responseJson?: string }>
): TokenUsageSummary {
  const usage = segments.reduce<TokenUsageSummary>(
    (summary, segment) => {
      const segmentUsage = readSegmentTokenUsage(segment.responseJson);
      if (!segmentUsage) {
        return summary;
      }

      return {
        ...summary,
        inputTokens: summary.inputTokens + (segmentUsage.inputTokens ?? 0),
        outputTokens: summary.outputTokens + (segmentUsage.outputTokens ?? 0),
        totalTokens: summary.totalTokens + (segmentUsage.totalTokens ?? 0),
        segmentCount: summary.segmentCount + 1
      };
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, segmentCount: 0 }
  );
  const estimatedCostUsd = estimateTokenCostUsd(usage);
  return {
    ...usage,
    estimatedCostUsd,
    costSource: estimatedCostUsd === undefined ? undefined : "env"
  };
}

function readSegmentTokenUsage(
  responseJson: string | undefined
): { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined {
  if (!responseJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(responseJson) as Record<string, unknown>;
    const usage = readUsageRecord(parsed.usage) ?? readUsageRecord(readRecordValue(parsed.response)?.usage);
    if (!usage) {
      return undefined;
    }

    return {
      inputTokens: readOptionalNumber(usage.inputTokens ?? usage.promptTokenCount),
      outputTokens: readOptionalNumber(usage.outputTokens ?? usage.candidatesTokenCount),
      totalTokens: readOptionalNumber(usage.totalTokens ?? usage.totalTokenCount)
    };
  } catch {
    return undefined;
  }
}

function readUsageRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function readRecordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function estimateTokenCostUsd(usage: TokenUsageSummary): number | undefined {
  const totalRate = readEnvNumber("STS_TOKEN_USD_PER_1M");
  if (totalRate !== undefined && usage.totalTokens > 0) {
    return roundCurrency((usage.totalTokens / 1_000_000) * totalRate);
  }

  const inputRate = readEnvNumber("STS_INPUT_TOKEN_USD_PER_1M");
  const outputRate = readEnvNumber("STS_OUTPUT_TOKEN_USD_PER_1M");
  if (inputRate === undefined && outputRate === undefined) {
    return undefined;
  }

  return roundCurrency(
    (usage.inputTokens / 1_000_000) * (inputRate ?? 0) +
      (usage.outputTokens / 1_000_000) * (outputRate ?? 0)
  );
}

function readEnvNumber(name: string): number | undefined {
  const value = process.env[name];
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function summarizeProviderIssues(
  segments: Array<{ status: string; responseJson?: string; errorMessage?: string }>
): ProviderIssueSummary[] {
  const issues = new Map<string, ProviderIssueSummary>();

  for (const segment of segments) {
    if (segment.status !== "error" && segment.status !== "editorial_error") {
      continue;
    }

    const parsed = readProviderIssue(segment);
    const key = `${parsed.category}:${parsed.code}:${parsed.retryable ? "retry" : "stop"}`;
    const existing = issues.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    issues.set(key, {
      ...parsed,
      count: 1
    });
  }

  return [...issues.values()].sort((a, b) => b.count - a.count);
}

function readProviderIssue(segment: {
  responseJson?: string;
  errorMessage?: string;
}): Omit<ProviderIssueSummary, "count"> {
  const message = segment.errorMessage?.trim() || "Provider request failed.";
  const providerError = readProviderErrorPayload(segment.responseJson);
  const code = providerError?.code ?? inferProviderErrorCode(message);
  const retryable = providerError?.retryable ?? inferRetryableProviderError(code, message);
  const category = classifyProviderIssue(code, message);

  return {
    category,
    code,
    retryable,
    message,
    userAction: providerIssueUserAction(category, retryable)
  };
}

function readProviderErrorPayload(
  responseJson: string | undefined
): { code?: string; retryable?: boolean } | undefined {
  if (!responseJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(responseJson) as { providerError?: unknown; response?: unknown };
    const payload = parsed.providerError ?? (parsed.response as { providerError?: unknown })?.providerError;
    if (!payload || typeof payload !== "object") {
      return undefined;
    }

    const record = payload as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? record.code : undefined,
      retryable: typeof record.retryable === "boolean" ? record.retryable : undefined
    };
  } catch {
    return undefined;
  }
}

function inferProviderErrorCode(message: string): string {
  if (/VERTEX_PROJECT_ID|GOOGLE_CLOUD_PROJECT|VERTEX_LOCATION|VERTEX_MODEL|config/i.test(message)) {
    return "CONFIG_INVALID";
  }
  if (/401|403|permission|credential|auth|unauthor/i.test(message)) {
    return "AUTH_INVALID";
  }
  if (/429|quota/i.test(message)) {
    return "QUOTA_OR_RATE_LIMIT";
  }
  if (/timeout/i.test(message)) {
    return "TIMEOUT";
  }
  if (/json|schema|parse|format/i.test(message)) {
    return "RESPONSE_FORMAT";
  }
  return "PROVIDER_ERROR";
}

function inferRetryableProviderError(code: string, message: string): boolean {
  return /TIMEOUT|429|RATE|QUOTA|EMPTY_RESPONSE|VERTEX_5\d\d/i.test(code) || /timeout|temporarily|unavailable/i.test(message);
}

function classifyProviderIssue(code: string, message: string): ProviderIssueCategory {
  if (/CONFIG/.test(code) || /VERTEX_PROJECT_ID|GOOGLE_CLOUD_PROJECT|VERTEX_LOCATION|VERTEX_MODEL/i.test(message)) {
    return "config";
  }
  if (/AUTH|401|403|PERMISSION|CREDENTIAL/i.test(code) || /permission|credential|auth|unauthor/i.test(message)) {
    return "auth";
  }
  if (/QUOTA/i.test(code) || /quota/i.test(message)) {
    return "quota";
  }
  if (/429|RATE/.test(code)) {
    return "rate_limit";
  }
  if (/TIMEOUT/.test(code) || /timeout/i.test(message)) {
    return "timeout";
  }
  if (/JSON|SCHEMA|FORMAT|PARSE|RESPONSE_FORMAT/.test(code) || /json|schema|parse|format/i.test(message)) {
    return "response_format";
  }
  if (/VERTEX_5\d\d|NETWORK|UNAVAILABLE/.test(code) || /network|unavailable|temporarily/i.test(message)) {
    return "network";
  }
  return "unknown";
}

function providerIssueUserAction(category: ProviderIssueCategory, retryable: boolean): string {
  if (category === "config") {
    return ".env provider 설정을 확인하세요.";
  }
  if (category === "auth") {
    return "Google Cloud 인증과 Vertex 권한을 확인하세요.";
  }
  if (category === "quota") {
    return "quota/결제 한도를 확인하거나 잠시 후 재시도하세요.";
  }
  if (category === "rate_limit") {
    return "요청 속도를 낮추고 재시도하세요.";
  }
  if (category === "timeout" || category === "network") {
    return "네트워크 상태를 확인한 뒤 재시도하세요.";
  }
  if (category === "response_format") {
    return "프롬프트/모델 응답 형식을 확인하고 해당 segment를 재번역하세요.";
  }
  return retryable ? "일시적 오류일 수 있습니다. 재시도하세요." : "오류 메시지를 확인한 뒤 설정을 보정하세요.";
}

function buildEditorialProgress(input: {
  job: EditorialJob;
  decisions: Array<{ decision: string; tmGrade: string }>;
  segments: Array<{ status: string }>;
  segmentCount: number;
}): EditorialJobProgress {
  const statusCounts = input.segments.reduce<Record<string, number>>((counts, segment) => {
    counts[segment.status] = (counts[segment.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    job: input.job,
    segmentCount: input.segmentCount,
    processedCount: input.decisions.length,
    approvedCount: input.decisions.filter((decision) => decision.decision === "approve").length,
    needsReviewCount: input.decisions.filter((decision) => decision.decision === "needs_review")
      .length,
    rejectedCount: input.decisions.filter((decision) => decision.decision === "reject").length,
    goldCandidateCount: input.decisions.filter(
      (decision) => decision.tmGrade === "gold_candidate"
    ).length,
    errorCount: statusCounts.editorial_error ?? 0,
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

function normalizeSearchText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function similarityScore(query: string, text: string): number {
  const queryTerms = new Set(query.split(/\s+/).filter(Boolean));
  const textTerms = new Set(text.split(/\s+/).filter(Boolean));
  if (queryTerms.size === 0 || textTerms.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const term of queryTerms) {
    if (textTerms.has(term)) {
      overlap += 1;
    }
  }
  return overlap / queryTerms.size;
}

function searchSegmentsBySentence(
  projectId: ProjectId,
  bookId: BookId,
  query: string
): SegmentSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const chapters = new ChapterRepository(db).listByBook(bookId);
    const blocks = new TextBlockRepository(db).listByChapterIds(
      chapters.map((chapter) => chapter.id)
    );
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const chapterByBlockId = new Map<string, Chapter>();
    const blockIndex = new Map(blocks.map((block, index) => [block.id, index + 1]));
    for (const block of blocks) {
      const chapter = chapterById.get(block.chapterId);
      if (chapter) {
        chapterByBlockId.set(block.id, chapter);
      }
    }

    return new TranslationSegmentRepository(db)
      .listByBook(bookId)
      .flatMap((segment): SegmentSearchResult[] => {
        const candidates = [
          segment.finalTranslation,
          segment.editorialTranslation,
          segment.aiTranslation,
          segment.sourceText
        ].filter((value): value is string => Boolean(value?.trim()));
        const best = candidates
          .map((text) => {
            const normalized = normalizeSearchText(text);
            const score = normalized.includes(normalizedQuery)
              ? 1
              : normalizedQuery.includes(normalized)
                ? 0.8
                : similarityScore(normalizedQuery, normalized);
            return { text, score };
          })
          .sort((a, b) => b.score - a.score)[0];
        const chapter = chapterByBlockId.get(segment.blockId);
        if (!best || best.score < 0.35 || !chapter) {
          return [];
        }

        return [
          {
            segment,
            chapter,
            displayIndex: blockIndex.get(segment.blockId) ?? 0,
            matchedText: best.text,
            score: best.score
          }
        ];
      })
      .sort((a, b) => b.score - a.score || a.displayIndex - b.displayIndex)
      .slice(0, 20);
  } finally {
    db.close();
  }
}

function savePostReadCorrection(
  projectId: ProjectId,
  bookId: BookId,
  input: SavePostReadCorrectionRequest
): PostReadCorrection {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  const now = nowTimestamp();
  const correctedText = input.correctedText.trim();
  if (!correctedText) {
    throw new Error("Correction text is required.");
  }

  try {
    const segmentRepository = new TranslationSegmentRepository(db);
    const segment = segmentRepository.get(input.segmentId);
    if (!segment) {
      throw new Error(`Translation segment not found: ${input.segmentId}`);
    }

    const beforeText =
      segment.finalTranslation ?? segment.editorialTranslation ?? segment.aiTranslation ?? "";
    const correction = new PostReadCorrectionRepository(db).create({
      correction: {
        id: randomUUID(),
        projectId,
        bookId,
        segmentId: segment.id,
        sourceText: segment.sourceText,
        beforeText,
        correctedText,
        note: input.note?.trim() || undefined,
        createdAt: now,
        updatedAt: now
      }
    });

    segmentRepository.updateFinalTranslation({
      segmentId: segment.id,
      finalTranslation: correctedText,
      status: "post_read_corrected"
    });

    return correction;
  } finally {
    db.close();
  }
}

function listPostReadCorrections(
  projectId: ProjectId,
  bookId: BookId
): PostReadCorrection[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new PostReadCorrectionRepository(db).listByBook(projectId, bookId);
  } finally {
    db.close();
  }
}

function promoteCorrectionToGold(projectId: ProjectId, correctionId: string): PostReadCorrection {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const correctionRepository = new PostReadCorrectionRepository(db);
    const correction = correctionRepository.get(projectId, correctionId);
    if (!correction) {
      throw new Error(`Post-read correction not found: ${correctionId}`);
    }
    if (correction.promotedTmUnitId) {
      return correction;
    }

    const now = nowTimestamp();
    const tmUnit = new TmUnitRepository(db).upsert({
      unit: {
        id: randomUUID(),
        projectId,
        bookId: correction.bookId,
        sourceText: correction.sourceText,
        targetText: correction.correctedText,
        sourceHash: tmSourceHash(correction.sourceText),
        grade: "gold",
        origin: "post_read_correction",
        confidence: 1,
        notes: `post_read_correction=${correction.id}; segment=${correction.segmentId}`,
        createdAt: now,
        updatedAt: now
      }
    });

    return correctionRepository.markPromoted({
      projectId,
      correctionId,
      tmUnitId: tmUnit.id
    });
  } finally {
    db.close();
  }
}

function alignmentConfidence(sourceText: string, referenceText: string): number {
  return alignmentConfidenceWithRatio(sourceText, referenceText, 1);
}

function alignmentConfidenceWithRatio(
  sourceText: string,
  referenceText: string,
  targetSourceRatio: number
): number {
  const sourceLength = Math.max(normalizeSearchText(sourceText).length * targetSourceRatio, 1);
  const referenceLength = Math.max(normalizeSearchText(referenceText).length, 1);
  const lengthRatio = Math.min(sourceLength, referenceLength) / Math.max(sourceLength, referenceLength);
  const sentenceRatio = sentenceShapeRatio(sourceText, referenceText);
  const entityRatio = jaccard(
    buildAlignmentFingerprint(sourceText).anchors,
    buildAlignmentFingerprint(referenceText).anchors
  );
  const numberRatio = jaccard(
    buildAlignmentFingerprint(sourceText).numbers,
    buildAlignmentFingerprint(referenceText).numbers
  );
  const sourceQuote = /["“”‘’]/.test(sourceText);
  const referenceQuote = /["“”‘’「」『』]/.test(referenceText);
  const quoteBonus = sourceQuote === referenceQuote ? 0.04 : -0.08;
  const score =
    entityRatio * 0.3 +
    numberRatio * 0.16 +
    lengthRatio * 0.3 +
    sentenceRatio * 0.16 +
    0.04 +
    quoteBonus;
  return Number(Math.max(0.05, Math.min(0.93, score)).toFixed(2));
}

function sentenceShapeRatio(sourceText: string, referenceText: string): number {
  const sourceCount = sentenceLikeCount(sourceText);
  const referenceCount = sentenceLikeCount(referenceText);
  return Math.min(sourceCount, referenceCount) / Math.max(sourceCount, referenceCount);
}

function sentenceLikeCount(text: string): number {
  const punctuationCount = text.match(/[.!?。！？]+/g)?.length ?? 0;
  const koreanEndingCount =
    text.match(/(?:다|요|죠|네|까|군|지|음|함)(?=\s|$|["”’」』])/g)?.length ?? 0;
  return Math.max(1, punctuationCount, koreanEndingCount);
}

function textAlignLength(text: string): number {
  return Math.max(normalizeSearchText(text).replace(/\s/g, "").length, 1);
}

function isAlignmentNoiseText(text: string): boolean {
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return true;
  }

  const compact = normalized.replace(/\s/g, "");
  const sceneBreak = /^([*＊*⁂※·•\-–—_]{1,5})$/.test(compact);
  const upperRatio =
    normalized.replace(/[^A-Z]/g, "").length / Math.max(normalized.replace(/[^A-Za-z]/g, "").length, 1);
  const chapterHeading =
    /^chapter\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i.test(
      normalized
    ) || /^제\s*\d+\s*장/.test(normalized);
  const tocLine = /^[A-Z][A-Z\s'.:-]{4,}\.?\s+\d{1,4}$/.test(normalized);
  const pageNumber = /^\d{1,4}$/.test(compact);
  const frontMatter =
    /^(contents|table of contents|title page|copyright|dedication|acknowledg(e)?ments?)$/i.test(
      normalized
    );

  return (
    chapterHeading ||
    sceneBreak ||
    tocLine ||
    pageNumber ||
    frontMatter ||
    (normalized.length <= 28 && upperRatio > 0.75)
  );
}

function isAlignableSourceBlock(block: TextBlock): boolean {
  if (/^h[1-6]$/i.test(block.htmlTag)) {
    return false;
  }
  return !isAlignmentNoiseText(block.sourceText);
}

function isAlignableReferenceBlock(block: ReferenceBlock): boolean {
  return !isAlignmentNoiseText(block.referenceText);
}

function withoutConsecutiveDuplicateReferenceBlocks(blocks: ReferenceBlock[]): ReferenceBlock[] {
  const deduped: ReferenceBlock[] = [];
  let previous = "";
  for (const block of blocks) {
    const normalized = normalizeSearchText(block.referenceText);
    if (normalized && normalized === previous) {
      continue;
    }
    deduped.push(block);
    previous = normalized;
  }
  return deduped;
}

function estimateReferenceRatio(sourceBlocks: TextBlock[], referenceBlocks: ReferenceBlock[]): number {
  const sourceTotal = sourceBlocks.reduce((sum, block) => sum + textAlignLength(block.sourceText), 0);
  const referenceTotal = referenceBlocks.reduce(
    (sum, block) => sum + textAlignLength(block.referenceText),
    0
  );
  return Math.max(0.35, Math.min(1.4, referenceTotal / Math.max(sourceTotal, 1)));
}

function alignBlocksByDynamicProgramming(input: {
  sourceBlocks: TextBlock[];
  referenceBlocks: ReferenceBlock[];
  targetSourceRatio: number;
  allowLeadingSkip?: boolean;
}): AlignmentGroup[] {
  const sourceCount = input.sourceBlocks.length;
  const referenceCount = input.referenceBlocks.length;
  if (sourceCount === 0 || referenceCount === 0) {
    return [];
  }

  const width = referenceCount + 1;
  const costs = new Float64Array((sourceCount + 1) * width);
  const moves = new Uint8Array((sourceCount + 1) * width);
  costs.fill(Number.POSITIVE_INFINITY);
  costs[0] = 0;

  const sourceSkipCost = 0.62;
  const referenceSkipCost = 0.44;
  const leadingSourceSkipCost = input.allowLeadingSkip === false ? 8 : 0.08;
  const leadingReferenceSkipCost = input.allowLeadingSkip === false ? 8 : 0.06;
  const maxSourceSpan = Number(process.env.ALIGNMENT_DP_MAX_SOURCE_SPAN ?? 4);
  const maxReferenceSpan = Number(process.env.ALIGNMENT_DP_MAX_REFERENCE_SPAN ?? 2);
  const minBand = Number(process.env.ALIGNMENT_DP_MIN_BAND ?? 28);
  const bandRatio = Number(process.env.ALIGNMENT_DP_BAND_RATIO ?? 0.035);
  const band = Math.max(minBand, Math.ceil(Math.abs(sourceCount - referenceCount) * bandRatio));
  const sourceSpanTexts = buildSourceSpanTexts(input.sourceBlocks, maxSourceSpan);
  const referenceSpanTexts = buildReferenceSpanTexts(input.referenceBlocks, maxReferenceSpan);

  for (let i = 0; i <= sourceCount; i += 1) {
    const proportionalJ = Math.round((i / Math.max(sourceCount, 1)) * referenceCount);
    const minJ = Math.max(0, proportionalJ - band);
    const maxJ = Math.min(referenceCount, proportionalJ + band);

    for (let j = minJ; j <= maxJ; j += 1) {
      const index = i * width + j;
      const current = costs[index];
      if (!Number.isFinite(current)) {
        continue;
      }

      if (i < sourceCount) {
        const next = (i + 1) * width + j;
        const cost = current + (j === 0 ? leadingSourceSkipCost : sourceSkipCost);
        if (cost < costs[next]) {
          costs[next] = cost;
          moves[next] = 2;
        }
      }

      if (j < referenceCount) {
        const next = i * width + j + 1;
        const cost = current + (i === 0 ? leadingReferenceSkipCost : referenceSkipCost);
        if (cost < costs[next]) {
          costs[next] = cost;
          moves[next] = 3;
        }
      }

      for (let sourceSpan = 1; sourceSpan <= maxSourceSpan; sourceSpan += 1) {
        if (i + sourceSpan > sourceCount) {
          break;
        }

        const sourceText = sourceSpanTexts[i]?.[sourceSpan];
        if (!sourceText) {
          continue;
        }
        for (let referenceSpan = 1; referenceSpan <= maxReferenceSpan; referenceSpan += 1) {
          if (j + referenceSpan > referenceCount) {
            break;
          }

          const referenceText = referenceSpanTexts[j]?.[referenceSpan];
          if (!referenceText) {
            continue;
          }
          const confidence = alignmentConfidenceWithRatio(sourceText, referenceText, input.targetSourceRatio);
          const positionPenalty =
            Math.abs(i / Math.max(sourceCount, 1) - j / Math.max(referenceCount, 1)) * 0.35;
          const spanPenalty = (sourceSpan - 1) * 0.02 + (referenceSpan - 1) * 0.03;
          const next = (i + sourceSpan) * width + j + referenceSpan;
          const cost = current + (1 - confidence) + positionPenalty + spanPenalty;
          if (cost < costs[next]) {
            costs[next] = cost;
            moves[next] = encodeAlignmentMove(sourceSpan, referenceSpan, maxReferenceSpan);
          }
        }
      }
    }
  }

  const aligned: AlignmentGroup[] = [];
  let i = sourceCount;
  let j = referenceCount;
  while (i > 0 || j > 0) {
    const move = moves[i * width + j];
    const span = decodeAlignmentMove(move, maxReferenceSpan);
    if (span) {
      const sourceBlocks = input.sourceBlocks.slice(i - span.sourceSpan, i);
      const referenceBlocks = input.referenceBlocks.slice(j - span.referenceSpan, j);
      const sourceText = joinAlignmentTexts(sourceBlocks.map((block) => block.sourceText));
      const referenceText = joinAlignmentTexts(referenceBlocks.map((block) => block.referenceText));
      aligned.push({
        sourceBlocks,
        referenceBlocks,
        sourceText,
        referenceText,
        confidence: alignmentConfidenceWithRatio(sourceText, referenceText, input.targetSourceRatio)
      });
      i -= span.sourceSpan;
      j -= span.referenceSpan;
    } else if (move === 2) {
      i -= 1;
    } else if (move === 3) {
      j -= 1;
    } else {
      break;
    }
  }

  return aligned.reverse();
}

function alignBlocksWithAnchors(input: {
  sourceBlocks: TextBlock[];
  referenceBlocks: ReferenceBlock[];
  targetSourceRatio: number;
  debug?: AlignmentDebugLogger;
}): AlignmentGroup[] {
  input.debug?.step("anchor_candidate_start", {
    sourceBlocks: input.sourceBlocks.length,
    referenceBlocks: input.referenceBlocks.length
  });
  const anchors = selectMonotonicAlignmentAnchors(
    buildAlignmentAnchorCandidates(input.sourceBlocks, input.referenceBlocks)
  );
  input.debug?.step("anchor_candidate_finish", { anchorCount: anchors.length });
  if (anchors.length === 0) {
    input.debug?.step("anchor_window_dp_start", { mode: "no_anchors" });
    return alignBlocksByDynamicProgramming({
      sourceBlocks: input.sourceBlocks,
      referenceBlocks: input.referenceBlocks,
      targetSourceRatio: input.targetSourceRatio,
      allowLeadingSkip: false
    });
  }

  const groups: AlignmentGroup[] = [];
  let previousSource = 0;
  let previousReference = 0;
  for (const [anchorIndex, anchor] of anchors.entries()) {
    if (anchor.sourceIndex < previousSource || anchor.referenceIndex < previousReference) {
      continue;
    }

    input.debug?.step("anchor_window_dp_start", {
      anchorIndex,
      sourceWindow: anchor.sourceIndex - previousSource,
      referenceWindow: anchor.referenceIndex - previousReference
    });
    groups.push(
      ...alignWindowSafely({
        sourceBlocks: input.sourceBlocks.slice(previousSource, anchor.sourceIndex),
        referenceBlocks: input.referenceBlocks.slice(previousReference, anchor.referenceIndex),
        targetSourceRatio: input.targetSourceRatio
      })
    );
    groups.push(
      makeAlignmentGroup({
        sourceBlocks: [input.sourceBlocks[anchor.sourceIndex]!],
        referenceBlocks: [input.referenceBlocks[anchor.referenceIndex]!],
        targetSourceRatio: input.targetSourceRatio
      })
    );
    previousSource = anchor.sourceIndex + 1;
    previousReference = anchor.referenceIndex + 1;
  }

  input.debug?.step("anchor_window_dp_start", {
    anchorIndex: "tail",
    sourceWindow: input.sourceBlocks.length - previousSource,
    referenceWindow: input.referenceBlocks.length - previousReference
  });
  groups.push(
    ...alignWindowSafely({
      sourceBlocks: input.sourceBlocks.slice(previousSource),
      referenceBlocks: input.referenceBlocks.slice(previousReference),
      targetSourceRatio: input.targetSourceRatio
    })
  );

  input.debug?.step("anchor_window_dp_finish", { groupCount: groups.length });
  return groups;
}

function alignWindowSafely(input: {
  sourceBlocks: TextBlock[];
  referenceBlocks: ReferenceBlock[];
  targetSourceRatio: number;
}): AlignmentGroup[] {
  if (input.sourceBlocks.length === 0 || input.referenceBlocks.length === 0) {
    return [];
  }

  const maxCells = Number(process.env.ALIGNMENT_DP_MAX_CELLS ?? 900000);
  if (input.sourceBlocks.length * input.referenceBlocks.length <= maxCells) {
    return alignBlocksByDynamicProgramming({
      sourceBlocks: input.sourceBlocks,
      referenceBlocks: input.referenceBlocks,
      targetSourceRatio: input.targetSourceRatio,
      allowLeadingSkip: false
    });
  }

  const chunkSize = Number(process.env.ALIGNMENT_DP_CHUNK_SOURCE_BLOCKS ?? 180);
  const groups: AlignmentGroup[] = [];
  const sourceCount = input.sourceBlocks.length;
  const referenceCount = input.referenceBlocks.length;
  for (let sourceStart = 0; sourceStart < sourceCount; sourceStart += chunkSize) {
    const sourceEnd = Math.min(sourceCount, sourceStart + chunkSize);
    const referenceStart = Math.floor((sourceStart / sourceCount) * referenceCount);
    const referenceEnd = sourceEnd === sourceCount
      ? referenceCount
      : Math.ceil((sourceEnd / sourceCount) * referenceCount);
    groups.push(
      ...alignBlocksByDynamicProgramming({
        sourceBlocks: input.sourceBlocks.slice(sourceStart, sourceEnd),
        referenceBlocks: input.referenceBlocks.slice(referenceStart, Math.max(referenceStart + 1, referenceEnd)),
        targetSourceRatio: input.targetSourceRatio,
        allowLeadingSkip: false
      })
    );
  }
  return groups;
}

function buildAlignmentAnchorCandidates(
  sourceBlocks: TextBlock[],
  referenceBlocks: ReferenceBlock[]
): AlignmentAnchor[] {
  const sourceFeatures = sourceBlocks.map((block) => buildAlignmentFingerprint(block.sourceText));
  const referenceFeatures = referenceBlocks.map((block) => buildAlignmentFingerprint(block.referenceText));
  const candidates: AlignmentAnchor[] = [];
  const minAnchorScore = Number(process.env.ALIGNMENT_ANCHOR_MIN_SCORE ?? 0.62);
  const maxPositionDrift = Number(process.env.ALIGNMENT_ANCHOR_MAX_POSITION_DRIFT ?? 0.18);
  const maxWindow = Number(process.env.ALIGNMENT_ANCHOR_MAX_TARGET_WINDOW ?? 180);

  for (let sourceIndex = 0; sourceIndex < sourceBlocks.length; sourceIndex += 1) {
    const source = sourceFeatures[sourceIndex]!;
    if (source.anchors.size + source.numbers.size < 2) {
      continue;
    }

    const proportionalReferenceIndex = Math.round(
      (sourceIndex / Math.max(sourceBlocks.length, 1)) * referenceBlocks.length
    );
    const driftWindow = Math.ceil(referenceBlocks.length * maxPositionDrift);
    const halfWindow = Math.min(maxWindow, Math.max(24, driftWindow));
    const minReferenceIndex = Math.max(0, proportionalReferenceIndex - halfWindow);
    const maxReferenceIndex = Math.min(referenceBlocks.length - 1, proportionalReferenceIndex + halfWindow);
    const scored: Array<{ referenceIndex: number; score: number }> = [];

    for (let referenceIndex = minReferenceIndex; referenceIndex <= maxReferenceIndex; referenceIndex += 1) {
      const reference = referenceFeatures[referenceIndex]!;
      if (reference.anchors.size + reference.numbers.size < 1) {
        continue;
      }
        const positionDrift = Math.abs(
          sourceIndex / Math.max(sourceBlocks.length, 1) -
            referenceIndex / Math.max(referenceBlocks.length, 1)
        );
        if (positionDrift > maxPositionDrift) {
          continue;
        }

        const entityScore = jaccard(source.anchors, reference.anchors);
        const numberScore = jaccard(source.numbers, reference.numbers);
        if (entityScore === 0 && numberScore === 0) {
          continue;
        }

        const dialogueScore = 1 - Math.min(1, Math.abs(source.dialogueRatio - reference.dialogueRatio));
        const lengthScore = 1 - Math.min(1, Math.abs(source.lengthBucket - reference.lengthBucket) / 4);
        const score =
          entityScore * 0.52 +
          numberScore * 0.28 +
          dialogueScore * 0.08 +
          lengthScore * 0.06 +
          (1 - positionDrift) * 0.06;
        scored.push({ referenceIndex, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < minAnchorScore) {
      continue;
    }
    const second = scored[1]?.score ?? 0;
    candidates.push({
      sourceIndex,
      referenceIndex: best.referenceIndex,
      score: best.score,
      uniqueness: best.score - second
    });
  }

  return candidates;
}

function selectMonotonicAlignmentAnchors(candidates: AlignmentAnchor[] = []): AlignmentAnchor[] {
  const minUniqueness = Number(process.env.ALIGNMENT_ANCHOR_MIN_UNIQUENESS ?? 0.08);
  const strong = candidates
    .filter((candidate) => candidate.uniqueness >= minUniqueness)
    .sort((a, b) => a.sourceIndex - b.sourceIndex || a.referenceIndex - b.referenceIndex);
  if (strong.length <= 1) {
    return strong;
  }

  const bestLengths = new Array<number>(strong.length).fill(1);
  const previous = new Array<number>(strong.length).fill(-1);
  let bestIndex = 0;
  for (let i = 0; i < strong.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (strong[j]!.referenceIndex < strong[i]!.referenceIndex && bestLengths[j]! + 1 > bestLengths[i]!) {
        bestLengths[i] = bestLengths[j]! + 1;
        previous[i] = j;
      }
    }
    if (
      bestLengths[i]! > bestLengths[bestIndex]! ||
      (bestLengths[i] === bestLengths[bestIndex] && strong[i]!.score > strong[bestIndex]!.score)
    ) {
      bestIndex = i;
    }
  }

  const selected: AlignmentAnchor[] = [];
  for (let cursor = bestIndex; cursor >= 0; cursor = previous[cursor]!) {
    selected.push(strong[cursor]!);
    if (previous[cursor] === -1) {
      break;
    }
  }
  return selected.reverse();
}

function encodeAlignmentMove(sourceSpan: number, referenceSpan: number, maxReferenceSpan: number): number {
  return 10 + (sourceSpan - 1) * maxReferenceSpan + referenceSpan - 1;
}

function buildSourceSpanTexts(blocks: TextBlock[], maxSpan: number): Array<Record<number, string>> {
  return blocks.map((_, index) => {
    const spans: Record<number, string> = {};
    const texts: string[] = [];
    for (let span = 1; span <= maxSpan && index + span <= blocks.length; span += 1) {
      texts.push(blocks[index + span - 1]!.sourceText);
      spans[span] = joinAlignmentTexts(texts);
    }
    return spans;
  });
}

function buildReferenceSpanTexts(
  blocks: ReferenceBlock[],
  maxSpan: number
): Array<Record<number, string>> {
  return blocks.map((_, index) => {
    const spans: Record<number, string> = {};
    const texts: string[] = [];
    for (let span = 1; span <= maxSpan && index + span <= blocks.length; span += 1) {
      texts.push(blocks[index + span - 1]!.referenceText);
      spans[span] = joinAlignmentTexts(texts);
    }
    return spans;
  });
}

function decodeAlignmentMove(
  move: number,
  maxReferenceSpan: number
): { sourceSpan: number; referenceSpan: number } | undefined {
  if (move < 10) {
    return undefined;
  }

  const encoded = move - 10;
  return {
    sourceSpan: Math.floor(encoded / maxReferenceSpan) + 1,
    referenceSpan: (encoded % maxReferenceSpan) + 1
  };
}

function joinAlignmentTexts(texts: string[]): string {
  return texts.map((text) => text.trim()).filter(Boolean).join("\n");
}

function makeAlignmentGroup(input: {
  sourceBlocks: TextBlock[];
  referenceBlocks: ReferenceBlock[];
  targetSourceRatio: number;
}): AlignmentGroup {
  const sourceText = joinAlignmentTexts(input.sourceBlocks.map((block) => block.sourceText));
  const referenceText = joinAlignmentTexts(input.referenceBlocks.map((block) => block.referenceText));
  return {
    sourceBlocks: input.sourceBlocks,
    referenceBlocks: input.referenceBlocks,
    sourceText,
    referenceText,
    confidence: alignmentConfidenceWithRatio(sourceText, referenceText, input.targetSourceRatio)
  };
}

async function rerankAlignmentGroupsWithLocalLlm(input: {
  groups: AlignmentGroup[];
  referenceBlocks: ReferenceBlock[];
  targetSourceRatio: number;
}): Promise<AlignmentGroup[]> {
  const config = localAlignmentJudgeConfig();
  if (!config.enabled || input.groups.length === 0) {
    return input.groups;
  }

  const limit = Math.min(input.groups.length, config.maxPairs);
  const startedAt = Date.now();
  const reranked: AlignmentGroup[] = [];
  for (let index = 0; index < input.groups.length; index += 1) {
    const group = input.groups[index]!;
    if (index >= limit || Date.now() - startedAt > config.timeBudgetMs) {
      reranked.push(group);
      continue;
    }

    const candidates = buildReferenceAlignmentCandidates({
      referenceBlocks: input.referenceBlocks,
      anchorBlockIndex: group.referenceBlocks[0]?.blockIndex ?? 0,
      radius: config.candidateRadius,
      maxSpan: config.maxCandidateSpan
    });
    if (candidates.length === 0) {
      reranked.push(group);
      continue;
    }

    try {
      const judgment = await judgeAlignmentCandidateWithLocalLlm({
        config,
        sourceText: group.sourceText,
        candidates
      });
      const chosen =
        judgment.best_candidate_index === null ? undefined : candidates[judgment.best_candidate_index];
      if (!chosen || judgment.match_type === "wrong" || judgment.confidence < config.minConfidence) {
        reranked.push({ ...group, confidence: Math.min(group.confidence, 0.49) });
        continue;
      }

      const sourceBlocks = group.sourceBlocks;
      const sourceText = group.sourceText;
      const referenceText = chosen.text;
      reranked.push({
        sourceBlocks,
        referenceBlocks: chosen.blocks,
        sourceText,
        referenceText,
        confidence: Number(
          Math.max(
            0.05,
            Math.min(
              0.96,
              judgment.confidence * 0.72 +
                alignmentConfidenceWithRatio(sourceText, referenceText, input.targetSourceRatio) * 0.28
            )
          ).toFixed(2)
        )
      });
    } catch {
      reranked.push(group);
    }
  }

  return reranked;
}

async function alignBlocksWithLocalLlmStepper(input: {
  sourceBlocks: TextBlock[];
  referenceBlocks: ReferenceBlock[];
  targetSourceRatio: number;
}): Promise<AlignmentGroup[] | undefined> {
  const config = localAlignmentJudgeConfig();
  if (!config.enabled || input.sourceBlocks.length === 0 || input.referenceBlocks.length === 0) {
    return undefined;
  }

  const groups: AlignmentGroup[] = [];
  let sourceIndex = 0;
  let referenceIndex = 0;
  const maxSourceSpan = Number(process.env.LM_STUDIO_ALIGNMENT_STEP_MAX_SOURCE_SPAN ?? 4);
  const maxReferenceSpan = Number(process.env.LM_STUDIO_ALIGNMENT_STEP_MAX_REFERENCE_SPAN ?? 3);

  for (
    let step = 0;
    step < config.maxPairs && sourceIndex < input.sourceBlocks.length && referenceIndex < input.referenceBlocks.length;
    step += 1
  ) {
    const candidates = buildLocalAlignmentStepCandidates({
      sourceBlocks: input.sourceBlocks,
      referenceBlocks: input.referenceBlocks,
      sourceIndex,
      referenceIndex,
      maxSourceSpan,
      maxReferenceSpan
    });
    if (candidates.length === 0) {
      break;
    }

    let chosen = chooseBestLengthCandidate(candidates, input.targetSourceRatio);
    try {
      const judgment = await judgeAlignmentStepWithLocalLlm({ config, candidates });
      const llmChosen =
        judgment.best_candidate_index === null ? undefined : candidates[judgment.best_candidate_index];
      if (llmChosen && judgment.match_type !== "wrong" && judgment.confidence >= config.minConfidence) {
        chosen = llmChosen;
      }
    } catch {
      // Keep the local length fallback when LM Studio is unavailable or returns malformed JSON.
    }

    groups.push(
      makeAlignmentGroup({
        sourceBlocks: input.sourceBlocks.slice(sourceIndex, sourceIndex + chosen.sourceSpan),
        referenceBlocks: input.referenceBlocks.slice(referenceIndex, referenceIndex + chosen.referenceSpan),
        targetSourceRatio: input.targetSourceRatio
      })
    );
    sourceIndex += chosen.sourceSpan;
    referenceIndex += chosen.referenceSpan;
  }

  if (sourceIndex < input.sourceBlocks.length && referenceIndex < input.referenceBlocks.length) {
    groups.push(
      ...alignBlocksByDynamicProgramming({
        sourceBlocks: input.sourceBlocks.slice(sourceIndex),
        referenceBlocks: input.referenceBlocks.slice(referenceIndex),
        targetSourceRatio: input.targetSourceRatio,
        allowLeadingSkip: false
      })
    );
  }

  return groups;
}

function buildLocalAlignmentStepCandidates(input: {
  sourceBlocks: TextBlock[];
  referenceBlocks: ReferenceBlock[];
  sourceIndex: number;
  referenceIndex: number;
  maxSourceSpan: number;
  maxReferenceSpan: number;
}): LocalAlignmentStepCandidate[] {
  const candidates: LocalAlignmentStepCandidate[] = [];
  for (
    let sourceSpan = 1;
    sourceSpan <= input.maxSourceSpan && input.sourceIndex + sourceSpan <= input.sourceBlocks.length;
    sourceSpan += 1
  ) {
    const sourceText = joinAlignmentTexts(
      input.sourceBlocks
        .slice(input.sourceIndex, input.sourceIndex + sourceSpan)
        .map((block) => block.sourceText)
    );
    for (
      let referenceSpan = 1;
      referenceSpan <= input.maxReferenceSpan && input.referenceIndex + referenceSpan <= input.referenceBlocks.length;
      referenceSpan += 1
    ) {
      const referenceText = joinAlignmentTexts(
        input.referenceBlocks
          .slice(input.referenceIndex, input.referenceIndex + referenceSpan)
          .map((block) => block.referenceText)
      );
      candidates.push({ sourceSpan, referenceSpan, sourceText, referenceText });
    }
  }
  return candidates;
}

function chooseBestLengthCandidate(
  candidates: LocalAlignmentStepCandidate[],
  targetSourceRatio: number
): LocalAlignmentStepCandidate {
  return candidates
    .map((candidate) => ({
      candidate,
      score: alignmentConfidenceWithRatio(candidate.sourceText, candidate.referenceText, targetSourceRatio)
    }))
    .sort((a, b) => b.score - a.score)[0]!.candidate;
}

function localAlignmentJudgeConfig(): {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  timeBudgetMs: number;
  maxPairs: number;
  candidateRadius: number;
  maxCandidateSpan: number;
  minConfidence: number;
} {
  const baseUrl = process.env.LM_STUDIO_BASE_URL ?? process.env.LMSTUDIO_BASE_URL ?? "";
  const enabled =
    Boolean(baseUrl) &&
    !["0", "false", "off"].includes(
      (process.env.LM_STUDIO_ALIGNMENT_ENABLED ?? process.env.LOCAL_ALIGNMENT_LLM_ENABLED ?? "true").toLowerCase()
    );

  return {
    enabled,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model:
      process.env.LM_STUDIO_ALIGNMENT_MODEL ??
      process.env.LM_STUDIO_MODEL ??
      process.env.LOCAL_ALIGNMENT_LLM_MODEL ??
      "qwen3.5-9b",
    timeoutMs: Number(process.env.LM_STUDIO_ALIGNMENT_TIMEOUT_MS ?? 10000),
    timeBudgetMs: Number(process.env.LM_STUDIO_ALIGNMENT_TIME_BUDGET_MS ?? 60000),
    maxPairs: Number(process.env.LM_STUDIO_ALIGNMENT_MAX_PAIRS ?? 24),
    candidateRadius: Number(process.env.LM_STUDIO_ALIGNMENT_CANDIDATE_RADIUS ?? 3),
    maxCandidateSpan: Number(process.env.LM_STUDIO_ALIGNMENT_MAX_SPAN ?? 2),
    minConfidence: Number(process.env.LM_STUDIO_ALIGNMENT_MIN_CONFIDENCE ?? 0.45)
  };
}

function buildReferenceAlignmentCandidates(input: {
  referenceBlocks: ReferenceBlock[];
  anchorBlockIndex: number;
  radius: number;
  maxSpan: number;
}): ReferenceAlignmentCandidate[] {
  const byBlockIndex = new Map(input.referenceBlocks.map((block, index) => [block.blockIndex, index]));
  const anchorIndex = byBlockIndex.get(input.anchorBlockIndex) ?? 0;
  const candidates: ReferenceAlignmentCandidate[] = [];
  const seen = new Set<string>();

  for (
    let start = Math.max(0, anchorIndex - input.radius);
    start <= Math.min(input.referenceBlocks.length - 1, anchorIndex + input.radius);
    start += 1
  ) {
    for (let span = 1; span <= input.maxSpan && start + span <= input.referenceBlocks.length; span += 1) {
      const blocks = input.referenceBlocks.slice(start, start + span);
      const key = `${blocks[0]?.blockIndex}:${span}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({
        startBlockIndex: blocks[0]!.blockIndex,
        blocks,
        text: joinAlignmentTexts(blocks.map((block) => block.referenceText))
      });
    }
  }

  return candidates.slice(0, 16);
}

async function judgeAlignmentCandidateWithLocalLlm(input: {
  config: ReturnType<typeof localAlignmentJudgeConfig>;
  sourceText: string;
  candidates: ReferenceAlignmentCandidate[];
}): Promise<LocalAlignmentJudgeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const response = await fetch(`${input.config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.config.model,
        temperature: 0,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: [
              "You are an English-Korean literary alignment judge.",
              "Choose the Korean candidate that best corresponds to the English source.",
              "Do not translate. Return strict JSON only."
            ].join(" ")
          },
          {
            role: "user",
            content: buildLocalAlignmentJudgePrompt(input.sourceText, input.candidates)
          }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`LM Studio alignment request failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LM Studio alignment response was empty.");
    }
    return parseLocalAlignmentJudgeResult(content);
  } finally {
    clearTimeout(timeout);
  }
}

async function judgeAlignmentStepWithLocalLlm(input: {
  config: ReturnType<typeof localAlignmentJudgeConfig>;
  candidates: LocalAlignmentStepCandidate[];
}): Promise<LocalAlignmentJudgeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const response = await fetch(`${input.config.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.config.model,
        temperature: 0,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: [
              "You are an English-Korean literary alignment judge.",
              "Choose the candidate pair that best aligns the next source passage with the next Korean passage.",
              "Prefer sequential continuity. Do not translate. Return strict JSON only."
            ].join(" ")
          },
          {
            role: "user",
            content: buildLocalAlignmentStepPrompt(input.candidates)
          }
        ]
      })
    });
    if (!response.ok) {
      throw new Error(`LM Studio alignment step request failed: ${response.status}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LM Studio alignment step response was empty.");
    }
    return parseLocalAlignmentJudgeResult(content);
  } finally {
    clearTimeout(timeout);
  }
}

function buildLocalAlignmentJudgePrompt(
  sourceText: string,
  candidates: ReferenceAlignmentCandidate[]
): string {
  return [
    "SOURCE_EN:",
    sourceText,
    "",
    "KOREAN_CANDIDATES:",
    ...candidates.map((candidate, index) => `[${index}] block=${candidate.startBlockIndex}\n${candidate.text}`),
    "",
    "Return JSON:",
    '{"best_candidate_index":number|null,"match_type":"exact|partial|merged|split|wrong","confidence":0.0,"reason":"short"}'
  ].join("\n");
}

function buildLocalAlignmentStepPrompt(candidates: LocalAlignmentStepCandidate[]): string {
  return [
    "Choose the best NEXT alignment pair. Each candidate consumes source_span English blocks and reference_span Korean blocks.",
    "",
    "CANDIDATES:",
    ...candidates.map(
      (candidate, index) =>
        `[${index}] source_span=${candidate.sourceSpan} reference_span=${candidate.referenceSpan}\nSOURCE_EN:\n${candidate.sourceText}\nKOREAN:\n${candidate.referenceText}`
    ),
    "",
    "Return JSON:",
    '{"best_candidate_index":number|null,"match_type":"exact|partial|merged|split|wrong","confidence":0.0,"reason":"short"}'
  ].join("\n");
}

function parseLocalAlignmentJudgeResult(raw: string): LocalAlignmentJudgeResult {
  const parsed = JSON.parse(stripJsonFence(raw)) as Partial<LocalAlignmentJudgeResult>;
  const matchType = parsed.match_type;
  return {
    best_candidate_index:
      typeof parsed.best_candidate_index === "number" ? parsed.best_candidate_index : null,
    match_type:
      matchType === "exact" ||
      matchType === "partial" ||
      matchType === "merged" ||
      matchType === "split" ||
      matchType === "wrong"
        ? matchType
        : "wrong",
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined
  };
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

async function importReferenceForBook(
  projectId: ProjectId,
  bookId: BookId,
  input: { referencePath?: string } = {}
): Promise<AlignmentRunSummary | undefined> {
  let referencePath = input.referencePath;
  if (!referencePath) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Reference translation import",
      properties: ["openFile"],
      filters: [
        { name: "Reference", extensions: ["epub", "txt", "md", "docx", "hwpx", "hwp", "html", "htm", "xhtml"] }
      ]
    });

    if (canceled || !filePaths[0]) {
      return undefined;
    }
    referencePath = filePaths[0];
  }

  const project = findProject(projectId);
  const extension = parsePath(referencePath).ext.toLowerCase().replace(/^\./, "") || "txt";
  const data = readFileSync(referencePath);
  const documentId = randomUUID();
  const referenceDir = join(project.workspacePath, "reference", bookId);
  mkdirSync(referenceDir, { recursive: true });
  const copiedPath = join(referenceDir, `${documentId}.${extension}`);
  writeFileSync(copiedPath, data);

  let referenceTexts: string[];
  let referenceChapters: Array<{
    chapterIndex: number;
    title?: string;
    spineHref: string;
    blocks: Array<{ sourceText: string }>;
  }> = [];
  if (extension === "epub") {
    const unpacked = await unpackEpub({
      epubPath: copiedPath,
      outputDir: join(project.workspacePath, "reference_extracted", bookId, documentId)
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
    referenceChapters = chapters;
    referenceTexts = chapters.flatMap((chapter) => chapter.blocks.map((block) => block.sourceText));
  } else {
    referenceTexts = extractReferenceTextBlocks({ extension, data });
  }

  const now = nowTimestamp();
  const db = openProjectDb(project);
  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const document: SourceDocument = {
      id: documentId,
      bookId,
      filePath: copiedPath,
      fileType: extension,
      fileHash: hashEpubBytes(data),
      role: "reference_translation",
      importedAt: now
    };
    new SourceDocumentRepository(db).create(document);
    let referenceBlockIndex = 0;
    const blocks: ReferenceBlock[] =
      extension === "epub"
        ? referenceChapters.flatMap((chapter) =>
            chapter.blocks.map((block): ReferenceBlock => ({
              id: randomUUID() as ReferenceBlockId,
              projectId,
              bookId,
              documentId,
              blockIndex: referenceBlockIndex++,
              chapterIndex: chapter.chapterIndex,
              spineHref: chapter.spineHref,
              title: chapter.title,
              referenceText: block.sourceText,
              normalizedText: normalizeSearchText(block.sourceText),
              textHash: tmSourceHash(block.sourceText),
              createdAt: now
            }))
          )
        : referenceTexts.map((text, index) => ({
            id: randomUUID() as ReferenceBlockId,
            projectId,
            bookId,
            documentId,
            blockIndex: index,
            referenceText: text,
            normalizedText: normalizeSearchText(text),
            textHash: tmSourceHash(text),
            createdAt: now
          }));
    new ReferenceBlockRepository(db).replaceForDocument({ blocks });

    const sourceBlocks = new TextBlockRepository(db).listByChapterIds(
      new ChapterRepository(db).listByBook(bookId).map((chapter) => chapter.id)
    );

    return {
      book,
      referenceDocument: document,
      sourceBlockCount: sourceBlocks.length,
      referenceBlockCount: blocks.length,
      pairCount: 0,
      averageConfidence: 0
    };
  } finally {
    db.close();
  }
}

async function reimportLastReferenceForBook(
  projectId: ProjectId,
  bookId: BookId
): Promise<AlignmentRunSummary | undefined> {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const latest = new SourceDocumentRepository(db).findLatestByBookRole({
      bookId,
      role: "reference_translation"
    });
    if (!latest) {
      throw new Error("이 책에 다시 import할 reference 파일 기록이 없습니다.");
    }
    if (!existsSync(latest.filePath)) {
      throw new Error(`마지막 reference 파일을 찾을 수 없습니다: ${latest.filePath}`);
    }
    return importReferenceForBook(projectId, bookId, { referencePath: latest.filePath });
  } finally {
    db.close();
  }
}

function groupSourceBlocksByChapter(
  db: ReturnType<typeof openProjectDb>,
  chapters: Chapter[]
): Map<Chapter["id"], TextBlock[]> {
  const blocks = new TextBlockRepository(db).listByChapterIds(chapters.map((chapter) => chapter.id));
  const chapterOrder = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  blocks.sort((a, b) => {
    const chapterDiff = (chapterOrder.get(a.chapterId) ?? 0) - (chapterOrder.get(b.chapterId) ?? 0);
    return chapterDiff || a.blockIndex - b.blockIndex;
  });

  const grouped = new Map<Chapter["id"], TextBlock[]>();
  for (const block of blocks) {
    const existing = grouped.get(block.chapterId) ?? [];
    existing.push(block);
    grouped.set(block.chapterId, existing);
  }
  return grouped;
}

function sourceBlocksFromStartChapter(
  db: ReturnType<typeof openProjectDb>,
  chapters: Chapter[],
  sourceChapterId?: Chapter["id"]
): TextBlock[] {
  const startIndex = sourceChapterId
    ? Math.max(0, chapters.findIndex((chapter) => chapter.id === sourceChapterId))
    : 0;
  const selectedChapters = chapters.slice(startIndex);
  const grouped = groupSourceBlocksByChapter(db, selectedChapters);
  return selectedChapters.flatMap((chapter) => grouped.get(chapter.id) ?? []);
}

function groupReferencePreviewChapters(blocks: ReferenceBlock[]): AlignmentPreviewChapter[] {
  if (blocks.length === 0) {
    return [];
  }

  const groups = new Map<string, ReferenceBlock[]>();
  for (const block of blocks) {
    const key =
      block.chapterIndex !== undefined
        ? `chapter:${block.chapterIndex}:${block.spineHref ?? ""}`
        : `chunk:${Math.floor(block.blockIndex / 50)}`;
    const existing = groups.get(key) ?? [];
    existing.push(block);
    groups.set(key, existing);
  }

  return Array.from(groups.values()).map((group, index): AlignmentPreviewChapter => {
    const first = group[0]!;
    const candidate = classifyTextSection({
      title: first.title,
      spineHref: first.spineHref,
      chapterIndex: first.chapterIndex ?? index,
      paragraphs: group.map((block) => block.referenceText),
      isSource: false
    });
    return {
      chapterIndex: first.chapterIndex ?? index,
      spineHref: first.spineHref,
      title: first.title,
      blockStartIndex: first.blockIndex,
      blockCount: group.length,
      previewText: group.slice(0, 3).map((block) => block.referenceText).join("\n"),
      candidateType: candidate.candidateType,
      confidence: candidate.confidence,
      reason: candidate.reason
    };
  });
}

function classifyTextSection(input: {
  title?: string;
  spineHref?: string;
  chapterIndex: number;
  paragraphs: string[];
  isSource: boolean;
}): { candidateType: string; confidence: number; reason: string } {
  const heading = `${input.title ?? ""} ${input.spineHref ?? ""}`.trim();
  const preview = input.paragraphs.slice(0, 6).join(" ");
  const normalized = `${heading} ${preview}`.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const compact = normalized.replace(/\s/g, "");
  let score = 0.15;
  const reasons: string[] = [];

  if (isChapterHeadingText(heading) || isChapterHeadingText(input.paragraphs[0] ?? "")) {
    score += 0.35;
    reasons.push("chapter heading");
  }
  if (looksLikeNarrativeText(preview)) {
    score += 0.2;
    reasons.push("narrative prose");
  }
  const entityHits = countAlignmentAnchorHits(normalized);
  if (entityHits > 0) {
    score += Math.min(0.25, entityHits * 0.06);
    reasons.push(`anchor terms ${entityHits}`);
  }
  if (input.paragraphs.length >= 3) {
    score += 0.08;
    reasons.push("multi paragraph");
  }
  if (input.chapterIndex <= 2 && !/split_00[2-9]|8\.x?html|8\.html/i.test(input.spineHref ?? "")) {
    score -= 0.06;
  }

  if (
    /contents|table of contents|copyright|title page|dedication|acknowledg|translator|역자|옮긴이|감사의|목차|차례|판권|출판|광고|저작권/i.test(
      normalized
    )
  ) {
    score -= 0.45;
    reasons.push("front/back matter signal");
  }
  if (/^\d{1,4}$/.test(compact) || /^(contents|목차|차례)$/i.test(normalized)) {
    score -= 0.3;
    reasons.push("toc/noise");
  }

  const confidence = Number(Math.max(0.02, Math.min(0.98, score)).toFixed(2));
  const candidateType =
    confidence >= 0.58
      ? "body_chapter"
      : /translator|역자|옮긴이/i.test(normalized)
        ? "translator_note"
        : /contents|목차|차례/i.test(normalized)
          ? "toc"
          : /copyright|판권|저작권|출판/i.test(normalized)
            ? "copyright"
            : "front_matter";

  return {
    candidateType,
    confidence,
    reason: reasons.join(", ") || "weak body signal"
  };
}

function isChapterHeadingText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /^chapter\s+([ivxlcdm]+|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(
      normalized
    ) ||
    /^제\s*\d+\s*장/.test(normalized) ||
    /^\d{1,3}$/.test(normalized)
  );
}

function looksLikeNarrativeText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length < 120) {
    return false;
  }
  const sentenceCount = sentenceLikeCount(normalized);
  const dialogueRatio = (normalized.match(/["“”‘’「」『』]/g)?.length ?? 0) / Math.max(normalized.length, 1);
  return sentenceCount >= 3 && dialogueRatio < 0.08;
}

function countAlignmentAnchorHits(text: string): number {
  const lower = text.toLowerCase();
  const anchors = [
    "cordelia",
    "naismith",
    "dubauer",
    "rosemont",
    "barrayar",
    "barrayaran",
    "beta colony",
    "vorkosigan",
    "코델리아",
    "네이스미스",
    "두바우어",
    "로즈몬트",
    "바라야",
    "베타",
    "보르코시건"
  ];
  return anchors.filter((anchor) => lower.includes(anchor)).length;
}

function bestAlignmentPreviewCandidate(
  candidates: AlignmentPreviewChapter[]
): AlignmentPreviewChapter | undefined {
  return candidates
    .slice()
    .sort((a, b) => {
      const confidenceDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (Math.abs(confidenceDiff) > 0.08) {
        return confidenceDiff;
      }
      return a.chapterIndex - b.chapterIndex;
    })[0];
}

function bestReferenceMatchForSource(
  source: AlignmentPreviewChapter | undefined,
  references: AlignmentPreviewChapter[]
): AlignmentPreviewChapter | undefined {
  if (!source) {
    return bestAlignmentPreviewCandidate(references);
  }

  const sourceFingerprint = buildAlignmentFingerprint(source.previewText);
  return references
    .slice()
    .sort((a, b) => {
      const scoreA = sectionMatchScore(sourceFingerprint, a);
      const scoreB = sectionMatchScore(sourceFingerprint, b);
      return scoreB - scoreA;
    })[0];
}

function sectionMatchScore(
  sourceFingerprint: AlignmentFingerprint,
  reference: AlignmentPreviewChapter
): number {
  const referenceFingerprint = buildAlignmentFingerprint(reference.previewText);
  return (
    (reference.confidence ?? 0) * 0.45 +
    jaccard(sourceFingerprint.anchors, referenceFingerprint.anchors) * 0.35 +
    jaccard(sourceFingerprint.numbers, referenceFingerprint.numbers) * 0.12 +
    (1 - Math.min(1, Math.abs(sourceFingerprint.dialogueRatio - referenceFingerprint.dialogueRatio))) * 0.05 +
    (1 - Math.min(1, Math.abs(sourceFingerprint.lengthBucket - referenceFingerprint.lengthBucket) / 4)) * 0.03
  );
}

function buildAlignmentFingerprint(text: string): AlignmentFingerprint {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const anchorGroups: Array<[string, string[]]> = [
    ["cordelia", ["cordelia", "코델리아"]],
    ["naismith", ["naismith", "네이스미스"]],
    ["dubauer", ["dubauer", "두바우어"]],
    ["rosemont", ["rosemont", "로즈몬트"]],
    ["barrayar", ["barrayar", "barrayaran", "바라야"]],
    ["beta", ["beta colony", "베타"]],
    ["vorkosigan", ["vorkosigan", "보르코시건"]],
    ["mist", ["mist", "fog", "안개"]],
    ["mountain", ["mountain", "ridge", "산", "고지대"]],
    ["shuttle", ["shuttle", "셔틀"]],
    ["smoke", ["smoke", "연기"]]
  ];
  const anchors = new Set(
    anchorGroups
      .filter(([, aliases]) => aliases.some((alias) => lower.includes(alias)))
      .map(([canonical]) => canonical)
  );
  const numbers = new Set(extractComparableNumbers(normalized));
  const dialogueRatio = (normalized.match(/["“”‘’「」『』]/g)?.length ?? 0) / Math.max(normalized.length, 1);
  const lengthBucket = Math.min(8, Math.floor(normalized.length / 250));
  return { anchors, numbers, dialogueRatio, lengthBucket };
}

function extractComparableNumbers(text: string): string[] {
  const lower = text.toLowerCase();
  const numbers = lower.match(/\d+(?:[.,]\d+)?/g)?.map((value) => value.replace(/[,.]/g, "")) ?? [];
  const numberWords: Record<string, string> = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    eleven: "11",
    twelve: "12",
    thirteen: "13",
    fourteen: "14",
    fifteen: "15",
    sixteen: "16",
    seventeen: "17",
    eighteen: "18",
    nineteen: "19",
    twenty: "20",
    fifty: "50",
    "fifty-six": "56"
  };
  for (const [word, value] of Object.entries(numberWords)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) {
      numbers.push(value);
    }
  }
  return Array.from(new Set(numbers));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

function inferSourceBodyStartChapter(
  chapters: Chapter[],
  blocksByChapterId: Map<Chapter["id"], TextBlock[]>
): Chapter["id"] | undefined {
  const candidates = chapters.map((chapter): AlignmentPreviewChapter => {
    const blocks = blocksByChapterId.get(chapter.id) ?? [];
    const candidate = classifyTextSection({
      title: chapter.title,
      spineHref: chapter.spineHref,
      chapterIndex: chapter.chapterIndex,
      paragraphs: blocks.map((block) => block.sourceText),
      isSource: true
    });
    return {
      chapterId: chapter.id,
      chapterIndex: chapter.chapterIndex,
      spineHref: chapter.spineHref,
      title: chapter.title,
      blockStartIndex: 0,
      blockCount: blocks.length,
      previewText: blocks.slice(0, 3).map((block) => block.sourceText).join("\n"),
      candidateType: candidate.candidateType,
      confidence: candidate.confidence,
      reason: candidate.reason
    };
  });
  return bestAlignmentPreviewCandidate(
    candidates.filter((candidate) => candidate.candidateType === "body_chapter")
  )?.chapterId;
}

function inferReferenceBodyStartIndex(blocks: ReferenceBlock[]): number | undefined {
  return bestAlignmentPreviewCandidate(
    groupReferencePreviewChapters(blocks).filter((candidate) => candidate.candidateType === "body_chapter")
  )?.blockStartIndex;
}

function inferReferenceBodyStartIndexForSource(
  blocks: ReferenceBlock[],
  sourcePreview: AlignmentPreviewChapter | undefined
): number | undefined {
  const candidates = groupReferencePreviewChapters(blocks).filter(
    (candidate) => candidate.candidateType === "body_chapter"
  );
  return bestReferenceMatchForSource(sourcePreview, candidates)?.blockStartIndex;
}

function listAlignmentPreview(projectId: ProjectId, bookId: BookId): AlignmentPreview {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const chapters = new ChapterRepository(db).listByBook(bookId);
    const blocksByChapterId = groupSourceBlocksByChapter(db, chapters);
    const sourceChapters = chapters.map((chapter): AlignmentPreviewChapter => {
      const blocks = blocksByChapterId.get(chapter.id) ?? [];
      const candidate = classifyTextSection({
        title: chapter.title,
        spineHref: chapter.spineHref,
        chapterIndex: chapter.chapterIndex,
        paragraphs: blocks.map((block) => block.sourceText),
        isSource: true
      });
      return {
        chapterId: chapter.id,
        chapterIndex: chapter.chapterIndex,
        spineHref: chapter.spineHref,
        title: chapter.title,
        blockStartIndex: 0,
        blockCount: blocks.length,
        previewText: blocks.slice(0, 3).map((block) => block.sourceText).join("\n"),
        candidateType: candidate.candidateType,
        confidence: candidate.confidence,
        reason: candidate.reason
      };
    });

    const referenceBlocks = new ReferenceBlockRepository(db).listByBook(projectId, bookId);
    const referenceChapters = groupReferencePreviewChapters(referenceBlocks);
    const suggestedSource = bestAlignmentPreviewCandidate(
      sourceChapters.filter((chapter) => chapter.candidateType === "body_chapter")
    );
    const referenceBodyCandidates =
      referenceChapters.filter((chapter) => chapter.candidateType === "body_chapter")
    const suggestedReference = bestReferenceMatchForSource(suggestedSource, referenceBodyCandidates);

    return {
      sourceChapters,
      referenceChapters,
      suggestedSourceChapterId: suggestedSource?.chapterId,
      suggestedReferenceBlockStartIndex: suggestedReference?.blockStartIndex
    };
  } finally {
    db.close();
  }
}

async function runAlignmentForBook(
  projectId: ProjectId,
  bookId: BookId,
  options: AlignmentRunOptions = {}
): Promise<AlignmentRunSummary> {
  const project = findProject(projectId);
  const debug = createAlignmentDebugLogger(project, bookId);
  debug.step("start", { projectId, bookId, options });
  const db = openProjectDb(project);
  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const chapters = new ChapterRepository(db).listByBook(bookId);
    debug.step("load_source_chapters", { chapterCount: chapters.length });
    const referenceBlocksForPreview = new ReferenceBlockRepository(db).listByBook(projectId, bookId);
    debug.step("load_reference_blocks", { referenceBlockCount: referenceBlocksForPreview.length });
    const sourceBlocksByChapter = groupSourceBlocksByChapter(db, chapters);
    debug.step("group_source_blocks", {
      sourceBlockCount: Array.from(sourceBlocksByChapter.values()).reduce(
        (sum, blocks) => sum + blocks.length,
        0
      )
    });
    const inferredSourceChapterId =
      options.sourceChapterId ??
      inferSourceBodyStartChapter(chapters, sourceBlocksByChapter);
    const inferredSourceChapter = chapters.find((chapter) => chapter.id === inferredSourceChapterId);
    const inferredSourceBlocks = inferredSourceChapter
      ? sourceBlocksByChapter.get(inferredSourceChapter.id) ?? []
      : [];
    const inferredSourcePreview: AlignmentPreviewChapter | undefined = inferredSourceChapter
      ? {
          chapterId: inferredSourceChapter.id,
          chapterIndex: inferredSourceChapter.chapterIndex,
          spineHref: inferredSourceChapter.spineHref,
          title: inferredSourceChapter.title,
          blockStartIndex: 0,
          blockCount: inferredSourceBlocks.length,
          previewText: inferredSourceBlocks.slice(0, 3).map((block) => block.sourceText).join("\n")
        }
      : undefined;
    const inferredReferenceStartIndex =
      options.referenceBlockStartIndex ??
      inferReferenceBodyStartIndexForSource(referenceBlocksForPreview, inferredSourcePreview) ??
      inferReferenceBodyStartIndex(referenceBlocksForPreview);
    debug.step("infer_body_start", {
      inferredSourceChapterId,
      inferredSourceSpineHref: inferredSourceChapter?.spineHref,
      inferredReferenceStartIndex
    });
    const sourceBlocks = sourceBlocksFromStartChapter(db, chapters, inferredSourceChapterId);
    const referenceBlocks = new ReferenceBlockRepository(db)
      .listByBook(projectId, bookId)
      .filter((block) => block.blockIndex >= (inferredReferenceStartIndex ?? 0));
    const alignableSourceBlocks = sourceBlocks.filter(isAlignableSourceBlock);
    const alignableReferenceBlocks = withoutConsecutiveDuplicateReferenceBlocks(
      referenceBlocks.filter(isAlignableReferenceBlock)
    );
    debug.step("filter_alignable_blocks", {
      sourceBlocks: sourceBlocks.length,
      referenceBlocks: referenceBlocks.length,
      alignableSourceBlocks: alignableSourceBlocks.length,
      alignableReferenceBlocks: alignableReferenceBlocks.length
    });
    const targetSourceRatio = estimateReferenceRatio(alignableSourceBlocks, alignableReferenceBlocks);
    debug.step("estimate_reference_ratio", { targetSourceRatio });
    const alignedBlocks = alignBlocksWithAnchors({
      sourceBlocks: alignableSourceBlocks,
      referenceBlocks: alignableReferenceBlocks,
      targetSourceRatio,
      debug
    });
    const rerankConfidenceThreshold = Number(process.env.ALIGNMENT_RERANK_CONFIDENCE_THRESHOLD ?? 0.88);
    debug.step("align_blocks_with_anchors", {
      groupCount: alignedBlocks.length,
      rerankCandidateCount: alignedBlocks.filter((group) => group.confidence < rerankConfidenceThreshold).length,
      rerankConfidenceThreshold
    });
    const rerankCandidateGroups = alignedBlocks.filter(
      (group) => group.confidence < rerankConfidenceThreshold
    );
    const rerankedCandidateGroups = await rerankAlignmentGroupsWithLocalLlm({
      groups: rerankCandidateGroups,
      referenceBlocks: alignableReferenceBlocks,
      targetSourceRatio
    });
    debug.step("rerank_candidate_groups", {
      requestedCount: rerankCandidateGroups.length,
      returnedCount: rerankedCandidateGroups.length
    });
    const rerankedQueue = [...rerankedCandidateGroups];
    const rerankedBlocks = alignedBlocks.map((group) =>
      group.confidence < rerankConfidenceThreshold ? rerankedQueue.shift() ?? group : group
    );
    const now = nowTimestamp();
    const pairs: AlignmentPair[] = rerankedBlocks.map(({ sourceBlocks, referenceBlocks, sourceText, referenceText, confidence }) => {
      const source = sourceBlocks[0]!;
      const reference = referenceBlocks[0]!;
      return {
        id: randomUUID() as AlignmentPairId,
        projectId,
        bookId,
        sourceBlockId: source.id,
        referenceBlockId: reference.id,
        sourceText,
        referenceText,
        confidence,
        status: "candidate",
        createdAt: now,
        updatedAt: now
      };
    });

    new AlignmentPairRepository(db).replaceCandidatesForBook({ pairs });
    debug.step("replace_alignment_pairs", { pairCount: pairs.length });
    const confidenceTotal = pairs.reduce((sum, pair) => sum + pair.confidence, 0);
    const debugLogPath = debug.finish({
      pairCount: pairs.length,
      averageConfidence: pairs.length > 0 ? Number((confidenceTotal / pairs.length).toFixed(2)) : 0
    });

    return {
      book,
      sourceBlockCount: sourceBlocks.length,
      referenceBlockCount: referenceBlocks.length,
      pairCount: pairs.length,
      averageConfidence: pairs.length > 0 ? Number((confidenceTotal / pairs.length).toFixed(2)) : 0,
      debugLogPath: debugLogPath || undefined
    };
  } finally {
    db.close();
  }
}

function listAlignmentPairs(projectId: ProjectId, bookId: BookId): AlignmentPair[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new AlignmentPairRepository(db).listByBook(projectId, bookId);
  } finally {
    db.close();
  }
}

function promoteAlignmentPair(
  projectId: ProjectId,
  input: PromoteAlignmentPairRequest
): AlignmentPair {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const repository = new AlignmentPairRepository(db);
    const pair = repository.get(projectId, input.pairId);
    if (!pair) {
      throw new Error(`Alignment pair not found: ${input.pairId}`);
    }
    if (pair.promotedTmUnitId) {
      return repository.updateStatus({
        projectId,
        pairId: pair.id,
        status: "approved"
      });
    }

    const now = nowTimestamp();
    const grade = input.grade ?? (pair.confidence >= 0.88 ? "silver" : "reference");
    const tmUnit = new TmUnitRepository(db).upsert({
      unit: {
        id: randomUUID(),
        projectId,
        bookId: pair.bookId,
        sourceText: pair.sourceText,
        targetText: pair.referenceText,
        sourceHash: tmSourceHash(pair.sourceText),
        grade,
        origin: "alignment_auto",
        confidence: pair.confidence,
        notes: `alignment_pair=${pair.id}`,
        createdAt: now,
        updatedAt: now
      }
    });

    return repository.updateStatus({
      projectId,
      pairId: pair.id,
      status: "approved",
      tmUnitId: tmUnit.id
    });
  } finally {
    db.close();
  }
}

function rejectAlignmentPair(projectId: ProjectId, pairId: AlignmentPairId): AlignmentPair {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new AlignmentPairRepository(db).updateStatus({
      projectId,
      pairId,
      status: "rejected"
    });
  } finally {
    db.close();
  }
}

function buildSeriesMemorySection(input: {
  stylebookEntries: StylebookEntry[];
  characterProfiles: CharacterProfile[];
  chapterMemories: ChapterMemory[];
}): string {
  const lines: string[] = ["Series memory and stylebook:"];
  for (const entry of input.stylebookEntries.slice(0, 12)) {
    lines.push(`- [${entry.entryType}] ${entry.title}: ${entry.body}`);
  }
  for (const profile of input.characterProfiles.slice(0, 12)) {
    lines.push(
      `- Character ${profile.name}: ${[
        profile.aliases ? `aliases ${profile.aliases}` : "",
        profile.description,
        profile.speechStyle ? `speech ${profile.speechStyle}` : "",
        profile.translationNotes
      ]
        .filter(Boolean)
        .join("; ")}`
    );
  }
  for (const memory of input.chapterMemories.slice(0, 8)) {
    lines.push(`- Prior chapter memory: ${memory.summary}${memory.termNotes ? `; terms ${memory.termNotes}` : ""}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function listStylebookEntries(projectId: ProjectId): StylebookEntry[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new StylebookEntryRepository(db).list(projectId);
  } finally {
    db.close();
  }
}

function saveStylebookEntry(
  projectId: ProjectId,
  input: SaveStylebookEntryRequest
): StylebookEntry {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw new Error("Stylebook title and body are required.");
  }

  const project = findProject(projectId);
  const db = openProjectDb(project);
  const now = nowTimestamp();
  try {
    return new StylebookEntryRepository(db).upsert({
      entry: {
        id: randomUUID(),
        projectId,
        entryType: input.entryType ?? "note",
        title,
        body,
        priority: input.priority ?? 50,
        createdAt: now,
        updatedAt: now
      }
    });
  } finally {
    db.close();
  }
}

function listCharacterProfiles(projectId: ProjectId): CharacterProfile[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new CharacterProfileRepository(db).list(projectId);
  } finally {
    db.close();
  }
}

function saveCharacterProfile(
  projectId: ProjectId,
  input: SaveCharacterProfileRequest
): CharacterProfile {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Character name is required.");
  }

  const project = findProject(projectId);
  const db = openProjectDb(project);
  const now = nowTimestamp();
  try {
    return new CharacterProfileRepository(db).upsert({
      profile: {
        id: randomUUID(),
        projectId,
        name,
        aliases: input.aliases?.trim() || undefined,
        description: input.description?.trim() || undefined,
        speechStyle: input.speechStyle?.trim() || undefined,
        translationNotes: input.translationNotes?.trim() || undefined,
        createdAt: now,
        updatedAt: now
      }
    });
  } finally {
    db.close();
  }
}

function listChapterMemories(projectId: ProjectId, bookId: BookId): ChapterMemory[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new ChapterMemoryRepository(db).listByBook(projectId, bookId);
  } finally {
    db.close();
  }
}

function saveChapterMemory(
  projectId: ProjectId,
  bookId: BookId,
  input: SaveChapterMemoryRequest
): ChapterMemory {
  const summary = input.summary.trim();
  if (!summary) {
    throw new Error("Chapter memory summary is required.");
  }

  const project = findProject(projectId);
  const db = openProjectDb(project);
  const now = nowTimestamp();
  try {
    return new ChapterMemoryRepository(db).upsert({
      memory: {
        id: randomUUID(),
        projectId,
        bookId,
        chapterId: input.chapterId,
        summary,
        termNotes: input.termNotes?.trim() || undefined,
        createdAt: now,
        updatedAt: now
      }
    });
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

async function exportTmForProject(projectId: ProjectId): Promise<string | undefined> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "TM CSV export",
    defaultPath: "series.tm.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (canceled || !filePath) {
    return undefined;
  }

  const rows = [
    ["sourceText", "targetText", "grade", "origin", "confidence", "notes"],
    ...listTmUnits(projectId).map((unit) => [
      unit.sourceText,
      unit.targetText,
      unit.grade,
      unit.origin,
      unit.confidence ?? "",
      unit.notes ?? ""
    ])
  ];
  writeFileSync(filePath, rows.map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n"));
  return filePath;
}

async function exportBilingualCsv(projectId: ProjectId, bookId: BookId): Promise<string | undefined> {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Bilingual CSV export",
      defaultPath: `${sanitizeFileName(book.title)}.bilingual.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });
    if (canceled || !filePath) {
      return undefined;
    }

    const segments = new TranslationSegmentRepository(db).listByBook(bookId);
    const rows = [
      ["segmentId", "status", "sourceText", "aiTranslation", "finalTranslation"],
      ...segments.map((segment) => [
        segment.id,
        segment.status,
        segment.sourceText,
        segment.aiTranslation ?? "",
        segment.finalTranslation ?? segment.editorialTranslation ?? ""
      ])
    ];
    writeFileSync(filePath, rows.map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n"));
    return filePath;
  } finally {
    db.close();
  }
}

async function exportQaReport(projectId: ProjectId, bookId: BookId): Promise<string | undefined> {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "QA report export",
      defaultPath: `${sanitizeFileName(book.title)}.qa.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (canceled || !filePath) {
      return undefined;
    }

    const segments = new TranslationSegmentRepository(db).listByBook(bookId);
    const summary = buildSpoilerSafeSummary(projectId, bookId);
    const lines = [
      `# QA Report: ${book.title}`,
      "",
      `- Segments: ${summary.totalSegments}`,
      `- Translated: ${summary.translatedSegments}`,
      `- Approved: ${summary.editorialApproved}`,
      `- Needs review: ${summary.needsReview}`,
      `- Blocking errors: ${summary.blockingErrors}`,
      `- Glossary warnings: ${summary.glossaryWarnings}`,
      "",
      "## Segment Flags",
      ""
    ];
    for (const segment of segments) {
      const issues = parseQaIssues(segment);
      if (issues.length > 0 || ["error", "editorial_error", "needs_review"].includes(segment.status)) {
        lines.push(`- ${segment.id} (${segment.status}): ${issues.join("; ") || "manual review"}`);
      }
    }
    writeFileSync(filePath, lines.join("\n"));
    return filePath;
  } finally {
    db.close();
  }
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
  const sourceFileHash = hashEpubBytes(readFileSync(epubPath));
  const duplicateDb = openProjectDb(project);
  try {
    const existingDocument = new SourceDocumentRepository(duplicateDb).findByProjectFileHash({
      projectId,
      fileHash: sourceFileHash,
      role: "source_original"
    });
    if (existingDocument) {
      const existingBook = new BookRepository(duplicateDb)
        .list(projectId)
        .find((candidate) => candidate.id === existingDocument.bookId);
      if (!existingBook) {
        throw new Error(`Duplicate source document exists without a book: ${existingDocument.id}`);
      }

      const chapters = new ChapterRepository(duplicateDb).listByBook(existingBook.id);
      const blocks = new TextBlockRepository(duplicateDb).listByChapterIds(
        chapters.map((chapter) => chapter.id)
      );

      return {
        book: existingBook,
        document: existingDocument,
        chapterCount: chapters.length,
        blockCount: blocks.length,
        extractedDir: join(project.workspacePath, "extracted", existingBook.id)
      };
    }
  } finally {
    duplicateDb.close();
  }

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
    const sourceDocument = new SourceDocumentRepository(db).findLatestByBookRole({
      bookId,
      role: "source_original"
    });
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const outputPath = join(
      project.workspacePath,
      "output",
      `${sanitizeFileName(book.title)}.m1-export.epub`
    );
    const replacementSpineHrefs: string[] = [];

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
    for (const block of blocks) {
      const chapter = chapterById.get(block.chapterId);
      if (chapter?.spineHref) {
        replacementSpineHrefs.push(chapter.spineHref);
      }
    }

    const validation = validateEpubFile(outputPath);
    const artifacts = await writeRoundTripArtifacts({
      project,
      book,
      sourceDocument,
      sourceExtractedDir: join(project.workspacePath, "extracted", book.id),
      outputPath,
      replacementCount: blocks.length,
      replacementSpineHrefs,
      validation,
      mode: "roundtrip"
    });

    return {
      book,
      outputPath,
      replacementCount: blocks.length,
      manifestPath: artifacts.manifestPath,
      reportPath: artifacts.reportPath,
      validation
    };
  } finally {
    db.close();
  }
}

async function translateBookForProject(
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

    const chapters = new ChapterRepository(db).listByBook(bookId);
    if (chapters.length === 0) {
      throw new Error(`No imported chapters found for book: ${book.title}`);
    }

    const blocks = new TextBlockRepository(db).listByChapterIds(chapters.map((chapter) => chapter.id));
    if (blocks.length === 0) {
      throw new Error(`No translatable text blocks found for book: ${book.title}`);
    }
    const provider = createTranslationProvider();
    const jobRepository = new TranslationJobRepository(db);
    const glossaryTerms = new GlossaryTermRepository(db).list(projectId);
    const glossaryVersion = glossaryVersionHash(glossaryTerms);
    const tmUnits = new TmUnitRepository(db).listUsable(projectId);
    const tmVersion = tmVersionHash(tmUnits);
    const seriesMemorySection = buildSeriesMemorySection({
      stylebookEntries: new StylebookEntryRepository(db).list(projectId),
      characterProfiles: new CharacterProfileRepository(db).list(projectId),
      chapterMemories: new ChapterMemoryRepository(db).listByBook(projectId, bookId)
    });
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
        seriesMemorySection,
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
        .find(
          (segment) =>
            segment.blockId === block.id &&
            segment.promptHash === promptHash &&
            ["translated", "needs_review", "reviewed", "approved"].includes(segment.status)
        );
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
  bookId: BookId,
  mode: TranslationExportMode = "draft"
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
      `${sanitizeFileName(book.title)}.ko-${mode}.epub`
    );

    await rebuildEpub({
      extractedDir: join(project.workspacePath, "extracted", book.id),
      outputPath,
      metadata: {
        title: `${book.title} KO ${modeLabel(mode)}`
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
          text: segmentTextForExportMode(segment, block.sourceText, mode)
        };
      })
    });

    return {
      book,
      outputPath,
      mode,
      replacementCount: segments.filter((segment) => segment.finalTranslation ?? segment.aiTranslation)
        .length,
      validation: validateEpubFile(outputPath)
    };
  } finally {
    db.close();
  }
}

function latestSegmentMap(segments: TranslationSegment[]): Map<string, TranslationSegment> {
  return new Map(segments.map((segment) => [segment.blockId, segment]));
}

function modeLabel(mode: TranslationExportMode): string {
  return mode === "draft" ? "Draft" : mode === "reviewed" ? "Reviewed" : "Final";
}

function segmentTextForExportMode(
  segment: TranslationSegment | undefined,
  sourceText: string,
  mode: TranslationExportMode
): string {
  if (mode === "draft") {
    return segment?.aiTranslation ?? sourceText;
  }

  if (mode === "reviewed") {
    return (
      segment?.finalTranslation ??
      segment?.reviewedTranslation ??
      segment?.editorialTranslation ??
      segment?.aiTranslation ??
      sourceText
    );
  }

  return (
    segment?.finalTranslation ??
    segment?.reviewedTranslation ??
    segment?.editorialTranslation ??
    segment?.aiTranslation ??
    sourceText
  );
}

function segmentDraftText(segment: TranslationSegment | undefined, sourceText: string): string {
  return (
    segment?.finalTranslation ??
    segment?.reviewedTranslation ??
    segment?.editorialTranslation ??
    segment?.aiTranslation ??
    sourceText
  ).trim();
}

function exportDraftTextForProject(projectId: ProjectId, bookId: BookId): string {
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
    const blocksByChapterId = new Map<string, TextBlock[]>();
    for (const block of blocks) {
      const chapterBlocks = blocksByChapterId.get(block.chapterId) ?? [];
      chapterBlocks.push(block);
      blocksByChapterId.set(block.chapterId, chapterBlocks);
    }

    const segments = new TranslationSegmentRepository(db).listByBook(bookId);
    const segmentByBlockId = latestSegmentMap(segments);
    const lines = [`# ${book.title}`, ""];

    if (book.author) {
      lines.push(`Author: ${book.author}`, "");
    }

    for (const chapter of chapters) {
      const chapterBlocks = blocksByChapterId.get(chapter.id) ?? [];
      if (chapter.title) {
        lines.push(`## ${chapter.title}`, "");
      }

      for (const block of chapterBlocks) {
        const text = segmentDraftText(segmentByBlockId.get(block.id), block.sourceText);
        if (text.length > 0) {
          lines.push(text, "");
        }
      }
    }

    const outputDir = join(project.workspacePath, "output");
    mkdirSync(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${sanitizeFileName(book.title)}.translated.draft.txt`);
    writeFileSync(outputPath, lines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
    return outputPath;
  } finally {
    db.close();
  }
}

function setBookSpoilerSafe(
  projectId: ProjectId,
  bookId: BookId,
  enabled: boolean
): Book {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    return new BookRepository(db).updateSpoilerSafe({ projectId, bookId, enabled });
  } finally {
    db.close();
  }
}

function buildSpoilerSafeSummary(projectId: ProjectId, bookId: BookId): SpoilerSafeSummary {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const translationJob = new TranslationJobRepository(db).latestByBook(bookId);
    const segments = translationJob
      ? new TranslationSegmentRepository(db).listByJob(translationJob.id)
      : [];
    const editorialJobs = new EditorialJobRepository(db).listByBook(bookId);
    const latestEditorialJob = editorialJobs[0];
    const decisions = latestEditorialJob
      ? new EditorialDecisionRepository(db).listByJob(latestEditorialJob.id)
      : [];
    const glossaryWarnings = segments.reduce((count, segment) => {
      if (!segment.responseJson) {
        return count;
      }
      try {
        const parsed = JSON.parse(segment.responseJson) as { glossaryIssues?: unknown[] };
        return count + (Array.isArray(parsed.glossaryIssues) ? parsed.glossaryIssues.length : 0);
      } catch {
        return count;
      }
    }, 0);
    const statusCounts = segments.reduce<Record<string, number>>((counts, segment) => {
      counts[segment.status] = (counts[segment.status] ?? 0) + 1;
      return counts;
    }, {});
    const blockingErrors =
      (statusCounts.error ?? 0) + (statusCounts.editorial_error ?? 0) +
      decisions.filter((decision) => {
        try {
          const flags = JSON.parse(decision.qaFlagsJson) as Array<{ severity?: string }>;
          return flags.some((flag) => flag.severity === "blocking" || flag.severity === "error");
        } catch {
          return false;
        }
      }).length;
    const approvedCount = decisions.length
      ? decisions.filter((decision) => decision.decision === "approve").length
      : statusCounts.editorial_approved ?? 0;
    const needsReview = decisions.length
      ? decisions.filter((decision) => decision.decision === "needs_review").length
      : statusCounts.needs_review ?? 0;
    const rejected = decisions.filter((decision) => decision.decision === "reject").length;
    const totalSegments = segments.length;
    const canExport =
      totalSegments > 0 &&
      decisions.length > 0 &&
      blockingErrors === 0 &&
      segments.some((segment) => segment.finalTranslation || segment.editorialTranslation);

    return {
      bookId,
      totalSegments,
      translatedSegments: segments.filter((segment) => segment.aiTranslation).length,
      editorialApproved: approvedCount,
      needsReview,
      rejected,
      blockingErrors,
      goldCandidates: decisions.filter((decision) => decision.tmGrade === "gold_candidate").length,
      glossaryWarnings,
      newTermCandidates: new GlossaryTermRepository(db)
        .list(projectId)
        .filter((term) => term.needsReview).length,
      canExport,
      summary: canExport
        ? "Spoiler-safe EPUB 생성이 가능합니다. 본문 내용은 표시하지 않습니다."
        : "아직 spoiler-safe EPUB 생성 조건이 충족되지 않았습니다. 본문 내용은 표시하지 않습니다."
    };
  } finally {
    db.close();
  }
}

async function exportSpoilerSafeBookForProject(
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

    const summary = buildSpoilerSafeSummary(projectId, bookId);
    if (!summary.canExport) {
      throw new Error("Spoiler-safe export 조건이 충족되지 않았습니다.");
    }

    const chapters = new ChapterRepository(db).listByBook(bookId);
    const blocks = new TextBlockRepository(db).listByChapterIds(
      chapters.map((chapter) => chapter.id)
    );
    const translationJob = new TranslationJobRepository(db).latestByBook(bookId);
    if (!translationJob) {
      throw new Error("번역 job이 없습니다.");
    }
    const segments = new TranslationSegmentRepository(db).listByJob(translationJob.id);
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const segmentByBlockId = new Map(segments.map((segment) => [segment.blockId, segment]));
    const outputPath = join(
      project.workspacePath,
      "output",
      `${sanitizeFileName(book.title)}.spoiler-safe.epub`
    );

    await rebuildEpub({
      extractedDir: join(project.workspacePath, "extracted", book.id),
      outputPath,
      metadata: {
        title: `${book.title} KO Spoiler Safe`
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
          text:
            segment?.finalTranslation ??
            segment?.editorialTranslation ??
            segment?.aiTranslation ??
            block.sourceText
        };
      })
    });

    return {
      book,
      outputPath,
      replacementCount: segments.filter(
        (segment) => segment.finalTranslation ?? segment.editorialTranslation ?? segment.aiTranslation
      ).length,
      validation: validateEpubFile(outputPath)
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

async function runEditorialForProject(
  projectId: ProjectId,
  bookId: BookId
): Promise<EditorialRunSummary> {
  const project = findProject(projectId);
  const db = openProjectDb(project);

  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const translationJob = new TranslationJobRepository(db).latestByBook(bookId);
    if (!translationJob) {
      throw new Error("먼저 M2 번역 job을 실행하세요.");
    }

    const segmentRepository = new TranslationSegmentRepository(db);
    const sourceSegments = segmentRepository
      .listByJob(translationJob.id)
      .filter((segment) => segment.aiTranslation?.trim());
    if (sourceSegments.length === 0) {
      throw new Error("감수할 번역 segment가 없습니다.");
    }

    const provider = createEditorialProvider();
    const jobRepository = new EditorialJobRepository(db);
    const now = nowTimestamp();
    const existingJob = jobRepository
      .listByBook(bookId)
      .find(
        (candidate) =>
          ["running", "paused", "failed"].includes(candidate.status) &&
          candidate.translationJobId === translationJob.id &&
          candidate.provider === provider.name &&
          candidate.model === currentProviderModel()
      );
    const job: EditorialJob =
      existingJob ??
      jobRepository.create({
        job: {
          id: randomUUID() as JobId,
          projectId,
          bookId,
          translationJobId: translationJob.id,
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

    const decisionRepository = new EditorialDecisionRepository(db);
    const glossaryTerms = new GlossaryTermRepository(db).list(projectId);
    const tmUnits = new TmUnitRepository(db).listUsable(projectId);
    const characterProfiles = new CharacterProfileRepository(db).list(projectId);
    const editorialCharacterProfiles = characterProfiles.map((profile) => ({
      name: profile.name,
      summary: [
        profile.description,
        profile.speechStyle ? `speech: ${profile.speechStyle}` : undefined,
        profile.translationNotes ? `notes: ${profile.translationNotes}` : undefined
      ]
        .filter(Boolean)
        .join("\n")
    }));
    const seriesMemorySection = buildSeriesMemorySection({
      stylebookEntries: new StylebookEntryRepository(db).list(projectId),
      characterProfiles,
      chapterMemories: new ChapterMemoryRepository(db).listByBook(projectId, bookId)
    });
    let processedCount = 0;
    let approvedCount = 0;
    let needsReviewCount = 0;
    let rejectedCount = 0;
    let goldCandidateCount = 0;
    let errorCount = 0;

    for (const segment of sourceSegments) {
      const latestJob = jobRepository.get(job.id);
      if (latestJob?.status === "paused" || latestJob?.status === "cancelled") {
        job.status = latestJob.status;
        break;
      }

      const aiTranslation = segment.aiTranslation ?? "";
      const tmMatches = findTmMatches({ sourceText: segment.sourceText, units: tmUnits });
      const glossaryHits = findGlossaryHits(segment.sourceText, glossaryTerms);
      const previousContext = sourceSegments
        .slice(Math.max(0, sourceSegments.indexOf(segment) - 3), sourceSegments.indexOf(segment))
        .map((candidate) => ({
          sourceText: candidate.sourceText,
          translation:
            candidate.editorialTranslation ??
            candidate.finalTranslation ??
            candidate.aiTranslation ??
            ""
        }))
        .filter((candidate) => candidate.translation.trim());
      const promptHash = sha256(
        JSON.stringify({
          promptVersion: editorialPromptVersion,
          prompt: editorialPrompt,
          sourceHash: segment.sourceHash,
          aiTranslationHash: sha256(aiTranslation),
          tmContext: tmMatches.map((match) => [match.unit.id, match.weightedScore]),
          glossaryContext: glossaryHits.map((hit) => hit.termId),
          seriesMemoryHash: sha256(seriesMemorySection)
        })
      );

      try {
        segmentRepository.updateEditorialResult({
          segmentId: segment.id,
          status: "editorial_running",
          editorialPromptHash: promptHash
        });

        const response = await provider.editSegment({
          projectId,
          bookId,
          segmentId: segment.id,
          sourceText: segment.sourceText,
          aiTranslation,
          tmMatches,
          glossaryHits,
          stylebookSummary: seriesMemorySection,
          characterProfiles: editorialCharacterProfiles,
          previousContext,
          systemPrompt: editorialPrompt,
          promptVersion: editorialPromptVersion
        });
        const createdAt = nowTimestamp();
        decisionRepository.upsert({
          decision: {
            id: randomUUID(),
            editorialJobId: job.id,
            segmentId: segment.id,
            sourceText: segment.sourceText,
            aiTranslation,
            editorialTranslation: response.editorialTranslation,
            decision: response.decision,
            tmGrade: response.tmGrade,
            confidence: response.confidence,
            rationale: response.rationale,
            qaFlagsJson: JSON.stringify(response.qaFlags),
            responseJson: JSON.stringify({
              provider: provider.name,
              response: response.responseJson,
              usage: response.usage,
              usedReferenceParts: response.usedReferenceParts
            }),
            createdAt,
            updatedAt: createdAt
          }
        });

        const status =
          response.decision === "approve"
            ? "editorial_approved"
            : response.decision === "reject"
              ? "editorial_error"
              : "needs_review";
        segmentRepository.updateEditorialResult({
          segmentId: segment.id,
          editorialTranslation: response.editorialTranslation,
          finalTranslation: response.decision === "approve" ? response.editorialTranslation : undefined,
          status,
          editorialResponseJson: JSON.stringify(response.responseJson),
          editorialPromptHash: promptHash,
          errorMessage:
            response.decision === "approve"
              ? undefined
              : response.qaFlags.map((flag) => flag.message).filter(Boolean).join("\n") ||
                response.rationale
        });

        if (shouldRegisterGoldCandidate(response)) {
          const tmNow = nowTimestamp();
          new TmUnitRepository(db).upsert({
            unit: {
              id: randomUUID(),
              projectId,
              bookId,
              sourceText: segment.sourceText,
              targetText: response.editorialTranslation,
              sourceHash: tmSourceHash(segment.sourceText),
              grade: "gold_candidate",
              origin: "ai_editorial_approved",
              confidence: response.confidence,
              notes: `editorial_job=${job.id}; segment=${segment.id}`,
              createdAt: tmNow,
              updatedAt: tmNow
            }
          });
          goldCandidateCount += 1;
        }

        processedCount += 1;
        approvedCount += response.decision === "approve" ? 1 : 0;
        needsReviewCount += response.decision === "needs_review" ? 1 : 0;
        rejectedCount += response.decision === "reject" ? 1 : 0;
      } catch (caught) {
        errorCount += 1;
        segmentRepository.updateEditorialResult({
          segmentId: segment.id,
          status: "editorial_error",
          editorialPromptHash: promptHash,
          errorMessage: caught instanceof Error ? caught.message : "Editorial failed."
        });
      }

      sendEditorialProgress(
        buildEditorialProgress({
          job,
          decisions: decisionRepository.listByJob(job.id),
          segments: segmentRepository.listByJob(translationJob.id),
          segmentCount: sourceSegments.length
        })
      );
    }

    if (job.status === "running") {
      const completedAt = nowTimestamp();
      job.status = errorCount > 0 || needsReviewCount > 0 || rejectedCount > 0
        ? "completed_with_warnings"
        : "completed";
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
      segmentCount: sourceSegments.length,
      processedCount,
      approvedCount,
      needsReviewCount,
      rejectedCount,
      goldCandidateCount,
      errorCount
    };
  } finally {
    db.close();
  }
}

function listEditorialProgress(projectId: ProjectId, bookId: BookId): EditorialJobProgress[] {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const segmentRepository = new TranslationSegmentRepository(db);
    const decisionRepository = new EditorialDecisionRepository(db);
    return new EditorialJobRepository(db).listByBook(bookId).map((job) =>
      buildEditorialProgress({
        job,
        decisions: decisionRepository.listByJob(job.id),
        segments: segmentRepository.listByJob(job.translationJobId),
        segmentCount: segmentRepository
          .listByJob(job.translationJobId)
          .filter((segment) => segment.aiTranslation?.trim()).length
      })
    );
  } finally {
    db.close();
  }
}

function updateEditorialJobStatus(
  projectId: ProjectId,
  jobId: JobId,
  status: EditorialJob["status"]
): EditorialJobProgress {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const jobRepository = new EditorialJobRepository(db);
    jobRepository.updateStatus({ jobId, status });
    const job = jobRepository.get(jobId);
    if (!job) {
      throw new Error(`Editorial job not found: ${jobId}`);
    }

    const segmentRepository = new TranslationSegmentRepository(db);
    return buildEditorialProgress({
      job,
      decisions: new EditorialDecisionRepository(db).listByJob(job.id),
      segments: segmentRepository.listByJob(job.translationJobId),
      segmentCount: segmentRepository
        .listByJob(job.translationJobId)
        .filter((segment) => segment.aiTranslation?.trim()).length
    });
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
    translateBookForProject(projectId, bookId)
  );

  ipcMain.handle(
    "book:exportTranslated",
    (_event, projectId: ProjectId, bookId: BookId, mode?: TranslationExportMode) =>
      exportTranslatedBookForProject(projectId, bookId, mode ?? "draft")
  );

  ipcMain.handle(
    "book:setSpoilerSafe",
    (_event, projectId: ProjectId, bookId: BookId, enabled: boolean) =>
      setBookSpoilerSafe(projectId, bookId, enabled)
  );

  ipcMain.handle("settings:validateProvider", () => validateTranslationProvider());

  ipcMain.handle("consent:list", (_event, projectId: ProjectId) =>
    listExternalTransferConsents(projectId)
  );

  ipcMain.handle(
    "consent:record",
    (_event, projectId: ProjectId, input: SaveExternalTransferConsentRequest) =>
      saveExternalTransferConsent(projectId, input)
  );

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

  ipcMain.handle("export:tmCsv", (_event, projectId: ProjectId) => exportTmForProject(projectId));

  ipcMain.handle("export:bilingualCsv", (_event, projectId: ProjectId, bookId: BookId) =>
    exportBilingualCsv(projectId, bookId)
  );

  ipcMain.handle("export:qaReport", (_event, projectId: ProjectId, bookId: BookId) =>
    exportQaReport(projectId, bookId)
  );

  ipcMain.handle("export:draftTxt", (_event, projectId: ProjectId, bookId: BookId) =>
    exportDraftTextForProject(projectId, bookId)
  );

  ipcMain.handle("report:readJson", (_event, path: string) => readReportJson(path));

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
    translateBookForProject(projectId, bookId)
  );

  ipcMain.handle("translation:cancel", (_event, projectId: ProjectId, jobId: JobId) =>
    updateTranslationJobStatus(projectId, jobId, "cancelled")
  );

  ipcMain.handle("editorial:run", (_event, projectId: ProjectId, bookId: BookId) =>
    runEditorialForProject(projectId, bookId)
  );

  ipcMain.handle("editorial:listJobs", (_event, projectId: ProjectId, bookId: BookId) =>
    listEditorialProgress(projectId, bookId)
  );

  ipcMain.handle("editorial:pause", (_event, projectId: ProjectId, jobId: JobId) =>
    updateEditorialJobStatus(projectId, jobId, "paused")
  );

  ipcMain.handle("editorial:resume", (_event, projectId: ProjectId, bookId: BookId) =>
    runEditorialForProject(projectId, bookId)
  );

  ipcMain.handle("editorial:cancel", (_event, projectId: ProjectId, jobId: JobId) =>
    updateEditorialJobStatus(projectId, jobId, "cancelled")
  );

  ipcMain.handle("spoilerSafe:getSummary", (_event, projectId: ProjectId, bookId: BookId) =>
    buildSpoilerSafeSummary(projectId, bookId)
  );

  ipcMain.handle("spoilerSafe:exportEpub", (_event, projectId: ProjectId, bookId: BookId) =>
    exportSpoilerSafeBookForProject(projectId, bookId)
  );

  ipcMain.handle("review:listSegments", (_event, projectId: ProjectId, bookId: BookId) =>
    listReviewSegments(projectId, bookId)
  );

  ipcMain.handle(
    "review:updateFinalTranslation",
    (_event, projectId: ProjectId, segmentId: SegmentId, finalTranslation: string) =>
      updateReviewFinalTranslation(projectId, segmentId, finalTranslation)
  );

  ipcMain.handle(
    "postRead:searchSegments",
    (_event, projectId: ProjectId, bookId: BookId, query: string) =>
      searchSegmentsBySentence(projectId, bookId, query)
  );

  ipcMain.handle(
    "postRead:saveCorrection",
    (_event, projectId: ProjectId, bookId: BookId, input: SavePostReadCorrectionRequest) =>
      savePostReadCorrection(projectId, bookId, input)
  );

  ipcMain.handle("postRead:listCorrections", (_event, projectId: ProjectId, bookId: BookId) =>
    listPostReadCorrections(projectId, bookId)
  );

  ipcMain.handle(
    "postRead:promoteCorrectionToGold",
    (_event, projectId: ProjectId, correctionId: string) =>
      promoteCorrectionToGold(projectId, correctionId)
  );

  ipcMain.handle("alignment:importReference", (_event, projectId: ProjectId, bookId: BookId) =>
    importReferenceForBook(projectId, bookId)
  );

  ipcMain.handle("alignment:reimportLastReference", (_event, projectId: ProjectId, bookId: BookId) =>
    reimportLastReferenceForBook(projectId, bookId)
  );

  ipcMain.handle("alignment:preview", (_event, projectId: ProjectId, bookId: BookId) =>
    listAlignmentPreview(projectId, bookId)
  );

  ipcMain.handle(
    "alignment:run",
    (_event, projectId: ProjectId, bookId: BookId, options?: AlignmentRunOptions) =>
      runAlignmentForBook(projectId, bookId, options)
  );

  ipcMain.handle("alignment:listPairs", (_event, projectId: ProjectId, bookId: BookId) =>
    listAlignmentPairs(projectId, bookId)
  );

  ipcMain.handle(
    "alignment:promotePair",
    (_event, projectId: ProjectId, input: PromoteAlignmentPairRequest) =>
      promoteAlignmentPair(projectId, input)
  );

  ipcMain.handle("alignment:rejectPair", (_event, projectId: ProjectId, pairId: AlignmentPairId) =>
    rejectAlignmentPair(projectId, pairId)
  );

  ipcMain.handle("memory:listStylebook", (_event, projectId: ProjectId) =>
    listStylebookEntries(projectId)
  );

  ipcMain.handle(
    "memory:saveStylebook",
    (_event, projectId: ProjectId, input: SaveStylebookEntryRequest) =>
      saveStylebookEntry(projectId, input)
  );

  ipcMain.handle("memory:listCharacters", (_event, projectId: ProjectId) =>
    listCharacterProfiles(projectId)
  );

  ipcMain.handle(
    "memory:saveCharacter",
    (_event, projectId: ProjectId, input: SaveCharacterProfileRequest) =>
      saveCharacterProfile(projectId, input)
  );

  ipcMain.handle("memory:listChapterMemories", (_event, projectId: ProjectId, bookId: BookId) =>
    listChapterMemories(projectId, bookId)
  );

  ipcMain.handle(
    "memory:saveChapterMemory",
    (_event, projectId: ProjectId, bookId: BookId, input: SaveChapterMemoryRequest) =>
      saveChapterMemory(projectId, bookId, input)
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
