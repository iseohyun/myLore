//! Gemini LLM 연동(통화/음성 녹음 스크립트화) 및 통계·결재 조회.

use crate::*;

mod client;
mod multi_llm;
mod transcription;

pub(crate) use client::*;
pub(crate) use multi_llm::*;
pub(crate) use transcription::*;

#[tauri::command]
pub(crate) fn get_call_ai_transcription_stats(
    state: State<'_, AppState>,
) -> Result<CallAiTranscriptionStats, String> {
    use chrono::{Datelike, Duration, Local, Weekday};

    let conn = open_db(&state.db_path)?;
    let calls_dir = get_archive_mobile_dir(&conn, "calls");
    let audio_dir = calls_dir.join("audio");

    let mut meta_map: HashMap<String, (u8, String)> = HashMap::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT safe_stem, stage, updated_at FROM call_transcript_meta")
    {
        if let Ok(iter) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2).unwrap_or_default(),
            ))
        }) {
            for (stem_k, st_i, upd) in iter.flatten() {
                meta_map.insert(stem_k, (st_i.clamp(1, 4) as u8, upd));
            }
        }
    }

    let mut total_audio_calls = 0usize;
    let mut completed_calls = 0usize;
    let mut remaining_calls = 0usize;
    let mut total_audio_bytes = 0u64;
    let mut completed_audio_bytes = 0u64;
    let mut remaining_audio_bytes = 0u64;
    let mut stem_file_bytes_map: HashMap<String, u64> = HashMap::new();
    let mut completed_stems_with_date_and_prov: HashMap<String, (String, &'static str)> = HashMap::new();

    if let Ok(entries) = fs::read_dir(&audio_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                continue;
            }
            let file_stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if file_stem.is_empty() || is_voice_memo_or_watch_recording(&file_stem, "calls", "").0 {
                continue;
            }

            let safe_stem = sanitize_filename_stem(&file_stem);
            let file_bytes = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            stem_file_bytes_map.insert(safe_stem.clone(), file_bytes);
            total_audio_calls += 1;
            total_audio_bytes = total_audio_bytes.saturating_add(file_bytes);

            let mut is_completed = false;
            let mut fallback_date = String::new();
            let mut md_prov: &'static str = "gemini";

            let md_path = calls_dir.join(format!("{}.md", safe_stem));
            if md_path.exists() {
                if let Ok(md_raw) = fs::read_to_string(&md_path) {
                    let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
                    if let Some(p_str) = fm.get("llm_provider") {
                        md_prov = match p_str.trim().to_lowercase().as_str() {
                            "claude" => "claude",
                            "openai" | "gpt" => "openai",
                            "grok" => "grok",
                            _ => "gemini",
                        };
                    }
                    let status = fm
                        .get("transcript_status")
                        .map(|s| s.as_str())
                        .unwrap_or("");
                    if status == "completed" || status == "unverified" || status == "verified" {
                        is_completed = true;
                        if let Some(ls) = fm.get("last_synced") {
                            if ls.len() >= 10 {
                                fallback_date = ls[..10].to_string();
                            }
                        }
                    }
                }
            }

            if let Some((st, upd)) = meta_map.get(&safe_stem) {
                if *st == 2 || *st == 4 {
                    is_completed = true;
                    if upd.len() >= 10 {
                        fallback_date = upd[..10].to_string();
                    }
                } else {
                    is_completed = false;
                }
            }

            if is_completed {
                completed_calls += 1;
                completed_audio_bytes = completed_audio_bytes.saturating_add(file_bytes);
                completed_stems_with_date_and_prov.insert(safe_stem, (fallback_date, md_prov));
            } else {
                remaining_calls += 1;
                remaining_audio_bytes = remaining_audio_bytes.saturating_add(file_bytes);
            }
        }
    }

    let today = Local::now().date_naive();
    let mut last_7_days: Vec<(String, String, String)> = Vec::with_capacity(7);
    let mut per_day_stems: HashMap<String, HashMap<String, &'static str>> = HashMap::new();

    for offset in (0..=6).rev() {
        let d = today - Duration::days(offset);
        let date_str = d.format("%Y-%m-%d").to_string();
        let ymd_compact = d.format("%Y%m%d").to_string();
        let dow_kr = match d.weekday() {
            Weekday::Mon => "월",
            Weekday::Tue => "화",
            Weekday::Wed => "수",
            Weekday::Thu => "목",
            Weekday::Fri => "금",
            Weekday::Sat => "토",
            Weekday::Sun => "일",
        };
        let label = format!("{:02}-{:02}({})", d.month(), d.day(), dow_kr);
        per_day_stems.insert(date_str.clone(), HashMap::new());
        last_7_days.push((date_str, ymd_compact, label));
    }

    let log_dir = resolve_log_dir(Some(&conn));
    let mut logged_stems: HashSet<String> = HashSet::new();

    for (date_str, ymd_compact, _) in &last_7_days {
        let log_path = log_dir.join(format!("ai_{}.log", ymd_compact));
        let Ok(raw) = fs::read_to_string(&log_path) else {
            continue;
        };
        for line in raw.lines() {
            if let Some(end_idx) = line.find(" 스크립트 생성 완료") {
                let prefix = &line[..end_idx];
                let prefix_lower = prefix.to_lowercase();
                let provider_and_stem: Option<(&'static str, &str)> =
                    if let Some(idx) = prefix_lower.rfind("[claude] ") {
                        Some(("claude", prefix[idx + "[claude] ".len()..].trim()))
                    } else if let Some(idx) = prefix_lower.rfind("[openai] ") {
                        Some(("openai", prefix[idx + "[openai] ".len()..].trim()))
                    } else if let Some(idx) = prefix_lower.rfind("[gpt] ") {
                        Some(("openai", prefix[idx + "[gpt] ".len()..].trim()))
                    } else if let Some(idx) = prefix_lower.rfind("[grok] ") {
                        Some(("grok", prefix[idx + "[grok] ".len()..].trim()))
                    } else if let Some(idx) = prefix_lower.rfind("[gemini] ") {
                        Some(("gemini", prefix[idx + "[gemini] ".len()..].trim()))
                    } else {
                        None
                    };

                if let Some((prov_key, raw_stem)) = provider_and_stem {
                    if !raw_stem.is_empty()
                        && !is_voice_memo_or_watch_recording(raw_stem, "calls", "").0
                    {
                        let safe_stem = sanitize_filename_stem(raw_stem);
                        let final_prov = completed_stems_with_date_and_prov
                            .get(&safe_stem)
                            .map(|(_, p)| *p)
                            .filter(|p| *p != "gemini")
                            .unwrap_or(prov_key);
                        if let Some(day_map) = per_day_stems.get_mut(date_str) {
                            day_map.insert(safe_stem.clone(), final_prov);
                            logged_stems.insert(safe_stem);
                        }
                    }
                }
            }
        }
    }

    for (safe_stem, (fb_date, md_prov)) in completed_stems_with_date_and_prov {
        if !logged_stems.contains(&safe_stem) && !fb_date.is_empty() {
            if let Some(day_map) = per_day_stems.get_mut(&fb_date) {
                day_map.entry(safe_stem).or_insert(md_prov);
            }
        }
    }

    let daily_stats = last_7_days
        .into_iter()
        .map(|(date_str, _, label)| {
            let mut gemini_count = 0usize;
            let mut claude_count = 0usize;
            let mut openai_count = 0usize;
            let mut grok_count = 0usize;
            let mut gemini_bytes = 0u64;
            let mut claude_bytes = 0u64;
            let mut openai_bytes = 0u64;
            let mut grok_bytes = 0u64;
            if let Some(day_map) = per_day_stems.get(&date_str) {
                for (stem, &prov) in day_map.iter() {
                    let f_bytes = stem_file_bytes_map.get(stem).copied().unwrap_or(0);
                    match prov {
                        "claude" => {
                            claude_count += 1;
                            claude_bytes = claude_bytes.saturating_add(f_bytes);
                        }
                        "openai" => {
                            openai_count += 1;
                            openai_bytes = openai_bytes.saturating_add(f_bytes);
                        }
                        "grok" => {
                            grok_count += 1;
                            grok_bytes = grok_bytes.saturating_add(f_bytes);
                        }
                        _ => {
                            gemini_count += 1;
                            gemini_bytes = gemini_bytes.saturating_add(f_bytes);
                        }
                    }
                }
            }
            let count = gemini_count + claude_count + openai_count + grok_count;
            let total_bytes = gemini_bytes
                .saturating_add(claude_bytes)
                .saturating_add(openai_bytes)
                .saturating_add(grok_bytes);
            CallAiDailyStat {
                date: date_str,
                label,
                count,
                gemini_count,
                claude_count,
                openai_count,
                grok_count,
                total_bytes,
                gemini_bytes,
                claude_bytes,
                openai_bytes,
                grok_bytes,
            }
        })
        .collect();

    Ok(CallAiTranscriptionStats {
        total_audio_calls,
        completed_calls,
        remaining_calls,
        total_audio_bytes,
        completed_audio_bytes,
        remaining_audio_bytes,
        daily_stats,
    })
}

/// 결재창(`Ctrl+\``) 및 사이드바(`Ctrl+B`) 검토 리스트에서 사용할 통화/음성 녹음 스크립트 항목 목록 조회
#[tauri::command]
pub(crate) fn get_call_approval_items(
    state: State<'_, AppState>,
) -> Result<Vec<CallApprovalItem>, String> {
    let conn = open_db(&state.db_path)?;
    let contacts_map = load_mobile_contacts_map(&conn);
    let calls_dir = get_archive_mobile_dir(&conn, "calls");
    let audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(&conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");

    let mut meta_map: HashMap<String, (u8, String, String)> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT safe_stem, stage, user_requirement, updated_at FROM call_transcript_meta",
    ) {
        if let Ok(iter) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2).unwrap_or_default(),
                r.get::<_, String>(3).unwrap_or_default(),
            ))
        }) {
            for (stem_k, st_i, req_s, upd) in iter.flatten() {
                meta_map.insert(stem_k, (st_i.clamp(1, 4) as u8, req_s, upd));
            }
        }
    }

    let mut out: Vec<CallApprovalItem> = Vec::new();
    for (scan_audio_dir, scan_md_dir, is_voice_memo) in [
        (&audio_dir, &calls_dir, false),
        (&rec_audio_dir, &rec_dir, true),
    ] {
        let Ok(entries) = fs::read_dir(scan_audio_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                continue;
            }
            let file_name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let file_stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if file_stem.is_empty() {
                continue;
            }
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = scan_md_dir.join(format!("{}.md", safe_stem));
            if !md_path.exists() {
                continue;
            }
            let Ok(md_raw) = fs::read_to_string(&md_path) else {
                continue;
            };
            let (fm, body) = parse_frontmatter_and_body_simple(&md_raw);
            let status_str = fm
                .get("transcript_status")
                .map(|s| s.as_str())
                .unwrap_or("");
            let mut stage: u8 = match status_str {
                "unverified" | "completed" => 2,
                "needs_revision" => 3,
                "verified" => 4,
                _ => 1,
            };
            let mut user_req = fm.get("user_requirement").cloned().unwrap_or_default();
            let mut updated_at = fm.get("last_synced").cloned().unwrap_or_default();
            if let Some((m_stage, m_req, m_upd)) = meta_map.get(&safe_stem) {
                stage = *m_stage;
                if !m_req.trim().is_empty() {
                    user_req = m_req.clone();
                }
                if !m_upd.trim().is_empty() {
                    updated_at = m_upd.clone();
                }
            }
            // 결재창에서는 스크립트가 생성된 항목(2단계 결재 대기, 3단계 반려/재작성, 4단계 결재 완료)만 표시
            if stage < 2 {
                continue;
            }

            let llm_provider = fm
                .get("llm_provider")
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "gemini".to_string());

            let (contact_name, rec_date, rec_time) = if is_voice_memo {
                let (_, rec_src, r_d, r_t) =
                    parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                (rec_src, r_d, r_t)
            } else {
                parse_call_audio_filename_meta(&file_stem, &contacts_map)
            };

            let mut summary_lines: Vec<String> = Vec::new();
            let mut in_summary = false;
            for line in body.lines() {
                let tl = line.trim();
                if tl.starts_with("## 💡 요약") {
                    in_summary = true;
                    continue;
                }
                if in_summary {
                    if tl.starts_with("## ") {
                        break;
                    }
                    if !tl.is_empty() {
                        summary_lines.push(tl.trim_start_matches("- ").to_string());
                    }
                }
            }
            let summary_text = if summary_lines.is_empty() {
                body.lines()
                    .find(|l| !l.trim().is_empty() && !l.trim().starts_with('#') && !l.trim().starts_with('<'))
                    .unwrap_or("요약 없음")
                    .to_string()
            } else {
                summary_lines.join(" · ")
            };

            out.push(CallApprovalItem {
                safe_stem,
                file_stem,
                file_name,
                contact_name,
                rec_date,
                rec_time,
                stage,
                llm_provider,
                user_requirement: user_req,
                summary_text,
                script_markdown: body.trim().to_string(),
                md_path: md_path.to_string_lossy().to_string(),
                audio_path: p.to_string_lossy().to_string(),
                is_voice_memo,
                updated_at,
            });
        }
    }

    out.sort_by(|a, b| {
        b.rec_date
            .cmp(&a.rec_date)
            .then_with(|| b.rec_time.cmp(&a.rec_time))
            .then_with(|| b.safe_stem.cmp(&a.safe_stem))
    });

    Ok(out)
}

pub(crate) fn notify_main_process_ai_event(event_type: &str, message: &str) {
    use std::io::Write;
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let Ok(addr) = "127.0.0.1:18443".parse::<SocketAddr>() else {
        return;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) else {
        return;
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
    let body = serde_json::json!({
        "type": event_type,
        "message": message
    })
    .to_string();
    let req = format!(
        "POST /api/v1/internal/ai-event HTTP/1.1\r\nHost: 127.0.0.1:18443\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(req.as_bytes());
}

fn is_external_ai_worker_lock_alive(lock_file: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(lock_file) else {
        return false;
    };
    let mut parts = raw.trim().split(':');
    let pid: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ts_ms: i64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let now_ms = chrono::Local::now().timestamp_millis();
    if pid == 0 || (now_ms - ts_ms).abs() > 30 * 60 * 1000 {
        return false;
    }
    if pid == std::process::id() {
        return true;
    }
    if let Ok(meta) = fs::metadata(lock_file) {
        if let Ok(modified) = meta.modified() {
            if let Ok(elapsed) = modified.elapsed() {
                if elapsed.as_secs() < 180 {
                    return true;
                }
            }
        }
    }
    false
}

/// 메인 프로세스와 완전히 분리된 OS 독립 서브프로세스(`DETACHED_PROCESS | CREATE_NO_WINDOW`)로
/// AI 스크립팅 및 Queue 관리 프로세스를 기동합니다.
/// 메인 프로세스가 비정상 종료되거나 닫히더라도, 이 AI 워커 프로세스는 현재 큐의 작업들을 끝까지 완료한 후 스스로 종료됩니다.
pub(crate) fn spawn_detached_ai_queue_worker_if_needed(force_now: bool) -> bool {
    const DETACHED_PROCESS_FLAG: u32 = 0x00000008;
    let db_path = resolve_meta_db_path();
    let lock_file = db_path.with_file_name("ai_queue_worker.lock");
    if !force_now && is_external_ai_worker_lock_alive(&lock_file) {
        return false;
    }
    if !force_now {
        let Ok(conn) = open_db(&db_path) else {
            return false;
        };
        if !is_auto_call_transcription_enabled(&conn) {
            return false;
        }
        if get_unlocked_available_agents(&conn).is_empty() {
            return false;
        }
    }
    let Ok(exe_path) = std::env::current_exe() else {
        return false;
    };
    let mut cmd = Command::new(exe_path);
    cmd.arg("--ai-queue-worker");
    if force_now {
        cmd.arg("--force-now");
    }
    cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS_FLAG);
    cmd.spawn().is_ok()
}

/// 설정 > AI Queue 대시보드용: 독립 AI 큐 워커 프로세스 상태, 에이전트 슬롯 상태 및 대기열(Queue) 조회
#[tauri::command]
pub(crate) fn get_ai_queue_dashboard_status(
    state: State<'_, AppState>,
) -> Result<AiQueueDashboardPayload, String> {
    let conn = open_db(&state.db_path)?;
    let lock_file = state.db_path.with_file_name("ai_queue_worker.lock");
    let worker_running = is_external_ai_worker_lock_alive(&lock_file)
        || IS_TRANSCRIPTION_RUNNING.load(std::sync::atomic::Ordering::SeqCst);

    let mut worker_pid: u32 = 0;
    let mut worker_heartbeat_at = String::new();
    if let Ok(raw) = fs::read_to_string(&lock_file) {
        let mut parts = raw.trim().split(':');
        worker_pid = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        if let Some(ts_ms) = parts.next().and_then(|s| s.parse::<i64>().ok()) {
            let (d_str, t_str) = epoch_ms_to_local_date_time(ts_ms);
            worker_heartbeat_at = format!("{} {}", d_str, t_str);
        }
    }
    if worker_running && worker_pid == 0 {
        worker_pid = std::process::id();
    }

    let auto_transcription_enabled = is_auto_call_transcription_enabled(&conn);
    let unlocked_agents = get_unlocked_available_agents(&conn);
    let gemini_st = build_gemini_api_key_status_with_conn(Some(&conn));
    let multi_st = build_multi_llm_providers_status();

    let gemini_usable = unlocked_agents.iter().any(|a| a == "gemini");
    let gemini_quota_text = if !gemini_st.has_key {
        "미등록".to_string()
    } else if !gemini_st.retry_after_at.is_empty() && !gemini_usable {
        format!("타임리밋 ({})", gemini_st.retry_after_at)
    } else {
        let limit = read_ai_daily_token_limit(Some(&conn)).max(1) as f64;
        let rem_pct = ((1.0 - (gemini_st.today_used_tokens as f64 / limit)) * 100.0).clamp(0.0, 100.0);
        format!("{:.1}% 가용", rem_pct)
    };

    let mut agent_slots = vec![AiQueueAgentSlotStatus {
        provider: "gemini".to_string(),
        display_name: "Google Gemini (STT + 요약)".to_string(),
        is_usable: gemini_usable,
        status_label: if !gemini_st.has_key {
            "키 미등록".to_string()
        } else if gemini_usable {
            if worker_running { "워커 가동 중".to_string() } else { "대기 중 (가용)".to_string() }
        } else {
            "5시간 락 대기".to_string()
        },
        credit_or_quota_text: gemini_quota_text,
        today_request_count: gemini_st.today_request_count,
        today_used_tokens: gemini_st.today_used_tokens,
    }];

    for (prov_id, st) in [
        ("claude", &multi_st.claude),
        ("grok", &multi_st.grok),
        ("openai", &multi_st.openai),
    ] {
        let usable = unlocked_agents.iter().any(|a| a == prov_id);
        let status_label = if !st.has_key {
            "키 미등록".to_string()
        } else if st.credit_exhausted {
            "크레딧 소진 (0$)".to_string()
        } else if usable {
            if worker_running { "워커 가동 중".to_string() } else { "대기 중 (가용)".to_string() }
        } else {
            "대기 중".to_string()
        };
        agent_slots.push(AiQueueAgentSlotStatus {
            provider: prov_id.to_string(),
            display_name: format!("{} ({})", st.display_name, st.model_name),
            is_usable: usable,
            status_label,
            credit_or_quota_text: if !st.has_key {
                "미등록".to_string()
            } else {
                st.credit_display_text.clone()
            },
            today_request_count: st.today_request_count,
            today_used_tokens: st.today_used_tokens,
        });
    }

    let contacts_map = load_mobile_contacts_map(&conn);
    let calls_dir = get_archive_mobile_dir(&conn, "calls");
    let audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(&conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");

    let mut transcript_meta_map: HashMap<String, (u8, String)> = HashMap::new();
    if let Ok(mut tm_stmt) =
        conn.prepare("SELECT safe_stem, stage, user_requirement FROM call_transcript_meta")
    {
        if let Ok(iter) = tm_stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2).unwrap_or_default(),
            ))
        }) {
            for (stem_k, st_i, req_s) in iter.flatten() {
                transcript_meta_map.insert(stem_k, (st_i.clamp(1, 4) as u8, req_s));
            }
        }
    }

    let mut raw_pending: Vec<(String, String, String, String, String, u64, u8, bool, bool, String)> = Vec::new();
    for (scan_audio_dir, scan_md_dir, is_voice_memo) in [
        (&audio_dir, &calls_dir, false),
        (&rec_audio_dir, &rec_dir, true),
    ] {
        let Ok(entries) = fs::read_dir(scan_audio_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) {
                continue;
            }
            let file_name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let file_stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if file_stem.is_empty() {
                continue;
            }
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = scan_md_dir.join(format!("{}.md", safe_stem));
            let mut stage: u8 = 1;
            let mut user_req = String::new();

            if let Some((st, req_str)) = transcript_meta_map.get(&safe_stem) {
                if *st == 2 || *st == 4 {
                    continue;
                }
                stage = *st;
                user_req = req_str.clone();
            } else if md_path.exists() {
                if let Ok(md_raw) = fs::read_to_string(&md_path) {
                    let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
                    let status = fm.get("transcript_status").map(|s| s.as_str()).unwrap_or("");
                    if status == "completed" || status == "unverified" || status == "verified" {
                        continue;
                    }
                    if status == "needs_revision" {
                        stage = 3;
                    }
                    if let Some(r) = fm.get("user_requirement") {
                        user_req = r.clone();
                    }
                }
            }

            let file_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let has_existing_script = extract_existing_valid_script_body(&md_path).is_some();
            let (contact_name, rec_date, rec_time) = if is_voice_memo {
                let (_, rec_src, r_d, r_t) = parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                (rec_src, r_d, r_t)
            } else {
                parse_call_audio_filename_meta(&file_stem, &contacts_map)
            };

            raw_pending.push((
                safe_stem,
                file_name,
                contact_name,
                rec_date,
                rec_time,
                file_bytes,
                stage,
                is_voice_memo,
                has_existing_script,
                user_req,
            ));
        }
    }

    raw_pending.sort_by(|a, b| {
        b.3.cmp(&a.3)
            .then_with(|| b.4.cmp(&a.4))
            .then_with(|| b.0.cmp(&a.0))
    });

    let total_pending_count = raw_pending.len();
    let mut total_pending_bytes = 0u64;
    let mut stage1_pending_count = 0usize;
    let mut stage3_revision_count = 0usize;
    for item in &raw_pending {
        total_pending_bytes = total_pending_bytes.saturating_add(item.5);
        if item.6 == 3 {
            stage3_revision_count += 1;
        } else {
            stage1_pending_count += 1;
        }
    }

    let pending_items: Vec<AiQueuePendingItem> = raw_pending
        .into_iter()
        .take(200)
        .enumerate()
        .map(
            |(
                idx,
                (
                    safe_stem,
                    file_name,
                    contact_name,
                    rec_date,
                    rec_time,
                    file_bytes,
                    stage,
                    is_voice_memo,
                    has_existing_script,
                    user_requirement,
                ),
            )| AiQueuePendingItem {
                queue_order: idx + 1,
                safe_stem,
                file_name,
                contact_name,
                rec_date,
                rec_time,
                file_bytes,
                stage,
                is_voice_memo,
                has_existing_script,
                user_requirement,
            },
        )
        .collect();

    let today_ymd = chrono::Local::now().format("%Y%m%d").to_string();
    let log_path = resolve_log_dir(Some(&conn)).join(format!("ai_{}.log", today_ymd));
    let mut completed_today_count = 0usize;
    let mut recent_completed: Vec<AiQueueRecentCompletedItem> = Vec::new();
    if let Ok(raw_log) = fs::read_to_string(&log_path) {
        for line in raw_log.lines().rev() {
            if let Some(end_idx) = line.find(" 스크립트 생성 완료") {
                completed_today_count += 1;
                if recent_completed.len() < 40 {
                    let ts = line
                        .get(1..20)
                        .unwrap_or("")
                        .to_string();
                    let prefix = &line[..end_idx];
                    let prefix_lower = prefix.to_lowercase();
                    let (prov, stem) = if let Some(idx) = prefix_lower.rfind("[claude] ") {
                        ("claude", prefix[idx + "[claude] ".len()..].trim())
                    } else if let Some(idx) = prefix_lower.rfind("[grok] ") {
                        ("grok", prefix[idx + "[grok] ".len()..].trim())
                    } else if let Some(idx) = prefix_lower.rfind("[openai] ") {
                        ("openai", prefix[idx + "[openai] ".len()..].trim())
                    } else if let Some(idx) = prefix_lower.rfind("[gemini] ") {
                        ("gemini", prefix[idx + "[gemini] ".len()..].trim())
                    } else {
                        ("gemini", "")
                    };
                    recent_completed.push(AiQueueRecentCompletedItem {
                        timestamp: ts,
                        provider: prov.to_string(),
                        safe_stem: stem.to_string(),
                        message: format!("{} 스크립트 생성 완료", stem),
                    });
                }
            }
        }
    }

    Ok(AiQueueDashboardPayload {
        worker_running,
        worker_pid,
        worker_heartbeat_at,
        lock_file_path: lock_file.to_string_lossy().to_string(),
        auto_transcription_enabled,
        unlocked_agent_count: unlocked_agents.len(),
        total_pending_count,
        total_pending_bytes,
        stage1_pending_count,
        stage3_revision_count,
        completed_today_count,
        agent_slots,
        pending_items,
        recent_completed,
    })
}

/// 독립 AI 큐 워커 프로세스 제어 (`start_now` | `stop_worker`)
#[tauri::command]
pub(crate) fn control_ai_queue_worker(
    state: State<'_, AppState>,
    action: String,
) -> Result<AiQueueDashboardPayload, String> {
    let lock_file = state.db_path.with_file_name("ai_queue_worker.lock");
    match action.trim() {
        "stop_worker" => {
            if let Ok(raw) = fs::read_to_string(&lock_file) {
                let pid: u32 = raw
                    .trim()
                    .split(':')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                if pid > 0 && pid != std::process::id() {
                    let _ = Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string()])
                        .creation_flags(CREATE_NO_WINDOW)
                        .status();
                }
            }
            let _ = fs::remove_file(&lock_file);
            IS_TRANSCRIPTION_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
            log_gemini("INFO", "[AIQueueWorker] 사용자 요청으로 독립 AI 큐 워커가 중지 및 락 해제되었습니다.");
        }
        _ => {
            let _ = spawn_detached_ai_queue_worker_if_needed(true);
        }
    }
    get_ai_queue_dashboard_status(state)
}

/// `mylore.exe --ai-queue-worker` 진입점:
/// 메인 GUI 프로세스와 분리되어 백그라운드에서 독립적으로 AI 큐를 병렬 처리하고 완료 시 자동 종료됩니다.
pub(crate) fn run_detached_ai_queue_worker_process(force_now: bool) {
    let db_path = resolve_meta_db_path();
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let lock_file = db_path.with_file_name("ai_queue_worker.lock");
    if !force_now && is_external_ai_worker_lock_alive(&lock_file) {
        return;
    }

    let pid = std::process::id();
    let now_ms = chrono::Local::now().timestamp_millis();
    let _ = fs::write(&lock_file, format!("{}:{}", pid, now_ms));

    struct WorkerLockGuard(PathBuf);
    impl Drop for WorkerLockGuard {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _guard = WorkerLockGuard(lock_file.clone());

    // 작업이 길어질 때 락 파일 mtime을 30초마다 갱신하는 하트비트 스레드
    let hb_lock = lock_file.clone();
    let alive_flag = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let alive_ref = alive_flag.clone();
    thread::spawn(move || {
        while alive_ref.load(std::sync::atomic::Ordering::Relaxed) {
            thread::sleep(std::time::Duration::from_secs(30));
            if !alive_ref.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            let ts = chrono::Local::now().timestamp_millis();
            let _ = fs::write(&hb_lock, format!("{}:{}", pid, ts));
        }
    });

    log_gemini(
        "INFO",
        &format!(
            "[AIQueueWorker] 독립 AI 큐 프로세스(PID={}) 시작 — 메인 프로세스 종료와 무관하게 큐 처리 후 자동 종료됩니다.",
            pid
        ),
    );
    let (completed, failed, last_msg) = process_pending_call_transcriptions(&db_path, None, force_now);
    alive_flag.store(false, std::sync::atomic::Ordering::Relaxed);
    if completed > 0 || failed > 0 {
        log_gemini(
            "INFO",
            &format!(
                "[AIQueueWorker] 독립 AI 큐 프로세스(PID={}) 처리 완료 후 정상 종료 (완료: {}건, 실패/보류: {}건, 상태: {})",
                pid, completed, failed, last_msg
            ),
        );
    }
}
