//! SQLite 메타 DB 연결, 스키마 생성/마이그레이션 및 `mobile_sync_meta` 키-값 헬퍼.

use crate::*;

pub(crate) static DB_SCHEMA_INITIALIZED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

pub(crate) static LIFELOG_BACKFILLED_ONCE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

pub(crate) fn open_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        ",
    )
    .map_err(|e| e.to_string())?;

    if DB_SCHEMA_INITIALIZED.get().is_none() {
        // 실행 순서가 중요합니다: 스키마 → 컬럼 마이그레이션 → 기본값 시드 → 템플릿 → 카톡 파일 마이그레이션 → ACK 상태 역추출
        create_schema(&conn)?;
        apply_column_migrations(&conn);
        seed_default_meta_and_base_folders(&conn);
        let _ = ensure_projects_mylore_templates(&conn);
        migrate_raw_kakao_chat_mds(&conn);
        backfill_sync_ack_states(&conn);
        let _ = DB_SCHEMA_INITIALIZED.set(true);
    }

    Ok(conn)
}

/// 모든 테이블을 `CREATE TABLE IF NOT EXISTS` 로 생성합니다.
fn create_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS base_folders (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            path TEXT NOT NULL,
            label TEXT NOT NULL,
            purpose TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS files (
            uuid TEXT PRIMARY KEY,
            full_path TEXT NOT NULL UNIQUE,
            relative_path TEXT NOT NULL,
            role TEXT NOT NULL,
            base_folder_id TEXT NOT NULL,
            extension TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            title TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS links (
            source_uuid TEXT NOT NULL,
            target_uuid TEXT NOT NULL,
            excerpt TEXT NOT NULL,
            PRIMARY KEY (source_uuid, target_uuid, excerpt)
        );
        CREATE TABLE IF NOT EXISTS lifelog_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            room_or_sender TEXT NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            sent_date TEXT NOT NULL,
            sent_time TEXT NOT NULL,
            attachment_uuid TEXT,
            dedup_key TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS finance_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tx_date TEXT NOT NULL,
            tx_time TEXT NOT NULL,
            institution TEXT NOT NULL,
            tx_type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            merchant TEXT NOT NULL,
            category TEXT NOT NULL,
            memo TEXT NOT NULL,
            verify_status TEXT NOT NULL,
            dedup_key TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS media_inbox (
            uuid TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            full_path TEXT NOT NULL,
            taken_date TEXT NOT NULL,
            taken_time TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            status TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mobile_sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS paired_devices (
            device_id TEXT PRIMARY KEY,
            device_name TEXT NOT NULL,
            model TEXT NOT NULL,
            paired_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS synced_file_hashes (
            file_hash TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            synced_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lifelog_call_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone_number TEXT NOT NULL,
            contact_name TEXT NOT NULL,
            call_type TEXT NOT NULL,
            duration_sec INTEGER NOT NULL,
            call_date TEXT NOT NULL,
            call_time TEXT NOT NULL,
            timestamp_ms INTEGER NOT NULL,
            dedup_key TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS kakao_room_sync_state (
            room_name TEXT PRIMARY KEY,
            folder_name TEXT NOT NULL DEFAULT '',
            last_message TEXT NOT NULL DEFAULT '',
            last_message_ts INTEGER NOT NULL DEFAULT 0,
            last_shared_ts INTEGER NOT NULL DEFAULT 0,
            total_bytes INTEGER NOT NULL DEFAULT 0,
            synced_bytes INTEGER NOT NULL DEFAULT 0,
            client_ack INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS domain_sync_state (
            domain TEXT PRIMARY KEY,
            latest_ts INTEGER NOT NULL DEFAULT 0,
            extra_json TEXT NOT NULL DEFAULT '{}',
            client_ack INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS call_transcript_meta (
            safe_stem TEXT PRIMARY KEY,
            stage INTEGER NOT NULL DEFAULT 1,
            user_requirement TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS pc_activity_events (
            aw_event_id INTEGER PRIMARY KEY,
            bucket_type TEXT NOT NULL,
            hostname TEXT NOT NULL,
            local_date TEXT NOT NULL,
            local_time TEXT NOT NULL,
            local_hour INTEGER NOT NULL,
            timestamp_utc TEXT NOT NULL,
            duration_sec REAL NOT NULL,
            app_name TEXT NOT NULL DEFAULT '',
            window_title TEXT NOT NULL DEFAULT '',
            afk_status TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_pc_activity_date ON pc_activity_events(local_date, bucket_type);
        CREATE TABLE IF NOT EXISTS contact_ai_profiles (
            contact_name TEXT PRIMARY KEY,
            profile_text TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS media_origin_registry (
            origin_hash TEXT PRIMARY KEY,
            blake3_hash TEXT NOT NULL DEFAULT '',
            origin_file_name TEXT NOT NULL,
            origin_file_size INTEGER NOT NULL DEFAULT 0,
            device_id TEXT NOT NULL DEFAULT '',
            device_name TEXT NOT NULL DEFAULT '',
            taken_date TEXT NOT NULL DEFAULT '',
            taken_time TEXT NOT NULL DEFAULT '',
            current_status TEXT NOT NULL DEFAULT 'original',
            current_path TEXT NOT NULL DEFAULT '',
            current_hash TEXT NOT NULL DEFAULT '',
            history_note TEXT NOT NULL DEFAULT '',
            first_synced_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS lifelog_location_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL DEFAULT '',
            device_name TEXT NOT NULL DEFAULT '',
            event_type TEXT NOT NULL DEFAULT 'passive',
            place_label TEXT NOT NULL DEFAULT '',
            wifi_ssid TEXT NOT NULL DEFAULT '',
            wifi_bssid TEXT NOT NULL DEFAULT '',
            latitude REAL NOT NULL DEFAULT 0.0,
            longitude REAL NOT NULL DEFAULT 0.0,
            accuracy_m REAL NOT NULL DEFAULT 0.0,
            battery_pct INTEGER NOT NULL DEFAULT -1,
            log_date TEXT NOT NULL,
            log_time TEXT NOT NULL,
            timestamp_ms INTEGER NOT NULL,
            dedup_key TEXT NOT NULL UNIQUE
        );
        CREATE INDEX IF NOT EXISTS idx_location_logs_date ON lifelog_location_logs(log_date, timestamp_ms);
        CREATE TABLE IF NOT EXISTS kakao_update_requests (
            room_name TEXT PRIMARY KEY,
            pending_noti_count INTEGER NOT NULL DEFAULT 1,
            last_sender TEXT NOT NULL DEFAULT '',
            last_message_preview TEXT NOT NULL DEFAULT '',
            last_noti_date TEXT NOT NULL DEFAULT '',
            last_noti_time TEXT NOT NULL DEFAULT '',
            last_noti_ts INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS kakao_auto_channels (
            channel_name TEXT PRIMARY KEY,
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS contact_prompt_slots (
            slot TEXT PRIMARY KEY,
            version INTEGER NOT NULL DEFAULT 1,
            prompt_title TEXT NOT NULL DEFAULT '',
            prompt_text TEXT NOT NULL DEFAULT '',
            win_count INTEGER NOT NULL DEFAULT 0,
            loss_count INTEGER NOT NULL DEFAULT 0,
            consecutive_losses INTEGER NOT NULL DEFAULT 0,
            last_evolution_reason TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS contact_prompt_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            replaced_slot TEXT NOT NULL,
            old_version INTEGER NOT NULL,
            new_version INTEGER NOT NULL,
            winner_slot TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            evolution_summary TEXT NOT NULL DEFAULT '',
            old_prompt_text TEXT NOT NULL DEFAULT '',
            new_prompt_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS contact_profile_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_name TEXT NOT NULL,
            md_path TEXT NOT NULL DEFAULT '',
            doc_uuid TEXT NOT NULL DEFAULT '',
            source_type TEXT NOT NULL DEFAULT 'manual',
            source_ref TEXT NOT NULL DEFAULT '',
            event_summary TEXT NOT NULL DEFAULT '',
            original_profile_text TEXT NOT NULL DEFAULT '',
            prompt_a_version INTEGER NOT NULL DEFAULT 1,
            prompt_b_version INTEGER NOT NULL DEFAULT 1,
            candidate_a_text TEXT NOT NULL DEFAULT '',
            candidate_b_text TEXT NOT NULL DEFAULT '',
            llm_provider TEXT NOT NULL DEFAULT 'gemini',
            status TEXT NOT NULL DEFAULT 'pending',
            chosen_slot TEXT NOT NULL DEFAULT '',
            user_edited INTEGER NOT NULL DEFAULT 0,
            final_profile_text TEXT NOT NULL DEFAULT '',
            evolution_note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT '',
            resolved_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS voiceprint_profiles (
            profile_id TEXT PRIMARY KEY,
            target_type TEXT NOT NULL DEFAULT 'user',
            display_name TEXT NOT NULL DEFAULT '',
            source_mode TEXT NOT NULL DEFAULT 'server_mic',
            model_a_name TEXT NOT NULL DEFAULT '3dspeaker_campplus_192d',
            model_b_name TEXT NOT NULL DEFAULT 'wespeaker_resnet34_256d',
            embedding_a_json TEXT NOT NULL DEFAULT '[]',
            embedding_b_json TEXT NOT NULL DEFAULT '[]',
            sample_count INTEGER NOT NULL DEFAULT 0,
            consistency_a REAL NOT NULL DEFAULT 0.0,
            consistency_b REAL NOT NULL DEFAULT 0.0,
            cross_agreement_score REAL NOT NULL DEFAULT 0.0,
            samples_meta_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL DEFAULT ''
        );
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 컬럼 추가 마이그레이션 (이미 존재하면 오류를 무시합니다).
///
/// TODO: `PRAGMA user_version` 기반 버전 마이그레이션으로 전환
fn apply_column_migrations(conn: &Connection) {
    // 다중 기기 출처 및 서비스별 독립 동기화 타임스탬프 컬럼 마이그레이션
    for sql in [
        "ALTER TABLE lifelog_messages ADD COLUMN device_id TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE lifelog_messages ADD COLUMN device_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE lifelog_call_logs ADD COLUMN device_id TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE lifelog_call_logs ADD COLUMN device_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE paired_devices ADD COLUMN last_kakao_ts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE paired_devices ADD COLUMN last_noti_ts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE paired_devices ADD COLUMN last_sms_ts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE paired_devices ADD COLUMN last_call_ts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE paired_devices ADD COLUMN last_recording_ts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE paired_devices ADD COLUMN last_health_ts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE paired_devices ADD COLUMN last_contact_ts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE paired_devices ADD COLUMN last_usage_ts INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = conn.execute(sql, []);
    }
}

/// 페어링 토큰 / 기본 베이스 폴더 3종 시드.
///
/// - 허용 Wi-Fi SSID는 시드하지 않습니다. 페어링 QR을 만들 때 **PC가 현재 연결된 Wi-Fi**를 자동으로 넣습니다. (`mobile::pairing`)
/// - 기본 베이스 폴더는 `%USERPROFILE%\Documents\myLore\{Data,Diary,Projects}` 이며, 설정 화면에서 변경할 수 있습니다.
fn seed_default_meta_and_base_folders(conn: &Connection) {
    // 기본 페어링 토큰 초기화
    let has_token: Option<String> = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'pairing_token'",
            [],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    if has_token.is_none() {
        let raw_uuid = Uuid::new_v4().to_string().replace('-', "");
        let token = format!("mylore_sec_{}", raw_uuid);
        let _ = conn.execute(
            "INSERT OR IGNORE INTO mobile_sync_meta (key, value) VALUES ('pairing_token', ?1)",
            params![token],
        );
    }

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM base_folders", [], |r| r.get(0))
        .unwrap_or(0);
    let docs_root = detect_default_docs_root_dir();
    let git_root = detect_default_git_root_dir();
    let pic_root = detect_default_picture_root_dir();

    if count == 0 {
        let defaults = vec![
            (
                "base-projects-1",
                "projects",
                docs_root.join("Projects"),
                "프로젝트 (Docs/Projects)",
                "폴더별 main.md 기반 프로젝트 관리 볼트",
            ),
            (
                "base-diary-1",
                "diary",
                docs_root.join("Diary"),
                "일기 (Docs/Diary)",
                "매일의 작업/일상 기록 및 구글 캘린더 1:1 동기화 폴더",
            ),
            (
                "base-data-1",
                "data",
                docs_root.clone(),
                "Docs (통합 문서 · 아카이브)",
                "Docs 통합 문서 루트 및 Mobile 라이프로그 아카이브",
            ),
            (
                "base-git-1",
                "git",
                git_root,
                "Git (개발 프로젝트)",
                "개발 프로젝트 참고용 코드/문서 폴더 (UUID 미주입)",
            ),
            (
                "base-picture-1",
                "picture",
                pic_root,
                "Picture (사진첩)",
                "내 장치들의 사진/영상 및 과거 사진 통합 저장소",
            ),
        ];
        for (id, role, path, label, purpose) in defaults {
            let _ = fs::create_dir_all(&path);
            let _ = conn.execute(
                "INSERT INTO base_folders (id, role, path, label, purpose, enabled) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![id, role, path.to_string_lossy().to_string(), label, purpose],
            );
        }
        let _ = fs::create_dir_all(docs_root.join("Mobile"));
        invalidate_cached_data_base_path();
    } else {
        // 기존 DB가 레거시 OneDrive 개별 폴더(Projects, Diary, iseohyunDocs)를 가리키고 있고,
        // 새 Docs 통합 구조(docs_root/Projects/main.md, docs_root/Diary, docs_root/Mobile)가 존재하면 자동 마이그레이션 수행
        let old_proj: Option<String> = conn
            .query_row(
                "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        let old_diary: Option<String> = conn
            .query_row(
                "SELECT path FROM base_folders WHERE role = 'diary' AND enabled = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        let old_data: Option<String> = conn
            .query_row(
                "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);

        let new_proj_dir = docs_root.join("Projects");
        let new_diary_dir = docs_root.join("Diary");
        let new_mobile_dir = docs_root.join("Mobile");

        let old_proj_missing_main = old_proj
            .as_ref()
            .map(|p| !Path::new(p).join("main.md").is_file())
            .unwrap_or(true);
        let new_docs_ready =
            new_proj_dir.join("main.md").is_file() && new_diary_dir.is_dir() && new_mobile_dir.is_dir();

        if old_proj_missing_main && new_docs_ready {
            let new_proj_str = new_proj_dir.to_string_lossy().to_string();
            let new_diary_str = new_diary_dir.to_string_lossy().to_string();
            let new_docs_str = docs_root.to_string_lossy().to_string();

            let _ = conn.execute(
                "UPDATE base_folders SET path = ?1, label = '프로젝트 (Docs/Projects)' WHERE role = 'projects'",
                params![new_proj_str],
            );
            let _ = conn.execute(
                "UPDATE base_folders SET path = ?1, label = '일기 (Docs/Diary)' WHERE role = 'diary'",
                params![new_diary_str],
            );
            let _ = conn.execute(
                "UPDATE base_folders SET path = ?1, label = 'Docs (통합 문서 · 아카이브)' WHERE role = 'data'",
                params![new_docs_str],
            );

            // files 테이블 내의 구 경로를 새 Docs 하위 경로(및 소문자 mobile -> 대문자 Mobile)로 일괄 매핑
            if let Ok(mut stmt) = conn.prepare("SELECT uuid, full_path FROM files") {
                let rows: Vec<(String, String)> = stmt
                    .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .ok()
                    .into_iter()
                    .flatten()
                    .filter_map(|r| r.ok())
                    .collect();
                for (u, fp) in rows {
                    let mut updated_fp: Option<String> = None;
                    if let Some(ref op) = old_proj {
                        if let Ok(rel) = Path::new(&fp).strip_prefix(Path::new(op)) {
                            let candidate = new_proj_dir.join(rel);
                            if candidate.is_file() {
                                updated_fp = Some(candidate.to_string_lossy().to_string());
                            }
                        }
                    }
                    if updated_fp.is_none() {
                        if let Some(ref od) = old_diary {
                            if let Ok(rel) = Path::new(&fp).strip_prefix(Path::new(od)) {
                                let candidate = new_diary_dir.join(rel);
                                if candidate.is_file() {
                                    updated_fp = Some(candidate.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                    if updated_fp.is_none() {
                        if let Some(ref odata) = old_data {
                            if let Ok(rel) = Path::new(&fp).strip_prefix(Path::new(odata)) {
                                let rel_str = rel.to_string_lossy().to_string();
                                let remapped_rel = if rel_str.starts_with("mobile\\")
                                    || rel_str.starts_with("mobile/")
                                {
                                    format!("Mobile{}", &rel_str[6..])
                                } else {
                                    rel_str
                                };
                                let candidate = docs_root.join(&remapped_rel);
                                if candidate.is_file() {
                                    updated_fp = Some(candidate.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                    if let Some(nfp) = updated_fp {
                        let _ = conn.execute(
                            "UPDATE files SET full_path = ?1 WHERE uuid = ?2",
                            params![nfp, u],
                        );
                    }
                }
            }
            invalidate_cached_data_base_path();
        }

        // git 또는 picture 베이스 폴더가 아직 없으면 기본 등록
        let has_git: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM base_folders WHERE role = 'git'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if has_git == 0 && git_root.is_dir() {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO base_folders (id, role, path, label, purpose, enabled) VALUES ('base-git-1', 'git', ?1, 'Git (개발 프로젝트)', '개발 프로젝트 참고용 코드/문서 폴더 (UUID 미주입)', 1)",
                params![git_root.to_string_lossy().to_string()],
            );
        }

        let has_pic: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM base_folders WHERE role = 'picture'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if has_pic == 0 {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO base_folders (id, role, path, label, purpose, enabled) VALUES ('base-picture-1', 'picture', ?1, 'Picture (사진첩)', '내 장치들의 사진/영상 및 과거 사진 통합 저장소', 1)",
                params![pic_root.to_string_lossy().to_string()],
            );
        }
    }

    repair_moved_files_table_paths(conn);
}

/// `base_folders`가 3대 카테고리(`Docs`·`Git`·`Picture`)로 구성되었거나 볼트 폴더가 이동된 경우,
/// `files` 테이블의 `full_path`, `relative_path`, `role`을 실제 디스크상의 `Docs/Projects`, `Docs/Diary`, `Docs` 경로와 일치하도록 자동 보정합니다.
pub(crate) fn repair_moved_files_table_paths(conn: &Connection) {
    let proj_base = PathBuf::from(projects_base_path_string(conn));
    let diary_base = PathBuf::from(diary_base_path_string(conn));
    let data_base = PathBuf::from(data_base_path_string(conn));

    let Ok(mut stmt) = conn.prepare("SELECT uuid, full_path, relative_path, role FROM files") else {
        return;
    };
    let rows: Vec<(String, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|r| r.ok())
        .collect();

    for (u, fp, rel_path, role) in rows {
        let norm_rel = rel_path.replace('/', "\\");
        let mut target_role = role.clone();
        let mut target_rel = norm_rel.clone();
        let mut target_fp: Option<PathBuf> = None;

        if role == "projects" {
            let cand = proj_base.join(&norm_rel);
            if cand.is_file() {
                target_fp = Some(cand);
            }
        } else if role == "diary" {
            let cand = diary_base.join(&norm_rel);
            if cand.is_file() {
                target_fp = Some(cand);
            }
        } else if role == "data" {
            let lower_rel = norm_rel.to_ascii_lowercase();
            if lower_rel.starts_with("projects\\") && norm_rel.len() > 9 {
                let stripped = norm_rel[9..].to_string();
                let cand = proj_base.join(&stripped);
                if cand.is_file() {
                    target_role = "projects".to_string();
                    target_rel = stripped;
                    target_fp = Some(cand);
                }
            } else if lower_rel.starts_with("diary\\") && norm_rel.len() > 6 {
                let stripped = norm_rel[6..].to_string();
                let cand = diary_base.join(&stripped);
                if cand.is_file() {
                    target_role = "diary".to_string();
                    target_rel = stripped;
                    target_fp = Some(cand);
                }
            } else {
                let remapped = if norm_rel.starts_with("mobile\\") {
                    format!("Mobile{}", &norm_rel[6..])
                } else {
                    norm_rel.clone()
                };
                let cand = data_base.join(&remapped);
                if cand.is_file() {
                    target_rel = remapped;
                    target_fp = Some(cand);
                }
            }
        }

        if let Some(nfp_buf) = target_fp {
            let nfp_str = nfp_buf.to_string_lossy().to_string();
            if nfp_str != fp || target_rel != rel_path || target_role != role {
                let _ = conn.execute(
                    "DELETE FROM files WHERE full_path = ?1 AND uuid != ?2",
                    params![nfp_str, u],
                );
                let _ = conn.execute(
                    "UPDATE files SET full_path = ?1, relative_path = ?2, role = ?3 WHERE uuid = ?4",
                    params![nfp_str, target_rel, target_role, u],
                );
            }
        } else if !Path::new(&fp).is_file() {
            let _ = conn.execute("DELETE FROM files WHERE uuid = ?1", params![u]);
        }
    }
}

pub(crate) fn get_meta_i64(conn: &Connection, key: &str) -> i64 {
    conn.query_row(
        "SELECT value FROM mobile_sync_meta WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| s.parse::<i64>().ok())
    .unwrap_or(0)
}

pub(crate) fn set_meta_i64_max(conn: &Connection, key: &str, candidate: i64) {
    let cur = get_meta_i64(conn, key);
    if candidate > cur {
        let _ = conn.execute(
            "INSERT INTO mobile_sync_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, candidate.to_string()],
        );
    }
}
