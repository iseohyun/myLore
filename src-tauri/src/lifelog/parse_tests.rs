//! `lifelog::parse` / `lifelog::contacts` 순수 함수 단위 테스트.
//!
//! 현재 동작을 고정하는 특성(characterization) 테스트입니다. 파서를 수정할 때 의도한 변화인지 확인하는 기준으로 사용합니다.
//! 실행: `cd src-tauri; cargo test --lib`

use crate::*;

fn contacts(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// 문자열의 UTF-8 바이트를 ISO-8859-1(latin1) 문자로 잘못 해석한 "깨진" 문자열을 만듭니다.
fn as_mojibake(s: &str) -> String {
    s.as_bytes().iter().map(|&b| b as char).collect()
}

// ---------------------------------------------------------------- contacts

#[test]
fn normalize_phone_digits_strips_symbols_and_country_code() {
    assert_eq!(normalize_phone_digits("010-1234-5678"), "01012345678");
    assert_eq!(normalize_phone_digits("+82 10-1234-5678"), "01012345678");
    assert_eq!(normalize_phone_digits("1588-1234"), "15881234");
    assert_eq!(normalize_phone_digits("이름"), "");
}

#[test]
fn resolve_contact_display_uses_exact_then_normalized_lookup() {
    let map = contacts(&[("01012345678", "홍길동")]);
    assert_eq!(resolve_contact_display("", &map), "알수없음");
    assert_eq!(resolve_contact_display("01012345678", &map), "홍길동");
    assert_eq!(resolve_contact_display("010-1234-5678", &map), "홍길동");
    assert_eq!(resolve_contact_display("김철수", &map), "김철수");
}

// ---------------------------------------------------------------- MMS / RCS 본문

#[test]
fn clean_mms_body_empty_and_plain_title_prefix() {
    assert_eq!(clean_mms_and_multiline_body("   "), "");
    assert_eq!(clean_mms_and_multiline_body("[제목없음] 안녕하세요"), "안녕하세요");
}

#[test]
fn clean_mms_body_recovers_mojibake_title() {
    let broken_no_title = format!("[{}] 본문", as_mojibake("제목없음"));
    assert_eq!(clean_mms_and_multiline_body(&broken_no_title), "본문");

    let broken_title = format!("[{}] 본문", as_mojibake("공지"));
    assert_eq!(clean_mms_and_multiline_body(&broken_title), "[공지] 본문");
}

#[test]
fn clean_mms_body_extracts_rcs_card_texts() {
    let rcs = r#"{"layout":{"widget":"LinearLayout","children":[{"widget":"TextView","text":"안녕"},{"widget":"TextView","text":"반가워"}]}}"#;
    assert_eq!(clean_mms_and_multiline_body(rcs), "안녕<br/>반가워");
}

#[test]
fn clean_mms_body_joins_lines_and_collapses_blank_runs() {
    let raw = "첫줄\r\n둘째줄\n\n\n셋째줄\n";
    assert_eq!(
        clean_mms_and_multiline_body(raw),
        "첫줄<br/>둘째줄<br/><br/>셋째줄"
    );
}

// ---------------------------------------------------------------- 녹음 파일 판별 / 파일명 메타

#[test]
fn voice_memo_detection() {
    assert_eq!(
        is_voice_memo_or_watch_recording("음성 001_W_20250404_140623.m4a", "", ""),
        (true, "갤럭시 워치".to_string())
    );
    assert_eq!(
        is_voice_memo_or_watch_recording("통화 녹음 홍길동_241017_180627.m4a", "", ""),
        (false, String::new())
    );
    assert_eq!(
        is_voice_memo_or_watch_recording("음성 260503_212528.m4a", "", "모바일"),
        (true, "SM-S901N".to_string())
    );
    assert_eq!(
        is_voice_memo_or_watch_recording("음성 260503_212528.m4a", "", "Galaxy S23"),
        (true, "Galaxy S23".to_string())
    );
    assert_eq!(
        is_voice_memo_or_watch_recording("random.m4a", "/Download", "x"),
        (false, String::new())
    );
}

#[test]
fn voice_recording_filename_meta_watch_and_phone() {
    assert_eq!(
        parse_voice_recording_filename_meta("음성 001_W_20250404_140623", ""),
        (
            "[워치] 음성 001_W_20250404_140623".to_string(),
            "갤럭시 워치".to_string(),
            "2025-04-04".to_string(),
            "14:06:23".to_string()
        )
    );
    assert_eq!(
        parse_voice_recording_filename_meta("음성 260503_212528", "SM-S911N"),
        (
            "[SM-S911N] 음성 260503_212528".to_string(),
            "SM-S911N".to_string(),
            "2026-05-03".to_string(),
            "21:25:28".to_string()
        )
    );
    let (_, src, _, _) = parse_voice_recording_filename_meta("음성 260503_212528", "모바일");
    assert_eq!(src, "SM-S901N");
}

#[test]
fn clean_contact_name_variants() {
    let empty = HashMap::new();
    assert_eq!(extract_clean_contact_name("홍길동 (010-1234-5678)", &empty), "홍길동");
    assert_eq!(extract_clean_contact_name("통화 녹음 #덕산아내중계", &empty), "#덕산아내중계");
    assert_eq!(extract_clean_contact_name("구인호_01038213356", &empty), "구인호");
    assert_eq!(
        extract_clean_contact_name("이름_01012345678_20261023_122434", &empty),
        "이름"
    );

    let map = contacts(&[("01012345678", "홍길동"), ("01099990000", "김")]);
    assert_eq!(extract_clean_contact_name("01012345678_x", &map), "홍길동");
    assert_eq!(extract_clean_contact_name("010-9999-0000_abc", &map), "김");
}

#[test]
fn call_audio_filename_meta_formats() {
    let empty = HashMap::new();
    // T전화: 이름_전화번호_YYYYMMDDHHMMSS
    assert_eq!(
        parse_call_audio_filename_meta("구인호_01038213356_20261029165901", &empty),
        (
            "구인호".to_string(),
            "2026-10-29".to_string(),
            "16:59:01".to_string()
        )
    );
    // 이름_전화번호_YYYYMMDD_HHMMSS
    assert_eq!(
        parse_call_audio_filename_meta("이름_01012345678_20261023_122434", &empty),
        (
            "이름".to_string(),
            "2026-10-23".to_string(),
            "12:24:34".to_string()
        )
    );
    // 삼성 기본: 통화 녹음 상대방_YYMMDD_HHMMSS
    assert_eq!(
        parse_call_audio_filename_meta("통화 녹음 #덕산아내중계_241017_180627", &empty),
        (
            "#덕산아내중계".to_string(),
            "2024-10-17".to_string(),
            "18:06:27".to_string()
        )
    );
}

// ---------------------------------------------------------------- LLM 응답 정규화

#[test]
fn split_summary_and_transcript_with_markers() {
    let raw = "## 💡 요약\n- 핵심\n\n## 📜 스크립트\n- **[00:00:00] 나**: 안녕";
    assert_eq!(
        split_summary_and_transcript(raw),
        ("- 핵심".to_string(), "- **[00:00:00] 나**: 안녕".to_string())
    );

    let (summary, script) = split_summary_and_transcript("## 📜 스크립트\n- 대화");
    assert_eq!(summary, "- 통화 요약 내용이 아래 스크립트에 포함되어 있습니다.");
    assert_eq!(script, "- 대화");
}

#[test]
fn split_summary_and_transcript_without_markers() {
    assert_eq!(split_summary_and_transcript(""), (String::new(), String::new()));
    assert_eq!(
        split_summary_and_transcript("짧은 응답"),
        ("짧은 응답".to_string(), "짧은 응답".to_string())
    );
    assert_eq!(
        split_summary_and_transcript("a\nb\nc\nd"),
        ("a\nb\nc".to_string(), "a\nb\nc\nd".to_string())
    );
}

#[test]
fn normalize_script_pads_and_converts_timestamps() {
    assert_eq!(
        normalize_script_lines_with_timestamps_and_clean_name("- **[0:01:05] 나**: 안녕", "", ""),
        "- **[00:01:05] 나**: 안녕"
    );
    assert_eq!(
        normalize_script_lines_with_timestamps_and_clean_name("- [01:05] 나: hi", "", ""),
        "- [00:01:05] 나: hi"
    );
}

#[test]
fn normalize_script_assigns_estimated_offsets_to_bullets() {
    let input = "## 📜 스크립트\n- **[나]**: 안녕하세요\n- **[상대]**: 네";
    assert_eq!(
        normalize_script_lines_with_timestamps_and_clean_name(input, "", ""),
        "## 📜 스크립트\n- **[00:00:00] 나**: 안녕하세요\n- **[00:00:02] 상대**: 네"
    );
}

#[test]
fn normalize_script_cleans_dirty_speaker_names() {
    assert_eq!(
        normalize_script_lines_with_timestamps_and_clean_name(
            "- **[00:00:03] 홍길동_01012345678_20261023**: 네",
            "홍길동",
            "홍길동_01012345678_20261023"
        ),
        "- **[00:00:03] 홍길동**: 네"
    );
    assert_eq!(
        normalize_script_lines_with_timestamps_and_clean_name("- **홍길동_01012345678**: 네", "홍길동", ""),
        "- **[00:00:00] 홍길동**: 네"
    );
}

#[test]
fn enforce_call_script_timetag_and_speaker_rules_fixes_mm_ss_ff_and_splits_sentences() {
    let input = "- **[00:00:05] 아정당대표번호**: 네, 정서현입니다.\n\
                 - **[00:00:19] 나**: 접수 도와드리는 담당자입니다. 잠시 통화 가능하실까요?\n\
                 - **[01:14:00] 아정당대표번호**: 이미 LG로 했습니다.";
    let out = enforce_call_script_timetag_and_speaker_rules(
        input,
        "아정당대표번호",
        "아정당대표번호_18333504_20261105205929",
        Some(90.0),
        None,
    );
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines.len(), 4);
    // 첫 문장: "네, 정서현입니다" -> 화자혼동 교정되어 '나'가 되며 실제 시각 [00:00:05] 유지
    assert!(lines[0].contains("[00:00:05] 나**: 네, 정서현입니다."));
    // 둘째 턴: 2문장으로 분할되어 [00:00:19] 및 보간 시각이 부여되고 화자는 '아정당대표번호'
    assert!(lines[1].contains("[00:00:19] 아정당대표번호**: 접수 도와드리는 담당자입니다."));
    assert!(lines[2].contains("아정당대표번호**: 잠시 통화 가능하실까요?"));
    // 셋째 턴: [01:14:00]이 1시간 14분이 아니라 [00:01:14]로 복원되고 화자는 '나'로 교정
    assert!(lines[3].contains("[00:01:14] 나**: 이미 LG로 했습니다."));
}

#[test]
fn slot_a_and_slot_b_produce_distinct_dual_ab_scripts() {
    let input = "- **[00:00:05] 상담사**: 안녕하세요 고객님. 본인 확인 도와드리겠습니다. 잠시 통화 가능하실까요?";
    let out_a = enforce_call_script_timetag_and_speaker_rules(
        input,
        "상담사",
        "상담사_15880000_20261106100000",
        Some(30.0),
        None,
    );
    let out_b = enforce_call_script_timetag_and_speaker_rules_slot_b(
        input,
        "상담사",
        "상담사_15880000_20261106100000",
        Some(30.0),
    );
    // Slot A(min_sentence_chars=6)는 짧은 인사말까지 세밀하게 분할하고, Slot B(min_sentence_chars=24)는 호흡 단위로 묶어 분할
    assert!(out_a.lines().count() >= out_b.lines().count());
    assert_ne!(out_a, out_b);
}





