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
    ) = (0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64, 0i64);
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

        if url_path == "/api/v1/sync/watermarks" {
            if force_full_sync {
                let _ = conn.execute(
                    "INSERT INTO mobile_sync_meta (key, value) VALUES ('force_full_sync', '0')
                                         ON CONFLICT(key) DO UPDATE SET value = '0'",
                    [],
                );
            } else if !INITIAL_SYNC_CHECKED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                // 서버 기동 후 첫 워터마크 핸드셰이크 시:
                // 폰은 이미 전송했다고 기억(watermark > 0)하지만 PC DB에는 해당 항목이 0건인 경우 자동 재동기화 유도
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

                let db_kakao_cnt: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'kakaotalk'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let db_sms_cnt: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'sms'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let db_call_cnt: i64 = conn
                    .query_row("SELECT COUNT(*) FROM lifelog_call_logs", [], |r| r.get(0))
                    .unwrap_or(0);
                let db_noti_cnt: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'notification'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);

                if (c_kakao > 0 && db_kakao_cnt == 0)
                    || (c_sms > 0 && db_sms_cnt == 0)
                    || (c_call > 0 && db_call_cnt == 0)
                    || (c_noti > 0 && db_noti_cnt == 0)
                {
                    force_full_sync = true;
                    reset_in_memory_sync_caches();
                    enqueue_sync_worker_job(SyncWorkerJob::StartSyncInspection {
                        reset_watermarks: false,
                    });
                }
            }
        }

        if !force_full_sync {
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
            last_kakao_ts = get_meta_i64(&conn, "last_kakao_ts")
                .max(MEM_LAST_KAKAO_TS.load(std::sync::atomic::Ordering::Relaxed));
            last_sms_ts = get_meta_i64(&conn, "last_sms_ts")
                .max(MEM_LAST_SMS_TS.load(std::sync::atomic::Ordering::Relaxed));
            last_call_ts = get_meta_i64(&conn, "last_call_ts")
                .max(MEM_LAST_CALL_TS.load(std::sync::atomic::Ordering::Relaxed));
            last_noti_ts = get_meta_i64(&conn, "last_noti_ts")
                .max(MEM_LAST_NOTI_TS.load(std::sync::atomic::Ordering::Relaxed));
            last_recording_ts = get_meta_i64(&conn, "last_recording_ts")
                .max(MEM_LAST_RECORDING_TS.load(std::sync::atomic::Ordering::Relaxed));
            last_health_ts = get_meta_i64(&conn, "last_health_ts")
                .max(MEM_LAST_HEALTH_TS.load(std::sync::atomic::Ordering::Relaxed));
            last_contact_ts = get_meta_i64(&conn, "last_contact_ts")
                .max(MEM_LAST_CONTACT_TS.load(std::sync::atomic::Ordering::Relaxed));
            last_usage_ts = get_meta_i64(&conn, "last_usage_ts")
                .max(MEM_LAST_USAGE_TS.load(std::sync::atomic::Ordering::Relaxed));

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

            update_atomic_max_i64(&MEM_LAST_KAKAO_TS, last_kakao_ts);
            update_atomic_max_i64(&MEM_LAST_SMS_TS, last_sms_ts);
            update_atomic_max_i64(&MEM_LAST_CALL_TS, last_call_ts);
            update_atomic_max_i64(&MEM_LAST_NOTI_TS, last_noti_ts);
            update_atomic_max_i64(&MEM_LAST_RECORDING_TS, last_recording_ts);
            update_atomic_max_i64(&MEM_LAST_HEALTH_TS, last_health_ts);
            update_atomic_max_i64(&MEM_LAST_CONTACT_TS, last_contact_ts);
            update_atomic_max_i64(&MEM_LAST_USAGE_TS, last_usage_ts);
        }
    }
    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "status": "ok",
            "pc_name": pc_name,
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
            "last_usage_ts": last_usage_ts
        }),
    );
}

/// `else if url_path == "/api/v1/sync/batch-init"`
pub(crate) fn handle_batch_init(mut request: tiny_http::Request, app_handle: AppHandle) {
    // 카톡(전달할 전체 폴더 수) 또는 알림(전달할 전체 메시지 수) 동기화 시작 전 총 개수 선발송 수신
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

    enqueue_sync_worker_job(SyncWorkerJob::BatchInit {
        service: service.to_string(),
        total_count,
    });
    let pct = emit_live_service_sync_progress(
        &app_handle,
        service,
        0,
        total_count.max(1),
        0,
        0,
        Some(&format!("총 {}건 전송 준비 완료 (0%)", total_count)),
    );

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "service": service,
            "total_count": total_count,
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

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "missing_hashes": missing_hashes
        }),
    );
}
