//! `mobile::pairing` 순수 함수 단위 테스트.

use crate::*;

#[test]
fn parse_netsh_extracts_ssid_and_skips_bssid() {
    let sample = "\
There are 2 interfaces on the system:

    Name                   : Wi-Fi
    State                  : connected
    SSID                   : MyHome_5G
    AP BSSID               : f4:28:53:6a:56:54
    BSSID                  : f4:28:53:6a:56:55

    Name                   : Wi-Fi 2
    State                  : connected
    SSID                   : 우리집 와이파이
    SSID                   : MyHome_5G
";
    assert_eq!(
        parse_netsh_wlan_ssids(sample),
        vec!["MyHome_5G".to_string(), "우리집 와이파이".to_string()]
    );
}

#[test]
fn parse_netsh_returns_empty_when_disconnected() {
    let sample = "    Name                   : Wi-Fi\n    State                  : disconnected\n";
    assert!(parse_netsh_wlan_ssids(sample).is_empty());
    assert!(parse_netsh_wlan_ssids("").is_empty());
}

#[test]
fn merge_ssids_puts_current_first_without_duplicates() {
    let merged = merge_ssids(
        vec!["Office".to_string()],
        vec!["Home".to_string(), " Office ".to_string(), "".to_string()],
    );
    assert_eq!(merged, vec!["Office".to_string(), "Home".to_string()]);
}

#[test]
fn parse_netsh_profile_extracts_key_and_prefers_wpa2_on_transition_mode() {
    let sample = r#"
Security settings
-----------------
    Authentication         : WPA3-Personal
    Cipher                 : GCMP-256
    Authentication         : WPA2-Personal
    Cipher                 : CCMP
    Security key           : Present
    Key Content            : MySecretPass!23
"#;
    let (pw, auth) = parse_netsh_wlan_profile_credentials(sample);
    assert_eq!(pw, "MySecretPass!23");
    assert_eq!(auth, "WPA2");
}

#[test]
fn parse_netsh_profile_handles_wpa3_only_and_korean_labels() {
    let sample_wpa3 = r#"
보안 설정
-----------------
    인증                   : WPA3-Personal
    암호화                 : GCMP-256
    보안 키                : 있음
    키 콘텐츠              : kor_pass_9999
"#;
    let (pw, auth) = parse_netsh_wlan_profile_credentials(sample_wpa3);
    assert_eq!(pw, "kor_pass_9999");
    assert_eq!(auth, "WPA3");

    let sample_open = "    Authentication : Open\n    Security key : Absent\n";
    let (pw_open, auth_open) = parse_netsh_wlan_profile_credentials(sample_open);
    assert_eq!(pw_open, "");
    assert_eq!(auth_open, "OPEN");
}

#[test]
fn parse_korean_date_time_handles_am_pm_and_24h() {
    let ts_am = parse_korean_date_time_to_epoch_ms("2026-10-30", "오전 9:15");
    let ts_pm = parse_korean_date_time_to_epoch_ms("2026-10-30", "오후 2:15");
    let ts_24 = parse_korean_date_time_to_epoch_ms("2026-10-30", "14:15:00");
    assert!(ts_am > 0);
    assert_eq!(ts_pm, ts_24);
    assert_eq!(ts_pm - ts_am, 5 * 3600 * 1000);
}

#[test]
fn normalize_service_key_maps_kakao_and_all_domains() {
    assert_eq!(normalize_sync_service_key("kakao"), "kakaotalk");
    assert_eq!(normalize_sync_service_key("kakaotalk"), "kakaotalk");
    assert_eq!(normalize_sync_service_key("notification"), "notification");
    assert_eq!(normalize_sync_service_key("call"), "call");
    assert_eq!(normalize_sync_service_key("recording"), "recording");
    assert_eq!(normalize_sync_service_key("health"), "health");
}

#[test]
fn sync_ack_state_machine_tracks_unacked_and_resets_on_new_message() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "
        CREATE TABLE mobile_sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE synced_file_hashes (file_hash TEXT PRIMARY KEY, file_name TEXT NOT NULL, synced_at TEXT NOT NULL);
        CREATE TABLE kakao_room_sync_state (
            room_name TEXT PRIMARY KEY,
            folder_name TEXT NOT NULL DEFAULT '',
            last_message TEXT NOT NULL DEFAULT '',
            last_message_ts INTEGER NOT NULL DEFAULT 0,
            last_shared_ts INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER NOT NULL DEFAULT 0,
            synced_bytes INTEGER NOT NULL DEFAULT 0,
            client_ack INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE domain_sync_state (
            domain TEXT PRIMARY KEY,
            latest_ts INTEGER NOT NULL DEFAULT 0,
            extra_json TEXT NOT NULL DEFAULT '{}',
            client_ack INTEGER NOT NULL DEFAULT 0
        );
        ",
    )
    .unwrap();

    // 1. 카톡방 및 도메인 신규 적재 -> client_ack = 0 (unacked)
    upsert_kakao_room_sync_state_unacked(
        &conn,
        "김철수",
        "KakaoTalk_Chats_1",
        "안녕하세요",
        1000,
        1050,
        5000,
        5000,
    );
    mark_domain_sync_state_unacked(&conn, "notification", 2000, None);

    let (rooms, doms) = query_unacked_sync_states(&conn);
    assert_eq!(rooms.len(), 1);
    assert_eq!(rooms[0]["room_name"], "김철수");
    assert_eq!(rooms[0]["client_ack"], false);
    assert!(doms.contains_key("notification"));

    // 2. 클라이언트 ACK 수신 -> client_ack = 1
    conn.execute(
        "UPDATE kakao_room_sync_state SET client_ack = 1 WHERE room_name = '김철수' AND last_message_ts <= 1000",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE domain_sync_state SET client_ack = 1 WHERE domain = 'notification' AND latest_ts <= 2000",
        [],
    )
    .unwrap();

    let (rooms_after_ack, doms_after_ack) = query_unacked_sync_states(&conn);
    assert!(rooms_after_ack.is_empty());
    assert!(doms_after_ack.is_empty());

    // 3. 해당 방에 새 대화 적재 -> 자동으로 client_ack = 0 리셋
    upsert_kakao_room_sync_state_unacked(
        &conn,
        "김철수",
        "KakaoTalk_Chats_2",
        "새 메시지",
        3000,
        3050,
        1200,
        0,
    );
    let (rooms_reopened, _) = query_unacked_sync_states(&conn);
    assert_eq!(rooms_reopened.len(), 1);
    assert_eq!(rooms_reopened[0]["last_message"], "새 메시지");
    assert_eq!(rooms_reopened[0]["last_message_ts"], 3000);
    assert_eq!(rooms_reopened[0]["synced_bytes"], 6200);
}
