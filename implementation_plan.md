# Series Translation Studio Implementation Plan

버전: v2.0  
기준 문서: `Series Translation Studio 기획 및 시스템 설계서` 개정판  
핵심 변경: Phase 2를 **사용자 수동 선감수**가 아니라 **AI 편집장 감수 + spoiler-safe EPUB 생성 + 완독 후 사후 보정** 구조로 재설계한다.

---

## 0. 개발 원칙

### 0.1 제품 원칙

```text
사용자는 번역 생산자가 아니라 최종 독자다.
사용자가 읽기 전에 본문을 전부 감수해야 한다면 제품 목적과 충돌한다.
Phase 2의 감수 주체는 사용자가 아니라 AI 편집장이다.
사용자는 완성 EPUB를 독서한 뒤, 마음에 걸린 부분만 사후 보정한다.
```

### 0.2 기술 원칙

```text
1. 로컬 우선 데스크톱 앱으로 만든다.
2. 원본 EPUB 구조를 최대한 보존한다.
3. 모든 번역 작업은 중단 후 재개 가능해야 한다.
4. 모든 AI 호출 결과는 재현 가능하도록 prompt/config/hash를 저장한다.
5. glossary, TM, stylebook 변경은 버전으로 관리한다.
6. AI 편집장이 승인한 문장은 gold가 아니라 gold_candidate로 저장한다.
7. 사용자가 직접 수정하거나 명시 승인한 문장만 gold TM으로 확정한다.
8. spoiler-safe mode에서는 본문 원문/번역문을 UI에 노출하지 않는다.
```

### 0.3 초기 기술 스택

```text
Desktop: Electron + React + TypeScript
Runtime: Node.js
Package Manager: pnpm workspace
Database: SQLite
AI Provider: Vertex AI Gemini 우선
EPUB 처리: Node.js 기반 unzip/xml/html parser
UI State: Zustand 또는 Redux Toolkit
Job Queue: 로컬 job runner
Test: Vitest + Playwright
```

---

## 1. 전체 개발 단계 요약

```text
M0. Repository / 개발 환경 구축
M1. EPUB import / extract / rebuild MVP
M2. Vertex AI 번역 Job MVP
M3. Cache / Resume / Job Monitor
M4. Glossary Engine
M5. Basic Review Studio
M6. TM Engine
M7. Alignment Engine
M8. AI Editorial Engine
M9. Spoiler-safe Phase 2 Pipeline
M10. Post-read Correction / TM Promotion
M11. Series Memory / Stylebook 고도화
M12. Export / QA / Stabilization
```

권장 개발 순서는 다음과 같다.

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M8 → M9 → M10 → M7 → M11 → M12
```

주의: Alignment Engine은 중요하지만 초반 병목이 크다. 먼저 EPUB 번역/감수/AI 편집장 흐름을 만든 뒤 붙이는 편이 좋다.

---

## 2. Phase별 제품 구현 목표

## 2.1 Phase 0: 기본 EPUB 번역기 MVP

목표:

```text
영어 EPUB 하나를 입력하면 Vertex AI로 한국어 초벌 번역 EPUB를 생성한다.
```

포함 기능:

```text
- EPUB drag-and-drop
- EPUB unpack
- OPF / spine 분석
- XHTML text block 추출
- Vertex AI 번역
- structured JSON 응답 파싱
- SQLite segment 저장
- EPUB rebuild
- 중단 후 재개
```

제외 기능:

```text
- 기존 한국어판 비교
- TM 자동 구축
- AI 편집장 감수
- spoiler-safe mode
- 고급 QA
```

완료 기준:

```text
- EPUB 1권을 import할 수 있다.
- 챕터/문단 단위 text block을 추출할 수 있다.
- block 단위 번역 결과를 DB에 저장할 수 있다.
- 번역된 block을 원본 XHTML에 재삽입할 수 있다.
- 번역 EPUB를 생성할 수 있다.
- 작업 중단 후 완료된 segment를 재사용한다.
```

---

## 2.2 Phase 1: Gold Source 기반 TM / Glossary 구축

목표:

```text
신뢰할 수 있는 기존 번역권에서 gold급 TM, glossary, stylebook 초안을 구축한다.
```

포함 기능:

```text
- 영어 EPUB import
- 한국어 EPUB/TXT import
- 문서 구조 추출
- 챕터 rough matching
- 문단 alignment
- alignment confidence 표시
- 사람이 alignment pair 승인/거부
- 승인 pair를 gold TM으로 저장
- 용어 후보 추출
- glossary 편집
- stylebook 초안 생성
```

완료 기준:

```text
- 신뢰 가능한 기존 번역권에서 승인된 pair를 gold TM으로 저장할 수 있다.
- 주요 고유명사를 glossary에 등록할 수 있다.
- 이후 번역 job에서 TM/glossary를 context로 사용할 수 있다.
```

---

## 2.3 Phase 2: 기존 한국어판이 있는 권의 재번역 / AI 편집장 감수

목표:

```text
사용자가 본문을 미리 읽지 않아도, AI 편집장이 기존 번역/AI 번역/TM/glossary/stylebook을 비교 감수하고 EPUB를 생성한다.
```

핵심 흐름:

```text
1. 영어 EPUB import
2. 기존 한국어판 import
3. Phase 1 TM / glossary / stylebook 로드
4. AI 초벌 번역 생성
5. AI 편집장 감수 실행
6. AI 편집장이 최종 감수문 승인
7. 승인문을 gold_candidate TM으로 등록
8. spoiler-safe mode로 EPUB 생성
9. 사용자는 완성 EPUB를 처음부터 독서
10. 완독 후 어색한 문장만 사후 수정
11. 사용자 수정/명시 승인 문장을 gold TM으로 승격
```

중요 원칙:

```text
- 기존 한국어판은 reference이지 정답이 아니다.
- AI 초벌 번역도 정답이 아니다.
- AI 편집장은 두 번역과 TM/glossary/stylebook을 비교하여 editorial_translation을 만든다.
- AI 편집장이 승인한 문장은 gold_candidate다.
- gold_candidate는 gold보다 약하게 프롬프트에 반영한다.
- 사용자가 완독 후 수정/승인한 문장만 gold가 된다.
```

완료 기준:

```text
- 사용자가 본문을 미리 읽지 않고 Phase 2 EPUB를 생성할 수 있다.
- AI 편집장 감수 결과가 segment별로 저장된다.
- AI 편집장 승인문은 gold_candidate TM으로 등록된다.
- confidence가 낮은 문장은 needs_review 상태로 보류된다.
- 사용자가 완독 후 수정한 문장은 post_read_correction으로 저장된다.
- 사용자 수정/명시 승인 문장은 gold TM으로 승격된다.
```

---

## 2.4 Phase 3: 미발간권 본번역

목표:

```text
Phase 1~2에서 축적한 gold/gold_candidate TM, glossary, stylebook, character profile을 기반으로 미발간권을 번역한다.
```

포함 기능:

```text
- 시리즈 프로필 로드
- TM retrieval
- glossary retrieval
- stylebook retrieval
- character memory retrieval
- chapter summary memory
- AI 번역
- AI 편집장 자체 감수
- QA 검사
- EPUB export
- 완독 후 사후 수정
```

완료 기준:

```text
- 기존 한국어판 없이도 시리즈 자산 기반 번역이 가능하다.
- 주요 용어/호칭/말투 일관성 QA를 수행한다.
- 최종 EPUB를 생성한다.
- 독서 후 수정사항을 TM/glossary/stylebook에 반영할 수 있다.
```

---

## 3. Monorepo 구조

```text
series-translation-studio/
 ├─ apps/
 │   └─ desktop/
 │       ├─ src-main/
 │       │   ├─ ipc/
 │       │   ├─ jobs/
 │       │   ├─ db/
 │       │   └─ main.ts
 │       ├─ src-renderer/
 │       │   ├─ pages/
 │       │   ├─ components/
 │       │   ├─ stores/
 │       │   └─ App.tsx
 │       ├─ src-preload/
 │       │   └─ index.ts
 │       └─ package.json
 │
 ├─ packages/
 │   ├─ common/
 │   ├─ db-core/
 │   ├─ epub-core/
 │   ├─ translator-core/
 │   ├─ vertex-provider/
 │   ├─ glossary-core/
 │   ├─ tm-core/
 │   ├─ aligner/
 │   ├─ editorial-core/
 │   ├─ qa-core/
 │   ├─ stylebook-core/
 │   ├─ character-core/
 │   └─ export-core/
 │
 ├─ docs/
 │   ├─ prd.md
 │   ├─ architecture.md
 │   ├─ implementation_plan.md
 │   ├─ db_schema.md
 │   ├─ prompts.md
 │   └─ ai_editorial_engine.md
 │
 ├─ samples/
 ├─ scripts/
 ├─ tests/
 ├─ package.json
 ├─ pnpm-workspace.yaml
 └─ README.md
```

---

## 4. 패키지별 구현 계획

## 4.1 `packages/common`

역할:

```text
- 공통 타입
- enum
- error class
- utility function
- hash function
- result type
```

구현 항목:

```text
- [ ] ProjectId / BookId / SegmentId 타입 정의
- [ ] Result<T, E> 유틸 정의
- [ ] sha256 hash helper
- [ ] 날짜/경로 normalize helper
- [ ] 공통 error code 정의
```

주요 타입:

```ts
export type TmGrade =
  | 'gold'
  | 'gold_candidate'
  | 'silver'
  | 'reference'
  | 'rejected';

export type SegmentStatus =
  | 'pending'
  | 'translating'
  | 'translated'
  | 'editorial_pending'
  | 'editorial_approved'
  | 'needs_review'
  | 'post_read_corrected'
  | 'approved'
  | 'error';
```

---

## 4.2 `packages/db-core`

역할:

```text
- SQLite connection
- migration
- repository layer
- transaction helper
```

구현 항목:

```text
- [ ] SQLite connection manager
- [ ] migration runner
- [ ] project repository
- [ ] book repository
- [ ] segment repository
- [ ] job repository
- [ ] TM repository
- [ ] glossary repository
- [ ] editorial repository
```

권장 라이브러리:

```text
better-sqlite3
kysely 또는 drizzle 선택 가능
```

초기에는 raw SQL + repository로 단순하게 시작해도 된다.

---

## 4.3 `packages/epub-core`

역할:

```text
- EPUB import
- EPUB 구조 분석
- text block extraction
- translated EPUB rebuild
```

구현 항목:

```text
- [ ] EPUB unzip
- [ ] mimetype 검증
- [ ] container.xml parser
- [ ] OPF parser
- [ ] spine item 추출
- [ ] nav/toc 추출
- [ ] XHTML parser
- [ ] text block extraction
- [ ] xpath/css selector mapping 저장
- [ ] translated block 재삽입
- [ ] EPUB zip packaging
```

EPUB import 결과:

```ts
export interface EpubImportResult {
  documentId: string;
  title?: string;
  language?: string;
  spineItems: EpubSpineItem[];
  chapters: EpubChapter[];
  blocks: TextBlock[];
  assetPaths: string[];
}
```

TextBlock:

```ts
export interface TextBlock {
  id: string;
  documentId: string;
  chapterId: string;
  blockIndex: number;
  spineHref: string;
  selector: string;
  htmlTag: string;
  sourceText: string;
  normalizedText: string;
  textHash: string;
}
```

완료 기준:

```text
- EPUB import 시 spine 순서대로 block이 추출된다.
- 번역문을 삽입한 EPUB가 주요 뷰어에서 열린다.
- 원본 이미지/CSS/metadata가 유지된다.
```

---

## 4.4 `packages/vertex-provider`

역할:

```text
- Vertex AI Gemini 호출
- structured output 요청
- token usage 저장
- retry/backoff
```

구현 항목:

```text
- [ ] provider config validation
- [ ] service account / ADC 인증 지원
- [ ] translateSegment API
- [ ] editSegment API
- [ ] structured JSON schema 적용
- [ ] response parser
- [ ] retry/backoff
- [ ] token usage logger
```

Provider interface:

```ts
export interface TranslationProvider {
  name: string;
  translateSegment(input: TranslationRequest): Promise<TranslationResponse>;
  editSegment?(input: EditorialRequest): Promise<EditorialResponse>;
  validateConfig(config: ProviderConfig): Promise<ValidationResult>;
}
```

---

## 4.5 `packages/translator-core`

역할:

```text
- 번역 job orchestration
- chunking
- context building
- provider 호출
- cache 저장
- progress event
```

구현 항목:

```text
- [ ] createTranslationJob
- [ ] runTranslationJob
- [ ] pauseJob
- [ ] resumeJob
- [ ] cancelJob
- [ ] segment queue 생성
- [ ] cache key 생성
- [ ] glossary/TM/stylebook context 삽입
- [ ] provider 호출
- [ ] response validation
- [ ] translation_segments 저장
```

번역 job 흐름:

```text
1. book의 text_blocks 조회
2. 각 block에 translation_segment 생성
3. cache key 계산
4. cache hit이면 기존 번역 사용
5. cache miss이면 provider 호출
6. response JSON 검증
7. ai_translation 저장
8. QA 1차 검사
9. 다음 segment 진행
```

---

## 4.6 `packages/glossary-core`

역할:

```text
- glossary CRUD
- glossary hit detection
- forbidden term detection
- CSV import/export
```

구현 항목:

```text
- [ ] glossary_terms table 연동
- [ ] CSV import
- [ ] CSV export
- [ ] source text에서 term hit 검색
- [ ] target text에서 forbidden term 검색
- [ ] context-dependent term rule 저장
- [ ] glossary version hash 생성
```

Glossary hit:

```ts
export interface GlossaryHit {
  termId: string;
  sourceTerm: string;
  canonicalKo: string;
  category: string;
  confidence: 'gold' | 'silver' | 'candidate';
  notes?: string;
}
```

---

## 4.7 `packages/tm-core`

역할:

```text
- TM 저장
- TM 검색
- TM 등급 관리
- gold_candidate → gold 승격
```

구현 항목:

```text
- [x] tm_units table 연동
- [x] exact hash search
- [x] fuzzy search
- [x] grade weighting
- [x] addTmUnit
- [x] promoteGoldCandidateToGold
- [x] rejectTmUnit
- [ ] TM export CSV/TMX 준비
```

TM 검색 weighting:

```text
gold: 1.0
gold_candidate: 0.75
silver: 0.4
reference: 0.25
rejected: 0.0, 검색 제외
```

TM Unit:

```ts
export interface TmUnit {
  id: string;
  projectId: string;
  bookId?: string;
  sourceText: string;
  targetText: string;
  sourceHash: string;
  grade: TmGrade;
  origin:
    | 'user_approved'
    | 'ai_editorial_approved'
    | 'alignment_auto'
    | 'reference_translation'
    | 'post_read_correction';
  confidence?: number;
  notes?: string;
}
```

---

## 4.8 `packages/editorial-core`

역할:

```text
Phase 2의 핵심 모듈.
AI 번역, 기존 한국어판, TM, glossary, stylebook을 비교하여 AI 편집장 감수문을 생성한다.
```

구현 항목:

```text
- [ ] createEditorialJob
- [ ] runEditorialJob
- [ ] buildEditorialContext
- [ ] AI 편집장 prompt template
- [ ] EditorialResponse schema
- [ ] editorial_confidence 저장
- [ ] decision에 따른 segment 상태 변경
- [ ] gold_candidate TM 자동 등록
- [ ] needs_review 보류 처리
- [ ] rejected 후보 처리
```

Editorial Job 흐름:

```text
1. ai_translation이 있는 segment 조회
2. reference_translation 매칭 조회
3. TM matches 검색
4. glossary hits 검색
5. stylebook summary 로드
6. character profile 로드
7. AI 편집장 호출
8. editorial_translation 저장
9. decision 저장
10. approve이면 final_translation에 editorial_translation 저장
11. approve + confidence threshold 충족 시 gold_candidate TM 등록
12. needs_review이면 final_translation에는 보류 또는 ai_translation 유지
13. reject이면 QA issue 생성
```

Editorial Request:

```ts
export interface EditorialRequest {
  projectId: string;
  bookId: string;
  segmentId: string;
  sourceText: string;
  aiTranslation: string;
  referenceTranslation?: string;
  tmMatches: TmMatch[];
  glossaryHits: GlossaryHit[];
  stylebookSummary: string;
  characterProfiles: CharacterProfile[];
  previousContext: ContextBlock[];
}
```

Editorial Response:

```ts
export interface EditorialResponse {
  editorialTranslation: string;
  decision: 'approve' | 'needs_review' | 'reject';
  tmGrade: 'gold_candidate' | 'none' | 'rejected';
  confidence: number;
  rationale: string;
  usedReferenceParts: UsedReferencePart[];
  qaFlags: QaFlag[];
}
```

AI 편집장 decision 기준:

```text
approve:
- glossary 불일치가 없다.
- reference translation과 충돌이 있더라도 stylebook/TM 기준으로 설명 가능하다.
- 문장 의미 누락이 없다.
- confidence >= 0.85

gold_candidate:
- decision이 approve다.
- confidence >= 0.85다.
- QA severity error가 없다.

needs_review:
- confidence < 0.85
- glossary 충돌이 해결되지 않았다.
- 기존 번역과 AI 번역의 의미 차이가 크다.
- 인물 호칭/말투 판단이 어렵다.

reject:
- 명백한 누락/오역/금지어 사용
- 기존 번역 또는 AI 번역 중 하나가 부적절한 reference로 판단됨
```

---

## 4.9 `packages/qa-core`

역할:

```text
- 번역/편집 결과 자동 검사
- spoiler-safe summary 생성
- Review Studio 경고 제공
```

구현 항목:

```text
- [ ] glossary mismatch 검사
- [ ] forbidden term 검사
- [ ] number mismatch 검사
- [ ] untranslated English 검사
- [ ] quote mismatch 검사
- [ ] suspicious expansion/compression 검사
- [ ] editorial confidence warning
- [ ] spoiler-safe QA summary 생성
```

QA issue severity:

```text
info
warning
error
blocking
```

spoiler-safe QA summary 예시:

```text
전체 4,320 segment 중:
- AI 편집장 승인: 4,010
- 확인 필요: 287
- 차단 오류: 23
- glossary 자동 수정: 118
- 신규 용어 후보: 42
```

주의: spoiler-safe summary에서는 본문 문장을 직접 노출하지 않는다.

---

## 4.10 `packages/aligner`

역할:

```text
- 영어 원문과 한국어 기존 번역본 정렬
- Phase 1 TM 구축
- Phase 2 reference_translation 매칭
```

구현 항목:

```text
- [ ] chapter rough matching
- [ ] paragraph length-based alignment
- [ ] fuzzy text similarity
- [ ] embedding similarity optional
- [ ] confidence score
- [ ] alignment review state
- [ ] approved alignment → TM 등록
- [ ] reference alignment → editorial job에 제공
```

개발 우선순위:

```text
1. 챕터 순서 기반 단순 매칭
2. 문단 길이 기반 rough alignment
3. confidence 낮은 항목 표시
4. 수동 보정 UI
5. embedding 기반 개선
```

---

## 4.11 `packages/stylebook-core`

역할:

```text
- stylebook 저장/편집
- prompt용 짧은 summary 생성
- version hash 생성
```

구현 항목:

```text
- [ ] stylebook_entries table 연동
- [ ] markdown editor
- [ ] stylebook summary generator
- [ ] stylebook version hash
- [ ] book/phase별 style override
```

---

## 4.12 `packages/export-core`

역할:

```text
- 최종 EPUB 생성
- spoiler-safe EPUB 생성
- bilingual table export
- QA report export
```

구현 항목:

```text
- [ ] final_translation 기반 EPUB 생성
- [ ] editorial_translation 기반 EPUB 생성
- [ ] draft/reviewed/final export mode
- [ ] spoiler-safe export mode
- [ ] manifest.json 생성
- [ ] QA report markdown 생성
- [ ] CSV bilingual export
```

Export mode:

```text
draft: ai_translation 중심
editorial: editorial_translation 중심
spoiler_safe: 본문 미리보기 없이 editorial/final translation으로 EPUB 생성
final: user approved final_translation 중심
```

---

## 5. 데이터베이스 Migration 계획

## 5.1 Migration 001: Project / Book / Document

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_lang TEXT NOT NULL DEFAULT 'en',
  target_lang TEXT NOT NULL DEFAULT 'ko',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE books (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT,
  series_order REAL,
  author TEXT,
  publication_year INTEGER,
  phase TEXT,
  status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id)
);
```

---

## 5.2 Migration 002: EPUB Structure

```sql
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  chapter_index INTEGER NOT NULL,
  title TEXT,
  spine_href TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(document_id) REFERENCES source_documents(id)
);

CREATE TABLE text_blocks (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  xpath TEXT,
  selector TEXT,
  html_tag TEXT,
  source_text TEXT NOT NULL,
  normalized_text TEXT,
  text_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id),
  FOREIGN KEY(document_id) REFERENCES source_documents(id)
);
```

---

## 5.3 Migration 003: Translation Jobs / Segments

```sql
CREATE TABLE translation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id)
);

CREATE TABLE translation_segments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  source_text TEXT NOT NULL,
  ai_translation TEXT,
  editorial_translation TEXT,
  reviewed_translation TEXT,
  final_translation TEXT,
  status TEXT NOT NULL,
  response_json TEXT,
  editorial_response_json TEXT,
  source_hash TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  editorial_prompt_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES translation_jobs(id),
  FOREIGN KEY(block_id) REFERENCES text_blocks(id)
);
```

---

## 5.4 Migration 004: Glossary

```sql
CREATE TABLE glossary_terms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_term TEXT NOT NULL,
  canonical_ko TEXT NOT NULL,
  category TEXT NOT NULL,
  aliases TEXT,
  forbidden_targets TEXT,
  context_rules TEXT,
  notes TEXT,
  confidence TEXT NOT NULL,
  do_not_translate INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
```

---

## 5.5 Migration 005: TM

```sql
CREATE TABLE tm_units (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT,
  chapter_id TEXT,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  grade TEXT NOT NULL,
  origin TEXT NOT NULL,
  confidence REAL,
  translator_profile TEXT,
  alignment_id TEXT,
  segment_id TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX idx_tm_project_grade ON tm_units(project_id, grade);
CREATE INDEX idx_tm_source_hash ON tm_units(source_hash);
```

TM grade:

```text
gold
gold_candidate
silver
reference
rejected
```

TM origin:

```text
user_approved
ai_editorial_approved
alignment_auto
reference_translation
post_read_correction
manual_import
```

---

## 5.6 Migration 006: Editorial Jobs

```sql
CREATE TABLE editorial_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  translation_job_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  spoiler_safe INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(translation_job_id) REFERENCES translation_jobs(id)
);

CREATE TABLE editorial_decisions (
  id TEXT PRIMARY KEY,
  editorial_job_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  tm_grade TEXT,
  confidence REAL NOT NULL,
  rationale TEXT,
  used_reference_parts_json TEXT,
  qa_flags_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(editorial_job_id) REFERENCES editorial_jobs(id),
  FOREIGN KEY(segment_id) REFERENCES translation_segments(id)
);
```

---

## 5.7 Migration 007: QA Issues

```sql
CREATE TABLE qa_issues (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  suggestion TEXT,
  spoiler_safe_message TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(segment_id) REFERENCES translation_segments(id)
);
```

---

## 5.8 Migration 008: Post-read Corrections

```sql
CREATE TABLE post_read_corrections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  correction_note TEXT,
  promote_to_gold INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(book_id) REFERENCES books(id),
  FOREIGN KEY(segment_id) REFERENCES translation_segments(id)
);
```

---

## 6. IPC API 설계

Electron Renderer는 직접 filesystem/db/provider에 접근하지 않는다. Preload를 통해 제한된 IPC API만 사용한다.

## 6.1 Project API

```ts
window.sts.project.create(input)
window.sts.project.list()
window.sts.project.open(projectId)
window.sts.project.update(projectId, patch)
```

## 6.2 Book / Import API

```ts
window.sts.book.create(projectId, input)
window.sts.book.importSource(bookId, filePath)
window.sts.book.importReference(bookId, filePath)
window.sts.book.list(projectId)
window.sts.book.get(bookId)
```

## 6.3 Translation API

```ts
window.sts.translation.createJob(bookId, config)
window.sts.translation.run(jobId)
window.sts.translation.pause(jobId)
window.sts.translation.resume(jobId)
window.sts.translation.cancel(jobId)
window.sts.translation.getProgress(jobId)
window.sts.translation.onProgress(callback)
```

## 6.4 Editorial API

```ts
window.sts.editorial.createJob(translationJobId, config)
window.sts.editorial.run(editorialJobId)
window.sts.editorial.pause(editorialJobId)
window.sts.editorial.resume(editorialJobId)
window.sts.editorial.getSpoilerSafeSummary(editorialJobId)
window.sts.editorial.getDecisionStats(editorialJobId)
```

## 6.5 Spoiler-safe API

```ts
window.sts.spoilerSafe.exportEpub(bookId, options)
window.sts.spoilerSafe.getProgress(bookId)
window.sts.spoilerSafe.getQaSummary(bookId)
```

주의:

```text
spoiler-safe API는 본문 텍스트를 반환하지 않는다.
진행률, 통계, QA 요약, 신규 용어 수, 오류 수만 반환한다.
```

## 6.6 Review / Post-read API

```ts
window.sts.review.getSegment(segmentId)
window.sts.review.updateFinalTranslation(segmentId, text)
window.sts.review.addPostReadCorrection(segmentId, correction)
window.sts.review.promoteCorrectionToGold(correctionId)
window.sts.review.promoteGoldCandidateToGold(tmUnitId)
```

---

## 7. Prompt 설계

## 7.1 Translation Prompt

목적:

```text
원문 text block을 한국어 초벌 번역으로 변환한다.
```

출력:

```json
{
  "translation": "string",
  "used_terms": [],
  "uncertain_terms": [],
  "qa_flags": [],
  "notes": "string"
}
```

핵심 규칙:

```text
- CURRENT_TEXT만 번역한다.
- glossary를 우선한다.
- 원문에 없는 설명을 추가하지 않는다.
- 문단/대사 구조를 유지한다.
- 불확실한 용어는 uncertain_terms에 보고한다.
```

---

## 7.2 Editorial Prompt

목적:

```text
AI 초벌 번역, 기존 한국어판 reference, TM, glossary, stylebook을 비교하여 최종 감수문을 만든다.
```

입력:

```text
SOURCE_TEXT
AI_TRANSLATION
REFERENCE_TRANSLATION
TM_MATCHES
GLOSSARY_HITS
STYLEBOOK
CHARACTER_PROFILES
PREVIOUS_CONTEXT
```

출력:

```json
{
  "editorial_translation": "string",
  "decision": "approve | needs_review | reject",
  "tm_grade": "gold_candidate | none | rejected",
  "confidence": 0.0,
  "rationale": "string",
  "used_reference_parts": [],
  "qa_flags": []
}
```

AI 편집장 규칙:

```text
- 기존 한국어판을 정답으로 복사하지 않는다.
- 기존 한국어판은 용어/문체/해석 참고자료로만 사용한다.
- glossary와 gold TM을 최우선으로 따른다.
- gold_candidate TM은 참고하되 gold보다 약하게 반영한다.
- 문장 의미가 불확실하면 approve하지 않는다.
- 확신이 낮으면 needs_review로 둔다.
- 최종 감수문은 자연스러운 한국어 문학 번역이어야 한다.
```

---

## 7.3 Spoiler-safe Summary Prompt

목적:

```text
사용자에게 본문 내용을 노출하지 않고 번역/감수 상태만 알려준다.
```

출력 예:

```json
{
  "total_segments": 4320,
  "editorial_approved": 4010,
  "needs_review": 287,
  "blocking_errors": 23,
  "new_term_candidates": 42,
  "summary": "전체적으로 EPUB 생성 가능하나 일부 용어 후보와 확인 필요 문장이 있습니다. 본문 내용은 표시하지 않습니다."
}
```

금지:

```text
- 원문 문장 출력 금지
- 번역문 출력 금지
- 줄거리 요약 금지
- 특정 장면 내용 암시 금지
```

---

## 8. UI 구현 계획

## 8.1 Main Dashboard

기능:

```text
- 프로젝트 목록
- 최근 작업
- 빠른 import
- 진행 중 job 상태
```

구현 항목:

```text
- [ ] 프로젝트 카드
- [ ] 새 프로젝트 생성 modal
- [ ] 최근 job list
- [ ] 오류 job 재개 버튼
```

---

## 8.2 Book Workspace

기능:

```text
- 권별 파일 관리
- Phase 선택
- 원서/기존 번역본 import
- 번역 job 실행
- AI 편집장 job 실행
- EPUB export
```

구현 항목:

```text
- [ ] Book metadata editor
- [ ] Source EPUB dropzone
- [ ] Reference translation dropzone
- [ ] Phase badge
- [ ] Run Translation button
- [ ] Run AI Editorial button
- [ ] Spoiler-safe Export button
```

---

## 8.3 Translation Job Monitor

기능:

```text
- 번역 진행률
- token usage
- cache hit
- error count
- pause/resume/cancel
```

구현 항목:

```text
- [ ] Progress bar
- [ ] Chapter progress table
- [ ] Segment status count
- [ ] API usage panel
- [ ] Error retry button
```

---

## 8.4 AI Editorial Monitor

기능:

```text
- AI 편집장 감수 진행률
- approve / needs_review / reject 통계
- gold_candidate 생성 수
- spoiler-safe QA summary
```

구현 항목:

```text
- [ ] Editorial progress bar
- [ ] Decision stats
- [ ] Confidence histogram
- [ ] QA summary
- [ ] Run / Pause / Resume
- [ ] Generate spoiler-safe EPUB
```

주의:

```text
기본 모드에서는 본문을 표시하지 않는다.
사용자가 spoiler-safe mode를 끈 경우에만 segment 내용을 볼 수 있다.
```

---

## 8.5 Spoiler-safe Mode UI

목표:

```text
사용자가 본문 내용을 보지 않고 Phase 2 감수/EPUB 생성까지 진행한다.
```

표시 가능 정보:

```text
- 진행률
- 처리 segment 수
- AI 편집장 승인 수
- 확인 필요 수
- blocking error 수
- 신규 용어 후보 수
- glossary 변경 요약
- EPUB 생성 가능 여부
```

표시 금지 정보:

```text
- 원문 문장
- 번역문 문장
- 장면 설명
- 줄거리 요약
- 캐릭터 행동/사건 암시
```

구현 항목:

```text
- [ ] Spoiler-safe toggle
- [ ] 본문 hidden guard
- [ ] summary-only API 사용
- [ ] reveal confirmation dialog
- [ ] spoiler-safe export flow
```

Reveal dialog 예:

```text
본문을 표시하면 아직 읽지 않은 내용이 노출될 수 있습니다.
정말 spoiler-safe mode를 해제할까요?
```

---

## 8.6 Review Studio

역할:

```text
수동 선감수용이 아니라, 예외 처리와 완독 후 사후 보정용 UI다.
```

기능:

```text
- needs_review segment 확인
- AI 편집장 decision 확인
- 사후 수정 입력
- gold_candidate → gold 승격
- glossary 수정
- QA issue 해결
```

구현 항목:

```text
- [ ] Segment list with filters
- [ ] Source / AI / Reference / Editorial / Final panel
- [ ] QA issue panel
- [ ] TM match panel
- [ ] Glossary hit panel
- [ ] Post-read correction editor
- [ ] Promote to gold button
```

필터:

```text
needs_review
blocking_error
gold_candidate
post_read_corrected
user_approved
rejected
```

---

## 8.7 Post-read Correction UI

목표:

```text
사용자가 EPUB를 읽은 뒤 어색한 문장만 찾아 수정한다.
```

구현 방식:

```text
- EPUB 내 segment marker를 숨겨 넣거나, 문장 검색 기반으로 segment를 찾는다.
- 사용자가 수정 전/후 문장을 입력한다.
- 앱이 대응 segment 후보를 검색한다.
- 사용자가 선택하면 correction 저장.
- 필요 시 gold TM으로 승격.
```

구현 항목:

```text
- [ ] 문장 검색
- [ ] segment 후보 표시
- [ ] correction form
- [ ] correction history
- [ ] promote correction to gold
- [ ] regenerate EPUB from corrections
```

---

## 9. Job 상태 머신

## 9.1 Translation Job

```text
pending
→ running
→ paused
→ running
→ completed

running
→ failed
→ running

running
→ cancelled
```

## 9.2 Editorial Job

```text
pending
→ running
→ paused
→ running
→ completed

running
→ completed_with_warnings
running
→ failed
running
→ cancelled
```

## 9.3 Segment 상태

```text
pending
→ translating
→ translated
→ editorial_pending
→ editorial_running
→ editorial_approved
→ needs_review
→ post_read_corrected
→ approved
```

오류 흐름:

```text
translating → error → translating
editorial_running → editorial_error → editorial_running
needs_review → post_read_corrected → approved
```

---

## 10. Cache 설계

## 10.1 Translation Cache Key

```text
source_text_hash
provider
model
prompt_template_version
glossary_version_hash
stylebook_version_hash
tm_context_hash
translation_options_hash
```

## 10.2 Editorial Cache Key

```text
source_text_hash
ai_translation_hash
reference_translation_hash
glossary_version_hash
stylebook_version_hash
tm_context_hash
editorial_prompt_template_version
provider
model
```

주의:

```text
AI 초벌 번역이 바뀌면 editorial cache는 무효화한다.
glossary/stylebook/TM context가 바뀌면 editorial cache도 무효화한다.
```

---

## 11. QA 구현 계획

## 11.1 Translation QA

```text
- 미번역 영어 잔존
- 숫자 불일치
- glossary mismatch
- forbidden target 사용
- 문장 길이 이상치
- 따옴표 불일치
```

## 11.2 Editorial QA

```text
- editorial_translation 누락
- decision/confidence 불일치
- approve인데 QA error 존재
- gold_candidate인데 confidence 낮음
- reference를 과도하게 복사한 의심
- glossary를 무시한 감수문
```

## 11.3 Spoiler-safe QA

```text
- 본문 미노출 summary 생성
- blocking count만 표시
- 신규 용어 후보 수만 표시
- 줄거리/문장 암시 금지
```

---

## 12. Milestone 상세 계획

## M0. Repository / 개발 환경 구축

목표:

```text
개발 가능한 monorepo와 Electron 앱 skeleton을 만든다.
```

작업:

```text
- [ ] Git repository 생성
- [ ] pnpm workspace 설정
- [ ] Electron + React + TypeScript 설정
- [ ] ESLint / Prettier 설정
- [ ] Vitest 설정
- [ ] 기본 IPC 구조 생성
- [ ] SQLite 연결 테스트
```

완료 기준:

```text
pnpm dev로 데스크톱 앱이 실행된다.
SQLite DB를 생성하고 migration을 실행할 수 있다.
```

---

## M1. EPUB Import / Extract / Rebuild MVP

작업:

```text
- [ ] EPUB drag-and-drop
- [ ] EPUB unzip
- [ ] OPF/spine parser
- [ ] XHTML text block 추출
- [ ] block list DB 저장
- [ ] dummy translation 삽입
- [ ] EPUB rebuild
```

완료 기준:

```text
원본 EPUB를 import한 뒤, 본문 일부를 dummy text로 교체한 EPUB를 생성할 수 있다.
```

---

## M2. Vertex AI Translation MVP

작업:

```text
- [x] Vertex AI config UI
- [x] provider validation
- [x] Translation prompt 작성
- [x] structured JSON response 파싱
- [x] block 단위 번역 실행
- [x] translation_segments 저장
```

완료 기준:

```text
EPUB의 일부 또는 전체 block을 Vertex AI로 번역하고 DB에 저장할 수 있다.
```

---

## M3. Cache / Resume / Job Monitor

작업:

```text
- [x] translation_jobs table 연동
- [x] segment status 관리
- [x] cache key 생성
- [x] cache hit 처리
- [x] pause/resume/cancel
- [x] progress event
- [x] job monitor UI
```

완료 기준:

```text
작업 중 앱을 껐다 켜도 완료 segment를 재사용하여 이어서 번역할 수 있다.
```

---

## M4. Glossary Engine

작업:

```text
- [x] glossary_terms table
- [x] CSV import/export
- [x] glossary hit detection
- [x] prompt injection
- [x] glossary mismatch QA
- [x] glossary editor UI
```

완료 기준:

```text
등록한 용어가 번역 prompt에 반영되고, 결과에서 불일치가 감지된다.
```

---

## M5. Basic Review Studio

작업:

```text
- [x] segment list UI
- [x] source/ai_translation/final_translation 표시
- [x] final_translation 수정 저장
- [x] QA issue 표시
- [x] EPUB regenerate
```

완료 기준:

```text
번역된 segment를 수정하고, 수정본 기반 EPUB를 다시 생성할 수 있다.
```

---

## M6. TM Engine

작업:

```text
- [x] tm_units table
- [x] manual TM add
- [x] exact/fuzzy search
- [x] grade weighting
- [x] prompt insertion
- [x] TM manager UI
```

완료 기준:

```text
TM에 등록된 번역 예문이 이후 번역 prompt에 반영된다.
```

---

## M7. Alignment Engine

작업:

```text
- [x] reference translation import
- [x] source/reference chapter matching
- [x] paragraph alignment
- [x] confidence score
- [x] alignment review UI
- [x] approved pair → gold/silver/reference TM 등록
```

완료 기준:

```text
기존 번역권에서 정렬 pair를 만들고 TM으로 저장할 수 있다.
```

---

## M8. AI Editorial Engine

작업:

```text
- [x] editorial_jobs table
- [x] editorial_decisions table
- [x] EditorialRequest builder
- [x] Editorial prompt 작성
- [x] Vertex provider editSegment 구현
- [x] EditorialResponse schema validation
- [x] editorial_translation 저장
- [x] decision/confidence 저장
- [x] approve → final_translation 반영
- [x] approve + confidence threshold → gold_candidate TM 등록
```

완료 기준:

```text
AI 초벌 번역과 기존 한국어판 reference를 비교하여 AI 편집장 감수문을 생성하고, gold_candidate TM으로 등록할 수 있다.
```

---

## M9. Spoiler-safe Phase 2 Pipeline

작업:

```text
- [x] spoiler-safe mode 설정
- [x] spoiler-safe API 분리
- [x] 본문 미노출 guard
- [x] Editorial Monitor summary-only UI
- [x] spoiler-safe QA summary
- [x] spoiler-safe EPUB export
- [x] reveal confirmation dialog
```

완료 기준:

```text
사용자가 본문을 보지 않고 Translation → AI Editorial → EPUB Export까지 완료할 수 있다.
```

---

## M10. Post-read Correction / TM Promotion

작업:

```text
- [x] post_read_corrections table
- [x] 문장 검색으로 segment 찾기
- [x] correction 저장
- [x] correction 기반 EPUB regenerate
- [x] gold_candidate → gold 수동 승격
- [x] post_read_correction → gold TM 등록
```

완료 기준:

```text
사용자가 완독 후 어색한 문장만 수정하고, 그 수정문을 gold TM으로 확정할 수 있다.
```

---

## M11. Series Memory / Stylebook

작업:

```text
- [x] stylebook editor
- [x] stylebook summary generator
- [x] character profile DB
- [x] character speech style prompt injection
- [x] chapter summary memory
- [x] cross-chapter term memory
```

완료 기준:

```text
시리즈 단위 문체/인물/용어 정보가 번역과 AI 편집장 감수에 반영된다.
```

---

## M12. Export / QA / Stabilization

작업:

```text
- [x] EPUB validation 개선
- [x] QA report export
- [x] bilingual CSV export
- [x] glossary export
- [x] TM export
- [x] crash recovery
- [ ] large book performance test
- [ ] packaging installer
```

완료 기준:

```text
장편 EPUB 1권을 안정적으로 번역/AI 감수/EPUB 생성/사후 수정까지 처리할 수 있다.
```

---

## 13. GitHub Issue 분해 예시

## Epic: EPUB Core

```text
#1 Setup pnpm monorepo
#2 Setup Electron React TypeScript app
#3 Implement EPUB unzip and container parser
#4 Implement OPF and spine parser
#5 Extract XHTML text blocks
#6 Store extracted blocks in SQLite
#7 Rebuild EPUB with dummy translations
#8 Add EPUB import UI
```

## Epic: Translation Core

```text
#9 Define TranslationProvider interface
#10 Implement Vertex AI provider config
#11 Implement translation prompt template
#12 Parse structured JSON response
#13 Save translation segments
#14 Implement translation job runner
#15 Add pause/resume/cancel
#16 Add job progress UI
```

## Epic: Glossary / TM

```text
#17 Create glossary schema and repository
#18 Implement glossary CSV import/export
#19 Implement glossary hit detection
#20 Inject glossary into prompt
#21 Create TM schema and repository
#22 Implement TM search
#23 Inject TM matches into prompt
#24 Add TM grade weighting including gold_candidate
```

## Epic: AI Editorial Engine

```text
#25 Create editorial_jobs and editorial_decisions schema
#26 Define EditorialRequest and EditorialResponse types
#27 Implement editorial prompt template
#28 Implement Vertex editSegment call
#29 Store editorial decision and confidence
#30 Auto-register approved editorial translation as gold_candidate
#31 Add editorial job monitor
#32 Add editorial QA checks
```

## Epic: Spoiler-safe Mode

```text
#33 Add spoiler-safe project/book setting
#34 Implement summary-only editorial API
#35 Hide source/translation body in spoiler-safe mode
#36 Add reveal warning dialog
#37 Implement spoiler-safe QA summary
#38 Implement spoiler-safe EPUB export
```

## Epic: Post-read Correction

```text
#39 Create post_read_corrections schema
#40 Implement segment search by sentence
#41 Add correction editor UI
#42 Regenerate EPUB from corrections
#43 Promote correction to gold TM
#44 Promote gold_candidate to gold after user approval
```

---

## 14. 테스트 계획

## 14.1 Unit Tests

```text
- hash helper
- EPUB parser
- text block extractor
- cache key generator
- glossary hit detection
- TM grade weighting
- EditorialResponse validator
- spoiler-safe summary sanitizer
```

## 14.2 Integration Tests

```text
- EPUB import → block extraction → DB save
- translation job → segment save → resume
- glossary import → prompt context
- TM search → prompt context
- editorial job → gold_candidate TM 등록
- post-read correction → gold TM 승격
```

## 14.3 E2E Tests

```text
- EPUB drag-and-drop
- translation job 실행
- AI editorial job 실행
- spoiler-safe EPUB export
- spoiler-safe mode에서 본문 미노출 확인
- Review Studio에서 correction 저장
- correction 기반 EPUB regenerate
```

## 14.4 Spoiler-safe Regression Tests

중요 테스트:

```text
- spoiler-safe API가 source_text를 반환하지 않는지 확인
- spoiler-safe summary가 translation text를 포함하지 않는지 확인
- QA summary에 줄거리/장면 정보가 포함되지 않는지 확인
- reveal confirmation 없이 본문 panel이 열리지 않는지 확인
```

---

## 15. 첫 개발 7일 작업안

## Day 1

```text
- repository 생성
- pnpm workspace 설정
- Electron + React skeleton
- SQLite 연결
- migration runner 초안
```

## Day 2

```text
- project/book/source_documents schema
- 프로젝트 생성 UI
- EPUB 파일 drag-and-drop
- file hash 계산
```

## Day 3

```text
- EPUB unzip
- container.xml parser
- OPF parser
- spine parser
```

## Day 4

```text
- XHTML parser
- text block extraction
- chapters/text_blocks 저장
- block list UI
```

## Day 5

```text
- dummy translation 적용
- EPUB rebuild
- export test
```

## Day 6

```text
- Vertex AI provider config
- translation prompt
- single segment translation test
```

## Day 7

```text
- translation job runner
- translation_segments 저장
- progress UI 초안
```

---

## 16. MVP 완료 정의

## MVP 1 완료 정의

```text
영어 EPUB를 입력해서 AI 초벌 번역 EPUB를 만들 수 있다.
작업 중단 후 재개할 수 있다.
glossary CSV를 반영할 수 있다.
```

## MVP 2 완료 정의

```text
TM을 수동 등록하고 번역 prompt에 반영할 수 있다.
Basic Review Studio에서 segment를 수정할 수 있다.
```

## MVP 3 완료 정의

```text
기존 한국어판이 있는 권에 대해 AI 편집장 감수를 실행할 수 있다.
AI 편집장 승인문이 gold_candidate TM으로 저장된다.
```

## MVP 4 완료 정의

```text
spoiler-safe mode에서 본문 노출 없이 Phase 2 EPUB 생성이 가능하다.
사용자가 완독 후 수정한 문장을 gold TM으로 승격할 수 있다.
```

---

## 17. 최종 개발 우선순위

가장 중요한 순서:

```text
1. EPUB import/rebuild 안정화
2. Vertex AI 번역 job 안정화
3. cache/resume 안정화
4. glossary 적용
5. TM 검색/등급 체계
6. AI Editorial Engine
7. spoiler-safe Phase 2 flow
8. post-read correction
9. alignment 자동화
10. series memory 고도화
```

초반에 피해야 할 것:

```text
- Alignment Engine을 처음부터 완벽히 만들기
- MOBI/AZW3 지원을 초반에 넣기
- PDF/OCR 번역을 넣기
- Review Studio를 CAT tool처럼 과도하게 복잡하게 만들기
- 사용자 선감수를 기본 흐름으로 강제하기
```

이 구현 계획의 중심은 다음 문장이다.

```text
앱은 사용자가 번역문을 만들기 위해 쓰는 도구가 아니라,
사용자가 읽을 수 있는 EPUB를 만들기 위해 쓰는 도구다.
```
