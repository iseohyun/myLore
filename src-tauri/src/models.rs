//! 프론트엔드와 주고받는 공용 직렬화 모델(DTO) 모음.

use crate::*;

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
    #[serde(default)]
    pub ssid: String,
    #[serde(default)]
    pub wifi_auth: String,
    #[serde(default)]
    pub has_wifi_password: bool,
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
