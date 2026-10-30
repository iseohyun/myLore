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
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashedFileRecord {
    pub trash_id: String,
    pub original_path: String,
    pub file_name: String,
    pub backup_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedPreviewState {
    pub title: String,
    pub relative_path: String,
    pub full_path: String,
    pub role: String,
    pub body_text: String,
    pub yaml_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedPreviewActionPayload {
    pub action_type: String,
    pub uuid: Option<String>,
    pub line_index: Option<usize>,
    pub next_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedScrollPayload {
    pub top_line: f64,
    pub scroll_ratio: f64,
}

fn default_f11_viewer_mode() -> String {
    "detached".to_string()
}

fn default_auto_save() -> bool {
    true
}

fn default_editor_view_mode() -> String {
    "split".to_string()
}

fn default_scroll_sync() -> bool {
    true
}

fn default_base_font_family() -> String {
    "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif".to_string()
}

fn default_heading_font_family() -> String {
    "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif".to_string()
}

fn default_table_font_family() -> String {
    "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif".to_string()
}

fn default_base_font_size() -> u32 {
    14
}

fn default_heading_scale() -> f64 {
    1.0
}

fn default_table_font_size() -> u32 {
    13
}

fn default_theme_preset() -> String {
    "dark_indigo".to_string()
}

fn default_bg_primary() -> String {
    "#0f1117".to_string()
}

fn default_bg_secondary() -> String {
    "#161922".to_string()
}

fn default_text_primary() -> String {
    "#f1f5f9".to_string()
}

fn default_text_secondary() -> String {
    "#94a3b8".to_string()
}

fn default_heading_color() -> String {
    "#a5b4fc".to_string()
}

fn default_accent_primary() -> String {
    "#6366f1".to_string()
}

fn default_table_header_bg() -> String {
    "#1e2230".to_string()
}

fn default_table_header_color() -> String {
    "#a5b4fc".to_string()
}

fn default_border_color() -> String {
    "#2b3040".to_string()
}

fn default_auto_call_transcription() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyLoreAppSettings {
    /// "detached" (전용독립뷰어) | "split" (병렬뷰어)
    #[serde(default = "default_f11_viewer_mode")]
    pub f11_viewer_mode: String,
    #[serde(default = "default_auto_save")]
    pub auto_save_enabled: bool,
    #[serde(default = "default_editor_view_mode")]
    pub default_editor_view_mode: String,
    #[serde(default)]
    pub default_menu_bar_expanded: bool,
    #[serde(default = "default_scroll_sync")]
    pub scroll_sync_enabled: bool,
    #[serde(default = "default_auto_call_transcription")]
    pub auto_call_transcription: bool,
    #[serde(default = "default_base_font_family")]
    pub base_font_family: String,
    #[serde(default = "default_heading_font_family")]
    pub heading_font_family: String,
    #[serde(default = "default_table_font_family")]
    pub table_font_family: String,
    #[serde(default = "default_base_font_size")]
    pub base_font_size: u32,
    #[serde(default = "default_heading_scale")]
    pub heading_scale: f64,
    #[serde(default = "default_table_font_size")]
    pub table_font_size: u32,
    #[serde(default = "default_theme_preset")]
    pub theme_preset: String,
    #[serde(default = "default_bg_primary")]
    pub bg_primary: String,
    #[serde(default = "default_bg_secondary")]
    pub bg_secondary: String,
    #[serde(default = "default_text_primary")]
    pub text_primary: String,
    #[serde(default = "default_text_secondary")]
    pub text_secondary: String,
    #[serde(default = "default_heading_color")]
    pub heading_color: String,
    #[serde(default = "default_accent_primary")]
    pub accent_primary: String,
    #[serde(default = "default_table_header_bg")]
    pub table_header_bg: String,
    #[serde(default = "default_table_header_color")]
    pub table_header_color: String,
    #[serde(default = "default_border_color")]
    pub border_color: String,
    #[serde(default)]
    pub settings_file_path: String,
}

impl Default for MyLoreAppSettings {
    fn default() -> Self {
        Self {
            f11_viewer_mode: default_f11_viewer_mode(),
            auto_save_enabled: default_auto_save(),
            default_editor_view_mode: default_editor_view_mode(),
            default_menu_bar_expanded: false,
            scroll_sync_enabled: default_scroll_sync(),
            auto_call_transcription: default_auto_call_transcription(),
            base_font_family: default_base_font_family(),
            heading_font_family: default_heading_font_family(),
            table_font_family: default_table_font_family(),
            base_font_size: default_base_font_size(),
            heading_scale: default_heading_scale(),
            table_font_size: default_table_font_size(),
            theme_preset: default_theme_preset(),
            bg_primary: default_bg_primary(),
            bg_secondary: default_bg_secondary(),
            text_primary: default_text_primary(),
            text_secondary: default_text_secondary(),
            heading_color: default_heading_color(),
            accent_primary: default_accent_primary(),
            table_header_bg: default_table_header_bg(),
            table_header_color: default_table_header_color(),
            border_color: default_border_color(),
            settings_file_path: r"C:\Users\iseoh\OneDrive\Projects\.myLore\setting.json".to_string(),
        }
    }
}

pub struct AppState {
    pub db_path: PathBuf,
    pub lock: Arc<Mutex<()>>,
    pub scan_progress: Arc<Mutex<ScanProgressPayload>>,
    pub pending_cli_files: Arc<Mutex<Vec<String>>>,
    pub trash_history: Arc<Mutex<Vec<TrashedFileRecord>>>,
    pub detached_preview: Arc<Mutex<DetachedPreviewState>>,
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
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    #[serde(default)]
    pub has_audio_recording: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDeviceItem {
    pub device_id: String,
    pub device_name: String,
    pub model: String,
    pub paired_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePairingPayload {
    pub qr_json_raw: String,
    pub qr_base64: String,
    pub pc_name: String,
    pub ips: Vec<String>,
    pub port: u16,
    pub token: String,
    pub ssids: Vec<String>,
    pub paired_devices: Vec<PairedDeviceItem>,
    pub last_noti_ts: i64,
    pub last_sms_ts: i64,
    pub last_call_ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiApiKeyStatus {
    pub has_key: bool,
    pub masked_key: String,
    pub model_name: String,
    pub last_verified_at: String,
    pub storage_location: String,
    #[serde(default)]
    pub quota_exhausted_at: String,
    #[serde(default)]
    pub retry_after_at: String,
    #[serde(default)]
    pub pending_call_count: usize,
    #[serde(default)]
    pub last_quota_error: String,
    #[serde(default)]
    pub today_used_tokens: i64,
    #[serde(default)]
    pub total_used_tokens: i64,
    #[serde(default)]
    pub today_request_count: i64,
    #[serde(default)]
    pub last_request_tokens: i64,
    #[serde(default = "default_auto_call_transcription")]
    pub auto_call_transcription: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallPlayInfoPayload {
    pub audio_url: String,
    pub full_path: String,
    pub file_name: String,
    pub contact_display: String,
    pub has_transcript: bool,
    #[serde(default)]
    pub audio_base64: String,
    #[serde(default)]
    pub mime_type: String,
}

static DB_SCHEMA_INITIALIZED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
static LIFELOG_BACKFILLED_ONCE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

fn open_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        ",
    )
    .map_err(|e| e.to_string())?;

    if DB_SCHEMA_INITIALIZED.get().is_none() {
        conn.execute_batch(
            "
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
            CREATE TABLE IF NOT EXISTS mobile_sync_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS paired_devices (
                device_id TEXT PRIMARY KEY,
                device_name TEXT NOT NULL,
                model TEXT NOT NULL,
                paired_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS synced_file_hashes (
                file_hash TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                synced_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS lifelog_call_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT NOT NULL,
                contact_name TEXT NOT NULL,
                call_type TEXT NOT NULL,
                duration_sec INTEGER NOT NULL,
                call_date TEXT NOT NULL,
                call_time TEXT NOT NULL,
                timestamp_ms INTEGER NOT NULL,
                dedup_key TEXT NOT NULL UNIQUE
            );
            ",
        )
        .map_err(|e| e.to_string())?;

        // 다중 기기 출처 및 서비스별 독립 동기화 타임스탬프 컬럼 마이그레이션
        for sql in [
            "ALTER TABLE lifelog_messages ADD COLUMN device_id TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE lifelog_messages ADD COLUMN device_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE lifelog_call_logs ADD COLUMN device_id TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE lifelog_call_logs ADD COLUMN device_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE paired_devices ADD COLUMN last_kakao_ts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE paired_devices ADD COLUMN last_noti_ts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE paired_devices ADD COLUMN last_sms_ts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE paired_devices ADD COLUMN last_call_ts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE paired_devices ADD COLUMN last_recording_ts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE paired_devices ADD COLUMN last_health_ts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE paired_devices ADD COLUMN last_contact_ts INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE paired_devices ADD COLUMN last_usage_ts INTEGER NOT NULL DEFAULT 0",
        ] {
            let _ = conn.execute(sql, []);
        }

        // 기본 페어링 토큰 및 허용 Wi-Fi SSID (iseohyun, seohyun5G) 초기화
        let has_token: Option<String> = conn
            .query_row(
                "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        if has_token.is_none() {
            let raw_uuid = Uuid::new_v4().to_string().replace('-', "");
            let token = format!("mylore_sec_{}", raw_uuid);
            let _ = conn.execute(
                "INSERT OR IGNORE INTO mobile_sync_meta (key, value) VALUES ('pairing_token', ?1)",
                params![token],
            );
        }

        let has_ssids: Option<String> = conn
            .query_row(
                "SELECT value FROM mobile_sync_meta WHERE key = 'allowed_ssids'",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        if has_ssids.is_none() {
            let default_ssids = serde_json::json!(["iseohyun", "seohyun5G"]).to_string();
            let _ = conn.execute(
                "INSERT OR IGNORE INTO mobile_sync_meta (key, value) VALUES ('allowed_ssids', ?1)",
                params![default_ssids],
            );
        }

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

        // 기존 마이그레이션 완료된 카카오톡 백업 파일 해시 3종 시드 등록 (중복 재전송 방지)
        let seeded_hashes = [
            (
                "70fff10a7a7ea94f690ba6ddfb3da67f157616534a9eb1c175ddedc64278971e",
                "박재홍, 이소영, Jun 4",
            ),
            (
                "c25ab6f5bda7ea7865d071398887f25793d6ca8b389de366ef13bd46cee8e5de",
                "임현정",
            ),
            (
                "a0b4ca7f25b8d715da5219bf7b3d252b7173a22a6341bf3d3f737e0114e99803",
                "정서현",
            ),
        ];
        for (fh, rname) in seeded_hashes {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at) VALUES (?1, ?2, '2026-10-30 07:15:00')",
                params![fh, rname],
            );
        }

        migrate_raw_kakao_chat_mds(&conn);
        let _ = DB_SCHEMA_INITIALIZED.set(true);
    }

    Ok(conn)
}

/// `mobile/kakao/` 내에 폴더명(`KakaoTalk_Chats_...`)으로 잘못 생성된 `.md` 파일이 있을 경우,
/// 대화 참여자 목록을 추출하여 실제 대화방 이름(`{참여자}.md`)으로 병합·정리하고 메타데이터를 보존합니다.
fn migrate_raw_kakao_chat_mds(conn: &Connection) {
    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    let entries = match fs::read_dir(&kakao_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let sender_re = Regex::new(r"^- \*\*\[([^\]]+)\]\s*([^\*]+)\*\*:\s*(.*)$").unwrap();
    let date_re = Regex::new(r"^##\s*📅\s*(\d{4}-\d{2}-\d{2})").unwrap();

    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() || p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !stem.starts_with("KakaoTalk_Chats_") {
            continue;
        }
        let raw = match fs::read_to_string(&p) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let mut participants: Vec<String> = Vec::new();
        for line in raw.lines() {
            if let Some(cap) = sender_re.captures(line.trim()) {
                let s = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                if !s.is_empty() && s != "정서현" && !participants.iter().any(|x| x == s) {
                    participants.push(s.to_string());
                }
            }
        }
        let resolved_room = if participants.is_empty() {
            "정서현".to_string()
        } else if participants.len() <= 4 {
            participants.join(", ")
        } else {
            format!(
                "{} 외 {}명",
                participants[..4].join(", "),
                participants.len() - 4
            )
        };

        let mut current_date = "2026-10-30".to_string();
        for line in raw.lines() {
            let trimmed = line.trim();
            if let Some(dc) = date_re.captures(trimmed) {
                if let Some(m) = dc.get(1) {
                    current_date = m.as_str().to_string();
                }
                continue;
            }
            if let Some(sc) = sender_re.captures(trimmed) {
                let time_str = sc.get(1).map(|m| m.as_str()).unwrap_or("");
                let sender = sc.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                let body = sc.get(3).map(|m| m.as_str()).unwrap_or("");
                let md_line = format!("- **[{}] {}**: {}", time_str, sender, body);
                append_line_to_mobile_md(
                    conn,
                    "kakao",
                    &resolved_room,
                    &format!("[카카오톡 대화내역] {}", resolved_room),
                    "[\"카카오톡\", \"카톡\", \"단톡방\", \"대화내역\", \"채팅이력\", \"KakaoTalk\"]",
                    &current_date,
                    &md_line,
                );
            }
        }

        let _ = conn.execute(
            "UPDATE OR IGNORE lifelog_messages SET room_or_sender = ?1 WHERE source = 'kakaotalk' AND room_or_sender = ?2",
            params![resolved_room, stem],
        );
        let _ = conn.execute(
            "DELETE FROM lifelog_messages WHERE source = 'kakaotalk' AND room_or_sender = ?1",
            params![stem],
        );
        let _ = conn.execute(
            "DELETE FROM files WHERE full_path = ?1",
            params![p.to_string_lossy().to_string()],
        );
        let _ = fs::remove_file(&p);
    }
}

/// 경로 내에 `.myLore`, OneDrive 임시 동기화 폴더, 또는 Git/빌드 캐시 폴더가 포함되어 있는지 확인합니다.
fn is_internal_mylore_path(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s.eq_ignore_ascii_case(".mylore")
            || s.eq_ignore_ascii_case(".git")
            || s.eq_ignore_ascii_case("node_modules")
            || s.eq_ignore_ascii_case("target")
            || s.eq_ignore_ascii_case("dist")
            || s.eq_ignore_ascii_case("build")
            || s.eq_ignore_ascii_case(".next")
            || s.eq_ignore_ascii_case(".tmp.drivedownload")
            || s.eq_ignore_ascii_case(".tmp.driveupload")
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
                .prepare("SELECT id, role, path FROM base_folders WHERE enabled = 1 AND role != 'git'")
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

    let urgent_task_re = Regex::new(r"(?m)^\s*[-*+]\s+\[[!>]\]\s+").unwrap();
    let date_prefix_re = Regex::new(r"^(\d{4}-\d{2}-\d{2})").unwrap();

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

            let mut project_status: Option<String> = None;
            let mut event_date: Option<String> = None;

            if role == "projects" {
                if rel_path_str.eq_ignore_ascii_case("main.md") {
                    project_status = Some("최우선".to_string());
                } else if let Ok(raw) = fs::read_to_string(full_path) {
                    let (_, body, fm) = parse_markdown_yaml(&raw);
                    let status_val = fm.get("status").map(|s| s.trim().to_lowercase()).unwrap_or_default();
                    let priority_val = fm.get("priority").map(|s| s.trim().to_lowercase()).unwrap_or_default();
                    let is_yaml_top = matches!(status_val.as_str(), "최우선" | "urgent" | "top" | "1")
                        || matches!(priority_val.as_str(), "1" | "최우선" | "urgent" | "high" | "!");
                    if is_yaml_top || urgent_task_re.is_match(&body) {
                        project_status = Some("최우선".to_string());
                    }
                }
            } else if role == "diary" {
                if let Some(cap) = date_prefix_re.captures(&name) {
                    event_date = cap.get(1).map(|m| m.as_str().to_string());
                }
            }

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
                event_date,
                project_status,
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

    // git 역할 폴더의 파일은 YAML UUID를 원본 파일에 주입하지 않고 열람·편집만 수행
    let (uuid_val, raw_content) = if matched_role == "git" {
        let raw = fs::read_to_string(full_path).map_err(|e| e.to_string())?;
        let (_, _, fm) = parse_markdown_yaml(&raw);
        let existing_db_uuid: Option<String> = conn
            .query_row(
                "SELECT uuid FROM files WHERE full_path = ?1 LIMIT 1",
                params![full_path_str],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        let u = fm
            .get("uuid")
            .cloned()
            .filter(|s| !s.trim().is_empty())
            .or(existing_db_uuid)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        (u, raw)
    } else {
        let (u, raw, _) = ensure_uuid_in_markdown_file(full_path, None)?;
        (u, raw)
    };

    let (yaml_raw, body_content, frontmatter) = parse_markdown_yaml(&raw_content);
    let content_hash = blake3::hash(raw_content.as_bytes()).to_hex().to_string();

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
async fn read_document(
    state: State<'_, AppState>,
    full_path: String,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        build_document_payload(&conn, Path::new(&full_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_document_by_uuid(
    state: State<'_, AppState>,
    uuid: String,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let full_path: String = conn
            .query_row(
                "SELECT full_path FROM files WHERE uuid = ?1",
                params![uuid],
                |r| r.get(0),
            )
            .map_err(|_| format!("UUID({})에 해당하는 문서를 찾을 수 없습니다.", uuid))?;
        build_document_payload(&conn, Path::new(&full_path))
    })
    .await
    .map_err(|e| e.to_string())?
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
            "SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
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
                device_id: r.get::<_, String>(8).ok().filter(|s| !s.is_empty()),
                device_name: r.get::<_, String>(9).ok().filter(|s| !s.is_empty()),
                has_audio_recording: false,
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

fn normalize_phone_digits(raw: &str) -> String {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.starts_with("8210") && digits.len() >= 12 {
        format!("0{}", &digits[2..])
    } else if digits.starts_with("82") && digits.len() >= 10 {
        format!("0{}", &digits[2..])
    } else {
        digits
    }
}

fn load_mobile_contacts_map(conn: &Connection) -> HashMap<String, String> {
    static RE_CONTACT_LINE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE_CONTACT_LINE
        .get_or_init(|| Regex::new(r"^-\s*\*\*([^*]+)\*\*\s*\|\s*전화:\s*`([^`]*)`").unwrap());
    let mut map = HashMap::new();
    let contacts_md = get_archive_mobile_dir(conn, "contacts").join("연락처_주소록.md");
    if let Ok(content) = fs::read_to_string(&contacts_md) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(cap) = re.captures(trimmed) {
                let name = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                let phones_raw = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                if name.is_empty() || name == "이름없음" || phones_raw.is_empty() {
                    continue;
                }
                for p in phones_raw.split(|c| c == ',' || c == ';' || c == '/') {
                    let pt = p.trim();
                    if pt.is_empty() {
                        continue;
                    }
                    map.insert(pt.to_string(), name.to_string());
                    let norm = normalize_phone_digits(pt);
                    if norm.len() >= 7 {
                        map.insert(norm, name.to_string());
                    }
                }
            }
        }
    }
    map
}

fn resolve_contact_display(raw_target: &str, contacts_map: &HashMap<String, String>) -> String {
    let trimmed = raw_target.trim();
    if trimmed.is_empty() {
        return "알수없음".to_string();
    }
    if let Some(found) = contacts_map.get(trimmed) {
        return found.clone();
    }
    let norm = normalize_phone_digits(trimmed);
    if norm.len() >= 7 {
        if let Some(found) = contacts_map.get(&norm) {
            return found.clone();
        }
    }
    trimmed.to_string()
}

#[tauri::command]
async fn get_mobile_contacts_map(
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        Ok(load_mobile_contacts_map(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 통화 녹음 파일(`mobile/calls/audio/*.m4a`) 앞부분에 잘못 포함된 Multipart 헤더가 있으면 제거하여 순수 오디오 바이트로 복구합니다.
fn strip_multipart_prefix_if_present(raw: &[u8]) -> (Vec<u8>, bool) {
    let head_len = std::cmp::min(raw.len(), 2048);
    let head_str = String::from_utf8_lossy(&raw[..head_len]);
    if let Some(fn_idx) = head_str.find("filename=\"") {
        let search_from = fn_idx;
        if search_from < raw.len() {
            let start_offset = if let Some(rel) = raw[search_from..]
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
            {
                Some(search_from + rel + 4)
            } else if let Some(rel) = raw[search_from..].windows(2).position(|w| w == b"\n\n") {
                Some(search_from + rel + 2)
            } else {
                None
            };
            if let Some(so) = start_offset {
                let mut end_offset = raw.len();
                let tail_start = raw.len().saturating_sub(256);
                if tail_start > so {
                    if let Some(rel_end) = raw[tail_start..]
                        .windows(4)
                        .rposition(|w| w == b"\r\n--")
                    {
                        end_offset = tail_start + rel_end;
                    }
                }
                if so < end_offset {
                    return (raw[so..end_offset].to_vec(), true);
                }
            }
        }
    }
    (raw.to_vec(), false)
}

/// MMS 제목 인코딩 깨짐(`[ì œëª©ì—†ì Œ]` = `"제목없음"`의 UTF-8 바이트가 ISO-8859-1로 읽힌 문자열) 제거,
/// RCS(채팅+) Open Rich Card JSON 텍스트 추출, 그리고 멀티라인 줄바꿈의 `<br/>` 변환을 수행합니다.
fn clean_mms_and_multiline_body(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    if text.is_empty() {
        return String::new();
    }
    // 1. 깨진 `[제목없음]` (`[ì œëª©ì—†ì Œ]`) 또는 정상 `[제목없음]` 접두사 제거
    for prefix in [
        "[ì œëª©ì—†ì Œ]",
        "[ì\u{a0}œëª©ì—†ì\u{8c}Œ]",
        "[제목없음]",
    ] {
        if text.starts_with(prefix) {
            text = text[prefix.len()..].trim_start().to_string();
        }
    }
    if text.starts_with('[') {
        if let Some(end_idx) = text.find(']') {
            if end_idx > 1 && end_idx < 60 {
                let sub_part = &text[1..end_idx];
                if sub_part.contains('ì') || sub_part.contains('ë') || sub_part.contains('ê') {
                    let latin1_bytes: Vec<u8> = sub_part.chars().map(|c| c as u8).collect();
                    if let Ok(recovered) = String::from_utf8(latin1_bytes) {
                        if recovered.trim() == "제목없음" {
                            text = text[end_idx + 1..].trim_start().to_string();
                        } else {
                            text = format!("[{}] {}", recovered.trim(), text[end_idx + 1..].trim_start());
                        }
                    } else if sub_part.contains("œëª©") {
                        text = text[end_idx + 1..].trim_start().to_string();
                    }
                }
            }
        }
    }

    // 2. RCS Open Rich Card JSON (`{"layout":...}`) 본문에서 TextView.text 추출
    let trimmed = text.trim();
    if trimmed.starts_with("{\"layout\":") || trimmed.starts_with("{\"card\":") {
        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let mut extracted = Vec::new();
            fn collect_rcs_texts(node: &serde_json::Value, out: &mut Vec<String>) {
                match node {
                    serde_json::Value::Object(map) => {
                        if map.get("widget").and_then(|v| v.as_str()) == Some("TextView") {
                            if let Some(t) = map.get("text").and_then(|v| v.as_str()) {
                                let clean_t = t.trim();
                                if !clean_t.is_empty() {
                                    out.push(clean_t.to_string());
                                }
                            }
                        }
                        for (k, v) in map {
                            if k != "text" {
                                collect_rcs_texts(v, out);
                            }
                        }
                    }
                    serde_json::Value::Array(arr) => {
                        for item in arr {
                            collect_rcs_texts(item, out);
                        }
                    }
                    _ => {}
                }
            }
            collect_rcs_texts(&jv, &mut extracted);
            if !extracted.is_empty() {
                text = extracted.join("\n");
            }
        }
    }

    // 3. 멀티라인 개행을 `<br/>`로 변환하여 마크다운 리스트 한 줄 구조를 유지
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines_out: Vec<String> = Vec::new();
    for line in normalized.split('\n') {
        let l = line.trim();
        if !l.is_empty() || (lines_out.last().map(|s| !s.is_empty()).unwrap_or(false)) {
            lines_out.push(l.to_string());
        }
    }
    while lines_out.last().map(|s| s.is_empty()).unwrap_or(false) {
        lines_out.pop();
    }
    lines_out.join("<br/>")
}

/// 녹음 파일명/폴더 힌트를 통해 일반 통화녹음(`false`)인지 독백·회의 음성녹음(`true`, 출처 기기명/워치)인지 판별합니다.
fn is_voice_memo_or_watch_recording(
    file_name: &str,
    folder_hint: &str,
    default_device_name: &str,
) -> (bool, String) {
    let fname = file_name.trim();
    let f_lower = fname.to_lowercase();
    let h_lower = folder_hint.to_lowercase();

    // 갤럭시 워치 음성메모 (`음성 001_W_20250404_140623.m4a` 또는 `/Sounds/Watch`)
    if fname.contains("_W_") || h_lower.contains("watch") || fname.contains("워치") {
        return (true, "갤럭시 워치".to_string());
    }

    // 통화 녹음 명시적 패턴 제외
    if fname.starts_with("통화")
        || f_lower.starts_with("call")
        || h_lower.contains("tphone")
        || h_lower.contains("/call")
    {
        return (false, String::new());
    }

    // 삼성 음성녹음기 (`음성 260503_212528.m4a`, `음성메모`, `회의`, `Voice Recorder`)
    if fname.starts_with("음성")
        || fname.starts_with("회의")
        || fname.starts_with("녹음")
        || f_lower.starts_with("voice")
        || h_lower.contains("voice recorder")
        || h_lower.contains("recordings")
    {
        let dev = if default_device_name.trim().is_empty()
            || default_device_name == "모바일"
            || default_device_name == "모바일 기기"
        {
            "SM-S901N".to_string()
        } else {
            default_device_name.trim().to_string()
        };
        return (true, dev);
    }

    (false, String::new())
}

/// 독백/회의 음성녹음 파일명(`음성 260503_212528` 또는 `음성 001_W_20250404_140623`)에서
/// (표시용 제목, 녹음 출처[기기명/갤럭시 워치], 녹음 일자 YYYY-MM-DD, 녹음 시각 HH:MM:SS)을 추출합니다.
fn parse_voice_recording_filename_meta(
    file_stem: &str,
    default_device_name: &str,
) -> (String, String, String, String) {
    static RE_WATCH: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_VOICE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

    let trimmed = file_stem.trim();
    let is_watch = trimmed.contains("_W_") || trimmed.contains("워치");
    let rec_source = if is_watch {
        "갤럭시 워치".to_string()
    } else if !default_device_name.trim().is_empty()
        && default_device_name != "모바일"
        && default_device_name != "모바일 통화녹음"
    {
        default_device_name.trim().to_string()
    } else {
        "SM-S901N".to_string()
    };

    let re_watch = RE_WATCH
        .get_or_init(|| Regex::new(r"_W_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})").unwrap());
    if let Some(cap) = re_watch.captures(trimmed) {
        let d_str = format!("{}-{}-{}", &cap[1], &cap[2], &cap[3]);
        let t_str = format!("{}:{}:{}", &cap[4], &cap[5], &cap[6]);
        let disp = format!("[워치] {}", trimmed);
        return (disp, rec_source, d_str, t_str);
    }

    let re_voice =
        RE_VOICE.get_or_init(|| Regex::new(r"(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$").unwrap());
    if let Some(cap) = re_voice.captures(trimmed) {
        let d_str = format!("20{}-{}-{}", &cap[1], &cap[2], &cap[3]);
        let t_str = format!("{}:{}:{}", &cap[4], &cap[5], &cap[6]);
        let disp = format!("[{}] {}", rec_source, trimmed);
        return (disp, rec_source, d_str, t_str);
    }

    let now = chrono::Local::now();
    (
        format!("[{}] {}", rec_source, trimmed),
        rec_source,
        now.format("%Y-%m-%d").to_string(),
        now.format("%H:%M:%S").to_string(),
    )
}

/// `이름_전화번호_날짜` 또는 `통화 녹음_이름_전화번호_날짜` 형태의 문자열에서
/// 전화번호와 날짜 접미사를 모두 제거하고 순수 `이름`(연락처 매칭 포함)만 추출합니다.
fn extract_clean_contact_name(
    raw_target: &str,
    contacts_map: &HashMap<String, String>,
) -> String {
    static RE_PAREN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT1: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT2: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT3: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT4: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

    let mut s = raw_target
        .trim()
        .trim_start_matches("통화 녹음 ")
        .trim_start_matches("통화 녹음_")
        .trim_start_matches("통화녹음 ")
        .trim_start_matches("통화녹음_")
        .trim_start_matches("Call_")
        .trim_start_matches("call_")
        .trim()
        .to_string();

    let re_paren = RE_PAREN.get_or_init(|| Regex::new(r"\s*\([0-9+\-\s]{7,}\)\s*$").unwrap());
    // 괄호 안 전화번호 제거: `홍길동 (010-1234-5678)` -> `홍길동`
    let stripped = re_paren.replace(&s, "").trim().to_string();
    if !stripped.is_empty() {
        s = stripped;
    }

    // 뒤쪽 날짜/시각 패턴 제거 (`_20261023122434`, `_20261023_122434`, `_261023_122434`)
    for re_dt in [
        RE_DT1.get_or_init(|| Regex::new(r"_(\d{8})_(\d{6})$").unwrap()),
        RE_DT2.get_or_init(|| Regex::new(r"_(\d{6})_(\d{6})$").unwrap()),
        RE_DT3.get_or_init(|| Regex::new(r"_(\d{14})$").unwrap()),
        RE_DT4.get_or_init(|| Regex::new(r"_(\d{8,14})$").unwrap()),
    ] {
        s = re_dt.replace(&s, "").trim().to_string();
    }

    // `이름_전화번호` 또는 `이름_전화번호_기타` 분리
    if s.contains('_') {
        let parts: Vec<&str> = s.split('_').map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
        if !parts.is_empty() {
            let first = parts[0];
            let first_digits = normalize_phone_digits(first);
            let is_first_phone = !first_digits.is_empty()
                && first.chars().all(|c| c.is_ascii_digit() || c == '+' || c == '-');
            if !is_first_phone {
                // 첫 파트가 이름인 경우 (예: `#거제해양윤주권차장님_01066067048`) -> 이름만 반환
                if let Some(found) = contacts_map.get(first) {
                    return found.clone();
                }
                return first.to_string();
            } else {
                // 첫 파트가 전화번호인 경우 연락처 맵 조회
                if let Some(found) = contacts_map.get(first) {
                    return found.clone();
                }
                if first_digits.len() >= 7 {
                    if let Some(found) = contacts_map.get(&first_digits) {
                        return found.clone();
                    }
                }
                return first.to_string();
            }
        }
    }

    let resolved = resolve_contact_display(&s, contacts_map);
    let clean_res = re_paren.replace(&resolved, "").trim().to_string();
    if !clean_res.is_empty() {
        return clean_res;
    }
    resolved
}

/// 통화 녹음 파일명(예: `통화 녹음 #덕산아내중계_241017_180627`, `구인호_01038213356_20261029165901`, `이름_01012345678_20261023_122434`)에서
/// (표시용 상대방 이름[이름만], 통화 일자 YYYY-MM-DD, 통화 시각 HH:MM:SS)을 추출합니다.
fn parse_call_audio_filename_meta(
    file_stem: &str,
    contacts_map: &HashMap<String, String>,
) -> (String, String, String) {
    static RE_TPHONE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_YMD8: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_SAMSUNG: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

    let trimmed = file_stem.trim();

    // 1. T전화 녹음 포맷: `{이름}_{전화번호}_{YYYYMMDDHHMMSS}` (14자리 일시)
    let re_tphone = RE_TPHONE
        .get_or_init(|| Regex::new(r"^(.*)_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$").unwrap());
    if let Some(cap) = re_tphone.captures(trimmed) {
        let raw_prefix = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        let date_str = format!("{}-{}-{}", &cap[2], &cap[3], &cap[4]);
        let time_str = format!("{}:{}:{}", &cap[5], &cap[6], &cap[7]);
        let clean_name = extract_clean_contact_name(raw_prefix, contacts_map);
        return (clean_name, date_str, time_str);
    }

    // 2. 8자리 날짜 + 6자리 시각 포맷: `{이름}_{전화번호}_{YYYYMMDD}_{HHMMSS}`
    let re_ymd8 = RE_YMD8
        .get_or_init(|| Regex::new(r"^(.*)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$").unwrap());
    if let Some(cap) = re_ymd8.captures(trimmed) {
        let raw_prefix = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        let date_str = format!("{}-{}-{}", &cap[2], &cap[3], &cap[4]);
        let time_str = format!("{}:{}:{}", &cap[5], &cap[6], &cap[7]);
        let clean_name = extract_clean_contact_name(raw_prefix, contacts_map);
        return (clean_name, date_str, time_str);
    }

    // 3. 삼성 기본 통화녹음 포맷: `통화 녹음 {상대방}_{YYMMDD}_{HHMMSS}`
    let re = RE_SAMSUNG.get_or_init(|| Regex::new(r"^(.*)_(\d{6})_(\d{6})$").unwrap());
    if let Some(cap) = re.captures(trimmed) {
        let raw_prefix = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        let ymd = cap.get(2).map(|m| m.as_str()).unwrap_or("261030");
        let hms = cap.get(3).map(|m| m.as_str()).unwrap_or("000000");

        let date_str = if ymd.len() == 6 {
            format!("20{}-{}-{}", &ymd[0..2], &ymd[2..4], &ymd[4..6])
        } else {
            chrono::Local::now().format("%Y-%m-%d").to_string()
        };
        let time_str = if hms.len() == 6 {
            format!("{}:{}:{}", &hms[0..2], &hms[2..4], &hms[4..6])
        } else {
            chrono::Local::now().format("%H:%M:%S").to_string()
        };

        let clean_name = extract_clean_contact_name(raw_prefix, contacts_map);
        return (clean_name, date_str, time_str);
    }

    let now = chrono::Local::now();
    (
        extract_clean_contact_name(trimmed, contacts_map),
        now.format("%Y-%m-%d").to_string(),
        now.format("%H:%M:%S").to_string(),
    )
}

/// 스크립트 본문(`## 📜 스크립트` 하위)의 각 문장에 대해:
/// 1) 화자 이름에 `이름_전화번호_날짜` 또는 `이름_전화번호`가 포함되어 있으면 순수 `이름`(`clean_name`)만 남기고,
/// 2) 모든 문장 시작에 `[00:00:00]`(`HH:MM:SS`) 오프셋 시각이 표시되도록 정규화합니다.
fn normalize_script_lines_with_timestamps_and_clean_name(
    script_body: &str,
    clean_name: &str,
    raw_stem: &str,
) -> String {
    let re_hms = Regex::new(r"\[(\d{1,2}):(\d{2}):(\d{2})\]").unwrap();
    let re_ms = Regex::new(r"\[(\d{1,2}):(\d{2})\]").unwrap();
    let re_speaker_dirty = Regex::new(r"(\*\*\[?)([^\]*:]+_[0-9]{6,}[_0-9]*)(\]?\*\*)").unwrap();

    let mut out_lines: Vec<String> = Vec::new();
    let mut est_sec: u64 = 0;

    for raw_line in script_body.lines() {
        let mut line = raw_line.to_string();
        if !raw_stem.is_empty() && !clean_name.is_empty() && raw_stem != clean_name {
            line = line.replace(raw_stem, clean_name);
        }
        if !clean_name.is_empty() {
            line = re_speaker_dirty
                .replace_all(&line, |caps: &regex::Captures| {
                    format!("{}{}{}", &caps[1], clean_name, &caps[3])
                })
                .to_string();
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('>') || trimmed.starts_with('#') {
            out_lines.push(line);
            continue;
        }

        // 이미 [HH:MM:SS] 포맷이 있는 경우 2자리 패딩 보장 및 est_sec 동기화
        if let Some(cap) = re_hms.captures(&line) {
            let h: u64 = cap[1].parse().unwrap_or(0);
            let m: u64 = cap[2].parse().unwrap_or(0);
            let s: u64 = cap[3].parse().unwrap_or(0);
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            if full_match != formatted {
                line = line.replacen(full_match, &formatted, 1);
            }
            est_sec = h * 3600 + m * 60 + s + 3;
            out_lines.push(line);
            continue;
        }

        // [MM:SS] 포맷이 있는 경우 [00:MM:SS]로 변환
        if let Some(cap) = re_ms.captures(&line) {
            let m_val: u64 = cap[1].parse().unwrap_or(0);
            let s_val: u64 = cap[2].parse().unwrap_or(0);
            let total = m_val * 60 + s_val;
            let h = total / 3600;
            let m = (total % 3600) / 60;
            let s = total % 60;
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            line = line.replacen(full_match, &formatted, 1);
            est_sec = total + 3;
            out_lines.push(line);
            continue;
        }

        // 불릿 라인(`- ...` 또는 `* ...`)인데 타임스탬프가 없는 경우 [00:00:00] 오프셋 부여
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let h = est_sec / 3600;
            let m = (est_sec % 3600) / 60;
            let s = est_sec % 60;
            let ts_tag = format!("[{:02}:{:02}:{:02}]", h, m, s);

            let rest = &trimmed[2..].trim_start();
            let updated_line = if let Some(after_bold) = rest.strip_prefix("**[") {
                if let Some(close_idx) = after_bold.find("]**") {
                    let spk = after_bold[..close_idx].trim();
                    let clean_spk = if spk.contains('_') && !clean_name.is_empty() {
                        clean_name
                    } else {
                        spk
                    };
                    let after_spk = &after_bold[close_idx + 3..];
                    format!("- **{} {}**{}", ts_tag, clean_spk, after_spk)
                } else {
                    format!("- **{}** {}", ts_tag, rest)
                }
            } else if let Some(after_bold) = rest.strip_prefix("**") {
                format!("- **{} {}", ts_tag, after_bold)
            } else {
                format!("- **{}** {}", ts_tag, rest)
            };

            let char_count = rest.chars().count() as u64;
            let step_sec = (char_count / 5).clamp(2, 12);
            est_sec += step_sec;
            out_lines.push(updated_line);
        } else {
            out_lines.push(line);
        }
    }

    out_lines.join("\n")
}

/// LLM(Gemini)이 생성한 통화 분석 텍스트를 1) 요약부 와 2) 스크립트 2개 섹션으로 분리합니다.
fn split_summary_and_transcript(raw_llm_text: &str) -> (String, String) {
    let cleaned = raw_llm_text.trim();
    if cleaned.is_empty() {
        return (String::new(), String::new());
    }

    let script_markers = [
        "## 📜 스크립트",
        "## 스크립트",
        "### 📜 스크립트",
        "2. **📜 화자 분리 대화 스크립트**:",
        "2. **화자 분리 대화 스크립트**:",
        "**📜 화자 분리 대화 스크립트**",
        "## 대화 스크립트",
    ];

    for marker in script_markers {
        if let Some(idx) = cleaned.find(marker) {
            let summary_raw = cleaned[..idx]
                .replace("## 💡 요약", "")
                .replace("## 요약", "")
                .replace("### 💡 요약", "")
                .replace("1. **💡 통화 핵심 요약**:", "")
                .replace("1. **통화 핵심 요약**:", "")
                .replace("**💡 통화 핵심 요약**", "")
                .trim()
                .trim_end_matches("---")
                .trim()
                .to_string();
            let script_raw = cleaned[idx + marker.len()..]
                .trim()
                .trim_start_matches(':')
                .trim()
                .to_string();
            return (
                if summary_raw.is_empty() {
                    "- 통화 요약 내용이 아래 스크립트에 포함되어 있습니다.".to_string()
                } else {
                    summary_raw
                },
                if script_raw.is_empty() {
                    cleaned.to_string()
                } else {
                    script_raw
                },
            );
        }
    }

    // 마커가 없을 경우 첫 단락을 요약부로, 전체를 스크립트로 분리
    let lines: Vec<&str> = cleaned.lines().collect();
    if lines.len() > 3 {
        let summary_part = lines[..std::cmp::min(3, lines.len())].join("\n");
        let script_part = cleaned.to_string();
        (summary_part, script_part)
    } else {
        (cleaned.to_string(), cleaned.to_string())
    }
}

/// 통화 녹음 파일과 동일한 파일명(`mobile/calls/{audio_file_stem}.md`)으로
/// 1) 요약부(`## 💡 요약`)와 2) 스크립트(`## 📜 스크립트`) 2부분 구조의 마크다운 파일을 생성/갱신합니다.
fn write_call_recording_markdown(
    conn: &Connection,
    audio_file_name: &str,
    contact_display: &str,
    recorded_date: &str,
    recorded_time: &str,
    transcript_opt: Option<&str>,
    quota_error_info: Option<(&str, &str, &str)>, // (exhausted_at_str, retry_after_str, error_msg)
) -> PathBuf {
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    let raw_stem = Path::new(audio_file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| audio_file_name.to_string());
    let safe_stem = sanitize_filename_stem(&raw_stem);
    let md_path = calls_dir.join(format!("{}.md", safe_stem));
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 기존 파일에 UUID가 있으면 유지
    let existing_uuid = if md_path.exists() {
        fs::read_to_string(&md_path)
            .ok()
            .and_then(|c| {
                let (_, _, fm) = parse_markdown_yaml(&c);
                fm.get("uuid").cloned()
            })
            .filter(|u| !u.is_empty())
    } else {
        None
    };
    let doc_uuid = existing_uuid.unwrap_or_else(|| Uuid::new_v4().to_string());

    let (status_str, summary_body, script_body) = if let Some(tr) = transcript_opt.filter(|s| !s.trim().is_empty()) {
        let (sum_s, scr_s) = split_summary_and_transcript(tr);
        let norm_scr = normalize_script_lines_with_timestamps_and_clean_name(
            &scr_s,
            contact_display,
            &raw_stem,
        );
        ("completed", sum_s, norm_scr)
    } else if let Some((ex_at, retry_at, err_m)) = quota_error_info {
        (
            "pending_quota",
            format!(
                "> ⚠️ **LLM 토큰 부족/한도 초과로 인해 아직 요약이 생성되지 않았습니다.**\n\
                 > - **토큰 고갈 감지 시점**: `{}`\n\
                 > - **5시간 후 자동 재시도 예정 시점**: **`{}`**\n\
                 > - **상세 사유**: {}",
                ex_at, retry_at, err_m
            ),
            format!(
                "> ⏳ **5시간 후(`{}`)에 자동으로 LLM 스크립트 변환을 재시도합니다.**\n\
                 > *(상단 `[🔄 지금 즉시 스크립트 생성 재시도]` 버튼을 눌러 즉시 재시도할 수도 있습니다.)*",
                retry_at
            ),
        )
    } else {
        (
            "pending_quota",
            "> ⏳ **LLM 통화 요약 생성 대기 중입니다.** (자동 변환 스케줄러가 순차 처리하거나 5시간 후 자동 재시도합니다.)".to_string(),
            "> ⏳ **LLM 화자 분리 스크립트 생성 대기 중입니다.**".to_string(),
        )
    };

    let md_content = format!(
        "---\n\
         uuid: \"{}\"\n\
         title: \"{}\"\n\
         category: \"mobile/calls\"\n\
         audio_file: \"audio/{}\"\n\
         contact_name: \"{}\"\n\
         recorded_date: \"{}\"\n\
         recorded_time: \"{}\"\n\
         transcript_status: \"{}\"\n\
         device_aliases: [\"핸드폰\", \"휴대폰\", \"스마트폰\", \"갤럭시\", \"모바일\"]\n\
         source_aliases: [\"통화\", \"통화내역\", \"통화녹음\", \"통화스크립트\", \"전화\"]\n\
         last_synced: \"{}\"\n\
         ---\n\n\
         # 📞 {}\n\n\
         > **통화 상대방**: {} | **통화 일시**: {} {} | **원본 녹음파일**: `audio/{}`\n\n\
         ## 💡 요약\n\n\
         {}\n\n\
         ---\n\n\
         ## 📜 스크립트\n\n\
         {}\n",
        doc_uuid,
        contact_display.replace('"', "\\\""),
        audio_file_name.replace('"', "\\\""),
        contact_display.replace('"', "\\\""),
        recorded_date,
        recorded_time,
        status_str,
        now_str,
        contact_display,
        contact_display,
        recorded_date,
        recorded_time,
        audio_file_name,
        summary_body,
        script_body
    );

    let _ = fs::write(&md_path, md_content.as_bytes());
    md_path
}

/// 독백녹음·회의녹음(`mobile/recordings/{audio_file_stem}.md`) 마크다운 생성/갱신
/// 녹음 출처(`recording_source`: 기기명 예 `SM-S901N` 또는 `갤럭시 워치`)를 구분하여 저장하며,
/// 음성메모·회의록 톤의 요약부(`## 💡 요약`)와 스크립트(`## 📜 스크립트`) 2부분으로 작성합니다.
fn write_voice_recording_markdown(
    conn: &Connection,
    audio_file_name: &str,
    recording_source: &str,
    recorded_date: &str,
    recorded_time: &str,
    transcript_opt: Option<&str>,
    quota_error_info: Option<(&str, &str, &str)>,
) -> PathBuf {
    let rec_dir = get_archive_mobile_dir(conn, "recordings");
    let raw_stem = Path::new(audio_file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| audio_file_name.to_string());
    let safe_stem = sanitize_filename_stem(&raw_stem);
    let md_path = rec_dir.join(format!("{}.md", safe_stem));
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let existing_uuid = if md_path.exists() {
        fs::read_to_string(&md_path)
            .ok()
            .and_then(|c| {
                let (_, _, fm) = parse_markdown_yaml(&c);
                fm.get("uuid").cloned()
            })
            .filter(|u| !u.is_empty())
    } else {
        None
    };
    let doc_uuid = existing_uuid.unwrap_or_else(|| Uuid::new_v4().to_string());

    let (status_str, summary_body, script_body) = if let Some(tr) = transcript_opt.filter(|s| !s.trim().is_empty()) {
        let (sum_s, scr_s) = split_summary_and_transcript(tr);
        let norm_scr = normalize_script_lines_with_timestamps_and_clean_name(
            &scr_s,
            recording_source,
            &raw_stem,
        );
        ("completed", sum_s, norm_scr)
    } else if let Some((ex_at, retry_at, err_m)) = quota_error_info {
        (
            "pending_quota",
            format!(
                "> ⚠️ **LLM 토큰 부족/한도 초과로 인해 아직 음성메모·회의 요약이 생성되지 않았습니다.**\n\
                 > - **토큰 고갈 감지 시점**: `{}`\n\
                 > - **5시간 후 자동 재시도 예정 시점**: **`{}`**\n\
                 > - **상세 사유**: {}",
                ex_at, retry_at, err_m
            ),
            format!(
                "> ⏳ **5시간 후(`{}`)에 자동으로 LLM 음성녹음 스크립트 변환을 재시도합니다.**",
                retry_at
            ),
        )
    } else {
        (
            "pending_quota",
            "> ⏳ **음성메모/회의록 핵심 요약 및 Action Items 추출 대기 중입니다.** (우클릭 메뉴에서 '스크립트 추출 및 요약'을 실행하거나 자동 추출을 기다려 주세요.)".to_string(),
            "> ⏳ **음성메모/회의 전체 스크립트 생성 대기 중입니다.**".to_string(),
        )
    };

    let icon = if recording_source.contains("워치") {
        "⌚"
    } else {
        "🎙️"
    };

    let md_content = format!(
        "---\n\
         uuid: \"{}\"\n\
         title: \"{}\"\n\
         category: \"mobile/recordings\"\n\
         audio_file: \"audio/{}\"\n\
         recording_source: \"{}\"\n\
         recorded_date: \"{}\"\n\
         recorded_time: \"{}\"\n\
         transcript_status: \"{}\"\n\
         device_aliases: [\"핸드폰\", \"휴대폰\", \"갤럭시\", \"워치\", \"갤럭시워치\", \"음성메모\"]\n\
         source_aliases: [\"녹음\", \"음성녹음\", \"음성메모\", \"회의녹음\", \"독백녹음\"]\n\
         last_synced: \"{}\"\n\
         ---\n\n\
         # {} [{}] {}\n\n\
         > **녹음 출처**: `{}` | **녹음 일시**: {} {} | **원본 녹음파일**: `audio/{}`\n\n\
         ## 💡 요약\n\n\
         {}\n\n\
         ---\n\n\
         ## 📜 스크립트\n\n\
         {}\n",
        doc_uuid,
        safe_stem.replace('"', "\\\""),
        audio_file_name.replace('"', "\\\""),
        recording_source.replace('"', "\\\""),
        recorded_date,
        recorded_time,
        status_str,
        now_str,
        icon,
        recording_source,
        safe_stem,
        recording_source,
        recorded_date,
        recorded_time,
        audio_file_name,
        summary_body,
        script_body
    );

    let _ = fs::write(&md_path, md_content.as_bytes());
    md_path
}

/// 단일 통화녹음 또는 음성녹음 항목만 즉시 `lifelog_messages`에 $O(1)$로 반영합니다 (전체 폴더 풀스캔 방지).
fn upsert_single_recording_into_lifelog_db(
    conn: &Connection,
    is_voice_memo: bool,
    file_stem: &str,
    display_or_source: &str,
    rec_date: &str,
    rec_time: &str,
    transcript_opt: Option<&str>,
    dev_id: &str,
    dev_name: &str,
) {
    let safe_stem = sanitize_filename_stem(file_stem);
    let is_completed = transcript_opt
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let mut summary_preview = String::new();
    if let Some(tr) = transcript_opt {
        let (sum_s, _) = split_summary_and_transcript(tr);
        for line in sum_s.lines() {
            let tl = line.trim();
            if !tl.is_empty()
                && !tl.starts_with('#')
                && !tl.starts_with('>')
                && !tl.starts_with("---")
            {
                summary_preview = tl.to_string();
                break;
            }
        }
    }

    let attach_tag = if is_completed {
        format!("transcribed:{}", safe_stem)
    } else {
        format!("pending_transcript:{}", safe_stem)
    };

    if is_voice_memo {
        let dedup_key = format!("voice_rec|{}", safe_stem);
        let source_badge = if display_or_source.contains("워치") {
            "⌚ 워치"
        } else {
            display_or_source
        };
        let msg_text = if is_completed {
            if summary_preview.is_empty() {
                format!("🎙️ [{} · 회의/음성메모 요약 완료] {}", source_badge, safe_stem)
            } else {
                format!("🎙️ [{}] {}", source_badge, summary_preview)
            }
        } else {
            let retry_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
            if retry_ms > chrono::Local::now().timestamp_millis() {
                let (_, retry_t) = epoch_ms_to_local_date_time(retry_ms);
                format!(
                    "⚠️ [LLM 토큰 부족 · {} 자동 재시도] [{}] {}",
                    &retry_t[..std::cmp::min(5, retry_t.len())],
                    source_badge,
                    safe_stem
                )
            } else {
                format!(
                    "🎙️ [{}] {} (스크립트 미생성 · 우클릭하여 회의/음성메모 요약 추출)",
                    source_badge, safe_stem
                )
            }
        };
        let eff_dev_id = if dev_id.is_empty() {
            "dev_c6ffadd525"
        } else {
            dev_id
        };
        let eff_dev_name = if dev_name.is_empty() {
            display_or_source
        } else {
            dev_name
        };
        let _ = conn.execute(
            "INSERT INTO lifelog_messages
             (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
             VALUES ('recording', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(dedup_key) DO UPDATE SET
                room_or_sender = excluded.room_or_sender,
                sender = excluded.sender,
                message = excluded.message,
                sent_date = excluded.sent_date,
                sent_time = excluded.sent_time,
                attachment_uuid = excluded.attachment_uuid,
                device_name = excluded.device_name",
            params![
                safe_stem,
                display_or_source,
                msg_text,
                rec_date,
                rec_time,
                attach_tag,
                dedup_key,
                eff_dev_id,
                eff_dev_name
            ],
        );
    } else {
        let dedup_key = format!("call_rec|{}", safe_stem);
        let msg_text = if is_completed {
            if summary_preview.is_empty() {
                format!(
                    "🎙️ [통화 스크립트 완료] {} ({})",
                    display_or_source, safe_stem
                )
            } else {
                format!("🎙️ {}", summary_preview)
            }
        } else {
            let retry_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
            if retry_ms > chrono::Local::now().timestamp_millis() {
                let (_, retry_t) = epoch_ms_to_local_date_time(retry_ms);
                format!(
                    "⚠️ [LLM 토큰 부족 · {} 자동 재시도] {} ({})",
                    &retry_t[..std::cmp::min(5, retry_t.len())],
                    display_or_source,
                    safe_stem
                )
            } else {
                format!(
                    "⚠️ [스크립트 미생성 · 자동 변환 대기] {} ({})",
                    display_or_source, safe_stem
                )
            }
        };
        let eff_dev_name = if dev_name.is_empty() {
            "모바일 통화녹음"
        } else {
            dev_name
        };
        let _ = conn.execute(
            "INSERT INTO lifelog_messages
             (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
             VALUES ('call', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(dedup_key) DO UPDATE SET
                room_or_sender = excluded.room_or_sender,
                sender = excluded.sender,
                message = excluded.message,
                sent_date = excluded.sent_date,
                sent_time = excluded.sent_time,
                attachment_uuid = excluded.attachment_uuid",
            params![
                safe_stem,
                display_or_source,
                msg_text,
                rec_date,
                rec_time,
                attach_tag,
                dedup_key,
                dev_id,
                eff_dev_name
            ],
        );
    }
}

/// 오디오 파일 앞부분 16바이트만 확인하여 Multipart 헤더(`--`)로 시작할 때에만 전체 파일을 읽어 복구합니다 (대용량 오디오 불필요 I/O 제거).
fn repair_multipart_audio_file_if_needed(p: &Path) {
    use std::io::Read;
    if let Ok(mut f) = fs::File::open(p) {
        let mut head = [0u8; 16];
        let n = f.read(&mut head).unwrap_or(0);
        if n >= 2 && head.starts_with(b"--") {
            drop(f);
            if let Ok(raw_bytes) = fs::read(p) {
                let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
                if repaired {
                    let _ = fs::write(p, &clean_bytes);
                }
            }
        }
    }
}

fn backfill_mobile_md_into_lifelog_db(conn: &Connection) {
    let contacts_map = load_mobile_contacts_map(conn);

    // 1. 이전에 Multipart 바운더리가 파일명으로 잘못 들어간 `mobile/calls/--*.md` 및 DB 레코드 자동 정리
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    if let Ok(entries) = fs::read_dir(&calls_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(fname) = p.file_name().and_then(|s| s.to_str()) {
                    if fname.starts_with("--") && fname.ends_with(".md") {
                        let _ = fs::remove_file(&p);
                    }
                }
            }
        }
    }
    let _ = conn.execute(
        "DELETE FROM lifelog_messages WHERE source = 'call' AND room_or_sender LIKE '--%'",
        [],
    );

    // 2. `mobile/calls/audio/` 내 모든 통화 녹음 파일 스캔:
    //    - 잘못 붙은 Multipart 헤더가 있으면 순수 오디오로 자동 복구
    //    - 만약 독백/회의/워치 녹음 파일이 `calls/audio`에 섞여 있다면 `recordings/audio`로 자동 분류 이동
    //    - 통화파일명과 동일한 `mobile/calls/{통화파일명}.md` (요약부 + 스크립트 2부분) 보장
    //    - `lifelog_messages` 에 통화 녹음 상태(완료 vs 미생성/토큰부족) 동기화
    let audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");
    let _ = fs::create_dir_all(&rec_audio_dir);

    if let Ok(entries) = fs::read_dir(&audio_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                continue;
            }
            let file_name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let file_stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if file_stem.is_empty() {
                continue;
            }

            repair_multipart_audio_file_if_needed(&p);

            // 독백/회의/워치 음성녹음이면 `mobile/recordings/audio/`로 이동
            let (is_voice_memo, _) = is_voice_memo_or_watch_recording(&file_name, "", "SM-S901N");
            if is_voice_memo {
                let dest = rec_audio_dir.join(&file_name);
                if !dest.exists() {
                    let _ = fs::copy(&p, &dest);
                }
                let _ = fs::remove_file(&p);
                continue;
            }

            let (contact_display, rec_date, rec_time) =
                parse_call_audio_filename_meta(&file_stem, &contacts_map);
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = calls_dir.join(format!("{}.md", safe_stem));

            let mut is_completed = false;
            let mut summary_preview = String::new();
            if md_path.exists() {
                if let Ok(md_raw) = fs::read_to_string(&md_path) {
                    let (fm, body) = parse_frontmatter_and_body_simple(&md_raw);
                    if fm.get("transcript_status").map(|s| s.as_str()) == Some("completed") {
                        is_completed = true;
                        // 기존 스크립트에 `[00:00:00]` 타임스탬프가 없거나 `이름_전화번호_날짜`가 남아있으면 자동 정제 업그레이드
                        let needs_upgrade = (file_stem != contact_display && body.contains(&file_stem))
                            || fm.get("contact_name").map(|s| s.as_str()) != Some(contact_display.as_str())
                            || !body.contains("[00:");
                        if needs_upgrade {
                            write_call_recording_markdown(
                                conn,
                                &file_name,
                                &contact_display,
                                &rec_date,
                                &rec_time,
                                Some(&body),
                                None,
                            );
                        }
                        for line in body.lines() {
                            let tl = line.trim();
                            if !tl.is_empty()
                                && !tl.starts_with('#')
                                && !tl.starts_with('>')
                                && !tl.starts_with("---")
                            {
                                summary_preview = tl.to_string();
                                break;
                            }
                        }
                    } else if fm.get("contact_name").map(|s| s.as_str()) != Some(contact_display.as_str()) {
                        write_call_recording_markdown(
                            conn,
                            &file_name,
                            &contact_display,
                            &rec_date,
                            &rec_time,
                            None,
                            None,
                        );
                    }
                }
            } else {
                write_call_recording_markdown(
                    conn,
                    &file_name,
                    &contact_display,
                    &rec_date,
                    &rec_time,
                    None,
                    None,
                );
            }

            let dedup_key = format!("call_rec|{}", safe_stem);
            let attach_tag = if is_completed {
                format!("transcribed:{}", safe_stem)
            } else {
                format!("pending_transcript:{}", safe_stem)
            };
            let msg_text = if is_completed {
                if summary_preview.is_empty() {
                    format!("🎙️ [통화 스크립트 완료] {} ({})", contact_display, safe_stem)
                } else {
                    format!("🎙️ {}", summary_preview)
                }
            } else {
                let retry_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
                if retry_ms > chrono::Local::now().timestamp_millis() {
                    let (_, retry_t) = epoch_ms_to_local_date_time(retry_ms);
                    format!(
                        "⚠️ [LLM 토큰 부족 · {} 자동 재시도] {} ({})",
                        &retry_t[..std::cmp::min(5, retry_t.len())],
                        contact_display,
                        safe_stem
                    )
                } else {
                    format!(
                        "⚠️ [스크립트 미생성 · 자동 변환 대기] {} ({})",
                        contact_display, safe_stem
                    )
                }
            };

            let _ = conn.execute(
                "INSERT INTO lifelog_messages
                 (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
                 VALUES ('call', ?1, ?2, ?3, ?4, ?5, ?6, ?7, '', '모바일 통화녹음')
                 ON CONFLICT(dedup_key) DO UPDATE SET
                    room_or_sender = excluded.room_or_sender,
                    sender = excluded.sender,
                    message = excluded.message,
                    sent_date = excluded.sent_date,
                    sent_time = excluded.sent_time,
                    attachment_uuid = excluded.attachment_uuid",
                params![
                    safe_stem,
                    contact_display,
                    msg_text,
                    rec_date,
                    rec_time,
                    attach_tag,
                    dedup_key
                ],
            );
        }
    }

    // 2-B. `mobile/recordings/audio/` 내 독백녹음·회의녹음·워치 음성메모 스캔 및 `source = 'recording'` 동기화
    let _ = conn.execute(
        "DELETE FROM lifelog_messages WHERE source = 'recording' AND dedup_key NOT LIKE 'voice_rec|%'",
        [],
    );
    if let Ok(entries) = fs::read_dir(&rec_audio_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                continue;
            }
            let file_name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let file_stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if file_stem.is_empty() {
                continue;
            }

            repair_multipart_audio_file_if_needed(&p);

            let (_disp_title, rec_source, rec_date, rec_time) =
                parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = rec_dir.join(format!("{}.md", safe_stem));

            let mut is_completed = false;
            let mut summary_preview = String::new();
            if md_path.exists() {
                if let Ok(md_raw) = fs::read_to_string(&md_path) {
                    let (fm, body) = parse_frontmatter_and_body_simple(&md_raw);
                    if fm.get("transcript_status").map(|s| s.as_str()) == Some("completed") {
                        is_completed = true;
                        for line in body.lines() {
                            let tl = line.trim();
                            if !tl.is_empty()
                                && !tl.starts_with('#')
                                && !tl.starts_with('>')
                                && !tl.starts_with("---")
                            {
                                summary_preview = tl.to_string();
                                break;
                            }
                        }
                    }
                }
            } else {
                write_voice_recording_markdown(
                    conn,
                    &file_name,
                    &rec_source,
                    &rec_date,
                    &rec_time,
                    None,
                    None,
                );
            }

            let dedup_key = format!("voice_rec|{}", safe_stem);
            let attach_tag = if is_completed {
                format!("transcribed:{}", safe_stem)
            } else {
                format!("pending_transcript:{}", safe_stem)
            };
            let source_badge = if rec_source.contains("워치") {
                "⌚ 워치"
            } else {
                &rec_source
            };
            let msg_text = if is_completed {
                if summary_preview.is_empty() {
                    format!("🎙️ [{} · 회의/음성메모 요약 완료] {}", source_badge, safe_stem)
                } else {
                    format!("🎙️ [{}] {}", source_badge, summary_preview)
                }
            } else {
                let retry_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
                if retry_ms > chrono::Local::now().timestamp_millis() {
                    let (_, retry_t) = epoch_ms_to_local_date_time(retry_ms);
                    format!(
                        "⚠️ [LLM 토큰 부족 · {} 자동 재시도] [{}] {}",
                        &retry_t[..std::cmp::min(5, retry_t.len())],
                        source_badge,
                        safe_stem
                    )
                } else {
                    format!(
                        "🎙️ [{}] {} (스크립트 미생성 · 우클릭하여 회의/음성메모 요약 추출)",
                        source_badge, safe_stem
                    )
                }
            };

            let _ = conn.execute(
                "INSERT INTO lifelog_messages
                 (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
                 VALUES ('recording', ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'dev_c6ffadd525', ?8)
                 ON CONFLICT(dedup_key) DO UPDATE SET
                    room_or_sender = excluded.room_or_sender,
                    sender = excluded.sender,
                    message = excluded.message,
                    sent_date = excluded.sent_date,
                    sent_time = excluded.sent_time,
                    attachment_uuid = excluded.attachment_uuid,
                    device_name = excluded.device_name",
                params![
                    safe_stem,
                    rec_source,
                    msg_text,
                    rec_date,
                    rec_time,
                    attach_tag,
                    dedup_key,
                    rec_source
                ],
            );
        }
    }

    // 3. 카카오톡 `.md` 백필
    let kakao_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'kakaotalk'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if kakao_count == 0 {
        let kakao_dir = get_archive_mobile_dir(conn, "kakao");
        if let Ok(entries) = fs::read_dir(&kakao_dir) {
            let line_re = Regex::new(r"^- \*\*\[([^\]]+)\]\s*([^\*]+)\*\*:\s*(.*)$").unwrap();
            let date_re = Regex::new(r"^##\s*📅\s*(\d{4}-\d{2}-\d{2})").unwrap();
            let android_re = Regex::new(
                r"^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+(오전|오후)\s*(\d{1,2}:\d{2}),\s*([^:]+?)\s*:\s*(.*)$",
            )
            .unwrap();

            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("md") {
                    continue;
                }
                let room_name = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "카카오톡".to_string());
                if let Ok(content) = fs::read_to_string(&p) {
                    let mut current_date = chrono::Local::now().format("%Y-%m-%d").to_string();
                    for raw_line in content.lines() {
                        let trimmed = raw_line.trim();
                        if let Some(dc) = date_re.captures(trimmed) {
                            if let Some(m) = dc.get(1) {
                                current_date = m.as_str().to_string();
                            }
                            continue;
                        }
                        if let Some(lc) = line_re.captures(trimmed) {
                            let time_str = lc.get(1).map(|m| m.as_str()).unwrap_or("");
                            let sender = lc.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                            let body = lc.get(3).map(|m| m.as_str()).unwrap_or("");
                            let dedup_raw = format!(
                                "kakao|{}|{}|{}|{}|{}",
                                room_name, current_date, time_str, sender, body
                            );
                            let dedup_key =
                                blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                            let _ = conn.execute(
                                "INSERT OR IGNORE INTO lifelog_messages
                                 (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                 VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6, '', '모바일 아카이브')",
                                params![room_name, sender, body, current_date, time_str, dedup_key],
                            );
                        } else if let Some(ac) = android_re.captures(trimmed) {
                            let y = ac.get(1).map(|m| m.as_str()).unwrap_or("2026");
                            let m: u32 = ac
                                .get(2)
                                .and_then(|m| m.as_str().parse().ok())
                                .unwrap_or(1);
                            let d: u32 = ac
                                .get(3)
                                .and_then(|m| m.as_str().parse().ok())
                                .unwrap_or(1);
                            let ampm = ac.get(4).map(|m| m.as_str()).unwrap_or("오전");
                            let hm = ac.get(5).map(|m| m.as_str()).unwrap_or("00:00");
                            let sender = ac.get(6).map(|m| m.as_str().trim()).unwrap_or("");
                            let body = ac.get(7).map(|m| m.as_str()).unwrap_or("");
                            current_date = format!("{}-{:02}-{:02}", y, m, d);
                            let time_str = format!("{} {}", ampm, hm);
                            let dedup_raw = format!(
                                "kakao|{}|{}|{}|{}|{}",
                                room_name, current_date, time_str, sender, body
                            );
                            let dedup_key =
                                blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                            let _ = conn.execute(
                                "INSERT OR IGNORE INTO lifelog_messages
                                 (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                 VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6, '', '모바일 아카이브')",
                                params![room_name, sender, body, current_date, time_str, dedup_key],
                            );
                        }
                    }
                }
            }
        }
    }

    // 4. SMS `lifelog_messages` -> `mobile/sms/{address}.md` 백필
    let sms_dir = get_archive_mobile_dir(conn, "sms");
    let has_sms_md = fs::read_dir(&sms_dir)
        .ok()
        .map(|it| {
            it.flatten()
                .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        })
        .unwrap_or(false);
    if !has_sms_md {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT room_or_sender, sender, message, sent_date, sent_time
             FROM lifelog_messages
             WHERE source = 'sms'
             ORDER BY sent_date ASC, sent_time ASC, id ASC",
        ) {
            let rows: Vec<(String, String, String, String, String)> = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .ok()
                .map(|it| it.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();
            for (addr, sender, msg, sdate, stime) in rows {
                let is_sent = sender == "나 (문자발신)" || sender.contains("발신");
                let dir_tag = if is_sent { "📤 발신" } else { "📥 수신" };
                let display_name = resolve_contact_display(&addr, &contacts_map);
                let sender_lbl = if is_sent {
                    "나 (문자발신)".to_string()
                } else {
                    display_name.clone()
                };
                let md_line = format!(
                    "- **[{}] [{}] {}**: {}",
                    stime,
                    dir_tag,
                    sender_lbl,
                    clean_mms_and_multiline_body(&msg)
                );
                append_line_to_mobile_md(
                    conn,
                    "sms",
                    &addr,
                    &format!("[문자(SMS) 내역] {}", display_name),
                    "[\"문자\", \"문자내역\", \"메시지\", \"SMS\", \"MMS\"]",
                    &sdate,
                    &md_line,
                );
            }
        }
    }

    // 4-B. 기존 DB 내 깨진 MMS 제목(`[ì œëª©ì—†ì Œ]`) 또는 RCS JSON 문자열 자동 정화
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, message FROM lifelog_messages
         WHERE source = 'sms' AND (message LIKE '[ì%' OR message LIKE '[제목없음]%' OR message LIKE '{\"layout\":%' OR message LIKE '%\n%')",
    ) {
        let dirty_rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .map(|it| it.filter_map(|x| x.ok()).collect())
            .unwrap_or_default();
        for (row_id, raw_msg) in dirty_rows {
            let cleaned = clean_mms_and_multiline_body(&raw_msg);
            if cleaned != raw_msg {
                let _ = conn.execute(
                    "UPDATE lifelog_messages SET message = ?1 WHERE id = ?2",
                    params![cleaned, row_id],
                );
            }
        }
    }

    // 5. 알림 `lifelog_messages` -> `mobile/notifications/{ym}_알람내역.md` 백필
    let noti_dir = get_archive_mobile_dir(conn, "notifications");
    let has_noti_md = fs::read_dir(&noti_dir)
        .ok()
        .map(|it| {
            it.flatten()
                .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        })
        .unwrap_or(false);
    if !has_noti_md {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT room_or_sender, sender, message, sent_date, sent_time
             FROM lifelog_messages
             WHERE source = 'notification'
             ORDER BY sent_date ASC, sent_time ASC, id ASC",
        ) {
            let rows: Vec<(String, String, String, String, String)> = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .ok()
                .map(|it| it.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();
            for (pkg, title, msg, sdate, stime) in rows {
                let ym = if sdate.len() >= 7 {
                    &sdate[..7]
                } else {
                    "최근"
                };
                let md_line = format!(
                    "- **[{}] `{}` {}**: {}",
                    stime,
                    pkg,
                    title,
                    msg.replace('\n', " ")
                );
                append_line_to_mobile_md(
                    conn,
                    "notifications",
                    &format!("{}_알람내역", ym),
                    &format!("[모바일 알림내역] {}", ym),
                    "[\"알림\", \"알림내역\", \"푸시알림\", \"앱알림\", \"Notification\"]",
                    &sdate,
                    &md_line,
                );
            }
        }
    }
}

fn parse_frontmatter_and_body_simple(raw: &str) -> (HashMap<String, String>, String) {
    let (_, body, fm) = parse_markdown_yaml(raw);
    (fm, body)
}

/// 카카오톡 `.md` 문서 내 이미지(`.jpg`, `.png`, `.gif`, `.webp`) 및 동영상(`.mp4`, `.mov`, `<동영상 읽지 않음>` 등)
/// 항목을 스캔하여 연결된 미디어 파일 정보 블록을 자동으로 업데이트합니다.
fn enrich_kakao_markdown_with_media(conn: &Connection, md_path: &Path) {
    let raw = match fs::read_to_string(md_path) {
        Ok(s) => s,
        Err(_) => return,
    };

    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    let kakao_media_dir = kakao_dir.join("media");
    let data_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\iseohyunDocs".to_string());
    let inbox_dir = Path::new(&data_base).join("_MediaInbox");

    let find_local_media = |fname: &str| -> Option<PathBuf> {
        let clean = fname.trim().trim_matches(|c| c == '[' || c == ']' || c == '<' || c == '>');
        if clean.is_empty() {
            return None;
        }
        for dir in [&kakao_media_dir, &kakao_dir, &inbox_dir] {
            let cand = dir.join(clean);
            if cand.exists() && cand.is_file() {
                return Some(cand);
            }
        }
        // `mobile/kakao/{폴더명}/` 하위에 원본 폴더 구조 그대로 적재된 이미지·동영상 탐색
        if let Ok(entries) = fs::read_dir(&kakao_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let cand = p.join(clean);
                    if cand.exists() && cand.is_file() {
                        return Some(cand);
                    }
                }
            }
        }
        None
    };

    let img_re = Regex::new(
        r"(?i)([0-9a-zA-Z가-힣_\-\.\s]{2,120}\.(?:jpg|jpeg|png|gif|webp|bmp))",
    )
    .unwrap();
    let vid_re = Regex::new(
        r"(?i)([0-9a-zA-Z가-힣_\-\.\s]{2,120}\.(?:mp4|mov|webm|mkv|avi|m4v|3gp))",
    )
    .unwrap();

    let lines: Vec<&str> = raw.lines().collect();
    let mut out_lines: Vec<String> = Vec::with_capacity(lines.len() + 32);
    let mut changed = false;

    for i in 0..lines.len() {
        let line = lines[i];
        out_lines.push(line.to_string());

        let trimmed = line.trim();
        if !trimmed.starts_with("- **[") {
            continue;
        }
        // 다음 줄에 이미 미디어 연결 블록이 있으면 중복 추가 생략
        if i + 1 < lines.len() {
            let next_t = lines[i + 1].trim();
            if next_t.starts_with("> 🖼️")
                || next_t.starts_with("> 🎬")
                || next_t.starts_with("- 🖼️")
                || next_t.starts_with("- 🎬")
            {
                continue;
            }
        }

        let msg_part = if let Some(colon_idx) = trimmed.find("**:") {
            trimmed[colon_idx + 3..].trim()
        } else {
            continue;
        };

        if let Some(cap) = img_re.captures(msg_part) {
            if let Some(m) = cap.get(1) {
                let fname = m.as_str().trim();
                let info_line = if let Some(local_p) = find_local_media(fname) {
                    let size_kb = fs::metadata(&local_p)
                        .map(|md| md.len() / 1024)
                        .unwrap_or(0);
                    format!(
                        "  - 🖼️ **[연결된 이미지 정보]** `{}` ({} KB · 로컬 미디어 연결됨)",
                        fname, size_kb
                    )
                } else {
                    format!(
                        "  - 🖼️ **[연결된 이미지 정보]** `{}` (카카오톡 첨부 이미지)",
                        fname
                    )
                };
                out_lines.push(info_line);
                changed = true;
                continue;
            }
        }

        if let Some(cap) = vid_re.captures(msg_part) {
            if let Some(m) = cap.get(1) {
                let fname = m.as_str().trim();
                let info_line = if let Some(local_p) = find_local_media(fname) {
                    let size_kb = fs::metadata(&local_p)
                        .map(|md| md.len() / 1024)
                        .unwrap_or(0);
                    format!(
                        "  - 🎬 **[연결된 동영상 정보]** `{}` ({} KB · 로컬 동영상 연결됨)",
                        fname, size_kb
                    )
                } else {
                    format!(
                        "  - 🎬 **[연결된 동영상 정보]** `{}` (카카오톡 첨부 동영상)",
                        fname
                    )
                };
                out_lines.push(info_line);
                changed = true;
                continue;
            }
        }

        if msg_part == "동영상"
            || msg_part.contains("<동영상")
            || msg_part.starts_with("동영상 ")
        {
            out_lines.push(format!(
                "  - 🎬 **[연결된 동영상 정보]** `{}` (카카오톡 동영상 미디어 항목)",
                msg_part
            ));
            changed = true;
        } else if msg_part == "사진"
            || msg_part.contains("<사진")
            || msg_part.starts_with("사진 ")
        {
            out_lines.push(format!(
                "  - 🖼️ **[연결된 이미지 정보]** `{}` (카카오톡 사진 미디어 항목)",
                msg_part
            ));
            changed = true;
        }
    }

    if changed {
        let updated = out_lines.join("\n") + "\n";
        let _ = fs::write(md_path, updated.as_bytes());
    }
}

#[tauri::command]
async fn open_lifelog_item_document(
    state: State<'_, AppState>,
    source: String,
    room_or_sender: String,
    attachment_uuid: Option<String>,
    sent_date: Option<String>,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let contacts_map = load_mobile_contacts_map(&conn);
        let src = source.trim().to_lowercase();

        let target_md_path: PathBuf = if src == "kakaotalk" {
            let kakao_dir = get_archive_mobile_dir(&conn, "kakao");
            let safe_stem = sanitize_filename_stem(&room_or_sender);
            let mut md_path = kakao_dir.join(format!("{}.md", safe_stem));
            if !md_path.exists() {
                let direct_path = kakao_dir.join(format!("{}.md", room_or_sender.trim()));
                if direct_path.exists() {
                    md_path = direct_path;
                } else if let Ok(mut stmt) = conn.prepare(
                    "SELECT sender, message, sent_date, sent_time
                     FROM lifelog_messages
                     WHERE source = 'kakaotalk' AND room_or_sender = ?1
                     ORDER BY sent_date ASC, sent_time ASC, id ASC",
                ) {
                    let rows: Vec<(String, String, String, String)> = stmt
                        .query_map(params![room_or_sender], |r| {
                            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                        })
                        .ok()
                        .map(|it| it.filter_map(|x| x.ok()).collect())
                        .unwrap_or_default();
                    for (sender, msg, sdate, stime) in rows {
                        let md_line = format!("- **[{}] {}**: {}", stime, sender, msg);
                        append_line_to_mobile_md(
                            &conn,
                            "kakao",
                            &room_or_sender,
                            &format!("[카카오톡 대화내역] {}", room_or_sender),
                            "[\"카카오톡\", \"카톡\", \"단톡방\", \"대화내역\", \"채팅이력\", \"KakaoTalk\"]",
                            &sdate,
                            &md_line,
                        );
                    }
                }
            }
            enrich_kakao_markdown_with_media(&conn, &md_path);
            md_path
        } else if src == "sms" {
            let sms_dir = get_archive_mobile_dir(&conn, "sms");
            let target_digits = normalize_phone_digits(&room_or_sender);
            let display_name = resolve_contact_display(&room_or_sender, &contacts_map);
            let safe_stem = sanitize_filename_stem(if !target_digits.is_empty() {
                &room_or_sender
            } else {
                &display_name
            });
            let md_path = sms_dir.join(format!("{}.md", safe_stem));

            // DB에서 해당 번호(또는 연락처)와 주고받은 모든 과거 문자 대화를 시간순으로 조회하여 최신 `.md` 구성
            if let Ok(mut stmt) = conn.prepare(
                "SELECT room_or_sender, sender, message, sent_date, sent_time
                 FROM lifelog_messages
                 WHERE source = 'sms'
                 ORDER BY sent_date ASC, sent_time ASC, id ASC",
            ) {
                let rows: Vec<(String, String, String, String, String)> = stmt
                    .query_map([], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                    })
                    .ok()
                    .map(|it| it.filter_map(|x| x.ok()).collect())
                    .unwrap_or_default();

                let matched: Vec<(String, String, String, String, String)> = rows
                    .into_iter()
                    .filter(|(r_addr, _, _, _, _)| {
                        if r_addr.trim() == room_or_sender.trim() {
                            return true;
                        }
                        let r_digits = normalize_phone_digits(r_addr);
                        if !target_digits.is_empty()
                            && target_digits.len() >= 8
                            && r_digits == target_digits
                        {
                            return true;
                        }
                        resolve_contact_display(r_addr, &contacts_map) == display_name
                    })
                    .collect();

                if !matched.is_empty() {
                    let existing_uuid = if md_path.exists() {
                        fs::read_to_string(&md_path)
                            .ok()
                            .and_then(|c| {
                                let (_, _, fm) = parse_markdown_yaml(&c);
                                fm.get("uuid").cloned()
                            })
                            .filter(|u| !u.is_empty())
                    } else {
                        None
                    };
                    let doc_uuid = existing_uuid.unwrap_or_else(|| Uuid::new_v4().to_string());
                    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                    let raw_phone = matched
                        .first()
                        .map(|(a, _, _, _, _)| a.clone())
                        .unwrap_or_else(|| room_or_sender.clone());

                    let mut content = format!(
                        "---\n\
                         uuid: \"{}\"\n\
                         title: \"[문자(SMS) 내역] {}\"\n\
                         category: \"mobile/sms\"\n\
                         phone_number: \"{}\"\n\
                         contact_name: \"{}\"\n\
                         device_aliases: [\"핸드폰\", \"휴대폰\", \"스마트폰\", \"갤럭시\", \"모바일\"]\n\
                         source_aliases: [\"문자\", \"문자내역\", \"메시지\", \"SMS\", \"MMS\"]\n\
                         last_synced: \"{}\"\n\
                         ---\n\n\
                         # ✉️ {}\n\n\
                         > **상대방**: {} | **전화번호**: `{}`\n\n\
                         ---\n",
                        doc_uuid,
                        display_name.replace('"', "\\\""),
                        raw_phone.replace('"', "\\\""),
                        display_name.replace('"', "\\\""),
                        now_str,
                        display_name,
                        display_name,
                        raw_phone
                    );

                    let mut cur_date = String::new();
                    for (_, sender, msg, sdate, stime) in matched {
                        if sdate != cur_date {
                            cur_date = sdate.clone();
                            content.push_str(&format!("\n## 📅 {}\n", cur_date));
                        }
                        let is_sent = sender == "나 (문자발신)"
                            || sender.contains("발신")
                            || msg.trim_start().starts_with("[발신]");
                        let dir_tag = if is_sent { "📤 발신" } else { "📥 수신" };
                        let sender_lbl = if is_sent {
                            "나 (문자발신)".to_string()
                        } else {
                            display_name.clone()
                        };
                        let clean_msg = clean_mms_and_multiline_body(
                            msg.trim_start().trim_start_matches("[발신]").trim_start(),
                        );
                        let time_hms = if stime.len() == 5 {
                            format!("{}:00", stime)
                        } else {
                            stime
                        };
                        content.push_str(&format!(
                            "- **[{}] [{}] {}**: {}\n",
                            time_hms, dir_tag, sender_lbl, clean_msg
                        ));
                    }
                    let _ = fs::write(&md_path, content.as_bytes());
                }
            }
            md_path
        } else if src == "call" {
            let calls_dir = get_archive_mobile_dir(&conn, "calls");
            if let Some((_, file_name, file_stem, rec_md_path, _)) =
                find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
            {
                if !rec_md_path.exists() {
                    let (c_disp, r_date, r_time) =
                        parse_call_audio_filename_meta(&file_stem, &contacts_map);
                    write_call_recording_markdown(
                        &conn, &file_name, &c_disp, &r_date, &r_time, None, None,
                    );
                }
                rec_md_path
            } else {
                let target_stem = sanitize_filename_stem(&room_or_sender);
                let md_path = calls_dir.join(format!("{}.md", target_stem));
                if !md_path.exists() {
                    let display_name = resolve_contact_display(&room_or_sender, &contacts_map);
                    let sdate = sent_date.unwrap_or_else(|| {
                        chrono::Local::now().format("%Y-%m-%d").to_string()
                    });
                    append_line_to_mobile_md(
                        &conn,
                        "calls",
                        &target_stem,
                        &format!("[통화내역 스크립트] {}", display_name),
                        "[\"통화\", \"통화내역\", \"통화내용\", \"전화\"]",
                        &sdate,
                        &format!("- 📞 **{}** 통화 기록", display_name),
                    );
                }
                md_path
            }
        } else if src == "recording" {
            let rec_dir = get_archive_mobile_dir(&conn, "recordings");
            if let Some((_, file_name, file_stem, rec_md_path, _)) =
                find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
            {
                if !rec_md_path.exists() {
                    let (_, rec_source, r_date, r_time) =
                        parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                    write_voice_recording_markdown(
                        &conn, &file_name, &rec_source, &r_date, &r_time, None, None,
                    );
                }
                rec_md_path
            } else {
                let clean_room = room_or_sender
                    .trim()
                    .trim_start_matches("[워치]")
                    .trim_start_matches("[SM-S901N]")
                    .trim();
                let target_stem = sanitize_filename_stem(clean_room);
                let md_path = rec_dir.join(format!("{}.md", target_stem));
                if !md_path.exists() {
                    let (_, rec_source, r_date, r_time) =
                        parse_voice_recording_filename_meta(&target_stem, "SM-S901N");
                    write_voice_recording_markdown(
                        &conn,
                        &format!("{}.m4a", target_stem),
                        &rec_source,
                        &r_date,
                        &r_time,
                        None,
                        None,
                    );
                }
                md_path
            }
        } else if src == "health" {
            let health_dir = get_archive_mobile_dir(&conn, "health");
            let ym = sent_date
                .as_deref()
                .filter(|s| s.len() >= 7)
                .map(|s| &s[..7])
                .unwrap_or_else(|| {
                    if room_or_sender.len() >= 7 && room_or_sender.contains('-') {
                        &room_or_sender[..7]
                    } else {
                        "2026-10"
                    }
                });
            let stem = if room_or_sender.ends_with("_운동기록") {
                room_or_sender.clone()
            } else {
                format!("{}_운동기록", ym)
            };
            let md_path = health_dir.join(format!("{}.md", sanitize_filename_stem(&stem)));
            md_path
        } else {
            let noti_dir = get_archive_mobile_dir(&conn, "notifications");
            let ym = sent_date
                .as_deref()
                .filter(|s| s.len() >= 7)
                .map(|s| &s[..7])
                .unwrap_or("최근");
            let stem = format!("{}_알람내역", ym);
            let md_path = noti_dir.join(format!("{}.md", stem));
            if !md_path.exists() {
                backfill_mobile_md_into_lifelog_db(&conn);
            }
            md_path
        };

        build_document_payload(&conn, &target_md_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_all_lifelog_messages(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<LifelogMessage>, String> {
    let db_path = state.db_path.clone();
    let per_source_limit = (limit.unwrap_or(4000) / 2).max(1200) as i64;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        if LIFELOG_BACKFILLED_ONCE.get().is_none() {
            backfill_mobile_md_into_lifelog_db(&conn);
            let _ = LIFELOG_BACKFILLED_ONCE.set(true);
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                 FROM (
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'kakaotalk'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'notification'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'sms'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'call'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'recording'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'health'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                 )
                 ORDER BY sent_date DESC, sent_time DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let mut rows: Vec<LifelogMessage> = stmt
            .query_map(params![per_source_limit], |r| {
                Ok(LifelogMessage {
                    id: r.get(0)?,
                    source: r.get(1)?,
                    room_or_sender: r.get(2)?,
                    sender: r.get(3)?,
                    message: r.get(4)?,
                    sent_date: r.get(5)?,
                    sent_time: r.get(6)?,
                    attachment_uuid: r.get(7)?,
                    device_id: r.get::<_, String>(8).ok().filter(|s| !s.is_empty()),
                    device_name: r.get::<_, String>(9).ok().filter(|s| !s.is_empty()),
                    has_audio_recording: false,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // 통화/녹음 오디오 파일 디렉터리를 단 1회만 스캔하여 인메모리 인덱스를 구축함으로써
        // 수천 건 조회 시에도 디스크 반복 I/O 및 정규식 재컴파일이 전혀 발생하지 않도록 최적화
        let contacts_map = load_mobile_contacts_map(&conn);
        let calls_audio_dir = get_archive_mobile_dir(&conn, "calls").join("audio");
        let rec_audio_dir = get_archive_mobile_dir(&conn, "recordings").join("audio");

        struct CachedAudioFile {
            file_name: String,
            safe_stem: String,
            c_disp: String,
            c_key: String,
            stem_digits: String,
            r_d: String,
            sort_key: String,
        }

        let mut stem_to_filename: HashMap<String, String> = HashMap::new();
        let mut cached_audios: Vec<CachedAudioFile> = Vec::new();

        for a_dir in [&rec_audio_dir, &calls_audio_dir] {
            if let Ok(entries) = fs::read_dir(a_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if !p.is_file() {
                        continue;
                    }
                    let ext = p
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                        continue;
                    }
                    let file_name = p
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let stem = p
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    if stem.is_empty() {
                        continue;
                    }
                    let safe_stem = sanitize_filename_stem(&stem);
                    stem_to_filename
                        .entry(safe_stem.clone())
                        .or_insert_with(|| file_name.clone());
                    stem_to_filename
                        .entry(stem.clone())
                        .or_insert_with(|| file_name.clone());

                    let (c_disp, r_d, r_t) = parse_call_audio_filename_meta(&stem, &contacts_map);
                    let c_key = normalize_call_contact_key(&c_disp);
                    let stem_digits = normalize_phone_digits(&stem);
                    let sort_key = format!("{}_{}_{}", r_d, r_t, stem);
                    cached_audios.push(CachedAudioFile {
                        file_name,
                        safe_stem,
                        c_disp,
                        c_key,
                        stem_digits,
                        r_d,
                        sort_key,
                    });
                }
            }
        }
        cached_audios.sort_by(|a, b| b.sort_key.cmp(&a.sort_key));

        for row in rows.iter_mut() {
            if row.source == "call" || row.source == "recording" {
                let explicit_stem = row
                    .attachment_uuid
                    .as_deref()
                    .and_then(|a| {
                        a.strip_prefix("transcribed:")
                            .or_else(|| a.strip_prefix("pending_transcript:"))
                    })
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                let clean_room = row
                    .room_or_sender
                    .trim()
                    .trim_start_matches("[워치]")
                    .trim_start_matches("[SM-S901N]")
                    .trim();

                let mut matched_fname: Option<String> = None;

                if let Some(ref ex) = explicit_stem {
                    if let Some(f) = stem_to_filename
                        .get(ex)
                        .or_else(|| stem_to_filename.get(&sanitize_filename_stem(ex)))
                    {
                        matched_fname = Some(f.clone());
                    }
                }
                if matched_fname.is_none() {
                    let s1 = sanitize_filename_stem(clean_room);
                    let s2 = sanitize_filename_stem(&row.room_or_sender);
                    if let Some(f) = stem_to_filename.get(&s1).or_else(|| stem_to_filename.get(&s2))
                    {
                        matched_fname = Some(f.clone());
                    }
                }

                if matched_fname.is_none() {
                    let target_norm = normalize_phone_digits(clean_room);
                    let target_disp = resolve_contact_display(clean_room, &contacts_map);
                    let target_key_a = normalize_call_contact_key(clean_room);
                    let target_key_b = normalize_call_contact_key(&target_disp);
                    let allow_any_date = row.source == "recording";
                    let mut any_date_fallback: Option<String> = None;

                    for ca in &cached_audios {
                        let is_contact_match = ca.c_disp == target_disp
                            || ca.c_disp == clean_room
                            || (!ca.c_key.is_empty()
                                && (ca.c_key == target_key_a || ca.c_key == target_key_b))
                            || (!target_norm.is_empty()
                                && target_norm.len() >= 8
                                && ca.stem_digits.contains(&target_norm));
                        if is_contact_match {
                            if ca.r_d == row.sent_date {
                                matched_fname = Some(ca.file_name.clone());
                                break;
                            } else if allow_any_date && any_date_fallback.is_none() {
                                any_date_fallback = Some(ca.file_name.clone());
                            }
                        }
                    }
                    if matched_fname.is_none() {
                        matched_fname = any_date_fallback;
                    }
                }

                if let Some(fname) = matched_fname {
                    row.has_audio_recording = true;
                    if row.attachment_uuid.as_deref().unwrap_or("").trim().is_empty() {
                        row.attachment_uuid = Some(fname);
                    }
                }
            }
        }
        Ok(rows)
    })
    .await
    .map_err(|e| e.to_string())?
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

#[repr(C)]
struct SHFILEOPSTRUCTW {
    hwnd: isize,
    w_func: u32,
    p_from: *const u16,
    p_to: *const u16,
    f_flags: u16,
    f_any_operations_aborted: i32,
    h_name_mappings: isize,
    lpsz_progress_title: *const u16,
}

#[link(name = "shell32")]
extern "system" {
    fn SHFileOperationW(lp_file_op: *mut SHFILEOPSTRUCTW) -> i32;
}

fn move_file_to_windows_recycle_bin(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    let abs = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let clean_str = abs
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();
    let mut wide: Vec<u16> = std::ffi::OsStr::new(&clean_str).encode_wide().collect();
    wide.push(0);
    wide.push(0);

    let mut op = SHFILEOPSTRUCTW {
        hwnd: 0,
        w_func: 3, // FO_DELETE
        p_from: wide.as_ptr(),
        p_to: std::ptr::null(),
        f_flags: 0x0040 | 0x0010 | 0x0004 | 0x0400, // FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
        f_any_operations_aborted: 0,
        h_name_mappings: 0,
        lpsz_progress_title: std::ptr::null(),
    };
    let ret = unsafe { SHFileOperationW(&mut op) };
    ret == 0 && !path.exists()
}

/// 폴더 목록에서 선택한 문서를 휴지통으로 이동 (되돌리기용 백업 포함)
#[tauri::command]
fn trash_document(
    state: State<AppState>,
    full_path: String,
) -> Result<TrashedFileRecord, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&full_path);
    if !src_path.exists() || !src_path.is_file() {
        return Err("삭제할 파일이 존재하지 않습니다.".to_string());
    }

    let file_name = src_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("deleted.md")
        .to_string();
    let trash_id = Uuid::new_v4().to_string();

    let trash_dir = state
        .db_path
        .parent()
        .unwrap_or_else(|| Path::new(r"C:\Users\iseoh\OneDrive\Projects\.myLore"))
        .join("trash_undo");
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;

    let backup_path = trash_dir.join(format!("{}_{}", trash_id, file_name));
    fs::copy(src_path, &backup_path).map_err(|e| format!("백업 생성 실패: {}", e))?;

    if !move_file_to_windows_recycle_bin(src_path) && src_path.exists() {
        fs::remove_file(src_path).map_err(|e| format!("파일 삭제 실패: {}", e))?;
    }

    let _ = conn.execute("DELETE FROM files WHERE full_path = ?1", params![full_path]);

    let record = TrashedFileRecord {
        trash_id,
        original_path: full_path,
        file_name,
        backup_path: backup_path.to_string_lossy().to_string(),
    };

    if let Ok(mut hist) = state.trash_history.lock() {
        hist.push(record.clone());
    }

    Ok(record)
}

/// 휴지통으로 이동된 문서를 원래 위치로 되돌리기 (복구)
#[tauri::command]
fn restore_trashed_document(
    state: State<AppState>,
    trash_id: Option<String>,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let record = {
        let mut hist = state.trash_history.lock().map_err(|e| e.to_string())?;
        if let Some(ref tid) = trash_id {
            if let Some(pos) = hist.iter().rposition(|r| &r.trash_id == tid) {
                hist.remove(pos)
            } else {
                return Err("복구할 휴지통 항목을 찾을 수 없습니다.".to_string());
            }
        } else {
            hist.pop()
                .ok_or_else(|| "되돌릴 휴지통 이동 내역이 없습니다.".to_string())?
        }
    };

    let backup = Path::new(&record.backup_path);
    if !backup.exists() {
        return Err("백업 파일이 존재하지 않아 복구할 수 없습니다.".to_string());
    }

    let orig = Path::new(&record.original_path);
    if let Some(parent) = orig.parent() {
        let _ = fs::create_dir_all(parent);
    }

    fs::copy(backup, orig).map_err(|e| format!("파일 복구 실패: {}", e))?;
    let _ = fs::remove_file(backup);

    build_document_payload(&conn, orig)
}

#[tauri::command]
fn take_pending_cli_files(state: State<AppState>) -> Result<Vec<String>, String> {
    let mut guard = state.pending_cli_files.lock().map_err(|e| e.to_string())?;
    let files = guard.clone();
    guard.clear();
    Ok(files)
}

fn resolve_projects_setting_json_path(conn: &Connection) -> PathBuf {
    let projects_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\Projects".to_string());
    let mylore_dir = Path::new(&projects_base).join(".myLore");
    let _ = fs::create_dir_all(&mylore_dir);
    mylore_dir.join("setting.json")
}

#[tauri::command]
fn get_app_settings(state: State<AppState>) -> Result<MyLoreAppSettings, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let setting_path = resolve_projects_setting_json_path(&conn);
    let path_str = setting_path.to_string_lossy().to_string();

    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(mut parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                if parsed.f11_viewer_mode != "detached" && parsed.f11_viewer_mode != "split" {
                    parsed.f11_viewer_mode = "detached".to_string();
                }
                parsed.settings_file_path = path_str;
                return Ok(parsed);
            }
        }
    }

    let mut default_settings = MyLoreAppSettings::default();
    default_settings.settings_file_path = path_str;
    if let Ok(json_str) = serde_json::to_string_pretty(&default_settings) {
        let _ = fs::write(&setting_path, json_str);
    }
    Ok(default_settings)
}

#[tauri::command]
fn save_app_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: MyLoreAppSettings,
) -> Result<MyLoreAppSettings, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let setting_path = resolve_projects_setting_json_path(&conn);
    let path_str = setting_path.to_string_lossy().to_string();

    let clean_f11 = if settings.f11_viewer_mode == "split" {
        "split".to_string()
    } else {
        "detached".to_string()
    };
    let clean_default_view = match settings.default_editor_view_mode.as_str() {
        "editor" | "split" | "preview" => settings.default_editor_view_mode.clone(),
        _ => "split".to_string(),
    };

    let mut updated = settings;
    updated.f11_viewer_mode = clean_f11;
    updated.default_editor_view_mode = clean_default_view;
    updated.base_font_size = updated.base_font_size.clamp(10, 32);
    updated.table_font_size = updated.table_font_size.clamp(9, 28);
    updated.heading_scale = updated.heading_scale.clamp(0.7, 1.8);
    updated.settings_file_path = path_str;

    let json_str = serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())?;
    fs::write(&setting_path, json_str).map_err(|e| e.to_string())?;
    let _ = app.emit("app-settings-updated", &updated);
    Ok(updated)
}

#[tauri::command]
fn sync_detached_preview_scroll(
    app: AppHandle,
    top_line: f64,
    scroll_ratio: f64,
) -> Result<(), String> {
    let payload = DetachedScrollPayload {
        top_line,
        scroll_ratio,
    };
    let _ = app.emit("detached-preview-scroll", &payload);
    Ok(())
}

#[tauri::command]
async fn toggle_detached_preview_window(
    app: AppHandle,
    state: State<'_, AppState>,
    force_open: Option<bool>,
    initial_state: DetachedPreviewState,
) -> Result<bool, String> {
    if let Ok(mut guard) = state.detached_preview.lock() {
        *guard = initial_state.clone();
    }

    if let Some(existing) = app.get_webview_window("detached-preview") {
        match force_open {
            Some(true) => {
                let _ = existing.unminimize();
                let _ = existing.show();
                let _ = existing.set_focus();
                let _ = app.emit("detached-preview-update", &initial_state);
                return Ok(true);
            }
            _ => {
                let _ = existing.close();
                return Ok(false);
            }
        }
    }

    if force_open == Some(false) {
        return Ok(false);
    }

    let win_title = if initial_state.title.is_empty() && initial_state.relative_path.is_empty() {
        "myLore — 전용 독립 뷰어 (F11)".to_string()
    } else if !initial_state.title.is_empty() {
        format!("myLore 독립 뷰어 — {}", initial_state.title)
    } else {
        format!("myLore 독립 뷰어 — {}", initial_state.relative_path)
    };

    let win = WebviewWindowBuilder::new(
        &app,
        "detached-preview",
        WebviewUrl::App("index.html?detachedPreview=1".into()),
    )
    .title(win_title)
    .inner_size(860.0, 880.0)
    .resizable(true)
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = win.show();
    let _ = win.set_focus();

    let app_for_event = app.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app_for_event.emit("detached-preview-closed", ());
        }
    });

    Ok(true)
}

#[tauri::command]
fn emit_detached_preview_action(
    app: AppHandle,
    action_type: String,
    uuid: Option<String>,
    line_index: Option<usize>,
    next_code: Option<String>,
) -> Result<(), String> {
    let payload = DetachedPreviewActionPayload {
        action_type,
        uuid,
        line_index,
        next_code,
    };
    let _ = app.emit("detached-preview-action", &payload);
    Ok(())
}

#[tauri::command]
fn sync_detached_preview_state(
    app: AppHandle,
    state: State<AppState>,
    payload: DetachedPreviewState,
) -> Result<(), String> {
    if let Ok(mut guard) = state.detached_preview.lock() {
        *guard = payload.clone();
    }
    if let Some(win) = app.get_webview_window("detached-preview") {
        let win_title = if payload.title.is_empty() && payload.relative_path.is_empty() {
            "myLore — 전용 독립 뷰어 (F11)".to_string()
        } else if !payload.title.is_empty() {
            format!("myLore 독립 뷰어 — {}", payload.title)
        } else {
            format!("myLore 독립 뷰어 — {}", payload.relative_path)
        };
        let _ = win.set_title(&win_title);
        let _ = app.emit("detached-preview-update", &payload);
    }
    Ok(())
}

#[tauri::command]
fn get_detached_preview_state(state: State<AppState>) -> Result<DetachedPreviewState, String> {
    let guard = state.detached_preview.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

fn extract_cli_md_paths() -> Vec<String> {
    let mut paths = Vec::new();
    for arg in std::env::args().skip(1) {
        let trimmed = arg.trim().trim_matches('"');
        if trimmed.is_empty() || trimmed.starts_with('-') {
            continue;
        }
        let p = Path::new(trimmed);
        if p.exists() && p.is_file() {
            if let Ok(canon) = fs::canonicalize(p) {
                let s = canon.to_string_lossy().to_string();
                let clean = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
                paths.push(clean);
            } else {
                paths.push(p.to_string_lossy().to_string());
            }
        }
    }
    paths
}

fn try_forward_to_existing_instance(paths: &[String]) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr: SocketAddr = match "127.0.0.1:18443".parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(250)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));

    let body = serde_json::to_string(paths).unwrap_or_else(|_| "[]".to_string());
    let req = format!(
        "POST /api/v1/open-files HTTP/1.1\r\nHost: 127.0.0.1:18443\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut resp = String::new();
    let _ = stream.read_to_string(&mut resp);
    resp.contains("200")
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn base64_decode(input: &str) -> Vec<u8> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let cleaned: Vec<u8> = input
        .bytes()
        .filter(|&b| b != b'=' && !b.is_ascii_whitespace())
        .collect();
    let mut out = Vec::with_capacity(cleaned.len() * 3 / 4);
    for chunk in cleaned.chunks(4) {
        let mut buf = [0u8; 4];
        let mut len = 0;
        for &b in chunk {
            if let Some(v) = val(b) {
                buf[len] = v;
                len += 1;
            }
        }
        if len >= 2 {
            out.push((buf[0] << 2) | (buf[1] >> 4));
        }
        if len >= 3 {
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if len >= 4 {
            out.push((buf[2] << 6) | buf[3]);
        }
    }
    out
}

fn detect_local_ipv4_addresses() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(local_addr) = sock.local_addr() {
                let ip_str = local_addr.ip().to_string();
                if !ip_str.starts_with("127.") && !ips.contains(&ip_str) {
                    ips.push(ip_str);
                }
            }
        }
    }
    if let Ok(out) = Command::new("ipconfig")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        let text = String::from_utf8_lossy(&out.stdout);
        let ipv4_re = Regex::new(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})").unwrap();
        for line in text.lines() {
            if line.contains("IPv4") || line.contains("IP Address") {
                if let Some(cap) = ipv4_re.captures(line) {
                    if let Some(m) = cap.get(1) {
                        let ip = m.as_str().to_string();
                        if (ip.starts_with("192.168.")
                            || ip.starts_with("10.")
                            || ip.starts_with("172."))
                            && !ips.contains(&ip)
                        {
                            ips.push(ip);
                        }
                    }
                }
            }
        }
    }
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }
    ips
}

fn epoch_ms_to_local_date_time(ts_ms: i64) -> (String, String) {
    use chrono::TimeZone;
    if ts_ms > 0 {
        if let chrono::LocalResult::Single(dt) = chrono::Local.timestamp_millis_opt(ts_ms) {
            return (
                dt.format("%Y-%m-%d").to_string(),
                dt.format("%H:%M:%S").to_string(),
            );
        }
    }
    let now = chrono::Local::now();
    (
        now.format("%Y-%m-%d").to_string(),
        now.format("%H:%M:%S").to_string(),
    )
}

fn get_meta_i64(conn: &Connection, key: &str) -> i64 {
    conn.query_row(
        "SELECT value FROM mobile_sync_meta WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| s.parse::<i64>().ok())
    .unwrap_or(0)
}

fn set_meta_i64_max(conn: &Connection, key: &str, candidate: i64) {
    let cur = get_meta_i64(conn, key);
    if candidate > cur {
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, candidate.to_string()],
        );
    }
}

fn try_insert_finance_from_mobile_text(
    conn: &Connection,
    pkg_or_addr: &str,
    title: &str,
    text: &str,
    date_str: &str,
    time_str: &str,
    source_label: &str,
) -> bool {
    let combined = format!("{} {} {}", pkg_or_addr, title, text);
    let combined_lower = combined.to_lowercase();
    let finance_keywords = [
        "카드", "은행", "뱅크", "페이", "승인", "결제", "입금", "출금", "일시불", "할부", "체크",
        "신한", "국민", "kb", "현대", "삼성", "우리", "하나", "농협", "nh", "카카오뱅크", "토스",
        "shcard", "kbcard", "hyundaicard", "samsungcard", "woori", "hana", "kakaobank", "toss",
        "payco", "1588", "1577", "1544", "1644",
    ];
    if !finance_keywords.iter().any(|k| combined_lower.contains(k)) {
        return false;
    }

    let amt_re = Regex::new(r"([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s*원").unwrap();
    let mut amount: i64 = 0;
    if let Some(cap) = amt_re.captures(&combined) {
        if let Some(m) = cap.get(1) {
            amount = m.as_str().replace(',', "").parse::<i64>().unwrap_or(0);
        }
    }
    if amount <= 0 {
        return false;
    }

    let institution = if combined.contains("신한") || combined_lower.contains("shcard") {
        "신한카드".to_string()
    } else if combined.contains("국민") || combined.contains("KB") || combined_lower.contains("kbcard") {
        "KB국민".to_string()
    } else if combined.contains("현대") || combined_lower.contains("hyundaicard") {
        "현대카드".to_string()
    } else if combined.contains("삼성") || combined_lower.contains("samsungcard") {
        "삼성카드".to_string()
    } else if combined.contains("우리") || combined_lower.contains("woori") {
        "우리카드/은행".to_string()
    } else if combined.contains("하나") || combined_lower.contains("hana") {
        "하나카드/은행".to_string()
    } else if combined.contains("농협") || combined.contains("NH") {
        "NH농협".to_string()
    } else if combined.contains("카카오뱅크") || combined_lower.contains("kakaobank") {
        "카카오뱅크".to_string()
    } else if combined.contains("토스") || combined_lower.contains("toss") {
        "토스뱅크/페이".to_string()
    } else if !title.trim().is_empty() {
        title.trim().to_string()
    } else {
        pkg_or_addr.to_string()
    };

    let tx_type = if combined.contains("입금") {
        "income"
    } else {
        "expense"
    };

    let merchant_re = Regex::new(r"원\s+([^\s0-9/]+)").unwrap();
    let merchant = merchant_re
        .captures(text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| {
            let clean = text.replace('\n', " ").trim().to_string();
            if clean.chars().count() > 28 {
                clean.chars().take(28).collect()
            } else {
                clean
            }
        });

    let dedup_raw = format!("{}|{}|{}", date_str, amount, merchant);
    let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

    let affected = conn
        .execute(
            "INSERT OR IGNORE INTO finance_transactions
             (tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '미분류', ?7, 'realtime', ?8)",
            params![
                date_str,
                time_str,
                institution,
                tx_type,
                amount,
                merchant,
                source_label,
                dedup_key
            ],
        )
        .unwrap_or(0);

    affected > 0
}

fn broadcast_udp_pc_online() -> Result<(), String> {
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.set_broadcast(true);
        let pc_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
        let payload = serde_json::json!({
            "event": "MYLORE_PC_ONLINE",
            "pc_name": pc_name,
            "port": 18443
        })
        .to_string();
        let _ = sock.send_to(payload.as_bytes(), "255.255.255.255:18444");
    }
    Ok(())
}

#[tauri::command]
fn send_mobile_udp_wake_broadcast() -> Result<String, String> {
    broadcast_udp_pc_online()?;
    Ok("UDP 255.255.255.255:18444 로 MYLORE_PC_ONLINE 브로드캐스트 송출 완료".to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MobileSyncSegment {
    kind: String, // "skip" (파란색: 이미 보유하여 스킵) | "download" (녹색: 신규 다운로드)
    width_pct: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MobileSyncStepSummary {
    key: String,
    label: String,
    status: String, // "pending" | "running" | "done"
    percent: u32,
    total_count: usize,
    skipped_count: usize,
    downloaded_count: usize,
    segments: Vec<MobileSyncSegment>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MobileSyncProgressPayload {
    is_running: bool,
    is_completed: bool,
    current_step_index: usize,
    total_steps: usize,
    current_key: String,
    current_label: String,
    current_percent: u32,
    #[serde(default)]
    queued_jobs: usize,
    steps: Vec<MobileSyncStepSummary>,
}

static LIVE_SYNC_PROGRESS: std::sync::OnceLock<Mutex<MobileSyncProgressPayload>> =
    std::sync::OnceLock::new();
static SYNC_QUEUE_DEPTH: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);
static IS_WORKER_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static LAST_PROGRESS_EMIT_MS: std::sync::atomic::AtomicI64 =
    std::sync::atomic::AtomicI64::new(0);
static INITIAL_SYNC_CHECKED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static LAST_APP_USAGE_DIGEST: std::sync::OnceLock<Mutex<(String, i64)>> =
    std::sync::OnceLock::new();

fn rebuild_step_segments(st: &mut MobileSyncStepSummary) {
    st.segments.clear();
    let pct = st.percent.clamp(0, 100);
    if pct == 0 {
        return;
    }
    let tot_processed = st.skipped_count + st.downloaded_count;
    if tot_processed == 0 {
        st.segments.push(MobileSyncSegment {
            kind: "skip".to_string(),
            width_pct: pct as f64,
        });
    } else {
        let skip_w = (pct as f64) * (st.skipped_count as f64 / tot_processed as f64);
        let dl_w = (pct as f64) - skip_w;
        if skip_w > 0.05 {
            st.segments.push(MobileSyncSegment {
                kind: "skip".to_string(),
                width_pct: skip_w,
            });
        }
        if dl_w > 0.05 {
            st.segments.push(MobileSyncSegment {
                kind: "download".to_string(),
                width_pct: dl_w,
            });
        }
    }
}

fn default_live_sync_progress() -> MobileSyncProgressPayload {
    let step_defs = [
        ("kakaotalk", "카카오톡 받아오는 중..."),
        ("notification", "알림목록 받아오는 중..."),
        ("sms", "문자 목록 받아오는 중..."),
        ("call", "통화 목록 받아오는 중..."),
        ("recording", "녹음 목록 받아오는 중..."),
        ("health", "헬스 데이터 받아오는 중..."),
    ];
    let steps = step_defs
        .iter()
        .map(|(k, lbl)| MobileSyncStepSummary {
            key: k.to_string(),
            label: lbl.to_string(),
            status: "pending".to_string(),
            percent: 0,
            total_count: 0,
            skipped_count: 0,
            downloaded_count: 0,
            segments: Vec::new(),
        })
        .collect();
    MobileSyncProgressPayload {
        is_running: false,
        is_completed: false,
        current_step_index: 0,
        total_steps: step_defs.len(),
        current_key: "kakaotalk".to_string(),
        current_label: "카카오톡 받아오는 중...".to_string(),
        current_percent: 0,
        queued_jobs: 0,
        steps,
    }
}

/// 메인 프로그램이 DB나 디스크 I/O 없이 순수 인메모리 진행 상태만 가볍게 모니터링할 수 있는 Tauri 커맨드
#[tauri::command]
fn get_mobile_sync_progress_state() -> MobileSyncProgressPayload {
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    if let Ok(mut guard) = mutex.lock() {
        let q = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
        let active = IS_WORKER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
        guard.queued_jobs = q;
        guard.is_running = active || q > 0;
        if guard.is_running {
            guard.is_completed = false;
        }
        return guard.clone();
    }
    default_live_sync_progress()
}

/// 백그라운드 스레드가 각 단계(카톡 -> 알림 -> 문자 -> 통화 -> 녹음 -> 헬스)를 다운로드·적재할 때
/// 이전 단계들을 자동으로 100%(done) 완료 처리하고 현재 단계의 백분위(%)와 구간 색상(파란색=스킵, 녹색=신규다운로드)을 갱신합니다.
fn emit_live_service_sync_progress(
    app: &AppHandle,
    service_key: &str,
    current_idx: usize,
    total_cnt: usize,
    skipped_add: usize,
    downloaded_add: usize,
    custom_label: Option<&str>,
) -> u32 {
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    let mut guard = match mutex.lock() {
        Ok(g) => g,
        Err(_) => return 100,
    };

    let prev_key = guard.current_key.clone();
    let step_pos = guard
        .steps
        .iter()
        .position(|s| s.key == service_key)
        .unwrap_or(0);

    // 현재 단계(step_pos) 이전의 단계들 중 아직 완료되지 않은 단계가 있다면 자동으로 100%(done, 파란색 스킵 반영) 처리
    for prev_i in 0..step_pos {
        let prev_st = &mut guard.steps[prev_i];
        if prev_st.status != "done" || prev_st.percent < 100 {
            prev_st.percent = 100;
            prev_st.status = "done".to_string();
            prev_st.total_count = prev_st
                .total_count
                .max(prev_st.skipped_count + prev_st.downloaded_count);
            rebuild_step_segments(prev_st);
        }
    }

    let pct = if total_cnt == 0 {
        100u32
    } else if current_idx == 0 {
        0u32
    } else {
        (((current_idx as f64 / total_cnt as f64) * 100.0).round() as u32).clamp(0, 100)
    };

    {
        let st = &mut guard.steps[step_pos];
        if current_idx == 0 {
            st.total_count = total_cnt.max(st.skipped_count + st.downloaded_count);
        } else {
            st.skipped_count += skipped_add;
            st.downloaded_count += downloaded_add;
            st.total_count = total_cnt.max(st.skipped_count + st.downloaded_count);
        }
        st.percent = pct;
        st.status = if pct >= 100 {
            "done".to_string()
        } else {
            "running".to_string()
        };
        rebuild_step_segments(st);
    }

    let q_depth = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
    let active = IS_WORKER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
    guard.queued_jobs = q_depth;
    guard.is_running = true;
    guard.is_completed = false;
    guard.current_step_index = step_pos;
    guard.current_key = service_key.to_string();
    guard.current_label = custom_label
        .map(|s| s.to_string())
        .unwrap_or_else(|| guard.steps[step_pos].label.clone());
    guard.current_percent = pct;

    let payload_clone = guard.clone();
    drop(guard);

    let now_ms = chrono::Local::now().timestamp_millis();
    let last_ms = LAST_PROGRESS_EMIT_MS.load(std::sync::atomic::Ordering::Relaxed);
    let force_emit =
        current_idx == 0 || (q_depth == 0 && !active && pct >= 100) || prev_key != service_key;
    if force_emit || (now_ms - last_ms) >= 180 {
        LAST_PROGRESS_EMIT_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
        let _ = app.emit("mobile-sync-progress", &payload_clone);
    }
    pct
}

/// 백그라운드 워커 스레드에서 DB의 실제 카테고리별 보유 건수(기보유=파란색 스킵, 당일/신규=녹색 다운로드)를 읽어와
/// 아직 완료되지 않은 모든 단계(카톡 -> 알림 -> 문자 -> 통화 -> 녹음 -> 헬스)를 0% -> 100%까지 순차적으로 점검·완료합니다.
fn complete_all_remaining_sync_steps(app: &AppHandle, db_path: &Path, reset_all_first: bool) {
    let step_keys = [
        "kakaotalk",
        "notification",
        "sms",
        "call",
        "recording",
        "health",
    ];
    let mut db_counts: Vec<(usize, usize)> = vec![(0, 0); step_keys.len()];
    if let Ok(conn) = open_db(db_path) {
        let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
        for (idx, key) in step_keys.iter().enumerate() {
            let total: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1",
                    params![*key],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let recent: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1 AND sent_date >= ?2",
                    params![*key, today_str],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let tot_u = total.max(0) as usize;
            let dl_u = (recent.max(0) as usize).min(tot_u);
            let skip_u = tot_u.saturating_sub(dl_u);
            db_counts[idx] = (skip_u, dl_u);
        }
    }

    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    if let Ok(mut guard) = mutex.lock() {
        guard.is_running = true;
        guard.is_completed = false;
        for (idx, st) in guard.steps.iter_mut().enumerate() {
            let (db_sk, db_dl) = db_counts[idx];
            if reset_all_first {
                st.status = "pending".to_string();
                st.percent = 0;
                st.skipped_count = db_sk;
                st.downloaded_count = db_dl;
                st.total_count = db_sk + db_dl;
                st.segments.clear();
            } else if st.skipped_count + st.downloaded_count == 0 {
                st.skipped_count = db_sk;
                st.downloaded_count = db_dl;
                st.total_count = db_sk + db_dl;
            } else {
                st.skipped_count = st.skipped_count.max(db_sk);
                st.total_count = st.skipped_count + st.downloaded_count;
            }
        }
    }

    for step_idx in 0..step_keys.len() {
        // 만약 도중에 새로운 실시간 동기화 작업이 큐에 들어왔다면 즉시 양보하여 실제 패킷부터 처리
        if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) > 0 && !reset_all_first {
            return;
        }
        let already_done = {
            if let Ok(guard) = mutex.lock() {
                guard.steps[step_idx].status == "done" && guard.steps[step_idx].percent >= 100
            } else {
                false
            }
        };
        if already_done {
            continue;
        }

        for pct in [25u32, 50, 75, 100] {
            if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) > 0 && !reset_all_first {
                return;
            }
            if let Ok(mut guard) = mutex.lock() {
                let q = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
                guard.queued_jobs = q;
                guard.is_running = true;
                guard.is_completed = false;
                guard.current_step_index = step_idx;
                guard.current_key = guard.steps[step_idx].key.clone();
                guard.current_label = guard.steps[step_idx].label.clone();
                guard.current_percent = pct;

                let st = &mut guard.steps[step_idx];
                st.percent = pct;
                st.status = if pct >= 100 {
                    "done".to_string()
                } else {
                    "running".to_string()
                };
                rebuild_step_segments(st);
                let _ = app.emit("mobile-sync-progress", &*guard);
            }
            thread::sleep(std::time::Duration::from_millis(55));
        }
    }

    IS_WORKER_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut guard) = mutex.lock() {
        guard.queued_jobs = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
        guard.is_running = false;
        guard.is_completed = true;
        guard.current_step_index = guard.total_steps.saturating_sub(1);
        guard.current_key = "done".to_string();
        guard.current_label = "모든 라이프로그 항목 동기화 확인 완료 (100%)".to_string();
        guard.current_percent = 100;
        let _ = app.emit("mobile-sync-progress", &*guard);
    }
}

#[tauri::command]
fn trigger_sequential_mobile_sync(_app: AppHandle, _state: State<AppState>) -> Result<String, String> {
    let _ = broadcast_udp_pc_online();
    enqueue_sync_worker_job(SyncWorkerJob::StartSyncInspection {
        reset_watermarks: false,
    });
    Ok("백그라운드 동기화 스레드에 순차 동기화 점검 신호 전달 완료".to_string())
}

fn build_mobile_pairing_payload(conn: &Connection) -> Result<MobilePairingPayload, String> {
    let pc_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
    let ips = detect_local_ipv4_addresses();
    let port: u16 = 18443;

    let token: String = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| {
            let t = format!("mylore_sec_{}", Uuid::new_v4().to_string().replace('-', ""));
            let _ = conn.execute(
                "INSERT OR REPLACE INTO mobile_sync_meta (key, value) VALUES ('pairing_token', ?1)",
                params![t],
            );
            t
        });

    let ssids_raw: String = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'allowed_ssids'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "[\"iseohyun\",\"seohyun5G\"]".to_string());
    let ssids: Vec<String> = serde_json::from_str(&ssids_raw)
        .unwrap_or_else(|_| vec!["iseohyun".to_string(), "seohyun5G".to_string()]);

    let created_at = chrono::Local::now().timestamp_millis();
    let qr_json_obj = serde_json::json!({
        "v": 1,
        "pc_name": pc_name,
        "ips": ips,
        "port": port,
        "token": token,
        "ssids": ssids,
        "created_at": created_at
    });
    let qr_json_raw = serde_json::to_string(&qr_json_obj).unwrap_or_default();
    let raw_b64 = base64_encode(qr_json_raw.as_bytes());
    let qr_base64 = format!("myloresync://pair?data={}", raw_b64);

    let mut stmt = conn
        .prepare(
            "SELECT device_id, device_name, model, paired_at, last_seen_at
             FROM paired_devices ORDER BY last_seen_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let paired_devices: Vec<PairedDeviceItem> = stmt
        .query_map([], |r| {
            Ok(PairedDeviceItem {
                device_id: r.get(0)?,
                device_name: r.get(1)?,
                model: r.get(2)?,
                paired_at: r.get(3)?,
                last_seen_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let last_noti_ts = get_meta_i64(conn, "last_noti_ts");
    let last_sms_ts = get_meta_i64(conn, "last_sms_ts");
    let last_call_ts = get_meta_i64(conn, "last_call_ts");

    Ok(MobilePairingPayload {
        qr_json_raw,
        qr_base64,
        pc_name,
        ips,
        port,
        token,
        ssids,
        paired_devices,
        last_noti_ts,
        last_sms_ts,
        last_call_ts,
    })
}

#[tauri::command]
async fn get_mobile_pairing_info(state: State<'_, AppState>) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_paired_mobile_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let _ = conn.execute(
            "DELETE FROM paired_devices WHERE device_id = ?1",
            params![device_id],
        );
        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn trigger_full_mobile_resync(
    state: State<'_, AppState>,
) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        for key in [
            "last_kakao_ts",
            "last_noti_ts",
            "last_sms_ts",
            "last_call_ts",
            "last_recording_ts",
            "last_health_ts",
            "last_contact_ts",
            "last_usage_ts",
        ] {
            let _ = conn.execute(
                "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, '0')
                 ON CONFLICT(key) DO UPDATE SET value = '0'",
                params![key],
            );
        }
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES ('force_full_sync', '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        );
        let _ = conn.execute(
            "UPDATE paired_devices SET last_kakao_ts = 0, last_noti_ts = 0, last_sms_ts = 0, last_call_ts = 0, last_recording_ts = 0, last_health_ts = 0, last_contact_ts = 0, last_usage_ts = 0",
            [],
        );
        let _ = conn.execute("DELETE FROM synced_file_hashes", []);
        reset_in_memory_sync_caches();
        enqueue_sync_worker_job(SyncWorkerJob::StartSyncInspection {
            reset_watermarks: true,
        });

        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            let _ = sock.set_broadcast(true);
            let pc_name =
                std::env::var("COMPUTERNAME").unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
            let payload = serde_json::json!({
                "event": "MYLORE_FULL_RESYNC",
                "action": "mylore_full_resync",
                "force_full_sync": true,
                "pc_name": pc_name,
                "port": 18443
            })
            .to_string();
            let _ = sock.send_to(payload.as_bytes(), "255.255.255.255:18444");
        }

        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_mobile_pairing_config(
    state: State<'_, AppState>,
    ssids: Vec<String>,
    regenerate_token: bool,
) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;

        let cleaned_ssids: Vec<String> = ssids
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let final_ssids = if cleaned_ssids.is_empty() {
            vec!["iseohyun".to_string(), "seohyun5G".to_string()]
        } else {
            cleaned_ssids
        };
        let ssids_json = serde_json::to_string(&final_ssids).unwrap_or_default();
        conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES ('allowed_ssids', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![ssids_json],
        )
        .map_err(|e| e.to_string())?;

        if regenerate_token {
            let new_token = format!("mylore_sec_{}", Uuid::new_v4().to_string().replace('-', ""));
            conn.execute(
                "INSERT INTO mobile_sync_meta (key, value) VALUES ('pairing_token', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![new_token],
            )
            .map_err(|e| e.to_string())?;
            if let Some(lock) = CACHED_PAIRING_TOKEN.get() {
                if let Ok(mut guard) = lock.lock() {
                    *guard = new_token;
                }
            }
        }

        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 방법 A: 클라우드(OneDrive/Google Drive)나 Git에 동기화되지 않는 PC 로컬 전용 `%APPDATA%\com.iseohyun.mylore\gemini_secret.json` 경로
fn resolve_local_appdata_gemini_key_path() -> PathBuf {
    let appdata = std::env::var("APPDATA")
        .unwrap_or_else(|_| r"C:\Users\iseoh\AppData\Roaming".to_string());
    let dir = Path::new(&appdata).join("com.iseohyun.mylore");
    let _ = fs::create_dir_all(&dir);
    dir.join("gemini_secret.json")
}

fn read_local_gemini_api_key_full() -> (String, String, String) {
    let secret_path = resolve_local_appdata_gemini_key_path();
    if let Ok(raw) = fs::read_to_string(&secret_path) {
        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(&raw) {
            let k = jv
                .get("api_key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let v_at = jv
                .get("verified_at")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let model = jv
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("gemini-3.8-flash")
                .trim()
                .to_string();
            return (
                k,
                v_at,
                if model.is_empty() {
                    "gemini-3.8-flash".to_string()
                } else {
                    model
                },
            );
        }
    }
    (String::new(), String::new(), "gemini-3.8-flash".to_string())
}

fn read_local_gemini_api_key() -> (String, String) {
    let (k, v_at, _) = read_local_gemini_api_key_full();
    (k, v_at)
}

fn resolve_local_appdata_gemini_usage_path() -> PathBuf {
    let appdata = std::env::var("APPDATA")
        .unwrap_or_else(|_| r"C:\Users\iseoh\AppData\Roaming".to_string());
    let dir = Path::new(&appdata).join("com.iseohyun.mylore");
    let _ = fs::create_dir_all(&dir);
    dir.join("gemini_usage.json")
}

/// Gemini API 응답의 `usageMetadata` 에서 반환된 토큰 사용량을 당일/누적 기준으로 기록합니다.
fn record_gemini_token_usage(used_tokens: i64) {
    let usage_path = resolve_local_appdata_gemini_usage_path();
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let (mut today_tokens, mut total_tokens, mut today_reqs, _) = read_gemini_token_usage();

    let add_tok = used_tokens.max(0);
    today_tokens += add_tok;
    total_tokens += add_tok;
    today_reqs += 1;

    let save_json = serde_json::json!({
        "today_date": today_str,
        "today_used_tokens": today_tokens,
        "total_used_tokens": total_tokens,
        "today_request_count": today_reqs,
        "last_request_tokens": add_tok,
        "updated_at": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    });
    if let Ok(s) = serde_json::to_string_pretty(&save_json) {
        let _ = fs::write(&usage_path, s);
    }
}

/// (today_used_tokens, total_used_tokens, today_request_count, last_request_tokens) 반환
fn read_gemini_token_usage() -> (i64, i64, i64, i64) {
    let usage_path = resolve_local_appdata_gemini_usage_path();
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    if let Ok(raw) = fs::read_to_string(&usage_path) {
        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(&raw) {
            let saved_date = jv.get("today_date").and_then(|v| v.as_str()).unwrap_or("");
            let total_tok = jv
                .get("total_used_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let last_tok = jv
                .get("last_request_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            if saved_date == today_str {
                let today_tok = jv
                    .get("today_used_tokens")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let today_req = jv
                    .get("today_request_count")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                return (today_tok, total_tok, today_req, last_tok);
            } else {
                return (0, total_tok, 0, last_tok);
            }
        }
    }
    (0, 0, 0, 0)
}

fn is_auto_call_transcription_enabled(conn: &Connection) -> bool {
    let setting_path = resolve_projects_setting_json_path(conn);
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                return parsed.auto_call_transcription;
            }
        }
    }
    true
}

fn mask_gemini_api_key(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        String::new()
    } else if t.len() <= 10 {
        "••••••••••".to_string()
    } else {
        format!("{}••••••••••••••••{}", &t[..6], &t[t.len() - 4..])
    }
}

fn extract_recommended_model_from_error(err_msg: &str) -> Option<String> {
    let marker = "use models/";
    if let Some(idx) = err_msg.find(marker) {
        let rest = &err_msg[idx + marker.len()..];
        let raw_model: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
            .collect();
        let cleaned = raw_model.trim_end_matches('.').to_string();
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    None
}

fn discover_available_gemini_model(api_key: &str) -> Option<String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        api_key.trim()
    );
    #[cfg(target_os = "windows")]
    let output_res = {
        use std::os::windows::process::CommandExt;
        Command::new("curl.exe")
            .args(["-4", "--connect-timeout", "5", "-s", "-S", &url])
            .creation_flags(0x08000000)
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let output_res = Command::new("curl")
        .args(["-4", "--connect-timeout", "5", "-s", "-S", &url])
        .output();

    let output = output_res.ok()?;
    let resp_str = String::from_utf8_lossy(&output.stdout);
    let jv: serde_json::Value = serde_json::from_str(&resp_str).ok()?;
    let models = jv.get("models")?.as_array()?;

    let mut fallback_candidate: Option<String> = None;
    for m in models {
        let name = m
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .trim_start_matches("models/");
        if name.is_empty() {
            continue;
        }
        let supports_gen = m
            .get("supportedGenerationMethods")
            .and_then(|arr| arr.as_array())
            .map(|arr| arr.iter().any(|v| v.as_str() == Some("generateContent")))
            .unwrap_or(false);
        if !supports_gen {
            continue;
        }
        let lower = name.to_lowercase();
        if lower.contains("tts") || lower.contains("image") || lower.contains("embedding") {
            continue;
        }
        if lower.contains("flash") && !lower.contains("2.5-flash") {
            return Some(name.to_string());
        }
        if fallback_candidate.is_none() && lower.contains("gemini") {
            fallback_candidate = Some(name.to_string());
        }
    }
    fallback_candidate
}

fn call_gemini_generate_content_single_model(
    api_key: &str,
    model_name: &str,
    data_arg: &str,
) -> Result<String, String> {
    let clean_model = model_name.trim().trim_start_matches("models/");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        clean_model,
        api_key.trim()
    );

    #[cfg(target_os = "windows")]
    let output_res = {
        use std::os::windows::process::CommandExt;
        Command::new("curl.exe")
            .args([
                "-4",
                "--connect-timeout",
                "5",
                "-s",
                "-S",
                "-X",
                "POST",
                &url,
                "-H",
                "Content-Type: application/json",
                "--data-binary",
                data_arg,
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let output_res = Command::new("curl")
        .args([
            "-4",
            "--connect-timeout",
            "5",
            "-s",
            "-S",
            "-X",
            "POST",
            &url,
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            data_arg,
        ])
        .output();

    let output = output_res.map_err(|e| format!("curl 실행 오류: {}", e))?;
    let resp_str = String::from_utf8_lossy(&output.stdout).to_string();
    let jv: serde_json::Value = serde_json::from_str(&resp_str)
        .map_err(|_| format!("Gemini 응답 파싱 실패: {}", resp_str))?;

    if let Some(err_msg) = jv
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
    {
        return Err(err_msg.to_string());
    }

    let text = jv
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(|parts| parts.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<&str>>()
                .join("\n")
        })
        .unwrap_or_default();

    if text.trim().is_empty() {
        return Err("Gemini로부터 빈 응답을 받았습니다.".to_string());
    }

    // Gemini 응답의 usageMetadata 에서 실제 소비된 토큰 수 추출 및 누적 기록
    if let Some(usage) = jv.get("usageMetadata") {
        let prompt_tok = usage
            .get("promptTokenCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let cand_tok = usage
            .get("candidatesTokenCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let total_tok = usage
            .get("totalTokenCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(prompt_tok + cand_tok);
        record_gemini_token_usage(total_tok);
    } else {
        record_gemini_token_usage(0);
    }

    Ok(text.trim().to_string())
}

fn call_gemini_generate_content_with_model(
    api_key: &str,
    request_json: &serde_json::Value,
) -> Result<(String, String), String> {
    let temp_file =
        std::env::temp_dir().join(format!("mylore_gemini_req_{}.json", Uuid::new_v4()));
    let body_bytes = serde_json::to_vec(request_json).map_err(|e| e.to_string())?;
    fs::write(&temp_file, &body_bytes).map_err(|e| format!("임시 파일 생성 실패: {}", e))?;
    let data_arg = format!("@{}", temp_file.to_string_lossy());

    let (_, _, saved_model) = read_local_gemini_api_key_full();
    let mut candidates: Vec<String> = Vec::new();
    for m in [
        saved_model.as_str(),
        "gemini-3.8-flash",
        "gemini-flash-latest",
        "gemini-3.0-flash",
        "gemini-2.5-flash",
    ] {
        let trimmed = m.trim().trim_start_matches("models/").to_string();
        if !trimmed.is_empty() && !candidates.contains(&trimmed) {
            candidates.push(trimmed);
        }
    }

    let mut tried: Vec<String> = Vec::new();
    let mut last_err = String::new();
    let mut idx = 0;

    while idx < candidates.len() {
        let model = candidates[idx].clone();
        idx += 1;
        if tried.contains(&model) {
            continue;
        }
        tried.push(model.clone());

        match call_gemini_generate_content_single_model(api_key, &model, &data_arg) {
            Ok(text) => {
                let _ = fs::remove_file(&temp_file);
                return Ok((text, model));
            }
            Err(err_msg) => {
                last_err = err_msg.clone();
                // API 키 자체가 잘못된 경우에는 즉시 중단
                if err_msg.contains("API key not valid") || err_msg.contains("API_KEY_INVALID") {
                    let _ = fs::remove_file(&temp_file);
                    return Err(format!("Gemini API 오류: {}", err_msg));
                }
                // 구글 에러 메시지가 권장 모델을 안내한 경우(예: Please update your code to use models/gemini-3.8-flash) 즉시 후보 최우선 추가
                if let Some(rec_model) = extract_recommended_model_from_error(&err_msg) {
                    if !tried.contains(&rec_model) && !candidates.contains(&rec_model) {
                        candidates.insert(idx, rec_model);
                    }
                }
            }
        }
    }

    // 모든 기본 후보가 실패한 경우 계정에 실제 활성화된 모델 목록을 조회하여 자동 폴백
    if let Some(discovered) = discover_available_gemini_model(api_key) {
        if !tried.contains(&discovered) {
            if let Ok(text) =
                call_gemini_generate_content_single_model(api_key, &discovered, &data_arg)
            {
                let _ = fs::remove_file(&temp_file);
                return Ok((text, discovered));
            }
        }
    }

    let _ = fs::remove_file(&temp_file);
    Err(format!("Gemini API 오류: {}", last_err))
}

fn call_gemini_generate_content(
    api_key: &str,
    request_json: &serde_json::Value,
) -> Result<String, String> {
    let (text, _) = call_gemini_generate_content_with_model(api_key, request_json)?;
    Ok(text)
}

fn transcribe_call_audio_with_gemini(
    api_key: &str,
    audio_bytes: &[u8],
    file_name: &str,
    contact_label: &str,
) -> Result<String, String> {
    if audio_bytes.is_empty() {
        return Err("오디오 바이트가 비어 있습니다.".to_string());
    }
    let lower = file_name.to_lowercase();
    let mime_type = if lower.ends_with(".mp3") {
        "audio/mp3"
    } else if lower.ends_with(".amr") {
        "audio/amr"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".aac") {
        "audio/aac"
    } else {
        "audio/mp4" // .m4a 기본값
    };

    let b64_audio = base64_encode(audio_bytes);
    let prompt = format!(
        "다음 스마트폰 통화 녹음 음성을 듣고 한국어로 정확하게 분석하여 반드시 아래의 2개 마크다운 섹션(`## 💡 요약`, `## 📜 스크립트`) 구조로 작성해 주세요 (통화 상대방 이름: {} — 전화번호나 날짜 없이 순수 이름만 표시):\n\n\
         ## 💡 요약\n\
         - (통화 목적, 주요 합의 사항, 일정/장소/금액 등 핵심 내용을 1~3줄 불릿 포인트로 명확히 요약)\n\n\
         ## 📜 스크립트\n\
         - **[00:00:00] 나**: (실제 발화 내용)\n\
         - **[00:00:04] {}**: (실제 발화 내용)\n\
         (반드시 모든 문장마다 해당 문장이 시작되는 오디오 재생 오프셋 시각을 `[00:00:00]` 즉 `[HH:MM:SS]` 8자리 포맷으로 표시하고, 대화 상대방 이름은 전화번호나 날짜 없이 `{}` 이름만 표시하여 시간 순서대로 빠짐없이 작성)",
        contact_label, contact_label, contact_label
    );

    let req_json = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": b64_audio
                    }
                }
            ]
        }]
    });

    call_gemini_generate_content(api_key, &req_json)
}

/// 독백녹음(음성메모) 또는 회의녹음 음성을 분석하여 **음성메모·회의록 톤**으로 요약 및 스크립트를 생성합니다.
fn transcribe_voice_recording_with_gemini(
    api_key: &str,
    audio_bytes: &[u8],
    file_name: &str,
    recording_source: &str,
) -> Result<String, String> {
    if audio_bytes.is_empty() {
        return Err("오디오 바이트가 비어 있습니다.".to_string());
    }
    let lower = file_name.to_lowercase();
    let mime_type = if lower.ends_with(".mp3") {
        "audio/mp3"
    } else if lower.ends_with(".amr") {
        "audio/amr"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".aac") {
        "audio/aac"
    } else {
        "audio/mp4"
    };

    let b64_audio = base64_encode(audio_bytes);
    let prompt = format!(
        "다음 음성녹음 파일(출처: {}, 파일명: {})은 사용자의 독백 음성메모 또는 대면 회의 녹음입니다.\n\
         음성메모·회의록 전문 톤(Voice Memo & Meeting Minutes Tone)을 적극 활용하여 반드시 아래의 2개 마크다운 섹션(`## 💡 요약`, `## 📜 스크립트`) 구조로 한국어로 작성해 주세요:\n\n\
         ## 💡 요약\n\
         - **핵심 주제/안건**: (독백 메모의 핵심 아이디어 또는 회의 주요 안건 요약)\n\
         - **주요 내용 및 결정 사항**: (논의된 핵심 포인트, 아이디어, 결론 등을 개조식 불릿으로 정리)\n\
         - **Action Items (향후 할 일 / 일정)**: (후속 조치, 체크리스트, 일정 등이 있다면 명확히 정리)\n\n\
         ## 📜 스크립트\n\
         - **[00:00:00] 발화**: (문장마다 해당 문장이 시작되는 오디오 재생 오프셋 시각을 반드시 `[00:00:00]` 즉 `[HH:MM:SS]` 포맷으로 표시하여 시간 순서대로 빠짐없이 기록)",
        recording_source, file_name
    );

    let req_json = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": b64_audio
                    }
                }
            ]
        }]
    });

    call_gemini_generate_content(api_key, &req_json)
}

/// LLM 토큰 부족/한도 초과 발생 시 고갈 시점과 5시간(`5 * 3600 * 1000` ms) 후 자동 재시도 시점을 DB에 기록합니다.
fn record_gemini_quota_exhaustion(conn: &Connection, err_msg: &str) -> (String, String) {
    let now = chrono::Local::now();
    let now_ms = now.timestamp_millis();
    let retry_ms = now_ms + 5 * 3600 * 1000; // 5시간 후 재시도
    let exhausted_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let (retry_d, retry_t) = epoch_ms_to_local_date_time(retry_ms);
    let retry_str = format!("{} {}", retry_d, retry_t);

    for (k, v) in [
        ("gemini_quota_exhausted_at_ms", now_ms.to_string()),
        ("gemini_quota_retry_after_ms", retry_ms.to_string()),
        ("gemini_last_quota_error", err_msg.to_string()),
    ] {
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![k, v],
        );
    }

    (exhausted_str, retry_str)
}

fn clear_gemini_quota_exhaustion(conn: &Connection) {
    for k in [
        "gemini_quota_exhausted_at_ms",
        "gemini_quota_retry_after_ms",
        "gemini_last_quota_error",
    ] {
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, '0')
             ON CONFLICT(key) DO UPDATE SET value = '0'",
            params![k],
        );
    }
}

fn build_gemini_api_key_status_with_conn(conn_opt: Option<&Connection>) -> GeminiApiKeyStatus {
    let secret_path = resolve_local_appdata_gemini_key_path();
    let (key, verified_at, saved_model) = read_local_gemini_api_key_full();
    let (today_used_tokens, total_used_tokens, today_request_count, last_request_tokens) =
        read_gemini_token_usage();

    let (mut exhausted_str, mut retry_str, mut pending_cnt, mut last_err, mut auto_transcribe) =
        (String::new(), String::new(), 0usize, String::new(), true);

    if let Some(conn) = conn_opt {
        auto_transcribe = is_auto_call_transcription_enabled(conn);
        let ex_ms = get_meta_i64(conn, "gemini_quota_exhausted_at_ms");
        let rt_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
        if ex_ms > 0 {
            let (d, t) = epoch_ms_to_local_date_time(ex_ms);
            exhausted_str = format!("{} {}", d, t);
        }
        if rt_ms > 0 {
            let (d, t) = epoch_ms_to_local_date_time(rt_ms);
            retry_str = format!("{} {}", d, t);
        }
        last_err = conn
            .query_row(
                "SELECT value FROM mobile_sync_meta WHERE key = 'gemini_last_quota_error'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .filter(|s| s != "0")
            .unwrap_or_default();
        pending_cnt = conn
            .query_row(
                "SELECT COUNT(*) FROM lifelog_messages WHERE source IN ('call', 'recording') AND attachment_uuid LIKE 'pending_transcript:%'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize;
    }

    GeminiApiKeyStatus {
        has_key: !key.is_empty(),
        masked_key: mask_gemini_api_key(&key),
        model_name: saved_model,
        last_verified_at: verified_at,
        storage_location: secret_path.to_string_lossy().to_string(),
        quota_exhausted_at: exhausted_str,
        retry_after_at: retry_str,
        pending_call_count: pending_cnt,
        last_quota_error: last_err,
        today_used_tokens,
        total_used_tokens,
        today_request_count,
        last_request_tokens,
        auto_call_transcription: auto_transcribe,
    }
}

/// 미완료 통화 녹음(`mobile/calls/audio/*`) 및 독백·회의 음성녹음(`mobile/recordings/audio/*`)들을
/// **가장 최근 녹음음성부터(역순 정렬)** 순회하며 LLM 스크립트(`.md`)를 생성합니다.
/// 토큰 부족/한도 초과 발생 시 마지막 실패 시각을 기억하고 5시간 후 재시도 타이머를 설정합니다.
static IS_TRANSCRIPTION_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn process_pending_call_transcriptions(
    db_path: &Path,
    app_handle_opt: Option<&AppHandle>,
    force_now: bool,
) -> (usize, usize, String) {
    if IS_TRANSCRIPTION_RUNNING
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return (0, 0, "이미 백그라운드 스크립트 추출 작업이 실행 중입니다.".to_string());
    }
    struct ResetGuard;
    impl Drop for ResetGuard {
        fn drop(&mut self) {
            IS_TRANSCRIPTION_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _reset = ResetGuard;

    let conn = match open_db(db_path) {
        Ok(c) => c,
        Err(e) => return (0, 0, e),
    };

    if !force_now && !is_auto_call_transcription_enabled(&conn) {
        return (
            0,
            0,
            "설정에서 자동 스크립트 추출이 비활성화(No)되어 있습니다.".to_string(),
        );
    }

    let (api_key, _) = read_local_gemini_api_key();
    if api_key.is_empty() {
        return (0, 0, "Gemini API 키가 아직 등록되지 않았습니다.".to_string());
    }

    let now_ms = chrono::Local::now().timestamp_millis();
    let retry_after_ms = get_meta_i64(&conn, "gemini_quota_retry_after_ms");
    if !force_now && retry_after_ms > now_ms {
        let (rd, rt) = epoch_ms_to_local_date_time(retry_after_ms);
        return (
            0,
            0,
            format!("토큰 고갈 대기 중 ({} {} 에 자동 재시도)", rd, rt),
        );
    }

    let contacts_map = load_mobile_contacts_map(&conn);
    let calls_dir = get_archive_mobile_dir(&conn, "calls");
    let audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(&conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");
    let mut completed_now = 0usize;
    let mut failed_now = 0usize;
    let mut last_status_msg = String::new();

    struct PendingCallAudioItem {
        path: PathBuf,
        file_name: String,
        file_stem: String,
        safe_stem: String,
        contact_display: String,
        rec_date: String,
        rec_time: String,
        modified_secs: u64,
        is_voice_memo: bool,
    }

    let mut pending_items: Vec<PendingCallAudioItem> = Vec::new();
    for (scan_audio_dir, scan_md_dir, is_voice_memo) in [
        (&audio_dir, &calls_dir, false),
        (&rec_audio_dir, &rec_dir, true),
    ] {
        if let Ok(entries) = fs::read_dir(scan_audio_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let ext = p
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                    continue;
                }
                let file_name = p
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let file_stem = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if file_stem.is_empty() {
                    continue;
                }

                let safe_stem = sanitize_filename_stem(&file_stem);
                let md_path = scan_md_dir.join(format!("{}.md", safe_stem));
                if md_path.exists() {
                    if let Ok(md_raw) = fs::read_to_string(&md_path) {
                        let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
                        if fm.get("transcript_status").map(|s| s.as_str()) == Some("completed") {
                            continue;
                        }
                    }
                }

                let (contact_display, rec_date, rec_time) = if is_voice_memo {
                    let (_, rec_src, r_d, r_t) =
                        parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                    (rec_src, r_d, r_t)
                } else {
                    parse_call_audio_filename_meta(&file_stem, &contacts_map)
                };
                let modified_secs = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                pending_items.push(PendingCallAudioItem {
                    path: p,
                    file_name,
                    file_stem,
                    safe_stem,
                    contact_display,
                    rec_date,
                    rec_time,
                    modified_secs,
                    is_voice_memo,
                });
            }
        }
    }

    // 가장 최근 녹음음성부터 우선 처리하도록 내림차순 정렬 (rec_date DESC, rec_time DESC, modified_secs DESC, file_stem DESC)
    pending_items.sort_by(|a, b| {
        b.rec_date
            .cmp(&a.rec_date)
            .then_with(|| b.rec_time.cmp(&a.rec_time))
            .then_with(|| b.modified_secs.cmp(&a.modified_secs))
            .then_with(|| b.file_stem.cmp(&a.file_stem))
    });

    for item in pending_items {
        let raw_bytes = match fs::read(&item.path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&item.path, &clean_bytes);
        }

        let res = if item.is_voice_memo {
            transcribe_voice_recording_with_gemini(
                &api_key,
                &clean_bytes,
                &item.file_name,
                &item.contact_display,
            )
        } else {
            transcribe_call_audio_with_gemini(
                &api_key,
                &clean_bytes,
                &item.file_name,
                &item.contact_display,
            )
        };

        match res {
            Ok(transcript) => {
                if item.is_voice_memo {
                    write_voice_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        Some(&transcript),
                        None,
                    );
                } else {
                    write_call_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        Some(&transcript),
                        None,
                    );
                }
                clear_gemini_quota_exhaustion(&conn);
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    item.is_voice_memo,
                    &item.file_stem,
                    &item.contact_display,
                    &item.rec_date,
                    &item.rec_time,
                    Some(&transcript),
                    "",
                    "",
                );
                completed_now += 1;
                last_status_msg = format!("{} 스크립트 생성 완료", item.safe_stem);
            }
            Err(err_msg) => {
                let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                if item.is_voice_memo {
                    write_voice_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                } else {
                    write_call_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                }
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    item.is_voice_memo,
                    &item.file_stem,
                    &item.contact_display,
                    &item.rec_date,
                    &item.rec_time,
                    None,
                    "",
                    "",
                );
                failed_now += 1;
                last_status_msg = format!(
                    "LLM 토큰 부족/오류 감지 (마지막 실패: {} · 5시간 후 {} 자동 재시도): {}",
                    ex_str, rt_str, err_msg
                );
                // 토큰 부족 시 마지막 실패 시각을 기억하고 5시간 대기 후 재시도
                break;
            }
        }
    }

    if (completed_now > 0 || failed_now > 0) && app_handle_opt.is_some() {
        if let Some(app) = app_handle_opt {
            let _ = app.emit(
                "mobile-sync-event",
                serde_json::json!({
                    "type": "call_transcript_retry",
                    "message": last_status_msg
                }),
            );
        }
    }

    (completed_now, failed_now, last_status_msg)
}

fn spawn_call_transcript_retry_worker(app_handle: AppHandle, db_path: PathBuf) {
    thread::spawn(move || {
        // 앱 시작 4초 후 미완료 통화 녹음 1차 점검
        thread::sleep(std::time::Duration::from_secs(4));
        let _ = process_pending_call_transcriptions(&db_path, Some(&app_handle), false);

        // 이후 60초마다 토큰 고갈 5시간 경과 여부를 확인하여 자동 재시도
        loop {
            thread::sleep(std::time::Duration::from_secs(60));
            let _ = process_pending_call_transcriptions(&db_path, Some(&app_handle), false);
        }
    });
}

#[tauri::command]
async fn retry_pending_call_transcriptions(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GeminiApiKeyStatus, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = process_pending_call_transcriptions(&db_path, Some(&app), true);
        let conn = open_db(&db_path).ok();
        Ok(build_gemini_api_key_status_with_conn(conn.as_ref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_gemini_api_key_status(state: State<'_, AppState>) -> Result<GeminiApiKeyStatus, String> {
    let conn = open_db(&state.db_path).ok();
    Ok(build_gemini_api_key_status_with_conn(conn.as_ref()))
}

#[tauri::command]
async fn set_auto_call_transcription(
    enabled: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GeminiApiKeyStatus, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let setting_path = resolve_projects_setting_json_path(&conn);
        let mut settings = if setting_path.exists() {
            fs::read_to_string(&setting_path)
                .ok()
                .and_then(|r| serde_json::from_str::<MyLoreAppSettings>(&r).ok())
                .unwrap_or_default()
        } else {
            MyLoreAppSettings::default()
        };
        settings.auto_call_transcription = enabled;
        settings.settings_file_path = setting_path.to_string_lossy().to_string();
        if let Ok(json_str) = serde_json::to_string_pretty(&settings) {
            let _ = fs::write(&setting_path, json_str);
        }
        let _ = app.emit("app-settings-updated", &settings);

        if enabled {
            let db_clone = db_path.clone();
            let app_clone = app.clone();
            thread::spawn(move || {
                let _ = process_pending_call_transcriptions(&db_clone, Some(&app_clone), false);
            });
        }

        Ok(build_gemini_api_key_status_with_conn(Some(&conn)))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn normalize_call_contact_key(raw: &str) -> String {
    let mut s = raw
        .trim()
        .trim_start_matches("통화 녹음 ")
        .trim_start_matches("통화 녹음_")
        .trim_start_matches("통화녹음 ")
        .trim_start_matches("통화녹음_")
        .trim_start_matches("Call_")
        .trim()
        .to_string();
    if let Ok(re_paren_phone) = Regex::new(r"\s*\([0-9+\-\s]{7,}\)\s*$") {
        s = re_paren_phone.replace(&s, "").to_string();
    }
    s.trim().trim_start_matches('#').trim().to_lowercase()
}

/// 통화(`mobile/calls/audio/`) 또는 음성녹음(`mobile/recordings/audio/`) 항목으로부터 실제 오디오 파일과 `.md` 문서를 찾습니다.
fn find_call_audio_and_md(
    conn: &Connection,
    room_or_sender: &str,
    attachment_uuid: Option<&str>,
) -> Option<(PathBuf, String, String, PathBuf, bool)> {
    find_call_audio_and_md_ext(conn, room_or_sender, attachment_uuid, None, true)
}

fn find_call_audio_and_md_ext(
    conn: &Connection,
    room_or_sender: &str,
    attachment_uuid: Option<&str>,
    expected_date: Option<&str>,
    allow_any_date_fallback: bool,
) -> Option<(PathBuf, String, String, PathBuf, bool)> {
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    let calls_audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");

    let explicit_stem = attachment_uuid
        .and_then(|a| {
            a.strip_prefix("transcribed:")
                .or_else(|| a.strip_prefix("pending_transcript:"))
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let clean_room = room_or_sender
        .trim()
        .trim_start_matches("[워치]")
        .trim_start_matches("[SM-S901N]")
        .trim();

    let mut matched_audio_path: Option<PathBuf> = None;
    let mut matched_parent_dir: PathBuf = calls_dir.clone();

    if let Some(ref stem) = explicit_stem {
        for (a_dir, p_dir) in [(&calls_audio_dir, &calls_dir), (&rec_audio_dir, &rec_dir)] {
            for ext in ["m4a", "amr", "mp3", "wav", "ogg", "aac"] {
                let cand = a_dir.join(format!("{}.{}", stem, ext));
                if cand.exists() && cand.is_file() {
                    matched_audio_path = Some(cand);
                    matched_parent_dir = p_dir.clone();
                    break;
                }
            }
            if matched_audio_path.is_some() {
                break;
            }
        }
    }

    if matched_audio_path.is_none() {
        let contacts_map = load_mobile_contacts_map(conn);
        let target_norm = normalize_phone_digits(clean_room);
        let target_disp = resolve_contact_display(clean_room, &contacts_map);
        let target_key_a = normalize_call_contact_key(clean_room);
        let target_key_b = normalize_call_contact_key(&target_disp);

        for (a_dir, p_dir) in [(&rec_audio_dir, &rec_dir), (&calls_audio_dir, &calls_dir)] {
            if let Ok(entries) = fs::read_dir(a_dir) {
                let mut same_date_candidates: Vec<(String, PathBuf)> = Vec::new();
                let mut any_date_candidates: Vec<(String, PathBuf)> = Vec::new();
                for entry in entries.flatten() {
                    let p = entry.path();
                    if !p.is_file() {
                        continue;
                    }
                    let ext = p
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                        continue;
                    }
                    let stem = p
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let safe_stem = sanitize_filename_stem(&stem);
                    if let Some(ref ex) = explicit_stem {
                        if safe_stem == sanitize_filename_stem(ex) {
                            matched_audio_path = Some(p);
                            matched_parent_dir = p_dir.clone();
                            break;
                        }
                    }
                    if safe_stem == sanitize_filename_stem(clean_room)
                        || safe_stem == sanitize_filename_stem(room_or_sender)
                    {
                        matched_audio_path = Some(p);
                        matched_parent_dir = p_dir.clone();
                        break;
                    }
                    let (c_disp, r_d, r_t) = parse_call_audio_filename_meta(&stem, &contacts_map);
                    let c_key = normalize_call_contact_key(&c_disp);
                    let stem_digits = normalize_phone_digits(&stem);
                    let is_contact_match = c_disp == target_disp
                        || c_disp == clean_room
                        || (!c_key.is_empty() && (c_key == target_key_a || c_key == target_key_b))
                        || (!target_norm.is_empty()
                            && target_norm.len() >= 8
                            && stem_digits.contains(&target_norm));

                    if is_contact_match {
                        let sort_key = format!("{}_{}_{}", r_d, r_t, stem);
                        if let Some(exp_d) = expected_date {
                            if r_d == exp_d {
                                same_date_candidates.push((sort_key.clone(), p.clone()));
                            }
                        }
                        any_date_candidates.push((sort_key, p));
                    }
                }
                if matched_audio_path.is_none() {
                    if !same_date_candidates.is_empty() {
                        same_date_candidates.sort_by(|a, b| b.0.cmp(&a.0));
                        matched_audio_path = same_date_candidates.into_iter().next().map(|(_, p)| p);
                        matched_parent_dir = p_dir.clone();
                    } else if allow_any_date_fallback && !any_date_candidates.is_empty() {
                        any_date_candidates.sort_by(|a, b| b.0.cmp(&a.0));
                        matched_audio_path = any_date_candidates.into_iter().next().map(|(_, p)| p);
                        matched_parent_dir = p_dir.clone();
                    }
                }
            }
            if matched_audio_path.is_some() {
                break;
            }
        }
    }

    let audio_path = matched_audio_path?;
    let file_name = audio_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_stem = audio_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let safe_stem = sanitize_filename_stem(&file_stem);
    let md_path = matched_parent_dir.join(format!("{}.md", safe_stem));
    let mut has_transcript = false;
    if md_path.exists() {
        if let Ok(md_raw) = fs::read_to_string(&md_path) {
            let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
            if fm.get("transcript_status").map(|s| s.as_str()) == Some("completed") {
                has_transcript = true;
            }
        }
    }

    Some((audio_path, file_name, file_stem, md_path, has_transcript))
}

#[tauri::command]
async fn get_call_recording_play_info(
    state: State<'_, AppState>,
    room_or_sender: String,
    attachment_uuid: Option<String>,
) -> Result<CallPlayInfoPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let (audio_path, file_name, file_stem, _, has_transcript) =
            find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
                .ok_or_else(|| "해당 항목의 원본 녹음 오디오 파일이 다운로드되어 있지 않습니다.".to_string())?;

        let raw_bytes =
            fs::read(&audio_path).map_err(|e| format!("오디오 파일 읽기 오류: {}", e))?;
        let (clean_b, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&audio_path, &clean_b);
        }

        let lower_fn = file_name.to_lowercase();
        let mime_type = if lower_fn.ends_with(".m4a") || lower_fn.ends_with(".mp4") {
            "audio/mp4".to_string()
        } else if lower_fn.ends_with(".mp3") {
            "audio/mpeg".to_string()
        } else if lower_fn.ends_with(".wav") {
            "audio/wav".to_string()
        } else if lower_fn.ends_with(".ogg") {
            "audio/ogg".to_string()
        } else if lower_fn.ends_with(".amr") {
            "audio/amr".to_string()
        } else if lower_fn.ends_with(".aac") {
            "audio/aac".to_string()
        } else {
            "audio/mp4".to_string()
        };
        let audio_base64 = base64_encode(&clean_b);

        let is_voice_rec = audio_path
            .to_string_lossy()
            .replace('\\', "/")
            .contains("/recordings/");
        let contact_display = if is_voice_rec {
            let (disp, _, _, _) = parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
            disp
        } else {
            let contacts_map = load_mobile_contacts_map(&conn);
            let (c_disp, _, _) = parse_call_audio_filename_meta(&file_stem, &contacts_map);
            c_disp
        };

        let encoded_fn: String = file_name
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
                    (b as char).to_string()
                } else {
                    format!("%{:02X}", b)
                }
            })
            .collect();
        let sub_folder = if is_voice_rec {
            "recordings/audio"
        } else {
            "calls/audio"
        };
        let audio_url = format!(
            "http://127.0.0.1:18443/api/v1/local-media?sub={}&file={}",
            sub_folder, encoded_fn
        );

        Ok(CallPlayInfoPayload {
            audio_url,
            full_path: audio_path.to_string_lossy().to_string(),
            file_name,
            contact_display,
            has_transcript,
            audio_base64,
            mime_type,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn transcribe_single_call_item(
    state: State<'_, AppState>,
    app: AppHandle,
    room_or_sender: String,
    attachment_uuid: Option<String>,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let (api_key, _) = read_local_gemini_api_key();
        if api_key.is_empty() {
            return Err(
                "등록된 Gemini API 키가 없습니다. 라이프로그 설정 탭에서 API 키를 먼저 등록해 주세요."
                    .to_string(),
            );
        }

        let (audio_path, file_name, file_stem, _, _) =
            find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
                .ok_or_else(|| "해당 항목의 녹음 파일을 찾을 수 없습니다.".to_string())?;

        let raw_bytes =
            fs::read(&audio_path).map_err(|e| format!("오디오 파일 읽기 오류: {}", e))?;
        let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&audio_path, &clean_bytes);
        }

        let is_voice_rec = audio_path
            .to_string_lossy()
            .replace('\\', "/")
            .contains("/recordings/");

        if is_voice_rec {
            let (_disp, rec_source, rec_date, rec_time) =
                parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
            match transcribe_voice_recording_with_gemini(
                &api_key,
                &clean_bytes,
                &file_name,
                &rec_source,
            ) {
                Ok(transcript) => {
                    let md_path = write_voice_recording_markdown(
                        &conn,
                        &file_name,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        None,
                    );
                    clear_gemini_quota_exhaustion(&conn);
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        true,
                        &file_stem,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        "",
                        "",
                    );
                    let _ = app.emit(
                        "mobile-sync-event",
                        serde_json::json!({
                            "type": "call_transcript_completed",
                            "message": format!("✅ '[{}] {}' 음성메모·회의 스크립트 추출 및 요약 완료!", rec_source, file_stem)
                        }),
                    );
                    build_document_payload(&conn, &md_path)
                }
                Err(err_msg) => {
                    let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                    let _ = write_voice_recording_markdown(
                        &conn,
                        &file_name,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        true,
                        &file_stem,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        None,
                        "",
                        "",
                    );
                    Err(format!(
                        "토큰 부족/API 오류 (마지막 실패 시각: {} · 5시간 후 {} 자동 재시도): {}",
                        ex_str, rt_str, err_msg
                    ))
                }
            }
        } else {
            let contacts_map = load_mobile_contacts_map(&conn);
            let (contact_display, rec_date, rec_time) =
                parse_call_audio_filename_meta(&file_stem, &contacts_map);

            match transcribe_call_audio_with_gemini(
                &api_key,
                &clean_bytes,
                &file_name,
                &contact_display,
            ) {
                Ok(transcript) => {
                    let md_path = write_call_recording_markdown(
                        &conn,
                        &file_name,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        None,
                    );
                    clear_gemini_quota_exhaustion(&conn);
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        false,
                        &file_stem,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        "",
                        "",
                    );
                    let _ = app.emit(
                        "mobile-sync-event",
                        serde_json::json!({
                            "type": "call_transcript_completed",
                            "message": format!("✅ '{}' 통화 스크립트 추출 및 요약 완료!", contact_display)
                        }),
                    );
                    build_document_payload(&conn, &md_path)
                }
                Err(err_msg) => {
                    let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                    let _ = write_call_recording_markdown(
                        &conn,
                        &file_name,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        false,
                        &file_stem,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        None,
                        "",
                        "",
                    );
                    Err(format!(
                        "토큰 부족/API 오류 (마지막 실패 시각: {} · 5시간 후 {} 자동 재시도): {}",
                        ex_str, rt_str, err_msg
                    ))
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_and_verify_gemini_api_key(
    api_key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GeminiApiKeyStatus, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let secret_path = resolve_local_appdata_gemini_key_path();
        let trimmed = api_key.trim().to_string();

        if trimmed.is_empty() {
            let _ = fs::remove_file(&secret_path);
            let conn = open_db(&db_path).ok();
            return Ok(build_gemini_api_key_status_with_conn(conn.as_ref()));
        }

        // 백그라운드 워커 스레드에서 Gemini Flash API 호출(메인 UI 스레드 블로킹 0%)
        let test_req = serde_json::json!({
            "contents": [{
                "parts": [{ "text": "Reply with OK" }]
            }],
            "generationConfig": {
                "maxOutputTokens": 8
            }
        });
        let (_, active_model) = call_gemini_generate_content_with_model(&trimmed, &test_req)?;

        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let save_json = serde_json::json!({
            "api_key": trimmed,
            "verified_at": now_str,
            "model": active_model
        });
        fs::write(
            &secret_path,
            serde_json::to_string_pretty(&save_json).unwrap_or_default(),
        )
        .map_err(|e| format!("보안 키 파일 저장 실패: {}", e))?;

        if let Ok(conn) = open_db(&db_path) {
            clear_gemini_quota_exhaustion(&conn);
        }

        // 새 키가 인증되면 백그라운드에서 미생성 통화 스크립트 즉시 재시도 트리거
        let db_clone = db_path.clone();
        let app_clone = app.clone();
        thread::spawn(move || {
            let _ = process_pending_call_transcriptions(&db_clone, Some(&app_clone), true);
        });

        let conn = open_db(&db_path).ok();
        Ok(build_gemini_api_key_status_with_conn(conn.as_ref()))
    })
    .await
    .map_err(|e| format!("백그라운드 검증 스레드 오류: {}", e))?
}

#[tauri::command]
async fn transcribe_local_audio_file(
    audio_path: String,
    contact_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (api_key, _) = read_local_gemini_api_key();
        if api_key.is_empty() {
            return Err(
                "등록된 Gemini API 키가 없습니다. 먼저 Gemini API 키를 등록해 주세요.".to_string(),
            );
        }
        let src_path = PathBuf::from(&audio_path);
        if !src_path.exists() {
            return Err(format!("오디오 파일을 찾을 수 없습니다: {}", audio_path));
        }
        let raw_bytes = fs::read(&src_path).map_err(|e| format!("파일 읽기 오류: {}", e))?;
        let (audio_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&src_path, &audio_bytes);
        }
        let file_name = src_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "CallRec.m4a".to_string());
        let file_stem = src_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "통화상대".to_string());

        let conn = open_db(&db_path)?;
        let contacts_map = load_mobile_contacts_map(&conn);
        let (parsed_contact, rec_date, rec_time) =
            parse_call_audio_filename_meta(&file_stem, &contacts_map);
        let contact_label = if contact_name.trim().is_empty() {
            parsed_contact
        } else {
            extract_clean_contact_name(contact_name.trim(), &contacts_map)
        };

        let calls_dir = get_archive_mobile_dir(&conn, "calls");
        let audio_dir = calls_dir.join("audio");
        let _ = fs::create_dir_all(&audio_dir);
        let dest_audio = audio_dir.join(&file_name);
        if src_path != dest_audio {
            let _ = fs::write(&dest_audio, &audio_bytes);
        }

        match transcribe_call_audio_with_gemini(&api_key, &audio_bytes, &file_name, &contact_label)
        {
            Ok(transcript) => {
                write_call_recording_markdown(
                    &conn,
                    &file_name,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    Some(&transcript),
                    None,
                );
                clear_gemini_quota_exhaustion(&conn);
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    false,
                    &file_stem,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    Some(&transcript),
                    "",
                    "",
                );
                Ok(transcript)
            }
            Err(err_msg) => {
                let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                write_call_recording_markdown(
                    &conn,
                    &file_name,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    None,
                    Some((&ex_str, &rt_str, &err_msg)),
                );
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    false,
                    &file_stem,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    None,
                    "",
                    "",
                );
                Err(format!(
                    "{} (토큰 부족/오류 기록 완료 · 5시간 후인 {} 에 자동 재시도 예약)",
                    err_msg, rt_str
                ))
            }
        }
    })
    .await
    .map_err(|e| format!("백그라운드 음성 변환 스레드 오류: {}", e))?
}

fn respond_json(request: tiny_http::Request, status_code: u16, body: serde_json::Value) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap();
    let cors = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
    let cors_headers = tiny_http::Header::from_bytes(
        &b"Access-Control-Allow-Headers"[..],
        &b"Content-Type, X-MyLore-Token"[..],
    )
    .unwrap();
    let resp = tiny_http::Response::from_string(body.to_string())
        .with_status_code(status_code)
        .with_header(header)
        .with_header(cors)
        .with_header(cors_headers);
    let _ = request.respond(resp);
}

fn resolve_request_device(
    request: &tiny_http::Request,
    json_val: Option<&serde_json::Value>,
    conn: &Connection,
) -> (String, String) {
    let mut dev_id = String::new();
    let mut dev_name = String::new();

    for h in request.headers() {
        if h.field.equiv("X-MyLore-Device-Id") {
            dev_id = h.value.as_str().trim().to_string();
        } else if h.field.equiv("X-MyLore-Device-Name") {
            dev_name = h.value.as_str().trim().to_string();
        }
    }

    if let Some(jv) = json_val {
        if dev_id.is_empty() {
            if let Some(id_s) = jv.get("device_id").and_then(|v| v.as_str()) {
                dev_id = id_s.trim().to_string();
            }
        }
        if dev_name.is_empty() {
            if let Some(nm_s) = jv.get("device_name").and_then(|v| v.as_str()) {
                dev_name = nm_s.trim().to_string();
            }
        }
    }

    if dev_id.is_empty() {
        let raw_url = request.url();
        if let Some(q_idx) = raw_url.find("device_id=") {
            let sub = &raw_url[q_idx + "device_id=".len()..];
            dev_id = sub.split('&').next().unwrap_or("").trim().to_string();
        }
    }

    if !dev_id.is_empty() && dev_name.is_empty() {
        if let Ok(found_name) = conn.query_row(
            "SELECT device_name FROM paired_devices WHERE device_id = ?1 LIMIT 1",
            params![dev_id],
            |r| r.get::<_, String>(0),
        ) {
            dev_name = found_name;
        }
    }

    if dev_id.is_empty() && dev_name.is_empty() {
        if let Ok((fid, fname)) = conn.query_row(
            "SELECT device_id, device_name FROM paired_devices ORDER BY last_seen_at DESC LIMIT 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) {
            dev_id = fid;
            dev_name = fname;
        }
    }

    (dev_id, dev_name)
}

static LAST_SEEN_DB_UPDATE_MS: std::sync::atomic::AtomicI64 =
    std::sync::atomic::AtomicI64::new(0);
static CACHED_PAIRING_TOKEN: std::sync::OnceLock<Mutex<String>> =
    std::sync::OnceLock::new();

fn check_request_token(request: &tiny_http::Request, conn: &Connection) -> bool {
    let expected: String = {
        let lock = CACHED_PAIRING_TOKEN.get_or_init(|| Mutex::new(String::new()));
        let mut guard = lock.lock().unwrap();
        if guard.is_empty() {
            let db_tok: String = conn
                .query_row(
                    "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_default();
            *guard = db_tok.clone();
            db_tok
        } else {
            guard.clone()
        }
    };
    if expected.is_empty() {
        return true;
    }
    for h in request.headers() {
        let mut candidate_opt: Option<&str> = None;
        if h.field.equiv("X-MyLore-Token") {
            candidate_opt = Some(h.value.as_str().trim());
        } else if h.field.equiv("Authorization") {
            let v = h.value.as_str().trim();
            if let Some(stripped) = v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")) {
                candidate_opt = Some(stripped.trim());
            } else {
                candidate_opt = Some(v);
            }
        }
        if let Some(provided) = candidate_opt {
            if provided == expected {
                let now_ms = chrono::Local::now().timestamp_millis();
                let last_ms = LAST_SEEN_DB_UPDATE_MS.load(std::sync::atomic::Ordering::Relaxed);
                if (now_ms - last_ms) >= 60_000 {
                    LAST_SEEN_DB_UPDATE_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
                    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                    let _ = conn.execute(
                        "UPDATE paired_devices SET last_seen_at = ?1",
                        params![now_str],
                    );
                }
                return true;
            } else {
                return false;
            }
        }
    }
    // 헤더가 생략된 로컬 테스트 호출도 허용하되, 잘못된 토큰이 명시된 경우만 차단
    true
}

static CACHED_DATA_BASE_PATH: std::sync::OnceLock<Mutex<String>> =
    std::sync::OnceLock::new();

fn get_archive_mobile_dir(conn: &Connection, sub: &str) -> PathBuf {
    let data_base: String = {
        let lock = CACHED_DATA_BASE_PATH.get_or_init(|| Mutex::new(String::new()));
        let mut guard = lock.lock().unwrap();
        if guard.is_empty() {
            let db_p = conn
                .query_row(
                    "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\iseohyunDocs".to_string());
            *guard = db_p.clone();
            db_p
        } else {
            guard.clone()
        }
    };
    let dir = Path::new(&data_base).join("mobile").join(sub);
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

fn sanitize_filename_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "미분류".to_string()
    } else {
        trimmed.to_string()
    }
}

/// `mobile/{sub}/{file_stem}.md` 파일에 여러 `(date_str, entry_line)` 항목을 단 1회 파일 읽기·쓰기(Batch I/O)로 병합합니다.
fn append_lines_to_mobile_md_batch(
    conn: &Connection,
    sub: &str,
    file_stem: &str,
    doc_title: &str,
    source_aliases: &str,
    entries: &[(String, String)],
) {
    if entries.is_empty() {
        return;
    }
    let dir = get_archive_mobile_dir(conn, sub);
    let safe_stem = sanitize_filename_stem(file_stem);
    let md_path = dir.join(format!("{}.md", safe_stem));
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut content = if md_path.exists() {
        fs::read_to_string(&md_path).unwrap_or_default()
    } else {
        let new_uuid = Uuid::new_v4().to_string();
        format!(
            "---\nuuid: \"{}\"\ntitle: \"{}\"\ncategory: \"mobile/{}\"\ndevice_aliases: [\"핸드폰\", \"휴대폰\", \"스마트폰\", \"갤럭시\", \"모바일\"]\nsource_aliases: {}\nlast_synced: \"{}\"\n---\n\n# {}\n\n> **검색 키워드**: 핸드폰 · 휴대폰 · 갤럭시 · 스마트폰 · 모바일 라이프로그 (`mobile/{}`)\n\n---\n\n",
            new_uuid, doc_title, sub, source_aliases, now_str, doc_title, sub
        )
    };

    let mut modified = false;
    for (date_str, entry_line) in entries {
        if content.contains(entry_line.as_str()) {
            continue;
        }
        let date_header = format!("## 📅 {}", date_str);
        if !content.contains(&date_header) {
            if !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(&format!("\n{}\n{}\n", date_header, entry_line));
        } else {
            if !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(&format!("{}\n", entry_line));
        }
        modified = true;
    }

    if modified {
        let _ = fs::write(&md_path, content.as_bytes());
    }
}

/// `mobile/{sub}/{file_stem}.md` 파일에 날짜 섹션(`## 📅 YYYY-MM-DD`)별로 중복 없이 스크립트 라인을 추가(Append)합니다.
fn append_line_to_mobile_md(
    conn: &Connection,
    sub: &str,
    file_stem: &str,
    doc_title: &str,
    source_aliases: &str,
    date_str: &str,
    entry_line: &str,
) {
    let single = [(date_str.to_string(), entry_line.to_string())];
    append_lines_to_mobile_md_batch(conn, sub, file_stem, doc_title, source_aliases, &single);
}

/// `multipart/form-data` 바디에서 `file_hash`, `folder_name`, `folder_index`, `total_folders`, 그리고 순수 `KakaoTalkChats.txt` 본문을 분리 추출합니다.
fn parse_multipart_kakao_payload(body_str: &str) -> (String, String, String, usize, usize) {
    let mut folder_name = String::new();
    let mut file_hash = String::new();
    let mut folder_index = 1usize;
    let mut total_folders = 1usize;
    let mut clean_content = body_str.to_string();

    if let Ok(re_fh) = Regex::new(r#"name="file_hash"[\s\S]*?\r?\n\r?\n([0-9a-fA-F]{32,128})"#) {
        if let Some(cap) = re_fh.captures(body_str) {
            if let Some(m) = cap.get(1) {
                file_hash = m.as_str().trim().to_string();
            }
        }
    }
    if let Ok(re_fn) = Regex::new(r#"name="folder_name"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#) {
        if let Some(cap) = re_fn.captures(body_str) {
            if let Some(m) = cap.get(1) {
                folder_name = m.as_str().trim().to_string();
            }
        }
    }
    if let Ok(re_fi) = Regex::new(r#"name="folder_index"[\s\S]*?\r?\n\r?\n(\d+)"#) {
        if let Some(cap) = re_fi.captures(body_str) {
            if let Some(m) = cap.get(1) {
                folder_index = m.as_str().trim().parse::<usize>().unwrap_or(1).max(1);
            }
        }
    }
    if let Ok(re_tf) = Regex::new(r#"name="total_folders"[\s\S]*?\r?\n\r?\n(\d+)"#) {
        if let Some(cap) = re_tf.captures(body_str) {
            if let Some(m) = cap.get(1) {
                total_folders = m.as_str().trim().parse::<usize>().unwrap_or(1).max(1);
            }
        }
    }

    if let Some(file_idx) = body_str.find("filename=\"") {
        let after_crlf = body_str[file_idx..].find("\r\n\r\n").map(|i| file_idx + i + 4);
        let after_lf = body_str[file_idx..].find("\n\n").map(|i| file_idx + i + 2);
        let start_pos = match (after_crlf, after_lf) {
            (Some(a), Some(b)) => Some(std::cmp::min(a, b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        if let Some(sp) = start_pos {
            let mut slice = body_str[sp..].to_string();
            if let Ok(re_tail) = Regex::new(r"\r?\n--[0-9a-fA-F\-]{8,}--\s*$") {
                slice = re_tail.replace(&slice, "").to_string();
            }
            clean_content = slice.trim_start_matches('\u{feff}').trim().to_string();
        }
    }

    (folder_name, file_hash, clean_content, folder_index, total_folders)
}

/// 카카오톡 대화 `.md` 문서 상단 프론트매터에 원본 적재 폴더(`raw_folder`), 참여자, 중복/신규 건수, `last_kakao_ts` 메타데이터를 갱신합니다.
fn upsert_kakao_metadata_in_md(
    conn: &Connection,
    room_name: &str,
    raw_folder_name: &str,
    participants: &[String],
    overlapping_count: usize,
    messages_added: usize,
    last_kakao_ts: i64,
) {
    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    let safe_stem = sanitize_filename_stem(room_name);
    let md_path = kakao_dir.join(format!("{}.md", safe_stem));
    if !md_path.exists() {
        return;
    }
    let Ok(raw_md) = fs::read_to_string(&md_path) else {
        return;
    };
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut media_count = 0usize;
    if !raw_folder_name.is_empty() {
        let folder_path = kakao_dir.join(sanitize_filename_stem(raw_folder_name));
        if let Ok(entries) = fs::read_dir(&folder_path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let fname = p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    if fname != "kakaotalkchats.txt" && !fname.ends_with(".md") {
                        media_count += 1;
                    }
                }
            }
        }
    }

    let part_json = serde_json::to_string(participants).unwrap_or_else(|_| "[]".to_string());
    let raw_folder_rel = if raw_folder_name.is_empty() {
        "mobile/kakao".to_string()
    } else {
        format!("mobile/kakao/{}", sanitize_filename_stem(raw_folder_name))
    };

    if raw_md.starts_with("---\n") || raw_md.starts_with("---\r\n") {
        let sep = if raw_md.starts_with("---\r\n") { "\r\n" } else { "\n" };
        if let Some(end_idx) = raw_md[4..].find(&format!("{}---", sep)) {
            let fm_end = 4 + end_idx;
            let fm_block = &raw_md[4..fm_end];
            let body_rest = &raw_md[fm_end + 4..];
            let mut kept_lines: Vec<String> = Vec::new();
            for line in fm_block.lines() {
                let t = line.trim();
                if t.starts_with("last_synced:")
                    || t.starts_with("raw_folder:")
                    || t.starts_with("participants:")
                    || t.starts_with("overlapping_messages:")
                    || t.starts_with("newly_added_messages:")
                    || t.starts_with("media_files_in_folder:")
                    || t.starts_with("last_kakao_ts:")
                {
                    continue;
                }
                kept_lines.push(line.to_string());
            }
            kept_lines.push(format!("raw_folder: \"{}\"", raw_folder_rel));
            kept_lines.push(format!("participants: {}", part_json));
            kept_lines.push(format!("overlapping_messages: {}", overlapping_count));
            kept_lines.push(format!("newly_added_messages: {}", messages_added));
            kept_lines.push(format!("media_files_in_folder: {}", media_count));
            kept_lines.push(format!("last_kakao_ts: {}", last_kakao_ts));
            kept_lines.push(format!("last_synced: \"{}\"", now_str));
            let updated = format!("---\n{}\n---{}", kept_lines.join("\n"), body_rest);
            let _ = fs::write(&md_path, updated.as_bytes());
        }
    }
}

static MEM_LAST_KAKAO_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static MEM_LAST_SMS_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static MEM_LAST_CALL_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static MEM_LAST_NOTI_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static MEM_LAST_RECORDING_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static MEM_LAST_HEALTH_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static MEM_LAST_CONTACT_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static MEM_LAST_USAGE_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static PENDING_SYNCED_HASHES: std::sync::OnceLock<Mutex<HashSet<String>>> =
    std::sync::OnceLock::new();

fn update_atomic_max_i64(atom: &std::sync::atomic::AtomicI64, val: i64) {
    if val <= 0 {
        return;
    }
    let _ = atom.fetch_max(val, std::sync::atomic::Ordering::Relaxed);
}

fn reset_in_memory_sync_caches() {
    for a in [
        &MEM_LAST_KAKAO_TS,
        &MEM_LAST_SMS_TS,
        &MEM_LAST_CALL_TS,
        &MEM_LAST_NOTI_TS,
        &MEM_LAST_RECORDING_TS,
        &MEM_LAST_HEALTH_TS,
        &MEM_LAST_CONTACT_TS,
        &MEM_LAST_USAGE_TS,
    ] {
        a.store(0, std::sync::atomic::Ordering::Relaxed);
    }
    if let Some(lock) = PENDING_SYNCED_HASHES.get() {
        if let Ok(mut g) = lock.lock() {
            g.clear();
        }
    }
}

fn mark_hash_synced_in_memory(h: &str) {
    if h.is_empty() {
        return;
    }
    let lock = PENDING_SYNCED_HASHES.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut g) = lock.lock() {
        g.insert(h.to_string());
    }
}

fn is_hash_synced_in_memory(h: &str) -> bool {
    let lock = PENDING_SYNCED_HASHES.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(g) = lock.lock() {
        return g.contains(h);
    }
    false
}

fn check_request_token_fast(request: &tiny_http::Request, db_path: &Path) -> bool {
    let expected: String = {
        let lock = CACHED_PAIRING_TOKEN.get_or_init(|| Mutex::new(String::new()));
        let mut guard = lock.lock().unwrap();
        if guard.is_empty() {
            let db_tok = open_db(db_path)
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                })
                .unwrap_or_default();
            *guard = db_tok.clone();
            db_tok
        } else {
            guard.clone()
        }
    };
    if expected.is_empty() {
        return true;
    }
    for h in request.headers() {
        let mut candidate_opt: Option<&str> = None;
        if h.field.equiv("X-MyLore-Token") {
            candidate_opt = Some(h.value.as_str().trim());
        } else if h.field.equiv("Authorization") {
            let v = h.value.as_str().trim();
            if let Some(stripped) = v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")) {
                candidate_opt = Some(stripped.trim());
            } else {
                candidate_opt = Some(v);
            }
        }
        if let Some(provided) = candidate_opt {
            return provided == expected;
        }
    }
    true
}

fn extract_request_device_headers(
    request: &tiny_http::Request,
    json_val: Option<&serde_json::Value>,
) -> (String, String) {
    let mut dev_id = String::new();
    let mut dev_name = String::new();
    for h in request.headers() {
        if h.field.equiv("X-MyLore-Device-Id") {
            dev_id = h.value.as_str().trim().to_string();
        } else if h.field.equiv("X-MyLore-Device-Name") {
            dev_name = h.value.as_str().trim().to_string();
        }
    }
    if let Some(jv) = json_val {
        if dev_id.is_empty() {
            if let Some(id_s) = jv.get("device_id").and_then(|v| v.as_str()) {
                dev_id = id_s.trim().to_string();
            }
        }
        if dev_name.is_empty() {
            if let Some(nm_s) = jv.get("device_name").and_then(|v| v.as_str()) {
                dev_name = nm_s.trim().to_string();
            }
        }
    }
    if dev_id.is_empty() {
        let raw_url = request.url();
        if let Some(q_idx) = raw_url.find("device_id=") {
            let sub = &raw_url[q_idx + "device_id=".len()..];
            dev_id = sub.split('&').next().unwrap_or("").trim().to_string();
        }
    }
    (dev_id, dev_name)
}

enum SyncWorkerJob {
    StartSyncInspection {
        reset_watermarks: bool,
    },
    BatchInit {
        service: String,
        total_count: usize,
    },
    Notifications {
        dev_id: String,
        dev_name: String,
        items: Vec<(String, String, String, i64)>, // (pkg, title, text, ts)
        current_index: usize,
        total_count: usize,
    },
    Sms {
        dev_id: String,
        dev_name: String,
        items: Vec<(String, String, String, i64)>, // (address, clean_body, sms_type, ts)
    },
    CallLogs {
        dev_id: String,
        dev_name: String,
        items: Vec<(String, String, String, i64, i64)>, // (number, name, call_type, duration_sec, ts)
    },
    KakaoChat {
        dev_id: String,
        room_name: String,
        raw_folder_name: String,
        raw_text: String,
        file_hash: String,
        folder_index: usize,
        total_folders: usize,
        now_ms: i64,
    },
    Contacts {
        dev_id: String,
        items: Vec<(String, Vec<String>, String, String, i64)>, // (name, phones, org, memo, ts)
    },
    AppUsage {
        dev_id: String,
        items: Vec<(String, String, String, i64, i64, i64)>, // (date, pkg, app_name, fg_ms, launch_count, last_used)
    },
    CallRecording {
        dev_id: String,
        dev_name: String,
        file_hash: String,
        file_name: String,
        contact_label: String,
        transcript_text: String,
        audio_bytes: Vec<u8>,
        now_ms: i64,
    },
    Media {
        file_name: String,
        source_type: String,
        folder_name: String,
        file_bytes: Vec<u8>,
        taken_date: String,
        taken_time: String,
        media_uuid: String,
        content_hash: String,
    },
    SamsungHealth {
        dev_id: String,
        dev_name: String,
        raw_bytes: Vec<u8>,
        now_ms: i64,
    },
}

impl SyncWorkerJob {
    /// 6대 라이프로그 수집 진행률(카톡·알림·문자·통화·녹음·헬스)에 반영되는 포그라운드 동기화 작업인지 여부
    /// - 5초마다 백그라운드로 수신되는 `AppUsage`, `Contacts`는 진행률 바나 워커 배지를 깜빡이게 하지 않습니다.
    fn is_foreground_sync_job(&self) -> bool {
        !matches!(
            self,
            SyncWorkerJob::Contacts { .. } | SyncWorkerJob::AppUsage { .. }
        )
    }
}

static SYNC_WORKER_TX: std::sync::OnceLock<Mutex<std::sync::mpsc::Sender<SyncWorkerJob>>> =
    std::sync::OnceLock::new();

fn enqueue_sync_worker_job(job: SyncWorkerJob) {
    if let Some(tx_mutex) = SYNC_WORKER_TX.get() {
        if let Ok(tx) = tx_mutex.lock() {
            let is_fg = job.is_foreground_sync_job();
            if is_fg {
                SYNC_QUEUE_DEPTH.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                IS_WORKER_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            if tx.send(job).is_err() && is_fg {
                SYNC_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
}

/// 삼성 헬스 & 갤럭시 워치 GPS 운동 데이터를 파싱하여 `mobile/health/{YYYY-MM}_운동기록.md` 및 `mobile/health/gpx/{YYYYMMDD_HHMMSS}_{종목}.gpx`로 변환 적재합니다.
fn process_samsung_health_sync_payload(
    conn: &Connection,
    dev_id: &str,
    dev_name: &str,
    raw_bytes: &[u8],
    now_ms: i64,
) -> (usize, usize, i64) {
    let health_dir = get_archive_mobile_dir(conn, "health");
    let gpx_dir = health_dir.join("gpx");
    let _ = fs::create_dir_all(&gpx_dir);

    let (clean_bytes, _) = strip_multipart_prefix_if_present(raw_bytes);
    let body_str = String::from_utf8_lossy(&clean_bytes).to_string();
    let trimmed = body_str.trim();

    let mut added_count = 0usize;
    let mut skipped_count = 0usize;
    let mut max_ts = now_ms;
    let mut md_batches: HashMap<String, Vec<(String, String)>> = HashMap::new();

    // GPX XML 빌더 헬퍼 (`location_data.json` 포맷: `[{"latitude": 35.1, "longitude": 128.6, "altitude": 12.3, "start_time": 1730...}, ...]`)
    let write_gpx_from_points = |points: &[serde_json::Value],
                                 exercise_name: &str,
                                 ts_ms: i64|
     -> Option<String> {
        let mut trkpts = String::new();
        let mut valid_pts = 0usize;
        for pt in points {
            let lat = pt
                .get("latitude")
                .or_else(|| pt.get("lat"))
                .and_then(|v| v.as_f64());
            let lon = pt
                .get("longitude")
                .or_else(|| pt.get("lon"))
                .or_else(|| pt.get("lng"))
                .and_then(|v| v.as_f64());
            if let (Some(la), Some(lo)) = (lat, lon) {
                let ele = pt
                    .get("altitude")
                    .or_else(|| pt.get("alt"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let pt_ts = pt
                    .get("start_time")
                    .or_else(|| pt.get("timestamp"))
                    .or_else(|| pt.get("ts"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(ts_ms);
                let (d_s, t_s) = epoch_ms_to_local_date_time(pt_ts);
                trkpts.push_str(&format!(
                    "      <trkpt lat=\"{:.6}\" lon=\"{:.6}\"><ele>{:.1}</ele><time>{}T{}Z</time></trkpt>\n",
                    la, lo, ele, d_s, t_s
                ));
                valid_pts += 1;
            }
        }
        if valid_pts == 0 {
            return None;
        }
        let (d_str, t_str) = epoch_ms_to_local_date_time(ts_ms);
        let stamp = format!("{}_{}", d_str.replace('-', ""), t_str.replace(':', ""));
        let safe_ex = sanitize_filename_stem(exercise_name);
        let gpx_filename = format!("{}_{}.gpx", stamp, safe_ex);
        let gpx_path = gpx_dir.join(&gpx_filename);
        let gpx_xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <gpx version=\"1.1\" creator=\"myLore Samsung Health Sync\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n\
               <metadata><name>{} ({})</name></metadata>\n\
               <trk>\n\
                 <name>{}</name>\n\
                 <trkseg>\n\
             {}\
                 </trkseg>\n\
               </trk>\n\
             </gpx>\n",
            exercise_name, d_str, exercise_name, trkpts
        );
        let _ = fs::write(&gpx_path, gpx_xml.as_bytes());
        Some(gpx_filename)
    };

    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(arr) = jv.as_array() {
                // `location_data.json` 배열 자체가 업로드된 경우
                if let Some(gpx_fn) = write_gpx_from_points(arr, "워치운동", now_ms) {
                    let (s_date, s_time) = epoch_ms_to_local_date_time(now_ms);
                    let ym = if s_date.len() >= 7 { &s_date[..7] } else { "2026-10" }.to_string();
                    let msg = format!("🏃 [워치 GPS 경로] `{}` ({}개 좌표 기록)", gpx_fn, arr.len());
                    let md_line = format!("- **[{}] {}** — `gpx/{}`", s_time, msg, gpx_fn);
                    md_batches
                        .entry(ym)
                        .or_default()
                        .push((s_date.clone(), md_line));
                    let dedup_key = blake3::hash(format!("health_gpx|{}", gpx_fn).as_bytes())
                        .to_hex()
                        .to_string();
                    let affected = conn
                        .execute(
                            "INSERT OR IGNORE INTO lifelog_messages
                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                             VALUES ('health', '삼성 헬스 · 워치 GPS', '워치운동', ?1, ?2, ?3, ?4, ?5, ?6)",
                            params![msg, s_date, s_time, dedup_key, dev_id, dev_name],
                        )
                        .unwrap_or(0);
                    if affected > 0 {
                        added_count += 1;
                    } else {
                        skipped_count += 1;
                    }
                }
            } else {
                let empty_arr = Vec::new();
                let items = jv
                    .get("items")
                    .or_else(|| jv.get("exercises"))
                    .and_then(|v| v.as_array())
                    .unwrap_or(&empty_arr);
                for item in items {
                    let ex_type = item
                        .get("exercise_type")
                        .or_else(|| item.get("type"))
                        .or_else(|| item.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("운동");
                    let duration_sec = item
                        .get("duration_sec")
                        .or_else(|| item.get("duration"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let calorie = item
                        .get("calorie")
                        .or_else(|| item.get("calories"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let mean_hr = item
                        .get("mean_heart_rate")
                        .or_else(|| item.get("heart_rate"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let distance_m = item
                        .get("distance")
                        .or_else(|| item.get("distance_m"))
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let steps = item.get("steps").and_then(|v| v.as_i64()).unwrap_or(0);
                    let ts = item
                        .get("ts")
                        .or_else(|| item.get("start_time"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(now_ms);
                    if ts > max_ts {
                        max_ts = ts;
                    }
                    let (s_date, s_time) = epoch_ms_to_local_date_time(ts);
                    let ym = if s_date.len() >= 7 { &s_date[..7] } else { "2026-10" }.to_string();

                    let mut gpx_note = String::new();
                    if let Some(loc_arr) = item
                        .get("location_data")
                        .or_else(|| item.get("points"))
                        .and_then(|v| v.as_array())
                    {
                        if let Some(gpx_fn) = write_gpx_from_points(loc_arr, ex_type, ts) {
                            gpx_note = format!(" · GPX: `gpx/{}`", gpx_fn);
                        }
                    }

                    let mins = duration_sec / 60;
                    let secs = duration_sec % 60;
                    let summary = if steps > 0 && duration_sec == 0 {
                        format!(
                            "🏃 [걸음수 통계] {}보 · {:.0} kcal · {:.2} km",
                            steps,
                            calorie,
                            distance_m / 1000.0
                        )
                    } else {
                        format!(
                            "🏃 [{}] {}분 {}초 · {:.0} kcal · 평균심박 {} bpm · {:.2} km{}",
                            ex_type,
                            mins,
                            secs,
                            calorie,
                            mean_hr,
                            distance_m / 1000.0,
                            gpx_note
                        )
                    };
                    let md_line = format!("- **[{}] {}**", s_time, summary);
                    md_batches
                        .entry(ym)
                        .or_default()
                        .push((s_date.clone(), md_line));

                    let dedup_raw = format!("health|{}|{}|{}|{}", ex_type, s_date, s_time, summary);
                    let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                    let affected = conn
                        .execute(
                            "INSERT OR IGNORE INTO lifelog_messages
                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                             VALUES ('health', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                            params![
                                format!("삼성 헬스 ({})", ex_type),
                                ex_type,
                                summary,
                                s_date,
                                s_time,
                                dedup_key,
                                dev_id,
                                dev_name
                            ],
                        )
                        .unwrap_or(0);
                    if affected > 0 {
                        added_count += 1;
                    } else {
                        skipped_count += 1;
                    }
                }
            }
        }
    } else if !trimmed.is_empty() {
        // CSV 텍스트 업로드 지원
        let (s_date, s_time) = epoch_ms_to_local_date_time(now_ms);
        let ym = if s_date.len() >= 7 { &s_date[..7] } else { "2026-10" }.to_string();
        for line in trimmed.lines().skip(1).take(200) {
            let l = line.trim();
            if l.is_empty() || l.starts_with("com.samsung.") {
                continue;
            }
            let summary = format!("🏃 [삼성 헬스 CSV] {}", l.chars().take(140).collect::<String>());
            let md_line = format!("- **[{}] {}**", s_time, summary);
            md_batches
                .entry(ym.clone())
                .or_default()
                .push((s_date.clone(), md_line));
            let dedup_key = blake3::hash(format!("health_csv|{}", l).as_bytes())
                .to_hex()
                .to_string();
            let affected = conn
                .execute(
                    "INSERT OR IGNORE INTO lifelog_messages
                     (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                     VALUES ('health', '삼성 헬스 기록', '삼성 헬스', ?1, ?2, ?3, ?4, ?5, ?6)",
                    params![summary, s_date, s_time, dedup_key, dev_id, dev_name],
                )
                .unwrap_or(0);
            if affected > 0 {
                added_count += 1;
            } else {
                skipped_count += 1;
            }
        }
    }

    for (ym, lines) in md_batches {
        append_lines_to_mobile_md_batch(
            conn,
            "health",
            &format!("{}_운동기록", ym),
            &format!("[삼성 헬스 & 워치 운동기록] {}", ym),
            "[\"헬스\", \"삼성헬스\", \"운동\", \"운동기록\", \"워치\", \"심박수\", \"걸음수\", \"GPX\"]",
            &lines,
        );
    }

    set_meta_i64_max(conn, "last_health_ts", max_ts);
    if !dev_id.is_empty() {
        let _ = conn.execute(
            "UPDATE paired_devices SET last_health_ts = MAX(COALESCE(last_health_ts, 0), ?1) WHERE device_id = ?2",
            params![max_ts, dev_id],
        );
    }
    (added_count, skipped_count, max_ts)
}

/// 메인 프로그램(UI/IPC/DB)과 완전히 분리된 전용 백그라운드 동기화 워커 스레드
/// - 모든 HTTP 동기화 패킷의 디스크 `.md` 병합 및 SQLite 적재를 큐(Channel)로 받아 단일 트랜잭션(`BEGIN IMMEDIATE ... COMMIT`)과 파일별 1회 배치 쓰기로 처리합니다.
/// - 연속 수신 중에는 `mobile-sync-event`를 발생시키지 않고 진행률(`LIVE_SYNC_PROGRESS`)만 갱신하며, 큐가 모두 비워진 후에만 단 1회 완료 이벤트를 발생시킵니다.
fn spawn_mobile_sync_worker_thread(app_handle: AppHandle, db_path: PathBuf) {
    let (tx, rx) = std::sync::mpsc::channel::<SyncWorkerJob>();
    let _ = SYNC_WORKER_TX.set(Mutex::new(tx));

    let _ = thread::Builder::new()
        .name("mylore-mobile-sync-worker".to_string())
        .spawn(move || {
            let android_msg_re = Regex::new(
                r"^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+(오전|오후)\s*(\d{1,2}:\d{2}),\s*([^:]+?)\s*:\s*(.*)$",
            )
            .unwrap();
            let date_re = Regex::new(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일").unwrap();
            let pc_msg_re = Regex::new(r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$").unwrap();

            // 서버 기동 시 DB에 저장된 워터마크를 인메모리 캐시에 로드하고 초기 6단계 동기화 점검 수행
            if let Ok(conn) = open_db(&db_path) {
                update_atomic_max_i64(&MEM_LAST_KAKAO_TS, get_meta_i64(&conn, "last_kakao_ts"));
                update_atomic_max_i64(&MEM_LAST_NOTI_TS, get_meta_i64(&conn, "last_noti_ts"));
                update_atomic_max_i64(&MEM_LAST_SMS_TS, get_meta_i64(&conn, "last_sms_ts"));
                update_atomic_max_i64(&MEM_LAST_CALL_TS, get_meta_i64(&conn, "last_call_ts"));
                update_atomic_max_i64(
                    &MEM_LAST_RECORDING_TS,
                    get_meta_i64(&conn, "last_recording_ts"),
                );
                update_atomic_max_i64(&MEM_LAST_HEALTH_TS, get_meta_i64(&conn, "last_health_ts"));
                update_atomic_max_i64(&MEM_LAST_CONTACT_TS, get_meta_i64(&conn, "last_contact_ts"));
                update_atomic_max_i64(&MEM_LAST_USAGE_TS, get_meta_i64(&conn, "last_usage_ts"));
            }
            let _ = broadcast_udp_pc_online();
            complete_all_remaining_sync_steps(&app_handle, &db_path, true);

            let mut next_first_job: Option<SyncWorkerJob> = None;
            let mut cycle_had_foreground_job = false;
            let mut waiting_for_initial_phone_burst = false;

            loop {
                let first_job = match next_first_job.take() {
                    Some(j) => j,
                    None => match rx.recv() {
                        Ok(j) => j,
                        Err(_) => break,
                    },
                };

                let mut batch: Vec<SyncWorkerJob> = Vec::with_capacity(64);
                batch.push(first_job);
                while batch.len() < 128 {
                    match rx.try_recv() {
                        Ok(j) => batch.push(j),
                        Err(_) => break,
                    }
                }

                if batch.iter().any(|j| j.is_foreground_sync_job()) {
                    cycle_had_foreground_job = true;
                    IS_WORKER_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
                }

                if let Ok(conn) = open_db(&db_path) {
                    let _ = conn.execute_batch("BEGIN IMMEDIATE;");

                    // (sub, file_stem, doc_title, source_aliases) -> Vec<(date_str, md_line)>
                    let mut md_coalesced: HashMap<
                        (String, String, String, String),
                        Vec<(String, String)>,
                    > = HashMap::new();
                    let mut need_transcript_trigger = false;

                    for job in batch {
                        let is_fg = job.is_foreground_sync_job();
                        match job {
                            SyncWorkerJob::StartSyncInspection { reset_watermarks } => {
                                waiting_for_initial_phone_burst = true;
                                let mutex = LIVE_SYNC_PROGRESS
                                    .get_or_init(|| Mutex::new(default_live_sync_progress()));
                                if let Ok(mut guard) = mutex.lock() {
                                    *guard = default_live_sync_progress();
                                    guard.is_running = true;
                                    guard.is_completed = false;
                                    guard.queued_jobs = SYNC_QUEUE_DEPTH
                                        .load(std::sync::atomic::Ordering::Relaxed);
                                    guard.current_label = if reset_watermarks {
                                        "카카오톡 받아오는 중... (전체 데이터 재요청 송출)"
                                            .to_string()
                                    } else {
                                        "카카오톡 받아오는 중... (모바일 동기화 점검)".to_string()
                                    };
                                    if let Some(first_step) = guard.steps.first_mut() {
                                        first_step.status = "running".to_string();
                                    }
                                    let _ = app_handle.emit("mobile-sync-progress", &*guard);
                                }
                                let _ = broadcast_udp_pc_online();
                            }
                            SyncWorkerJob::BatchInit {
                                service,
                                total_count,
                            } => {
                                waiting_for_initial_phone_burst = false;
                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    &service,
                                    0,
                                    total_count.max(1),
                                    0,
                                    0,
                                    Some(&format!("총 {}건 전송 준비 완료 (0%)", total_count)),
                                );
                            }
                            SyncWorkerJob::Notifications {
                                dev_id,
                                dev_name,
                                items,
                                current_index,
                                total_count,
                            } => {
                                let mut downloaded = 0usize;
                                let mut skipped = 0usize;
                                let mut max_ts = 0i64;
                                for (pkg, title, text, ts) in items {
                                    if ts > max_ts {
                                        max_ts = ts;
                                    }
                                    let (sent_date, sent_time) = epoch_ms_to_local_date_time(ts);
                                    let dedup_raw = format!(
                                        "noti|{}|{}|{}|{}|{}",
                                        pkg, sent_date, sent_time, title, text
                                    );
                                    let dedup_key =
                                        blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                                    let affected = conn
                                        .execute(
                                            "INSERT OR IGNORE INTO lifelog_messages
                                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                             VALUES ('notification', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                                            params![
                                                pkg, title, text, sent_date, sent_time, dedup_key,
                                                dev_id, dev_name
                                            ],
                                        )
                                        .unwrap_or(0);
                                    if affected > 0 {
                                        downloaded += 1;
                                    } else {
                                        skipped += 1;
                                    }
                                    let ym = if sent_date.len() >= 7 {
                                        &sent_date[..7]
                                    } else {
                                        "2026-10"
                                    };
                                    let md_line = format!(
                                        "- **[{}] [{}] {}**: {}",
                                        sent_time,
                                        pkg,
                                        title.replace('\n', " "),
                                        text.replace('\n', " ")
                                    );
                                    md_coalesced
                                        .entry((
                                            "notifications".to_string(),
                                            format!("{}_알람내역", ym),
                                            format!("[모바일 알람/알림 내역] {}", ym),
                                            "[\"알람\", \"알림\", \"알람내역\", \"푸시알림\", \"상단바알림\"]"
                                                .to_string(),
                                        ))
                                        .or_default()
                                        .push((sent_date.clone(), md_line));

                                    let _ = try_insert_finance_from_mobile_text(
                                        &conn,
                                        &pkg,
                                        &title,
                                        &text,
                                        &sent_date,
                                        &sent_time,
                                        "모바일 실시간 푸시 알림 적재",
                                    );
                                }
                                if max_ts > 0 {
                                    set_meta_i64_max(&conn, "last_noti_ts", max_ts);
                                    if !dev_id.is_empty() {
                                        let _ = conn.execute(
                                            "UPDATE paired_devices SET last_noti_ts = MAX(COALESCE(last_noti_ts, 0), ?1) WHERE device_id = ?2",
                                            params![max_ts, dev_id],
                                        );
                                    }
                                }
                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    "notification",
                                    current_index,
                                    total_count,
                                    skipped,
                                    downloaded,
                                    Some(&format!(
                                        "알림 {}/{}건 처리 중 ({}%)",
                                        current_index,
                                        total_count,
                                        ((current_index as f64 / total_count.max(1) as f64) * 100.0)
                                            .round() as usize
                                    )),
                                );
                            }
                            SyncWorkerJob::Sms {
                                dev_id,
                                dev_name,
                                items,
                            } => {
                                let total_len = items.len().max(1);
                                let mut downloaded = 0usize;
                                let mut skipped = 0usize;
                                let mut max_ts = 0i64;
                                for (address, body, sms_type, ts) in items {
                                    if ts > max_ts {
                                        max_ts = ts;
                                    }
                                    let (sent_date, sent_time) = epoch_ms_to_local_date_time(ts);
                                    let sender_label = if sms_type == "sent" {
                                        "나 (문자발신)"
                                    } else {
                                        address.as_str()
                                    };
                                    let dedup_raw = format!(
                                        "sms|{}|{}|{}|{}|{}",
                                        address, sent_date, sent_time, sms_type, body
                                    );
                                    let dedup_key =
                                        blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                                    let affected = conn
                                        .execute(
                                            "INSERT OR IGNORE INTO lifelog_messages
                                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                             VALUES ('sms', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                                            params![
                                                address,
                                                sender_label,
                                                body,
                                                sent_date,
                                                sent_time,
                                                dedup_key,
                                                dev_id,
                                                dev_name
                                            ],
                                        )
                                        .unwrap_or(0);
                                    if affected > 0 {
                                        downloaded += 1;
                                    } else {
                                        skipped += 1;
                                    }
                                    let dir_tag = if sms_type == "sent" {
                                        "📤 발신"
                                    } else {
                                        "📥 수신"
                                    };
                                    let md_line = format!(
                                        "- **[{}] [{}] {}**: {}",
                                        sent_time, dir_tag, sender_label, body
                                    );
                                    md_coalesced
                                        .entry((
                                            "sms".to_string(),
                                            address.clone(),
                                            format!("[문자(SMS) 내역] {}", address),
                                            "[\"문자\", \"문자내역\", \"메시지\", \"SMS\", \"MMS\"]"
                                                .to_string(),
                                        ))
                                        .or_default()
                                        .push((sent_date.clone(), md_line));

                                    if sms_type != "sent" {
                                        let _ = try_insert_finance_from_mobile_text(
                                            &conn,
                                            &address,
                                            &address,
                                            &body,
                                            &sent_date,
                                            &sent_time,
                                            "모바일 SMS 문자 자동 적재",
                                        );
                                    }
                                }
                                if max_ts > 0 {
                                    set_meta_i64_max(&conn, "last_sms_ts", max_ts);
                                    if !dev_id.is_empty() {
                                        let _ = conn.execute(
                                            "UPDATE paired_devices SET last_sms_ts = MAX(COALESCE(last_sms_ts, 0), ?1) WHERE device_id = ?2",
                                            params![max_ts, dev_id],
                                        );
                                    }
                                }
                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    "sms",
                                    total_len,
                                    total_len,
                                    skipped,
                                    downloaded,
                                    None,
                                );
                            }
                            SyncWorkerJob::CallLogs {
                                dev_id,
                                dev_name: _,
                                items,
                            } => {
                                let total_len = items.len().max(1);
                                let mut inserted = 0usize;
                                let mut skipped = 0usize;
                                let mut max_ts = 0i64;
                                for (number, name, call_type, duration_sec, ts) in items {
                                    if ts > max_ts {
                                        max_ts = ts;
                                    }
                                    let (call_date, call_time) = epoch_ms_to_local_date_time(ts);
                                    let dedup_raw = format!(
                                        "call|{}|{}|{}|{}|{}",
                                        number, call_date, call_time, call_type, duration_sec
                                    );
                                    let dedup_key =
                                        blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                                    let affected = conn
                                        .execute(
                                            "INSERT OR IGNORE INTO lifelog_call_logs
                                             (phone_number, contact_name, call_type, duration_sec, call_date, call_time, timestamp_ms, dedup_key)
                                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                                            params![
                                                number,
                                                name,
                                                call_type,
                                                duration_sec,
                                                call_date,
                                                call_time,
                                                ts,
                                                dedup_key
                                            ],
                                        )
                                        .unwrap_or(0);
                                    if affected > 0 {
                                        inserted += 1;
                                    } else {
                                        skipped += 1;
                                    }
                                    let type_kr = match call_type.as_str() {
                                        "outgoing" => "발신통화",
                                        "missed" => "부재중통화",
                                        "rejected" => "수신거절",
                                        _ => "수신통화",
                                    };
                                    let display_target = if name.trim().is_empty() {
                                        number.clone()
                                    } else {
                                        format!("{} ({})", name, number)
                                    };
                                    let mins = duration_sec / 60;
                                    let secs = duration_sec % 60;
                                    let msg_summary = if duration_sec > 0 {
                                        format!(
                                            "📞 [{}] {} — 통화시간 {}분 {}초",
                                            type_kr, display_target, mins, secs
                                        )
                                    } else {
                                        format!("📞 [{}] {}", type_kr, display_target)
                                    };
                                    let _ = conn.execute(
                                        "INSERT OR IGNORE INTO lifelog_messages
                                         (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key)
                                         VALUES ('call', ?1, ?2, ?3, ?4, ?5, ?6)",
                                        params![
                                            display_target,
                                            type_kr,
                                            msg_summary,
                                            call_date,
                                            call_time,
                                            dedup_key
                                        ],
                                    );
                                    let md_line = format!("- **[{}] {}**", call_time, msg_summary);
                                    md_coalesced
                                        .entry((
                                            "calls".to_string(),
                                            display_target.clone(),
                                            format!("[통화내역 스크립트] {}", display_target),
                                            "[\"통화\", \"통화내역\", \"통화내용\", \"전화\", \"통화기록\"]"
                                                .to_string(),
                                        ))
                                        .or_default()
                                        .push((call_date, md_line));
                                }
                                if max_ts > 0 {
                                    set_meta_i64_max(&conn, "last_call_ts", max_ts);
                                    if !dev_id.is_empty() {
                                        let _ = conn.execute(
                                            "UPDATE paired_devices SET last_call_ts = MAX(COALESCE(last_call_ts, 0), ?1) WHERE device_id = ?2",
                                            params![max_ts, dev_id],
                                        );
                                    }
                                }
                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    "call",
                                    total_len,
                                    total_len,
                                    skipped,
                                    inserted,
                                    None,
                                );
                            }
                            SyncWorkerJob::KakaoChat {
                                dev_id,
                                mut room_name,
                                raw_folder_name,
                                raw_text,
                                file_hash,
                                folder_index,
                                total_folders,
                                now_ms,
                            } => {
                                let mut current_date =
                                    chrono::Local::now().format("%Y-%m-%d").to_string();
                                let mut parsed_kakao_items: Vec<(String, String, String, String)> =
                                    Vec::new();
                                let mut participants: Vec<String> = Vec::new();

                                for line in raw_text.lines() {
                                    let t_line = line.trim().trim_start_matches('\u{feff}');
                                    if t_line.is_empty() {
                                        continue;
                                    }
                                    if let Some(cap) = android_msg_re.captures(t_line) {
                                        let y = cap.get(1).map(|m| m.as_str()).unwrap_or("2026");
                                        let m: u32 = cap
                                            .get(2)
                                            .and_then(|m| m.as_str().parse().ok())
                                            .unwrap_or(1);
                                        let d: u32 = cap
                                            .get(3)
                                            .and_then(|m| m.as_str().parse().ok())
                                            .unwrap_or(1);
                                        let ampm = cap.get(4).map(|m| m.as_str()).unwrap_or("오전");
                                        let hm = cap.get(5).map(|m| m.as_str()).unwrap_or("00:00");
                                        let sender =
                                            cap.get(6).map(|m| m.as_str()).unwrap_or("").trim();
                                        let body = cap.get(7).map(|m| m.as_str()).unwrap_or("");
                                        if !sender.is_empty()
                                            && sender != "회원님"
                                            && !participants.iter().any(|p| p == sender)
                                        {
                                            participants.push(sender.to_string());
                                        }
                                        current_date = format!("{}-{:02}-{:02}", y, m, d);
                                        let time_str = format!("{} {}", ampm, hm);
                                        parsed_kakao_items.push((
                                            current_date.clone(),
                                            time_str,
                                            sender.to_string(),
                                            body.to_string(),
                                        ));
                                        continue;
                                    }
                                    if t_line.starts_with("---") {
                                        if let Some(cap) = date_re.captures(t_line) {
                                            let y =
                                                cap.get(1).map(|m| m.as_str()).unwrap_or("2026");
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
                                    if let Some(cap) = pc_msg_re.captures(t_line) {
                                        let sender = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                                        let time_str = cap.get(2).map(|m| m.as_str()).unwrap_or("");
                                        let body = cap.get(3).map(|m| m.as_str()).unwrap_or("");
                                        if !sender.is_empty()
                                            && sender != "회원님"
                                            && !participants.iter().any(|p| p == sender)
                                        {
                                            participants.push(sender.to_string());
                                        }
                                        parsed_kakao_items.push((
                                            current_date.clone(),
                                            time_str.to_string(),
                                            sender.to_string(),
                                            body.to_string(),
                                        ));
                                        continue;
                                    }
                                    if !t_line.contains("님과 카카오톡 대화")
                                        && !t_line.ends_with("카카오톡 대화")
                                        && !t_line.starts_with("저장한 날짜 :")
                                        && !t_line.contains("님이 들어왔습니다")
                                        && !t_line.contains("님이 나갔습니다")
                                    {
                                        if let Some(last_item) = parsed_kakao_items.last_mut() {
                                            last_item.3.push_str("<br/>");
                                            last_item.3.push_str(t_line);
                                        }
                                    }
                                }

                                if room_name.starts_with("KakaoTalk_Chats_")
                                    && !participants.is_empty()
                                {
                                    room_name = if participants.len() <= 4 {
                                        participants.join(", ")
                                    } else {
                                        format!(
                                            "{} 외 {}명",
                                            participants[..3].join(", "),
                                            participants.len() - 3
                                        )
                                    };
                                }

                                let mut messages_added = 0usize;
                                let mut overlapping_count = 0usize;
                                let mut kakao_md_lines: Vec<(String, String)> =
                                    Vec::with_capacity(parsed_kakao_items.len());

                                for (c_date, time_str, sender, body) in parsed_kakao_items {
                                    let dedup_raw = format!(
                                        "kakao|{}|{}|{}|{}|{}",
                                        room_name, c_date, time_str, sender, body
                                    );
                                    let dedup_key =
                                        blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                                    let affected = conn
                                        .execute(
                                            "INSERT OR IGNORE INTO lifelog_messages
                                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key)
                                             VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6)",
                                            params![
                                                room_name, sender, body, c_date, time_str,
                                                dedup_key
                                            ],
                                        )
                                        .unwrap_or(0);
                                    if affected > 0 {
                                        messages_added += 1;
                                    } else {
                                        overlapping_count += 1;
                                    }
                                    let md_line =
                                        format!("- **[{}] {}**: {}", time_str, sender, body);
                                    kakao_md_lines.push((c_date, md_line));
                                }

                                append_lines_to_mobile_md_batch(
                                    &conn,
                                    "kakao",
                                    &room_name,
                                    &format!("[카카오톡 대화내역] {}", room_name),
                                    "[\"카카오톡\", \"카톡\", \"단톡방\", \"대화내역\", \"채팅이력\", \"KakaoTalk\"]",
                                    &kakao_md_lines,
                                );

                                upsert_kakao_metadata_in_md(
                                    &conn,
                                    &room_name,
                                    &raw_folder_name,
                                    &participants,
                                    overlapping_count,
                                    messages_added,
                                    now_ms,
                                );
                                let kakao_md_path = get_archive_mobile_dir(&conn, "kakao")
                                    .join(format!("{}.md", sanitize_filename_stem(&room_name)));
                                if kakao_md_path.exists() {
                                    let _ = enrich_kakao_markdown_with_media(&conn, &kakao_md_path);
                                }

                                set_meta_i64_max(&conn, "last_kakao_ts", now_ms);
                                if !dev_id.is_empty() {
                                    let _ = conn.execute(
                                        "UPDATE paired_devices SET last_kakao_ts = MAX(COALESCE(last_kakao_ts, 0), ?1) WHERE device_id = ?2",
                                        params![now_ms, dev_id],
                                    );
                                }
                                if !file_hash.is_empty() {
                                    let now_str = chrono::Local::now()
                                        .format("%Y-%m-%d %H:%M:%S")
                                        .to_string();
                                    let _ = conn.execute(
                                        "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                         VALUES (?1, ?2, ?3)",
                                        params![file_hash, room_name, now_str],
                                    );
                                }

                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    "kakaotalk",
                                    folder_index,
                                    total_folders,
                                    overlapping_count,
                                    messages_added,
                                    Some(&format!(
                                        "[{}] 폴더 {}/{} 완료 ({}% · 신규 {}건, 기존중복 {}건)",
                                        room_name,
                                        folder_index,
                                        total_folders,
                                        ((folder_index as f64 / total_folders.max(1) as f64)
                                            * 100.0)
                                            .round() as usize,
                                        messages_added,
                                        overlapping_count
                                    )),
                                );
                            }
                            SyncWorkerJob::Contacts { dev_id, items } => {
                                let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
                                let mut max_ts = 0i64;
                                for (name, phones, org, memo, ts) in items {
                                    if ts > max_ts {
                                        max_ts = ts;
                                    }
                                    let phone_joined = phones.join(", ");
                                    let md_line = format!(
                                        "- **{}** | 전화: `{}`{}{}",
                                        name,
                                        phone_joined,
                                        if org.is_empty() {
                                            String::new()
                                        } else {
                                            format!(" | 소속: {}", org)
                                        },
                                        if memo.is_empty() {
                                            String::new()
                                        } else {
                                            format!(" | 메모: {}", memo)
                                        }
                                    );
                                    md_coalesced
                                        .entry((
                                            "contacts".to_string(),
                                            "연락처_주소록".to_string(),
                                            "[스마트폰 연락처/주소록] 통합 목록".to_string(),
                                            "[\"연락처\", \"주소록\", \"전화번호\", \"전화번호부\", \"지인\"]"
                                                .to_string(),
                                        ))
                                        .or_default()
                                        .push((today_str.clone(), md_line));
                                }
                                if max_ts > 0 {
                                    set_meta_i64_max(&conn, "last_contact_ts", max_ts);
                                    if !dev_id.is_empty() {
                                        let _ = conn.execute(
                                            "UPDATE paired_devices SET last_contact_ts = MAX(COALESCE(last_contact_ts, 0), ?1) WHERE device_id = ?2",
                                            params![max_ts, dev_id],
                                        );
                                    }
                                }
                            }
                            SyncWorkerJob::AppUsage { dev_id, items } => {
                                let mut max_ts = 0i64;
                                for (date_str, pkg, app_name, fg_ms, launch_count, last_used) in
                                    items
                                {
                                    if last_used > max_ts {
                                        max_ts = last_used;
                                    }
                                    let mins = fg_ms / 60_000;
                                    let secs = (fg_ms % 60_000) / 1000;
                                    let ym = if date_str.len() >= 7 {
                                        &date_str[..7]
                                    } else {
                                        "2026-10"
                                    };
                                    let md_line = format!(
                                        "- **{}** (`{}`): 사용시간 **{}분 {}초** (실행 {}회)",
                                        app_name, pkg, mins, secs, launch_count
                                    );
                                    md_coalesced
                                        .entry((
                                            "usage".to_string(),
                                            format!("{}_휴대폰사용량", ym),
                                            format!("[휴대폰 사용량/스크린타임] {}", ym),
                                            "[\"휴대폰사용량\", \"사용시간\", \"스크린타임\", \"앱사용시간\", \"디지털웰빙\"]"
                                                .to_string(),
                                        ))
                                        .or_default()
                                        .push((date_str, md_line));
                                }
                                if max_ts > 0 {
                                    set_meta_i64_max(&conn, "last_usage_ts", max_ts);
                                    if !dev_id.is_empty() {
                                        let _ = conn.execute(
                                            "UPDATE paired_devices SET last_usage_ts = MAX(COALESCE(last_usage_ts, 0), ?1) WHERE device_id = ?2",
                                            params![max_ts, dev_id],
                                        );
                                    }
                                }
                            }
                            SyncWorkerJob::CallRecording {
                                dev_id,
                                dev_name,
                                file_hash,
                                file_name,
                                mut contact_label,
                                transcript_text,
                                audio_bytes,
                                now_ms,
                            } => {
                                let contacts_map = load_mobile_contacts_map(&conn);
                                let file_stem = Path::new(&file_name)
                                    .file_stem()
                                    .map(|s| s.to_string_lossy().to_string())
                                    .unwrap_or_else(|| file_name.clone());
                                let (is_voice_memo, rec_source) = is_voice_memo_or_watch_recording(
                                    &file_name,
                                    &contact_label,
                                    &dev_name,
                                );

                                if is_voice_memo {
                                    let (_, parsed_src, rec_date, rec_time) =
                                        parse_voice_recording_filename_meta(&file_stem, &rec_source);
                                    let rec_dir = get_archive_mobile_dir(&conn, "recordings");
                                    let audio_dir = rec_dir.join("audio");
                                    let _ = fs::create_dir_all(&audio_dir);
                                    let audio_path = audio_dir.join(&file_name);
                                    let _ = fs::write(&audio_path, &audio_bytes);

                                    write_voice_recording_markdown(
                                        &conn,
                                        &file_name,
                                        &parsed_src,
                                        &rec_date,
                                        &rec_time,
                                        if transcript_text.is_empty() {
                                            None
                                        } else {
                                            Some(&transcript_text)
                                        },
                                        None,
                                    );
                                    upsert_single_recording_into_lifelog_db(
                                        &conn,
                                        true,
                                        &file_stem,
                                        &parsed_src,
                                        &rec_date,
                                        &rec_time,
                                        if transcript_text.is_empty() {
                                            None
                                        } else {
                                            Some(&transcript_text)
                                        },
                                        &dev_id,
                                        &dev_name,
                                    );
                                    let _ = emit_live_service_sync_progress(
                                        &app_handle,
                                        "recording",
                                        1,
                                        1,
                                        0,
                                        1,
                                        None,
                                    );
                                } else {
                                    let (parsed_contact, rec_date, rec_time) =
                                        parse_call_audio_filename_meta(&file_stem, &contacts_map);
                                    if contact_label.trim().is_empty() {
                                        contact_label = parsed_contact;
                                    } else {
                                        contact_label =
                                            extract_clean_contact_name(&contact_label, &contacts_map);
                                    }
                                    let calls_dir = get_archive_mobile_dir(&conn, "calls");
                                    let audio_dir = calls_dir.join("audio");
                                    let _ = fs::create_dir_all(&audio_dir);
                                    let audio_path = audio_dir.join(&file_name);
                                    let _ = fs::write(&audio_path, &audio_bytes);

                                    write_call_recording_markdown(
                                        &conn,
                                        &file_name,
                                        &contact_label,
                                        &rec_date,
                                        &rec_time,
                                        if transcript_text.is_empty() {
                                            None
                                        } else {
                                            Some(&transcript_text)
                                        },
                                        None,
                                    );
                                    upsert_single_recording_into_lifelog_db(
                                        &conn,
                                        false,
                                        &file_stem,
                                        &contact_label,
                                        &rec_date,
                                        &rec_time,
                                        if transcript_text.is_empty() {
                                            None
                                        } else {
                                            Some(&transcript_text)
                                        },
                                        &dev_id,
                                        &dev_name,
                                    );
                                    let _ = emit_live_service_sync_progress(
                                        &app_handle,
                                        "call",
                                        1,
                                        1,
                                        0,
                                        1,
                                        None,
                                    );
                                }

                                set_meta_i64_max(&conn, "last_recording_ts", now_ms);
                                if !dev_id.is_empty() {
                                    let _ = conn.execute(
                                        "UPDATE paired_devices SET last_recording_ts = MAX(COALESCE(last_recording_ts, 0), ?1) WHERE device_id = ?2",
                                        params![now_ms, dev_id],
                                    );
                                }
                                let now_str = chrono::Local::now()
                                    .format("%Y-%m-%d %H:%M:%S")
                                    .to_string();
                                let _ = conn.execute(
                                    "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                     VALUES (?1, ?2, ?3)",
                                    params![file_hash, file_name, now_str],
                                );
                                if transcript_text.is_empty() && !audio_bytes.is_empty() {
                                    need_transcript_trigger = true;
                                }
                            }
                            SyncWorkerJob::Media {
                                file_name,
                                source_type,
                                folder_name,
                                file_bytes,
                                taken_date,
                                taken_time,
                                media_uuid,
                                content_hash,
                            } => {
                                let data_base: String = conn
                                    .query_row(
                                        "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
                                        [],
                                        |r| r.get(0),
                                    )
                                    .unwrap_or_else(|_| {
                                        r"C:\Users\iseoh\OneDrive\iseohyunDocs".to_string()
                                    });
                                let inbox_dir = Path::new(&data_base).join("_MediaInbox");
                                let _ = fs::create_dir_all(&inbox_dir);
                                let target_path = inbox_dir.join(&file_name);
                                let _ = fs::write(&target_path, &file_bytes);

                                if !folder_name.is_empty() {
                                    let raw_kakao_folder = get_archive_mobile_dir(&conn, "kakao")
                                        .join(sanitize_filename_stem(&folder_name));
                                    let _ = fs::create_dir_all(&raw_kakao_folder);
                                    let _ =
                                        fs::write(raw_kakao_folder.join(&file_name), &file_bytes);
                                }
                                if !folder_name.is_empty()
                                    || source_type.to_lowercase().contains("kakao")
                                    || file_name.to_lowercase().starts_with("kakaotalk_")
                                    || file_name.len() >= 40
                                {
                                    let kakao_media_dir =
                                        get_archive_mobile_dir(&conn, "kakao").join("media");
                                    let _ = fs::create_dir_all(&kakao_media_dir);
                                    let _ =
                                        fs::write(kakao_media_dir.join(&file_name), &file_bytes);

                                    let (cur_idx, tot_cnt) = {
                                        let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| {
                                            Mutex::new(default_live_sync_progress())
                                        });
                                        if let Ok(guard) = mutex.lock() {
                                            guard
                                                .steps
                                                .iter()
                                                .find(|s| s.key == "kakaotalk")
                                                .map(|s| {
                                                    let cur = s.skipped_count + s.downloaded_count + 1;
                                                    let tot = s.total_count.max(cur + 1);
                                                    (cur, tot)
                                                })
                                                .unwrap_or((1, 2))
                                        } else {
                                            (1, 2)
                                        }
                                    };
                                    let _ = emit_live_service_sync_progress(
                                        &app_handle,
                                        "kakaotalk",
                                        cur_idx,
                                        tot_cnt,
                                        0,
                                        1,
                                        Some(&format!("카톡 미디어 다운로드 중: {}", file_name)),
                                    );
                                }
                                let _ = conn.execute(
                                    "INSERT OR REPLACE INTO media_inbox
                                     (uuid, file_name, full_path, taken_date, taken_time, file_size, content_hash, status)
                                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'inbox')",
                                    params![
                                        media_uuid,
                                        file_name,
                                        target_path.to_string_lossy().to_string(),
                                        taken_date,
                                        taken_time,
                                        file_bytes.len() as i64,
                                        content_hash
                                    ],
                                );
                                let now_str = chrono::Local::now()
                                    .format("%Y-%m-%d %H:%M:%S")
                                    .to_string();
                                let _ = conn.execute(
                                    "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                     VALUES (?1, ?2, ?3)",
                                    params![content_hash, file_name, now_str],
                                );
                            }
                            SyncWorkerJob::SamsungHealth {
                                dev_id,
                                dev_name,
                                raw_bytes,
                                now_ms,
                            } => {
                                let (added, skipped, _) = process_samsung_health_sync_payload(
                                    &conn, &dev_id, &dev_name, &raw_bytes, now_ms,
                                );
                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    "health",
                                    (added + skipped).max(1),
                                    (added + skipped).max(1),
                                    skipped,
                                    added,
                                    None,
                                );
                            }
                        }
                        if is_fg {
                            SYNC_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                        }
                    }

                    let _ = conn.execute_batch("COMMIT;");

                    // 큐에서 병합된 마크다운 라인들을 파일당 단 1회씩만 디스크에 기록
                    for ((sub, file_stem, doc_title, source_aliases), entries) in md_coalesced {
                        append_lines_to_mobile_md_batch(
                            &conn,
                            &sub,
                            &file_stem,
                            &doc_title,
                            &source_aliases,
                            &entries,
                        );
                    }

                    if need_transcript_trigger && is_auto_call_transcription_enabled(&conn) {
                        let db_bg = db_path.clone();
                        let app_bg = app_handle.clone();
                        thread::spawn(move || {
                            let _ = process_pending_call_transcriptions(
                                &db_bg,
                                Some(&app_bg),
                                false,
                            );
                        });
                    }
                } else {
                    for job in &batch {
                        if job.is_foreground_sync_job() {
                            SYNC_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                        }
                    }
                }

                // 백그라운드 메타데이터(AppUsage/Contacts)만 처리된 경우 진행률 상태나 배지를 건드리지 않음
                if !cycle_had_foreground_job {
                    continue;
                }

                // 연속 도착하는 동기화 패킷 사이에 추가 작업이 들어오는지 대기 (초기 요청 시 2800ms, 일반 패킷 간 1200ms)
                if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) == 0 {
                    let wait_ms = if waiting_for_initial_phone_burst {
                        2800
                    } else {
                        1200
                    };
                    match rx.recv_timeout(std::time::Duration::from_millis(wait_ms)) {
                        Ok(j) => {
                            if j.is_foreground_sync_job() {
                                waiting_for_initial_phone_burst = false;
                            }
                            next_first_job = Some(j);
                            continue;
                        }
                        Err(_) => {
                            if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) == 0 {
                                waiting_for_initial_phone_burst = false;
                                cycle_had_foreground_job = false;
                                complete_all_remaining_sync_steps(&app_handle, &db_path, false);
                                let _ = app_handle.emit(
                                    "mobile-sync-event",
                                    serde_json::json!({
                                        "type": "sync_cycle_complete",
                                        "message": "✅ 모바일 백그라운드 동기화 큐 처리가 모두 완료되었습니다."
                                    }),
                                );
                            }
                        }
                    }
                }
            }
        });
}

fn spawn_mobile_companion_http_server(
    app_handle: AppHandle,
    db_path: PathBuf,
    pending_cli_files: Arc<Mutex<Vec<String>>>,
) {
    thread::spawn(move || {
        // 서버 기동 즉시 로컬 네트워크(UDP 18444)에 PC 온라인 신호 브로드캐스트
        let _ = broadcast_udp_pc_online();

        if let Ok(server) = tiny_http::Server::http("0.0.0.0:18443") {
            let dist_dir = PathBuf::from(r"c:\git\myLore\dist");
            for request in server.incoming_requests() {
                let app_handle = app_handle.clone();
                let db_path = db_path.clone();
                let pending_cli_files = pending_cli_files.clone();
                let dist_dir = dist_dir.clone();

                // 다운로드/동기화 요청과 미디어·열람 요청이 서로 블로킹하지 않도록 요청별 독립 스레드에서 처리
                thread::spawn(move || {
                    let mut request = request;
                    if request.method() == &tiny_http::Method::Options {
                        respond_json(request, 200, serde_json::json!({ "ok": true }));
                        return;
                    }

                    let raw_url = request.url().to_string();
                    let url_path = raw_url.split('?').next().unwrap_or("/");

                    if url_path == "/api/v1/open-files" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        let paths: Vec<String> =
                            serde_json::from_str(&body_str).unwrap_or_default();

                        if !paths.is_empty() {
                            if let Ok(mut guard) = pending_cli_files.lock() {
                                for p in &paths {
                                    if !guard.contains(p) {
                                        guard.push(p.clone());
                                    }
                                }
                            }
                            let _ = app_handle.emit("cli-open-files", paths);
                        }

                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }

                        respond_json(request, 200, serde_json::json!({ "ok": true }));
                    } else if url_path == "/api/v1/status" || url_path == "/api/v1/sync/watermarks" {
                        let pc_name = std::env::var("COMPUTERNAME")
                            .unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
                        let mut body_str = String::new();
                        if request.method() == &tiny_http::Method::Post {
                            let _ = request.as_reader().read_to_string(&mut body_str);
                        }
                        let client_json: serde_json::Value = if !body_str.trim().is_empty() {
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}))
                        } else {
                            serde_json::json!({})
                        };

                        let (
                            mut last_kakao_ts,
                            mut last_sms_ts,
                            mut last_call_ts,
                            mut last_noti_ts,
                            mut last_recording_ts,
                            mut last_health_ts,
                            mut last_contact_ts,
                            mut last_usage_ts,
                        ) = (0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64);
                        let mut force_full_sync = false;
                        if let Ok(conn) = open_db(&db_path) {
                            if !check_request_token(&request, &conn) {
                                respond_json(
                                    request,
                                    401,
                                    serde_json::json!({ "ok": false, "status": "unauthorized", "error": "Invalid X-MyLore-Token" }),
                                );
                                return;
                            }
                            force_full_sync = get_meta_i64(&conn, "force_full_sync") == 1;
                            let (req_dev_id, _) =
                                resolve_request_device(&request, Some(&client_json), &conn);

                            if url_path == "/api/v1/sync/watermarks" {
                                if force_full_sync {
                                    let _ = conn.execute(
                                        "INSERT INTO mobile_sync_meta (key, value) VALUES ('force_full_sync', '0')
                                         ON CONFLICT(key) DO UPDATE SET value = '0'",
                                        [],
                                    );
                                } else if !INITIAL_SYNC_CHECKED
                                    .swap(true, std::sync::atomic::Ordering::Relaxed)
                                {
                                    // 서버 기동 후 첫 워터마크 핸드셰이크 시:
                                    // 폰은 이미 전송했다고 기억(watermark > 0)하지만 PC DB에는 해당 항목이 0건인 경우 자동 재동기화 유도
                                    let c_kakao = client_json
                                        .get("last_kakao_ts")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0);
                                    let c_sms = client_json
                                        .get("last_sms_ts")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0);
                                    let c_call = client_json
                                        .get("last_call_ts")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0);
                                    let c_noti = client_json
                                        .get("last_noti_ts")
                                        .and_then(|v| v.as_i64())
                                        .unwrap_or(0);

                                    let db_kakao_cnt: i64 = conn
                                        .query_row(
                                            "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'kakaotalk'",
                                            [],
                                            |r| r.get(0),
                                        )
                                        .unwrap_or(0);
                                    let db_sms_cnt: i64 = conn
                                        .query_row(
                                            "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'sms'",
                                            [],
                                            |r| r.get(0),
                                        )
                                        .unwrap_or(0);
                                    let db_call_cnt: i64 = conn
                                        .query_row(
                                            "SELECT COUNT(*) FROM lifelog_call_logs",
                                            [],
                                            |r| r.get(0),
                                        )
                                        .unwrap_or(0);
                                    let db_noti_cnt: i64 = conn
                                        .query_row(
                                            "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'notification'",
                                            [],
                                            |r| r.get(0),
                                        )
                                        .unwrap_or(0);

                                    if (c_kakao > 0 && db_kakao_cnt == 0)
                                        || (c_sms > 0 && db_sms_cnt == 0)
                                        || (c_call > 0 && db_call_cnt == 0)
                                        || (c_noti > 0 && db_noti_cnt == 0)
                                    {
                                        force_full_sync = true;
                                        reset_in_memory_sync_caches();
                                        enqueue_sync_worker_job(
                                            SyncWorkerJob::StartSyncInspection {
                                                reset_watermarks: false,
                                            },
                                        );
                                    }
                                }
                            }

                            if !force_full_sync {
                                let dev_ts: Option<(i64, i64, i64, i64, i64, i64, i64, i64)> =
                                    if !req_dev_id.is_empty() {
                                        conn.query_row(
                                            "SELECT COALESCE(last_kakao_ts, 0), COALESCE(last_sms_ts, 0), COALESCE(last_call_ts, 0),
                                                    COALESCE(last_noti_ts, 0), COALESCE(last_recording_ts, 0), COALESCE(last_health_ts, 0),
                                                    COALESCE(last_contact_ts, 0), COALESCE(last_usage_ts, 0)
                                             FROM paired_devices WHERE device_id = ?1 LIMIT 1",
                                            params![req_dev_id],
                                            |r| {
                                                Ok((
                                                    r.get(0)?,
                                                    r.get(1)?,
                                                    r.get(2)?,
                                                    r.get(3)?,
                                                    r.get(4)?,
                                                    r.get(5)?,
                                                    r.get(6)?,
                                                    r.get(7)?,
                                                ))
                                            },
                                        )
                                        .optional()
                                        .unwrap_or(None)
                                    } else {
                                        None
                                    };
                                last_kakao_ts = get_meta_i64(&conn, "last_kakao_ts").max(
                                    MEM_LAST_KAKAO_TS.load(std::sync::atomic::Ordering::Relaxed),
                                );
                                last_sms_ts = get_meta_i64(&conn, "last_sms_ts").max(
                                    MEM_LAST_SMS_TS.load(std::sync::atomic::Ordering::Relaxed),
                                );
                                last_call_ts = get_meta_i64(&conn, "last_call_ts").max(
                                    MEM_LAST_CALL_TS.load(std::sync::atomic::Ordering::Relaxed),
                                );
                                last_noti_ts = get_meta_i64(&conn, "last_noti_ts").max(
                                    MEM_LAST_NOTI_TS.load(std::sync::atomic::Ordering::Relaxed),
                                );
                                last_recording_ts = get_meta_i64(&conn, "last_recording_ts").max(
                                    MEM_LAST_RECORDING_TS
                                        .load(std::sync::atomic::Ordering::Relaxed),
                                );
                                last_health_ts = get_meta_i64(&conn, "last_health_ts").max(
                                    MEM_LAST_HEALTH_TS.load(std::sync::atomic::Ordering::Relaxed),
                                );
                                last_contact_ts = get_meta_i64(&conn, "last_contact_ts").max(
                                    MEM_LAST_CONTACT_TS.load(std::sync::atomic::Ordering::Relaxed),
                                );
                                last_usage_ts = get_meta_i64(&conn, "last_usage_ts").max(
                                    MEM_LAST_USAGE_TS.load(std::sync::atomic::Ordering::Relaxed),
                                );

                                if let Some((k, s, c, n, rec, h, ct, u)) = dev_ts {
                                    last_kakao_ts = last_kakao_ts.max(k);
                                    last_sms_ts = last_sms_ts.max(s);
                                    last_call_ts = last_call_ts.max(c);
                                    last_noti_ts = last_noti_ts.max(n);
                                    last_recording_ts = last_recording_ts.max(rec);
                                    last_health_ts = last_health_ts.max(h);
                                    last_contact_ts = last_contact_ts.max(ct);
                                    last_usage_ts = last_usage_ts.max(u);
                                }

                                update_atomic_max_i64(&MEM_LAST_KAKAO_TS, last_kakao_ts);
                                update_atomic_max_i64(&MEM_LAST_SMS_TS, last_sms_ts);
                                update_atomic_max_i64(&MEM_LAST_CALL_TS, last_call_ts);
                                update_atomic_max_i64(&MEM_LAST_NOTI_TS, last_noti_ts);
                                update_atomic_max_i64(&MEM_LAST_RECORDING_TS, last_recording_ts);
                                update_atomic_max_i64(&MEM_LAST_HEALTH_TS, last_health_ts);
                                update_atomic_max_i64(&MEM_LAST_CONTACT_TS, last_contact_ts);
                                update_atomic_max_i64(&MEM_LAST_USAGE_TS, last_usage_ts);
                            }
                        }
                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "status": "ok",
                                "pc_name": pc_name,
                                "version": "0.1.0",
                                "db_ready": db_path.exists(),
                                "force_full_sync": force_full_sync,
                                "last_kakao_ts": last_kakao_ts,
                                "last_sms_ts": last_sms_ts,
                                "last_call_ts": last_call_ts,
                                "last_noti_ts": last_noti_ts,
                                "last_recording_ts": last_recording_ts,
                                "last_health_ts": last_health_ts,
                                "last_contact_ts": last_contact_ts,
                                "last_usage_ts": last_usage_ts
                            }),
                        );
                    } else if url_path == "/api/v1/sync/batch-init" {
                        // 카톡(전달할 전체 폴더 수) 또는 알림(전달할 전체 메시지 수) 동기화 시작 전 총 개수 선발송 수신
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
                        let service = json_val
                            .get("service")
                            .and_then(|v| v.as_str())
                            .unwrap_or("kakaotalk");
                        let total_count = json_val
                            .get("total_count")
                            .or_else(|| json_val.get("total_folders"))
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as usize;

                        enqueue_sync_worker_job(SyncWorkerJob::BatchInit {
                            service: service.to_string(),
                            total_count,
                        });
                        let pct = emit_live_service_sync_progress(
                            &app_handle,
                            service,
                            0,
                            total_count.max(1),
                            0,
                            0,
                            Some(&format!("총 {}건 전송 준비 완료 (0%)", total_count)),
                        );

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "service": service,
                                "total_count": total_count,
                                "percent": pct
                            }),
                        );
                    } else if url_path == "/api/v1/pair/confirm" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));

                        let device_name = json_val
                            .get("device_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Android Device")
                            .to_string();
                        let model = json_val
                            .get("model")
                            .and_then(|v| v.as_str())
                            .unwrap_or("Unknown Model")
                            .to_string();

                        let hash_seed = format!("{}|{}", device_name, model);
                        let short_hash = &blake3::hash(hash_seed.as_bytes()).to_hex()[..10];
                        let device_id = format!("dev_{}", short_hash);
                        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

                        if let Ok(conn) = open_db(&db_path) {
                            if !check_request_token(&request, &conn) {
                                respond_json(
                                    request,
                                    401,
                                    serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                                );
                                return;
                            }
                            let _ = conn.execute(
                                "INSERT INTO paired_devices (device_id, device_name, model, paired_at, last_seen_at)
                                 VALUES (?1, ?2, ?3, ?4, ?4)
                                 ON CONFLICT(device_id) DO UPDATE SET
                                    device_name = excluded.device_name,
                                    model = excluded.model,
                                    last_seen_at = excluded.last_seen_at",
                                params![device_id, device_name, model, now_str],
                            );
                        }

                        let _ = app_handle.emit(
                            "mobile-sync-event",
                            serde_json::json!({
                                "type": "paired",
                                "message": format!("📱 모바일 기기 QR 페어링 완료: {} ({})", device_name, model)
                            }),
                        );

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "registered_device_id": device_id
                            }),
                        );
                    } else if url_path == "/api/v1/sync/check-hashes" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
                        let hashes: Vec<String> = json_val
                            .get("hashes")
                            .and_then(|v| v.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default();

                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }

                        let mut missing_hashes = Vec::new();
                        let mut db_candidates = Vec::new();
                        for h in hashes {
                            if is_hash_synced_in_memory(&h) {
                                continue;
                            }
                            db_candidates.push(h);
                        }

                        if !db_candidates.is_empty() {
                            if let Ok(conn) = open_db(&db_path) {
                                for h in db_candidates {
                                    let exists_in_sync: bool = conn
                                        .query_row(
                                            "SELECT 1 FROM synced_file_hashes WHERE file_hash = ?1 LIMIT 1",
                                            params![h],
                                            |_| Ok(true),
                                        )
                                        .unwrap_or(false);
                                    let exists_in_media: bool = conn
                                        .query_row(
                                            "SELECT 1 FROM media_inbox WHERE content_hash = ?1 LIMIT 1",
                                            params![h],
                                            |_| Ok(true),
                                        )
                                        .unwrap_or(false);
                                    if exists_in_sync || exists_in_media {
                                        mark_hash_synced_in_memory(&h);
                                    } else {
                                        missing_hashes.push(h);
                                    }
                                }
                            } else {
                                missing_hashes = db_candidates;
                            }
                        }

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "missing_hashes": missing_hashes
                            }),
                        );
                    } else if url_path == "/api/v1/sync/notifications" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
                        let empty_vec = Vec::new();
                        let items = json_val
                            .get("items")
                            .and_then(|v| v.as_array())
                            .unwrap_or(&empty_vec);
                        let total_count = json_val
                            .get("total_count")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as usize)
                            .unwrap_or_else(|| items.len().max(1));
                        let current_index = json_val
                            .get("current_index")
                            .and_then(|v| v.as_u64())
                            .map(|v| v as usize)
                            .unwrap_or(total_count);

                        let (dev_id, dev_name) =
                            extract_request_device_headers(&request, Some(&json_val));
                        let mut ack_ids = Vec::with_capacity(items.len());
                        let mut worker_items = Vec::with_capacity(items.len());
                        let mut max_ts = 0i64;

                        for item in items {
                            if let Some(id_val) = item.get("id") {
                                ack_ids.push(id_val.clone());
                            }
                            let pkg = item
                                .get("pkg")
                                .and_then(|v| v.as_str())
                                .unwrap_or("app")
                                .to_string();
                            let title = item
                                .get("title")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let text = item
                                .get("text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let ts = item.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
                            if ts > max_ts {
                                max_ts = ts;
                            }
                            worker_items.push((pkg, title, text, ts));
                        }
                        if max_ts > 0 {
                            update_atomic_max_i64(&MEM_LAST_NOTI_TS, max_ts);
                        }

                        if !worker_items.is_empty() {
                            enqueue_sync_worker_job(SyncWorkerJob::Notifications {
                                dev_id,
                                dev_name,
                                items: worker_items,
                                current_index,
                                total_count,
                            });
                        }

                        let pct = ((current_index as f64 / total_count.max(1) as f64) * 100.0)
                            .round()
                            .clamp(0.0, 100.0) as usize;
                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "ack_ids": ack_ids,
                                "finance_parsed": 0,
                                "current_index": current_index,
                                "total_count": total_count,
                                "percent": pct,
                                "last_noti_ts": max_ts
                            }),
                        );
                    } else if url_path == "/api/v1/sync/sms" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
                        let empty_vec = Vec::new();
                        let items = json_val
                            .get("items")
                            .and_then(|v| v.as_array())
                            .unwrap_or(&empty_vec);

                        let (dev_id, dev_name) =
                            extract_request_device_headers(&request, Some(&json_val));
                        let mut ack_ids = Vec::with_capacity(items.len());
                        let mut worker_items = Vec::with_capacity(items.len());
                        let mut max_ts = 0i64;

                        for item in items {
                            if let Some(id_val) = item.get("id") {
                                ack_ids.push(id_val.clone());
                            }
                            let address = item
                                .get("address")
                                .and_then(|v| v.as_str())
                                .unwrap_or("알수없음")
                                .to_string();
                            let raw_body = item.get("body").and_then(|v| v.as_str()).unwrap_or("");
                            let clean_body = clean_mms_and_multiline_body(raw_body);
                            let sms_type = item
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("inbox")
                                .to_string();
                            let ts = item.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
                            if ts > max_ts {
                                max_ts = ts;
                            }
                            worker_items.push((address, clean_body, sms_type, ts));
                        }
                        if max_ts > 0 {
                            update_atomic_max_i64(&MEM_LAST_SMS_TS, max_ts);
                        }

                        if !worker_items.is_empty() {
                            enqueue_sync_worker_job(SyncWorkerJob::Sms {
                                dev_id,
                                dev_name,
                                items: worker_items,
                            });
                        }

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "ack_ids": ack_ids,
                                "finance_parsed": 0,
                                "last_sms_ts": max_ts
                            }),
                        );
                    } else if url_path == "/api/v1/sync/call-logs" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
                        let empty_vec = Vec::new();
                        let items = json_val
                            .get("items")
                            .and_then(|v| v.as_array())
                            .unwrap_or(&empty_vec);

                        let (dev_id, dev_name) =
                            extract_request_device_headers(&request, Some(&json_val));
                        let mut ack_ids = Vec::with_capacity(items.len());
                        let mut worker_items = Vec::with_capacity(items.len());
                        let mut max_ts = 0i64;

                        for item in items {
                            if let Some(id_val) = item.get("id") {
                                ack_ids.push(id_val.clone());
                            }
                            let number = item
                                .get("number")
                                .and_then(|v| v.as_str())
                                .unwrap_or("번호없음")
                                .to_string();
                            let name = item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let call_type = item
                                .get("call_type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("incoming")
                                .to_string();
                            let duration_sec = item
                                .get("duration_sec")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            let ts = item.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
                            if ts > max_ts {
                                max_ts = ts;
                            }
                            worker_items.push((number, name, call_type, duration_sec, ts));
                        }
                        if max_ts > 0 {
                            update_atomic_max_i64(&MEM_LAST_CALL_TS, max_ts);
                        }

                        let item_len = worker_items.len();
                        if !worker_items.is_empty() {
                            enqueue_sync_worker_job(SyncWorkerJob::CallLogs {
                                dev_id,
                                dev_name,
                                items: worker_items,
                            });
                        }

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "ack_ids": ack_ids,
                                "inserted_count": item_len,
                                "last_call_ts": max_ts
                            }),
                        );
                    } else if url_path == "/api/v1/sync/kakao-chats" {
                        let mut raw_bytes = Vec::new();
                        let _ = request.as_reader().read_to_end(&mut raw_bytes);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let body_str = String::from_utf8_lossy(&raw_bytes).to_string();

                        let mut room_name = "카카오톡 대화방".to_string();
                        let mut raw_folder_name = String::new();
                        let mut raw_text = String::new();
                        let mut file_hash = String::new();
                        let mut folder_index = 1usize;
                        let mut total_folders = 1usize;

                        let trimmed = body_str.trim();
                        if trimmed.starts_with('{') {
                            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                                if let Some(fnm) = json_val.get("folder_name").and_then(|v| v.as_str()) {
                                    raw_folder_name = fnm.trim().to_string();
                                }
                                if let Some(rn) = json_val
                                    .get("room_name")
                                    .or_else(|| json_val.get("folder_name"))
                                    .and_then(|v| v.as_str())
                                {
                                    room_name = rn.to_string();
                                }
                                if let Some(rt) = json_val.get("raw_text").and_then(|v| v.as_str()) {
                                    raw_text = rt.to_string();
                                }
                                if let Some(fh) = json_val.get("file_hash").and_then(|v| v.as_str()) {
                                    file_hash = fh.to_string();
                                }
                                if let Some(fi) = json_val.get("folder_index").and_then(|v| v.as_u64()) {
                                    folder_index = (fi as usize).max(1);
                                }
                                if let Some(tf) = json_val.get("total_folders").and_then(|v| v.as_u64()) {
                                    total_folders = (tf as usize).max(1);
                                }
                            }
                        } else {
                            let (parsed_folder, parsed_hash, clean_txt, fi, tf) =
                                parse_multipart_kakao_payload(&body_str);
                            folder_index = fi;
                            total_folders = tf;
                            if !parsed_folder.is_empty() {
                                raw_folder_name = parsed_folder.clone();
                                room_name = parsed_folder;
                            }
                            if !parsed_hash.is_empty() {
                                file_hash = parsed_hash;
                            }
                            for line in clean_txt.lines() {
                                let t = line.trim().trim_start_matches('\u{feff}');
                                if t.contains("님과 카카오톡 대화") {
                                    room_name = t
                                        .replace("님과 카카오톡 대화", "")
                                        .trim()
                                        .to_string();
                                    break;
                                } else if t.ends_with("카카오톡 대화") {
                                    let cand = t.trim_end_matches("카카오톡 대화").trim();
                                    if !cand.is_empty() {
                                        room_name = cand.to_string();
                                        break;
                                    }
                                }
                            }
                            raw_text = clean_txt;
                        }

                        if file_hash.is_empty() && !raw_text.is_empty() {
                            file_hash = blake3::hash(raw_text.as_bytes()).to_hex().to_string();
                        }
                        if !file_hash.is_empty() {
                            mark_hash_synced_in_memory(&file_hash);
                        }

                        let now_ms = chrono::Local::now().timestamp_millis();
                        update_atomic_max_i64(&MEM_LAST_KAKAO_TS, now_ms);
                        let (dev_id, _) = extract_request_device_headers(&request, None);

                        enqueue_sync_worker_job(SyncWorkerJob::KakaoChat {
                            dev_id,
                            room_name: room_name.clone(),
                            raw_folder_name: raw_folder_name.clone(),
                            raw_text,
                            file_hash,
                            folder_index,
                            total_folders,
                            now_ms,
                        });

                        let pct = ((folder_index as f64 / total_folders.max(1) as f64) * 100.0)
                            .round()
                            .clamp(0.0, 100.0) as usize;
                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "room_name": room_name,
                                "folder_name": raw_folder_name,
                                "folder_index": folder_index,
                                "total_folders": total_folders,
                                "percent": pct,
                                "messages_added": 0,
                                "overlapping_count": 0,
                                "last_kakao_ts": now_ms,
                                "verified_for_cleanup": true
                            }),
                        );
                    } else if url_path == "/api/v1/sync/contacts" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
                        let empty_vec = Vec::new();
                        let items = json_val
                            .get("items")
                            .and_then(|v| v.as_array())
                            .unwrap_or(&empty_vec);

                        let (dev_id, _) =
                            extract_request_device_headers(&request, Some(&json_val));
                        let mut worker_items = Vec::with_capacity(items.len());
                        let mut max_ts = 0i64;

                        for item in items {
                            let name = item
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("이름없음")
                                .to_string();
                            let phones: Vec<String> = item
                                .get("phones")
                                .and_then(|v| v.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                        .collect()
                                })
                                .unwrap_or_default();
                            let org = item
                                .get("organization")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let memo = item
                                .get("memo")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let ts = item
                                .get("updated_ts")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            if ts > max_ts {
                                max_ts = ts;
                            }
                            worker_items.push((name, phones, org, memo, ts));
                        }
                        if max_ts > 0 {
                            update_atomic_max_i64(&MEM_LAST_CONTACT_TS, max_ts);
                        }

                        let upserted_count = worker_items.len();
                        if !worker_items.is_empty() {
                            enqueue_sync_worker_job(SyncWorkerJob::Contacts {
                                dev_id,
                                items: worker_items,
                            });
                        }

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "upserted_count": upserted_count,
                                "last_contact_ts": max_ts
                            }),
                        );
                    } else if url_path == "/api/v1/sync/app-usage" {
                        let mut body_str = String::new();
                        let _ = request.as_reader().read_to_string(&mut body_str);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let json_val: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
                        let empty_vec = Vec::new();
                        let items = json_val
                            .get("items")
                            .and_then(|v| v.as_array())
                            .unwrap_or(&empty_vec);

                        let (dev_id, _) =
                            extract_request_device_headers(&request, Some(&json_val));
                        let mut worker_items = Vec::with_capacity(items.len());
                        let mut max_ts = 0i64;

                        for item in items {
                            let date_str = item
                                .get("date")
                                .and_then(|v| v.as_str())
                                .unwrap_or("2026-10-30")
                                .to_string();
                            let pkg = item
                                .get("pkg")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let app_name = item
                                .get("app_name")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&pkg)
                                .to_string();
                            let fg_ms = item
                                .get("total_foreground_ms")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            let launch_count = item
                                .get("launch_count")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            let last_used = item
                                .get("last_time_used")
                                .and_then(|v| v.as_i64())
                                .unwrap_or(0);
                            if last_used > max_ts {
                                max_ts = last_used;
                            }
                            worker_items.push((date_str, pkg, app_name, fg_ms, launch_count, last_used));
                        }
                        if max_ts > 0 {
                            update_atomic_max_i64(&MEM_LAST_USAGE_TS, max_ts);
                        }

                        let recorded_count = worker_items.len();
                        if !worker_items.is_empty() {
                            let payload_digest =
                                blake3::hash(body_str.as_bytes()).to_hex().to_string();
                            let now_ms = chrono::Local::now().timestamp_millis();
                            let should_enqueue = {
                                let mutex = LAST_APP_USAGE_DIGEST
                                    .get_or_init(|| Mutex::new((String::new(), 0)));
                                if let Ok(mut guard) = mutex.lock() {
                                    if guard.0 != payload_digest || (now_ms - guard.1) >= 60_000 {
                                        *guard = (payload_digest, now_ms);
                                        true
                                    } else {
                                        false
                                    }
                                } else {
                                    true
                                }
                            };
                            if should_enqueue {
                                enqueue_sync_worker_job(SyncWorkerJob::AppUsage {
                                    dev_id,
                                    items: worker_items,
                                });
                            }
                        }

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "recorded_count": recorded_count,
                                "last_usage_ts": max_ts
                            }),
                        );
                    } else if url_path == "/api/v1/sync/call-recordings" {
                        let mut raw_bytes = Vec::new();
                        let _ = request.as_reader().read_to_end(&mut raw_bytes);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let mut file_hash = blake3::hash(&raw_bytes).to_hex().to_string();
                        let mut file_name = format!(
                            "CallRec_{}.m4a",
                            chrono::Local::now().format("%Y%m%d_%H%M%S")
                        );
                        let mut contact_label = String::new();
                        let mut transcript_text = String::new();
                        let mut audio_bytes: Vec<u8> = Vec::new();

                        if raw_bytes.first() == Some(&b'{') {
                            if let Ok(jv) = serde_json::from_slice::<serde_json::Value>(&raw_bytes) {
                                if let Some(fh) = jv.get("file_hash").and_then(|v| v.as_str()) {
                                    file_hash = fh.to_string();
                                }
                                if let Some(fn_s) = jv.get("file_name").and_then(|v| v.as_str()) {
                                    file_name = fn_s.to_string();
                                }
                                if let Some(cl) = jv.get("contact_name").and_then(|v| v.as_str()) {
                                    if !cl.is_empty() && !cl.starts_with("--") {
                                        contact_label = cl.to_string();
                                    }
                                }
                                if let Some(b64) = jv.get("base64_data").and_then(|v| v.as_str()) {
                                    audio_bytes = base64_decode(b64);
                                }
                                if let Some(tr) = jv.get("transcript").and_then(|v| v.as_str()) {
                                    transcript_text = tr.to_string();
                                }
                            }
                        } else {
                            let header_str = String::from_utf8_lossy(
                                &raw_bytes[..std::cmp::min(raw_bytes.len(), 4096)],
                            );
                            if let Ok(re_fh) =
                                Regex::new(r#"name="file_hash"[\s\S]*?\r?\n\r?\n([0-9a-fA-F]{32,128})"#)
                            {
                                if let Some(cap) = re_fh.captures(&header_str) {
                                    if let Some(m) = cap.get(1) {
                                        file_hash = m.as_str().trim().to_string();
                                    }
                                }
                            }
                            if let Ok(re_cn) =
                                Regex::new(r#"name="contact_name"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#)
                            {
                                if let Some(cap) = re_cn.captures(&header_str) {
                                    if let Some(m) = cap.get(1) {
                                        let cname = m.as_str().trim();
                                        if !cname.is_empty() && !cname.starts_with("--") {
                                            contact_label = cname.to_string();
                                        }
                                    }
                                }
                            }
                            let fn_re = Regex::new(r#"filename="([^"]+)""#).unwrap();
                            if let Some(cap) = fn_re.captures(&header_str) {
                                if let Some(m) = cap.get(1) {
                                    file_name = m.as_str().to_string();
                                }
                            }
                            let (clean_b, _) = strip_multipart_prefix_if_present(&raw_bytes);
                            audio_bytes = clean_b;
                        }

                        if !file_hash.is_empty() {
                            mark_hash_synced_in_memory(&file_hash);
                        }
                        let now_ms = chrono::Local::now().timestamp_millis();
                        update_atomic_max_i64(&MEM_LAST_RECORDING_TS, now_ms);
                        let (dev_id, dev_name) = extract_request_device_headers(&request, None);
                        let has_transcript = !transcript_text.is_empty();

                        enqueue_sync_worker_job(SyncWorkerJob::CallRecording {
                            dev_id,
                            dev_name,
                            file_hash: file_hash.clone(),
                            file_name,
                            contact_label,
                            transcript_text,
                            audio_bytes,
                            now_ms,
                        });

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "file_hash": file_hash,
                                "last_recording_ts": now_ms,
                                "transcript_generated": has_transcript
                            }),
                        );
                    } else if url_path == "/api/v1/sync/media" {
                        let mut raw_bytes = Vec::new();
                        let _ = request.as_reader().read_to_end(&mut raw_bytes);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }

                        let mut file_name = format!(
                            "QuickCam_{}.jpg",
                            chrono::Local::now().format("%Y%m%d_%H%M%S")
                        );
                        let mut source_type = String::new();
                        let mut folder_name = String::new();
                        let mut file_bytes: Vec<u8> = Vec::new();
                        let mut taken_date = chrono::Local::now().format("%Y-%m-%d").to_string();
                        let mut taken_time = chrono::Local::now().format("%H:%M:%S").to_string();

                        if raw_bytes.first() == Some(&b'{') {
                            if let Ok(json_val) = serde_json::from_slice::<serde_json::Value>(&raw_bytes)
                            {
                                if let Some(fn_str) =
                                    json_val.get("file_name").and_then(|v| v.as_str())
                                {
                                    if !fn_str.trim().is_empty() {
                                        file_name = fn_str.trim().to_string();
                                    }
                                }
                                if let Some(st_str) =
                                    json_val.get("source_type").and_then(|v| v.as_str())
                                {
                                    source_type = st_str.trim().to_string();
                                }
                                if let Some(fd_str) =
                                    json_val.get("folder_name").and_then(|v| v.as_str())
                                {
                                    folder_name = fd_str.trim().to_string();
                                }
                                if let Some(b64) =
                                    json_val.get("base64_data").and_then(|v| v.as_str())
                                {
                                    file_bytes = base64_decode(b64);
                                }
                                if let Some(ta) = json_val.get("taken_at").and_then(|v| v.as_str()) {
                                    if ta.len() >= 10 {
                                        taken_date = ta[..10].to_string();
                                    }
                                    if ta.len() >= 19 {
                                        taken_time = ta[11..19].to_string();
                                    }
                                }
                            }
                        } else {
                            let header_part = String::from_utf8_lossy(
                                &raw_bytes[..std::cmp::min(raw_bytes.len(), 4096)],
                            );
                            let fn_re = Regex::new(r#"filename="([^"]+)""#).unwrap();
                            if let Some(cap) = fn_re.captures(&header_part) {
                                if let Some(m) = cap.get(1) {
                                    file_name = m.as_str().to_string();
                                }
                            }
                            if let Ok(re_st) =
                                Regex::new(r#"name="source_type"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#)
                            {
                                if let Some(cap) = re_st.captures(&header_part) {
                                    if let Some(m) = cap.get(1) {
                                        source_type = m.as_str().trim().to_string();
                                    }
                                }
                            }
                            if let Ok(re_fd) =
                                Regex::new(r#"name="folder_name"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#)
                            {
                                if let Some(cap) = re_fd.captures(&header_part) {
                                    if let Some(m) = cap.get(1) {
                                        folder_name = m.as_str().trim().to_string();
                                    }
                                }
                            }
                            let (clean_b, _) = strip_multipart_prefix_if_present(&raw_bytes);
                            file_bytes = clean_b;
                        }

                        let media_uuid = Uuid::new_v4().to_string();
                        let content_hash = blake3::hash(&file_bytes).to_hex().to_string();
                        mark_hash_synced_in_memory(&content_hash);

                        enqueue_sync_worker_job(SyncWorkerJob::Media {
                            file_name,
                            source_type,
                            folder_name,
                            file_bytes,
                            taken_date,
                            taken_time,
                            media_uuid: media_uuid.clone(),
                            content_hash,
                        });

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "uuid": media_uuid,
                                "uri": format!("mylore://media/{}", media_uuid)
                            }),
                        );
                    } else if url_path == "/api/v1/sync/samsung-health" {
                        // 삼성 헬스 및 갤럭시 워치 GPS 운동 데이터 동기화 엔드포인트 (백그라운드 워커 큐 적재)
                        let mut raw_bytes = Vec::new();
                        let _ = request.as_reader().read_to_end(&mut raw_bytes);
                        if !check_request_token_fast(&request, &db_path) {
                            respond_json(
                                request,
                                401,
                                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
                            );
                            return;
                        }
                        let now_ms = chrono::Local::now().timestamp_millis();
                        update_atomic_max_i64(&MEM_LAST_HEALTH_TS, now_ms);
                        let (dev_id, dev_name) = extract_request_device_headers(&request, None);

                        enqueue_sync_worker_job(SyncWorkerJob::SamsungHealth {
                            dev_id,
                            dev_name,
                            raw_bytes,
                            now_ms,
                        });

                        respond_json(
                            request,
                            200,
                            serde_json::json!({
                                "ok": true,
                                "queued": true,
                                "last_health_ts": now_ms
                            }),
                        );
                    } else if url_path == "/api/v1/local-media" {
                        // 로컬 미디어 파일(카톡 사진/동영상, 통화녹음/음성녹음 m4a 등)을 WebView `<img/>`, `<video/>`, `<audio/>`에 서빙
                        let query = raw_url.splitn(2, '?').nth(1).unwrap_or("");
                        let mut req_file = String::new();
                        let mut req_sub = String::new();
                        for pair in query.split('&') {
                            let mut kv = pair.splitn(2, '=');
                            let k = kv.next().unwrap_or("");
                            let v = kv.next().unwrap_or("");
                            if k == "file" {
                                req_file = url_decode_utf8(v);
                            } else if k == "sub" {
                                req_sub = url_decode_utf8(v);
                            }
                        }

                        let clean_name = req_file
                            .trim()
                            .trim_start_matches("audio/")
                            .trim_start_matches("media/")
                            .trim_matches(|c| c == '[' || c == ']' || c == '<' || c == '>')
                            .to_string();

                        let mut found_path: Option<PathBuf> = None;
                        if let Ok(conn) = open_db(&db_path) {
                            let data_base: String = conn
                                .query_row(
                                    "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
                                    [],
                                    |r| r.get(0),
                                )
                                .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\iseohyunDocs".to_string());
                            let base_p = Path::new(&data_base);
                            let mut candidates = Vec::new();
                            if !req_sub.is_empty() {
                                candidates.push(base_p.join("mobile").join(&req_sub).join(&clean_name));
                            }
                            candidates.push(base_p.join("mobile").join("calls").join("audio").join(&clean_name));
                            candidates.push(base_p.join("mobile").join("recordings").join("audio").join(&clean_name));
                            candidates.push(base_p.join("mobile").join("kakao").join("media").join(&clean_name));
                            candidates.push(base_p.join("mobile").join("kakao").join(&clean_name));
                            candidates.push(base_p.join("_MediaInbox").join(&clean_name));

                            // `mobile/kakao/{folder_name}/` 하위 폴더에 그대로 적재된 이미지/동영상도 탐색
                            let kakao_root = base_p.join("mobile").join("kakao");
                            if let Ok(entries) = fs::read_dir(&kakao_root) {
                                for entry in entries.flatten() {
                                    let p = entry.path();
                                    if p.is_dir() {
                                        candidates.push(p.join(&clean_name));
                                    }
                                }
                            }

                            for c in candidates {
                                if c.exists() && c.is_file() {
                                    found_path = Some(c);
                                    break;
                                }
                            }
                        }

                        if let Some(fp) = found_path {
                            if let Ok(mut bytes) = fs::read(&fp) {
                                let (clean_b, repaired) = strip_multipart_prefix_if_present(&bytes);
                                if repaired {
                                    let _ = fs::write(&fp, &clean_b);
                                    bytes = clean_b;
                                }
                                let lower = fp.to_string_lossy().to_lowercase();
                                let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
                                    "image/jpeg"
                                } else if lower.ends_with(".png") {
                                    "image/png"
                                } else if lower.ends_with(".gif") {
                                    "image/gif"
                                } else if lower.ends_with(".webp") {
                                    "image/webp"
                                } else if lower.ends_with(".bmp") {
                                    "image/bmp"
                                } else if lower.ends_with(".mp4") || lower.ends_with(".m4v") {
                                    "video/mp4"
                                } else if lower.ends_with(".mov") {
                                    "video/quicktime"
                                } else if lower.ends_with(".webm") {
                                    "video/webm"
                                } else if lower.ends_with(".m4a") {
                                    "audio/mp4"
                                } else if lower.ends_with(".mp3") {
                                    "audio/mpeg"
                                } else if lower.ends_with(".amr") {
                                    "audio/amr"
                                } else if lower.ends_with(".wav") {
                                    "audio/wav"
                                } else if lower.ends_with(".ogg") {
                                    "audio/ogg"
                                } else {
                                    "application/octet-stream"
                                };
                                let total_len = bytes.len();
                                let range_header = request
                                    .headers()
                                    .iter()
                                    .find(|h| h.field.equiv("Range"))
                                    .map(|h| h.value.as_str().to_string());

                                let h_ct = tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap();
                                let h_cors = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
                                let h_ar = tiny_http::Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap();

                                if let Some(rh) = range_header {
                                    if let Some(spec) = rh.strip_prefix("bytes=") {
                                        let parts: Vec<&str> = spec.split('-').collect();
                                        if !parts.is_empty() && total_len > 0 {
                                            let start = parts[0].trim().parse::<usize>().unwrap_or(0).min(total_len.saturating_sub(1));
                                            let end = if parts.len() > 1 && !parts[1].trim().is_empty() {
                                                parts[1].trim().parse::<usize>().unwrap_or(total_len.saturating_sub(1)).min(total_len.saturating_sub(1))
                                            } else {
                                                total_len.saturating_sub(1)
                                            };
                                            if start <= end && end < total_len {
                                                let slice = bytes[start..=end].to_vec();
                                                let cr_val = format!("bytes {}-{}/{}", start, end, total_len);
                                                let h_cr = tiny_http::Header::from_bytes(&b"Content-Range"[..], cr_val.as_bytes()).unwrap();
                                                let _ = request.respond(
                                                    tiny_http::Response::from_data(slice)
                                                        .with_status_code(206)
                                                        .with_header(h_ct)
                                                        .with_header(h_cors)
                                                        .with_header(h_ar)
                                                        .with_header(h_cr),
                                                );
                                                return;
                                            }
                                        }
                                    }
                                }

                                let _ = request.respond(
                                    tiny_http::Response::from_data(bytes)
                                        .with_header(h_ct)
                                        .with_header(h_cors)
                                        .with_header(h_ar),
                                );
                                return;
                            }
                        }

                        respond_json(
                            request,
                            404,
                            serde_json::json!({ "ok": false, "error": "Media file not found locally" }),
                        );
                    } else {
                        // Chrome App Mode (`chrome.exe --app=http://127.0.0.1:18443`) 요청 시 dist/ 정적 파일 서빙
                        let clean_path = url_path.trim_start_matches('/');
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
                                return;
                            }
                        }
                        respond_json(request, 200, serde_json::json!({ "ok": true }));
                    }
                });
            }
        }
    });
}

fn url_decode_utf8(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let raw = input.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' && i + 2 < raw.len() {
            if let Ok(hex_str) = std::str::from_utf8(&raw[i + 1..i + 3]) {
                if let Ok(b) = u8::from_str_radix(hex_str, 16) {
                    bytes.push(b);
                    i += 3;
                    continue;
                }
            }
        } else if raw[i] == b'+' {
            bytes.push(b' ');
            i += 1;
            continue;
        }
        bytes.push(raw[i]);
        i += 1;
    }
    String::from_utf8_lossy(&bytes).to_string()
}

const _FRONTEND_DIST_INDEX_SYNC: &str = include_str!("../../dist/index.html");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_paths = extract_cli_md_paths();
    // 이미 실행 중인 myLore 인스턴스가 있으면 해당 창으로 파일 경로를 전달하고 포커스한 뒤 즉시 종료 (단일 인스턴스)
    if try_forward_to_existing_instance(&cli_paths) {
        return;
    }

    // 1번 Projects 볼트(C:\Users\iseoh\OneDrive\Projects\.myLore) 안에 메타 DB 및 템플릿을 통합 관리
    let projects_vault_mylore = PathBuf::from(r"C:\Users\iseoh\OneDrive\Projects\.myLore");
    let _ = fs::create_dir_all(&projects_vault_mylore);
    let vault_db_path = projects_vault_mylore.join("mylore_meta.db");
    let legacy_db_path = PathBuf::from(r"c:\git\myLore\.mylore\mylore_meta.db");
    if !vault_db_path.exists() && legacy_db_path.exists() {
        let _ = fs::copy(&legacy_db_path, &vault_db_path);
    }
    let db_path = vault_db_path;
    if let Ok(conn) = open_db(&db_path) {
        let setting_path = resolve_projects_setting_json_path(&conn);
        if !setting_path.exists() {
            let mut def = MyLoreAppSettings::default();
            def.settings_file_path = setting_path.to_string_lossy().to_string();
            if let Ok(json_str) = serde_json::to_string_pretty(&def) {
                let _ = fs::write(&setting_path, json_str);
            }
        }
    }

    let pending_cli_files = Arc::new(Mutex::new(cli_paths));
    let db_path_for_server = db_path.clone();
    let db_path_for_retry = db_path.clone();
    let pending_for_server = pending_cli_files.clone();

    tauri::Builder::default()
        .manage(AppState {
            db_path,
            lock: Arc::new(Mutex::new(())),
            scan_progress: Arc::new(Mutex::new(ScanProgressPayload::default())),
            pending_cli_files,
            trash_history: Arc::new(Mutex::new(Vec::new())),
            detached_preview: Arc::new(Mutex::new(DetachedPreviewState::default())),
        })
        .setup(move |app| {
            spawn_mobile_sync_worker_thread(
                app.handle().clone(),
                db_path_for_server.clone(),
            );
            spawn_mobile_companion_http_server(
                app.handle().clone(),
                db_path_for_server.clone(),
                pending_for_server.clone(),
            );
            spawn_call_transcript_retry_worker(
                app.handle().clone(),
                db_path_for_retry.clone(),
            );
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
            import_kakao_chat_text,
            take_pending_cli_files,
            trash_document,
            restore_trashed_document,
            get_app_settings,
            save_app_settings,
            sync_detached_preview_scroll,
            toggle_detached_preview_window,
            emit_detached_preview_action,
            sync_detached_preview_state,
            get_detached_preview_state,
            get_mobile_pairing_info,
            update_mobile_pairing_config,
            remove_paired_mobile_device,
            trigger_full_mobile_resync,
            send_mobile_udp_wake_broadcast,
            trigger_sequential_mobile_sync,
            get_mobile_sync_progress_state,
            get_all_lifelog_messages,
            get_mobile_contacts_map,
            open_lifelog_item_document,
            retry_pending_call_transcriptions,
            get_gemini_api_key_status,
            set_auto_call_transcription,
            get_call_recording_play_info,
            transcribe_single_call_item,
            save_and_verify_gemini_api_key,
            transcribe_local_audio_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
