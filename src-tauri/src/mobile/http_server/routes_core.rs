//! 동반 앱 HTTP 라우트: 파일 열기 전달, 상태/워터마크, 배치 시작, 페어링 확정, 해시 중복 확인.

use crate::*;

/// `if url_path == "/api/v1/open-files"`
pub(crate) fn handle_open_files(
    mut request: tiny_http::Request,
    app_handle: AppHandle,
    pending_cli_files: Arc<Mutex<Vec<String>>>,
) {
    let mut body_str = String::new();
    let _ = request.as_reader().read_to_string(&mut body_str);
    let paths: Vec<String> = serde_json::from_str(&body_str).unwrap_or_default();

    if !paths.is_empty() {
        if let Ok(mut guard) = pending_cli_files.lock() {
            for p in &paths {
                if !guard.contains(p) {
                    guard.push(p.clone());
                }
            }
        }
        let _ = app_handle.emit("cli-open-files", paths);
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    respond_json(request, 200, serde_json::json!({ "ok": true }));
}

/// `else if url_path == "/api/v1/status" || url_path == "/api/v1/sync/watermarks"`
pub(crate) fn handle_status_and_watermarks(
    mut request: tiny_http::Request,
    db_path: PathBuf,
    url_path: &str,
) {
    let pc_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
    let mut body_str = String::new();
    if request.method() == &tiny_http::Method::Post {
        let _ = request.as_reader().read_to_string(&mut body_str);
    }
    let client_json: serde_json::Value = if !body_str.trim().is_empty() {
        serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let (
        mut last_kakao_ts,
        mut last_sms_ts,
        mut last_call_ts,
        mut last_noti_ts,
        mut last_recording_ts,
        mut last_health_ts,
        mut last_contact_ts,
        mut last_usage_ts,
        mut last_photo_ts,
    ) = (0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64);
    let mut force_full_sync = false;
    if let Ok(conn) = open_db(&db_path) {
        if !check_request_token(&request, &conn) {
            respond_json(
                request,
                401,
                serde_json::json!({ "ok": false, "status": "unauthorized", "error": "Invalid X-MyLore-Token" }),
            );
            return;
        }
        force_full_sync = get_meta_i64(&conn, "force_full_sync") == 1;
        let (req_dev_id, _) = resolve_request_device(&request, Some(&client_json), &conn);

        if url_path == "/api/v1/sync/watermarks" && force_full_sync {
            let _ = conn.execute(
                "INSERT INTO mobile_sync_meta (key, value) VALUES ('force_full_sync', '0')
                                     ON CONFLICT(key) DO UPDATE SET value = '0'",
                [],
            );
        }

        if !force_full_sync {
            let c_kakao = client_json
                .get("last_kakao_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_sms = client_json
                .get("last_sms_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_call = client_json
                .get("last_call_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_noti = client_json
                .get("last_noti_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_rec = client_json
                .get("last_recording_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_health = client_json
                .get("last_health_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_contact = client_json
                .get("last_contact_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_usage = client_json
                .get("last_usage_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let c_photo = client_json
                .get("last_photo_ts")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let dev_ts: Option<(i64, i64, i64, i64, i64, i64, i64, i64)> = if !req_dev_id.is_empty()
            {
                conn.query_row(
                        "SELECT COALESCE(last_kakao_ts, 0), COALESCE(last_sms_ts, 0), COALESCE(last_call_ts, 0),
                                                    COALESCE(last_noti_ts, 0), COALESCE(last_recording_ts, 0), COALESCE(last_health_ts, 0),
                                                    COALESCE(last_contact_ts, 0), COALESCE(last_usage_ts, 0)
                                             FROM paired_devices WHERE device_id = ?1 LIMIT 1",
                        params![req_dev_id],
                        |r| {
                            Ok((
                                r.get(0)?,
                                r.get(1)?,
                                r.get(2)?,
                                r.get(3)?,
                                r.get(4)?,
                                r.get(5)?,
                                r.get(6)?,
                                r.get(7)?,
                            ))
                        },
                    )
                    .optional()
                    .unwrap_or(None)
            } else {
                None
            };
            // 프로토콜 v2.0 1-1 하한선(Floor) 보호: 서버 DB가 재구축되어도 클라이언트가 이미 전송 완료한 타임스탬프 미만으로 후퇴하지 않음
            last_kakao_ts = get_meta_i64(&conn, "last_kakao_ts")
                .max(MEM_LAST_KAKAO_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_kakao);
            last_sms_ts = get_meta_i64(&conn, "last_sms_ts")
                .max(MEM_LAST_SMS_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_sms);
            last_call_ts = get_meta_i64(&conn, "last_call_ts")
                .max(MEM_LAST_CALL_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_call);
            last_noti_ts = get_meta_i64(&conn, "last_noti_ts")
                .max(MEM_LAST_NOTI_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_noti);
            last_recording_ts = get_meta_i64(&conn, "last_recording_ts")
                .max(MEM_LAST_RECORDING_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_rec);
            last_health_ts = get_meta_i64(&conn, "last_health_ts")
                .max(MEM_LAST_HEALTH_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_health);
            last_contact_ts = get_meta_i64(&conn, "last_contact_ts")
                .max(MEM_LAST_CONTACT_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_contact);
            last_usage_ts = get_meta_i64(&conn, "last_usage_ts")
                .max(MEM_LAST_USAGE_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_usage);
            last_photo_ts = get_meta_i64(&conn, "last_photo_ts")
                .max(MEM_LAST_PHOTO_TS.load(std::sync::atomic::Ordering::Relaxed))
                .max(c_photo);

            if let Some((k, s, c, n, rec, h, ct, u)) = dev_ts {
                last_kakao_ts = last_kakao_ts.max(k);
                last_sms_ts = last_sms_ts.max(s);
                last_call_ts = last_call_ts.max(c);
                last_noti_ts = last_noti_ts.max(n);
                last_recording_ts = last_recording_ts.max(rec);
                last_health_ts = last_health_ts.max(h);
                last_contact_ts = last_contact_ts.max(ct);
                last_usage_ts = last_usage_ts.max(u);
            }

            set_meta_i64_max(&conn, "last_kakao_ts", last_kakao_ts);
            set_meta_i64_max(&conn, "last_sms_ts", last_sms_ts);
            set_meta_i64_max(&conn, "last_call_ts", last_call_ts);
            set_meta_i64_max(&conn, "last_noti_ts", last_noti_ts);
            set_meta_i64_max(&conn, "last_recording_ts", last_recording_ts);
            set_meta_i64_max(&conn, "last_health_ts", last_health_ts);
            set_meta_i64_max(&conn, "last_contact_ts", last_contact_ts);
            set_meta_i64_max(&conn, "last_usage_ts", last_usage_ts);
            set_meta_i64_max(&conn, "last_photo_ts", last_photo_ts);

            update_atomic_max_i64(&MEM_LAST_KAKAO_TS, last_kakao_ts);
            update_atomic_max_i64(&MEM_LAST_SMS_TS, last_sms_ts);
            update_atomic_max_i64(&MEM_LAST_CALL_TS, last_call_ts);
            update_atomic_max_i64(&MEM_LAST_NOTI_TS, last_noti_ts);
            update_atomic_max_i64(&MEM_LAST_RECORDING_TS, last_recording_ts);
            update_atomic_max_i64(&MEM_LAST_HEALTH_TS, last_health_ts);
            update_atomic_max_i64(&MEM_LAST_CONTACT_TS, last_contact_ts);
            update_atomic_max_i64(&MEM_LAST_USAGE_TS, last_usage_ts);
            update_atomic_max_i64(&MEM_LAST_PHOTO_TS, last_photo_ts);
        }
    }
    let current_ssids: Vec<String> = open_db(&db_path)
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT value FROM mobile_sync_meta WHERE key = 'allowed_ssids'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
        })
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default();
    let current_ssid = current_ssids.first().cloned().unwrap_or_default();

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "status": "ok",
            "pc_name": pc_name,
            "ssid": current_ssid,
            "ssids": current_ssids,
            "version": "0.1.0",
            "db_ready": db_path.exists(),
            "force_full_sync": force_full_sync,
            "last_kakao_ts": last_kakao_ts,
            "last_sms_ts": last_sms_ts,
            "last_call_ts": last_call_ts,
            "last_noti_ts": last_noti_ts,
            "last_recording_ts": last_recording_ts,
            "last_health_ts": last_health_ts,
            "last_contact_ts": last_contact_ts,
            "last_usage_ts": last_usage_ts,
            "last_photo_ts": last_photo_ts
        }),
    );
}

/// `else if url_path == "/api/v1/sync/manifest" || url_path == "/api/v1/sync/reconcile"`
///
/// 모바일 앱이 초기 기동(`GET /api/v1/sync/manifest`) 또는 한 사이클의 모든 항목 전송을 마친 유휴 시점(`POST /api/v1/sync/reconcile`)에
/// 호출하여 서버-단말 간 보유 목록 및 워터마크 정합성을 맞추고, 서버 진행률 상태를 최종 완료로 정리합니다.
pub(crate) fn handle_sync_manifest_and_reconcile(
    mut request: tiny_http::Request,
    app_handle: AppHandle,
    db_path: PathBuf,
    url_path: &str,
) {
    let mut body_str = String::new();
    let is_reconcile = url_path == "/api/v1/sync/reconcile"
        || request.method() == &tiny_http::Method::Post;
    if request.method() == &tiny_http::Method::Post {
        let _ = request.as_reader().read_to_string(&mut body_str);
    }
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

    // 1. 워터마크 병합 (reconcile 요청에 포함된 단말 워터마크가 있으면 max 반영)
    let mut last_kakao_ts = get_meta_i64(&conn, "last_kakao_ts")
        .max(MEM_LAST_KAKAO_TS.load(std::sync::atomic::Ordering::Relaxed));
    let mut last_sms_ts = get_meta_i64(&conn, "last_sms_ts")
        .max(MEM_LAST_SMS_TS.load(std::sync::atomic::Ordering::Relaxed));
    let mut last_call_ts = get_meta_i64(&conn, "last_call_ts")
        .max(MEM_LAST_CALL_TS.load(std::sync::atomic::Ordering::Relaxed));
    let mut last_noti_ts = get_meta_i64(&conn, "last_noti_ts")
        .max(MEM_LAST_NOTI_TS.load(std::sync::atomic::Ordering::Relaxed));
    let mut last_recording_ts = get_meta_i64(&conn, "last_recording_ts")
        .max(MEM_LAST_RECORDING_TS.load(std::sync::atomic::Ordering::Relaxed));
    let mut last_health_ts = get_meta_i64(&conn, "last_health_ts")
        .max(MEM_LAST_HEALTH_TS.load(std::sync::atomic::Ordering::Relaxed));

    if is_reconcile {
        let c_kakao = client_json.get("last_kakao_ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let c_sms = client_json.get("last_sms_ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let c_call = client_json.get("last_call_ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let c_noti = client_json.get("last_noti_ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let c_rec = client_json.get("last_recording_ts").and_then(|v| v.as_i64()).unwrap_or(0);
        let c_health = client_json.get("last_health_ts").and_then(|v| v.as_i64()).unwrap_or(0);

        last_kakao_ts = last_kakao_ts.max(c_kakao);
        last_sms_ts = last_sms_ts.max(c_sms);
        last_call_ts = last_call_ts.max(c_call);
        last_noti_ts = last_noti_ts.max(c_noti);
        last_recording_ts = last_recording_ts.max(c_rec);
        last_health_ts = last_health_ts.max(c_health);

        set_meta_i64_max(&conn, "last_kakao_ts", last_kakao_ts);
        set_meta_i64_max(&conn, "last_sms_ts", last_sms_ts);
        set_meta_i64_max(&conn, "last_call_ts", last_call_ts);
        set_meta_i64_max(&conn, "last_noti_ts", last_noti_ts);
        set_meta_i64_max(&conn, "last_recording_ts", last_recording_ts);
        set_meta_i64_max(&conn, "last_health_ts", last_health_ts);

        update_atomic_max_i64(&MEM_LAST_KAKAO_TS, last_kakao_ts);
        update_atomic_max_i64(&MEM_LAST_SMS_TS, last_sms_ts);
        update_atomic_max_i64(&MEM_LAST_CALL_TS, last_call_ts);
        update_atomic_max_i64(&MEM_LAST_NOTI_TS, last_noti_ts);
        update_atomic_max_i64(&MEM_LAST_RECORDING_TS, last_recording_ts);
        update_atomic_max_i64(&MEM_LAST_HEALTH_TS, last_health_ts);

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
                params![
                    last_kakao_ts,
                    last_sms_ts,
                    last_call_ts,
                    last_noti_ts,
                    last_recording_ts,
                    last_health_ts,
                    req_dev_id
                ],
            );
        }

        // 단말이 보내온 카톡/헬스 로컬 캐시 요약을 서버 메타에 병합 보존
        if let Some(arr) = client_json.get("local_kakao_rooms").and_then(|v| v.as_array()) {
            if !arr.is_empty() {
                if let Ok(raw) = serde_json::to_string(arr) {
                    let _ = conn.execute(
                        "INSERT INTO mobile_sync_meta (key, value) VALUES ('manifest_kakao_rooms', ?1)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![raw],
                    );
                }
                let mut tot_b = 0u64;
                let mut syn_b = 0u64;
                for item in arr {
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
                    tot_b = tot_b.saturating_add(tb);
                    syn_b = syn_b.saturating_add(sb.min(tb));
                }
                if tot_b > 0 {
                    let pct = update_live_service_byte_progress(
                        &app_handle,
                        "kakaotalk",
                        syn_b,
                        tot_b,
                        arr.len(),
                        true,
                        None,
                    );
                    log_comm(
                        "INFO",
                        &format!(
                            "[POST /api/v1/sync/reconcile] 카톡 로컬 캐시 {}개 방 용량 동기화 반영 — {} / {} ({}%)",
                            arr.len(),
                            format_bytes_human(syn_b),
                            format_bytes_human(tot_b),
                            pct
                        ),
                    );
                }
            }
        }
        if let Some(arr) = client_json.get("local_health_records").and_then(|v| v.as_array()) {
            if !arr.is_empty() {
                if let Ok(raw) = serde_json::to_string(arr) {
                    let _ = conn.execute(
                        "INSERT INTO mobile_sync_meta (key, value) VALUES ('manifest_health_records', ?1)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![raw],
                    );
                }
            }
        }
    }

    // 2. 서버 보유 카톡 대화방 목록 구성 (kakao_room_sync_state 기반 — 구 프로토콜 누락 방 포함)
    let mut kakao_rooms: Vec<serde_json::Value> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT room_name, folder_name, last_message, last_message_ts, last_shared_ts, total_bytes, synced_bytes, client_ack
         FROM kakao_room_sync_state
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
            let client_ack: i64 = r.get(7)?;
            Ok(serde_json::json!({
                "room_name": room_name,
                "folder_name": if folder_name.is_empty() { room_name } else { folder_name },
                "last_message": last_message,
                "last_message_ts": last_message_ts,
                "last_shared_ts": last_shared_ts.max(last_message_ts),
                "total_bytes": total_bytes.max(0),
                "synced_bytes": synced_bytes.max(0),
                "client_ack": client_ack != 0
            }))
        }) {
            kakao_rooms = rows.filter_map(|r| r.ok()).collect();
        }
    }

    let (unacked_kakao_rooms, unacked_domains) = query_unacked_sync_states(&conn);
    let has_unacked_updates = !unacked_kakao_rooms.is_empty() || !unacked_domains.is_empty();

    // 3. 서버 보유 헬스 기록 요약 목록
    let health_records: Vec<serde_json::Value> = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'manifest_health_records'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok())
        .unwrap_or_default();

    // 4. 서버에 이미 적재된 파일 해시 목록 (녹음/미디어 중복 방지 및 단말 상태 정합성)
    let mut synced_recording_hashes: Vec<String> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("SELECT file_hash FROM synced_file_hashes LIMIT 5000") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            synced_recording_hashes = rows.filter_map(|r| r.ok()).collect();
        }
    }

    drop(conn);

    // 5. 단말이 모든 대기 항목 전송 후 POST /api/v1/sync/reconcile 을 호출한 경우:
    //    워커 큐가 비어 있으면 즉시(아니면 워커가 큐를 비우는 즉시) 전체 동기화 단계 완료 처리
    if is_reconcile {
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
                    "message": "✅ 모바일 기기와의 모든 동기화 항목 전송 및 정합성 검증이 완료되었습니다."
                }),
            );
        }
    }

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "has_unacked_updates": has_unacked_updates,
            "unacked_kakao_rooms": unacked_kakao_rooms,
            "unacked_domains": unacked_domains,
            "last_kakao_ts": last_kakao_ts,
            "last_sms_ts": last_sms_ts,
            "last_call_ts": last_call_ts,
            "last_noti_ts": last_noti_ts,
            "last_recording_ts": last_recording_ts,
            "last_health_ts": last_health_ts,
            "kakao_rooms": kakao_rooms,
            "health_records": health_records,
            "synced_recording_hashes": synced_recording_hashes,
            "synced_sms_ids": [],
            "synced_call_ids": [],
            "synced_noti_ids": []
        }),
    );
}

/// `else if url_path == "/api/v1/sync/batch-init"`
pub(crate) fn handle_batch_init(mut request: tiny_http::Request, app_handle: AppHandle) {
    // 카톡(전달할 전체 폴더 수 / 전체 용량) 또는 알림(전달할 전체 메시지 수) 동기화 시작 전 및 백그라운드 Lazy 스캔 완료 시 갱신 수신
    let mut body_str = String::new();
    let _ = request.as_reader().read_to_string(&mut body_str);
    let json_val: serde_json::Value =
        serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
    let service = json_val
        .get("service")
        .and_then(|v| v.as_str())
        .unwrap_or("kakaotalk");
    let total_count = json_val
        .get("total_count")
        .or_else(|| json_val.get("total_folders"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let total_bytes = json_val
        .get("total_bytes")
        .or_else(|| json_val.get("totalBytes"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let synced_bytes = json_val
        .get("synced_bytes")
        .or_else(|| json_val.get("syncedBytes"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let is_lazy_update = json_val
        .get("is_lazy_update")
        .or_else(|| json_val.get("isLazyUpdate"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    enqueue_sync_worker_job(SyncWorkerJob::BatchInit {
        service: service.to_string(),
        total_count,
        total_bytes,
        synced_bytes,
        is_lazy_update,
    });
    let pct = if total_bytes > 0 || is_lazy_update {
        update_live_service_byte_progress(
            &app_handle,
            service,
            synced_bytes,
            total_bytes,
            total_count,
            is_lazy_update,
            None,
        )
    } else {
        emit_live_service_sync_progress(
            &app_handle,
            service,
            0,
            total_count.max(1),
            0,
            0,
            Some(&format!("총 {}건 전송 준비 완료 (0%)", total_count)),
        )
    };
    log_comm(
        "INFO",
        &format!(
            "[POST /api/v1/sync/batch-init] service={} count={} bytes={}/{} lazy={} -> {}%",
            service,
            total_count,
            format_bytes_human(synced_bytes),
            format_bytes_human(total_bytes),
            is_lazy_update,
            pct
        ),
    );

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "service": service,
            "total_count": total_count,
            "total_bytes": total_bytes,
            "synced_bytes": synced_bytes,
            "percent": pct
        }),
    );
}

/// `else if url_path == "/api/v1/pair/confirm"`
pub(crate) fn handle_pair_confirm(
    mut request: tiny_http::Request,
    app_handle: AppHandle,
    db_path: PathBuf,
) {
    let mut body_str = String::new();
    let _ = request.as_reader().read_to_string(&mut body_str);
    let json_val: serde_json::Value =
        serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));

    let device_name = json_val
        .get("device_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Android Device")
        .to_string();
    let model = json_val
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Model")
        .to_string();

    let hash_seed = format!("{}|{}", device_name, model);
    let short_hash = &blake3::hash(hash_seed.as_bytes()).to_hex()[..10];
    let device_id = format!("dev_{}", short_hash);
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    if let Ok(conn) = open_db(&db_path) {
        if !check_request_token(&request, &conn) {
            respond_json(
                request,
                401,
                serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
            );
            return;
        }
        let _ = conn.execute(
            "INSERT INTO paired_devices (device_id, device_name, model, paired_at, last_seen_at)
                                 VALUES (?1, ?2, ?3, ?4, ?4)
                                 ON CONFLICT(device_id) DO UPDATE SET
                                    device_name = excluded.device_name,
                                    model = excluded.model,
                                    last_seen_at = excluded.last_seen_at",
            params![device_id, device_name, model, now_str],
        );
    }

    log_comm(
        "INFO",
        &format!(
            "[POST /api/v1/pair/confirm] 모바일 기기 페어링 완료 — {} ({}, id={})",
            device_name, model, device_id
        ),
    );
    let _ = app_handle.emit(
        "mobile-sync-event",
        serde_json::json!({
            "type": "paired",
            "message": format!("📱 모바일 기기 QR 페어링 완료: {} ({})", device_name, model)
        }),
    );

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "registered_device_id": device_id
        }),
    );
}

/// `else if url_path == "/api/v1/sync/check-hashes"`
pub(crate) fn handle_check_hashes(mut request: tiny_http::Request, db_path: PathBuf) {
    let mut body_str = String::new();
    let _ = request.as_reader().read_to_string(&mut body_str);
    let json_val: serde_json::Value =
        serde_json::from_str(&body_str).unwrap_or(serde_json::json!({}));
    let hashes: Vec<String> = json_val
        .get("hashes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let total_req = hashes.len();

    if !check_request_token_fast(&request, &db_path) {
        respond_json(
            request,
            401,
            serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
        );
        return;
    }

    let mut missing_hashes = Vec::new();
    let mut db_candidates = Vec::new();
    for h in hashes {
        if is_hash_synced_in_memory(&h) {
            continue;
        }
        db_candidates.push(h);
    }

    if !db_candidates.is_empty() {
        if let Ok(conn) = open_db(&db_path) {
            for h in db_candidates {
                let exists_in_sync: bool = conn
                    .query_row(
                        "SELECT 1 FROM synced_file_hashes WHERE file_hash = ?1 LIMIT 1",
                        params![h],
                        |_| Ok(true),
                    )
                    .unwrap_or(false);
                let exists_in_media: bool = conn
                    .query_row(
                        "SELECT 1 FROM media_inbox WHERE content_hash = ?1 LIMIT 1",
                        params![h],
                        |_| Ok(true),
                    )
                    .unwrap_or(false);
                if exists_in_sync || exists_in_media {
                    mark_hash_synced_in_memory(&h);
                } else {
                    missing_hashes.push(h);
                }
            }
        } else {
            missing_hashes = db_candidates;
        }
    }

    log_comm(
        "INFO",
        &format!(
            "[POST /api/v1/sync/check-hashes] 요청 {}건 중 미전송 {}건 (스킵 {}건)",
            total_req,
            missing_hashes.len(),
            total_req.saturating_sub(missing_hashes.len())
        ),
    );
    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "missing_hashes": missing_hashes
        }),
    );
}
