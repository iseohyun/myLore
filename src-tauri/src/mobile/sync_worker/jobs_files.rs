//! 동기화 워커 작업: 통화 녹음 / 미디어 파일 저장.

use crate::*;

/// `SyncWorkerJob::CallRecording` 처리
pub(crate) fn handle_call_recording_job(
    app_handle: &AppHandle,
    conn: &Connection,
    need_transcript_trigger: &mut bool,
    job: SyncWorkerJob,
) {
    let SyncWorkerJob::CallRecording {
        dev_id,
        dev_name,
        file_hash,
        file_name,
        mut contact_label,
        transcript_text,
        audio_bytes,
        now_ms,
    } = job
    else {
        return;
    };
    let contacts_map = load_mobile_contacts_map(&conn);
    let file_stem = Path::new(&file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.clone());
    let (is_voice_memo, rec_source) =
        is_voice_memo_or_watch_recording(&file_name, &contact_label, &dev_name);

    if is_voice_memo {
        let (_, parsed_src, rec_date, rec_time) =
            parse_voice_recording_filename_meta(&file_stem, &rec_source);
        let rec_dir = get_archive_mobile_dir(&conn, "recordings");
        let audio_dir = rec_dir.join("audio");
        let _ = fs::create_dir_all(&audio_dir);
        let audio_path = audio_dir.join(&file_name);
        let _ = fs::write(&audio_path, &audio_bytes);

        write_voice_recording_markdown(
            &conn,
            &file_name,
            &parsed_src,
            &rec_date,
            &rec_time,
            if transcript_text.is_empty() {
                None
            } else {
                Some(&transcript_text)
            },
            None,
        );
        upsert_single_recording_into_lifelog_db(
            &conn,
            true,
            &file_stem,
            &parsed_src,
            &rec_date,
            &rec_time,
            if transcript_text.is_empty() {
                None
            } else {
                Some(&transcript_text)
            },
            &dev_id,
            &dev_name,
        );
        let _ = emit_live_service_sync_progress(&app_handle, "recording", 1, 1, 0, 1, None);
    } else {
        let (parsed_contact, rec_date, rec_time) =
            parse_call_audio_filename_meta(&file_stem, &contacts_map);
        if contact_label.trim().is_empty() {
            contact_label = parsed_contact;
        } else {
            contact_label = extract_clean_contact_name(&contact_label, &contacts_map);
        }
        let calls_dir = get_archive_mobile_dir(&conn, "calls");
        let audio_dir = calls_dir.join("audio");
        let _ = fs::create_dir_all(&audio_dir);
        let audio_path = audio_dir.join(&file_name);
        let _ = fs::write(&audio_path, &audio_bytes);

        write_call_recording_markdown(
            &conn,
            &file_name,
            &contact_label,
            &rec_date,
            &rec_time,
            if transcript_text.is_empty() {
                None
            } else {
                Some(&transcript_text)
            },
            None,
        );
        upsert_single_recording_into_lifelog_db(
            &conn,
            false,
            &file_stem,
            &contact_label,
            &rec_date,
            &rec_time,
            if transcript_text.is_empty() {
                None
            } else {
                Some(&transcript_text)
            },
            &dev_id,
            &dev_name,
        );
        let _ = emit_live_service_sync_progress(&app_handle, "call", 1, 1, 0, 1, None);
    }

    set_meta_i64_max(&conn, "last_recording_ts", now_ms);
    if !dev_id.is_empty() {
        let _ = conn.execute(
            "UPDATE paired_devices SET last_recording_ts = MAX(COALESCE(last_recording_ts, 0), ?1) WHERE device_id = ?2",
            params![now_ms, dev_id],
        );
    }
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = conn.execute(
        "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                     VALUES (?1, ?2, ?3)",
        params![file_hash, file_name, now_str],
    );
    if transcript_text.is_empty() && !audio_bytes.is_empty() {
        *need_transcript_trigger = true;
    }
}

/// `SyncWorkerJob::Media` 처리
pub(crate) fn handle_media_job(app_handle: &AppHandle, conn: &Connection, job: SyncWorkerJob) {
    let SyncWorkerJob::Media {
        file_name,
        source_type,
        folder_name,
        file_bytes,
        taken_date,
        taken_time,
        media_uuid,
        content_hash,
    } = job
    else {
        return;
    };
    let data_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| r"C:\Users\iseoh\OneDrive\iseohyunDocs".to_string());
    let inbox_dir = Path::new(&data_base).join("_MediaInbox");
    let _ = fs::create_dir_all(&inbox_dir);
    let target_path = inbox_dir.join(&file_name);
    let _ = fs::write(&target_path, &file_bytes);

    if !folder_name.is_empty() {
        let raw_kakao_folder =
            get_archive_mobile_dir(&conn, "kakao").join(sanitize_filename_stem(&folder_name));
        let _ = fs::create_dir_all(&raw_kakao_folder);
        let _ = fs::write(raw_kakao_folder.join(&file_name), &file_bytes);
    }
    if !folder_name.is_empty()
        || source_type.to_lowercase().contains("kakao")
        || file_name.to_lowercase().starts_with("kakaotalk_")
        || file_name.len() >= 40
    {
        let kakao_media_dir = get_archive_mobile_dir(&conn, "kakao").join("media");
        let _ = fs::create_dir_all(&kakao_media_dir);
        let _ = fs::write(kakao_media_dir.join(&file_name), &file_bytes);

        let (cur_idx, tot_cnt) = {
            let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
            if let Ok(guard) = mutex.lock() {
                guard
                    .steps
                    .iter()
                    .find(|s| s.key == "kakaotalk")
                    .map(|s| {
                        let cur = s.skipped_count + s.downloaded_count + 1;
                        let tot = s.total_count.max(cur + 1);
                        (cur, tot)
                    })
                    .unwrap_or((1, 2))
            } else {
                (1, 2)
            }
        };
        let _ = emit_live_service_sync_progress(
            &app_handle,
            "kakaotalk",
            cur_idx,
            tot_cnt,
            0,
            1,
            Some(&format!("카톡 미디어 다운로드 중: {}", file_name)),
        );
    }
    let _ = conn.execute(
        "INSERT OR REPLACE INTO media_inbox
                                     (uuid, file_name, full_path, taken_date, taken_time, file_size, content_hash, status)
                                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'inbox')",
        params![
            media_uuid,
            file_name,
            target_path.to_string_lossy().to_string(),
            taken_date,
            taken_time,
            file_bytes.len() as i64,
            content_hash
        ],
    );
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = conn.execute(
        "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                     VALUES (?1, ?2, ?3)",
        params![content_hash, file_name, now_str],
    );
}
