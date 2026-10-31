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
/// (API 호출이 성공한 시점이므로 기존의 5시간 쿼터 락은 해제된 것으로 간주하여 날짜 변경 시 새 날짜로 갱신합니다.)
pub(crate) fn record_gemini_token_usage(used_tokens: i64) {
    let usage_path = resolve_local_appdata_gemini_usage_path();
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let (mut today_tokens, mut total_tokens, mut today_reqs, _) =
        read_gemini_token_usage_with_lock(false);

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
        "quota_retry_after_ms": 0,
        "updated_at": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
    });
    if let Ok(s) = serde_json::to_string_pretty(&save_json) {
        let _ = fs::write(&usage_path, s);
    }
}

/// 5시간 쿼터 락 설정/해제 시 `gemini_usage.json` 에도 `quota_retry_after_ms` 를 동기화합니다.
pub(crate) fn sync_gemini_usage_lock_state(retry_after_ms: i64) {
    let usage_path = resolve_local_appdata_gemini_usage_path();
    if let Ok(raw) = fs::read_to_string(&usage_path) {
        if let Ok(mut jv) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(obj) = jv.as_object_mut() {
                obj.insert(
                    "quota_retry_after_ms".to_string(),
                    serde_json::json!(retry_after_ms.max(0)),
                );
                if let Ok(s) = serde_json::to_string_pretty(&jv) {
                    let _ = fs::write(&usage_path, s);
                }
            }
        }
    }
}

/// (today_used_tokens, total_used_tokens, today_request_count, last_request_tokens) 반환.
/// 5시간 락(`external_lock_active` 또는 `quota_retry_after_ms > now_ms`)에 걸린 경우,
/// 락이 풀리기 전까지는 날짜가 변경(`saved_date != today_str`)되더라도 사용량을 0으로 갱신하지 않고 유지합니다.
pub(crate) fn read_gemini_token_usage_with_lock(external_lock_active: bool) -> (i64, i64, i64, i64) {
    let usage_path = resolve_local_appdata_gemini_usage_path();
    let now = chrono::Local::now();
    let today_str = now.format("%Y-%m-%d").to_string();
    let now_ms = now.timestamp_millis();
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
            let saved_retry_after_ms = jv
                .get("quota_retry_after_ms")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let is_locked = external_lock_active || (saved_retry_after_ms > now_ms);

            if saved_date == today_str || is_locked {
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

static GEMINI_HTTP_AGENT: std::sync::LazyLock<ureq::Agent> = std::sync::LazyLock::new(|| {
    use std::time::Duration;
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(5)))
        .timeout_global(Some(Duration::from_secs(180)))
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build()
        .into()
});

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
    let url = "https://generativelanguage.googleapis.com/v1beta/models";
    let resp = GEMINI_HTTP_AGENT
        .get(url)
        .header("x-goog-api-key", api_key.trim())
        .call()
        .ok()?;
    let resp_str = resp.into_body().read_to_string().ok()?;
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
    body_bytes: &[u8],
) -> Result<String, String> {
    let clean_model = model_name.trim().trim_start_matches("models/");
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        clean_model
    );

    let resp = GEMINI_HTTP_AGENT
        .post(&url)
        .header("x-goog-api-key", api_key.trim())
        .header("Content-Type", "application/json")
        .send(body_bytes)
        .map_err(|e| format!("Gemini HTTP 요청 오류: {}", e))?;
    let resp_str = resp
        .into_body()
        .read_to_string()
        .map_err(|e| format!("Gemini 응답 읽기 실패: {}", e))?;
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
    let body_bytes = serde_json::to_vec(request_json).map_err(|e| e.to_string())?;

    let (_, _, saved_model) = read_local_gemini_api_key_full();
    let mut candidates: Vec<String> = Vec::new();
    for m in [
        saved_model.as_str(),
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-flash-latest",
        "gemini-3.5-flash-lite",
    ] {
        let trimmed = m.trim().trim_start_matches("models/").to_string();
        if !trimmed.is_empty()
            && !trimmed.contains("2.5-flash")
            && !candidates.contains(&trimmed)
        {
            candidates.push(trimmed);
        }
    }

    let mut tried: Vec<String> = Vec::new();
    let mut first_primary_err = String::new();
    let mut last_err = String::new();
    let mut idx = 0;

    while idx < candidates.len() {
        let model = candidates[idx].clone();
        idx += 1;
        if tried.contains(&model) {
            continue;
        }
        tried.push(model.clone());

        match call_gemini_generate_content_single_model(api_key, &model, &body_bytes) {
            Ok(text) => {
                return Ok((text, model));
            }
            Err(err_msg) => {
                if first_primary_err.is_empty() {
                    first_primary_err = format!("[{}] {}", model, err_msg);
                }
                last_err = format!("[{}] {}", model, err_msg);
                // API 키 자체가 잘못된 경우에는 즉시 중단
                if err_msg.contains("API key not valid") || err_msg.contains("API_KEY_INVALID") {
                    return Err(format!("Gemini API 오류: {}", err_msg));
                }
                // 구글 에러 메시지가 권장 모델을 안내한 경우(예: Please update your code to use models/gemini-3.8-flash) 즉시 후보 최우선 추가
                if let Some(rec_model) = extract_recommended_model_from_error(&err_msg) {
                    if !rec_model.contains("2.5-flash")
                        && !tried.contains(&rec_model)
                        && !candidates.contains(&rec_model)
                    {
                        candidates.insert(idx, rec_model);
                    }
                }
            }
        }
    }

    // 모든 기본 후보가 실패한 경우 계정에 실제 활성화된 모델 목록을 조회하여 자동 폴백
    if let Some(discovered) = discover_available_gemini_model(api_key) {
        if !tried.contains(&discovered) {
            match call_gemini_generate_content_single_model(api_key, &discovered, &body_bytes) {
                Ok(text) => return Ok((text, discovered)),
                Err(err_msg) => {
                    last_err = format!("[{}] {}", discovered, err_msg);
                }
            }
        }
    }

    let final_err = if !first_primary_err.is_empty() {
        first_primary_err
    } else {
        last_err
    };
    Err(format!("Gemini API 오류: {}", final_err))
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
    user_requirement: Option<&str>,
    user_profile: Option<&str>,
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

    let profile_text = user_profile
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("이름: 정서현, 출생년도: 1983, 거주지: 거제, 출생지: 서울, 취미: 수영");
    let profile_section = format!(
        "\n\n[👤 사용자(통화 당사자 '나') 개인화 참고 정보]\n\
         - {}\n\
         - 주의: 대화 중 사용자의 이름(예: '서현', '정서현')이나 배경 정보가 발화될 때 통화 상대방 이름({})이나 유사 발음의 엉뚱한 인명으로 오인식·치환하지 말고, 위 사용자 개인화 정보를 정확히 참고하여 전사 및 요약하세요.",
        profile_text, contact_label
    );

    let req_section = match user_requirement.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(req_text) => format!(
            "\n\n[🔥 사용자 추가 요구사항 (반드시 최우선으로 반영할 것)]\n- {}\n위 사용자 추가 요구사항을 요약 및 스크립트 작성에 반드시 반영해 주세요.",
            req_text
        ),
        None => String::new(),
    };

    let b64_audio = base64_encode(audio_bytes);
    let prompt = format!(
        "다음 스마트폰 통화 녹음 음성을 듣고 한국어로 정확하게 분석하여 반드시 아래의 2개 마크다운 섹션(`## 💡 요약`, `## 📜 스크립트`) 구조로 작성해 주세요 (통화 상대방 이름: {} — 전화번호나 날짜 없이 순수 이름만 표시):\n\n\
         ## 💡 요약\n\
         - (통화 목적, 주요 합의 사항, 일정/장소/금액 등 핵심 내용을 1~3줄 불릿 포인트로 명확히 요약)\n\n\
         ## 📜 스크립트\n\
         - **[00:00:00] 나**: (실제 발화 내용)\n\
         - **[00:00:04] {}**: (실제 발화 내용)\n\
         (반드시 모든 문장마다 해당 문장이 시작되는 오디오 재생 오프셋 시각을 `[00:00:00]` 즉 `[HH:MM:SS]` 8자리 포맷으로 표시하고, 대화 상대방 이름은 전화번호나 날짜 없이 `{}` 이름만 표시하여 시간 순서대로 빠짐없이 작성){}{}",
        contact_label, contact_label, contact_label, profile_section, req_section
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
    user_requirement: Option<&str>,
    user_profile: Option<&str>,
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

    let profile_text = user_profile
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("이름: 정서현, 출생년도: 1983, 거주지: 거제, 출생지: 서울, 취미: 수영");
    let profile_section = format!(
        "\n\n[👤 사용자(녹음 당사자 본인) 개인화 참고 정보]\n\
         - {}\n\
         - 주의: 발화 내용 중 본인 이름(예: '서현', '정서현')이나 배경 정보가 언급될 때 엉뚱한 인명으로 오인식하지 말고 위 개인화 참고 정보를 기준으로 정확히 전사 및 요약하세요.",
        profile_text
    );

    let req_section = match user_requirement.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(req_text) => format!(
            "\n\n[🔥 사용자 추가 요구사항 (반드시 최우선으로 반영할 것)]\n- {}\n위 사용자 추가 요구사항을 요약 및 스크립트 작성에 반드시 반영해 주세요.",
            req_text
        ),
        None => String::new(),
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
         - **[00:00:00] 발화**: (문장마다 해당 문장이 시작되는 오디오 재생 오프셋 시각을 반드시 `[00:00:00]` 즉 `[HH:MM:SS]` 포맷으로 표시하여 시간 순서대로 빠짐없이 기록){}{}",
        recording_source, file_name, profile_section, req_section
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
    sync_gemini_usage_lock_state(retry_ms);

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
    sync_gemini_usage_lock_state(0);
}

/// `ai_*.log` 파일(최근 2개 파일)을 역순으로 스캔하여 가장 최근의 AI 이벤트가
/// `LLM 토큰 부족/오류 감지 (마지막 실패: YYYY-MM-DD HH:MM:SS · 5시간 후 YYYY-MM-DD HH:MM:SS 자동 재시도)` 인 경우
/// `(retry_after_ms, exhausted_at_str, retry_after_str, error_msg)` 를 반환합니다.
pub(crate) fn detect_quota_lock_from_ai_logs() -> Option<(i64, String, String, String)> {
    use chrono::{Local, NaiveDateTime, TimeZone};

    let logs_dir = app_logs_dir();
    let Ok(entries) = fs::read_dir(&logs_dir) else {
        return None;
    };
    let mut ai_log_files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.starts_with("ai_") && s.ends_with(".log"))
                    .unwrap_or(false)
        })
        .collect();
    ai_log_files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    let re_lock = cached_regex!(
        r"LLM 토큰 부족/오류 감지\s*\(마지막 실패:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*·\s*5시간 후\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*자동 재시도\)(?::\s*(.*))?$"
    );

    for log_path in ai_log_files.into_iter().take(2) {
        let Ok(raw) = fs::read_to_string(&log_path) else {
            continue;
        };
        for line in raw.lines().rev() {
            if line.contains("스크립트 생성 완료") {
                // 마지막 실패 이후 정상 생성 성공 로그가 있으면 락 해제 상태
                return None;
            }
            if let Some(cap) = re_lock.captures(line) {
                let ex_str = cap
                    .get(1)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();
                let rt_str = cap
                    .get(2)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();
                let err_str = cap
                    .get(3)
                    .map(|m| m.as_str().trim().to_string())
                    .unwrap_or_default();
                if let Ok(ndt) = NaiveDateTime::parse_from_str(&rt_str, "%Y-%m-%d %H:%M:%S") {
                    if let Some(dt) = Local.from_local_datetime(&ndt).earliest() {
                        return Some((dt.timestamp_millis(), ex_str, rt_str, err_str));
                    }
                }
            }
        }
    }
    None
}

pub(crate) fn build_gemini_api_key_status_with_conn(conn_opt: Option<&Connection>) -> GeminiApiKeyStatus {
    let secret_path = resolve_local_appdata_gemini_key_path();
    let (key, verified_at, saved_model) = read_local_gemini_api_key_full();
    let now_ms = chrono::Local::now().timestamp_millis();

    let (mut exhausted_str, mut retry_str, mut pending_cnt, mut last_err, mut auto_transcribe) =
        (String::new(), String::new(), 0usize, String::new(), true);
    let mut is_quota_locked = false;

    if let Some(conn) = conn_opt {
        auto_transcribe = is_auto_call_transcription_enabled(conn);
        let ex_ms = get_meta_i64(conn, "gemini_quota_exhausted_at_ms");
        let rt_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
        pending_cnt = conn
            .query_row(
                "SELECT COUNT(*) FROM lifelog_messages WHERE source IN ('call', 'recording') AND attachment_uuid LIKE 'pending_transcript:%'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize;

        if rt_ms > now_ms {
            is_quota_locked = true;
            sync_gemini_usage_lock_state(rt_ms);
            if ex_ms > 0 {
                let (d, t) = epoch_ms_to_local_date_time(ex_ms);
                exhausted_str = format!("{} {}", d, t);
            }
            let (d, t) = epoch_ms_to_local_date_time(rt_ms);
            retry_str = format!("{} {}", d, t);
            last_err = conn
                .query_row(
                    "SELECT value FROM mobile_sync_meta WHERE key = 'gemini_last_quota_error'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .filter(|s| s != "0")
                .unwrap_or_default();
        } else if rt_ms > 0 {
            // 5시간 락 시각이 경과한 경우 만료된 락 상태를 해제하여 날짜 변경분 사용량 갱신 허용
            clear_gemini_quota_exhaustion(conn);
        }
    }

    // DB에 락이 없거나 누락된 경우에도 ai_*.log 에서 5시간 락이 감지되면 반영
    if !is_quota_locked {
        if let Some((log_rt_ms, log_ex_str, log_rt_str, log_err)) = detect_quota_lock_from_ai_logs()
        {
            if log_rt_ms > now_ms {
                is_quota_locked = true;
                exhausted_str = log_ex_str;
                retry_str = log_rt_str;
                last_err = log_err;
                sync_gemini_usage_lock_state(log_rt_ms);
            }
        }
    }

    // gemini_usage.json 에 저장된 quota_retry_after_ms 가 아직 유효한 경우에도 폴백으로 반영
    if !is_quota_locked {
        let usage_path = resolve_local_appdata_gemini_usage_path();
        if let Ok(raw) = fs::read_to_string(&usage_path) {
            if let Ok(jv) = serde_json::from_str::<serde_json::Value>(&raw) {
                let saved_rt_ms = jv
                    .get("quota_retry_after_ms")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                if saved_rt_ms > now_ms {
                    is_quota_locked = true;
                    let (d, t) = epoch_ms_to_local_date_time(saved_rt_ms);
                    retry_str = format!("{} {}", d, t);
                    let ex_ms = saved_rt_ms - 5 * 60 * 60 * 1000;
                    let (ed, et) = epoch_ms_to_local_date_time(ex_ms);
                    exhausted_str = format!("{} {}", ed, et);
                }
            }
        }
    }

    let (today_used_tokens, total_used_tokens, today_request_count, last_request_tokens) =
        read_gemini_token_usage_with_lock(is_quota_locked);

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
