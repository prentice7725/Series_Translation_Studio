import { StrictMode, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type {
  Book,
  BookId,
  ExportedBookSummary,
  ImportedBookSummary,
  Project,
  ProviderValidationSummary,
  TranslationRunSummary
} from "@sts/common";
import "./styles.css";

interface ProjectFormState {
  name: string;
  seriesName: string;
}

function App(): ReactElement {
  const hasBridge = Boolean(window.sts?.project && window.sts?.book);
  const [projects, setProjects] = useState<Project[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [form, setForm] = useState<ProjectFormState>({ name: "", seriesName: "" });
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [exportingBookId, setExportingBookId] = useState<BookId | undefined>();
  const [translatingBookId, setTranslatingBookId] = useState<BookId | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [lastImport, setLastImport] = useState<ImportedBookSummary | undefined>();
  const [lastExport, setLastExport] = useState<ExportedBookSummary | undefined>();
  const [lastTranslation, setLastTranslation] = useState<TranslationRunSummary | undefined>();
  const [providerStatus, setProviderStatus] = useState<ProviderValidationSummary | undefined>();

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId]
  );

  async function loadProjects(): Promise<void> {
    if (!hasBridge) {
      setError("Electron preload bridge가 로드되지 않았습니다.");
      return;
    }

    setProjects(await window.sts.project.list());
  }

  async function loadBooks(project: Project | undefined): Promise<void> {
    if (!hasBridge || !project) {
      setBooks([]);
      return;
    }

    setBooks(await window.sts.book.list(project.id));
  }

  useEffect(() => {
    void loadProjects();
  }, [hasBridge]);

  useEffect(() => {
    if (hasBridge) {
      void validateProvider();
    }
  }, [hasBridge]);

  useEffect(() => {
    void loadBooks(selectedProject);
  }, [hasBridge, selectedProject?.id]);

  async function createProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);

    if (!hasBridge) {
      setError("Electron preload bridge가 로드되지 않았습니다.");
      return;
    }

    setIsSaving(true);

    try {
      const project = await window.sts.project.create({
        name: form.name,
        seriesName: form.seriesName || undefined
      });
      await loadProjects();
      setSelectedProjectId(project.id);
      setBooks([]);
      setForm({ name: "", seriesName: "" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로젝트 생성에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function importEpub(): Promise<void> {
    if (!selectedProject) {
      setError("먼저 프로젝트를 선택하세요.");
      return;
    }

    setError(undefined);
    setIsImporting(true);

    try {
      const imported = await window.sts.book.importEpub(selectedProject.id);
      if (imported) {
        setLastImport(imported);
        await loadBooks(selectedProject);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "EPUB import에 실패했습니다.");
    } finally {
      setIsImporting(false);
    }
  }

  async function exportM1(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      setError("먼저 프로젝트를 선택하세요.");
      return;
    }

    setError(undefined);
    setExportingBookId(bookId);

    try {
      setLastExport(await window.sts.book.exportM1(selectedProject.id, bookId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "EPUB export에 실패했습니다.");
    } finally {
      setExportingBookId(undefined);
    }
  }

  async function translateM2(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      setError("먼저 프로젝트를 선택하세요.");
      return;
    }

    setError(undefined);
    setTranslatingBookId(bookId);

    try {
      setLastTranslation(await window.sts.book.translateM2(selectedProject.id, bookId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "번역 실행에 실패했습니다.");
    } finally {
      setTranslatingBookId(undefined);
    }
  }

  async function exportTranslated(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      setError("먼저 프로젝트를 선택하세요.");
      return;
    }

    setError(undefined);
    setExportingBookId(bookId);

    try {
      setLastExport(await window.sts.book.exportTranslated(selectedProject.id, bookId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "번역 EPUB export에 실패했습니다.");
    } finally {
      setExportingBookId(undefined);
    }
  }

  async function validateProvider(): Promise<void> {
    if (!hasBridge) {
      return;
    }

    try {
      setProviderStatus(await window.sts.settings.validateProvider());
    } catch (caught) {
      setProviderStatus({
        provider: "unknown",
        ok: false,
        message: caught instanceof Error ? caught.message : "Provider 설정 확인에 실패했습니다.",
        configSource: ".env"
      });
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">STS</p>
          <h1>Series Translation Studio</h1>
        </div>

        <form className="project-form" onSubmit={createProject}>
          <label>
            프로젝트명
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Vorkosigan"
            />
          </label>
          <label>
            시리즈명
            <input
              value={form.seriesName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, seriesName: event.target.value }))
              }
              placeholder="Vorkosigan Saga"
            />
          </label>
          <button type="submit" disabled={isSaving || !form.name.trim()}>
            {isSaving ? "생성 중" : "새 프로젝트"}
          </button>
          {error ? <p className="form-error">{error}</p> : null}
        </form>

        <nav className="project-list" aria-label="프로젝트 목록">
          {projects.length === 0 ? (
            <p className="empty">아직 프로젝트가 없습니다.</p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                className={project.id === selectedProject?.id ? "active" : ""}
                onClick={() => setSelectedProjectId(project.id)}
                type="button"
              >
                <span>{project.name}</span>
                <small>{project.seriesName || "Standalone"}</small>
              </button>
            ))
          )}
        </nav>
      </aside>

      <section className="workspace">
        {selectedProject ? (
          <>
            <header className="workspace-header">
              <div>
                <p className="eyebrow">Project</p>
                <h2>{selectedProject.name}</h2>
                <p>{selectedProject.seriesName || "시리즈명 미지정"}</p>
              </div>
              <div className="status-pill">M0 Ready</div>
            </header>

            <div className="project-grid">
              <section className="panel">
                <h3>Workspace</h3>
                <p className="path">{selectedProject.workspacePath}</p>
              </section>
              <section className="panel">
                <h3>Languages</h3>
                <p>
                  {selectedProject.sourceLang.toUpperCase()} →{" "}
                  {selectedProject.targetLang.toUpperCase()}
                </p>
              </section>
              <section className="panel">
                <h3>Next Step</h3>
                <p>EPUB를 추가하면 unpack, OPF spine parsing, text block extraction을 실행합니다.</p>
                <button type="button" onClick={importEpub} disabled={isImporting}>
                  {isImporting ? "Import 중" : "EPUB 추가"}
                </button>
              </section>
              <section className="panel">
                <h3>Provider</h3>
                <p>
                  {providerStatus
                    ? `${providerStatus.provider}: ${providerStatus.ok ? "ready" : "needs config"}`
                    : "checking .env"}
                </p>
                {providerStatus?.message ? <p className="form-error">{providerStatus.message}</p> : null}
                <button type="button" onClick={() => void validateProvider()}>
                  설정 확인
                </button>
              </section>
            </div>

            {lastImport ? (
              <section className="import-result">
                <h3>최근 Import</h3>
                <p>
                  {lastImport.book.title}: chapter {lastImport.chapterCount}, block{" "}
                  {lastImport.blockCount}
                </p>
                <p className="path">{lastImport.extractedDir}</p>
              </section>
            ) : null}

            {lastExport ? (
              <section className="import-result">
                <h3>최근 Export</h3>
                <p>
                  {lastExport.book.title}: replacement {lastExport.replacementCount}
                </p>
                <p className="path">{lastExport.outputPath}</p>
              </section>
            ) : null}

            {lastTranslation ? (
              <section className="import-result">
                <h3>최근 번역</h3>
                <p>
                  {lastTranslation.book.title}: translated {lastTranslation.translatedCount}/
                  {lastTranslation.segmentCount}, error {lastTranslation.errorCount}
                </p>
                <p className="path">job {lastTranslation.job.id}</p>
              </section>
            ) : null}

            <section className="book-section">
              <div className="section-header">
                <h3>Books</h3>
                <span>{books.length}</span>
              </div>
              {books.length === 0 ? (
                <p className="empty">아직 import된 EPUB가 없습니다.</p>
              ) : (
                <div className="book-list">
                  {books.map((book) => (
                    <article key={book.id} className="book-row">
                      <div>
                        <strong>{book.title}</strong>
                        <span>
                          {book.sourceLang.toUpperCase()} → {book.targetLang.toUpperCase()}
                        </span>
                      </div>
                      <div className="book-actions">
                        <button
                          type="button"
                          onClick={() => void translateM2(book.id)}
                          disabled={translatingBookId === book.id}
                        >
                          {translatingBookId === book.id ? "번역 중" : "M2 번역"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportTranslated(book.id)}
                          disabled={exportingBookId === book.id}
                        >
                          {exportingBookId === book.id ? "Export 중" : "번역 Export"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportM1(book.id)}
                          disabled={exportingBookId === book.id}
                        >
                          M1 Export
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="welcome">
            <p className="eyebrow">Start</p>
            <h2>첫 프로젝트를 만들면 로컬 SQLite workspace가 준비됩니다.</h2>
          </section>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
