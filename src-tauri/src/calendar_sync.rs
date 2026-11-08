//! Google Calendar API v3 양방향 동기화 모듈 (OAuth 2.0 PKCE 로컬 콜백, 신규 일정 업로드, 시작 시/F5 요청 시 일정 다운로드).

use crate::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

const DEFAULT_GCAL_CLIENT_ID: &str = "";
const DEFAULT_GCAL_CLIENT_SECRET: &str = "";
const DEFAULT_GCAL_CALENDAR_ID: &str = "primary";
const GCAL_OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:42813/callback";

fn env_gcal_client_id() -> String {
    std::env::var("MYLORE_GCAL_CLIENT_ID")
        .unwrap_or_else(|_| DEFAULT_GCAL_CLIENT_ID.to_string())
}

fn env_gcal_client_secret() -> String {
    std::env::var("MYLORE_GCAL_CLIENT_SECRET")
        .unwrap_or_else(|_| DEFAULT_GCAL_CLIENT_SECRET.to_string())
}

fn env_gcal_calendar_id() -> String {
    std::env::var("MYLORE_GCAL_CALENDAR_ID")
        .unwrap_or_else(|_| DEFAULT_GCAL_CALENDAR_ID.to_string())
}

static GCAL_HTTP_AGENT: std::sync::LazyLock<ureq::Agent> = std::sync::LazyLock::new(|| {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(8)))
        .timeout_global(Some(Duration::from_secs(30)))
        .tls_config(TlsConfig::builder().provider(TlsProvider::NativeTls).root_certs(RootCerts::PlatformVerifier).build())
        .build()
        .into()
});

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleCalendarSecretConfig {
    pub client_id: String,
    pub client_secret: String,
    pub default_calendar_id: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub expires_at_ms: i64,
    #[serde(default)]
    pub last_sync_at: String,
    #[serde(default)]
    pub last_error: String,
    #[serde(default)]
    pub blacklisted_calendars: Vec<String>,
}

impl Default for GoogleCalendarSecretConfig {
    fn default() -> Self {
        Self {
            client_id: env_gcal_client_id(),
            client_secret: env_gcal_client_secret(),
            default_calendar_id: env_gcal_calendar_id(),
            refresh_token: String::new(),
            access_token: String::new(),
            expires_at_ms: 0,
            last_sync_at: String::new(),
            last_error: String::new(),
            blacklisted_calendars: vec![
                "addressbook#contacts@group.v.calendar.google.com".to_string(),
                "ko.south_korea#holiday@group.v.calendar.google.com".to_string(),
            ],
        }
    }
}

pub(crate) fn resolve_gcal_secret_path() -> PathBuf {
    let dir = app_data_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("google_calendar_secret.json")
}

pub(crate) fn load_or_init_gcal_config() -> GoogleCalendarSecretConfig {
    let path = resolve_gcal_secret_path();
    if path.exists() {
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(mut cfg) = serde_json::from_str::<GoogleCalendarSecretConfig>(&raw) {
                if cfg.client_id.trim().is_empty() { cfg.client_id = env_gcal_client_id(); }
                if cfg.client_secret.trim().is_empty() { cfg.client_secret = env_gcal_client_secret(); }
                if cfg.default_calendar_id.trim().is_empty() { cfg.default_calendar_id = env_gcal_calendar_id(); }
                if cfg.blacklisted_calendars.is_empty() {
                    cfg.blacklisted_calendars = GoogleCalendarSecretConfig::default().blacklisted_calendars;
                }
                return cfg;
            }
        }
    }
    let def = GoogleCalendarSecretConfig::default();
    save_gcal_config(&def);
    def
}

pub(crate) fn save_gcal_config(cfg: &GoogleCalendarSecretConfig) {
    let path = resolve_gcal_secret_path();
    if let Ok(s) = serde_json::to_string_pretty(cfg) {
        let _ = fs::write(&path, s);
    }
}

fn url_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn base64url_no_pad(bytes: &[u8]) -> String {
    base64_encode(bytes).replace('+', "-").replace('/', "_").trim_end_matches('=').to_string()
}

fn sha256_bytes_from_hex(data: &[u8]) -> Vec<u8> {
    let hex = sha256_hex(data);
    let mut out = Vec::with_capacity(32);
    let bytes = hex.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if let Ok(s) = std::str::from_utf8(&bytes[i..i + 2]) {
            if let Ok(v) = u8::from_str_radix(s, 16) { out.push(v); }
        }
        i += 2;
    }
    out
}

/// 유효한 Google OAuth 2.0 `access_token`을 반환합니다 (만료 시 `refresh_token`으로 자동 갱신).
pub(crate) fn ensure_valid_gcal_access_token() -> Result<(String, GoogleCalendarSecretConfig), String> {
    let mut cfg = load_or_init_gcal_config();
    let now_ms = chrono::Local::now().timestamp_millis();
    if !cfg.access_token.trim().is_empty() && cfg.expires_at_ms > now_ms + 60_000 {
        return Ok((cfg.access_token.clone(), cfg));
    }
    if cfg.refresh_token.trim().is_empty() {
        return Err("NEEDS_AUTH: 구글 캘린더 계정 연동이 필요합니다. 일정 대쉬보드에서 [🔑 구글 연동] 버튼을 눌러 로그인해 주세요.".to_string());
    }

    let form_body = format!(
        "client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token",
        url_encode_component(cfg.client_id.trim()),
        url_encode_component(cfg.client_secret.trim()),
        url_encode_component(cfg.refresh_token.trim())
    );
    let resp = GCAL_HTTP_AGENT
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .send(form_body.as_bytes())
        .map_err(|e| format!("Google OAuth 토큰 갱신 네트워크 오류: {}", e))?;

    let resp_str = resp.into_body().read_to_string().map_err(|e| format!("Google OAuth 응답 읽기 오류: {}", e))?;
    let jv: serde_json::Value = serde_json::from_str(&resp_str).map_err(|_| format!("Google OAuth 응답 파싱 실패: {}", resp_str))?;

    if let Some(err_code) = jv.get("error").and_then(|v| v.as_str()) {
        let err_desc = jv.get("error_description").and_then(|v| v.as_str()).unwrap_or(err_code);
        cfg.access_token.clear();
        cfg.expires_at_ms = 0;
        cfg.last_error = format!("{}: {}", err_code, err_desc);
        save_gcal_config(&cfg);
        return Err(format!("NEEDS_AUTH: 구글 캘린더 인증이 만료되었습니다 ({}). [🔑 구글 연동] 버튼을 눌러 다시 로그인해 주세요.", err_desc));
    }

    let access_token = jv.get("access_token").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if access_token.is_empty() {
        return Err("Google OAuth 응답에 access_token이 없습니다.".to_string());
    }

    let expires_in = jv.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(3599);
    if let Some(new_rt) = jv.get("refresh_token").and_then(|v| v.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty()) {
        cfg.refresh_token = new_rt.to_string();
    }
    cfg.access_token = access_token.clone();
    cfg.expires_at_ms = now_ms + (expires_in.saturating_sub(60)) * 1000;
    cfg.last_error.clear();
    save_gcal_config(&cfg);
    Ok((access_token, cfg))
}

#[derive(Debug, Clone)]
struct GoogleCalendarListEntry {
    id: String,
    summary: String,
    primary: bool,
    access_role: String,
}

fn fetch_user_calendars(access_token: &str, cfg: &GoogleCalendarSecretConfig) -> Result<Vec<GoogleCalendarListEntry>, String> {
    let resp = GCAL_HTTP_AGENT
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
        .header("Authorization", &format!("Bearer {}", access_token))
        .call()
        .map_err(|e| format!("Google Calendar 목록 조회 오류: {}", e))?;

    let resp_str = resp.into_body().read_to_string().map_err(|e| format!("Google Calendar 목록 읽기 오류: {}", e))?;
    let jv: serde_json::Value = serde_json::from_str(&resp_str).map_err(|_| format!("Google Calendar 목록 JSON 파싱 오류: {}", resp_str))?;

    if let Some(err) = jv.get("error") {
        let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("Calendar API Error");
        return Err(format!("Google Calendar 목록 API 오류: {}", msg));
    }

    let mut out = Vec::new();
    if let Some(items) = jv.get("items").and_then(|v| v.as_array()) {
        for item in items {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let summary = item.get("summaryOverride").or_else(|| item.get("summary")).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if id.is_empty() { continue; }
            let is_blacklisted = cfg.blacklisted_calendars.iter().any(|b| b.eq_ignore_ascii_case(&id) || b.eq_ignore_ascii_case(&summary))
                || summary == "생일" || summary == "대한민국의 휴일" || id.contains("#holiday@") || id.contains("addressbook#contacts");
            if is_blacklisted { continue; }
            let primary = item.get("primary").and_then(|v| v.as_bool()).unwrap_or(false);
            let access_role = item.get("accessRole").and_then(|v| v.as_str()).unwrap_or("").to_string();
            out.push(GoogleCalendarListEntry { id, summary, primary, access_role });
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ParsedDiaryEventYaml {
    pub uuid: String,
    pub event_id: String,
    pub summary: String,
    pub start_date: String,
    pub end_date: String,
    pub calendar: String,
    pub location: String,
    pub transparency: String,
    pub visibility: String,
    pub color_id: String,
    pub description: String,
    pub status: String,
    pub upload_pending: bool,
    pub attendees: Vec<(String, String)>,
}

fn unquote_yaml_val(raw_v: &str) -> String {
    let trimmed = raw_v.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        rest.find('"')
            .map(|idx| rest[..idx].replace("\\\"", "\"").trim().to_string())
            .unwrap_or_else(|| rest.trim_matches('"').trim().to_string())
    } else if let Some(rest) = trimmed.strip_prefix('\'') {
        rest.find('\'')
            .map(|idx| rest[..idx].trim().to_string())
            .unwrap_or_else(|| rest.trim_matches('\'').trim().to_string())
    } else {
        let without_comment = trimmed.find(" #").map(|idx| &trimmed[..idx]).unwrap_or(trimmed);
        without_comment.trim().trim_matches('"').trim_matches('\'').trim().to_string()
    }
}

/// 일기(Diary) `.md` 파일의 중첩 YAML (`start.date`, `end.date`, `attendees` 포함)을 정밀 파싱합니다.
pub(crate) fn parse_diary_event_yaml(yaml_raw: &str) -> ParsedDiaryEventYaml {
    let mut parsed = ParsedDiaryEventYaml::default();
    let mut current_block = "";
    let mut pending_attendee_email = String::new();

    for line in yaml_raw.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let trimmed = line.trim();

        if indent == 0 {
            if !pending_attendee_email.is_empty() {
                parsed.attendees.push((pending_attendee_email.clone(), "needsAction".to_string()));
                pending_attendee_email.clear();
            }
            if let Some(colon) = trimmed.find(':') {
                let k = trimmed[..colon].trim();
                let v = unquote_yaml_val(&trimmed[colon + 1..]);
                match k {
                    "start" => {
                        current_block = "start";
                        if v.len() >= 10 {
                            parsed.start_date = v[..10].to_string();
                        }
                    }
                    "end" => {
                        current_block = "end";
                        if v.len() >= 10 {
                            parsed.end_date = v[..10].to_string();
                        }
                    }
                    "attendees" => current_block = "attendees",
                    _ => {
                        current_block = "";
                        match k {
                            "uuid" => parsed.uuid = v,
                            "event-id" | "event_id" => parsed.event_id = v,
                            "summary" | "title" if parsed.summary.is_empty() || k == "summary" => parsed.summary = v,
                            "date" if parsed.start_date.is_empty() && v.len() >= 10 => {
                                parsed.start_date = v[..10].to_string();
                            }
                            "calendar" => parsed.calendar = v,
                            "location" => parsed.location = v,
                            "transparency" => parsed.transparency = v,
                            "visibility" => parsed.visibility = v,
                            "colorId" | "color_id" => parsed.color_id = v,
                            "description" => parsed.description = v,
                            "status" => parsed.status = v,
                            "gcal-upload-pending" => parsed.upload_pending = v.eq_ignore_ascii_case("true") || v == "1",
                            _ => {}
                        }
                    }
                }
            }
        } else {
            let sub = trimmed.trim_start_matches('-').trim();
            if let Some(colon) = sub.find(':') {
                let k = sub[..colon].trim();
                let v = unquote_yaml_val(&sub[colon + 1..]);
                match current_block {
                    "start" if (k == "date" || k == "dateTime") && v.len() >= 10 => {
                        parsed.start_date = v[..10].to_string();
                    }
                    "end" if (k == "date" || k == "dateTime") && v.len() >= 10 => {
                        parsed.end_date = v[..10].to_string();
                    }
                    "attendees" => {
                        if k == "email" {
                            if !pending_attendee_email.is_empty() {
                                parsed.attendees.push((pending_attendee_email.clone(), "needsAction".to_string()));
                            }
                            pending_attendee_email = v;
                        } else if k == "responseStatus" && !pending_attendee_email.is_empty() {
                            let st = if v.is_empty() { "needsAction".to_string() } else { v };
                            parsed.attendees.push((pending_attendee_email.clone(), st));
                            pending_attendee_email.clear();
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    if !pending_attendee_email.is_empty() {
        parsed.attendees.push((pending_attendee_email, "needsAction".to_string()));
    }
    if parsed.end_date.is_empty() && !parsed.start_date.is_empty() {
        parsed.end_date = parsed.start_date.clone();
    }
    parsed
}

fn add_days_to_ymd(ymd: &str, days: i64) -> String {
    if let Ok(nd) = chrono::NaiveDate::parse_from_str(ymd.trim(), "%Y-%m-%d") {
        if let Some(next) = nd.checked_add_signed(chrono::Duration::days(days)) {
            return next.format("%Y-%m-%d").to_string();
        }
    }
    ymd.to_string()
}

fn color_id_to_calendar_category(color_id: &str, fallback_cal_summary: &str) -> (String, String) {
    match color_id.trim() {
        "11" => ("개발".to_string(), "11".to_string()),
        "6" => ("이벤트".to_string(), "6".to_string()),
        "10" => ("수영".to_string(), "10".to_string()),
        "7" => ("기록".to_string(), "7".to_string()),
        "9" => ("식단".to_string(), "9".to_string()),
        "3" => ("일상".to_string(), "3".to_string()),
        "1" => ("알림".to_string(), "1".to_string()),
        "2" => ("민트".to_string(), "2".to_string()),
        "4" => ("연분홍".to_string(), "4".to_string()),
        "5" => ("노랑".to_string(), "5".to_string()),
        "8" => ("회색".to_string(), "8".to_string()),
        _ => match fallback_cal_summary.trim() {
            "개발" => ("개발".to_string(), "11".to_string()),
            "이벤트" => ("이벤트".to_string(), "6".to_string()),
            "수영" => ("수영".to_string(), "10".to_string()),
            "기록" => ("기록".to_string(), "7".to_string()),
            "식단" => ("식단".to_string(), "9".to_string()),
            "일상" => ("일상".to_string(), "3".to_string()),
            "알림" => ("알림".to_string(), "1".to_string()),
            other if !other.is_empty() => (other.to_string(), "11".to_string()),
            _ => ("개발".to_string(), "11".to_string()),
        },
    }
}

/// 마크다운 파일의 YAML Frontmatter에 `event-id`를 주입하고 `gcal-upload-pending` 플래그를 제거합니다.
pub(crate) fn inject_event_id_into_markdown(path: &Path, event_id: &str) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (yaml_raw, body, _) = parse_markdown_yaml(&raw);
    if yaml_raw.is_empty() {
        return Ok(());
    }

    let mut lines: Vec<String> = Vec::new();
    let mut inserted = false;
    for line in yaml_raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("event-id:") || trimmed.starts_with("event_id:") {
            if !inserted {
                lines.push(format!("event-id: {}", event_id.trim()));
                inserted = true;
            }
            continue;
        }
        if trimmed.starts_with("gcal-upload-pending:") {
            continue;
        }
        lines.push(line.to_string());
        if !inserted && trimmed.starts_with("uuid:") {
            lines.push(format!("event-id: {}", event_id.trim()));
            inserted = true;
        }
    }
    if !inserted {
        lines.insert(0, format!("event-id: {}", event_id.trim()));
    }

    let new_raw = format!("---\n{}\n---\n{}", lines.join("\n"), body);
    fs::write(path, new_raw).map_err(|e| e.to_string())
}

/// 오프라인이거나 아직 OAuth 미연동 상태에서 새로 생성된 일정 파일에 `gcal-upload-pending: "true"`를 표시합니다.
pub(crate) fn mark_diary_markdown_upload_pending(path: &Path) {
    let Ok(raw) = fs::read_to_string(path) else { return };
    let (yaml_raw, body, _) = parse_markdown_yaml(&raw);
    if yaml_raw.is_empty() || yaml_raw.contains("gcal-upload-pending:") || yaml_raw.contains("event-id:") {
        return;
    }
    let new_raw = format!("---\n{}\ngcal-upload-pending: \"true\"\n---\n{}", yaml_raw.trim_end(), body);
    let _ = fs::write(path, new_raw);
}

/// 단일 일기(`.md`) 파일을 Google Calendar API v3로 업로드하고 반환된 `event-id`를 파일에 기록합니다.
pub(crate) fn try_upload_diary_markdown_to_gcal(path: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let (yaml_raw, body, _) = parse_markdown_yaml(&raw);
    let mut parsed = parse_diary_event_yaml(&yaml_raw);

    if !parsed.event_id.trim().is_empty() {
        return Ok(parsed.event_id);
    }

    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
        let date_re = cached_regex!(r"^(\d{4}-\d{2}-\d{2})\s*(.*)$");
        if let Some(cap) = date_re.captures(stem) {
            if parsed.start_date.is_empty() {
                parsed.start_date = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            }
            if parsed.summary.is_empty() {
                parsed.summary = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            }
        }
    }

    if parsed.start_date.is_empty() {
        return Err("일정 시작 날짜(start.date)가 없습니다.".to_string());
    }
    if parsed.summary.is_empty() {
        parsed.summary = "새 일정".to_string();
    }
    if parsed.end_date.is_empty() || parsed.end_date < parsed.start_date {
        parsed.end_date = parsed.start_date.clone();
    }

    let (access_token, cfg) = match ensure_valid_gcal_access_token() {
        Ok(res) => res,
        Err(e) => {
            mark_diary_markdown_upload_pending(path);
            return Err(e);
        }
    };

    let calendars = fetch_user_calendars(&access_token, &cfg).unwrap_or_default();
    let target_cal_id = calendars
        .iter()
        .find(|c| {
            !parsed.calendar.is_empty()
                && (c.summary.eq_ignore_ascii_case(&parsed.calendar) || c.id.eq_ignore_ascii_case(&parsed.calendar))
        })
        .or_else(|| calendars.iter().find(|c| c.id.eq_ignore_ascii_case(&cfg.default_calendar_id)))
        .or_else(|| calendars.iter().find(|c| c.primary))
        .map(|c| c.id.clone())
        .unwrap_or_else(|| {
            if !cfg.default_calendar_id.trim().is_empty() {
                cfg.default_calendar_id.clone()
            } else {
                "primary".to_string()
            }
        });

    let exclusive_end_date = add_days_to_ymd(&parsed.end_date, 1);
    let (_, resolved_color_id) = color_id_to_calendar_category(&parsed.color_id, &parsed.calendar);

    let mut event_obj = serde_json::Map::new();
    event_obj.insert("summary".to_string(), serde_json::json!(parsed.summary));
    event_obj.insert("start".to_string(), serde_json::json!({ "date": parsed.start_date }));
    event_obj.insert("end".to_string(), serde_json::json!({ "date": exclusive_end_date }));
    if !resolved_color_id.is_empty() {
        event_obj.insert("colorId".to_string(), serde_json::json!(resolved_color_id));
    }
    if !parsed.location.trim().is_empty() {
        event_obj.insert("location".to_string(), serde_json::json!(parsed.location.trim()));
    }
    if !parsed.transparency.trim().is_empty() {
        event_obj.insert("transparency".to_string(), serde_json::json!(parsed.transparency.trim()));
    }
    if !parsed.visibility.trim().is_empty() {
        event_obj.insert("visibility".to_string(), serde_json::json!(parsed.visibility.trim()));
    }
    if !parsed.status.trim().is_empty() {
        event_obj.insert("status".to_string(), serde_json::json!(parsed.status.trim()));
    }
    if !parsed.attendees.is_empty() {
        let att_arr: Vec<serde_json::Value> = parsed
            .attendees
            .iter()
            .map(|(email, resp)| serde_json::json!({ "email": email, "responseStatus": resp }))
            .collect();
        event_obj.insert("attendees".to_string(), serde_json::Value::Array(att_arr));
    }

    let body_trimmed = body.trim();
    if !body_trimmed.is_empty() {
        event_obj.insert("description".to_string(), serde_json::json!(body_trimmed));
    }

    let req_bytes = serde_json::to_vec(&serde_json::Value::Object(event_obj)).map_err(|e| e.to_string())?;
    let post_url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        url_encode_component(&target_cal_id)
    );

    let resp = GCAL_HTTP_AGENT
        .post(&post_url)
        .header("Authorization", &format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .send(&req_bytes)
        .map_err(|e| {
            mark_diary_markdown_upload_pending(path);
            format!("Google Calendar 이벤트 업로드 실패: {}", e)
        })?;

    let resp_str = resp
        .into_body()
        .read_to_string()
        .map_err(|e| format!("Google Calendar 이벤트 응답 읽기 실패: {}", e))?;
    let jv: serde_json::Value =
        serde_json::from_str(&resp_str).map_err(|_| format!("Google Calendar 이벤트 응답 파싱 실패: {}", resp_str))?;

    if let Some(err) = jv.get("error") {
        let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("Upload Error");
        mark_diary_markdown_upload_pending(path);
        return Err(format!("Google Calendar 업로드 API 오류: {}", msg));
    }

    let created_id = jv.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if created_id.is_empty() {
        mark_diary_markdown_upload_pending(path);
        return Err("Google Calendar 응답에 event id가 없습니다.".to_string());
    }

    inject_event_id_into_markdown(path, &created_id)?;
    log_comm(
        "INFO",
        &format!("[GoogleCalendar] 신규 일정 업로드 완료: {} (event-id: {})", parsed.summary, created_id),
    );
    Ok(created_id)
}

fn resolve_diary_base_folder(conn: &Connection) -> Result<(String, PathBuf), String> {
    let (base_id, p) = resolve_role_base_folder(conn, "diary")?;
    let _ = fs::create_dir_all(&p);
    Ok((base_id, p))
}

/// Google Calendar 이벤트를 다운로드(및 업로드 대기 중인 신규 일정 업로드)하고 로컬 `Diary` 폴더와 동기화합니다.
pub(crate) fn sync_google_calendar_events_internal(
    conn: &Connection,
    year: Option<i32>,
    month: Option<i32>,
) -> Result<GoogleCalendarSyncResult, String> {
    let (_, diary_dir) = resolve_diary_base_folder(conn)?;

    let (access_token, mut cfg) = match ensure_valid_gcal_access_token() {
        Ok(res) => res,
        Err(err_msg) => {
            let needs_auth = err_msg.starts_with("NEEDS_AUTH:");
            let clean_msg = err_msg.trim_start_matches("NEEDS_AUTH:").trim().to_string();
            return Ok(GoogleCalendarSyncResult {
                uploaded_count: 0,
                downloaded_count: 0,
                updated_count: 0,
                skipped_count: 0,
                needs_auth,
                message: clean_msg,
                last_sync_at: cfg_last_sync_fallback(),
            });
        }
    };

    let mut existing_by_event_id: HashMap<String, PathBuf> = HashMap::new();
    let mut existing_by_date_title: HashMap<(String, String), PathBuf> = HashMap::new();
    let mut pending_upload_files: Vec<PathBuf> = Vec::new();
    let date_prefix_re = cached_regex!(r"^(\d{4}-\d{2}-\d{2})\s+(.*)$");

    for entry in WalkDir::new(&diary_dir)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && !is_internal_mylore_path(e.path()))
    {
        let p = entry.path().to_path_buf();
        if p.extension().and_then(|s| s.to_str()).map(|s| !s.eq_ignore_ascii_case("md")).unwrap_or(true) {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&p) else { continue };
        let (yaml_raw, _, _) = parse_markdown_yaml(&raw);
        let parsed = parse_diary_event_yaml(&yaml_raw);

        if !parsed.event_id.trim().is_empty() {
            existing_by_event_id.insert(parsed.event_id.trim().to_string(), p.clone());
        } else if parsed.upload_pending {
            pending_upload_files.push(p.clone());
        }

        let mut d_str = parsed.start_date.clone();
        let mut s_str = parsed.summary.clone();
        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
            if let Some(cap) = date_prefix_re.captures(stem) {
                if d_str.is_empty() {
                    d_str = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
                }
                if s_str.is_empty() {
                    s_str = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
                }
            }
        }
        if !d_str.is_empty() && !s_str.is_empty() {
            existing_by_date_title.insert((d_str, s_str.to_lowercase()), p);
        }
    }

    let mut uploaded_count = 0usize;
    for pending_path in pending_upload_files {
        if let Ok(ev_id) = try_upload_diary_markdown_to_gcal(&pending_path) {
            existing_by_event_id.insert(ev_id, pending_path.clone());
            let _ = build_document_payload(conn, &pending_path);
            uploaded_count += 1;
        }
    }

    use chrono::{Local, NaiveDate};
    let now = Local::now();
    let (start_date, end_date) = match (year, month) {
        (Some(y), Some(m)) if (1..=12).contains(&m) => {
            let target_first = NaiveDate::from_ymd_opt(y, m as u32, 1).unwrap_or_else(|| now.date_naive());
            let min_d = target_first.checked_sub_signed(chrono::Duration::days(35)).unwrap_or(target_first);
            let max_d = target_first.checked_add_signed(chrono::Duration::days(65)).unwrap_or(target_first);
            (min_d, max_d)
        }
        _ => {
            let today = now.date_naive();
            let min_d = today.checked_sub_signed(chrono::Duration::days(60)).unwrap_or(today);
            let max_d = today.checked_add_signed(chrono::Duration::days(90)).unwrap_or(today);
            (min_d, max_d)
        }
    };

    let time_min = format!("{}T00:00:00Z", start_date.format("%Y-%m-%d"));
    let time_max = format!("{}T23:59:59Z", end_date.format("%Y-%m-%d"));

    let calendars = fetch_user_calendars(&access_token, &cfg)?;
    let mut target_calendars: Vec<GoogleCalendarListEntry> = calendars
        .iter()
        .filter(|c| {
            c.id.eq_ignore_ascii_case(&cfg.default_calendar_id)
                || c.primary
                || c.access_role == "owner"
                || c.access_role == "writer"
        })
        .cloned()
        .collect();

    if target_calendars.is_empty() && !cfg.default_calendar_id.trim().is_empty() {
        target_calendars.push(GoogleCalendarListEntry {
            id: cfg.default_calendar_id.clone(),
            summary: "기본 캘린더".to_string(),
            primary: true,
            access_role: "owner".to_string(),
        });
    }

    let mut downloaded_count = 0usize;
    let mut updated_count = 0usize;
    let mut skipped_count = 0usize;

    for cal in target_calendars {
        let events_url = format!(
            "https://www.googleapis.com/calendar/v3/calendars/{}/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults=250",
            url_encode_component(&cal.id),
            url_encode_component(&time_min),
            url_encode_component(&time_max)
        );

        let Ok(resp) = GCAL_HTTP_AGENT
            .get(&events_url)
            .header("Authorization", &format!("Bearer {}", access_token))
            .call()
        else {
            continue;
        };
        let Ok(resp_str) = resp.into_body().read_to_string() else { continue };
        let Ok(jv) = serde_json::from_str::<serde_json::Value>(&resp_str) else { continue };
        let Some(items) = jv.get("items").and_then(|v| v.as_array()) else { continue };

        for item in items {
            let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("confirmed");
            if status == "cancelled" {
                continue;
            }
            let event_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let summary = item.get("summary").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if event_id.is_empty() || summary.is_empty() {
                continue;
            }

            let start_obj = item.get("start");
            let end_obj = item.get("end");

            let (ev_start_date, is_all_day) =
                if let Some(d) = start_obj.and_then(|o| o.get("date")).and_then(|v| v.as_str()) {
                    (d.trim().to_string(), true)
                } else if let Some(dt) = start_obj.and_then(|o| o.get("dateTime")).and_then(|v| v.as_str()) {
                    if dt.len() >= 10 {
                        (dt[..10].to_string(), false)
                    } else {
                        continue;
                    }
                } else {
                    continue;
                };

            let ev_end_date = if is_all_day {
                if let Some(d) = end_obj.and_then(|o| o.get("date")).and_then(|v| v.as_str()) {
                    let incl = add_days_to_ymd(d.trim(), -1);
                    if incl < ev_start_date { ev_start_date.clone() } else { incl }
                } else {
                    ev_start_date.clone()
                }
            } else if let Some(dt) = end_obj.and_then(|o| o.get("dateTime")).and_then(|v| v.as_str()) {
                if dt.len() >= 10 { dt[..10].to_string() } else { ev_start_date.clone() }
            } else {
                ev_start_date.clone()
            };

            let raw_color_id = item.get("colorId").and_then(|v| v.as_str()).unwrap_or("");
            let (cal_category, color_id) = color_id_to_calendar_category(raw_color_id, &cal.summary);
            let location = item.get("location").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let transparency = item.get("transparency").and_then(|v| v.as_str()).unwrap_or("transparent").to_string();
            let visibility = item.get("visibility").and_then(|v| v.as_str()).unwrap_or("default").to_string();
            let description_remote = item.get("description").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

            if let Some(existing_path) = existing_by_event_id.get(&event_id).cloned() {
                if let Ok(raw) = fs::read_to_string(&existing_path) {
                    let (yaml_raw, local_body, _) = parse_markdown_yaml(&raw);
                    let body_needs_fill = local_body.trim().is_empty()
                        && !description_remote.is_empty()
                        && !description_remote.eq_ignore_ascii_case("File");
                    if body_needs_fill {
                        let updated_raw = format!("---\n{}\n---\n{}\n", yaml_raw.trim_end(), description_remote);
                        if fs::write(&existing_path, updated_raw).is_ok() {
                            let _ = build_document_payload(conn, &existing_path);
                            updated_count += 1;
                            continue;
                        }
                    }
                }
                skipped_count += 1;
                continue;
            }

            let lookup_key = (ev_start_date.clone(), summary.to_lowercase());
            if let Some(existing_path) = existing_by_date_title.get(&lookup_key).cloned() {
                if inject_event_id_into_markdown(&existing_path, &event_id).is_ok() {
                    existing_by_event_id.insert(event_id.clone(), existing_path.clone());
                    let _ = build_document_payload(conn, &existing_path);
                    updated_count += 1;
                    continue;
                }
            }

            let safe_title = sanitize_filename_stem(&summary);
            let mut filename = format!("{} {}.md", ev_start_date, safe_title);
            let mut target_path = diary_dir.join(&filename);
            let mut suffix = 1usize;
            while target_path.exists() {
                filename = format!("{} {}-{}.md", ev_start_date, safe_title, suffix);
                target_path = diary_dir.join(&filename);
                suffix += 1;
            }

            let new_uuid = Uuid::new_v4().to_string();
            let loc_line = if location.is_empty() { String::new() } else { format!("location: \"{}\"\n", location.replace('"', "\\\"")) };
            let body_text = if description_remote.is_empty() || description_remote.eq_ignore_ascii_case("File") { String::new() } else { format!("{}\n", description_remote) };

            let content = format!(
                "---\nuuid: \"{}\"\nevent-id: {}\nsummary: \"{}\"\nstart:\n  date: \"{}\"\nend:\n  date: \"{}\"\ncalendar: \"{}\"\n{}transparency: \"{}\"\nvisibility: \"{}\"\ncolorId: \"{}\"\ndescription: \"File\"\nstatus: \"{}\"\n---\n{}",
                new_uuid, event_id, summary.replace('"', "\\\""), ev_start_date, ev_end_date,
                cal_category, loc_line, transparency, visibility, color_id, status, body_text
            );

            if fs::write(&target_path, content).is_ok() {
                existing_by_event_id.insert(event_id, target_path.clone());
                existing_by_date_title.insert(lookup_key, target_path.clone());
                let _ = build_document_payload(conn, &target_path);
                downloaded_count += 1;
            }
        }
    }

    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    cfg.last_sync_at = now_str.clone();
    cfg.last_error.clear();
    save_gcal_config(&cfg);

    let msg = format!(
        "📅 구글 캘린더 동기화 완료 ({}): 신규 다운로드 {}건 · 업로드 {}건 · 매칭 갱신 {}건 (기존 유지 {}건)",
        now_str, downloaded_count, uploaded_count, updated_count, skipped_count
    );
    log_comm("INFO", &msg);

    Ok(GoogleCalendarSyncResult {
        uploaded_count, downloaded_count, updated_count, skipped_count,
        needs_auth: false, message: msg, last_sync_at: now_str,
    })
}

fn cfg_last_sync_fallback() -> String {
    load_or_init_gcal_config().last_sync_at
}

#[tauri::command]
pub(crate) fn get_google_calendar_sync_status() -> Result<GoogleCalendarSyncStatus, String> {
    let cfg = load_or_init_gcal_config();
    let path = resolve_gcal_secret_path();
    let is_connected = !cfg.refresh_token.trim().is_empty() && cfg.last_error.is_empty();
    Ok(GoogleCalendarSyncStatus {
        is_connected, client_id: cfg.client_id, default_calendar_id: cfg.default_calendar_id,
        last_sync_at: cfg.last_sync_at, last_error: cfg.last_error, storage_location: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub(crate) async fn sync_google_calendar_events(
    state: State<'_, AppState>,
    year: Option<i32>,
    month: Option<i32>,
) -> Result<GoogleCalendarSyncResult, String> {
    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_arc.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&db_path)?;
        sync_google_calendar_events_internal(&conn, year, month)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Google OAuth 2.0 PKCE 브라우저 로그인(`http://127.0.0.1:42813/callback`)을 시작하고,
/// 인증 완료 시 즉시 토큰 저장 및 캘린더 동기화를 수행한 뒤 `"google-calendar-sync-event"` 이벤트를 발행합니다.
#[tauri::command]
pub(crate) fn start_google_calendar_oauth_login(app: AppHandle, state: State<AppState>) -> Result<String, String> {
    let cfg = load_or_init_gcal_config();
    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();

    let verifier_raw = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let challenge_bytes = sha256_bytes_from_hex(verifier_raw.as_bytes());
    let code_challenge = base64url_no_pad(&challenge_bytes);

    let scopes = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events";
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?scope={}&access_type=offline&include_granted_scopes=true&response_type=code&prompt=consent&state=mylore_gcal&redirect_uri={}&client_id={}&code_challenge={}&code_challenge_method=S256",
        url_encode_component(scopes), url_encode_component(GCAL_OAUTH_REDIRECT_URI),
        url_encode_component(cfg.client_id.trim()), url_encode_component(&code_challenge)
    );

    let listener = TcpListener::bind("127.0.0.1:42813").map_err(|e| {
        format!("로컬 OAuth 콜백 포트(127.0.0.1:42813) 바인딩 실패 (이미 인증 창이 열려 있는지 확인하세요): {}", e)
    })?;
    let _ = listener.set_nonblocking(true);
    open_google_calendar_web(auth_url.clone(), None)?;

    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(180);
        let mut auth_code = String::new();

        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let req_str = String::from_utf8_lossy(&buf[..n]);
                    let first_line = req_str.lines().next().unwrap_or("");
                    if let Some(q_idx) = first_line.find('?') {
                        let query_part = first_line[q_idx + 1..].split_whitespace().next().unwrap_or("");
                        for pair in query_part.split('&') {
                            let mut kv = pair.splitn(2, '=');
                            if kv.next() == Some("code") {
                                auth_code = url_decode_utf8(kv.next().unwrap_or(""));
                            }
                        }
                    }

                    let html_body = if !auth_code.is_empty() {
                        "<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'><title>myLore Google Calendar 연동 완료</title><style>body{font-family:sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#313244;padding:32px 40px;border-radius:12px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.4)}h2{color:#a6e3a1;margin-top:0}</style></head><body><div class='card'><h2>✅ myLore 구글 캘린더 연동 완료!</h2><p>인증 토큰이 저장되었으며 일정 동기화를 시작합니다.<br>이 브라우저 탭을 닫으셔도 됩니다.</p></div><script>setTimeout(()=>window.close(),1500);</script></body></html>"
                    } else {
                        "<!DOCTYPE html><html lang='ko'><head><meta charset='utf-8'><title>인증 대기</title></head><body>인증 코드가 감지되지 않았습니다.</body></html>"
                    };

                    let http_resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html_body.len(), html_body
                    );
                    let _ = stream.write_all(http_resp.as_bytes());
                    let _ = stream.flush();
                    if !auth_code.is_empty() { break; }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(120)),
                Err(_) => break,
            }
        }

        drop(listener);
        if auth_code.is_empty() {
            let _ = app.emit("google-calendar-sync-event", GoogleCalendarSyncResult {
                uploaded_count: 0, downloaded_count: 0, updated_count: 0, skipped_count: 0,
                needs_auth: true,
                message: "⚠️ 구글 캘린더 OAuth 로그인이 시간 초과되었거나 취소되었습니다.".to_string(),
                last_sync_at: cfg_last_sync_fallback(),
            });
            return;
        }

        let mut cur_cfg = load_or_init_gcal_config();
        let token_body = format!(
            "code={}&client_id={}&client_secret={}&redirect_uri={}&code_verifier={}&grant_type=authorization_code",
            url_encode_component(&auth_code), url_encode_component(cur_cfg.client_id.trim()),
            url_encode_component(cur_cfg.client_secret.trim()), url_encode_component(GCAL_OAUTH_REDIRECT_URI),
            url_encode_component(&verifier_raw)
        );

        let Ok(resp) = GCAL_HTTP_AGENT.post("https://oauth2.googleapis.com/token").header("Content-Type", "application/x-www-form-urlencoded").send(token_body.as_bytes()) else { return };
        let Ok(resp_str) = resp.into_body().read_to_string() else { return };
        let Ok(jv) = serde_json::from_str::<serde_json::Value>(&resp_str) else { return };

        let access_token = jv.get("access_token").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let refresh_token = jv.get("refresh_token").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let expires_in = jv.get("expires_in").and_then(|v| v.as_i64()).unwrap_or(3599);

        if !access_token.is_empty() {
            cur_cfg.access_token = access_token;
            if !refresh_token.is_empty() { cur_cfg.refresh_token = refresh_token; }
            cur_cfg.expires_at_ms = chrono::Local::now().timestamp_millis() + (expires_in.saturating_sub(60)) * 1000;
            cur_cfg.last_error.clear();
            save_gcal_config(&cur_cfg);

            let _guard = lock_arc.lock().ok();
            if let Ok(conn) = open_db(&db_path) {
                if let Ok(sync_res) = sync_google_calendar_events_internal(&conn, None, None) {
                    let _ = app.emit("google-calendar-sync-event", sync_res);
                }
            }
        }
    });

    Ok(auth_url)
}
