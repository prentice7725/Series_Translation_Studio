import { randomUUID } from "node:crypto";
import { basename, dirname, join, parse as parsePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  AlignmentRunSummary,
  Book,
  BookId,
  CharacterProfile,
  Chapter,
  ChapterMemory,
  EditorialJob,
  EditorialJobProgress,
  EditorialRunSummary,
  ExportedBookSummary,
  GlossaryImportSummary,
  GlossaryTerm,
  ImportedBookSummary,
  JobId,
  PostReadCorrection,
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

function splitReferenceText(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n|(?<=[.!?。！？])\s+(?=[A-Z가-힣0-9"“‘])/g)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 2);
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
  const sourceQuote = /["“”‘’]/.test(sourceText);
  const referenceQuote = /["“”‘’「」『』]/.test(referenceText);
  const quoteBonus = sourceQuote === referenceQuote ? 0.04 : -0.08;
  return Number(Math.max(0.05, Math.min(0.99, lengthRatio + quoteBonus)).toFixed(2));
}

function textAlignLength(text: string): number {
  return Math.max(normalizeSearchText(text).replace(/\s/g, "").length, 1);
}

function isAlignmentNoiseText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return true;
  }

  const compact = normalized.replace(/\s/g, "");
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
}): Array<{ source: TextBlock; reference: ReferenceBlock; confidence: number }> {
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
  const band = Math.max(80, Math.ceil(Math.abs(sourceCount - referenceCount) * 0.08));

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
        const cost = current + sourceSkipCost;
        if (cost < costs[next]) {
          costs[next] = cost;
          moves[next] = 2;
        }
      }

      if (j < referenceCount) {
        const next = i * width + j + 1;
        const cost = current + referenceSkipCost;
        if (cost < costs[next]) {
          costs[next] = cost;
          moves[next] = 3;
        }
      }

      if (i < sourceCount && j < referenceCount) {
        const source = input.sourceBlocks[i]!;
        const reference = input.referenceBlocks[j]!;
        const confidence = alignmentConfidenceWithRatio(
          source.sourceText,
          reference.referenceText,
          input.targetSourceRatio
        );
        const positionPenalty =
          Math.abs(i / Math.max(sourceCount, 1) - j / Math.max(referenceCount, 1)) * 0.35;
        const next = (i + 1) * width + j + 1;
        const cost = current + (1 - confidence) + positionPenalty;
        if (cost < costs[next]) {
          costs[next] = cost;
          moves[next] = 1;
        }
      }
    }
  }

  const aligned: Array<{ source: TextBlock; reference: ReferenceBlock; confidence: number }> = [];
  let i = sourceCount;
  let j = referenceCount;
  while (i > 0 || j > 0) {
    const move = moves[i * width + j];
    if (move === 1) {
      const source = input.sourceBlocks[i - 1]!;
      const reference = input.referenceBlocks[j - 1]!;
      aligned.push({
        source,
        reference,
        confidence: alignmentConfidenceWithRatio(
          source.sourceText,
          reference.referenceText,
          input.targetSourceRatio
        )
      });
      i -= 1;
      j -= 1;
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

async function importReferenceForBook(
  projectId: ProjectId,
  bookId: BookId
): Promise<AlignmentRunSummary | undefined> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Reference translation import",
    properties: ["openFile"],
    filters: [{ name: "Reference", extensions: ["epub", "txt"] }]
  });

  if (canceled || !filePaths[0]) {
    return undefined;
  }

  const referencePath = filePaths[0];
  const project = findProject(projectId);
  const extension = parsePath(referencePath).ext.toLowerCase().replace(/^\./, "") || "txt";
  const data = readFileSync(referencePath);
  const documentId = randomUUID();
  const referenceDir = join(project.workspacePath, "reference", bookId);
  mkdirSync(referenceDir, { recursive: true });
  const copiedPath = join(referenceDir, `${documentId}.${extension}`);
  writeFileSync(copiedPath, data);

  let referenceTexts: string[];
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
    referenceTexts = chapters.flatMap((chapter) => chapter.blocks.map((block) => block.sourceText));
  } else {
    referenceTexts = splitReferenceText(data.toString("utf8"));
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
    const blocks: ReferenceBlock[] = referenceTexts.map((text, index) => ({
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

function runAlignmentForBook(projectId: ProjectId, bookId: BookId): AlignmentRunSummary {
  const project = findProject(projectId);
  const db = openProjectDb(project);
  try {
    const book = new BookRepository(db).list(projectId).find((candidate) => candidate.id === bookId);
    if (!book) {
      throw new Error(`Book not found: ${bookId}`);
    }

    const sourceBlocks = new TextBlockRepository(db).listByChapterIds(
      new ChapterRepository(db).listByBook(bookId).map((chapter) => chapter.id)
    );
    const referenceBlocks = new ReferenceBlockRepository(db).listByBook(projectId, bookId);
    const alignableSourceBlocks = sourceBlocks.filter(isAlignableSourceBlock);
    const alignableReferenceBlocks = referenceBlocks.filter(isAlignableReferenceBlock);
    const targetSourceRatio = estimateReferenceRatio(alignableSourceBlocks, alignableReferenceBlocks);
    const alignedBlocks = alignBlocksByDynamicProgramming({
      sourceBlocks: alignableSourceBlocks,
      referenceBlocks: alignableReferenceBlocks,
      targetSourceRatio
    });
    const now = nowTimestamp();
    const pairs: AlignmentPair[] = alignedBlocks.map(({ source, reference, confidence }) => {
      return {
        id: randomUUID() as AlignmentPairId,
        projectId,
        bookId,
        sourceBlockId: source.id,
        referenceBlockId: reference.id,
        sourceText: source.sourceText,
        referenceText: reference.referenceText,
        confidence,
        status: "candidate",
        createdAt: now,
        updatedAt: now
      };
    });

    new AlignmentPairRepository(db).replaceCandidatesForBook({ pairs });
    const confidenceTotal = pairs.reduce((sum, pair) => sum + pair.confidence, 0);

    return {
      book,
      sourceBlockCount: sourceBlocks.length,
      referenceBlockCount: referenceBlocks.length,
      pairCount: pairs.length,
      averageConfidence: pairs.length > 0 ? Number((confidenceTotal / pairs.length).toFixed(2)) : 0
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
      replacementCount: blocks.length,
      validation: validateEpubFile(outputPath)
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
        .length,
      validation: validateEpubFile(outputPath)
    };
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
          characterProfiles,
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
    translateFirstChapterForProject(projectId, bookId)
  );

  ipcMain.handle("book:exportTranslated", (_event, projectId: ProjectId, bookId: BookId) =>
    exportTranslatedBookForProject(projectId, bookId)
  );

  ipcMain.handle(
    "book:setSpoilerSafe",
    (_event, projectId: ProjectId, bookId: BookId, enabled: boolean) =>
      setBookSpoilerSafe(projectId, bookId, enabled)
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

  ipcMain.handle("export:tmCsv", (_event, projectId: ProjectId) => exportTmForProject(projectId));

  ipcMain.handle("export:bilingualCsv", (_event, projectId: ProjectId, bookId: BookId) =>
    exportBilingualCsv(projectId, bookId)
  );

  ipcMain.handle("export:qaReport", (_event, projectId: ProjectId, bookId: BookId) =>
    exportQaReport(projectId, bookId)
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

  ipcMain.handle("alignment:run", (_event, projectId: ProjectId, bookId: BookId) =>
    runAlignmentForBook(projectId, bookId)
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
