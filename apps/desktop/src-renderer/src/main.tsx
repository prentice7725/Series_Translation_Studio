import { StrictMode, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type {
  AlignmentPair,
  AlignmentPreview,
  AlignmentRunSummary,
  Book,
  BookId,
  CharacterProfile,
  ChapterId,
  ChapterMemory,
  EditorialJobProgress,
  EditorialRunSummary,
  ExportedBookSummary,
  GlossaryTerm,
  ImportedBookSummary,
  PostReadCorrection,
  Project,
  ProviderValidationSummary,
  ReviewSegmentSummary,
  SegmentSearchResult,
  SegmentId,
  SpoilerSafeSummary,
  StylebookEntry,
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

interface StylebookFormState {
  title: string;
  body: string;
}

interface CharacterFormState {
  name: string;
  speechStyle: string;
  translationNotes: string;
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
  const [editorialBookId, setEditorialBookId] = useState<BookId | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [lastImport, setLastImport] = useState<ImportedBookSummary | undefined>();
  const [lastExport, setLastExport] = useState<ExportedBookSummary | undefined>();
  const [lastTranslation, setLastTranslation] = useState<TranslationRunSummary | undefined>();
  const [lastEditorial, setLastEditorial] = useState<EditorialRunSummary | undefined>();
  const [lastAlignment, setLastAlignment] = useState<AlignmentRunSummary | undefined>();
  const [providerStatus, setProviderStatus] = useState<ProviderValidationSummary | undefined>();
  const [jobProgresses, setJobProgresses] = useState<TranslationJobProgress[]>([]);
  const [editorialProgresses, setEditorialProgresses] = useState<EditorialJobProgress[]>([]);
  const [spoilerSafeSummaries, setSpoilerSafeSummaries] = useState<
    Record<string, SpoilerSafeSummary>
  >({});
  const [revealedBookIds, setRevealedBookIds] = useState<Set<string>>(() => new Set());
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [tmUnits, setTmUnits] = useState<TmUnit[]>([]);
  const [reviewBookId, setReviewBookId] = useState<BookId | undefined>();
  const [reviewSegments, setReviewSegments] = useState<ReviewSegmentSummary[]>([]);
  const [selectedReviewSegmentId, setSelectedReviewSegmentId] = useState<SegmentId | undefined>();
  const [reviewDraft, setReviewDraft] = useState("");
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [postReadBookId, setPostReadBookId] = useState<BookId | undefined>();
  const [postReadQuery, setPostReadQuery] = useState("");
  const [postReadResults, setPostReadResults] = useState<SegmentSearchResult[]>([]);
  const [selectedPostReadSegmentId, setSelectedPostReadSegmentId] = useState<
    SegmentId | undefined
  >();
  const [postReadCorrection, setPostReadCorrection] = useState("");
  const [postReadNote, setPostReadNote] = useState("");
  const [postReadCorrections, setPostReadCorrections] = useState<PostReadCorrection[]>([]);
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);
  const [alignmentBookId, setAlignmentBookId] = useState<BookId | undefined>();
  const [alignmentPairs, setAlignmentPairs] = useState<AlignmentPair[]>([]);
  const [alignmentPreview, setAlignmentPreview] = useState<AlignmentPreview | undefined>();
  const [alignmentSourceChapterId, setAlignmentSourceChapterId] = useState<ChapterId | "">("");
  const [alignmentReferenceStartIndex, setAlignmentReferenceStartIndex] = useState<string>("");
  const [aligningBookId, setAligningBookId] = useState<BookId | undefined>();
  const [stylebookEntries, setStylebookEntries] = useState<StylebookEntry[]>([]);
  const [characterProfiles, setCharacterProfiles] = useState<CharacterProfile[]>([]);
  const [chapterMemories, setChapterMemories] = useState<ChapterMemory[]>([]);
  const [memoryBookId, setMemoryBookId] = useState<BookId | undefined>();
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
  const [stylebookForm, setStylebookForm] = useState<StylebookFormState>({
    title: "",
    body: ""
  });
  const [characterForm, setCharacterForm] = useState<CharacterFormState>({
    name: "",
    speechStyle: "",
    translationNotes: ""
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
  const selectedReviewBook = useMemo(
    () => books.find((book) => book.id === reviewBookId),
    [books, reviewBookId]
  );
  const canShowReviewBody =
    !selectedReviewBook?.spoilerSafeEnabled ||
    (reviewBookId ? revealedBookIds.has(reviewBookId) : false);
  const selectedPostReadResult = useMemo(
    () =>
      postReadResults.find((candidate) => candidate.segment.id === selectedPostReadSegmentId) ??
      postReadResults[0],
    [postReadResults, selectedPostReadSegmentId]
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
      setStylebookEntries([]);
      setCharacterProfiles([]);
      setChapterMemories([]);
      setSpoilerSafeSummaries({});
      return;
    }

    const nextBooks = await window.sts.book.list(project.id);
    setBooks(nextBooks);
    setGlossaryTerms(await window.sts.glossary.list(project.id));
    setTmUnits(await window.sts.tm.list(project.id));
    setStylebookEntries(await window.sts.memory.listStylebook(project.id));
    setCharacterProfiles(await window.sts.memory.listCharacters(project.id));
    const progressLists = await Promise.all(
      nextBooks.map((book: Book) => window.sts.translation.listJobs(project.id, book.id))
    );
    const editorialProgressLists = await Promise.all(
      nextBooks.map((book: Book) => window.sts.editorial.listJobs(project.id, book.id))
    );
    const spoilerSummaries = await Promise.all(
      nextBooks.map((book: Book) => window.sts.spoilerSafe.getSummary(project.id, book.id))
    );
    setJobProgresses(progressLists.flat());
    setEditorialProgresses(editorialProgressLists.flat());
    setSpoilerSafeSummaries(
      Object.fromEntries(spoilerSummaries.map((summary) => [summary.bookId, summary]))
    );
    if (reviewBookId && nextBooks.some((book) => book.id === reviewBookId)) {
      await loadReviewSegments(project.id, reviewBookId);
    } else {
      setReviewBookId(undefined);
      setReviewSegments([]);
      setSelectedReviewSegmentId(undefined);
      setReviewDraft("");
    }
    if (postReadBookId && nextBooks.some((book) => book.id === postReadBookId)) {
      setPostReadCorrections(await window.sts.postRead.listCorrections(project.id, postReadBookId));
    }
    if (memoryBookId && nextBooks.some((book) => book.id === memoryBookId)) {
      setChapterMemories(await window.sts.memory.listChapterMemories(project.id, memoryBookId));
    }
    if (alignmentBookId && nextBooks.some((book) => book.id === alignmentBookId)) {
      await loadAlignmentPreview(project.id, alignmentBookId);
    } else {
      setAlignmentBookId(undefined);
      setAlignmentPreview(undefined);
      setAlignmentPairs([]);
    }
  }

  async function loadAlignmentPreview(projectId: Project["id"], bookId: BookId): Promise<void> {
    const preview = await window.sts.alignment.preview(projectId, bookId);
    setAlignmentPreview(preview);
    const suggestedSource =
      preview.sourceChapters.find((chapter) => chapter.chapterId === preview.suggestedSourceChapterId) ??
      preview.sourceChapters[0];
    const suggestedReference =
      preview.referenceChapters.find(
        (chapter) => chapter.blockStartIndex === preview.suggestedReferenceBlockStartIndex
      ) ?? preview.referenceChapters[0];
    setAlignmentSourceChapterId((current) => current || suggestedSource?.chapterId || "");
    setAlignmentReferenceStartIndex((current) =>
      current || (suggestedReference ? String(suggestedReference.blockStartIndex) : "")
    );
  }

  useEffect(() => {
    void loadProjects();
  }, [hasBridge]);

  useEffect(() => {
    if (!hasBridge) {
      return undefined;
    }

    return window.sts.editorial.onProgress((progress: EditorialJobProgress) => {
      setEditorialProgresses((prev) => [
        progress,
        ...prev.filter((candidate) => candidate.job.id !== progress.job.id)
      ]);
    });
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

  async function exportSpoilerSafe(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      setError("먼저 프로젝트를 선택하세요.");
      return;
    }

    setError(undefined);
    setExportingBookId(bookId);

    try {
      setLastExport(await window.sts.spoilerSafe.exportEpub(selectedProject.id, bookId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spoiler-safe EPUB export에 실패했습니다.");
    } finally {
      setExportingBookId(undefined);
    }
  }

  async function runEditorial(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      setError("먼저 프로젝트를 선택하세요.");
      return;
    }

    setError(undefined);
    setEditorialBookId(bookId);

    try {
      setLastEditorial(await window.sts.editorial.run(selectedProject.id, bookId));
      await loadBooks(selectedProject);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 편집장 감수에 실패했습니다.");
    } finally {
      setEditorialBookId(undefined);
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

  async function exportTmCsv(): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const path = await window.sts.export.tmCsv(selectedProject.id);
    if (path) {
      setError(`TM exported: ${path}`);
    }
  }

  async function exportBilingualCsv(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const path = await window.sts.export.bilingualCsv(selectedProject.id, bookId);
    if (path) {
      setError(`Bilingual CSV exported: ${path}`);
    }
  }

  async function exportQaReport(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const path = await window.sts.export.qaReport(selectedProject.id, bookId);
    if (path) {
      setError(`QA report exported: ${path}`);
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

    const book = books.find((candidate) => candidate.id === bookId);
    if (book?.spoilerSafeEnabled && !revealedBookIds.has(bookId)) {
      const confirmed = window.confirm(
        "본문을 표시하면 아직 읽지 않은 내용이 노출될 수 있습니다.\n정말 spoiler-safe mode를 해제하고 Review Studio를 열까요?"
      );
      if (!confirmed) {
        setError("Spoiler-safe mode가 켜져 있어 본문을 표시하지 않았습니다.");
        return;
      }
      setRevealedBookIds((prev) => new Set(prev).add(bookId));
    }

    setError(undefined);
    setReviewBookId(bookId);
    await loadReviewSegments(selectedProject.id, bookId);
  }

  async function toggleSpoilerSafe(book: Book): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const nextEnabled = !book.spoilerSafeEnabled;
    if (!nextEnabled && !revealedBookIds.has(book.id)) {
      const confirmed = window.confirm(
        "Spoiler-safe mode를 끄면 Review Studio에서 본문을 볼 수 있습니다.\n정말 해제할까요?"
      );
      if (!confirmed) {
        return;
      }
      setRevealedBookIds((prev) => new Set(prev).add(book.id));
    }

    const updated = await window.sts.book.setSpoilerSafe(selectedProject.id, book.id, nextEnabled);
    setBooks((prev) => prev.map((candidate) => (candidate.id === updated.id ? updated : candidate)));
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

  async function openPostReadStudio(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setError(undefined);
    setPostReadBookId(bookId);
    setPostReadResults([]);
    setSelectedPostReadSegmentId(undefined);
    setPostReadCorrection("");
    setPostReadNote("");
    setPostReadCorrections(await window.sts.postRead.listCorrections(selectedProject.id, bookId));
  }

  async function searchPostReadSegments(): Promise<void> {
    if (!selectedProject || !postReadBookId) {
      return;
    }

    const results = await window.sts.postRead.searchSegments(
      selectedProject.id,
      postReadBookId,
      postReadQuery
    );
    setPostReadResults(results);
    const first = results[0];
    setSelectedPostReadSegmentId(first?.segment.id);
    setPostReadCorrection(
      first?.segment.finalTranslation ??
        first?.segment.editorialTranslation ??
        first?.segment.aiTranslation ??
        ""
    );
  }

  function selectPostReadResult(result: SegmentSearchResult): void {
    setSelectedPostReadSegmentId(result.segment.id);
    setPostReadCorrection(
      result.segment.finalTranslation ??
        result.segment.editorialTranslation ??
        result.segment.aiTranslation ??
        ""
    );
  }

  async function savePostReadCorrection(): Promise<void> {
    if (!selectedProject || !postReadBookId || !selectedPostReadResult) {
      return;
    }

    setError(undefined);
    setIsSavingCorrection(true);
    try {
      await window.sts.postRead.saveCorrection(selectedProject.id, postReadBookId, {
        segmentId: selectedPostReadResult.segment.id,
        correctedText: postReadCorrection,
        note: postReadNote || undefined
      });
      setPostReadCorrections(
        await window.sts.postRead.listCorrections(selectedProject.id, postReadBookId)
      );
      setError("Correction 저장 완료. EPUB regenerate를 누르면 수정본으로 다시 생성됩니다.");
      await loadBooks(selectedProject);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Correction 저장에 실패했습니다.");
    } finally {
      setIsSavingCorrection(false);
    }
  }

  async function promoteCorrectionToGold(correctionId: string): Promise<void> {
    if (!selectedProject || !postReadBookId) {
      return;
    }

    await window.sts.postRead.promoteCorrectionToGold(selectedProject.id, correctionId);
    setPostReadCorrections(
      await window.sts.postRead.listCorrections(selectedProject.id, postReadBookId)
    );
    setTmUnits(await window.sts.tm.list(selectedProject.id));
  }

  async function importReference(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setError(undefined);
    setAligningBookId(bookId);
    try {
      const summary = await window.sts.alignment.importReference(selectedProject.id, bookId);
      if (summary) {
        setLastAlignment(summary);
        setAlignmentBookId(bookId);
        await loadAlignmentPreview(selectedProject.id, bookId);
        setAlignmentPairs(await window.sts.alignment.listPairs(selectedProject.id, bookId));
        setError(`Reference import: ${summary.referenceBlockCount} blocks`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reference import에 실패했습니다.");
    } finally {
      setAligningBookId(undefined);
    }
  }

  async function reimportLastReference(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setError(undefined);
    setAligningBookId(bookId);
    try {
      const summary = await window.sts.alignment.reimportLastReference(selectedProject.id, bookId);
      if (summary) {
        setLastAlignment(summary);
        setAlignmentBookId(bookId);
        await loadAlignmentPreview(selectedProject.id, bookId);
        setAlignmentPairs(await window.sts.alignment.listPairs(selectedProject.id, bookId));
        setError(`Reference reimport: ${summary.referenceBlockCount} blocks`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reference 재import에 실패했습니다.");
    } finally {
      setAligningBookId(undefined);
    }
  }

  async function runAlignment(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setError(undefined);
    setAligningBookId(bookId);
    try {
      const useManualStarts = alignmentBookId === bookId;
      const summary = await window.sts.alignment.run(selectedProject.id, bookId, {
        sourceChapterId: useManualStarts ? alignmentSourceChapterId || undefined : undefined,
        referenceBlockStartIndex:
          useManualStarts && alignmentReferenceStartIndex
            ? Number(alignmentReferenceStartIndex)
            : undefined
      });
      setLastAlignment(summary);
      setAlignmentBookId(bookId);
      await loadAlignmentPreview(selectedProject.id, bookId);
      setAlignmentPairs(await window.sts.alignment.listPairs(selectedProject.id, bookId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Alignment 실행에 실패했습니다.");
    } finally {
      setAligningBookId(undefined);
    }
  }

  async function openAlignmentStudio(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setAlignmentBookId(bookId);
    setAlignmentSourceChapterId("");
    setAlignmentReferenceStartIndex("");
    await loadAlignmentPreview(selectedProject.id, bookId);
    setAlignmentPairs(await window.sts.alignment.listPairs(selectedProject.id, bookId));
  }

  async function promoteAlignmentPair(pairId: AlignmentPair["id"], grade: TmGrade): Promise<void> {
    if (!selectedProject || !alignmentBookId) {
      return;
    }

    const updated = await window.sts.alignment.promotePair(selectedProject.id, { pairId, grade });
    setAlignmentPairs((prev) => prev.map((pair) => (pair.id === updated.id ? updated : pair)));
    setTmUnits(await window.sts.tm.list(selectedProject.id));
  }

  async function rejectAlignmentPair(pairId: AlignmentPair["id"]): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const updated = await window.sts.alignment.rejectPair(selectedProject.id, pairId);
    setAlignmentPairs((prev) => prev.map((pair) => (pair.id === updated.id ? updated : pair)));
  }

  async function saveStylebookEntry(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    await window.sts.memory.saveStylebook(selectedProject.id, {
      entryType: "voice",
      title: stylebookForm.title,
      body: stylebookForm.body,
      priority: 70
    });
    setStylebookEntries(await window.sts.memory.listStylebook(selectedProject.id));
    setStylebookForm({ title: "", body: "" });
  }

  async function saveCharacterProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }

    await window.sts.memory.saveCharacter(selectedProject.id, characterForm);
    setCharacterProfiles(await window.sts.memory.listCharacters(selectedProject.id));
    setCharacterForm({ name: "", speechStyle: "", translationNotes: "" });
  }

  async function openMemoryForBook(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setMemoryBookId(bookId);
    setChapterMemories(await window.sts.memory.listChapterMemories(selectedProject.id, bookId));
  }

  async function saveAutoChapterMemory(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const reviewItems = await window.sts.review.listSegments(selectedProject.id, bookId);
    const chapter = reviewItems[0]?.chapter;
    if (!chapter) {
      setError("Chapter memory를 만들 segment가 없습니다.");
      return;
    }

    const sourcePreview = reviewItems
      .slice(0, 8)
      .map((item) => item.segment.sourceText)
      .join(" ");
    await window.sts.memory.saveChapterMemory(selectedProject.id, bookId, {
      chapterId: chapter.id,
      summary: sourcePreview.slice(0, 700),
      termNotes: glossaryTerms
        .slice(0, 12)
        .map((term) => `${term.sourceTerm}=${term.canonicalKo}`)
        .join("; ")
    });
    setMemoryBookId(bookId);
    setChapterMemories(await window.sts.memory.listChapterMemories(selectedProject.id, bookId));
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

  async function pauseEditorialJob(jobId: EditorialJobProgress["job"]["id"]): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const progress = await window.sts.editorial.pause(selectedProject.id, jobId);
    setEditorialProgresses((prev) => [
      progress,
      ...prev.filter((candidate) => candidate.job.id !== progress.job.id)
    ]);
  }

  async function resumeEditorialJob(bookId: BookId): Promise<void> {
    if (!selectedProject) {
      return;
    }

    setLastEditorial(await window.sts.editorial.resume(selectedProject.id, bookId));
    await loadBooks(selectedProject);
  }

  async function cancelEditorialJob(jobId: EditorialJobProgress["job"]["id"]): Promise<void> {
    if (!selectedProject) {
      return;
    }

    const progress = await window.sts.editorial.cancel(selectedProject.id, jobId);
    setEditorialProgresses((prev) => [
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
                  {lastExport.validation
                    ? ` · EPUB ${lastExport.validation.ok ? "valid" : "invalid"} · ${lastExport.validation.fileSize} bytes`
                    : ""}
                </p>
                {lastExport.validation && lastExport.validation.errors.length > 0 ? (
                  <p className="form-error">{lastExport.validation.errors.join(", ")}</p>
                ) : null}
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

            {lastEditorial ? (
              <section className="import-result">
                <h3>최근 AI 편집장 감수</h3>
                <p>
                  {lastEditorial.book.title}: approved {lastEditorial.approvedCount}/
                  {lastEditorial.segmentCount}, needs review {lastEditorial.needsReviewCount},
                  rejected {lastEditorial.rejectedCount}, gold candidate{" "}
                  {lastEditorial.goldCandidateCount}
                </p>
                <p className="path">job {lastEditorial.job.id}</p>
              </section>
            ) : null}

            {lastAlignment ? (
              <section className="import-result">
                <h3>최근 Alignment</h3>
                <p>
                  {lastAlignment.book.title}: pair {lastAlignment.pairCount}, source{" "}
                  {lastAlignment.sourceBlockCount}, reference {lastAlignment.referenceBlockCount},
                  confidence {lastAlignment.averageConfidence}
                </p>
                {lastAlignment.debugLogPath ? (
                  <p className="path">{lastAlignment.debugLogPath}</p>
                ) : null}
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

            {editorialProgresses.length > 0 ? (
              <section className="book-section">
                <div className="section-header">
                  <h3>Editorial Jobs</h3>
                  <span>{editorialProgresses.length}</span>
                </div>
                <div className="book-list">
                  {editorialProgresses.map((progress) => (
                    <article key={progress.job.id} className="book-row">
                      <div>
                        <strong>{progress.job.status}</strong>
                        <span>
                          {progress.processedCount}/{progress.segmentCount} processed, approve{" "}
                          {progress.approvedCount}, review {progress.needsReviewCount}, reject{" "}
                          {progress.rejectedCount}, gold candidate {progress.goldCandidateCount}
                        </span>
                        <span className="path">{progress.job.id}</span>
                      </div>
                      <div className="book-actions">
                        <button
                          type="button"
                          onClick={() => void pauseEditorialJob(progress.job.id)}
                          disabled={progress.job.status !== "running"}
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          onClick={() => void resumeEditorialJob(progress.job.bookId)}
                          disabled={!["paused", "failed", "running"].includes(progress.job.status)}
                        >
                          Resume
                        </button>
                        <button
                          type="button"
                          onClick={() => void cancelEditorialJob(progress.job.id)}
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

            {Object.keys(spoilerSafeSummaries).length > 0 ? (
              <section className="book-section spoiler-summary">
                <div className="section-header">
                  <h3>Spoiler-safe Summary</h3>
                  <span>{Object.keys(spoilerSafeSummaries).length}</span>
                </div>
                <div className="summary-grid">
                  {books.map((book) => {
                    const summary = spoilerSafeSummaries[book.id];
                    return summary ? (
                      <article key={book.id} className="summary-tile">
                        <strong>{book.title}</strong>
                        <span>{summary.summary}</span>
                        <dl>
                          <div>
                            <dt>approved</dt>
                            <dd>{summary.editorialApproved}</dd>
                          </div>
                          <div>
                            <dt>review</dt>
                            <dd>{summary.needsReview}</dd>
                          </div>
                          <div>
                            <dt>blocking</dt>
                            <dd>{summary.blockingErrors}</dd>
                          </div>
                          <div>
                            <dt>gold cand.</dt>
                            <dd>{summary.goldCandidates}</dd>
                          </div>
                        </dl>
                      </article>
                    ) : null;
                  })}
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
                <button type="button" onClick={() => void exportTmCsv()}>
                  TM Export
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
                <h3>Series Memory</h3>
                <span>{stylebookEntries.length + characterProfiles.length + chapterMemories.length}</span>
              </div>
              <div className="memory-grid">
                <form className="memory-form" onSubmit={saveStylebookEntry}>
                  <input
                    value={stylebookForm.title}
                    onChange={(event) =>
                      setStylebookForm((prev) => ({ ...prev, title: event.target.value }))
                    }
                    placeholder="style title"
                  />
                  <textarea
                    value={stylebookForm.body}
                    onChange={(event) =>
                      setStylebookForm((prev) => ({ ...prev, body: event.target.value }))
                    }
                    placeholder="voice, pacing, punctuation, recurring style"
                  />
                  <button
                    type="submit"
                    disabled={!stylebookForm.title.trim() || !stylebookForm.body.trim()}
                  >
                    Style 저장
                  </button>
                </form>
                <form className="memory-form" onSubmit={saveCharacterProfile}>
                  <input
                    value={characterForm.name}
                    onChange={(event) =>
                      setCharacterForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="character"
                  />
                  <input
                    value={characterForm.speechStyle}
                    onChange={(event) =>
                      setCharacterForm((prev) => ({ ...prev, speechStyle: event.target.value }))
                    }
                    placeholder="speech style"
                  />
                  <textarea
                    value={characterForm.translationNotes}
                    onChange={(event) =>
                      setCharacterForm((prev) => ({
                        ...prev,
                        translationNotes: event.target.value
                      }))
                    }
                    placeholder="translation notes"
                  />
                  <button type="submit" disabled={!characterForm.name.trim()}>
                    Character 저장
                  </button>
                </form>
              </div>
              <div className="memory-lists">
                {stylebookEntries.slice(0, 6).map((entry) => (
                  <article key={entry.id}>
                    <strong>{entry.title}</strong>
                    <span>{entry.body}</span>
                  </article>
                ))}
                {characterProfiles.slice(0, 6).map((profile) => (
                  <article key={profile.id}>
                    <strong>{profile.name}</strong>
                    <span>{profile.speechStyle || profile.translationNotes || "profile"}</span>
                  </article>
                ))}
                {chapterMemories.slice(0, 4).map((memory) => (
                  <article key={memory.id}>
                    <strong>Chapter memory</strong>
                    <span>{memory.summary}</span>
                  </article>
                ))}
              </div>
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
                        {spoilerSafeSummaries[book.id] ? (
                          <span>
                            spoiler-safe:{" "}
                            {book.spoilerSafeEnabled ? "on" : "off"} · approved{" "}
                            {spoilerSafeSummaries[book.id].editorialApproved}/
                            {spoilerSafeSummaries[book.id].totalSegments} · review{" "}
                            {spoilerSafeSummaries[book.id].needsReview} · blocking{" "}
                            {spoilerSafeSummaries[book.id].blockingErrors}
                          </span>
                        ) : null}
                      </div>
                      <div className="book-actions">
                        <button type="button" onClick={() => void toggleSpoilerSafe(book)}>
                          {book.spoilerSafeEnabled ? "Spoiler On" : "Spoiler Off"}
                        </button>
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
                          onClick={() => void runEditorial(book.id)}
                          disabled={editorialBookId === book.id}
                        >
                          {editorialBookId === book.id ? "감수 중" : "AI Editorial"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportSpoilerSafe(book.id)}
                          disabled={
                            exportingBookId === book.id ||
                            !spoilerSafeSummaries[book.id]?.canExport
                          }
                        >
                          Safe Export
                        </button>
                        <button type="button" onClick={() => void openReviewStudio(book.id)}>
                          Review
                        </button>
                        <button type="button" onClick={() => void openPostReadStudio(book.id)}>
                          Post-read
                        </button>
                        <button
                          type="button"
                          onClick={() => void importReference(book.id)}
                          disabled={aligningBookId === book.id}
                        >
                          Ref Import
                        </button>
                        <button
                          type="button"
                          onClick={() => void reimportLastReference(book.id)}
                          disabled={aligningBookId === book.id}
                        >
                          Ref Again
                        </button>
                        <button
                          type="button"
                          onClick={() => void runAlignment(book.id)}
                          disabled={aligningBookId === book.id}
                        >
                          Align
                        </button>
                        <button type="button" onClick={() => void openAlignmentStudio(book.id)}>
                          Alignment
                        </button>
                        <button type="button" onClick={() => void openMemoryForBook(book.id)}>
                          Memory
                        </button>
                        <button type="button" onClick={() => void saveAutoChapterMemory(book.id)}>
                          Chapter Memo
                        </button>
                        <button type="button" onClick={() => void exportBilingualCsv(book.id)}>
                          CSV
                        </button>
                        <button type="button" onClick={() => void exportQaReport(book.id)}>
                          QA
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

            {alignmentBookId ? (
              <section className="alignment-studio">
                <div className="section-header">
                  <h3>Alignment Engine</h3>
                  <span>{alignmentPairs.length}</span>
                </div>
                {alignmentPreview ? (
                  <div className="alignment-anchor-panel">
                    <label>
                      Source start
                      <select
                        value={alignmentSourceChapterId}
                        onChange={(event) =>
                          setAlignmentSourceChapterId(event.target.value as ChapterId)
                        }
                      >
                        {alignmentPreview.sourceChapters.map((chapter) => (
                          <option key={chapter.chapterId} value={chapter.chapterId}>
                            {chapter.chapterIndex + 1}. {chapter.spineHref || chapter.title || "source"} ·{" "}
                            {chapter.candidateType ?? "unknown"} {Math.round((chapter.confidence ?? 0) * 100)}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reference start
                      <select
                        value={alignmentReferenceStartIndex}
                        onChange={(event) => setAlignmentReferenceStartIndex(event.target.value)}
                      >
                        {alignmentPreview.referenceChapters.map((chapter) => (
                          <option key={chapter.blockStartIndex} value={chapter.blockStartIndex}>
                            {chapter.chapterIndex + 1}. {chapter.spineHref || chapter.title || "reference"} ·{" "}
                            {chapter.candidateType ?? "unknown"} {Math.round((chapter.confidence ?? 0) * 100)}%
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void runAlignment(alignmentBookId)}
                      disabled={aligningBookId === alignmentBookId}
                    >
                      Align From Selected
                    </button>
                    <div className="alignment-preview-columns">
                      <p>
                        {
                          alignmentPreview.sourceChapters.find(
                            (chapter) => chapter.chapterId === alignmentSourceChapterId
                          )?.previewText
                        }
                      </p>
                      <p>
                        {
                          alignmentPreview.referenceChapters.find(
                            (chapter) =>
                              String(chapter.blockStartIndex) === alignmentReferenceStartIndex
                          )?.previewText
                        }
                      </p>
                    </div>
                  </div>
                ) : null}
                {alignmentPairs.length === 0 ? (
                  <p className="empty">reference를 import하고 Align을 실행하세요.</p>
                ) : (
                  <div className="alignment-list">
                    {alignmentPairs.slice(0, 80).map((pair) => (
                      <article
                        key={pair.id}
                        className={`alignment-pair ${pair.confidence < 0.65 ? "low-confidence" : ""}`}
                      >
                        <div className="alignment-columns">
                          <p>{pair.sourceText}</p>
                          <p>{pair.referenceText}</p>
                        </div>
                        <div className="book-actions">
                          <span>
                            {pair.status} · {Math.round(pair.confidence * 100)}%
                            {pair.confidence < 0.65 ? " · check" : ""}
                          </span>
                          <button
                            type="button"
                            onClick={() => void promoteAlignmentPair(pair.id, "reference")}
                            disabled={pair.status === "approved"}
                          >
                            Ref TM
                          </button>
                          <button
                            type="button"
                            onClick={() => void promoteAlignmentPair(pair.id, "silver")}
                            disabled={pair.status === "approved"}
                          >
                            Silver
                          </button>
                          <button
                            type="button"
                            onClick={() => void promoteAlignmentPair(pair.id, "gold")}
                            disabled={pair.status === "approved"}
                          >
                            Gold
                          </button>
                          <button
                            type="button"
                            onClick={() => void rejectAlignmentPair(pair.id)}
                            disabled={pair.status === "rejected"}
                          >
                            Reject
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

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
                          <textarea
                            readOnly
                            value={
                              canShowReviewBody
                                ? selectedReviewSegment.segment.sourceText
                                : "Spoiler-safe mode is active. Use the reveal confirmation to view body text."
                            }
                          />
                        </label>
                        <label>
                          AI Translation
                          <textarea
                            readOnly
                            value={
                              canShowReviewBody
                                ? selectedReviewSegment.segment.aiTranslation ?? ""
                                : "Spoiler-safe mode is active."
                            }
                          />
                        </label>
                        <label>
                          Final Translation
                          <textarea
                            value={canShowReviewBody ? reviewDraft : "Spoiler-safe mode is active."}
                            onChange={(event) => setReviewDraft(event.target.value)}
                            readOnly={!canShowReviewBody}
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
                            disabled={isSavingReview || !reviewDraft.trim() || !canShowReviewBody}
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

            {postReadBookId ? (
              <section className="post-read-studio">
                <div className="section-header">
                  <h3>Post-read Correction</h3>
                  <span>{postReadCorrections.length}</span>
                </div>
                <div className="post-read-search">
                  <input
                    value={postReadQuery}
                    onChange={(event) => setPostReadQuery(event.target.value)}
                    placeholder="읽다가 걸린 문장을 입력하세요"
                  />
                  <button
                    type="button"
                    onClick={() => void searchPostReadSegments()}
                    disabled={!postReadQuery.trim()}
                  >
                    Search
                  </button>
                </div>

                <div className="post-read-layout">
                  <div className="segment-list" aria-label="post-read search results">
                    {postReadResults.length === 0 ? (
                      <p className="empty">검색 결과가 없습니다.</p>
                    ) : (
                      postReadResults.map((result) => (
                        <button
                          key={result.segment.id}
                          type="button"
                          className={
                            result.segment.id === selectedPostReadResult?.segment.id
                              ? "active"
                              : ""
                          }
                          onClick={() => selectPostReadResult(result)}
                        >
                          <strong>#{result.displayIndex}</strong>
                          <span>{Math.round(result.score * 100)}%</span>
                          <small>{result.segment.status}</small>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="review-detail">
                    {selectedPostReadResult ? (
                      <>
                        <div className="review-meta">
                          <strong>
                            {selectedPostReadResult.chapter.title ||
                              selectedPostReadResult.chapter.spineHref}
                          </strong>
                          <span>segment #{selectedPostReadResult.displayIndex}</span>
                        </div>
                        <label>
                          Matched Text
                          <textarea readOnly value={selectedPostReadResult.matchedText} />
                        </label>
                        <label>
                          Correction
                          <textarea
                            value={postReadCorrection}
                            onChange={(event) => setPostReadCorrection(event.target.value)}
                          />
                        </label>
                        <label>
                          Note
                          <input
                            value={postReadNote}
                            onChange={(event) => setPostReadNote(event.target.value)}
                            placeholder="선택 사항"
                          />
                        </label>
                        <div className="book-actions">
                          <button
                            type="button"
                            onClick={() => void savePostReadCorrection()}
                            disabled={isSavingCorrection || !postReadCorrection.trim()}
                          >
                            {isSavingCorrection ? "저장 중" : "Correction 저장"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void exportTranslated(postReadBookId)}
                            disabled={exportingBookId === postReadBookId}
                          >
                            EPUB regenerate
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="empty">문장을 검색하고 segment를 선택하세요.</p>
                    )}
                  </div>
                </div>

                {postReadCorrections.length > 0 ? (
                  <div className="correction-history">
                    <h3>Correction History</h3>
                    <div className="book-list">
                      {postReadCorrections.map((correction) => (
                        <article key={correction.id} className="book-row tm-row">
                          <div>
                            <strong>{correction.correctedText}</strong>
                            <span>{correction.note || "note 없음"}</span>
                            <span>{correction.promotedTmUnitId ? "gold TM 등록됨" : "TM 미등록"}</span>
                          </div>
                          <div className="book-actions">
                            <button
                              type="button"
                              onClick={() => void promoteCorrectionToGold(correction.id)}
                              disabled={Boolean(correction.promotedTmUnitId)}
                            >
                              Promote Gold
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
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
