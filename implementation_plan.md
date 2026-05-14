# Series Translation Studio 구현 계획서

## 0. 문서 목적

이 문서는 `series_translation_studio_prd_v3.md`와 `sts_uiux_spec_v3.md`를 바탕으로, Series Translation Studio(STS)를 실제로 개발하기 위한 구현 순서, 패키지 책임, 작업 단위, 완료 기준, 테스트 전략을 정리한 개발 착수용 문서다.

목표는 처음부터 전체 시스템을 한 번에 만들지 않고, EPUB round-trip 검증부터 시작해 실제 번역, 최소 감수, glossary, TM, alignment, AI Editorial까지 단계적으로 확장하는 것이다.

---

## 1. 구현 원칙

### 1.1 제품 전제

- 대상 사용자는 1인 개인 사용자다.
- 외부 공개, 공유, 협업, SaaS, 권한 관리 기능은 만들지 않는다.
- 모든 프로젝트 데이터는 로컬 workspace에 저장한다.
- cloud sync는 기본 비활성 또는 비목표로 둔다.
- DRM 해제 기능은 제공하지 않는다.
- 생성된 EPUB, TM, glossary, stylebook은 본인 감상용으로만 사용한다.

### 1.2 개발 전제

- 데스크톱 앱: Electron + React + TypeScript
- 패키지 관리: pnpm workspace
- 데이터베이스: SQLite
- 기본 번역 provider: Vertex AI Gemini
- 기본 임베딩: 로컬 다국어 임베딩 모델 우선
- 긴 작업은 job 단위로 중단, 재개, 재시도 가능해야 한다.
- 모든 cache key는 재현 가능해야 한다.
- MVP에서는 alignment와 AI Editorial을 붙이지 않는다.

### 1.3 구현 우선순위

1. EPUB를 안전하게 뜯고 다시 봉합한다.
2. dummy translation으로 round-trip을 검증한다.
3. 실제 번역 API를 붙인다.
4. translation cache와 resume을 안정화한다.
5. 최소 Review Studio를 만든다.
6. glossary를 붙인다.
7. TM 수동 등록과 검색을 붙인다.
8. embedding cache를 붙인다.
9. chapter alignment를 붙인다.
10. paragraph alignment와 Review UI를 붙인다.
11. multi-reference와 AI Editorial을 붙인다.
12. character memory와 stylebook을 고도화한다.

---

## 2. 권장 저장소 구조

```text
series-translation-studio/
├─ apps/
│  └─ desktop/
│     ├─ src-main/
│     │  ├─ ipc/
│     │  ├─ jobs/
│     │  ├─ db/
│     │  ├─ filesystem/
│     │  └─ main.ts
│     ├─ src-preload/
│     │  └─ index.ts
│     ├─ src-renderer/
│     │  ├─ app/
│     │  ├─ routes/
│     │  ├─ components/
│     │  ├─ features/
│     │  ├─ stores/
│     │  └─ styles/
│     └─ package.json
│
├─ packages/
│  ├─ common/
│  ├─ epub-core/
│  ├─ db-core/
│  ├─ job-core/
│  ├─ translator-core/
│  ├─ vertex-provider/
│  ├─ glossary-core/
│  ├─ tm-core/
│  ├─ qa-core/
│  ├─ embedding-core/
│  ├─ aligner/
│  └─ export-core/
│
├─ docs/
│  ├─ implementation_plan.md
│  ├─ architecture.md
│  ├─ db-schema.md
│  ├─ prompts.md
│  └─ roadmap.md
│
├─ samples/
│  ├─ epubs/
│  └─ fixtures/
│
├─ scripts/
├─ tests/
├─ package.json
├─ pnpm-workspace.yaml
└─ README.md
```

---

## 3. 핵심 패키지 책임

### 3.1 `packages/common`

공유 타입, enum, validation schema, 공통 유틸을 둔다.

주요 산출물:

- `Book`, `Project`, `SourceDocument`
- `TextSection`, `TextBlock`, `LogicalChapter`
- `TranslationJob`, `TranslationSegment`
- `TmUnit`, `GlossaryTerm`, `QaIssue`
- `Result<T, E>` 형태의 공통 error handling
- `hashText`, `normalizeText`, `safeJsonParse`

---

### 3.2 `packages/db-core`

SQLite 연결과 migration을 담당한다.

주요 책임:

- project workspace별 `project.sqlite` 생성
- migration runner
- repository layer
- transaction helper
- backup/export helper

초기 구현 테이블:

- `projects`
- `books`
- `source_documents`
- `document_items`
- `text_sections`
- `logical_chapters`
- `text_blocks`
- `translation_jobs`
- `translation_segments`
- `qa_issues`
- `glossary_terms`
- `tm_units`
- `prompt_templates`
- `provider_usage`
- `manifests`

Post-MVP 테이블:

- `embeddings`
- `chapter_alignments`
- `alignments`
- `character_profiles`
- `stylebook_entries`

---

### 3.3 `packages/epub-core`

EPUB import, 분석, block 추출, rebuild, validation을 담당한다.

MVP 책임:

- EPUB unzip
- `mimetype` 검증
- `META-INF/container.xml` 파싱
- OPF 위치 찾기
- manifest, spine, nav/toc 파싱
- XHTML text block extraction
- inline markup Level 1 placeholder 처리
- dummy translation 적용
- EPUB packaging
- `roundtrip_report.json` 생성

핵심 제약:

- `mimetype`은 zip 첫 entry이며 무압축이어야 한다.
- CSS, 이미지, 폰트, metadata를 보존한다.
- XHTML namespace를 유지한다.
- 변경된 파일과 변경 사유를 report에 기록한다.

---

### 3.4 `packages/translator-core`

번역 job orchestration을 담당한다.

주요 책임:

- job 생성
- segment queue 생성
- cache lookup
- context builder 호출
- provider 호출
- structured JSON parsing
- retry/backoff
- pause/resume/cancel
- progress event 발행
- provider usage 기록

---

### 3.5 `packages/vertex-provider`

Vertex AI Gemini 호출을 담당한다.

주요 책임:

- provider config 검증
- structured output 요청
- usage/token/cost 추출
- 오류 타입 분류
- retry 가능 여부 판단

오류 분류:

- `rate_limit`
- `network_timeout`
- `schema_validation_failed`
- `safety_block`
- `auth_failed`
- `quota_exceeded`
- `unknown`

---

### 3.6 `packages/glossary-core`

용어집 관리와 glossary hit detection을 담당한다.

MVP 책임:

- CSV import/export
- CRUD
- source text에서 glossary hit 탐지
- prompt injection용 glossary payload 생성
- forbidden term, mismatch QA 생성

---

### 3.7 `packages/tm-core`

Translation Memory 저장과 검색을 담당한다.

초기 책임:

- 수동 TM 등록
- exact hash 검색
- 간단한 fuzzy 검색
- grade 관리
- prompt 삽입용 TM match 생성

Post-MVP 책임:

- embedding similarity 검색
- reference, silver, gold_candidate, gold 등급 운영
- TMX import/export

---

### 3.8 `packages/qa-core`

번역 결과의 자동 QA를 담당한다.

MVP 검사:

- untranslated text
- glossary mismatch
- forbidden term
- number mismatch
- suspicious empty translation
- schema response warning

Post-MVP 검사:

- missing text
- name inconsistency
- quote mismatch
- paragraph count mismatch
- honorific warning
- suspicious expansion/compression

---

### 3.9 `packages/embedding-core`

Post-MVP에서 다국어 임베딩 생성과 cache를 담당한다.

주요 책임:

- `EmbeddingService` 인터페이스
- 로컬 모델 adapter
- 외부 임베딩 adapter
- `embedding_cache.sqlite`
- text hash + model id 기반 cache
- chapter summary embedding
- cosine similarity

---

### 3.10 `packages/aligner`

Post-MVP에서 영한 alignment를 담당한다.

주요 책임:

- Text Section normalization 결과 사용
- body start candidate 처리
- chapter candidate filtering
- LLM Alignment Judge 호출
- monotonic sequence DP
- paragraph similarity matrix
- auxiliary signal scoring
- low-confidence window 재검증
- approved alignment to TM

---

### 3.11 `packages/export-core`

EPUB, TXT, CSV, TMX, report export를 담당한다.

MVP 책임:

- draft/reviewed/final EPUB 생성
- TXT export
- manifest 생성
- EPUB validation 결과 저장

Post-MVP 책임:

- bilingual CSV export
- TMX export
- QA report HTML/Markdown export

---

## 4. 단계별 구현 계획

## 4.1 Milestone 0: 프로젝트 기반

목표: 앱을 실행하고 프로젝트 workspace를 만들 수 있는 최소 기반을 만든다.

### 포함 범위

- pnpm monorepo 생성
- Electron + React + TypeScript 세팅
- 기본 라우팅
- SQLite 연결
- workspace 생성
- Project Selector
- Project Wizard
- Project Home 뼈대
- Settings 뼈대
- 파일 선택과 drag-and-drop 기반 import 준비

### 주요 작업

```text
[Repo]
- pnpm workspace 초기화
- apps/desktop 생성
- packages/common, db-core 생성
- eslint, prettier, tsconfig, path alias 설정

[Electron]
- main, preload, renderer 분리
- contextIsolation 활성화
- IPC bridge 설계
- 앱 데이터 디렉터리 결정

[DB]
- migration runner 구현
- project.sqlite 생성
- projects, books 기본 테이블 생성

[UI]
- Welcome / Onboarding
- Project Selector
- Project Wizard
- Project Home skeleton
- 공통 Layout, Header, Sidebar
- 상태 배지, progress bar, toast
```

### 완료 기준

- 앱을 실행할 수 있다.
- 새 프로젝트를 만들고 workspace가 생성된다.
- 프로젝트 목록에 프로젝트가 표시된다.
- 프로젝트를 열면 Project Home으로 이동한다.
- 앱 재시작 후에도 프로젝트 목록이 유지된다.

---

## 4.2 Milestone 1: MVP-0 EPUB round-trip

목표: 번역 API 없이 EPUB를 안전하게 import, unpack, rebuild할 수 있음을 검증한다.

### 포함 범위

- Book List
- Book Import Wizard
- Book Detail
- EPUB import
- OPF/spine/nav 분석
- XHTML text block extraction
- dummy translation 또는 marker 삽입
- EPUB rebuild
- roundtrip report 생성
- roundtrip output 저장

### 주요 작업

```text
[DB]
- books
- source_documents
- document_items
- text_sections
- text_blocks
- manifests

[epub-core]
- unzipEpub(filePath)
- parseContainerXml()
- parseOpf()
- parseManifest()
- parseSpine()
- parseNav()
- extractXhtmlItems()
- extractTextBlocks()
- applyDummyTranslation()
- rebuildEpub()
- validateRoundTrip()
- generateRoundtripReport()

[UI]
- Book List
- Book Import Wizard Step 1: 영어 EPUB import
- Book Detail
- Round-trip Job Monitor
- Roundtrip Report Viewer
```

### 구현 세부

#### EPUB import 흐름

```text
1. 사용자가 EPUB를 drag-and-drop
2. 파일 hash 계산
3. workspace/source/en/에 원본 복사
4. temporary unpack directory 생성
5. container.xml 파싱
6. OPF 파싱
7. manifest, spine, nav/toc 파싱
8. document_items 저장
9. XHTML에서 text_sections와 text_blocks 생성
10. import manifest 저장
```

#### round-trip rebuild 흐름

```text
1. unpack workspace 복사
2. dummy translation marker 적용
3. 변경 파일 목록 계산
4. mimetype을 첫 entry, store 방식으로 zip
5. 나머지 파일 zip
6. EPUB validation 수행
7. roundtrip_report.json 저장
```

### 완료 기준

- EPUB 1권을 import할 수 있다.
- XHTML text block이 DB에 저장된다.
- dummy translation EPUB가 생성된다.
- `mimetype` entry가 zip 첫 번째이며 무압축이다.
- CSS, 이미지, 폰트 asset 누락이 없다.
- OPF spine 순서가 유지된다.
- `roundtrip_report.json`이 생성된다.

---

## 4.3 Milestone 2: MVP-1 실제 번역 실행

목표: Vertex AI provider를 붙여 영어 EPUB 1권을 한국어 draft EPUB로 번역한다.

### 포함 범위

- Vertex AI provider
- 기본 번역 prompt
- structured JSON response parsing
- translation job
- translation cache
- retry/backoff
- pause/resume
- Translation Setup
- Translation Job Monitor
- draft EPUB export
- draft TXT export

### 주요 작업

```text
[DB]
- prompt_templates
- translation_jobs
- translation_segments
- provider_usage
- qa_issues

[translator-core]
- createTranslationJob()
- buildSegmentQueue()
- buildTranslationContext()
- runTranslationJob()
- pauseJob()
- resumeJob()
- cancelJob()
- handleProviderError()
- parseTranslationResponse()
- saveSegmentResult()

[vertex-provider]
- validateConfig()
- translateSegment()
- estimateUsage()
- classifyError()

[UI]
- Providers & API Keys
- Translation Setup
- Translation Job Monitor
- job progress event subscription
- 오류 segment 재시도 UI
```

### 번역 job 상태

```text
pending → running → paused → running → completed
pending → running → failed
running → cancelled
```

### segment 상태

```text
pending → translating → translated
translating → error → translating
translated → needs_review
```

### cache key 구성

```text
source_text_hash
provider
model
prompt_template_version
glossary_version
stylebook_version
tm_context_hash
translation_options_hash
```

MVP-1에서는 glossary, stylebook, TM이 없을 수 있으므로 해당 version 값은 `none`으로 둔다.

### 완료 기준

- 영어 EPUB 1권을 입력하면 draft EPUB가 생성된다.
- 작업 중단 후 재실행하면 완료된 segment를 재사용한다.
- provider 오류가 segment 단위로 저장된다.
- rate limit, timeout은 자동 재시도된다.
- schema 오류는 repair 1회 후 실패하면 `needs_review` 또는 `error`가 된다.
- Job Monitor에서 진행률, 호출 수, token usage, 비용을 볼 수 있다.

---

## 4.4 Milestone 3: MVP-2 최소 감수

목표: 생성된 번역문을 사람이 segment 단위로 수정하고 final_translation으로 저장할 수 있게 한다.

### 포함 범위

- Minimal Review Studio 2-pane
- segment list
- source text / translation editor
- save
- approve and next
- reviewed_translation, final_translation 저장
- reviewed EPUB export
- final EPUB export

### 주요 작업

```text
[DB]
- translation_segments에 reviewed_translation, final_translation 사용
- status: translated, needs_review, reviewed, approved

[UI]
- Minimal Review Studio
- segment list
- filter: 전체, 미승인, QA 있음, error
- source panel
- translation editor
- action bar
- keyboard shortcuts
- autosave or explicit save
```

### 단축키

```text
Ctrl+Enter: 승인하고 다음
Ctrl+S: 저장
Alt+Left: 이전 segment
Alt+Right: 다음 segment
Ctrl+R: 현재 segment 재번역
```

### 완료 기준

- 사용자가 segment 번역문을 수정할 수 있다.
- 저장 시 `reviewed_translation`이 저장된다.
- 승인 시 `final_translation`이 저장되고 segment 상태가 `approved`가 된다.
- 승인된 segment를 기반으로 final EPUB를 export할 수 있다.
- 승인되지 않은 segment가 있을 때 export 경고가 표시된다.

---

## 4.5 Milestone 4: MVP-3 Glossary

목표: 고유명사와 반복 용어를 glossary로 관리하고 번역 prompt와 QA에 반영한다.

### 포함 범위

- glossary_terms table
- Glossary 화면
- CSV import/export
- glossary hit detection
- prompt injection
- glossary mismatch QA
- forbidden term QA
- 간단한 glossary editor

### 주요 작업

```text
[DB]
- glossary_terms

[glossary-core]
- importGlossaryCsv()
- exportGlossaryCsv()
- createGlossaryTerm()
- updateGlossaryTerm()
- deleteGlossaryTerm()
- findGlossaryHits()
- buildGlossaryPromptBlock()
- detectGlossaryMismatch()
- detectForbiddenTerms()

[translator-core]
- buildTranslationContext()에 glossaryHits 추가
- cache key에 glossary_version 반영

[qa-core]
- glossary_mismatch
- forbidden_term

[UI]
- Glossary list
- Glossary drawer editor
- CSV import/export
- needs_review filter
- Review Studio에서 선택어 glossary 등록
```

### CSV 포맷

```csv
source_term,canonical_ko,category,aliases,forbidden_targets,notes,confidence,do_not_translate
Barrayar,바라야,place,"Barrayaran","바라야르",행성명,gold,false
Vor,보르,culture,"Vor caste;Vor class","볼;보어",귀족 계층,gold,false
```

### 완료 기준

- CSV로 glossary를 가져올 수 있다.
- glossary hit가 translation prompt에 들어간다.
- glossary와 다른 번역어가 나오면 QA warning이 생성된다.
- forbidden target이 나오면 QA warning 또는 error가 생성된다.
- glossary 변경 후 같은 segment 재번역 시 cache miss가 발생한다.

---

## 4.6 Milestone 5: TM 수동 등록과 검색

목표: 사용자가 승인한 번역문을 TM에 등록하고, 이후 번역 context로 재사용한다.

### 포함 범위

- tm_units table
- Review Studio에서 TM 등록
- TM Manager
- exact hash search
- fuzzy search
- prompt TM insertion
- TM grade 관리

### 주요 작업

```text
[tm-core]
- addTmUnit()
- updateTmUnit()
- rejectTmUnit()
- promoteToGold()
- searchTm()
- buildTmPromptBlock()

[translator-core]
- buildTranslationContext()에 tmMatches 추가
- cache key에 tm_context_hash 반영

[UI]
- TM Manager
- Review Studio: 현재 segment TM 등록
- TM 검색
- grade filter
```

### 완료 기준

- 승인된 final_translation을 gold TM으로 등록할 수 있다.
- 동일하거나 유사한 문장이 번역될 때 TM match가 prompt에 삽입된다.
- TM Manager에서 검색, 수정, reject가 가능하다.

---

## 4.7 Milestone 6: Review Studio 고도화

목표: MVP-2의 2-pane 감수 화면을 실제 장편 번역 감수용 3-pane 또는 4-pane 화면으로 확장한다.

### 포함 범위

- 3-pane Review Studio
- reference 패널 placeholder
- TM 추천 side panel
- Glossary hit panel
- QA issue panel
- Character panel placeholder
- diff 또는 compact view
- segment filter 고도화

### 주요 작업

```text
[UI]
- Review Studio layout
- resizable panes
- collapsible side panel
- reference tab structure
- TM panel
- Glossary panel
- QA panel
- keyboard shortcut help
```

### 완료 기준

- 원문, AI 번역, 최종 감수문을 동시에 볼 수 있다.
- reference가 있으면 reference 탭을 표시할 수 있다.
- QA issue에서 해당 segment로 이동할 수 있다.
- TM, Glossary hit를 side panel에서 볼 수 있다.

---

## 4.8 Milestone 7: Embedding Service

목표: 영한 alignment의 기반이 되는 다국어 임베딩 생성과 cache를 구현한다.

### 포함 범위

- bilingual document import
- Text Section normalization 개선
- Body Start Detector
- EmbeddingService 인터페이스
- local model adapter
- external embedding adapter
- embedding_cache.sqlite
- cache hit/miss
- chapter summary embedding
- Embedding Models 설정 화면

### 주요 작업

```text
[embedding-core]
- EmbeddingService interface
- getEmbeddingService()
- embedTexts()
- embedChapterSummary()
- similarity()
- bulkEmbedTextBlocks()
- embedding cache repository

[DB]
- embeddings table 또는 별도 embedding_cache.sqlite schema
- text_hash + model_id + model_version index

[UI]
- Embedding Models settings
- external embedding 전환 시 추가 확인
- embedding progress screen
- cache hit ratio 표시
```

### 완료 기준

- 영어와 한국어 text block 임베딩을 생성할 수 있다.
- 같은 텍스트와 같은 모델로 재실행 시 cache hit가 발생한다.
- 모델 버전이 바뀌면 새 cache row가 생성된다.
- 외부 임베딩 모델 사용 시 전송 범위 확인 UI가 표시된다.

---

## 4.9 Milestone 8: Chapter Alignment

목표: 영한 EPUB의 챕터 매핑 후보를 생성하고 사용자가 명시적으로 확정할 수 있게 한다.

### 포함 범위

- chapter_alignments table
- chapter candidate filtering
- chapter summary embedding similarity
- LLM Alignment Judge
- judge_cache.sqlite
- monotonic sequence DP
- Chapter Alignment Review UI
- 사용자 분할, 병합, 제외, 확정

### 주요 작업

```text
[aligner]
- buildChapterCandidates()
- scoreChapterCandidates()
- callChapterAlignmentJudge()
- cacheJudgeResponse()
- optimizeChapterMapping()
- saveChapterAlignmentProposals()
- confirmChapterAlignments()

[DB]
- chapter_alignments

[UI]
- Alignment Overview
- Preprocessing & Body Start
- Chapter Alignment Review
- Chapter Mapping drawer
- confidence filter
- mapping type badge
- cost/call count display
```

### 완료 기준

- 영문 챕터와 한국어 챕터 후보를 top-K로 좁힐 수 있다.
- LLM Judge가 챕터 매핑 confidence와 rationale을 JSON으로 반환한다.
- 사용자 확정 전에는 paragraph alignment로 진행할 수 없다.
- 1:1, 1:N, N:1, N:M, 1:0, 0:1 매핑을 저장할 수 있다.
- 확정된 mapping만 status `approved`, user_confirmed `1`이 된다.

---

## 4.10 Milestone 9: Paragraph Alignment

목표: 확정된 chapter alignment 내부에서 문단 정렬을 수행하고 approved alignment를 reference TM으로 등록한다.

### 포함 범위

- alignments table
- paragraph similarity matrix
- auxiliary signal scoring
- DP alignment
- low-confidence window detection
- paragraph LLM Judge
- Paragraph Alignment Review UI
- approved alignment to TM

### 주요 작업

```text
[aligner]
- buildParagraphSimilarityMatrix()
- extractAuxiliarySignals()
- scoreParagraphPair()
- runParagraphDp()
- detectLowConfidenceWindows()
- callParagraphAlignmentJudge()
- saveAlignmentProposals()
- approveAlignment()
- rejectAlignment()
- splitAlignment()
- mergeAlignment()
- registerApprovedAlignmentToTm()

[DB]
- alignments
- tm_units에 alignment_id 연결

[UI]
- Paragraph Alignment Review
- LLM Judge Review Drawer
- filter: 낮은 confidence, LLM 재검증됨, 승인 대기, 승인됨
- approve, reject, split, merge
```

### 완료 기준

- 확정된 chapter alignment 내부에서만 paragraph alignment가 실행된다.
- 1:1, 1:2, 2:1, 2:2, 1:0, 0:1 정렬을 저장할 수 있다.
- confidence 0.85 이상은 일괄 승인 추천 후보로 표시된다.
- 낮은 confidence window만 LLM Judge에 보낼 수 있다.
- approved alignment가 reference TM으로 등록된다.
- chapter alignment가 되돌려지면 연결된 paragraph alignment가 stale 처리된다.

---

## 4.11 Milestone 10: Multi-reference 통합

목표: 동일 권에 여러 한국어 reference를 등록하고 reference별 alignment와 TM을 분리 관리한다.

### 포함 범위

- Book Import Wizard reference N개 입력
- source_documents에 translator, publisher, publication_year, edition_label 저장
- reference별 alignment 실행
- reference별 TM metadata 보존
- Review Studio reference tab
- glossary 후보에서 역자별 음차 충돌 표시

### 주요 작업

```text
[DB]
- source_documents role=reference_translation N개 허용
- tm_units에 source_document_id 또는 reference metadata 추가 검토
- alignments reference 구분 강화

[UI]
- Book Import Wizard Step 2 다중 reference
- Book Detail reference list
- Alignment Overview reference selector
- Review Studio reference tabs
- Reference conflict panel
```

### 완료 기준

- 한 책에 reference_translation을 2개 이상 등록할 수 있다.
- 각 reference는 독립적으로 alignment status를 가진다.
- 영어 임베딩은 reference별로 중복 계산하지 않고 cache를 재사용한다.
- TM 검색 결과에 역자, 출판사, 판본 정보가 표시된다.
- Review Studio에서 역자별 reference를 탭으로 전환할 수 있다.

---

## 4.12 Milestone 11: AI Editorial Engine

목표: AI 번역, 여러 reference, TM, glossary, stylebook을 비교하여 AI 편집장 감수문을 생성한다.

### 포함 범위

- AI Editorial prompt
- editorial job
- editorial result schema
- used_reference_parts
- reference_conflicts
- editorial_confidence
- gold_candidate TM 등록
- AI Editorial Result 화면
- spoiler-safe mode 기초

### 주요 작업

```text
[translator-core 또는 editorial-core]
- createEditorialJob()
- buildEditorialContext()
- callEditorialProvider()
- parseEditorialResponse()
- saveEditorialTranslation()
- promoteGoldCandidate()
- createReferenceConflictIssues()

[DB]
- translation_segments에 editorial_translation 추가 검토
- editorial response JSON 저장
- tm_units grade=gold_candidate

[UI]
- AI Editorial Result
- Review Studio AI Editorial panel
- Spoiler-safe Progress
- 본문 노출 확인 flow
```

### 완료 기준

- AI 편집장이 segment별 editorial_translation을 생성한다.
- 어떤 reference 표현을 차용했는지 JSON으로 저장된다.
- confidence가 높은 결과는 gold_candidate TM으로 등록된다.
- confidence가 낮은 결과는 needs_review 상태가 된다.
- spoiler-safe mode에서는 본문이 표시되지 않는다.

---

## 4.13 Milestone 12: Series Memory 고도화

목표: 장편 시리즈의 장기 일관성을 위해 character profile, stylebook, chapter summary memory를 붙인다.

### 포함 범위

- character_profiles table
- stylebook_entries 또는 stylebook markdown
- Character Profiles 화면
- Stylebook editor
- chapter summary memory
- prompt context builder 개선
- cross-chapter term memory

### 주요 작업

```text
[DB]
- character_profiles
- stylebook_entries
- chapter_summaries 검토

[UI]
- Character Profiles
- Stylebook markdown editor
- version history
- Review Studio character panel

[translator-core]
- buildCharacterContext()
- buildStylebookSummary()
- buildChapterMemoryContext()
```

### 완료 기준

- character profile이 번역 context에 삽입된다.
- stylebook summary가 prompt에 삽입된다.
- 사용자가 stylebook을 편집할 수 있다.
- 캐릭터별 호칭 규칙을 관리할 수 있다.

---

## 5. 화면 구현 순서

UI/UX 구현 순서는 다음과 같이 잡는다.

```text
1. App Shell
   - Header
   - Sidebar
   - Breadcrumb
   - Toast
   - Dialog
   - Drawer
   - ProgressBar
   - StatusBadge

2. Welcome / Onboarding
   - workspace 위치
   - provider 설정 placeholder
   - 외부 전송 정책 1회 동의

3. Project Selector / Project Wizard / Project Home

4. Books
   - Book List
   - Book Import Wizard
   - Book Detail

5. MVP-0 Round-trip
   - Round-trip progress
   - Report Viewer

6. Translation
   - Translation Setup
   - Translation Job Monitor

7. Minimal Review Studio
   - 2-pane editor
   - segment navigation
   - approve workflow

8. Export
   - draft/reviewed/final export
   - validation result

9. Glossary
   - list
   - drawer editor
   - CSV import/export

10. TM Manager

11. Alignment
   - Overview
   - Body Start
   - Chapter Alignment Review
   - Paragraph Alignment Review
   - Judge drawer

12. Review Studio 고도화
   - 3-pane/4-pane
   - reference tabs
   - TM/Glossary/QA side panels

13. AI Editorial / Spoiler-safe

14. Character / Stylebook / Cost & Usage
```

---

## 6. 데이터베이스 migration 계획

### 6.1 Migration 001: Project Base

- `projects`
- `books`
- `source_documents`
- `manifests`

### 6.2 Migration 002: EPUB Core

- `document_items`
- `text_sections`
- `logical_chapters`
- `text_blocks`

### 6.3 Migration 003: Translation Job

- `prompt_templates`
- `translation_jobs`
- `translation_segments`
- `provider_usage`
- `qa_issues`

### 6.4 Migration 004: Glossary

- `glossary_terms`
- glossary version metadata 추가

### 6.5 Migration 005: TM

- `tm_units`
- `idx_tm_project_grade`
- `idx_tm_source_hash`

### 6.6 Migration 006: Embeddings

- `embeddings` 또는 별도 `embedding_cache.sqlite`
- `idx_emb_hash_model`
- `idx_emb_scope_ref`

### 6.7 Migration 007: Alignment

- `chapter_alignments`
- `alignments`
- stale 처리용 index

### 6.8 Migration 008: Series Memory

- `character_profiles`
- `stylebook_entries`
- chapter summaries 테이블 검토

---

## 7. IPC 설계 초안

Renderer는 파일 시스템과 DB에 직접 접근하지 않는다. 모든 접근은 preload bridge를 통해 main process로 보낸다.

```ts
window.sts = {
  projects: {
    list(): Promise<ProjectSummary[]>;
    create(input: CreateProjectInput): Promise<Project>;
    open(projectId: string): Promise<Project>;
  },

  books: {
    list(projectId: string): Promise<BookSummary[]>;
    importEpub(input: ImportEpubInput): Promise<BookImportResult>;
    get(bookId: string): Promise<BookDetail>;
  },

  translation: {
    createJob(input: CreateTranslationJobInput): Promise<TranslationJob>;
    start(jobId: string): Promise<void>;
    pause(jobId: string): Promise<void>;
    resume(jobId: string): Promise<void>;
    retrySegment(segmentId: string): Promise<void>;
    onProgress(callback: (event: JobProgressEvent) => void): Unsubscribe;
  },

  review: {
    getSegment(input: GetSegmentInput): Promise<ReviewSegment>;
    saveSegment(input: SaveSegmentInput): Promise<void>;
    approveSegment(segmentId: string): Promise<void>;
  },

  glossary: {
    list(projectId: string): Promise<GlossaryTerm[]>;
    create(input: CreateGlossaryTermInput): Promise<GlossaryTerm>;
    update(input: UpdateGlossaryTermInput): Promise<GlossaryTerm>;
    importCsv(filePath: string): Promise<ImportResult>;
    exportCsv(projectId: string): Promise<string>;
  },

  export: {
    exportEpub(input: ExportEpubInput): Promise<ExportResult>;
  }
};
```

Post-MVP에서 추가:

```ts
window.sts.alignment = {
  startPreprocessing(input: AlignmentPreprocessInput): Promise<Job>;
  buildChapterAlignments(input: ChapterAlignmentInput): Promise<Job>;
  confirmChapterAlignments(input: ConfirmChapterAlignmentsInput): Promise<void>;
  alignParagraphs(input: ParagraphAlignmentInput): Promise<Job>;
};

window.sts.tm = {
  search(input: TmSearchInput): Promise<TmMatch[]>;
  add(input: AddTmUnitInput): Promise<TmUnit>;
};
```

---

## 8. Job System 구현 계획

### 8.1 공통 Job Runner

모든 긴 작업은 job runner를 통해 실행한다.

대상 작업:

- EPUB import
- round-trip rebuild
- translation
- export
- embedding
- chapter alignment
- paragraph alignment
- AI editorial

### 8.2 Job Runner 요구사항

- job status persistence
- segment 또는 step 단위 checkpoint
- pause request 처리
- cancel request 처리
- retry policy
- progress event
- error aggregation
- crash recovery

### 8.3 Job event 예시

```ts
type JobProgressEvent = {
  jobId: string;
  type: "progress" | "segment_done" | "warning" | "error" | "completed";
  current: number;
  total: number;
  message?: string;
  costUsd?: number;
  payload?: unknown;
};
```

### 8.4 Crash recovery

앱 시작 시 `translation_jobs.status in ('running', 'paused')`를 조회한다.

```text
- running 상태였던 job은 crashed로 표시하지 않고 paused로 전환한다.
- 사용자에게 "이전 세션에서 중단된 작업이 있습니다. 재개하시겠습니까?"를 표시한다.
- 재개 시 completed segment를 cache와 DB에서 확인하고 나머지만 실행한다.
```

---

## 9. Prompt와 schema 관리

### 9.1 prompt template versioning

모든 prompt는 DB의 `prompt_templates`에 version과 함께 저장한다.

scope:

- `translation`
- `alignment_chapter_judge`
- `alignment_paragraph_judge`
- `ai_editorial`
- `qa`

### 9.2 translation response schema

```json
{
  "translation": "string",
  "used_terms": [
    {
      "source": "string",
      "target": "string",
      "source_type": "glossary | tm | inferred"
    }
  ],
  "uncertain_terms": [
    {
      "source": "string",
      "suggestion": "string",
      "reason": "string"
    }
  ],
  "qa_flags": [
    {
      "type": "string",
      "severity": "info | warning | error",
      "message": "string"
    }
  ],
  "notes": "string"
}
```

### 9.3 schema validation failure 처리

```text
1. JSON parse 시도
2. 실패 시 raw response 저장
3. repair prompt 1회 호출
4. repair 성공 시 저장
5. repair 실패 시 segment status=needs_review 또는 error
6. Review Studio에서 raw response 확인 가능
```

---

## 10. Testing 전략

### 10.1 Unit Test

대상:

- text normalization
- hash key generation
- EPUB path resolver
- OPF parser
- spine parser
- XHTML block extraction
- cache key generation
- glossary hit detection
- QA detector
- provider error classifier

### 10.2 Integration Test

대상:

- EPUB import to DB
- dummy translation to EPUB rebuild
- translation job with mock provider
- pause/resume
- glossary prompt injection
- final EPUB export

### 10.3 Fixture 전략

`samples/fixtures`에 소형 EPUB를 둔다.

필수 fixture:

```text
simple-book.epub
- chapter 2개
- p, h1, em, strong, a 포함
- 이미지 1개
- CSS 1개

split-chapter.epub
- 한 챕터가 XHTML 여러 파일에 나뉨

merged-chapter.epub
- 한 XHTML에 챕터 여러 개 포함

inline-markup.epub
- italic, link, nested inline 포함

nav-only.epub
- nav 문서가 있는 EPUB3

toc-ncx.epub
- toc.ncx가 있는 EPUB2
```

### 10.4 Golden Test

EPUB round-trip은 golden snapshot을 둔다.

검증 항목:

- zip entry 목록
- mimetype 위치와 compression
- OPF href 유지
- spine 순서 유지
- asset count 동일
- text block count 예상 범위
- roundtrip_report schema

### 10.5 Manual QA Checklist

MVP-0:

- EPUB import 성공
- dummy translation EPUB 열림
- 원본 이미지 표시
- 목차 이동 가능
- 특수문자 깨짐 없음

MVP-1:

- translation job 시작
- 중간 pause
- 앱 재시작 후 resume
- provider 오류 segment만 재시도
- draft EPUB 생성

MVP-2:

- segment 수정
- 승인하고 다음
- final EPUB export
- 미승인 segment 경고

MVP-3:

- glossary CSV import
- glossary hit prompt 반영
- mismatch QA 생성
- glossary 수정 후 재번역 cache miss

---

## 11. Definition of Done

### 11.1 기능 단위 DoD

- TypeScript type error가 없다.
- unit test가 통과한다.
- 주요 오류 케이스가 처리된다.
- job 작업이면 pause/resume/cancel 정책이 정의되어 있다.
- DB 변경이 있으면 migration과 rollback 전략이 있다.
- UI 화면이면 loading, empty, error 상태가 있다.
- 사용자 데이터가 손상되지 않도록 원본 파일을 직접 수정하지 않는다.
- README 또는 docs에 사용법이 갱신되어 있다.

### 11.2 Milestone DoD

각 milestone은 다음을 만족해야 완료로 본다.

- 샘플 EPUB fixture에서 end-to-end 시나리오가 통과한다.
- 실제 EPUB 1권으로 smoke test를 통과한다.
- workspace에 생성되는 파일 구조가 문서화되어 있다.
- 실패 시 복구 경로가 있다.
- 다음 milestone이 해당 산출물을 재사용할 수 있다.

---

## 12. 위험 요소와 대응

| 위험 | 설명 | 대응 |
|---|---|---|
| EPUB 구조 다양성 | EPUB마다 OPF, nav, XHTML 구조가 다름 | fixture를 다양하게 만들고 round-trip부터 안정화 |
| inline markup 손상 | 번역 중 `<em>`, `<a>`, footnote가 깨질 수 있음 | MVP는 Level 1 placeholder 보존, Level 2는 Post-MVP |
| provider 비용 증가 | 장편 번역 호출 수가 많음 | cache, segment resume, 비용 표시, 일부 챕터 테스트 실행 |
| JSON schema 실패 | LLM 응답이 schema를 어길 수 있음 | repair 1회, raw response 저장, needs_review 처리 |
| resume 불안정 | 앱 종료 후 job 상태가 꼬일 수 있음 | segment 단위 checkpoint, 시작 시 running job을 paused로 전환 |
| glossary 무시 | 모델이 glossary를 따르지 않을 수 있음 | prompt injection + mismatch QA |
| alignment 비용 폭증 | LLM Judge 호출이 많아질 수 있음 | 임베딩 top-K 필터, low-confidence window만 Judge 호출 |
| DB migration 실패 | 로컬 데이터 손상 위험 | migration 전 자동 backup |
| 대용량 EPUB 성능 | 문단 수가 많으면 UI가 느려질 수 있음 | virtualized list, streaming progress, batch DB insert |

---

## 13. 개발 순서 요약

```text
Phase A. 기반
1. monorepo + Electron + React + SQLite
2. Project / Workspace
3. App shell

Phase B. EPUB MVP
4. EPUB import
5. text block extraction
6. dummy translation
7. EPUB rebuild
8. roundtrip report

Phase C. Translation MVP
9. Vertex provider
10. prompt template
11. translation job
12. cache/resume
13. draft EPUB/TXT export

Phase D. Review MVP
14. Minimal Review Studio
15. final/reviewed export
16. QA 기초

Phase E. Glossary/TM
17. Glossary CSV + prompt injection
18. glossary mismatch QA
19. TM 수동 등록
20. TM 검색 + prompt insertion

Phase F. Alignment
21. Embedding cache
22. Body Start Detector
23. Chapter Alignment
24. Paragraph Alignment
25. reference TM 자동 등록

Phase G. Advanced
26. Multi-reference
27. AI Editorial
28. spoiler-safe mode
29. Character profiles
30. Stylebook
```

---

## 14. 초기 Sprint 제안

### Sprint 1: 앱 골격과 프로젝트 생성

목표:

- 앱 실행
- 프로젝트 생성
- workspace 생성
- DB migration

작업:

```text
- pnpm workspace 구성
- Electron main/preload/renderer 구성
- React Router 구성
- db-core migration runner
- Project Selector
- Project Wizard
- Project Home skeleton
```

완료 산출물:

```text
앱을 켜고 새 프로젝트를 만들 수 있다.
```

---

### Sprint 2: EPUB import

목표:

- EPUB를 프로젝트에 추가하고 구조를 DB에 저장한다.

작업:

```text
- Book List
- Book Import Wizard Step 1
- EPUB unzip
- container.xml parser
- OPF parser
- manifest/spine parser
- document_items 저장
- 원본 파일 workspace 복사
```

완료 산출물:

```text
EPUB 1권을 import하고 spine/item 정보를 볼 수 있다.
```

---

### Sprint 3: Text Block extraction

목표:

- XHTML에서 번역 대상 block을 추출한다.

작업:

```text
- XHTML parser
- text_sections 생성
- text_blocks 생성
- block role 분류
- scene_break/noise 처리
- Book Detail에 block count 표시
```

완료 산출물:

```text
EPUB의 본문 text block이 DB에 저장된다.
```

---

### Sprint 4: Round-trip rebuild

목표:

- dummy translation EPUB를 생성한다.

작업:

```text
- dummy translation 적용
- XHTML rebuild
- EPUB zip packaging
- mimetype 첫 entry 무압축 처리
- roundtrip_report.json 생성
- Report Viewer
```

완료 산출물:

```text
roundtrip.epub와 roundtrip_report.json이 생성된다.
```

---

### Sprint 5: Translation provider

목표:

- mock provider와 Vertex provider의 provider interface를 완성한다.

작업:

```text
- TranslationProvider interface
- Mock provider
- Vertex provider config
- structured JSON parser
- provider error classifier
- prompt template 저장
```

완료 산출물:

```text
Mock provider로 segment 번역 결과를 저장할 수 있다.
```

---

### Sprint 6: Translation job

목표:

- 실제 translation job을 실행하고 resume한다.

작업:

```text
- translation_jobs
- translation_segments
- job runner
- progress event
- cache key
- pause/resume
- Translation Setup
- Translation Job Monitor
```

완료 산출물:

```text
EPUB 1권을 segment 단위로 번역하고 중단 후 재개할 수 있다.
```

---

### Sprint 7: Draft export

목표:

- 번역 결과로 draft EPUB/TXT를 생성한다.

작업:

```text
- translated XHTML rebuild
- draft EPUB export
- TXT export
- export manifest
- validation result 표시
```

완료 산출물:

```text
translated.draft.epub와 translated.draft.txt가 생성된다.
```

---

### Sprint 8: Minimal Review

목표:

- 최소 감수 UI에서 segment를 수정하고 승인한다.

작업:

```text
- Minimal Review Studio
- segment navigation
- save reviewed_translation
- approve final_translation
- reviewed/final export
```

완료 산출물:

```text
사용자가 감수한 final EPUB를 생성할 수 있다.
```

---

## 15. 첫 구현 시 바로 만들 파일 목록

```text
package.json
pnpm-workspace.yaml
tsconfig.base.json
.eslintrc.cjs
.prettierrc

apps/desktop/package.json
apps/desktop/src-main/main.ts
apps/desktop/src-main/ipc/index.ts
apps/desktop/src-main/db/openProjectDb.ts
apps/desktop/src-preload/index.ts
apps/desktop/src-renderer/app/App.tsx
apps/desktop/src-renderer/app/router.tsx
apps/desktop/src-renderer/components/layout/AppLayout.tsx
apps/desktop/src-renderer/components/common/StatusBadge.tsx
apps/desktop/src-renderer/components/common/ProgressBar.tsx

packages/common/src/index.ts
packages/common/src/types/project.ts
packages/common/src/types/book.ts
packages/common/src/types/epub.ts
packages/common/src/types/job.ts
packages/common/src/utils/hash.ts
packages/common/src/utils/result.ts

packages/db-core/src/index.ts
packages/db-core/src/migrations/index.ts
packages/db-core/src/migrations/001_project_base.sql

packages/epub-core/src/index.ts
packages/epub-core/src/unzipEpub.ts
packages/epub-core/src/parseContainerXml.ts
packages/epub-core/src/parseOpf.ts
packages/epub-core/src/extractTextBlocks.ts
packages/epub-core/src/rebuildEpub.ts
packages/epub-core/src/roundtripReport.ts
```

---

## 16. MVP 완료 기준

MVP는 MVP-0부터 MVP-3까지 완료된 상태를 말한다.

### 필수 기능

- 프로젝트 생성
- 영어 EPUB import
- EPUB round-trip
- 실제 번역 실행
- translation cache/resume
- draft EPUB/TXT export
- 최소 감수
- final EPUB export
- glossary CSV import/export
- glossary prompt injection
- glossary mismatch QA

### 필수 산출물

```text
roundtrip.epub
roundtrip_report.json
translated.draft.epub
translated.draft.txt
translated.reviewed.epub
translated.final.epub
translation_job.sqlite 또는 project.sqlite
manifest.json
series.glossary.csv
```

### MVP에서 하지 않는 것

- 자동 alignment
- Embedding Service
- Chapter Alignment LLM Judge
- Paragraph Alignment
- TM 자동 구축
- AI Editorial
- spoiler-safe mode
- Character Memory
- Stylebook 자동 생성
- Cost & Usage 월별 차트
- PDF/OCR
- MOBI/AZW3
- 모바일 앱

---

## 17. 결론

가장 중요한 첫 단추는 번역 품질이 아니라 EPUB 구조 보존이다. STS의 모든 고급 기능은 원본 EPUB를 안전하게 import하고, text block을 추출하고, 다시 EPUB로 봉합할 수 있다는 전제 위에 올라간다.

따라서 구현은 다음의 작은 검증 루프를 반복한다.

```text
EPUB import
→ text block extraction
→ dummy or real translation
→ rebuild
→ validation
→ report
→ review
→ export
```

이 루프가 안정화된 뒤 glossary, TM, embedding, alignment, AI Editorial을 얹으면, 초반부터 실제로 읽을 수 있는 결과물을 확보하면서도 장기적으로는 시리즈 전체 일관성을 관리하는 번역 스튜디오로 확장할 수 있다.
