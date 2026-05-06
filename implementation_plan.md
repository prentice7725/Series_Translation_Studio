# Series Translation Studio Implementation Plan

## 0. 문서 목적

이 문서는 `Series Translation Studio`를 실제로 개발하기 위한 구현 계획서다.

목표는 다음과 같다.

- 혼자 개발하고 유지보수하기 쉬운 순서로 작업을 나눈다.
- 처음부터 거대한 번역 스튜디오를 만들지 않고, 작동하는 EPUB 번역 MVP를 먼저 만든다.
- 이후 glossary, TM, alignment, review, QA 기능을 단계적으로 붙인다.
- 각 단계마다 완료 기준을 명확히 둔다.
- 나중에 GitHub Issues, Linear, Notion, Obsidian, TODO.md 등으로 바로 쪼갤 수 있게 한다.

---

## 1. 최종 제품 방향

제품은 단순 EPUB 자동번역기가 아니다.

최종 목표는 다음 세 가지를 결합한 데스크톱 앱이다.

```text
1. EPUB 구조 보존 번역기
2. 장편 시리즈용 TM / glossary / stylebook 관리기
3. 원문-번역문 비교 감수 스튜디오
```

초기 구현은 다음 순서로 간다.

```text
MVP 1: 영어 EPUB → 한국어 EPUB 번역
MVP 2: glossary 기반 번역
MVP 3: cache / resume / job 안정화
MVP 4: segment review UI
MVP 5: TM 수동 등록 및 검색
MVP 6: 기존 번역권 alignment
MVP 7: 시리즈 memory / stylebook / character profile
MVP 8: 고급 QA / export / packaging
```

---

## 2. 기술 스택

## 2.1 기본 스택

```text
Runtime: Node.js LTS
Language: TypeScript
Desktop: Electron
UI: React
Build: Vite
Package Manager: pnpm
DB: SQLite
AI Provider: Vertex AI Gemini
Validation: Zod
HTML/XML Parsing: cheerio 또는 node-html-parser
EPUB Zip: yauzl / yazl 또는 adm-zip 대체 검토
State Management: Zustand 또는 Jotai
Testing: Vitest
E2E: Playwright, 선택 사항
```

## 2.2 왜 Electron인가

이 앱은 다음 특성이 강하다.

```text
- 로컬 파일 접근
- EPUB unpack/repack
- SQLite 사용
- 대용량 번역 job 실행
- 드래그앤드롭
- 중단 후 재개
- 감수용 데스크톱 UI
```

따라서 Node.js 기반 파일 처리와 데스크톱 UI를 한 번에 가져갈 수 있는 Electron이 초기 개발에 적합하다.

---

## 3. 저장소 구조

권장 monorepo 구조:

```text
series-translation-studio/
 ├─ apps/
 │   └─ desktop/
 │       ├─ src-main/
 │       ├─ src-renderer/
 │       ├─ src-preload/
 │       ├─ index.html
 │       ├─ vite.config.ts
 │       └─ package.json
 │
 ├─ packages/
 │   ├─ common/
 │   ├─ db/
 │   ├─ epub-core/
 │   ├─ translator-core/
 │   ├─ vertex-provider/
 │   ├─ glossary-core/
 │   ├─ tm-core/
 │   ├─ aligner/
 │   ├─ qa-core/
 │   └─ export-core/
 │
 ├─ docs/
 │   ├─ prd.md
 │   ├─ architecture.md
 │   ├─ db-schema.md
 │   ├─ prompts.md
 │   └─ implementation_plan.md
 │
 ├─ samples/
 │   ├─ epubs/
 │   └─ glossary/
 │
 ├─ scripts/
 ├─ tests/
 ├─ package.json
 ├─ pnpm-workspace.yaml
 ├─ tsconfig.base.json
 └─ README.md
```

---

## 4. 개발 원칙

## 4.1 가장 중요한 원칙

```text
항상 “읽을 수 있는 결과물”을 먼저 만든다.
```

즉, 처음부터 TM, alignment, review studio를 완벽히 만들지 않는다.

1차 목표는 다음이다.

```text
영어 EPUB 1권 입력
→ Vertex AI로 번역
→ 한국어 EPUB 출력
→ 중단 후 재개 가능
```

이게 성공하면 이후 품질 개선 기능을 붙인다.

## 4.2 기능 추가 원칙

새 기능은 반드시 다음 순서를 따른다.

```text
1. DB schema
2. core package API
3. main process service
4. IPC bridge
5. renderer UI
6. test
7. sample data 검증
```

## 4.3 데이터 보존 원칙

번역 앱에서 가장 위험한 것은 작업 손실이다.

따라서 다음을 반드시 지킨다.

```text
- segment 단위로 즉시 저장한다.
- API 응답 raw JSON을 보관한다.
- 작업 중단 시 완료 segment를 재사용한다.
- 원본 EPUB는 절대 수정하지 않는다.
- export는 별도 output 폴더에 생성한다.
```

---

## 5. Milestone 개요

| Milestone | 이름 | 핵심 결과물 |
|---|---|---|
| M0 | 프로젝트 스캐폴딩 | Electron 앱 실행, SQLite 연결 |
| M1 | EPUB Core | EPUB import/extract/rebuild 가능 |
| M2 | Translation MVP | Vertex AI로 segment 번역 가능 |
| M3 | Job/Cache/Resume | 중단 후 재개 가능한 번역 job |
| M4 | Glossary | glossary CSV 적용 및 용어 일관성 검사 |
| M5 | Review Studio MVP | 원문/번역문 수정 및 승인 UI |
| M6 | TM Engine | 수동 TM 등록 및 검색 |
| M7 | Alignment Engine | 기존 영한 번역권에서 TM 구축 |
| M8 | Series Memory | stylebook, character profile, chapter memory |
| M9 | QA/Export 강화 | EPUB validation, QA report, packaging |

---

# M0. 프로젝트 스캐폴딩

## 목표

개발 가능한 Electron + React + TypeScript monorepo를 만든다.

## 작업 목록

### M0-1. pnpm workspace 생성

```text
- [ ] root package.json 생성
- [ ] pnpm-workspace.yaml 생성
- [ ] tsconfig.base.json 생성
- [ ] apps/desktop 생성
- [ ] packages 디렉터리 생성
```

완료 기준:

```text
pnpm install
pnpm build
pnpm lint
```

명령이 최소한 실패 없이 실행된다.

---

### M0-2. Electron + React + Vite 설정

```text
- [ ] Electron main process 설정
- [ ] preload script 설정
- [ ] renderer React 설정
- [ ] Vite dev server 연결
- [ ] 개발 모드 실행 스크립트 추가
```

예상 스크립트:

```json
{
  "scripts": {
    "dev": "pnpm --filter @sts/desktop dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

완료 기준:

```text
pnpm dev
```

실행 시 데스크톱 창이 뜬다.

---

### M0-3. 공통 타입 패키지 생성

패키지:

```text
packages/common
```

내용:

```text
- ProjectId
- BookId
- ChapterId
- BlockId
- JobId
- SegmentId
- Result<T>
- AppError
- Timestamp
```

완료 기준:

```text
renderer/main/core packages에서 common type을 import 가능
```

---

### M0-4. SQLite DB 패키지 생성

패키지:

```text
packages/db
```

작업:

```text
- [ ] SQLite driver 선택
- [ ] DB connection manager 구현
- [ ] migration runner 구현
- [ ] initial schema migration 생성
- [ ] repository pattern 초안 작성
```

추천:

```text
better-sqlite3
```

완료 기준:

```text
앱 실행 시 workspace/project.sqlite 생성 가능
```

---

# M1. EPUB Core

## 목표

EPUB 파일을 import하고, 텍스트 block을 추출하고, 번역문을 다시 EPUB로 rebuild할 수 있게 한다.

## 패키지

```text
packages/epub-core
```

---

## M1-1. EPUB unpack 구현

작업:

```text
- [ ] EPUB 파일 zip 해제
- [ ] mimetype 확인
- [ ] META-INF/container.xml 파싱
- [ ] OPF 파일 위치 찾기
- [ ] workspace/extracted/{bookId}에 저장
```

API:

```ts
export async function unpackEpub(input: {
  epubPath: string;
  outputDir: string;
}): Promise<UnpackedEpub>;
```

완료 기준:

```text
샘플 EPUB를 넣으면 extracted 폴더에 원본 구조가 풀린다.
```

---

## M1-2. OPF / spine parser 구현

작업:

```text
- [ ] OPF manifest 파싱
- [ ] spine itemref 순서 파악
- [ ] 각 spine item의 href resolve
- [ ] nav/toc 문서 식별
```

출력 예시:

```ts
export interface EpubSpineItem {
  id: string;
  href: string;
  mediaType: string;
  index: number;
  isLinear: boolean;
}
```

완료 기준:

```text
본문 XHTML 파일이 reading order대로 정렬되어 나온다.
```

---

## M1-3. XHTML text block extraction

작업:

```text
- [ ] XHTML 파일 로드
- [ ] p, h1~h6, blockquote, li 등 block 추출
- [ ] 빈 문단 제외
- [ ] 너무 짧은 장식 텍스트 제외 옵션
- [ ] block_id 생성
- [ ] xpath 또는 stable selector 저장
- [ ] text_hash 생성
```

API:

```ts
export async function extractTextBlocks(input: {
  bookId: string;
  documentId: string;
  spineItems: EpubSpineItem[];
  extractedDir: string;
}): Promise<TextBlock[]>;
```

완료 기준:

```text
EPUB 1권에서 본문 문단 목록이 순서대로 추출된다.
```

---

## M1-4. DB 저장

테이블:

```text
source_documents
chapters
text_blocks
```

작업:

```text
- [ ] import된 EPUB metadata 저장
- [ ] chapter 저장
- [ ] text_blocks 저장
- [ ] block_index 보존
```

완료 기준:

```text
앱 재시작 후에도 추출된 block 목록을 다시 볼 수 있다.
```

---

## M1-5. EPUB rebuild 구현

작업:

```text
- [ ] 원본 extracted workspace 복사
- [ ] text_block mapping으로 번역문 삽입
- [ ] XHTML escape 처리
- [ ] OPF metadata 업데이트 옵션
- [ ] EPUB zip 재생성
- [ ] mimetype entry 무압축/첫 번째 위치 보장
```

API:

```ts
export async function rebuildEpub(input: {
  extractedDir: string;
  outputPath: string;
  translations: Record<string, string>;
}): Promise<RebuildResult>;
```

완료 기준:

```text
원본 문단을 임시 문자열로 치환한 EPUB가 정상 생성되고 뷰어에서 열린다.
```

---

# M2. Translation MVP

## 목표

Vertex AI Gemini를 사용해 EPUB text block을 한국어로 번역한다.

## 패키지

```text
packages/translator-core
packages/vertex-provider
```

---

## M2-1. Provider interface 정의

```ts
export interface TranslationProvider {
  name: string;
  translateSegment(input: TranslationRequest): Promise<TranslationResponse>;
  validateConfig(config: ProviderConfig): Promise<ValidationResult>;
}
```

작업:

```text
- [ ] TranslationRequest 타입 정의
- [ ] TranslationResponse 타입 정의
- [ ] ProviderConfig 타입 정의
- [ ] TokenUsage 타입 정의
- [ ] ProviderError 타입 정의
```

완료 기준:

```text
mock provider로 테스트 번역 가능
```

---

## M2-2. Vertex AI provider 구현

작업:

```text
- [ ] Google auth 방식 결정
- [ ] project id / location / model 설정
- [ ] translateSegment 구현
- [ ] timeout 설정
- [ ] retry 가능한 오류 분류
- [ ] usage metadata 저장
```

환경변수 예시:

```text
GOOGLE_APPLICATION_CREDENTIALS=...
VERTEX_PROJECT_ID=...
VERTEX_LOCATION=us-central1
VERTEX_MODEL=...
```

완료 기준:

```text
짧은 영어 문단 1개를 한국어 JSON 응답으로 받을 수 있다.
```

---

## M2-3. 기본 번역 프롬프트 작성

파일:

```text
packages/translator-core/prompts/literary-ko-v1.md
```

기본 규칙:

```text
- CURRENT_TEXT만 번역
- 원문에 없는 설명 추가 금지
- 자연스러운 한국어 문학 번역
- 문단 구조 보존
- JSON schema 준수
```

응답 schema:

```json
{
  "translation": "string",
  "used_terms": [],
  "uncertain_terms": [],
  "qa_flags": [],
  "notes": "string"
}
```

완료 기준:

```text
잘못된 JSON이 오면 재시도하거나 error 상태로 저장한다.
```

---

## M2-4. Segment 번역 실행

작업:

```text
- [ ] text_blocks를 translation_segments로 변환
- [ ] segment 단위 provider 호출
- [ ] response_json 저장
- [ ] ai_translation 저장
- [ ] status 업데이트
```

완료 기준:

```text
EPUB 1개 챕터를 segment 단위로 번역해 DB에 저장할 수 있다.
```

---

## M2-5. 번역 결과 EPUB export

작업:

```text
- [ ] ai_translation을 final_translation으로 임시 사용
- [ ] rebuildEpub 호출
- [ ] output 폴더에 EPUB 생성
```

완료 기준:

```text
영어 EPUB → 한국어 EPUB 초벌 번역본 생성 가능
```

---

# M3. Job / Cache / Resume

## 목표

긴 장편 번역을 안정적으로 처리한다.

---

## M3-1. translation_jobs 상태 머신 구현

상태:

```text
pending
running
paused
completed
failed
cancelled
```

작업:

```text
- [ ] job 생성
- [ ] job 시작
- [ ] job 일시정지
- [ ] job 재개
- [ ] job 취소
- [ ] 실패 job 재시도
```

완료 기준:

```text
앱 UI에서 job 상태를 확인할 수 있다.
```

---

## M3-2. segment 상태 머신 구현

상태:

```text
pending
translating
translated
needs_review
reviewed
approved
error
```

작업:

```text
- [ ] segment status transition 함수 작성
- [ ] invalid transition 방지
- [ ] error message 저장
```

완료 기준:

```text
실패 segment만 필터링 가능
```

---

## M3-3. cache key 설계 및 구현

cache key 구성:

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

작업:

```text
- [ ] hash utility 구현
- [ ] cache table 생성
- [ ] cache hit 시 provider 호출 생략
- [ ] cache miss 시 provider 호출 후 저장
```

완료 기준:

```text
같은 설정으로 재실행하면 이미 번역한 segment는 API를 다시 호출하지 않는다.
```

---

## M3-4. Resume logic

작업:

```text
- [ ] completed/translated segment skip
- [ ] error segment retry 옵션
- [ ] job 시작 시 남은 segment 계산
- [ ] 앱 종료 후 재실행 시 job 이어하기
```

완료 기준:

```text
번역 중 앱을 종료해도 다음 실행에서 이어서 번역 가능
```

---

## M3-5. Progress event

작업:

```text
- [ ] main process에서 progress event 발행
- [ ] preload IPC bridge 추가
- [ ] renderer에서 progress bar 표시
- [ ] 현재 챕터/segment 표시
- [ ] cache hit/API call/error 수 표시
```

완료 기준:

```text
사용자가 작업 진행 상태를 실시간으로 볼 수 있다.
```

---

# M4. Glossary

## 목표

사용자가 정의한 용어집을 번역에 반영하고, 결과의 용어 일관성을 검사한다.

## 패키지

```text
packages/glossary-core
```

---

## M4-1. glossary_terms schema 구현

필드:

```text
id
project_id
source_term
canonical_ko
category
aliases
forbidden_targets
context_rules
notes
confidence
do_not_translate
needs_review
created_at
updated_at
```

완료 기준:

```text
glossary term CRUD 가능
```

---

## M4-2. CSV import/export

CSV columns:

```text
source_term,canonical_ko,category,aliases,forbidden_targets,notes,confidence
```

작업:

```text
- [ ] CSV import
- [ ] CSV validation
- [ ] 중복 용어 처리
- [ ] CSV export
```

완료 기준:

```text
사용자가 만든 glossary.csv를 import해서 번역에 사용할 수 있다.
```

---

## M4-3. Glossary hit detection

작업:

```text
- [ ] source_text에서 source_term 탐지
- [ ] aliases 탐지
- [ ] 대소문자 옵션
- [ ] word boundary 옵션
- [ ] hit 결과를 context builder에 전달
```

완료 기준:

```text
번역할 segment에 포함된 glossary term이 prompt에 삽입된다.
```

---

## M4-4. Prompt integration

프롬프트에 삽입할 형식:

```text
GLOSSARY:
- Vor => 보르 [culture]
- Barrayar => 바라야 [planet]
- armsman => 무장가신 [rank/title, needs review]
```

완료 기준:

```text
glossary hit가 있는 segment에서 번역 결과가 canonical_ko를 우선 사용한다.
```

---

## M4-5. Glossary mismatch QA

작업:

```text
- [ ] source에 glossary term이 있음
- [ ] translation에 canonical_ko가 없음
- [ ] forbidden target이 있음
- [ ] QA issue 생성
```

완료 기준:

```text
용어 불일치가 Review Studio에 warning으로 표시된다.
```

---

## M4-6. Glossary UI

기능:

```text
- [ ] 용어 목록
- [ ] 검색
- [ ] 카테고리 필터
- [ ] 용어 추가/수정/삭제
- [ ] CSV import/export
- [ ] needs_review 필터
```

완료 기준:

```text
사용자가 GUI에서 glossary를 관리할 수 있다.
```

---

# M5. Review Studio MVP

## 목표

AI 번역 결과를 사람이 수정하고 승인할 수 있게 한다.

---

## M5-1. Segment list 화면

작업:

```text
- [ ] 챕터 목록 표시
- [ ] segment 목록 표시
- [ ] status 필터
- [ ] QA issue 수 표시
- [ ] 검색
```

완료 기준:

```text
번역된 segment를 순서대로 탐색할 수 있다.
```

---

## M5-2. 원문/번역문 편집 화면

구성:

```text
원문 source_text
AI 번역 ai_translation
최종 감수문 final_translation editor
```

작업:

```text
- [ ] segment 상세 로드
- [ ] final_translation 수정
- [ ] 저장
- [ ] 승인하고 다음
```

완료 기준:

```text
사용자가 번역문을 직접 고치고 저장할 수 있다.
```

---

## M5-3. Keyboard shortcuts

단축키:

```text
Ctrl+S: 저장
Ctrl+Enter: 승인하고 다음
Alt+Left: 이전 segment
Alt+Right: 다음 segment
Ctrl+G: 선택 텍스트 glossary 등록
Ctrl+T: 선택 문장 TM 등록
```

완료 기준:

```text
마우스 없이 기본 감수 흐름이 가능하다.
```

---

## M5-4. QA panel

작업:

```text
- [ ] segment별 QA issue 표시
- [ ] severity 표시
- [ ] issue 해결 처리
- [ ] issue 무시 처리
```

완료 기준:

```text
QA issue를 보고 수정/해결 상태로 바꿀 수 있다.
```

---

## M5-5. Export reviewed EPUB

작업:

```text
- [ ] final_translation 우선 사용
- [ ] 없으면 reviewed_translation 사용
- [ ] 없으면 ai_translation 사용
- [ ] export 옵션 제공
```

완료 기준:

```text
감수한 내용이 EPUB export에 반영된다.
```

---

# M6. TM Engine

## 목표

과거 번역 예문을 저장하고, 새 번역 시 유사 예문을 참고하게 한다.

## 패키지

```text
packages/tm-core
```

---

## M6-1. tm_units schema 구현

필드:

```text
id
project_id
book_id
chapter_id
source_text
target_text
source_hash
source_lang
target_lang
grade
translator_profile
alignment_id
approved
notes
created_at
updated_at
```

완료 기준:

```text
TM unit CRUD 가능
```

---

## M6-2. 수동 TM 등록

작업:

```text
- [ ] Review Studio에서 source/final pair를 TM 등록
- [ ] grade 선택: gold/silver/reference
- [ ] notes 입력
```

완료 기준:

```text
사용자가 감수한 문장을 gold TM으로 등록할 수 있다.
```

---

## M6-3. Exact / fuzzy search

초기 구현:

```text
- exact hash match
- normalized text 포함 검색
- 간단한 token overlap score
```

후속 구현:

```text
- embedding similarity
- FTS5
- glossary overlap boost
```

완료 기준:

```text
새 segment 번역 시 관련 TM 예문 3~5개를 찾을 수 있다.
```

---

## M6-4. Prompt integration

프롬프트 형식:

```text
TM EXAMPLES:
[gold, similarity 0.84]
EN: He was a Vor lord, after all.
KO: 어쨌든 그는 보르 귀족이었다.
```

완료 기준:

```text
TM 예문이 있는 segment에서 번역 스타일과 용어가 더 일관된다.
```

---

## M6-5. TM Manager UI

기능:

```text
- [ ] TM 검색
- [ ] grade 필터
- [ ] book/chapter 필터
- [ ] TM 수정
- [ ] TM 삭제 또는 rejected 처리
- [ ] CSV export
```

완료 기준:

```text
TM을 GUI에서 관리할 수 있다.
```

---

# M7. Alignment Engine

## 목표

기존 영어 원문과 한국어 번역본을 정렬하여 TM을 구축한다.

## 패키지

```text
packages/aligner
```

---

## M7-1. Bilingual import

작업:

```text
- [ ] 같은 book에 영어 source_document 추가
- [ ] 같은 book에 한국어 reference_translation 추가
- [ ] 각각 text_blocks 추출
- [ ] lang 구분 저장
```

완료 기준:

```text
한 권의 영어 문단과 한국어 문단을 동시에 DB에 저장할 수 있다.
```

---

## M7-2. Chapter matching

초기 전략:

```text
- spine 순서 기반 매칭
- 제목 normalize 후 유사도 비교
- chapter count 비교
```

작업:

```text
- [ ] chapter candidate pair 생성
- [ ] confidence 계산
- [ ] mismatch 표시
```

완료 기준:

```text
대부분의 챕터가 자동으로 대응된다.
```

---

## M7-3. Paragraph alignment v1

초기 전략:

```text
- 문단 순서 유지 가정
- source/target 문단 길이 비율 사용
- dynamic programming으로 1:1, 1:N, N:1 매칭
```

작업:

```text
- [ ] paragraph length normalize
- [ ] candidate pair 생성
- [ ] confidence score
- [ ] alignment table 저장
```

완료 기준:

```text
문단 단위 rough alignment 가능
```

---

## M7-4. Alignment review UI

기능:

```text
- [ ] 영어 문단 / 한국어 문단 나란히 표시
- [ ] confidence 표시
- [ ] 승인
- [ ] 거부
- [ ] 병합
- [ ] 분할
- [ ] 다음 low-confidence 이동
```

완료 기준:

```text
사용자가 자동 정렬 실패 구간을 수동 보정할 수 있다.
```

---

## M7-5. Approved alignment → TM

작업:

```text
- [ ] approved alignment를 tm_units로 변환
- [ ] phase1 대상은 gold 후보
- [ ] phase2 대상은 silver/reference 기본값
- [ ] 사용자가 grade 조정 가능
```

완료 기준:

```text
Shards of Honor / Barrayar 같은 기존 번역권에서 TM 구축 가능
```

---

## M7-6. Alignment 개선 v2

후속 작업:

```text
- [ ] sentence splitter
- [ ] embedding similarity
- [ ] proper noun overlap
- [ ] glossary term overlap
- [ ] chapter title translation 후보
```

완료 기준:

```text
의역이 많은 구간에서도 후보 정렬 품질이 개선된다.
```

---

# M8. Series Memory

## 목표

장편 시리즈 번역의 장기 일관성을 유지한다.

---

## M8-1. Stylebook editor

작업:

```text
- [ ] stylebook_entries table
- [ ] markdown editor
- [ ] stylebook versioning
- [ ] prompt에 stylebook summary 삽입
```

완료 기준:

```text
사용자가 시리즈 번역 스타일 규칙을 직접 관리할 수 있다.
```

---

## M8-2. Character profiles

작업:

```text
- [ ] character_profiles table
- [ ] 인물명/별칭/한국어 표기 관리
- [ ] speech_style 관리
- [ ] relationship_notes 관리
- [ ] honorific_rules 관리
```

완료 기준:

```text
주요 인물의 말투와 호칭 규칙을 번역 prompt에 반영할 수 있다.
```

---

## M8-3. Chapter summary memory

작업:

```text
- [ ] 챕터 번역 완료 후 요약 생성
- [ ] 주요 사건/인물/용어 저장
- [ ] 다음 챕터 번역 시 이전 요약 삽입
```

완료 기준:

```text
긴 권에서도 앞 사건과 용어를 일정 수준 유지할 수 있다.
```

---

## M8-4. Term memory 자동 후보

작업:

```text
- [ ] 반복 등장하는 대문자/고유명사 후보 추출
- [ ] 미등록 glossary 후보 표시
- [ ] 사용자가 승인하면 glossary 등록
```

완료 기준:

```text
새로운 인명/지명/함선명 후보를 놓치지 않는다.
```

---

# M9. QA / Export / Packaging

## 목표

번역 품질 검사와 최종 배포 가능한 앱 패키징을 강화한다.

---

## M9-1. QA Engine 확장

검사 항목:

```text
- glossary_mismatch
- forbidden_term
- untranslated_english
- number_mismatch
- quote_mismatch
- paragraph_count_mismatch
- suspicious_expansion
- suspicious_compression
- name_inconsistency
- honorific_warning
```

완료 기준:

```text
Review Studio에서 주요 오류를 사전에 확인할 수 있다.
```

---

## M9-2. QA Report export

출력:

```text
qa_report.md
qa_report.html
qa_report.csv
```

포함 내용:

```text
- 권 제목
- 전체 segment 수
- issue 수
- severity별 통계
- glossary mismatch 목록
- unresolved issue 목록
```

완료 기준:

```text
최종 감수 전 점검용 보고서를 export할 수 있다.
```

---

## M9-3. Export 옵션 강화

옵션:

```text
- draft EPUB
- reviewed EPUB
- final EPUB
- bilingual Markdown
- bilingual CSV
- glossary CSV
- TM CSV
```

완료 기준:

```text
번역 결과를 여러 형식으로 내보낼 수 있다.
```

---

## M9-4. App packaging

작업:

```text
- [ ] electron-builder 또는 electron-forge 설정
- [ ] Windows installer 생성
- [ ] macOS build 옵션 검토
- [ ] app data path 정리
- [ ] auto update는 초기 제외
```

완료 기준:

```text
Windows에서 설치 가능한 앱 파일 생성
```

---

# 6. IPC API 설계

Electron renderer는 직접 filesystem/DB/API에 접근하지 않는다.

preload를 통해 제한된 API만 노출한다.

## 6.1 Project API

```ts
window.sts.project.create(input)
window.sts.project.list()
window.sts.project.open(projectId)
window.sts.project.delete(projectId)
```

## 6.2 Book API

```ts
window.sts.book.importEpub(projectId, filePath)
window.sts.book.list(projectId)
window.sts.book.get(bookId)
window.sts.book.extractBlocks(bookId)
```

## 6.3 Translation API

```ts
window.sts.translation.createJob(input)
window.sts.translation.startJob(jobId)
window.sts.translation.pauseJob(jobId)
window.sts.translation.resumeJob(jobId)
window.sts.translation.cancelJob(jobId)
window.sts.translation.onProgress(callback)
```

## 6.4 Segment API

```ts
window.sts.segment.list(jobId, filter)
window.sts.segment.get(segmentId)
window.sts.segment.updateFinalTranslation(segmentId, text)
window.sts.segment.approve(segmentId)
```

## 6.5 Glossary API

```ts
window.sts.glossary.list(projectId)
window.sts.glossary.create(input)
window.sts.glossary.update(termId, input)
window.sts.glossary.delete(termId)
window.sts.glossary.importCsv(projectId, filePath)
window.sts.glossary.exportCsv(projectId)
```

## 6.6 TM API

```ts
window.sts.tm.search(projectId, query)
window.sts.tm.create(input)
window.sts.tm.update(tmId, input)
window.sts.tm.reject(tmId)
```

---

# 7. DB Migration 계획

## 7.1 Migration 파일 규칙

```text
packages/db/migrations/
 ├─ 0001_initial.sql
 ├─ 0002_glossary.sql
 ├─ 0003_translation_jobs.sql
 ├─ 0004_tm.sql
 ├─ 0005_alignment.sql
 └─ 0006_series_memory.sql
```

## 7.2 Migration 적용 규칙

```text
- 앱 시작 시 현재 schema_version 확인
- 적용되지 않은 migration 순서대로 실행
- migration 실패 시 앱 시작 중단
- migration 전 DB 백업 옵션 제공
```

---

# 8. 테스트 계획

## 8.1 Unit test

대상:

```text
- hash utility
- EPUB path resolver
- OPF parser
- text block extractor
- cache key generator
- glossary hit detection
- TM search score
- QA checker
```

## 8.2 Integration test

대상:

```text
- EPUB import → text_blocks 저장
- text_blocks → mock translation → EPUB rebuild
- glossary CSV import → prompt context 생성
- job pause/resume
```

## 8.3 Golden sample test

샘플 데이터:

```text
samples/epubs/simple.epub
samples/epubs/with_toc.epub
samples/epubs/with_inline_tags.epub
samples/glossary/basic.csv
```

검증:

```text
- block 수가 예상과 일치
- export EPUB가 열림
- 번역문이 지정 위치에 삽입됨
- 원본 이미지/CSS가 보존됨
```

---

# 9. 개발 순서 상세

## Sprint 1: 앱 뼈대와 DB

목표:

```text
앱 실행 + 프로젝트 생성 + DB 저장
```

작업:

```text
- M0-1 pnpm workspace
- M0-2 Electron React Vite
- M0-3 common types
- M0-4 SQLite connection
- Project create/list UI
```

완료 기준:

```text
새 프로젝트를 만들면 workspace와 project.sqlite가 생성된다.
```

---

## Sprint 2: EPUB import

목표:

```text
EPUB를 드래그앤드롭해서 본문 문단을 추출한다.
```

작업:

```text
- M1-1 EPUB unpack
- M1-2 OPF/spine parser
- M1-3 text block extraction
- M1-4 DB 저장
- Book detail UI
```

완료 기준:

```text
EPUB 본문 문단 목록을 앱에서 볼 수 있다.
```

---

## Sprint 3: Mock translation과 EPUB rebuild

목표:

```text
실제 AI 없이도 EPUB 재생성 파이프라인을 검증한다.
```

작업:

```text
- mock provider
- translation_segments 생성
- 모든 문단을 '[KO] 원문' 형태로 치환
- M1-5 EPUB rebuild
```

완료 기준:

```text
치환된 EPUB가 뷰어에서 정상적으로 열린다.
```

---

## Sprint 4: Vertex AI 연결

목표:

```text
실제 AI 번역을 segment 단위로 실행한다.
```

작업:

```text
- M2-1 provider interface
- M2-2 Vertex AI provider
- M2-3 prompt v1
- M2-4 segment translation
```

완료 기준:

```text
한 챕터를 실제 한국어로 번역할 수 있다.
```

---

## Sprint 5: Job/cache/resume

목표:

```text
긴 책 번역을 안정적으로 돌린다.
```

작업:

```text
- M3-1 job 상태 머신
- M3-2 segment 상태 머신
- M3-3 cache key
- M3-4 resume logic
- M3-5 progress event
```

완료 기준:

```text
번역 도중 앱 종료 후 재실행해도 이어서 번역한다.
```

---

## Sprint 6: Glossary

목표:

```text
용어집을 번역 prompt에 반영한다.
```

작업:

```text
- M4-1 schema
- M4-2 CSV import/export
- M4-3 hit detection
- M4-4 prompt integration
- M4-5 mismatch QA
- M4-6 glossary UI
```

완료 기준:

```text
glossary에 등록한 고유명사가 번역문에 유지된다.
```

---

## Sprint 7: Review Studio MVP

목표:

```text
사람이 번역문을 감수할 수 있다.
```

작업:

```text
- M5-1 segment list
- M5-2 editor
- M5-3 shortcut
- M5-4 QA panel
- M5-5 reviewed EPUB export
```

완료 기준:

```text
수정한 번역문이 최종 EPUB에 반영된다.
```

---

## Sprint 8: TM 수동 등록

목표:

```text
감수한 문장을 TM으로 축적한다.
```

작업:

```text
- M6-1 schema
- M6-2 수동 TM 등록
- M6-3 exact/fuzzy search
- M6-4 prompt integration
- M6-5 TM manager UI
```

완료 기준:

```text
새 segment 번역 시 기존 TM 예문이 prompt에 들어간다.
```

---

## Sprint 9: Alignment v1

목표:

```text
기존 영어/한국어 번역권에서 TM을 만든다.
```

작업:

```text
- M7-1 bilingual import
- M7-2 chapter matching
- M7-3 paragraph alignment v1
- M7-4 alignment review UI
- M7-5 approved alignment to TM
```

완료 기준:

```text
기존 번역권에서 승인된 TM을 구축할 수 있다.
```

---

## Sprint 10: Series memory

목표:

```text
장편 시리즈 일관성을 강화한다.
```

작업:

```text
- M8-1 stylebook editor
- M8-2 character profiles
- M8-3 chapter summary memory
- M8-4 term memory candidate
```

완료 기준:

```text
stylebook/character profile이 번역 prompt에 반영된다.
```

---

# 10. 우선순위가 낮은 기능

초기에는 하지 않는다.

```text
- MOBI/AZW3 직접 지원
- PDF/OCR 번역
- 만화 이미지 번역
- TTS 오디오북 생성
- cloud sync
- multi-user collaboration
- auto update
- plugin system
- mobile app
```

이 기능들은 EPUB 번역 + glossary + TM + review workflow가 안정화된 뒤 검토한다.

---

# 11. 위험 요소와 대응

## 11.1 EPUB 구조 다양성

문제:

```text
EPUB마다 XHTML 구조, nav, CSS, inline tag가 다르다.
```

대응:

```text
- 처음에는 단순 EPUB 샘플 기준으로 구현
- 실패 EPUB를 fixtures에 추가
- extractor/rebuilder를 테스트 기반으로 개선
```

---

## 11.2 AI 응답 JSON 깨짐

문제:

```text
모델이 JSON schema를 어길 수 있다.
```

대응:

```text
- Zod validation
- JSON repair 1회 시도
- 실패 시 재시도
- 계속 실패하면 segment error 저장
```

---

## 11.3 번역 비용 증가

문제:

```text
장편 전체 번역 시 API 비용이 커진다.
```

대응:

```text
- cache 필수
- chapter 단위 실행
- dry run / estimate mode
- glossary/TM context 길이 제한
- 재번역 범위 선택
```

---

## 11.4 정렬 품질 부족

문제:

```text
기존 번역본이 의역되어 문단 대응이 어렵다.
```

대응:

```text
- confidence 표시
- low-confidence만 수동 보정
- 1:N, N:1 alignment 지원
- embedding similarity는 v2로 분리
```

---

## 11.5 감수 UI 복잡도

문제:

```text
원문, AI 번역, 기존 번역, TM, glossary, QA를 한 화면에 넣으면 UI가 복잡해진다.
```

대응:

```text
- MVP는 원문/AI/final 3패널만 시작
- 사이드패널은 접기 가능
- TM/glossary/QA는 탭으로 분리
```

---

# 12. Definition of Done

각 기능은 다음 조건을 만족해야 완료로 본다.

```text
- TypeScript compile 통과
- unit test 또는 최소 integration test 존재
- DB migration 포함
- 에러 처리 포함
- 로그에 민감정보 없음
- UI에서 실패 상태 확인 가능
- 샘플 EPUB로 수동 검증 완료
```

번역 관련 기능은 추가로 다음을 만족해야 한다.

```text
- segment 단위 저장
- 중복 API 호출 방지
- 실패 segment 재시도 가능
- raw response_json 저장
- prompt version 기록
```

---

# 13. 첫 번째 실제 구현 목표

가장 먼저 달성해야 할 목표는 이것이다.

```text
영어 EPUB를 드래그앤드롭한다.
본문 문단을 추출한다.
Mock provider로 문단을 치환한다.
치환된 EPUB를 다시 export한다.
```

이 목표가 중요한 이유:

```text
- AI 비용 없이 EPUB 파이프라인을 검증할 수 있다.
- 앱 구조와 DB 구조를 빠르게 검증할 수 있다.
- 이후 Vertex AI를 붙여도 export 안정성을 유지할 수 있다.
```

첫 성공 기준:

```text
sample.epub → sample.mock.ko.epub
```

그리고 EPUB 뷰어에서 열었을 때 다음이 유지되어야 한다.

```text
- 목차
- 챕터 순서
- 문단 순서
- 이미지
- CSS
- 기본 metadata
```

---

# 14. GitHub Issue 분해 예시

## Epic: EPUB Core

```text
#1 Setup pnpm monorepo
#2 Setup Electron + React + Vite
#3 Add SQLite migration runner
#4 Implement EPUB unzip and container.xml parser
#5 Implement OPF manifest/spine parser
#6 Implement XHTML text block extractor
#7 Persist books/chapters/text_blocks to SQLite
#8 Implement mock translation job
#9 Implement EPUB rebuild
#10 Validate rebuilt EPUB with sample file
```

## Epic: Translation MVP

```text
#11 Define TranslationProvider interface
#12 Implement mock provider
#13 Implement Vertex AI provider
#14 Add literary-ko-v1 prompt template
#15 Add structured JSON response validation
#16 Persist translation_segments
#17 Export translated EPUB using ai_translation
```

## Epic: Job Stability

```text
#18 Implement translation_jobs state machine
#19 Implement segment state machine
#20 Implement cache key generation
#21 Add translation cache table
#22 Implement resume logic
#23 Add progress IPC events
#24 Add pause/resume/cancel UI
```

## Epic: Glossary

```text
#25 Add glossary_terms schema
#26 Implement glossary CSV import
#27 Implement glossary hit detection
#28 Inject glossary hits into prompt
#29 Implement glossary mismatch QA
#30 Build glossary manager UI
```

## Epic: Review Studio

```text
#31 Build segment list UI
#32 Build source/translation/final editor
#33 Add save and approve workflow
#34 Add keyboard shortcuts
#35 Add QA issue panel
#36 Export reviewed EPUB
```

## Epic: TM

```text
#37 Add tm_units schema
#38 Add manual TM registration from Review Studio
#39 Implement basic TM search
#40 Inject TM examples into prompt
#41 Build TM manager UI
```

## Epic: Alignment

```text
#42 Add bilingual document import
#43 Implement chapter matching
#44 Implement paragraph alignment v1
#45 Build alignment review UI
#46 Convert approved alignments to TM units
```

---

# 15. 개발 중 판단 기준

무엇을 먼저 할지 헷갈리면 다음 기준을 적용한다.

## 15.1 우선순위 1

```text
EPUB import/export 안정성
```

번역 품질보다 먼저다. EPUB가 깨지면 앱의 의미가 없다.

## 15.2 우선순위 2

```text
cache/resume 안정성
```

장편 번역은 오래 걸린다. 중간에 날아가면 안 된다.

## 15.3 우선순위 3

```text
glossary 일관성
```

시리즈 번역에서 가장 눈에 띄는 품질 문제는 고유명사 흔들림이다.

## 15.4 우선순위 4

```text
Review Studio 사용성
```

AI 번역은 최종물이 아니라 초벌이다. 감수 흐름이 편해야 한다.

## 15.5 우선순위 5

```text
TM / alignment 고도화
```

이건 차별화 포인트지만, EPUB 번역 MVP 이후에 붙여야 한다.

---

# 16. 최종 로드맵 요약

```text
Step 1. 앱 뼈대 생성
Step 2. EPUB 추출/재생성 성공
Step 3. Mock 번역으로 전체 파이프라인 검증
Step 4. Vertex AI 번역 연결
Step 5. Cache/resume 안정화
Step 6. Glossary 적용
Step 7. Review Studio 구현
Step 8. TM 수동 등록/검색
Step 9. 기존 번역권 alignment
Step 10. Series memory와 QA 고도화
```

최종적으로는 다음 사용 흐름을 지원한다.

```text
Phase 1:
신뢰 가능한 기존 번역권으로 TM/glossary/stylebook 구축

Phase 2:
기존 번역이 있는 권은 AI 번역과 기존 번역을 비교 감수하면서 자산 확장

Phase 3:
한국 미발간권을 누적된 TM/glossary/stylebook 기반으로 본격 번역
```

---

## 17. 당장 시작할 첫 명령 수준 작업

실제 개발 첫날 작업은 다음 정도면 충분하다.

```bash
mkdir series-translation-studio
cd series-translation-studio
pnpm init
mkdir -p apps/desktop packages/common packages/db packages/epub-core docs samples/epubs
```

그 다음 바로 해야 할 일:

```text
1. pnpm workspace 구성
2. Electron + React 실행
3. SQLite 연결
4. Project 생성 버튼 만들기
5. EPUB 파일 선택/드래그앤드롭
6. EPUB unpack 결과를 workspace에 저장
```

첫날의 목표는 번역이 아니다.

첫날의 목표는 이것이다.

```text
앱이 켜지고,
프로젝트를 만들고,
EPUB를 넣으면,
내부 workspace에 안전하게 import된다.
```

이게 되면 이후 개발이 훨씬 안정적으로 진행된다.
