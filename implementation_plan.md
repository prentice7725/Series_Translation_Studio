# Series Translation Studio Implementation Plan

버전: v3.0  
업데이트일: 2026-05-11  
기준 문서:

- `series_translation_studio_prd_design_revised.md`
- `sts_uiux_spec_revised.md`

이번 개정의 핵심은 초기 개발 범위를 다시 작게 자르는 것이다. 기존 계획은 Phase 2의 AI Editorial / spoiler-safe 흐름을 너무 앞에 두고 있었고, 실제 제품 리스크인 EPUB round-trip 안정화와 번역 job resume을 충분히 분리하지 못했다. 앞으로의 기준은 다음 순서다.

```text
MVP-0 EPUB round-trip
→ MVP-1 실제 번역 실행
→ MVP-2 최소 감수
→ MVP-3 Glossary 적용
→ Post-MVP: TM / Alignment / AI Editorial / spoiler-safe / Series Memory
```

---

## 0. 현재 구현 상태 요약

이 섹션은 2026-05-11 현재 코드베이스 기준이다.

### 0.1 한 줄 판단

```text
프로젝트는 이미 MVP-0~MVP-3의 핵심 뼈대와 일부 Post-MVP 기능까지 구현되어 있다.
다만 새 PRD의 완료 기준으로 보면 "작동 초안"과 "제품 완료" 사이의 빈칸이 남아 있다.
```

### 0.2 현재 코드와 PRD 대조

| 영역 | 새 PRD 기준 | 현재 상태 | 판단 |
|---|---|---:|---|
| Monorepo / Electron | pnpm workspace, Electron + React + TS | `apps/desktop`, `packages/*` 구성 완료 | 완료 |
| SQLite project DB | project/book/document/block/job/segment 저장 | `packages/db` + migrations `0001~0011` 구현 | 완료 |
| MVP-0 EPUB import | EPUB unpack, OPF/spine, XHTML block extraction | `epub-core` + `book:importEpub` 구현 | 대부분 완료 |
| MVP-0 EPUB rebuild | 원본 구조 보존, mimetype 첫 항목 무압축 | `rebuildEpub`, custom ZIP writer, validation 구현 | 대부분 완료 |
| MVP-0 roundtrip report | `roundtrip_report.json`, `manifest.json` | `book:exportM1`에서 산출 시작 | 부분 완료 |
| MVP-1 provider | Vertex AI Gemini 우선, mock 가능 | `vertex-provider`, `MockTranslationProvider` 구현 | 완료 |
| MVP-1 translation job | block/chunk 번역, cache, retry, progress, resume | `translation_jobs`, `translation_segments`, cache key, progress event 구현 | 부분 완료 |
| MVP-1 전체 권 번역 | 영어 EPUB 1권 전체 draft 생성 | `translateBookForProject`가 책 전체 chapter/block 기준으로 실행 | 1차 완료 |
| MVP-1 TXT export | draft TXT 산출물 | `export:draftTxt`와 Export UI 버튼 구현 | 1차 완료 |
| MVP-2 최소 감수 | segment list, source/translation 2-pane, final 저장 | renderer `ReviewView`, `review:updateFinalTranslation` 구현 | 부분 완료 |
| MVP-2 reviewed/final export | final_translation 기반 EPUB export | draft/reviewed/final mode 선택과 파일명 분리 구현 | 1차 완료 |
| MVP-3 Glossary | CSV import/export, hit detection, prompt injection, mismatch QA | `glossary-core`, UI, DB 구현 | 대부분 완료 |
| TM Manager | 수동 등록, fuzzy search, prompt insertion | `tm-core`, DB, UI 일부 구현 | Post-MVP 초안 있음 |
| Alignment | Embedding + LLM Judge + 사용자 확정 | local heuristic/DP alignment 초안 있음, embedding/judge cache 없음 | 새 PRD와 차이 큼 |
| AI Editorial | MVP 이후 | 이미 `editorial-core`, job, decision, gold_candidate 등록 구현 | Post-MVP 초안 있음 |
| spoiler-safe | MVP 이후 | summary/export/API 일부 구현 | Post-MVP 초안 있음 |
| Post-read correction | MVP 이후 | search/correction/TM promotion 구현 | Post-MVP 초안 있음 |
| Series Memory | MVP 이후 | stylebook/character/chapter memory DB/API 구현 | Post-MVP 초안 있음 |
| Cost & Usage | MVP 이후, job별부터 | translation job token 합산 + env 단가 기반 비용 추정 표시 | 1차 완료 |
| Privacy / 동의 이력 | 책별/프로젝트별 동의 정책 | `external_transfer_consents` 기록 + Settings 최근 이력 표시 | 1차 완료 |
| UI/UX | 고밀도 CAT/IDE형 IA | 새 IA 기반 renderer 개편 완료 | 1차 반영 |

### 0.3 현재 구현된 주요 파일

```text
apps/desktop/src-main/index.ts
  - Electron main process
  - project/book import/export
  - translation/editorial/spoiler-safe/review/post-read/alignment/memory IPC

apps/desktop/src-preload/index.ts
  - window.sts bridge

apps/desktop/src-renderer/src/main.tsx
  - 새 UI IA 반영: Home / Books / Translation / Review / Memory / Alignment / Export / Settings

apps/desktop/src-renderer/src/styles.css
  - 새 UI/UX spec 기반 고밀도 데스크톱 스타일

packages/epub-core
  - EPUB unpack / OPF parsing / text block extraction / rebuild / validation

packages/translator-core
  - prompt, structured JSON parsing, cache key, provider interface

packages/vertex-provider
  - Vertex AI translation/editorial provider

packages/glossary-core
  - glossary hit detection, CSV import/export, mismatch validation

packages/tm-core
  - exact/fuzzy TM search, grade weighting, prompt section

packages/editorial-core
  - AI Editorial prompt, response parser, gold_candidate 판단

packages/db
  - project DB repositories and migrations
```

---

## 1. 개발 원칙

### 1.1 제품 원칙

```text
1. 먼저 EPUB를 안전하게 뜯고 다시 봉합한다.
2. 번역 API 품질보다 구조 보존과 재개 가능성이 먼저다.
3. 초기 MVP는 사용자가 실제로 읽을 draft EPUB를 만드는 데 집중한다.
4. 자동 결과는 확정값이 아니라 검토 후보다.
5. Alignment의 챕터 매핑은 반드시 사용자 확정 단계를 가진다.
6. 생성 EPUB와 프로젝트 데이터는 개인 감상용이며 배포/공유를 전제로 하지 않는다.
```

### 1.2 기술 원칙

```text
1. 로컬 우선 데스크톱 앱으로 만든다.
2. 원본 EPUB 구조, CSS, 이미지, 폰트, metadata를 최대한 보존한다.
3. 모든 긴 작업은 job으로 관리하고 중단 후 재개 가능해야 한다.
4. AI 호출은 prompt/config/context/hash를 저장해 재현성을 확보한다.
5. cache는 translation / embedding / judge를 분리한다.
6. provider 실패는 유형별로 retry / pause / user action으로 나눈다.
7. 본문 외부 전송 전에는 전송 범위와 개인용 사용 정책을 명확히 알린다.
```

---

## 2. 새 Milestone 구조

### Milestone 1: Phase 0 MVP-0~MVP-2 안정화

목표:

```text
영어 EPUB 1권을 import → round-trip 검증 → 실제 번역 → 최소 감수 → EPUB export까지 처리한다.
```

포함:

- MVP-0 EPUB round-trip
- MVP-1 실제 번역 실행
- MVP-2 최소 감수

현재 상태:

```text
구현 초안 있음. 제품 완료를 위해 report/export mode/job UX 보강 필요.
```

### Milestone 2: MVP-3 Glossary 적용

목표:

```text
사용자가 관리하는 glossary가 번역 prompt와 QA warning에 반영된다.
```

현재 상태:

```text
대부분 구현됨. UX와 edge case 검증 필요.
```

### Milestone 3: TM DB와 수동 검색

목표:

```text
사용자 승인 번역 예문을 TM으로 저장하고 이후 번역 prompt에 활용한다.
```

현재 상태:

```text
핵심 구현 있음. 새 PRD에서는 Post-MVP로 분류한다.
```

### Milestone 4a: Embedding Service

목표:

```text
영-한 문단/챕터 임베딩을 생성하고 embedding_cache.sqlite에 저장한다.
```

현재 상태:

```text
미구현. 현재 alignment는 heuristic/DP/local LLM 초안에 가깝다.
```

### Milestone 4b: Chapter Alignment

목표:

```text
챕터 후보를 임베딩 + 보조 신호 + LLM Judge로 제안하고 사용자가 확정한다.
```

현재 상태:

```text
본문 시작 후보/preview UI는 있음. chapter_alignments 테이블, LLM Judge cache, 확정 workflow는 미구현.
```

### Milestone 4c: Paragraph Alignment

목표:

```text
확정된 챕터 내부에서 1:1 / 1:N / N:1 / N:M / skip paragraph alignment를 제안한다.
```

현재 상태:

```text
alignment_pairs 초안과 DP 기반 정렬이 있음. 새 PRD가 요구하는 embedding matrix, low-confidence window judge, mapping type 저장은 미구현.
```

### Milestone 5: Review Studio 고도화

목표:

```text
MVP-2의 2-pane 감수를 3/4-pane Review Studio로 확장한다.
```

현재 상태:

```text
MVP-2 2-pane 중심으로 개편됨. TM/glossary/reference side panel은 추후.
```

### Milestone 6: Series Memory

목표:

```text
stylebook, character profile, chapter memory를 번역 context에 반영한다.
```

현재 상태:

```text
DB/API 초안 있음. UI는 새 개편에서 MVP 범위 밖으로 밀어둔 상태.
```

---

## 3. MVP-0: EPUB Round-trip

### 3.1 목표

번역 API 호출 없이도 EPUB를 안전하게 import/rebuild할 수 있음을 검증한다.

### 3.2 요구 기능

```text
- EPUB file import
- EPUB unpack
- mimetype 검증
- META-INF/container.xml 분석
- OPF / manifest / spine / nav/toc 기본 분석
- XHTML text block extraction
- dummy translation 또는 marker 삽입
- EPUB rebuild
- 원본 CSS / 이미지 / 폰트 / metadata 보존
- roundtrip_report.json 생성
- manifest.json 생성
```

### 3.3 현재 구현 상태

완료:

```text
- `unpackEpub`
- `validateEpubFile`
- `findRootfilePath`
- `parseOpf`
- `extractTextBlocks`
- `copyEpubToWorkspace`
- `rebuildEpub`
- mimetype 첫 항목 ZIP writer
- project workspace import/export flow
- Books 화면에서 Round-trip 실행 버튼
- `book:exportM1` 실행 후 `manifest.json` / `roundtrip_report.json` 산출
- output EPUB를 다시 unpack하여 원본 extracted 파일 manifest와 비교
- Export 화면에서 round-trip report 요약 viewer 표시
```

미완료 / 보강 필요:

```text
- nav/toc 상세 검증 report
- asset 누락 비교 report
- inline markup 보존 수준(Level 0~2) 정책 반영
- drag-and-drop UI. 현재는 file dialog 중심
- Books 화면 쪽 inline report viewer
```

### 3.4 완료 기준

```text
- 원본 EPUB를 import한 뒤 dummy/marker 적용 EPUB를 생성한다.
- mimetype entry가 첫 번째이며 무압축이다.
- container.xml, OPF, spine, nav/toc가 깨지지 않는다.
- 이미지/CSS/font asset 누락이 report에 표시된다.
- 변경된 XHTML 파일, 변경 block 수, 변경 사유가 roundtrip_report.json에 기록된다.
```

### 3.5 다음 작업

```text
- [x] `book:exportM1` 결과에 report path / manifest path 포함
- [x] rebuild 전/후 file manifest 비교
- [ ] RoundTripReport 공용 타입 추가
- [ ] OPF/spine/nav/toc 상세 검증 결과 확장
- [x] renderer Export 화면에 report viewer 추가
- [ ] Books 화면에도 최근 report 요약 연결
- [ ] inline markup 보존 Level 0~2 선택값 설계
```

---

## 4. MVP-1: 실제 번역 실행

### 4.1 목표

Vertex AI provider를 붙여 block 단위 실제 번역을 수행하고 draft EPUB/TXT를 생성한다.

### 4.2 요구 기능

```text
- Vertex AI provider 연결
- project default model 설정
- 기본 translation prompt
- structured JSON response parsing
- translation cache
- retry/backoff
- provider 실패 유형별 retry / pause
- job progress 표시
- pause / resume / cancel
- translated.draft.epub 생성
- translated.draft.txt 생성
```

### 4.3 현재 구현 상태

완료:

```text
- `TranslationProvider` interface
- `VertexTranslationProvider`
- `MockTranslationProvider`
- `literaryKoPrompt`
- structured JSON parser
- `createTranslationCacheKey`
- `translation_jobs`, `translation_segments`
- progress IPC event
- pause/resume/cancel IPC
- draft EPUB export
- provider validation
```

부분 완료:

```text
- cache/resume는 segment/prompt_hash 기반으로 작동하나 별도 translation_cache 파일은 없음
- retry/backoff는 Vertex provider 레벨에 있음. job policy UI는 없음
- 번역 runner는 `translateBookForProject`로 정리되어 책 전체 chapter/block 기준으로 실행됨
- 비용/token usage는 response_json 기반 job summary로 1차 표시됨
```

미완료:

```text
- draft TXT export 1차 구현 완료
- provider failure type별 사용자 action UI 1차 구현 완료
- 책별 외부 전송 동의 저장 정책 1차 구현 완료
- 전체 권 번역 성능/대용량 검증
```

### 4.4 다음 작업

```text
- [x] `translateFirstChapterForProject`를 전체 권 기준 `translateBookForProject`로 재정리
- [ ] chapter 범위/전체 권 범위 선택 옵션 추가
- [x] translated.draft.txt export 추가
- [x] provider error taxonomy를 job status/error UI에 노출
- [x] book/project 단위 외부 전송 동의 기록 테이블 또는 settings 추가
- [x] token usage / estimated cost를 job progress summary에 추가
```

---

## 5. MVP-2: 최소 감수

### 5.1 목표

사용자가 생성된 번역문을 segment 단위로 수정하고 `final_translation`으로 저장한 뒤 final EPUB를 만들 수 있게 한다.

### 5.2 요구 기능

```text
- segment list
- source text / translation editor 2-pane
- reviewed_translation / final_translation 저장
- segment 상태 관리
- 저장 / 승인하고 다음 단축키
- reviewed / final EPUB export
```

### 5.3 현재 구현 상태

완료:

```text
- `review:listSegments`
- `review:updateFinalTranslation`
- segment list UI
- source/final 2-pane editor
- QA issue 표시
- final_translation 기반 EPUB regenerate
```

부분 완료:

```text
- reviewed_translation 별도 사용보다 final_translation 중심
- save-and-next와 기본 keyboard 이동 1차 구현 완료
- draft/reviewed/final export mode 1차 구분 완료. mode별 fallback 정책 테스트 필요
```

### 5.4 다음 작업

```text
- [x] save-and-next 동작 추가
- [x] Ctrl/Cmd+Enter 승인 단축키
- [ ] reviewed_translation과 final_translation 상태 정책 정리
- [x] Export 화면에 Draft / Reviewed / Final mode 추가
- [ ] segment filter: untranslated / translated / reviewed / error
```

---

## 6. MVP-3: Glossary

### 6.1 목표

고유명사와 반복 용어를 번역 프롬프트에 반영하고, 불일치를 QA warning으로 표시한다.

### 6.2 현재 구현 상태

완료:

```text
- `glossary_terms` migration/repository
- CSV import/export
- glossary hit detection
- prompt section builder
- forbidden target / mismatch validation
- glossaryVersionHash
- renderer Memory 화면에서 간단 CRUD
```

보강 필요:

```text
- context_rules UI
- do_not_translate / needs_review UI
- 충돌 발생 segment로 점프
- TBX/TMX export는 MVP 범위 밖
```

### 6.3 다음 작업

```text
- [ ] Glossary row drawer 또는 상세 편집
- [ ] category/filter/search
- [ ] needs_review 후보 표시
- [ ] QA issue에서 해당 glossary term으로 이동
```

---

## 7. Post-MVP 기능 현황

새 PRD에서는 다음 기능들을 MVP 이후로 분리한다. 다만 현재 코드에는 이미 초안이 들어가 있으므로, 버리지 말고 PRD 기준에 맞게 재정렬한다.

### 7.1 TM Manager

현재 구현:

```text
- `tm_units`
- manual TM save/delete/promote/reject
- exact/fuzzy search
- grade weighting
- prompt insertion
- CSV export
```

남은 작업:

```text
- [ ] TMX export/import
- [ ] source/target 양방향 검색 UI
- [ ] grade별 필터
- [ ] gold_candidate → gold 승인 workflow
```

### 7.2 Alignment Engine

현재 구현:

```text
- reference import
- reference_blocks / alignment_pairs
- body start preview candidate
- source/reference anchor UI
- entity/number/length 기반 heuristic
- LIS 기반 crossing anchor 제거
- windowed DP alignment
- local LLM rerank 초안
- pair promote to TM
```

새 PRD와의 차이:

```text
- text_sections 중심 DB가 없다.
- embedding_cache.sqlite가 없다.
- judge_cache.sqlite가 없다.
- chapter_alignments 테이블과 사용자 확정 상태가 없다.
- 다국어 임베딩 기반 chapter/paragraph alignment가 없다.
- LLM Alignment Judge prompt/cache/cost monitor가 없다.
- mapping type(1:1, 1:N, N:1, N:M, 1:0, 0:1)이 DB에 저장되지 않는다.
- low-confidence window review UI가 없다.
```

재정렬 방향:

```text
현재 heuristic alignment는 MVP 이후 실험 기능으로 유지한다.
정식 Alignment Engine은 Embedding Service → Chapter Alignment → Paragraph Alignment 순서로 새로 쌓는다.
```

### 7.3 AI Editorial

현재 구현:

```text
- editorial_jobs / editorial_decisions
- AI Editorial prompt/parser
- Vertex editSegment
- approve / needs_review / reject
- approve + confidence >= 0.85 → gold_candidate TM 등록
- final_translation 반영
```

새 PRD 기준 위치:

```text
MVP 이후. Phase 2 재번역/AI 편집장 감수에서 사용.
```

보강 필요:

```text
- reference alignment 결과를 segment별 reference_translation으로 연결
- AI Editorial 결과 전용 UI
- 비용 동의/추정 표시
- spoiler-safe 상태와 Review 상태 분리
```

### 7.4 Spoiler-safe / Post-read Correction

현재 구현:

```text
- book spoiler_safe_enabled
- spoilerSafe summary
- spoiler-safe EPUB export
- post_read_corrections
- 문장 검색 기반 segment 찾기
- correction 저장
- correction → gold TM promotion
```

보강 필요:

```text
- 새 UI에서는 아직 Post-read 화면을 숨긴 상태
- spoiler-safe 본문 미노출 regression test
- reveal confirmation을 정책화
- EPUB 내 segment marker 또는 더 강한 검색 UX
```

### 7.5 Series Memory

현재 구현:

```text
- stylebook_entries
- character_profiles
- chapter_memories
- prompt용 series memory section builder
```

보강 필요:

```text
- 새 UI에서 Character / Stylebook 화면 재노출
- stylebook version hash
- character relation/history 모델
- chapter summary 자동 생성 품질 개선
```

---

## 8. Database 계획

### 8.1 이미 존재하는 migration

```text
0001_initial.sql
  - projects
  - books
  - source_documents
  - chapters
  - text_blocks

0003_translation_jobs_segments.sql
  - translation_jobs
  - translation_segments

0004_glossary.sql
  - glossary_terms

0005_tm_units.sql
  - tm_units

0006_editorial_jobs_decisions.sql
  - editorial_jobs
  - editorial_decisions

0007_spoiler_safe.sql
  - books.spoiler_safe_enabled

0008_post_read_corrections.sql
  - post_read_corrections

0009_alignment_engine.sql
  - reference_blocks
  - alignment_pairs

0010_series_memory.sql
  - stylebook_entries
  - character_profiles
  - chapter_memories

0011_reference_block_chapters.sql
  - reference_blocks chapter metadata
```

### 8.2 새 PRD 기준 추가 필요

```text
0012_text_sections.sql
  - text_sections
  - section_type: front_matter | body_chapter | back_matter | translator_note | advertisement | toc | unknown
  - body_start_candidate/confidence/reason
  - source_document_id, spine_href, section_index, block_start, block_end

0013_roundtrip_reports.sql 또는 파일 산출물
  - report metadata만 DB 저장하거나 workspace report 파일로만 관리

0014_chapter_alignments.sql
  - source_section_ids
  - reference_section_ids
  - mapping_type: 1:1 | 1:N | N:1 | N:M | excluded
  - status: proposed | needs_review | approved | rejected
  - confidence, judge_response_json, approved_at

0015_paragraph_alignment_shape.sql
  - alignment_pairs에 mapping_type, source_span, reference_span, judge_response_json 추가

embedding_cache.sqlite
  - embeddings(text_hash, model_id, model_version, dim, vector, created_at)

judge_cache.sqlite
  - judge_cache(cache_key, scope, input_hash, prompt_version, model, response_json, created_at)

consent_settings
  - project/book/task scope별 외부 전송 동의 이력
```

---

## 9. UI 구현 계획

### 9.1 현재 반영된 화면

```text
- Sidebar IA
- Project Home
- Books / round-trip action
- Translation job monitor
- Minimal Review Studio 2-pane
- Memory: Glossary / TM
- Alignment 초안 화면
- Export
- Settings provider/privacy 요약
```

### 9.2 MVP 보강 우선순위

```text
1. Welcome / Onboarding
2. Project Selector를 사이드바 임시 폼에서 독립 화면으로 분리
3. Book Import Wizard: source EPUB, 정책 안내, import result
4. Round-trip report viewer
5. Translation Setup: provider/model, 범위, 비용 추정, 동의
6. Review Studio: save-and-next, filters, keyboard shortcuts
7. Export: Draft / Reviewed / Final mode 선택
8. Glossary 상세 편집 drawer
```

### 9.3 Post-MVP UI

```text
1. Embedding 진행 화면
2. Preprocessing & Body Start 화면
3. Chapter Alignment Review
4. Paragraph Alignment Review
5. LLM Judge Review Drawer
6. AI Editorial Result
7. Spoiler-safe Progress
8. Post-read Correction
9. Character Profiles
10. Stylebook editor
11. Cost & Usage
12. Privacy & Transfer Policy 상세
```

---

## 10. Cache 설계

### 10.1 현재 상태

```text
- translation cache key는 `createTranslationCacheKey`로 존재
- 실제 저장은 translation_segments와 prompt_hash/response_json 중심
- embedding cache 없음
- judge cache 없음
```

### 10.2 목표 구조

```text
project.sqlite
  - jobs, segments, glossary, tm, review/editorial metadata

translation_cache
  - project.sqlite 내부 segment cache로 유지 가능

embedding_cache.sqlite
  - normalized_text_hash + embedding_model_id + embedding_model_version

judge_cache.sqlite
  - judge_input_hash + judge_prompt_version + judge_model
```

---

## 11. Test 계획

### 11.1 현재 확인된 테스트

```text
- epub-core tests
- glossary-core tests
- tm-core tests
- translator-core tests
- editorial-core tests
- `pnpm build` 통과
- `pnpm test` 통과
```

### 11.2 MVP-0 추가 테스트

```text
- mimetype이 zip 첫 항목이며 무압축인지 검증
- OPF/container/nav/toc round-trip 검증
- 이미지/CSS/font asset count 비교
- XHTML namespace 보존 확인
- roundtrip_report.json snapshot test
```

### 11.3 MVP-1 추가 테스트

```text
- provider retryable error → retry
- auth/config error → paused/user action
- resume 시 완료 segment 재사용
- glossary/TM hash 변경 시 cache miss
- draft TXT export
```

### 11.4 MVP-2/3 추가 테스트

```text
- final_translation 저장 후 EPUB에 반영
- save-and-next 상태 전이
- glossary mismatch QA
- forbidden target QA
- CSV import/export round-trip
```

### 11.5 Post-MVP regression

```text
- spoiler-safe API가 source_text / translation text를 반환하지 않는지
- chapter alignment approved 전 paragraph alignment 실행 차단
- chapter alignment 되돌림 시 paragraph alignment 재계산 대상 표시
- judge cache prompt/model 변경 시 miss
```

---

## 12. 다음 개발 순서

### 12.1 바로 다음 1차 작업

```text
1. Glossary 상세 UI와 QA jump
2. segment filter: untranslated / translated / reviewed / error
3. reviewed_translation과 final_translation 상태 정책 정리
4. Provider issue별 재시도/설정 이동 action 고도화
5. Editorial job token usage summary
```

### 12.2 그 다음 작업

```text
7. Glossary 상세 UI와 QA jump
8. TM Manager 검색/필터 고도화
9. Welcome / Project Selector / Book Import Wizard 분리
10. Cost/token usage summary
```

### 12.3 Alignment 재착수 순서

```text
1. text_sections migration
2. Body Start Detector를 text_sections 기준으로 저장
3. EmbeddingService interface
4. local embedding adapter skeleton
5. embedding_cache.sqlite
6. chapter_alignments table
7. Chapter Alignment Review UI
8. LLM Judge + judge_cache.sqlite
9. paragraph alignment mapping_type 확장
10. low-confidence window review
```

---

## 13. 완료 정의

### MVP-0 Done

```text
- EPUB import/rebuild가 가능하다.
- roundtrip.epub, roundtrip_report.json, manifest.json이 생성된다.
- 기본 EPUB 구조와 asset 보존 여부를 report로 확인할 수 있다.
```

### MVP-1 Done

```text
- 영어 EPUB 1권 전체를 draft 번역할 수 있다.
- translated.draft.epub과 translated.draft.txt를 생성한다.
- provider 오류가 segment/job 단위로 retry 또는 pause 처리된다.
- 중단 후 재실행 시 완료 segment를 재사용한다.
```

### MVP-2 Done

```text
- segment 단위 final_translation 수정/승인이 가능하다.
- keyboard-first 최소 감수 흐름이 있다.
- reviewed/final EPUB export mode가 구분된다.
```

### MVP-3 Done

```text
- glossary CSV import/export가 가능하다.
- glossary hit가 prompt에 삽입된다.
- glossary mismatch/forbidden term warning이 Review Studio에 표시된다.
```

### Milestone 4 Done

```text
- text_sections, embedding_cache, judge_cache, chapter_alignments가 존재한다.
- 챕터 매핑은 사용자가 명시적으로 확정해야 한다.
- 확정된 챕터 내부 paragraph alignment만 TM 후보로 승격 가능하다.
```

---

## 14. 현재 리스크

| 리스크 | 현재 상태 | 대응 |
|---|---|---|
| EPUB round-trip 품질을 눈으로만 확인 | report 부재 | roundtrip_report 우선 구현 |
| 전체 권 번역 성능/범위 검증 필요 | `translateBookForProject` 1차 정리 완료 | 대용량 EPUB 테스트와 progress UX 점검 |
| Alignment가 새 PRD와 다른 방향 | heuristic/DP 초안 선행 | embedding/chapter 확정 구조로 재설계 |
| 외부 전송 동의 UX가 아직 confirm 중심 | 이력 저장은 구현됨 | 전용 consent dialog와 재동의 정책 추가 |
| Post-MVP 기능이 MVP UI에 섞일 가능성 | 많은 기능이 이미 IPC로 열려 있음 | IA에서 MVP/후속 기능을 명확히 분리 |
| 비용 표시 범위 제한 | translation job 기준 1차 표시 | editorial/alignment usage까지 확장 |
| inline markup 손상 가능성 | text replacement가 `set_content` 중심 | preservation level 설계와 테스트 |

---

## 15. 최종 우선순위

```text
1. EPUB round-trip report
2. 전체 권 번역 + resume 안정화
3. 최소 Review Studio 작업성
4. Glossary QA UX
5. TM Manager 고도화
6. text_sections + Embedding Service
7. Chapter Alignment 확정 workflow
8. Paragraph Alignment + LLM Judge cache
9. AI Editorial / spoiler-safe / post-read를 새 Phase 2 흐름에 재통합
```

이 계획의 현재 중심 문장은 다음이다.

```text
STS는 먼저 EPUB를 안전하게 왕복시키는 도구이고, 그다음 번역기이며,
그 이후에야 장편 시리즈 alignment/editorial studio가 된다.
```
