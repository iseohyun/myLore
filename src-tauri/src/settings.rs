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

pub(crate) fn default_scroll_sync() -> bool {
    true
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

pub(crate) fn default_ai_user_profile() -> String {
    "이름: 정서현, 출생년도: 1983, 거주지: 거제, 출생지: 서울, 취미: 수영".to_string()
}

pub(crate) fn default_call_analysis_prompt() -> String {
    "다음 스마트폰 통화 녹음 음성을 듣고 한국어로 정확하게 분석하여 반드시 아래의 2개 마크다운 섹션(`## 💡 요약`, `## 📜 스크립트`) 구조로 작성해 주세요 (통화 상대방 이름: {contact_name} — 전화번호나 날짜 없이 순수 이름만 표시):\n\n\
## 💡 요약\n\
- (통화 목적, 주요 합의 사항, 일정/장소/금액 등 핵심 내용을 1~3줄 불릿 포인트로 명확히 요약)\n\n\
## 📜 스크립트\n\
- **[00:00:00] 나**: (실제 발화 내용)\n\
- **[00:00:04] {contact_name}**: (실제 발화 내용)\n\n\
[⏱️ 대화 시각(타임스탬프) 정밀 매칭 및 연락처 관계 열람 정책]\n\
1. 초반 통화 연결음·침묵 구간을 정확히 계산하여 각 문장의 첫 음절이 실제로 들리는 오디오 재생 오프셋 시각을 `[HH:MM:SS]` 8자리 포맷으로 정확히 표기하세요 (문장과 대화 시각의 타이밍 일치 필수).\n\
2. 대화 상대방 이름은 전화번호나 날짜 없이 `{contact_name}` 이름만 표시하여 시간 순서대로 빠짐없이 전사하세요.\n\
3. 하단에 첨부된 [👤 사용자 개인화 참고 정보]와 [📇 연락처 당사자 관계 · 소속 모임 배경지식]을 열람하여 호칭, 인명, 모임 구성원, 직업/거주지 맥락을 기준으로 발음 오인식을 교정하되, 실제 녹음에서 발화되지 않은 사실은 임의로 지어내지 마세요.".to_string()
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
    #[serde(default)]
    pub default_menu_bar_expanded: bool,
    #[serde(default = "default_scroll_sync")]
    pub scroll_sync_enabled: bool,
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
            default_menu_bar_expanded: false,
            scroll_sync_enabled: default_scroll_sync(),
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
    let setting_path = resolve_projects_setting_json_path(conn);
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                let trimmed = parsed.ai_user_profile.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
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

    let mut updated = settings;
    fill_missing_topic_folders_from_db(&conn, &mut updated);
    sync_topic_folders_to_base_folders(&conn, &updated);

    let setting_path = resolve_projects_setting_json_path(&conn);
    let path_str = setting_path.to_string_lossy().to_string();

    updated.f11_viewer_mode = clean_f11;
    updated.default_editor_view_mode = clean_default_view;
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
