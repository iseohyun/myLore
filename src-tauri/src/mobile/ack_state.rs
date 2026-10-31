//! 동기화 프로토콜 v2.0: `client_ack` 상태 머신(`kakao_room_sync_state`, `domain_sync_state`),
//! 구 프로토콜 누락 카톡 대화방 자동 역추출(Backfill), 세션 플랜(`session-plan`),
//! Background Check(`complete`) 및 클라이언트 수신 확인(`ack`) 핸들러.

use crate::*;
use chrono::{Local, TimeZone};

/// 서비스 키 정규화: 프로토콜 v2.0의 `"kakao"`와 기존 백엔드의 `"kakaotalk"`를 호환 매핑합니다.
pub(crate) fn normalize_sync_service_key(raw_key: &str) -> &'static str {
    match raw_key.trim().to_lowercase().as_str() {
        "notification" | "notifications" | "noti" => "notification",
        "sms" | "mms" | "message" => "sms",
        "call" | "calls" | "call_log" | "call-logs" => "call",
        "kakao" | "kakaotalk" | "kakao_chat" | "kakao-chats" => "kakaotalk",
        "recording" | "recordings" | "voice" => "recording",
        "health" | "samsung_health" | "samsung-health" => "health",
        "photo" | "photos" | "media" | "device_photo" => "photo",
        _ => "kakaotalk",
    }
}

/// 한국어 날짜(`YYYY-MM-DD`)와 시각 문자열(`오전 9:15`, `오후 12:30`, `14:25:30` 등)을
/// 로컬 타임존 기준 Epoch Milliseconds (`i64`)로 변환합니다.
pub(crate) fn parse_korean_date_time_to_epoch_ms(date_str: &str, time_str: &str) -> i64 {
    let d_trim = date_str.trim();
    let date_parts: Vec<&str> = d_trim.split('-').collect();
    if date_parts.len() < 3 {
        return 0;
    }
    let year: i32 = match date_parts[0].parse() {
        Ok(y) => y,
        Err(_) => return 0,
    };
    let month: u32 = match date_parts[1].parse() {
        Ok(m) if (1..=12).contains(&m) => m,
        _ => return 0,
    };
    let day: u32 = match date_parts[2].parse() {
        Ok(d) if (1..=31).contains(&d) => d,
        _ => return 0,
    };

    let t_trim = time_str.trim();
    let is_pm = t_trim.contains("오후") || t_trim.to_uppercase().contains("PM");
    let is_am = t_trim.contains("오전") || t_trim.to_uppercase().contains("AM");

    let clean_hm = t_trim
        .replace("오전", "")
        .replace("오후", "")
        .replace("AM", "")
        .replace("PM", "")
        .replace("am", "")
        .replace("pm", "")
        .trim()
        .to_string();

    let hm_parts: Vec<&str> = clean_hm.split(':').collect();
    let mut hour: u32 = hm_parts
        .first()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    let minute: u32 = hm_parts
        .get(1)
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
        .min(59);
    let second: u32 = hm_parts
        .get(2)
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
        .min(59);

    if is_pm && hour < 12 {
        hour += 12;
    } else if is_am && hour == 12 {
        hour = 0;
    }
    hour = hour.min(23);

    Local
        .with_ymd_and_hms(year, month, day, hour, minute, second)
        .earliest()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

/// 서버 기동 시 `kakao_room_sync_state` 및 `domain_sync_state` 테이블을 초기화하고,
/// 구 프로토콜로 업로드되어 클라이언트가 존재조차 모르는 기존 카톡 대화방들과 도메인 상태를
/// `client_ack = 0` (`false`)으로 역추출(Backfill)합니다.
pub(crate) fn backfill_sync_ack_states(conn: &Connection) {
    // 1. 기존 manifest_kakao_rooms 메타가 있으면 우선 폴더명/바이트 힌트 로드
    let mut meta_hints: HashMap<String, (String, u64, u64, i64)> = HashMap::new();
    if let Ok(raw) = conn.query_row(
        "SELECT value FROM mobile_sync_meta WHERE key = 'manifest_kakao_rooms'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
            for item in arr {
                let rn = item
                    .get("room_name")
                    .or_else(|| item.get("roomName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if rn.is_empty() {
                    continue;
                }
                let fn_s = item
                    .get("folder_name")
                    .or_else(|| item.get("folderName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&rn)
                    .to_string();
                let tb = item
                    .get("total_bytes")
                    .or_else(|| item.get("totalBytes"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let sb = item
                    .get("synced_bytes")
                    .or_else(|| item.get("syncedBytes"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let sh_ts = item
                    .get("last_shared_ts")
                    .or_else(|| item.get("lastSharedTs"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                meta_hints.insert(rn, (fn_s, tb, sb, sh_ts));
            }
        }
    }

    // 2. lifelog_messages 테이블에서 카톡 대화방별 최신 메시지 추출 후 client_ack = 0 으로 등록
    let fallback_kakao_ts = get_meta_i64(conn, "last_kakao_ts");
    if let Ok(mut stmt) = conn.prepare(
        "SELECT room_or_sender, message, sent_date, sent_time
         FROM lifelog_messages
         WHERE source = 'kakaotalk' AND id IN (
             SELECT MAX(id) FROM lifelog_messages WHERE source = 'kakaotalk' GROUP BY room_or_sender
         )",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        }) {
            for row in rows.flatten() {
                let (room_name, last_msg, sent_date, sent_time) = row;
                if room_name.trim().is_empty() {
                    continue;
                }
                let parsed_ts = parse_korean_date_time_to_epoch_ms(&sent_date, &sent_time);
                let msg_ts = if parsed_ts > 0 {
                    parsed_ts
                } else {
                    fallback_kakao_ts
                };
                let (folder_name, tb, sb, sh_ts) = meta_hints
                    .get(&room_name)
                    .cloned()
                    .unwrap_or_else(|| (room_name.clone(), 0, 0, msg_ts));
                let _ = conn.execute(
                    "INSERT INTO kakao_room_sync_state
                        (room_name, folder_name, last_message, last_message_ts, last_shared_ts, total_bytes, synced_bytes, client_ack)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
                     ON CONFLICT(room_name) DO UPDATE SET
                        folder_name = CASE WHEN kakao_room_sync_state.folder_name = '' THEN excluded.folder_name ELSE kakao_room_sync_state.folder_name END,
                        last_message = CASE WHEN excluded.last_message_ts >= kakao_room_sync_state.last_message_ts THEN excluded.last_message ELSE kakao_room_sync_state.last_message END,
                        last_message_ts = MAX(kakao_room_sync_state.last_message_ts, excluded.last_message_ts),
                        last_shared_ts = MAX(kakao_room_sync_state.last_shared_ts, excluded.last_shared_ts),
                        total_bytes = MAX(kakao_room_sync_state.total_bytes, excluded.total_bytes),
                        synced_bytes = MAX(kakao_room_sync_state.synced_bytes, excluded.synced_bytes)",
                    params![
                        room_name,
                        folder_name,
                        last_msg,
                        msg_ts,
                        sh_ts.max(msg_ts),
                        tb as i64,
                        sb as i64
                    ],
                );
            }
        }
    }

    // 3. mobile/kakao/*.md 파일들을 직접 스캔하여 DB에 누락된 대화방이나 용량/폴더명 메타데이터를 보강
    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    if let Ok(entries) = fs::read_dir(&kakao_dir) {
        let date_re = cached_regex!(r"^##\s*📅\s*(\d{4}-\d{2}-\d{2})");
        let msg_re = cached_regex!(r"^- \*\*\[([^\]]+)\]\s*([^\*]+)\*\*:\s*(.*)$");
        let folder_re = cached_regex!(r"folder_name:\s*([^\r\n]+)");

        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() || p.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let room_stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if room_stem.is_empty() || room_stem.starts_with("KakaoTalk_Chats_") {
                continue;
            }
            let file_len = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            let Ok(raw) = fs::read_to_string(&p) else {
                continue;
            };

            let mut folder_name = room_stem.clone();
            if let Some(cap) = folder_re.captures(&raw) {
                if let Some(m) = cap.get(1) {
                    let f = m.as_str().trim().trim_matches('"').trim_matches('\'');
                    if !f.is_empty() {
                        folder_name = f.to_string();
                    }
                }
            }

            let mut cur_date = String::new();
            let mut last_date = String::new();
            let mut last_time = String::new();
            let mut last_body = String::new();

            for line in raw.lines() {
                let t = line.trim();
                if let Some(dc) = date_re.captures(t) {
                    if let Some(m) = dc.get(1) {
                        cur_date = m.as_str().to_string();
                    }
                    continue;
                }
                if let Some(mc) = msg_re.captures(t) {
                    last_date = cur_date.clone();
                    last_time = mc
                        .get(1)
                        .map(|m| m.as_str().trim().to_string())
                        .unwrap_or_default();
                    last_body = mc
                        .get(3)
                        .map(|m| m.as_str().trim().to_string())
                        .unwrap_or_default();
                }
            }

            let msg_ts = if !last_date.is_empty() && !last_time.is_empty() {
                parse_korean_date_time_to_epoch_ms(&last_date, &last_time)
            } else {
                fallback_kakao_ts
            };

            let _ = conn.execute(
                "INSERT INTO kakao_room_sync_state
                    (room_name, folder_name, last_message, last_message_ts, last_shared_ts, total_bytes, synced_bytes, client_ack)
                 VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?5, 0)
                 ON CONFLICT(room_name) DO UPDATE SET
                    folder_name = CASE WHEN kakao_room_sync_state.folder_name = '' OR kakao_room_sync_state.folder_name = kakao_room_sync_state.room_name THEN excluded.folder_name ELSE kakao_room_sync_state.folder_name END,
                    last_message = CASE WHEN kakao_room_sync_state.last_message = '' OR excluded.last_message_ts > kakao_room_sync_state.last_message_ts THEN excluded.last_message ELSE kakao_room_sync_state.last_message END,
                    last_message_ts = MAX(kakao_room_sync_state.last_message_ts, excluded.last_message_ts),
                    last_shared_ts = MAX(kakao_room_sync_state.last_shared_ts, excluded.last_shared_ts),
                    total_bytes = MAX(kakao_room_sync_state.total_bytes, excluded.total_bytes),
                    synced_bytes = MAX(kakao_room_sync_state.synced_bytes, excluded.synced_bytes)",
                params![room_stem, folder_name, last_body, msg_ts, file_len as i64],
            );
        }
    }

    // 4. 도메인(notification, sms, call, recording, health, photo) 초기 상태 시드 (client_ack = 0)
    let domain_seeds = [
        ("notification", get_meta_i64(conn, "last_noti_ts")),
        ("sms", get_meta_i64(conn, "last_sms_ts")),
        ("call", get_meta_i64(conn, "last_call_ts")),
        ("recording", get_meta_i64(conn, "last_recording_ts")),
        ("health", get_meta_i64(conn, "last_health_ts")),
        ("photo", get_meta_i64(conn, "last_photo_ts")),
    ];
    for (domain, ts) in domain_seeds {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO domain_sync_state (domain, latest_ts, extra_json, client_ack)
             VALUES (?1, ?2, '{}', 0)",
            params![domain, ts],
        );
    }

    let room_cnt: i64 = conn
        .query_row("SELECT COUNT(*) FROM kakao_room_sync_state", [], |r| r.get(0))
        .unwrap_or(0);
    let unacked_cnt: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM kakao_room_sync_state WHERE client_ack = 0",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    log_version(
        "INFO",
        &format!(
            "[Sync v2.0 백필] 카톡 대화방 상태 테이블 총 {}개 대화방 로드 완료 (미확인 client_ack=0: {}개)",
            room_cnt, unacked_cnt
        ),
    );
}

/// 카톡 대화방에 신규 메시지 또는 미디어가 적재될 때 대화방 상태를 갱신하고 `client_ack = 0` (`false`)으로 리셋합니다.
pub(crate) fn upsert_kakao_room_sync_state_unacked(
    conn: &Connection,
    room_name: &str,
    folder_name: &str,
    last_message: &str,
    last_message_ts: i64,
    last_shared_ts: i64,
    add_synced_bytes: u64,
    total_bytes_hint: u64,
) {
    let clean_room = room_name.trim();
    if clean_room.is_empty() {
        return;
    }
    let eff_folder = if folder_name.trim().is_empty() {
        clean_room
    } else {
        folder_name.trim()
    };
    let eff_shared_ts = last_shared_ts.max(last_message_ts);

    let _ = conn.execute(
        "INSERT INTO kakao_room_sync_state
            (room_name, folder_name, last_message, last_message_ts, last_shared_ts, total_bytes, synced_bytes, client_ack)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
         ON CONFLICT(room_name) DO UPDATE SET
            folder_name = CASE WHEN excluded.folder_name != '' AND excluded.folder_name != excluded.room_name THEN excluded.folder_name ELSE kakao_room_sync_state.folder_name END,
            last_message = CASE WHEN excluded.last_message != '' AND excluded.last_message_ts >= kakao_room_sync_state.last_message_ts THEN excluded.last_message ELSE kakao_room_sync_state.last_message END,
            last_message_ts = MAX(kakao_room_sync_state.last_message_ts, excluded.last_message_ts),
            last_shared_ts = MAX(kakao_room_sync_state.last_shared_ts, excluded.last_shared_ts),
            synced_bytes = kakao_room_sync_state.synced_bytes + ?7,
            total_bytes = MAX(kakao_room_sync_state.total_bytes, excluded.total_bytes, kakao_room_sync_state.synced_bytes + ?7),
            client_ack = 0",
        params![
            clean_room,
            eff_folder,
            last_message,
            last_message_ts,
            eff_shared_ts,
            total_bytes_hint.max(add_synced_bytes) as i64,
            add_synced_bytes as i64
        ],
    );
}

/// 카톡 미디어 파일이 수신되었을 때 `folder_name` 또는 `room_name`으로 매칭되는 대화방의 `synced_bytes`를 누적하고 `client_ack = 0`으로 리셋합니다.
pub(crate) fn add_kakao_room_media_bytes_unacked(
    conn: &Connection,
    folder_name: &str,
    add_bytes: u64,
) {
    let clean_folder = folder_name.trim();
    if clean_folder.is_empty() || add_bytes == 0 {
        return;
    }
    let _ = conn.execute(
        "UPDATE kakao_room_sync_state
         SET synced_bytes = synced_bytes + ?1,
             total_bytes = MAX(total_bytes, synced_bytes + ?1),
             client_ack = 0
         WHERE folder_name = ?2 OR room_name = ?2",
        params![add_bytes as i64, clean_folder],
    );
}

/// 5대 도메인(`notification`, `sms`, `call`, `recording`, `health`)에 신규 데이터가 적재될 때
/// `latest_ts`를 갱신하고 `client_ack = 0` (`false`)으로 리셋합니다.
pub(crate) fn mark_domain_sync_state_unacked(
    conn: &Connection,
    domain: &str,
    latest_ts: i64,
    extra_json_opt: Option<&str>,
) {
    let extra = extra_json_opt.unwrap_or("{}");
    let _ = conn.execute(
        "INSERT INTO domain_sync_state (domain, latest_ts, extra_json, client_ack)
         VALUES (?1, ?2, ?3, 0)
         ON CONFLICT(domain) DO UPDATE SET
            latest_ts = MAX(domain_sync_state.latest_ts, excluded.latest_ts),
            extra_json = CASE WHEN ?4 = 1 THEN excluded.extra_json ELSE domain_sync_state.extra_json END,
            client_ack = 0",
        params![
            domain,
            latest_ts,
            extra,
            if extra_json_opt.is_some() { 1 } else { 0 }
        ],
    );
}

/// `client_ack == 0` (`false`)인 미확인 카톡 대화방 목록과 5대 도메인 상태를 조회하여 JSON으로 반환합니다.
pub(crate) fn query_unacked_sync_states(
    conn: &Connection,
) -> (Vec<serde_json::Value>, serde_json::Map<String, serde_json::Value>) {
    let mut unacked_kakao_rooms: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT room_name, folder_name, last_message, last_message_ts, last_shared_ts, total_bytes, synced_bytes
         FROM kakao_room_sync_state
         WHERE client_ack = 0
         ORDER BY last_message_ts DESC LIMIT 500",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            let room_name: String = r.get(0)?;
            let folder_name: String = r.get(1)?;
            let last_message: String = r.get(2)?;
            let last_message_ts: i64 = r.get(3)?;
            let last_shared_ts: i64 = r.get(4)?;
            let total_bytes: i64 = r.get(5)?;
            let synced_bytes: i64 = r.get(6)?;
            Ok(serde_json::json!({
                "room_name": room_name,
                "folder_name": if folder_name.is_empty() { room_name } else { folder_name },
                "last_message": last_message,
                "last_message_ts": last_message_ts,
                "last_shared_ts": last_shared_ts.max(last_message_ts),
                "total_bytes": total_bytes.max(0),
                "synced_bytes": synced_bytes.max(0),
                "client_ack": false
            }))
        }) {
            unacked_kakao_rooms = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let mut unacked_domains = serde_json::Map::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT domain, latest_ts, extra_json
         FROM domain_sync_state
         WHERE client_ack = 0",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        }) {
            for (domain, latest_ts, extra_json) in rows.flatten() {
                let mut obj = serde_json::Map::new();
                let meta_key = match domain.as_str() {
                    "notification" => "last_noti_ts",
                    "sms" => "last_sms_ts",
                    "call" => "last_call_ts",
                    "recording" => "last_recording_ts",
                    "health" => "last_health_ts",
                    "photo" => "last_photo_ts",
                    _ => "",
                };
                let eff_ts = if !meta_key.is_empty() {
                    latest_ts.max(get_meta_i64(conn, meta_key))
                } else {
                    latest_ts
                };
                obj.insert("latest_ts".to_string(), serde_json::json!(eff_ts));
                obj.insert("client_ack".to_string(), serde_json::json!(false));

                if domain == "recording" || domain == "photo" {
                    let mut hashes: Vec<String> = Vec::new();
                    if let Ok(mut h_stmt) =
                        conn.prepare("SELECT file_hash FROM synced_file_hashes LIMIT 5000")
                    {
                        if let Ok(h_rows) = h_stmt.query_map([], |r| r.get::<_, String>(0)) {
                            hashes = h_rows.filter_map(|r| r.ok()).collect();
                        }
                    }
                    obj.insert("synced_hashes".to_string(), serde_json::json!(hashes));
                } else if domain == "health" {
                    if let Ok(parsed_extra) =
                        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
                            &extra_json,
                        )
                    {
                        for (k, v) in parsed_extra {
                            obj.insert(k, v);
                        }
                    }
                    if !obj.contains_key("latest_record_type") {
                        obj.insert(
                            "latest_record_type".to_string(),
                            serde_json::json!("exercise"),
                        );
                    }
                    if !obj.contains_key("folder_name") {
                        obj.insert(
                            "folder_name".to_string(),
                            serde_json::json!("samsunghealth"),
                        );
                    }
                }
                unacked_domains.insert(domain, serde_json::Value::Object(obj));
            }
        }
    }

    (unacked_kakao_rooms, unacked_domains)
}

/// `POST /api/v1/sync/session-plan` 핸들러
///
/// 클라이언트가 2단계 초기화(Step 2-A 로컬 캐시 즉시 전송 `is_ready: false` -> Step 2-B 백그라운드 정밀 스캔 `is_ready: true`)
/// 또는 충전 중 신규 이벤트 발생으로 인한 동적 볼륨 확장 시 호출합니다.
pub(crate) fn handle_session_plan(
    mut request: tiny_http::Request,
    app_handle: AppHandle,
    db_path: PathBuf,
) {
    let mut body_str = String::new();
    let _ = request.as_reader().read_to_string(&mut body_str);
    if !check_request_token_fast(&request, &db_path) {
        respond_json(
            request,
            401,
            serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
        );
        return;
    }

    let json_val: serde_json::Value =
        serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
    let session_id = json_val
        .get("session_id")
        .or_else(|| json_val.get("sessionId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let is_ready = json_val
        .get("is_ready")
        .or_else(|| json_val.get("isReady"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let req_total_bytes = json_val
        .get("total_bytes")
        .or_else(|| json_val.get("totalBytes"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let req_synced_bytes = json_val
        .get("synced_bytes")
        .or_else(|| json_val.get("syncedBytes"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let req_total_count = json_val
        .get("total_count")
        .or_else(|| json_val.get("totalCount"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let req_synced_count = json_val
        .get("synced_count")
        .or_else(|| json_val.get("syncedCount"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    // 카테고리별 볼륨 파싱 (volumes 객체)
    let mut parsed_volumes: Vec<(String, usize, usize, u64, u64)> = Vec::new();
    if let Some(vols) = json_val.get("volumes").and_then(|v| v.as_object()) {
        for (raw_k, v_obj) in vols {
            let norm_key = normalize_sync_service_key(raw_k).to_string();
            let tc = v_obj
                .get("total_count")
                .or_else(|| v_obj.get("totalCount"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            let sc = v_obj
                .get("synced_count")
                .or_else(|| v_obj.get("syncedCount"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            // DB형 데이터(notification, sms)는 바이트를 합산하지 않고 건수만 집계
            let is_db_only = norm_key == "notification" || norm_key == "sms";
            let tb = if is_db_only {
                0
            } else {
                v_obj
                    .get("total_bytes")
                    .or_else(|| v_obj.get("totalBytes"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
            };
            let sb = if is_db_only {
                0
            } else {
                v_obj
                    .get("synced_bytes")
                    .or_else(|| v_obj.get("syncedBytes"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
            };
            parsed_volumes.push((norm_key, tc, sc, tb, sb));
        }
    }

    let overall_pct = apply_session_plan_to_live_progress(
        &app_handle,
        &session_id,
        is_ready,
        req_total_bytes,
        req_synced_bytes,
        req_total_count,
        req_synced_count,
        &parsed_volumes,
    );

    log_comm(
        "INFO",
        &format!(
            "[POST /api/v1/sync/session-plan] session={} is_ready={} bytes={}/{} [{} / {}개] -> {}%",
            if session_id.is_empty() { "-" } else { &session_id },
            is_ready,
            format_bytes_human(req_synced_bytes),
            format_bytes_human(req_total_bytes),
            req_synced_count,
            req_total_count,
            overall_pct
        ),
    );

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "session_id": session_id,
            "is_ready": is_ready,
            "percent": overall_pct
        }),
    );
}

/// `POST /api/v1/sync/complete` 핸들러 (Step 4: 서버 주도 Background Check)
///
/// 클라이언트가 모든 항목 전송을 마친 후 호출하면:
/// 1) 단말 최신 타임스탬프(`client_latest`)를 서버 워터마크에 병합하고,
/// 2) `client_ack == 0` (`false`)인 미확인 카톡 대화방(`unacked_kakao_rooms`) 및 5대 도메인(`unacked_domains`)만 선별 반환하며,
/// 3) 서버 동기화 진행률 상태를 완료 처리합니다.
pub(crate) fn handle_sync_complete(
    mut request: tiny_http::Request,
    app_handle: AppHandle,
    db_path: PathBuf,
) {
    let mut body_str = String::new();
    let _ = request.as_reader().read_to_string(&mut body_str);
    let client_json: serde_json::Value = if !body_str.trim().is_empty() {
        serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let Ok(conn) = open_db(&db_path) else {
        respond_json(
            request,
            500,
            serde_json::json!({ "ok": false, "error": "Failed to open DB" }),
        );
        return;
    };
    if !check_request_token(&request, &conn) {
        respond_json(
            request,
            401,
            serde_json::json!({ "ok": false, "status": "unauthorized", "error": "Invalid X-MyLore-Token" }),
        );
        return;
    }

    let (req_dev_id, _) = resolve_request_device(&request, Some(&client_json), &conn);
    let latest_node = client_json.get("client_latest").unwrap_or(&client_json);

    let c_kakao = latest_node
        .get("last_kakao_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let c_noti = latest_node
        .get("last_noti_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let c_sms = latest_node
        .get("last_sms_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let c_call = latest_node
        .get("last_call_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let c_rec = latest_node
        .get("last_recording_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let c_health = latest_node
        .get("last_health_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let c_photo = latest_node
        .get("last_photo_ts")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    // 워터마크 하한선(Floor) 보장 병합
    if c_kakao > 0 {
        set_meta_i64_max(&conn, "last_kakao_ts", c_kakao);
        update_atomic_max_i64(&MEM_LAST_KAKAO_TS, c_kakao);
    }
    if c_noti > 0 {
        set_meta_i64_max(&conn, "last_noti_ts", c_noti);
        update_atomic_max_i64(&MEM_LAST_NOTI_TS, c_noti);
    }
    if c_sms > 0 {
        set_meta_i64_max(&conn, "last_sms_ts", c_sms);
        update_atomic_max_i64(&MEM_LAST_SMS_TS, c_sms);
    }
    if c_call > 0 {
        set_meta_i64_max(&conn, "last_call_ts", c_call);
        update_atomic_max_i64(&MEM_LAST_CALL_TS, c_call);
    }
    if c_rec > 0 {
        set_meta_i64_max(&conn, "last_recording_ts", c_rec);
        update_atomic_max_i64(&MEM_LAST_RECORDING_TS, c_rec);
    }
    if c_health > 0 {
        set_meta_i64_max(&conn, "last_health_ts", c_health);
        update_atomic_max_i64(&MEM_LAST_HEALTH_TS, c_health);
    }
    if c_photo > 0 {
        set_meta_i64_max(&conn, "last_photo_ts", c_photo);
        update_atomic_max_i64(&MEM_LAST_PHOTO_TS, c_photo);
    }

    if !req_dev_id.is_empty() {
        let _ = conn.execute(
            "UPDATE paired_devices SET
                last_kakao_ts = MAX(COALESCE(last_kakao_ts, 0), ?1),
                last_sms_ts = MAX(COALESCE(last_sms_ts, 0), ?2),
                last_call_ts = MAX(COALESCE(last_call_ts, 0), ?3),
                last_noti_ts = MAX(COALESCE(last_noti_ts, 0), ?4),
                last_recording_ts = MAX(COALESCE(last_recording_ts, 0), ?5),
                last_health_ts = MAX(COALESCE(last_health_ts, 0), ?6)
             WHERE device_id = ?7",
            params![c_kakao, c_sms, c_call, c_noti, c_rec, c_health, req_dev_id],
        );
    }

    let (unacked_kakao_rooms, unacked_domains) = query_unacked_sync_states(&conn);
    let has_unacked_updates = !unacked_kakao_rooms.is_empty() || !unacked_domains.is_empty();
    drop(conn);

    // 워커 큐가 비어 있으면 즉시(아니면 워커가 큐를 비우는 즉시) 동기화 단계 완료 처리
    RECONCILE_PENDING_COMPLETION.store(true, std::sync::atomic::Ordering::Relaxed);
    if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) == 0
        && !IS_WORKER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed)
    {
        RECONCILE_PENDING_COMPLETION.store(false, std::sync::atomic::Ordering::Relaxed);
        complete_all_remaining_sync_steps(&app_handle, &db_path, false);
        let _ = app_handle.emit(
            "mobile-sync-event",
            serde_json::json!({
                "type": "sync_cycle_complete",
                "message": "✅ 모바일 기기와의 모든 동기화 항목 전송 및 Background Check가 완료되었습니다."
            }),
        );
    }

    log_comm(
        "INFO",
        &format!(
            "[POST /api/v1/sync/complete] Background Check 응답 — 미확인 카톡방 {}개, 미확인 도메인 {}개",
            unacked_kakao_rooms.len(),
            unacked_domains.len()
        ),
    );

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "has_unacked_updates": has_unacked_updates,
            "unacked_kakao_rooms": unacked_kakao_rooms,
            "unacked_domains": unacked_domains
        }),
    );
}

/// `POST /api/v1/sync/ack` 핸들러 (Step 5: 클라이언트 수신 확인 및 `client_ack = true` 마킹)
pub(crate) fn handle_sync_ack(mut request: tiny_http::Request, db_path: PathBuf) {
    let mut body_str = String::new();
    let _ = request.as_reader().read_to_string(&mut body_str);
    let client_json: serde_json::Value = if !body_str.trim().is_empty() {
        serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let Ok(conn) = open_db(&db_path) else {
        respond_json(
            request,
            500,
            serde_json::json!({ "ok": false, "error": "Failed to open DB" }),
        );
        return;
    };
    if !check_request_token(&request, &conn) {
        respond_json(
            request,
            401,
            serde_json::json!({ "ok": false, "status": "unauthorized", "error": "Invalid X-MyLore-Token" }),
        );
        return;
    }

    let mut acked_room_count = 0usize;
    if let Some(rooms) = client_json
        .get("acked_kakao_rooms")
        .or_else(|| client_json.get("ackedKakaoRooms"))
        .and_then(|v| v.as_array())
    {
        for r_item in rooms {
            let rn = r_item
                .get("room_name")
                .or_else(|| r_item.get("roomName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if rn.is_empty() {
                continue;
            }
            let ack_ts = r_item
                .get("last_message_ts")
                .or_else(|| r_item.get("lastMessageTs"))
                .and_then(|v| v.as_i64())
                .unwrap_or(i64::MAX);
            let affected = conn
                .execute(
                    "UPDATE kakao_room_sync_state
                     SET client_ack = 1
                     WHERE room_name = ?1 AND (last_message_ts <= ?2 OR ?2 <= 0)",
                    params![rn, ack_ts],
                )
                .unwrap_or(0);
            acked_room_count += affected;
        }
    }

    let mut acked_domain_count = 0usize;
    if let Some(doms) = client_json
        .get("acked_domains")
        .or_else(|| client_json.get("ackedDomains"))
        .and_then(|v| v.as_object())
    {
        for (raw_dom, val) in doms {
            let dom_key = match normalize_sync_service_key(raw_dom) {
                "kakaotalk" => "kakao",
                other => other,
            };
            let ack_ts = val
                .as_i64()
                .or_else(|| val.get("latest_ts").and_then(|v| v.as_i64()))
                .unwrap_or(i64::MAX);
            let affected = conn
                .execute(
                    "UPDATE domain_sync_state
                     SET client_ack = 1
                     WHERE domain = ?1 AND (latest_ts <= ?2 OR ?2 <= 0)",
                    params![dom_key, ack_ts],
                )
                .unwrap_or(0);
            acked_domain_count += affected;
        }
    }

    log_comm(
        "INFO",
        &format!(
            "[POST /api/v1/sync/ack] 클라이언트 ACK 확정 — 카톡방 {}개, 도메인 {}개 (client_ack = true)",
            acked_room_count, acked_domain_count
        ),
    );
    log_version(
        "INFO",
        &format!(
            "[워터마크 ACK 동기화] 클라이언트 측 카톡방 {}개 · 도메인 {}개 최신 타임스탬프 버전 일치 확정(client_ack=true)",
            acked_room_count, acked_domain_count
        ),
    );

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "acked_room_count": acked_room_count,
            "acked_domain_count": acked_domain_count
        }),
    );
}
