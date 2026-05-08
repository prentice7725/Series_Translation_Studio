import { contextBridge, ipcRenderer } from "electron";
import type {
  Book,
  BookId,
  ExportedBookSummary,
  GlossaryImportSummary,
  GlossaryTerm,
  ImportedBookSummary,
  Project,
  ProviderValidationSummary,
  ProjectId,
  JobId,
  ReviewSegmentSummary,
  SegmentId,
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
  review: {
    listSegments(projectId: ProjectId, bookId: BookId): Promise<ReviewSegmentSummary[]>;
    updateFinalTranslation(
      projectId: ProjectId,
      segmentId: SegmentId,
      finalTranslation: string
    ): Promise<ReviewSegmentSummary>;
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
  }
};

contextBridge.exposeInMainWorld("sts", api);
