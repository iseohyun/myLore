//! 공통 유틸리티 (Windows 프로세스 플래그, base64, URL 디코딩, 시간 변환, 파일명 정리, 정규식 캐시).

use crate::*;

pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 정규식을 **프로세스 전체에서 최초 1회만** 컴파일하고 `&'static Regex`를 돌려줍니다.
///
/// 호출 위치마다 별도의 `static LazyLock`이 생기므로, 반복문·자주 호출되는 함수 안에서도 재컴파일 비용이 없습니다.
/// 패턴은 반드시 문자열 리터럴이어야 합니다. (잘못된 패턴은 첫 사용 시 panic — 기존 `.unwrap()`과 동일)
///
/// ```ignore
/// let re = cached_regex!(r"^(\d{4})-(\d{2})-(\d{2})$");
/// ```
macro_rules! cached_regex {
    ($pattern:literal) => {{
        static RE: std::sync::LazyLock<regex::Regex> =
            std::sync::LazyLock::new(|| regex::Regex::new($pattern).unwrap());
        &*RE
    }};
}
pub(crate) use cached_regex;

pub(crate) fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub(crate) fn base64_decode(input: &str) -> Vec<u8> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let cleaned: Vec<u8> = input
        .bytes()
        .filter(|&b| b != b'=' && !b.is_ascii_whitespace())
        .collect();
    let mut out = Vec::with_capacity(cleaned.len() * 3 / 4);
    for chunk in cleaned.chunks(4) {
        let mut buf = [0u8; 4];
        let mut len = 0;
        for &b in chunk {
            if let Some(v) = val(b) {
                buf[len] = v;
                len += 1;
            }
        }
        if len >= 2 {
            out.push((buf[0] << 2) | (buf[1] >> 4));
        }
        if len >= 3 {
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if len >= 4 {
            out.push((buf[2] << 6) | buf[3]);
        }
    }
    out
}

pub(crate) fn epoch_ms_to_local_date_time(ts_ms: i64) -> (String, String) {
    use chrono::TimeZone;
    if ts_ms > 0 {
        if let chrono::LocalResult::Single(dt) = chrono::Local.timestamp_millis_opt(ts_ms) {
            return (
                dt.format("%Y-%m-%d").to_string(),
                dt.format("%H:%M:%S").to_string(),
            );
        }
    }
    let now = chrono::Local::now();
    (
        now.format("%Y-%m-%d").to_string(),
        now.format("%H:%M:%S").to_string(),
    )
}

pub(crate) fn sanitize_filename_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "미분류".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn update_atomic_max_i64(atom: &std::sync::atomic::AtomicI64, val: i64) {
    if val <= 0 {
        return;
    }
    let _ = atom.fetch_max(val, std::sync::atomic::Ordering::Relaxed);
}

pub(crate) fn url_decode_utf8(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let raw = input.as_bytes();
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' && i + 2 < raw.len() {
            if let Ok(hex_str) = std::str::from_utf8(&raw[i + 1..i + 3]) {
                if let Ok(b) = u8::from_str_radix(hex_str, 16) {
                    bytes.push(b);
                    i += 3;
                    continue;
                }
            }
        } else if raw[i] == b'+' {
            bytes.push(b' ');
            i += 1;
            continue;
        }
        bytes.push(raw[i]);
        i += 1;
    }
    String::from_utf8_lossy(&bytes).to_string()
}
