//! 휴대폰 연락처 매핑(전화번호 → 표시 이름).

use crate::*;

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
