//! 휴대폰 연락처 매핑(전화번호 → 표시 이름) 및 연락처별 AI 배경지식 프로필 관리.

use crate::*;

pub(crate) const DEFAULT_CONTACT_PROFILE_TEMPLATE: &str = "이 사람의 호칭(복수 가능): \n나를 부르는 호칭: \n소속 모임: \n속해있는 카톡 그룹: \n이 사람은?(직업, 사는곳, 이미지, ): \n\n## 최근 history\n\n## 📌 주요 사건 기록\n";

pub(crate) fn get_contact_person_md_dir(conn: &Connection) -> PathBuf {
    let dir = get_archive_mobile_dir(conn, "contacts").join("people");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub(crate) fn get_contact_person_md_path(conn: &Connection, contact_name: &str) -> PathBuf {
    let safe_name = sanitize_filename_stem(contact_name.trim());
    let eff_name = if safe_name.is_empty() {
        "이름없음".to_string()
    } else {
        safe_name
    };
    get_contact_person_md_dir(conn).join(format!("{}.md", eff_name))
}

pub(crate) fn normalize_phone_digits(raw: &str) -> String {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.starts_with("8210") && digits.len() >= 12 {
        format!("0{}", &digits[2..])
    } else if digits.starts_with("82") && digits.len() >= 10 {
        format!("0{}", &digits[2..])
    } else {
        digits
    }
}

pub(crate) fn load_mobile_contacts_map(conn: &Connection) -> HashMap<String, String> {
    static RE_CONTACT_LINE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE_CONTACT_LINE
        .get_or_init(|| Regex::new(r"^-\s*\*\*([^*]+)\*\*\s*\|\s*전화:\s*`([^`]*)`").unwrap());
    let mut map = HashMap::new();
    let contacts_md = get_archive_mobile_dir(conn, "contacts").join("연락처_주소록.md");
    if let Ok(content) = fs::read_to_string(&contacts_md) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(cap) = re.captures(trimmed) {
                let name = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                let phones_raw = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                if name.is_empty() || name == "이름없음" || phones_raw.is_empty() {
                    continue;
                }
                for p in phones_raw.split(|c| c == ',' || c == ';' || c == '/') {
                    let pt = p.trim();
                    if pt.is_empty() {
                        continue;
                    }
                    map.insert(pt.to_string(), name.to_string());
                    let norm = normalize_phone_digits(pt);
                    if norm.len() >= 7 {
                        map.insert(norm, name.to_string());
                    }
                }
            }
        }
    }
    map
}

pub(crate) fn resolve_contact_display(raw_target: &str, contacts_map: &HashMap<String, String>) -> String {
    let trimmed = raw_target.trim();
    if trimmed.is_empty() {
        return "알수없음".to_string();
    }
    if let Some(found) = contacts_map.get(trimmed) {
        return found.clone();
    }
    let norm = normalize_phone_digits(trimmed);
    if norm.len() >= 7 {
        if let Some(found) = contacts_map.get(&norm) {
            return found.clone();
        }
    }
    trimmed.to_string()
}

#[tauri::command]
pub(crate) async fn get_mobile_contacts_map(
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        Ok(load_mobile_contacts_map(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 템플릿 기본 문구만 남아 있고 실제 입력된 값이 없는지 확인합니다.
pub(crate) fn is_effectively_empty_contact_profile(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    for line in trimmed.lines() {
        let l = line.trim();
        if l.is_empty()
            || l.starts_with("## 📌 주요 사건 기록")
            || l.starts_with("## 주요 사건 기록")
            || l.starts_with("## 최근 history")
            || l.starts_with("## 🕒 최근 history")
            || l.starts_with("# 👤")
        {
            continue;
        }
        if let Some(colon_idx) = l.find(':') {
            let prefix = l[..colon_idx].trim();
            let val = l[colon_idx + 1..].trim();
            if matches!(
                prefix,
                "이 사람의 호칭(복수 가능)"
                    | "나를 부르는 호칭"
                    | "소속 모임"
                    | "속해있는 카톡 그룹"
                    | "이 사람은?(직업, 사는곳, 이미지, )"
                    | "이 사람은?(직업, 사는곳, 이미지)"
            ) {
                if !val.is_empty() {
                    return false;
                }
                continue;
            }
        }
        // 템플릿 외 자유 서술 줄이 있으면 비어 있지 않음
        return false;
    }
    true
}

pub(crate) fn ensure_contact_profile_has_template_sections(raw_body: &str) -> String {
    let trimmed = raw_body.trim();
    if trimmed.is_empty() {
        return DEFAULT_CONTACT_PROFILE_TEMPLATE.trim().to_string();
    }
    let mut out = trimmed.to_string();
    if !out.contains("속해있는 카톡 그룹:") {
        let mut lines: Vec<String> = Vec::new();
        let mut inserted = false;
        for line in out.lines() {
            lines.push(line.to_string());
            if !inserted && line.trim_start().starts_with("소속 모임:") {
                lines.push("속해있는 카톡 그룹: ".to_string());
                inserted = true;
            }
        }
        if !inserted {
            lines.insert(0, "속해있는 카톡 그룹: ".to_string());
        }
        out = lines.join("\n");
    }
    if !out.contains("최근 history") {
        if let Some(pos) = out.find("## 📌 주요 사건 기록") {
            let (before, after) = out.split_at(pos);
            out = format!("{}\n\n## 최근 history\n\n{}", before.trim_end(), after);
        } else {
            out = format!("{}\n\n## 최근 history", out);
        }
    }
    if !out.contains("주요 사건 기록") {
        out = format!("{}\n\n## 📌 주요 사건 기록", out);
    }
    out
}

/// 개별 인원의 `Data/mobile/contacts/people/{이름}.md` 파일을 생성 또는 갱신하고 `(md_path, uuid, body_text)`를 반환합니다.
pub(crate) fn ensure_or_write_contact_person_md(
    conn: &Connection,
    contact_name: &str,
    phones: &[String],
    override_body: Option<&str>,
) -> (PathBuf, String, String) {
    let clean_name = contact_name.trim();
    let md_path = get_contact_person_md_path(conn, clean_name);
    let mut existing_uuid = String::new();
    let mut existing_phones = phones.join(", ");
    let mut existing_body = String::new();

    if md_path.exists() {
        if let Ok(raw) = fs::read_to_string(&md_path) {
            let (_, body, fm) = parse_markdown_yaml(&raw);
            if let Some(u) = fm.get("uuid") {
                existing_uuid = u.trim().to_string();
            }
            if existing_phones.is_empty() {
                if let Some(p) = fm.get("phones") {
                    existing_phones = p.trim().to_string();
                }
            }
            existing_body = body.trim().to_string();
        }
    }

    let doc_uuid = if existing_uuid.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        existing_uuid
    };

    let target_body = if let Some(ov) = override_body {
        ov.trim().to_string()
    } else if !existing_body.is_empty() {
        ensure_contact_profile_has_template_sections(&existing_body)
    } else {
        DEFAULT_CONTACT_PROFILE_TEMPLATE.trim().to_string()
    };

    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let should_write = override_body.is_some() || !md_path.exists() || existing_body.is_empty();
    if should_write {
        let md_content = format!(
            "---\n\
             uuid: \"{}\"\n\
             title: \"[인물 프로필] {}\"\n\
             category: \"mobile/contacts/person\"\n\
             contact_name: \"{}\"\n\
             phones: \"{}\"\n\
             updated_at: \"{}\"\n\
             ---\n\n\
             {}\n",
            doc_uuid,
            clean_name.replace('"', "\\\""),
            clean_name.replace('"', "\\\""),
            existing_phones.replace('"', "\\\""),
            now_str,
            target_body
        );
        let _ = fs::write(&md_path, md_content.as_bytes());
    }

    (md_path, doc_uuid, target_body)
}

/// 주소록(`연락처_주소록.md`) 및 `contact_ai_profiles`의 모든 인원에 대해 `Data/mobile/contacts/people/{이름}.md` 파일(UUID + 기본 템플릿/기존 내용)을 보장합니다.
pub(crate) fn sync_all_contact_person_md_files(conn: &Connection) -> Vec<ContactPersonDocInfo> {
    sync_all_kakao_group_memberships_to_contacts(conn);
    static RE_CONTACT_LINE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE_CONTACT_LINE
        .get_or_init(|| Regex::new(r"^-\s*\*\*([^*]+)\*\*\s*\|\s*전화:\s*`([^`]*)`").unwrap());

    let mut phones_by_name: HashMap<String, Vec<String>> = HashMap::new();
    let contacts_md = get_archive_mobile_dir(conn, "contacts").join("연락처_주소록.md");
    if let Ok(content) = fs::read_to_string(&contacts_md) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(cap) = re.captures(trimmed) {
                let name = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                let phones_raw = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                if name.is_empty() || name == "이름없음" {
                    continue;
                }
                let entry = phones_by_name.entry(name.to_string()).or_default();
                for p in phones_raw.split(|c| c == ',' || c == ';' || c == '/') {
                    let pt = p.trim();
                    if !pt.is_empty() && !entry.contains(&pt.to_string()) {
                        entry.push(pt.to_string());
                    }
                }
            }
        }
    }

    let db_profiles = load_contact_ai_profiles_map(conn);
    for k in db_profiles.keys() {
        phones_by_name.entry(k.clone()).or_default();
    }

    // people 폴더에 이미 존재하는 .md 파일도 스캔하여 포함
    let people_dir = get_contact_person_md_dir(conn);
    if let Ok(entries) = fs::read_dir(&people_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Ok(raw) = fs::read_to_string(&p) {
                    let (_, body, fm) = parse_markdown_yaml(&raw);
                    let cname = fm
                        .get("contact_name")
                        .cloned()
                        .unwrap_or_else(|| {
                            p.file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_default()
                        });
                    let clean = cname.trim().to_string();
                    if !clean.is_empty() {
                        phones_by_name.entry(clean.clone()).or_default();
                        if !db_profiles.contains_key(&clean) && !is_effectively_empty_contact_profile(&body) {
                            let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                            let _ = conn.execute(
                                "INSERT INTO contact_ai_profiles (contact_name, profile_text, updated_at)
                                 VALUES (?1, ?2, ?3)
                                 ON CONFLICT(contact_name) DO UPDATE SET
                                    profile_text = excluded.profile_text,
                                    updated_at = excluded.updated_at",
                                params![clean, body.trim(), now_str],
                            );
                        }
                    }
                }
            }
        }
    }

    let refreshed_profiles = load_contact_ai_profiles_map(conn);
    let mut names: Vec<String> = phones_by_name.keys().cloned().collect();
    names.sort();

    let mut out = Vec::new();
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    for name in names {
        let phones = phones_by_name.get(&name).cloned().unwrap_or_default();
        let db_text = refreshed_profiles.get(&name).map(|s| s.as_str());
        let (md_path, doc_uuid, body_text) =
            ensure_or_write_contact_person_md(conn, &name, &phones, db_text);
        out.push(ContactPersonDocInfo {
            contact_name: name,
            phones,
            md_path: md_path.to_string_lossy().to_string(),
            doc_uuid,
            profile_text: body_text,
            updated_at: now_str.clone(),
        });
    }
    out
}

pub(crate) fn load_contact_ai_profiles_map(conn: &Connection) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT contact_name, profile_text FROM contact_ai_profiles")
    {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }) {
            for (name, text) in rows.flatten() {
                if !name.trim().is_empty() && !is_effectively_empty_contact_profile(&text) {
                    map.insert(name, text);
                }
            }
        }
    }

    // DB가 비어 있을 때 볼트 백업 JSON 파일(`Data/mobile/contacts/연락처_AI_프로필.json`)이 있으면 복원
    if map.is_empty() {
        let backup_json = get_archive_mobile_dir(conn, "contacts").join("연락처_AI_프로필.json");
        if let Ok(raw) = fs::read_to_string(&backup_json) {
            if let Ok(parsed) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
                for (k, v) in parsed {
                    if !k.trim().is_empty() && !is_effectively_empty_contact_profile(&v) {
                        let _ = conn.execute(
                            "INSERT INTO contact_ai_profiles (contact_name, profile_text, updated_at)
                             VALUES (?1, ?2, ?3)
                             ON CONFLICT(contact_name) DO UPDATE SET
                                profile_text = excluded.profile_text,
                                updated_at = excluded.updated_at",
                            params![k.trim(), v.trim(), now_str],
                        );
                        map.insert(k.trim().to_string(), v.trim().to_string());
                    }
                }
            }
        }
    }

    // people/{이름}.md 파일을 직접 스캔하여 사용자가 .md 문서에 직접 작성한 '## 최근 history', '소속 모임', '호칭' 등을 최신 상태로 오버레이
    let people_dir = get_contact_person_md_dir(conn);
    if let Ok(entries) = fs::read_dir(&people_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Ok(raw) = fs::read_to_string(&p) {
                    let (_, body, fm) = parse_markdown_yaml(&raw);
                    if !is_effectively_empty_contact_profile(&body) {
                        let cname = fm
                            .get("contact_name")
                            .cloned()
                            .unwrap_or_else(|| {
                                p.file_stem()
                                    .map(|s| s.to_string_lossy().to_string())
                                    .unwrap_or_default()
                            });
                        let clean = cname.trim().to_string();
                        if !clean.is_empty() {
                            map.insert(clean, body.trim().to_string());
                        }
                    }
                }
            }
        }
    }

    map
}

fn persist_contact_ai_profiles_to_vault(conn: &Connection, map: &HashMap<String, String>) {
    let contacts_dir = get_archive_mobile_dir(conn, "contacts");
    let _ = fs::create_dir_all(&contacts_dir);
    let json_path = contacts_dir.join("연락처_AI_프로필.json");
    if let Ok(json_str) = serde_json::to_string_pretty(map) {
        let _ = fs::write(&json_path, json_str);
    }

    let md_path = contacts_dir.join("연락처_AI_프로필.md");
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    let mut md_lines = vec![
        "---".to_string(),
        "title: \"연락처 AI 인물 배경지식 프로필\"".to_string(),
        "category: \"mobile/contacts\"".to_string(),
        "---".to_string(),
        "# 📇 연락처 인물 배경지식 (AI 스크립팅 컨텍스트)".to_string(),
        "".to_string(),
    ];
    for k in keys {
        if let Some(v) = map.get(k) {
            md_lines.push(format!("## 👤 {}", k));
            md_lines.push("```text".to_string());
            md_lines.push(v.trim().to_string());
            md_lines.push("```".to_string());
            md_lines.push(String::new());
        }
    }
    let _ = fs::write(&md_path, md_lines.join("\n"));
}

#[tauri::command]
pub(crate) async fn get_contact_ai_profiles(
    state: State<'_, AppState>,
) -> Result<HashMap<String, String>, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        Ok(load_contact_ai_profiles_map(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn save_contact_ai_profile(
    state: State<'_, AppState>,
    contact_name: String,
    profile_text: String,
) -> Result<HashMap<String, String>, String> {
    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_arc.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&db_path)?;
        let contacts_map = load_mobile_contacts_map(&conn);
        let base_raw = contact_name.split('(').next().unwrap_or(&contact_name).trim();
        let resolved = resolve_contact_display(base_raw, &contacts_map);
        let clean_name = resolved.split('(').next().unwrap_or(&resolved).trim();
        if clean_name.is_empty() {
            return Err("연락처 이름이 비어 있습니다.".to_string());
        }
        let known_phones: Vec<String> = contacts_map
            .iter()
            .filter(|(k, v)| v.as_str() == clean_name && k.contains('-'))
            .map(|(k, _)| k.clone())
            .collect();
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let raw_trimmed = profile_text.trim();
        if raw_trimmed.is_empty() {
            let _ = conn.execute(
                "DELETE FROM contact_ai_profiles WHERE contact_name = ?1",
                params![clean_name],
            );
            let _ = ensure_or_write_contact_person_md(&conn, clean_name, &known_phones, Some(""));
        } else {
            let _ = conn.execute(
                "INSERT INTO contact_ai_profiles (contact_name, profile_text, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(contact_name) DO UPDATE SET
                    profile_text = excluded.profile_text,
                    updated_at = excluded.updated_at",
                params![clean_name, raw_trimmed, now_str],
            );
            let _ = ensure_or_write_contact_person_md(&conn, clean_name, &known_phones, Some(raw_trimmed));
        }
        let mut updated_map = load_contact_ai_profiles_map(&conn);
        if !raw_trimmed.is_empty() {
            updated_map.insert(clean_name.to_string(), raw_trimmed.to_string());
        }
        persist_contact_ai_profiles_to_vault(&conn, &updated_map);
        Ok(updated_map)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn sync_contact_person_markdown_files(
    state: State<'_, AppState>,
) -> Result<Vec<ContactPersonDocInfo>, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        Ok(sync_all_contact_person_md_files(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn open_contact_person_document(
    state: State<'_, AppState>,
    contact_name: String,
    phones: Option<Vec<String>>,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let contacts_map = load_mobile_contacts_map(&conn);
        let base_raw = contact_name.split('(').next().unwrap_or(&contact_name).trim();
        let resolved = resolve_contact_display(base_raw, &contacts_map);
        let clean_name = resolved.split('(').next().unwrap_or(&resolved).trim();
        if clean_name.is_empty() {
            return Err("연락처 이름이 비어 있습니다.".to_string());
        }
        let profiles = load_contact_ai_profiles_map(&conn);
        let md_exists = get_contact_person_md_path(&conn, clean_name).exists();
        let db_text = if md_exists { None } else { profiles.get(clean_name).map(|s| s.as_str()) };
        let mut phone_list = phones.unwrap_or_default();
        if phone_list.is_empty() {
            phone_list = contacts_map
                .iter()
                .filter(|(k, v)| v.as_str() == clean_name && k.contains('-'))
                .map(|(k, _)| k.clone())
                .collect();
            phone_list.sort();
        }
        let (md_path, _, _) =
            ensure_or_write_contact_person_md(&conn, clean_name, &phone_list, db_text);
        build_document_payload(&conn, &md_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn extract_profile_field(profile_text: &str, field_prefix: &str) -> String {
    for line in profile_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(field_prefix) {
            if let Some(colon) = trimmed.find(':') {
                return trimmed[colon + 1..].trim().to_string();
            }
        }
    }
    String::new()
}

pub(crate) fn extract_kakao_groups_from_profile(profile_text: &str) -> Vec<String> {
    let raw = extract_profile_field(profile_text, "속해있는 카톡 그룹");
    raw.split(|c| c == '|' || c == ';' || c == '·')
        .flat_map(|part| {
            // 방 이름 자체에 쉼표("권순용, 양지야, 서충근, 박성준")가 포함될 수 있으므로 ` / ` 또는 `;` 또는 `|` 구분자를 우선하되 단일 방 이름 보존
            part.split(" / ")
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub(crate) fn merge_kakao_groups_into_profile_body(raw_body: &str, discovered_groups: &[String]) -> (String, bool) {
    let base = ensure_contact_profile_has_template_sections(raw_body);
    let mut merged: Vec<String> = extract_kakao_groups_from_profile(&base);
    let mut changed = !raw_body.contains("속해있는 카톡 그룹:");
    for g in discovered_groups {
        let clean = g.trim();
        if !clean.is_empty() && !merged.iter().any(|x| x == clean) {
            merged.push(clean.to_string());
            changed = true;
        }
    }
    let joined = merged.join(" / ");
    let mut out_lines: Vec<String> = Vec::new();
    for line in base.lines() {
        if line.trim_start().starts_with("속해있는 카톡 그룹:") {
            let new_line = format!("속해있는 카톡 그룹: {}", joined);
            if line.trim() != new_line.trim() {
                changed = true;
            }
            out_lines.push(new_line);
        } else {
            out_lines.push(line.to_string());
        }
    }
    (out_lines.join("\n"), changed)
}

fn extract_groups_from_profile(profile_text: &str) -> Vec<String> {
    let raw = extract_profile_field(profile_text, "소속 모임");
    let mut list: Vec<String> = raw
        .split(|c| c == ',' || c == '/' || c == ';' || c == '·')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    for kg in extract_kakao_groups_from_profile(profile_text) {
        if !list.iter().any(|x| x == &kg) {
            list.push(kg);
        }
    }
    list
}

/// 통화 스크립팅 또는 음성녹음 분석 시 Gemini/LLM 프롬프트에 주입할 연락처 인물 배경지식(`## 최근 history` 및 2-Hop 동일 소속 그룹 고유명사·호칭 사전)을 구성합니다.
pub(crate) fn build_contact_ai_context_for_target(
    conn: &Connection,
    contact_label: &str,
    is_voice_memo: bool,
) -> Option<String> {
    let profiles = load_contact_ai_profiles_map(conn);
    let contacts_map = load_mobile_contacts_map(conn);
    let resolved_target = resolve_contact_display(contact_label, &contacts_map);

    let clean_target = resolved_target
        .split('(')
        .next()
        .unwrap_or(&resolved_target)
        .trim();

    if !is_voice_memo && !clean_target.is_empty() {
        // 1. 정확히 일치하거나 호칭에 포함된 연락처 검색
        let mut matched_entry: Option<(&String, &String)> = profiles.get_key_value(clean_target);
        if matched_entry.is_none() {
            matched_entry = profiles.iter().find(|(name, text)| {
                name.trim() == clean_target
                    || clean_target.contains(name.as_str())
                    || extract_profile_field(text, "이 사람의 호칭")
                        .split(|c| c == ',' || c == '/' || c == ';')
                        .any(|alias| !alias.trim().is_empty() && alias.trim() == clean_target)
            });
        }

        let (recent_events_snippet, _) = collect_recent_contact_events_context(conn, clean_target);

        if let Some((matched_name, matched_text)) = matched_entry {
            let mut section = format!(
                "\n\n[📇 통화 상대방(`{}`) 인물 배경지식 (`{}.md` 프로필 및 최근 history)]\n{}\n\
                 - 주의: 위 '이 사람의 호칭', '나를 부르는 호칭', '소속 모임', '이 사람은?', '## 최근 history' 정보를 배경지식으로 적극 활용하여 대화 맥락, 호칭, 고유명사(모임명·지명·직업·관계 등)를 정확하게 교정 및 요약하세요.",
                matched_name,
                matched_name,
                matched_text.trim()
            );

            if !recent_events_snippet.trim().is_empty() {
                section.push_str(&format!(
                    "\n\n[🕒 상대방(`{}`) 최근 통화·메시지 history 참고]\n{}",
                    matched_name,
                    recent_events_snippet.trim()
                ));
            }

            // 2-Hop Group Expansion: 같은 소속 모임(예: 숭실대, 해풍단 등) 구성원의 정식 이름 + 호칭/별칭(예: 박창희 → 박씨) 자동 조립
            let my_groups = extract_groups_from_profile(matched_text);
            let mut peer_names_included: HashSet<String> = HashSet::new();
            peer_names_included.insert(matched_name.clone());

            if !my_groups.is_empty() {
                let mut peers: Vec<String> = Vec::new();
                for (other_name, other_text) in &profiles {
                    if other_name == matched_name {
                        continue;
                    }
                    let other_groups = extract_groups_from_profile(other_text);
                    if my_groups
                        .iter()
                        .any(|g| other_groups.iter().any(|og| og.eq_ignore_ascii_case(g)))
                    {
                        peer_names_included.insert(other_name.clone());
                        let aliases = extract_profile_field(other_text, "이 사람의 호칭");
                        let call_me = extract_profile_field(other_text, "나를 부르는 호칭");
                        let desc = extract_profile_field(other_text, "이 사람은?");
                        let surname_hint = other_name
                            .chars()
                            .next()
                            .filter(|c| !c.is_ascii() && *c != '#')
                            .map(|c| format!("{}씨 / {}쌤 / {}형", c, c, c))
                            .unwrap_or_default();
                        let alias_display = if !aliases.is_empty() && !surname_hint.is_empty() {
                            format!("{} (성씨 파생 호칭 가능: {})", aliases, surname_hint)
                        } else if !aliases.is_empty() {
                            aliases
                        } else if !surname_hint.is_empty() {
                            format!("-(성씨 파생 호칭 가능: {})", surname_hint)
                        } else {
                            "-".to_string()
                        };
                        peers.push(format!(
                            "  * **{}** | 호칭/별칭: `{}` | 나를 부르는 호칭: `{}` | 소속: `{}` | 설명: {}",
                            other_name,
                            alias_display,
                            if call_me.is_empty() { "-" } else { &call_me },
                            other_groups.join(", "),
                            if desc.is_empty() { "-" } else { &desc }
                        ));
                    }
                }
                if !peers.is_empty() {
                    peers.sort();
                    section.push_str(&format!(
                        "\n\n[👥 동일 소속 그룹({}) 고유명사·인명·호칭 사전 (대화 중 제3자 언급·호칭 식별 최우선 적용)]\n{}",
                        my_groups.join(", "),
                        peers.join("\n")
                    ));
                }
            }

            // 다른 그룹이거나 그룹 미지정이라도 호칭/소속이 등록된 주요 인물 사전 추가 첨부
            let mut other_glossary: Vec<String> = Vec::new();
            let mut sorted_keys: Vec<&String> = profiles.keys().collect();
            sorted_keys.sort();
            for k in sorted_keys {
                if peer_names_included.contains(k) {
                    continue;
                }
                if let Some(txt) = profiles.get(k) {
                    let aliases = extract_profile_field(txt, "이 사람의 호칭");
                    let groups = extract_groups_from_profile(txt);
                    let desc = extract_profile_field(txt, "이 사람은?");
                    if !aliases.is_empty() || !groups.is_empty() || !desc.is_empty() {
                        other_glossary.push(format!(
                            "  * **{}** (호칭: `{}`, 소속: `{}`, 특징: {})",
                            k,
                            if aliases.is_empty() { "-" } else { &aliases },
                            if groups.is_empty() { "-".to_string() } else { groups.join(", ") },
                            if desc.is_empty() { "-" } else { &desc }
                        ));
                    }
                }
                if other_glossary.len() >= 25 {
                    break;
                }
            }
            if !other_glossary.is_empty() {
                section.push_str(&format!(
                    "\n\n[📚 등록된 기타 인물·호칭·모임 고유명사 사전 (제3자 언급 교정용)]\n{}",
                    other_glossary.join("\n")
                ));
            }
            return Some(section);
        } else if !recent_events_snippet.trim().is_empty() {
            // 아직 프로필 .md가 채워지지 않은 상대방이라도 최근 대화 history와 등록된 주변 인물 사전은 제공
            let mut fallback_sec = format!(
                "\n\n[🕒 통화 상대방(`{}`) 최근 통화·메시지 history 참고]\n{}",
                clean_target,
                recent_events_snippet.trim()
            );
            let mut keys: Vec<&String> = profiles.keys().collect();
            keys.sort();
            let mut gl_lines: Vec<String> = Vec::new();
            for k in keys.into_iter().take(25) {
                if let Some(txt) = profiles.get(k) {
                    let aliases = extract_profile_field(txt, "이 사람의 호칭");
                    let groups = extract_groups_from_profile(txt);
                    let desc = extract_profile_field(txt, "이 사람은?");
                    gl_lines.push(format!(
                        "  * **{}** (호칭: `{}`, 소속: `{}`, 특징: {})",
                        k,
                        if aliases.is_empty() { "-" } else { &aliases },
                        if groups.is_empty() { "-".to_string() } else { groups.join(", ") },
                        if desc.is_empty() { "-" } else { &desc }
                    ));
                }
            }
            if !gl_lines.is_empty() {
                fallback_sec.push_str(&format!(
                    "\n\n[📚 등록된 주변 인물·호칭·모임 고유명사 사전]\n{}",
                    gl_lines.join("\n")
                ));
            }
            return Some(fallback_sec);
        }
    }

    if profiles.is_empty() {
        return None;
    }

    // 2. 음성메모/회의녹음이거나 상대방이 특정되지 않은 경우: 등록된 주요 연락처 배경지식 요약본 제공
    let mut summary_lines: Vec<String> = Vec::new();
    let mut keys: Vec<&String> = profiles.keys().collect();
    keys.sort();
    for k in keys.into_iter().take(25) {
        if let Some(txt) = profiles.get(k) {
            let compact = txt
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect::<Vec<&str>>()
                .join(" / ");
            summary_lines.push(format!("- **{}**: {}", k, compact));
        }
    }
    if summary_lines.is_empty() {
        None
    } else {
        Some(format!(
            "\n\n[📇 등록된 주변 인물·연락처 배경지식 참고 (대화 중 언급되는 인명·호칭·모임 식별용)]\n{}",
            summary_lines.join("\n")
        ))
    }
}

/// 대상 인물의 최근 통화 요약 및 대화 기록을 수집하여 사건 컨텍스트를 구성합니다.
pub(crate) fn collect_recent_contact_events_context(
    conn: &Connection,
    contact_name: &str,
) -> (String, String) {
    let clean_name = contact_name.trim();
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut snippets: Vec<String> = Vec::new();
    let mut latest_ref = format!("manual_{}", today_str);

    if let Ok(mut stmt) = conn.prepare(
        "SELECT source, sent_date, sent_time, message
         FROM lifelog_messages
         WHERE (room_or_sender LIKE ?1 OR sender LIKE ?1)
         ORDER BY sent_date DESC, sent_time DESC, id DESC LIMIT 12",
    ) {
        let pat = format!("%{}%", clean_name);
        if let Ok(rows) = stmt.query_map(params![pat], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        }) {
            for (idx, (src, sdate, stime, msg)) in rows.flatten().enumerate() {
                if idx == 0 {
                    latest_ref = format!("{}_{}_{}", src, sdate, stime);
                }
                let clean_m = msg.replace('\n', " ").trim().to_string();
                if !clean_m.is_empty() {
                    snippets.push(format!("- [{} {} · {}] {}", sdate, stime, src, clean_m));
                }
            }
        }
    }

    if snippets.is_empty() {
        (
            format!("[{}] 최근 기록된 신규 통화/메시지 내역 기반 프로필 점검", today_str),
            latest_ref,
        )
    } else {
        (snippets.join("\n"), latest_ref)
    }
}

pub(crate) fn strip_markdown_code_fence(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") {
        let mut lines: Vec<&str> = trimmed.lines().collect();
        if !lines.is_empty() {
            lines.remove(0);
        }
        if lines.last().map(|l| l.trim().starts_with("```")).unwrap_or(false) {
            lines.pop();
        }
        return lines.join("\n").trim().to_string();
    }
    trimmed.to_string()
}

/// 사건 원문으로부터 1~2줄 핵심 사건 요약을 생성합니다.
pub(crate) fn summarize_event_in_one_or_two_lines(
    conn: &Connection,
    contact_name: &str,
    raw_event_context: &str,
) -> (String, String) {
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let prompt = format!(
        "다음은 '{}' 님과 관련된 최근 통화/대화 또는 사건 내용입니다.\n\
         이를 인물 프로필의 `## 📌 주요 사건 기록`에 추가할 수 있도록 **핵심만 1~2줄 이내로 간결하게 요약**해 주세요.\n\
         불필요한 머리말 없이 `- **[YYYY-MM-DD]** 요약 내용` 형식으로만 출력하세요.\n\n\
         [사건/대화 원문]\n{}",
        contact_name, raw_event_context
    );
    if let Some((resp, prov)) = call_any_text_llm(conn, &prompt, 350) {
        let cleaned = strip_markdown_code_fence(&resp);
        if !cleaned.is_empty() {
            return (cleaned, prov);
        }
    }
    let first_line = raw_event_context
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("최근 통화 및 대화 이벤트 발생")
        .trim()
        .trim_start_matches('-')
        .trim();
    let short: String = first_line.chars().take(110).collect();
    (
        format!("- **[{}]** {}", today_str, short),
        "local_fallback".to_string(),
    )
}

/// 사용자(`나/{USER_NAME}`)의 등록된 음성지문 및 상대방(`contact_{contact_name}`)의 누적 음성지문 현황을 조회하여 사전조사 텍스트를 생성합니다.
pub(crate) fn build_contact_and_user_voiceprint_summary(
    conn: &Connection,
    contact_name: &str,
) -> (String, String) {
    let (user_name, _, _) = resolve_user_identity();
    let srv = load_voiceprint_profile(conn, "user_server_mic", "내 목소리 지문 (서버 마이크 생성)", "server_mic");
    let sync = load_voiceprint_profile(conn, "user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile");
    let contact_pid = format!("contact_{}", sanitize_filename_stem(contact_name));
    let c_prof = load_voiceprint_profile(conn, &contact_pid, &format!("{} 통화 상대방 음성지문", contact_name), "call_counterpart");

    let user_vp_line = format!(
        "User Voiceprint (내 목소리 지문 - {}): Server Mic {} samples (CAM++ {:.1}% / ResNet34 {:.1}%) + Sync Mobile {} samples (CAM++ {:.1}% / ResNet34 {:.1}%)",
        user_name, srv.sample_count, srv.consistency_a, srv.consistency_b, sync.sample_count, sync.consistency_a, sync.consistency_b
    );

    let (counterpart_vp_line, phone_voice_archive_block) = if c_prof.sample_count > 0 {
        let last_meta = c_prof
            .samples_meta
            .last()
            .map(|m| format!("최근 추출 소스 `{}` ({:.1}초, 내 음성 대비 분리도 CAM++ {:.1}% / ResNet34 {:.1}%, 갱신 {})", m.source_label, m.duration_sec, m.sim_a, m.sim_b, m.created_at))
            .unwrap_or_else(|| format!("최근 갱신: {}", c_prof.updated_at));
        (
            format!(
                "Counterpart Voiceprint (상대방 `{}` 음성지문 ID `{}`): 누적 {}회 통화 성문 추출 완료 · 교차검증 일관성 {:.1}% (CAM++ {:.1}% / ResNet34 {:.1}%) · {}",
                contact_name, contact_pid, c_prof.sample_count, c_prof.cross_agreement_score, c_prof.consistency_a, c_prof.consistency_b, last_meta
            ),
            format!(
                "- **음성지문 ID**: `{}` (3D-Speaker CAM++ 192D & WeSpeaker ResNet34-LM 256D 교차검증 등록)\n\
                 - **누적 성문 샘플 및 수렴도**: 통화 성문 {}회 누적 · 모델 일관성 **{:.1}%** (CAM++ {:.1}% / ResNet34 {:.1}%)\n\
                 - **전화목소리 음향 및 화자분리 특징**: {}\n\
                 - **화자혼동/타임태그 방어 기준**: 내 목소리 지문(`user_master_combined`)과 음향 코사인 거리 및 호칭 맥락을 교차검증하여 `나({})`와 `{}` 발화를 엄격 분리함",
                contact_pid, c_prof.sample_count, c_prof.cross_agreement_score, c_prof.consistency_a, c_prof.consistency_b, last_meta, user_name, contact_name
            ),
        )
    } else {
        (
            format!("Counterpart Voiceprint (상대방 `{}` 음성지문 ID `{}`): 통화 녹음 기반 성문 벡터 신규 추적 대상", contact_name, contact_pid),
            format!(
                "- **음성지문 ID**: `{}` (통화 음원 기반 2종 모델 성문 프로필 관리 대상)\n\
                 - **전화목소리 및 화자분리 관리**: 내 목소리 지문(`user_master_combined`) 대비 음색·호칭 차이를 기준으로 `{}` 전화목소리 특징을 별도 추적·보관함",
                contact_pid, contact_name
            ),
        )
    };

    (format!("{}\n{}", user_vp_line, counterpart_vp_line), phone_voice_archive_block)
}

/// 프롬프트 A 전용: 결과 마크다운에 `## 🎙️ 전화목소리 및 음성지문 보관관리` 섹션이 누락되어 있으면
/// `## 📌 주요 사건 기록` 직전에 자동으로 삽입하여 전화목소리 추가 업데이트를 별도 보관·관리합니다.
pub(crate) fn ensure_prompt_a_phone_voice_section(profile_md: &str, phone_voice_block: &str) -> String {
    let normalized = ensure_contact_profile_has_template_sections(profile_md);
    if normalized.contains("## 🎙️ 전화목소리") || normalized.contains("전화목소리 및 음성지문 보관관리") {
        return normalized;
    }
    let section_text = format!(
        "## 🎙️ 전화목소리 및 음성지문 보관관리 (Prompt A 전용 별도 보관)\n{}\n\n",
        phone_voice_block.trim()
    );
    if let Some(pos) = normalized.find("## 📌 주요 사건 기록") {
        let (before, after) = normalized.split_at(pos);
        format!("{}{}\n{}", before.trim_end(), "\n\n".to_string() + section_text.trim_end(), after)
    } else {
        format!("{}\n\n{}", normalized.trim_end(), section_text.trim_end())
    }
}
