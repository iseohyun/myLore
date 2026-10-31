//! 앱 경로 해석: 메타 DB(`%APPDATA%`), 기본 베이스 폴더, 레거시 DB 이전.
//!
//! 개인 PC에 종속된 절대 경로를 코드에 두지 않기 위해 모든 기본 경로는 환경 변수(`APPDATA`, `USERPROFILE`, `OneDrive`)에서 계산합니다.

use crate::*;

/// Tauri `identifier`(tauri.conf.json)와 동일한 앱 식별자. `%APPDATA%\{APP_IDENTIFIER}` 폴더 이름으로 사용합니다.
pub(crate) const APP_IDENTIFIER: &str = "com.iseohyun.mylore";

/// 메타 DB 파일 이름.
pub(crate) const META_DB_FILE_NAME: &str = "mylore_meta.db";

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// 클라우드 동기화 대상이 아닌 PC 로컬 앱 데이터 폴더: `%APPDATA%\com.iseohyun.mylore`
pub(crate) fn app_data_dir() -> PathBuf {
    env_dir("APPDATA")
        .or_else(|| env_dir("USERPROFILE").map(|p| p.join("AppData").join("Roaming")))
        .unwrap_or_else(std::env::temp_dir)
        .join(APP_IDENTIFIER)
}

/// SQLite 메타 DB 경로: `%APPDATA%\com.iseohyun.mylore\mylore_meta.db`
///
/// OneDrive 같은 동기화 폴더에 WAL 모드 SQLite를 두면 `-wal`/`-shm` 파일이 따로 업로드되어 손상될 수 있으므로 로컬 폴더를 사용합니다.
pub(crate) fn meta_db_path() -> PathBuf {
    app_data_dir().join(META_DB_FILE_NAME)
}

/// 앱 런타임 로그 폴더 경로: `%APPDATA%\com.iseohyun.mylore\logs`
///
/// OneDrive 등 클라우드 동기화 폴더(`Projects\.myLore\log`)에 수시로 기록되는 런타임 로그를 두면
/// 불필요한 동기화 부하가 발생하므로, 메타 DB와 동일한 로컬 `%APPDATA%` 하위에 통합 보관합니다.
pub(crate) fn app_logs_dir() -> PathBuf {
    app_data_dir().join("logs")
}

/// 최초 실행 시 기본 베이스 폴더를 만들 루트: `%USERPROFILE%\Documents\myLore`
pub(crate) fn default_user_root() -> PathBuf {
    env_dir("USERPROFILE")
        .map(|p| p.join("Documents"))
        .unwrap_or_else(app_data_dir)
        .join("myLore")
}

/// 데이터(아카이브) 베이스 폴더가 DB에 없을 때 사용할 기본 경로.
pub(crate) fn default_data_base_dir() -> PathBuf {
    default_user_root().join("Data")
}

/// 프로젝트 베이스 폴더가 DB에 없을 때 사용할 기본 경로.
pub(crate) fn default_projects_base_dir() -> PathBuf {
    default_user_root().join("Projects")
}

/// DB에 등록된 프로젝트 베이스 폴더 경로. 없으면 [`default_projects_base_dir`].
pub(crate) fn projects_base_path_string(conn: &Connection) -> String {
    conn.query_row(
        "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
        [],
        |r| r.get(0),
    )
    .unwrap_or_else(|_| default_projects_base_dir().to_string_lossy().to_string())
}

/// DB에 등록된 데이터(아카이브) 베이스 폴더 경로. 없으면 [`default_data_base_dir`].
pub(crate) fn data_base_path_string(conn: &Connection) -> String {
    conn.query_row(
        "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
        [],
        |r| r.get(0),
    )
    .unwrap_or_else(|_| default_data_base_dir().to_string_lossy().to_string())
}

/// 사진첩 동기화 루트 폴더(`Picture\extern`) 경로를 해석합니다.
/// 프로젝트/데이터 베이스 폴더의 상위 폴더(예: `OneDrive\Picture\extern`) 또는 환경 변수 `OneDrive\Picture\extern`을 우선 사용합니다.
pub(crate) fn resolve_picture_extern_root_dir(conn: &Connection) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let proj_base = PathBuf::from(projects_base_path_string(conn));
    if let Some(parent) = proj_base.parent() {
        candidates.push(parent.join("Picture"));
    }
    let data_base = PathBuf::from(data_base_path_string(conn));
    if let Some(parent) = data_base.parent() {
        candidates.push(parent.join("Picture"));
    }
    for env_root in [
        env_dir("OneDrive"),
        env_dir("OneDriveConsumer"),
        env_dir("USERPROFILE").map(|p| p.join("OneDrive")),
    ]
    .into_iter()
    .flatten()
    {
        candidates.push(env_root.join("Picture"));
    }

    let picture_root = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .or_else(|| candidates.into_iter().next())
        .unwrap_or_else(|| default_user_root().join("Picture"));

    let extern_dir = picture_root.join("extern");
    let _ = fs::create_dir_all(&extern_dir);
    extern_dir
}

/// 연결된 기기의 이름(모델명 우선, 예: `SM-S901N`)에 따라 사진첩 동기화 대상 폴더(`Picture\extern\SM-S901N`) 경로를 반환합니다.
pub(crate) fn resolve_picture_extern_device_dir(
    conn: &Connection,
    dev_id: &str,
    dev_name: &str,
) -> PathBuf {
    let normalize_model_label = |raw: &str| -> String {
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || trimmed.eq_ignore_ascii_case("Android Device")
            || trimmed.eq_ignore_ascii_case("Unknown Model")
        {
            return String::new();
        }
        // "samsung SM-S901N" 형태이면 모델 코드("SM-S901N")만 추출
        let stripped = if trimmed.len() > 8 && trimmed[..8].eq_ignore_ascii_case("samsung ") {
            trimmed[8..].trim()
        } else {
            trimmed
        };
        sanitize_filename_stem(stripped)
    };

    let mut folder_label = String::new();

    if !dev_id.trim().is_empty() {
        if let Ok((model, dname)) = conn.query_row(
            "SELECT COALESCE(model, ''), COALESCE(device_name, '') FROM paired_devices WHERE device_id = ?1 LIMIT 1",
            params![dev_id.trim()],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) {
            folder_label = normalize_model_label(&model);
            if folder_label.is_empty() {
                folder_label = normalize_model_label(&dname);
            }
        }
    }

    if folder_label.is_empty() {
        folder_label = normalize_model_label(dev_name);
    }

    if folder_label.is_empty() {
        if let Ok((model, dname)) = conn.query_row(
            "SELECT COALESCE(model, ''), COALESCE(device_name, '') FROM paired_devices ORDER BY last_sync_at DESC LIMIT 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ) {
            folder_label = normalize_model_label(&model);
            if folder_label.is_empty() {
                folder_label = normalize_model_label(&dname);
            }
        }
    }

    if folder_label.is_empty() || folder_label == "미분류" {
        folder_label = "SM-S901N".to_string();
    }

    let target_dir = resolve_picture_extern_root_dir(conn).join(folder_label);
    let _ = fs::create_dir_all(&target_dir);
    target_dir
}

/// 이전 버전이 메타 DB를 두던 위치 후보 (`{OneDrive}\Projects\.myLore\mylore_meta.db`).
fn legacy_meta_db_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let roots = [
        env_dir("OneDrive"),
        env_dir("OneDriveConsumer"),
        env_dir("USERPROFILE").map(|p| p.join("OneDrive")),
    ];
    for root in roots.into_iter().flatten() {
        let p = root.join("Projects").join(".myLore").join(META_DB_FILE_NAME);
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// DB에 저장된 `lifelog_messages` 건수와 `files` 건수의 합계를 반환합니다.
pub(crate) fn count_meta_db_records(db_path: &Path) -> i64 {
    if !db_path.is_file() {
        return 0;
    }
    let Ok(conn) = Connection::open(db_path) else {
        return 0;
    };
    let msg_cnt: i64 = conn
        .query_row("SELECT COUNT(*) FROM lifelog_messages", [], |r| r.get(0))
        .unwrap_or(0);
    let file_cnt: i64 = conn
        .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))
        .unwrap_or(0);
    let dev_cnt: i64 = conn
        .query_row("SELECT COUNT(*) FROM paired_devices", [], |r| r.get(0))
        .unwrap_or(0);
    msg_cnt + file_cnt + dev_cnt
}

/// 앱이 사용할 메타 DB 경로를 결정합니다. (필요하면 레거시 위치에서 이전)
///
/// 1. `%APPDATA%` 위치에 DB가 있고, 레거시(OneDrive) DB보다 데이터가 많거나 같으면 그대로 사용
/// 2. `%APPDATA%` DB가 없거나 초기 빈 시드 상태(또는 레거시 DB에 훨씬 많은 실데이터가 있는 경우)이면
///    레거시 위치(OneDrive) DB를 `VACUUM INTO`로 이전 후 새 위치 사용
///    - 이전에 실패하면 데이터가 비어 보이지 않도록 **이번 실행은 레거시 DB를 그대로 사용**하고 다음 실행 때 다시 시도
/// 3. 둘 다 없으면 새 위치에 새 DB 생성
pub(crate) fn resolve_meta_db_path() -> PathBuf {
    let target = meta_db_path();
    let target_records = count_meta_db_records(&target);

    if let Some(legacy) = legacy_meta_db_candidates().into_iter().find(|p| p.is_file()) {
        let legacy_records = count_meta_db_records(&legacy);
        // target이 없거나, target이 초기 빈 상태(레코드 50개 미만)인데 legacy에 더 많은 데이터가 있는 경우 이전 수행
        if !target.exists() || (target_records < 50 && legacy_records > target_records) {
            match migrate_meta_db(&legacy, &target) {
                Ok(()) => {
                    eprintln!(
                        "[myLore] 메타 DB 이전 완료: {} ({}건) -> {} ",
                        legacy.display(),
                        legacy_records,
                        target.display()
                    );
                    return target;
                }
                Err(e) => {
                    eprintln!(
                        "[myLore] 메타 DB 이전 실패, 기존 위치를 계속 사용합니다 ({}): {}",
                        legacy.display(),
                        e
                    );
                    return legacy;
                }
            }
        }
    }

    target
}

/// `legacy` DB를 `VACUUM INTO`로 `target`에 복사합니다.
///
/// - WAL에 남아 있는 변경분까지 포함된 일관된 단일 파일 사본이 만들어집니다.
/// - 원본(레거시) DB는 **삭제하거나 변경하지 않습니다.** (검증 후 사용자가 직접 정리)
pub(crate) fn migrate_meta_db(legacy: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("db.migrating");
    let _ = fs::remove_file(&tmp);
    let result = (|| -> Result<(), String> {
        let src = Connection::open(legacy).map_err(|e| e.to_string())?;
        let _ = src.busy_timeout(std::time::Duration::from_millis(5000));
        src.execute("VACUUM INTO ?1", params![tmp.to_string_lossy().to_string()])
            .map_err(|e| e.to_string())?;
        drop(src);
        let _ = fs::remove_file(target);
        let _ = fs::remove_file(format!("{}-wal", target.to_string_lossy()));
        let _ = fs::remove_file(format!("{}-shm", target.to_string_lossy()));
        fs::rename(&tmp, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
