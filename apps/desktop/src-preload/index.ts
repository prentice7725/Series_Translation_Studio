import { contextBridge, ipcRenderer } from "electron";
import type {
  Book,
  BookId,
  ExportedBookSummary,
  ImportedBookSummary,
  Project,
  ProviderValidationSummary,
  ProjectId,
  TranslationRunSummary
} from "@sts/common";

export interface CreateProjectRequest {
  name: string;
  seriesName?: string;
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
  }
};

contextBridge.exposeInMainWorld("sts", api);
