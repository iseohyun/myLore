# myLore Project Architecture & Styling Rules

## 1. 플랫폼 및 애플리케이션 구조 (Platform Architecture)
- **애플리케이션 형태**: **Tauri v2 (`Rust` 백엔드 + `TypeScript/React` 프론트엔드)** 기반 데스크톱 애플리케이션 (로컬 파일 시스템 직접 제어, 커스텀 URI 스키마 `mylore://` 처리, 로컬 SQLite 메타데이터 DB 내장)
- **다중 베이스 폴더 (Role-Based Multi-Root)**:
  - 물리적으로 분리된 여러 폴더를 각각 `데이터(Archive)`, `일기(Diary)`, `프로젝트(Projects)` 역할로 마운트하고 폴더별 목적을 설정하며, UI에서는 논리적으로 통합된 단일 트리(Virtual Union Tree)로 표시한다.
- **프로젝트 폴더 규칙 (`main.md` 중심)**:
  - 루트 기본 뷰어 문서는 `Projects/main.md`로 구성하며, 모든 개별 프로젝트는 `Projects/{프로젝트명}/main.md` 형태의 폴더 구조로 관리한다. (별도 대시보드 UI는 보류)
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
