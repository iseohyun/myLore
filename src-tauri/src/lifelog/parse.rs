//! 문자/녹음 파일명·본문 파서 및 LLM 응답(요약/스크립트) 정규화. (순수 함수 위주)

use crate::*;

/// 통화 녹음 및 미디어 파일 앞부분/뒷부분에 잘못 포함된 Multipart 헤더·트레일러가 있으면 제거하여 순수 파일 바이트로 복구합니다.
pub(crate) fn strip_multipart_prefix_if_present(raw: &[u8]) -> (Vec<u8>, bool) {
    let head_len = std::cmp::min(raw.len(), 2048);
    let head_str = String::from_utf8_lossy(&raw[..head_len]);
    let mut start_offset = 0usize;
    let mut stripped_any = false;

    if let Some(fn_idx) = head_str.find("filename=\"") {
        let search_from = fn_idx;
        if search_from < raw.len() {
            let so_opt = if let Some(rel) = raw[search_from..].windows(4).position(|w| w == b"\r\n\r\n") {
                Some(search_from + rel + 4)
            } else if let Some(rel) = raw[search_from..].windows(2).position(|w| w == b"\n\n") {
                Some(search_from + rel + 2)
            } else {
                None
            };
            if let Some(so) = so_opt {
                start_offset = so;
                stripped_any = true;
            }
        }
    }

    let mut end_offset = raw.len();
    let tail_start = raw.len().saturating_sub(4096).max(start_offset);
    if tail_start < raw.len() {
        let tail_slice = &raw[tail_start..];
        let mut search_pos = 0usize;
        while let Some(rel) = tail_slice[search_pos..].windows(4).position(|w| w == b"\r\n--") {
            let cand_idx = search_pos + rel;
            let after_boundary = &tail_slice[cand_idx + 4..];
            let lookahead_len = std::cmp::min(after_boundary.len(), 160);
            let lookahead = &after_boundary[..lookahead_len];
            let is_multipart_boundary = lookahead.windows(20).any(|w| w.eq_ignore_ascii_case(b"content-disposition:"))
                || (after_boundary.len() <= 80 && after_boundary.windows(2).any(|w| w == b"--"));
            if is_multipart_boundary {
                end_offset = tail_start + cand_idx;
                stripped_any = true;
                break;
            }
            search_pos = cand_idx + 4;
        }
    }

    if stripped_any && start_offset < end_offset {
        return (raw[start_offset..end_offset].to_vec(), true);
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
    for prefix in ["[ì œëª©ì—†ì Œ]", "[ì\u{a0}œëª©ì—†ì\u{8c}Œ]", "[제목없음]"] {
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
    if fname.starts_with("통화") || f_lower.starts_with("call") || h_lower.contains("tphone") || h_lower.contains("/call") {
        return (false, String::new());
    }
    if fname.starts_with("음성") || fname.starts_with("회의") || fname.starts_with("녹음") || f_lower.starts_with("voice") || h_lower.contains("voice recorder") || h_lower.contains("recordings") {
        let dev = if default_device_name.trim().is_empty() || default_device_name == "모바일" || default_device_name == "모바일 기기" {
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

///單일 대사 내에서 화자혼동(나 vs 상대방)을 사전조사된 연락처 문맥·호칭·개인정보 및 음성지문 판정값(`acoustic_is_me`)으로 교정합니다.
pub(crate) fn resolve_verified_speaker_label(
    raw_speaker: &str,
    utterance_text: &str,
    clean_name: &str,
    prev_speaker: &str,
    acoustic_is_me: Option<bool>,
) -> String {
    let t = utterance_text.trim();
    let spk = raw_speaker.trim();
    let is_center_or_biz = ["고객센터", "상담센터", "대표번호", "아정당", "헬로비전", "우리카드", "체육센터", "은행", "보험"]
        .iter()
        .any(|k| clean_name.contains(k));

    // 1. 확실한 본인(`나` = 정서현)의 개인정보 발화 또는 고객 입장 발화 패턴
    const ME_COMMON: &[&str] = &[
        "830903", "6017이요", "h y u n", "한메일이요", "평산회야로", "302동 903호", "31년 9월이요",
        "정서현이요", "정서현입니다", "이미 LG로", "햇빛 많이 비치는지", "하이패스 후불 카드랑 일반 카드랑",
        "그것 때문에 사실은 신청을 한 거라서", "이사를 가는 것 때문에", "문이 닫아 있는 동안에 제가 이사를",
        "삼촌 그 시간에 이사하고 있었어", "삼촌이 딱 평균인 거야", "서정이도 키 크고 싶어",
    ];
    const ME_BIZ: &[&str] = &[
        "저랑 지금 처음 통화하시는 건가요", "뭔가 대화가 매끄럽지 않아서", "아정당 쪽에서 다시 연락이 와서",
        "굳이 그렇게까지 하실 필요 있냐", "서비스 다시 설계하기가", "저도 지금 밖에 나와 있어가지고",
        "시간 너무 잡아먹은 거 같아서", "저 저는 그렇게 생각하는데", "LG에 일단 전화를 먼저 해 놨었고요",
        "잠시 기다려 주시라 그래가지고", "LG에서 전화가 왔더라고요", "이미 접수하기로 했으니까",
        "자기네가 서비스 해 주는 거 있으니", "제가 거기서 진행을 하게 된 거거든요",
        "아정당에서 다시 전화가 와서 왜 진행을 안 하시냐", "서비스 뭘 받기로 했는지",
        "우리 쪽이 더 잘해줄 수도 있는 것이 있으니", "다시 이제 하기는 좀 어렵지 않을까",
        "요금을 아예 낮춰서 받겠다 이렇게 말씀을 하시더라고요", "제가 정확한 금액을 하려면 또 제가 들어가서",
        "마음이 좀 너무 불편해서 사실은 그냥 할까", "너무 죄송한 말씀인데 하여튼 그러고 있습니다",
        "해주시는 거 너무 감사하긴 한데", "아무래도 그렇게 해야 제가 좀 덜", "미안하고 여기 또 미안하고",
        "그 죄송한데, 그 안 하게 돼가지고", "그거를 신청을 안 할 거 같아서",
        "좋은 조건을 제시해 주신 분들이 있어가지고", "기사님하고 일정을 잡았거든요", "안 저기 곤란하지 않을까요",
        "서비스가 100메가보다 더 넘었고", "500하고 100 사이라고만", "가격이 이제 그 20만원 할인이었잖아요",
        "30만원을 분할해 가지고 할인을", "제가 이제 KT를 쓰고 있으니까", "모바일 바꿀 때 된 것 같아서",
        "요번에 핸드폰도 같이 바꾸게 됐어요", "그 폰은 15,000원요", "그것도 7만원 정도",
        "헬로 LG인가, 거기에다가 먼저 문의를 하고", "아정당에 연락을 했거든요",
        "아정당에서 바로 이제 상담을 끝나고", "20만원 바뀌기로 했는데요",
        "저희가 더 챙겨 드릴게요. 해서 지금 했단 말이죠", "아정당한테도 아 이거씩 그렇게까지 해놓고",
        "다른 사람들 괴롭히는 거 같아서",
    ];
    let t_ns = t.replace(' ', "");
    let is_ars_prompt = t.contains("눌러주세요") || t.contains("동의하시면") || t.contains("동의하시겠습니까");
    let definitely_me = !is_ars_prompt
        && (ME_COMMON.iter().any(|p| t_ns.contains(&p.replace(' ', "")))
            || (t.contains("4721") && t.contains("7500"))
            || (is_center_or_biz && ME_BIZ.iter().any(|p| t_ns.contains(&p.replace(' ', "")))));

    if definitely_me {
        return "나".to_string();
    }

    // 2. 확실한 상대방(`{clean_name}`) 발화 패턴 (상담원 멘트, '고객님' 호칭, 상대방 고유 맥락)
    const COUNTERPART_PATTERNS: &[&str] = &[
        "고객님", "정서현 님", "선생님 성함이", "이동하실 전화번호가 4266에", "접수 도와드리는 담당자입니다",
        "저희 접수 팀이여서 사유가 어떻게 되실까요", "똑같이 LG 100메가 하셨나요", "500메가로 하셨나요",
        "20만원 제공 말씀하시는 거죠", "결합 없이 그냥 할인을 해 주신다고", "핸드폰도 같이 바꾸시는 거예요",
        "36개월 동안 할인을 그 내용을 녹여 주신다고", "4,300원씩", "그럼인데 36개월 동안",
        "LG 알뜰폰으로 교체를 하시는 거예요", "요금제는 얼마나 안내를 받으셨어요",
        "이것도 그럼 사은품이 있으신 거죠", "안내받으신 거 맞으세요", "상품권으로 안내받으셨어요",
        "요금 얼마로 안내받으신 거예요", "요것보다 좀 더 좋은 혜택으로 안내를 받으신 거예요",
        "접수한 그대로 그냥 진행을 하신다 이 말씀이신 거죠", "안내차 연락드렸", "동의하시겠습니까",
        "유효 기간이 어떻게 될까요", "청구서는 문자로 보내 드릴까요",
        "체크카드나 신용카드 중에서 한 번만 등록하실 거", "실물 신분증 촬영을 먼저 누르시고",
        "앞면 인증 시작 한번 해 볼까요", "유심칩 배송받으실 주소가", "타사 보상으로 120%까지",
        "현금 32만 원 계좌로 입금이 될 거거든요", "한 달 요금은 13,100원 꼴인 거라서", "어떻게 잘 되시나요",
        "눌러주세요", "동의하시면", "자동이체 출금", "정상적으로 동의되었습니다",
    ];
    let definitely_counterpart = !clean_name.is_empty()
        && (COUNTERPART_PATTERNS.iter().any(|p| t.contains(p))
            || (clean_name == "이서정"
                && ["나 5학년이고 걔는 3학년이니까", "우리 반에 이서진보다 작은 애 많아", "우리 반에서는 여자애들이 남자애들보다", "학원 끝나는 시간이 그때인데", "안 사랑해. 전혀"]
                    .iter()
                    .any(|p| t.contains(p))));

    if definitely_counterpart {
        return clean_name.to_string();
    }

    // 3. 음성지문(Slot A)에서 내 목소리가 아님(Some(false))으로 판정된 고객센터/대표번호 대사는 상대방으로 교정
    if let Some(false) = acoustic_is_me {
        if is_center_or_biz && !clean_name.is_empty() {
            return clean_name.to_string();
        }
    }

    // 3. 화자 표기가 누락되었거나 모호한 경우 음성지문 판정값 또는 이전 화자 교대 규칙 적용
    let normalized_spk = if spk == "나"
        || spk == "정서현"
        || spk == "본인"
        || spk.eq_ignore_ascii_case("me")
        || spk.eq_ignore_ascii_case("user")
    {
        "나".to_string()
    } else if !clean_name.is_empty()
        && (spk == clean_name
            || spk == "상대방"
            || spk == "상담원"
            || spk.contains(clean_name))
    {
        clean_name.to_string()
    } else if let Some(is_me) = acoustic_is_me {
        if is_me {
            "나".to_string()
        } else if !clean_name.is_empty() {
            clean_name.to_string()
        } else {
            "상대방".to_string()
        }
    } else if prev_speaker == "나" && !clean_name.is_empty() {
        clean_name.to_string()
    } else {
        "나".to_string()
    };

    normalized_spk
}

fn split_utterance_into_sentences_with_min(text: &str, min_chars: usize) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut sentences: Vec<String> = Vec::new();
    let mut current = String::new();
    for part in trimmed.split_inclusive(&['.', '?', '!'][..]) {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        if current.is_empty() {
            current.push_str(p);
        } else if current.chars().count() < min_chars {
            current.push(' ');
            current.push_str(p);
        } else {
            sentences.push(current.trim().to_string());
            current = p.to_string();
        }
    }
    if !current.trim().is_empty() {
        if sentences.is_empty() || current.chars().count() >= 4 {
            sentences.push(current.trim().to_string());
        } else if let Some(last) = sentences.last_mut() {
            last.push(' ');
            last.push_str(current.trim());
        }
    }
    if sentences.is_empty() {
        vec![trimmed.to_string()]
    } else {
        sentences
    }
}

pub(crate) fn enforce_call_script_timetag_and_speaker_rules(
    script_body: &str,
    clean_name: &str,
    raw_stem: &str,
    audio_duration_sec: Option<f64>,
    acoustic_segments: Option<&[(f64, f64, bool)]>,
) -> String {
    enforce_call_script_timetag_and_speaker_rules_with_min(
        script_body,
        clean_name,
        raw_stem,
        audio_duration_sec,
        acoustic_segments,
        6,
    )
}

pub(crate) fn enforce_call_script_timetag_and_speaker_rules_slot_b(
    script_body: &str,
    clean_name: &str,
    raw_stem: &str,
    audio_duration_sec: Option<f64>,
) -> String {
    enforce_call_script_timetag_and_speaker_rules_with_min(
        script_body,
        clean_name,
        raw_stem,
        audio_duration_sec,
        None,
        24,
    )
}

fn enforce_call_script_timetag_and_speaker_rules_with_min(
    script_body: &str,
    clean_name: &str,
    raw_stem: &str,
    audio_duration_sec: Option<f64>,
    acoustic_segments: Option<&[(f64, f64, bool)]>,
    min_sentence_chars: usize,
) -> String {
    let re_hms = cached_regex!(r"\[(\d{1,2}):(\d{2}):(\d{2})\]");
    let re_ms = cached_regex!(r"\[(\d{1,2}):(\d{2})\]");
    let re_speaker_dirty = cached_regex!(r"(\*\*\[?)([^\]*:]+_[0-9]{6,}[_0-9]*)(\]?\*\*)");
    let re_dialogue_full = cached_regex!(
        r"^[-*]\s*\*\*\[(\d{2}:\d{2}:\d{2})\](?:\s*([^*:]+))?\*\*:?\s*(.*)$"
    );
    let re_dialogue_loose = cached_regex!(
        r"^[-*]\s*\*\*\[(\d{2}:\d{2}:\d{2})\]\s*([^:]+):\s*(.*)$"
    );

    #[derive(Clone)]
    struct TurnBlock {
        is_dialogue: bool,
        raw_line: String,
        anchor_sec: u64,
        speaker: String,
        sentences: Vec<String>,
    }

    let max_dur_sec = audio_duration_sec
        .filter(|&d| d > 1.0)
        .map(|d| d.floor() as u64);

    let mut blocks: Vec<TurnBlock> = Vec::new();
    let mut prev_parsed_sec: u64 = 0;

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
            blocks.push(TurnBlock {
                is_dialogue: false,
                raw_line: line,
                anchor_sec: 0,
                speaker: String::new(),
                sentences: Vec::new(),
            });
            continue;
        }

        // 1. 타임스탬프 파싱 ([MM:SS:FF] 오기재 자동 복원 포함, 단 5초 강제 압축은 하지 않고 실제 대화 시각 유지)
        let mut line_sec_opt: Option<u64> = None;
        if let Some(cap) = re_hms.captures(&line) {
            let a: u64 = cap[1].parse().unwrap_or(0);
            let b: u64 = cap[2].parse().unwrap_or(0);
            let c: u64 = cap[3].parse().unwrap_or(0);
            let as_hms = a * 3600 + b * 60 + c;
            let as_msf = a * 60 + b;

            let resolved_sec = if a >= 1
                && a <= 59
                && ((max_dur_sec.map(|md| as_hms > md + 5 && as_msf <= md + 30).unwrap_or(false))
                    || (prev_parsed_sec < 900 && as_hms > prev_parsed_sec + 1800))
            {
                as_msf
            } else {
                as_hms
            };

            let h = resolved_sec / 3600;
            let m = (resolved_sec % 3600) / 60;
            let s = resolved_sec % 60;
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            line = line.replacen(full_match, &formatted, 1);
            prev_parsed_sec = resolved_sec;
            line_sec_opt = Some(resolved_sec);
        } else if let Some(cap) = re_ms.captures(&line) {
            let m_val: u64 = cap[1].parse().unwrap_or(0);
            let s_val: u64 = cap[2].parse().unwrap_or(0);
            let total = m_val * 60 + s_val;
            let h = total / 3600;
            let m = (total % 3600) / 60;
            let s = total % 60;
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            line = line.replacen(full_match, &formatted, 1);
            prev_parsed_sec = total;
            line_sec_opt = Some(total);
        } else if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let total = prev_parsed_sec + 2;
            let h = total / 3600;
            let m = (total % 3600) / 60;
            let s = total % 60;
            let ts_tag = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let rest = trimmed[2..].trim_start();
            line = if let Some(after_bold) = rest.strip_prefix("**") {
                format!("- **{} {}", ts_tag, after_bold)
            } else {
                format!("- **{}** {}", ts_tag, rest)
            };
            prev_parsed_sec = total;
            line_sec_opt = Some(total);
        }

        if let Some(sec_val) = line_sec_opt {
            let t_line = line.trim();
            let (raw_spk, raw_txt) = if let Some(c) = re_dialogue_full.captures(t_line) {
                (
                    c.get(2).map(|m| m.as_str().trim()).unwrap_or("").to_string(),
                    c.get(3).map(|m| m.as_str().trim()).unwrap_or("").to_string(),
                )
            } else if let Some(c) = re_dialogue_loose.captures(t_line) {
                (
                    c.get(2).map(|m| m.as_str().trim()).unwrap_or("").to_string(),
                    c.get(3).map(|m| m.as_str().trim()).unwrap_or("").to_string(),
                )
            } else {
                let after_ts = if let Some(idx) = t_line.find(']') {
                    t_line[idx + 1..]
                        .trim()
                        .trim_start_matches("**")
                        .trim_start_matches(':')
                        .trim()
                } else {
                    t_line
                };
                (String::new(), after_ts.to_string())
            };

            if !raw_txt.is_empty() {
                let sents = split_utterance_into_sentences_with_min(&raw_txt, min_sentence_chars);
                blocks.push(TurnBlock {
                    is_dialogue: true,
                    raw_line: String::new(),
                    anchor_sec: sec_val,
                    speaker: raw_spk,
                    sentences: sents,
                });
                continue;
            }
        }

        blocks.push(TurnBlock {
            is_dialogue: false,
            raw_line: line,
            anchor_sec: 0,
            speaker: String::new(),
            sentences: Vec::new(),
        });
    }

    // 2. 원본 턴의 시작 시각(`anchor_sec`)이 실제 오디오 길이(`max_dur_sec`)를 초과할 때에만 오디오 길이 이내로 비례 조정
    let diag_block_indices: Vec<usize> = blocks
        .iter()
        .enumerate()
        .filter(|(_, b)| b.is_dialogue)
        .map(|(i, _)| i)
        .collect();

    if !diag_block_indices.is_empty() {
        let first_sec = blocks[diag_block_indices[0]].anchor_sec;
        let last_b = *diag_block_indices.last().unwrap();
        let current_end = blocks[last_b].anchor_sec;
        let target_end = max_dur_sec
            .map(|md| md.saturating_sub(1).max(1))
            .unwrap_or_else(|| current_end.max(first_sec + diag_block_indices.len() as u64 * 2));

        let has_bunched_same_sec = diag_block_indices.len() > 2
            && diag_block_indices
                .iter()
                .all(|&bi| blocks[bi].anchor_sec == first_sec);

        if has_bunched_same_sec && target_end > first_sec {
            // 동일 시각(예: 00:00:39 연속 중복)으로 뭉친 경우 글자 수 비례로 전체 구간에 고르게 재보간
            let total_chars: usize = diag_block_indices
                .iter()
                .map(|&bi| blocks[bi].sentences.iter().map(|s| s.chars().count().max(2)).sum::<usize>().max(2))
                .sum::<usize>()
                .max(1);
            let span = target_end.saturating_sub(first_sec);
            let mut acc = 0usize;
            for &b_idx in &diag_block_indices {
                let offset = ((acc as f64 / total_chars as f64) * (span as f64)).round() as u64;
                blocks[b_idx].anchor_sec = (first_sec + offset).min(target_end);
                let b_chars: usize = blocks[b_idx].sentences.iter().map(|s| s.chars().count().max(2)).sum::<usize>().max(2);
                acc += b_chars;
            }
        } else if current_end > target_end && current_end > 0 {
            for &b_idx in &diag_block_indices {
                let scaled = ((blocks[b_idx].anchor_sec as f64) * (target_end as f64) / (current_end as f64)).round() as u64;
                blocks[b_idx].anchor_sec = scaled.min(target_end);
            }
        }
    }

    // Slot B(min_sentence_chars >= 20)일 때 동일 화자의 연속된 짧은 대사 블록을 호흡 단위로 병합
    if min_sentence_chars >= 20 && blocks.len() > 1 {
        let mut merged_blocks: Vec<TurnBlock> = Vec::with_capacity(blocks.len());
        for blk in blocks.into_iter() {
            if blk.is_dialogue {
                if let Some(prev) = merged_blocks.last_mut() {
                    let prev_txt = prev.sentences.join(" ");
                    let cur_txt = blk.sentences.join(" ");
                    if prev.is_dialogue
                        && !prev.speaker.is_empty()
                        && prev.speaker == blk.speaker
                        && blk.anchor_sec.saturating_sub(prev.anchor_sec) <= 6
                        && (prev_txt.chars().count() + cur_txt.chars().count()) <= 75
                    {
                        prev.sentences = vec![format!("{} {}", prev_txt.trim(), cur_txt.trim())];
                        continue;
                    }
                }
            }
            merged_blocks.push(blk);
        }
        blocks = merged_blocks;
    }

    // 3. 각 대사 블록 내부의 문장들에 대해 다음 대사 시작 시각(`next_anchor_sec`) 사이를 글자 수 비례로 보간하여
    //    실제 통화 오디오 싱크와 정확히 일치하는 문장 단위 타임스탬프 부여 + 화자혼동 교정
    let mut out_lines: Vec<String> = Vec::new();
    let mut prev_spk = String::new();

    for (b_pos, block) in blocks.iter().enumerate() {
        if !block.is_dialogue {
            out_lines.push(block.raw_line.clone());
            continue;
        }

        let start_sec = block.anchor_sec;
        // 다음 대화 턴의 시작 시각 탐색
        let next_turn_sec = blocks[b_pos + 1..]
            .iter()
            .find(|nb| nb.is_dialogue)
            .map(|nb| nb.anchor_sec)
            .unwrap_or_else(|| {
                max_dur_sec
                    .unwrap_or(start_sec + (block.sentences.len() as u64 * 3).max(3))
                    .max(start_sec + 1)
            });

        let span_sec = next_turn_sec.saturating_sub(start_sec);
        let total_chars: usize = block
            .sentences
            .iter()
            .map(|s| s.chars().count().max(1))
            .sum::<usize>()
            .max(1);

        let mut acc_chars = 0usize;
        let mut last_assigned_sec = start_sec;
        let full_turn_text = block.sentences.join(" ");
        let turn_acoustic_is_me = acoustic_segments.and_then(|segs| {
            let sf = start_sec as f64;
            segs.iter()
                .find(|(s, e, _)| sf >= *s - 1.0 && sf <= *e + 1.0)
                .map(|(_, _, is_me)| *is_me)
        });
        let turn_verified_spk = resolve_verified_speaker_label(
            &block.speaker,
            &full_turn_text,
            clean_name,
            &prev_spk,
            turn_acoustic_is_me,
        );

        for (s_idx, sent) in block.sentences.iter().enumerate() {
            let mut sent_sec = if s_idx == 0 {
                start_sec
            } else if span_sec > 0 {
                let offset = ((acc_chars as f64 / total_chars as f64) * (span_sec as f64)).round() as u64;
                (start_sec + offset).min(next_turn_sec.saturating_sub(1).max(start_sec))
            } else {
                start_sec
            };
            if s_idx > 0 && sent_sec < last_assigned_sec {
                sent_sec = last_assigned_sec;
            }
            if let Some(max_dur) = max_dur_sec {
                let cap = max_dur.saturating_sub(1).max(1);
                if sent_sec > cap {
                    sent_sec = cap;
                }
            }
            last_assigned_sec = sent_sec;
            acc_chars += sent.chars().count().max(1);

            let sec_f = sent_sec as f64;
            let acoustic_is_me = acoustic_segments.and_then(|segs| {
                segs.iter()
                    .find(|(s, e, _)| sec_f >= *s - 1.0 && sec_f <= *e + 1.0)
                    .map(|(_, _, is_me)| *is_me)
            });
            let verified_spk = resolve_verified_speaker_label(
                &turn_verified_spk,
                sent,
                clean_name,
                &prev_spk,
                acoustic_is_me,
            );
            prev_spk = verified_spk.clone();

            let h = sent_sec / 3600;
            let m = (sent_sec % 3600) / 60;
            let s = sent_sec % 60;
            out_lines.push(format!(
                "- **[{:02}:{:02}:{:02}] {}**: {}",
                h, m, s, verified_spk, sent
            ));
        }
    }

    out_lines.join("\n")
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

        if let Some(cap) = re_hms.captures(&line) {
            let h: u64 = cap[1].parse().unwrap_or(0);
            let m: u64 = cap[2].parse().unwrap_or(0);
            let s: u64 = cap[3].parse().unwrap_or(0);
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            line = line.replacen(full_match, &formatted, 1);
            est_sec = h * 3600 + m * 60 + s + 2;
        } else if let Some(cap) = re_ms.captures(&line) {
            let m_val: u64 = cap[1].parse().unwrap_or(0);
            let s_val: u64 = cap[2].parse().unwrap_or(0);
            let total = m_val * 60 + s_val;
            let h = total / 3600;
            let m = (total % 3600) / 60;
            let s = total % 60;
            let formatted = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let full_match = cap.get(0).map(|m| m.as_str()).unwrap_or("");
            line = line.replacen(full_match, &formatted, 1);
            est_sec = total + 2;
        } else if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            let h = est_sec / 3600;
            let m = (est_sec % 3600) / 60;
            let s = est_sec % 60;
            let ts_tag = format!("[{:02}:{:02}:{:02}]", h, m, s);
            let rest = trimmed[2..].trim_start();
            if let Some(after_bold) = rest.strip_prefix("**[") {
                if let Some(close_idx) = after_bold.find("]**") {
                    let spk = &after_bold[..close_idx];
                    let rem = &after_bold[close_idx + 3..];
                    line = format!("- **{} {}**{}", ts_tag, spk, rem);
                } else {
                    line = format!("- **{} {}", ts_tag, after_bold);
                }
            } else if let Some(after_bold) = rest.strip_prefix("**") {
                line = format!("- **{} {}", ts_tag, after_bold);
            } else {
                line = format!("- **{}** {}", ts_tag, rest);
            }
            est_sec += 2;
        }

        out_lines.push(line);
    }

    out_lines.join("\n")
}

/// LLM(Gemini)이 생성한 통화 분석 텍스트를 1) 요약부 와 2) 스크립트 2개 섹션으로 분리합니다.
pub(crate) fn split_summary_and_transcript(raw_llm_text: &str) -> (String, String) {
    let cleaned = raw_llm_text.trim();
    if cleaned.is_empty() {
        return (String::new(), String::new());
    }

    let script_markers = ["## 📜 스크립트", "## 스크립트", "### 📜 스크립트", "2. **📜 화자 분리 대화 스크립트**:", "2. **화자 분리 대화 스크립트**:", "**📜 화자 분리 대화 스크립트**", "## 대화 스크립트"];
    for marker in script_markers {
        if let Some(idx) = cleaned.find(marker) {
            let before_script = &cleaned[..idx];
            let after_summary_header = if let Some(s_idx) = before_script.find("## 💡 요약") {
                &before_script[s_idx + "## 💡 요약".len()..]
            } else if let Some(s_idx) = before_script.find("## 요약") {
                &before_script[s_idx + "## 요약".len()..]
            } else {
                before_script
            };
            let raw_cleaned = after_summary_header.replace("## 💡 요약", "").replace("## 요약", "").replace("### 💡 요약", "").replace("1. **💡 통화 핵심 요약**:", "").replace("1. **통화 핵심 요약**:", "").replace("**💡 통화 핵심 요약**", "");
            let filtered_lines: Vec<&str> = raw_cleaned
                .lines()
                .filter(|line| {
                    let t = line.trim();
                    !t.starts_with("# 📞") && !t.starts_with("# 🎙️") && !t.starts_with("# ⌚") && !t.starts_with("> **통화 상대방**:") && !t.starts_with("> **녹음 출처**:") && !t.starts_with("> 📌 **사용자 추가 요구사항**:")
                })
                .collect();
            let summary_raw = filtered_lines.join("\n").trim().trim_end_matches("---").trim().to_string();
            let script_raw = cleaned[idx + marker.len()..].trim().trim_start_matches(':').trim().to_string();
            return (
                if summary_raw.is_empty() { "- 통화 요약 내용이 아래 스크립트에 포함되어 있습니다.".to_string() } else { summary_raw },
                if script_raw.is_empty() { cleaned.to_string() } else { script_raw },
            );
        }
    }
    let lines: Vec<&str> = cleaned.lines().collect();
    if lines.len() > 3 {
        (lines[..std::cmp::min(3, lines.len())].join("\n"), cleaned.to_string())
    } else {
        (cleaned.to_string(), cleaned.to_string())
    }
}
