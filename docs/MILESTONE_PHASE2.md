# myLore 리팩터링 마일스톤 (Phase 2 & Gemini HTTP 클라이언트 전환 — 완료 기록)

> 이 문서는 백엔드 도메인 모듈 분리(Phase 1) 및 경로·DB·정규식·단위 테스트·지연 로딩 개선(Phase 1.5)에 이어 **완료된 Phase 2 마일스톤(Gemini `ureq` HTTP 클라이언트 전환 및 `src/App.tsx` 4단계 모듈 분리)** 결과를 기록합니다.

---

## 1. 완료된 마일스톤 요약

- **Phase 0 & 1 (`30e7881`)**: `src-tauri/src/lib.rs`(11,222줄)를 35개 도메인 모듈 파일(각 750줄 이하)로 분리, `AGENTS.md` 및 `docs/CODEMAP.md` 작성
- **Phase 1.5 (`a3e80c8`, `a11a4f7`)**:
  1. 개인 경로(`C:\Users\iseoh\...`, `c:\git\myLore\dist`) 및 하드코딩된 Wi-Fi SSID 제거, 현재 연결된 Wi-Fi SSID·비밀번호·인증방식 자동 탐지(`netsh wlan show interfaces`, `netsh wlan show profile ... key=clear`) 및 Tauri 내장 `asset_resolver` 적용 (`myLoreSync` `0387190`에서 `ACTION_WIFI_ADD_NETWORKS` 영구 등록 + 다중 IP 폴링 재시도 결합)
  2. SQLite 메타 DB를 `%APPDATA%\com.iseohyun.mylore\mylore_meta.db`로 이동 (기존 OneDrive DB 존재 시 `VACUUM INTO`로 1회 무손실 자동 마이그레이션)
  3. `cached_regex!` 매크로(`std::sync::LazyLock<Regex>`) 도입 및 36곳 정규식 1회 컴파일 캐시 적용
  4. `xlsx` 동적 `import('xlsx')` 지연 로딩 적용 (초기 메인 번들 `720.66 kB → 391.96 kB` 감소)
  5. 모바일 동기화 진행률 600ms 폴링 제거 및 `mobile-sync-progress` Tauri `listen` 이벤트로 일원화
  6. `lifelog::parse`, `lifelog::contacts`, `mobile::pairing`, `paths` 단위 테스트 23개 추가 (`cargo test --lib` 전원 통과)
- **Phase 2 (본 마일스톤 완료)**:
  1. **Gemini API 클라이언트 `ureq` 전환 (추천안 B-3 적용 완료)**: `src-tauri/src/gemini/client.rs`에서 `curl.exe` 서브프로세스 및 `?key=` URL 쿼리 파라미터, `%TEMP%` 임시 요청 파일 생성을 제거하고, `ureq 3.5` (`native-tls-no-default` + `PlatformVerifier` + `x-goog-api-key` 헤더 + 인메모리 요청 바디 전송)로 전환 완료.
  2. **`src/App.tsx` 4단계 분리 (Step 2A ~ 2D 완료)**: 기존 **11,115줄** 단일 파일이던 `src/App.tsx`를 **267줄**(-97.6%)로 축소하고, **24개 UI 컴포넌트(`src/components/**`)**와 **9개 커스텀 훅(`src/hooks/**`)**으로 분리 완료 (모든 추출 파일 ≤ 708줄, Rules of Hooks 위반 수정, 모바일 라이프로그 4,000건 필터링 `useMemo` 적용, 전역 단축키 `useRef` 리스너 최적화, 미사용 데드 코드 제거).

---

## 2. Gemini API 키 전달 방식 실측 비교 및 채택안 (추천안 B-3)

현재 [`src-tauri/src/gemini/client.rs`](../src-tauri/src/gemini/client.rs)는 `curl.exe` 서브프로세스를 호출하면서 URL 쿼리(`?key=AIza...`)에 API 키를 넣고 있어, 요청 중 **Windows 작업 관리자 명령줄 / WMI `Win32_Process.CommandLine`**에 API 키가 평문으로 노출됩니다.

### 2.1 바이너리 크기 · 클린 빌드 시간 · 의존성 수 비교 (`cargo build --release`)

| 구성 | 릴리즈 `.exe` 크기 | `base_curl` 대비 증가량 | 클린 빌드 시간 | 의존 크레이트 수 (`cargo tree`) | 추가 크레이트 수 |
|---|---:|---:|---:|---:|---:|
| **A. `base_curl` (`curl.exe -H @hdr.txt`)** | **1.40 MiB** (1,465,045 B) | 기준 (0 B) | **6.4 s** | 6개 | **+0개** |
| **B-1. `ureq` 기본 (`rustls` + `gzip`)** | 5.22 MiB (5,472,807 B) | **+3.82 MiB** (+4,007,762 B) | 21.2 s | 31개 | +25개 (`ring`, `rustls`, `webpki-roots` 등) |
| **B-2. `ureq` (`native-tls` + `gzip`)** | 2.95 MiB (3,097,104 B) | **+1.56 MiB** (+1,632,059 B) | 19.5 s | 31개 | +25개 (`schannel`, `native-tls` 등) |
| **B-3. `ureq` (`native-tls-no-default` + `gzip`)** | **2.83 MiB** (2,967,192 B) | **+1.43 MiB** (+1,502,147 B) | 19.3 s | 30개 | +24개 (`webpki-root-certs` 제외, OS 인증서 저장소 사용) |

> **구현 시 주의사항**: `ureq = { version = "3.5", default-features = false, features = ["native-tls-no-default", "gzip"] }`와 함께 `TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier)` 및 `.http_status_as_error(false)` 설정을 명시해야 Windows Schannel + OS 루트 인증서 저장소 및 4xx 에러 본문 파싱이 정상 동작합니다.

### 2.2 요청 지연 시간(Latency) 및 보안·안정성 비교

| 항목 | 방식 A: `curl.exe -H @header_file` | 방식 B-3: `ureq` (`native-tls-no-default`) | 방식 B-1: `ureq` (`rustls` 기본) |
|---|---|---|---|
| **첫 요청 (Cold, ms)** | 249 ~ 615 ms (프로세스 생성 포함) | 156 ~ 159 ms | 138 ~ 146 ms |
| **이후 요청 중앙값 (Median, ms)** | **205 ~ 209 ms** | **115 ~ 120 ms** (Agent 재사용 시) | **74 ~ 135 ms** (Agent 재사용 시) |
| **작업 관리자 / WMI 명령줄 노출** | **노출 안 됨** (`-H @C:\...\Temp\...` 경로만 보임) | **노출 안 됨** (서브프로세스 없음) | **노출 안 됨** (서브프로세스 없음) |
| **디스크 임시 파일 노출** | 요청 중 `%TEMP%`에 헤더 파일이 수백 ms 동안 존재 | **없음** (API 키와 오디오 base64가 프로세스 메모리 안에서만 처리됨) | **없음** |
| **대용량 통화 녹음(수십 MB) 전송** | 요청 본문(`--data-binary @body.json`)도 임시 파일 1회 기록 후 전송 | 메모리 버퍼(`serde_json::to_vec`)에서 소켓으로 직접 스트리밍 | 메모리 버퍼에서 직접 스트리밍 |

---

## 3. `src/App.tsx` 단계별 분리 계획안 (Phase 2A ~ 2D)

현재 [`src/App.tsx`](../src/App.tsx)는 **11,115줄**(UTF-8 기준)의 단일 파일이며, `useState` **97개**(`App` 96개 + `DetachedPreviewWindowView` 1개), `useEffect` **21개**, `useMemo` **15개**, `useRef` **17개**, 인라인 스타일(`style={{`) **392곳**을 포함하고 있습니다.

### 3.1 주요 구조 개선 포인트

1. **Rules of Hooks 위반 해소 (`src/App.tsx` L412–420)**:
   - `if (isDetachedPreviewWindow) return <DetachedPreviewWindowView />;` 조기 반환을 얇은 루트 래퍼 컴포넌트로 분리하여 모든 훅이 고정된 순서로 호출되도록 수정합니다.
2. **전역 단축키 `useEffect` (337줄) 리스너 재등록 방지**:
   - 의존성 배열의 `bodyText` 때문에 매 타이핑마다 `keydown` 리스너를 재등록하는 문제를 `useRef` 기반 `useKeybindings` 훅으로 해결합니다.
3. **상단 메뉴바 7개 (955줄) 선언형 컴포넌트화**:
   - 파일·편집·선택·보기·이동·실행·대시보드 메뉴를 데이터 배열 + `<MenuBar />`로 통합합니다.
4. **JSX 내부 즉시실행함수(IIFE) 9곳 `useMemo` 전환**:
   - 우측 휴대폰 사이드바 등에서 최대 4,000건의 메시지를 매 렌더마다 필터·정렬하는 연산을 메모이제이션합니다.

### 3.2 목표 디렉터리 구조 (모든 파일 ≤ 700줄)

```
src/
├─ main.tsx                              (9줄)
├─ App.tsx                               (~450줄: 최상위 레이아웃 조합 + 루트 분기)
├─ components/
│   ├─ window/
│   │   └─ DetachedPreviewWindowView.tsx (~220줄, 의존성 0)
│   ├─ header/
│   │   ├─ AppHeader.tsx                 (~180줄: 메뉴바 + 탭바 + 우측 아이콘 조합)
│   │   ├─ MenuBar.tsx                   (~260줄: 7개 메뉴 선언형 렌더링)
│   │   └─ DocTabsBar.tsx                (~90줄)
│   ├─ dashboards/
│   │   ├─ DiaryDashboard.tsx            (~120줄)
│   │   ├─ FinanceDashboard.tsx          (~300줄: 거래내역 표 + 엑셀 업로드 핸들러)
│   │   ├─ LifelogDashboard.tsx          (~350줄: 헤더·동기화 카드 + 탭 컨테이너)
│   │   ├─ LifelogSettingsTab.tsx        (~600줄: QR·페어링·통합 설정 표·Gemini 키)
│   │   ├─ LifelogMobileDataTab.tsx      (~300줄: 휴대폰 데이터 테이블)
│   │   ├─ SettingsDashboard.tsx         (~620줄: 글꼴·테마·스크롤·통화·에디터·베이스폴더)
│   │   └─ SyncProgressCard.tsx          (~110줄: 대시보드·사이드바 공용 진행률 카드)
│   ├─ editor/
│   │   ├─ DocumentWorkspace.tsx         (~280줄: 찾기바·YAML·배너·에디터·뷰어 조합)
│   │   ├─ SmsBubbleView.tsx             (~230줄: SMS 전환 바 + 말풍선 뷰)
│   │   └─ ProjectSubDocsPanel.tsx       (~210줄: 프로젝트 하위 문서 카드/표)
│   ├─ sidebar/
│   │   ├─ RightSidebar.tsx              (~260줄: 탭 헤더 + 검색·목차·백링크·일기라이프로그)
│   │   ├─ FileTreePanel.tsx             (~620줄: 프로젝트·일기·아카이브·Git 폴더 트리)
│   │   └─ MobileLifelogSidebar.tsx      (~580줄: 휴대폰 메시지 리스트 + 아이템 렌더러)
│   ├─ footer/
│   │   └─ StatusBar.tsx                 (~170줄: 스캔 진행률 + 통화 오디오 플레이어 + 상태바)
│   └─ modals/
│       ├─ CommandPaletteModal.tsx       (~100줄)
│       ├─ CalendarNewDocModal.tsx       (~170줄)
│       ├─ ShortcutsHelpModal.tsx        (~190줄)
│       ├─ DocumentModals.tsx            (~240줄: 이름변경·줄이동·새프로젝트·승격·템플릿)
│       └─ ContextMenus.tsx              (~270줄: 일반 컨텍스트 메뉴 + 휴대폰 컨텍스트 메뉴)
└─ hooks/
    ├─ useKeybindings.ts                 (~380줄: 단축키 상태·localStorage·전역 keydown 리스너)
    ├─ useDocuments.ts                   (~520줄: 탭·문서 열기/저장/닫기·자동저장·세션 복원)
    ├─ useFileTree.ts                    (~260줄: 트리 로드·필터·폴더 열림 상태·파생 트리 memo)
    └─ useLifelogAudio.ts                (~220줄: 통화 오디오 로드·시간 동기화·큐 파싱)
```

### 3.3 4단계 실행 로드맵

| 단계 | 작업 내용 | 추출 줄 수 | 완료 후 `App.tsx` 잔여 줄 수 | 위험도 |
|---|---|---:|---:|---|
| **Step 2A: 독립 뷰 & 모달/하단바 분리** | 1) `DetachedPreviewWindowView` 분리 + Rules of Hooks 수정<br>2) 모달 8종(`CommandPalette`, `CalendarNewDoc`, `ShortcutsHelp`, `DocumentModals`) 및 `ContextMenus`, `StatusBar` 추출<br>3) 미사용 죽은 코드 제거 | 약 1,650줄 | ~9,450줄 | **매우 낮음** |
| **Step 2B: 4대 대시보드 분리** | 1) `SettingsDashboard` (1,128줄)<br>2) `FinanceDashboard` (238줄 + 엑셀 업로드)<br>3) `DiaryDashboard` (93줄)<br>4) `LifelogDashboard` + 하위 탭 2종 + 공용 `SyncProgressCard` | 약 2,640줄 | ~6,800줄 | **낮음** |
| **Step 2C: 상단 메뉴바·사이드바·에디터 뷰 분리** | 1) 7개 메뉴 → 데이터 기반 `MenuBar` + `DocTabsBar` + `AppHeader`<br>2) `MobileLifelogSidebar` + `FileTreePanel` + `RightSidebar`<br>3) `DocumentWorkspace` (`SmsBubbleView`, `ProjectSubDocsPanel` 포함) | 약 4,150줄 | ~2,650줄 | **중간** |
| **Step 2D: 커스텀 훅 분리** | 1) `useKeybindings`<br>2) `useFileTree`, `useLifelogAudio`, `useDocuments` 추출 | 약 2,200줄 | **~450줄** | **중간** |


---

## 4. Phase 3 향후 마일스톤 로드맵 (연락처 메모 AI 컨텍스트 연동 & 라이프로그 [설정/대화/기록] 아키텍처)

### 4.1 AI 개인화 참고 설정(`aiUserProfile`) 및 연락처 + 연락처 메모 AI 컨텍스트 확장
- **1단계 (구현 완료)**:
  - `MyLoreAppSettings`에 `aiUserProfile`(기본값: `"이름: 정서현, 출생년도: 1983, 거주지: 거제, 출생지: 서울, 취미: 수영"`) 및 `aiDailyTokenLimit`(기본값: `1,000,000`)을 추가.
  - 통화 녹음(`transcribe_call_audio_with_gemini`) 및 음성메모·회의 녹음(`transcribe_voice_recording_with_gemini`) 분석 시 프롬프트에 `[👤 사용자(통화/녹음 당사자 '나') 개인화 참고 정보]` 섹션을 자동 첨부하여 사용자 본인 이름(`정서현`, `서현`)이 상대방 이름(예: `대원`)이나 유사 발음 인명으로 오인식되는 오류를 방지.
- **2단계 (Phase 3 예정 — 연락처 및 연락처 메모 AI 연동)**:
  - `연락처_주소록.md` 및 연락처 DB 스키마를 확장하여 각 연락처별 **관계·호칭·직책·소속·특이사항 메모(`contact_memo`)** 및 **명함 OCR 정보**를 저장.
  - 특정 인물과의 통화 녹음 스크립트화, 카톡/문자 요약, 일정 추출 시 **사용자 개인화 프로필(`aiUserProfile`) + 해당 통화 상대방의 연락처 정보 및 메모(`contact_memo`)**를 함께 Gemini 프롬프트에 주입하여 맥락 기반 고정밀 AI 분석을 수행.

### 4.2 라이프로그 대시보드 `설정 / 대화 / 기록` 3단 탭 구조 및 미디어·명함 아카이브 고도화
- **현재 UI 구조 (`LifelogDashboard.tsx` + `LifelogRecordsTab.tsx` 반영 완료)**:
  - `⚙️ 설정` (`LifelogSettingsTab.tsx`): QR 페어링, NAT Wi-Fi 자격 증명, Gemini API 키, AI 개인화 참고 설정(`aiUserProfile`), 일일 예상 토큰 한도 및 `AI: XX.X%` 잔여 백분율 표시.
  - `💬 대화` (`LifelogMobileDataTab.tsx`): 카카오톡, 문자(SMS/MMS), 통화 이력, 앱 알림, 삼성 헬스 등 시계열 대화·이벤트 로그 통합 조회.
  - `🗂️ 기록` (`LifelogRecordsTab.tsx`):
    1. **🖼️ 사진첩 (`photos`)**: 모바일에서 수집된 이미지 미디어 그리드 뷰 및 원본 문서 연동.
    2. **🎬 동영상기록 (`videos`)**: 모바일에서 수집된 동영상 미디어 인라인 재생 및 원본 문서 연동.
    3. **🎙️ 음성녹음 (`recordings`)**: 독백 음성메모·회의 녹음·통화 녹음 통합 관리 및 4단계 AI 스크립트 상태 제어.
    4. **📇 연락처+명함 (`contacts`)**: 동기화된 연락처 주소록 조회, 누적 대화/통화 집계, 향후 연락처별 AI 메모 및 명함 스캔 관리.
