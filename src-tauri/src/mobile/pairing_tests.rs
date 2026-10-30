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
