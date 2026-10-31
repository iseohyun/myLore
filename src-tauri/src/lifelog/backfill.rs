//! `mobile/*.md` 아카이브 → 라이프로그 DB 백필(재색인).

use crate::*;

pub(crate) fn backfill_mobile_md_into_lifelog_db(conn: &Connection) {
    let contacts_map = load_mobile_contacts_map(conn);

    // 1. 이전에 Multipart 바운더리가 파일명으로 잘못 들어간 `mobile/calls/--*.md` 및 DB 레코드 자동 정리
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    if let Ok(entries) = fs::read_dir(&calls_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(fname) = p.file_name().and_then(|s| s.to_str()) {
                    if fname.starts_with("--") && fname.ends_with(".md") {
                        let _ = fs::remove_file(&p);
                    }
                }
            }
        }
    }
    let _ = conn.execute(
        "DELETE FROM lifelog_messages WHERE source = 'call' AND room_or_sender LIKE '--%'",
        [],
    );

    // 2. `mobile/calls/audio/` 내 모든 통화 녹음 파일 스캔:
    //    - 잘못 붙은 Multipart 헤더가 있으면 순수 오디오로 자동 복구
    //    - 만약 독백/회의/워치 녹음 파일이 `calls/audio`에 섞여 있다면 `recordings/audio`로 자동 분류 이동
    //    - 통화파일명과 동일한 `mobile/calls/{통화파일명}.md` (요약부 + 스크립트 2부분) 보장
    //    - `lifelog_messages` 에 통화 녹음 상태(완료 vs 미생성/토큰부족) 동기화
    let audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");
    let _ = fs::create_dir_all(&rec_audio_dir);

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

            repair_multipart_audio_file_if_needed(&p);

            // 독백/회의/워치 음성녹음이면 `mobile/recordings/audio/`로 이동
            let (is_voice_memo, _) = is_voice_memo_or_watch_recording(&file_name, "", "SM-S901N");
            if is_voice_memo {
                let dest = rec_audio_dir.join(&file_name);
                if !dest.exists() {
                    let _ = fs::copy(&p, &dest);
                }
                let _ = fs::remove_file(&p);
                continue;
            }

            let (contact_display, rec_date, rec_time) =
                parse_call_audio_filename_meta(&file_stem, &contacts_map);
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = calls_dir.join(format!("{}.md", safe_stem));

            let mut is_completed = false;
            let mut summary_preview = String::new();
            if md_path.exists() {
                if let Ok(md_raw) = fs::read_to_string(&md_path) {
                    let (fm, body) = parse_frontmatter_and_body_simple(&md_raw);
                    let status_val = fm.get("transcript_status").map(|s| s.as_str()).unwrap_or("");
                    if status_val == "completed" || status_val == "unverified" || status_val == "verified" {
                        is_completed = true;
                        let (_, script_only) = split_summary_and_transcript(&body);
                        let dup_header_count = body.matches("> **통화 상대방**:").count();
                        // 기존 스크립트 본문(`## 📜 스크립트` 하위)에 `[00:00:00]` 타임스탬프가 없거나 `이름_전화번호_날짜`가 남아있거나 중복 헤더가 있으면 자동 정제 업그레이드
                        let needs_upgrade = (file_stem != contact_display && script_only.contains(&file_stem))
                            || fm.get("contact_name").map(|s| s.as_str()) != Some(contact_display.as_str())
                            || !script_only.contains("[00:")
                            || dup_header_count > 1;
                        if needs_upgrade {
                            write_call_recording_markdown(
                                conn,
                                &file_name,
                                &contact_display,
                                &rec_date,
                                &rec_time,
                                Some(&body),
                                None,
                            );
                        }
                        for line in body.lines() {
                            let tl = line.trim();
                            if !tl.is_empty()
                                && !tl.starts_with('#')
                                && !tl.starts_with('>')
                                && !tl.starts_with("---")
                            {
                                summary_preview = tl.to_string();
                                break;
                            }
                        }
                    } else if fm.get("contact_name").map(|s| s.as_str()) != Some(contact_display.as_str()) {
                        write_call_recording_markdown(
                            conn,
                            &file_name,
                            &contact_display,
                            &rec_date,
                            &rec_time,
                            None,
                            None,
                        );
                    }
                }
            } else {
                write_call_recording_markdown(
                    conn,
                    &file_name,
                    &contact_display,
                    &rec_date,
                    &rec_time,
                    None,
                    None,
                );
            }

            let dedup_key = format!("call_rec|{}", safe_stem);
            let attach_tag = if is_completed {
                format!("transcribed:{}", safe_stem)
            } else {
                format!("pending_transcript:{}", safe_stem)
            };
            let msg_text = if is_completed {
                if summary_preview.is_empty() {
                    format!("🎙️ [통화 스크립트 완료] {} ({})", contact_display, safe_stem)
                } else {
                    format!("🎙️ {}", summary_preview)
                }
            } else {
                let retry_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
                if retry_ms > chrono::Local::now().timestamp_millis() {
                    let (_, retry_t) = epoch_ms_to_local_date_time(retry_ms);
                    format!(
                        "⚠️ [LLM 토큰 부족 · {} 자동 재시도] {} ({})",
                        &retry_t[..std::cmp::min(5, retry_t.len())],
                        contact_display,
                        safe_stem
                    )
                } else {
                    format!(
                        "⚠️ [스크립트 미생성 · 자동 변환 대기] {} ({})",
                        contact_display, safe_stem
                    )
                }
            };

            let _ = conn.execute(
                "INSERT INTO lifelog_messages
                 (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
                 VALUES ('call', ?1, ?2, ?3, ?4, ?5, ?6, ?7, '', '모바일 통화녹음')
                 ON CONFLICT(dedup_key) DO UPDATE SET
                    room_or_sender = excluded.room_or_sender,
                    sender = excluded.sender,
                    message = excluded.message,
                    sent_date = excluded.sent_date,
                    sent_time = excluded.sent_time,
                    attachment_uuid = excluded.attachment_uuid",
                params![
                    safe_stem,
                    contact_display,
                    msg_text,
                    rec_date,
                    rec_time,
                    attach_tag,
                    dedup_key
                ],
            );
        }
    }

    // 2-B. `mobile/recordings/audio/` 내 독백녹음·회의녹음·워치 음성메모 스캔 및 `source = 'recording'` 동기화
    let _ = conn.execute(
        "DELETE FROM lifelog_messages WHERE source = 'recording' AND dedup_key NOT LIKE 'voice_rec|%'",
        [],
    );
    if let Ok(entries) = fs::read_dir(&rec_audio_dir) {
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

            repair_multipart_audio_file_if_needed(&p);

            let (_disp_title, rec_source, rec_date, rec_time) =
                parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = rec_dir.join(format!("{}.md", safe_stem));

            let mut is_completed = false;
            let mut summary_preview = String::new();
            if md_path.exists() {
                if let Ok(md_raw) = fs::read_to_string(&md_path) {
                    let (fm, body) = parse_frontmatter_and_body_simple(&md_raw);
                    if fm.get("transcript_status").map(|s| s.as_str()) == Some("completed") {
                        is_completed = true;
                        for line in body.lines() {
                            let tl = line.trim();
                            if !tl.is_empty()
                                && !tl.starts_with('#')
                                && !tl.starts_with('>')
                                && !tl.starts_with("---")
                            {
                                summary_preview = tl.to_string();
                                break;
                            }
                        }
                    }
                }
            } else {
                write_voice_recording_markdown(
                    conn,
                    &file_name,
                    &rec_source,
                    &rec_date,
                    &rec_time,
                    None,
                    None,
                );
            }

            let dedup_key = format!("voice_rec|{}", safe_stem);
            let attach_tag = if is_completed {
                format!("transcribed:{}", safe_stem)
            } else {
                format!("pending_transcript:{}", safe_stem)
            };
            let source_badge = if rec_source.contains("워치") {
                "⌚ 워치"
            } else {
                &rec_source
            };
            let msg_text = if is_completed {
                if summary_preview.is_empty() {
                    format!("🎙️ [{} · 회의/음성메모 요약 완료] {}", source_badge, safe_stem)
                } else {
                    format!("🎙️ [{}] {}", source_badge, summary_preview)
                }
            } else {
                let retry_ms = get_meta_i64(conn, "gemini_quota_retry_after_ms");
                if retry_ms > chrono::Local::now().timestamp_millis() {
                    let (_, retry_t) = epoch_ms_to_local_date_time(retry_ms);
                    format!(
                        "⚠️ [LLM 토큰 부족 · {} 자동 재시도] [{}] {}",
                        &retry_t[..std::cmp::min(5, retry_t.len())],
                        source_badge,
                        safe_stem
                    )
                } else {
                    format!(
                        "🎙️ [{}] {} (스크립트 미생성 · 우클릭하여 회의/음성메모 요약 추출)",
                        source_badge, safe_stem
                    )
                }
            };

            let _ = conn.execute(
                "INSERT INTO lifelog_messages
                 (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
                 VALUES ('recording', ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'dev_c6ffadd525', ?8)
                 ON CONFLICT(dedup_key) DO UPDATE SET
                    room_or_sender = excluded.room_or_sender,
                    sender = excluded.sender,
                    message = excluded.message,
                    sent_date = excluded.sent_date,
                    sent_time = excluded.sent_time,
                    attachment_uuid = excluded.attachment_uuid,
                    device_name = excluded.device_name",
                params![
                    safe_stem,
                    rec_source,
                    msg_text,
                    rec_date,
                    rec_time,
                    attach_tag,
                    dedup_key,
                    rec_source
                ],
            );
        }
    }

    // 3. 카카오톡 `.md` 백필
    let kakao_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM lifelog_messages WHERE source = 'kakaotalk'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if kakao_count == 0 {
        let kakao_dir = get_archive_mobile_dir(conn, "kakao");
        if let Ok(entries) = fs::read_dir(&kakao_dir) {
            let line_re = cached_regex!(r"^- \*\*\[([^\]]+)\]\s*([^\*]+)\*\*:\s*(.*)$");
            let date_re = cached_regex!(r"^##\s*📅\s*(\d{4}-\d{2}-\d{2})");
            let android_re = cached_regex!(r"^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+(오전|오후)\s*(\d{1,2}:\d{2}),\s*([^:]+?)\s*:\s*(.*)$");

            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("md") {
                    continue;
                }
                let room_name = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "카카오톡".to_string());
                if let Ok(content) = fs::read_to_string(&p) {
                    let mut current_date = chrono::Local::now().format("%Y-%m-%d").to_string();
                    for raw_line in content.lines() {
                        let trimmed = raw_line.trim();
                        if let Some(dc) = date_re.captures(trimmed) {
                            if let Some(m) = dc.get(1) {
                                current_date = m.as_str().to_string();
                            }
                            continue;
                        }
                        if let Some(lc) = line_re.captures(trimmed) {
                            let time_str = lc.get(1).map(|m| m.as_str()).unwrap_or("");
                            let sender = lc.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                            let body = lc.get(3).map(|m| m.as_str()).unwrap_or("");
                            let dedup_raw = format!(
                                "kakao|{}|{}|{}|{}|{}",
                                room_name, current_date, time_str, sender, body
                            );
                            let dedup_key =
                                blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                            let _ = conn.execute(
                                "INSERT OR IGNORE INTO lifelog_messages
                                 (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                 VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6, '', '모바일 아카이브')",
                                params![room_name, sender, body, current_date, time_str, dedup_key],
                            );
                        } else if let Some(ac) = android_re.captures(trimmed) {
                            let y = ac.get(1).map(|m| m.as_str()).unwrap_or("2026");
                            let m: u32 = ac
                                .get(2)
                                .and_then(|m| m.as_str().parse().ok())
                                .unwrap_or(1);
                            let d: u32 = ac
                                .get(3)
                                .and_then(|m| m.as_str().parse().ok())
                                .unwrap_or(1);
                            let ampm = ac.get(4).map(|m| m.as_str()).unwrap_or("오전");
                            let hm = ac.get(5).map(|m| m.as_str()).unwrap_or("00:00");
                            let sender = ac.get(6).map(|m| m.as_str().trim()).unwrap_or("");
                            let body = ac.get(7).map(|m| m.as_str()).unwrap_or("");
                            current_date = format!("{}-{:02}-{:02}", y, m, d);
                            let time_str = format!("{} {}", ampm, hm);
                            let dedup_raw = format!(
                                "kakao|{}|{}|{}|{}|{}",
                                room_name, current_date, time_str, sender, body
                            );
                            let dedup_key =
                                blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
                            let _ = conn.execute(
                                "INSERT OR IGNORE INTO lifelog_messages
                                 (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key, device_id, device_name)
                                 VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6, '', '모바일 아카이브')",
                                params![room_name, sender, body, current_date, time_str, dedup_key],
                            );
                        }
                    }
                }
            }
        }
    }

    // 4. SMS `lifelog_messages` -> `mobile/sms/{address}.md` 백필
    let sms_dir = get_archive_mobile_dir(conn, "sms");
    let has_sms_md = fs::read_dir(&sms_dir)
        .ok()
        .map(|it| {
            it.flatten()
                .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        })
        .unwrap_or(false);
    if !has_sms_md {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT room_or_sender, sender, message, sent_date, sent_time
             FROM lifelog_messages
             WHERE source = 'sms'
             ORDER BY sent_date ASC, sent_time ASC, id ASC",
        ) {
            let rows: Vec<(String, String, String, String, String)> = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .ok()
                .map(|it| it.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();
            for (addr, sender, msg, sdate, stime) in rows {
                let is_sent = sender == "나 (문자발신)" || sender.contains("발신");
                let dir_tag = if is_sent { "📤 발신" } else { "📥 수신" };
                let display_name = resolve_contact_display(&addr, &contacts_map);
                let sender_lbl = if is_sent {
                    "나 (문자발신)".to_string()
                } else {
                    display_name.clone()
                };
                let md_line = format!(
                    "- **[{}] [{}] {}**: {}",
                    stime,
                    dir_tag,
                    sender_lbl,
                    clean_mms_and_multiline_body(&msg)
                );
                append_line_to_mobile_md(
                    conn,
                    "sms",
                    &addr,
                    &format!("[문자(SMS) 내역] {}", display_name),
                    "[\"문자\", \"문자내역\", \"메시지\", \"SMS\", \"MMS\"]",
                    &sdate,
                    &md_line,
                );
            }
        }
    }

    // 4-B. 기존 DB 내 깨진 MMS 제목(`[ì œëª©ì—†ì Œ]`) 또는 RCS JSON 문자열 자동 정화
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, message FROM lifelog_messages
         WHERE source = 'sms' AND (message LIKE '[ì%' OR message LIKE '[제목없음]%' OR message LIKE '{\"layout\":%' OR message LIKE '%\n%')",
    ) {
        let dirty_rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .ok()
            .map(|it| it.filter_map(|x| x.ok()).collect())
            .unwrap_or_default();
        for (row_id, raw_msg) in dirty_rows {
            let cleaned = clean_mms_and_multiline_body(&raw_msg);
            if cleaned != raw_msg {
                let _ = conn.execute(
                    "UPDATE lifelog_messages SET message = ?1 WHERE id = ?2",
                    params![cleaned, row_id],
                );
            }
        }
    }

    // 5. 알림 `lifelog_messages` -> `mobile/notifications/{ym}_알람내역.md` 백필
    let noti_dir = get_archive_mobile_dir(conn, "notifications");
    let has_noti_md = fs::read_dir(&noti_dir)
        .ok()
        .map(|it| {
            it.flatten()
                .any(|e| e.path().extension().and_then(|s| s.to_str()) == Some("md"))
        })
        .unwrap_or(false);
    if !has_noti_md {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT room_or_sender, sender, message, sent_date, sent_time
             FROM lifelog_messages
             WHERE source = 'notification'
             ORDER BY sent_date ASC, sent_time ASC, id ASC",
        ) {
            let rows: Vec<(String, String, String, String, String)> = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .ok()
                .map(|it| it.filter_map(|x| x.ok()).collect())
                .unwrap_or_default();
            for (pkg, title, msg, sdate, stime) in rows {
                let ym = if sdate.len() >= 7 {
                    &sdate[..7]
                } else {
                    "최근"
                };
                let md_line = format!(
                    "- **[{}] `{}` {}**: {}",
                    stime,
                    pkg,
                    title,
                    msg.replace('\n', " ")
                );
                append_line_to_mobile_md(
                    conn,
                    "notifications",
                    &format!("{}_알람내역", ym),
                    &format!("[모바일 알림내역] {}", ym),
                    "[\"알림\", \"알림내역\", \"푸시알림\", \"앱알림\", \"Notification\"]",
                    &sdate,
                    &md_line,
                );
            }
        }
    }
}
