//! 통화 녹음 자동 스크립트화 워커 및 Gemini 관련 Tauri 커맨드.

use crate::*;

/// 미완료 통화 녹음(`mobile/calls/audio/*`) 및 독백·회의 음성녹음(`mobile/recordings/audio/*`)들을
/// **가장 최근 녹음음성부터(역순 정렬)** 순회하며 LLM 스크립트(`.md`)를 생성합니다.
/// 토큰 부족/한도 초과 발생 시 마지막 실패 시각을 기억하고 5시간 후 재시도 타이머를 설정합니다.
pub(crate) static IS_TRANSCRIPTION_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

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
    if api_key.is_empty() {
        return (0, 0, "Gemini API 키가 아직 등록되지 않았습니다.".to_string());
    }

    let now_ms = chrono::Local::now().timestamp_millis();
    let last_quota_err: String = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'gemini_last_quota_error'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    if last_quota_err.contains("no longer available") || last_quota_err.contains("2.5-flash") {
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
    if !force_now && retry_after_ms > now_ms {
        let (rd, rt) = epoch_ms_to_local_date_time(retry_after_ms);
        return (
            0,
            0,
            format!("토큰 고갈 대기 중 ({} {} 에 자동 재시도)", rd, rt),
        );
    }

    let contacts_map = load_mobile_contacts_map(&conn);
    let user_profile = read_ai_user_profile(&conn);
    let calls_dir = get_archive_mobile_dir(&conn, "calls");
    let audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(&conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");
    let mut completed_now = 0usize;
    let mut failed_now = 0usize;
    let mut last_status_msg = String::new();

    struct PendingCallAudioItem {
        path: PathBuf,
        file_name: String,
        file_stem: String,
        safe_stem: String,
        contact_display: String,
        rec_date: String,
        rec_time: String,
        modified_secs: u64,
        is_voice_memo: bool,
        user_requirement: Option<String>,
    }

    let mut transcript_meta_map: HashMap<String, (u8, String)> = HashMap::new();
    if let Ok(mut tm_stmt) = conn.prepare(
        "SELECT safe_stem, stage, user_requirement FROM call_transcript_meta",
    ) {
        if let Ok(iter) = tm_stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
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
                let mut item_req: Option<String> = None;

                if let Some((st, req_str)) = transcript_meta_map.get(&safe_stem) {
                    if *st == 2 || *st == 4 {
                        // 2단계(확인 전) 및 4단계(확인 완료)는 AI 스크립팅 대기목록에서 제외
                        continue;
                    }
                    if !req_str.trim().is_empty() {
                        item_req = Some(req_str.clone());
                    }
                } else if md_path.exists() {
                    if let Ok(md_raw) = fs::read_to_string(&md_path) {
                        let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
                        let status = fm
                            .get("transcript_status")
                            .map(|s| s.as_str())
                            .unwrap_or("");
                        if status == "completed" || status == "unverified" || status == "verified" {
                            continue;
                        }
                        if let Some(r) = fm.get("user_requirement").filter(|s| !s.trim().is_empty()) {
                            item_req = Some(r.clone());
                        }
                    }
                }

                let (contact_display, rec_date, rec_time) = if is_voice_memo {
                    let (_, rec_src, r_d, r_t) =
                        parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
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
                    file_name,
                    file_stem,
                    safe_stem,
                    contact_display,
                    rec_date,
                    rec_time,
                    modified_secs,
                    is_voice_memo,
                    user_requirement: item_req,
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

    for item in pending_items {
        let raw_bytes = match fs::read(&item.path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&item.path, &clean_bytes);
        }

        let combined_profile = match build_contact_ai_context_for_target(
            &conn,
            &item.contact_display,
            item.is_voice_memo,
        ) {
            Some(ctx) => format!("{}{}", user_profile, ctx),
            None => user_profile.clone(),
        };

        let res = if item.is_voice_memo {
            transcribe_voice_recording_with_gemini(
                &api_key,
                &clean_bytes,
                &item.file_name,
                &item.contact_display,
                item.user_requirement.as_deref(),
                Some(&combined_profile),
            )
        } else {
            transcribe_call_audio_with_gemini(
                &api_key,
                &clean_bytes,
                &item.file_name,
                &item.contact_display,
                item.user_requirement.as_deref(),
                Some(&combined_profile),
            )
        };

        match res {
            Ok(transcript) => {
                if item.is_voice_memo {
                    write_voice_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        Some(&transcript),
                        None,
                    );
                } else {
                    write_call_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        Some(&transcript),
                        None,
                    );
                }
                clear_gemini_quota_exhaustion(&conn);
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    item.is_voice_memo,
                    &item.file_stem,
                    &item.contact_display,
                    &item.rec_date,
                    &item.rec_time,
                    Some(&transcript),
                    "",
                    "",
                );
                completed_now += 1;
                last_status_msg = format!("{} 스크립트 생성 완료", item.safe_stem);
                log_gemini("INFO", &format!("[Gemini] {}", last_status_msg));
                if let Some(app) = app_handle_opt {
                    let _ = app.emit(
                        "mobile-sync-event",
                        serde_json::json!({
                            "type": "call_transcript_progress",
                            "message": last_status_msg
                        }),
                    );
                }
            }
            Err(err_msg) => {
                let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                if item.is_voice_memo {
                    write_voice_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                } else {
                    write_call_recording_markdown(
                        &conn,
                        &item.file_name,
                        &item.contact_display,
                        &item.rec_date,
                        &item.rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                }
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    item.is_voice_memo,
                    &item.file_stem,
                    &item.contact_display,
                    &item.rec_date,
                    &item.rec_time,
                    None,
                    "",
                    "",
                );
                failed_now += 1;
                last_status_msg = format!(
                    "LLM 토큰 부족/오류 감지 (마지막 실패: {} · 5시간 후 {} 자동 재시도): {}",
                    ex_str, rt_str, err_msg
                );
                log_gemini("WARN", &format!("[Gemini] {}", last_status_msg));
                // 토큰 부족 시 마지막 실패 시각을 기억하고 5시간 대기 후 재시도
                break;
            }
        }
    }

    if (completed_now > 0 || failed_now > 0) && app_handle_opt.is_some() {
        if let Some(app) = app_handle_opt {
            let _ = app.emit(
                "mobile-sync-event",
                serde_json::json!({
                    "type": "call_transcript_retry",
                    "message": last_status_msg
                }),
            );
        }
    }

    (completed_now, failed_now, last_status_msg)
}

pub(crate) fn spawn_call_transcript_retry_worker(app_handle: AppHandle, db_path: PathBuf) {
    thread::spawn(move || {
        // 앱 시작 4초 후 미완료 통화 녹음 1차 점검
        thread::sleep(std::time::Duration::from_secs(4));
        let _ = process_pending_call_transcriptions(&db_path, Some(&app_handle), false);

        // 이후 60초마다 토큰 고갈 5시간 경과 여부를 확인하여 자동 재시도
        loop {
            thread::sleep(std::time::Duration::from_secs(60));
            let _ = process_pending_call_transcriptions(&db_path, Some(&app_handle), false);
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
        let _ = process_pending_call_transcriptions(&db_path, Some(&app), true);
        let conn = open_db(&db_path).ok();
        Ok(build_gemini_api_key_status_with_conn(conn.as_ref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn get_gemini_api_key_status(state: State<'_, AppState>) -> Result<GeminiApiKeyStatus, String> {
    let conn = open_db(&state.db_path).ok();
    Ok(build_gemini_api_key_status_with_conn(conn.as_ref()))
}

#[tauri::command]
pub(crate) async fn set_auto_call_transcription(
    enabled: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GeminiApiKeyStatus, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let setting_path = resolve_projects_setting_json_path(&conn);
        let mut settings = if setting_path.exists() {
            fs::read_to_string(&setting_path)
                .ok()
                .and_then(|r| serde_json::from_str::<MyLoreAppSettings>(&r).ok())
                .unwrap_or_default()
        } else {
            MyLoreAppSettings::default()
        };
        settings.auto_call_transcription = enabled;
        settings.settings_file_path = setting_path.to_string_lossy().to_string();
        if let Ok(json_str) = serde_json::to_string_pretty(&settings) {
            let _ = fs::write(&setting_path, json_str);
        }
        let _ = app.emit("app-settings-updated", &settings);

        if enabled {
            let db_clone = db_path.clone();
            let app_clone = app.clone();
            thread::spawn(move || {
                let _ = process_pending_call_transcriptions(&db_clone, Some(&app_clone), false);
            });
        }

        Ok(build_gemini_api_key_status_with_conn(Some(&conn)))
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
        if api_key.is_empty() {
            return Err(
                "등록된 Gemini API 키가 없습니다. 라이프로그 설정 탭에서 API 키를 먼저 등록해 주세요."
                    .to_string(),
            );
        }

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

        let raw_bytes =
            fs::read(&audio_path).map_err(|e| format!("오디오 파일 읽기 오류: {}", e))?;
        let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&audio_path, &clean_bytes);
        }

        let is_voice_rec = audio_path
            .to_string_lossy()
            .replace('\\', "/")
            .contains("/recordings/");
        let user_profile = read_ai_user_profile(&conn);

        if is_voice_rec {
            let (_disp, rec_source, rec_date, rec_time) =
                parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
            let combined_profile =
                match build_contact_ai_context_for_target(&conn, &rec_source, true) {
                    Some(ctx) => format!("{}{}", user_profile, ctx),
                    None => user_profile.clone(),
                };
            match transcribe_voice_recording_with_gemini(
                &api_key,
                &clean_bytes,
                &file_name,
                &rec_source,
                eff_requirement.as_deref(),
                Some(&combined_profile),
            ) {
                Ok(transcript) => {
                    let md_path = write_voice_recording_markdown(
                        &conn,
                        &file_name,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        None,
                    );
                    clear_gemini_quota_exhaustion(&conn);
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        true,
                        &file_stem,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        "",
                        "",
                    );
                    let _ = app.emit(
                        "mobile-sync-event",
                        serde_json::json!({
                            "type": "call_transcript_completed",
                            "message": format!("✅ '[{}] {}' 음성메모·회의 스크립트 추출 및 요약 완료! (2단계 미확인 상태)", rec_source, file_stem)
                        }),
                    );
                    build_document_payload(&conn, &md_path)
                }
                Err(err_msg) => {
                    let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                    let _ = write_voice_recording_markdown(
                        &conn,
                        &file_name,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        true,
                        &file_stem,
                        &rec_source,
                        &rec_date,
                        &rec_time,
                        None,
                        "",
                        "",
                    );
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
        } else {
            let contacts_map = load_mobile_contacts_map(&conn);
            let (contact_display, rec_date, rec_time) =
                parse_call_audio_filename_meta(&file_stem, &contacts_map);
            let combined_profile =
                match build_contact_ai_context_for_target(&conn, &contact_display, false) {
                    Some(ctx) => format!("{}{}", user_profile, ctx),
                    None => user_profile.clone(),
                };

            match transcribe_call_audio_with_gemini(
                &api_key,
                &clean_bytes,
                &file_name,
                &contact_display,
                eff_requirement.as_deref(),
                Some(&combined_profile),
            ) {
                Ok(transcript) => {
                    let md_path = write_call_recording_markdown(
                        &conn,
                        &file_name,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        None,
                    );
                    clear_gemini_quota_exhaustion(&conn);
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        false,
                        &file_stem,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        Some(&transcript),
                        "",
                        "",
                    );
                    let _ = app.emit(
                        "mobile-sync-event",
                        serde_json::json!({
                            "type": "call_transcript_completed",
                            "message": format!("✅ '{}' 통화 스크립트 추출 및 요약 완료! (2단계 미확인 상태)", contact_display)
                        }),
                    );
                    build_document_payload(&conn, &md_path)
                }
                Err(err_msg) => {
                    let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                    let _ = write_call_recording_markdown(
                        &conn,
                        &file_name,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        None,
                        Some((&ex_str, &rt_str, &err_msg)),
                    );
                    upsert_single_recording_into_lifelog_db(
                        &conn,
                        false,
                        &file_stem,
                        &contact_display,
                        &rec_date,
                        &rec_time,
                        None,
                        "",
                        "",
                    );
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
        let is_voice_rec = audio_path
            .to_string_lossy()
            .replace('\\', "/")
            .contains("/recordings/");

        if !md_path.exists() {
            if is_voice_rec {
                let (_, rec_source, r_date, r_time) =
                    parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                md_path = write_voice_recording_markdown(
                    &conn,
                    &file_name,
                    &rec_source,
                    &r_date,
                    &r_time,
                    None,
                    None,
                );
            } else {
                let (c_disp, r_date, r_time) =
                    parse_call_audio_filename_meta(&file_stem, &contacts_map);
                md_path = write_call_recording_markdown(
                    &conn, &file_name, &c_disp, &r_date, &r_time, None, None,
                );
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

        let eff_req = user_requirement
            .map(|s| s.trim().to_string())
            .unwrap_or(existing_req);

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

            // 본문에 `> 📌 **사용자 추가 요구사항**:` 라인 갱신
            let cleaned_body_lines: Vec<String> = body_content
                .lines()
                .filter(|l| !l.trim_start().starts_with("> 📌 **사용자 추가 요구사항**:"))
                .map(|l| l.to_string())
                .collect();
            body_content = cleaned_body_lines.join("\n");
            if !eff_req.is_empty() {
                if let Some(pos) = body_content.find("## 💡 요약") {
                    let (before, after) = body_content.split_at(pos);
                    body_content = format!(
                        "{}> 📌 **사용자 추가 요구사항**: {}\n\n{}",
                        before, eff_req, after
                    );
                } else {
                    body_content = format!(
                        "> 📌 **사용자 추가 요구사항**: {}\n\n{}",
                        eff_req, body_content
                    );
                }
            }

            let updated_md = format!(
                "---\n{}\n---\n\n{}",
                new_yaml_lines.join("\n"),
                body_content.trim_start()
            );
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
            let db_clone = db_path.clone();
            let app_clone = app.clone();
            thread::spawn(move || {
                let _ = process_pending_call_transcriptions(&db_clone, Some(&app_clone), false);
            });
        }

        build_document_payload(&conn, &md_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn save_and_verify_gemini_api_key(
    api_key: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GeminiApiKeyStatus, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let secret_path = resolve_local_appdata_gemini_key_path();
        let trimmed = api_key.trim().to_string();

        if trimmed.is_empty() {
            let _ = fs::remove_file(&secret_path);
            let conn = open_db(&db_path).ok();
            return Ok(build_gemini_api_key_status_with_conn(conn.as_ref()));
        }

        // 백그라운드 워커 스레드에서 Gemini Flash API 호출(메인 UI 스레드 블로킹 0%)
        let test_req = serde_json::json!({
            "contents": [{
                "parts": [{ "text": "Reply with OK" }]
            }],
            "generationConfig": {
                "maxOutputTokens": 8
            }
        });
        let (_, active_model) = call_gemini_generate_content_with_model(&trimmed, &test_req)?;

        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let save_json = serde_json::json!({
            "api_key": trimmed,
            "verified_at": now_str,
            "model": active_model
        });
        fs::write(
            &secret_path,
            serde_json::to_string_pretty(&save_json).unwrap_or_default(),
        )
        .map_err(|e| format!("보안 키 파일 저장 실패: {}", e))?;

        if let Ok(conn) = open_db(&db_path) {
            clear_gemini_quota_exhaustion(&conn);
        }

        // 새 키가 인증되면 백그라운드에서 미생성 통화 스크립트 즉시 재시도 트리거
        let db_clone = db_path.clone();
        let app_clone = app.clone();
        thread::spawn(move || {
            let _ = process_pending_call_transcriptions(&db_clone, Some(&app_clone), true);
        });

        let conn = open_db(&db_path).ok();
        Ok(build_gemini_api_key_status_with_conn(conn.as_ref()))
    })
    .await
    .map_err(|e| format!("백그라운드 검증 스레드 오류: {}", e))?
}

#[tauri::command]
pub(crate) async fn transcribe_local_audio_file(
    audio_path: String,
    contact_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (api_key, _) = read_local_gemini_api_key();
        if api_key.is_empty() {
            return Err(
                "등록된 Gemini API 키가 없습니다. 먼저 Gemini API 키를 등록해 주세요.".to_string(),
            );
        }
        let src_path = PathBuf::from(&audio_path);
        if !src_path.exists() {
            return Err(format!("오디오 파일을 찾을 수 없습니다: {}", audio_path));
        }
        let raw_bytes = fs::read(&src_path).map_err(|e| format!("파일 읽기 오류: {}", e))?;
        let (audio_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&src_path, &audio_bytes);
        }
        let file_name = src_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "CallRec.m4a".to_string());
        let file_stem = src_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "통화상대".to_string());

        let conn = open_db(&db_path)?;
        let user_profile = read_ai_user_profile(&conn);
        let contacts_map = load_mobile_contacts_map(&conn);
        let (parsed_contact, rec_date, rec_time) =
            parse_call_audio_filename_meta(&file_stem, &contacts_map);
        let contact_label = if contact_name.trim().is_empty() {
            parsed_contact
        } else {
            extract_clean_contact_name(contact_name.trim(), &contacts_map)
        };

        let calls_dir = get_archive_mobile_dir(&conn, "calls");
        let audio_dir = calls_dir.join("audio");
        let _ = fs::create_dir_all(&audio_dir);
        let dest_audio = audio_dir.join(&file_name);
        if src_path != dest_audio {
            let _ = fs::write(&dest_audio, &audio_bytes);
        }

        let combined_profile =
            match build_contact_ai_context_for_target(&conn, &contact_label, false) {
                Some(ctx) => format!("{}{}", user_profile, ctx),
                None => user_profile.clone(),
            };

        match transcribe_call_audio_with_gemini(
            &api_key,
            &audio_bytes,
            &file_name,
            &contact_label,
            None,
            Some(&combined_profile),
        )
        {
            Ok(transcript) => {
                write_call_recording_markdown(
                    &conn,
                    &file_name,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    Some(&transcript),
                    None,
                );
                clear_gemini_quota_exhaustion(&conn);
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    false,
                    &file_stem,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    Some(&transcript),
                    "",
                    "",
                );
                Ok(transcript)
            }
            Err(err_msg) => {
                let (ex_str, rt_str) = record_gemini_quota_exhaustion(&conn, &err_msg);
                write_call_recording_markdown(
                    &conn,
                    &file_name,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    None,
                    Some((&ex_str, &rt_str, &err_msg)),
                );
                upsert_single_recording_into_lifelog_db(
                    &conn,
                    false,
                    &file_stem,
                    &contact_label,
                    &rec_date,
                    &rec_time,
                    None,
                    "",
                    "",
                );
                Err(format!(
                    "{} (토큰 부족/오류 기록 완료 · 5시간 후인 {} 에 자동 재시도 예약)",
                    err_msg, rt_str
                ))
            }
        }
    })
    .await
    .map_err(|e| format!("백그라운드 음성 변환 스레드 오류: {}", e))?
}
