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

pub(crate) fn default_auto_call_transcription() -> bool {
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
pub(crate) fn save_app_settings(
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
