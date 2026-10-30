//! 카카오톡 대화 마크다운: 가져오기, 병합 마이그레이션, 미디어 보강, 멀티파트 파싱.

use crate::*;

/// `mobile/kakao/` 내에 폴더명(`KakaoTalk_Chats_...`)으로 잘못 생성된 `.md` 파일이 있을 경우,
/// 대화 참여자 목록을 추출하여 실제 대화방 이름(`{참여자}.md`)으로 병합·정리하고 메타데이터를 보존합니다.
pub(crate) fn migrate_raw_kakao_chat_mds(conn: &Connection) {
    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    let entries = match fs::read_dir(&kakao_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let sender_re = cached_regex!(r"^- \*\*\[([^\]]+)\]\s*([^\*]+)\*\*:\s*(.*)$");
    let date_re = cached_regex!(r"^##\s*📅\s*(\d{4}-\d{2}-\d{2})");

    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() || p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !stem.starts_with("KakaoTalk_Chats_") {
            continue;
        }
        let raw = match fs::read_to_string(&p) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let mut participants: Vec<String> = Vec::new();
        for line in raw.lines() {
            if let Some(cap) = sender_re.captures(line.trim()) {
                let s = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                if !s.is_empty() && s != "정서현" && !participants.iter().any(|x| x == s) {
                    participants.push(s.to_string());
                }
            }
        }
        let resolved_room = if participants.is_empty() {
            "정서현".to_string()
        } else if participants.len() <= 4 {
            participants.join(", ")
        } else {
            format!(
                "{} 외 {}명",
                participants[..4].join(", "),
                participants.len() - 4
            )
        };

        let mut current_date = "2026-10-30".to_string();
        for line in raw.lines() {
            let trimmed = line.trim();
            if let Some(dc) = date_re.captures(trimmed) {
                if let Some(m) = dc.get(1) {
                    current_date = m.as_str().to_string();
                }
                continue;
            }
            if let Some(sc) = sender_re.captures(trimmed) {
                let time_str = sc.get(1).map(|m| m.as_str()).unwrap_or("");
                let sender = sc.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                let body = sc.get(3).map(|m| m.as_str()).unwrap_or("");
                let md_line = format!("- **[{}] {}**: {}", time_str, sender, body);
                append_line_to_mobile_md(
                    conn,
                    "kakao",
                    &resolved_room,
                    &format!("[카카오톡 대화내역] {}", resolved_room),
                    "[\"카카오톡\", \"카톡\", \"단톡방\", \"대화내역\", \"채팅이력\", \"KakaoTalk\"]",
                    &current_date,
                    &md_line,
                );
            }
        }

        let _ = conn.execute(
            "UPDATE OR IGNORE lifelog_messages SET room_or_sender = ?1 WHERE source = 'kakaotalk' AND room_or_sender = ?2",
            params![resolved_room, stem],
        );
        let _ = conn.execute(
            "DELETE FROM lifelog_messages WHERE source = 'kakaotalk' AND room_or_sender = ?1",
            params![stem],
        );
        let _ = conn.execute(
            "DELETE FROM files WHERE full_path = ?1",
            params![p.to_string_lossy().to_string()],
        );
        let _ = fs::remove_file(&p);
    }
}

/// 카카오톡 `.md` 문서 내 이미지(`.jpg`, `.png`, `.gif`, `.webp`) 및 동영상(`.mp4`, `.mov`, `<동영상 읽지 않음>` 등)
/// 항목을 스캔하여 연결된 미디어 파일 정보 블록을 자동으로 업데이트합니다.
pub(crate) fn enrich_kakao_markdown_with_media(conn: &Connection, md_path: &Path) {
    let raw = match fs::read_to_string(md_path) {
        Ok(s) => s,
        Err(_) => return,
    };

    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    let kakao_media_dir = kakao_dir.join("media");
    let data_base: String = data_base_path_string(&conn);
    let inbox_dir = Path::new(&data_base).join("_MediaInbox");

    let find_local_media = |fname: &str| -> Option<PathBuf> {
        let clean = fname.trim().trim_matches(|c| c == '[' || c == ']' || c == '<' || c == '>');
        if clean.is_empty() {
            return None;
        }
        for dir in [&kakao_media_dir, &kakao_dir, &inbox_dir] {
            let cand = dir.join(clean);
            if cand.exists() && cand.is_file() {
                return Some(cand);
            }
        }
        // `mobile/kakao/{폴더명}/` 하위에 원본 폴더 구조 그대로 적재된 이미지·동영상 탐색
        if let Ok(entries) = fs::read_dir(&kakao_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let cand = p.join(clean);
                    if cand.exists() && cand.is_file() {
                        return Some(cand);
                    }
                }
            }
        }
        None
    };

    let img_re = cached_regex!(r"(?i)([0-9a-zA-Z가-힣_\-\.\s]{2,120}\.(?:jpg|jpeg|png|gif|webp|bmp))");
    let vid_re = cached_regex!(r"(?i)([0-9a-zA-Z가-힣_\-\.\s]{2,120}\.(?:mp4|mov|webm|mkv|avi|m4v|3gp))");

    let lines: Vec<&str> = raw.lines().collect();
    let mut out_lines: Vec<String> = Vec::with_capacity(lines.len() + 32);
    let mut changed = false;

    for i in 0..lines.len() {
        let line = lines[i];
        out_lines.push(line.to_string());

        let trimmed = line.trim();
        if !trimmed.starts_with("- **[") {
            continue;
        }
        // 다음 줄에 이미 미디어 연결 블록이 있으면 중복 추가 생략
        if i + 1 < lines.len() {
            let next_t = lines[i + 1].trim();
            if next_t.starts_with("> 🖼️")
                || next_t.starts_with("> 🎬")
                || next_t.starts_with("- 🖼️")
                || next_t.starts_with("- 🎬")
            {
                continue;
            }
        }

        let msg_part = if let Some(colon_idx) = trimmed.find("**:") {
            trimmed[colon_idx + 3..].trim()
        } else {
            continue;
        };

        if let Some(cap) = img_re.captures(msg_part) {
            if let Some(m) = cap.get(1) {
                let fname = m.as_str().trim();
                let info_line = if let Some(local_p) = find_local_media(fname) {
                    let size_kb = fs::metadata(&local_p)
                        .map(|md| md.len() / 1024)
                        .unwrap_or(0);
                    format!(
                        "  - 🖼️ **[연결된 이미지 정보]** `{}` ({} KB · 로컬 미디어 연결됨)",
                        fname, size_kb
                    )
                } else {
                    format!(
                        "  - 🖼️ **[연결된 이미지 정보]** `{}` (카카오톡 첨부 이미지)",
                        fname
                    )
                };
                out_lines.push(info_line);
                changed = true;
                continue;
            }
        }

        if let Some(cap) = vid_re.captures(msg_part) {
            if let Some(m) = cap.get(1) {
                let fname = m.as_str().trim();
                let info_line = if let Some(local_p) = find_local_media(fname) {
                    let size_kb = fs::metadata(&local_p)
                        .map(|md| md.len() / 1024)
                        .unwrap_or(0);
                    format!(
                        "  - 🎬 **[연결된 동영상 정보]** `{}` ({} KB · 로컬 동영상 연결됨)",
                        fname, size_kb
                    )
                } else {
                    format!(
                        "  - 🎬 **[연결된 동영상 정보]** `{}` (카카오톡 첨부 동영상)",
                        fname
                    )
                };
                out_lines.push(info_line);
                changed = true;
                continue;
            }
        }

        if msg_part == "동영상"
            || msg_part.contains("<동영상")
            || msg_part.starts_with("동영상 ")
        {
            out_lines.push(format!(
                "  - 🎬 **[연결된 동영상 정보]** `{}` (카카오톡 동영상 미디어 항목)",
                msg_part
            ));
            changed = true;
        } else if msg_part == "사진"
            || msg_part.contains("<사진")
            || msg_part.starts_with("사진 ")
        {
            out_lines.push(format!(
                "  - 🖼️ **[연결된 이미지 정보]** `{}` (카카오톡 사진 미디어 항목)",
                msg_part
            ));
            changed = true;
        }
    }

    if changed {
        let updated = out_lines.join("\n") + "\n";
        let _ = fs::write(md_path, updated.as_bytes());
    }
}

#[tauri::command]
pub(crate) fn import_kakao_chat_text(
    state: State<AppState>,
    room_name: String,
    raw_text: String,
) -> Result<KakaoImportResult, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let date_re = cached_regex!(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일");
    let msg_re = cached_regex!(r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$");

    let mut current_date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut inserted_count = 0usize;

    for line in raw_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("---") {
            if let Some(cap) = date_re.captures(trimmed) {
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

        if let Some(cap) = msg_re.captures(trimmed) {
            let sender = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let time_str = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let body = cap.get(3).map(|m| m.as_str()).unwrap_or("");

            let dedup_raw = format!(
                "kakao|{}|{}|{}|{}|{}",
                room_name, current_date, time_str, sender, body
            );
            let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

            let affected = conn
                .execute(
                    "INSERT OR IGNORE INTO lifelog_messages
                     (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key)
                     VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6)",
                    params![room_name, sender, body, current_date, time_str, dedup_key],
                )
                .map_err(|e| e.to_string())?;
            if affected > 0 {
                inserted_count += 1;
            }
        }
    }

    Ok(KakaoImportResult { inserted_count })
}

/// `multipart/form-data` 바디에서 `file_hash`, `folder_name`, `folder_index`, `total_folders`, 그리고 순수 `KakaoTalkChats.txt` 본문을 분리 추출합니다.
pub(crate) fn parse_multipart_kakao_payload(body_str: &str) -> (String, String, String, usize, usize) {
    let mut folder_name = String::new();
    let mut file_hash = String::new();
    let mut folder_index = 1usize;
    let mut total_folders = 1usize;
    let mut clean_content = body_str.to_string();

    {
        let re_fh = cached_regex!(r#"name="file_hash"[\s\S]*?\r?\n\r?\n([0-9a-fA-F]{32,128})"#);
        if let Some(cap) = re_fh.captures(body_str) {
            if let Some(m) = cap.get(1) {
                file_hash = m.as_str().trim().to_string();
            }
        }
    }
    {
        let re_fn = cached_regex!(r#"name="folder_name"[\s\S]*?\r?\n\r?\n([^\r\n]+)"#);
        if let Some(cap) = re_fn.captures(body_str) {
            if let Some(m) = cap.get(1) {
                folder_name = m.as_str().trim().to_string();
            }
        }
    }
    {
        let re_fi = cached_regex!(r#"name="folder_index"[\s\S]*?\r?\n\r?\n(\d+)"#);
        if let Some(cap) = re_fi.captures(body_str) {
            if let Some(m) = cap.get(1) {
                folder_index = m.as_str().trim().parse::<usize>().unwrap_or(1).max(1);
            }
        }
    }
    {
        let re_tf = cached_regex!(r#"name="total_folders"[\s\S]*?\r?\n\r?\n(\d+)"#);
        if let Some(cap) = re_tf.captures(body_str) {
            if let Some(m) = cap.get(1) {
                total_folders = m.as_str().trim().parse::<usize>().unwrap_or(1).max(1);
            }
        }
    }

    if let Some(file_idx) = body_str.find("filename=\"") {
        let after_crlf = body_str[file_idx..].find("\r\n\r\n").map(|i| file_idx + i + 4);
        let after_lf = body_str[file_idx..].find("\n\n").map(|i| file_idx + i + 2);
        let start_pos = match (after_crlf, after_lf) {
            (Some(a), Some(b)) => Some(std::cmp::min(a, b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };
        if let Some(sp) = start_pos {
            let mut slice = body_str[sp..].to_string();
            {
                let re_tail = cached_regex!(r"\r?\n--[0-9a-fA-F\-]{8,}--\s*$");
                slice = re_tail.replace(&slice, "").to_string();
            }
            clean_content = slice.trim_start_matches('\u{feff}').trim().to_string();
        }
    }

    (folder_name, file_hash, clean_content, folder_index, total_folders)
}

/// 카카오톡 대화 `.md` 문서 상단 프론트매터에 원본 적재 폴더(`raw_folder`), 참여자, 중복/신규 건수, `last_kakao_ts` 메타데이터를 갱신합니다.
pub(crate) fn upsert_kakao_metadata_in_md(
    conn: &Connection,
    room_name: &str,
    raw_folder_name: &str,
    participants: &[String],
    overlapping_count: usize,
    messages_added: usize,
    last_kakao_ts: i64,
) {
    let kakao_dir = get_archive_mobile_dir(conn, "kakao");
    let safe_stem = sanitize_filename_stem(room_name);
    let md_path = kakao_dir.join(format!("{}.md", safe_stem));
    if !md_path.exists() {
        return;
    }
    let Ok(raw_md) = fs::read_to_string(&md_path) else {
        return;
    };
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut media_count = 0usize;
    if !raw_folder_name.is_empty() {
        let folder_path = kakao_dir.join(sanitize_filename_stem(raw_folder_name));
        if let Ok(entries) = fs::read_dir(&folder_path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let fname = p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    if fname != "kakaotalkchats.txt" && !fname.ends_with(".md") {
                        media_count += 1;
                    }
                }
            }
        }
    }

    let part_json = serde_json::to_string(participants).unwrap_or_else(|_| "[]".to_string());
    let raw_folder_rel = if raw_folder_name.is_empty() {
        "mobile/kakao".to_string()
    } else {
        format!("mobile/kakao/{}", sanitize_filename_stem(raw_folder_name))
    };

    if raw_md.starts_with("---\n") || raw_md.starts_with("---\r\n") {
        let sep = if raw_md.starts_with("---\r\n") { "\r\n" } else { "\n" };
        if let Some(end_idx) = raw_md[4..].find(&format!("{}---", sep)) {
            let fm_end = 4 + end_idx;
            let fm_block = &raw_md[4..fm_end];
            let body_rest = &raw_md[fm_end + 4..];
            let mut kept_lines: Vec<String> = Vec::new();
            for line in fm_block.lines() {
                let t = line.trim();
                if t.starts_with("last_synced:")
                    || t.starts_with("raw_folder:")
                    || t.starts_with("participants:")
                    || t.starts_with("overlapping_messages:")
                    || t.starts_with("newly_added_messages:")
                    || t.starts_with("media_files_in_folder:")
                    || t.starts_with("last_kakao_ts:")
                {
                    continue;
                }
                kept_lines.push(line.to_string());
            }
            kept_lines.push(format!("raw_folder: \"{}\"", raw_folder_rel));
            kept_lines.push(format!("participants: {}", part_json));
            kept_lines.push(format!("overlapping_messages: {}", overlapping_count));
            kept_lines.push(format!("newly_added_messages: {}", messages_added));
            kept_lines.push(format!("media_files_in_folder: {}", media_count));
            kept_lines.push(format!("last_kakao_ts: {}", last_kakao_ts));
            kept_lines.push(format!("last_synced: \"{}\"", now_str));
            let updated = format!("---\n{}\n---{}", kept_lines.join("\n"), body_rest);
            let _ = fs::write(&md_path, updated.as_bytes());
        }
    }
}
