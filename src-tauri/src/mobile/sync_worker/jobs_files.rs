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
        let parsed_ts = parse_korean_date_time_to_epoch_ms(&rec_date, &rec_time);
        if parsed_ts > 0 {
            update_atomic_max_i64(&MEM_LAST_RECORDING_TS, parsed_ts);
            set_meta_i64_max(&conn, "last_recording_ts", parsed_ts);
            mark_domain_sync_state_unacked(&conn, "recording", parsed_ts, None);
            if !dev_id.is_empty() {
                let _ = conn.execute(
                    "UPDATE paired_devices SET last_recording_ts = MAX(COALESCE(last_recording_ts, 0), ?1) WHERE device_id = ?2",
                    params![parsed_ts, dev_id],
                );
            }
        }
        let (syn_b, tot_b) = add_live_service_synced_bytes("recording", audio_bytes.len() as u64);
        let lbl = if tot_b > 0 {
            Some(format!(
                "일반 녹음 적재 중 ({} / {}): {}",
                format_bytes_human(syn_b),
                format_bytes_human(tot_b),
                file_name
            ))
        } else {
            None
        };
        let _ = emit_live_service_sync_progress(
            &app_handle,
            "recording",
            1,
            1,
            0,
            1,
            lbl.as_deref(),
        );
    } else {
        let (parsed_contact, rec_date, rec_time) =
            parse_call_audio_filename_meta(&file_stem, &contacts_map);
        let raw_cl = contact_label.trim();
        let cl_is_numeric_only = !raw_cl.is_empty()
            && raw_cl
                .chars()
                .all(|c| c.is_ascii_digit() || c == '-' || c == '_');
        let parsed_has_name = !parsed_contact.trim().is_empty()
            && !parsed_contact
                .trim()
                .chars()
                .all(|c| c.is_ascii_digit() || c == '-' || c == '_');
        if raw_cl.is_empty() || (cl_is_numeric_only && parsed_has_name) {
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
        // 프로토콜 v2.0 (3-1, 4-1): 통화 녹음은 통화기록과 결합된 단일 `call` 이벤트의 용량/진행률로 귀속
        let parsed_ts = parse_korean_date_time_to_epoch_ms(&rec_date, &rec_time);
        if parsed_ts > 0 {
            update_atomic_max_i64(&MEM_LAST_CALL_TS, parsed_ts);
            update_atomic_max_i64(&MEM_LAST_RECORDING_TS, parsed_ts);
            set_meta_i64_max(&conn, "last_call_ts", parsed_ts);
            set_meta_i64_max(&conn, "last_recording_ts", parsed_ts);
            mark_domain_sync_state_unacked(&conn, "call", parsed_ts, None);
            mark_domain_sync_state_unacked(&conn, "recording", parsed_ts, None);
            if !dev_id.is_empty() {
                let _ = conn.execute(
                    "UPDATE paired_devices SET
                        last_call_ts = MAX(COALESCE(last_call_ts, 0), ?1),
                        last_recording_ts = MAX(COALESCE(last_recording_ts, 0), ?1)
                     WHERE device_id = ?2",
                    params![parsed_ts, dev_id],
                );
            }
        }
        let (syn_b, tot_b) = add_live_service_synced_bytes("call", audio_bytes.len() as u64);
        let lbl = if tot_b > 0 {
            Some(format!(
                "통화 녹음 적재 중 ({} / {}): {}",
                format_bytes_human(syn_b),
                format_bytes_human(tot_b),
                file_name
            ))
        } else {
            Some(format!("통화 녹음 적재 완료: {}", file_name))
        };
        let _ = emit_live_service_sync_progress(&app_handle, "call", 1, 1, 0, 1, lbl.as_deref());
    }
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = conn.execute(
        "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                     VALUES (?1, ?2, ?3)",
        params![file_hash, file_name, now_str],
    );
    log_sync(
        "INFO",
        &format!(
            "[CallRecording] 녹음 파일 적재 완료: {} ({})",
            file_name,
            format_bytes_human(audio_bytes.len() as u64)
        ),
    );
    if transcript_text.is_empty() && !audio_bytes.is_empty() {
        *need_transcript_trigger = true;
    }
}

/// `SyncWorkerJob::Media` 처리
pub(crate) fn handle_media_job(app_handle: &AppHandle, conn: &Connection, job: SyncWorkerJob) {
    let SyncWorkerJob::Media {
        dev_id,
        dev_name,
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

    let is_device_photo = source_type.eq_ignore_ascii_case("device_photo")
        || matches!(
            folder_name.as_str(),
            "Camera" | "Pictures" | "Screen recordings" | "Screenshots" | "Videocaptures"
        );

    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let blake3_hash = blake3::hash(&file_bytes).to_hex().to_string();

    if is_device_photo {
        // 연결된 기기의 이름에 따라 대상 폴더에 저장 (예: Picture\extern\SM-S901N)
        let device_photo_dir = resolve_picture_extern_device_dir(&conn, &dev_id, &dev_name);
        let target_path = device_photo_dir.join(&file_name);
        let _ = fs::write(&target_path, &file_bytes);

        let parsed_ts = parse_korean_date_time_to_epoch_ms(&taken_date, &taken_time);
        let eff_photo_ts = if parsed_ts > 0 {
            parsed_ts
        } else {
            chrono::Local::now().timestamp_millis()
        };
        update_atomic_max_i64(&MEM_LAST_PHOTO_TS, eff_photo_ts);
        set_meta_i64_max(&conn, "last_photo_ts", eff_photo_ts);
        mark_domain_sync_state_unacked(&conn, "photo", eff_photo_ts, None);

        let (syn_b, tot_b) = add_live_service_synced_bytes("photo", file_bytes.len() as u64);
        let (cur_idx, tot_cnt) = {
            let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
            if let Ok(guard) = mutex.lock() {
                guard
                    .steps
                    .iter()
                    .find(|s| s.key == "photo")
                    .map(|s| {
                        let cur = s.skipped_count + s.downloaded_count + 1;
                        let tot = s.total_count.max(cur);
                        (cur, tot)
                    })
                    .unwrap_or((1, 1))
            } else {
                (1, 1)
            }
        };
        let label_msg = if tot_b > 0 {
            format!(
                "사진·동영상 다운로드 중 ({} / {}): {}",
                format_bytes_human(syn_b),
                format_bytes_human(tot_b),
                file_name
            )
        } else {
            format!(
                "사진·동영상 저장 완료 ({}): {}",
                device_photo_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("SM-S901N"),
                file_name
            )
        };
        let pct = emit_live_service_sync_progress(
            &app_handle,
            "photo",
            cur_idx,
            tot_cnt,
            0,
            1,
            Some(&label_msg),
        );
        log_sync(
            "INFO",
            &format!(
                "[DevicePhoto] {} ({}) -> {} 저장 완료 — 누적 {} / {} ({}%)",
                file_name,
                format_bytes_human(file_bytes.len() as u64),
                target_path.display(),
                format_bytes_human(syn_b),
                format_bytes_human(tot_b),
                pct
            ),
        );

        let target_path_str = target_path.to_string_lossy().to_string();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO media_inbox
                 (uuid, file_name, full_path, taken_date, taken_time, file_size, content_hash, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'device_photo')",
            params![
                media_uuid,
                file_name,
                target_path_str,
                taken_date,
                taken_time,
                file_bytes.len() as i64,
                content_hash
            ],
        );
        upsert_media_origin_record(
            &conn,
            &content_hash,
            &blake3_hash,
            &file_name,
            file_bytes.len() as u64,
            &dev_id,
            &dev_name,
            &taken_date,
            &taken_time,
            &target_path_str,
        );
        for h in [&content_hash, &blake3_hash] {
            if !h.is_empty() {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                     VALUES (?1, ?2, ?3)",
                    params![h, file_name, now_str],
                );
            }
        }
        return;
    }

    let data_base: String = data_base_path_string(&conn);
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

        add_kakao_room_media_bytes_unacked(&conn, &folder_name, file_bytes.len() as u64);
        let (syn_b, tot_b) = add_live_service_synced_bytes("kakaotalk", file_bytes.len() as u64);
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
        let label_msg = if tot_b > 0 {
            format!(
                "카톡 미디어 다운로드 중 ({} / {}): {}",
                format_bytes_human(syn_b),
                format_bytes_human(tot_b),
                file_name
            )
        } else {
            format!("카톡 미디어 다운로드 중: {}", file_name)
        };
        let pct = emit_live_service_sync_progress(
            &app_handle,
            "kakaotalk",
            cur_idx,
            tot_cnt,
            0,
            1,
            Some(&label_msg),
        );
        log_sync(
            "INFO",
            &format!(
                "[KakaoMedia] {} ({}) 저장 완료 — 누적 {} / {} ({}%)",
                file_name,
                format_bytes_human(file_bytes.len() as u64),
                format_bytes_human(syn_b),
                format_bytes_human(tot_b),
                pct
            ),
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
    for h in [&content_hash, &blake3_hash] {
        if !h.is_empty() {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                         VALUES (?1, ?2, ?3)",
                params![h, file_name, now_str],
            );
        }
    }
}

/// 기동 시:
/// 1) 과거 `mobile/kakao/{Camera|Pictures|Screen recordings|Screenshots|Videocaptures}` 또는 `_MediaInbox`에 잘못 적재된 사진첩 파일을
///    멀티파트 트레일러 정리 후 `Picture\extern\{device_name}` (예: `Picture\extern\SM-S901N`)으로 자동 이동시키고,
/// 2) `Picture\extern\*` 폴더 내 기존 사진·동영상들의 SHA-256 해시를 `synced_file_hashes`에 등록하여 중복 재전송을 방지합니다.
pub(crate) fn backfill_picture_extern_device_photos(conn: &Connection) {
    let target_dev_dir = resolve_picture_extern_device_dir(conn, "", "");
    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    let data_base = data_base_path_string(conn);
    let inbox_dir = Path::new(&data_base).join("_MediaInbox");
    let kakao_media_dir = kakao_dir.join("media");

    // 1-A. mobile/kakao/{Camera|Pictures|...} 폴더 정리 및 이동
    for photo_folder in [
        "Camera",
        "Pictures",
        "Screen recordings",
        "Screenshots",
        "Videocaptures",
    ] {
        let wrong_dir = kakao_dir.join(photo_folder);
        if wrong_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&wrong_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if !p.is_file() {
                        continue;
                    }
                    let Some(fname) = p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string())
                    else {
                        continue;
                    };
                    if let Ok(raw_b) = fs::read(&p) {
                        let (clean_b, _) = strip_multipart_prefix_if_present(&raw_b);
                        let dest = target_dev_dir.join(&fname);
                        let _ = fs::write(&dest, &clean_b);
                    }
                    let _ = fs::remove_file(&p);
                    let _ = fs::remove_file(inbox_dir.join(&fname));
                    let _ = fs::remove_file(kakao_media_dir.join(&fname));
                }
            }
            let _ = fs::remove_dir(&wrong_dir);
        }
    }

    // 1-B. _MediaInbox 내에 멀티파트 트레일러(source_type=device_photo 또는 folder_name=Camera 등)가 남아있거나
    //      기기 사진첩 파일이 잘못 들어간 경우 정제하여 Picture\extern\{device_name} 으로 이동
    if inbox_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&inbox_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() {
                    continue;
                }
                let Some(fname) = p.file_name().and_then(|n| n.to_str()).map(|s| s.to_string())
                else {
                    continue;
                };
                let Ok(raw_b) = fs::read(&p) else {
                    continue;
                };
                let tail_start = raw_b.len().saturating_sub(4096);
                let tail_str = String::from_utf8_lossy(&raw_b[tail_start..]);
                let is_dev_photo_in_inbox = tail_str.contains("device_photo")
                    || tail_str.contains("name=\"folder_name\"")
                        && (tail_str.contains("\nCamera")
                            || tail_str.contains("\nPictures")
                            || tail_str.contains("\nScreenshots")
                            || tail_str.contains("\nScreen recordings")
                            || tail_str.contains("\nVideocaptures"));
                if is_dev_photo_in_inbox {
                    let (clean_b, _) = strip_multipart_prefix_if_present(&raw_b);
                    let dest = target_dev_dir.join(&fname);
                    let _ = fs::write(&dest, &clean_b);
                    let _ = fs::remove_file(&p);
                    let _ = fs::remove_file(kakao_media_dir.join(&fname));
                }
            }
        }
    }

    // Picture\extern 하위 기기 폴더들의 파일 해시(SHA-256) 및 media_inbox 등록
    let extern_root = resolve_picture_extern_root_dir(conn);
    let Ok(dev_dirs) = fs::read_dir(&extern_root) else {
        return;
    };
    let mut existing_names: HashSet<String> = HashSet::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT file_name FROM media_inbox WHERE status = 'device_photo'",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            existing_names = rows.flatten().collect();
        }
    }

    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    for dev_entry in dev_dirs.flatten() {
        let dpath = dev_entry.path();
        if !dpath.is_dir() {
            continue;
        }
        let Ok(files) = fs::read_dir(&dpath) else {
            continue;
        };
        for f_entry in files.flatten() {
            let fpath = f_entry.path();
            if !fpath.is_file() {
                continue;
            }
            let Some(fname) = fpath
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
            else {
                continue;
            };
            if existing_names.contains(&fname) {
                continue;
            }
            let Ok(bytes) = fs::read(&fpath) else {
                continue;
            };
            let sha = sha256_hex(&bytes);
            mark_hash_synced_in_memory(&sha);
            let mtime_ms = f_entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let (t_date, t_time) = epoch_ms_to_local_date_time(mtime_ms);
            let fpath_str = fpath.to_string_lossy().to_string();
            let _ = conn.execute(
                "INSERT OR REPLACE INTO media_inbox
                     (uuid, file_name, full_path, taken_date, taken_time, file_size, content_hash, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'device_photo')",
                params![
                    Uuid::new_v4().to_string(),
                    fname,
                    fpath_str,
                    t_date,
                    t_time,
                    bytes.len() as i64,
                    sha
                ],
            );
            upsert_media_origin_record(
                conn,
                &sha,
                "",
                &fname,
                bytes.len() as u64,
                "",
                "SM-S901N",
                &t_date,
                &t_time,
                &fpath_str,
            );
            let _ = conn.execute(
                "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                 VALUES (?1, ?2, ?3)",
                params![sha, fname, now_str],
            );
        }
    }
}
