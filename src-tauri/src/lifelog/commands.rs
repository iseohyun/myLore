//! 라이프로그 조회/열기 Tauri 커맨드.

use crate::*;

#[tauri::command]
pub(crate) fn get_lifelog_for_date(
    state: State<AppState>,
    date_str: String,
) -> Result<DailyLifelogResponse, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let _ = process_and_consume_kakao_notifications(&conn);

    let mut msg_stmt = conn
        .prepare(
            "SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
             FROM lifelog_messages WHERE sent_date = ?1 ORDER BY sent_time ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let messages: Vec<LifelogMessage> = msg_stmt
        .query_map(params![date_str], |r| {
            Ok(LifelogMessage {
                id: r.get(0)?, source: r.get(1)?, room_or_sender: r.get(2)?, sender: r.get(3)?,
                message: r.get(4)?, sent_date: r.get(5)?, sent_time: r.get(6)?, attachment_uuid: r.get(7)?,
                device_id: r.get::<_, String>(8).ok().filter(|s| !s.is_empty()),
                device_name: r.get::<_, String>(9).ok().filter(|s| !s.is_empty()),
                has_audio_recording: false, transcript_stage: 0, transcript_requirement: None,
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
                id: r.get(0)?, tx_date: r.get(1)?, tx_time: r.get(2)?, institution: r.get(3)?,
                tx_type: r.get(4)?, amount: r.get(5)?, merchant: r.get(6)?, category: r.get(7)?,
                memo: r.get(8)?, verify_status: r.get(9)?, dedup_key: r.get(10)?,
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
                uuid: r.get(0)?, file_name: r.get(1)?, full_path: r.get(2)?, taken_date: r.get(3)?,
                taken_time: r.get(4)?, file_size: r.get::<_, i64>(5)? as u64, content_hash: r.get(6)?, status: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DailyLifelogResponse { messages, transactions, media_inbox })
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
            let has_explicit_audio = attachment_uuid
                .as_deref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if has_explicit_audio {
                if let Some((_, file_name, file_stem, rec_md_path, _)) =
                    find_call_audio_and_md_ext(
                        &conn,
                        &room_or_sender,
                        attachment_uuid.as_deref(),
                        sent_date.as_deref(),
                        true,
                    )
                {
                    if !rec_md_path.exists() {
                        let (c_disp, r_date, r_time) =
                            parse_call_audio_filename_meta(&file_stem, &contacts_map);
                        write_call_recording_markdown(
                            &conn, &file_name, &c_disp, &r_date, &r_time, None, None,
                        );
                    }
                    return build_document_payload(&conn, &rec_md_path);
                }
            }
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
    let full_history_limit = 50_000i64;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        if LIFELOG_BACKFILLED_ONCE.get().is_none() {
            backfill_mobile_md_into_lifelog_db(&conn);
            let _ = LIFELOG_BACKFILLED_ONCE.set(true);
        }
        let _ = process_and_consume_kakao_notifications(&conn);

        let mut stmt = conn
            .prepare(
                "SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                 FROM (
                     SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name
                     FROM lifelog_messages
                     WHERE id IN (
                         SELECT MAX(id) FROM lifelog_messages
                         WHERE source IN ('kakaotalk', 'sms')
                         GROUP BY source, room_or_sender
                     )
                     UNION
                     SELECT * FROM (SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name FROM lifelog_messages WHERE source = 'kakaotalk' ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1)
                     UNION ALL
                     SELECT * FROM (SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name FROM lifelog_messages WHERE source = 'notification' ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?1)
                     UNION
                     SELECT * FROM (SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name FROM lifelog_messages WHERE source = 'sms' ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?2)
                     UNION ALL
                     SELECT * FROM (SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name FROM lifelog_messages WHERE source = 'call' ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?2)
                     UNION ALL
                     SELECT * FROM (SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name FROM lifelog_messages WHERE source = 'recording' ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?2)
                     UNION ALL
                     SELECT * FROM (SELECT id, source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, device_id, device_name FROM lifelog_messages WHERE source = 'health' ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT ?2)
                 )
                 ORDER BY sent_date DESC, sent_time DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let mut rows: Vec<LifelogMessage> = stmt
            .query_map(params![per_source_limit, full_history_limit], |r| {
                Ok(LifelogMessage {
                    id: r.get(0)?, source: r.get(1)?, room_or_sender: r.get(2)?, sender: r.get(3)?,
                    message: r.get(4)?, sent_date: r.get(5)?, sent_time: r.get(6)?, attachment_uuid: r.get(7)?,
                    device_id: r.get::<_, String>(8).ok().filter(|s| !s.is_empty()),
                    device_name: r.get::<_, String>(9).ok().filter(|s| !s.is_empty()),
                    has_audio_recording: false, transcript_stage: 0, transcript_requirement: None,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // 사진첩(`media_inbox WHERE status = 'device_photo'` 및 `Picture\extern\*`)에서 동기화된 실제 사진/동영상 항목 로드
        let re_media_dt = cached_regex!(
            r"((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[_-]([01]\d|2[0-3])([0-5]\d)([0-5]\d)"
        );
        if let Ok(mut m_stmt) = conn.prepare(
            "SELECT file_name, full_path, taken_date, taken_time, file_size
             FROM media_inbox
             WHERE status = 'device_photo'
             ORDER BY taken_date DESC, taken_time DESC, rowid DESC
             LIMIT ?1",
        ) {
            if let Ok(m_iter) = m_stmt.query_map(params![per_source_limit], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            }) {
                let mut media_rows: Vec<LifelogMessage> = Vec::new();
                for (m_idx, item) in m_iter.flatten().enumerate() {
                    let (fname, fpath, t_date, t_time, fsize) = item;
                    let lower = fname.to_lowercase();
                    let is_vid = lower.ends_with(".mp4")
                        || lower.ends_with(".mov")
                        || lower.ends_with(".webm")
                        || lower.ends_with(".mkv")
                        || lower.ends_with(".m4v")
                        || lower.ends_with(".3gp")
                        || lower.ends_with(".avi");
                    let is_img = lower.ends_with(".jpg")
                        || lower.ends_with(".jpeg")
                        || lower.ends_with(".png")
                        || lower.ends_with(".webp")
                        || lower.ends_with(".gif")
                        || lower.ends_with(".bmp")
                        || lower.ends_with(".heic");
                    if !is_vid && !is_img {
                        continue;
                    }
                    let (eff_date, eff_time) = if let Some(cap) = re_media_dt.captures(&fname) {
                        (
                            format!("{}-{}-{}", &cap[1], &cap[2], &cap[3]),
                            format!("{}:{}:{}", &cap[4], &cap[5], &cap[6]),
                        )
                    } else {
                        (t_date, t_time)
                    };
                    let dev_folder = Path::new(&fpath)
                        .parent()
                        .and_then(|p| p.file_name())
                        .and_then(|n| n.to_str())
                        .unwrap_or("SM-S901N")
                        .to_string();
                    let kind_label = if is_vid {
                        if lower.starts_with("screen_recording") {
                            "화면녹화"
                        } else {
                            "동영상"
                        }
                    } else if lower.starts_with("screenshot") {
                        "스크린샷"
                    } else {
                        "사진"
                    };
                    let icon = if is_vid { "🎬" } else { "🖼️" };
                    let msg_txt = format!(
                        "{} `{}` ({})",
                        icon,
                        fname,
                        format_bytes_human(fsize.max(0) as u64)
                    );
                    media_rows.push(LifelogMessage {
                        id: -100_000 - (m_idx as i64),
                        source: "media".to_string(),
                        room_or_sender: dev_folder.clone(),
                        sender: kind_label.to_string(),
                        message: msg_txt,
                        sent_date: eff_date,
                        sent_time: eff_time,
                        attachment_uuid: Some(fname),
                        device_id: None,
                        device_name: Some(dev_folder),
                        has_audio_recording: false,
                        transcript_stage: 0,
                        transcript_requirement: None,
                    });
                }
                media_rows.sort_by(|a, b| {
                    b.sent_date
                        .cmp(&a.sent_date)
                        .then_with(|| b.sent_time.cmp(&a.sent_time))
                });
                rows.extend(media_rows);
            }
        }

        // 통화/녹음 오디오 파일 디렉터리를 단 1회만 스캔하여 인메모리 인덱스를 구축함으로써
        // 수천 건 조회 시에도 디스크 반복 I/O 및 정규식 재컴파일이 전혀 발생하지 않도록 최적화
        let contacts_map = load_mobile_contacts_map(&conn);
        let calls_audio_dir = get_archive_mobile_dir(&conn, "calls").join("audio");
        let rec_audio_dir = get_archive_mobile_dir(&conn, "recordings").join("audio");

        fn hms_to_seconds(t: &str) -> Option<i64> {
            let parts: Vec<&str> = t.trim().split(':').collect();
            if parts.len() >= 2 {
                let h: i64 = parts[0].parse().ok()?;
                let m: i64 = parts[1].parse().ok()?;
                let s: i64 = parts.get(2).and_then(|v| v.parse().ok()).unwrap_or(0);
                Some(h * 3600 + m * 60 + s)
            } else {
                None
            }
        }

        struct CachedAudioFile {
            file_name: String,
            c_disp: String,
            c_key: String,
            stem_digits: String,
            r_d: String,
            r_t_sec: Option<i64>,
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
                    let r_t_sec = hms_to_seconds(&r_t);
                    let sort_key = format!("{}_{}_{}", r_d, r_t, stem);
                    cached_audios.push(CachedAudioFile {
                        file_name,
                        c_disp,
                        c_key,
                        stem_digits,
                        r_d,
                        r_t_sec,
                        sort_key,
                    });
                }
            }
        }
        cached_audios.sort_by(|a, b| b.sort_key.cmp(&a.sort_key));

        // 1단계: `call_rec` 행(통화녹음 파일 기반)과 `call_log` 행(통화이력 기반)이 동일 통화(동일 일자·연락처·600초 이내)인 경우 병합
        let mut merged_rec_indices: HashSet<usize> = HashSet::new();
        let mut claimed_log_indices: HashSet<usize> = HashSet::new();
        let re_strip_rec_ts = cached_regex!(r"[_-]?(?:19|20)?\d{6}[_-]?\d{6}$");

        // `lifelog_call_logs` 테이블에서 발신/수신 방향 역추적용 인메모리 캐시 로드 (날짜별 해시 인덱스)
        struct CallLogDirEntry {
            phone_digits: String,
            contact_key: String,
            call_type: String,
            call_sec: Option<i64>,
        }
        let mut call_logs_by_date: HashMap<String, Vec<CallLogDirEntry>> = HashMap::new();
        if let Ok(mut cl_stmt) = conn.prepare(
            "SELECT phone_number, contact_name, call_type, call_date, call_time
             FROM lifelog_call_logs ORDER BY call_date DESC, call_time DESC",
        ) {
            if let Ok(iter) = cl_stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            }) {
                for (ph, cname, ctype, cdate, ctime) in iter.flatten() {
                    let ph_digits = normalize_phone_digits(&ph);
                    let c_disp = if !cname.trim().is_empty() {
                        cname
                    } else {
                        resolve_contact_display(&ph, &contacts_map)
                    };
                    call_logs_by_date
                        .entry(cdate)
                        .or_default()
                        .push(CallLogDirEntry {
                            phone_digits: ph_digits,
                            contact_key: normalize_call_contact_key(&c_disp),
                            call_type: ctype,
                            call_sec: hms_to_seconds(&ctime),
                        });
                }
            }
        }

        // `call_transcript_meta` 4단계 상태 맵 로드
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

        // 원본 행이 `call_rec` 행인지 미리 기록해 두어, 병합 후 `call_log` 행이 다시 `call_rec`로 오인되어 연쇄 병합되는 버그를 방지
        let is_original_rec_row: Vec<bool> = rows
            .iter()
            .map(|r| {
                r.source == "call"
                    && r.attachment_uuid
                        .as_deref()
                        .map(|a| {
                            a.starts_with("transcribed:") || a.starts_with("pending_transcript:")
                        })
                        .unwrap_or(false)
            })
            .collect();

        let mut call_log_indices_by_date: HashMap<String, Vec<usize>> = HashMap::new();
        for (j, r) in rows.iter().enumerate() {
            if r.source == "call" && !is_original_rec_row[j] && r.message.contains("통화시간") {
                call_log_indices_by_date
                    .entry(r.sent_date.clone())
                    .or_default()
                    .push(j);
            }
        }

        // `call_rec` 행과 `call_log` 행의 모든 후보 쌍을 수집한 뒤 시간차(`diff_sec`) 오름차순으로 1:1 매칭
        let mut candidate_pairs: Vec<(i64, usize, usize)> = Vec::new();
        for i in 0..rows.len() {
            if !is_original_rec_row[i] {
                continue;
            }
            let rec_date = rows[i].sent_date.clone();
            let Some(same_date_log_indices) = call_log_indices_by_date.get(&rec_date) else {
                continue;
            };
            let rec_sec = hms_to_seconds(&rows[i].sent_time);
            let rec_clean = rows[i].room_or_sender.trim().to_string();
            let rec_no_ts = re_strip_rec_ts.replace(&rec_clean, "").to_string();
            let (rec_parsed_disp, _, _) = parse_call_audio_filename_meta(&rec_clean, &contacts_map);
            let rec_norm = normalize_phone_digits(&rec_no_ts);
            let rec_disp = resolve_contact_display(&rec_no_ts, &contacts_map);
            let rec_key_a = normalize_call_contact_key(&rec_parsed_disp);
            let rec_key_b = normalize_call_contact_key(&rec_disp);
            let rec_key_s = normalize_call_contact_key(&rows[i].sender);

            for &j in same_date_log_indices {
                let log_sec = hms_to_seconds(&rows[j].sent_time);
                let diff_sec = match (rec_sec, log_sec) {
                    (Some(rs), Some(ls)) => (rs - ls).abs(),
                    _ => 999_999,
                };
                if diff_sec > 300 {
                    continue;
                }
                let log_clean = rows[j].room_or_sender.trim();
                let log_norm = normalize_phone_digits(log_clean);
                let log_disp = resolve_contact_display(log_clean, &contacts_map);
                let log_key_a = normalize_call_contact_key(log_clean);
                let log_key_b = normalize_call_contact_key(&log_disp);

                let contact_matched = (!rec_norm.is_empty()
                    && rec_norm.len() >= 8
                    && log_norm == rec_norm)
                    || (!log_key_a.is_empty()
                        && (log_key_a == rec_key_a
                            || log_key_a == rec_key_b
                            || log_key_a == rec_key_s))
                    || (!log_key_b.is_empty()
                        && (log_key_b == rec_key_a
                            || log_key_b == rec_key_b
                            || log_key_b == rec_key_s));
                if contact_matched {
                    candidate_pairs.push((diff_sec, i, j));
                }
            }
        }
        candidate_pairs.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

        for (_, rec_idx, log_idx) in candidate_pairs {
            if merged_rec_indices.contains(&rec_idx) || claimed_log_indices.contains(&log_idx) {
                continue;
            }
            let rec_att = rows[rec_idx].attachment_uuid.clone();
            rows[log_idx].attachment_uuid = rec_att;
            rows[log_idx].has_audio_recording = true;
            claimed_log_indices.insert(log_idx);
            merged_rec_indices.insert(rec_idx);
        }

        for i in 0..rows.len() {
            if !is_original_rec_row[i] || merged_rec_indices.contains(&i) {
                continue;
            }
            let rec_date = rows[i].sent_date.clone();
            let rec_sec = hms_to_seconds(&rows[i].sent_time);
            let rec_clean = rows[i].room_or_sender.trim().to_string();
            let rec_no_ts = re_strip_rec_ts.replace(&rec_clean, "").to_string();
            let (rec_parsed_disp, _, _) = parse_call_audio_filename_meta(&rec_clean, &contacts_map);
            let rec_norm = normalize_phone_digits(&rec_no_ts);
            let rec_disp = resolve_contact_display(&rec_no_ts, &contacts_map);
            let rec_key_a = normalize_call_contact_key(&rec_parsed_disp);
            let rec_key_b = normalize_call_contact_key(&rec_disp);
            let rec_key_s = normalize_call_contact_key(&rows[i].sender);

            // `lifelog_call_logs`에서 발신/수신 방향을 찾아 `call_rec` 행의 `sender`를 보정
            let mut best_dir: Option<(i64, &str)> = None;
            if let Some(same_date_cls) = call_logs_by_date.get(&rec_date) {
                for cl in same_date_cls {
                    let diff_sec = match (rec_sec, cl.call_sec) {
                        (Some(rs), Some(ls)) => (rs - ls).abs(),
                        _ => 999_999,
                    };
                    if diff_sec > 300 {
                        continue;
                    }
                    let matched = (!rec_norm.is_empty()
                        && rec_norm.len() >= 8
                        && cl.phone_digits == rec_norm)
                        || (!cl.contact_key.is_empty()
                            && (cl.contact_key == rec_key_a
                                || cl.contact_key == rec_key_b
                                || cl.contact_key == rec_key_s));
                    if matched {
                        if best_dir.map(|(bd, _)| diff_sec < bd).unwrap_or(true) {
                            best_dir = Some((diff_sec, cl.call_type.as_str()));
                        }
                    }
                }
            }
            if let Some((_, ctype)) = best_dir {
                rows[i].sender = match ctype {
                    "outgoing" => "발신통화".to_string(),
                    "missed" => "부재중통화".to_string(),
                    "rejected" => "수신거절".to_string(),
                    _ => "수신통화".to_string(),
                };
            }
        }

        if !merged_rec_indices.is_empty() {
            let mut idx = 0usize;
            rows.retain(|_| {
                let keep = !merged_rec_indices.contains(&idx);
                idx += 1;
                keep
            });
        }

        // 이미 명시적 `attachment_uuid`로 매칭된 오디오 파일명을 추적하여 다른 통화 행에 중복 연결되는 것을 방지
        let mut claimed_audio_filenames: HashSet<String> = HashSet::new();
        for row in rows.iter() {
            if row.source == "call" || row.source == "recording" {
                if let Some(ex) = row
                    .attachment_uuid
                    .as_deref()
                    .and_then(|a| {
                        a.strip_prefix("transcribed:")
                            .or_else(|| a.strip_prefix("pending_transcript:"))
                    })
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    if let Some(f) = stem_to_filename
                        .get(ex)
                        .or_else(|| stem_to_filename.get(&sanitize_filename_stem(ex)))
                    {
                        claimed_audio_filenames.insert(f.clone());
                    }
                }
            }
        }

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
                        claimed_audio_filenames.insert(f.clone());
                    }
                }

                if matched_fname.is_none() {
                    let is_eligible_call = row.source == "recording"
                        || explicit_stem.is_some()
                        || row.message.contains("통화시간");
                    if is_eligible_call {
                        let target_norm = normalize_phone_digits(clean_room);
                        let target_disp = resolve_contact_display(clean_room, &contacts_map);
                        let target_key_a = normalize_call_contact_key(clean_room);
                        let target_key_b = normalize_call_contact_key(&target_disp);
                        let allow_any_date = row.source == "recording";
                        let row_sec = hms_to_seconds(&row.sent_time);
                        let mut best_same_date: Option<(i64, String)> = None;
                        let mut any_date_fallback: Option<String> = None;

                        for ca in &cached_audios {
                            if row.source == "call"
                                && claimed_audio_filenames.contains(&ca.file_name)
                            {
                                continue;
                            }
                            let is_contact_match = ca.c_disp == target_disp
                                || ca.c_disp == clean_room
                                || (!ca.c_key.is_empty()
                                    && (ca.c_key == target_key_a || ca.c_key == target_key_b))
                                || (!target_norm.is_empty()
                                    && target_norm.len() >= 8
                                    && ca.stem_digits.contains(&target_norm));
                            if is_contact_match {
                                if ca.r_d == row.sent_date {
                                    if row.source == "call" {
                                        if let (Some(rs), Some(cs)) = (row_sec, ca.r_t_sec) {
                                            let diff = (cs - rs).abs();
                                            if diff <= 120
                                                && best_same_date
                                                    .as_ref()
                                                    .map(|(bd, _)| diff < *bd)
                                                    .unwrap_or(true)
                                            {
                                                best_same_date = Some((diff, ca.file_name.clone()));
                                            }
                                        }
                                    } else {
                                        matched_fname = Some(ca.file_name.clone());
                                        break;
                                    }
                                } else if allow_any_date && any_date_fallback.is_none() {
                                    any_date_fallback = Some(ca.file_name.clone());
                                }
                            }
                        }
                        if matched_fname.is_none() {
                            if let Some((_, f)) = best_same_date {
                                claimed_audio_filenames.insert(f.clone());
                                matched_fname = Some(f);
                            } else {
                                matched_fname = any_date_fallback;
                            }
                        }
                    }
                }

                let matched_file_stem = matched_fname.as_deref().and_then(|fn_s| {
                    Path::new(fn_s)
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .filter(|s| !s.is_empty())
                });

                if let Some(ref fname) = matched_fname {
                    row.has_audio_recording = true;
                    if row.attachment_uuid.as_deref().unwrap_or("").trim().is_empty() {
                        row.attachment_uuid = Some(fname.clone());
                    }
                }

                // 4단계 스크립트 진행 상태(`transcript_stage`) 및 추가 요구사항(`transcript_requirement`) 결정
                if !row.has_audio_recording {
                    row.transcript_stage = 0;
                    row.transcript_requirement = None;
                } else {
                    let att_str = row.attachment_uuid.as_deref().unwrap_or("").trim();
                    let raw_stem_cand = matched_file_stem
                        .clone()
                        .or_else(|| explicit_stem.clone())
                        .unwrap_or_else(|| {
                            Path::new(att_str)
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .filter(|s| !s.is_empty())
                                .unwrap_or_else(|| row.room_or_sender.clone())
                        });
                    let safe_stem_cand = sanitize_filename_stem(&raw_stem_cand);
                    let meta_hit = transcript_meta_map
                        .get(&safe_stem_cand)
                        .or_else(|| transcript_meta_map.get(&raw_stem_cand))
                        .or_else(|| {
                            explicit_stem.as_ref().and_then(|ex| {
                                transcript_meta_map
                                    .get(&sanitize_filename_stem(ex))
                                    .or_else(|| transcript_meta_map.get(ex))
                            })
                        });
                    if let Some((st, req)) = meta_hit {
                        row.transcript_stage = *st;
                        if !req.trim().is_empty() {
                            row.transcript_requirement = Some(req.clone());
                        }
                    } else if att_str.starts_with("transcribed:")
                        || (row.message.starts_with("🎙️")
                            && !row.message.contains("스크립트 미생성")
                            && !row.message.contains("토큰 부족"))
                    {
                        row.transcript_stage = 2;
                    } else {
                        row.transcript_stage = 1;
                    }
                }
            }
        }
        Ok(rows)
    })
    .await
    .map_err(|e| e.to_string())?
}
