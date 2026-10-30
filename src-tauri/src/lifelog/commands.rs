//! 라이프로그 조회/열기 Tauri 커맨드.

use crate::*;

#[tauri::command]
pub(crate) fn get_lifelog_for_date(
    state: State<AppState>,
    date_str: String,
) -> Result<DailyLifelogResponse, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut msg_stmt = conn
        .prepare(
            "SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
             FROM lifelog_messages WHERE sent_date = ?1 ORDER BY sent_time ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let messages: Vec<LifelogMessage> = msg_stmt
        .query_map(params![date_str], |r| {
            Ok(LifelogMessage {
                id: r.get(0)?,
                source: r.get(1)?,
                room_or_sender: r.get(2)?,
                sender: r.get(3)?,
                message: r.get(4)?,
                sent_date: r.get(5)?,
                sent_time: r.get(6)?,
                attachment_uuid: r.get(7)?,
                device_id: r.get::<_, String>(8).ok().filter(|s| !s.is_empty()),
                device_name: r.get::<_, String>(9).ok().filter(|s| !s.is_empty()),
                has_audio_recording: false,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut tx_stmt = conn
        .prepare(
            "SELECT id, tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key
             FROM finance_transactions WHERE tx_date = ?1 ORDER BY tx_time ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let transactions: Vec<FinanceTransaction> = tx_stmt
        .query_map(params![date_str], |r| {
            Ok(FinanceTransaction {
                id: r.get(0)?,
                tx_date: r.get(1)?,
                tx_time: r.get(2)?,
                institution: r.get(3)?,
                tx_type: r.get(4)?,
                amount: r.get(5)?,
                merchant: r.get(6)?,
                category: r.get(7)?,
                memo: r.get(8)?,
                verify_status: r.get(9)?,
                dedup_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut media_stmt = conn
        .prepare(
            "SELECT uuid, file_name, full_path, taken_date, taken_time, file_size, content_hash, status
             FROM media_inbox WHERE taken_date = ?1",
        )
        .map_err(|e| e.to_string())?;
    let media_inbox: Vec<MediaInboxItem> = media_stmt
        .query_map(params![date_str], |r| {
            Ok(MediaInboxItem {
                uuid: r.get(0)?,
                file_name: r.get(1)?,
                full_path: r.get(2)?,
                taken_date: r.get(3)?,
                taken_time: r.get(4)?,
                file_size: r.get::<_, i64>(5)? as u64,
                content_hash: r.get(6)?,
                status: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DailyLifelogResponse {
        messages,
        transactions,
        media_inbox,
    })
}

#[tauri::command]
pub(crate) async fn open_lifelog_item_document(
    state: State<'_, AppState>,
    source: String,
    room_or_sender: String,
    attachment_uuid: Option<String>,
    sent_date: Option<String>,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let contacts_map = load_mobile_contacts_map(&conn);
        let src = source.trim().to_lowercase();

        let target_md_path: PathBuf = if src == "kakaotalk" {
            let kakao_dir = get_archive_mobile_dir(&conn, "kakao");
            let safe_stem = sanitize_filename_stem(&room_or_sender);
            let mut md_path = kakao_dir.join(format!("{}.md", safe_stem));
            if !md_path.exists() {
                let direct_path = kakao_dir.join(format!("{}.md", room_or_sender.trim()));
                if direct_path.exists() {
                    md_path = direct_path;
                } else if let Ok(mut stmt) = conn.prepare(
                    "SELECT sender, message, sent_date, sent_time
                     FROM lifelog_messages
                     WHERE source = 'kakaotalk' AND room_or_sender = ?1
                     ORDER BY sent_date ASC, sent_time ASC, id ASC",
                ) {
                    let rows: Vec<(String, String, String, String)> = stmt
                        .query_map(params![room_or_sender], |r| {
                            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                        })
                        .ok()
                        .map(|it| it.filter_map(|x| x.ok()).collect())
                        .unwrap_or_default();
                    for (sender, msg, sdate, stime) in rows {
                        let md_line = format!("- **[{}] {}**: {}", stime, sender, msg);
                        append_line_to_mobile_md(
                            &conn,
                            "kakao",
                            &room_or_sender,
                            &format!("[카카오톡 대화내역] {}", room_or_sender),
                            "[\"카카오톡\", \"카톡\", \"단톡방\", \"대화내역\", \"채팅이력\", \"KakaoTalk\"]",
                            &sdate,
                            &md_line,
                        );
                    }
                }
            }
            enrich_kakao_markdown_with_media(&conn, &md_path);
            md_path
        } else if src == "sms" {
            let sms_dir = get_archive_mobile_dir(&conn, "sms");
            let target_digits = normalize_phone_digits(&room_or_sender);
            let display_name = resolve_contact_display(&room_or_sender, &contacts_map);
            let safe_stem = sanitize_filename_stem(if !target_digits.is_empty() {
                &room_or_sender
            } else {
                &display_name
            });
            let md_path = sms_dir.join(format!("{}.md", safe_stem));

            // DB에서 해당 번호(또는 연락처)와 주고받은 모든 과거 문자 대화를 시간순으로 조회하여 최신 `.md` 구성
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

                let matched: Vec<(String, String, String, String, String)> = rows
                    .into_iter()
                    .filter(|(r_addr, _, _, _, _)| {
                        if r_addr.trim() == room_or_sender.trim() {
                            return true;
                        }
                        let r_digits = normalize_phone_digits(r_addr);
                        if !target_digits.is_empty()
                            && target_digits.len() >= 8
                            && r_digits == target_digits
                        {
                            return true;
                        }
                        resolve_contact_display(r_addr, &contacts_map) == display_name
                    })
                    .collect();

                if !matched.is_empty() {
                    let existing_uuid = if md_path.exists() {
                        fs::read_to_string(&md_path)
                            .ok()
                            .and_then(|c| {
                                let (_, _, fm) = parse_markdown_yaml(&c);
                                fm.get("uuid").cloned()
                            })
                            .filter(|u| !u.is_empty())
                    } else {
                        None
                    };
                    let doc_uuid = existing_uuid.unwrap_or_else(|| Uuid::new_v4().to_string());
                    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                    let raw_phone = matched
                        .first()
                        .map(|(a, _, _, _, _)| a.clone())
                        .unwrap_or_else(|| room_or_sender.clone());

                    let mut content = format!(
                        "---\n\
                         uuid: \"{}\"\n\
                         title: \"[문자(SMS) 내역] {}\"\n\
                         category: \"mobile/sms\"\n\
                         phone_number: \"{}\"\n\
                         contact_name: \"{}\"\n\
                         device_aliases: [\"핸드폰\", \"휴대폰\", \"스마트폰\", \"갤럭시\", \"모바일\"]\n\
                         source_aliases: [\"문자\", \"문자내역\", \"메시지\", \"SMS\", \"MMS\"]\n\
                         last_synced: \"{}\"\n\
                         ---\n\n\
                         # ✉️ {}\n\n\
                         > **상대방**: {} | **전화번호**: `{}`\n\n\
                         ---\n",
                        doc_uuid,
                        display_name.replace('"', "\\\""),
                        raw_phone.replace('"', "\\\""),
                        display_name.replace('"', "\\\""),
                        now_str,
                        display_name,
                        display_name,
                        raw_phone
                    );

                    let mut cur_date = String::new();
                    for (_, sender, msg, sdate, stime) in matched {
                        if sdate != cur_date {
                            cur_date = sdate.clone();
                            content.push_str(&format!("\n## 📅 {}\n", cur_date));
                        }
                        let is_sent = sender == "나 (문자발신)"
                            || sender.contains("발신")
                            || msg.trim_start().starts_with("[발신]");
                        let dir_tag = if is_sent { "📤 발신" } else { "📥 수신" };
                        let sender_lbl = if is_sent {
                            "나 (문자발신)".to_string()
                        } else {
                            display_name.clone()
                        };
                        let clean_msg = clean_mms_and_multiline_body(
                            msg.trim_start().trim_start_matches("[발신]").trim_start(),
                        );
                        let time_hms = if stime.len() == 5 {
                            format!("{}:00", stime)
                        } else {
                            stime
                        };
                        content.push_str(&format!(
                            "- **[{}] [{}] {}**: {}\n",
                            time_hms, dir_tag, sender_lbl, clean_msg
                        ));
                    }
                    let _ = fs::write(&md_path, content.as_bytes());
                }
            }
            md_path
        } else if src == "call" {
            let calls_dir = get_archive_mobile_dir(&conn, "calls");
            if let Some((_, file_name, file_stem, rec_md_path, _)) =
                find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
            {
                if !rec_md_path.exists() {
                    let (c_disp, r_date, r_time) =
                        parse_call_audio_filename_meta(&file_stem, &contacts_map);
                    write_call_recording_markdown(
                        &conn, &file_name, &c_disp, &r_date, &r_time, None, None,
                    );
                }
                rec_md_path
            } else {
                let target_stem = sanitize_filename_stem(&room_or_sender);
                let md_path = calls_dir.join(format!("{}.md", target_stem));
                if !md_path.exists() {
                    let display_name = resolve_contact_display(&room_or_sender, &contacts_map);
                    let sdate = sent_date.unwrap_or_else(|| {
                        chrono::Local::now().format("%Y-%m-%d").to_string()
                    });
                    append_line_to_mobile_md(
                        &conn,
                        "calls",
                        &target_stem,
                        &format!("[통화내역 스크립트] {}", display_name),
                        "[\"통화\", \"통화내역\", \"통화내용\", \"전화\"]",
                        &sdate,
                        &format!("- 📞 **{}** 통화 기록", display_name),
                    );
                }
                md_path
            }
        } else if src == "recording" {
            let rec_dir = get_archive_mobile_dir(&conn, "recordings");
            if let Some((_, file_name, file_stem, rec_md_path, _)) =
                find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
            {
                if !rec_md_path.exists() {
                    let (_, rec_source, r_date, r_time) =
                        parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
                    write_voice_recording_markdown(
                        &conn, &file_name, &rec_source, &r_date, &r_time, None, None,
                    );
                }
                rec_md_path
            } else {
                let clean_room = room_or_sender
                    .trim()
                    .trim_start_matches("[워치]")
                    .trim_start_matches("[SM-S901N]")
                    .trim();
                let target_stem = sanitize_filename_stem(clean_room);
                let md_path = rec_dir.join(format!("{}.md", target_stem));
                if !md_path.exists() {
                    let (_, rec_source, r_date, r_time) =
                        parse_voice_recording_filename_meta(&target_stem, "SM-S901N");
                    write_voice_recording_markdown(
                        &conn,
                        &format!("{}.m4a", target_stem),
                        &rec_source,
                        &r_date,
                        &r_time,
                        None,
                        None,
                    );
                }
                md_path
            }
        } else if src == "health" {
            let health_dir = get_archive_mobile_dir(&conn, "health");
            let ym = sent_date
                .as_deref()
                .filter(|s| s.len() >= 7)
                .map(|s| &s[..7])
                .unwrap_or_else(|| {
                    if room_or_sender.len() >= 7 && room_or_sender.contains('-') {
                        &room_or_sender[..7]
                    } else {
                        "2026-10"
                    }
                });
            let stem = if room_or_sender.ends_with("_운동기록") {
                room_or_sender.clone()
            } else {
                format!("{}_운동기록", ym)
            };
            let md_path = health_dir.join(format!("{}.md", sanitize_filename_stem(&stem)));
            md_path
        } else {
            let noti_dir = get_archive_mobile_dir(&conn, "notifications");
            let ym = sent_date
                .as_deref()
                .filter(|s| s.len() >= 7)
                .map(|s| &s[..7])
                .unwrap_or("최근");
            let stem = format!("{}_알람내역", ym);
            let md_path = noti_dir.join(format!("{}.md", stem));
            if !md_path.exists() {
                backfill_mobile_md_into_lifelog_db(&conn);
            }
            md_path
        };

        build_document_payload(&conn, &target_md_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn get_all_lifelog_messages(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<LifelogMessage>, String> {
    let db_path = state.db_path.clone();
    let per_source_limit = (limit.unwrap_or(4000) / 2).max(1200) as i64;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        if LIFELOG_BACKFILLED_ONCE.get().is_none() {
            backfill_mobile_md_into_lifelog_db(&conn);
            let _ = LIFELOG_BACKFILLED_ONCE.set(true);
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                 FROM (
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'kakaotalk'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'notification'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'sms'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'call'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'recording'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                     UNION ALL
                     SELECT * FROM (
                         SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                         FROM lifelog_messages WHERE source = 'health'
                         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1
                     )
                 )
                 ORDER BY sent_date DESC, sent_time DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let mut rows: Vec<LifelogMessage> = stmt
            .query_map(params![per_source_limit], |r| {
                Ok(LifelogMessage {
                    id: r.get(0)?,
                    source: r.get(1)?,
                    room_or_sender: r.get(2)?,
                    sender: r.get(3)?,
                    message: r.get(4)?,
                    sent_date: r.get(5)?,
                    sent_time: r.get(6)?,
                    attachment_uuid: r.get(7)?,
                    device_id: r.get::<_, String>(8).ok().filter(|s| !s.is_empty()),
                    device_name: r.get::<_, String>(9).ok().filter(|s| !s.is_empty()),
                    has_audio_recording: false,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // 통화/녹음 오디오 파일 디렉터리를 단 1회만 스캔하여 인메모리 인덱스를 구축함으로써
        // 수천 건 조회 시에도 디스크 반복 I/O 및 정규식 재컴파일이 전혀 발생하지 않도록 최적화
        let contacts_map = load_mobile_contacts_map(&conn);
        let calls_audio_dir = get_archive_mobile_dir(&conn, "calls").join("audio");
        let rec_audio_dir = get_archive_mobile_dir(&conn, "recordings").join("audio");

        struct CachedAudioFile {
            file_name: String,
            safe_stem: String,
            c_disp: String,
            c_key: String,
            stem_digits: String,
            r_d: String,
            sort_key: String,
        }

        let mut stem_to_filename: HashMap<String, String> = HashMap::new();
        let mut cached_audios: Vec<CachedAudioFile> = Vec::new();

        for a_dir in [&rec_audio_dir, &calls_audio_dir] {
            if let Ok(entries) = fs::read_dir(a_dir) {
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
                    let stem = p
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    if stem.is_empty() {
                        continue;
                    }
                    let safe_stem = sanitize_filename_stem(&stem);
                    stem_to_filename
                        .entry(safe_stem.clone())
                        .or_insert_with(|| file_name.clone());
                    stem_to_filename
                        .entry(stem.clone())
                        .or_insert_with(|| file_name.clone());

                    let (c_disp, r_d, r_t) = parse_call_audio_filename_meta(&stem, &contacts_map);
                    let c_key = normalize_call_contact_key(&c_disp);
                    let stem_digits = normalize_phone_digits(&stem);
                    let sort_key = format!("{}_{}_{}", r_d, r_t, stem);
                    cached_audios.push(CachedAudioFile {
                        file_name,
                        safe_stem,
                        c_disp,
                        c_key,
                        stem_digits,
                        r_d,
                        sort_key,
                    });
                }
            }
        }
        cached_audios.sort_by(|a, b| b.sort_key.cmp(&a.sort_key));

        for row in rows.iter_mut() {
            if row.source == "call" || row.source == "recording" {
                let explicit_stem = row
                    .attachment_uuid
                    .as_deref()
                    .and_then(|a| {
                        a.strip_prefix("transcribed:")
                            .or_else(|| a.strip_prefix("pending_transcript:"))
                    })
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                let clean_room = row
                    .room_or_sender
                    .trim()
                    .trim_start_matches("[워치]")
                    .trim_start_matches("[SM-S901N]")
                    .trim();

                let mut matched_fname: Option<String> = None;

                if let Some(ref ex) = explicit_stem {
                    if let Some(f) = stem_to_filename
                        .get(ex)
                        .or_else(|| stem_to_filename.get(&sanitize_filename_stem(ex)))
                    {
                        matched_fname = Some(f.clone());
                    }
                }
                if matched_fname.is_none() {
                    let s1 = sanitize_filename_stem(clean_room);
                    let s2 = sanitize_filename_stem(&row.room_or_sender);
                    if let Some(f) = stem_to_filename.get(&s1).or_else(|| stem_to_filename.get(&s2))
                    {
                        matched_fname = Some(f.clone());
                    }
                }

                if matched_fname.is_none() {
                    let target_norm = normalize_phone_digits(clean_room);
                    let target_disp = resolve_contact_display(clean_room, &contacts_map);
                    let target_key_a = normalize_call_contact_key(clean_room);
                    let target_key_b = normalize_call_contact_key(&target_disp);
                    let allow_any_date = row.source == "recording";
                    let mut any_date_fallback: Option<String> = None;

                    for ca in &cached_audios {
                        let is_contact_match = ca.c_disp == target_disp
                            || ca.c_disp == clean_room
                            || (!ca.c_key.is_empty()
                                && (ca.c_key == target_key_a || ca.c_key == target_key_b))
                            || (!target_norm.is_empty()
                                && target_norm.len() >= 8
                                && ca.stem_digits.contains(&target_norm));
                        if is_contact_match {
                            if ca.r_d == row.sent_date {
                                matched_fname = Some(ca.file_name.clone());
                                break;
                            } else if allow_any_date && any_date_fallback.is_none() {
                                any_date_fallback = Some(ca.file_name.clone());
                            }
                        }
                    }
                    if matched_fname.is_none() {
                        matched_fname = any_date_fallback;
                    }
                }

                if let Some(fname) = matched_fname {
                    row.has_audio_recording = true;
                    if row.attachment_uuid.as_deref().unwrap_or("").trim().is_empty() {
                        row.attachment_uuid = Some(fname);
                    }
                }
            }
        }
        Ok(rows)
    })
    .await
    .map_err(|e| e.to_string())?
}
