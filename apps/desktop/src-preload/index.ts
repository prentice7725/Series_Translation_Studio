import { contextBridge, ipcRenderer } from "electron";
import type {
  AlignmentPair,
  AlignmentPreview,
  AlignmentPairId,
  AlignmentRunOptions,
  AlignmentRunSummary,
  Book,
  BookId,
  CharacterProfile,
  ChapterMemory,
  EditorialJobProgress,
  EditorialRunSummary,
  ExportedBookSummary,
  GlossaryImportSummary,
  GlossaryTerm,
  ImportedBookSummary,
  PostReadCorrection,
  Project,
  ProviderValidationSummary,
  ProjectId,
  JobId,
  ReviewSegmentSummary,
  SegmentSearchResult,
  SegmentId,
  SpoilerSafeSummary,
  StylebookEntry,
  StylebookEntryType,
  TmGrade,
  TmOrigin,
  TmUnit,
  TranslationJobProgress,
  TranslationRunSummary
} from "@sts/common";

export interface CreateProjectRequest {
  name: string;
  seriesName?: string;
}

export interface SaveGlossaryTermRequest {
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

export interface SaveTmUnitRequest {
  bookId?: BookId;
  sourceText: string;
  targetText: string;
  grade?: TmGrade;
  origin?: TmOrigin;
  confidence?: number;
  notes?: string;
}

export interface SavePostReadCorrectionRequest {
  segmentId: SegmentId;
  correctedText: string;
  note?: string;
}

export interface PromoteAlignmentPairRequest {
  pairId: AlignmentPairId;
  grade?: TmGrade;
}

export interface SaveStylebookEntryRequest {
  entryType?: StylebookEntryType;
  title: string;
  body: string;
  priority?: number;
}

export interface SaveCharacterProfileRequest {
  name: string;
  aliases?: string;
  description?: string;
  speechStyle?: string;
  translationNotes?: string;
}

export interface SaveChapterMemoryRequest {
  chapterId: ChapterMemory["chapterId"];
  summary: string;
  termNotes?: string;
}

export interface StsApi {
  project: {
    create(input: CreateProjectRequest): Promise<Project>;
    list(): Promise<Project[]>;
  };
  book: {
    importEpub(projectId: ProjectId): Promise<ImportedBookSummary | undefined>;
    exportM1(projectId: ProjectId, bookId: BookId): Promise<ExportedBookSummary>;
    translateM2(projectId: ProjectId, bookId: BookId): Promise<TranslationRunSummary>;
    exportTranslated(projectId: ProjectId, bookId: BookId): Promise<ExportedBookSummary>;
    setSpoilerSafe(projectId: ProjectId, bookId: BookId, enabled: boolean): Promise<Book>;
    list(projectId: ProjectId): Promise<Book[]>;
  };
  settings: {
    validateProvider(): Promise<ProviderValidationSummary>;
  };
  glossary: {
    list(projectId: ProjectId): Promise<GlossaryTerm[]>;
    save(projectId: ProjectId, input: SaveGlossaryTermRequest): Promise<GlossaryTerm>;
    delete(projectId: ProjectId, termId: string): Promise<void>;
    importCsv(projectId: ProjectId): Promise<GlossaryImportSummary>;
    exportCsv(projectId: ProjectId): Promise<string | undefined>;
  };
  export: {
    tmCsv(projectId: ProjectId): Promise<string | undefined>;
    bilingualCsv(projectId: ProjectId, bookId: BookId): Promise<string | undefined>;
    qaReport(projectId: ProjectId, bookId: BookId): Promise<string | undefined>;
  };
  tm: {
    list(projectId: ProjectId): Promise<TmUnit[]>;
    save(projectId: ProjectId, input: SaveTmUnitRequest): Promise<TmUnit>;
    delete(projectId: ProjectId, unitId: string): Promise<void>;
    promote(projectId: ProjectId, unitId: string): Promise<TmUnit>;
    reject(projectId: ProjectId, unitId: string): Promise<TmUnit>;
  };
  translation: {
    listJobs(projectId: ProjectId, bookId: BookId): Promise<TranslationJobProgress[]>;
    pause(projectId: ProjectId, jobId: JobId): Promise<TranslationJobProgress>;
    resume(projectId: ProjectId, bookId: BookId): Promise<TranslationRunSummary>;
    cancel(projectId: ProjectId, jobId: JobId): Promise<TranslationJobProgress>;
    onProgress(callback: (progress: TranslationJobProgress) => void): () => void;
  };
  editorial: {
    run(projectId: ProjectId, bookId: BookId): Promise<EditorialRunSummary>;
    listJobs(projectId: ProjectId, bookId: BookId): Promise<EditorialJobProgress[]>;
    pause(projectId: ProjectId, jobId: JobId): Promise<EditorialJobProgress>;
    resume(projectId: ProjectId, bookId: BookId): Promise<EditorialRunSummary>;
    cancel(projectId: ProjectId, jobId: JobId): Promise<EditorialJobProgress>;
    onProgress(callback: (progress: EditorialJobProgress) => void): () => void;
  };
  spoilerSafe: {
    getSummary(projectId: ProjectId, bookId: BookId): Promise<SpoilerSafeSummary>;
    exportEpub(projectId: ProjectId, bookId: BookId): Promise<ExportedBookSummary>;
  };
  review: {
    listSegments(projectId: ProjectId, bookId: BookId): Promise<ReviewSegmentSummary[]>;
    updateFinalTranslation(
      projectId: ProjectId,
      segmentId: SegmentId,
      finalTranslation: string
    ): Promise<ReviewSegmentSummary>;
  };
  postRead: {
    searchSegments(
      projectId: ProjectId,
      bookId: BookId,
      query: string
    ): Promise<SegmentSearchResult[]>;
    saveCorrection(
      projectId: ProjectId,
      bookId: BookId,
      input: SavePostReadCorrectionRequest
    ): Promise<PostReadCorrection>;
    listCorrections(projectId: ProjectId, bookId: BookId): Promise<PostReadCorrection[]>;
    promoteCorrectionToGold(projectId: ProjectId, correctionId: string): Promise<PostReadCorrection>;
  };
  alignment: {
    importReference(projectId: ProjectId, bookId: BookId): Promise<AlignmentRunSummary | undefined>;
    reimportLastReference(projectId: ProjectId, bookId: BookId): Promise<AlignmentRunSummary | undefined>;
    preview(projectId: ProjectId, bookId: BookId): Promise<AlignmentPreview>;
    run(projectId: ProjectId, bookId: BookId, options?: AlignmentRunOptions): Promise<AlignmentRunSummary>;
    listPairs(projectId: ProjectId, bookId: BookId): Promise<AlignmentPair[]>;
    promotePair(projectId: ProjectId, input: PromoteAlignmentPairRequest): Promise<AlignmentPair>;
    rejectPair(projectId: ProjectId, pairId: AlignmentPairId): Promise<AlignmentPair>;
  };
  memory: {
    listStylebook(projectId: ProjectId): Promise<StylebookEntry[]>;
    saveStylebook(projectId: ProjectId, input: SaveStylebookEntryRequest): Promise<StylebookEntry>;
    listCharacters(projectId: ProjectId): Promise<CharacterProfile[]>;
    saveCharacter(
      projectId: ProjectId,
      input: SaveCharacterProfileRequest
    ): Promise<CharacterProfile>;
    listChapterMemories(projectId: ProjectId, bookId: BookId): Promise<ChapterMemory[]>;
    saveChapterMemory(
      projectId: ProjectId,
      bookId: BookId,
      input: SaveChapterMemoryRequest
    ): Promise<ChapterMemory>;
  };
}

const api: StsApi = {
  project: {
    create: (input) => ipcRenderer.invoke("project:create", input) as Promise<Project>,
    list: () => ipcRenderer.invoke("project:list") as Promise<Project[]>
  },
  book: {
    importEpub: (projectId) =>
      ipcRenderer.invoke("book:importEpub", projectId) as Promise<ImportedBookSummary | undefined>,
    exportM1: (projectId, bookId) =>
      ipcRenderer.invoke("book:exportM1", projectId, bookId) as Promise<ExportedBookSummary>,
    translateM2: (projectId, bookId) =>
      ipcRenderer.invoke("book:translateM2", projectId, bookId) as Promise<TranslationRunSummary>,
    exportTranslated: (projectId, bookId) =>
      ipcRenderer.invoke("book:exportTranslated", projectId, bookId) as Promise<ExportedBookSummary>,
    setSpoilerSafe: (projectId, bookId, enabled) =>
      ipcRenderer.invoke("book:setSpoilerSafe", projectId, bookId, enabled) as Promise<Book>,
    list: (projectId) => ipcRenderer.invoke("book:list", projectId) as Promise<Book[]>
  },
  settings: {
    validateProvider: () =>
      ipcRenderer.invoke("settings:validateProvider") as Promise<ProviderValidationSummary>
  },
  glossary: {
    list: (projectId) => ipcRenderer.invoke("glossary:list", projectId) as Promise<GlossaryTerm[]>,
    save: (projectId, input) =>
      ipcRenderer.invoke("glossary:save", projectId, input) as Promise<GlossaryTerm>,
    delete: (projectId, termId) =>
      ipcRenderer.invoke("glossary:delete", projectId, termId) as Promise<void>,
    importCsv: (projectId) =>
      ipcRenderer.invoke("glossary:importCsv", projectId) as Promise<GlossaryImportSummary>,
    exportCsv: (projectId) =>
      ipcRenderer.invoke("glossary:exportCsv", projectId) as Promise<string | undefined>
  },
  export: {
    tmCsv: (projectId) =>
      ipcRenderer.invoke("export:tmCsv", projectId) as Promise<string | undefined>,
    bilingualCsv: (projectId, bookId) =>
      ipcRenderer.invoke("export:bilingualCsv", projectId, bookId) as Promise<string | undefined>,
    qaReport: (projectId, bookId) =>
      ipcRenderer.invoke("export:qaReport", projectId, bookId) as Promise<string | undefined>
  },
  tm: {
    list: (projectId) => ipcRenderer.invoke("tm:list", projectId) as Promise<TmUnit[]>,
    save: (projectId, input) =>
      ipcRenderer.invoke("tm:save", projectId, input) as Promise<TmUnit>,
    delete: (projectId, unitId) =>
      ipcRenderer.invoke("tm:delete", projectId, unitId) as Promise<void>,
    promote: (projectId, unitId) =>
      ipcRenderer.invoke("tm:promote", projectId, unitId) as Promise<TmUnit>,
    reject: (projectId, unitId) =>
      ipcRenderer.invoke("tm:reject", projectId, unitId) as Promise<TmUnit>
  },
  translation: {
    listJobs: (projectId, bookId) =>
      ipcRenderer.invoke("translation:listJobs", projectId, bookId) as Promise<
        TranslationJobProgress[]
      >,
    pause: (projectId, jobId) =>
      ipcRenderer.invoke("translation:pause", projectId, jobId) as Promise<TranslationJobProgress>,
    resume: (projectId, bookId) =>
      ipcRenderer.invoke("translation:resume", projectId, bookId) as Promise<TranslationRunSummary>,
    cancel: (projectId, jobId) =>
      ipcRenderer.invoke("translation:cancel", projectId, jobId) as Promise<TranslationJobProgress>,
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: TranslationJobProgress) => {
        callback(progress);
      };
      ipcRenderer.on("translation:progress", listener);
      return () => ipcRenderer.off("translation:progress", listener);
    }
  },
  editorial: {
    run: (projectId, bookId) =>
      ipcRenderer.invoke("editorial:run", projectId, bookId) as Promise<EditorialRunSummary>,
    listJobs: (projectId, bookId) =>
      ipcRenderer.invoke("editorial:listJobs", projectId, bookId) as Promise<
        EditorialJobProgress[]
      >,
    pause: (projectId, jobId) =>
      ipcRenderer.invoke("editorial:pause", projectId, jobId) as Promise<EditorialJobProgress>,
    resume: (projectId, bookId) =>
      ipcRenderer.invoke("editorial:resume", projectId, bookId) as Promise<EditorialRunSummary>,
    cancel: (projectId, jobId) =>
      ipcRenderer.invoke("editorial:cancel", projectId, jobId) as Promise<EditorialJobProgress>,
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: EditorialJobProgress) => {
        callback(progress);
      };
      ipcRenderer.on("editorial:progress", listener);
      return () => ipcRenderer.off("editorial:progress", listener);
    }
  },
  spoilerSafe: {
    getSummary: (projectId, bookId) =>
      ipcRenderer.invoke("spoilerSafe:getSummary", projectId, bookId) as Promise<
        SpoilerSafeSummary
      >,
    exportEpub: (projectId, bookId) =>
      ipcRenderer.invoke("spoilerSafe:exportEpub", projectId, bookId) as Promise<
        ExportedBookSummary
      >
  },
  review: {
    listSegments: (projectId, bookId) =>
      ipcRenderer.invoke("review:listSegments", projectId, bookId) as Promise<
        ReviewSegmentSummary[]
      >,
    updateFinalTranslation: (projectId, segmentId, finalTranslation) =>
      ipcRenderer.invoke(
        "review:updateFinalTranslation",
        projectId,
        segmentId,
        finalTranslation
      ) as Promise<ReviewSegmentSummary>
  },
  postRead: {
    searchSegments: (projectId, bookId, query) =>
      ipcRenderer.invoke("postRead:searchSegments", projectId, bookId, query) as Promise<
        SegmentSearchResult[]
      >,
    saveCorrection: (projectId, bookId, input) =>
      ipcRenderer.invoke("postRead:saveCorrection", projectId, bookId, input) as Promise<
        PostReadCorrection
      >,
    listCorrections: (projectId, bookId) =>
      ipcRenderer.invoke("postRead:listCorrections", projectId, bookId) as Promise<
        PostReadCorrection[]
      >,
    promoteCorrectionToGold: (projectId, correctionId) =>
      ipcRenderer.invoke("postRead:promoteCorrectionToGold", projectId, correctionId) as Promise<
        PostReadCorrection
      >
  },
  alignment: {
    importReference: (projectId, bookId) =>
      ipcRenderer.invoke("alignment:importReference", projectId, bookId) as Promise<
        AlignmentRunSummary | undefined
      >,
    reimportLastReference: (projectId, bookId) =>
      ipcRenderer.invoke("alignment:reimportLastReference", projectId, bookId) as Promise<
        AlignmentRunSummary | undefined
      >,
    preview: (projectId, bookId) =>
      ipcRenderer.invoke("alignment:preview", projectId, bookId) as Promise<AlignmentPreview>,
    run: (projectId, bookId, options) =>
      ipcRenderer.invoke("alignment:run", projectId, bookId, options) as Promise<AlignmentRunSummary>,
    listPairs: (projectId, bookId) =>
      ipcRenderer.invoke("alignment:listPairs", projectId, bookId) as Promise<AlignmentPair[]>,
    promotePair: (projectId, input) =>
      ipcRenderer.invoke("alignment:promotePair", projectId, input) as Promise<AlignmentPair>,
    rejectPair: (projectId, pairId) =>
      ipcRenderer.invoke("alignment:rejectPair", projectId, pairId) as Promise<AlignmentPair>
  },
  memory: {
    listStylebook: (projectId) =>
      ipcRenderer.invoke("memory:listStylebook", projectId) as Promise<StylebookEntry[]>,
    saveStylebook: (projectId, input) =>
      ipcRenderer.invoke("memory:saveStylebook", projectId, input) as Promise<StylebookEntry>,
    listCharacters: (projectId) =>
      ipcRenderer.invoke("memory:listCharacters", projectId) as Promise<CharacterProfile[]>,
    saveCharacter: (projectId, input) =>
      ipcRenderer.invoke("memory:saveCharacter", projectId, input) as Promise<CharacterProfile>,
    listChapterMemories: (projectId, bookId) =>
      ipcRenderer.invoke("memory:listChapterMemories", projectId, bookId) as Promise<
        ChapterMemory[]
      >,
    saveChapterMemory: (projectId, bookId, input) =>
      ipcRenderer.invoke("memory:saveChapterMemory", projectId, bookId, input) as Promise<
        ChapterMemory
      >
  }
};

contextBridge.exposeInMainWorld("sts", api);
