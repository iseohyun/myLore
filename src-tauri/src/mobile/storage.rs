//! 모바일 아카이브 폴더(`mobile/*`) 경로·마크다운 append 및 인메모리 중복 방지 캐시.

use crate::*;

pub(crate) static CACHED_DATA_BASE_PATH: std::sync::OnceLock<Mutex<String>> =
    std::sync::OnceLock::new();

pub(crate) fn invalidate_cached_data_base_path() {
    if let Some(lock) = CACHED_DATA_BASE_PATH.get() {
        if let Ok(mut guard) = lock.lock() {
            guard.clear();
        }
    }
}

pub(crate) fn get_archive_mobile_dir(conn: &Connection, sub: &str) -> PathBuf {
    let mobile_root: String = {
        let lock = CACHED_DATA_BASE_PATH.get_or_init(|| Mutex::new(String::new()));
        let mut guard = lock.lock().unwrap();
        if guard.is_empty() {
            let resolved = resolve_mobile_root_dir(conn).to_string_lossy().to_string();
            *guard = resolved.clone();
            resolved
        } else {
            guard.clone()
        }
    };
    let dir = Path::new(&mobile_root).join(sub);
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

/// `mobile/{sub}/{file_stem}.md` 파일에 여러 `(date_str, entry_line)` 항목을 단 1회 파일 읽기·쓰기(Batch I/O)로 병합합니다.
pub(crate) fn append_lines_to_mobile_md_batch(
    conn: &Connection,
    sub: &str,
    file_stem: &str,
    doc_title: &str,
    source_aliases: &str,
    entries: &[(String, String)],
) {
    if entries.is_empty() {
        return;
    }
    let dir = get_archive_mobile_dir(conn, sub);
    let safe_stem = sanitize_filename_stem(file_stem);
    let md_path = dir.join(format!("{}.md", safe_stem));
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let mut content = if md_path.exists() {
        fs::read_to_string(&md_path).unwrap_or_default()
    } else {
        let new_uuid = Uuid::new_v4().to_string();
        format!(
            "---\nuuid: \"{}\"\ntitle: \"{}\"\ncategory: \"mobile/{}\"\ndevice_aliases: [\"핸드폰\", \"휴대폰\", \"스마트폰\", \"갤럭시\", \"모바일\"]\nsource_aliases: {}\nlast_synced: \"{}\"\n---\n\n# {}\n\n> **검색 키워드**: 핸드폰 · 휴대폰 · 갤럭시 · 스마트폰 · 모바일 라이프로그 (`mobile/{}`)\n\n---\n\n",
            new_uuid, doc_title, sub, source_aliases, now_str, doc_title, sub
        )
    };

    let mut modified = false;
    for (date_str, entry_line) in entries {
        if content.contains(entry_line.as_str()) {
            continue;
        }
        let date_header = format!("## 📅 {}", date_str);
        if !content.contains(&date_header) {
            if !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(&format!("\n{}\n{}\n", date_header, entry_line));
        } else {
            if !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(&format!("{}\n", entry_line));
        }
        modified = true;
    }

    if modified {
        let _ = fs::write(&md_path, content.as_bytes());
    }
}

/// `mobile/{sub}/{file_stem}.md` 파일에 날짜 섹션(`## 📅 YYYY-MM-DD`)별로 중복 없이 스크립트 라인을 추가(Append)합니다.
pub(crate) fn append_line_to_mobile_md(
    conn: &Connection,
    sub: &str,
    file_stem: &str,
    doc_title: &str,
    source_aliases: &str,
    date_str: &str,
    entry_line: &str,
) {
    let single = [(date_str.to_string(), entry_line.to_string())];
    append_lines_to_mobile_md_batch(conn, sub, file_stem, doc_title, source_aliases, &single);
}

pub(crate) static MEM_LAST_KAKAO_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_SMS_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_CALL_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_NOTI_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_RECORDING_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_HEALTH_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_CONTACT_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_USAGE_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static MEM_LAST_PHOTO_TS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub(crate) static PENDING_SYNCED_HASHES: std::sync::OnceLock<Mutex<HashSet<String>>> =
    std::sync::OnceLock::new();

pub(crate) fn reset_in_memory_sync_caches() {
    for a in [
        &MEM_LAST_KAKAO_TS,
        &MEM_LAST_SMS_TS,
        &MEM_LAST_CALL_TS,
        &MEM_LAST_NOTI_TS,
        &MEM_LAST_RECORDING_TS,
        &MEM_LAST_HEALTH_TS,
        &MEM_LAST_CONTACT_TS,
        &MEM_LAST_USAGE_TS,
        &MEM_LAST_PHOTO_TS,
    ] {
        a.store(0, std::sync::atomic::Ordering::Relaxed);
    }
    if let Some(lock) = PENDING_SYNCED_HASHES.get() {
        if let Ok(mut g) = lock.lock() {
            g.clear();
        }
    }
}

pub(crate) fn mark_hash_synced_in_memory(h: &str) {
    if h.is_empty() {
        return;
    }
    let lock = PENDING_SYNCED_HASHES.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut g) = lock.lock() {
        g.insert(h.to_string());
    }
}

pub(crate) fn is_hash_synced_in_memory(h: &str) -> bool {
    let lock = PENDING_SYNCED_HASHES.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(g) = lock.lock() {
        return g.contains(h);
    }
    false
}
