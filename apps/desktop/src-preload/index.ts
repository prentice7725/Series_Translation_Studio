import { contextBridge, ipcRenderer } from "electron";
import type { Book, ImportedBookSummary, Project, ProjectId } from "@sts/common";

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
    list(projectId: ProjectId): Promise<Book[]>;
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
    list: (projectId) => ipcRenderer.invoke("book:list", projectId) as Promise<Book[]>
  }
};

contextBridge.exposeInMainWorld("sts", api);
