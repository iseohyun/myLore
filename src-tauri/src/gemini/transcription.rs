//! 통화 녹음 자동 스크립트화 워커 및 멀티 AI 에이전트 병렬 큐 배분·결재 관련 Tauri 커맨드.

use crate::*;

/// 미완료 통화 녹음(`mobile/calls/audio/*`) 및 독백·회의 음성녹음(`mobile/recordings/audio/*`)들을
/// **가장 최근 녹음음성부터(역순 정렬)** 공유 큐(`VecDeque`)에 적재하고,
/// 가용한 모든 AI 에이전트(`Gemini`, `Claude`, `Grok`, `OpenAI`)가 각자의 병렬 워커 스레드에서
/// 동시에 작업을 가져가 처리합니다(예: `1-gemini`, `2-claude`, `3-grok` 동시 실행 → `1` 실패 시 큐 선두 복귀 → 먼저 끝난 `grok`이 `1-grok` 처리, 이어 끝난 `claude`가 `4-claude` 처리).
pub(crate) static IS_TRANSCRIPTION_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub(crate) fn format_provider_badge_tag(prov: &str) -> &'static str {
    match prov.trim().to_lowercase().as_str() {
        "claude" => "Claude",
        "openai" | "gpt" => "OpenAI",
        "grok" => "Grok",
        _ => "Gemini",
    }
}

pub(crate) fn extract_existing_valid_script_body(md_path: &Path) -> Option<String> {
    if !md_path.exists() {
        return None;
    }
    let raw = fs::read_to_string(md_path).ok()?;
    let (_, body, _) = parse_markdown_yaml(&raw);
    let trimmed = body.trim();
    if trimmed.len() < 40
        || trimmed.contains("LLM 화자 분리 스크립트 생성 대기 중입니다")
        || trimmed.contains("통화 스크립트 추출 대기 중")
        || trimmed.contains("스크립트 추출 실패")
    {
        return None;
    }
    if trimmed.contains("## 📜 스크립트") || trimmed.contains("- **[") {
        Some(trimmed.to_string())
    } else {
        None
    }
}

pub(crate) fn inject_llm_provider_into_md(md_path: &Path, used_prov: &str) {
    let clean_prov = match used_prov.trim().to_lowercase().as_str() {
        "claude" => "claude",
        "openai" | "gpt" => "openai",
        "grok" => "grok",
        _ => "gemini",
    };
    let Ok(raw_md) = fs::read_to_string(md_path) else {
        return;
    };
    let (yaml_raw, body_content, _) = parse_markdown_yaml(&raw_md);
    if yaml_raw.trim().is_empty() {
        return;
    }
    let mut new_yaml_lines: Vec<String> = Vec::new();
    let mut replaced_prov = false;
    for line in yaml_raw.lines() {
        let tl = line.trim_start();
        if tl.starts_with("llm_provider:") {
            new_yaml_lines.push(format!("llm_provider: \"{}\"", clean_prov));
            replaced_prov = true;
        } else {
            new_yaml_lines.push(line.to_string());
            if tl.starts_with("transcript_status:") && !replaced_prov {
                new_yaml_lines.push(format!("llm_provider: \"{}\"", clean_prov));
                replaced_prov = true;
            }
        }
    }
    if !replaced_prov {
        new_yaml_lines.push(format!("llm_provider: \"{}\"", clean_prov));
    }
    let updated = format!(
        "---\n{}\n---\n\n{}",
        new_yaml_lines.join("\n"),
        body_content.trim_start()
    );
    let _ = fs::write(md_path, updated.as_bytes());
}

/// 단일 통화/음성메모 항목을 배정된 담당 에이전트(`assigned_agent`)로 전사 또는 반려 재작성합니다.
/// - `assigned_agent`가 실패하면 다른 에이전트로 내부 대체하지 않고 `Err`를 반환하여,
///   호출자(병렬 큐 워커)가 해당 항목을 다시 큐의 선두(`push_front`)에 돌려놓고 먼저 끝나는 다른 에이전트가 가져가도록 보장합니다.
fn execute_distributed_call_transcription(
    conn: &Connection,
    gemini_api_key: &str,
    gemini_unlocked: bool,
    assigned_agent: &str,
    clean_bytes: &[u8],
    file_name: &str,
    contact_display: &str,
    is_voice_memo: bool,
    user_requirement: Option<&str>,
    combined_profile: &str,
    call_prompt_tpl: &str,
    existing_script: Option<&str>,
) -> Result<(String, String), String> {
    // 1. 기존 전사본이 존재하고 담당 에이전트가 Claude/Grok/OpenAI인 경우:
    //    오디오 재추출 없이 해당 텍스트 에이전트가 직접 교정/반려 재작성 수행
    if let Some(script_text) = existing_script {
        if assigned_agent != "gemini" {
            return run_text_agent_call_script_revision_or_refinement(
                Some(assigned_agent),
                script_text,
                contact_display,
                combined_profile,
                call_prompt_tpl,
                user_requirement,
            )
            .ok_or_else(|| format!("{} 에이전트 통화 스크립트 재작성 실패", assigned_agent.to_uppercase()));
        }
    }

    // 2. 오디오 1차 전사가 필요하거나 Gemini 담당인 경우
    if gemini_api_key.trim().is_empty() {
        return Err("Gemini API 키가 아직 등록되지 않았습니다.".to_string());
    }
    if !gemini_unlocked && assigned_agent == "gemini" {
        return Err("Gemini 에이전트가 현재 5시간 쿼터 대기 중입니다.".to_string());
    }

    let record_gemini_usage = assigned_agent == "gemini";
    let raw_res = if is_voice_memo {
        transcribe_voice_recording_with_gemini_ext(
            gemini_api_key,
            clean_bytes,
            file_name,
            contact_display,
            user_requirement,
            Some(combined_profile),
            record_gemini_usage,
        )
    } else {
        transcribe_call_audio_with_gemini_ext(
            gemini_api_key,
            clean_bytes,
            file_name,
            contact_display,
            user_requirement,
            Some(combined_profile),
            Some(call_prompt_tpl),
            record_gemini_usage,
        )
    };

    match raw_res {
        Ok(raw_transcript) => {
            if record_gemini_usage {
                clear_gemini_quota_exhaustion(conn);
                return Ok((raw_transcript, "gemini".to_string()));
            }
            // 담당 에이전트가 Claude/Grok/OpenAI이면 해당 에이전트가 교정·요약을 수행 (실패 시 Err 반환 → 큐 선두 복귀)
            run_text_agent_call_script_revision_or_refinement(
                Some(assigned_agent),
                &raw_transcript,
                contact_display,
                combined_profile,
                call_prompt_tpl,
                user_requirement,
            )
            .ok_or_else(|| format!("{} 에이전트 통화 스크립트 교정·요약 실패", assigned_agent.to_uppercase()))
        }
        Err(err_msg) => Err(err_msg),
    }
}

pub(crate) fn process_pending_call_transcriptions(
    db_path: &Path,
    app_handle_opt: Option<&AppHandle>,
    force_now: bool,
) -> (usize, usize, String) {
    if IS_TRANSCRIPTION_RUNNING
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return (0, 0, "이미 백그라운드 스크립트 추출 작업이 실행 중입니다.".to_string());
    }
    struct ResetGuard;
    impl Drop for ResetGuard {
        fn drop(&mut self) {
            IS_TRANSCRIPTION_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _reset = ResetGuard;

    let conn = match open_db(db_path) {
        Ok(c) => c,
        Err(e) => return (0, 0, e),
    };

    if !force_now && !is_auto_call_transcription_enabled(&conn) {
        return (
            0,
            0,
            "설정에서 자동 스크립트 추출이 비활성화(No)되어 있습니다.".to_string(),
        );
    }

    let (api_key, _) = read_local_gemini_api_key();
    let now_ms = chrono::Local::now().timestamp_millis();
    let last_quota_err: String = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'gemini_last_quota_error'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    if last_quota_err.contains("no longer available")
        || last_quota_err.contains("2.5-flash")
        || last_quota_err.contains("gemini-3.8-flash")
    {
        clear_gemini_quota_exhaustion(&conn);
    }
    let mut retry_after_ms = get_meta_i64(&conn, "gemini_quota_retry_after_ms");
    if retry_after_ms <= now_ms {
        if let Some((log_rt_ms, _, _, _)) = detect_quota_lock_from_ai_logs() {
            if log_rt_ms > now_ms {
                retry_after_ms = log_rt_ms;
                sync_gemini_usage_lock_state(log_rt_ms);
            }
        }
    }

    let mut active_agents = get_unlocked_available_agents(&conn);
    if force_now && active_agents.is_empty() {
        for cand in ["gemini", "claude", "grok", "openai"] {
            if is_agent_currently_usable(&conn, cand, true) {
                active_agents.push(cand.to_string());
            }
        }
    }
    if active_agents.is_empty() {
        if retry_after_ms > now_ms {
            let (rd, rt) = epoch_ms_to_local_date_time(retry_after_ms);
            return (
                0,
                0,
                format!("모든 AI 에이전트 토큰 고갈 대기 중 ({} {} 에 자동 재시도)", rd, rt),
            );
        }
        return (0, 0, "사용 가능한 AI 에이전트 API 키가 없습니다.".to_string());
    }

    let contacts_map = load_mobile_contacts_map(&conn);
    let user_profile = read_ai_user_profile(&conn);
    let call_prompt_tpl = read_call_analysis_prompt(&conn);
    let calls_dir = get_archive_mobile_dir(&conn, "calls");
    let audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(&conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");

    struct PendingCallAudioItem {
        path: PathBuf,
        md_path: PathBuf,
        file_name: String,
        file_stem: String,
        safe_stem: String,
        contact_display: String,
        rec_date: String,
        rec_time: String,
        modified_secs: u64,
        is_voice_memo: bool,
        user_requirement: Option<String>,
        failed_agents: Vec<String>,
    }

    let mut transcript_meta_map: HashMap<String, (u8, String)> = HashMap::new();
    if let Ok(mut tm_stmt) = conn.prepare("SELECT safe_stem, stage, user_requirement FROM call_transcript_meta") {
        if let Ok(iter) = tm_stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
        }) {
            for (stem_k, st_i, req_s) in iter.flatten() {
                transcript_meta_map.insert(stem_k, (st_i.clamp(1, 4) as u8, req_s));
            }
        }
    }

    let mut pending_items: Vec<PendingCallAudioItem> = Vec::new();
    for (scan_audio_dir, scan_md_dir, is_voice_memo) in [
        (&audio_dir, &calls_dir, false),
        (&rec_audio_dir, &rec_dir, true),
    ] {
        if let Ok(entries) = fs::read_dir(scan_audio_dir) {
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
                let mut item_req: Option<String> = None;

                if let Some((st, req_str)) = transcript_meta_map.get(&safe_stem) {
                    if *st == 2 || *st == 4 {
                        continue;
                    }
                    if !req_str.trim().is_empty() {
                        item_req = Some(req_str.clone());
                    }
                } else if md_path.exists() {
                    if let Ok(md_raw) = fs::read_to_string(&md_path) {
                        let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
                        let status = fm.get("transcript_status").map(|s| s.as_str()).unwrap_or("");
                        if status == "completed" || status == "unverified" || status == "verified" {
                            continue;
                        }
                        if let Some(r) = fm.get("user_requirement").filter(|s| !s.trim().is_empty()) {
                            item_req = Some(r.clone());
                        }
                    }
                }

                let (contact_display, rec_date, rec_time) = if is_voice_memo {
                    let (_, rec_src, r_d, r_t) = parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                    (rec_src, r_d, r_t)
                } else {
                    parse_call_audio_filename_meta(&file_stem, &contacts_map)
                };
                let modified_secs = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                pending_items.push(PendingCallAudioItem {
                    path: p,
                    md_path,
                    file_name,
                    file_stem,
                    safe_stem,
                    contact_display,
                    rec_date,
                    rec_time,
                    modified_secs,
                    is_voice_memo,
                    user_requirement: item_req,
                    failed_agents: Vec::new(),
                });
            }
        }
    }

    // 가장 최근 녹음음성부터 우선 처리하도록 내림차순 정렬 (rec_date DESC, rec_time DESC, modified_secs DESC, file_stem DESC)
    pending_items.sort_by(|a, b| {
        b.rec_date
            .cmp(&a.rec_date)
            .then_with(|| b.rec_time.cmp(&a.rec_time))
            .then_with(|| b.modified_secs.cmp(&a.modified_secs))
            .then_with(|| b.file_stem.cmp(&a.file_stem))
    });

    if pending_items.is_empty() && retry_after_ms > 0 && retry_after_ms <= now_ms {
        clear_gemini_quota_exhaustion(&conn);
        if let Some(app) = app_handle_opt {
            let _ = app.emit(
                "mobile-sync-event",
                serde_json::json!({
                    "type": "call_transcript_retry",
                    "message": "AI 5시간 쿼터 락이 해제되어 토큰 사용량 상태가 갱신되었습니다."
                }),
            );
        }
    }
    drop(conn);

    if pending_items.is_empty() {
        return (0, 0, String::new());
    }

    // 공유 우선순위 큐: [1, 2, 3, 4, ...]
    // 각 가용 에이전트(예: 1-gemini, 2-claude, 3-grok)가 병렬 스레드에서 동시에 큐 선두의 작업을 가져가며,
    // 특정 에이전트(예: 1-gemini)가 실패하면 1번 작업을 큐 선두(push_front)에 되돌려 놓아
    // 먼저 작업이 끝난 다른 에이전트(예: 3-grok 완료 후 1-grok, 2-claude 완료 후 4-claude)가 즉시 이어받아 처리합니다.
    let shared_queue = Arc::new(Mutex::new(std::collections::VecDeque::from(pending_items)));
    let db_write_lock = Arc::new(Mutex::new(()));
    let completed_counter = std::sync::atomic::AtomicUsize::new(0);
    let failed_counter = std::sync::atomic::AtomicUsize::new(0);
    let stt_all_exhausted = std::sync::atomic::AtomicBool::new(false);
    let last_status_mutex = Arc::new(Mutex::new(String::new()));

    std::thread::scope(|s| {
        for agent_id in active_agents {
            let queue_ref = Arc::clone(&shared_queue);
            let write_lock_ref = Arc::clone(&db_write_lock);
            let status_ref = Arc::clone(&last_status_mutex);
            let completed_ref = &completed_counter;
            let failed_ref = &failed_counter;
            let stt_exhausted_ref = &stt_all_exhausted;
            let api_key_ref = &api_key;
            let user_profile_ref = &user_profile;
            let call_prompt_ref = &call_prompt_tpl;

            s.spawn(move || {
                let Ok(worker_conn) = open_db(db_path) else {
                    return;
                };
                loop {
                    if !is_agent_currently_usable(&worker_conn, &agent_id, force_now) {
                        break;
                    }
                    let cur_now_ms = chrono::Local::now().timestamp_millis();
                    let gemini_unlocked = force_now
                        || (!api_key_ref.is_empty()
                            && get_meta_i64(&worker_conn, "gemini_quota_retry_after_ms") <= cur_now_ms);
                    let stt_dead = stt_exhausted_ref.load(std::sync::atomic::Ordering::SeqCst);

                    // 큐에서 현재 에이전트가 처리 가능한 가장 앞선(가장 최근) 항목을 꺼냄
                    let next_item_opt = {
                        let Ok(mut q) = queue_ref.lock() else {
                            break;
                        };
                        let mut picked_idx: Option<usize> = None;
                        for (idx, cand) in q.iter().enumerate() {
                            if cand.failed_agents.contains(&agent_id) {
                                continue;
                            }
                            let has_existing = extract_existing_valid_script_body(&cand.md_path).is_some();
                            if !has_existing && (stt_dead || (!gemini_unlocked && agent_id == "gemini")) {
                                continue;
                            }
                            picked_idx = Some(idx);
                            break;
                        }
                        picked_idx.and_then(|i| q.remove(i))
                    };

                    let Some(mut item) = next_item_opt else {
                        break;
                    };

                    let existing_script = extract_existing_valid_script_body(&item.md_path);
                    let raw_bytes = match fs::read(&item.path) {
                        Ok(b) => b,
                        Err(_) => continue,
                    };
                    let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
                    if repaired {
                        let _ = fs::write(&item.path, &clean_bytes);
                    }

                    let combined_profile = match build_contact_ai_context_for_target(
                        &worker_conn,
                        &item.contact_display,
                        item.is_voice_memo,
                    ) {
                        Some(ctx) => format!("{}{}", user_profile_ref, ctx),
                        None => user_profile_ref.clone(),
                    };

                    let res = execute_distributed_call_transcription(
                        &worker_conn,
                        api_key_ref,
                        gemini_unlocked,
                        &agent_id,
                        &clean_bytes,
                        &item.file_name,
                        &item.contact_display,
                        item.is_voice_memo,
                        item.user_requirement.as_deref(),
                        &combined_profile,
                        call_prompt_ref,
                        existing_script.as_deref(),
                    );

                    match res {
                        Ok((transcript, used_prov)) => {
                            let _wg = write_lock_ref.lock().ok();
                            let md_path = if item.is_voice_memo {
                                write_voice_recording_markdown(
                                    &worker_conn,
                                    &item.file_name,
                                    &item.contact_display,
                                    &item.rec_date,
                                    &item.rec_time,
                                    Some(&transcript),
                                    None,
                                )
                            } else {
                                write_call_recording_markdown(
                                    &worker_conn,
                                    &item.file_name,
                                    &item.contact_display,
                                    &item.rec_date,
                                    &item.rec_time,
                                    Some(&transcript),
                                    None,
                                )
                            };
                            inject_llm_provider_into_md(&md_path, &used_prov);
                            upsert_single_recording_into_lifelog_db(
                                &worker_conn,
                                item.is_voice_memo,
                                &item.file_stem,
                                &item.contact_display,
                                &item.rec_date,
                                &item.rec_time,
                                Some(&transcript),
                                "",
                                "",
                            );
                            drop(_wg);

                            completed_ref.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            let badge = format_provider_badge_tag(&used_prov);
                            let msg = format!("{} 스크립트 생성 완료 ({})", item.safe_stem, badge);
                            log_gemini("INFO", &format!("[{}] {} 스크립트 생성 완료", badge, item.safe_stem));
                            if let Ok(mut st) = status_ref.lock() {
                                *st = msg.clone();
                            }
                            if let Some(app) = app_handle_opt {
                                let _ = app.emit(
                                    "mobile-sync-event",
                                    serde_json::json!({
                                        "type": "call_transcript_progress",
                                        "message": msg
                                    }),
                                );
                            } else {
                                notify_main_process_ai_event("call_transcript_progress", &msg);
                            }
                        }
                        Err(err_msg) => {
                            let badge = format_provider_badge_tag(&agent_id);
                            if agent_id == "gemini" || err_msg.starts_with("Gemini API 오류:") {
                                let _wg = write_lock_ref.lock().ok();
                                let (ex_str, rt_str) = record_gemini_quota_exhaustion(&worker_conn, &err_msg);
                                if existing_script.is_none() && err_msg.starts_with("Gemini API 오류:") && agent_id != "gemini" {
                                    // 모든 Gemini STT 후보 모델까지 전부 실패한 경우
                                    stt_exhausted_ref.store(true, std::sync::atomic::Ordering::SeqCst);
                                }
                                let warn_msg = format!(
                                    "LLM 토큰 부족/오류 감지 (마지막 실패: {} · 5시간 후 {} 자동 재시도): {}",
                                    ex_str, rt_str, err_msg
                                );
                                log_gemini("WARN", &format!("[{}] {}", badge, warn_msg));
                                if let Ok(mut st) = status_ref.lock() {
                                    *st = warn_msg;
                                }
                            } else {
                                log_gemini(
                                    "WARN",
                                    &format!("[{}] {} 처리 실패 (큐 선두 복귀 후 타 에이전트 인계): {}", badge, item.safe_stem, err_msg),
                                );
                            }

                            failed_ref.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            item.failed_agents.push(agent_id.clone());

                            // 실패한 작업을 다시 큐의 가장 앞(push_front)에 되돌려 놓아,
                            // 먼저 작업이 끝나는 다른 가용 에이전트(예: 3-grok 완료 직후 1-grok)가 즉시 가져가도록 함
                            if let Ok(mut q) = queue_ref.lock() {
                                q.push_front(item);
                            }

                            if !is_agent_currently_usable(&worker_conn, &agent_id, false) {
                                break;
                            }
                        }
                    }
                }
            });
        }
    });

    let completed_now = completed_counter.load(std::sync::atomic::Ordering::SeqCst);
    let failed_now = failed_counter.load(std::sync::atomic::Ordering::SeqCst);
    let last_status_msg = last_status_mutex
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();

    if completed_now > 0 || failed_now > 0 {
        if let Some(app) = app_handle_opt {
            let _ = app.emit(
                "mobile-sync-event",
                serde_json::json!({
                    "type": "call_transcript_retry",
                    "message": last_status_msg
                }),
            );
        } else {
            notify_main_process_ai_event("call_transcript_retry", &last_status_msg);
        }
    }

    (completed_now, failed_now, last_status_msg)
}

pub(crate) fn spawn_call_transcript_retry_worker(app_handle: AppHandle, db_path: PathBuf) {
    thread::spawn(move || {
        // 앱 시작 4초 후 미완료 통화 녹음 1차 병렬 점검 (분리된 독립 AI 큐 프로세스 우선 기동)
        thread::sleep(std::time::Duration::from_secs(4));
        if !spawn_detached_ai_queue_worker_if_needed(false) {
            let lock_file = db_path.with_file_name("ai_queue_worker.lock");
            if !lock_file.exists() {
                let _ = process_pending_call_transcriptions(&db_path, Some(&app_handle), false);
            }
        }

        // 이후 60초마다 미완료 큐 및 토큰 고갈 5시간 경과 여부를 확인하여 독립 AI 프로세스로 병렬 자동 재시도
        loop {
            thread::sleep(std::time::Duration::from_secs(60));
            if !spawn_detached_ai_queue_worker_if_needed(false) {
                let lock_file = db_path.with_file_name("ai_queue_worker.lock");
                if !lock_file.exists() {
                    let _ = process_pending_call_transcriptions(&db_path, Some(&app_handle), false);
                }
            }
        }
    });
}

#[tauri::command]
pub(crate) async fn retry_pending_call_transcriptions(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GeminiApiKeyStatus, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !spawn_detached_ai_queue_worker_if_needed(true) {
            let _ = process_pending_call_transcriptions(&db_path, Some(&app), true);
        }
        let conn = open_db(&db_path).ok();
        Ok(build_gemini_api_key_status_with_conn(conn.as_ref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn transcribe_single_call_item(
    state: State<'_, AppState>,
    app: AppHandle,
    room_or_sender: String,
    attachment_uuid: Option<String>,
    user_requirement: Option<String>,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let (api_key, _) = read_local_gemini_api_key();

        let (audio_path, file_name, file_stem, existing_md_path, _) =
            find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
                .ok_or_else(|| "해당 항목의 녹음 파일을 찾을 수 없습니다.".to_string())?;

        let safe_stem = sanitize_filename_stem(&file_stem);
        let eff_requirement: Option<String> = if let Some(ref r) = user_requirement.as_ref().filter(|s| !s.trim().is_empty()) {
            upsert_call_transcript_meta(&conn, &safe_stem, 3, r.trim());
            Some(r.trim().to_string())
        } else {
            conn.query_row(
                "SELECT user_requirement FROM call_transcript_meta WHERE safe_stem = ?1",
                params![safe_stem],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                if existing_md_path.exists() {
                    fs::read_to_string(&existing_md_path)
                        .ok()
                        .and_then(|c| {
                            let (_, _, fm) = parse_markdown_yaml(&c);
                            fm.get("user_requirement").cloned()
                        })
                        .filter(|s| !s.trim().is_empty())
                } else {
                    None
                }
            })
        };

        let existing_script = extract_existing_valid_script_body(&existing_md_path);
        let assigned_agent = pick_next_round_robin_agent(&conn).unwrap_or_else(|| "gemini".to_string());

        let raw_bytes = fs::read(&audio_path).map_err(|e| format!("오디오 파일 읽기 오류: {}", e))?;
        let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&audio_path, &clean_bytes);
        }

        let is_voice_rec = audio_path.to_string_lossy().replace('\\', "/").contains("/recordings/");
        let user_profile = read_ai_user_profile(&conn);
        let call_prompt_tpl = read_call_analysis_prompt(&conn);

        let (contact_display, rec_date, rec_time) = if is_voice_rec {
            let (_disp, rec_source, r_d, r_t) = parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
            (rec_source, r_d, r_t)
        } else {
            let contacts_map = load_mobile_contacts_map(&conn);
            parse_call_audio_filename_meta(&file_stem, &contacts_map)
        };

        let combined_profile = match build_contact_ai_context_for_target(&conn, &contact_display, is_voice_rec) {
            Some(ctx) => format!("{}{}", user_profile, ctx),
            None => user_profile.clone(),
        };

        let res = execute_distributed_call_transcription(
            &conn,
            &api_key,
            !api_key.is_empty(),
            &assigned_agent,
            &clean_bytes,
            &file_name,
            &contact_display,
            is_voice_rec,
            eff_requirement.as_deref(),
            &combined_profile,
            &call_prompt_tpl,
            existing_script.as_deref(),
        );

        match res {
            Ok((transcript, used_prov)) => {
                let md_path = if is_voice_rec {
                    write_voice_recording_markdown(&conn, &file_name, &contact_display, &rec_date, &rec_time, Some(&transcript), None)
                } else {
                    write_call_recording_markdown(&conn, &file_name, &contact_display, &rec_date, &rec_time, Some(&transcript), None)
                };
                inject_llm_provider_into_md(&md_path, &used_prov);
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    is_voice_rec,
                    &file_stem,
                    &contact_display,
                    &rec_date,
                    &rec_time,
                    Some(&transcript),
                    "",
                    "",
                );
                let badge = format_provider_badge_tag(&used_prov);
                log_gemini("INFO", &format!("[{}] {} 스크립트 생성 완료", badge, safe_stem));
                let _ = app.emit(
                    "mobile-sync-event",
                    serde_json::json!({
                        "type": "call_transcript_completed",
                        "message": format!("✅ '{}' 통화 스크립트 추출 및 요약 완료! ({} · 2단계 미확인 상태)", contact_display, badge)
                    }),
                );
                build_document_payload(&conn, &md_path)
            }
            Err(err_msg) => {
                let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                if existing_script.is_none() {
                    if is_voice_rec {
                        let _ = write_voice_recording_markdown(&conn, &file_name, &contact_display, &rec_date, &rec_time, None, Some((&ex_str, &rt_str, &err_msg)));
                    } else {
                        let _ = write_call_recording_markdown(&conn, &file_name, &contact_display, &rec_date, &rec_time, None, Some((&ex_str, &rt_str, &err_msg)));
                    }
                    upsert_single_recording_into_lifelog_db(&conn, is_voice_rec, &file_stem, &contact_display, &rec_date, &rec_time, None, "", "");
                }
                let warn_msg = format!(
                    "LLM 토큰 부족/오류 감지 (마지막 실패: {} · 5시간 후 {} 자동 재시도): {}",
                    ex_str, rt_str, err_msg
                );
                log_gemini("WARN", &format!("[Gemini] {}", warn_msg));
                let _ = app.emit(
                    "mobile-sync-event",
                    serde_json::json!({
                        "type": "call_transcript_retry",
                        "message": warn_msg
                    }),
                );
                Err(format!(
                    "토큰 부족/API 오류 (마지막 실패 시각: {} · 5시간 후 {} 자동 재시도): {}",
                    ex_str, rt_str, err_msg
                ))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 통화/음성 녹음의 4단계 스크립트 상태(`1`=미생성 대기🔊, `2`=확인 전❓, `3`=추가 요구사항 대기❗, `4`=확인 완료📄)와
/// 사용자 추가 요구사항(`user_requirement`)을 변경합니다.
#[tauri::command]
pub(crate) async fn update_call_transcript_stage(
    state: State<'_, AppState>,
    app: AppHandle,
    room_or_sender: String,
    attachment_uuid: Option<String>,
    stage: u8,
    user_requirement: Option<String>,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let clean_stage = stage.clamp(1, 4);
        let contacts_map = load_mobile_contacts_map(&conn);

        let (audio_path, file_name, file_stem, mut md_path, _) =
            find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
                .ok_or_else(|| "해당 항목의 녹음 파일을 찾을 수 없습니다.".to_string())?;
        let safe_stem = sanitize_filename_stem(&file_stem);
        let is_voice_rec = audio_path.to_string_lossy().replace('\\', "/").contains("/recordings/");

        if !md_path.exists() {
            if is_voice_rec {
                let (_, rec_source, r_date, r_time) = parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                md_path = write_voice_recording_markdown(&conn, &file_name, &rec_source, &r_date, &r_time, None, None);
            } else {
                let (c_disp, r_date, r_time) = parse_call_audio_filename_meta(&file_stem, &contacts_map);
                md_path = write_call_recording_markdown(&conn, &file_name, &c_disp, &r_date, &r_time, None, None);
            }
        }

        let existing_req: String = conn
            .query_row(
                "SELECT user_requirement FROM call_transcript_meta WHERE safe_stem = ?1",
                params![safe_stem],
                |r| r.get(0),
            )
            .ok()
            .unwrap_or_default();

        let eff_req = user_requirement.map(|s| s.trim().to_string()).unwrap_or(existing_req);

        upsert_call_transcript_meta(&conn, &safe_stem, clean_stage, &eff_req);

        let status_str = match clean_stage {
            1 => "pending_quota",
            2 => "unverified",
            3 => "needs_revision",
            _ => "verified",
        };

        if let Ok(raw_md) = fs::read_to_string(&md_path) {
            let (yaml_raw, mut body_content, _) = parse_markdown_yaml(&raw_md);
            let mut new_yaml_lines: Vec<String> = Vec::new();
            let mut replaced_status = false;
            let mut replaced_req = false;
            for line in yaml_raw.lines() {
                let tl = line.trim_start();
                if tl.starts_with("transcript_status:") {
                    new_yaml_lines.push(format!("transcript_status: \"{}\"", status_str));
                    replaced_status = true;
                } else if tl.starts_with("user_requirement:") {
                    if !eff_req.is_empty() {
                        new_yaml_lines.push(format!(
                            "user_requirement: \"{}\"",
                            eff_req.replace('"', "\\\"").replace('\n', " ")
                        ));
                    }
                    replaced_req = true;
                } else {
                    new_yaml_lines.push(line.to_string());
                }
            }
            if !replaced_status {
                new_yaml_lines.push(format!("transcript_status: \"{}\"", status_str));
            }
            if !replaced_req && !eff_req.is_empty() {
                new_yaml_lines.push(format!(
                    "user_requirement: \"{}\"",
                    eff_req.replace('"', "\\\"").replace('\n', " ")
                ));
            }

            let cleaned_body_lines: Vec<String> = body_content
                .lines()
                .filter(|l| !l.trim_start().starts_with("> 📌 **사용자 추가 요구사항**:"))
                .map(|l| l.to_string())
                .collect();
            body_content = cleaned_body_lines.join("\n");
            if !eff_req.is_empty() {
                if let Some(pos) = body_content.find("## 💡 요약") {
                    let (before, after) = body_content.split_at(pos);
                    body_content = format!("{}> 📌 **사용자 추가 요구사항**: {}\n\n{}", before, eff_req, after);
                } else {
                    body_content = format!("> 📌 **사용자 추가 요구사항**: {}\n\n{}", eff_req, body_content);
                }
            }

            let updated_md = format!("---\n{}\n---\n\n{}", new_yaml_lines.join("\n"), body_content.trim_start());
            let _ = fs::write(&md_path, updated_md.as_bytes());
        }

        let attach_tag = if clean_stage == 1 || clean_stage == 3 {
            format!("pending_transcript:{}", safe_stem)
        } else {
            format!("transcribed:{}", safe_stem)
        };
        let _ = conn.execute(
            "UPDATE lifelog_messages
             SET attachment_uuid = ?1
             WHERE room_or_sender = ?2
                OR attachment_uuid = ?3
                OR attachment_uuid = ?4
                OR attachment_uuid = ?5",
            params![
                attach_tag,
                safe_stem,
                format!("transcribed:{}", safe_stem),
                format!("pending_transcript:{}", safe_stem),
                file_name
            ],
        );

        if (clean_stage == 1 || (clean_stage == 3 && !eff_req.trim().is_empty()))
            && is_auto_call_transcription_enabled(&conn)
        {
            if !spawn_detached_ai_queue_worker_if_needed(false) {
                let db_clone = db_path.clone();
                let app_clone = app.clone();
                thread::spawn(move || {
                    let _ = process_pending_call_transcriptions(&db_clone, Some(&app_clone), false);
                });
            }
        }

        build_document_payload(&conn, &md_path)
    })
    .await
    .map_err(|e| e.to_string())?
}
