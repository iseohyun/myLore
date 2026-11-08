//! 앱 설정(`setting.json`) 모델, 기본값 및 조회/저장 커맨드.

use crate::*;

pub(crate) fn default_f11_viewer_mode() -> String {
    "detached".to_string()
}

pub(crate) fn default_auto_save() -> bool {
    true
}

pub(crate) fn default_editor_view_mode() -> String {
    "split".to_string()
}

pub(crate) fn default_file_open_pane() -> String {
    "left".to_string()
}

pub(crate) fn default_link_open_pane() -> String {
    "unfocused".to_string()
}

pub(crate) fn default_activity_bar_open() -> bool {
    true
}

pub(crate) fn default_activity_bar_hidden_items() -> Vec<String> {
    Vec::new()
}

pub(crate) fn default_activity_bar_top_order() -> Vec<String> {
    vec![
        "approval".to_string(),
        "projects".to_string(),
        "call".to_string(),
        "sms".to_string(),
        "kakaotalk".to_string(),
        "recording".to_string(),
        "media".to_string(),
        "contacts".to_string(),
        "pc_log".to_string(),
        "notification".to_string(),
        "health".to_string(),
        "location".to_string(),
        "finance".to_string(),
        "diary".to_string(),
    ]
}

pub(crate) fn default_activity_bar_bottom_order() -> Vec<String> {
    vec![
        "settings".to_string(),
        "login".to_string(),
        "help".to_string(),
    ]
}

pub(crate) fn default_scroll_sync() -> bool {
    true
}

pub(crate) fn default_tab_indent_spaces() -> u32 {
    2
}

pub(crate) fn default_base_font_family() -> String {
    "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif".to_string()
}

pub(crate) fn default_heading_font_family() -> String {
    "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif".to_string()
}

pub(crate) fn default_table_font_family() -> String {
    "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif".to_string()
}

pub(crate) fn default_base_font_size() -> u32 {
    14
}

pub(crate) fn default_heading_scale() -> f64 {
    1.0
}

pub(crate) fn default_table_font_size() -> u32 {
    13
}

pub(crate) fn default_theme_preset() -> String {
    "dark_indigo".to_string()
}

pub(crate) fn default_bg_primary() -> String {
    "#0f1117".to_string()
}

pub(crate) fn default_bg_secondary() -> String {
    "#161922".to_string()
}

pub(crate) fn default_text_primary() -> String {
    "#f1f5f9".to_string()
}

pub(crate) fn default_text_secondary() -> String {
    "#94a3b8".to_string()
}

pub(crate) fn default_heading_color() -> String {
    "#a5b4fc".to_string()
}

pub(crate) fn default_accent_primary() -> String {
    "#6366f1".to_string()
}

pub(crate) fn default_table_header_bg() -> String {
    "#1e2230".to_string()
}

pub(crate) fn default_table_header_color() -> String {
    "#a5b4fc".to_string()
}

pub(crate) fn default_border_color() -> String {
    "#2b3040".to_string()
}

pub(crate) fn default_failed_call_text_color() -> String {
    "#b91c1c".to_string()
}

pub(crate) fn default_lifelog_time_format() -> String {
    "MM-DD(ddd) hh:mm".to_string()
}

pub(crate) fn default_call_playback_speed() -> f64 {
    1.75
}

pub(crate) fn default_auto_call_transcription() -> bool {
    true
}

pub(crate) fn default_log_retention_comm_days() -> u32 {
    7
}

pub(crate) fn default_log_retention_version_days() -> u32 {
    30
}

pub(crate) fn default_log_retention_system_days() -> u32 {
    30
}

pub(crate) fn default_log_retention_ai_days() -> u32 {
    30
}

/// OS 환경변수(`MYLORE_USER_NAME`, `MYLORE_USER_SURNAME`, `MYLORE_USER_GIVEN_NAME`)를 우선 조회하여
/// `(전체 이름, 성, 이름)` 튜플을 반환합니다. 기본값은 `("정서현", "정", "서현")`입니다.
pub(crate) fn resolve_user_identity() -> (String, String, String) {
    let raw_full = std::env::var("MYLORE_USER_NAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "정서현".to_string());

    let chars: Vec<char> = raw_full.chars().collect();
    let default_surname = if !chars.is_empty() {
        chars[0].to_string()
    } else {
        "정".to_string()
    };
    let default_given = if chars.len() > 1 {
        chars[1..].iter().collect::<String>()
    } else {
        "서현".to_string()
    };

    let surname = std::env::var("MYLORE_USER_SURNAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(default_surname);

    let given_name = std::env::var("MYLORE_USER_GIVEN_NAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(default_given);

    (raw_full, surname, given_name)
}

pub(crate) fn apply_user_identity_placeholders(template: &str) -> String {
    let (full_name, surname, given_name) = resolve_user_identity();
    template
        .replace("{USER_NAME}", &full_name)
        .replace("{USER_SURNAME}", &surname)
        .replace("{USER_GIVEN_NAME}", &given_name)
}

pub(crate) fn default_ai_user_profile() -> String {
    let (full_name, surname, given_name) = resolve_user_identity();
    format!(
        "이름: {} (성: {}, 이름: {}), 출생년도: 1983, 거주지: 거제, 출생지: 서울, 취미: 수영",
        full_name, surname, given_name
    )
}

pub(crate) fn default_call_analysis_prompt() -> String {
    let raw = "Analyze this smartphone call recording and output the transcript in Korean using strictly the 2 Markdown sections below (`## 💡 요약`, `## 📜 스크립트`).\n\
Speaker Labels: User = `나` (본인: {USER_NAME}, 성: {USER_SURNAME}, 이름: {USER_GIVEN_NAME}), Counterpart = `{contact_name}` (상대방: 순수 이름만 표시, 전화번호/날짜 제외).\n\n\
## 💡 요약\n\
- (Summarize the call purpose, key agreements, schedule/location/amount in 1~3 concise Korean bullet points)\n\n\
## 📜 스크립트\n\
- **[00:00:00] 나**: (실제 발화 내용 — 문장 단위로 분리)\n\
- **[00:00:01] {contact_name}**: (실제 발화 내용 — 문장 단위로 분리)\n\n\
[CRITICAL GUARDRAILS: SPEAKER CONFUSION & SENTENCE-LEVEL TIMESTAMPS (화자혼동 방지 및 문장 단위 타임스탬프 부여)]\n\
1. Pre-Investigate User Voiceprint & Counterpart Contact Profile (내 목소리 지문 및 연락처 사전조사):\n\
   - Cross-reference the attached User Dual-Model Voiceprint (`내 목소리 지문`: 3D-Speaker CAM++ 192D & WeSpeaker ResNet34-LM 256D for `나/{USER_NAME}`) and Counterpart Contact Info (`{contact_name}`'s 호칭/소속 모임/관계 배경지식). Notice that the counterpart's voiceprint (`contact_{contact_name}`) and event log will be updated from this analysis.\n\
2. Prevent Error #1 — Speaker Confusion (화자혼동 방지):\n\
   - Strictly distinguish `나` ({USER_NAME}) from `{contact_name}` (상대방). Never flip speakers mid-call after short backchannels ('네', '예'). Verify who addresses whom ('고객님', '선생님', '삼촌', '형', '{USER_SURNAME}쌤') and who states the user's personal information.\n\
3. Prevent Error #2 — Time-Tag Mismatch & Sentence-Level Splitting (타임태그 불일치 방지 및 문장 단위 분할):\n\
   - Format all timestamps strictly as `[HH:MM:SS]` (Hours:Minutes:Seconds, e.g., 1 min 14 sec = `[00:01:14]`, NEVER `[01:14:00]`).\n\
   - (Rule 3A — Duration Cap): The script's final timestamp MUST NEVER exceed the physical audio recording duration (음성녹음보다 스크립트의 시간이 더 긴 경우 절대 금지).\n\
   - (Rule 3B — Sentence-Level Timestamps): Split long turns into individual sentences as finely as possible (`최대한 문장 단위로 잘라서 타임스탬프 부여`) and assign each sentence its true speaking start time so clicking any sentence in the player seeks accurately to that exact moment.";
    apply_user_identity_placeholders(raw)
}

pub(crate) fn default_ai_daily_token_limit() -> i64 {
    1_000_000
}

pub(crate) fn default_status_bar_show() -> bool {
    true
}

pub(crate) fn default_topic_folder_docs() -> String {
    detect_default_docs_root_dir().to_string_lossy().to_string()
}

pub(crate) fn default_topic_folder_projects() -> String {
    "Projects".to_string()
}

pub(crate) fn default_topic_folder_diary() -> String {
    "Diary".to_string()
}

pub(crate) fn default_topic_folder_mobile() -> String {
    "Mobile".to_string()
}

pub(crate) fn default_topic_folder_git() -> String {
    detect_default_git_root_dir().to_string_lossy().to_string()
}

pub(crate) fn default_topic_folder_picture() -> String {
    detect_default_picture_root_dir().to_string_lossy().to_string()
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
    /// "left" | "focused" | "right"
    #[serde(default = "default_file_open_pane")]
    pub default_file_open_pane: String,
    /// "left" | "right" | "focused" | "unfocused"
    #[serde(default = "default_link_open_pane")]
    pub link_open_pane: String,
    #[serde(default = "default_activity_bar_open")]
    pub default_activity_bar_open: bool,
    #[serde(default = "default_activity_bar_hidden_items")]
    pub activity_bar_hidden_items: Vec<String>,
    #[serde(default = "default_activity_bar_top_order")]
    pub activity_bar_top_order: Vec<String>,
    #[serde(default = "default_activity_bar_bottom_order")]
    pub activity_bar_bottom_order: Vec<String>,
    #[serde(default)]
    pub default_menu_bar_expanded: bool,
    #[serde(default = "default_scroll_sync")]
    pub scroll_sync_enabled: bool,
    #[serde(default = "default_tab_indent_spaces")]
    pub tab_indent_spaces: u32,
    #[serde(default = "default_auto_call_transcription")]
    pub auto_call_transcription: bool,
    #[serde(default = "default_ai_user_profile")]
    pub ai_user_profile: String,
    #[serde(default = "default_call_analysis_prompt")]
    pub call_analysis_prompt: String,
    #[serde(default = "default_ai_daily_token_limit")]
    pub ai_daily_token_limit: i64,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_ai: bool,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_gemini: bool,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_claude: bool,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_openai: bool,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_grok: bool,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_trash: bool,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_auto_save: bool,
    #[serde(default = "default_status_bar_show")]
    pub status_bar_show_port: bool,
    #[serde(default = "default_log_retention_comm_days")]
    pub log_retention_comm_days: u32,
    #[serde(default = "default_log_retention_version_days", alias = "logRetentionSyncDays")]
    pub log_retention_version_days: u32,
    #[serde(default = "default_log_retention_system_days")]
    pub log_retention_system_days: u32,
    #[serde(default = "default_log_retention_ai_days", alias = "logRetentionGeminiDays")]
    pub log_retention_ai_days: u32,
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
    #[serde(default = "default_failed_call_text_color")]
    pub failed_call_text_color: String,
    #[serde(default = "default_lifelog_time_format")]
    pub lifelog_time_format: String,
    #[serde(default = "default_call_playback_speed")]
    pub call_playback_speed: f64,
    #[serde(default = "default_topic_folder_docs")]
    pub topic_folder_docs: String,
    #[serde(default = "default_topic_folder_projects")]
    pub topic_folder_projects: String,
    #[serde(default = "default_topic_folder_diary")]
    pub topic_folder_diary: String,
    #[serde(default = "default_topic_folder_mobile")]
    pub topic_folder_mobile: String,
    #[serde(default = "default_topic_folder_git")]
    pub topic_folder_git: String,
    #[serde(default = "default_topic_folder_picture")]
    pub topic_folder_picture: String,
    #[serde(default)]
    pub settings_file_path: String,
}

impl Default for MyLoreAppSettings {
    fn default() -> Self {
        Self {
            f11_viewer_mode: default_f11_viewer_mode(),
            auto_save_enabled: default_auto_save(),
            default_editor_view_mode: default_editor_view_mode(),
            default_file_open_pane: default_file_open_pane(),
            link_open_pane: default_link_open_pane(),
            default_activity_bar_open: default_activity_bar_open(),
            activity_bar_hidden_items: default_activity_bar_hidden_items(),
            activity_bar_top_order: default_activity_bar_top_order(),
            activity_bar_bottom_order: default_activity_bar_bottom_order(),
            default_menu_bar_expanded: false,
            scroll_sync_enabled: default_scroll_sync(),
            tab_indent_spaces: default_tab_indent_spaces(),
            auto_call_transcription: default_auto_call_transcription(),
            ai_user_profile: default_ai_user_profile(),
            call_analysis_prompt: default_call_analysis_prompt(),
            ai_daily_token_limit: default_ai_daily_token_limit(),
            status_bar_show_ai: default_status_bar_show(),
            status_bar_show_gemini: default_status_bar_show(),
            status_bar_show_claude: default_status_bar_show(),
            status_bar_show_openai: default_status_bar_show(),
            status_bar_show_grok: default_status_bar_show(),
            status_bar_show_trash: default_status_bar_show(),
            status_bar_show_auto_save: default_status_bar_show(),
            status_bar_show_port: default_status_bar_show(),
            log_retention_comm_days: default_log_retention_comm_days(),
            log_retention_version_days: default_log_retention_version_days(),
            log_retention_system_days: default_log_retention_system_days(),
            log_retention_ai_days: default_log_retention_ai_days(),
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
            failed_call_text_color: default_failed_call_text_color(),
            lifelog_time_format: default_lifelog_time_format(),
            call_playback_speed: default_call_playback_speed(),
            topic_folder_docs: default_topic_folder_docs(),
            topic_folder_projects: default_topic_folder_projects(),
            topic_folder_diary: default_topic_folder_diary(),
            topic_folder_mobile: default_topic_folder_mobile(),
            topic_folder_git: default_topic_folder_git(),
            topic_folder_picture: default_topic_folder_picture(),
            settings_file_path: default_projects_base_dir()
                .join(".myLore")
                .join("setting.json")
                .to_string_lossy()
                .to_string(),
        }
    }
}

pub(crate) fn resolve_projects_setting_json_path(conn: &Connection) -> PathBuf {
    let projects_base: String = projects_base_path_string(&conn);
    let mylore_dir = Path::new(&projects_base).join(".myLore");
    let _ = fs::create_dir_all(&mylore_dir);
    mylore_dir.join("setting.json")
}

pub(crate) fn read_topic_folder_mobile(conn: &Connection) -> String {
    let setting_path = resolve_projects_setting_json_path(conn);
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                let trimmed = parsed.topic_folder_mobile.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
        }
    }
    default_topic_folder_mobile()
}

pub(crate) fn fill_missing_topic_folders_from_db(
    conn: &Connection,
    settings: &mut MyLoreAppSettings,
) {
    let db_docs: Option<String> = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    if settings.topic_folder_docs.trim().is_empty() {
        settings.topic_folder_docs = db_docs.unwrap_or_else(default_topic_folder_docs);
    }
    if settings.topic_folder_projects.trim().is_empty() {
        settings.topic_folder_projects = default_topic_folder_projects();
    }
    if settings.topic_folder_diary.trim().is_empty() {
        settings.topic_folder_diary = default_topic_folder_diary();
    }
    if settings.topic_folder_mobile.trim().is_empty() {
        settings.topic_folder_mobile = default_topic_folder_mobile();
    }
    if settings.topic_folder_git.trim().is_empty() {
        let db_git: Option<String> = conn
            .query_row(
                "SELECT path FROM base_folders WHERE role = 'git' AND enabled = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        settings.topic_folder_git = db_git.unwrap_or_else(default_topic_folder_git);
    }
    if settings.topic_folder_picture.trim().is_empty() {
        let db_pic: Option<String> = conn
            .query_row(
                "SELECT path FROM base_folders WHERE role = 'picture' AND enabled = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        settings.topic_folder_picture = db_pic.unwrap_or_else(default_topic_folder_picture);
    }
}

/// 주제별 기본 폴더 설정(`topic_folder_*`)을 `base_folders` 테이블과 동기화합니다.
pub(crate) fn sync_topic_folders_to_base_folders(
    conn: &Connection,
    settings: &MyLoreAppSettings,
) {
    let docs_str = if settings.topic_folder_docs.trim().is_empty() {
        default_topic_folder_docs()
    } else {
        settings.topic_folder_docs.trim().to_string()
    };
    let docs_root = PathBuf::from(&docs_str);
    let projects_path =
        resolve_topic_sub_or_abs_path(&docs_root, &settings.topic_folder_projects, "Projects");
    let diary_path =
        resolve_topic_sub_or_abs_path(&docs_root, &settings.topic_folder_diary, "Diary");
    let mobile_path =
        resolve_topic_sub_or_abs_path(&docs_root, &settings.topic_folder_mobile, "Mobile");
    let git_str = if settings.topic_folder_git.trim().is_empty() {
        default_topic_folder_git()
    } else {
        settings.topic_folder_git.trim().to_string()
    };
    let pic_str = if settings.topic_folder_picture.trim().is_empty() {
        default_topic_folder_picture()
    } else {
        settings.topic_folder_picture.trim().to_string()
    };

    let _ = fs::create_dir_all(&docs_root);
    let _ = fs::create_dir_all(&projects_path);
    let _ = fs::create_dir_all(&diary_path);
    let _ = fs::create_dir_all(&mobile_path);

    let role_items = [
        (
            "base-projects-1",
            "projects",
            projects_path.to_string_lossy().to_string(),
            "프로젝트 (Docs/Projects)",
            "폴더별 main.md 기반 프로젝트 관리 볼트",
        ),
        (
            "base-diary-1",
            "diary",
            diary_path.to_string_lossy().to_string(),
            "일기 (Docs/Diary)",
            "매일의 작업/일상 기록 및 구글 캘린더 1:1 동기화 폴더",
        ),
        (
            "base-data-1",
            "data",
            docs_root.to_string_lossy().to_string(),
            "Docs (통합 문서 · 아카이브)",
            "Docs 통합 문서 루트 및 Mobile 라이프로그 아카이브",
        ),
        (
            "base-git-1",
            "git",
            git_str,
            "Git (개발 프로젝트)",
            "개발 프로젝트 참고용 코드/문서 폴더 (UUID 미주입)",
        ),
        (
            "base-picture-1",
            "picture",
            pic_str,
            "Picture (사진첩)",
            "내 장치들의 사진/영상 및 과거 사진 통합 저장소",
        ),
    ];

    for (default_id, role, path_val, label, purpose) in role_items {
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM base_folders WHERE role = ?1 ORDER BY enabled DESC LIMIT 1",
                params![role],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        if let Some(eid) = existing_id {
            let _ = conn.execute(
                "UPDATE base_folders SET path = ?1, label = ?2, purpose = ?3, enabled = 1 WHERE id = ?4",
                params![path_val, label, purpose, eid],
            );
        } else if matches!(role, "data" | "git" | "picture") {
            let _ = conn.execute(
                "INSERT INTO base_folders (id, role, path, label, purpose, enabled) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![default_id, role, path_val, label, purpose],
            );
        }
    }

    invalidate_cached_data_base_path();
    repair_moved_files_table_paths(conn);
}

pub(crate) fn read_ai_daily_token_limit(conn_opt: Option<&Connection>) -> i64 {
    let setting_path = if let Some(conn) = conn_opt {
        resolve_projects_setting_json_path(conn)
    } else if let Ok(conn) = open_db(&meta_db_path()) {
        resolve_projects_setting_json_path(&conn)
    } else {
        detect_default_docs_root_dir()
            .join("Projects")
            .join(".myLore")
            .join("setting.json")
    };
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                if parsed.ai_daily_token_limit > 0 {
                    return parsed.ai_daily_token_limit;
                }
            }
        }
    }
    default_ai_daily_token_limit()
}

pub(crate) fn read_ai_user_profile(conn: &Connection) -> String {
    let (full_name, _, _) = resolve_user_identity();
    let setting_path = resolve_projects_setting_json_path(conn);
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                let trimmed = parsed.ai_user_profile.trim().to_string();
                if !trimmed.is_empty() {
                    return apply_user_identity_placeholders(&trimmed).replace("이서현", &full_name);
                }
            }
        }
    }
    default_ai_user_profile()
}

pub(crate) fn read_call_analysis_prompt(conn: &Connection) -> String {
    let setting_path = resolve_projects_setting_json_path(conn);
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                let trimmed = parsed.call_analysis_prompt.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
        }
    }
    default_call_analysis_prompt()
}

#[tauri::command]
pub(crate) fn get_app_settings(state: State<AppState>) -> Result<MyLoreAppSettings, String> {
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
                if !matches!(parsed.default_file_open_pane.as_str(), "left" | "focused" | "right") {
                    parsed.default_file_open_pane = default_file_open_pane();
                }
                if !matches!(parsed.link_open_pane.as_str(), "left" | "right" | "focused" | "unfocused") {
                    parsed.link_open_pane = default_link_open_pane();
                }
                if parsed.ai_user_profile.trim().is_empty() {
                    parsed.ai_user_profile = default_ai_user_profile();
                }
                if parsed.call_analysis_prompt.trim().is_empty() {
                    parsed.call_analysis_prompt = default_call_analysis_prompt();
                }
                if parsed.ai_daily_token_limit <= 0 {
                    parsed.ai_daily_token_limit = default_ai_daily_token_limit();
                }
                if parsed.call_playback_speed <= 0.25 || parsed.call_playback_speed > 4.0 {
                    parsed.call_playback_speed = default_call_playback_speed();
                }
                fill_missing_topic_folders_from_db(&conn, &mut parsed);
                parsed.settings_file_path = path_str;
                return Ok(parsed);
            }
        }
    }

    let mut default_settings = MyLoreAppSettings::default();
    fill_missing_topic_folders_from_db(&conn, &mut default_settings);
    default_settings.settings_file_path = path_str;
    if let Ok(json_str) = serde_json::to_string_pretty(&default_settings) {
        let _ = fs::write(&setting_path, json_str);
    }
    Ok(default_settings)
}

#[tauri::command]
pub(crate) fn save_app_settings(
    app: AppHandle,
    state: State<AppState>,
    settings: MyLoreAppSettings,
) -> Result<MyLoreAppSettings, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let clean_f11 = if settings.f11_viewer_mode == "split" {
        "split".to_string()
    } else {
        "detached".to_string()
    };
    let clean_default_view = match settings.default_editor_view_mode.as_str() {
        "editor" | "split" | "preview" => settings.default_editor_view_mode.clone(),
        _ => "split".to_string(),
    };
    let clean_file_open_pane = match settings.default_file_open_pane.as_str() {
        "left" | "focused" | "right" => settings.default_file_open_pane.clone(),
        _ => "left".to_string(),
    };
    let clean_link_open_pane = match settings.link_open_pane.as_str() {
        "left" | "right" | "focused" | "unfocused" => settings.link_open_pane.clone(),
        _ => "unfocused".to_string(),
    };

    let mut updated = settings;
    fill_missing_topic_folders_from_db(&conn, &mut updated);
    sync_topic_folders_to_base_folders(&conn, &updated);

    let setting_path = resolve_projects_setting_json_path(&conn);
    let path_str = setting_path.to_string_lossy().to_string();

    updated.f11_viewer_mode = clean_f11;
    updated.default_editor_view_mode = clean_default_view;
    updated.default_file_open_pane = clean_file_open_pane;
    updated.link_open_pane = clean_link_open_pane;
    updated.base_font_size = updated.base_font_size.clamp(10, 32);
    updated.table_font_size = updated.table_font_size.clamp(9, 28);
    updated.heading_scale = updated.heading_scale.clamp(0.7, 1.8);
    updated.log_retention_comm_days = updated.log_retention_comm_days.clamp(1, 365);
    updated.log_retention_version_days = updated.log_retention_version_days.clamp(1, 365);
    updated.log_retention_system_days = updated.log_retention_system_days.clamp(1, 365);
    updated.log_retention_ai_days = updated.log_retention_ai_days.clamp(1, 365);
    updated.ai_daily_token_limit = updated.ai_daily_token_limit.clamp(10_000, 100_000_000);
    updated.call_playback_speed = updated.call_playback_speed.clamp(0.5, 3.0);
    updated.settings_file_path = path_str;

    let json_str = serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())?;
    fs::write(&setting_path, json_str).map_err(|e| e.to_string())?;
    let log_dir = refresh_log_dir_cache(&conn);
    let _ = prune_logs_in_dir(&log_dir, &updated);
    log_system(
        "INFO",
        &format!(
            "설정 저장 완료 (로그 보관일: 통신 {}일, 버전 {}일, 시스템 {}일, AI {}일)",
            updated.log_retention_comm_days,
            updated.log_retention_version_days,
            updated.log_retention_system_days,
            updated.log_retention_ai_days
        ),
    );
    let _ = app.emit("app-settings-updated", &updated);
    Ok(updated)
}
