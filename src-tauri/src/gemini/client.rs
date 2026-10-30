//! Gemini API 클라이언트: API 키/토큰 사용량 저장, 모델 폴백, 음성 → 텍스트 변환, 쿼터 상태.

use crate::*;

/// 방법 A: 클라우드(OneDrive/Google Drive)나 Git에 동기화되지 않는 PC 로컬 전용 `%APPDATA%\com.iseohyun.mylore\gemini_secret.json` 경로
pub(crate) fn resolve_local_appdata_gemini_key_path() -> PathBuf {
    let dir = app_data_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("gemini_secret.json")
}

pub(crate) fn read_local_gemini_api_key_full() -> (String, String, String) {
    let secret_path = resolve_local_appdata_gemini_key_path();
    if let Ok(raw) = fs::read_to_string(&secret_path) {
        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(&raw) {
            let k = jv
                .get("api_key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let v_at = jv
                .get("verified_at")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let model = jv
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("gemini-3.8-flash")
                .trim()
                .to_string();
            return (
                k,
                v_at,
                if model.is_empty() {
                    "gemini-3.8-flash".to_string()
                } else {
                    model
                },
            );
        }
    }
    (String::new(), String::new(), "gemini-3.8-flash".to_string())
}

pub(crate) fn read_local_gemini_api_key() -> (String, String) {
    let (k, v_at, _) = read_local_gemini_api_key_full();
    (k, v_at)
}

pub(crate) fn resolve_local_appdata_gemini_usage_path() -> PathBuf {
    let dir = app_data_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("gemini_usage.json")
}

/// Gemini API 응답의 `usageMetadata` 에서 반환된 토큰 사용량을 당일/누적 기준으로 기록합니다.
pub(crate) fn record_gemini_token_usage(used_tokens: i64) {
    let usage_path = resolve_local_appdata_gemini_usage_path();
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let (mut today_tokens, mut total_tokens, mut today_reqs, _) = read_gemini_token_usage();

    let add_tok = used_tokens.max(0);
    today_tokens += add_tok;
    total_tokens += add_tok;
    today_reqs += 1;

    let save_json = serde_json::json!({
        "today_date": today_str,
        "today_used_tokens": today_tokens,
        "total_used_tokens": total_tokens,
        "today_request_count": today_reqs,
        "last_request_tokens": add_tok,
        "updated_at": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    });
    if let Ok(s) = serde_json::to_string_pretty(&save_json) {
        let _ = fs::write(&usage_path, s);
    }
}

/// (today_used_tokens, total_used_tokens, today_request_count, last_request_tokens) 반환
pub(crate) fn read_gemini_token_usage() -> (i64, i64, i64, i64) {
    let usage_path = resolve_local_appdata_gemini_usage_path();
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    if let Ok(raw) = fs::read_to_string(&usage_path) {
        if let Ok(jv) = serde_json::from_str::<serde_json::Value>(&raw) {
            let saved_date = jv.get("today_date").and_then(|v| v.as_str()).unwrap_or("");
            let total_tok = jv
                .get("total_used_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let last_tok = jv
                .get("last_request_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            if saved_date == today_str {
                let today_tok = jv
                    .get("today_used_tokens")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let today_req = jv
                    .get("today_request_count")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                return (today_tok, total_tok, today_req, last_tok);
            } else {
                return (0, total_tok, 0, last_tok);
            }
        }
    }
    (0, 0, 0, 0)
}

pub(crate) fn is_auto_call_transcription_enabled(conn: &Connection) -> bool {
    let setting_path = resolve_projects_setting_json_path(conn);
    if setting_path.exists() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<MyLoreAppSettings>(&raw) {
                return parsed.auto_call_transcription;
            }
        }
    }
    true
}

pub(crate) fn mask_gemini_api_key(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        String::new()
    } else if t.len() <= 10 {
        "••••••••••".to_string()
    } else {
        format!("{}••••••••••••••••{}", &t[..6], &t[t.len() - 4..])
    }
}

pub(crate) fn extract_recommended_model_from_error(err_msg: &str) -> Option<String> {
    let marker = "use models/";
    if let Some(idx) = err_msg.find(marker) {
        let rest = &err_msg[idx + marker.len()..];
        let raw_model: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
            .collect();
        let cleaned = raw_model.trim_end_matches('.').to_string();
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    None
}

pub(crate) fn discover_available_gemini_model(api_key: &str) -> Option<String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}",
        api_key.trim()
    );
    #[cfg(target_os = "windows")]
    let output_res = {
        use std::os::windows::process::CommandExt;
        Command::new("curl.exe")
            .args(["-4", "--connect-timeout", "5", "-s", "-S", &url])
            .creation_flags(0x08000000)
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let output_res = Command::new("curl")
        .args(["-4", "--connect-timeout", "5", "-s", "-S", &url])
        .output();

    let output = output_res.ok()?;
    let resp_str = String::from_utf8_lossy(&output.stdout);
    let jv: serde_json::Value = serde_json::from_str(&resp_str).ok()?;
    let models = jv.get("models")?.as_array()?;

    let mut fallback_candidate: Option<String> = None;
    for m in models {
        let name = m
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .trim_start_matches("models/");
        if name.is_empty() {
            continue;
        }
        let supports_gen = m
            .get("supportedGenerationMethods")
            .and_then(|arr| arr.as_array())
            .map(|arr| arr.iter().any(|v| v.as_str() == Some("generateContent")))
            .unwrap_or(false);
        if !supports_gen {
            continue;
        }
        let lower = name.to_lowercase();
        if lower.contains("tts") || lower.contains("image") || lower.contains("embedding") {
            continue;
        }
        if lower.contains("flash") && !lower.contains("2.5-flash") {
            return Some(name.to_string());
        }
        if fallback_candidate.is_none() && lower.contains("gemini") {
            fallback_candidate = Some(name.to_string());
        }
    }
    fallback_candidate
}

pub(crate) fn call_gemini_generate_content_single_model(
    api_key: &str,
    model_name: &str,
    data_arg: &str,
) -> Result<String, String> {
    let clean_model = model_name.trim().trim_start_matches("models/");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        clean_model,
        api_key.trim()
    );

    #[cfg(target_os = "windows")]
    let output_res = {
        use std::os::windows::process::CommandExt;
        Command::new("curl.exe")
            .args([
                "-4",
                "--connect-timeout",
                "5",
                "-s",
                "-S",
                "-X",
                "POST",
                &url,
                "-H",
                "Content-Type: application/json",
                "--data-binary",
                data_arg,
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let output_res = Command::new("curl")
        .args([
            "-4",
            "--connect-timeout",
            "5",
            "-s",
            "-S",
            "-X",
            "POST",
            &url,
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            data_arg,
        ])
        .output();

    let output = output_res.map_err(|e| format!("curl 실행 오류: {}", e))?;
    let resp_str = String::from_utf8_lossy(&output.stdout).to_string();
    let jv: serde_json::Value = serde_json::from_str(&resp_str)
        .map_err(|_| format!("Gemini 응답 파싱 실패: {}", resp_str))?;

    if let Some(err_msg) = jv
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
    {
        return Err(err_msg.to_string());
    }

    let text = jv
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(|parts| parts.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<&str>>()
                .join("\n")
        })
        .unwrap_or_default();

    if text.trim().is_empty() {
        return Err("Gemini로부터 빈 응답을 받았습니다.".to_string());
    }

    // Gemini 응답의 usageMetadata 에서 실제 소비된 토큰 수 추출 및 누적 기록
    if let Some(usage) = jv.get("usageMetadata") {
        let prompt_tok = usage
            .get("promptTokenCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let cand_tok = usage
            .get("candidatesTokenCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let total_tok = usage
            .get("totalTokenCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(prompt_tok + cand_tok);
        record_gemini_token_usage(total_tok);
    } else {
        record_gemini_token_usage(0);
    }

    Ok(text.trim().to_string())
}

pub(crate) fn call_gemini_generate_content_with_model(
    api_key: &str,
    request_json: &serde_json::Value,
) -> Result<(String, String), String> {
    let temp_file =
        std::env::temp_dir().join(format!("mylore_gemini_req_{}.json", Uuid::new_v4()));
    let body_bytes = serde_json::to_vec(request_json).map_err(|e| e.to_string())?;
    fs::write(&temp_file, &body_bytes).map_err(|e| format!("임시 파일 생성 실패: {}", e))?;
    let data_arg = format!("@{}", temp_file.to_string_lossy());

    let (_, _, saved_model) = read_local_gemini_api_key_full();
    let mut candidates: Vec<String> = Vec::new();
    for m in [
        saved_model.as_str(),
        "gemini-3.8-flash",
        "gemini-flash-latest",
        "gemini-3.0-flash",
        "gemini-2.5-flash",
    ] {
        let trimmed = m.trim().trim_start_matches("models/").to_string();
        if !trimmed.is_empty() && !candidates.contains(&trimmed) {
            candidates.push(trimmed);
        }
    }

    let mut tried: Vec<String> = Vec::new();
    let mut last_err = String::new();
    let mut idx = 0;

    while idx < candidates.len() {
        let model = candidates[idx].clone();
        idx += 1;
        if tried.contains(&model) {
            continue;
        }
        tried.push(model.clone());

        match call_gemini_generate_content_single_model(api_key, &model, &data_arg) {
            Ok(text) => {
                let _ = fs::remove_file(&temp_file);
                return Ok((text, model));
            }
            Err(err_msg) => {
                last_err = err_msg.clone();
                // API 키 자체가 잘못된 경우에는 즉시 중단
                if err_msg.contains("API key not valid") || err_msg.contains("API_KEY_INVALID") {
                    let _ = fs::remove_file(&temp_file);
                    return Err(format!("Gemini API 오류: {}", err_msg));
                }
                // 구글 에러 메시지가 권장 모델을 안내한 경우(예: Please update your code to use models/gemini-3.8-flash) 즉시 후보 최우선 추가
                if let Some(rec_model) = extract_recommended_model_from_error(&err_msg) {
                    if !tried.contains(&rec_model) && !candidates.contains(&rec_model) {
                        candidates.insert(idx, rec_model);
                    }
                }
            }
        }
    }

    // 모든 기본 후보가 실패한 경우 계정에 실제 활성화된 모델 목록을 조회하여 자동 폴백
    if let Some(discovered) = discover_available_gemini_model(api_key) {
        if !tried.contains(&discovered) {
            if let Ok(text) =
                call_gemini_generate_content_single_model(api_key, &discovered, &data_arg)
            {
                let _ = fs::remove_file(&temp_file);
                return Ok((text, discovered));
            }
        }
    }

    let _ = fs::remove_file(&temp_file);
    Err(format!("Gemini API 오류: {}", last_err))
}

pub(crate) fn call_gemini_generate_content(
    api_key: &str,
    request_json: &serde_json::Value,
) -> Result<String, String> {
    let (text, _) = call_gemini_generate_content_with_model(api_key, request_json)?;
    Ok(text)
}

pub(crate) fn transcribe_call_audio_with_gemini(
    api_key: &str,
    audio_bytes: &[u8],
    file_name: &str,
    contact_label: &str,
) -> Result<String, String> {
    if audio_bytes.is_empty() {
        return Err("오디오 바이트가 비어 있습니다.".to_string());
    }
    let lower = file_name.to_lowercase();
    let mime_type = if lower.ends_with(".mp3") {
        "audio/mp3"
    } else if lower.ends_with(".amr") {
        "audio/amr"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".aac") {
        "audio/aac"
    } else {
        "audio/mp4" // .m4a 기본값
    };

    let b64_audio = base64_encode(audio_bytes);
    let prompt = format!(
        "다음 스마트폰 통화 녹음 음성을 듣고 한국어로 정확하게 분석하여 반드시 아래의 2개 마크다운 섹션(`## 💡 요약`, `## 📜 스크립트`) 구조로 작성해 주세요 (통화 상대방 이름: {} — 전화번호나 날짜 없이 순수 이름만 표시):\n\n\
         ## 💡 요약\n\
         - (통화 목적, 주요 합의 사항, 일정/장소/금액 등 핵심 내용을 1~3줄 불릿 포인트로 명확히 요약)\n\n\
         ## 📜 스크립트\n\
         - **[00:00:00] 나**: (실제 발화 내용)\n\
         - **[00:00:04] {}**: (실제 발화 내용)\n\
         (반드시 모든 문장마다 해당 문장이 시작되는 오디오 재생 오프셋 시각을 `[00:00:00]` 즉 `[HH:MM:SS]` 8자리 포맷으로 표시하고, 대화 상대방 이름은 전화번호나 날짜 없이 `{}` 이름만 표시하여 시간 순서대로 빠짐없이 작성)",
        contact_label, contact_label, contact_label
    );

    let req_json = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": b64_audio
                    }
                }
            ]
        }]
    });

    call_gemini_generate_content(api_key, &req_json)
}

/// 독백녹음(음성메모) 또는 회의녹음 음성을 분석하여 **음성메모·회의록 톤**으로 요약 및 스크립트를 생성합니다.
pub(crate) fn transcribe_voice_recording_with_gemini(
    api_key: &str,
    audio_bytes: &[u8],
    file_name: &str,
    recording_source: &str,
) -> Result<String, String> {
    if audio_bytes.is_empty() {
        return Err("오디오 바이트가 비어 있습니다.".to_string());
    }
    let lower = file_name.to_lowercase();
    let mime_type = if lower.ends_with(".mp3") {
        "audio/mp3"
    } else if lower.ends_with(".amr") {
        "audio/amr"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".ogg") {
        "audio/ogg"
    } else if lower.ends_with(".aac") {
        "audio/aac"
    } else {
        "audio/mp4"
    };

    let b64_audio = base64_encode(audio_bytes);
    let prompt = format!(
        "다음 음성녹음 파일(출처: {}, 파일명: {})은 사용자의 독백 음성메모 또는 대면 회의 녹음입니다.\n\
         음성메모·회의록 전문 톤(Voice Memo & Meeting Minutes Tone)을 적극 활용하여 반드시 아래의 2개 마크다운 섹션(`## 💡 요약`, `## 📜 스크립트`) 구조로 한국어로 작성해 주세요:\n\n\
         ## 💡 요약\n\
         - **핵심 주제/안건**: (독백 메모의 핵심 아이디어 또는 회의 주요 안건 요약)\n\
         - **주요 내용 및 결정 사항**: (논의된 핵심 포인트, 아이디어, 결론 등을 개조식 불릿으로 정리)\n\
         - **Action Items (향후 할 일 / 일정)**: (후속 조치, 체크리스트, 일정 등이 있다면 명확히 정리)\n\n\
         ## 📜 스크립트\n\
         - **[00:00:00] 발화**: (문장마다 해당 문장이 시작되는 오디오 재생 오프셋 시각을 반드시 `[00:00:00]` 즉 `[HH:MM:SS]` 포맷으로 표시하여 시간 순서대로 빠짐없이 기록)",
        recording_source, file_name
    );

    let req_json = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": b64_audio
                    }
                }
            ]
        }]
    });

    call_gemini_generate_content(api_key, &req_json)
}

/// LLM 토큰 부족/한도 초과 발생 시 고갈 시점과 5시간(`5 * 3600 * 1000` ms) 후 자동 재시도 시점을 DB에 기록합니다.
pub(crate) fn record_gemini_quota_exhaustion(conn: &Connection, err_msg: &str) -> (String, String) {
    let now = chrono::Local::now();
    let now_ms = now.timestamp_millis();
    let retry_ms = now_ms + 5 * 3600 * 1000; // 5시간 후 재시도
    let exhausted_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let (retry_d, retry_t) = epoch_ms_to_local_date_time(retry_ms);
    let retry_str = format!("{} {}", retry_d, retry_t);

    for (k, v) in [
        ("gemini_quota_exhausted_at_ms", now_ms.to_string()),
        ("gemini_quota_retry_after_ms", retry_ms.to_string()),
        ("gemini_last_quota_error", err_msg.to_string()),
    ] {
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![k, v],
        );
    }

    (exhausted_str, retry_str)
}

pub(crate) fn clear_gemini_quota_exhaustion(conn: &Connection) {
    for k in [
        "gemini_quota_exhausted_at_ms",
        "gemini_quota_retry_after_ms",
        "gemini_last_quota_error",
    ] {
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, '0')
             ON CONFLICT(key) DO UPDATE SET value = '0'",
            params![k],
        );
    }
}

pub(crate) fn build_gemini_api_key_status_with_conn(conn_opt: Option<&Connection>) -> GeminiApiKeyStatus {
    let secret_path = resolve_local_appdata_gemini_key_path();
    let (key, verified_at, saved_model) = read_local_gemini_api_key_full();
    let (today_used_tokens, total_used_tokens, today_request_count, last_request_tokens) =
        read_gemini_token_usage();

    let (mut exhausted_str, mut retry_str, mut pending_cnt, mut last_err, mut auto_transcribe) =
        (String::new(), String::new(), 0usize, String::new(), true);

    if let Some(conn) = conn_opt {
        auto_transcribe = is_auto_call_transcription_enabled(conn);
        let ex_ms = get_meta_i64(conn, "gemini_quota_exhausted_at_ms");
        let rt_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
        if ex_ms > 0 {
            let (d, t) = epoch_ms_to_local_date_time(ex_ms);
            exhausted_str = format!("{} {}", d, t);
        }
        if rt_ms > 0 {
            let (d, t) = epoch_ms_to_local_date_time(rt_ms);
            retry_str = format!("{} {}", d, t);
        }
        last_err = conn
            .query_row(
                "SELECT value FROM mobile_sync_meta WHERE key = 'gemini_last_quota_error'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .filter(|s| s != "0")
            .unwrap_or_default();
        pending_cnt = conn
            .query_row(
                "SELECT COUNT(*) FROM lifelog_messages WHERE source IN ('call', 'recording') AND attachment_uuid LIKE 'pending_transcript:%'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize;
    }

    GeminiApiKeyStatus {
        has_key: !key.is_empty(),
        masked_key: mask_gemini_api_key(&key),
        model_name: saved_model,
        last_verified_at: verified_at,
        storage_location: secret_path.to_string_lossy().to_string(),
        quota_exhausted_at: exhausted_str,
        retry_after_at: retry_str,
        pending_call_count: pending_cnt,
        last_quota_error: last_err,
        today_used_tokens,
        total_used_tokens,
        today_request_count,
        last_request_tokens,
        auto_call_transcription: auto_transcribe,
    }
}
