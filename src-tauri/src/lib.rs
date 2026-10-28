use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressPayload {
    pub is_running: bool,
    pub phase: String, // "idle" | "prescan" | "injecting" | "done"
    pub total_files: usize,
    pub already_registered: usize,
    pub pending_files: usize,
    pub completed_files: usize,
    pub start_percent: f64,
    pub current_percent: f64,
    pub uuids_injected: usize,
    pub media_indexed: usize,
    pub links_indexed: usize,
    pub current_file: String,
    pub eta_seconds: f64,
}

impl Default for ScanProgressPayload {
    fn default() -> Self {
        Self {
            is_running: false,
            phase: "idle".to_string(),
            total_files: 0,
            already_registered: 0,
            pending_files: 0,
            completed_files: 0,
            start_percent: 0.0,
            current_percent: 0.0,
            uuids_injected: 0,
            media_indexed: 0,
            links_indexed: 0,
            current_file: String::new(),
            eta_seconds: 0.0,
        }
    }
}

pub struct AppState {
    pub db_path: PathBuf,
    pub lock: Arc<Mutex<()>>,
    pub scan_progress: Arc<Mutex<ScanProgressPayload>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseFolderConfig {
    pub id: String,
    pub role: String, // "data" | "diary" | "projects"
    pub path: String,
    pub label: String,
    pub purpose: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub uuid: String,
    pub name: String,
    pub relative_path: String,
    pub full_path: String,
    pub role: String,
    pub base_folder_id: String,
    pub is_dir: bool,
    pub extension: String,
    pub content_hash: String,
    pub title: Option<String>,
    pub calendar_category: Option<String>,
    pub event_date: Option<String>,
    pub project_status: Option<String>,
    pub updated_at: String,
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkItem {
    pub source_uuid: String,
    pub source_title: String,
    pub source_path: String,
    pub source_role: String,
    pub excerpt: String,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub uuid: String,
    pub full_path: String,
    pub relative_path: String,
    pub role: String,
    pub raw_content: String,
    pub yaml_raw: String,
    pub body_content: String,
    pub frontmatter: HashMap<String, String>,
    pub content_hash: String,
    pub backlinks: Vec<BacklinkItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchScanSummary {
    pub scanned_files: usize,
    pub already_registered: usize,
    pub pending_files: usize,
    pub uuids_injected: usize,
    pub media_indexed: usize,
    pub links_indexed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LifelogMessage {
    pub id: i64,
    pub source: String,
    pub room_or_sender: String,
    pub sender: String,
    pub message: String,
    pub sent_date: String,
    pub sent_time: String,
    pub attachment_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceTransaction {
    pub id: i64,
    pub tx_date: String,
    pub tx_time: String,
    pub institution: String,
    pub tx_type: String,
    pub amount: i64,
    pub merchant: String,
    pub category: String,
    pub memo: String,
    pub verify_status: String,
    pub dedup_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInboxItem {
    pub uuid: String,
    pub file_name: String,
    pub full_path: String,
    pub taken_date: String,
    pub taken_time: String,
    pub file_size: u64,
    pub content_hash: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocParams {
    pub role: String,
    pub title: String,
    pub date_str: Option<String>,
    pub calendar_category: Option<String>,
    pub location: Option<String>,
    pub is_project_folder: Option<bool>,
    pub template_file: Option<String>,
    pub sub_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchItem {
    pub full_path: String,
    pub relative_path: String,
    pub role: String,
    pub file_name: String,
    pub line_number: usize,
    pub line_text: String,
    pub char_offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTemplateItem {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub full_path: String,
    pub description: String,
    pub body_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceImportRow {
    pub tx_date: String,
    pub tx_time: String,
    pub institution: String,
    pub tx_type: String,
    pub amount: i64,
    pub merchant: String,
    pub category: String,
    pub memo: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceImportSummary {
    pub inserted_new: usize,
    pub reconciled_existing: usize,
    pub skipped_duplicate: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KakaoImportResult {
    pub inserted_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLifelogResponse {
    pub messages: Vec<LifelogMessage>,
    pub transactions: Vec<FinanceTransaction>,
    pub media_inbox: Vec<MediaInboxItem>,
}

fn open_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS base_folders (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            path TEXT NOT NULL,
            label TEXT NOT NULL,
            purpose TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS files (
            uuid TEXT PRIMARY KEY,
            full_path TEXT NOT NULL UNIQUE,
            relative_path TEXT NOT NULL,
            role TEXT NOT NULL,
            base_folder_id TEXT NOT NULL,
            extension TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            title TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS links (
            source_uuid TEXT NOT NULL,
            target_uuid TEXT NOT NULL,
            excerpt TEXT NOT NULL,
            PRIMARY KEY (source_uuid, target_uuid, excerpt)
        );
        CREATE TABLE IF NOT EXISTS lifelog_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            room_or_sender TEXT NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            sent_date TEXT NOT NULL,
            sent_time TEXT NOT NULL,
            attachment_uuid TEXT,
            dedup_key TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS finance_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tx_date TEXT NOT NULL,
            tx_time TEXT NOT NULL,
            institution TEXT NOT NULL,
            tx_type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            merchant TEXT NOT NULL,
            category TEXT NOT NULL,
            memo TEXT NOT NULL,
            verify_status TEXT NOT NULL,
            dedup_key TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS media_inbox (
            uuid TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            full_path TEXT NOT NULL,
            taken_date TEXT NOT NULL,
            taken_time TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            status TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM base_folders", [], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        let defaults = vec![
            (
                "base-data-1",
                "data",
                r"C:\Users\iseoh\OneDrive\iseohyunDocs",
                "iseohyunDocs (데이터/아카이브)",
                "과거 문서, 위키, 부동산/재정, 미디어 원본 아카이브 및 분류 대기 문서",
            ),
            (
                "base-diary-1",
                "diary",
                r"C:\Users\iseoh\OneDrive\Diary",
                "OneDrive Diary (일기)",
                "매일의 주관적 작업/일상 기록 및 구글 캘린더 1:1 양방향 동기화 폴더",
            ),
            (
                "base-projects-1",
                "projects",
                r"C:\Users\iseoh\OneDrive\Projects",
                "OneDrive Projects (프로젝트)",
                "폴더별 main.md 기반 개발·아티클·영상 제작 프로젝트 관리 폴더",
            ),
        ];
        for (id, role, path, label, purpose) in defaults {
            let _ = conn.execute(
                "INSERT INTO base_folders (id, role, path, label, purpose, enabled) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![id, role, path, label, purpose],
            );
        }
    }

    let _ = ensure_projects_mylore_templates(&conn);

    Ok(conn)
}

/// 경로 내에 `.myLore` 또는 `.mylore` 시스템/템플릿 폴더가 포함되어 있는지 확인합니다.
fn is_internal_mylore_path(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s.eq_ignore_ascii_case(".mylore")
    })
}

/// 1번 Projects 볼트(`C:\Users\iseoh\OneDrive\Projects\.myLore\templates`)에 기본 마크다운 템플릿을 생성·관리합니다.
fn ensure_projects_mylore_templates(conn: &Connection) -> PathBuf {
    let projects_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\Projects".to_string());

    let templates_dir = Path::new(&projects_base).join(".myLore").join("templates");
    let _ = fs::create_dir_all(&templates_dir);

    let default_templates = vec![
        (
            "project_main.md",
            r#"---
title: "{{title}}"
description: "프로젝트 기본 main.md 템플릿 (표, 구분선, 서브미션 포함)"
status: "진행중"
milestone: "초기 설계 및 목표 수립"
---
# 📁 {{title}}

| 항목 | 내용 | 비고 |
| :--- | :--- | :--- |
| **프로젝트 상태** | `진행중` | 우선순위 관리 대상 |
| **핵심 목표** | 프로젝트의 최종 산출물 및 목적 정의 | 1줄 요약 |
| **관련 볼트** | `Projects/{{title}}/main.md` | 서브 문서는 현 폴더 하위 배치 |

---

## 🎯 서브 미션 (Tasks — `Alt+Shift+F` 자동 정렬 지원)
- [!] 가장 먼저 처리할 핵심/내일 할 일 과제
- [/] 현재 진행 중인 구현 또는 조사 작업
- [ ] 대기 중인 백로그 항목
- [-] 보류 중인 아이디어
- [x] 초기 프로젝트 폴더(`main.md`) 생성 완료

---

## 📝 아키텍처 & 상세 노트
여기에 프로젝트 관련 상세 설계나 메모를 자유롭게 작성하세요.

<details>
<summary>💡 참고 자료 및 접기/펼치기 섹션 (HTML 태그 호환 예시)</summary>
<p>마크다운 표준에 따라 <code>&lt;details&gt;</code>, <code>&lt;hr&gt;</code>, <code>&lt;kbd&gt;</code> 등 HTML 태그도 스타일이 적용된 상태로 렌더링됩니다.</p>
</details>
"#,
        ),
        (
            "article_research.md",
            r#"---
title: "{{title}}"
description: "개발 커리어·사색·수영 등 아티클/영상 제작을 위한 자료조사 템플릿"
status: "자료수집중"
category: "콘텐츠기획"
---
# 🎬 {{title}} (아티클 · 영상 기획 및 자료조사)

| 구분 | 기획 내용 | 상태 |
| :--- | :--- | :---: |
| **타겟 포맷** | 기술 블로그 아티클 / 유튜브 영상 스크립트 | 기획중 |
| **핵심 메시지** | 독자/시청자에게 전달할 가장 중요한 인사이트 1가지 | 작성필요 |
| **예상 분량** | 아티클 1편 (또는 10분 내외 영상) | - |

---

## 📌 핵심 할 일 (Production Tasks)
- [!] 핵심 레퍼런스 및 근거 자료 3건 이상 수집
- [/] 도입부(Hook) 및 전체 목차 구조화
- [ ] 초안(Draft) 작성 및 시각화/표 정리

---

## 📚 수집된 자료 및 인용 (References)
> 핵심 인용구나 기억해야 할 문장을 여기에 기록합니다.

1. 첫 번째 참고 자료 요약
2. 두 번째 참고 자료 요약
"#,
        ),
        (
            "diary_default.md",
            r#"---
title: "{{title}}"
description: "구글 캘린더 양방향 연동 호환 일기(Diary) 기본 템플릿"
---
# 📅 {{date}} — {{title}}

| 시간대 | 주요 활동 / 일정 요약 | 구분 |
| :---: | :--- | :---: |
| 오전 | 오전 주요 일정 또는 컨디션 기록 | 일상 |
| 오후 | 핵심 프로젝트/업무 진행 내역 | 개발/업무 |
| 저녁 | 운동(수영 등) 및 개인 회고 | 기록 |

---

## ✅ 오늘의 체크리스트
- [!] 오늘 반드시 마무리할 핵심 일과
- [ ] 내일로 이관할 후속 일정 점검

---

## 💬 상세 기록 & 라이프로그 메모
우측 사이드바의 **[📱 라이프로그]** 탭에서 당일 카드 결제 내역이나 카카오톡 대화를 클릭하면 이 본문에 즉시 삽입됩니다.
"#,
        ),
    ];

    for (file_name, content) in default_templates {
        let p = templates_dir.join(file_name);
        if !p.exists() {
            let _ = fs::write(&p, content);
        }
    }

    templates_dir
}

fn parse_markdown_yaml(raw: &str) -> (String, String, HashMap<String, String>) {
    let normalized = raw.replace("\r\n", "\n");
    let mut map = HashMap::new();
    if !normalized.starts_with("---\n") {
        return (String::new(), normalized, map);
    }
    let close_pos = normalized[4..]
        .find("\n---\n")
        .map(|idx| idx + 4)
        .or_else(|| {
            if normalized.ends_with("\n---") {
                Some(normalized.len() - 4)
            } else {
                None
            }
        });

    if let Some(pos) = close_pos {
        let yaml_raw = normalized[4..pos].to_string();
        let body = if pos + 5 <= normalized.len() {
            normalized[pos + 5..].to_string()
        } else {
            String::new()
        };
        for line in yaml_raw.lines() {
            if let Some(colon) = line.find(':') {
                let k = line[..colon].trim().to_string();
                let v = line[colon + 1..].trim().trim_matches('"').to_string();
                if !k.is_empty() {
                    map.insert(k, v);
                }
            }
        }
        (yaml_raw, body, map)
    } else {
        (String::new(), normalized, map)
    }
}

fn ensure_uuid_in_markdown_file(
    path: &Path,
    existing_uuid: Option<&str>,
) -> Result<(String, String, bool), String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (yaml_raw, body, frontmatter) = parse_markdown_yaml(&raw);

    if let Some(u) = frontmatter.get("uuid") {
        if !u.trim().is_empty() {
            return Ok((u.trim().to_string(), raw, false));
        }
    }

    let assigned_uuid = existing_uuid
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let new_raw = if yaml_raw.is_empty() && !raw.replace("\r\n", "\n").starts_with("---\n") {
        format!("---\nuuid: \"{}\"\n---\n{}", assigned_uuid, body)
    } else {
        format!("---\nuuid: \"{}\"\n{}\n---\n{}", assigned_uuid, yaml_raw, body)
    };

    fs::write(path, &new_raw).map_err(|e| e.to_string())?;
    Ok((assigned_uuid, new_raw, true))
}

#[tauri::command]
fn get_base_folders(state: State<AppState>) -> Result<Vec<BaseFolderConfig>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let mut stmt = conn
        .prepare("SELECT id, role, path, label, purpose, enabled FROM base_folders")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(BaseFolderConfig {
                id: row.get(0)?,
                role: row.get(1)?,
                path: row.get(2)?,
                label: row.get(3)?,
                purpose: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn save_base_folders(
    state: State<AppState>,
    folders: Vec<BaseFolderConfig>,
) -> Result<Vec<BaseFolderConfig>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    conn.execute("DELETE FROM base_folders", [])
        .map_err(|e| e.to_string())?;
    for bf in &folders {
        conn.execute(
            "INSERT INTO base_folders (id, role, path, label, purpose, enabled) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                bf.id,
                bf.role,
                bf.path,
                bf.label,
                bf.purpose,
                if bf.enabled { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(folders)
}

#[tauri::command]
fn get_scan_progress(state: State<AppState>) -> Result<ScanProgressPayload, String> {
    let prog = state.scan_progress.lock().map_err(|e| e.to_string())?;
    Ok(prog.clone())
}

/// 백그라운드 스레드에서 사전 스캔(Pre-scan) -> 기등록 파일 스킵(이어하기) -> 실시간 프로그레스 이벤트 송출을 수행합니다.
#[tauri::command]
fn start_batch_uuid_scan(app: AppHandle, state: State<AppState>) -> Result<ScanProgressPayload, String> {
    {
        let prog = state.scan_progress.lock().map_err(|e| e.to_string())?;
        if prog.is_running {
            return Ok(prog.clone());
        }
    }

    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    let prog_arc = state.scan_progress.clone();

    thread::spawn(move || {
        // 1. 사전 스캔(Pre-scan): 전체 파일 목록과 이미 DB에 UUID가 등록된 파일 목록을 빠르게 대조
        let (folders, registered_paths) = {
            let _g = lock_arc.lock().unwrap();
            let conn = match open_db(&db_path) {
                Ok(c) => c,
                Err(_) => return,
            };
            let mut stmt = conn
                .prepare("SELECT id, role, path FROM base_folders WHERE enabled = 1")
                .unwrap();
            let folders: Vec<(String, String, String)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            let mut reg_stmt = conn.prepare("SELECT full_path FROM files").unwrap();
            let reg_set: HashSet<String> = reg_stmt
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            (folders, reg_set)
        };

        struct PendingItem {
            base_id: String,
            role: String,
            base_path: PathBuf,
            full_path: PathBuf,
            full_path_str: String,
            rel_path_str: String,
            ext: String,
        }

        let mut total_files = 0usize;
        let mut already_registered = 0usize;
        let mut pending_list: Vec<PendingItem> = Vec::new();

        for (base_id, role, base_path_str) in folders {
            let base_path = PathBuf::from(&base_path_str);
            if !base_path.exists() {
                let _ = fs::create_dir_all(&base_path);
                continue;
            }
            for entry in WalkDir::new(&base_path)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file() && !is_internal_mylore_path(e.path()))
            {
                let full_path = entry.path().to_path_buf();
                let full_path_str = full_path.to_string_lossy().to_string();
                total_files += 1;

                // 이미 DB에 등록된 파일이면 즉시 건너뛰기 카운트에 포함 (이어하기!)
                if registered_paths.contains(&full_path_str) {
                    already_registered += 1;
                    continue;
                }

                let rel_path_str = full_path
                    .strip_prefix(&base_path)
                    .unwrap_or(&full_path)
                    .to_string_lossy()
                    .to_string();
                let ext = full_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                pending_list.push(PendingItem {
                    base_id: base_id.clone(),
                    role: role.clone(),
                    base_path: base_path.clone(),
                    full_path,
                    full_path_str,
                    rel_path_str,
                    ext,
                });
            }
        }

        let pending_files = pending_list.len();
        let start_percent = if total_files > 0 {
            (already_registered as f64 / total_files as f64) * 100.0
        } else {
            100.0
        };

        {
            let mut p = prog_arc.lock().unwrap();
            *p = ScanProgressPayload {
                is_running: pending_files > 0,
                phase: if pending_files > 0 {
                    "injecting".to_string()
                } else {
                    "done".to_string()
                },
                total_files,
                already_registered,
                pending_files,
                completed_files: already_registered,
                start_percent,
                current_percent: start_percent,
                uuids_injected: 0,
                media_indexed: 0,
                links_indexed: 0,
                current_file: if pending_files == 0 {
                    "모든 파일이 이미 등록되어 있습니다.".to_string()
                } else {
                    "미등록 파일 일괄 주입 시작...".to_string()
                },
                eta_seconds: 0.0,
            };
            let _ = app.emit("uuid-scan-progress", p.clone());
        }

        if pending_files == 0 {
            return;
        }

        let start_instant = Instant::now();
        let uri_re = Regex::new(r"mylore://(?:doc|media)/([a-fA-F0-9-]{36})").unwrap();

        let mut uuids_injected = 0usize;
        let mut media_indexed = 0usize;
        let mut links_indexed = 0usize;

        for (idx, item) in pending_list.into_iter().enumerate() {
            {
                let _g = lock_arc.lock().unwrap();
                if let Ok(conn) = open_db(&db_path) {
                    if item.ext == "md" {
                        if let Ok((uuid_val, raw_after, injected)) =
                            ensure_uuid_in_markdown_file(&item.full_path, None)
                        {
                            if injected {
                                uuids_injected += 1;
                            }
                            let hash_val = blake3::hash(raw_after.as_bytes()).to_hex().to_string();
                            let (_, body_after, fm_after) = parse_markdown_yaml(&raw_after);
                            let title = fm_after
                                .get("summary")
                                .or_else(|| fm_after.get("title"))
                                .cloned()
                                .unwrap_or_else(|| {
                                    item.full_path
                                        .file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("무제")
                                        .to_string()
                                });
                            let now_str = chrono::Local::now().to_rfc3339();
                            let _ = conn.execute(
                                "INSERT INTO files (uuid, full_path, relative_path, role, base_folder_id, extension, content_hash, title, updated_at)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                                 ON CONFLICT(uuid) DO UPDATE SET
                                    full_path = excluded.full_path,
                                    relative_path = excluded.relative_path,
                                    role = excluded.role,
                                    content_hash = excluded.content_hash,
                                    title = excluded.title,
                                    updated_at = excluded.updated_at",
                                params![
                                    uuid_val,
                                    item.full_path_str,
                                    item.rel_path_str,
                                    item.role,
                                    item.base_id,
                                    item.ext,
                                    hash_val,
                                    title,
                                    now_str
                                ],
                            );

                            let _ = conn.execute(
                                "DELETE FROM links WHERE source_uuid = ?1",
                                params![uuid_val],
                            );
                            for line in body_after.lines() {
                                for cap in uri_re.captures_iter(line) {
                                    if let Some(target_match) = cap.get(1) {
                                        let _ = conn.execute(
                                            "INSERT OR IGNORE INTO links (source_uuid, target_uuid, excerpt) VALUES (?1, ?2, ?3)",
                                            params![uuid_val, target_match.as_str(), line.trim()],
                                        );
                                        links_indexed += 1;
                                    }
                                }
                            }
                        }
                    } else if let Ok(bytes) = fs::read(&item.full_path) {
                        let hash_val = blake3::hash(&bytes).to_hex().to_string();
                        let existing_uuid: Option<String> = conn
                            .query_row(
                                "SELECT uuid FROM files WHERE full_path = ?1 OR content_hash = ?2 LIMIT 1",
                                params![item.full_path_str, hash_val],
                                |r| r.get(0),
                            )
                            .optional()
                            .unwrap_or(None);

                        let uuid_val =
                            existing_uuid.unwrap_or_else(|| Uuid::new_v4().to_string());
                        let title = item
                            .full_path
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("file")
                            .to_string();
                        let now_str = chrono::Local::now().to_rfc3339();

                        let _ = conn.execute(
                            "INSERT INTO files (uuid, full_path, relative_path, role, base_folder_id, extension, content_hash, title, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                             ON CONFLICT(uuid) DO UPDATE SET
                                full_path = excluded.full_path,
                                relative_path = excluded.relative_path,
                                content_hash = excluded.content_hash,
                                updated_at = excluded.updated_at",
                            params![
                                uuid_val,
                                item.full_path_str,
                                item.rel_path_str,
                                item.role,
                                item.base_id,
                                item.ext,
                                hash_val,
                                title,
                                now_str
                            ],
                        );
                        media_indexed += 1;
                    }
                }
            };

            let processed_pending = idx + 1;
            let completed_files = already_registered + processed_pending;
            let current_percent = if total_files > 0 {
                (completed_files as f64 / total_files as f64) * 100.0
            } else {
                100.0
            };

            let elapsed_secs = start_instant.elapsed().as_secs_f64();
            let avg_per_file = elapsed_secs / (processed_pending as f64);
            let remaining_files = pending_files.saturating_sub(processed_pending);
            let eta_seconds = avg_per_file * (remaining_files as f64);

            // 매 3개 파일마다 또는 마지막 파일일 때 실시간 진행률 이벤트 송출
            if processed_pending % 3 == 0 || processed_pending == pending_files {
                let mut p = prog_arc.lock().unwrap();
                p.is_running = processed_pending < pending_files;
                p.phase = if processed_pending < pending_files {
                    "injecting".to_string()
                } else {
                    "done".to_string()
                };
                p.completed_files = completed_files;
                p.current_percent = current_percent;
                p.uuids_injected = uuids_injected;
                p.media_indexed = media_indexed;
                p.links_indexed = links_indexed;
                p.current_file = item.rel_path_str.clone();
                p.eta_seconds = eta_seconds;
                let _ = app.emit("uuid-scan-progress", p.clone());
            }
        }
    });

    let prog = state.scan_progress.lock().map_err(|e| e.to_string())?;
    Ok(prog.clone())
}

#[tauri::command]
fn scan_and_inject_uuids(
    app: AppHandle,
    state: State<AppState>,
) -> Result<BatchScanSummary, String> {
    let prog = start_batch_uuid_scan(app, state)?;
    Ok(BatchScanSummary {
        scanned_files: prog.total_files,
        already_registered: prog.already_registered,
        pending_files: prog.pending_files,
        uuids_injected: prog.uuids_injected,
        media_indexed: prog.media_indexed,
        links_indexed: prog.links_indexed,
    })
}

#[tauri::command]
fn get_virtual_tree(state: State<AppState>) -> Result<Vec<FileNode>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut stmt = conn
        .prepare("SELECT id, role, path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut out = Vec::new();
    for (base_id, role, base_path_str) in folders {
        let base_path = Path::new(&base_path_str);
        if !base_path.exists() {
            continue;
        }
        for entry in WalkDir::new(base_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && !is_internal_mylore_path(e.path()))
        {
            let full_path = entry.path();
            let ext = full_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext != "md" {
                continue;
            }
            let full_path_str = full_path.to_string_lossy().to_string();
            let rel_path_str = full_path
                .strip_prefix(base_path)
                .unwrap_or(full_path)
                .to_string_lossy()
                .to_string();
            let name = full_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            let db_info: Option<(String, String, Option<String>)> = conn
                .query_row(
                    "SELECT uuid, content_hash, title FROM files WHERE full_path = ?1",
                    params![full_path_str],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .unwrap_or(None);

            let (uuid_val, hash_val, title_val) =
                db_info.unwrap_or_else(|| (String::new(), String::new(), None));

            out.push(FileNode {
                uuid: uuid_val,
                name,
                relative_path: rel_path_str,
                full_path: full_path_str,
                role: role.clone(),
                base_folder_id: base_id.clone(),
                is_dir: false,
                extension: ext,
                content_hash: hash_val,
                title: title_val,
                calendar_category: None,
                event_date: None,
                project_status: None,
                updated_at: String::new(),
                children: None,
            });
        }
    }

    out.sort_by(|a, b| b.relative_path.cmp(&a.relative_path));
    Ok(out)
}

fn build_document_payload(conn: &Connection, full_path: &Path) -> Result<DocumentPayload, String> {
    if !full_path.exists() {
        return Err(format!("파일이 존재하지 않습니다: {}", full_path.display()));
    }
    let full_path_str = full_path.to_string_lossy().to_string();

    let (uuid_val, raw_content, _) = ensure_uuid_in_markdown_file(full_path, None)?;
    let (yaml_raw, body_content, frontmatter) = parse_markdown_yaml(&raw_content);
    let content_hash = blake3::hash(raw_content.as_bytes()).to_hex().to_string();

    let mut stmt = conn
        .prepare("SELECT id, role, path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut matched_role = "data".to_string();
    let mut matched_base_id = "base-data-1".to_string();
    let mut rel_path_str = full_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    for (b_id, b_role, b_path) in folders {
        let bp = Path::new(&b_path);
        if let Ok(stripped) = full_path.strip_prefix(bp) {
            matched_role = b_role;
            matched_base_id = b_id;
            rel_path_str = stripped.to_string_lossy().to_string();
            break;
        }
    }

    let title = frontmatter
        .get("summary")
        .or_else(|| frontmatter.get("title"))
        .cloned()
        .unwrap_or_else(|| rel_path_str.clone());
    let now_str = chrono::Local::now().to_rfc3339();

    let _ = conn.execute(
        "INSERT INTO files (uuid, full_path, relative_path, role, base_folder_id, extension, content_hash, title, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'md', ?6, ?7, ?8)
         ON CONFLICT(uuid) DO UPDATE SET
            full_path = excluded.full_path,
            relative_path = excluded.relative_path,
            role = excluded.role,
            content_hash = excluded.content_hash,
            title = excluded.title,
            updated_at = excluded.updated_at",
        params![
            uuid_val,
            full_path_str,
            rel_path_str,
            matched_role,
            matched_base_id,
            content_hash,
            title,
            now_str
        ],
    );

    let mut bl_stmt = conn
        .prepare(
            "SELECT f.uuid, COALESCE(f.title, f.relative_path), f.full_path, f.role, l.excerpt
             FROM links l
             JOIN files f ON f.uuid = l.source_uuid
             WHERE l.target_uuid = ?1",
        )
        .map_err(|e| e.to_string())?;
    let backlinks: Vec<BacklinkItem> = bl_stmt
        .query_map(params![uuid_val], |r| {
            Ok(BacklinkItem {
                source_uuid: r.get(0)?,
                source_title: r.get(1)?,
                source_path: r.get(2)?,
                source_role: r.get(3)?,
                excerpt: r.get(4)?,
                date: None,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DocumentPayload {
        uuid: uuid_val,
        full_path: full_path_str,
        relative_path: rel_path_str,
        role: matched_role,
        raw_content,
        yaml_raw,
        body_content,
        frontmatter,
        content_hash,
        backlinks,
    })
}

#[tauri::command]
fn read_document(state: State<AppState>, full_path: String) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    build_document_payload(&conn, Path::new(&full_path))
}

#[tauri::command]
fn read_document_by_uuid(state: State<AppState>, uuid: String) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let full_path: String = conn
        .query_row(
            "SELECT full_path FROM files WHERE uuid = ?1",
            params![uuid],
            |r| r.get(0),
        )
        .map_err(|_| format!("UUID({})에 해당하는 문서를 찾을 수 없습니다.", uuid))?;
    build_document_payload(&conn, Path::new(&full_path))
}

#[tauri::command]
fn save_document(
    state: State<AppState>,
    full_path: String,
    raw_content: String,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let path = Path::new(&full_path);
    fs::write(path, &raw_content).map_err(|e| e.to_string())?;
    let payload = build_document_payload(&conn, path)?;

    let uri_re = Regex::new(r"mylore://(?:doc|media)/([a-fA-F0-9-]{36})").unwrap();
    let _ = conn.execute(
        "DELETE FROM links WHERE source_uuid = ?1",
        params![payload.uuid],
    );
    for line in payload.body_content.lines() {
        for cap in uri_re.captures_iter(line) {
            if let Some(m) = cap.get(1) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO links (source_uuid, target_uuid, excerpt) VALUES (?1, ?2, ?3)",
                    params![payload.uuid, m.as_str(), line.trim()],
                );
            }
        }
    }

    build_document_payload(&conn, path)
}

#[tauri::command]
fn create_new_document(
    state: State<AppState>,
    params: CreateDocParams,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let base_path_str: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = ?1 AND enabled = 1 LIMIT 1",
            params![params.role],
            |r| r.get(0),
        )
        .map_err(|_| format!("역할({})에 해당하는 베이스 폴더가 설정되어 있지 않습니다.", params.role))?;

    let base_path = Path::new(&base_path_str);
    let _ = fs::create_dir_all(base_path);
    let new_uuid = Uuid::new_v4().to_string();

    let templates_dir = ensure_projects_mylore_templates(&conn);
    let date_str = params
        .date_str
        .clone()
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());

    let load_template_body = |file_name: &str| -> Option<String> {
        let tpl_path = templates_dir.join(file_name);
        if let Ok(raw) = fs::read_to_string(tpl_path) {
            let (_, body, _) = parse_markdown_yaml(&raw);
            Some(
                body.replace("{{title}}", &params.title)
                    .replace("{{date}}", &date_str),
            )
        } else {
            None
        }
    };

    let target_file_path =
        if params.role == "projects" && params.is_project_folder.unwrap_or(true) {
            let proj_dir = base_path.join(&params.title);
            let _ = fs::create_dir_all(&proj_dir);
            let p = proj_dir.join("main.md");
            if !p.exists() {
                let tpl_name = params
                    .template_file
                    .as_deref()
                    .unwrap_or("project_main.md");
                let body = load_template_body(tpl_name).unwrap_or_else(|| {
                    format!(
                        "# {}\n\n## 서브 미션 (Tasks)\n- [!] 내일 해야 할 핵심 과제를 여기에 작성하세요\n- [/] 현재 진행 중인 작업\n- [ ] 대기 중인 백로그 과제\n",
                        params.title
                    )
                });
                let content = format!(
                    "---\nuuid: \"{}\"\ntitle: \"{}\"\nstatus: \"진행중\"\nmilestone: \"초기 설계 및 할 일 정의\"\n---\n{}",
                    new_uuid, params.title, body
                );
                fs::write(&p, content).map_err(|e| e.to_string())?;
            }
            p
        } else if params.role == "diary" {
            let cal_cat = params
                .calendar_category
                .unwrap_or_else(|| "개발".to_string());
            let color_id = match cal_cat.as_str() {
                "개발" => "11",
                "이벤트" => "6",
                "수영" => "10",
                "기록" => "7",
                "식단" => "9",
                "일상" => "3",
                "알림" => "1",
                _ => "8",
            };
            let loc = params.location.unwrap_or_else(|| "거제집".to_string());

            let mut filename = format!("{} {}.md", date_str, params.title);
            let mut p = base_path.join(&filename);
            let mut idx = 1;
            while p.exists() {
                filename = format!("{} {}-{}.md", date_str, params.title, idx);
                p = base_path.join(&filename);
                idx += 1;
            }

            let tpl_name = params
                .template_file
                .as_deref()
                .unwrap_or("diary_default.md");
            let body = load_template_body(tpl_name).unwrap_or_default();

            let content = format!(
                "---\nuuid: \"{}\"\nsummary: \"{}\"\nstart:\n  date: \"{}\"\nend:\n  date: \"{}\"\ncalendar: \"{}\"\nlocation: \"{}\"\ntransparency: \"transparent\"\nvisibility: \"default\"\ncolorId: \"{}\"\ndescription: \"File\"\nstatus: \"confirmed\"\n---\n{}",
                new_uuid, params.title, date_str, date_str, cal_cat, loc, color_id, body
            );
            fs::write(&p, content).map_err(|e| e.to_string())?;
            p
        } else {
            let target_dir = if let Some(sf) = &params.sub_folder {
                let d = base_path.join(sf);
                let _ = fs::create_dir_all(&d);
                d
            } else {
                base_path.to_path_buf()
            };
            let p = target_dir.join(format!("{}.md", params.title));
            let body = params
                .template_file
                .as_deref()
                .and_then(load_template_body)
                .unwrap_or_else(|| format!("# {}\n\n", params.title));
            let content = format!(
                "---\nuuid: \"{}\"\ntitle: \"{}\"\n---\n{}",
                new_uuid, params.title, body
            );
            fs::write(&p, content).map_err(|e| e.to_string())?;
            p
        };

    build_document_payload(&conn, &target_file_path)
}

/// 새 메모 (임시 메모장 출력, 프로젝트/임시에 자동 분류)
#[tauri::command]
fn create_temp_memo(state: State<AppState>, title: Option<String>) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let projects_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\Projects".to_string());

    let temp_dir = Path::new(&projects_base).join("임시");
    let _ = fs::create_dir_all(&temp_dir);

    let now = chrono::Local::now();
    let memo_title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| format!("임시메모_{}", now.format("%Y-%m-%d_%H%M%S")));

    let file_path = temp_dir.join(format!("{}.md", memo_title));
    if !file_path.exists() {
        let new_uuid = Uuid::new_v4().to_string();
        let content = format!(
            "---\nuuid: \"{}\"\ntitle: \"{}\"\ncategory: \"임시메모\"\ncreated: \"{}\"\n---\n# 📝 {}\n\n- [!] 빠른 메모 내용을 여기에 기록하세요\n",
            new_uuid,
            memo_title,
            now.format("%Y-%m-%d %H:%M:%S"),
            memo_title
        );
        fs::write(&file_path, content).map_err(|e| e.to_string())?;
    }

    build_document_payload(&conn, &file_path)
}

/// 루트 Projects/main.md 로 즉시 이동 (파일이 없으면 생성)
#[tauri::command]
fn open_root_main_md(state: State<AppState>) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let projects_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\Projects".to_string());

    let _ = fs::create_dir_all(&projects_base);
    let root_main = Path::new(&projects_base).join("main.md");
    if !root_main.exists() {
        let new_uuid = Uuid::new_v4().to_string();
        let content = format!(
            "---\nuuid: \"{}\"\ntitle: \"전체 프로젝트 마스터 (main.md)\"\nstatus: \"활성\"\n---\n# ⭐ 전체 프로젝트 마스터 (`Projects/main.md`)\n\n| 구분 | 설명 | 단축 이동 |\n| :--- | :--- | :--- |\n| **전체 프로젝트** | 각 하위 폴더의 `{{프로젝트명}}/main.md`와 연동되는 최상위 문서 | `이동 > main.md로 이동` |\n| **임시 메모** | `Projects/임시/` 폴더에 자동 분류 | `파일 > 새 파일 > 새 메모` |\n\n---\n\n## 🎯 핵심 우선순위 과제 (Tasks)\n- [!] 오늘/내일 집중할 최우선 프로젝트 항목\n- [/] 현재 진행 중인 프로젝트 점검\n- [ ] 백로그 및 자료조사(개발 커리어·사색·수영 아티클/영상 기획)\n",
            new_uuid
        );
        fs::write(&root_main, content).map_err(|e| e.to_string())?;
    }

    build_document_payload(&conn, &root_main)
}

/// 우클릭 -> 탐색기에서 보기 (Windows Explorer /select 실행)
#[tauri::command]
fn show_in_explorer(full_path: String) -> Result<(), String> {
    let p = Path::new(&full_path);
    if p.exists() {
        let _ = Command::new("explorer.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .arg(format!("/select,{}", p.display()))
            .spawn();
    } else if let Some(parent) = p.parent() {
        let _ = Command::new("explorer.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .arg(parent.as_os_str())
            .spawn();
    }
    Ok(())
}

/// F2: 현재 문서 제목(파일명 또는 프로젝트 폴더명) 변경 (UUID 불변 유지)
#[tauri::command]
fn rename_current_document(
    state: State<AppState>,
    source_full_path: String,
    new_title: String,
) -> Result<DocumentPayload, String> {
    let clean_title = new_title.trim().replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    if clean_title.is_empty() {
        return Err("새 제목이 비어 있습니다.".to_string());
    }

    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&source_full_path);
    if !src_path.exists() {
        return Err("원본 파일이 존재하지 않습니다.".to_string());
    }

    let (uuid_val, raw_content, _) = ensure_uuid_in_markdown_file(src_path, None)?;
    let (yaml_raw, body, _) = parse_markdown_yaml(&raw_content);

    // YAML 내부의 summary 또는 title 값도 새 제목으로 동기화
    let mut updated_yaml_lines: Vec<String> = Vec::new();
    let mut title_updated_in_yaml = false;
    for line in yaml_raw.lines() {
        let t = line.trim_start();
        if t.starts_with("title:") {
            updated_yaml_lines.push(format!("title: \"{}\"", clean_title));
            title_updated_in_yaml = true;
        } else if t.starts_with("summary:") {
            updated_yaml_lines.push(format!("summary: \"{}\"", clean_title));
            title_updated_in_yaml = true;
        } else {
            updated_yaml_lines.push(line.to_string());
        }
    }
    if !title_updated_in_yaml && !yaml_raw.is_empty() {
        updated_yaml_lines.push(format!("title: \"{}\"", clean_title));
    }
    let new_raw = if updated_yaml_lines.is_empty() {
        raw_content
    } else {
        format!("---\n{}\n---\n{}", updated_yaml_lines.join("\n"), body)
    };
    let _ = fs::write(src_path, &new_raw);

    let file_name_only = src_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let target_path = if file_name_only.eq_ignore_ascii_case("main.md") {
        // 프로젝트 하위 폴더의 main.md인 경우 부모 프로젝트 폴더 이름을 변경
        if let Some(parent_dir) = src_path.parent() {
            if let Some(grand_parent) = parent_dir.parent() {
                let new_proj_dir = grand_parent.join(&clean_title);
                if new_proj_dir != parent_dir {
                    fs::rename(parent_dir, &new_proj_dir).map_err(|e| e.to_string())?;
                }
                new_proj_dir.join("main.md")
            } else {
                src_path.to_path_buf()
            }
        } else {
            src_path.to_path_buf()
        }
    } else if let Some(parent_dir) = src_path.parent() {
        let new_file_name = if clean_title.to_lowercase().ends_with(".md") {
            clean_title.clone()
        } else {
            format!("{}.md", clean_title)
        };
        let dst = parent_dir.join(new_file_name);
        if dst != src_path {
            fs::rename(src_path, &dst).map_err(|e| e.to_string())?;
        }
        dst
    } else {
        src_path.to_path_buf()
    };

    let _ = conn.execute(
        "UPDATE files SET full_path = ?1, title = ?2 WHERE uuid = ?3",
        params![
            target_path.to_string_lossy().to_string(),
            clean_title,
            uuid_val
        ],
    );

    build_document_payload(&conn, &target_path)
}

/// F11: 전체 화면(Fullscreen) 토글
#[tauri::command]
fn toggle_window_fullscreen(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_full = window.is_fullscreen().unwrap_or(false);
        let next_full = !is_full;
        window
            .set_fullscreen(next_full)
            .map_err(|e| e.to_string())?;
        return Ok(next_full);
    }
    Ok(false)
}

/// 전체 볼트 파일에서 키워드 검색 (오른쪽 사이드바 검색 결과 리스트 연동)
#[tauri::command]
fn search_in_files(
    state: State<AppState>,
    query: String,
) -> Result<Vec<SearchMatchItem>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let q_lower = q.to_lowercase();

    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut stmt = conn
        .prepare("SELECT role, path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::new();
    for (role, base_path_str) in folders {
        let base_path = Path::new(&base_path_str);
        if !base_path.exists() {
            continue;
        }
        for entry in WalkDir::new(base_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && !is_internal_mylore_path(e.path()))
        {
            let full_path = entry.path();
            if full_path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(full_path) {
                let (_, body, _) = parse_markdown_yaml(&raw);
                let rel_path_str = full_path
                    .strip_prefix(base_path)
                    .unwrap_or(full_path)
                    .to_string_lossy()
                    .to_string();
                let file_name = full_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let full_path_str = full_path.to_string_lossy().to_string();

                let mut running_offset = 0usize;
                for (idx, line) in body.lines().enumerate() {
                    if line.to_lowercase().contains(&q_lower) {
                        results.push(SearchMatchItem {
                            full_path: full_path_str.clone(),
                            relative_path: rel_path_str.clone(),
                            role: role.clone(),
                            file_name: file_name.clone(),
                            line_number: idx + 1,
                            line_text: line.trim().chars().take(120).collect(),
                            char_offset: running_offset,
                        });
                        if results.len() >= 250 {
                            return Ok(results);
                        }
                    }
                    running_offset += line.len() + 1;
                }
            }
        }
    }

    Ok(results)
}

/// 전체 파일에서 일괄 바꾸기 (파일에서 바꾸기)
#[tauri::command]
fn replace_in_files(
    state: State<AppState>,
    query: String,
    replacement: String,
) -> Result<usize, String> {
    if query.is_empty() {
        return Ok(0);
    }
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut stmt = conn
        .prepare("SELECT path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut modified_files = 0usize;
    for base_path_str in folders {
        let base_path = Path::new(&base_path_str);
        if !base_path.exists() {
            continue;
        }
        for entry in WalkDir::new(base_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && !is_internal_mylore_path(e.path()))
        {
            let full_path = entry.path();
            if full_path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(full_path) {
                let (yaml_raw, body, _) = parse_markdown_yaml(&raw);
                if body.contains(&query) {
                    let new_body = body.replace(&query, &replacement);
                    let new_raw = if yaml_raw.is_empty() {
                        new_body
                    } else {
                        format!("---\n{}\n---\n{}", yaml_raw, new_body)
                    };
                    if fs::write(full_path, new_raw).is_ok() {
                        modified_files += 1;
                    }
                }
            }
        }
    }

    Ok(modified_files)
}

/// Windows 네이티브 파일 선택 다이얼로그 (파일 > 파일 열기)
#[tauri::command]
fn open_native_file_dialog() -> Result<Option<String>, String> {
    let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = "Markdown Files (*.md)|*.md|All Files (*.*)|*.*"
$dlg.InitialDirectory = "C:\Users\iseoh\OneDrive"
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dlg.FileName
}
"#;
    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-STA", "-Command", ps_script])
        .output()
        .map_err(|e| e.to_string())?;
    let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_str.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path_str))
    }
}

/// Windows 네이티브 폴더 선택 다이얼로그 (파일 > 폴더 열기)
#[tauri::command]
fn open_native_folder_dialog() -> Result<Option<String>, String> {
    let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.SelectedPath = "C:\Users\iseoh\OneDrive"
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dlg.SelectedPath
}
"#;
    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-STA", "-Command", ps_script])
        .output()
        .map_err(|e| e.to_string())?;
    let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_str.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path_str))
    }
}

#[tauri::command]
fn get_vault_templates(state: State<AppState>) -> Result<Vec<VaultTemplateItem>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let templates_dir = ensure_projects_mylore_templates(&conn);

    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&templates_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Ok(raw) = fs::read_to_string(&path) {
                    let (_, body, fm) = parse_markdown_yaml(&raw);
                    let file_name = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let name = fm
                        .get("title")
                        .cloned()
                        .unwrap_or_else(|| file_name.clone());
                    let desc = fm.get("description").cloned().unwrap_or_else(|| {
                        "1번 Projects 볼트(.myLore/templates) 사용자 템플릿".to_string()
                    });
                    out.push(VaultTemplateItem {
                        id: file_name.clone(),
                        name,
                        file_name,
                        full_path: path.to_string_lossy().to_string(),
                        description: desc,
                        body_content: body,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(out)
}

#[tauri::command]
fn open_in_chrome_app_mode() -> Result<(), String> {
    let app_url = "http://127.0.0.1:18443";
    let chrome_candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for candidate in chrome_candidates {
        if Path::new(candidate).exists() {
            let _ = Command::new(candidate)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(format!("--app={}", app_url))
                .spawn();
            return Ok(());
        }
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let user_chrome =
            Path::new(&local_app_data).join(r"Google\Chrome\Application\chrome.exe");
        if user_chrome.exists() {
            let _ = Command::new(user_chrome)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(format!("--app={}", app_url))
                .spawn();
            return Ok(());
        }
    }
    open_google_calendar_web(app_url.to_string(), None)
}

#[tauri::command]
fn promote_to_project_folder(
    state: State<AppState>,
    source_full_path: String,
    project_name: String,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&source_full_path);
    if !src_path.exists() {
        return Err("원본 문서가 존재하지 않습니다.".to_string());
    }

    let (uuid_val, _, _) = ensure_uuid_in_markdown_file(src_path, None)?;

    let projects_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "프로젝트(Projects) 베이스 폴더가 설정되어 있지 않습니다.".to_string())?;

    let target_dir = Path::new(&projects_base).join(&project_name);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target_file = target_dir.join("main.md");

    fs::rename(src_path, &target_file).map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "UPDATE files SET full_path = ?1, relative_path = ?2, role = 'projects' WHERE uuid = ?3",
        params![
            target_file.to_string_lossy().to_string(),
            format!("{}\\main.md", project_name),
            uuid_val
        ],
    );

    build_document_payload(&conn, &target_file)
}

#[tauri::command]
fn move_document_to_role(
    state: State<AppState>,
    source_full_path: String,
    target_role: String,
    new_file_name: Option<String>,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&source_full_path);
    if !src_path.exists() {
        return Err("원본 파일이 존재하지 않습니다.".to_string());
    }
    let (uuid_val, _, _) = ensure_uuid_in_markdown_file(src_path, None)?;

    let target_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = ?1 AND enabled = 1 LIMIT 1",
            params![target_role],
            |r| r.get(0),
        )
        .map_err(|_| format!("{} 역할의 베이스 폴더를 찾을 수 없습니다.", target_role))?;

    let file_name = new_file_name.unwrap_or_else(|| {
        src_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("moved.md")
            .to_string()
    });

    let target_dir = Path::new(&target_base);
    let _ = fs::create_dir_all(target_dir);
    let target_file = target_dir.join(&file_name);

    fs::rename(src_path, &target_file).map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "UPDATE files SET full_path = ?1, relative_path = ?2, role = ?3 WHERE uuid = ?4",
        params![
            target_file.to_string_lossy().to_string(),
            file_name,
            target_role,
            uuid_val
        ],
    );

    build_document_payload(&conn, &target_file)
}

#[tauri::command]
fn open_google_calendar_web(url: String, browser_path: Option<String>) -> Result<(), String> {
    if let Some(bp) = browser_path {
        if !bp.trim().is_empty() && Path::new(&bp).exists() {
            let _ = Command::new(bp)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(&url)
                .spawn();
            return Ok(());
        }
    }

    let chrome_candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for candidate in chrome_candidates {
        if Path::new(candidate).exists() {
            let _ = Command::new(candidate)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(&url)
                .spawn();
            return Ok(());
        }
    }

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let user_chrome =
            Path::new(&local_app_data).join(r"Google\Chrome\Application\chrome.exe");
        if user_chrome.exists() {
            let _ = Command::new(user_chrome)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(&url)
                .spawn();
            return Ok(());
        }
    }

    let _ = Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["/C", "start", "chrome", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_lifelog_for_date(
    state: State<AppState>,
    date_str: String,
) -> Result<DailyLifelogResponse, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut msg_stmt = conn
        .prepare(
            "SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid
             FROM lifelog_messages WHERE sent_date = ?1 ORDER BY sent_time ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let messages: Vec<LifelogMessage> = msg_stmt
        .query_map(params![date_str], |r| {
            Ok(LifelogMessage {
                id: r.get(0)?,
                source: r.get(1)?,
                room_or_sender: r.get(2)?,
                sender: r.get(3)?,
                message: r.get(4)?,
                sent_date: r.get(5)?,
                sent_time: r.get(6)?,
                attachment_uuid: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut tx_stmt = conn
        .prepare(
            "SELECT id, tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key
             FROM finance_transactions WHERE tx_date = ?1 ORDER BY tx_time ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let transactions: Vec<FinanceTransaction> = tx_stmt
        .query_map(params![date_str], |r| {
            Ok(FinanceTransaction {
                id: r.get(0)?,
                tx_date: r.get(1)?,
                tx_time: r.get(2)?,
                institution: r.get(3)?,
                tx_type: r.get(4)?,
                amount: r.get(5)?,
                merchant: r.get(6)?,
                category: r.get(7)?,
                memo: r.get(8)?,
                verify_status: r.get(9)?,
                dedup_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut media_stmt = conn
        .prepare(
            "SELECT uuid, file_name, full_path, taken_date, taken_time, file_size, content_hash, status
             FROM media_inbox WHERE taken_date = ?1",
        )
        .map_err(|e| e.to_string())?;
    let media_inbox: Vec<MediaInboxItem> = media_stmt
        .query_map(params![date_str], |r| {
            Ok(MediaInboxItem {
                uuid: r.get(0)?,
                file_name: r.get(1)?,
                full_path: r.get(2)?,
                taken_date: r.get(3)?,
                taken_time: r.get(4)?,
                file_size: r.get::<_, i64>(5)? as u64,
                content_hash: r.get(6)?,
                status: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DailyLifelogResponse {
        messages,
        transactions,
        media_inbox,
    })
}

#[tauri::command]
fn get_all_finance_transactions(state: State<AppState>) -> Result<Vec<FinanceTransaction>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key
             FROM finance_transactions ORDER BY tx_date DESC, tx_time DESC, id DESC LIMIT 300",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(FinanceTransaction {
                id: r.get(0)?,
                tx_date: r.get(1)?,
                tx_time: r.get(2)?,
                institution: r.get(3)?,
                tx_type: r.get(4)?,
                amount: r.get(5)?,
                merchant: r.get(6)?,
                category: r.get(7)?,
                memo: r.get(8)?,
                verify_status: r.get(9)?,
                dedup_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[tauri::command]
fn parse_notification_into_finance(
    state: State<AppState>,
    package_name: String,
    title: String,
    text: String,
    date_str: String,
    time_str: String,
) -> Result<Option<FinanceTransaction>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let amt_re = Regex::new(r"([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)원").unwrap();
    let mut amount: i64 = 0;
    if let Some(cap) = amt_re.captures(&text) {
        if let Some(m) = cap.get(1) {
            amount = m.as_str().replace(',', "").parse::<i64>().unwrap_or(0);
        }
    }
    if amount <= 0 {
        return Ok(None);
    }

    let institution = if title.contains("신한") {
        "신한카드".to_string()
    } else if title.contains("국민") || title.contains("KB") {
        "KB국민".to_string()
    } else if title.contains("현대") {
        "현대카드".to_string()
    } else {
        package_name
    };

    let merchant_re = Regex::new(r"원\s+([^\s0-9/]+)").unwrap();
    let merchant = merchant_re
        .captures(&text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| text.clone());

    let dedup_raw = format!("{}|{}|{}", date_str, amount, merchant);
    let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

    conn.execute(
        "INSERT OR IGNORE INTO finance_transactions
         (tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key)
         VALUES (?1, ?2, ?3, 'expense', ?4, ?5, '미분류', '모바일 실시간 알림 자동 적재', 'realtime', ?6)",
        params![date_str, time_str, institution, amount, merchant, dedup_key],
    )
    .map_err(|e| e.to_string())?;

    let tx = conn
        .query_row(
            "SELECT id, tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key
             FROM finance_transactions WHERE dedup_key = ?1",
            params![dedup_key],
            |r| {
                Ok(FinanceTransaction {
                    id: r.get(0)?,
                    tx_date: r.get(1)?,
                    tx_time: r.get(2)?,
                    institution: r.get(3)?,
                    tx_type: r.get(4)?,
                    amount: r.get(5)?,
                    merchant: r.get(6)?,
                    category: r.get(7)?,
                    memo: r.get(8)?,
                    verify_status: r.get(9)?,
                    dedup_key: r.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(tx)
}

#[tauri::command]
fn import_finance_rows(
    state: State<AppState>,
    rows: Vec<FinanceImportRow>,
) -> Result<FinanceImportSummary, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut inserted_new = 0usize;
    let mut reconciled_existing = 0usize;
    let mut skipped_duplicate = 0usize;

    for row in rows {
        let existing_match: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, verify_status FROM finance_transactions
                 WHERE tx_date = ?1 AND amount = ?2 AND (merchant = ?3 OR instr(merchant, ?3) > 0 OR instr(?3, merchant) > 0)
                 LIMIT 1",
                params![row.tx_date, row.amount, row.merchant],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .unwrap_or(None);

        if let Some((existing_id, status)) = existing_match {
            if status == "realtime" {
                conn.execute(
                    "UPDATE finance_transactions SET verify_status = 'verified', category = ?1, memo = '실시간 알림 + 엑셀 명세서 대조 확정' WHERE id = ?2",
                    params![row.category, existing_id],
                )
                .map_err(|e| e.to_string())?;
                reconciled_existing += 1;
            } else {
                skipped_duplicate += 1;
            }
            continue;
        }

        let dedup_raw = format!("{}|{}|{}", row.tx_date, row.amount, row.merchant);
        let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
        let verify_status = if row.source == "realtime" {
            "realtime"
        } else {
            "excel_only"
        };

        let affected = conn
            .execute(
                "INSERT OR IGNORE INTO finance_transactions
                 (tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    row.tx_date,
                    row.tx_time,
                    row.institution,
                    row.tx_type,
                    row.amount,
                    row.merchant,
                    row.category,
                    row.memo,
                    verify_status,
                    dedup_key
                ],
            )
            .map_err(|e| e.to_string())?;

        if affected > 0 {
            inserted_new += 1;
        } else {
            skipped_duplicate += 1;
        }
    }

    Ok(FinanceImportSummary {
        inserted_new,
        reconciled_existing,
        skipped_duplicate,
    })
}

#[tauri::command]
fn import_kakao_chat_text(
    state: State<AppState>,
    room_name: String,
    raw_text: String,
) -> Result<KakaoImportResult, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let date_re = Regex::new(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일").unwrap();
    let msg_re = Regex::new(r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$").unwrap();

    let mut current_date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut inserted_count = 0usize;

    for line in raw_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("---") {
            if let Some(cap) = date_re.captures(trimmed) {
                let y = cap.get(1).map(|m| m.as_str()).unwrap_or("2026");
                let m: u32 = cap
                    .get(2)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(1);
                let d: u32 = cap
                    .get(3)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(1);
                current_date = format!("{}-{:02}-{:02}", y, m, d);
                continue;
            }
        }

        if let Some(cap) = msg_re.captures(trimmed) {
            let sender = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let time_str = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let body = cap.get(3).map(|m| m.as_str()).unwrap_or("");

            let dedup_raw = format!(
                "kakao|{}|{}|{}|{}|{}",
                room_name, current_date, time_str, sender, body
            );
            let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

            let affected = conn
                .execute(
                    "INSERT OR IGNORE INTO lifelog_messages
                     (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key)
                     VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6)",
                    params![room_name, sender, body, current_date, time_str, dedup_key],
                )
                .map_err(|e| e.to_string())?;
            if affected > 0 {
                inserted_count += 1;
            }
        }
    }

    Ok(KakaoImportResult { inserted_count })
}

fn spawn_mobile_companion_http_server(db_path: PathBuf) {
    thread::spawn(move || {
        if let Ok(server) = tiny_http::Server::http("0.0.0.0:18443") {
            let dist_dir = PathBuf::from(r"c:\git\myLore\dist");
            for request in server.incoming_requests() {
                let url = request.url().to_string();
                if url == "/api/v1/status" {
                    let body = serde_json::json!({
                        "ok": true,
                        "pc_name": "MYLORE-DESKTOP",
                        "version": "0.1.0",
                        "db_ready": db_path.exists()
                    })
                    .to_string();
                    let header = tiny_http::Header::from_bytes(
                        &b"Content-Type"[..],
                        &b"application/json"[..],
                    )
                    .unwrap();
                    let _ = request.respond(
                        tiny_http::Response::from_string(body).with_header(header),
                    );
                } else {
                    // Chrome App Mode (`chrome.exe --app=http://127.0.0.1:18443`) 요청 시 dist/ 정적 파일 서빙
                    let clean_path = url.split('?').next().unwrap_or("/").trim_start_matches('/');
                    let rel_file = if clean_path.is_empty() {
                        "index.html"
                    } else {
                        clean_path
                    };
                    let target_file = dist_dir.join(rel_file);
                    if target_file.exists() && target_file.is_file() {
                        if let Ok(bytes) = fs::read(&target_file) {
                            let mime = if rel_file.ends_with(".html") {
                                "text/html; charset=utf-8"
                            } else if rel_file.ends_with(".js") {
                                "application/javascript; charset=utf-8"
                            } else if rel_file.ends_with(".css") {
                                "text/css; charset=utf-8"
                            } else {
                                "application/octet-stream"
                            };
                            let header = tiny_http::Header::from_bytes(
                                &b"Content-Type"[..],
                                mime.as_bytes(),
                            )
                            .unwrap();
                            let _ = request.respond(
                                tiny_http::Response::from_data(bytes).with_header(header),
                            );
                            continue;
                        }
                    }
                    let _ = request.respond(tiny_http::Response::from_string("{\"ok\":true}"));
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1번 Projects 볼트(C:\Users\iseoh\OneDrive\Projects\.myLore) 안에 메타 DB 및 템플릿을 통합 관리
    let projects_vault_mylore = PathBuf::from(r"C:\Users\iseoh\OneDrive\Projects\.myLore");
    let _ = fs::create_dir_all(&projects_vault_mylore);
    let vault_db_path = projects_vault_mylore.join("mylore_meta.db");
    let legacy_db_path = PathBuf::from(r"c:\git\myLore\.mylore\mylore_meta.db");
    if !vault_db_path.exists() && legacy_db_path.exists() {
        let _ = fs::copy(&legacy_db_path, &vault_db_path);
    }
    let db_path = vault_db_path;
    let _ = open_db(&db_path);
    spawn_mobile_companion_http_server(db_path.clone());

    tauri::Builder::default()
        .manage(AppState {
            db_path,
            lock: Arc::new(Mutex::new(())),
            scan_progress: Arc::new(Mutex::new(ScanProgressPayload::default())),
        })
        .setup(|app| {
            // 앱 실행 시 현재 모니터 작업 영역(Work Area)의 오른쪽 절반(Win + Right Arrow와 동일)으로 자동 배치
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window
                    .current_monitor()
                    .or_else(|_| window.primary_monitor())
                {
                    let work_area = monitor.work_area();
                    let half_width = work_area.size.width / 2;
                    let full_height = work_area.size.height;
                    let right_x =
                        work_area.position.x + (work_area.size.width as i32 - half_width as i32);
                    let top_y = work_area.position.y;

                    let _ = window.set_size(tauri::PhysicalSize::new(half_width, full_height));
                    let _ = window.set_position(tauri::PhysicalPosition::new(right_x, top_y));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_base_folders,
            save_base_folders,
            scan_and_inject_uuids,
            start_batch_uuid_scan,
            get_scan_progress,
            get_virtual_tree,
            read_document,
            read_document_by_uuid,
            save_document,
            create_new_document,
            create_temp_memo,
            open_root_main_md,
            show_in_explorer,
            rename_current_document,
            toggle_window_fullscreen,
            search_in_files,
            replace_in_files,
            open_native_file_dialog,
            open_native_folder_dialog,
            get_vault_templates,
            open_in_chrome_app_mode,
            promote_to_project_folder,
            move_document_to_role,
            open_google_calendar_web,
            get_lifelog_for_date,
            get_all_finance_transactions,
            parse_notification_into_finance,
            import_finance_rows,
            import_kakao_chat_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
