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

/// 앱이 사용할 메타 DB 경로를 결정합니다. (필요하면 레거시 위치에서 이전)
///
/// 1. `%APPDATA%` 위치에 DB가 있으면 그대로 사용
/// 2. 없고 레거시 위치(OneDrive)에 DB가 있으면 `VACUUM INTO`로 이전 후 새 위치 사용
///    - 이전에 실패하면 데이터가 비어 보이지 않도록 **이번 실행은 레거시 DB를 그대로 사용**하고 다음 실행 때 다시 시도
/// 3. 둘 다 없으면 새 위치에 새 DB 생성
pub(crate) fn resolve_meta_db_path() -> PathBuf {
    let target = meta_db_path();
    if target.exists() {
        return target;
    }
    match legacy_meta_db_candidates().into_iter().find(|p| p.is_file()) {
        Some(legacy) => match migrate_meta_db(&legacy, &target) {
            Ok(()) => {
                eprintln!(
                    "[myLore] 메타 DB 이전 완료: {} -> {}",
                    legacy.display(),
                    target.display()
                );
                target
            }
            Err(e) => {
                eprintln!(
                    "[myLore] 메타 DB 이전 실패, 기존 위치를 계속 사용합니다 ({}): {}",
                    legacy.display(),
                    e
                );
                legacy
            }
        },
        None => target,
    }
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
        fs::rename(&tmp, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
