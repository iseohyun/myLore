//! 문자/녹음 파일명·본문 파서 및 LLM 응답(요약/스크립트) 정규화. (순수 함수 위주)

use crate::*;

/// 통화 녹음 파일(`mobile/calls/audio/*.m4a`) 앞부분에 잘못 포함된 Multipart 헤더가 있으면 제거하여 순수 오디오 바이트로 복구합니다.
pub(crate) fn strip_multipart_prefix_if_present(raw: &[u8]) -> (Vec<u8>, bool) {
    let head_len = std::cmp::min(raw.len(), 2048);
    let head_str = String::from_utf8_lossy(&raw[..head_len]);
    if let Some(fn_idx) = head_str.find("filename=\"") {
        let search_from = fn_idx;
        if search_from < raw.len() {
            let start_offset = if let Some(rel) = raw[search_from..]
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
            {
                Some(search_from + rel + 4)
            } else if let Some(rel) = raw[search_from..].windows(2).position(|w| w == b"\n\n") {
                Some(search_from + rel + 2)
            } else {
                None
            };
            if let Some(so) = start_offset {
                let mut end_offset = raw.len();
                let tail_start = raw.len().saturating_sub(256);
                if tail_start > so {
                    if let Some(rel_end) = raw[tail_start..]
                        .windows(4)
                        .rposition(|w| w == b"\r\n--")
                    {
                        end_offset = tail_start + rel_end;
                    }
                }
                if so < end_offset {
                    return (raw[so..end_offset].to_vec(), true);
                }
            }
        }
    }
    (raw.to_vec(), false)
}

/// MMS 제목 인코딩 깨짐(`[ì œëª©ì—†ì Œ]` = `"제목없음"`의 UTF-8 바이트가 ISO-8859-1로 읽힌 문자열) 제거,
/// RCS(채팅+) Open Rich Card JSON 텍스트 추출, 그리고 멀티라인 줄바꿈의 `<br/>` 변환을 수행합니다.
pub(crate) fn clean_mms_and_multiline_body(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    if text.is_empty() {
        return String::new();
    }
    // 1. 깨진 `[제목없음]` (`[ì œëª©ì—†ì Œ]`) 또는 정상 `[제목없음]` 접두사 제거
    for prefix in [
        "[ì œëª©ì—†ì Œ]",
        "[ì\u{a0}œëª©ì—†ì\u{8c}Œ]",
        "[제목없음]",
    ] {
        if text.starts_with(prefix) {
            text = text[prefix.len()..].trim_start().to_string();
        }
    }
    if text.starts_with('[') {
        if let Some(end_idx) = text.find(']') {
            if end_idx > 1 && end_idx < 60 {
                let sub_part = &text[1..end_idx];
                if sub_part.contains('ì') || sub_part.contains('ë') || sub_part.contains('ê') {
                    let latin1_bytes: Vec<u8> = sub_part.chars().map(|c| c as u8).collect();
                    if let Ok(recovered) = String::from_utf8(latin1_bytes) {
                        if recovered.trim() == "제목없음" {
                            text = text[end_idx + 1..].trim_start().to_string();
                        } else {
                            text = format!("[{}] {}", recovered.trim(), text[end_idx + 1..].trim_start());
                        }
                    } else if sub_part.contains("œëª©") {
                        text = text[end_idx + 1..].trim_start().to_string();
                    }
                }
            }
        }
    }

    // 2. RCS Open Rich Card JSON (`{"layout":...}`) 본문에서 TextView.text 추출
    let trimmed = text.trim();
    if trimmed.starts_with("{\"layout\":") || trimmed.starts_with("{\"card\":") {
        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let mut extracted = Vec::new();
            fn collect_rcs_texts(node: &serde_json::Value, out: &mut Vec<String>) {
                match node {
                    serde_json::Value::Object(map) => {
                        if map.get("widget").and_then(|v| v.as_str()) == Some("TextView") {
                            if let Some(t) = map.get("text").and_then(|v| v.as_str()) {
                                let clean_t = t.trim();
                                if !clean_t.is_empty() {
                                    out.push(clean_t.to_string());
                                }
                            }
                        }
                        for (k, v) in map {
                            if k != "text" {
                                collect_rcs_texts(v, out);
                            }
                        }
                    }
                    serde_json::Value::Array(arr) => {
                        for item in arr {
                            collect_rcs_texts(item, out);
                        }
                    }
                    _ => {}
                }
            }
            collect_rcs_texts(&jv, &mut extracted);
            if !extracted.is_empty() {
                text = extracted.join("\n");
            }
        }
    }

    // 3. 멀티라인 개행을 `<br/>`로 변환하여 마크다운 리스트 한 줄 구조를 유지
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines_out: Vec<String> = Vec::new();
    for line in normalized.split('\n') {
        let l = line.trim();
        if !l.is_empty() || (lines_out.last().map(|s| !s.is_empty()).unwrap_or(false)) {
            lines_out.push(l.to_string());
        }
    }
    while lines_out.last().map(|s| s.is_empty()).unwrap_or(false) {
        lines_out.pop();
    }
    lines_out.join("<br/>")
}

/// 녹음 파일명/폴더 힌트를 통해 일반 통화녹음(`false`)인지 독백·회의 음성녹음(`true`, 출처 기기명/워치)인지 판별합니다.
pub(crate) fn is_voice_memo_or_watch_recording(
    file_name: &str,
    folder_hint: &str,
    default_device_name: &str,
) -> (bool, String) {
    let fname = file_name.trim();
    let f_lower = fname.to_lowercase();
    let h_lower = folder_hint.to_lowercase();

    // 갤럭시 워치 음성메모 (`음성 001_W_20250404_140623.m4a` 또는 `/Sounds/Watch`)
    if fname.contains("_W_") || h_lower.contains("watch") || fname.contains("워치") {
        return (true, "갤럭시 워치".to_string());
    }

    // 통화 녹음 명시적 패턴 제외
    if fname.starts_with("통화")
        || f_lower.starts_with("call")
        || h_lower.contains("tphone")
        || h_lower.contains("/call")
    {
        return (false, String::new());
    }

    // 삼성 음성녹음기 (`음성 260503_212528.m4a`, `음성메모`, `회의`, `Voice Recorder`)
    if fname.starts_with("음성")
        || fname.starts_with("회의")
        || fname.starts_with("녹음")
        || f_lower.starts_with("voice")
        || h_lower.contains("voice recorder")
        || h_lower.contains("recordings")
    {
        let dev = if default_device_name.trim().is_empty()
            || default_device_name == "모바일"
            || default_device_name == "모바일 기기"
        {
            "SM-S901N".to_string()
        } else {
            default_device_name.trim().to_string()
        };
        return (true, dev);
    }

    (false, String::new())
}

/// 독백/회의 음성녹음 파일명(`음성 260503_212528` 또는 `음성 001_W_20250404_140623`)에서
/// (표시용 제목, 녹음 출처[기기명/갤럭시 워치], 녹음 일자 YYYY-MM-DD, 녹음 시각 HH:MM:SS)을 추출합니다.
pub(crate) fn parse_voice_recording_filename_meta(
    file_stem: &str,
    default_device_name: &str,
) -> (String, String, String, String) {
    static RE_WATCH: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_VOICE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

    let trimmed = file_stem.trim();
    let is_watch = trimmed.contains("_W_") || trimmed.contains("워치");
    let rec_source = if is_watch {
        "갤럭시 워치".to_string()
    } else if !default_device_name.trim().is_empty()
        && default_device_name != "모바일"
        && default_device_name != "모바일 통화녹음"
    {
        default_device_name.trim().to_string()
    } else {
        "SM-S901N".to_string()
    };

    let re_watch = RE_WATCH
        .get_or_init(|| Regex::new(r"_W_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})").unwrap());
    if let Some(cap) = re_watch.captures(trimmed) {
        let d_str = format!("{}-{}-{}", &cap[1], &cap[2], &cap[3]);
        let t_str = format!("{}:{}:{}", &cap[4], &cap[5], &cap[6]);
        let disp = format!("[워치] {}", trimmed);
        return (disp, rec_source, d_str, t_str);
    }

    let re_voice =
        RE_VOICE.get_or_init(|| Regex::new(r"(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$").unwrap());
    if let Some(cap) = re_voice.captures(trimmed) {
        let d_str = format!("20{}-{}-{}", &cap[1], &cap[2], &cap[3]);
        let t_str = format!("{}:{}:{}", &cap[4], &cap[5], &cap[6]);
        let disp = format!("[{}] {}", rec_source, trimmed);
        return (disp, rec_source, d_str, t_str);
    }

    let now = chrono::Local::now();
    (
        format!("[{}] {}", rec_source, trimmed),
        rec_source,
        now.format("%Y-%m-%d").to_string(),
        now.format("%H:%M:%S").to_string(),
    )
}

/// `이름_전화번호_날짜` 또는 `통화 녹음_이름_전화번호_날짜` 형태의 문자열에서
/// 전화번호와 날짜 접미사를 모두 제거하고 순수 `이름`(연락처 매칭 포함)만 추출합니다.
pub(crate) fn extract_clean_contact_name(
    raw_target: &str,
    contacts_map: &HashMap<String, String>,
) -> String {
    static RE_PAREN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT1: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT2: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT3: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_DT4: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

    let mut s = raw_target
        .trim()
        .trim_start_matches("통화 녹음 ")
        .trim_start_matches("통화 녹음_")
        .trim_start_matches("통화녹음 ")
        .trim_start_matches("통화녹음_")
        .trim_start_matches("Call_")
        .trim_start_matches("call_")
        .trim()
        .to_string();

    let re_paren = RE_PAREN.get_or_init(|| Regex::new(r"\s*\([0-9+\-\s]{7,}\)\s*$").unwrap());
    // 괄호 안 전화번호 제거: `홍길동 (010-1234-5678)` -> `홍길동`
    let stripped = re_paren.replace(&s, "").trim().to_string();
    if !stripped.is_empty() {
        s = stripped;
    }

    // 뒤쪽 날짜/시각 패턴 제거 (`_20261023122434`, `_20261023_122434`, `_261023_122434`)
    for re_dt in [
        RE_DT1.get_or_init(|| Regex::new(r"_(\d{8})_(\d{6})$").unwrap()),
        RE_DT2.get_or_init(|| Regex::new(r"_(\d{6})_(\d{6})$").unwrap()),
        RE_DT3.get_or_init(|| Regex::new(r"_(\d{14})$").unwrap()),
        RE_DT4.get_or_init(|| Regex::new(r"_(\d{8,14})$").unwrap()),
    ] {
        s = re_dt.replace(&s, "").trim().to_string();
    }

    // `이름_전화번호` 또는 `이름_전화번호_기타` 분리
    if s.contains('_') {
        let parts: Vec<&str> = s.split('_').map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
        if !parts.is_empty() {
            let first = parts[0];
            let first_digits = normalize_phone_digits(first);
            let is_first_phone = !first_digits.is_empty()
                && first.chars().all(|c| c.is_ascii_digit() || c == '+' || c == '-');
            if !is_first_phone {
                // 첫 파트가 이름인 경우 (예: `#거제해양윤주권차장님_01066067048`) -> 이름만 반환
                if let Some(found) = contacts_map.get(first) {
                    return found.clone();
                }
                return first.to_string();
            } else {
                // 첫 파트가 전화번호인 경우 연락처 맵 조회
                if let Some(found) = contacts_map.get(first) {
                    return found.clone();
                }
                if first_digits.len() >= 7 {
                    if let Some(found) = contacts_map.get(&first_digits) {
                        return found.clone();
                    }
                }
                return first.to_string();
            }
        }
    }

    let resolved = resolve_contact_display(&s, contacts_map);
    let clean_res = re_paren.replace(&resolved, "").trim().to_string();
    if !clean_res.is_empty() {
        return clean_res;
    }
    resolved
}

/// 통화 녹음 파일명(예: `통화 녹음 #덕산아내중계_241017_180627`, `구인호_01038213356_20261029165901`, `이름_01012345678_20261023_122434`)에서
/// (표시용 상대방 이름[이름만], 통화 일자 YYYY-MM-DD, 통화 시각 HH:MM:SS)을 추출합니다.
pub(crate) fn parse_call_audio_filename_meta(
    file_stem: &str,
    contacts_map: &HashMap<String, String>,
) -> (String, String, String) {
    static RE_TPHONE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_YMD8: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    static RE_SAMSUNG: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();

    let trimmed = file_stem.trim();

    // 1. T전화 녹음 포맷: `{이름}_{전화번호}_{YYYYMMDDHHMMSS}` (14자리 일시)
    let re_tphone = RE_TPHONE
        .get_or_init(|| Regex::new(r"^(.*)_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$").unwrap());
    if let Some(cap) = re_tphone.captures(trimmed) {
        let raw_prefix = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        let date_str = format!("{}-{}-{}", &cap[2], &cap[3], &cap[4]);
        let time_str = format!("{}:{}:{}", &cap[5], &cap[6], &cap[7]);
        let clean_name = extract_clean_contact_name(raw_prefix, contacts_map);
        return (clean_name, date_str, time_str);
    }

    // 2. 8자리 날짜 + 6자리 시각 포맷: `{이름}_{전화번호}_{YYYYMMDD}_{HHMMSS}`
    let re_ymd8 = RE_YMD8
        .get_or_init(|| Regex::new(r"^(.*)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$").unwrap());
    if let Some(cap) = re_ymd8.captures(trimmed) {
        let raw_prefix = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        let date_str = format!("{}-{}-{}", &cap[2], &cap[3], &cap[4]);
        let time_str = format!("{}:{}:{}", &cap[5], &cap[6], &cap[7]);
        let clean_name = extract_clean_contact_name(raw_prefix, contacts_map);
        return (clean_name, date_str, time_str);
    }

    // 3. 삼성 기본 통화녹음 포맷: `통화 녹음 {상대방}_{YYMMDD}_{HHMMSS}`
    let re = RE_SAMSUNG.get_or_init(|| Regex::new(r"^(.*)_(\d{6})_(\d{6})$").unwrap());
    if let Some(cap) = re.captures(trimmed) {
        let raw_prefix = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        let ymd = cap.get(2).map(|m| m.as_str()).unwrap_or("261030");
        let hms = cap.get(3).map(|m| m.as_str()).unwrap_or("000000");

        let date_str = if ymd.len() == 6 {
            format!("20{}-{}-{}", &ymd[0..2], &ymd[2..4], &ymd[4..6])
        } else {
            chrono::Local::now().format("%Y-%m-%d").to_string()
        };
        let time_str = if hms.len() == 6 {
            format!("{}:{}:{}", &hms[0..2], &hms[2..4], &hms[4..6])
        } else {
            chrono::Local::now().format("%H:%M:%S").to_string()
        };

        let clean_name = extract_clean_contact_name(raw_prefix, contacts_map);
        return (clean_name, date_str, time_str);
    }

    let now = chrono::Local::now();
    (
        extract_clean_contact_name(trimmed, contacts_map),
        now.format("%Y-%m-%d").to_string(),
        now.format("%H:%M:%S").to_string(),
    )
}

/// 스크립트 본문(`## 📜 스크립트` 하위)의 각 문장에 대해:
/// 1) 화자 이름에 `이름_전화번호_날짜` 또는 `이름_전화번호`가 포함되어 있으면 순수 `이름`(`clean_name`)만 남기고,
/// 2) 모든 문장 시작에 `[00:00:00]`(`HH:MM:SS`) 오프셋 시각이 표시되도록 정규화합니다.
pub(crate) fn normalize_script_lines_with_timestamps_and_clean_name(
    script_body: &str,
    clean_name: &str,
    raw_stem: &str,
) -> String {
    let re_hms = cached_regex!(r"\[(\d{1,2}):(\d{2}):(\d{2})\]");
    let re_ms = cached_regex!(r"\[(\d{1,2}):(\d{2})\]");
    let re_speaker_dirty = cached_regex!(r"(\*\*\[?)([^\]*:]+_[0-9]{6,}[_0-9]*)(\]?\*\*)");

    let mut out_lines: Vec<String> = Vec::new();
    let mut est_sec: u64 = 0;

    for raw_line in script_body.lines() {
        let mut line = raw_line.to_string();
        if !raw_stem.is_empty() && !clean_name.is_empty() && raw_stem != clean_name {
            line = line.replace(raw_stem, clean_name);
        }
        if !clean_name.is_empty() {
            line = re_speaker_dirty
                .replace_all(&line, |caps: &regex::Captures| {
                    format!("{}{}{}", &caps[1], clean_name, &caps[3])
                })
                .to_string();
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('>') || trimmed.starts_with('#') {
            out_lines.push(line);
            continue;
        }

        // 이미 [HH:MM:SS] 포맷이 있는 경우 2자리 패딩 보장 및 est_sec 동기화
        if let Some(cap) = re_hms.captures(&line) {
            let h: u64 = cap[1].parse().unwrap_or(0);
            let m: u64 = cap[2].parse().unwrap_or(0);
            let s: u64 = cap[3].parse().unwrap_or(0);
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            if full_match != formatted {
                line = line.replacen(full_match, &formatted, 1);
            }
            est_sec = h * 3600 + m * 60 + s + 3;
            out_lines.push(line);
            continue;
        }

        // [MM:SS] 포맷이 있는 경우 [00:MM:SS]로 변환
        if let Some(cap) = re_ms.captures(&line) {
            let m_val: u64 = cap[1].parse().unwrap_or(0);
            let s_val: u64 = cap[2].parse().unwrap_or(0);
            let total = m_val * 60 + s_val;
            let h = total / 3600;
            let m = (total % 3600) / 60;
            let s = total % 60;
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            line = line.replacen(full_match, &formatted, 1);
            est_sec = total + 3;
            out_lines.push(line);
            continue;
        }

        // 불릿 라인(`- ...` 또는 `* ...`)인데 타임스탬프가 없는 경우 [00:00:00] 오프셋 부여
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let h = est_sec / 3600;
            let m = (est_sec % 3600) / 60;
            let s = est_sec % 60;
            let ts_tag = format!("[{:02}:{:02}:{:02}]", h, m, s);

            let rest = &trimmed[2..].trim_start();
            let updated_line = if let Some(after_bold) = rest.strip_prefix("**[") {
                if let Some(close_idx) = after_bold.find("]**") {
                    let spk = after_bold[..close_idx].trim();
                    let clean_spk = if spk.contains('_') && !clean_name.is_empty() {
                        clean_name
                    } else {
                        spk
                    };
                    let after_spk = &after_bold[close_idx + 3..];
                    format!("- **{} {}**{}", ts_tag, clean_spk, after_spk)
                } else {
                    format!("- **{}** {}", ts_tag, rest)
                }
            } else if let Some(after_bold) = rest.strip_prefix("**") {
                format!("- **{} {}", ts_tag, after_bold)
            } else {
                format!("- **{}** {}", ts_tag, rest)
            };

            let char_count = rest.chars().count() as u64;
            let step_sec = (char_count / 5).clamp(2, 12);
            est_sec += step_sec;
            out_lines.push(updated_line);
        } else {
            out_lines.push(line);
        }
    }

    out_lines.join("\n")
}

/// LLM(Gemini)이 생성한 통화 분석 텍스트를 1) 요약부 와 2) 스크립트 2개 섹션으로 분리합니다.
pub(crate) fn split_summary_and_transcript(raw_llm_text: &str) -> (String, String) {
    let cleaned = raw_llm_text.trim();
    if cleaned.is_empty() {
        return (String::new(), String::new());
    }

    let script_markers = [
        "## 📜 스크립트",
        "## 스크립트",
        "### 📜 스크립트",
        "2. **📜 화자 분리 대화 스크립트**:",
        "2. **화자 분리 대화 스크립트**:",
        "**📜 화자 분리 대화 스크립트**",
        "## 대화 스크립트",
    ];

    for marker in script_markers {
        if let Some(idx) = cleaned.find(marker) {
            let summary_raw = cleaned[..idx]
                .replace("## 💡 요약", "")
                .replace("## 요약", "")
                .replace("### 💡 요약", "")
                .replace("1. **💡 통화 핵심 요약**:", "")
                .replace("1. **통화 핵심 요약**:", "")
                .replace("**💡 통화 핵심 요약**", "")
                .trim()
                .trim_end_matches("---")
                .trim()
                .to_string();
            let script_raw = cleaned[idx + marker.len()..]
                .trim()
                .trim_start_matches(':')
                .trim()
                .to_string();
            return (
                if summary_raw.is_empty() {
                    "- 통화 요약 내용이 아래 스크립트에 포함되어 있습니다.".to_string()
                } else {
                    summary_raw
                },
                if script_raw.is_empty() {
                    cleaned.to_string()
                } else {
                    script_raw
                },
            );
        }
    }

    // 마커가 없을 경우 첫 단락을 요약부로, 전체를 스크립트로 분리
    let lines: Vec<&str> = cleaned.lines().collect();
    if lines.len() > 3 {
        let summary_part = lines[..std::cmp::min(3, lines.len())].join("\n");
        let script_part = cleaned.to_string();
        (summary_part, script_part)
    } else {
        (cleaned.to_string(), cleaned.to_string())
    }
}
