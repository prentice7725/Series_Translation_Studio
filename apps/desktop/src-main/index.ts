import { randomUUID } from "node:crypto";
import { basename, dirname, join, parse as parsePath } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  BookRepository,
  ChapterRepository,
  openProjectDatabase,
  ProjectRepository,
  SourceDocumentRepository,
  TextBlockRepository
} from "@sts/db";
import {
  copyEpubToWorkspace,
  extractTextBlocks,
  parseOpf,
  unpackEpub
} from "@sts/epub-core";
import type {
  Book,
  BookId,
  Chapter,
  ImportedBookSummary,
  Project,
  ProjectId,
  SourceDocument
} from "@sts/common";
import { nowTimestamp } from "@sts/common";

interface CreateProjectRequest {
  name: string;
  seriesName?: string;
}

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const currentDir = dirname(fileURLToPath(import.meta.url));

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
