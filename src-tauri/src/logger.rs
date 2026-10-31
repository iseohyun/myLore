//! 통합 로그 수집기: 분야별 일자 로그 파일(`log/{분야}_{YYYYMMDD}.log`) 기록, 보관일 기준 자동 정리, 로그 대시보드(`Ctrl+\``) 스트리밍.
//!
//! 수집 분야 구분 및 기본 보관일:
//! - `comm` (`comm_YYYYMMDD.log`): 모바일 HTTP/UDP 통신, 동기화 세션 플랜/ACK 및 워커 적재 로그 (기본 7일)
//! - `version` (`version_YYYYMMDD.log`): 앱/프로토콜 버전, 대화방/도메인 워터마크 백필 및 버전 호환성 로그 (기본 30일)
//! - `system` (`system_YYYYMMDD.log`): 서버 기동, NAT Wi-Fi SSID 탐지, DB/볼트/설정 시스템 로그 (기본 30일)
//! - `ai` (`ai_YYYYMMDD.log`): Gemini API 통화 녹음 스크립트 추출·토큰·쿼터 로그 (기본 30일)

use crate::*;
use std::collections::VecDeque;
use std::io::Write;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogEntry {
    pub id: u64,
    pub timestamp: String,
    pub service: String, // "comm" | "version" | "system" | "ai"
    pub level: String,   // "INFO" | "WARN" | "ERROR"
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogsPayload {
    pub log_dir_path: String,
    pub entries: Vec<ServiceLogEntry>,
    pub log_files: Vec<String>,
    pub retention_comm_days: u32,
    pub retention_version_days: u32,
    pub retention_system_days: u32,
    pub retention_ai_days: u32,
}

static LOG_DIR_CACHE: std::sync::OnceLock<Mutex<PathBuf>> = std::sync::OnceLock::new();
static LOG_APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
static LOG_SEQ_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static DISK_LOGS_LOADED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static RECENT_LOGS_BUFFER: std::sync::OnceLock<Mutex<VecDeque<ServiceLogEntry>>> =
    std::sync::OnceLock::new();

const MAX_LOGS_PER_DOMAIN: usize = 250;
const MAX_IN_MEMORY_LOGS: usize = 1000;

/// 로그 폴더 경로(`%APPDATA%\com.iseohyun.mylore\logs`)를 반환합니다.
pub(crate) fn resolve_log_dir(conn_opt: Option<&Connection>) -> PathBuf {
    let lock = LOG_DIR_CACHE.get_or_init(|| Mutex::new(PathBuf::new()));
    if let Ok(mut guard) = lock.lock() {
        if !guard.as_os_str().is_empty() {
            let _ = fs::create_dir_all(&*guard);
            return guard.clone();
        }
        let log_dir = app_logs_dir();
        let _ = fs::create_dir_all(&log_dir);
        if let Some(conn) = conn_opt {
            migrate_legacy_logs_if_needed(conn, &log_dir);
        }
        *guard = log_dir.clone();
        return log_dir;
    }
    let fallback = app_logs_dir();
    let _ = fs::create_dir_all(&fallback);
    fallback
}

/// 기존 `{projects_base}/.myLore/log/*.log` 파일들이 존재하면 `%APPDATA%\com.iseohyun.mylore\logs`로 자동 이전합니다.
fn migrate_legacy_logs_if_needed(conn: &Connection, target_log_dir: &Path) {
    let legacy_dir = PathBuf::from(projects_base_path_string(conn))
        .join(".myLore")
        .join("log");
    if !legacy_dir.is_dir() || legacy_dir == target_log_dir {
        return;
    }
    let _ = fs::create_dir_all(target_log_dir);
    let Ok(entries) = fs::read_dir(&legacy_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let src_path = entry.path();
        if !src_path.is_file() {
            continue;
        }
        let Some(fname) = src_path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !fname.ends_with(".log") {
            continue;
        }
        let dst_path = target_log_dir.join(fname);
        if !dst_path.exists() {
            if fs::rename(&src_path, &dst_path).is_err() {
                if fs::copy(&src_path, &dst_path).is_ok() {
                    let _ = fs::remove_file(&src_path);
                }
            }
        } else {
            // 이미 대상 파일이 있으면 레거시 로그 내용을 앞에 병합한 뒤 레거시 파일 제거
            let legacy_text = fs::read_to_string(&src_path).unwrap_or_default();
            let current_text = fs::read_to_string(&dst_path).unwrap_or_default();
            if !legacy_text.trim().is_empty() && !current_text.contains(legacy_text.lines().next().unwrap_or("")) {
                let merged = if current_text.trim().is_empty() {
                    legacy_text
                } else {
                    format!("{}\n{}", legacy_text.trim_end(), current_text.trim_start())
                };
                if fs::write(&dst_path, merged.as_bytes()).is_ok() {
                    let _ = fs::remove_file(&src_path);
                }
            } else {
                let _ = fs::remove_file(&src_path);
            }
        }
    }
    // 빈 폴더가 되었으면 레거시 log 폴더 정리
    let _ = fs::remove_dir(&legacy_dir);
}

/// 로그 폴더 캐시를 `%APPDATA%\com.iseohyun.mylore\logs`로 갱신하고 레거시 로그를 자동 이전합니다.
pub(crate) fn refresh_log_dir_cache(conn: &Connection) -> PathBuf {
    let lock = LOG_DIR_CACHE.get_or_init(|| Mutex::new(PathBuf::new()));
    let next_dir = app_logs_dir();
    let _ = fs::create_dir_all(&next_dir);
    migrate_legacy_logs_if_needed(conn, &next_dir);
    if let Ok(mut guard) = lock.lock() {
        *guard = next_dir.clone();
    }
    next_dir
}

/// 앱 시작 시 로거 핸들을 등록하고, 오늘자 로그 파일들의 최근 라인을 인메모리 버퍼로 읽어온 뒤 만료된 로그를 정리합니다.
pub(crate) fn init_logger_and_prune(app_handle: &AppHandle, db_path: &Path) {
    let _ = LOG_APP_HANDLE.set(app_handle.clone());
    if let Ok(conn) = open_db(db_path) {
        let log_dir = refresh_log_dir_cache(&conn);
        load_today_logs_into_memory(&log_dir);
        let settings = load_settings_from_conn(&conn);
        let pruned = prune_logs_in_dir(&log_dir, &settings);
        log_version(
            "INFO",
            &format!(
                "myLore v{} 기동 — 모바일 동기화 프로토콜 v2.0 (session-plan / complete / ack) 및 4대 분야 로그 수집(통신 {}일 · 버전 {}일 · 시스템 {}일 · AI {}일) 활성화",
                env!("CARGO_PKG_VERSION"),
                settings.log_retention_comm_days,
                settings.log_retention_version_days,
                settings.log_retention_system_days,
                settings.log_retention_ai_days
            ),
        );
        if pruned > 0 {
            append_service_log(
                "system",
                "INFO",
                &format!("보관 주기가 지난 로그 파일 {}개를 자동 정리했습니다.", pruned),
            );
        }
    }
}

fn normalize_log_domain(service: &str) -> &'static str {
    match service.trim().to_ascii_lowercase().as_str() {
        "comm" | "sync" => "comm",
        "version" => "version",
        "ai" | "gemini" => "ai",
        _ => "system",
    }
}

fn load_settings_from_conn(conn: &Connection) -> MyLoreAppSettings {
    let setting_path = resolve_projects_setting_json_path(conn);
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                return parsed;
            }
        }
    }
    MyLoreAppSettings::default()
}

fn load_today_logs_into_memory(log_dir: &Path) {
    if DISK_LOGS_LOADED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let buf_lock = RECENT_LOGS_BUFFER
        .get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_IN_MEMORY_LOGS)));
    let Ok(mut guard) = buf_lock.lock() else {
        return;
    };

    let mut loaded: Vec<ServiceLogEntry> = guard.drain(..).collect();
    for service in ["comm", "version", "system", "ai", "sync", "gemini"] {
        let file_path = log_dir.join(format!("{}_{}.log", service, today));
        if !file_path.is_file() {
            continue;
        }
        let normalized_svc = normalize_log_domain(service);
        if let Ok(raw) = fs::read_to_string(&file_path) {
            let lines: Vec<&str> = raw.lines().collect();
            let start = lines.len().saturating_sub(MAX_LOGS_PER_DOMAIN);
            for line in &lines[start..] {
                if let Some(entry) = parse_log_file_line(normalized_svc, line) {
                    loaded.push(entry);
                }
            }
        }
    }
    loaded.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    for mut item in loaded {
        item.id = LOG_SEQ_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        guard.push_back(item);
    }
}

fn parse_log_file_line(default_service: &str, line: &str) -> Option<ServiceLogEntry> {
    // 형식: [2026-10-31 11:55:28.123] [INFO] [comm] 메시지
    let t = line.trim();
    if !t.starts_with('[') {
        return None;
    }
    let close_ts = t.find(']')?;
    let timestamp = t[1..close_ts].trim().to_string();
    let rest1 = t[close_ts + 1..].trim();
    if !rest1.starts_with('[') {
        return Some(ServiceLogEntry {
            id: 0,
            timestamp,
            service: normalize_log_domain(default_service).to_string(),
            level: "INFO".to_string(),
            message: rest1.to_string(),
        });
    }
    let close_lvl = rest1.find(']')?;
    let level = rest1[1..close_lvl].trim().to_string();
    let rest2 = rest1[close_lvl + 1..].trim();
    if rest2.starts_with('[') {
        if let Some(close_svc) = rest2.find(']') {
            let svc = normalize_log_domain(&rest2[1..close_svc]).to_string();
            let msg = rest2[close_svc + 1..].trim().to_string();
            return Some(ServiceLogEntry {
                id: 0,
                timestamp,
                service: svc,
                level,
                message: msg,
            });
        }
    }
    Some(ServiceLogEntry {
        id: 0,
        timestamp,
        service: normalize_log_domain(default_service).to_string(),
        level,
        message: rest2.to_string(),
    })
}

/// 분야별 로그를 `log/{분야}_{YYYYMMDD}.log` 파일에 즉시 append 하고, 인메모리 링버퍼 및 프론트엔드 이벤트(`mylore-log-entry`)로 발행합니다.
pub(crate) fn append_service_log(service: &str, level: &str, message: &str) {
    let domain = normalize_log_domain(service);
    let now = chrono::Local::now();
    let date_tag = now.format("%Y%m%d").to_string();
    let ts_str = now.format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    let clean_msg = message.replace('\r', " ").replace('\n', " ");

    let log_dir = resolve_log_dir(None);
    let file_path = log_dir.join(format!("{}_{}.log", domain, date_tag));
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
    {
        let _ = writeln!(file, "[{}] [{}] [{}] {}", ts_str, level, domain, clean_msg);
    }

    let entry = ServiceLogEntry {
        id: LOG_SEQ_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        timestamp: ts_str,
        service: domain.to_string(),
        level: level.to_string(),
        message: clean_msg,
    };

    let buf_lock = RECENT_LOGS_BUFFER
        .get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_IN_MEMORY_LOGS)));
    if let Ok(mut guard) = buf_lock.lock() {
        // 해당 도메인(comm/version/system/ai)의 로그 개수만 체크하여 다른 도메인(예: ai) 로그가 밀려나지 않도록 보호
        let domain_count = guard.iter().filter(|e| e.service == domain).count();
        if domain_count >= MAX_LOGS_PER_DOMAIN {
            if let Some(pos) = guard.iter().position(|e| e.service == domain) {
                guard.remove(pos);
            }
        }
        guard.push_back(entry.clone());
    }

    if let Some(app) = LOG_APP_HANDLE.get() {
        let _ = app.emit("mylore-log-entry", &entry);
    }
}

pub(crate) fn log_comm(level: &str, msg: &str) {
    append_service_log("comm", level, msg);
}

pub(crate) fn log_version(level: &str, msg: &str) {
    append_service_log("version", level, msg);
}

pub(crate) fn log_system(level: &str, msg: &str) {
    append_service_log("system", level, msg);
}

pub(crate) fn log_ai(level: &str, msg: &str) {
    append_service_log("ai", level, msg);
}

pub(crate) fn log_sync(level: &str, msg: &str) {
    append_service_log("comm", level, msg);
}

pub(crate) fn log_gemini(level: &str, msg: &str) {
    log_ai(level, msg);
}

/// 설정된 분야별 보관일(`comm` 기본 7일, `version`/`system`/`ai` 기본 30일)이 지난
/// `{분야}_{YYYYMMDD}.log` 파일을 삭제합니다.
pub(crate) fn prune_logs_in_dir(log_dir: &Path, settings: &MyLoreAppSettings) -> usize {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return 0;
    };
    let today_date = chrono::Local::now().date_naive();
    let mut removed = 0usize;

    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let Some(fname) = p.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !fname.ends_with(".log") {
            continue;
        }
        let stem = &fname[..fname.len() - 4];
        let Some((svc, date_part)) = stem.rsplit_once('_') else {
            continue;
        };
        if date_part.len() != 8 {
            continue;
        }
        let Ok(file_date) = chrono::NaiveDate::parse_from_str(date_part, "%Y%m%d") else {
            continue;
        };
        let retention_days = match normalize_log_domain(svc) {
            "comm" => settings.log_retention_comm_days.max(1) as i64,
            "version" => settings.log_retention_version_days.max(1) as i64,
            "system" => settings.log_retention_system_days.max(1) as i64,
            "ai" => settings.log_retention_ai_days.max(1) as i64,
            _ => settings.log_retention_system_days.max(1) as i64,
        };
        let age_days = (today_date - file_date).num_days();
        if age_days >= retention_days {
            if fs::remove_file(&p).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

fn build_service_logs_payload(
    conn: &Connection,
    service_filter: Option<&str>,
    limit: Option<usize>,
) -> ServiceLogsPayload {
    let log_dir = refresh_log_dir_cache(conn);
    load_today_logs_into_memory(&log_dir);
    let settings = load_settings_from_conn(conn);

    let max_items = limit.unwrap_or(1000).clamp(20, 1000);
    let filter_trimmed = service_filter
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    let normalized_filter = if filter_trimmed.is_empty() || filter_trimmed == "all" {
        String::new()
    } else {
        normalize_log_domain(&filter_trimmed).to_string()
    };

    let buf_lock = RECENT_LOGS_BUFFER
        .get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_IN_MEMORY_LOGS)));
    let entries: Vec<ServiceLogEntry> = if let Ok(guard) = buf_lock.lock() {
        if normalized_filter.is_empty() {
            // 전체 조회 시에도 도메인별로 최대 MAX_LOGS_PER_DOMAIN개씩 모두 포함하여 특정 도메인(comm/system) 폭주로 ai/version 로그가 누락되지 않게 함
            let all_items: Vec<ServiceLogEntry> = guard.iter().cloned().collect();
            let start = all_items.len().saturating_sub(max_items.max(MAX_IN_MEMORY_LOGS));
            all_items[start..].to_vec()
        } else {
            let filtered: Vec<ServiceLogEntry> = guard
                .iter()
                .filter(|e| e.service.eq_ignore_ascii_case(&normalized_filter))
                .cloned()
                .collect();
            let start = filtered.len().saturating_sub(max_items);
            filtered[start..].to_vec()
        }
    } else {
        Vec::new()
    };

    let mut log_files: Vec<String> = Vec::new();
    if let Ok(rd) = fs::read_dir(&log_dir) {
        for e in rd.flatten() {
            if let Some(name) = e.file_name().to_str() {
                if name.ends_with(".log") {
                    log_files.push(name.to_string());
                }
            }
        }
    }
    log_files.sort();
    log_files.reverse();

    ServiceLogsPayload {
        log_dir_path: log_dir.to_string_lossy().to_string(),
        entries,
        log_files,
        retention_comm_days: settings.log_retention_comm_days,
        retention_version_days: settings.log_retention_version_days,
        retention_system_days: settings.log_retention_system_days,
        retention_ai_days: settings.log_retention_ai_days,
    }
}

#[tauri::command]
pub(crate) fn get_service_logs(
    state: State<AppState>,
    service_filter: Option<String>,
    limit: Option<usize>,
) -> Result<ServiceLogsPayload, String> {
    let conn = open_db(&state.db_path)?;
    Ok(build_service_logs_payload(
        &conn,
        service_filter.as_deref(),
        limit,
    ))
}

#[tauri::command]
pub(crate) fn clear_service_logs(
    state: State<AppState>,
    service_filter: Option<String>,
) -> Result<ServiceLogsPayload, String> {
    let conn = open_db(&state.db_path)?;
    let log_dir = refresh_log_dir_cache(&conn);
    let filter_trimmed = service_filter
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    let normalized_filter = if filter_trimmed.is_empty() || filter_trimmed == "all" {
        String::new()
    } else {
        normalize_log_domain(&filter_trimmed).to_string()
    };

    let buf_lock = RECENT_LOGS_BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_IN_MEMORY_LOGS)));
    if let Ok(mut guard) = buf_lock.lock() {
        if normalized_filter.is_empty() {
            guard.clear();
        } else {
            guard.retain(|e| !e.service.eq_ignore_ascii_case(&normalized_filter));
        }
    }

    let today = chrono::Local::now().format("%Y%m%d").to_string();
    let targets: Vec<&str> = if normalized_filter.is_empty() {
        vec!["comm", "version", "system", "ai", "sync", "gemini"]
    } else {
        vec![normalized_filter.as_str()]
    };
    for svc in targets {
        let p = log_dir.join(format!("{}_{}.log", svc, today));
        if p.exists() {
            let _ = fs::write(&p, b"");
        }
    }

    Ok(build_service_logs_payload(
        &conn,
        service_filter.as_deref(),
        None,
    ))
}

#[tauri::command]
pub(crate) fn prune_expired_service_logs(state: State<AppState>) -> Result<usize, String> {
    let conn = open_db(&state.db_path)?;
    let log_dir = refresh_log_dir_cache(&conn);
    let settings = load_settings_from_conn(&conn);
    let removed = prune_logs_in_dir(&log_dir, &settings);
    let msg = format!(
        "보관 주기(통신 {}일 · 버전 {}일 · 시스템 {}일 · AI {}일) 기준 만료 로그 {}개 정리 완료",
        settings.log_retention_comm_days,
        settings.log_retention_version_days,
        settings.log_retention_system_days,
        settings.log_retention_ai_days,
        removed
    );
    log_system("INFO", &msg);
    Ok(removed)
}
