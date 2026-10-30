//! 동반 앱 HTTP 라우트: 통화 녹음/미디어/삼성 헬스 수신, 로컬 미디어 서빙, 정적 파일(fallback).

use crate::*;

/// `else if url_path == "/api/v1/sync/call-recordings"`
pub(crate) fn handle_sync_call_recordings(mut request: tiny_http::Request, db_path: PathBuf) {
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
    let mut file_hash = blake3::hash(&raw_bytes).to_hex().to_string();
    let mut file_name = format!(
        "CallRec_{}.m4a",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let mut contact_label = String::new();
    let mut transcript_text = String::new();
    let mut audio_bytes: Vec<u8> = Vec::new();

    if raw_bytes.first() == Some(&b'{') {
        if let Ok(jv) = serde_json::from_slice::<serde_json::Value>(&raw_bytes) {
            if let Some(fh) = jv.get("file_hash").and_then(|v| v.as_str()) {
                file_hash = fh.to_string();
            }
            if let Some(fn_s) = jv.get("file_name").and_then(|v| v.as_str()) {
                file_name = fn_s.to_string();
            }
            if let Some(cl) = jv.get("contact_name").and_then(|v| v.as_str()) {
                if !cl.is_empty() && !cl.starts_with("--") {
                    contact_label = cl.to_string();
                }
            }
            if let Some(b64) = jv.get("base64_data").and_then(|v| v.as_str()) {
                audio_bytes = base64_decode(b64);
            }
            if let Some(tr) = jv.get("transcript").and_then(|v| v.as_str()) {
                transcript_text = tr.to_string();
            }
        }
    } else {
        let header_str =
            String::from_utf8_lossy(&raw_bytes[..std::cmp::min(raw_bytes.len(), 4096)]);
        {
            let re_fh = cached_regex!(r#"name="file_hash"[\s\S]*?\r?\n\r?\n([0-9a-fA-F]{32,128})"#);
            if let Some(cap) = re_fh.captures(&header_str) {
                if let Some(m) = cap.get(1) {
                    file_hash = m.as_str().trim().to_string();
                }
            }
        }
        {
            let re_cn = cached_regex!(r#"name="contact_name"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#);
            if let Some(cap) = re_cn.captures(&header_str) {
                if let Some(m) = cap.get(1) {
                    let cname = m.as_str().trim();
                    if !cname.is_empty() && !cname.starts_with("--") {
                        contact_label = cname.to_string();
                    }
                }
            }
        }
        let fn_re = cached_regex!(r#"filename="([^"]+)""#);
        if let Some(cap) = fn_re.captures(&header_str) {
            if let Some(m) = cap.get(1) {
                file_name = m.as_str().to_string();
            }
        }
        let (clean_b, _) = strip_multipart_prefix_if_present(&raw_bytes);
        audio_bytes = clean_b;
    }

    if !file_hash.is_empty() {
        mark_hash_synced_in_memory(&file_hash);
    }
    let now_ms = chrono::Local::now().timestamp_millis();
    update_atomic_max_i64(&MEM_LAST_RECORDING_TS, now_ms);
    let (dev_id, dev_name) = extract_request_device_headers(&request, None);
    let has_transcript = !transcript_text.is_empty();

    enqueue_sync_worker_job(SyncWorkerJob::CallRecording {
        dev_id,
        dev_name,
        file_hash: file_hash.clone(),
        file_name,
        contact_label,
        transcript_text,
        audio_bytes,
        now_ms,
    });

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "file_hash": file_hash,
            "last_recording_ts": now_ms,
            "transcript_generated": has_transcript
        }),
    );
}

/// `else if url_path == "/api/v1/sync/media"`
pub(crate) fn handle_sync_media(mut request: tiny_http::Request, db_path: PathBuf) {
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

    let mut file_name = format!(
        "QuickCam_{}.jpg",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let mut source_type = String::new();
    let mut folder_name = String::new();
    let mut file_bytes: Vec<u8> = Vec::new();
    let mut taken_date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut taken_time = chrono::Local::now().format("%H:%M:%S").to_string();

    if raw_bytes.first() == Some(&b'{') {
        if let Ok(json_val) = serde_json::from_slice::<serde_json::Value>(&raw_bytes) {
            if let Some(fn_str) = json_val.get("file_name").and_then(|v| v.as_str()) {
                if !fn_str.trim().is_empty() {
                    file_name = fn_str.trim().to_string();
                }
            }
            if let Some(st_str) = json_val.get("source_type").and_then(|v| v.as_str()) {
                source_type = st_str.trim().to_string();
            }
            if let Some(fd_str) = json_val.get("folder_name").and_then(|v| v.as_str()) {
                folder_name = fd_str.trim().to_string();
            }
            if let Some(b64) = json_val.get("base64_data").and_then(|v| v.as_str()) {
                file_bytes = base64_decode(b64);
            }
            if let Some(ta) = json_val.get("taken_at").and_then(|v| v.as_str()) {
                if ta.len() >= 10 {
                    taken_date = ta[..10].to_string();
                }
                if ta.len() >= 19 {
                    taken_time = ta[11..19].to_string();
                }
            }
        }
    } else {
        let header_part =
            String::from_utf8_lossy(&raw_bytes[..std::cmp::min(raw_bytes.len(), 4096)]);
        let fn_re = cached_regex!(r#"filename="([^"]+)""#);
        if let Some(cap) = fn_re.captures(&header_part) {
            if let Some(m) = cap.get(1) {
                file_name = m.as_str().to_string();
            }
        }
        {
            let re_st = cached_regex!(r#"name="source_type"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#);
            if let Some(cap) = re_st.captures(&header_part) {
                if let Some(m) = cap.get(1) {
                    source_type = m.as_str().trim().to_string();
                }
            }
        }
        {
            let re_fd = cached_regex!(r#"name="folder_name"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#);
            if let Some(cap) = re_fd.captures(&header_part) {
                if let Some(m) = cap.get(1) {
                    folder_name = m.as_str().trim().to_string();
                }
            }
        }
        let (clean_b, _) = strip_multipart_prefix_if_present(&raw_bytes);
        file_bytes = clean_b;
    }

    let media_uuid = Uuid::new_v4().to_string();
    let content_hash = blake3::hash(&file_bytes).to_hex().to_string();
    mark_hash_synced_in_memory(&content_hash);

    enqueue_sync_worker_job(SyncWorkerJob::Media {
        file_name,
        source_type,
        folder_name,
        file_bytes,
        taken_date,
        taken_time,
        media_uuid: media_uuid.clone(),
        content_hash,
    });

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "uuid": media_uuid,
            "uri": format!("mylore://media/{}", media_uuid)
        }),
    );
}

/// `else if url_path == "/api/v1/sync/samsung-health"`
pub(crate) fn handle_sync_samsung_health(mut request: tiny_http::Request, db_path: PathBuf) {
    // 삼성 헬스 및 갤럭시 워치 GPS 운동 데이터 동기화 엔드포인트 (백그라운드 워커 큐 적재)
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
    let now_ms = chrono::Local::now().timestamp_millis();
    update_atomic_max_i64(&MEM_LAST_HEALTH_TS, now_ms);
    let (dev_id, dev_name) = extract_request_device_headers(&request, None);

    enqueue_sync_worker_job(SyncWorkerJob::SamsungHealth {
        dev_id,
        dev_name,
        raw_bytes,
        now_ms,
    });

    respond_json(
        request,
        200,
        serde_json::json!({
            "ok": true,
            "queued": true,
            "last_health_ts": now_ms
        }),
    );
}

/// `else if url_path == "/api/v1/local-media"`
pub(crate) fn handle_local_media(request: tiny_http::Request, db_path: PathBuf, raw_url: &str) {
    // 로컬 미디어 파일(카톡 사진/동영상, 통화녹음/음성녹음 m4a 등)을 WebView `<img/>`, `<video/>`, `<audio/>`에 서빙
    let query = raw_url.splitn(2, '?').nth(1).unwrap_or("");
    let mut req_file = String::new();
    let mut req_sub = String::new();
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let k = kv.next().unwrap_or("");
        let v = kv.next().unwrap_or("");
        if k == "file" {
            req_file = url_decode_utf8(v);
        } else if k == "sub" {
            req_sub = url_decode_utf8(v);
        }
    }

    let clean_name = req_file
        .trim()
        .trim_start_matches("audio/")
        .trim_start_matches("media/")
        .trim_matches(|c| c == '[' || c == ']' || c == '<' || c == '>')
        .to_string();

    let mut found_path: Option<PathBuf> = None;
    if let Ok(conn) = open_db(&db_path) {
        let data_base: String = data_base_path_string(&conn);
        let base_p = Path::new(&data_base);
        let mut candidates = Vec::new();
        if !req_sub.is_empty() {
            candidates.push(base_p.join("mobile").join(&req_sub).join(&clean_name));
        }
        candidates.push(
            base_p
                .join("mobile")
                .join("calls")
                .join("audio")
                .join(&clean_name),
        );
        candidates.push(
            base_p
                .join("mobile")
                .join("recordings")
                .join("audio")
                .join(&clean_name),
        );
        candidates.push(
            base_p
                .join("mobile")
                .join("kakao")
                .join("media")
                .join(&clean_name),
        );
        candidates.push(base_p.join("mobile").join("kakao").join(&clean_name));
        candidates.push(base_p.join("_MediaInbox").join(&clean_name));

        // `mobile/kakao/{folder_name}/` 하위 폴더에 그대로 적재된 이미지/동영상도 탐색
        let kakao_root = base_p.join("mobile").join("kakao");
        if let Ok(entries) = fs::read_dir(&kakao_root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    candidates.push(p.join(&clean_name));
                }
            }
        }

        for c in candidates {
            if c.exists() && c.is_file() {
                found_path = Some(c);
                break;
            }
        }
    }

    if let Some(fp) = found_path {
        if let Ok(mut bytes) = fs::read(&fp) {
            let (clean_b, repaired) = strip_multipart_prefix_if_present(&bytes);
            if repaired {
                let _ = fs::write(&fp, &clean_b);
                bytes = clean_b;
            }
            let lower = fp.to_string_lossy().to_lowercase();
            let mime = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
                "image/jpeg"
            } else if lower.ends_with(".png") {
                "image/png"
            } else if lower.ends_with(".gif") {
                "image/gif"
            } else if lower.ends_with(".webp") {
                "image/webp"
            } else if lower.ends_with(".bmp") {
                "image/bmp"
            } else if lower.ends_with(".mp4") || lower.ends_with(".m4v") {
                "video/mp4"
            } else if lower.ends_with(".mov") {
                "video/quicktime"
            } else if lower.ends_with(".webm") {
                "video/webm"
            } else if lower.ends_with(".m4a") {
                "audio/mp4"
            } else if lower.ends_with(".mp3") {
                "audio/mpeg"
            } else if lower.ends_with(".amr") {
                "audio/amr"
            } else if lower.ends_with(".wav") {
                "audio/wav"
            } else if lower.ends_with(".ogg") {
                "audio/ogg"
            } else {
                "application/octet-stream"
            };
            let total_len = bytes.len();
            let range_header = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Range"))
                .map(|h| h.value.as_str().to_string());

            let h_ct =
                tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap();
            let h_cors =
                tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..])
                    .unwrap();
            let h_ar = tiny_http::Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap();

            if let Some(rh) = range_header {
                if let Some(spec) = rh.strip_prefix("bytes=") {
                    let parts: Vec<&str> = spec.split('-').collect();
                    if !parts.is_empty() && total_len > 0 {
                        let start = parts[0]
                            .trim()
                            .parse::<usize>()
                            .unwrap_or(0)
                            .min(total_len.saturating_sub(1));
                        let end = if parts.len() > 1 && !parts[1].trim().is_empty() {
                            parts[1]
                                .trim()
                                .parse::<usize>()
                                .unwrap_or(total_len.saturating_sub(1))
                                .min(total_len.saturating_sub(1))
                        } else {
                            total_len.saturating_sub(1)
                        };
                        if start <= end && end < total_len {
                            let slice = bytes[start..=end].to_vec();
                            let cr_val = format!("bytes {}-{}/{}", start, end, total_len);
                            let h_cr = tiny_http::Header::from_bytes(
                                &b"Content-Range"[..],
                                cr_val.as_bytes(),
                            )
                            .unwrap();
                            let _ = request.respond(
                                tiny_http::Response::from_data(slice)
                                    .with_status_code(206)
                                    .with_header(h_ct)
                                    .with_header(h_cors)
                                    .with_header(h_ar)
                                    .with_header(h_cr),
                            );
                            return;
                        }
                    }
                }
            }

            let _ = request.respond(
                tiny_http::Response::from_data(bytes)
                    .with_header(h_ct)
                    .with_header(h_cors)
                    .with_header(h_ar),
            );
            return;
        }
    }

    respond_json(
        request,
        404,
        serde_json::json!({ "ok": false, "error": "Media file not found locally" }),
    );
}

/// 그 외 경로: Chrome App Mode(`chrome.exe --app=http://127.0.0.1:18443`)용 프론트엔드 정적 파일 서빙 (없으면 `{"ok": true}`)
///
/// 개발 PC의 `dist/` 폴더 대신 **실행 파일에 내장된 프론트엔드 자산**(Tauri asset resolver)을 사용하므로 설치 위치와 무관하게 동작합니다.
pub(crate) fn handle_static_or_fallback(
    request: tiny_http::Request,
    app_handle: AppHandle,
    url_path: &str,
) {
    let clean_path = url_path.trim_start_matches('/');
    let rel_file = if clean_path.is_empty() {
        "index.html"
    } else {
        clean_path
    };
    if let Some(asset) = app_handle.asset_resolver().get(rel_file.to_string()) {
        let mime = if rel_file.ends_with(".html") {
            "text/html; charset=utf-8".to_string()
        } else if rel_file.ends_with(".js") {
            "application/javascript; charset=utf-8".to_string()
        } else if rel_file.ends_with(".css") {
            "text/css; charset=utf-8".to_string()
        } else {
            asset.mime_type().to_string()
        };
        let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap();
        let _ = request
            .respond(tiny_http::Response::from_data(asset.bytes().to_vec()).with_header(header));
        return;
    }
    respond_json(request, 200, serde_json::json!({ "ok": true }));
}
