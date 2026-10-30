# AGENTS.md — myLore 에이전트 진입 가이드

> 이 파일은 LLM 코딩 에이전트(Antigravity, Gemini CLI, Codex, Cursor, Copilot 등)가 **가장 먼저 자동으로 읽는 진입점**입니다.
> 여기에는 전체 구조와 작업 규칙만 짧게 적고, 자세한 함수 색인은 [`docs/CODEMAP.md`](./docs/CODEMAP.md)에 둡니다.
> 프로젝트 정책(CSS·버전 관리 등)은 [`.agents/rules/project_architecture.md`](./.agents/rules/project_architecture.md)를 따릅니다.

## 1. 프로젝트 한 줄 요약

Tauri v2 데스크톱 앱: **Rust 백엔드(`src-tauri/src/`) + React/TypeScript 프론트엔드(`src/`) + SQLite**.
개인 지식 관리(마크다운 볼트, `mylore://` UUID 링크), 일기/구글 캘린더, 모바일 라이프로그(카톡·문자·통화·녹음·헬스), 가계부, Gemini 통화 녹음 스크립트화.
안드로이드 동반 앱은 별도 저장소 `c:\git\myLoreSync`(Kotlin)이며, 로컬 HTTP(포트 18443)로 데이터를 보냅니다.

## 2. 규모 (2026-10-30 기준)

| 영역 | 파일 | 줄 수 | 비고 |
|---|---|---|---|
| Rust 백엔드 | 40 | 약 11,600 | 파일당 최대 약 750줄 |
| TSX/TS 프론트엔드 | 8 | 약 13,500 | ⚠️ `src/App.tsx` 하나가 **11,128줄 (약 43만 자)** |
| CSS | 1 | 약 1,600 | `src/styles/app.css` |

> [!WARNING]
> `src/App.tsx`는 한 번에 읽을 수 없는 크기입니다. **파일 전체를 읽지 말고** `docs/CODEMAP.md` 3.1절의 검색 키워드로 해당 구간만 찾아 읽으세요.

## 3. 진입점과 데이터 흐름

```
[UI] src/main.tsx → src/App.tsx
        │  invoke("snake_case_command")      (래퍼: src/services/tauriClient.ts, 타입: src/types/mylore.ts)
        ▼
[Rust] src-tauri/src/main.rs → lib.rs::run()  (generate_handler! 에 커맨드 56개 등록)
        ├─ vault/      문서·스캔·마크다운·휴지통
        ├─ lifelog/    연락처·파서·녹음·카톡·백필·조회
        ├─ gemini/     Gemini API 클라이언트·자동 스크립트화
        ├─ mobile/     페어링·인증·저장소·진행률·헬스
        │   ├─ http_server/  URL 라우팅(mod.rs) → routes_core / routes_sync / routes_media
        │   └─ sync_worker/  큐·배치 루프(mod.rs) → jobs_messages / jobs_meta / jobs_files
        ├─ settings.rs · window.rs · system.rs · finance.rs · util.rs
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

## 6. 검증 명령 (Windows PowerShell)

```powershell
npm.cmd run build                          # tsc 타입 검사 + Vite 빌드 → dist/ (백엔드가 include_str!로 참조하므로 먼저 실행)
cd src-tauri; cargo check                  # Rust 컴파일 검사 (기존 경고 2개: safe_stem, dev_name 미사용 필드)
cd src-tauri; cargo build                  # target/debug/mylore.exe (run-dev.bat에서 실행)
```

## 7. 알려진 기술 부채 (수정 전 사용자 확인 필요)

- `src/App.tsx` 단일 컴포넌트 분리 (상태 97개, 인라인 스타일 392곳)
- 개인 경로 하드코딩: `C:\Users\iseoh\OneDrive\...`, `c:\git\myLore\dist`, Wi-Fi 이름 `iseohyun`/`seohyun5G`
- SQLite DB(WAL)가 OneDrive 폴더(`OneDrive\Projects\.myLore\mylore_meta.db`)에 있음 → `%APPDATA%`로 이전 검토
- Gemini 호출이 `curl` 서브프로세스 + URL 쿼리에 API 키 포함
