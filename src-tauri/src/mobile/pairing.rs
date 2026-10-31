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
        let ipv4_re = cached_regex!(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})");
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

/// PC가 현재 연결된 NAT의 Wi-Fi SSID 목록을 `netsh wlan show interfaces`로 조회합니다.
/// 무선 인터페이스에서 SSID가 감지되지 않는 경우(유선 LAN 연결 등) Windows 네트워크 프로필 이름을 보조로 확인합니다.
///
/// 출력 인코딩 문제(한글 SSID)를 피하기 위해 `chcp 65001`(UTF-8) 상태에서 실행합니다.
pub(crate) fn detect_current_wifi_ssids() -> Vec<String> {
    let output = Command::new("cmd")
        .args(["/C", "chcp 65001 >nul && netsh wlan show interfaces"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let mut ssids = match output {
        Ok(out) => parse_netsh_wlan_ssids(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => Vec::new(),
    };
    if ssids.is_empty() {
        if let Ok(out) = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -eq 'Internet' -or $_.IPv4Connectivity -eq 'LocalNetwork' } | Select-Object -ExpandProperty Name",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let name = line.trim().to_string();
                if !name.is_empty()
                    && name != "네트워크"
                    && !name.starts_with("네트워크 ")
                    && !name.eq_ignore_ascii_case("Network")
                    && !name.starts_with("Network ")
                    && !name.contains("식별되지 않은")
                    && !name.to_ascii_lowercase().contains("unidentified")
                    && !ssids.contains(&name)
                {
                    ssids.push(name);
                }
            }
        }
    }
    ssids
}

/// 서버 기동 시 또는 페어링 정보 갱신 시 현재 NAT의 Wi-Fi SSID를 검색하여
/// `mobile_sync_meta`의 `allowed_ssids`를 해당 내용으로 덮어씁니다.
pub(crate) fn refresh_server_nat_wifi_ssids(conn: &Connection) -> Vec<String> {
    let detected = detect_current_wifi_ssids();
    let ssids_json = serde_json::to_string(&detected).unwrap_or_else(|_| "[]".to_string());
    let prev_json: String = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'allowed_ssids'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let _ = conn.execute(
        "INSERT INTO mobile_sync_meta (key, value) VALUES ('allowed_ssids', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![ssids_json],
    );
    if prev_json != ssids_json {
        log_system(
            "INFO",
            &format!("서버 NAT Wi-Fi SSID 자동 탐지 및 갱신 완료: {:?}", detected),
        );
    }
    detected
}

/// `netsh wlan show interfaces` 출력에서 `SSID : 이름` 줄만 추출합니다. (`BSSID` 줄은 제외)
pub(crate) fn parse_netsh_wlan_ssids(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        let Some(rest) = t.strip_prefix("SSID") else {
            continue;
        };
        let Some(value) = rest.trim_start().strip_prefix(':') else {
            continue;
        };
        let ssid = value.trim().to_string();
        if !ssid.is_empty() && !out.contains(&ssid) {
            out.push(ssid);
        }
    }
    out
}

/// 현재 Wi-Fi(`current`)를 앞에 두고 저장된 SSID(`saved`)를 중복 없이 뒤에 붙입니다.
#[allow(dead_code)]
pub(crate) fn merge_ssids(current: Vec<String>, saved: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in current.into_iter().chain(saved) {
        let s = s.trim().to_string();
        if !s.is_empty() && !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// 지정한 Wi-Fi 프로필(`ssid`)의 비밀번호(`Key Content`)와 인증 방식(`WPA2` / `WPA3` / `OPEN`)을
/// 관리자 권한(UAC) 없이 `netsh wlan show profile name="<SSID>" key=clear`로 조회합니다.
///
/// SSID에 공백이나 특수문자가 있어도 안전하도록 환경 변수(`MYLORE_WIFI_SSID`)로 전달합니다.
pub(crate) fn detect_wifi_profile_credentials(ssid: &str) -> (String, String) {
    let trimmed = ssid.trim();
    if trimmed.is_empty() {
        return (String::new(), "WPA2".to_string());
    }
    let output = Command::new("cmd")
        .args([
            "/C",
            "chcp 65001 >nul && netsh wlan show profile name=\"%MYLORE_WIFI_SSID%\" key=clear",
        ])
        .env("MYLORE_WIFI_SSID", trimmed)
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(out) => parse_netsh_wlan_profile_credentials(&String::from_utf8_lossy(&out.stdout)),
        Err(_) => (String::new(), "WPA2".to_string()),
    }
}

/// `netsh wlan show profile ... key=clear` 출력에서 `(비밀번호, 인증방식)`을 추출합니다.
///
/// - WPA2/WPA3 혼합(Transition) 공유기는 프로필에 `WPA3-Personal`과 `WPA2-Personal`이 함께 나타납니다.
///   안드로이드 `Settings.ACTION_WIFI_ADD_NETWORKS`와의 최상위 호환성을 위해 `WPA2`가 포함되어 있으면 `"WPA2"`를 우선 반환하고,
///   순수 WPA3 전용일 때만 `"WPA3"`를 반환합니다.
pub(crate) fn parse_netsh_wlan_profile_credentials(text: &str) -> (String, String) {
    let mut key_content = String::new();
    let mut saw_wpa2 = false;
    let mut saw_wpa3 = false;
    let mut saw_open = false;

    for line in text.lines() {
        let t = line.trim();
        let Some((raw_label, raw_val)) = t.split_once(':') else {
            continue;
        };
        let label = raw_label.trim();
        let val = raw_val.trim();
        if val.is_empty() {
            continue;
        }

        if label.eq_ignore_ascii_case("Key Content") || label == "키 콘텐츠" {
            key_content = val.to_string();
        } else if label.eq_ignore_ascii_case("Authentication") || label == "인증" {
            let upper = val.to_ascii_uppercase();
            if upper.contains("WPA2") || (upper.contains("WPA") && !upper.contains("WPA3")) {
                saw_wpa2 = true;
            } else if upper.contains("WPA3") || upper.contains("SAE") {
                saw_wpa3 = true;
            } else if upper.contains("OPEN") || val.contains("개방") {
                saw_open = true;
            }
        }
    }

    let auth = if saw_wpa2 {
        "WPA2"
    } else if saw_wpa3 {
        "WPA3"
    } else if saw_open {
        "OPEN"
    } else {
        "WPA2"
    };

    (key_content, auth.to_string())
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

    // 고정된 SSID를 유지하지 않고, 현재 서버의 NAT이 가지고 있는 Wi-Fi SSID를 검색하여 즉시 갱신합니다.
    let ssids = refresh_server_nat_wifi_ssids(conn);
    let primary_ssid = ssids.first().cloned().unwrap_or_default();
    let (wifi_pw, wifi_auth) = if !primary_ssid.is_empty() {
        detect_wifi_profile_credentials(&primary_ssid)
    } else {
        (String::new(), "WPA2".to_string())
    };
    let has_wifi_password = !wifi_pw.is_empty();

    let created_at = chrono::Local::now().timestamp_millis();
    let qr_json_obj = serde_json::json!({
        "v": 1,
        "pc_name": pc_name,
        "ips": ips,
        "port": port,
        "token": token,
        "ssid": primary_ssid,
        "wifi_pw": wifi_pw,
        "wifi_auth": wifi_auth,
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
        ssid: primary_ssid,
        wifi_auth,
        has_wifi_password,
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

        // 비워 두면 저장 목록은 비우고, QR에는 PC의 현재 Wi-Fi만 자동으로 들어갑니다.
        let final_ssids: Vec<String> = ssids
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
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
