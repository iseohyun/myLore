//! 모바일 동반 앱 페어링: 로컬 IP 탐지, UDP 깨우기, 페어링 정보/설정 커맨드.

use crate::*;

pub(crate) fn detect_local_ipv4_addresses() -> Vec<String> {
    let mut ips = Vec::new();
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(local_addr) = sock.local_addr() {
                let ip_str = local_addr.ip().to_string();
                if !ip_str.starts_with("127.") && !ips.contains(&ip_str) {
                    ips.push(ip_str);
                }
            }
        }
    }
    if let Ok(out) = Command::new("ipconfig")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        let text = String::from_utf8_lossy(&out.stdout);
        let ipv4_re = Regex::new(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})").unwrap();
        for line in text.lines() {
            if line.contains("IPv4") || line.contains("IP Address") {
                if let Some(cap) = ipv4_re.captures(line) {
                    if let Some(m) = cap.get(1) {
                        let ip = m.as_str().to_string();
                        if (ip.starts_with("192.168.")
                            || ip.starts_with("10.")
                            || ip.starts_with("172."))
                            && !ips.contains(&ip)
                        {
                            ips.push(ip);
                        }
                    }
                }
            }
        }
    }
    if ips.is_empty() {
        ips.push("127.0.0.1".to_string());
    }
    ips
}

pub(crate) fn broadcast_udp_pc_online() -> Result<(), String> {
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        let _ = sock.set_broadcast(true);
        let pc_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
        let payload = serde_json::json!({
            "event": "MYLORE_PC_ONLINE",
            "pc_name": pc_name,
            "port": 18443
        })
        .to_string();
        let _ = sock.send_to(payload.as_bytes(), "255.255.255.255:18444");
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn send_mobile_udp_wake_broadcast() -> Result<String, String> {
    broadcast_udp_pc_online()?;
    Ok("UDP 255.255.255.255:18444 로 MYLORE_PC_ONLINE 브로드캐스트 송출 완료".to_string())
}

pub(crate) fn build_mobile_pairing_payload(conn: &Connection) -> Result<MobilePairingPayload, String> {
    let pc_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
    let ips = detect_local_ipv4_addresses();
    let port: u16 = 18443;

    let token: String = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| {
            let t = format!("mylore_sec_{}", Uuid::new_v4().to_string().replace('-', ""));
            let _ = conn.execute(
                "INSERT OR REPLACE INTO mobile_sync_meta (key, value) VALUES ('pairing_token', ?1)",
                params![t],
            );
            t
        });

    let ssids_raw: String = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'allowed_ssids'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "[\"iseohyun\",\"seohyun5G\"]".to_string());
    let ssids: Vec<String> = serde_json::from_str(&ssids_raw)
        .unwrap_or_else(|_| vec!["iseohyun".to_string(), "seohyun5G".to_string()]);

    let created_at = chrono::Local::now().timestamp_millis();
    let qr_json_obj = serde_json::json!({
        "v": 1,
        "pc_name": pc_name,
        "ips": ips,
        "port": port,
        "token": token,
        "ssids": ssids,
        "created_at": created_at
    });
    let qr_json_raw = serde_json::to_string(&qr_json_obj).unwrap_or_default();
    let raw_b64 = base64_encode(qr_json_raw.as_bytes());
    let qr_base64 = format!("myloresync://pair?data={}", raw_b64);

    let mut stmt = conn
        .prepare(
            "SELECT device_id, device_name, model, paired_at, last_seen_at
             FROM paired_devices ORDER BY last_seen_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let paired_devices: Vec<PairedDeviceItem> = stmt
        .query_map([], |r| {
            Ok(PairedDeviceItem {
                device_id: r.get(0)?,
                device_name: r.get(1)?,
                model: r.get(2)?,
                paired_at: r.get(3)?,
                last_seen_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let last_noti_ts = get_meta_i64(conn, "last_noti_ts");
    let last_sms_ts = get_meta_i64(conn, "last_sms_ts");
    let last_call_ts = get_meta_i64(conn, "last_call_ts");

    Ok(MobilePairingPayload {
        qr_json_raw,
        qr_base64,
        pc_name,
        ips,
        port,
        token,
        ssids,
        paired_devices,
        last_noti_ts,
        last_sms_ts,
        last_call_ts,
    })
}

#[tauri::command]
pub(crate) async fn get_mobile_pairing_info(state: State<'_, AppState>) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn remove_paired_mobile_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let _ = conn.execute(
            "DELETE FROM paired_devices WHERE device_id = ?1",
            params![device_id],
        );
        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn trigger_full_mobile_resync(
    state: State<'_, AppState>,
) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        for key in [
            "last_kakao_ts",
            "last_noti_ts",
            "last_sms_ts",
            "last_call_ts",
            "last_recording_ts",
            "last_health_ts",
            "last_contact_ts",
            "last_usage_ts",
        ] {
            let _ = conn.execute(
                "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, '0')
                 ON CONFLICT(key) DO UPDATE SET value = '0'",
                params![key],
            );
        }
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES ('force_full_sync', '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        );
        let _ = conn.execute(
            "UPDATE paired_devices SET last_kakao_ts = 0, last_noti_ts = 0, last_sms_ts = 0, last_call_ts = 0, last_recording_ts = 0, last_health_ts = 0, last_contact_ts = 0, last_usage_ts = 0",
            [],
        );
        let _ = conn.execute("DELETE FROM synced_file_hashes", []);
        reset_in_memory_sync_caches();
        enqueue_sync_worker_job(SyncWorkerJob::StartSyncInspection {
            reset_watermarks: true,
        });

        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            let _ = sock.set_broadcast(true);
            let pc_name =
                std::env::var("COMPUTERNAME").unwrap_or_else(|_| "MYLORE-DESKTOP".to_string());
            let payload = serde_json::json!({
                "event": "MYLORE_FULL_RESYNC",
                "action": "mylore_full_resync",
                "force_full_sync": true,
                "pc_name": pc_name,
                "port": 18443
            })
            .to_string();
            let _ = sock.send_to(payload.as_bytes(), "255.255.255.255:18444");
        }

        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn update_mobile_pairing_config(
    state: State<'_, AppState>,
    ssids: Vec<String>,
    regenerate_token: bool,
) -> Result<MobilePairingPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;

        let cleaned_ssids: Vec<String> = ssids
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let final_ssids = if cleaned_ssids.is_empty() {
            vec!["iseohyun".to_string(), "seohyun5G".to_string()]
        } else {
            cleaned_ssids
        };
        let ssids_json = serde_json::to_string(&final_ssids).unwrap_or_default();
        conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES ('allowed_ssids', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![ssids_json],
        )
        .map_err(|e| e.to_string())?;

        if regenerate_token {
            let new_token = format!("mylore_sec_{}", Uuid::new_v4().to_string().replace('-', ""));
            conn.execute(
                "INSERT INTO mobile_sync_meta (key, value) VALUES ('pairing_token', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![new_token],
            )
            .map_err(|e| e.to_string())?;
            if let Some(lock) = CACHED_PAIRING_TOKEN.get() {
                if let Ok(mut guard) = lock.lock() {
                    *guard = new_token;
                }
            }
        }

        build_mobile_pairing_payload(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}
