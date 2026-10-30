//! 동반 앱 HTTP 라우트: 알림/문자/통화기록/카톡/연락처/앱 사용량 동기화 수신 → 워커 큐 적재.

use crate::*;

/// `else if url_path == "/api/v1/sync/notifications"`
pub(crate) fn handle_sync_notifications(mut request: tiny_http::Request, db_path: PathBuf) {
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
    let empty_vec = Vec::new();
    let items = json_val
        .get("items")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);
    let total_count = json_val
        .get("total_count")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or_else(|| items.len().max(1));
    let current_index = json_val
        .get("current_index")
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .unwrap_or(total_count);

    let (dev_id, dev_name) = extract_request_device_headers(&request, Some(&json_val));
    let mut ack_ids = Vec::with_capacity(items.len());
    let mut worker_items = Vec::with_capacity(items.len());
    let mut max_ts = 0i64;

    for item in items {
        if let Some(id_val) = item.get("id") {
            ack_ids.push(id_val.clone());
        }
        let pkg = item
            .get("pkg")
            .and_then(|v| v.as_str())
            .unwrap_or("app")
            .to_string();
        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let text = item
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ts = item.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
        if ts > max_ts {
            max_ts = ts;
        }
        worker_items.push((pkg, title, text, ts));
    }
    if max_ts > 0 {
        update_atomic_max_i64(&MEM_LAST_NOTI_TS, max_ts);
    }

    if !worker_items.is_empty() {
        enqueue_sync_worker_job(SyncWorkerJob::Notifications {
            dev_id,
            dev_name,
            items: worker_items,
            current_index,
            total_count,
        });
    }

    let pct = ((current_index as f64 / total_count.max(1) as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as usize;
    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "ack_ids": ack_ids,
            "finance_parsed": 0,
            "current_index": current_index,
            "total_count": total_count,
            "percent": pct,
            "last_noti_ts": max_ts
        }),
    );
}

/// `else if url_path == "/api/v1/sync/sms"`
pub(crate) fn handle_sync_sms(mut request: tiny_http::Request, db_path: PathBuf) {
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
    let empty_vec = Vec::new();
    let items = json_val
        .get("items")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);

    let (dev_id, dev_name) = extract_request_device_headers(&request, Some(&json_val));
    let mut ack_ids = Vec::with_capacity(items.len());
    let mut worker_items = Vec::with_capacity(items.len());
    let mut max_ts = 0i64;

    for item in items {
        if let Some(id_val) = item.get("id") {
            ack_ids.push(id_val.clone());
        }
        let address = item
            .get("address")
            .and_then(|v| v.as_str())
            .unwrap_or("알수없음")
            .to_string();
        let raw_body = item.get("body").and_then(|v| v.as_str()).unwrap_or("");
        let clean_body = clean_mms_and_multiline_body(raw_body);
        let sms_type = item
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("inbox")
            .to_string();
        let ts = item.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
        if ts > max_ts {
            max_ts = ts;
        }
        worker_items.push((address, clean_body, sms_type, ts));
    }
    if max_ts > 0 {
        update_atomic_max_i64(&MEM_LAST_SMS_TS, max_ts);
    }

    if !worker_items.is_empty() {
        enqueue_sync_worker_job(SyncWorkerJob::Sms {
            dev_id,
            dev_name,
            items: worker_items,
        });
    }

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "ack_ids": ack_ids,
            "finance_parsed": 0,
            "last_sms_ts": max_ts
        }),
    );
}

/// `else if url_path == "/api/v1/sync/call-logs"`
pub(crate) fn handle_sync_call_logs(mut request: tiny_http::Request, db_path: PathBuf) {
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
    let empty_vec = Vec::new();
    let items = json_val
        .get("items")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);

    let (dev_id, dev_name) = extract_request_device_headers(&request, Some(&json_val));
    let mut ack_ids = Vec::with_capacity(items.len());
    let mut worker_items = Vec::with_capacity(items.len());
    let mut max_ts = 0i64;

    for item in items {
        if let Some(id_val) = item.get("id") {
            ack_ids.push(id_val.clone());
        }
        let number = item
            .get("number")
            .and_then(|v| v.as_str())
            .unwrap_or("번호없음")
            .to_string();
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let call_type = item
            .get("call_type")
            .and_then(|v| v.as_str())
            .unwrap_or("incoming")
            .to_string();
        let duration_sec = item
            .get("duration_sec")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let ts = item.get("ts").and_then(|v| v.as_i64()).unwrap_or(0);
        if ts > max_ts {
            max_ts = ts;
        }
        worker_items.push((number, name, call_type, duration_sec, ts));
    }
    if max_ts > 0 {
        update_atomic_max_i64(&MEM_LAST_CALL_TS, max_ts);
    }

    let item_len = worker_items.len();
    if !worker_items.is_empty() {
        enqueue_sync_worker_job(SyncWorkerJob::CallLogs {
            dev_id,
            dev_name,
            items: worker_items,
        });
    }

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "ack_ids": ack_ids,
            "inserted_count": item_len,
            "last_call_ts": max_ts
        }),
    );
}

/// `else if url_path == "/api/v1/sync/kakao-chats"`
pub(crate) fn handle_sync_kakao_chats(mut request: tiny_http::Request, db_path: PathBuf) {
    let mut raw_bytes = Vec::new();
    let _ = request.as_reader().read_to_end(&mut raw_bytes);
    if !check_request_token_fast(&request, &db_path) {
        respond_json(
            request,
            401,
            serde_json::json!({ "ok": false, "error": "Invalid X-MyLore-Token" }),
        );
        return;
    }
    let body_str = String::from_utf8_lossy(&raw_bytes).to_string();

    let mut room_name = "카카오톡 대화방".to_string();
    let mut raw_folder_name = String::new();
    let mut raw_text = String::new();
    let mut file_hash = String::new();
    let mut folder_index = 1usize;
    let mut total_folders = 1usize;

    let trimmed = body_str.trim();
    if trimmed.starts_with('{') {
        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(fnm) = json_val.get("folder_name").and_then(|v| v.as_str()) {
                raw_folder_name = fnm.trim().to_string();
            }
            if let Some(rn) = json_val
                .get("room_name")
                .or_else(|| json_val.get("folder_name"))
                .and_then(|v| v.as_str())
            {
                room_name = rn.to_string();
            }
            if let Some(rt) = json_val.get("raw_text").and_then(|v| v.as_str()) {
                raw_text = rt.to_string();
            }
            if let Some(fh) = json_val.get("file_hash").and_then(|v| v.as_str()) {
                file_hash = fh.to_string();
            }
            if let Some(fi) = json_val.get("folder_index").and_then(|v| v.as_u64()) {
                folder_index = (fi as usize).max(1);
            }
            if let Some(tf) = json_val.get("total_folders").and_then(|v| v.as_u64()) {
                total_folders = (tf as usize).max(1);
            }
        }
    } else {
        let (parsed_folder, parsed_hash, clean_txt, fi, tf) =
            parse_multipart_kakao_payload(&body_str);
        folder_index = fi;
        total_folders = tf;
        if !parsed_folder.is_empty() {
            raw_folder_name = parsed_folder.clone();
            room_name = parsed_folder;
        }
        if !parsed_hash.is_empty() {
            file_hash = parsed_hash;
        }
        for line in clean_txt.lines() {
            let t = line.trim().trim_start_matches('\u{feff}');
            if t.contains("님과 카카오톡 대화") {
                room_name = t.replace("님과 카카오톡 대화", "").trim().to_string();
                break;
            } else if t.ends_with("카카오톡 대화") {
                let cand = t.trim_end_matches("카카오톡 대화").trim();
                if !cand.is_empty() {
                    room_name = cand.to_string();
                    break;
                }
            }
        }
        raw_text = clean_txt;
    }

    if file_hash.is_empty() && !raw_text.is_empty() {
        file_hash = blake3::hash(raw_text.as_bytes()).to_hex().to_string();
    }
    if !file_hash.is_empty() {
        mark_hash_synced_in_memory(&file_hash);
    }

    let now_ms = chrono::Local::now().timestamp_millis();
    update_atomic_max_i64(&MEM_LAST_KAKAO_TS, now_ms);
    let (dev_id, _) = extract_request_device_headers(&request, None);

    enqueue_sync_worker_job(SyncWorkerJob::KakaoChat {
        dev_id,
        room_name: room_name.clone(),
        raw_folder_name: raw_folder_name.clone(),
        raw_text,
        file_hash,
        folder_index,
        total_folders,
        now_ms,
    });

    let pct = ((folder_index as f64 / total_folders.max(1) as f64) * 100.0)
        .round()
        .clamp(0.0, 100.0) as usize;
    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "room_name": room_name,
            "folder_name": raw_folder_name,
            "folder_index": folder_index,
            "total_folders": total_folders,
            "percent": pct,
            "messages_added": 0,
            "overlapping_count": 0,
            "last_kakao_ts": now_ms,
            "verified_for_cleanup": true
        }),
    );
}

/// `else if url_path == "/api/v1/sync/contacts"`
pub(crate) fn handle_sync_contacts(mut request: tiny_http::Request, db_path: PathBuf) {
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
    let empty_vec = Vec::new();
    let items = json_val
        .get("items")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);

    let (dev_id, _) = extract_request_device_headers(&request, Some(&json_val));
    let mut worker_items = Vec::with_capacity(items.len());
    let mut max_ts = 0i64;

    for item in items {
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("이름없음")
            .to_string();
        let phones: Vec<String> = item
            .get("phones")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let org = item
            .get("organization")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let memo = item
            .get("memo")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let ts = item.get("updated_ts").and_then(|v| v.as_i64()).unwrap_or(0);
        if ts > max_ts {
            max_ts = ts;
        }
        worker_items.push((name, phones, org, memo, ts));
    }
    if max_ts > 0 {
        update_atomic_max_i64(&MEM_LAST_CONTACT_TS, max_ts);
    }

    let upserted_count = worker_items.len();
    if !worker_items.is_empty() {
        enqueue_sync_worker_job(SyncWorkerJob::Contacts {
            dev_id,
            items: worker_items,
        });
    }

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "upserted_count": upserted_count,
            "last_contact_ts": max_ts
        }),
    );
}

/// `else if url_path == "/api/v1/sync/app-usage"`
pub(crate) fn handle_sync_app_usage(mut request: tiny_http::Request, db_path: PathBuf) {
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
    let empty_vec = Vec::new();
    let items = json_val
        .get("items")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);

    let (dev_id, _) = extract_request_device_headers(&request, Some(&json_val));
    let mut worker_items = Vec::with_capacity(items.len());
    let mut max_ts = 0i64;

    for item in items {
        let date_str = item
            .get("date")
            .and_then(|v| v.as_str())
            .unwrap_or("2026-10-30")
            .to_string();
        let pkg = item
            .get("pkg")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let app_name = item
            .get("app_name")
            .and_then(|v| v.as_str())
            .unwrap_or(&pkg)
            .to_string();
        let fg_ms = item
            .get("total_foreground_ms")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let launch_count = item
            .get("launch_count")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let last_used = item
            .get("last_time_used")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if last_used > max_ts {
            max_ts = last_used;
        }
        worker_items.push((date_str, pkg, app_name, fg_ms, launch_count, last_used));
    }
    if max_ts > 0 {
        update_atomic_max_i64(&MEM_LAST_USAGE_TS, max_ts);
    }

    let recorded_count = worker_items.len();
    if !worker_items.is_empty() {
        let payload_digest = blake3::hash(body_str.as_bytes()).to_hex().to_string();
        let now_ms = chrono::Local::now().timestamp_millis();
        let should_enqueue = {
            let mutex = LAST_APP_USAGE_DIGEST.get_or_init(|| Mutex::new((String::new(), 0)));
            if let Ok(mut guard) = mutex.lock() {
                if guard.0 != payload_digest || (now_ms - guard.1) >= 60_000 {
                    *guard = (payload_digest, now_ms);
                    true
                } else {
                    false
                }
            } else {
                true
            }
        };
        if should_enqueue {
            enqueue_sync_worker_job(SyncWorkerJob::AppUsage {
                dev_id,
                items: worker_items,
            });
        }
    }

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "recorded_count": recorded_count,
            "last_usage_ts": max_ts
        }),
    );
}
