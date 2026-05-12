import { StrictMode, useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type {
  AlignmentPair,
  AlignmentPreview,
  Book,
  BookId,
  ChapterId,
  EditorialJobProgress,
  ExternalTransferConsent,
  ExportedBookSummary,
  GlossaryTerm,
  ImportedBookSummary,
  Project,
  ProviderValidationSummary,
  ReviewSegmentSummary,
  SegmentId,
  SpoilerSafeSummary,
  TmGrade,
  TmUnit,
  TranslationExportMode,
  TranslationJobProgress
} from "@sts/common";
import "./styles.css";

type WorkspaceView =
  | "home"
  | "books"
  | "translation"
  | "review"
  | "memory"
  | "alignment"
  | "export"
  | "settings";

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

interface RoundTripReportSummary {
  generatedAt?: string;
  mode?: string;
  ok: boolean;
  errors: string[];
  outputPath?: string;
  replacementCount: number;
  replacementFiles: string[];
  sourceFileCount: number;
  outputFileCount: number;
  missingFiles: string[];
  addedFiles: string[];
  changedFiles: string[];
  unexpectedChangedFiles: string[];
  sourceSpineCount?: number;
  outputSpineCount?: number;
  sourceManifestCount?: number;
  outputManifestCount?: number;
  sourceHasNav?: boolean;
  outputHasNav?: boolean;
  sourceHasToc?: boolean;
  outputHasToc?: boolean;
}

const navItems: Array<{ id: WorkspaceView; label: string; hint: string }> = [
  { id: "home", label: "Home", hint: "프로젝트 대시보드" },
  { id: "books", label: "Books", hint: "EPUB import / round-trip" },
  { id: "translation", label: "Translation", hint: "MVP-1 job monitor" },
  { id: "review", label: "Review", hint: "MVP-2 최소 감수" },
  { id: "memory", label: "Memory", hint: "Glossary / TM" },
  { id: "alignment", label: "Alignment", hint: "Post-MVP 초안" },
  { id: "export", label: "Export", hint: "draft / final EPUB" },
  { id: "settings", label: "Settings", hint: "Provider / privacy" }
];

function App(): ReactElement {
  const hasBridge = Boolean(window.sts?.project && window.sts?.book);
  const [view, setView] = useState<WorkspaceView>("home");
  const [projects, setProjects] = useState<Project[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<Project["id"] | undefined>();
  const [selectedBookId, setSelectedBookId] = useState<BookId | undefined>();
  const [projectForm, setProjectForm] = useState<ProjectFormState>({ name: "", seriesName: "" });
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
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [tmUnits, setTmUnits] = useState<TmUnit[]>([]);
  const [translationJobs, setTranslationJobs] = useState<TranslationJobProgress[]>([]);
  const [editorialJobs, setEditorialJobs] = useState<EditorialJobProgress[]>([]);
  const [spoilerSummaries, setSpoilerSummaries] = useState<Record<string, SpoilerSafeSummary>>({});
  const [providerStatus, setProviderStatus] = useState<ProviderValidationSummary | undefined>();
  const [transferConsents, setTransferConsents] = useState<ExternalTransferConsent[]>([]);
  const [reviewSegments, setReviewSegments] = useState<ReviewSegmentSummary[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<SegmentId | undefined>();
  const [reviewDraft, setReviewDraft] = useState("");
  const [alignmentPreview, setAlignmentPreview] = useState<AlignmentPreview | undefined>();
  const [alignmentPairs, setAlignmentPairs] = useState<AlignmentPair[]>([]);
  const [sourceAnchor, setSourceAnchor] = useState<ChapterId | "">("");
  const [referenceAnchor, setReferenceAnchor] = useState("");
  const [busy, setBusy] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [lastImport, setLastImport] = useState<ImportedBookSummary | undefined>();
  const [lastExport, setLastExport] = useState<ExportedBookSummary | undefined>();
  const [roundTripReport, setRoundTripReport] = useState<RoundTripReportSummary | undefined>();
  const [exportMode, setExportMode] = useState<TranslationExportMode>("draft");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId]
  );
  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? books[0],
    [books, selectedBookId]
  );
  const selectedSegment = useMemo(
    () =>
      reviewSegments.find((candidate) => candidate.segment.id === selectedSegmentId) ??
      reviewSegments[0],
    [reviewSegments, selectedSegmentId]
  );
  const activeTranslationJobs = translationJobs.filter((job) =>
    ["pending", "running", "paused"].includes(job.job.status)
  );
  const reviewedCount = reviewSegments.filter((item) =>
    ["reviewed", "approved"].includes(item.segment.status)
  ).length;
  const translatedCount = reviewSegments.filter((item) =>
    Boolean(item.segment.aiTranslation || item.segment.finalTranslation)
  ).length;
  const selectedSegmentIndex = selectedSegment
    ? reviewSegments.findIndex((item) => item.segment.id === selectedSegment.segment.id)
    : -1;

  useEffect(() => {
    void loadProjects();
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) {
      return undefined;
    }

    return window.sts.translation.onProgress((progress: TranslationJobProgress) => {
      setTranslationJobs((prev) => [
        progress,
        ...prev.filter((candidate) => candidate.job.id !== progress.job.id)
      ]);
    });
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) {
      return undefined;
    }

    return window.sts.editorial.onProgress((progress: EditorialJobProgress) => {
      setEditorialJobs((prev) => [
        progress,
        ...prev.filter((candidate) => candidate.job.id !== progress.job.id)
      ]);
    });
  }, [hasBridge]);

  useEffect(() => {
    void loadProjectData(selectedProject);
  }, [selectedProject?.id]);

  useEffect(() => {
    if (selectedBook && selectedProject && view === "review") {
      void openReview(selectedBook.id);
    }
    if (selectedBook && selectedProject && view === "alignment") {
      void openAlignment(selectedBook.id);
    }
  }, [view, selectedBook?.id]);

  useEffect(() => {
    setReviewDraft(
      selectedSegment?.segment.finalTranslation ?? selectedSegment?.segment.aiTranslation ?? ""
    );
  }, [selectedSegment?.segment.id]);

  async function loadProjects(): Promise<void> {
    if (!hasBridge) {
      setError("Electron preload bridge가 로드되지 않았습니다.");
      return;
    }

    try {
      const nextProjects = await window.sts.project.list();
      setProjects(nextProjects);
      setSelectedProjectId((current) => current ?? nextProjects[0]?.id);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로젝트 목록을 불러오지 못했습니다.");
    }
  }

  async function loadProjectData(project: Project | undefined): Promise<void> {
    if (!hasBridge || !project) {
      setBooks([]);
      setGlossaryTerms([]);
      setTmUnits([]);
      setTransferConsents([]);
      return;
    }

    try {
      const [nextBooks, terms, units, provider, consents] = await Promise.all([
        window.sts.book.list(project.id),
        window.sts.glossary.list(project.id),
        window.sts.tm.list(project.id),
        window.sts.settings.validateProvider(),
        window.sts.consent.list(project.id)
      ] as const);
      setBooks(nextBooks);
      setSelectedBookId((current) => current ?? nextBooks[0]?.id);
      setGlossaryTerms(terms);
      setTmUnits(units);
      setProviderStatus(provider);
      setTransferConsents(consents);
      const [translationProgresses, editorialProgresses, spoilerProgresses] = await Promise.all([
        Promise.all(
          nextBooks.map((book: Book) => window.sts.translation.listJobs(project.id, book.id))
        ),
        Promise.all(
          nextBooks.map((book: Book) => window.sts.editorial.listJobs(project.id, book.id))
        ),
        Promise.all(
          nextBooks.map((book: Book) => window.sts.spoilerSafe.getSummary(project.id, book.id))
        )
      ] as const);
      setTranslationJobs(translationProgresses.flat());
      setEditorialJobs(editorialProgresses.flat());
      setSpoilerSummaries(
        Object.fromEntries(
          spoilerProgresses.map((summary: SpoilerSafeSummary) => [summary.bookId, summary])
        )
      );
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "프로젝트 데이터를 불러오지 못했습니다.");
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!projectForm.name.trim()) {
      setError("프로젝트 이름을 입력하세요.");
      return;
    }

    await runBusy("project:create", async () => {
      const project = await window.sts.project.create({
        name: projectForm.name,
        seriesName: projectForm.seriesName || undefined
      });
      setProjectForm({ name: "", seriesName: "" });
      setSelectedProjectId(project.id);
      await loadProjects();
      setMessage("새 프로젝트를 만들었습니다.");
    });
  }

  async function importEpub(): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy("book:import", async () => {
      const imported = await window.sts.book.importEpub(selectedProject.id);
      if (imported) {
        setLastImport(imported);
        setSelectedBookId(imported.book.id);
        await loadProjectData(selectedProject);
        setMessage(`EPUB import 완료: ${imported.chapterCount} chapters / ${imported.blockCount} blocks`);
      }
    });
  }

  async function exportRoundTrip(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy(`export:mvp0:${bookId}`, async () => {
      const exported = await window.sts.book.exportM1(selectedProject.id, bookId);
      setLastExport(exported);
      if (exported.reportPath) {
        await openRoundTripReport(exported.reportPath);
      }
      setMessage(
        `round-trip EPUB 생성: ${exported.outputPath}${
          exported.reportPath ? ` · report: ${exported.reportPath}` : ""
        }`
      );
    });
  }

  async function translateBook(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const consentText =
      "이 작업은 선택한 원서 1권의 원문 text block을 외부 번역 provider로 전송할 수 있습니다. 합법적으로 보유한 파일만 사용하고, 생성 결과는 개인 감상용으로만 사용합니다.";
    const ok = window.confirm(
      consentText
    );
    if (!ok) {
      return;
    }

    await runBusy(`translate:${bookId}`, async () => {
      await window.sts.consent.record(selectedProject.id, {
        bookId,
        task: "translation",
        scope: "book",
        consentText
      });
      const summary = await window.sts.book.translateM2(selectedProject.id, bookId);
      await loadProjectData(selectedProject);
      setMessage(
        `전체 권 번역 완료: ${summary.translatedCount}/${summary.segmentCount}, cache ${summary.cacheHitCount}`
      );
    });
  }

  async function exportTranslated(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy(`export:translated:${bookId}`, async () => {
      const exported = await window.sts.book.exportTranslated(selectedProject.id, bookId, exportMode);
      setLastExport(exported);
      setMessage(`${exportMode} EPUB 생성: ${exported.outputPath}`);
    });
  }

  async function exportDraftTxt(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy(`export:draftTxt:${bookId}`, async () => {
      const outputPath = await window.sts.export.draftTxt(selectedProject.id, bookId);
      setMessage(`Draft TXT 생성: ${outputPath}`);
    });
  }

  async function openRoundTripReport(path: string): Promise<void> {
    await runBusy("report:read", async () => {
      const report = await window.sts.report.readJson(path);
      setRoundTripReport(toRoundTripReportSummary(report));
      setMessage("Round-trip report를 불러왔습니다.");
    });
  }

  async function runEditorial(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const consentText =
      "AI 편집장 감수는 AI 번역문, 원문 일부, 참고 컨텍스트를 외부 provider로 전송할 수 있습니다. 본문 노출과 비용 가능성을 확인한 뒤 실행합니다.";
    const ok = window.confirm(
      consentText
    );
    if (!ok) {
      return;
    }

    await runBusy(`editorial:${bookId}`, async () => {
      await window.sts.consent.record(selectedProject.id, {
        bookId,
        task: "editorial",
        scope: "book",
        consentText
      });
      const summary = await window.sts.editorial.run(selectedProject.id, bookId);
      await loadProjectData(selectedProject);
      setMessage(`AI Editorial 완료: 승인 ${summary.approvedCount}, 검토 필요 ${summary.needsReviewCount}`);
    });
  }

  async function openReview(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    try {
      const segments = await window.sts.review.listSegments(selectedProject.id, bookId);
      setReviewSegments(segments);
      setSelectedSegmentId((current) => current ?? segments[0]?.segment.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review segment를 불러오지 못했습니다.");
    }
  }

  async function saveReview(moveNext = false): Promise<void> {
    if (!selectedProject || !selectedBook || !selectedSegment || !reviewDraft.trim()) {
      return;
    }

    await runBusy("review:save", async () => {
      await window.sts.review.updateFinalTranslation(
        selectedProject.id,
        selectedSegment.segment.id,
        reviewDraft
      );
      const segments: ReviewSegmentSummary[] = await window.sts.review.listSegments(
        selectedProject.id,
        selectedBook.id
      );
      setReviewSegments(segments);
      if (moveNext) {
        const currentIndex = segments.findIndex(
          (item) => item.segment.id === selectedSegment.segment.id
        );
        const nextSegment = segments[currentIndex + 1] ?? segments[currentIndex];
        setSelectedSegmentId(nextSegment?.segment.id);
      }
    });
    setMessage(moveNext ? "저장 후 다음 segment로 이동했습니다." : "final_translation을 저장했습니다.");
  }

  async function saveGlossary(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    await runBusy("glossary:save", async () => {
      await window.sts.glossary.save(selectedProject.id, glossaryForm);
      setGlossaryTerms(await window.sts.glossary.list(selectedProject.id));
      setGlossaryForm({
        sourceTerm: "",
        canonicalKo: "",
        category: "term",
        aliases: "",
        forbiddenTargets: ""
      });
      setMessage("Glossary term을 저장했습니다.");
    });
  }

  async function importGlossary(): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy("glossary:import", async () => {
      const result = await window.sts.glossary.importCsv(selectedProject.id);
      setGlossaryTerms(await window.sts.glossary.list(selectedProject.id));
      setMessage(`CSV import: ${result.importedCount} imported / ${result.skippedCount} skipped`);
    });
  }

  async function exportGlossary(): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy("glossary:export", async () => {
      const path = await window.sts.glossary.exportCsv(selectedProject.id);
      if (path) {
        setMessage(`Glossary CSV 생성: ${path}`);
      }
    });
  }

  async function saveTm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    await runBusy("tm:save", async () => {
      await window.sts.tm.save(selectedProject.id, { ...tmForm, origin: "manual" });
      setTmUnits(await window.sts.tm.list(selectedProject.id));
      setTmForm({ sourceText: "", targetText: "", grade: "gold", notes: "" });
      setMessage("TM unit을 저장했습니다.");
    });
  }

  async function openAlignment(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    try {
      const [preview, pairs] = await Promise.all([
        window.sts.alignment.preview(selectedProject.id, bookId),
        window.sts.alignment.listPairs(selectedProject.id, bookId)
      ]);
      setAlignmentPreview(preview);
      setAlignmentPairs(pairs);
      setSourceAnchor((current) => current || preview.suggestedSourceChapterId || "");
      setReferenceAnchor((current) =>
        current || String(preview.suggestedReferenceBlockStartIndex ?? "")
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Alignment preview를 불러오지 못했습니다.");
    }
  }

  async function importReference(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy(`alignment:reference:${bookId}`, async () => {
      await window.sts.alignment.importReference(selectedProject.id, bookId);
      await openAlignment(bookId);
      setMessage("한국어 참고본을 import했습니다.");
    });
  }

  async function runAlignment(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    await runBusy(`alignment:run:${bookId}`, async () => {
      const summary = await window.sts.alignment.run(selectedProject.id, bookId, {
        sourceChapterId: sourceAnchor || undefined,
        referenceBlockStartIndex: referenceAnchor ? Number(referenceAnchor) : undefined
      });
      await openAlignment(bookId);
      setMessage(`Alignment 후보 ${summary.pairCount}개 생성, 평균 ${percent(summary.averageConfidence)}`);
    });
  }

  async function pauseJob(job: TranslationJobProgress): Promise<void> {
    if (!selectedProject) {
      return;
    }
    await window.sts.translation.pause(selectedProject.id, job.job.id);
    await loadProjectData(selectedProject);
  }

  async function resumeJob(job: TranslationJobProgress): Promise<void> {
    if (!selectedProject) {
      return;
    }
    await window.sts.translation.resume(selectedProject.id, job.job.bookId);
    await loadProjectData(selectedProject);
  }

  async function cancelJob(job: TranslationJobProgress): Promise<void> {
    if (!selectedProject) {
      return;
    }
    await window.sts.translation.cancel(selectedProject.id, job.job.id);
    await loadProjectData(selectedProject);
  }

  async function runBusy(name: string, task: () => Promise<void>): Promise<void> {
    setBusy(name);
    setError(undefined);
    setMessage(undefined);
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "작업에 실패했습니다.");
      throw caught;
    } finally {
      setBusy(undefined);
    }
  }

  function selectSegment(item: ReviewSegmentSummary): void {
    setSelectedSegmentId(item.segment.id);
    setReviewDraft(item.segment.finalTranslation ?? item.segment.aiTranslation ?? "");
  }

  function moveReviewSelection(delta: -1 | 1): void {
    if (selectedSegmentIndex < 0) {
      return;
    }

    const nextIndex = Math.min(Math.max(selectedSegmentIndex + delta, 0), reviewSegments.length - 1);
    const nextSegment = reviewSegments[nextIndex];
    if (nextSegment) {
      selectSegment(nextSegment);
    }
  }

  function renderContent(): ReactElement {
    if (!selectedProject) {
      return <EmptyProject createProject={createProject} form={projectForm} setForm={setProjectForm} />;
    }

    if (view === "home") {
      return (
        <HomeView
          project={selectedProject}
          books={books}
          glossaryCount={glossaryTerms.length}
          tmCount={tmUnits.length}
          jobCount={activeTranslationJobs.length}
          providerStatus={providerStatus}
          onImport={() => void importEpub()}
          onGo={setView}
        />
      );
    }

    if (view === "books") {
      return (
        <BooksView
          books={books}
          selectedBookId={selectedBook?.id}
          busy={busy}
          lastImport={lastImport}
          onSelect={setSelectedBookId}
          onImport={() => void importEpub()}
          onRoundTrip={(bookId) => void exportRoundTrip(bookId)}
          onTranslate={(bookId) => void translateBook(bookId)}
          onReview={(bookId) => {
            setSelectedBookId(bookId);
            setView("review");
          }}
        />
      );
    }

    if (view === "translation") {
      return (
        <TranslationView
          books={books}
          jobs={translationJobs}
          editorialJobs={editorialJobs}
          busy={busy}
          onTranslate={(bookId) => void translateBook(bookId)}
          onEditorial={(bookId) => void runEditorial(bookId)}
          onPause={(job) => void pauseJob(job)}
          onResume={(job) => void resumeJob(job)}
          onCancel={(job) => void cancelJob(job)}
        />
      );
    }

    if (view === "review") {
      return (
        <ReviewView
          book={selectedBook}
          books={books}
          segments={reviewSegments}
          selectedSegment={selectedSegment}
          reviewDraft={reviewDraft}
          reviewedCount={reviewedCount}
          translatedCount={translatedCount}
          busy={busy}
          onBookChange={(bookId) => {
            setSelectedBookId(bookId);
            void openReview(bookId);
          }}
          onSelectSegment={selectSegment}
          onDraftChange={setReviewDraft}
          onSave={() => void saveReview()}
          onSaveAndNext={() => void saveReview(true)}
          onPrevious={() => moveReviewSelection(-1)}
          onNext={() => moveReviewSelection(1)}
          onExport={(bookId) => void exportTranslated(bookId)}
        />
      );
    }

    if (view === "memory") {
      return (
        <MemoryView
          glossaryTerms={glossaryTerms}
          glossaryForm={glossaryForm}
          tmUnits={tmUnits}
          tmForm={tmForm}
          busy={busy}
          onGlossaryFormChange={setGlossaryForm}
          onTmFormChange={setTmForm}
          onSaveGlossary={saveGlossary}
          onImportGlossary={() => void importGlossary()}
          onExportGlossary={() => void exportGlossary()}
          onSaveTm={saveTm}
        />
      );
    }

    if (view === "alignment") {
      return (
        <AlignmentView
          book={selectedBook}
          books={books}
          preview={alignmentPreview}
          pairs={alignmentPairs}
          sourceAnchor={sourceAnchor}
          referenceAnchor={referenceAnchor}
          busy={busy}
          onBookChange={(bookId) => {
            setSelectedBookId(bookId);
            void openAlignment(bookId);
          }}
          onSourceAnchorChange={setSourceAnchor}
          onReferenceAnchorChange={setReferenceAnchor}
          onImportReference={(bookId) => void importReference(bookId)}
          onRun={(bookId) => void runAlignment(bookId)}
        />
      );
    }

    if (view === "export") {
      return (
        <ExportView
          books={books}
          spoilerSummaries={spoilerSummaries}
          lastExport={lastExport}
          roundTripReport={roundTripReport}
          exportMode={exportMode}
          busy={busy}
          onExportModeChange={setExportMode}
          onRoundTrip={(bookId) => void exportRoundTrip(bookId)}
          onTranslated={(bookId) => void exportTranslated(bookId)}
          onDraftTxt={(bookId) => void exportDraftTxt(bookId)}
          onOpenReport={(path) => void openRoundTripReport(path)}
        />
      );
    }

    return (
      <SettingsView
        providerStatus={providerStatus}
        project={selectedProject}
        consents={transferConsents}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">STS</div>
          <div>
            <h1>Series Translation Studio</h1>
            <p>개인 감상용 EPUB 번역·감수 스튜디오</p>
          </div>
        </div>

        <form className="project-form compact" onSubmit={(event) => void createProject(event)}>
          <label>
            새 프로젝트
            <input
              value={projectForm.name}
              onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
              placeholder="Vorkosigan"
            />
          </label>
          <input
            value={projectForm.seriesName}
            onChange={(event) => setProjectForm({ ...projectForm, seriesName: event.target.value })}
            placeholder="시리즈명 (선택)"
          />
          <button type="submit" disabled={busy === "project:create"}>
            프로젝트 생성
          </button>
        </form>

        <div className="project-switcher">
          <p className="eyebrow">Projects</p>
          {projects.length === 0 ? (
            <p className="muted">아직 프로젝트가 없습니다.</p>
          ) : (
            projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={project.id === selectedProject?.id ? "active" : ""}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <strong>{project.name}</strong>
                <span>{project.seriesName || project.targetLang}</span>
              </button>
            ))
          )}
        </div>

        <nav className="nav-list" aria-label="workspace">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </nav>

        <div className="policy-note">
          DRM 해제 기능은 제공하지 않습니다. 합법적으로 보유한 파일만 처리하고, 생성 EPUB는 개인 감상용으로만 사용하세요.
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="breadcrumb">
              {selectedProject?.name ?? "Project"} / {navItems.find((item) => item.id === view)?.label}
            </p>
            <h2>{viewTitle(view)}</h2>
          </div>
          <div className="topbar-actions">
            <span className={`provider-pill ${providerStatus?.ok ? "ok" : "warn"}`}>
              {providerStatus?.provider ?? "provider"} {providerStatus?.ok ? "ready" : "check"}
            </span>
            <span className="status-pill">Jobs {activeTranslationJobs.length}</span>
          </div>
        </header>

        {(message || error) && (
          <div className={error ? "notice error" : "notice"}>
            {error ?? message}
          </div>
        )}

        {renderContent()}
      </section>
    </main>
  );
}

function EmptyProject(props: {
  form: ProjectFormState;
  setForm: (form: ProjectFormState) => void;
  createProject: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): ReactElement {
  return (
    <section className="empty-state">
      <p className="eyebrow">Welcome</p>
      <h3>새 스펙은 프로젝트 단위 workspace에서 시작합니다.</h3>
      <p>
        먼저 시리즈 프로젝트를 만들고 EPUB를 import하세요. round-trip 검증이 첫 번째 완료 기준입니다.
      </p>
      <form className="inline-create" onSubmit={(event) => void props.createProject(event)}>
        <input
          value={props.form.name}
          onChange={(event) => props.setForm({ ...props.form, name: event.target.value })}
          placeholder="프로젝트 이름"
        />
        <button type="submit">시작</button>
      </form>
    </section>
  );
}

function HomeView(props: {
  project: Project;
  books: Book[];
  glossaryCount: number;
  tmCount: number;
  jobCount: number;
  providerStatus?: ProviderValidationSummary;
  onImport: () => void;
  onGo: (view: WorkspaceView) => void;
}): ReactElement {
  return (
    <div className="screen-grid">
      <section className="hero-panel span-8">
        <p className="eyebrow">MVP path</p>
        <h3>EPUB round-trip을 먼저 잠그고, 번역과 최소 감수를 얹는 흐름으로 개편했습니다.</h3>
        <div className="milestone-row">
          <Milestone label="MVP-0" title="Round-trip" active />
          <Milestone label="MVP-1" title="Translation" active={props.books.length > 0} />
          <Milestone label="MVP-2" title="Review" active={props.jobCount > 0} />
          <Milestone label="MVP-3" title="Glossary" active={props.glossaryCount > 0} />
        </div>
        <div className="action-row">
          <button type="button" onClick={props.onImport}>
            EPUB import
          </button>
          <button type="button" className="secondary" onClick={() => props.onGo("books")}>
            Books로 이동
          </button>
        </div>
      </section>
      <Metric label="Books" value={props.books.length} detail="imported EPUB" />
      <Metric label="TM" value={props.tmCount} detail="translation memory" />
      <Metric label="Glossary" value={props.glossaryCount} detail="locked terms" />
      <Metric label="Provider" value={props.providerStatus?.ok ? "OK" : "Check"} detail={props.providerStatus?.message ?? props.providerStatus?.provider ?? ".env"} />
      <section className="panel span-12">
        <p className="eyebrow">Workspace</p>
        <div className="definition-list">
          <div>
            <span>위치</span>
            <strong>{props.project.workspacePath}</strong>
          </div>
          <div>
            <span>언어</span>
            <strong>{props.project.sourceLang.toUpperCase()} → {props.project.targetLang.toUpperCase()}</strong>
          </div>
          <div>
            <span>정책</span>
            <strong>로컬 저장, 외부 전송 전 동의, 개인 감상용 export</strong>
          </div>
        </div>
      </section>
    </div>
  );
}

function BooksView(props: {
  books: Book[];
  selectedBookId?: BookId;
  busy?: string;
  lastImport?: ImportedBookSummary;
  onSelect: (bookId: BookId) => void;
  onImport: () => void;
  onRoundTrip: (bookId: BookId) => void;
  onTranslate: (bookId: BookId) => void;
  onReview: (bookId: BookId) => void;
}): ReactElement {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Books</p>
          <h3>Book Import Wizard / MVP-0 round-trip</h3>
        </div>
        <button type="button" onClick={props.onImport} disabled={props.busy === "book:import"}>
          EPUB 추가
        </button>
      </div>
      {props.lastImport && (
        <div className="inline-report">
          최근 import: {props.lastImport.book.title} · {props.lastImport.chapterCount} chapters ·{" "}
          {props.lastImport.blockCount} blocks
        </div>
      )}
      {props.books.length === 0 ? (
        <p className="empty">아직 책이 없습니다. EPUB를 추가해 round-trip 검증부터 시작하세요.</p>
      ) : (
        <div className="book-table">
          {props.books.map((book) => (
            <article key={book.id} className={book.id === props.selectedBookId ? "selected" : ""}>
              <button type="button" className="row-main" onClick={() => props.onSelect(book.id)}>
                <strong>{book.title}</strong>
                <span>{book.author || "author unknown"} · {book.sourceLang} → {book.targetLang}</span>
              </button>
              <div className="row-actions">
                <button type="button" onClick={() => props.onRoundTrip(book.id)} disabled={props.busy === `export:mvp0:${book.id}`}>
                  Round-trip
                </button>
                <button type="button" onClick={() => props.onTranslate(book.id)} disabled={props.busy === `translate:${book.id}`}>
                  Translate
                </button>
                <button type="button" className="secondary" onClick={() => props.onReview(book.id)}>
                  Review
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TranslationView(props: {
  books: Book[];
  jobs: TranslationJobProgress[];
  editorialJobs: EditorialJobProgress[];
  busy?: string;
  onTranslate: (bookId: BookId) => void;
  onEditorial: (bookId: BookId) => void;
  onPause: (job: TranslationJobProgress) => void;
  onResume: (job: TranslationJobProgress) => void;
  onCancel: (job: TranslationJobProgress) => void;
}): ReactElement {
  return (
    <div className="screen-grid">
      <section className="panel span-5">
        <p className="eyebrow">MVP-1</p>
        <h3>실제 번역 실행</h3>
        <div className="stack">
          {props.books.map((book) => (
            <div className="command-row" key={book.id}>
              <div>
                <strong>{book.title}</strong>
                <span>segment cache + resume</span>
              </div>
              <button type="button" onClick={() => props.onTranslate(book.id)} disabled={props.busy === `translate:${book.id}`}>
                번역 시작
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel span-7">
        <p className="eyebrow">Job Monitor</p>
        <h3>중단/재개 가능한 번역 작업</h3>
        <JobList jobs={props.jobs} onPause={props.onPause} onResume={props.onResume} onCancel={props.onCancel} />
      </section>
      <section className="panel span-12">
        <p className="eyebrow">Post-MVP</p>
        <h3>AI Editorial은 비용 동의 후 별도 실행</h3>
        <div className="book-table compact-table">
          {props.books.map((book) => (
            <article key={book.id}>
              <div className="row-main static">
                <strong>{book.title}</strong>
                <span>
                  editorial jobs: {props.editorialJobs.filter((job) => job.job.bookId === book.id).length}
                </span>
              </div>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={() => props.onEditorial(book.id)} disabled={props.busy === `editorial:${book.id}`}>
                  AI Editorial
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewView(props: {
  book?: Book;
  books: Book[];
  segments: ReviewSegmentSummary[];
  selectedSegment?: ReviewSegmentSummary;
  reviewDraft: string;
  reviewedCount: number;
  translatedCount: number;
  busy?: string;
  onBookChange: (bookId: BookId) => void;
  onSelectSegment: (item: ReviewSegmentSummary) => void;
  onDraftChange: (text: string) => void;
  onSave: () => void;
  onSaveAndNext: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onExport: (bookId: BookId) => void;
}): ReactElement {
  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      props.onSave();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      props.onSaveAndNext();
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      props.onPrevious();
      return;
    }
    if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      props.onNext();
    }
  }

  return (
    <section className="review-shell">
      <div className="review-toolbar">
        <label>
          Book
          <select
            value={props.book?.id ?? ""}
            onChange={(event) => props.onBookChange(event.target.value as BookId)}
          >
            {props.books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </select>
        </label>
        <div className="progress-caption">
          translated {props.translatedCount}/{props.segments.length} · reviewed {props.reviewedCount}
        </div>
        <button type="button" className="secondary" disabled={!props.selectedSegment} onClick={props.onPrevious}>
          이전
        </button>
        <button type="button" className="secondary" disabled={!props.selectedSegment} onClick={props.onNext}>
          다음
        </button>
        <button type="button" disabled={!props.book} onClick={() => props.book && props.onExport(props.book.id)}>
          Final EPUB
        </button>
      </div>
      <div className="review-layout">
        <aside className="segment-rail">
          {props.segments.length === 0 ? (
            <p className="empty">번역된 segment가 없습니다.</p>
          ) : (
            props.segments.map((item) => (
              <button
                key={item.segment.id}
                type="button"
                className={item.segment.id === props.selectedSegment?.segment.id ? "active" : ""}
                onClick={() => props.onSelectSegment(item)}
              >
                <strong>#{item.displayIndex}</strong>
                <span>{item.segment.status}</span>
                {item.qaIssues.length > 0 && <small>QA {item.qaIssues.length}</small>}
              </button>
            ))
          )}
        </aside>
        <div className="editor-grid">
          <article className="text-pane">
            <header>
              <strong>Source</strong>
              <span>{props.selectedSegment?.chapter.title || props.selectedSegment?.chapter.spineHref}</span>
            </header>
            <textarea readOnly value={props.selectedSegment?.segment.sourceText ?? ""} />
          </article>
          <article className="text-pane">
            <header>
              <strong>Final Translation</strong>
              <span>MVP-2 minimal review</span>
            </header>
            <textarea
              value={props.reviewDraft}
              onChange={(event) => props.onDraftChange(event.target.value)}
              onKeyDown={handleEditorKeyDown}
            />
          </article>
          <aside className="qa-side">
            <p className="eyebrow">QA / Context</p>
            {props.selectedSegment?.qaIssues.length ? (
              props.selectedSegment.qaIssues.map((issue) => <p key={issue}>{issue}</p>)
            ) : (
              <p className="empty">표시할 QA issue가 없습니다.</p>
            )}
            <button type="button" onClick={props.onSave} disabled={props.busy === "review:save" || !props.reviewDraft.trim()}>
              저장하고 승인
            </button>
            <button type="button" onClick={props.onSaveAndNext} disabled={props.busy === "review:save" || !props.reviewDraft.trim()}>
              저장 후 다음
            </button>
          </aside>
        </div>
      </div>
    </section>
  );
}

function MemoryView(props: {
  glossaryTerms: GlossaryTerm[];
  glossaryForm: GlossaryFormState;
  tmUnits: TmUnit[];
  tmForm: TmFormState;
  busy?: string;
  onGlossaryFormChange: (form: GlossaryFormState) => void;
  onTmFormChange: (form: TmFormState) => void;
  onSaveGlossary: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onImportGlossary: () => void;
  onExportGlossary: () => void;
  onSaveTm: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}): ReactElement {
  return (
    <div className="screen-grid">
      <section className="panel span-12">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MVP-3 Glossary</p>
            <h3>고유명사와 반복 용어를 prompt와 QA에 반영</h3>
          </div>
          <div className="action-row">
            <button type="button" className="secondary" onClick={props.onImportGlossary}>
              CSV import
            </button>
            <button type="button" className="secondary" onClick={props.onExportGlossary}>
              CSV export
            </button>
          </div>
        </div>
        <form className="glossary-form" onSubmit={(event) => void props.onSaveGlossary(event)}>
          <input value={props.glossaryForm.sourceTerm} onChange={(event) => props.onGlossaryFormChange({ ...props.glossaryForm, sourceTerm: event.target.value })} placeholder="source term" />
          <input value={props.glossaryForm.canonicalKo} onChange={(event) => props.onGlossaryFormChange({ ...props.glossaryForm, canonicalKo: event.target.value })} placeholder="canonical ko" />
          <input value={props.glossaryForm.category} onChange={(event) => props.onGlossaryFormChange({ ...props.glossaryForm, category: event.target.value })} placeholder="category" />
          <input value={props.glossaryForm.aliases} onChange={(event) => props.onGlossaryFormChange({ ...props.glossaryForm, aliases: event.target.value })} placeholder="aliases" />
          <input value={props.glossaryForm.forbiddenTargets} onChange={(event) => props.onGlossaryFormChange({ ...props.glossaryForm, forbiddenTargets: event.target.value })} placeholder="forbidden" />
          <button type="submit" disabled={props.busy === "glossary:save"}>저장</button>
        </form>
        <div className="data-table glossary-table">
          {props.glossaryTerms.slice(0, 80).map((term) => (
            <div key={term.id}>
              <strong>{term.sourceTerm}</strong>
              <span>{term.canonicalKo}</span>
              <span>{term.category}</span>
              <span>{term.confidence}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel span-12">
        <p className="eyebrow">TM Manager</p>
        <form className="tm-form" onSubmit={(event) => void props.onSaveTm(event)}>
          <textarea value={props.tmForm.sourceText} onChange={(event) => props.onTmFormChange({ ...props.tmForm, sourceText: event.target.value })} placeholder="source text" />
          <textarea value={props.tmForm.targetText} onChange={(event) => props.onTmFormChange({ ...props.tmForm, targetText: event.target.value })} placeholder="target text" />
          <select value={props.tmForm.grade} onChange={(event) => props.onTmFormChange({ ...props.tmForm, grade: event.target.value as TmGrade })}>
            <option value="gold">gold</option>
            <option value="gold_candidate">gold_candidate</option>
            <option value="silver">silver</option>
            <option value="reference">reference</option>
          </select>
          <input value={props.tmForm.notes} onChange={(event) => props.onTmFormChange({ ...props.tmForm, notes: event.target.value })} placeholder="notes" />
          <button type="submit" disabled={props.busy === "tm:save"}>TM 저장</button>
        </form>
        <div className="data-table tm-table">
          {props.tmUnits.slice(0, 40).map((unit) => (
            <div key={unit.id}>
              <strong>{unit.sourceText}</strong>
              <span>{unit.targetText}</span>
              <span>{unit.grade}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AlignmentView(props: {
  book?: Book;
  books: Book[];
  preview?: AlignmentPreview;
  pairs: AlignmentPair[];
  sourceAnchor: ChapterId | "";
  referenceAnchor: string;
  busy?: string;
  onBookChange: (bookId: BookId) => void;
  onSourceAnchorChange: (id: ChapterId | "") => void;
  onReferenceAnchorChange: (index: string) => void;
  onImportReference: (bookId: BookId) => void;
  onRun: (bookId: BookId) => void;
}): ReactElement {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Post-MVP Alignment</p>
          <h3>챕터 매핑은 자동 확정하지 않고 사용자 확정 단계로 둡니다.</h3>
        </div>
        <select value={props.book?.id ?? ""} onChange={(event) => props.onBookChange(event.target.value as BookId)}>
          {props.books.map((book) => (
            <option key={book.id} value={book.id}>{book.title}</option>
          ))}
        </select>
      </div>
      <div className="alignment-controls">
        <label>
          Source body start
          <select value={props.sourceAnchor} onChange={(event) => props.onSourceAnchorChange(event.target.value as ChapterId)}>
            <option value="">자동 제안</option>
            {props.preview?.sourceChapters.map((chapter) => (
              <option key={chapter.chapterId ?? chapter.blockStartIndex} value={chapter.chapterId ?? ""}>
                {chapter.chapterIndex + 1}. {chapter.title || chapter.spineHref || "source"} · {percent(chapter.confidence ?? 0)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reference body start
          <select value={props.referenceAnchor} onChange={(event) => props.onReferenceAnchorChange(event.target.value)}>
            <option value="">자동 제안</option>
            {props.preview?.referenceChapters.map((chapter) => (
              <option key={chapter.blockStartIndex} value={chapter.blockStartIndex}>
                {chapter.chapterIndex + 1}. {chapter.title || chapter.spineHref || "reference"} · {percent(chapter.confidence ?? 0)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!props.book || props.busy === `alignment:reference:${props.book?.id}`} onClick={() => props.book && props.onImportReference(props.book.id)}>
          참고본 import
        </button>
        <button type="button" disabled={!props.book || props.busy === `alignment:run:${props.book?.id}`} onClick={() => props.book && props.onRun(props.book.id)}>
          후보 생성
        </button>
      </div>
      <div className="alignment-list">
        {props.pairs.length === 0 ? (
          <p className="empty">아직 alignment pair가 없습니다.</p>
        ) : (
          props.pairs.slice(0, 80).map((pair) => (
            <article key={pair.id} className={pair.confidence < 0.65 ? "low" : ""}>
              <div>
                <p>{pair.sourceText}</p>
                <p>{pair.referenceText}</p>
              </div>
              <span>{pair.status} · {percent(pair.confidence)}</span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ExportView(props: {
  books: Book[];
  spoilerSummaries: Record<string, SpoilerSafeSummary>;
  lastExport?: ExportedBookSummary;
  roundTripReport?: RoundTripReportSummary;
  exportMode: TranslationExportMode;
  busy?: string;
  onExportModeChange: (mode: TranslationExportMode) => void;
  onRoundTrip: (bookId: BookId) => void;
  onTranslated: (bookId: BookId) => void;
  onDraftTxt: (bookId: BookId) => void;
  onOpenReport: (path: string) => void;
}): ReactElement {
  return (
    <section className="panel">
      <p className="eyebrow">Export</p>
      <h3>생성 EPUB는 개인 감상용이며 배포·공유를 전제로 하지 않습니다.</h3>
      <div className="mode-switch" aria-label="EPUB export mode">
        {(["draft", "reviewed", "final"] as TranslationExportMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={props.exportMode === mode ? "active" : ""}
            onClick={() => props.onExportModeChange(mode)}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="book-table">
        {props.books.map((book) => {
          const summary = props.spoilerSummaries[book.id];
          return (
            <article key={book.id}>
              <div className="row-main static">
                <strong>{book.title}</strong>
                <span>
                  translated {summary?.translatedSegments ?? 0}/{summary?.totalSegments ?? 0} · blocking {summary?.blockingErrors ?? 0}
                </span>
              </div>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={() => props.onRoundTrip(book.id)} disabled={props.busy === `export:mvp0:${book.id}`}>
                  Round-trip
                </button>
                <button type="button" onClick={() => props.onTranslated(book.id)} disabled={props.busy === `export:translated:${book.id}`}>
                  {props.exportMode} EPUB
                </button>
                <button type="button" onClick={() => props.onDraftTxt(book.id)} disabled={props.busy === `export:draftTxt:${book.id}`}>
                  Draft TXT
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {props.lastExport && (
        <div className="inline-report">
          <div>
            마지막 export: {props.lastExport.outputPath} · mode {props.lastExport.mode ?? "roundtrip"} · replacements {props.lastExport.replacementCount}
          </div>
          {props.lastExport.reportPath ? (
            <button type="button" className="secondary" onClick={() => props.onOpenReport(props.lastExport!.reportPath!)}>
              Round-trip report 열기
            </button>
          ) : null}
        </div>
      )}
      {props.roundTripReport ? <RoundTripReportPanel report={props.roundTripReport} /> : null}
    </section>
  );
}

function RoundTripReportPanel(props: { report: RoundTripReportSummary }): ReactElement {
  const report = props.report;
  return (
    <section className={report.ok ? "report-panel ok" : "report-panel warn"}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Round-trip Report</p>
          <h3>{report.ok ? "EPUB 구조 검증 통과" : "확인 필요한 항목이 있습니다"}</h3>
        </div>
        <span className={report.ok ? "provider-pill ok" : "provider-pill warn"}>
          {report.mode ?? "roundtrip"} · {report.generatedAt ?? "no timestamp"}
        </span>
      </div>
      <div className="report-metrics">
        <Metric label="Files" value={`${report.outputFileCount}/${report.sourceFileCount}`} detail="output/source" />
        <Metric label="Changed" value={report.changedFiles.length} detail="changed files" />
        <Metric label="Missing" value={report.missingFiles.length} detail="missing files" />
        <Metric label="Replaced" value={report.replacementCount} detail="text blocks" />
      </div>
      <div className="definition-list compact-defs">
        <div>
          <span>Spine</span>
          <strong>{report.outputSpineCount ?? 0} / {report.sourceSpineCount ?? 0}</strong>
        </div>
        <div>
          <span>Manifest</span>
          <strong>{report.outputManifestCount ?? 0} / {report.sourceManifestCount ?? 0}</strong>
        </div>
        <div>
          <span>Nav / TOC</span>
          <strong>
            nav {String(report.outputHasNav)} / toc {String(report.outputHasToc)}
          </strong>
        </div>
        <div>
          <span>Output</span>
          <strong>{report.outputPath ?? "unknown"}</strong>
        </div>
      </div>
      {report.errors.length > 0 ? (
        <div className="report-list">
          <strong>Errors</strong>
          {report.errors.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
      <div className="report-columns">
        <ReportList title="Unexpected changed" items={report.unexpectedChangedFiles} />
        <ReportList title="Missing" items={report.missingFiles} />
        <ReportList title="Added" items={report.addedFiles} />
        <ReportList title="Replacement files" items={report.replacementFiles} />
      </div>
    </section>
  );
}

function ReportList(props: { title: string; items: string[] }): ReactElement {
  return (
    <div className="report-list">
      <strong>{props.title}</strong>
      {props.items.length === 0 ? (
        <span>없음</span>
      ) : (
        props.items.slice(0, 12).map((item) => <span key={item}>{item}</span>)
      )}
      {props.items.length > 12 ? <span>+{props.items.length - 12} more</span> : null}
    </div>
  );
}

function SettingsView(props: {
  providerStatus?: ProviderValidationSummary;
  project: Project;
  consents: ExternalTransferConsent[];
}): ReactElement {
  return (
    <div className="screen-grid">
      <section className="panel span-6">
        <p className="eyebrow">Provider</p>
        <h3>{props.providerStatus?.provider ?? "unknown"}</h3>
        <p>{props.providerStatus?.message ?? "Provider 설정은 .env에서 읽습니다."}</p>
        <span className={`provider-pill ${props.providerStatus?.ok ? "ok" : "warn"}`}>
          {props.providerStatus?.ok ? "연결 가능" : "설정 확인 필요"}
        </span>
      </section>
      <section className="panel span-6">
        <p className="eyebrow">Privacy & Transfer</p>
        <h3>외부 전송은 작업 시작 전 동의</h3>
        <p>
          번역, 외부 임베딩, LLM Judge, AI Editorial 작업은 원문 또는 참고 번역 일부를 provider로 전송할 수 있습니다.
        </p>
        <div className="consent-list">
          {props.consents.length === 0 ? (
            <p className="empty">아직 저장된 외부 전송 동의 이력이 없습니다.</p>
          ) : (
            props.consents.slice(0, 5).map((consent) => (
              <article key={consent.id}>
                <strong>{consent.task}</strong>
                <span>
                  {consent.provider}/{consent.model} · {consent.scope} ·{" "}
                  {new Date(consent.createdAt).toLocaleString()}
                </span>
              </article>
            ))
          )}
        </div>
      </section>
      <section className="panel span-12">
        <p className="eyebrow">Project workspace</p>
        <p className="path">{props.project.workspacePath}</p>
      </section>
    </div>
  );
}

function JobList(props: {
  jobs: TranslationJobProgress[];
  onPause: (job: TranslationJobProgress) => void;
  onResume: (job: TranslationJobProgress) => void;
  onCancel: (job: TranslationJobProgress) => void;
}): ReactElement {
  if (props.jobs.length === 0) {
    return <p className="empty">아직 translation job이 없습니다.</p>;
  }

  return (
    <div className="job-list">
      {props.jobs.map((job) => (
        <article key={job.job.id}>
          <div>
            <strong>{job.job.status}</strong>
            <span>
              {job.translatedCount}/{job.segmentCount} · errors {job.errorCount} · cache {job.cacheHitCount}
            </span>
            <span>
              tokens {formatInteger(job.usage.totalTokens)} · in {formatInteger(job.usage.inputTokens)} / out{" "}
              {formatInteger(job.usage.outputTokens)} ·{" "}
              {job.usage.estimatedCostUsd === undefined
                ? "cost rate not set"
                : `est. $${job.usage.estimatedCostUsd.toFixed(6)}`}
            </span>
            <Progress value={job.segmentCount ? job.translatedCount / job.segmentCount : 0} />
            {job.providerIssues.length > 0 ? (
              <div className="provider-issues">
                {job.providerIssues.slice(0, 3).map((issue) => (
                  <article key={`${issue.category}:${issue.code}`}>
                    <strong>{issue.category}</strong>
                    <span>
                      {issue.code} · {issue.count} segment{issue.count > 1 ? "s" : ""} ·{" "}
                      {issue.retryable ? "retryable" : "user action"}
                    </span>
                    <p>{issue.userAction}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => props.onPause(job)}>
              일시정지
            </button>
            <button type="button" className="secondary" onClick={() => props.onResume(job)}>
              재개
            </button>
            <button type="button" className="danger" onClick={() => props.onCancel(job)}>
              취소
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Milestone(props: { label: string; title: string; active: boolean }): ReactElement {
  return (
    <div className={props.active ? "milestone active" : "milestone"}>
      <span>{props.label}</span>
      <strong>{props.title}</strong>
    </div>
  );
}

function Metric(props: { label: string; value: number | string; detail: string }): ReactElement {
  return (
    <section className="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </section>
  );
}

function Progress(props: { value: number }): ReactElement {
  const width = `${Math.max(0, Math.min(100, Math.round(props.value * 100)))}%`;
  return (
    <div className="progress">
      <span style={{ width }} />
    </div>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function toRoundTripReportSummary(raw: unknown): RoundTripReportSummary {
  const report = readRecord(raw);
  const result = readRecord(report.result);
  const output = readRecord(report.output);
  const structure = readRecord(report.structure);
  const textReplacement = readRecord(report.textReplacement);
  const files = readRecord(report.files);

  return {
    generatedAt: readString(report.generatedAt),
    mode: readString(report.mode),
    ok: readBoolean(result.ok),
    errors: readStringList(result.errors),
    outputPath: readString(output.epubPath),
    replacementCount: readNumber(textReplacement.replacementCount),
    replacementFiles: readStringList(textReplacement.replacementFiles),
    sourceFileCount: readNumber(files.sourceCount),
    outputFileCount: readNumber(files.outputCount),
    missingFiles: readStringList(files.missing),
    addedFiles: readStringList(files.added),
    changedFiles: readStringList(files.changed),
    unexpectedChangedFiles: readStringList(files.unexpectedChanged),
    sourceSpineCount: readOptionalNumber(structure.sourceSpineCount),
    outputSpineCount: readOptionalNumber(structure.outputSpineCount),
    sourceManifestCount: readOptionalNumber(structure.sourceManifestCount),
    outputManifestCount: readOptionalNumber(structure.outputManifestCount),
    sourceHasNav: readOptionalBoolean(structure.sourceHasNav),
    outputHasNav: readOptionalBoolean(structure.outputHasNav),
    sourceHasToc: readOptionalBoolean(structure.sourceHasToc),
    outputHasToc: readOptionalBoolean(structure.outputHasToc)
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function viewTitle(view: WorkspaceView): string {
  const titles: Record<WorkspaceView, string> = {
    home: "프로젝트 홈",
    books: "책과 EPUB round-trip",
    translation: "번역 작업",
    review: "최소 감수 Studio",
    memory: "Series Memory",
    alignment: "Alignment 초안",
    export: "Export",
    settings: "Settings"
  };
  return titles[view];
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
