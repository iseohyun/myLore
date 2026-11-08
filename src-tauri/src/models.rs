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
    #[serde(default)]
    pub transcript_stage: u8,
    #[serde(default)]
    pub transcript_requirement: Option<String>,
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
    pub include_location: Option<bool>,
    pub description_mode: Option<String>,
    pub transparency: Option<String>,
    pub visibility: Option<String>,
    pub attendee_email: Option<String>,
    pub attendee_response_status: Option<String>,
    pub event_status: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarSyncStatus {
    pub is_connected: bool,
    pub client_id: String,
    pub default_calendar_id: String,
    pub last_sync_at: String,
    pub last_error: String,
    pub storage_location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarSyncResult {
    pub uploaded_count: usize,
    pub downloaded_count: usize,
    pub updated_count: usize,
    pub skipped_count: usize,
    pub needs_auth: bool,
    pub message: String,
    pub last_sync_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallAiDailyStat {
    pub date: String,
    pub label: String,
    pub count: usize,
    pub gemini_count: usize,
    pub claude_count: usize,
    pub openai_count: usize,
    pub grok_count: usize,
    #[serde(default)]
    pub total_bytes: u64,
    #[serde(default)]
    pub gemini_bytes: u64,
    #[serde(default)]
    pub claude_bytes: u64,
    #[serde(default)]
    pub openai_bytes: u64,
    #[serde(default)]
    pub grok_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallAiTranscriptionStats {
    pub total_audio_calls: usize,
    pub completed_calls: usize,
    pub remaining_calls: usize,
    #[serde(default)]
    pub total_call_records: usize,
    #[serde(default)]
    pub downloaded_calls: usize,
    #[serde(default)]
    pub asr_converted_calls: usize,
    #[serde(default)]
    pub ai_postprocessed_calls: usize,
    #[serde(default)]
    pub pending_approval_calls: usize,
    #[serde(default)]
    pub verified_calls: usize,
    #[serde(default)]
    pub total_audio_bytes: u64,
    #[serde(default)]
    pub completed_audio_bytes: u64,
    #[serde(default)]
    pub remaining_audio_bytes: u64,
    pub daily_stats: Vec<CallAiDailyStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderConfigStatus {
    pub provider: String,
    pub display_name: String,
    pub has_key: bool,
    pub masked_key: String,
    pub model_name: String,
    pub verified_at: String,
    pub today_used_tokens: i64,
    pub total_used_tokens: i64,
    pub today_request_count: i64,
    pub last_error: String,
    pub retry_after_at: Option<String>,
    #[serde(default)]
    pub charged_credit_usd: f64,
    #[serde(default)]
    pub spent_credit_usd: f64,
    #[serde(default)]
    pub remaining_credit_usd: f64,
    #[serde(default)]
    pub credit_display_text: String,
    #[serde(default)]
    pub credit_exhausted: bool,
    #[serde(default)]
    pub has_admin_key: bool,
    #[serde(default)]
    pub masked_admin_key: String,
    #[serde(default)]
    pub team_id: String,
    #[serde(default)]
    pub balance_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiLlmProvidersStatus {
    pub active_text_provider: String,
    pub storage_location: String,
    pub claude: LlmProviderConfigStatus,
    pub openai: LlmProviderConfigStatus,
    pub grok: LlmProviderConfigStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOriginRegistryItem {
    pub origin_hash: String,
    pub origin_file_name: String,
    pub origin_file_size: u64,
    pub device_name: String,
    pub taken_date: String,
    pub taken_time: String,
    pub current_status: String,
    pub current_path: String,
    pub current_hash: String,
    pub history_note: String,
    pub first_synced_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOriginRegistrySummary {
    pub total_origin_count: usize,
    pub original_kept_count: usize,
    pub edited_or_renamed_count: usize,
    pub deleted_blocked_count: usize,
    pub items: Vec<MediaOriginRegistryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationMovementLogItem {
    pub id: i64,
    pub device_id: String,
    pub device_name: String,
    pub event_type: String,
    pub place_label: String,
    pub wifi_ssid: String,
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy_m: f64,
    pub battery_pct: i32,
    pub log_date: String,
    pub log_time: String,
    pub timestamp_ms: i64,
    pub naver_map_url: String,
    pub google_map_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationMovementSummary {
    pub total_logs: usize,
    pub wifi_logs_count: usize,
    pub gps_logs_count: usize,
    pub distinct_places: Vec<String>,
    pub logs: Vec<LocationMovementLogItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallApprovalItem {
    pub safe_stem: String,
    pub file_stem: String,
    pub file_name: String,
    pub contact_name: String,
    pub rec_date: String,
    pub rec_time: String,
    pub stage: u8,
    pub llm_provider: String,
    pub user_requirement: String,
    pub summary_text: String,
    pub script_markdown: String,
    pub md_path: String,
    pub audio_path: String,
    pub is_voice_memo: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueueAgentSlotStatus {
    pub provider: String,
    pub display_name: String,
    pub is_usable: bool,
    pub status_label: String,
    pub credit_or_quota_text: String,
    pub today_request_count: i64,
    pub today_used_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueuePendingItem {
    pub queue_order: usize,
    pub safe_stem: String,
    pub file_name: String,
    pub contact_name: String,
    pub rec_date: String,
    pub rec_time: String,
    pub file_bytes: u64,
    pub stage: u8,
    pub is_voice_memo: bool,
    pub has_existing_script: bool,
    pub user_requirement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueueRecentCompletedItem {
    pub timestamp: String,
    pub provider: String,
    pub safe_stem: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiQueueDashboardPayload {
    pub worker_running: bool,
    pub worker_pid: u32,
    pub worker_heartbeat_at: String,
    pub lock_file_path: String,
    pub auto_transcription_enabled: bool,
    pub unlocked_agent_count: usize,
    pub total_pending_count: usize,
    pub total_pending_bytes: u64,
    pub stage1_pending_count: usize,
    pub stage3_revision_count: usize,
    pub completed_today_count: usize,
    pub agent_slots: Vec<AiQueueAgentSlotStatus>,
    pub pending_items: Vec<AiQueuePendingItem>,
    pub recent_completed: Vec<AiQueueRecentCompletedItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KakaoUpdateRequestItem {
    pub room_name: String,
    pub pending_noti_count: usize,
    pub last_sender: String,
    pub last_message_preview: String,
    pub last_noti_date: String,
    pub last_noti_time: String,
    pub last_noti_ts: i64,
    pub last_synced_date: String,
    pub md_path: String,
    pub updated_at: String,
    #[serde(default)]
    pub kakao_groups: Vec<String>,
    #[serde(default)]
    pub candidate_rooms_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPersonDocInfo {
    pub contact_name: String,
    pub phones: Vec<String>,
    pub md_path: String,
    pub doc_uuid: String,
    pub profile_text: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPromptSlotInfo {
    pub slot: String,
    pub version: i64,
    pub prompt_title: String,
    pub prompt_text: String,
    pub win_count: i64,
    pub loss_count: i64,
    pub consecutive_losses: i64,
    pub last_evolution_reason: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPromptHistoryItem {
    pub id: i64,
    pub replaced_slot: String,
    pub old_version: i64,
    pub new_version: i64,
    pub winner_slot: String,
    pub trigger_type: String,
    pub evolution_summary: String,
    pub old_prompt_text: String,
    pub new_prompt_text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactProfileApprovalItem {
    pub id: i64,
    pub contact_name: String,
    pub md_path: String,
    pub doc_uuid: String,
    pub source_type: String,
    pub source_ref: String,
    pub event_summary: String,
    pub original_profile_text: String,
    pub prompt_a_version: i64,
    pub prompt_b_version: i64,
    pub candidate_a_text: String,
    pub candidate_b_text: String,
    pub llm_provider: String,
    pub status: String,
    pub chosen_slot: String,
    pub user_edited: bool,
    pub final_profile_text: String,
    pub evolution_note: String,
    pub created_at: String,
    pub resolved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPromptTournamentStatus {
    pub slot_a: ContactPromptSlotInfo,
    pub slot_b: ContactPromptSlotInfo,
    pub recent_history: Vec<ContactPromptHistoryItem>,
    pub pending_approval_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintSampleMeta {
    pub phrase_text: String,
    pub source_label: String,
    pub duration_sec: f64,
    pub sim_a: f64,
    pub sim_b: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintProfileItem {
    pub profile_id: String,
    pub target_type: String,
    pub display_name: String,
    pub source_mode: String,
    pub model_a_name: String,
    pub model_b_name: String,
    pub dim_a: usize,
    pub dim_b: usize,
    pub norm_a: f64,
    pub norm_b: f64,
    pub embedding_a: Vec<f64>,
    pub embedding_b: Vec<f64>,
    pub sample_count: usize,
    pub consistency_a: f64,
    pub consistency_b: f64,
    pub cross_agreement_score: f64,
    pub samples_meta: Vec<VoiceprintSampleMeta>,
    pub raw_json_text: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAudioCandidateItem {
    pub file_name: String,
    pub full_path: String,
    pub category: String,
    pub contact_or_source: String,
    pub rec_date: String,
    pub rec_time: String,
    pub file_bytes: u64,
    pub transcript_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintDashboardPayload {
    pub engine_ready: bool,
    pub python_path: String,
    pub ffmpeg_ready: bool,
    pub model_a_path: String,
    pub model_b_path: String,
    pub model_a_ready: bool,
    pub model_b_ready: bool,
    pub sync_enroll_url: String,
    pub server_profile: VoiceprintProfileItem,
    pub sync_profile: VoiceprintProfileItem,
    pub combined_profile: VoiceprintProfileItem,
    pub server_vs_sync_sim_a: f64,
    pub server_vs_sync_sim_b: f64,
    pub server_vs_sync_cross_score: f64,
    pub sync_audio_candidates: Vec<SyncAudioCandidateItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintSegmentTestItem {
    pub index: usize,
    pub start_sec: f64,
    pub end_sec: f64,
    pub sim_a_server: f64,
    pub sim_b_server: f64,
    pub sim_a_sync: f64,
    pub sim_b_sync: f64,
    pub combined_score: f64,
    pub cross_agreed: bool,
    pub predicted_speaker: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintTestResult {
    pub target_label: String,
    pub duration_sec: f64,
    pub whole_sim_a_server: f64,
    pub whole_sim_b_server: f64,
    pub whole_sim_a_sync: f64,
    pub whole_sim_b_sync: f64,
    pub cross_consensus_score: f64,
    pub cross_verified_is_me: bool,
    pub verdict_summary: String,
    pub segments: Vec<VoiceprintSegmentTestItem>,
}




