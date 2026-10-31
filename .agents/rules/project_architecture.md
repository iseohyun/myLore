---
uuid: "125c7d9e-5b61-4ecc-b8e3-796683e8e393"
---
# myLore Project Architecture & Styling Rules

## 1. 플랫폼 및 애플리케이션 구조 (Platform Architecture)
- **애플리케이션 형태**: **Tauri v2 (`Rust` 백엔드 + `TypeScript/React` 프론트엔드)** 기반 데스크톱 애플리케이션 (로컬 파일 시스템 직접 제어, 커스텀 URI 스키마 `mylore://` 처리, 로컬 SQLite 메타데이터 DB 내장)
- **다중 베이스 폴더 (Role-Based Multi-Root)**:
  - 물리적으로 분리된 여러 폴더를 각각 `데이터(Archive)`, `일기(Diary)`, `프로젝트(Projects)` 역할로 마운트하고 폴더별 목적을 설정하며, UI에서는 논리적으로 통합된 단일 트리(Virtual Union Tree)로 표시한다.
- **프로젝트 폴더 규칙 (`main.md` 중심 3계층 구조)**:
  - 상세 규약은 [`C:\Users\iseoh\OneDrive\Projects\프로젝트_문서_규약.md`](file:///C:/Users/iseoh/OneDrive/Projects/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8_%EB%AC%B8%EC%84%9C_%EA%B7%9C%EC%95%BD.md) (`mylore://doc/c18f40e7-72a9-4d38-9b81-5e6c3f019d24`)를 따른다.
  - **1계층 (`Projects/main.md`)**: 전역 대시보드 (전체 프로젝트 현황만 기록).
  - **2계층 (`Projects/{project}/main.md`)**: `## 개론` + `## 🎯 서브 미션` (`|미션|진행율|비고|링크|`, 진행율은 `33%(1/3)` 형식).
  - **3계층 (`Projects/{project}/{submission}.md`)**: `|task ID|진행 사항|내용|개선내용|` 4컬럼 표로 관리하며, `진행 사항`은 `[대기중 | 수정중 | 수정 후 확인 대기 | YYYY-MM-DD hh:mm:ss]` 4단계를 준수한다. (AI가 수정 완료 시 `수정 후 확인 대기`로 설정하고 `개선내용`에 수정 내역을 적으며, 사용자 확인 후에만 완료 시각을 기입한다.)
- **가상 파일 시스템 및 식별 체계**:
  - 모든 문서와 미디어 파일은 불변하는 `UUID`로 참조(`mylore://doc/{uuid}`, `mylore://media/{uuid}`)하며, 파일 이동/이름 변경 추적에는 `Content Hash`를 사용한다.
  - 베이스 폴더 등록/초기 스캔 시 모든 `.md` 파일의 YAML Frontmatter에 `uuid`를 **초기 일괄 주입(Batch Injection)**한다.
  - 마크다운 문서의 YAML Frontmatter에 `uuid` 및 메타데이터를 저장하되, **뷰어/에디터에서는 기본적으로 YAML 영역을 숨기고 단축키를 통해서만 열람·편집**할 수 있도록 구현한다.

## 2. CSS 스타일링 정책 (CSS Architecture)
- **단일 중앙 집중형 CSS (Single Centralized CSS)**:
  - 컴포넌트별 분산 CSS나 유틸리티 프레임워크(Tailwind 등) 대신, **`src/styles/app.css`** 단일 중앙 집중형 스타일시트를 통해 디자인 토큰(CSS Variables), 레이아웃, 컴포넌트 스타일을 일관되게 관리한다.

## 3. 버전 관리 정책 (Versioning Policy)
- **정식 시맨틱 버전 (Semantic Versioning, SemVer)**:
  - 정식 시맨틱 버전(`vMajor.Minor.Patch`, 예: `v0.1.0`) 단일 체계를 사용한다.
  - 버전 업데이트 및 `CHANGELOG.md` 기록은 사용자의 사전 승인을 거쳐 반영한다.

## 4. 코드 구조 및 탐색 원칙 (Code Structure & Navigation)
- **코드 지도 우선**: 코드를 수정하기 전에 [`docs/CODEMAP.md`](../../docs/CODEMAP.md)에서 대상 파일과 함수를 먼저 찾고, 저장소 전체를 grep으로 훑지 않는다. `node_modules/`, `dist/`, `src-tauri/target/`은 검색 대상에서 제외한다.
- **파일 크기 상한**: 소스 파일 하나는 **1,000줄 이하**를 목표로 한다. 새 기능은 기존 거대 파일(`App.tsx`)에 덧붙이지 말고, 도메인 모듈이나 컴포넌트 파일을 새로 만들어 분리한다.
- **백엔드 모듈 배치**: Rust 코드는 `src-tauri/src/{vault,lifelog,gemini,mobile}/` 또는 `settings.rs`/`db.rs`/`finance.rs`/`window.rs`/`system.rs`/`util.rs` 중 해당 도메인에 둔다. `lib.rs`에는 `run()`과 `generate_handler!` 등록만 둔다.
- **코드 지도 갱신**: 파일·모듈·커맨드를 추가하거나 옮기면 `docs/CODEMAP.md`와 루트 `AGENTS.md`(구조 요약)도 같은 작업에서 갱신한다.
