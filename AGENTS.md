# AGENTS.md — myLore 에이전트 진입 가이드

> 이 파일은 LLM 코딩 에이전트(Antigravity, Gemini CLI, Codex, Cursor, Copilot 등)가 **가장 먼저 자동으로 읽는 진입점**입니다.
> 여기에는 전체 구조와 작업 규칙만 짧게 적고, 자세한 함수 색인은 [`docs/CODEMAP.md`](./docs/CODEMAP.md)에 둡니다.
> 프로젝트 정책(CSS·버전 관리 등)은 [`.agents/rules/project_architecture.md`](./.agents/rules/project_architecture.md)를 따릅니다.

## 1. 프로젝트 한 줄 요약

Tauri v2 데스크톱 앱: **Rust 백엔드(`src-tauri/src/`) + React/TypeScript 프론트엔드(`src/`) + SQLite**.
개인 지식 관리(마크다운 볼트, `mylore://` UUID 링크), 일기/구글 캘린더, 모바일 라이프로그(카톡·문자·통화·녹음·헬스), 가계부, Gemini 통화 녹음 스크립트화.
안드로이드 동반 앱은 별도 저장소 `c:\git\myLoreSync`(Kotlin)이며, 로컬 HTTP(포트 18443)로 데이터를 보냅니다.

## 2. 규모 (2026-11-07 기준)

| 영역 | 파일 | 줄 수 | 비고 |
|---|---|---|---|
| Rust 백엔드 | 52 | 약 27,370 | 모든 파일 ≤ 997줄 (단위 테스트 29개 / 3개 파일 포함, 컴파일 경고 0개) |
| TSX/TS 프론트엔드 | 61 | 약 33,900 | `App.tsx` (413줄) + 컴포넌트 45개(`src/components/**`) + 훅 9개(`src/hooks/**`) — 모든 파일 ≤ 995줄 |
| CSS | 1 | 약 2,000 | `src/styles/app.css` |

## 3. 진입점과 데이터 흐름

```
[UI] src/main.tsx → src/App.tsx (413줄: DetachedPreviewWindowView 분기 + MainApp 조합)
        ├─ hooks/      useFileTree · useLifelogAudio · useDocuments · useDocumentActions ·
        │              useLifelogAndFinance · useEditorCommands · useDetachedPreviewAndSettings ·
        │              useAppStartup · useKeybindings
        ├─ components/ header/ · dashboards/(Diary, Finance, Lifelog, ContactsDashboardView, Settings(10개 서브 대시보드·기본 설정 트리), HelpDashboard, LoginDashboard, AiQueueSection, VoiceprintSection(2탭 서버/Sync 녹음), ApprovalDashboard, CallScriptAbComparisonPanel(통화 ASR/후처리 병렬 비교·동기 스크롤·Space 재생·대사 분리/결합), callScriptCompareUtils, ContactProfileApprovalPanel, LogDashboard) · editor/ · sidebar/(ActivityBar, RightSidebar, SidebarSearchPanel, ApprovalSidebarContent, MobileLifelogSidebar, SidebarSpecialTabs) · footer/ · modals/(ContextMenus, CallScriptCompareModal 등) · window/
        │  invoke("snake_case_command")      (래퍼: src/services/tauriClient.ts, 타입: src/types/mylore.ts)
        ▼
[Rust] src-tauri/src/main.rs → lib.rs::run()  (generate_handler! 에 커맨드 98개 등록)
        ├─ vault/      문서·스캔·마크다운·휴지통
        ├─ calendar_sync.rs Google Calendar API v3 양방향 동기화(OAuth 2.0 PKCE 로컬 콜백, 신규 일정 업로드, 시작 시/F5 일정 다운로드)
        ├─ lifelog/    연락처(인원별 .md+UUID·인물 서술 AI 프로필·소속 모임·음성지문 요약 컨텍스트)·contact_evolution(단일 프롬프트 수락/수정 진화·결재)·파서·녹음·카톡·백필·조회·pc_activity(ActivityWatch 연동)·media_and_location(원본 해시 DB·GPS/Wi-Fi 동선) (+ parse_tests.rs)
        ├─ gemini/     Gemini API 클라이언트(ureq + native-tls)·자동 스크립트화·multi_llm(Claude/GPT/Grok 다중 LLM 연동 및 $ 크레딧 잔액 관리)·voiceprint(2종 오픈소스 CAM++·ResNet34 교차검증 음성지문)·call_ab_review(통화 녹음 ASR+성문·후처리 재작성·폐기 옵션)·postprocess_pipeline(후처리 프롬프트·사용자 편집 로그·4단계 상태·ASR 부분 재처리)
        ├─ mobile/     페어링(현재 Wi-Fi SSID·비밀번호 자동 탐지)·인증·저장소·진행률·헬스·ack_state (+ pairing_tests.rs)
        │   ├─ http_server/  URL 라우팅(mod.rs) → routes_core / routes_sync / routes_media (session-plan, complete, ack, location-logs 포함)
        │   └─ sync_worker/  큐·배치 루프(mod.rs) → jobs_messages / jobs_meta / jobs_files
        ├─ logger.rs   4대 분야 로그 수집(%APPDATA%\com.iseohyun.mylore\logs\{분야}_YYYYMMDD.log · comm/version/system/ai) 및 보관일(통신 7일 / 기타 30일) 자동 정리
        ├─ paths.rs    메타 DB(%APPDATA%\com.iseohyun.mylore)·기본 폴더 해석·레거시 DB 이전 (+ paths_tests.rs)
        ├─ settings.rs · window.rs · system.rs · finance.rs · util.rs (cached_regex!)
        ├─ models.rs (공용 DTO) · state.rs (AppState)
        └─ db.rs       SQLite 연결·스키마·마이그레이션 (모든 모듈이 open_db 사용)
```

## 4. 작업별 시작 위치

| 작업 | 위치 |
|---|---|
| 프론트엔드 → 백엔드 호출 추적 | `tauriClient.ts`의 함수 → 같은 이름의 Rust `#[tauri::command]` (`docs/CODEMAP.md`에서 검색) |
| 새 Tauri 커맨드 | 도메인 모듈에 `#[tauri::command] pub(crate) fn` → `lib.rs` `generate_handler!` 등록 → `tauriClient.ts` 래퍼 → `types/mylore.ts` 타입 |
| 모바일 엔드포인트 추가/수정 | `mobile/http_server/mod.rs` 라우팅 표 → `routes_*.rs`의 `handle_*` (무거운 처리는 `enqueue_sync_worker_job` → `sync_worker/jobs_*.rs`) |
| DB 스키마 | `db.rs` (`create_schema`, `apply_column_migrations`) |
| 설정 항목 | `settings.rs` (`MyLoreAppSettings`, `default_*`) ↔ `types/mylore.ts` |
| 스타일 | `src/styles/app.css`만 사용 (인라인 스타일·CSS 모듈 추가 금지) |

## 5. 코드 규칙

- 백엔드 모듈은 첫 줄 `use crate::*;` 로 공용 네임스페이스를 공유합니다. 다른 모듈에서 쓰는 항목은 `pub(crate)`로 선언합니다.
- **파일당 1,000줄 이하.** 새 기능을 `App.tsx`에 덧붙이지 말고 새 컴포넌트/모듈 파일로 분리합니다.
- 파일·모듈·커맨드를 추가하거나 옮기면 `docs/CODEMAP.md`와 이 파일의 3장을 함께 갱신합니다.
- 검색할 때 `node_modules/`, `dist/`, `src-tauri/target/`(약 5 GB), 루트 `mylore.exe`는 제외합니다.
- **프로젝트 볼트 문서 규약 (`Projects/프로젝트_문서_규약.md`)**:
  - `Projects/main.md`(전역 현황) → `Projects/{project}/main.md`(`## 개론` + `|미션|진행율|비고|링크|`) → `Projects/{project}/{submission}.md`(`|task ID|진행 사항|내용|개선내용|`) 3계층 구조를 준수합니다.
  - 서브미션 표의 `진행 사항`은 `[대기중 | 수정중 | 수정 후 확인 대기 | YYYY-MM-DD hh:mm:ss]` 4단계로 관리하며, AI가 작업을 완료했을 때는 `수정 후 확인 대기`로 표기하고 `개선내용`을 작성합니다(사용자 최종 확인 시에만 시각 기입).

## 6. 검증 명령 (Windows PowerShell)

```powershell
npm.cmd run build                          # tsc 타입 검사 + Vite 빌드 → dist/ (백엔드가 include_str!로 참조하므로 먼저 실행)
cd src-tauri; cargo check                  # Rust 컴파일 검사 (기존 경고 2개: safe_stem, dev_name 미사용 필드)
cd src-tauri; cargo test --lib             # 파서·페어링·경로 단위 테스트 (23 passed)
cd src-tauri; cargo build                  # target/debug/mylore.exe (run-dev.bat에서 실행)
```

## 7. 완료된 리팩터링 마일스톤 ([`docs/MILESTONE_PHASE2.md`](./docs/MILESTONE_PHASE2.md))

- **Phase 0 & 1**: 백엔드 `src-tauri/src/lib.rs`(11,222줄)를 35개 도메인 모듈로 분리
- **Phase 1.5**: 개인 경로 제거, 메타 DB `%APPDATA%` 이전, 정규식 캐시(`cached_regex!`), `xlsx` 지연 로딩, 600ms 폴링 제거, 단위 테스트 23개 추가, QR Wi-Fi 자격 증명 자동 포함
- **Phase 2**: Gemini 호출 `ureq` (`native-tls-no-default` + `PlatformVerifier` + `x-goog-api-key` 헤더) 전환 및 프론트엔드 `src/App.tsx`(11,115줄 → 267줄) 24개 컴포넌트·9개 커스텀 훅 분리 완료
