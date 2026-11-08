//! 멀티 LLM (Anthropic Claude · OpenAI GPT · xAI Grok) 개별 API 연동, 키 검증, 토큰 및 달러($) 잔액 관리.

use crate::*;

static MULTI_LLM_STORE_LOCK: std::sync::LazyLock<Mutex<()>> =
    std::sync::LazyLock::new(|| Mutex::new(()));

pub(crate) fn resolve_local_appdata_multi_llm_path() -> PathBuf {
    let dir = app_data_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("multi_llm_secrets.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StoredLlmProviderEntry {
    #[serde(default)] api_key: String,
    #[serde(default)] model_name: String,
    #[serde(default)] verified_at: String,
    #[serde(default)] today_date: String,
    #[serde(default)] today_used_tokens: i64,
    #[serde(default)] total_used_tokens: i64,
    #[serde(default)] today_request_count: i64,
    #[serde(default)] last_error: String,
    #[serde(default)] retry_after_at: Option<String>,
    #[serde(default)] charged_credit_usd: Option<f64>,
    #[serde(default)] spent_credit_usd: f64,
    #[serde(default)] synced_balance_usd: Option<f64>,
    #[serde(default)] admin_api_key: String,
    #[serde(default)] team_id: String,
    #[serde(default)] credit_exhausted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMultiLlmStore {
    #[serde(default = "default_active_text_provider")] active_text_provider: String,
    #[serde(default)] claude: StoredLlmProviderEntry,
    #[serde(default)] openai: StoredLlmProviderEntry,
    #[serde(default)] grok: StoredLlmProviderEntry,
}

fn default_active_text_provider() -> String { "gemini".to_string() }

impl Default for StoredMultiLlmStore {
    fn default() -> Self {
        Self {
            active_text_provider: default_active_text_provider(),
            claude: StoredLlmProviderEntry { model_name: "claude-haiku-4-5".to_string(), charged_credit_usd: Some(5.0), ..Default::default() },
            openai: StoredLlmProviderEntry { model_name: "gpt-4o-mini".to_string(), charged_credit_usd: Some(0.0), ..Default::default() },
            grok: StoredLlmProviderEntry { model_name: "grok-3-mini".to_string(), charged_credit_usd: Some(5.0), ..Default::default() },
        }
    }
}

pub(crate) fn is_credit_exhaustion_error(err_msg: &str) -> bool {
    let lower = err_msg.to_lowercase();
    lower.contains("no credits remaining") || lower.contains("no credits") || lower.contains("insufficient_quota")
        || lower.contains("exceeded your current quota") || lower.contains("credit balance is too low")
        || lower.contains("credit balance") || lower.contains("exhausted") || lower.contains("out of credits")
        || lower.contains("billing") || lower.contains("prepaid") || lower.contains("spending limit")
        || lower.contains("status code 402") || lower.contains("status code 429") || lower.contains("429 too many requests")
}

/// 모델별 입력/출력 토큰 단가(USD per 1M tokens) 기반 사용 금액($) 추정
pub(crate) fn estimate_provider_cost_usd(provider: &str, model: &str, input_tokens: i64, output_tokens: i64) -> f64 {
    let (in_tok, out_tok) = if output_tokens <= 0 && input_tokens > 0 {
        ((input_tokens as f64) * 0.70, (input_tokens as f64) * 0.30)
    } else {
        (input_tokens.max(0) as f64, output_tokens.max(0) as f64)
    };
    let m = model.to_lowercase();
    let (in_per_m, out_per_m) = match provider {
        "claude" => if m.contains("haiku") { (1.00, 5.00) } else { (3.00, 15.00) },
        "grok" => if m.contains("mini") { (0.30, 0.50) } else { (3.00, 15.00) },
        "openai" => if m.contains("mini") { (0.15, 0.60) } else { (2.50, 10.00) },
        _ => (0.50, 1.50),
    };
    (in_tok * in_per_m + out_tok * out_per_m) / 1_000_000.0
}

fn is_retry_lock_still_active(retry_after_at: Option<&str>) -> bool {
    let Some(raw) = retry_after_at else { return false; };
    let trimmed = raw.trim();
    if trimmed.is_empty() { return false; }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%d %H:%M:%S") {
        return chrono::Local::now().naive_local() < dt;
    }
    false
}

fn read_multi_llm_store_unlocked() -> StoredMultiLlmStore {
    let path = resolve_local_appdata_multi_llm_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(mut parsed) = serde_json::from_str::<StoredMultiLlmStore>(&raw) {
            let mut mutated = false;
            if parsed.claude.model_name.trim().is_empty() || parsed.claude.model_name.trim() == "claude-haiku-5-5" {
                parsed.claude.model_name = "claude-haiku-4-5".to_string(); mutated = true;
            }
            if parsed.openai.model_name.trim().is_empty() { parsed.openai.model_name = "gpt-4o-mini".to_string(); mutated = true; }
            if parsed.grok.model_name.trim().is_empty() { parsed.grok.model_name = "grok-3-mini".to_string(); mutated = true; }
            if parsed.claude.charged_credit_usd.is_none() { parsed.claude.charged_credit_usd = Some(5.0); mutated = true; }
            if parsed.grok.charged_credit_usd.is_none() { parsed.grok.charged_credit_usd = Some(5.0); mutated = true; }
            if parsed.openai.charged_credit_usd.is_none() { parsed.openai.charged_credit_usd = Some(0.0); mutated = true; }
            if !["gemini", "claude", "openai", "grok"].contains(&parsed.active_text_provider.as_str()) {
                parsed.active_text_provider = "gemini".to_string(); mutated = true;
            }
            for (prov, entry) in [("claude", &mut parsed.claude), ("openai", &mut parsed.openai), ("grok", &mut parsed.grok)] {
                if entry.retry_after_at.is_some() {
                    entry.retry_after_at = None;
                    if entry.verified_at.contains(" · 5시간 대기") {
                        entry.verified_at = entry.verified_at.replace(" · 5시간 대기", "");
                    }
                    mutated = true;
                }
                if !entry.last_error.is_empty() && is_credit_exhaustion_error(&entry.last_error) && !entry.credit_exhausted {
                    entry.credit_exhausted = true;
                    entry.synced_balance_usd = Some(0.0);
                    mutated = true;
                }
                if entry.spent_credit_usd <= 0.0 && entry.total_used_tokens > 0 {
                    entry.spent_credit_usd = estimate_provider_cost_usd(prov, &entry.model_name, entry.total_used_tokens, 0);
                    mutated = true;
                }
            }
            if mutated {
                if let Ok(json_str) = serde_json::to_string_pretty(&parsed) { let _ = fs::write(&path, json_str); }
            }
            return parsed;
        }
    }
    StoredMultiLlmStore::default()
}

fn read_multi_llm_store() -> StoredMultiLlmStore {
    let _g = MULTI_LLM_STORE_LOCK.lock().ok();
    read_multi_llm_store_unlocked()
}

fn write_multi_llm_store_unlocked(store: &StoredMultiLlmStore) -> Result<(), String> {
    let path = resolve_local_appdata_multi_llm_path();
    let json_str = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&path, json_str).map_err(|e| format!("멀티 LLM 설정 저장 실패: {}", e))
}

fn write_multi_llm_store(store: &StoredMultiLlmStore) -> Result<(), String> {
    let _g = MULTI_LLM_STORE_LOCK.lock().ok();
    write_multi_llm_store_unlocked(store)
}

fn entry_to_status(provider: &str, display_name: &str, default_model: &str, default_charged_usd: f64, entry: &StoredLlmProviderEntry) -> LlmProviderConfigStatus {
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let (today_tok, today_req) = if entry.today_date == today_str { (entry.today_used_tokens, entry.today_request_count) } else { (0, 0) };
    let model = if entry.model_name.trim().is_empty() { default_model.to_string() } else { entry.model_name.trim().to_string() };
    let charged_usd = entry.charged_credit_usd.unwrap_or(default_charged_usd);
    let exhausted = entry.credit_exhausted || (!entry.last_error.is_empty() && is_credit_exhaustion_error(&entry.last_error));
    let (remaining_usd, balance_source) = if exhausted {
        (0.0, "exhausted".to_string())
    } else if let Some(synced) = entry.synced_balance_usd {
        (synced.max(0.0), if provider == "grok" { "management_api" } else { "admin_api" }.to_string())
    } else {
        ((charged_usd - entry.spent_credit_usd).max(0.0), "token_ledger".to_string())
    };
    let is_zero_credit = exhausted || remaining_usd <= 0.0001;
    let credit_display_text = if is_zero_credit { "0$".to_string() } else { format!("{:.2}$", remaining_usd) };
    LlmProviderConfigStatus {
        provider: provider.to_string(),
        display_name: display_name.to_string(),
        has_key: !entry.api_key.trim().is_empty(),
        masked_key: mask_gemini_api_key(&entry.api_key),
        model_name: model,
        verified_at: entry.verified_at.clone(),
        today_used_tokens: today_tok,
        total_used_tokens: entry.total_used_tokens,
        today_request_count: today_req,
        last_error: entry.last_error.clone(),
        retry_after_at: None,
        charged_credit_usd: charged_usd,
        spent_credit_usd: entry.spent_credit_usd,
        remaining_credit_usd: remaining_usd,
        credit_display_text,
        credit_exhausted: is_zero_credit,
        has_admin_key: !entry.admin_api_key.trim().is_empty(),
        masked_admin_key: mask_gemini_api_key(&entry.admin_api_key),
        team_id: entry.team_id.clone(),
        balance_source,
    }
}

pub(crate) fn build_multi_llm_providers_status() -> MultiLlmProvidersStatus {
    let store = read_multi_llm_store();
    let storage_location = resolve_local_appdata_multi_llm_path().to_string_lossy().to_string();
    MultiLlmProvidersStatus {
        active_text_provider: store.active_text_provider.clone(),
        storage_location,
        claude: entry_to_status("claude", "Anthropic Claude", "claude-haiku-4-5", 5.0, &store.claude),
        openai: entry_to_status("openai", "OpenAI GPT", "gpt-4o-mini", 0.0, &store.openai),
        grok: entry_to_status("grok", "xAI Grok", "grok-3-mini", 5.0, &store.grok),
    }
}

fn record_provider_usage(provider: &str, in_tokens: i64, out_tokens: i64, active_model_opt: Option<&str>, err_opt: Option<&str>) {
    let _g = MULTI_LLM_STORE_LOCK.lock().ok();
    let mut store = read_multi_llm_store_unlocked();
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let entry = match provider {
        "claude" => &mut store.claude,
        "openai" => &mut store.openai,
        "grok" => &mut store.grok,
        _ => return,
    };

    if entry.today_date != today_str && !is_retry_lock_still_active(entry.retry_after_at.as_deref()) {
        entry.today_date = today_str;
        entry.today_used_tokens = 0;
        entry.today_request_count = 0;
    }

    if let Some(m) = active_model_opt {
        let clean_m = m.trim();
        if !clean_m.is_empty() && entry.model_name != clean_m {
            entry.model_name = clean_m.to_string();
        }
    }

    if let Some(err_msg) = err_opt {
        entry.last_error = err_msg.to_string();
        entry.retry_after_at = None;
        if is_credit_exhaustion_error(err_msg) {
            entry.credit_exhausted = true;
            entry.synced_balance_usd = Some(0.0);
        }
    } else {
        let used_tokens = (in_tokens + out_tokens).max(0);
        let cost_usd = estimate_provider_cost_usd(provider, &entry.model_name, in_tokens, out_tokens);
        entry.today_used_tokens += used_tokens;
        entry.total_used_tokens += used_tokens;
        entry.today_request_count += 1;
        entry.spent_credit_usd += cost_usd;
        let charged = entry.charged_credit_usd.unwrap_or(if provider == "openai" { 0.0 } else { 5.0 });
        if let Some(bal) = entry.synced_balance_usd {
            let next_bal = (bal - cost_usd).max(0.0);
            entry.synced_balance_usd = Some(next_bal);
            entry.credit_exhausted = next_bal <= 0.0001;
        } else {
            let rem = (charged - entry.spent_credit_usd).max(0.0);
            entry.credit_exhausted = rem <= 0.0001;
        }
        entry.last_error.clear();
        entry.retry_after_at = None;
    }
    let _ = write_multi_llm_store_unlocked(&store);
}

pub(crate) static NEXT_AGENT_RR_INDEX: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// 현재 API 키가 등록되어 있고 크레딧 잔액/토큰이 남아 있으며 5시간 대기 락(`retry_after`)이 걸려 있지 않은
/// 가용 에이전트 목록을 `["gemini", "claude", "grok", "openai"]` 순서로 반환합니다.
pub(crate) fn get_unlocked_available_agents(conn: &Connection) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let now_ms = chrono::Local::now().timestamp_millis();
    let daily_limit = read_ai_daily_token_limit(Some(conn));

    let (gemini_key, _) = read_local_gemini_api_key();
    let gemini_db_retry_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
    let (gemini_today_tok, _, _, _) = read_gemini_token_usage_with_lock(gemini_db_retry_ms > now_ms);
    if !gemini_key.trim().is_empty() && gemini_db_retry_ms <= now_ms && gemini_today_tok < daily_limit {
        out.push("gemini".to_string());
    }

    let store = read_multi_llm_store();
    for (prov, default_charged, entry) in [
        ("claude", 5.0, &store.claude),
        ("grok", 5.0, &store.grok),
        ("openai", 0.0, &store.openai),
    ] {
        let charged = entry.charged_credit_usd.unwrap_or(default_charged);
        let rem_usd = entry
            .synced_balance_usd
            .unwrap_or_else(|| (charged - entry.spent_credit_usd).max(0.0));
        let exhausted = entry.credit_exhausted
            || rem_usd <= 0.0001
            || (!entry.last_error.is_empty() && is_credit_exhaustion_error(&entry.last_error));
        if !entry.api_key.trim().is_empty() && !exhausted {
            out.push(prov.to_string());
        }
    }
    out
}

/// 병렬 워커 스레드에서 특정 에이전트(`agent_id`)가 현재 시점에 계속 작업을 가져갈 수 있는지(토큰/크레딧 여유 확인) 판별합니다.
pub(crate) fn is_agent_currently_usable(conn: &Connection, agent_id: &str, force_now: bool) -> bool {
    if force_now {
        if agent_id == "gemini" {
            let (k, _) = read_local_gemini_api_key();
            return !k.trim().is_empty();
        }
        let store = read_multi_llm_store();
        let entry = match agent_id {
            "claude" => &store.claude,
            "grok" => &store.grok,
            "openai" => &store.openai,
            _ => return false,
        };
        return !entry.api_key.trim().is_empty() && !entry.credit_exhausted;
    }
    get_unlocked_available_agents(conn).iter().any(|a| a == agent_id)
}

/// 가용한 모든 에이전트에게 순차적(Round-Robin)으로 작업을 배분하기 위해 다음 담당 에이전트를 선택합니다.
pub(crate) fn pick_next_round_robin_agent(conn: &Connection) -> Option<String> {
    let available = get_unlocked_available_agents(conn);
    if available.is_empty() {
        return None;
    }
    let idx = NEXT_AGENT_RR_INDEX.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Some(available[idx % available.len()].clone())
}

/// 지정된 담당 에이전트(`preferred_provider`: `"claude"`, `"openai"`, `"grok"`)로
/// 통화/음성 녹음 전사본을 교정·요약하거나 반려 요구사항(`user_requirement`)을 반영합니다.
/// - `preferred_provider`가 `Some(prov)`이면 해당 에이전트 전담 워커이므로 오직 `prov`만 호출하고 실패 시 `None`을 반환합니다(큐 재투입 후 다른 병렬 에이전트가 가져가도록).
pub(crate) fn run_text_agent_call_script_revision_or_refinement(
    preferred_provider: Option<&str>,
    raw_transcript: &str,
    contact_label: &str,
    combined_profile: &str,
    call_prompt_tpl: &str,
    user_requirement: Option<&str>,
) -> Option<(String, String)> {
    if raw_transcript.trim().is_empty() {
        return None;
    }
    let store = read_multi_llm_store();
    let order: Vec<&str> = match preferred_provider {
        Some(pref) if ["claude", "openai", "grok"].contains(&pref) => vec![pref],
        _ => vec!["claude", "grok", "openai"],
    };

    let rendered_base = call_prompt_tpl.replace("{contact_name}", contact_label);
    let req_block = match user_requirement.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(req) => format!(
            "\n\n[🚨 사용자 반려/수정 지시사항 (최우선 반영 필수)]\n- {}\n위 반려 사유 및 지시사항을 반드시 반영하여 요약과 스크립트를 수정하세요.",
            req
        ),
        None => String::new(),
    };
    let refine_prompt = format!(
        "{}\n\n[👤 사용자 및 연락처 배경 정보]\n{}{}\n\n\
         [🎙️ 기존/1차 음성 전사 원문]\n{}\n\n\
         위 전사 원문을 바탕으로 타임스탬프(`[HH:MM:SS]`)와 화자(`나`, `{}`) 및 마크다운 섹션(`## 💡 요약`, `## 📜 스크립트`) 구조를 유지하면서 오탈자·인명 오인식을 교정하고 요약을 정밀하게 다듬어 출력해 주세요.",
        rendered_base, combined_profile, req_block, raw_transcript, contact_label
    );

    for prov in order {
        let entry = match prov {
            "claude" => &store.claude,
            "openai" => &store.openai,
            "grok" => &store.grok,
            _ => continue,
        };
        let key = entry.api_key.trim();
        if key.is_empty() || is_retry_lock_still_active(entry.retry_after_at.as_deref()) {
            continue;
        }
        let exhausted = entry.credit_exhausted
            || (!entry.last_error.is_empty() && is_credit_exhaustion_error(&entry.last_error));
        if exhausted {
            continue;
        }

        let api_res = match prov {
            "claude" => call_claude_messages_api(key, &entry.model_name, &refine_prompt, 2048),
            "openai" => {
                let cands = vec![entry.model_name.clone(), "gpt-4o-mini".to_string(), "gpt-4o".to_string()];
                call_openai_compatible_chat_api("OpenAI GPT", "https://api.openai.com/v1/chat/completions", key, &cands, &refine_prompt, 2048)
            }
            "grok" => {
                let cands = vec![entry.model_name.clone(), "grok-3-mini".to_string(), "grok-3-latest".to_string(), "grok-2-latest".to_string()];
                call_openai_compatible_chat_api("xAI Grok", "https://api.x.ai/v1/chat/completions", key, &cands, &refine_prompt, 2048)
            }
            _ => continue,
        };

        match api_res {
            Ok((refined_text, active_model, in_tok, out_tok)) => {
                let used_tok = (in_tok + out_tok).max(1);
                record_provider_usage(prov, in_tok.max(1), out_tok, Some(&active_model), None);
                let prov_tag = match prov {
                    "claude" => "Claude",
                    "openai" => "OpenAI",
                    "grok" => "Grok",
                    _ => prov,
                };
                log_gemini(
                    "INFO",
                    &format!(
                        "[MultiLLM] [{}] ({}) 통화 스크립트 교정·요약 완료 (소비 토큰: {})",
                        prov_tag, active_model, used_tok
                    ),
                );
                if refined_text.contains("## ") && refined_text.len() >= 30 {
                    return Some((refined_text, prov.to_string()));
                } else {
                    return Some((raw_transcript.to_string(), prov.to_string()));
                }
            }
            Err(err_msg) => {
                record_provider_usage(prov, 0, 0, None, Some(&err_msg));
                log_gemini(
                    "WARN",
                    &format!("[MultiLLM] {} 통화 분석 호출 실패: {}", prov.to_uppercase(), err_msg),
                );
            }
        }
    }

    None
}

/// 가용한 에이전트(Gemini · Claude · Grok · OpenAI) 중 하나로 일반 텍스트 프롬프트를 실행하고 `(응답텍스트, 공급자ID)`를 반환합니다.
pub(crate) fn call_any_text_llm(conn: &Connection, prompt: &str, max_tokens: u32) -> Option<(String, String)> {
    let mut available = get_unlocked_available_agents(conn);
    let (gk, _) = read_local_gemini_api_key();
    if !gk.trim().is_empty() && !available.iter().any(|a| a == "gemini") {
        available.insert(0, "gemini".to_string());
    }
    let store = read_multi_llm_store();
    for prov in available {
        if prov == "gemini" {
            let (gk, _) = read_local_gemini_api_key();
            if !gk.trim().is_empty() {
                let req = serde_json::json!({ "contents": [{ "parts": [{ "text": prompt }] }] });
                if let Ok(txt) = call_gemini_generate_content_ext(&gk, &req, true) {
                    if !txt.trim().is_empty() {
                        clear_gemini_quota_exhaustion(conn);
                        return Some((txt.trim().to_string(), "gemini".to_string()));
                    }
                }
            }
        } else {
            let entry = match prov.as_str() { "claude" => &store.claude, "grok" => &store.grok, "openai" => &store.openai, _ => continue };
            let res = match prov.as_str() {
                "claude" => call_claude_messages_api(entry.api_key.trim(), &entry.model_name, prompt, max_tokens),
                "grok" => call_openai_compatible_chat_api("xAI Grok", "https://api.x.ai/v1/chat/completions", entry.api_key.trim(), &[entry.model_name.clone(), "grok-3-mini".to_string()], prompt, max_tokens),
                "openai" => call_openai_compatible_chat_api("OpenAI GPT", "https://api.openai.com/v1/chat/completions", entry.api_key.trim(), &[entry.model_name.clone(), "gpt-4o-mini".to_string()], prompt, max_tokens),
                _ => continue,
            };
            if let Ok((txt, active_m, in_t, out_t)) = res {
                record_provider_usage(&prov, in_t.max(1), out_t, Some(&active_m), None);
                if !txt.trim().is_empty() {
                    return Some((txt.trim().to_string(), prov));
                }
            }
        }
    }
    None
}

/// Anthropic `/v1/models` 조회를 통해 API 키 유효성 확인 및 계정에서 사용 가능한 모델 목록 조회
fn discover_claude_models(api_key: &str) -> Result<Vec<String>, String> {
    let resp = GEMINI_HTTP_AGENT
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .call()
        .map_err(|e| format!("Claude 모델 목록 조회 HTTP 오류: {}", e))?;
    let resp_str = resp.into_body().read_to_string().map_err(|e| format!("Claude 모델 응답 읽기 실패: {}", e))?;
    let jv: serde_json::Value = serde_json::from_str(&resp_str).map_err(|_| format!("Claude 모델 응답 파싱 실패: {}", resp_str))?;

    if let Some(err_obj) = jv.get("error") {
        let err_type = err_obj.get("type").and_then(|t| t.as_str()).unwrap_or("error");
        let msg = err_obj.get("message").and_then(|m| m.as_str()).unwrap_or(&resp_str);
        return Err(format!("[{}] {}", err_type, msg));
    }

    let mut models = Vec::new();
    if let Some(arr) = jv.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                let clean = id.trim();
                if !clean.is_empty() && !models.contains(&clean.to_string()) {
                    models.push(clean.to_string());
                }
            }
        }
    }
    Ok(models)
}

/// xAI Grok Management API (`GET https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance`)를 호출하여
/// 남은 선불 크레딧 잔액(USD)을 조회합니다.
pub(crate) fn fetch_grok_management_prepaid_balance(mgmt_key: &str, team_id: &str) -> Result<f64, String> {
    let clean_key = mgmt_key.trim();
    let clean_team = team_id.trim();
    if clean_key.is_empty() || clean_team.is_empty() {
        return Err("xAI Management API 키와 Team ID를 모두 입력해 주세요.".to_string());
    }
    let url = format!("https://management-api.x.ai/v1/billing/teams/{}/prepaid/balance", clean_team);
    let auth = format!("Bearer {}", clean_key);
    let resp = GEMINI_HTTP_AGENT.get(&url).header("Authorization", &auth).call().map_err(|e| format!("xAI Management API HTTP 오류: {}", e))?;
    let resp_str = resp.into_body().read_to_string().map_err(|e| format!("xAI Management API 응답 읽기 실패: {}", e))?;
    let jv: serde_json::Value = serde_json::from_str(&resp_str).map_err(|_| format!("xAI Management API 응답 파싱 실패: {}", resp_str))?;

    if let Some(err_msg) = jv.get("error").or_else(|| jv.get("message")) {
        return Err(format!("xAI Management API 오류: {}", err_msg.as_str().unwrap_or(&resp_str)));
    }

    if let Some(total_obj) = jv.get("total") {
        let cents_opt = total_obj
            .get("val")
            .and_then(|v| v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64()))
            .or_else(|| total_obj.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| total_obj.as_f64()));
        if let Some(cents) = cents_opt {
            let usd = if cents < 0.0 { (-cents) / 100.0 } else { cents / 100.0 };
            return Ok(usd.max(0.0));
        }
    }
    if let Some(bal) = jv.get("balance").or_else(|| jv.get("remaining_balance")) {
        if let Some(v) = bal.as_f64().or_else(|| bal.as_str().and_then(|s| s.parse::<f64>().ok())) {
            return Ok(v.abs());
        }
    }
    Err(format!("xAI 잔액 필드를 찾을 수 없습니다: {}", resp_str))
}

/// Anthropic Claude Admin API (`GET https://api.anthropic.com/v1/organizations/cost_report`)를 호출하여
/// 조직 누적 사용 금액(USD)을 조회합니다. (Admin 키: `sk-ant-admin-...`)
pub(crate) fn fetch_claude_admin_cost_report(admin_key: &str) -> Result<f64, String> {
    let clean_key = admin_key.trim();
    if clean_key.is_empty() {
        return Err("Anthropic Admin API 키(sk-ant-admin-...)를 입력해 주세요.".to_string());
    }
    let start_dt = (chrono::Utc::now() - chrono::Duration::days(30)).format("%Y-%m-%dT00:00:00Z").to_string();
    let url = format!("https://api.anthropic.com/v1/organizations/cost_report?starting_at={}&bucket_width=1d", start_dt);
    let resp = GEMINI_HTTP_AGENT
        .get(&url)
        .header("x-api-key", clean_key)
        .header("anthropic-version", "2023-06-01")
        .call()
        .map_err(|e| format!("Claude Admin API HTTP 오류: {}", e))?;
    let resp_str = resp.into_body().read_to_string().map_err(|e| format!("Claude Admin API 응답 읽기 실패: {}", e))?;
    let jv: serde_json::Value = serde_json::from_str(&resp_str).map_err(|_| format!("Claude Admin API 응답 파싱 실패: {}", resp_str))?;

    if let Some(err_obj) = jv.get("error") {
        let msg = err_obj.get("message").and_then(|m| m.as_str()).unwrap_or(&resp_str);
        return Err(format!("Claude Admin API 오류: {}", msg));
    }

    let mut total_spent_usd = 0.0f64;
    if let Some(buckets) = jv.get("data").and_then(|d| d.as_array()) {
        for b in buckets {
            if let Some(results) = b.get("results").and_then(|r| r.as_array()) {
                for item in results {
                    if let Some(amt) = item.get("amount").or_else(|| item.get("cost_usd")) {
                        if let Some(val) = amt.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| amt.as_f64()) {
                            total_spent_usd += if val > 50.0 { val / 100.0 } else { val };
                        }
                    }
                }
            }
        }
    }
    Ok(total_spent_usd.max(0.0))
}

#[derive(Debug)]
struct ProviderVerifyOutcome {
    active_model: String,
    in_tokens: i64,
    out_tokens: i64,
    quota_or_warning: Option<String>,
}

/// Anthropic Claude Messages API 호출 (`https://api.anthropic.com/v1/messages`)
pub(crate) fn call_claude_messages_api(
    api_key: &str,
    preferred_model: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<(String, String, i64, i64), String> {
    let mut candidates = Vec::new();
    let pref = preferred_model.trim();
    if !pref.is_empty() && pref != "claude-haiku-5-5" {
        candidates.push(pref.to_string());
    }
    for m in [
        "claude-haiku-4-5",
        "claude-sonnet-4-5",
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-0",
        "claude-3-7-sonnet-latest",
        "claude-3-5-haiku-latest",
    ] {
        if !m.is_empty() && !candidates.contains(&m.to_string()) {
            candidates.push(m.to_string());
        }
    }

    let mut last_err = String::new();
    for model in candidates {
        let req_body = serde_json::json!({
            "model": model,
            "max_tokens": max_tokens.max(16),
            "messages": [{ "role": "user", "content": user_prompt }]
        });
        let body_bytes = serde_json::to_vec(&req_body).map_err(|e| e.to_string())?;
        let resp = GEMINI_HTTP_AGENT
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key.trim())
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .send(&body_bytes)
            .map_err(|e| format!("Claude HTTP 오류: {}", e))?;
        let resp_str = resp.into_body().read_to_string().map_err(|e| format!("Claude 응답 읽기 실패: {}", e))?;
        let jv: serde_json::Value = serde_json::from_str(&resp_str).map_err(|_| format!("Claude 응답 파싱 실패: {}", resp_str))?;

        if let Some(err_obj) = jv.get("error") {
            let msg = err_obj.get("message").and_then(|m| m.as_str()).unwrap_or(&resp_str).to_string();
            last_err = format!("[{}] {}", model, msg);
            let lower = msg.to_lowercase();
            if lower.contains("authentication") || lower.contains("invalid x-api-key") || lower.contains("credit balance") {
                break;
            }
            continue;
        }

        let text = jv
            .get("content")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<&str>>()
                    .join("\n")
            })
            .unwrap_or_default();

        let (in_tok, out_tok) = jv
            .get("usage")
            .map(|u| {
                let i = u.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                let o = u.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                (i, o)
            })
            .unwrap_or((0, 0));

        return Ok((text.trim().to_string(), model, in_tok, out_tok));
    }

    Err(format!("Claude API 오류: {}", last_err))
}

/// OpenAI / xAI 호환 Chat Completions API 호출
pub(crate) fn call_openai_compatible_chat_api(
    provider_label: &str,
    endpoint_url: &str,
    api_key: &str,
    candidates: &[String],
    user_prompt: &str,
    max_tokens: u32,
) -> Result<(String, String, i64, i64), String> {
    let auth_header = format!("Bearer {}", api_key.trim());
    let mut last_err = String::new();

    for model in candidates {
        let req_body = serde_json::json!({
            "model": model,
            "max_tokens": max_tokens.max(16),
            "messages": [{ "role": "user", "content": user_prompt }]
        });
        let body_bytes = serde_json::to_vec(&req_body).map_err(|e| e.to_string())?;
        let resp = GEMINI_HTTP_AGENT
            .post(endpoint_url)
            .header("Authorization", &auth_header)
            .header("Content-Type", "application/json")
            .send(&body_bytes)
            .map_err(|e| format!("{} HTTP 오류: {}", provider_label, e))?;
        let resp_str = resp.into_body().read_to_string().map_err(|e| format!("{} 응답 읽기 실패: {}", provider_label, e))?;
        let jv: serde_json::Value = serde_json::from_str(&resp_str).map_err(|_| format!("{} 응답 파싱 실패: {}", provider_label, resp_str))?;

        if let Some(err_val) = jv.get("error") {
            let msg = if let Some(s) = err_val.as_str() {
                s.to_string()
            } else {
                err_val.get("message").and_then(|m| m.as_str()).unwrap_or(&resp_str).to_string()
            };
            last_err = format!("[{}] {}", model, msg);
            let lower = msg.to_lowercase();
            if lower.contains("invalid api key") || lower.contains("incorrect api key") || is_credit_exhaustion_error(&lower) {
                break;
            }
            continue;
        }

        let text = jv
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|first| first.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string();

        let (in_tok, out_tok) = jv
            .get("usage")
            .map(|u| {
                let p = u.get("prompt_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                let c = u.get("completion_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
                let t = u.get("total_tokens").and_then(|v| v.as_i64()).unwrap_or(p + c);
                if p + c > 0 { (p, (t - p).max(c)) } else { (t, 0) }
            })
            .unwrap_or((0, 0));

        return Ok((text.trim().to_string(), model.clone(), in_tok, out_tok));
    }

    Err(format!("{} API 오류: {}", provider_label, last_err))
}

fn validate_secret_key_format(provider: &str, key: &str) -> Result<(), String> {
    if key.contains("...") || key.contains("…") || key.contains("***") {
        return Err("화면 표시용으로 중간이 생략('...')된 마스킹 문자열입니다. [+ 키 생성 / + Create new secret key] 버튼을 눌러 새로 발급되는 전체 비밀 키를 복사해 주세요.".to_string());
    }
    if provider == "claude" && key.starts_with("apikey_") {
        return Err("입력하신 'apikey_...'는 Claude 콘솔의 '키 ID(식별자)'입니다. 콘솔 우측 상단 [+ 키 생성] 버튼을 눌러 새로 생성되는 'sk-ant-...' 전체 비밀 키를 복사해 주세요.".to_string());
    }
    if provider == "openai" && key.starts_with("key_") {
        return Err("입력하신 'key_...'는 OpenAI 콘솔의 '키 ID(식별자)'입니다. [+ Create new secret key] 버튼을 눌러 새로 생성되는 'sk-...' 전체 비밀 키를 복사해 주세요.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_multi_llm_providers_status() -> Result<MultiLlmProvidersStatus, String> {
    Ok(build_multi_llm_providers_status())
}

#[tauri::command]
pub(crate) fn set_active_text_llm_provider(provider: String) -> Result<MultiLlmProvidersStatus, String> {
    let clean = provider.trim().to_lowercase();
    if !["gemini", "claude", "openai", "grok"].contains(&clean.as_str()) {
        return Err(format!("지원하지 않는 LLM 공급자입니다: {}", provider));
    }
    let mut store = read_multi_llm_store();
    store.active_text_provider = clean.clone();
    write_multi_llm_store(&store)?;
    log_gemini("INFO", &format!("[MultiLLM] 기본 텍스트 분석 LLM 공급자 변경: {}", clean));
    Ok(build_multi_llm_providers_status())
}

/// 각 LLM 공급자의 충전 크레딧($) 설정 및 Grok Management API / Claude Admin API 기반 실시간 잔액 동기화
#[tauri::command]
pub(crate) async fn save_llm_provider_billing_config(
    provider: String,
    charged_credit_usd: Option<f64>,
    admin_api_key: Option<String>,
    team_id: Option<String>,
) -> Result<MultiLlmProvidersStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean_prov = provider.trim().to_lowercase();
        if !["claude", "openai", "grok"].contains(&clean_prov.as_str()) {
            return Err(format!("지원하지 않는 LLM 공급자입니다: {}", provider));
        }
        let mut store = read_multi_llm_store();
        let entry = match clean_prov.as_str() {
            "claude" => &mut store.claude,
            "openai" => &mut store.openai,
            "grok" => &mut store.grok,
            _ => unreachable!(),
        };

        if let Some(charged) = charged_credit_usd {
            entry.charged_credit_usd = Some(charged.max(0.0));
            if charged > 0.0 {
                entry.credit_exhausted = false;
                if is_credit_exhaustion_error(&entry.last_error) {
                    entry.last_error.clear();
                }
            } else {
                entry.credit_exhausted = true;
                entry.synced_balance_usd = Some(0.0);
            }
        }
        if let Some(ak) = admin_api_key {
            let trimmed = ak.trim();
            if trimmed == "__DELETE__" {
                entry.admin_api_key.clear();
                entry.synced_balance_usd = None;
            } else if !trimmed.is_empty() {
                entry.admin_api_key = trimmed.to_string();
            }
        }
        if let Some(tid) = team_id {
            entry.team_id = tid.trim().to_string();
        }

        if clean_prov == "grok" && !entry.admin_api_key.is_empty() && !entry.team_id.is_empty() {
            match fetch_grok_management_prepaid_balance(&entry.admin_api_key, &entry.team_id) {
                Ok(rem_usd) => {
                    entry.synced_balance_usd = Some(rem_usd);
                    entry.credit_exhausted = rem_usd <= 0.0;
                    log_gemini("INFO", &format!("[MultiLLM] Grok Management API 잔액 조회 성공: {:.2}$", rem_usd));
                }
                Err(e) => {
                    write_multi_llm_store(&store)?;
                    return Err(e);
                }
            }
        } else if clean_prov == "claude" && !entry.admin_api_key.is_empty() {
            match fetch_claude_admin_cost_report(&entry.admin_api_key) {
                Ok(spent_usd) => {
                    let charged = entry.charged_credit_usd.unwrap_or(5.0);
                    let rem_usd = (charged - spent_usd).max(0.0);
                    entry.spent_credit_usd = spent_usd;
                    entry.synced_balance_usd = Some(rem_usd);
                    entry.credit_exhausted = rem_usd <= 0.0;
                    log_gemini("INFO", &format!("[MultiLLM] Claude Admin API 비용 조회 성공 (누적 소비: {:.2}$, 잔액: {:.2}$)", spent_usd, rem_usd));
                }
                Err(e) => {
                    write_multi_llm_store(&store)?;
                    return Err(e);
                }
            }
        }

        write_multi_llm_store(&store)?;
        Ok(build_multi_llm_providers_status())
    })
    .await
    .map_err(|e| format!("멀티 LLM 잔액 동기화 스레드 오류: {}", e))?
}

#[tauri::command]
pub(crate) async fn save_and_verify_llm_provider_key(
    provider: String,
    api_key: String,
    model_name: Option<String>,
) -> Result<MultiLlmProvidersStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean_prov = provider.trim().to_lowercase();
        if !["claude", "openai", "grok"].contains(&clean_prov.as_str()) {
            return Err(format!("지원하지 않는 LLM 공급자입니다: {}", provider));
        }

        let input_key = api_key.trim().to_string();
        let mut store = read_multi_llm_store();

        if input_key == "__DELETE__" {
            let entry = match clean_prov.as_str() {
                "claude" => &mut store.claude,
                "openai" => &mut store.openai,
                "grok" => &mut store.grok,
                _ => unreachable!(),
            };
            entry.api_key.clear();
            entry.verified_at.clear();
            entry.last_error.clear();
            entry.retry_after_at = None;
            write_multi_llm_store(&store)?;
            log_gemini("INFO", &format!("[MultiLLM] {} API 키 삭제 완료", clean_prov.to_uppercase()));
            return Ok(build_multi_llm_providers_status());
        }

        let existing_key = match clean_prov.as_str() {
            "claude" => store.claude.api_key.trim().to_string(),
            "openai" => store.openai.api_key.trim().to_string(),
            "grok" => store.grok.api_key.trim().to_string(),
            _ => String::new(),
        };

        let trimmed_key = if input_key.is_empty() {
            if !existing_key.is_empty() {
                existing_key
            } else {
                return Err(format!("{} API 키를 입력해 주세요.", clean_prov.to_uppercase()));
            }
        } else {
            validate_secret_key_format(&clean_prov, &input_key)?;
            input_key
        };

        let req_model = model_name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

        let outcome_res: Result<ProviderVerifyOutcome, String> = match clean_prov.as_str() {
            "claude" => {
                let pref = req_model.clone().unwrap_or_else(|| store.claude.model_name.clone());
                let discovered = discover_claude_models(&trimmed_key).ok();
                match call_claude_messages_api(&trimmed_key, &pref, "Reply with OK", 16) {
                    Ok((_reply, active_model, in_tok, out_tok)) => Ok(ProviderVerifyOutcome {
                        active_model,
                        in_tokens: in_tok,
                        out_tokens: out_tok,
                        quota_or_warning: None,
                    }),
                    Err(err_msg) => {
                        let lower = err_msg.to_lowercase();
                        if is_credit_exhaustion_error(&lower) || lower.contains("rate_limit") || lower.contains("overloaded") {
                            let chosen = discovered.and_then(|v| v.into_iter().next()).unwrap_or(pref);
                            Ok(ProviderVerifyOutcome { active_model: chosen, in_tokens: 0, out_tokens: 0, quota_or_warning: Some(err_msg) })
                        } else if !lower.contains("invalid x-api-key") && !lower.contains("authentication") && (discovered.is_some() || lower.contains("model:")) {
                            let chosen = discovered.and_then(|v| v.into_iter().next()).unwrap_or(pref);
                            Ok(ProviderVerifyOutcome { active_model: chosen, in_tokens: 0, out_tokens: 0, quota_or_warning: None })
                        } else {
                            Err(err_msg)
                        }
                    }
                }
            }
            "openai" => {
                let pref = req_model.clone().unwrap_or_else(|| store.openai.model_name.clone());
                let mut cands = Vec::new();
                for m in [pref.as_str(), "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] {
                    if !m.is_empty() && !cands.contains(&m.to_string()) {
                        cands.push(m.to_string());
                    }
                }
                match call_openai_compatible_chat_api("OpenAI GPT", "https://api.openai.com/v1/chat/completions", &trimmed_key, &cands, "Reply with OK", 16) {
                    Ok((_reply, active_model, in_tok, out_tok)) => Ok(ProviderVerifyOutcome { active_model, in_tokens: in_tok, out_tokens: out_tok, quota_or_warning: None }),
                    Err(err_msg) => {
                        let lower = err_msg.to_lowercase();
                        if is_credit_exhaustion_error(&lower) || lower.contains("rate_limit") {
                            Ok(ProviderVerifyOutcome { active_model: pref, in_tokens: 0, out_tokens: 0, quota_or_warning: Some(err_msg) })
                        } else {
                            Err(err_msg)
                        }
                    }
                }
            }
            "grok" => {
                let pref = req_model.clone().unwrap_or_else(|| store.grok.model_name.clone());
                let mut cands = Vec::new();
                for m in [pref.as_str(), "grok-3-mini", "grok-3-latest", "grok-2-latest", "grok-beta"] {
                    if !m.is_empty() && !cands.contains(&m.to_string()) {
                        cands.push(m.to_string());
                    }
                }
                match call_openai_compatible_chat_api("xAI Grok", "https://api.x.ai/v1/chat/completions", &trimmed_key, &cands, "Reply with OK", 16) {
                    Ok((_reply, active_model, in_tok, out_tok)) => Ok(ProviderVerifyOutcome { active_model, in_tokens: in_tok, out_tokens: out_tok, quota_or_warning: None }),
                    Err(err_msg) => {
                        let lower = err_msg.to_lowercase();
                        if is_credit_exhaustion_error(&lower) || lower.contains("rate_limit") {
                            Ok(ProviderVerifyOutcome { active_model: pref, in_tokens: 0, out_tokens: 0, quota_or_warning: Some(err_msg) })
                        } else {
                            Err(err_msg)
                        }
                    }
                }
            }
            _ => unreachable!(),
        };

        match outcome_res {
            Ok(outcome) => {
                let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
                let entry = match clean_prov.as_str() {
                    "claude" => &mut store.claude, "openai" => &mut store.openai, "grok" => &mut store.grok, _ => unreachable!(),
                };
                entry.api_key = trimmed_key;
                entry.model_name = outcome.active_model.clone();
                if entry.today_date != today_str { entry.today_date = today_str; entry.today_used_tokens = 0; entry.today_request_count = 0; }
                if let Some(warn_msg) = outcome.quota_or_warning {
                    entry.verified_at = format!("{} (키 등록됨)", now_str);
                    entry.last_error = warn_msg.clone();
                    entry.retry_after_at = None;
                    if is_credit_exhaustion_error(&warn_msg) { entry.credit_exhausted = true; entry.synced_balance_usd = Some(0.0); }
                    write_multi_llm_store(&store)?;
                    log_gemini("WARN", &format!("[MultiLLM] {} API 키 등록 완료 (크레딧 부족 감지 → 0$ 표시: {})", clean_prov.to_uppercase(), warn_msg));
                } else {
                    let used_tokens = (outcome.in_tokens + outcome.out_tokens).max(0);
                    let cost_usd = estimate_provider_cost_usd(&clean_prov, &outcome.active_model, outcome.in_tokens, outcome.out_tokens);
                    entry.verified_at = now_str; entry.last_error.clear(); entry.retry_after_at = None; entry.credit_exhausted = false;
                    entry.today_used_tokens += used_tokens; entry.total_used_tokens += used_tokens; entry.today_request_count += 1; entry.spent_credit_usd += cost_usd;
                    if let Some(bal) = entry.synced_balance_usd { entry.synced_balance_usd = Some((bal - cost_usd).max(0.0)); }
                    write_multi_llm_store(&store)?;
                    log_gemini("INFO", &format!("[MultiLLM] {} API 키 검증 및 연동 성공 (모델: {}, 소비 토큰: {})", clean_prov.to_uppercase(), outcome.active_model, used_tokens));
                }
                Ok(build_multi_llm_providers_status())
            }
            Err(err_msg) => {
                record_provider_usage(&clean_prov, 0, 0, None, Some(&err_msg));
                log_gemini("WARN", &format!("[MultiLLM] {} API 키 검증 실패: {}", clean_prov.to_uppercase(), err_msg));
                Err(err_msg)
            }
        }
    }).await.map_err(|e| format!("멀티 LLM 검증 스레드 오류: {}", e))?
}
