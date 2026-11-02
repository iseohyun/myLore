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

/// 카카오톡 발신자/대화방명 및 메시지 본문을 기반으로 비즈니스·광고·알림톡 채널 여부를 판별합니다.
pub(crate) fn is_kakao_business_or_alimtalk_channel(
    conn: &Connection,
    sender: &str,
    message: &str,
) -> bool {
    let s = sender.trim();
    let m = message.trim();
    if s.is_empty() {
        return false;
    }

    // 1) 사용자가 명시적으로 지정한 자동 업데이트(비즈니스/광고) 채널 테이블 조회
    let in_auto_table: bool = conn
        .query_row(
            "SELECT 1 FROM kakao_auto_channels WHERE channel_name = ?1 LIMIT 1",
            params![s],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if in_auto_table {
        return true;
    }

    // 2) 메시지 본문 패턴: (광고), [광고], 무료수신거부, [채널명] 알림톡 포맷 등
    if m.starts_with("(광고)")
        || m.starts_with("[광고]")
        || m.contains("무료수신거부")
        || m.contains("수신거부")
        || m.contains("개인정보 이용·제공 내역")
        || m.contains("개인정보 이용제공내역")
        || m.contains("채널 추가하고")
        || m.contains("알림톡 도착")
    {
        return true;
    }
    let bracket_prefix = format!("[{}]", s);
    if m.starts_with(&bracket_prefix) {
        return true;
    }

    // 3) 대표적인 비즈니스/금융/쇼핑/공공기관 채널 키워드 매칭
    const KNOWN_CHANNELS: &[&str] = &[
        "거제시", "신한카드", "쿠팡", "토스", "카카오페이", "카카오뱅크", "제로페이",
        "가나스윔", "거제 반다비 체육센터", "카카오비즈니스 파트너센터", "한끼통살", "미닉스",
        "아정당 이사", "TMAP", "카카오톡 선물하기", "배달의민족", "NICE지키미", "노벨피아",
        "토스뱅크", "NH멤버스", "신한은행", "거제오션사이드수영장", "기장군도시관리공단",
        "카카오이모티콘", "한화생명", "다이소멤버십", "비플페이", "윙잇", "진에어",
        "아시아나항공", "IBK기업은행", "티머니", "경남에너지", "거제시립도서관", "코레일 기차",
        "퀸잇", "010휘슬", "더아파트", "자리톡 월세 카드결제", "페이히어 알림", "농협하나로마트",
        "국세청", "국민연금 전자문서", "토스페이먼츠", "SC제일은행", "한국연구재단",
        "한국결제네트웍스", "퀵계좌이체", "LG전자 물류센터", "11번가", "Klip",
        "한국교통안전공단 알림톡", "카카오 서비스 결제 안내", "맘스터치", "해피포인트",
        "뱅크샐러드", "도미노피자", "국민건강보험공단", "랭킹닭컴", "한화손해보험",
        "카카오비즈니스", "카카오톡 지갑", "KB국민카드", "토스오더", "CJ대한통운",
        "카카오계정", "페이타랩", "카카오페이 고객센터", "LG ThinQ", "튼튼머니", "농협몰",
        "공유누리", "금융결제원", "티머니GO", "로보락 기술지원", "에쓰오일", "한국도로교통공단",
        "카카오 톡딜", "GSNPOINT", "한국정보인증", "여기어때", "카카오 T",
        "거붕백병원건강증진센터", "우리은행", "모바일 신분증", "말해보카", "케이뱅크",
        "삼성전자로지텍", "한국전력공사", "해양에너지", "국민신문고", "현대해상",
    ];
    if KNOWN_CHANNELS.iter().any(|&ch| ch == s) {
        return true;
    }

    for suffix in [
        "카드", "은행", "페이", "택배", "고객센터", "알림톡", "공단", "공사", "청", "도서관",
        "멤버스", "멤버십", "선물하기", "마트", "백화점", "병원", "의원", "약국", "손해보험",
        "생명", "해상", "물류센터",
    ] {
        if s.ends_with(suffix) && s.chars().count() >= 3 {
            return true;
        }
    }

    false
}

/// 비즈니스/알림톡 채널 메시지를 `Mobile/kakao/{채널명}.md` 및 `lifelog_messages(source='kakaotalk')`에 자동 기록합니다.
fn auto_record_kakao_channel_message(
    conn: &Connection,
    channel_name: &str,
    message: &str,
    sent_date: &str,
    sent_time: &str,
) {
    let clean_room = channel_name.trim();
    if clean_room.is_empty() {
        return;
    }
    let clean_body = message.trim().replace("\r\n", "\n").replace('\n', "<br/>");
    let dedup_raw = format!(
        "kakao|{}|{}|{}|{}|{}",
        clean_room, sent_date, sent_time, clean_room, clean_body
    );
    let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

    let affected = conn
        .execute(
            "INSERT OR IGNORE INTO lifelog_messages
             (source, room_or_sender, sender, message, sent_date, sent_time, dedup_key)
             VALUES ('kakaotalk', ?1, ?2, ?3, ?4, ?5, ?6)",
            params![clean_room, clean_room, clean_body, sent_date, sent_time, dedup_key],
        )
        .unwrap_or(0);

    if affected > 0 {
        let md_line = format!("- **[{}] {}**: {}", sent_time, clean_room, clean_body);
        append_line_to_mobile_md(
            conn,
            "kakao",
            clean_room,
            &format!("[카카오톡 채널/알림톡] {}", clean_room),
            "[\"카카오톡\", \"채널\", \"알림톡\", \"비즈니스\", \"KakaoTalk\"]",
            sent_date,
            &md_line,
        );
    }
}

/// `lifelog_messages (source='notification', room_or_sender='com.kakao.talk')` 알림을 전수 검사하여:
/// 1) 내보내기 시스템 알림(`KakaoTalk_Chats_... 저장되었습니다`) → 즉시 삭제
/// 2) 비즈니스/광고/알림톡 채널 → `Mobile/kakao/{채널명}.md` 자동 기록 후 알림 삭제
/// 3) 일반 개인톡/단톡방 → 결재창 `kakao_update_requests` 보고서 테이블에 누적 등록 후 원본 카톡 알림 즉시 삭제
pub(crate) fn process_and_consume_kakao_notifications(conn: &Connection) -> usize {
    let mut rows: Vec<(i64, String, String, String, String)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, sender, message, sent_date, sent_time
         FROM lifelog_messages
         WHERE source = 'notification' AND room_or_sender = 'com.kakao.talk'
         ORDER BY id ASC",
    ) {
        if let Ok(mapped) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        }) {
            for item in mapped.flatten() {
                rows.push(item);
            }
        }
    }

    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut consumed_count = 0usize;

    for (noti_id, sender, message, sent_date, sent_time) in rows {
        let s = sender.trim();
        let m = message.trim();

        // 1) 내보내기 완료 시스템 알림 등 노이즈 즉시 삭제
        if s.is_empty()
            || s.starts_with("KakaoTalk_Chats_")
            || m == "저장되었습니다."
            || s == "카카오톡"
        {
            let _ = conn.execute("DELETE FROM lifelog_messages WHERE id = ?1", params![noti_id]);
            consumed_count += 1;
            continue;
        }

        // 2) 비즈니스 / 알림톡 / 광고 채널: 카톡 대화방 문서에 자동 기록 후 알림 삭제
        if is_kakao_business_or_alimtalk_channel(conn, s, m) {
            auto_record_kakao_channel_message(conn, s, m, &sent_date, &sent_time);
            let _ = conn.execute(
                "DELETE FROM kakao_update_requests WHERE room_name = ?1",
                params![s],
            );
            let _ = conn.execute("DELETE FROM lifelog_messages WHERE id = ?1", params![noti_id]);
            consumed_count += 1;
            continue;
        }

        // 3) 개인톡/단톡방: 이미 해당 시각 이후에 카톡 대화 내보내기가 동기화되었는지 확인
        let noti_ts = parse_korean_date_time_to_epoch_ms(&sent_date, &sent_time);
        let synced_ts: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(last_message_ts), 0) FROM kakao_room_sync_state WHERE room_name = ?1",
                params![s],
                |r| r.get(0),
            )
            .unwrap_or(0);

        if synced_ts <= 0 || noti_ts > synced_ts + 60_000 {
            let preview: String = m.replace('\n', " ").chars().take(80).collect();
            let _ = conn.execute(
                "INSERT INTO kakao_update_requests
                 (room_name, pending_noti_count, last_sender, last_message_preview, last_noti_date, last_noti_time, last_noti_ts, updated_at)
                 VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(room_name) DO UPDATE SET
                   pending_noti_count = kakao_update_requests.pending_noti_count + 1,
                   last_sender = excluded.last_sender,
                   last_message_preview = excluded.last_message_preview,
                   last_noti_date = CASE WHEN excluded.last_noti_ts >= kakao_update_requests.last_noti_ts THEN excluded.last_noti_date ELSE kakao_update_requests.last_noti_date END,
                   last_noti_time = CASE WHEN excluded.last_noti_ts >= kakao_update_requests.last_noti_ts THEN excluded.last_noti_time ELSE kakao_update_requests.last_noti_time END,
                   last_noti_ts = MAX(kakao_update_requests.last_noti_ts, excluded.last_noti_ts),
                   updated_at = excluded.updated_at",
                params![s, s, preview, sent_date, sent_time, noti_ts, now_str],
            );
        }

        // 보고서에 반영 완료된 원본 카톡 알림은 알림 테이블에서 즉시 삭제
        let _ = conn.execute("DELETE FROM lifelog_messages WHERE id = ?1", params![noti_id]);
        consumed_count += 1;
    }

    // 기존 `kakao_update_requests` 중 이미 대화 내보내기가 완료되었거나 비즈니스 채널로 전환된 항목 정리
    let mut existing_reqs: Vec<(String, String, String, String, i64)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT room_name, last_message_preview, last_noti_date, last_noti_time, last_noti_ts FROM kakao_update_requests",
    ) {
        if let Ok(mapped) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        }) {
            for item in mapped.flatten() {
                existing_reqs.push(item);
            }
        }
    }

    for (r_name, preview, n_date, n_time, n_ts) in existing_reqs {
        if is_kakao_business_or_alimtalk_channel(conn, &r_name, &preview) {
            auto_record_kakao_channel_message(conn, &r_name, &preview, &n_date, &n_time);
            let _ = conn.execute(
                "DELETE FROM kakao_update_requests WHERE room_name = ?1",
                params![r_name],
            );
            continue;
        }
        let synced_ts: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(last_message_ts), 0) FROM kakao_room_sync_state WHERE room_name = ?1",
                params![r_name],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if synced_ts > 0 && n_ts > 0 && synced_ts >= n_ts {
            let _ = conn.execute(
                "DELETE FROM kakao_update_requests WHERE room_name = ?1",
                params![r_name],
            );
        }
    }

    consumed_count
}

#[tauri::command]
pub(crate) fn get_kakao_update_requests(
    state: State<AppState>,
) -> Result<Vec<KakaoUpdateRequestItem>, String> {
    let conn = open_db(&state.db_path)?;
    query_kakao_update_requests_from_conn(&conn)
}

fn query_kakao_update_requests_from_conn(
    conn: &Connection,
) -> Result<Vec<KakaoUpdateRequestItem>, String> {
    let _ = process_and_consume_kakao_notifications(conn);
    let kakao_dir = get_archive_mobile_dir(conn, "kakao");

    let mut items: Vec<KakaoUpdateRequestItem> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT r.room_name, r.pending_noti_count, r.last_sender, r.last_message_preview,
                r.last_noti_date, r.last_noti_time, r.last_noti_ts, r.updated_at,
                COALESCE(s.last_message_ts, 0)
         FROM kakao_update_requests r
         LEFT JOIN kakao_room_sync_state s ON s.room_name = r.room_name
         ORDER BY r.last_noti_date DESC, r.last_noti_time DESC, r.pending_noti_count DESC",
    ) {
        if let Ok(mapped) = stmt.query_map([], |row| {
            let room_name: String = row.get(0)?;
            let pending_noti_count: i64 = row.get(1)?;
            let last_sender: String = row.get(2)?;
            let last_message_preview: String = row.get(3)?;
            let last_noti_date: String = row.get(4)?;
            let last_noti_time: String = row.get(5)?;
            let last_noti_ts: i64 = row.get(6)?;
            let updated_at: String = row.get(7)?;
            let last_sync_ts: i64 = row.get(8)?;
            let last_synced_date = if last_sync_ts > 0 {
                let (d, t) = epoch_ms_to_local_date_time(last_sync_ts);
                format!("{} {}", d, &t[..t.len().min(5)])
            } else {
                "백업 이력 없음".to_string()
            };
            let candidate_md = kakao_dir.join(format!("{}.md", sanitize_filename_stem(&room_name)));
            let md_path = if candidate_md.exists() {
                candidate_md.to_string_lossy().to_string()
            } else {
                String::new()
            };
            Ok(KakaoUpdateRequestItem {
                room_name,
                pending_noti_count: pending_noti_count.max(1) as usize,
                last_sender,
                last_message_preview,
                last_noti_date,
                last_noti_time,
                last_noti_ts,
                last_synced_date,
                md_path,
                updated_at,
            })
        }) {
            for item in mapped.flatten() {
                items.push(item);
            }
        }
    }

    Ok(items)
}

#[tauri::command]
pub(crate) fn resolve_kakao_update_request(
    state: State<AppState>,
    room_name: String,
    action: String,
) -> Result<Vec<KakaoUpdateRequestItem>, String> {
    let conn = open_db(&state.db_path)?;
    let clean_room = room_name.trim();
    if action.trim() == "clear_all" {
        let _ = conn.execute("DELETE FROM kakao_update_requests", []);
    } else if !clean_room.is_empty() {
        if action.trim() == "mark_auto_channel" {
            let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let _ = conn.execute(
                "INSERT OR IGNORE INTO kakao_auto_channels (channel_name, created_at) VALUES (?1, ?2)",
                params![clean_room, now_str],
            );
            if let Ok((preview, n_date, n_time)) = conn.query_row(
                "SELECT last_message_preview, last_noti_date, last_noti_time FROM kakao_update_requests WHERE room_name = ?1",
                params![clean_room],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
            ) {
                auto_record_kakao_channel_message(&conn, clean_room, &preview, &n_date, &n_time);
            }
        }
        let _ = conn.execute(
            "DELETE FROM kakao_update_requests WHERE room_name = ?1",
            params![clean_room],
        );
    }
    query_kakao_update_requests_from_conn(&conn)
}

