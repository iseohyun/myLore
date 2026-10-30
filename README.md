---
uuid: "236d14d4-0e82-4757-8145-cd6c65ec67cb"
---
# myLore

Tauri v2 (`Rust` + `React/TypeScript` + `SQLite`) 기반의 개인 지식 관리(PKM), 프로젝트(`main.md`), 다이어리/구글 캘린더, 모바일 라이프로그 및 가계부 통합 데스크톱 애플리케이션입니다.

## 주요 기능

- **3대 베이스 볼트 연동**: `Projects` (`main.md` 허브 & `.myLore/templates`), `Diary` (일기 & Google 캘린더), `Data` (아카이브)
- **불변 UUID 백링크 시스템**: 파일명이나 폴더 경로가 변경되어도 깨지지 않는 `mylore://doc/{uuid}` 영구 링크 및 이어하기(Resume) 일괄 스캔
- **다중 문서 탭 & 마크다운/HTML 뷰어**: CommonMark + GFM(표, 가로줄, 체크리스트) + Raw HTML 패스스루 실시간 렌더링
- **F1~F12 기능키 및 VSCode 스타일 상단 메뉴**:
  - `F1`: 도움말 (단축키 설정)
  - `F2`: 현재 문서 제목 변경 (UUID 및 백링크 유지)
  - `F3` / `F4`: 목록 이전 / 다음 선택 (검색 결과 또는 파일 트리)
  - `F5`: UUID 재스캔
  - `F6`: 프로젝트 대시보드
  - `F7`: 구글 캘린더 싱크 및 열기 (Chrome 연동)
  - `F8`: 라이프로그 수집 대쉬보드
  - `F9`: 프로그램 수행 (추후 업데이트 예정)
  - `F10`: 상단 메뉴 열기 (`Alt` 배지 지원)
  - `F11`: 전체 화면 토글
  - `F12`: 개발자모드 (DevTools)
- **라이프로그 & 가계부 3단계 자동화**: 모바일 카카오톡 백업 파싱, 실시간 금융 알림(1단계) 및 엑셀 명세서 대조·확정(3단계)

## 프로젝트 구조

> 기능별 파일·함수 색인은 **[코드 지도 (docs/CODEMAP.md)](./docs/CODEMAP.md)** 를 먼저 확인하세요.

```
myLore/
├─ src/                          # 프론트엔드 (React + TypeScript)
│  ├─ App.tsx                    # 루트 컴포넌트 (메뉴·탭·에디터·사이드바·대쉬보드·모달)
│  ├─ services/tauriClient.ts    # Rust 커맨드 invoke() 래퍼
│  ├─ types/mylore.ts            # 백엔드 DTO 대응 타입
│  ├─ utils/                     # 마크다운 렌더러 / 자동 서식
│  └─ styles/app.css             # 단일 중앙 집중형 CSS
├─ src-tauri/src/                # 백엔드 (Rust, Tauri v2)
│  ├─ lib.rs                     # run(): 앱 초기화 + generate_handler! 커맨드 등록
│  ├─ models.rs / state.rs       # 공용 DTO / AppState
│  ├─ settings.rs                # setting.json 설정 모델·커맨드
│  ├─ db.rs                      # SQLite 연결·스키마·마이그레이션·시드
│  ├─ vault/                     # markdown, scan, documents, trash
│  ├─ lifelog/                   # contacts, parse, recordings, kakao, backfill, commands
│  ├─ gemini/                    # client(API·모델 폴백·쿼터), transcription(자동 스크립트화)
│  ├─ mobile/                    # pairing, auth, storage, progress, health
│  │  ├─ http_server/            # mod.rs(URL 라우팅) + routes_core / routes_sync / routes_media
│  │  └─ sync_worker/            # mod.rs(큐·배치 루프) + jobs_messages / jobs_meta / jobs_files
│  ├─ finance.rs / window.rs / system.rs / util.rs
│  └─ main.rs
└─ docs/CODEMAP.md               # 코드 지도
```

> 코드 규칙과 작업별 시작 위치는 [AGENTS.md](./AGENTS.md)에 정리되어 있습니다. (LLM 에이전트가 자동으로 읽는 진입점이며, 사람이 읽어도 됩니다)

## 개발 & 빌드

```powershell
npm.cmd install                         # 최초 1회
npm.cmd run build                       # 프론트엔드 타입 검사 + Vite 빌드 (dist/)
cd src-tauri; cargo check               # 백엔드 컴파일 검사
cd src-tauri; cargo build               # 디버그 실행 파일 (target/debug/mylore.exe)
npx.cmd tauri build                     # 배포용 빌드 (beforeBuildCommand로 프론트엔드 자동 빌드)
```

- `run-dev.bat`: 루트의 `mylore.exe`가 있으면 그것을, 없으면 `src-tauri/target/debug/mylore.exe`를 실행합니다.
- 백엔드는 빌드할 때 `dist/index.html`을 포함하므로(`include_str!`) **프론트엔드를 먼저 빌드**해야 합니다.

## 관련 설계 문서
- [에이전트 진입 가이드 (AGENTS.md)](./AGENTS.md)
- [코드 지도 (docs/CODEMAP.md)](./docs/CODEMAP.md)
- [시스템 아키텍처 설계서 (DESIGN.md)](./DESIGN.md)
- [안드로이드 동반 앱 연동 설계서 (연동앱설계.md)](./연동앱설계.md)
