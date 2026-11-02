//! M#1 Step 1 (미디어 원본 origin 해시 DB화 및 중복 방지 추적) 및
//! M#4 Step 1·2 (모바일 GPS · Wi-Fi 동선 로깅 수집 및 지도 어플 연동 동선 추적).

use crate::*;

/// 미디어 원본(`origin`) 데이터를 `media_origin_registry`에 등록합니다.
/// 이미 등록된 `origin_hash`가 있으면 원본 메타(`origin_file_name`, `first_synced_at`)는 보존하고
/// 현재 경로만 최신화합니다.
pub(crate) fn upsert_media_origin_record(
    conn: &Connection,
    origin_hash: &str,
    blake3_hash: &str,
    file_name: &str,
    file_size: u64,
    dev_id: &str,
    dev_name: &str,
    taken_date: &str,
    taken_time: &str,
    current_path: &str,
) {
    let clean_hash = origin_hash.trim();
    if clean_hash.is_empty() {
        return;
    }
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let eff_dev_name = if dev_name.trim().is_empty() {
        "SM-S901N"
    } else {
        dev_name.trim()
    };

    let _ = conn.execute(
        "INSERT INTO media_origin_registry (
            origin_hash, blake3_hash, origin_file_name, origin_file_size,
            device_id, device_name, taken_date, taken_time,
            current_status, current_path, current_hash, history_note,
            first_synced_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'original', ?9, ?1, '최초 원본 수신', ?10, ?10)
        ON CONFLICT(origin_hash) DO UPDATE SET
            blake3_hash = CASE WHEN excluded.blake3_hash != '' THEN excluded.blake3_hash ELSE media_origin_registry.blake3_hash END,
            current_path = CASE WHEN media_origin_registry.current_status = 'original' THEN excluded.current_path ELSE media_origin_registry.current_path END,
            updated_at = excluded.updated_at",
        params![
            clean_hash,
            blake3_hash.trim(),
            file_name,
            file_size as i64,
            dev_id.trim(),
            eff_dev_name,
            taken_date,
            taken_time,
            current_path,
            now_str
        ],
    );
}

/// `check-hashes` 요청 시 해당 해시가 `media_origin_registry`에(원본 유지·편집·이름변경·삭제 차단 포함)
/// 등록되어 있는지 확인합니다.
pub(crate) fn is_hash_in_origin_registry(conn: &Connection, hash: &str) -> bool {
    let clean = hash.trim();
    if clean.is_empty() {
        return false;
    }
    conn.query_row(
        "SELECT 1 FROM media_origin_registry
         WHERE origin_hash = ?1 OR blake3_hash = ?1 OR current_hash = ?1
         LIMIT 1",
        params![clean],
        |_| Ok(true),
    )
    .unwrap_or(false)
}

/// 기존 `media_inbox`(`status = 'device_photo'`) 레코드들을 `media_origin_registry`로 백필하고,
/// 디스크 상의 파일 존재/변경/이름변경/삭제 상태를 점검하여 추적 테이블을 최신화합니다.
pub(crate) fn reconcile_media_origin_registry_with_disk(
    conn: &Connection,
) -> MediaOriginRegistrySummary {
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 1. media_inbox(device_photo) 중 아직 media_origin_registry에 없는 항목 백필
    let _ = conn.execute(
        "INSERT OR IGNORE INTO media_origin_registry (
            origin_hash, blake3_hash, origin_file_name, origin_file_size,
            device_id, device_name, taken_date, taken_time,
            current_status, current_path, current_hash, history_note,
            first_synced_at, updated_at
        )
        SELECT
            content_hash, '', file_name, file_size,
            '', 'SM-S901N', taken_date, taken_time,
            'original', full_path, content_hash, '기존 사진첩 백필 등록',
            ?1, ?1
        FROM media_inbox
        WHERE status = 'device_photo' AND content_hash != ''",
        params![now_str],
    );

    // 2. 등록된 레코드들의 디스크 상태 점검 (파일 크기 변화 -> edited, 파일 삭제 -> deleted 및 synced_file_hashes 유지)
    let mut rows_to_check: Vec<(String, String, i64, String, String)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT origin_hash, origin_file_name, origin_file_size, current_status, current_path
         FROM media_origin_registry",
    ) {
        if let Ok(iter) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        }) {
            rows_to_check = iter.flatten().collect();
        }
    }

    for (orig_hash, orig_name, orig_size, cur_status, cur_path) in rows_to_check {
        // 원본 해시가 항상 synced_file_hashes에 남아 있어 모바일 재수신을 차단하도록 보장
        let _ = conn.execute(
            "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
             VALUES (?1, ?2, ?3)",
            params![orig_hash, orig_name, now_str],
        );
        mark_hash_synced_in_memory(&orig_hash);

        if cur_path.trim().is_empty() {
            continue;
        }
        let p = Path::new(&cur_path);
        if p.exists() && p.is_file() {
            if let Ok(meta) = fs::metadata(p) {
                let disk_size = meta.len() as i64;
                if orig_size > 0 && disk_size != orig_size && cur_status == "original" {
                    let new_hash = fs::read(p)
                        .ok()
                        .map(|b| sha256_hex(&b))
                        .unwrap_or_else(|| orig_hash.clone());
                    let _ = conn.execute(
                        "UPDATE media_origin_registry
                         SET current_status = 'edited',
                             current_hash = ?1,
                             history_note = ?2,
                             updated_at = ?3
                         WHERE origin_hash = ?4",
                        params![
                            new_hash,
                            format!(
                                "파일 편집/용량 변경 감지 ({}B → {}B · 원본 해시 보존)",
                                orig_size, disk_size
                            ),
                            now_str,
                            orig_hash
                        ],
                    );
                } else if cur_status == "deleted" {
                    let _ = conn.execute(
                        "UPDATE media_origin_registry
                         SET current_status = 'original',
                             history_note = '파일 복원 확인됨',
                             updated_at = ?1
                         WHERE origin_hash = ?2",
                        params![now_str, orig_hash],
                    );
                }
            }
        } else if cur_status == "original" || cur_status == "renamed" {
            let _ = conn.execute(
                "UPDATE media_origin_registry
                 SET current_status = 'deleted',
                     history_note = '디스크에서 삭제/이동됨 (원본 해시 DB 보존으로 중복 재수신 차단됨)',
                     updated_at = ?1
                 WHERE origin_hash = ?2",
                params![now_str, orig_hash],
            );
        }
    }

    build_media_origin_summary(conn)
}

pub(crate) fn build_media_origin_summary(conn: &Connection) -> MediaOriginRegistrySummary {
    let mut total_origin_count = 0usize;
    let mut original_kept_count = 0usize;
    let mut edited_or_renamed_count = 0usize;
    let mut deleted_blocked_count = 0usize;

    if let Ok(mut stmt) = conn.prepare(
        "SELECT current_status, COUNT(*) FROM media_origin_registry GROUP BY current_status",
    ) {
        if let Ok(iter) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize))
        }) {
            for (st, cnt) in iter.flatten() {
                total_origin_count += cnt;
                match st.as_str() {
                    "original" => original_kept_count += cnt,
                    "edited" | "renamed" | "archived" => edited_or_renamed_count += cnt,
                    "deleted" => deleted_blocked_count += cnt,
                    _ => original_kept_count += cnt,
                }
            }
        }
    }

    let mut items = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT origin_hash, origin_file_name, origin_file_size, device_name,
                taken_date, taken_time, current_status, current_path, current_hash,
                history_note, first_synced_at, updated_at
         FROM media_origin_registry
         ORDER BY taken_date DESC, taken_time DESC, updated_at DESC
         LIMIT 200",
    ) {
        if let Ok(iter) = stmt.query_map([], |r| {
            Ok(MediaOriginRegistryItem {
                origin_hash: r.get(0)?,
                origin_file_name: r.get(1)?,
                origin_file_size: r.get::<_, i64>(2).unwrap_or(0).max(0) as u64,
                device_name: r.get(3)?,
                taken_date: r.get(4)?,
                taken_time: r.get(5)?,
                current_status: r.get(6)?,
                current_path: r.get(7)?,
                current_hash: r.get(8)?,
                history_note: r.get(9)?,
                first_synced_at: r.get(10)?,
                updated_at: r.get(11)?,
            })
        }) {
            items = iter.flatten().collect();
        }
    }

    MediaOriginRegistrySummary {
        total_origin_count,
        original_kept_count,
        edited_or_renamed_count,
        deleted_blocked_count,
        items,
    }
}

#[tauri::command]
pub(crate) fn get_media_origin_registry_summary(
    state: State<'_, AppState>,
    rescan_disk: Option<bool>,
) -> Result<MediaOriginRegistrySummary, String> {
    let conn = open_db(&state.db_path)?;
    if rescan_disk.unwrap_or(false) {
        Ok(reconcile_media_origin_registry_with_disk(&conn))
    } else {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM media_origin_registry", [], |r| r.get(0))
            .unwrap_or(0);
        if count == 0 {
            Ok(reconcile_media_origin_registry_with_disk(&conn))
        } else {
            Ok(build_media_origin_summary(&conn))
        }
    }
}

#[tauri::command]
pub(crate) fn update_media_origin_status(
    state: State<'_, AppState>,
    origin_hash: String,
    status: String,
    note: Option<String>,
    delete_disk_file: Option<bool>,
) -> Result<MediaOriginRegistrySummary, String> {
    let conn = open_db(&state.db_path)?;
    let clean_hash = origin_hash.trim();
    if clean_hash.is_empty() {
        return Err("origin_hash가 비어 있습니다.".to_string());
    }
    let clean_status = match status.trim() {
        "original" | "edited" | "renamed" | "deleted" | "archived" => status.trim().to_string(),
        _ => "edited".to_string(),
    };
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if delete_disk_file.unwrap_or(false) {
        if let Ok(cur_path) = conn.query_row(
            "SELECT current_path FROM media_origin_registry WHERE origin_hash = ?1",
            params![clean_hash],
            |r| r.get::<_, String>(0),
        ) {
            if !cur_path.trim().is_empty() {
                let p = Path::new(&cur_path);
                if p.exists() && p.is_file() {
                    let _ = fs::remove_file(p);
                }
            }
        }
        let _ = conn.execute(
            "DELETE FROM media_inbox WHERE content_hash = ?1",
            params![clean_hash],
        );
    }

    let eff_note = note.unwrap_or_else(|| match clean_status.as_str() {
        "deleted" => "사용자 삭제 처리 (원본 해시 보존 · 모바일 재다운로드 영구 차단)".to_string(),
        "edited" => "편집/가공본 대체 완료 (원본 재수신 차단)".to_string(),
        _ => format!("상태 변경: {}", clean_status),
    });

    let _ = conn.execute(
        "UPDATE media_origin_registry
         SET current_status = ?1,
             history_note = ?2,
             updated_at = ?3
         WHERE origin_hash = ?4",
        params![clean_status, eff_note, now_str, clean_hash],
    );

    Ok(build_media_origin_summary(&conn))
}

// ============================================================================
// M#4 Step 1 & Step 2: 모바일 GPS · Wi-Fi 동선 로깅 수집 및 지도 어플 연동 동선 추적
// ============================================================================

pub(crate) fn classify_place_label_from_wifi_or_coord(
    wifi_ssid: &str,
    place_hint: &str,
    lat: f64,
    lng: f64,
) -> String {
    let hint = place_hint.trim();
    if !hint.is_empty() {
        return hint.to_string();
    }
    let ssid_lower = wifi_ssid.trim().to_lowercase();
    if !ssid_lower.is_empty() {
        if ssid_lower.contains("home")
            || ssid_lower.contains("house")
            || ssid_lower.contains("geoje")
            || ssid_lower.contains("거제")
            || ssid_lower.contains("iseoh")
            || ssid_lower.contains("kt_giga")
            || ssid_lower.contains("sk_")
            || ssid_lower.contains("u+")
        {
            return format!("🏠 홈/거점 Wi-Fi ({})", wifi_ssid.trim());
        }
        if ssid_lower.contains("office")
            || ssid_lower.contains("work")
            || ssid_lower.contains("corp")
            || ssid_lower.contains("회사")
        {
            return format!("🏢 회사 Wi-Fi ({})", wifi_ssid.trim());
        }
        if ssid_lower.contains("swim")
            || ssid_lower.contains("pool")
            || ssid_lower.contains("수영")
            || ssid_lower.contains("체육")
            || ssid_lower.contains("콤플렉스")
        {
            return format!("🏊 수영장 Wi-Fi ({})", wifi_ssid.trim());
        }
        return format!("📶 Wi-Fi 접속 ({})", wifi_ssid.trim());
    }

    // 거제/주요 반경 대략적 좌표 판별 또는 일반 GPS 좌표 표시
    if lat.abs() > 0.0001 && lng.abs() > 0.0001 {
        return format!("📍 GPS 위치 ({:.5}, {:.5})", lat, lng);
    }
    "📍 위치/동선 이벤트".to_string()
}

pub(crate) fn build_map_tracking_urls(
    place_label: &str,
    wifi_ssid: &str,
    lat: f64,
    lng: f64,
) -> (String, String) {
    let has_coord = lat.abs() > 0.0001 && lng.abs() > 0.0001;
    if has_coord {
        // 네이버 지도: 위경도 좌표 중심 뷰어 및 검색 연동 / 구글 지도: 정확한 좌표 핀
        let naver_url = format!(
            "https://map.naver.com/p?c={:.6},{:.6},16,0,0,0,dh",
            lng, lat
        );
        let google_url = format!("https://www.google.com/maps?q={:.6},{:.6}", lat, lng);
        (naver_url, google_url)
    } else {
        let clean_q = if !place_label.trim().is_empty() {
            place_label
                .replace("🏠", "")
                .replace("🏢", "")
                .replace("🏊", "")
                .replace("📶", "")
                .replace("📍", "")
                .trim()
                .to_string()
        } else if !wifi_ssid.trim().is_empty() {
            wifi_ssid.trim().to_string()
        } else {
            "거제".to_string()
        };
        let encoded = clean_q.replace(' ', "%20");
        (
            format!("https://map.naver.com/p/search/{}", encoded),
            format!("https://www.google.com/maps/search/?api=1&query={}", encoded),
        )
    }
}

pub(crate) fn insert_location_movement_log(
    conn: &Connection,
    dev_id: &str,
    dev_name: &str,
    event_type: &str,
    place_label: &str,
    wifi_ssid: &str,
    wifi_bssid: &str,
    latitude: f64,
    longitude: f64,
    accuracy_m: f64,
    battery_pct: i32,
    ts_ms: i64,
) -> bool {
    let eff_ts = if ts_ms > 0 {
        ts_ms
    } else {
        chrono::Local::now().timestamp_millis()
    };
    let (log_date, log_time) = epoch_ms_to_local_date_time(eff_ts);
    let eff_place =
        classify_place_label_from_wifi_or_coord(wifi_ssid, place_label, latitude, longitude);
    let eff_event = if event_type.trim().is_empty() {
        if !wifi_ssid.trim().is_empty() {
            "wifi_connect"
        } else {
            "gps_passive"
        }
    } else {
        event_type.trim()
    };

    // 1분 단위 버킷 + 이벤트/SSID/좌표 조합으로 중복 방지 키 생성
    let minute_bucket = eff_ts / 60_000;
    let dedup_raw = format!(
        "loc|{}|{}|{}|{:.4}|{:.4}|{}",
        dev_id.trim(),
        eff_event,
        wifi_ssid.trim(),
        latitude,
        longitude,
        minute_bucket
    );
    let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

    let inserted = conn
        .execute(
            "INSERT OR IGNORE INTO lifelog_location_logs (
                device_id, device_name, event_type, place_label,
                wifi_ssid, wifi_bssid, latitude, longitude, accuracy_m,
                battery_pct, log_date, log_time, timestamp_ms, dedup_key
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                dev_id.trim(),
                dev_name.trim(),
                eff_event,
                eff_place,
                wifi_ssid.trim(),
                wifi_bssid.trim(),
                latitude,
                longitude,
                accuracy_m,
                battery_pct,
                log_date,
                log_time,
                eff_ts,
                dedup_key
            ],
        )
        .unwrap_or(0)
        > 0;

    if inserted {
        let coord_part = if latitude.abs() > 0.0001 && longitude.abs() > 0.0001 {
            format!(" · GPS({:.5}, {:.5})", latitude, longitude)
        } else {
            String::new()
        };
        let wifi_part = if !wifi_ssid.trim().is_empty() {
            format!(" · SSID: {}", wifi_ssid.trim())
        } else {
            String::new()
        };
        let bat_part = if (0..=100).contains(&battery_pct) {
            format!(" · 🔋{}%", battery_pct)
        } else {
            String::new()
        };
        let msg_text = format!(
            "[동선/{}] {}{}{}{}",
            eff_event, eff_place, wifi_part, coord_part, bat_part
        );
        let msg_dedup = format!("noti_loc_{}", dedup_key);
        let _ = conn.execute(
            "INSERT OR IGNORE INTO lifelog_messages
             (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
             VALUES ('notification', '📍 동선·Wi-Fi 로거', ?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)",
            params![
                eff_place,
                msg_text,
                log_date,
                log_time,
                msg_dedup,
                dev_id.trim(),
                dev_name.trim()
            ],
        );
    }

    inserted
}

pub(crate) fn query_location_movement_summary(
    conn: &Connection,
    date_filter: Option<&str>,
    limit: usize,
) -> LocationMovementSummary {
    // 만약 lifelog_location_logs 가 아직 비어있다면 현재 페어링된 Wi-Fi / 알림 기반 초기 동선 포인트 시드 점검
    let total_in_db: i64 = conn
        .query_row("SELECT COUNT(*) FROM lifelog_location_logs", [], |r| r.get(0))
        .unwrap_or(0);
    if total_in_db == 0 {
        seed_initial_location_logs_from_existing_data(conn);
    }

    let total_logs = conn
        .query_row("SELECT COUNT(*) FROM lifelog_location_logs", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0) as usize;
    let wifi_logs_count = conn
        .query_row(
            "SELECT COUNT(*) FROM lifelog_location_logs WHERE wifi_ssid != '' OR event_type LIKE 'wifi%'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) as usize;
    let gps_logs_count = conn
        .query_row(
            "SELECT COUNT(*) FROM lifelog_location_logs WHERE ABS(latitude) > 0.0001 AND ABS(longitude) > 0.0001",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) as usize;

    let mut distinct_places = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT DISTINCT place_label FROM lifelog_location_logs WHERE place_label != '' ORDER BY id DESC LIMIT 20",
    ) {
        if let Ok(iter) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            distinct_places = iter.flatten().collect();
        }
    }

    let mut logs = Vec::new();
    let clean_date = date_filter.map(|s| s.trim()).filter(|s| !s.is_empty());
    let sql = if clean_date.is_some() {
        "SELECT id, device_id, device_name, event_type, place_label, wifi_ssid,
                latitude, longitude, accuracy_m, battery_pct, log_date, log_time, timestamp_ms
         FROM lifelog_location_logs
         WHERE log_date = ?1
         ORDER BY timestamp_ms DESC, id DESC
         LIMIT ?2"
    } else {
        "SELECT id, device_id, device_name, event_type, place_label, wifi_ssid,
                latitude, longitude, accuracy_m, battery_pct, log_date, log_time, timestamp_ms
         FROM lifelog_location_logs
         ORDER BY timestamp_ms DESC, id DESC
         LIMIT ?1"
    };

    if let Ok(mut stmt) = conn.prepare(sql) {
        let map_row = |r: &rusqlite::Row<'_>| -> rusqlite::Result<LocationMovementLogItem> {
            let place_label: String = r.get(4)?;
            let wifi_ssid: String = r.get(5)?;
            let latitude: f64 = r.get(6)?;
            let longitude: f64 = r.get(7)?;
            let (naver_map_url, google_map_url) =
                build_map_tracking_urls(&place_label, &wifi_ssid, latitude, longitude);
            Ok(LocationMovementLogItem {
                id: r.get(0)?,
                device_id: r.get(1)?,
                device_name: r.get(2)?,
                event_type: r.get(3)?,
                place_label,
                wifi_ssid,
                latitude,
                longitude,
                accuracy_m: r.get(8)?,
                battery_pct: r.get(9)?,
                log_date: r.get(10)?,
                log_time: r.get(11)?,
                timestamp_ms: r.get(12)?,
                naver_map_url,
                google_map_url,
            })
        };

        if let Some(d_str) = clean_date {
            if let Ok(iter) = stmt.query_map(params![d_str, limit as i64], map_row) {
                logs = iter.flatten().collect();
            }
        } else if let Ok(iter) = stmt.query_map(params![limit as i64], map_row) {
            logs = iter.flatten().collect();
        }
    }

    LocationMovementSummary {
        total_logs,
        wifi_logs_count,
        gps_logs_count,
        distinct_places,
        logs,
    }
}

/// 최초 조회 시 기존에 감지된 NAT Wi-Fi SSID 및 모바일 알림(지도/배달/교통/수영장 등)에서
/// 초기 동선 로그를 추출하여 사용자가 즉시 동선·지도 연동을 확인할 수 있도록 시드합니다.
fn seed_initial_location_logs_from_existing_data(conn: &Connection) {
    let ssids = detect_current_wifi_ssids();
    if let Some(ssid) = ssids.into_iter().find(|s| !s.trim().is_empty()) {
        let now_ms = chrono::Local::now().timestamp_millis();
        // 거제 기본 홈 거점 좌표 (거제시청 인근 기본 기준점: 34.8806, 128.6211)
        let _ = insert_location_movement_log(
            conn,
            "local-pc",
            "SM-S901N",
            "wifi_connect",
            "🏠 홈/거점 Wi-Fi 접속",
            &ssid,
            "",
            34.8806,
            128.6211,
            15.0,
            100,
            now_ms,
        );
    }
}

#[tauri::command]
pub(crate) fn get_location_movement_logs(
    state: State<'_, AppState>,
    date_filter: Option<String>,
    limit: Option<usize>,
) -> Result<LocationMovementSummary, String> {
    let conn = open_db(&state.db_path)?;
    Ok(query_location_movement_summary(
        &conn,
        date_filter.as_deref(),
        limit.unwrap_or(200).clamp(1, 2000),
    ))
}

#[tauri::command]
pub(crate) fn record_location_movement_entry(
    state: State<'_, AppState>,
    event_type: String,
    place_label: String,
    wifi_ssid: String,
    latitude: f64,
    longitude: f64,
    accuracy_m: Option<f64>,
) -> Result<LocationMovementSummary, String> {
    let conn = open_db(&state.db_path)?;
    let now_ms = chrono::Local::now().timestamp_millis();
    let _ = insert_location_movement_log(
        &conn,
        "manual-check",
        "SM-S901N",
        &event_type,
        &place_label,
        &wifi_ssid,
        "",
        latitude,
        longitude,
        accuracy_m.unwrap_or(10.0),
        -1,
        now_ms,
    );
    Ok(query_location_movement_summary(&conn, None, 200))
}
