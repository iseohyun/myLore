//! 휴대폰 연락처 매핑(전화번호 → 표시 이름) 및 연락처별 AI 배경지식 프로필 관리.

use crate::*;

pub(crate) const DEFAULT_CONTACT_PROFILE_TEMPLATE: &str = "이 사람의 호칭(복수 가능): \n나를 부르는 호칭: \n소속 모임: \n이 사람은?(직업, 사는곳, 이미지, ): ";

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
        if l.is_empty() {
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
        let clean_name = contact_name.trim();
        if clean_name.is_empty() {
            return Err("연락처 이름이 비어 있습니다.".to_string());
        }
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        if is_effectively_empty_contact_profile(&profile_text) {
            let _ = conn.execute(
                "DELETE FROM contact_ai_profiles WHERE contact_name = ?1",
                params![clean_name],
            );
        } else {
            let _ = conn.execute(
                "INSERT INTO contact_ai_profiles (contact_name, profile_text, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(contact_name) DO UPDATE SET
                    profile_text = excluded.profile_text,
                    updated_at = excluded.updated_at",
                params![clean_name, profile_text.trim(), now_str],
            );
        }
        let updated_map = load_contact_ai_profiles_map(&conn);
        persist_contact_ai_profiles_to_vault(&conn, &updated_map);
        Ok(updated_map)
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

fn extract_groups_from_profile(profile_text: &str) -> Vec<String> {
    let raw = extract_profile_field(profile_text, "소속 모임");
    raw.split(|c| c == ',' || c == '/' || c == ';' || c == '·')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// 통화 스크립팅 또는 음성녹음 분석 시 Gemini 프롬프트에 주입할 연락처 인물 배경지식을 구성합니다.
pub(crate) fn build_contact_ai_context_for_target(
    conn: &Connection,
    contact_label: &str,
    is_voice_memo: bool,
) -> Option<String> {
    let profiles = load_contact_ai_profiles_map(conn);
    if profiles.is_empty() {
        return None;
    }

    let clean_target = contact_label
        .split('(')
        .next()
        .unwrap_or(contact_label)
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

        if let Some((matched_name, matched_text)) = matched_entry {
            let mut section = format!(
                "\n\n[📇 통화 상대방({}) 인물 배경지식 (연락처 프로필)]\n{}\n\
                 - 주의: 위 '이 사람의 호칭', '나를 부르는 호칭', '소속 모임', '이 사람은?' 정보를 배경지식으로 적극 활용하여 대화 맥락, 호칭, 고유명사(모임명·지명·직업·관계 등)를 정확하게 전사 및 요약하세요.",
                matched_name,
                matched_text.trim()
            );

            // 같은 소속 모임 구성원이 있으면 함께 참고 정보로 제공하여 대화 중 제3자 언급 시 정확도 향상
            let my_groups = extract_groups_from_profile(matched_text);
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
                        let aliases = extract_profile_field(other_text, "이 사람의 호칭");
                        let desc = extract_profile_field(other_text, "이 사람은?");
                        peers.push(format!(
                            "  * {} (호칭: {}, 소속: {}, 설명: {})",
                            other_name,
                            if aliases.is_empty() { "-" } else { &aliases },
                            other_groups.join(", "),
                            if desc.is_empty() { "-" } else { &desc }
                        ));
                    }
                }
                if !peers.is_empty() {
                    peers.sort();
                    section.push_str(&format!(
                        "\n[👥 동일 소속 모임({}) 관련 인물 참고 (대화 중 언급 시 인명·호칭 식별용)]\n{}",
                        my_groups.join(", "),
                        peers.join("\n")
                    ));
                }
            }
            return Some(section);
        }
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
