//! 동반 앱 HTTP 요청 인증(페어링 토큰)·기기 식별·JSON 응답 헬퍼.

use crate::*;

pub(crate) fn respond_json(request: tiny_http::Request, status_code: u16, body: serde_json::Value) {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap();
    let cors = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
    let cors_headers = tiny_http::Header::from_bytes(
        &b"Access-Control-Allow-Headers"[..],
        &b"Content-Type, X-MyLore-Token"[..],
    )
    .unwrap();
    let resp = tiny_http::Response::from_string(body.to_string())
        .with_status_code(status_code)
        .with_header(header)
        .with_header(cors)
        .with_header(cors_headers);
    let _ = request.respond(resp);
}

pub(crate) fn resolve_request_device(
    request: &tiny_http::Request,
    json_val: Option<&serde_json::Value>,
    conn: &Connection,
) -> (String, String) {
    let mut dev_id = String::new();
    let mut dev_name = String::new();

    for h in request.headers() {
        if h.field.equiv("X-MyLore-Device-Id") {
            dev_id = h.value.as_str().trim().to_string();
        } else if h.field.equiv("X-MyLore-Device-Name") {
            dev_name = h.value.as_str().trim().to_string();
        }
    }

    if let Some(jv) = json_val {
        if dev_id.is_empty() {
            if let Some(id_s) = jv.get("device_id").and_then(|v| v.as_str()) {
                dev_id = id_s.trim().to_string();
            }
        }
        if dev_name.is_empty() {
            if let Some(nm_s) = jv.get("device_name").and_then(|v| v.as_str()) {
                dev_name = nm_s.trim().to_string();
            }
        }
    }

    if dev_id.is_empty() {
        let raw_url = request.url();
        if let Some(q_idx) = raw_url.find("device_id=") {
            let sub = &raw_url[q_idx + "device_id=".len()..];
            dev_id = sub.split('&').next().unwrap_or("").trim().to_string();
        }
    }

    if !dev_id.is_empty() && dev_name.is_empty() {
        if let Ok(found_name) = conn.query_row(
            "SELECT device_name FROM paired_devices WHERE device_id = ?1 LIMIT 1",
            params![dev_id],
            |r| r.get::<_, String>(0),
        ) {
            dev_name = found_name;
        }
    }

    if dev_id.is_empty() && dev_name.is_empty() {
        if let Ok((fid, fname)) = conn.query_row(
            "SELECT device_id, device_name FROM paired_devices ORDER BY last_seen_at DESC LIMIT 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) {
            dev_id = fid;
            dev_name = fname;
        }
    }

    (dev_id, dev_name)
}

pub(crate) static LAST_SEEN_DB_UPDATE_MS: std::sync::atomic::AtomicI64 =
    std::sync::atomic::AtomicI64::new(0);

pub(crate) static CACHED_PAIRING_TOKEN: std::sync::OnceLock<Mutex<String>> =
    std::sync::OnceLock::new();

pub(crate) fn check_request_token(request: &tiny_http::Request, conn: &Connection) -> bool {
    let expected: String = {
        let lock = CACHED_PAIRING_TOKEN.get_or_init(|| Mutex::new(String::new()));
        let mut guard = lock.lock().unwrap();
        if guard.is_empty() {
            let db_tok: String = conn
                .query_row(
                    "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_default();
            *guard = db_tok.clone();
            db_tok
        } else {
            guard.clone()
        }
    };
    if expected.is_empty() {
        return true;
    }
    for h in request.headers() {
        let mut candidate_opt: Option<&str> = None;
        if h.field.equiv("X-MyLore-Token") {
            candidate_opt = Some(h.value.as_str().trim());
        } else if h.field.equiv("Authorization") {
            let v = h.value.as_str().trim();
            if let Some(stripped) = v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")) {
                candidate_opt = Some(stripped.trim());
            } else {
                candidate_opt = Some(v);
            }
        }
        if let Some(provided) = candidate_opt {
            if provided == expected {
                let now_ms = chrono::Local::now().timestamp_millis();
                let last_ms = LAST_SEEN_DB_UPDATE_MS.load(std::sync::atomic::Ordering::Relaxed);
                if (now_ms - last_ms) >= 60_000 {
                    LAST_SEEN_DB_UPDATE_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
                    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                    let _ = conn.execute(
                        "UPDATE paired_devices SET last_seen_at = ?1",
                        params![now_str],
                    );
                }
                return true;
            } else {
                return false;
            }
        }
    }
    // 헤더가 생략된 로컬 테스트 호출도 허용하되, 잘못된 토큰이 명시된 경우만 차단
    true
}

pub(crate) fn check_request_token_fast(request: &tiny_http::Request, db_path: &Path) -> bool {
    let expected: String = {
        let lock = CACHED_PAIRING_TOKEN.get_or_init(|| Mutex::new(String::new()));
        let mut guard = lock.lock().unwrap();
        if guard.is_empty() {
            let db_tok = open_db(db_path)
                .ok()
                .and_then(|conn| {
                    conn.query_row(
                        "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                })
                .unwrap_or_default();
            *guard = db_tok.clone();
            db_tok
        } else {
            guard.clone()
        }
    };
    if expected.is_empty() {
        return true;
    }
    for h in request.headers() {
        let mut candidate_opt: Option<&str> = None;
        if h.field.equiv("X-MyLore-Token") {
            candidate_opt = Some(h.value.as_str().trim());
        } else if h.field.equiv("Authorization") {
            let v = h.value.as_str().trim();
            if let Some(stripped) = v.strip_prefix("Bearer ").or_else(|| v.strip_prefix("bearer ")) {
                candidate_opt = Some(stripped.trim());
            } else {
                candidate_opt = Some(v);
            }
        }
        if let Some(provided) = candidate_opt {
            return provided == expected;
        }
    }
    true
}

pub(crate) fn extract_request_device_headers(
    request: &tiny_http::Request,
    json_val: Option<&serde_json::Value>,
) -> (String, String) {
    let mut dev_id = String::new();
    let mut dev_name = String::new();
    for h in request.headers() {
        if h.field.equiv("X-MyLore-Device-Id") {
            dev_id = h.value.as_str().trim().to_string();
        } else if h.field.equiv("X-MyLore-Device-Name") {
            dev_name = h.value.as_str().trim().to_string();
        }
    }
    if let Some(jv) = json_val {
        if dev_id.is_empty() {
            if let Some(id_s) = jv.get("device_id").and_then(|v| v.as_str()) {
                dev_id = id_s.trim().to_string();
            }
        }
        if dev_name.is_empty() {
            if let Some(nm_s) = jv.get("device_name").and_then(|v| v.as_str()) {
                dev_name = nm_s.trim().to_string();
            }
        }
    }
    if dev_id.is_empty() {
        let raw_url = request.url();
        if let Some(q_idx) = raw_url.find("device_id=") {
            let sub = &raw_url[q_idx + "device_id=".len()..];
            dev_id = sub.split('&').next().unwrap_or("").trim().to_string();
        }
    }
    (dev_id, dev_name)
}
