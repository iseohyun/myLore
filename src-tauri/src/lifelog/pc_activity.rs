//! ActivityWatch(`aw-watcher-window`, `aw-watcher-afk`) 로컬 DB 연동 및 PC 활동 모니터링 수집/조회 모듈.

use crate::*;
use chrono::{Local, Timelike};
use rusqlite::OpenFlags;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcAppUsageItem {
    pub app_name: String,
    pub total_sec: f64,
    pub percentage: f64,
    pub event_count: usize,
    pub top_titles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcWindowTimelineEvent {
    pub id: i64,
    pub local_time: String,
    pub duration_sec: f64,
    pub app_name: String,
    pub window_title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcDailyUsageItem {
    pub date: String,
    pub total_window_sec: f64,
    pub not_afk_sec: f64,
    pub top_app: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PcActivitySummaryPayload {
    pub is_aw_available: bool,
    pub aw_db_path: String,
    pub hostname: String,
    pub target_date: String,
    pub synced_new_events: usize,
    pub total_stored_events: usize,
    pub total_window_sec: f64,
    pub active_not_afk_sec: f64,
    pub afk_sec: f64,
    pub event_count: usize,
    pub hourly_breakdown: Vec<f64>,
    pub top_apps: Vec<PcAppUsageItem>,
    pub recent_timeline: Vec<PcWindowTimelineEvent>,
    pub weekly_summary: Vec<PcDailyUsageItem>,
}

/// `%LOCALAPPDATA%\activitywatch\activitywatch\aw-server\peewee-sqlite.v2.db` 경로를 탐색합니다.
pub(crate) fn resolve_activitywatch_db_path() -> Option<PathBuf> {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let candidate = PathBuf::from(&local_app_data)
            .join("activitywatch")
            .join("activitywatch")
            .join("aw-server")
            .join("peewee-sqlite.v2.db");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let candidate = PathBuf::from(&user_profile)
            .join("AppData")
            .join("Local")
            .join("activitywatch")
            .join("activitywatch")
            .join("aw-server")
            .join("peewee-sqlite.v2.db");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn parse_aw_timestamp_to_local(raw_ts: &str) -> Option<(String, String, i64)> {
    let normalized = raw_ts.trim().replace(' ', "T");
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&normalized) {
        let local_dt = dt.with_timezone(&Local);
        return Some((
            local_dt.format("%Y-%m-%d").to_string(),
            local_dt.format("%H:%M:%S").to_string(),
            local_dt.hour() as i64,
        ));
    }
    None
}

/// ActivityWatch SQLite DB에서 최신 창/AFK 이벤트를 읽어 myLore DB(`pc_activity_events`)에 증분 동기화합니다.
pub(crate) fn sync_activitywatch_events_to_mylore(
    mylore_conn: &Connection,
) -> (bool, String, String, usize) {
    let Some(aw_path) = resolve_activitywatch_db_path() else {
        return (false, String::new(), String::new(), 0);
    };
    let aw_path_str = aw_path.to_string_lossy().to_string();

    let Ok(aw_conn) = Connection::open_with_flags(
        &aw_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return (false, aw_path_str, String::new(), 0);
    };
    let _ = aw_conn.busy_timeout(Duration::from_millis(1500));

    let max_stored_id: i64 = mylore_conn
        .query_row(
            "SELECT COALESCE(MAX(aw_event_id), 0) FROM pc_activity_events",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // 진행 중인 마지막 이벤트의 duration 갱신을 반영하기 위해 최근 50개 ID부터 다시 덮어씁니다.
    let fetch_since_id = if max_stored_id > 50 {
        max_stored_id - 50
    } else {
        0
    };

    let mut hostname_detected = String::new();
    let mut rows_to_insert: Vec<(
        i64,
        String,
        String,
        String,
        String,
        i64,
        String,
        f64,
        String,
        String,
        String,
    )> = Vec::new();

    let query_sql = if fetch_since_id == 0 {
        // 최초 동기화 시 최근 60일 이벤트 수집
        "SELECT e.id, b.type, b.hostname, e.timestamp, CAST(e.duration AS REAL), e.datastr
         FROM eventmodel e
         JOIN bucketmodel b ON e.bucket_id = b.key
         WHERE b.type IN ('currentwindow', 'afkstatus')
           AND e.timestamp >= datetime('now', '-60 days')
         ORDER BY e.id ASC"
    } else {
        "SELECT e.id, b.type, b.hostname, e.timestamp, CAST(e.duration AS REAL), e.datastr
         FROM eventmodel e
         JOIN bucketmodel b ON e.bucket_id = b.key
         WHERE b.type IN ('currentwindow', 'afkstatus')
           AND e.id >= ?1
         ORDER BY e.id ASC"
    };

    if let Ok(mut stmt) = aw_conn.prepare(query_sql) {
        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<(i64, String, String, String, f64, String)> {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        };

        let iter_res = if fetch_since_id == 0 {
            stmt.query_map([], map_row)
        } else {
            stmt.query_map(params![fetch_since_id], map_row)
        };

        if let Ok(rows) = iter_res {
            for r in rows.flatten() {
                let (id, bucket_type, hostname, ts_utc, duration_sec, datastr) = r;
                if hostname_detected.is_empty() && !hostname.is_empty() && hostname != "unknown" {
                    hostname_detected = hostname.clone();
                }
                let Some((local_date, local_time, local_hour)) =
                    parse_aw_timestamp_to_local(&ts_utc)
                else {
                    continue;
                };

                let mut app_name = String::new();
                let mut window_title = String::new();
                let mut afk_status = String::new();

                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&datastr) {
                    if bucket_type == "currentwindow" {
                        app_name = val
                            .get("app")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                        window_title = val
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                    } else if bucket_type == "afkstatus" {
                        afk_status = val
                            .get("status")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim()
                            .to_string();
                    }
                }

                rows_to_insert.push((
                    id,
                    bucket_type,
                    hostname,
                    local_date,
                    local_time,
                    local_hour,
                    ts_utc,
                    duration_sec.max(0.0),
                    app_name,
                    window_title,
                    afk_status,
                ));
            }
        }
    }

    let mut newly_added = 0usize;
    if !rows_to_insert.is_empty() {
        let _ = mylore_conn.execute_batch("BEGIN IMMEDIATE;");
        if let Ok(mut ins_stmt) = mylore_conn.prepare(
            "INSERT OR REPLACE INTO pc_activity_events
             (aw_event_id, bucket_type, hostname, local_date, local_time, local_hour, timestamp_utc, duration_sec, app_name, window_title, afk_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        ) {
            for item in &rows_to_insert {
                if item.0 > max_stored_id {
                    newly_added += 1;
                }
                let _ = ins_stmt.execute(params![
                    item.0, item.1, item.2, item.3, item.4, item.5, item.6, item.7, item.8,
                    item.9, item.10
                ]);
            }
        }
        let _ = mylore_conn.execute_batch("COMMIT;");
    }

    if hostname_detected.is_empty() {
        hostname_detected = mylore_conn
            .query_row(
                "SELECT hostname FROM pc_activity_events WHERE hostname != '' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "LocalPC".to_string());
    }

    (true, aw_path_str, hostname_detected, newly_added)
}

#[tauri::command]
pub(crate) fn get_pc_activity_summary(
    state: State<AppState>,
    date: Option<String>,
) -> Result<PcActivitySummaryPayload, String> {
    let conn = open_db(&state.db_path)?;
    let (is_aw_available, aw_db_path, hostname, synced_new_events) =
        sync_activitywatch_events_to_mylore(&conn);

    let target_date = date
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());

    let total_stored_events: usize = conn
        .query_row("SELECT COUNT(*) FROM pc_activity_events", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0) as usize;

    // 1. AFK / Not-AFK 합계
    let mut active_not_afk_sec = 0.0f64;
    let mut afk_sec = 0.0f64;
    if let Ok(mut stmt) = conn.prepare(
        "SELECT afk_status, COALESCE(SUM(duration_sec), 0.0)
         FROM pc_activity_events
         WHERE local_date = ?1 AND bucket_type = 'afkstatus'
         GROUP BY afk_status",
    ) {
        if let Ok(rows) = stmt.query_map(params![target_date], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        }) {
            for (st, dur) in rows.flatten() {
                if st == "not-afk" {
                    active_not_afk_sec += dur;
                } else if st == "afk" {
                    afk_sec += dur;
                }
            }
        }
    }

    // 2. 시간대별(0~23시) 창 활성 시간 집계
    let mut hourly_breakdown = vec![0.0f64; 24];
    if let Ok(mut stmt) = conn.prepare(
        "SELECT local_hour, COALESCE(SUM(duration_sec), 0.0)
         FROM pc_activity_events
         WHERE local_date = ?1 AND bucket_type = 'currentwindow'
         GROUP BY local_hour",
    ) {
        if let Ok(rows) = stmt.query_map(params![target_date], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))
        }) {
            for (hr, dur) in rows.flatten() {
                if (0..24).contains(&hr) {
                    hourly_breakdown[hr as usize] = dur;
                }
            }
        }
    }

    // 3. 앱별 사용 시간 및 주요 창 제목 집계
    let mut total_window_sec = 0.0f64;
    let mut event_count = 0usize;
    let mut app_map: HashMap<String, (f64, usize, HashMap<String, f64>)> = HashMap::new();
    let mut recent_timeline: Vec<PcWindowTimelineEvent> = Vec::new();

    if let Ok(mut stmt) = conn.prepare(
        "SELECT aw_event_id, local_time, duration_sec, app_name, window_title
         FROM pc_activity_events
         WHERE local_date = ?1 AND bucket_type = 'currentwindow'
         ORDER BY aw_event_id DESC",
    ) {
        if let Ok(rows) = stmt.query_map(params![target_date], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        }) {
            for r in rows.flatten() {
                let (id, local_time, dur, raw_app, title) = r;
                let app = if raw_app.trim().is_empty() {
                    "(알 수 없음)".to_string()
                } else {
                    raw_app
                };
                total_window_sec += dur;
                event_count += 1;

                let entry = app_map
                    .entry(app.clone())
                    .or_insert_with(|| (0.0, 0, HashMap::new()));
                entry.0 += dur;
                entry.1 += 1;
                if !title.trim().is_empty() {
                    *entry.2.entry(title.clone()).or_insert(0.0) += dur;
                }

                if dur >= 1.0 && recent_timeline.len() < 150 {
                    recent_timeline.push(PcWindowTimelineEvent {
                        id,
                        local_time,
                        duration_sec: dur,
                        app_name: app,
                        window_title: title,
                    });
                }
            }
        }
    }

    let mut top_apps: Vec<PcAppUsageItem> = app_map
        .into_iter()
        .map(|(app_name, (sec, cnt, titles_map))| {
            let mut titles_vec: Vec<(String, f64)> = titles_map.into_iter().collect();
            titles_vec.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let top_titles = titles_vec
                .into_iter()
                .take(3)
                .map(|(t, _)| t)
                .collect::<Vec<_>>();
            let percentage = if total_window_sec > 0.0 {
                (sec / total_window_sec) * 100.0
            } else {
                0.0
            };
            PcAppUsageItem {
                app_name,
                total_sec: sec,
                percentage,
                event_count: cnt,
                top_titles,
            }
        })
        .collect();
    top_apps.sort_by(|a, b| {
        b.total_sec
            .partial_cmp(&a.total_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    top_apps.truncate(15);

    // 4. 최근 7일 주간 요약
    let base_naive = chrono::NaiveDate::parse_from_str(&target_date, "%Y-%m-%d")
        .unwrap_or_else(|_| Local::now().date_naive());
    let mut weekly_summary: Vec<PcDailyUsageItem> = Vec::new();
    for offset in (0..7).rev() {
        let d = base_naive - chrono::Duration::days(offset);
        let d_str = d.format("%Y-%m-%d").to_string();
        let day_win_sec: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(duration_sec), 0.0)
                 FROM pc_activity_events
                 WHERE local_date = ?1 AND bucket_type = 'currentwindow'",
                params![d_str],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let day_not_afk_sec: f64 = conn
            .query_row(
                "SELECT COALESCE(SUM(duration_sec), 0.0)
                 FROM pc_activity_events
                 WHERE local_date = ?1 AND bucket_type = 'afkstatus' AND afk_status = 'not-afk'",
                params![d_str],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let top_app: String = conn
            .query_row(
                "SELECT app_name
                 FROM pc_activity_events
                 WHERE local_date = ?1 AND bucket_type = 'currentwindow' AND app_name != ''
                 GROUP BY app_name
                 ORDER BY SUM(duration_sec) DESC
                 LIMIT 1",
                params![d_str],
                |r| r.get(0),
            )
            .unwrap_or_default();
        weekly_summary.push(PcDailyUsageItem {
            date: d_str,
            total_window_sec: day_win_sec,
            not_afk_sec: day_not_afk_sec,
            top_app,
        });
    }

    Ok(PcActivitySummaryPayload {
        is_aw_available,
        aw_db_path,
        hostname,
        target_date,
        synced_new_events,
        total_stored_events,
        total_window_sec,
        active_not_afk_sec,
        afk_sec,
        event_count,
        hourly_breakdown,
        top_apps,
        recent_timeline,
        weekly_summary,
    })
}
