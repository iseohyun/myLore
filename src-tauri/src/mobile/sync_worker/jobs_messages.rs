//! 동기화 워커 작업: 알림 / 문자 / 통화 기록 / 카카오톡 대화 병합.

use crate::*;

/// `SyncWorkerJob::Notifications` 처리
pub(crate) fn handle_notifications_job(
    app_handle: &AppHandle,
    conn: &Connection,
    md_coalesced: &mut MdCoalesced,
    job: SyncWorkerJob,
) {
    let SyncWorkerJob::Notifications {
        dev_id,
        dev_name,
        items,
        current_index,
        total_count,
    } = job
    else {
        return;
    };
    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let mut max_ts = 0i64;
    for (pkg, title, text, ts) in items {
        if ts > max_ts {
            max_ts = ts;
        }
        let (sent_date, sent_time) = epoch_ms_to_local_date_time(ts);
        let dedup_raw = format!(
            "noti|{}|{}|{}|{}|{}",
            pkg, sent_date, sent_time, title, text
        );
        let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
        let affected = conn
            .execute(
                "INSERT OR IGNORE INTO lifelog_messages
                                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                             VALUES ('notification', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    pkg, title, text, sent_date, sent_time, dedup_key,
                    dev_id, dev_name
                ],
            )
            .unwrap_or(0);
        if affected > 0 {
            downloaded += 1;
        } else {
            skipped += 1;
        }
        let ym = if sent_date.len() >= 7 {
            &sent_date[..7]
        } else {
            "2026-10"
        };
        let md_line = format!(
            "- **[{}] [{}] {}**: {}",
            sent_time,
            pkg,
            title.replace('\n', " "),
            text.replace('\n', " ")
        );
        md_coalesced
            .entry((
                "notifications".to_string(),
                format!("{}_알람내역", ym),
                format!("[모바일 알람/알림 내역] {}", ym),
                "[\"알람\", \"알림\", \"알람내역\", \"푸시알림\", \"상단바알림\"]".to_string(),
            ))
            .or_default()
            .push((sent_date.clone(), md_line));

        let _ = try_insert_finance_from_mobile_text(
            &conn,
            &pkg,
            &title,
            &text,
            &sent_date,
            &sent_time,
            "모바일 실시간 푸시 알림 적재",
        );
    }
    if max_ts > 0 {
        set_meta_i64_max(&conn, "last_noti_ts", max_ts);
        if !dev_id.is_empty() {
            let _ = conn.execute(
                "UPDATE paired_devices SET last_noti_ts = MAX(COALESCE(last_noti_ts, 0), ?1) WHERE device_id = ?2",
                params![max_ts, dev_id],
            );
        }
    }
    let _ = emit_live_service_sync_progress(
        &app_handle,
        "notification",
        current_index,
        total_count,
        skipped,
        downloaded,
        Some(&format!(
            "알림 {}/{}건 처리 중 ({}%)",
            current_index,
            total_count,
            ((current_index as f64 / total_count.max(1) as f64) * 100.0).round() as usize
        )),
    );
}

/// `SyncWorkerJob::Sms` 처리
pub(crate) fn handle_sms_job(
    app_handle: &AppHandle,
    conn: &Connection,
    md_coalesced: &mut MdCoalesced,
    job: SyncWorkerJob,
) {
    let SyncWorkerJob::Sms {
        dev_id,
        dev_name,
        items,
    } = job
    else {
        return;
    };
    let total_len = items.len().max(1);
    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let mut max_ts = 0i64;
    for (address, body, sms_type, ts) in items {
        if ts > max_ts {
            max_ts = ts;
        }
        let (sent_date, sent_time) = epoch_ms_to_local_date_time(ts);
        let sender_label = if sms_type == "sent" {
            "나 (문자발신)"
        } else {
            address.as_str()
        };
        let dedup_raw = format!(
            "sms|{}|{}|{}|{}|{}",
            address, sent_date, sent_time, sms_type, body
        );
        let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
        let affected = conn
            .execute(
                "INSERT OR IGNORE INTO lifelog_messages
                                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                             VALUES ('sms', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    address,
                    sender_label,
                    body,
                    sent_date,
                    sent_time,
                    dedup_key,
                    dev_id,
                    dev_name
                ],
            )
            .unwrap_or(0);
        if affected > 0 {
            downloaded += 1;
        } else {
            skipped += 1;
        }
        let dir_tag = if sms_type == "sent" {
            "📤 발신"
        } else {
            "📥 수신"
        };
        let md_line = format!(
            "- **[{}] [{}] {}**: {}",
            sent_time, dir_tag, sender_label, body
        );
        md_coalesced
            .entry((
                "sms".to_string(),
                address.clone(),
                format!("[문자(SMS) 내역] {}", address),
                "[\"문자\", \"문자내역\", \"메시지\", \"SMS\", \"MMS\"]".to_string(),
            ))
            .or_default()
            .push((sent_date.clone(), md_line));

        if sms_type != "sent" {
            let _ = try_insert_finance_from_mobile_text(
                &conn,
                &address,
                &address,
                &body,
                &sent_date,
                &sent_time,
                "모바일 SMS 문자 자동 적재",
            );
        }
    }
    if max_ts > 0 {
        set_meta_i64_max(&conn, "last_sms_ts", max_ts);
        if !dev_id.is_empty() {
            let _ = conn.execute(
                "UPDATE paired_devices SET last_sms_ts = MAX(COALESCE(last_sms_ts, 0), ?1) WHERE device_id = ?2",
                params![max_ts, dev_id],
            );
        }
    }
    let _ = emit_live_service_sync_progress(
        &app_handle,
        "sms",
        total_len,
        total_len,
        skipped,
        downloaded,
        None,
    );
}

/// `SyncWorkerJob::CallLogs` 처리
pub(crate) fn handle_call_logs_job(
    app_handle: &AppHandle,
    conn: &Connection,
    md_coalesced: &mut MdCoalesced,
    job: SyncWorkerJob,
) {
    let SyncWorkerJob::CallLogs {
        dev_id,
        dev_name: _,
        items,
    } = job
    else {
        return;
    };
    let total_len = items.len().max(1);
    let mut inserted = 0usize;
    let mut skipped = 0usize;
    let mut max_ts = 0i64;
    for (number, name, call_type, duration_sec, ts) in items {
        if ts > max_ts {
            max_ts = ts;
        }
        let (call_date, call_time) = epoch_ms_to_local_date_time(ts);
        let dedup_raw = format!(
            "call|{}|{}|{}|{}|{}",
            number, call_date, call_time, call_type, duration_sec
        );
        let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
        let affected = conn
            .execute(
                "INSERT OR IGNORE INTO lifelog_call_logs
                                             (phone_number, contact_name, call_type, duration_sec, call_date, call_time, timestamp_ms, dedup_key)
                                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    number,
                    name,
                    call_type,
                    duration_sec,
                    call_date,
                    call_time,
                    ts,
                    dedup_key
                ],
            )
            .unwrap_or(0);
        if affected > 0 {
            inserted += 1;
        } else {
            skipped += 1;
        }
        let type_kr = match call_type.as_str() {
            "outgoing" => "발신통화",
            "missed" => "부재중통화",
            "rejected" => "수신거절",
            _ => "수신통화",
        };
        let display_target = if name.trim().is_empty() {
            number.clone()
        } else {
            format!("{} ({})", name, number)
        };
        let mins = duration_sec / 60;
        let secs = duration_sec % 60;
        let msg_summary = if duration_sec > 0 {
            format!(
                "📞 [{}] {} — 통화시간 {}분 {}초",
                type_kr, display_target, mins, secs
            )
        } else {
            format!("📞 [{}] {}", type_kr, display_target)
        };
        let _ = conn.execute(
            "INSERT OR IGNORE INTO lifelog_messages
                                         (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key)
                                         VALUES ('call', ?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                display_target,
                type_kr,
                msg_summary,
                call_date,
                call_time,
                dedup_key
            ],
        );
        let md_line = format!("- **[{}] {}**", call_time, msg_summary);
        md_coalesced
            .entry((
                "calls".to_string(),
                display_target.clone(),
                format!("[통화내역 스크립트] {}", display_target),
                "[\"통화\", \"통화내역\", \"통화내용\", \"전화\", \"통화기록\"]".to_string(),
            ))
            .or_default()
            .push((call_date, md_line));
    }
    if max_ts > 0 {
        set_meta_i64_max(&conn, "last_call_ts", max_ts);
        if !dev_id.is_empty() {
            let _ = conn.execute(
                "UPDATE paired_devices SET last_call_ts = MAX(COALESCE(last_call_ts, 0), ?1) WHERE device_id = ?2",
                params![max_ts, dev_id],
            );
        }
    }
    let _ = emit_live_service_sync_progress(
        &app_handle,
        "call",
        total_len,
        total_len,
        skipped,
        inserted,
        None,
    );
}

/// `SyncWorkerJob::KakaoChat` 처리
pub(crate) fn handle_kakao_chat_job(
    app_handle: &AppHandle,
    conn: &Connection,
    android_msg_re: &Regex,
    date_re: &Regex,
    pc_msg_re: &Regex,
    job: SyncWorkerJob,
) {
    let SyncWorkerJob::KakaoChat {
        dev_id,
        mut room_name,
        raw_folder_name,
        raw_text,
        file_hash,
        folder_index,
        total_folders,
        now_ms,
    } = job
    else {
        return;
    };
    let mut current_date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut parsed_kakao_items: Vec<(String, String, String, String)> = Vec::new();
    let mut participants: Vec<String> = Vec::new();

    for line in raw_text.lines() {
        let t_line = line.trim().trim_start_matches('\u{feff}');
        if t_line.is_empty() {
            continue;
        }
        if let Some(cap) = android_msg_re.captures(t_line) {
            let y = cap.get(1).map(|m| m.as_str()).unwrap_or("2026");
            let m: u32 = cap
                .get(2)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(1);
            let d: u32 = cap
                .get(3)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(1);
            let ampm = cap.get(4).map(|m| m.as_str()).unwrap_or("오전");
            let hm = cap.get(5).map(|m| m.as_str()).unwrap_or("00:00");
            let sender = cap.get(6).map(|m| m.as_str()).unwrap_or("").trim();
            let body = cap.get(7).map(|m| m.as_str()).unwrap_or("");
            if !sender.is_empty() && sender != "회원님" && !participants.iter().any(|p| p == sender)
            {
                participants.push(sender.to_string());
            }
            current_date = format!("{}-{:02}-{:02}", y, m, d);
            let time_str = format!("{} {}", ampm, hm);
            parsed_kakao_items.push((
                current_date.clone(),
                time_str,
                sender.to_string(),
                body.to_string(),
            ));
            continue;
        }
        if t_line.starts_with("---") {
            if let Some(cap) = date_re.captures(t_line) {
                let y = cap.get(1).map(|m| m.as_str()).unwrap_or("2026");
                let m: u32 = cap
                    .get(2)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(1);
                let d: u32 = cap
                    .get(3)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(1);
                current_date = format!("{}-{:02}-{:02}", y, m, d);
                continue;
            }
        }
        if let Some(cap) = pc_msg_re.captures(t_line) {
            let sender = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let time_str = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let body = cap.get(3).map(|m| m.as_str()).unwrap_or("");
            if !sender.is_empty() && sender != "회원님" && !participants.iter().any(|p| p == sender)
            {
                participants.push(sender.to_string());
            }
            parsed_kakao_items.push((
                current_date.clone(),
                time_str.to_string(),
                sender.to_string(),
                body.to_string(),
            ));
            continue;
        }
        if !t_line.contains("님과 카카오톡 대화")
            && !t_line.ends_with("카카오톡 대화")
            && !t_line.starts_with("저장한 날짜 :")
            && !t_line.contains("님이 들어왔습니다")
            && !t_line.contains("님이 나갔습니다")
        {
            if let Some(last_item) = parsed_kakao_items.last_mut() {
                last_item.3.push_str("<br/>");
                last_item.3.push_str(t_line);
            }
        }
    }

    if room_name.starts_with("KakaoTalk_Chats_") && !participants.is_empty() {
        room_name = if participants.len() <= 4 {
            participants.join(", ")
        } else {
            format!(
                "{} 외 {}명",
                participants[..3].join(", "),
                participants.len() - 3
            )
        };
    }

    let mut messages_added = 0usize;
    let mut overlapping_count = 0usize;
    let mut kakao_md_lines: Vec<(String, String)> = Vec::with_capacity(parsed_kakao_items.len());

    for (c_date, time_str, sender, body) in parsed_kakao_items {
        let dedup_raw = format!(
            "kakao|{}|{}|{}|{}|{}",
            room_name, c_date, time_str, sender, body
        );
        let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
        let affected = conn
            .execute(
                "INSERT OR IGNORE INTO lifelog_messages
                                             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key)
                                             VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    room_name, sender, body, c_date, time_str,
                    dedup_key
                ],
            )
            .unwrap_or(0);
        if affected > 0 {
            messages_added += 1;
        } else {
            overlapping_count += 1;
        }
        let md_line = format!("- **[{}] {}**: {}", time_str, sender, body);
        kakao_md_lines.push((c_date, md_line));
    }

    append_lines_to_mobile_md_batch(
        &conn,
        "kakao",
        &room_name,
        &format!("[카카오톡 대화내역] {}", room_name),
        "[\"카카오톡\", \"카톡\", \"단톡방\", \"대화내역\", \"채팅이력\", \"KakaoTalk\"]",
        &kakao_md_lines,
    );

    upsert_kakao_metadata_in_md(
        &conn,
        &room_name,
        &raw_folder_name,
        &participants,
        overlapping_count,
        messages_added,
        now_ms,
    );
    let kakao_md_path = get_archive_mobile_dir(&conn, "kakao")
        .join(format!("{}.md", sanitize_filename_stem(&room_name)));
    if kakao_md_path.exists() {
        let _ = enrich_kakao_markdown_with_media(&conn, &kakao_md_path);
    }

    set_meta_i64_max(&conn, "last_kakao_ts", now_ms);
    if !dev_id.is_empty() {
        let _ = conn.execute(
            "UPDATE paired_devices SET last_kakao_ts = MAX(COALESCE(last_kakao_ts, 0), ?1) WHERE device_id = ?2",
            params![now_ms, dev_id],
        );
    }
    if !file_hash.is_empty() {
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at)
                                         VALUES (?1, ?2, ?3)",
            params![file_hash, room_name, now_str],
        );
    }

    let _ = emit_live_service_sync_progress(
        &app_handle,
        "kakaotalk",
        folder_index,
        total_folders,
        overlapping_count,
        messages_added,
        Some(&format!(
            "[{}] 폴더 {}/{} 완료 ({}% · 신규 {}건, 기존중복 {}건)",
            room_name,
            folder_index,
            total_folders,
            ((folder_index as f64 / total_folders.max(1) as f64) * 100.0).round() as usize,
            messages_added,
            overlapping_count
        )),
    );
}
