//! 삼성 헬스 동기화 페이로드 처리.

use crate::*;

/// 삼성 헬스 & 갤럭시 워치 GPS 운동 데이터를 파싱하여 `mobile/health/{YYYY-MM}_운동기록.md` 및 `mobile/health/gpx/{YYYYMMDD_HHMMSS}_{종목}.gpx`로 변환 적재합니다.
pub(crate) fn process_samsung_health_sync_payload(
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
