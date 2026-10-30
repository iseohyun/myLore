//! 통화/음성 녹음 마크다운 작성, 라이프로그 DB 반영, 녹음 파일 탐색·재생 정보.

use crate::*;

/// 통화 녹음 파일과 동일한 파일명(`mobile/calls/{audio_file_stem}.md`)으로
/// 1) 요약부(`## 💡 요약`)와 2) 스크립트(`## 📜 스크립트`) 2부분 구조의 마크다운 파일을 생성/갱신합니다.
pub(crate) fn write_call_recording_markdown(
    conn: &Connection,
    audio_file_name: &str,
    contact_display: &str,
    recorded_date: &str,
    recorded_time: &str,
    transcript_opt: Option<&str>,
    quota_error_info: Option<(&str, &str, &str)>, // (exhausted_at_str, retry_after_str, error_msg)
) -> PathBuf {
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    let raw_stem = Path::new(audio_file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| audio_file_name.to_string());
    let safe_stem = sanitize_filename_stem(&raw_stem);
    let md_path = calls_dir.join(format!("{}.md", safe_stem));
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 기존 파일에 UUID가 있으면 유지
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

    let (status_str, summary_body, script_body) = if let Some(tr) = transcript_opt.filter(|s| !s.trim().is_empty()) {
        let (sum_s, scr_s) = split_summary_and_transcript(tr);
        let norm_scr = normalize_script_lines_with_timestamps_and_clean_name(
            &scr_s,
            contact_display,
            &raw_stem,
        );
        ("completed", sum_s, norm_scr)
    } else if let Some((ex_at, retry_at, err_m)) = quota_error_info {
        (
            "pending_quota",
            format!(
                "> ⚠️ **LLM 토큰 부족/한도 초과로 인해 아직 요약이 생성되지 않았습니다.**\n\
                 > - **토큰 고갈 감지 시점**: `{}`\n\
                 > - **5시간 후 자동 재시도 예정 시점**: **`{}`**\n\
                 > - **상세 사유**: {}",
                ex_at, retry_at, err_m
            ),
            format!(
                "> ⏳ **5시간 후(`{}`)에 자동으로 LLM 스크립트 변환을 재시도합니다.**\n\
                 > *(상단 `[🔄 지금 즉시 스크립트 생성 재시도]` 버튼을 눌러 즉시 재시도할 수도 있습니다.)*",
                retry_at
            ),
        )
    } else {
        (
            "pending_quota",
            "> ⏳ **LLM 통화 요약 생성 대기 중입니다.** (자동 변환 스케줄러가 순차 처리하거나 5시간 후 자동 재시도합니다.)".to_string(),
            "> ⏳ **LLM 화자 분리 스크립트 생성 대기 중입니다.**".to_string(),
        )
    };

    let md_content = format!(
        "---\n\
         uuid: \"{}\"\n\
         title: \"{}\"\n\
         category: \"mobile/calls\"\n\
         audio_file: \"audio/{}\"\n\
         contact_name: \"{}\"\n\
         recorded_date: \"{}\"\n\
         recorded_time: \"{}\"\n\
         transcript_status: \"{}\"\n\
         device_aliases: [\"핸드폰\", \"휴대폰\", \"스마트폰\", \"갤럭시\", \"모바일\"]\n\
         source_aliases: [\"통화\", \"통화내역\", \"통화녹음\", \"통화스크립트\", \"전화\"]\n\
         last_synced: \"{}\"\n\
         ---\n\n\
         # 📞 {}\n\n\
         > **통화 상대방**: {} | **통화 일시**: {} {} | **원본 녹음파일**: `audio/{}`\n\n\
         ## 💡 요약\n\n\
         {}\n\n\
         ---\n\n\
         ## 📜 스크립트\n\n\
         {}\n",
        doc_uuid,
        contact_display.replace('"', "\\\""),
        audio_file_name.replace('"', "\\\""),
        contact_display.replace('"', "\\\""),
        recorded_date,
        recorded_time,
        status_str,
        now_str,
        contact_display,
        contact_display,
        recorded_date,
        recorded_time,
        audio_file_name,
        summary_body,
        script_body
    );

    let _ = fs::write(&md_path, md_content.as_bytes());
    md_path
}

/// 독백녹음·회의녹음(`mobile/recordings/{audio_file_stem}.md`) 마크다운 생성/갱신
/// 녹음 출처(`recording_source`: 기기명 예 `SM-S901N` 또는 `갤럭시 워치`)를 구분하여 저장하며,
/// 음성메모·회의록 톤의 요약부(`## 💡 요약`)와 스크립트(`## 📜 스크립트`) 2부분으로 작성합니다.
pub(crate) fn write_voice_recording_markdown(
    conn: &Connection,
    audio_file_name: &str,
    recording_source: &str,
    recorded_date: &str,
    recorded_time: &str,
    transcript_opt: Option<&str>,
    quota_error_info: Option<(&str, &str, &str)>,
) -> PathBuf {
    let rec_dir = get_archive_mobile_dir(conn, "recordings");
    let raw_stem = Path::new(audio_file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| audio_file_name.to_string());
    let safe_stem = sanitize_filename_stem(&raw_stem);
    let md_path = rec_dir.join(format!("{}.md", safe_stem));
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

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

    let (status_str, summary_body, script_body) = if let Some(tr) = transcript_opt.filter(|s| !s.trim().is_empty()) {
        let (sum_s, scr_s) = split_summary_and_transcript(tr);
        let norm_scr = normalize_script_lines_with_timestamps_and_clean_name(
            &scr_s,
            recording_source,
            &raw_stem,
        );
        ("completed", sum_s, norm_scr)
    } else if let Some((ex_at, retry_at, err_m)) = quota_error_info {
        (
            "pending_quota",
            format!(
                "> ⚠️ **LLM 토큰 부족/한도 초과로 인해 아직 음성메모·회의 요약이 생성되지 않았습니다.**\n\
                 > - **토큰 고갈 감지 시점**: `{}`\n\
                 > - **5시간 후 자동 재시도 예정 시점**: **`{}`**\n\
                 > - **상세 사유**: {}",
                ex_at, retry_at, err_m
            ),
            format!(
                "> ⏳ **5시간 후(`{}`)에 자동으로 LLM 음성녹음 스크립트 변환을 재시도합니다.**",
                retry_at
            ),
        )
    } else {
        (
            "pending_quota",
            "> ⏳ **음성메모/회의록 핵심 요약 및 Action Items 추출 대기 중입니다.** (우클릭 메뉴에서 '스크립트 추출 및 요약'을 실행하거나 자동 추출을 기다려 주세요.)".to_string(),
            "> ⏳ **음성메모/회의 전체 스크립트 생성 대기 중입니다.**".to_string(),
        )
    };

    let icon = if recording_source.contains("워치") {
        "⌚"
    } else {
        "🎙️"
    };

    let md_content = format!(
        "---\n\
         uuid: \"{}\"\n\
         title: \"{}\"\n\
         category: \"mobile/recordings\"\n\
         audio_file: \"audio/{}\"\n\
         recording_source: \"{}\"\n\
         recorded_date: \"{}\"\n\
         recorded_time: \"{}\"\n\
         transcript_status: \"{}\"\n\
         device_aliases: [\"핸드폰\", \"휴대폰\", \"갤럭시\", \"워치\", \"갤럭시워치\", \"음성메모\"]\n\
         source_aliases: [\"녹음\", \"음성녹음\", \"음성메모\", \"회의녹음\", \"독백녹음\"]\n\
         last_synced: \"{}\"\n\
         ---\n\n\
         # {} [{}] {}\n\n\
         > **녹음 출처**: `{}` | **녹음 일시**: {} {} | **원본 녹음파일**: `audio/{}`\n\n\
         ## 💡 요약\n\n\
         {}\n\n\
         ---\n\n\
         ## 📜 스크립트\n\n\
         {}\n",
        doc_uuid,
        safe_stem.replace('"', "\\\""),
        audio_file_name.replace('"', "\\\""),
        recording_source.replace('"', "\\\""),
        recorded_date,
        recorded_time,
        status_str,
        now_str,
        icon,
        recording_source,
        safe_stem,
        recording_source,
        recorded_date,
        recorded_time,
        audio_file_name,
        summary_body,
        script_body
    );

    let _ = fs::write(&md_path, md_content.as_bytes());
    md_path
}

/// 단일 통화녹음 또는 음성녹음 항목만 즉시 `lifelog_messages`에 $O(1)$로 반영합니다 (전체 폴더 풀스캔 방지).
pub(crate) fn upsert_single_recording_into_lifelog_db(
    conn: &Connection,
    is_voice_memo: bool,
    file_stem: &str,
    display_or_source: &str,
    rec_date: &str,
    rec_time: &str,
    transcript_opt: Option<&str>,
    dev_id: &str,
    dev_name: &str,
) {
    let safe_stem = sanitize_filename_stem(file_stem);
    let is_completed = transcript_opt
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let mut summary_preview = String::new();
    if let Some(tr) = transcript_opt {
        let (sum_s, _) = split_summary_and_transcript(tr);
        for line in sum_s.lines() {
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

    let attach_tag = if is_completed {
        format!("transcribed:{}", safe_stem)
    } else {
        format!("pending_transcript:{}", safe_stem)
    };

    if is_voice_memo {
        let dedup_key = format!("voice_rec|{}", safe_stem);
        let source_badge = if display_or_source.contains("워치") {
            "⌚ 워치"
        } else {
            display_or_source
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
        let eff_dev_id = if dev_id.is_empty() {
            "dev_c6ffadd525"
        } else {
            dev_id
        };
        let eff_dev_name = if dev_name.is_empty() {
            display_or_source
        } else {
            dev_name
        };
        let _ = conn.execute(
            "INSERT INTO lifelog_messages
             (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
             VALUES ('recording', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
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
                display_or_source,
                msg_text,
                rec_date,
                rec_time,
                attach_tag,
                dedup_key,
                eff_dev_id,
                eff_dev_name
            ],
        );
    } else {
        let dedup_key = format!("call_rec|{}", safe_stem);
        let msg_text = if is_completed {
            if summary_preview.is_empty() {
                format!(
                    "🎙️ [통화 스크립트 완료] {} ({})",
                    display_or_source, safe_stem
                )
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
                    display_or_source,
                    safe_stem
                )
            } else {
                format!(
                    "⚠️ [스크립트 미생성 · 자동 변환 대기] {} ({})",
                    display_or_source, safe_stem
                )
            }
        };
        let eff_dev_name = if dev_name.is_empty() {
            "모바일 통화녹음"
        } else {
            dev_name
        };
        let _ = conn.execute(
            "INSERT INTO lifelog_messages
             (source, room_or_sender, sender, message, sent_date, sent_time, attachment_uuid, dedup_key, device_id, device_name)
             VALUES ('call', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(dedup_key) DO UPDATE SET
                room_or_sender = excluded.room_or_sender,
                sender = excluded.sender,
                message = excluded.message,
                sent_date = excluded.sent_date,
                sent_time = excluded.sent_time,
                attachment_uuid = excluded.attachment_uuid",
            params![
                safe_stem,
                display_or_source,
                msg_text,
                rec_date,
                rec_time,
                attach_tag,
                dedup_key,
                dev_id,
                eff_dev_name
            ],
        );
    }
}

/// 오디오 파일 앞부분 16바이트만 확인하여 Multipart 헤더(`--`)로 시작할 때에만 전체 파일을 읽어 복구합니다 (대용량 오디오 불필요 I/O 제거).
pub(crate) fn repair_multipart_audio_file_if_needed(p: &Path) {
    use std::io::Read;
    if let Ok(mut f) = fs::File::open(p) {
        let mut head = [0u8; 16];
        let n = f.read(&mut head).unwrap_or(0);
        if n >= 2 && head.starts_with(b"--") {
            drop(f);
            if let Ok(raw_bytes) = fs::read(p) {
                let (clean_bytes, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
                if repaired {
                    let _ = fs::write(p, &clean_bytes);
                }
            }
        }
    }
}

pub(crate) fn normalize_call_contact_key(raw: &str) -> String {
    let mut s = raw
        .trim()
        .trim_start_matches("통화 녹음 ")
        .trim_start_matches("통화 녹음_")
        .trim_start_matches("통화녹음 ")
        .trim_start_matches("통화녹음_")
        .trim_start_matches("Call_")
        .trim()
        .to_string();
    if let Ok(re_paren_phone) = Regex::new(r"\s*\([0-9+\-\s]{7,}\)\s*$") {
        s = re_paren_phone.replace(&s, "").to_string();
    }
    s.trim().trim_start_matches('#').trim().to_lowercase()
}

/// 통화(`mobile/calls/audio/`) 또는 음성녹음(`mobile/recordings/audio/`) 항목으로부터 실제 오디오 파일과 `.md` 문서를 찾습니다.
pub(crate) fn find_call_audio_and_md(
    conn: &Connection,
    room_or_sender: &str,
    attachment_uuid: Option<&str>,
) -> Option<(PathBuf, String, String, PathBuf, bool)> {
    find_call_audio_and_md_ext(conn, room_or_sender, attachment_uuid, None, true)
}

pub(crate) fn find_call_audio_and_md_ext(
    conn: &Connection,
    room_or_sender: &str,
    attachment_uuid: Option<&str>,
    expected_date: Option<&str>,
    allow_any_date_fallback: bool,
) -> Option<(PathBuf, String, String, PathBuf, bool)> {
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    let calls_audio_dir = calls_dir.join("audio");
    let rec_dir = get_archive_mobile_dir(conn, "recordings");
    let rec_audio_dir = rec_dir.join("audio");

    let explicit_stem = attachment_uuid
        .and_then(|a| {
            a.strip_prefix("transcribed:")
                .or_else(|| a.strip_prefix("pending_transcript:"))
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let clean_room = room_or_sender
        .trim()
        .trim_start_matches("[워치]")
        .trim_start_matches("[SM-S901N]")
        .trim();

    let mut matched_audio_path: Option<PathBuf> = None;
    let mut matched_parent_dir: PathBuf = calls_dir.clone();

    if let Some(ref stem) = explicit_stem {
        for (a_dir, p_dir) in [(&calls_audio_dir, &calls_dir), (&rec_audio_dir, &rec_dir)] {
            for ext in ["m4a", "amr", "mp3", "wav", "ogg", "aac"] {
                let cand = a_dir.join(format!("{}.{}", stem, ext));
                if cand.exists() && cand.is_file() {
                    matched_audio_path = Some(cand);
                    matched_parent_dir = p_dir.clone();
                    break;
                }
            }
            if matched_audio_path.is_some() {
                break;
            }
        }
    }

    if matched_audio_path.is_none() {
        let contacts_map = load_mobile_contacts_map(conn);
        let target_norm = normalize_phone_digits(clean_room);
        let target_disp = resolve_contact_display(clean_room, &contacts_map);
        let target_key_a = normalize_call_contact_key(clean_room);
        let target_key_b = normalize_call_contact_key(&target_disp);

        for (a_dir, p_dir) in [(&rec_audio_dir, &rec_dir), (&calls_audio_dir, &calls_dir)] {
            if let Ok(entries) = fs::read_dir(a_dir) {
                let mut same_date_candidates: Vec<(String, PathBuf)> = Vec::new();
                let mut any_date_candidates: Vec<(String, PathBuf)> = Vec::new();
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
                    let stem = p
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    let safe_stem = sanitize_filename_stem(&stem);
                    if let Some(ref ex) = explicit_stem {
                        if safe_stem == sanitize_filename_stem(ex) {
                            matched_audio_path = Some(p);
                            matched_parent_dir = p_dir.clone();
                            break;
                        }
                    }
                    if safe_stem == sanitize_filename_stem(clean_room)
                        || safe_stem == sanitize_filename_stem(room_or_sender)
                    {
                        matched_audio_path = Some(p);
                        matched_parent_dir = p_dir.clone();
                        break;
                    }
                    let (c_disp, r_d, r_t) = parse_call_audio_filename_meta(&stem, &contacts_map);
                    let c_key = normalize_call_contact_key(&c_disp);
                    let stem_digits = normalize_phone_digits(&stem);
                    let is_contact_match = c_disp == target_disp
                        || c_disp == clean_room
                        || (!c_key.is_empty() && (c_key == target_key_a || c_key == target_key_b))
                        || (!target_norm.is_empty()
                            && target_norm.len() >= 8
                            && stem_digits.contains(&target_norm));

                    if is_contact_match {
                        let sort_key = format!("{}_{}_{}", r_d, r_t, stem);
                        if let Some(exp_d) = expected_date {
                            if r_d == exp_d {
                                same_date_candidates.push((sort_key.clone(), p.clone()));
                            }
                        }
                        any_date_candidates.push((sort_key, p));
                    }
                }
                if matched_audio_path.is_none() {
                    if !same_date_candidates.is_empty() {
                        same_date_candidates.sort_by(|a, b| b.0.cmp(&a.0));
                        matched_audio_path = same_date_candidates.into_iter().next().map(|(_, p)| p);
                        matched_parent_dir = p_dir.clone();
                    } else if allow_any_date_fallback && !any_date_candidates.is_empty() {
                        any_date_candidates.sort_by(|a, b| b.0.cmp(&a.0));
                        matched_audio_path = any_date_candidates.into_iter().next().map(|(_, p)| p);
                        matched_parent_dir = p_dir.clone();
                    }
                }
            }
            if matched_audio_path.is_some() {
                break;
            }
        }
    }

    let audio_path = matched_audio_path?;
    let file_name = audio_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_stem = audio_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let safe_stem = sanitize_filename_stem(&file_stem);
    let md_path = matched_parent_dir.join(format!("{}.md", safe_stem));
    let mut has_transcript = false;
    if md_path.exists() {
        if let Ok(md_raw) = fs::read_to_string(&md_path) {
            let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
            if fm.get("transcript_status").map(|s| s.as_str()) == Some("completed") {
                has_transcript = true;
            }
        }
    }

    Some((audio_path, file_name, file_stem, md_path, has_transcript))
}

#[tauri::command]
pub(crate) async fn get_call_recording_play_info(
    state: State<'_, AppState>,
    room_or_sender: String,
    attachment_uuid: Option<String>,
) -> Result<CallPlayInfoPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let (audio_path, file_name, file_stem, _, has_transcript) =
            find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
                .ok_or_else(|| "해당 항목의 원본 녹음 오디오 파일이 다운로드되어 있지 않습니다.".to_string())?;

        let raw_bytes =
            fs::read(&audio_path).map_err(|e| format!("오디오 파일 읽기 오류: {}", e))?;
        let (clean_b, repaired) = strip_multipart_prefix_if_present(&raw_bytes);
        if repaired {
            let _ = fs::write(&audio_path, &clean_b);
        }

        let lower_fn = file_name.to_lowercase();
        let mime_type = if lower_fn.ends_with(".m4a") || lower_fn.ends_with(".mp4") {
            "audio/mp4".to_string()
        } else if lower_fn.ends_with(".mp3") {
            "audio/mpeg".to_string()
        } else if lower_fn.ends_with(".wav") {
            "audio/wav".to_string()
        } else if lower_fn.ends_with(".ogg") {
            "audio/ogg".to_string()
        } else if lower_fn.ends_with(".amr") {
            "audio/amr".to_string()
        } else if lower_fn.ends_with(".aac") {
            "audio/aac".to_string()
        } else {
            "audio/mp4".to_string()
        };
        let audio_base64 = base64_encode(&clean_b);

        let is_voice_rec = audio_path
            .to_string_lossy()
            .replace('\\', "/")
            .contains("/recordings/");
        let contact_display = if is_voice_rec {
            let (disp, _, _, _) = parse_voice_recording_filename_meta(&file_stem, "SM-S901N");
            disp
        } else {
            let contacts_map = load_mobile_contacts_map(&conn);
            let (c_disp, _, _) = parse_call_audio_filename_meta(&file_stem, &contacts_map);
            c_disp
        };

        let encoded_fn: String = file_name
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
                    (b as char).to_string()
                } else {
                    format!("%{:02X}", b)
                }
            })
            .collect();
        let sub_folder = if is_voice_rec {
            "recordings/audio"
        } else {
            "calls/audio"
        };
        let audio_url = format!(
            "http://127.0.0.1:18443/api/v1/local-media?sub={}&file={}",
            sub_folder, encoded_fn
        );

        Ok(CallPlayInfoPayload {
            audio_url,
            full_path: audio_path.to_string_lossy().to_string(),
            file_name,
            contact_display,
            has_transcript,
            audio_base64,
            mime_type,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
