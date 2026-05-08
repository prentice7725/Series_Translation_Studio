import { StrictMode, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type {
  Book,
  BookId,
  ExportedBookSummary,
  GlossaryTerm,
  ImportedBookSummary,
  Project,
  ProviderValidationSummary,
  ReviewSegmentSummary,
  SegmentId,
  TmGrade,
  TmUnit,
  TranslationJobProgress,
  TranslationRunSummary
} from "@sts/common";
import "./styles.css";

interface ProjectFormState {
  name: string;
  seriesName: string;
}

interface GlossaryFormState {
  sourceTerm: string;
  canonicalKo: string;
  category: string;
  aliases: string;
  forbiddenTargets: string;
}

interface TmFormState {
  sourceText: string;
  targetText: string;
  grade: TmGrade;
  notes: string;
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
  const [jobProgresses, setJobProgresses] = useState<TranslationJobProgress[]>([]);
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [tmUnits, setTmUnits] = useState<TmUnit[]>([]);
  const [reviewBookId, setReviewBookId] = useState<BookId | undefined>();
  const [reviewSegments, setReviewSegments] = useState<ReviewSegmentSummary[]>([]);
  const [selectedReviewSegmentId, setSelectedReviewSegmentId] = useState<SegmentId | undefined>();
  const [reviewDraft, setReviewDraft] = useState("");
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [glossaryForm, setGlossaryForm] = useState<GlossaryFormState>({
    sourceTerm: "",
    canonicalKo: "",
    category: "term",
    aliases: "",
    forbiddenTargets: ""
  });
  const [tmForm, setTmForm] = useState<TmFormState>({
    sourceText: "",
    targetText: "",
    grade: "gold",
    notes: ""
  });

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId]
  );
  const selectedReviewSegment = useMemo(
    () =>
      reviewSegments.find((candidate) => candidate.segment.id === selectedReviewSegmentId) ??
      reviewSegments[0],
    [reviewSegments, selectedReviewSegmentId]
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
      setGlossaryTerms([]);
      setTmUnits([]);
      return;
    }

    const nextBooks = await window.sts.book.list(project.id);
    setBooks(nextBooks);
    setGlossaryTerms(await window.sts.glossary.list(project.id));
    setTmUnits(await window.sts.tm.list(project.id));
    const progressLists = await Promise.all(
      nextBooks.map((book: Book) => window.sts.translation.listJobs(project.id, book.id))
    );
    setJobProgresses(progressLists.flat());
    if (reviewBookId && nextBooks.some((book) => book.id === reviewBookId)) {
      await loadReviewSegments(project.id, reviewBookId);
    } else {
      setReviewBookId(undefined);
      setReviewSegments([]);
      setSelectedReviewSegmentId(undefined);
      setReviewDraft("");
    }
  }

  useEffect(() => {
    void loadProjects();
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) {
      return undefined;
    }

    return window.sts.translation.onProgress((progress: TranslationJobProgress) => {
      setJobProgresses((prev) => [
        progress,
        ...prev.filter((candidate) => candidate.job.id !== progress.job.id)
      ]);
    });
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
      await loadBooks(selectedProject);
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

  async function saveGlossaryTerm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    setError(undefined);
    try {
      await window.sts.glossary.save(selectedProject.id, glossaryForm);
      setGlossaryTerms(await window.sts.glossary.list(selectedProject.id));
      setGlossaryForm({
        sourceTerm: "",
        canonicalKo: "",
        category: "term",
        aliases: "",
        forbiddenTargets: ""
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Glossary 저장에 실패했습니다.");
    }
  }

  async function importGlossaryCsv(): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const result = await window.sts.glossary.importCsv(selectedProject.id);
    setGlossaryTerms(await window.sts.glossary.list(selectedProject.id));
    setError(`Glossary import: ${result.importedCount} imported, ${result.skippedCount} skipped`);
  }

  async function exportGlossaryCsv(): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const path = await window.sts.glossary.exportCsv(selectedProject.id);
    if (path) {
      setError(`Glossary exported: ${path}`);
    }
  }

  async function deleteGlossaryTerm(termId: string): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await window.sts.glossary.delete(selectedProject.id, termId);
    setGlossaryTerms(await window.sts.glossary.list(selectedProject.id));
  }

  async function saveTmUnit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    setError(undefined);
    try {
      await window.sts.tm.save(selectedProject.id, {
        ...tmForm,
        origin: "manual"
      });
      setTmUnits(await window.sts.tm.list(selectedProject.id));
      setTmForm({ sourceText: "", targetText: "", grade: "gold", notes: "" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "TM 저장에 실패했습니다.");
    }
  }

  async function promoteTmUnit(unitId: string): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await window.sts.tm.promote(selectedProject.id, unitId);
    setTmUnits(await window.sts.tm.list(selectedProject.id));
  }

  async function rejectTmUnit(unitId: string): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await window.sts.tm.reject(selectedProject.id, unitId);
    setTmUnits(await window.sts.tm.list(selectedProject.id));
  }

  async function deleteTmUnit(unitId: string): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await window.sts.tm.delete(selectedProject.id, unitId);
    setTmUnits(await window.sts.tm.list(selectedProject.id));
  }

  async function loadReviewSegments(projectId: Project["id"], bookId: BookId): Promise<void> {
    const segments = await window.sts.review.listSegments(projectId, bookId);
    setReviewSegments(segments);
    const nextSelected =
      segments.find((segment) => segment.segment.id === selectedReviewSegmentId) ?? segments[0];
    setSelectedReviewSegmentId(nextSelected?.segment.id);
    setReviewDraft(
      nextSelected?.segment.finalTranslation ?? nextSelected?.segment.aiTranslation ?? ""
    );
  }

  async function openReviewStudio(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setError(undefined);
    setReviewBookId(bookId);
    await loadReviewSegments(selectedProject.id, bookId);
  }

  function selectReviewSegment(segment: ReviewSegmentSummary): void {
    setSelectedReviewSegmentId(segment.segment.id);
    setReviewDraft(segment.segment.finalTranslation ?? segment.segment.aiTranslation ?? "");
  }

  async function saveReviewSegment(): Promise<void> {
    if (!selectedProject || !selectedReviewSegment) {
      return;
    }

    setError(undefined);
    setIsSavingReview(true);
    try {
      const updated = await window.sts.review.updateFinalTranslation(
        selectedProject.id,
        selectedReviewSegment.segment.id,
        reviewDraft
      );
      setReviewSegments((prev) =>
        prev.map((candidate) =>
          candidate.segment.id === updated.segment.id ? updated : candidate
        )
      );
      setSelectedReviewSegmentId(updated.segment.id);
      setReviewDraft(updated.segment.finalTranslation ?? "");
      setError("Review 저장 완료. 번역 Export를 누르면 수정본으로 EPUB를 다시 생성합니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review 저장에 실패했습니다.");
    } finally {
      setIsSavingReview(false);
    }
  }

  async function pauseJob(jobId: TranslationJobProgress["job"]["id"]): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const progress = await window.sts.translation.pause(selectedProject.id, jobId);
    setJobProgresses((prev) => [
      progress,
      ...prev.filter((candidate) => candidate.job.id !== progress.job.id)
    ]);
  }

  async function resumeJob(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setLastTranslation(await window.sts.translation.resume(selectedProject.id, bookId));
    await loadBooks(selectedProject);
  }

  async function cancelJob(jobId: TranslationJobProgress["job"]["id"]): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const progress = await window.sts.translation.cancel(selectedProject.id, jobId);
    setJobProgresses((prev) => [
      progress,
      ...prev.filter((candidate) => candidate.job.id !== progress.job.id)
    ]);
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
                  {lastTranslation.segmentCount}, cache {lastTranslation.cacheHitCount}, error{" "}
                  {lastTranslation.errorCount}
                </p>
                <p className="path">job {lastTranslation.job.id}</p>
              </section>
            ) : null}

            {jobProgresses.length > 0 ? (
              <section className="book-section">
                <div className="section-header">
                  <h3>Jobs</h3>
                  <span>{jobProgresses.length}</span>
                </div>
                <div className="book-list">
                  {jobProgresses.map((progress) => (
                    <article key={progress.job.id} className="book-row">
                      <div>
                        <strong>{progress.job.status}</strong>
                        <span>
                          {progress.translatedCount}/{progress.segmentCount} translated, cache{" "}
                          {progress.cacheHitCount}, error {progress.errorCount}
                        </span>
                        <span className="path">{progress.job.id}</span>
                      </div>
                      <div className="book-actions">
                        <button
                          type="button"
                          onClick={() => void pauseJob(progress.job.id)}
                          disabled={progress.job.status !== "running"}
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          onClick={() => void resumeJob(progress.job.bookId)}
                          disabled={!["paused", "failed", "running"].includes(progress.job.status)}
                        >
                          Resume
                        </button>
                        <button
                          type="button"
                          onClick={() => void cancelJob(progress.job.id)}
                          disabled={["completed", "cancelled"].includes(progress.job.status)}
                        >
                          Cancel
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="book-section">
              <div className="section-header">
                <h3>Glossary</h3>
                <span>{glossaryTerms.length}</span>
              </div>
              <form className="glossary-form" onSubmit={saveGlossaryTerm}>
                <input
                  value={glossaryForm.sourceTerm}
                  onChange={(event) =>
                    setGlossaryForm((prev) => ({ ...prev, sourceTerm: event.target.value }))
                  }
                  placeholder="source term"
                />
                <input
                  value={glossaryForm.canonicalKo}
                  onChange={(event) =>
                    setGlossaryForm((prev) => ({ ...prev, canonicalKo: event.target.value }))
                  }
                  placeholder="canonical ko"
                />
                <input
                  value={glossaryForm.category}
                  onChange={(event) =>
                    setGlossaryForm((prev) => ({ ...prev, category: event.target.value }))
                  }
                  placeholder="category"
                />
                <input
                  value={glossaryForm.aliases}
                  onChange={(event) =>
                    setGlossaryForm((prev) => ({ ...prev, aliases: event.target.value }))
                  }
                  placeholder="aliases"
                />
                <input
                  value={glossaryForm.forbiddenTargets}
                  onChange={(event) =>
                    setGlossaryForm((prev) => ({ ...prev, forbiddenTargets: event.target.value }))
                  }
                  placeholder="forbidden targets"
                />
                <button
                  type="submit"
                  disabled={!glossaryForm.sourceTerm.trim() || !glossaryForm.canonicalKo.trim()}
                >
                  용어 저장
                </button>
              </form>
              <div className="book-actions glossary-tools">
                <button type="button" onClick={() => void importGlossaryCsv()}>
                  CSV Import
                </button>
                <button type="button" onClick={() => void exportGlossaryCsv()}>
                  CSV Export
                </button>
              </div>
              {glossaryTerms.length === 0 ? (
                <p className="empty">등록된 glossary가 없습니다.</p>
              ) : (
                <div className="book-list">
                  {glossaryTerms.slice(0, 12).map((term) => (
                    <article key={term.id} className="book-row">
                      <div>
                        <strong>
                          {term.sourceTerm} → {term.canonicalKo}
                        </strong>
                        <span>
                          {term.category} · {term.confidence}
                          {term.forbiddenTargets ? ` · forbidden: ${term.forbiddenTargets}` : ""}
                        </span>
                      </div>
                      <div className="book-actions">
                        <button type="button" onClick={() => void deleteGlossaryTerm(term.id)}>
                          삭제
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="book-section">
              <div className="section-header">
                <h3>Translation Memory</h3>
                <span>{tmUnits.length}</span>
              </div>
              <form className="tm-form" onSubmit={saveTmUnit}>
                <textarea
                  value={tmForm.sourceText}
                  onChange={(event) =>
                    setTmForm((prev) => ({ ...prev, sourceText: event.target.value }))
                  }
                  placeholder="source text"
                />
                <textarea
                  value={tmForm.targetText}
                  onChange={(event) =>
                    setTmForm((prev) => ({ ...prev, targetText: event.target.value }))
                  }
                  placeholder="target text"
                />
                <div className="tm-controls">
                  <label>
                    Grade
                    <select
                      value={tmForm.grade}
                      onChange={(event) =>
                        setTmForm((prev) => ({
                          ...prev,
                          grade: event.target.value as TmGrade
                        }))
                      }
                    >
                      <option value="gold">gold</option>
                      <option value="gold_candidate">gold_candidate</option>
                      <option value="silver">silver</option>
                      <option value="reference">reference</option>
                      <option value="rejected">rejected</option>
                    </select>
                  </label>
                  <input
                    value={tmForm.notes}
                    onChange={(event) =>
                      setTmForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    placeholder="notes"
                  />
                  <button
                    type="submit"
                    disabled={!tmForm.sourceText.trim() || !tmForm.targetText.trim()}
                  >
                    TM 저장
                  </button>
                </div>
              </form>
              {tmUnits.length === 0 ? (
                <p className="empty">등록된 TM이 없습니다.</p>
              ) : (
                <div className="book-list">
                  {tmUnits.slice(0, 12).map((unit) => (
                    <article key={unit.id} className="book-row tm-row">
                      <div>
                        <strong>{unit.sourceText}</strong>
                        <span>{unit.targetText}</span>
                        <span>
                          {unit.grade} · {unit.origin}
                          {unit.notes ? ` · ${unit.notes}` : ""}
                        </span>
                      </div>
                      <div className="book-actions">
                        <button
                          type="button"
                          onClick={() => void promoteTmUnit(unit.id)}
                          disabled={unit.grade !== "gold_candidate"}
                        >
                          Gold
                        </button>
                        <button
                          type="button"
                          onClick={() => void rejectTmUnit(unit.id)}
                          disabled={unit.grade === "rejected"}
                        >
                          Reject
                        </button>
                        <button type="button" onClick={() => void deleteTmUnit(unit.id)}>
                          삭제
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

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
                        <button type="button" onClick={() => void openReviewStudio(book.id)}>
                          Review
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

            {reviewBookId ? (
              <section className="review-studio">
                <div className="section-header">
                  <h3>Review Studio</h3>
                  <span>{reviewSegments.length}</span>
                </div>
                {reviewSegments.length === 0 ? (
                  <p className="empty">번역된 segment가 없습니다. 먼저 M2 번역을 실행하세요.</p>
                ) : (
                  <div className="review-layout">
                    <div className="segment-list" aria-label="segment list">
                      {reviewSegments.map((item) => (
                        <button
                          key={item.segment.id}
                          type="button"
                          className={
                            item.segment.id === selectedReviewSegment?.segment.id ? "active" : ""
                          }
                          onClick={() => selectReviewSegment(item)}
                        >
                          <strong>#{item.displayIndex}</strong>
                          <span>{item.segment.status}</span>
                          {item.qaIssues.length > 0 ? <small>QA {item.qaIssues.length}</small> : null}
                        </button>
                      ))}
                    </div>

                    {selectedReviewSegment ? (
                      <div className="review-detail">
                        <div className="review-meta">
                          <strong>
                            {selectedReviewSegment.chapter.title ||
                              selectedReviewSegment.chapter.spineHref}
                          </strong>
                          <span>segment #{selectedReviewSegment.displayIndex}</span>
                        </div>
                        <label>
                          Source
                          <textarea readOnly value={selectedReviewSegment.segment.sourceText} />
                        </label>
                        <label>
                          AI Translation
                          <textarea
                            readOnly
                            value={selectedReviewSegment.segment.aiTranslation ?? ""}
                          />
                        </label>
                        <label>
                          Final Translation
                          <textarea
                            value={reviewDraft}
                            onChange={(event) => setReviewDraft(event.target.value)}
                          />
                        </label>
                        {selectedReviewSegment.qaIssues.length > 0 ? (
                          <div className="qa-panel">
                            <strong>QA Issues</strong>
                            {selectedReviewSegment.qaIssues.map((issue) => (
                              <p key={issue}>{issue}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="empty">표시할 QA issue가 없습니다.</p>
                        )}
                        <div className="book-actions">
                          <button
                            type="button"
                            onClick={() => void saveReviewSegment()}
                            disabled={isSavingReview || !reviewDraft.trim()}
                          >
                            {isSavingReview ? "저장 중" : "Final 저장"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void exportTranslated(reviewBookId)}
                            disabled={exportingBookId === reviewBookId}
                          >
                            EPUB regenerate
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}
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
