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

/// 일기 베이스 폴더가 DB에 없을 때 사용할 기본 경로.
pub(crate) fn default_diary_base_dir() -> PathBuf {
    default_user_root().join("Diary")
}

/// DB에 등록된 데이터(아카이브/Docs) 베이스 폴더 경로. 없으면 [`default_data_base_dir`].
pub(crate) fn data_base_path_string(conn: &Connection) -> String {
    conn.query_row(
        "SELECT path FROM base_folders WHERE role = 'data' AND enabled = 1 LIMIT 1",
        [],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| detect_default_docs_root_dir().to_string_lossy().to_string())
}

/// DB에 등록된 프로젝트 베이스 폴더 경로.
/// `base_folders`에 별도의 `projects` 행이 없더라도 3대 카테고리(`Docs`) 하위의 `Projects` 폴더를 자동으로 해석합니다.
pub(crate) fn projects_base_path_string(conn: &Connection) -> String {
    if let Ok(explicit) = conn.query_row(
        "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
        [],
        |r| r.get::<_, String>(0),
    ) {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return trimmed.to_string();
        }
    }

    let docs_base = PathBuf::from(data_base_path_string(conn));
    let default_proj = docs_base.join("Projects");
    let candidate_setting = default_proj.join(".myLore").join("setting.json");
    if candidate_setting.is_file() {
        if let Ok(raw) = fs::read_to_string(&candidate_setting) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(sub) = parsed.get("topicFolderProjects").and_then(|v| v.as_str()) {
                    let resolved = resolve_topic_sub_or_abs_path(&docs_base, sub, "Projects");
                    return resolved.to_string_lossy().to_string();
                }
            }
        }
    }
    if docs_base.exists() || default_proj.exists() {
        return default_proj.to_string_lossy().to_string();
    }
    default_projects_base_dir().to_string_lossy().to_string()
}

/// DB에 등록된 일기(`diary`) 베이스 폴더 경로.
/// `base_folders`에 별도의 `diary` 행이 없더라도 3대 카테고리(`Docs`) 하위의 `Diary` 폴더를 자동으로 해석합니다.
pub(crate) fn diary_base_path_string(conn: &Connection) -> String {
    if let Ok(explicit) = conn.query_row(
        "SELECT path FROM base_folders WHERE role = 'diary' AND enabled = 1 LIMIT 1",
        [],
        |r| r.get::<_, String>(0),
    ) {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return trimmed.to_string();
        }
    }

    let docs_base = PathBuf::from(data_base_path_string(conn));
    let proj_base = PathBuf::from(projects_base_path_string(conn));
    let setting_path = proj_base.join(".myLore").join("setting.json");
    if setting_path.is_file() {
        if let Ok(raw) = fs::read_to_string(&setting_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(sub) = parsed.get("topicFolderDiary").and_then(|v| v.as_str()) {
                    let resolved = resolve_topic_sub_or_abs_path(&docs_base, sub, "Diary");
                    return resolved.to_string_lossy().to_string();
                }
            }
        }
    }
    let default_diary = docs_base.join("Diary");
    if docs_base.exists() || default_diary.exists() {
        return default_diary.to_string_lossy().to_string();
    }
    default_diary_base_dir().to_string_lossy().to_string()
}

/// 특정 역할(`projects`, `diary`, `data`, `git`, `picture`)에 대응하는 `(base_id, PathBuf)`를 반환합니다.
/// 3대 카테고리(`Docs`·`Git`·`Picture`)만 `base_folders`에 등록된 경우에도 `Docs/Projects` 및 `Docs/Diary`를 자동 해석합니다.
pub(crate) fn resolve_role_base_folder(
    conn: &Connection,
    role: &str,
) -> Result<(String, PathBuf), String> {
    if let Ok((id, path_str)) = conn.query_row(
        "SELECT id, path FROM base_folders WHERE role = ?1 AND enabled = 1 LIMIT 1",
        params![role],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    ) {
        let trimmed = path_str.trim();
        if !trimmed.is_empty() {
            return Ok((id, PathBuf::from(trimmed)));
        }
    }
    match role {
        "projects" => Ok((
            "base-projects-1".to_string(),
            PathBuf::from(projects_base_path_string(conn)),
        )),
        "diary" => Ok((
            "base-diary-1".to_string(),
            PathBuf::from(diary_base_path_string(conn)),
        )),
        "data" => Ok((
            "base-data-1".to_string(),
            PathBuf::from(data_base_path_string(conn)),
        )),
        "git" => Ok(("base-git-1".to_string(), detect_default_git_root_dir())),
        "picture" => Ok((
            "base-picture-1".to_string(),
            PathBuf::from(picture_base_path_string(conn)),
        )),
        _ => Err(format!(
            "역할({})에 해당하는 베이스 폴더가 설정되어 있지 않습니다.",
            role
        )),
    }
}

/// 스캔·가상 파일트리·문서 조회 시 사용할 유효 볼트 폴더 목록 `(id, role, path)`을 반환합니다.
/// - 사용자가 `base_folders`에 `Docs`(`data`), `Git`(`git`), `Picture`(`picture`) 3개만 등록해 둔 경우에도
///   `Docs` 하위의 `Projects`(`role = "projects"`)와 `Diary`(`role = "diary"`)를 자동으로 포함합니다.
/// - 경로 길이가 긴 하위 폴더(`Docs\Projects`, `Docs\Diary`)가 상위 폴더(`Docs`)보다 먼저 매칭되도록 내림차순 정렬합니다.
pub(crate) fn resolve_effective_vault_folders(
    conn: &Connection,
    include_git: bool,
) -> Vec<(String, String, String)> {
    let mut folders: Vec<(String, String, String)> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, role, path FROM base_folders WHERE enabled = 1 AND role != 'picture'",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        }) {
            for (id, role, path) in rows.flatten() {
                if !include_git && role == "git" {
                    continue;
                }
                if !path.trim().is_empty() {
                    folders.push((id, role, path.trim().to_string()));
                }
            }
        }
    }

    let has_projects = folders.iter().any(|(_, r, _)| r == "projects");
    if !has_projects {
        let proj_path = projects_base_path_string(conn);
        if !proj_path.trim().is_empty() {
            folders.push((
                "base-projects-1".to_string(),
                "projects".to_string(),
                proj_path,
            ));
        }
    }

    let has_diary = folders.iter().any(|(_, r, _)| r == "diary");
    if !has_diary {
        let diary_path = diary_base_path_string(conn);
        if !diary_path.trim().is_empty() {
            folders.push(("base-diary-1".to_string(), "diary".to_string(), diary_path));
        }
    }

    folders.sort_by(|a, b| b.2.len().cmp(&a.2.len()));
    folders
}

/// 사용자 환경에서 3대 카테고리 중 `Docs` 루트 폴더를 자동 탐지합니다.
/// 1) `%USERPROFILE%\Docs`, `%OneDrive%\Docs`
/// 2) `%USERPROFILE%` 직속 하위 폴더 중 내부에 `Projects`와 `Diary`(및 `Mobile`)를 함께 가진 통합 문서 폴더
/// 3) 없으면 [`default_user_root`]
pub(crate) fn detect_default_docs_root_dir() -> PathBuf {
    let mut direct_candidates: Vec<PathBuf> = Vec::new();
    if let Some(up) = env_dir("USERPROFILE") {
        direct_candidates.push(up.join("Docs"));
    }
    for od in [
        env_dir("OneDrive"),
        env_dir("OneDriveConsumer"),
        env_dir("USERPROFILE").map(|p| p.join("OneDrive")),
    ]
    .into_iter()
    .flatten()
    {
        direct_candidates.push(od.join("Docs"));
    }
    for c in &direct_candidates {
        if c.is_dir() {
            return c.clone();
        }
    }

    if let Some(up) = env_dir("USERPROFILE") {
        if let Ok(entries) = fs::read_dir(&up) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let name = p
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                if name.starts_with('.') || name.eq_ignore_ascii_case("OneDrive") {
                    continue;
                }
                if p.join("Projects").is_dir()
                    && p.join("Diary").is_dir()
                    && (p.join("Mobile").is_dir() || p.join("mobile").is_dir())
                {
                    return p;
                }
            }
        }
    }

    default_user_root()
}

/// 사용자 환경에서 3대 카테고리 중 `Git` 루트 폴더를 자동 탐지합니다.
pub(crate) fn detect_default_git_root_dir() -> PathBuf {
    let c_git = PathBuf::from(r"C:\git");
    if c_git.is_dir() {
        return c_git;
    }
    if let Some(up) = env_dir("USERPROFILE") {
        let up_git = up.join("git");
        if up_git.is_dir() {
            return up_git;
        }
    }
    default_user_root().join("Git")
}

/// 사용자 환경에서 3대 카테고리 중 `Picture` 루트 폴더를 자동 탐지합니다.
pub(crate) fn detect_default_picture_root_dir() -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(up) = env_dir("USERPROFILE") {
        candidates.push(up.join("Picture"));
    }
    for od in [
        env_dir("OneDrive"),
        env_dir("OneDriveConsumer"),
        env_dir("USERPROFILE").map(|p| p.join("OneDrive")),
    ]
    .into_iter()
    .flatten()
    {
        candidates.push(od.join("Picture"));
    }
    let docs_root = detect_default_docs_root_dir();
    if let Some(parent) = docs_root.parent() {
        candidates.push(parent.join("Picture"));
    }
    candidates.push(docs_root.join("Picture"));

    candidates
        .into_iter()
        .find(|p| p.is_dir())
        .unwrap_or_else(|| default_user_root().join("Picture"))
}

/// `Docs` 루트 대비 상대 폴더명(예: `"Projects"`, `"Diary"`, `"Mobile"`) 또는 절대 경로를 `PathBuf`로 해석합니다.
pub(crate) fn resolve_topic_sub_or_abs_path(
    docs_root: &Path,
    sub_or_abs: &str,
    default_sub: &str,
) -> PathBuf {
    let trimmed = sub_or_abs.trim();
    let effective = if trimmed.is_empty() {
        default_sub
    } else {
        trimmed
    };
    let candidate = Path::new(effective);
    if candidate.is_absolute() || effective.contains(':') || effective.starts_with(r"\\") {
        candidate.to_path_buf()
    } else {
        docs_root.join(effective)
    }
}

/// DB에 등록된 사진첩(`picture`) 베이스 폴더 경로. 없으면 자동 탐지된 `Picture` 폴더 경로를 반환합니다.
pub(crate) fn picture_base_path_string(conn: &Connection) -> String {
    conn.query_row(
        "SELECT path FROM base_folders WHERE role = 'picture' AND enabled = 1 LIMIT 1",
        [],
        |r| r.get(0),
    )
    .ok()
    .filter(|s: &String| !s.trim().is_empty())
    .unwrap_or_else(|| detect_default_picture_root_dir().to_string_lossy().to_string())
}

/// `Docs` 하위의 모바일 라이프로그 루트 폴더(`{Docs}/Mobile`) 경로를 해석합니다.
/// 설정(`topic_folder_mobile`, 기본값 `"Mobile"`)을 따르며, 소문자 `mobile`만 존재할 경우에도 호환합니다.
pub(crate) fn resolve_mobile_root_dir(conn: &Connection) -> PathBuf {
    let docs_base = PathBuf::from(data_base_path_string(conn));
    let mobile_sub_cfg = read_topic_folder_mobile(conn);
    let target = resolve_topic_sub_or_abs_path(&docs_base, &mobile_sub_cfg, "Mobile");
    if !target.exists() && mobile_sub_cfg.trim().eq_ignore_ascii_case("Mobile") {
        let legacy_lower = docs_base.join("mobile");
        if legacy_lower.is_dir() {
            return legacy_lower;
        }
    }
    let _ = fs::create_dir_all(&target);
    target
}

/// 사진첩 동기화 루트 폴더(`Picture\extern`) 경로를 해석합니다.
/// DB에 등록된 `picture` 베이스 폴더 또는 자동 탐지된 `Picture` 루트 하위의 `extern`을 사용합니다.
pub(crate) fn resolve_picture_extern_root_dir(conn: &Connection) -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let configured_pic = PathBuf::from(picture_base_path_string(conn));
    if !configured_pic.as_os_str().is_empty() {
        candidates.push(configured_pic);
    }
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
        let stripped = if trimmed.to_ascii_lowercase().starts_with("samsung ") {
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
