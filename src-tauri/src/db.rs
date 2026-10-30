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
        // 실행 순서가 중요합니다: 스키마 → 컬럼 마이그레이션 → 기본값 시드 → 템플릿 → 해시 시드 → 카톡 파일 마이그레이션
        create_schema(&conn)?;
        apply_column_migrations(&conn);
        seed_default_meta_and_base_folders(&conn);
        let _ = ensure_projects_mylore_templates(&conn);
        seed_synced_file_hashes(&conn);
        migrate_raw_kakao_chat_mds(&conn);
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

/// 페어링 토큰 / 허용 SSID / 기본 베이스 폴더 3종 시드.
///
/// TODO: 개인 경로·SSID 하드코딩을 `setting.json` 또는 최초 실행 마법사로 이전
fn seed_default_meta_and_base_folders(conn: &Connection) {
    // 기본 페어링 토큰 및 허용 Wi-Fi SSID (iseohyun, seohyun5G) 초기화
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

    let has_ssids: Option<String> = conn
        .query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'allowed_ssids'",
            [],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    if has_ssids.is_none() {
        let default_ssids = serde_json::json!(["iseohyun", "seohyun5G"]).to_string();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO mobile_sync_meta (key, value) VALUES ('allowed_ssids', ?1)",
            params![default_ssids],
        );
    }

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM base_folders", [], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        let defaults = vec![
            (
                "base-data-1",
                "data",
                r"C:\Users\iseoh\OneDrive\iseohyunDocs",
                "iseohyunDocs (데이터/아카이브)",
                "과거 문서, 위키, 부동산/재정, 미디어 원본 아카이브 및 분류 대기 문서",
            ),
            (
                "base-diary-1",
                "diary",
                r"C:\Users\iseoh\OneDrive\Diary",
                "OneDrive Diary (일기)",
                "매일의 주관적 작업/일상 기록 및 구글 캘린더 1:1 양방향 동기화 폴더",
            ),
            (
                "base-projects-1",
                "projects",
                r"C:\Users\iseoh\OneDrive\Projects",
                "OneDrive Projects (프로젝트)",
                "폴더별 main.md 기반 개발·아티클·영상 제작 프로젝트 관리 폴더",
            ),
        ];
        for (id, role, path, label, purpose) in defaults {
            let _ = conn.execute(
                "INSERT INTO base_folders (id, role, path, label, purpose, enabled) VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                params![id, role, path, label, purpose],
            );
        }
    }
}

fn seed_synced_file_hashes(conn: &Connection) {
    // 기존 마이그레이션 완료된 카카오톡 백업 파일 해시 3종 시드 등록 (중복 재전송 방지)
    let seeded_hashes = [
        (
            "70fff10a7a7ea94f690ba6ddfb3da67f157616534a9eb1c175ddedc64278971e",
            "박재홍, 이소영, Jun 4",
        ),
        (
            "c25ab6f5bda7ea7865d071398887f25793d6ca8b389de366ef13bd46cee8e5de",
            "임현정",
        ),
        (
            "a0b4ca7f25b8d715da5219bf7b3d252b7173a22a6341bf3d3f737e0114e99803",
            "정서현",
        ),
    ];
    for (fh, rname) in seeded_hashes {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO synced_file_hashes (file_hash, file_name, synced_at) VALUES (?1, ?2, '2026-10-30 07:15:00')",
            params![fh, rname],
        );
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
