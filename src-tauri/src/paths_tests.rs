//! `paths` 단위 테스트: 레거시 메타 DB 이전(`VACUUM INTO`).

use crate::*;

fn temp_case_dir(name: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "mylore_paths_test_{}_{}_{}",
        name,
        std::process::id(),
        nanos
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 테스트 임시 폴더 정리. (`fs::remove_dir_all`은 MinGW 링커 환경의 테스트 바이너리에서
/// 진입점 누락(STATUS_ENTRYPOINT_NOT_FOUND)을 일으켜 WalkDir + remove_file/remove_dir로 직접 지웁니다.)
fn cleanup(dir: &Path) {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(dir).into_iter().flatten() {
        if entry.file_type().is_dir() {
            dirs.push(entry.path().to_path_buf());
        } else {
            let _ = fs::remove_file(entry.path());
        }
    }
    for d in dirs.iter().rev() {
        let _ = fs::remove_dir(d);
    }
}

#[test]
fn migrate_meta_db_copies_wal_content_and_keeps_legacy() {
    let dir = temp_case_dir("migrate");
    let legacy = dir.join("legacy").join(META_DB_FILE_NAME);
    let target = dir.join("appdata").join(META_DB_FILE_NAME);
    fs::create_dir_all(legacy.parent().unwrap()).unwrap();

    // WAL 모드에서 체크포인트 전 데이터가 남아 있는 상태를 만든다 (연결을 열어 둔 채로 이전)
    let src = Connection::open(&legacy).unwrap();
    src.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE t (v TEXT);
         INSERT INTO t (v) VALUES ('hello'), ('세계');",
    )
    .unwrap();

    migrate_meta_db(&legacy, &target).unwrap();

    let dst = Connection::open(&target).unwrap();
    let count: i64 = dst.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 2);
    assert!(legacy.exists(), "레거시 DB는 삭제하지 않아야 함");
    assert!(!target.with_extension("db.migrating").exists(), "임시 파일이 남지 않아야 함");

    drop(src);
    drop(dst);
    cleanup(&dir);
}

#[test]
fn migrate_meta_db_fails_cleanly_for_missing_legacy_dir() {
    let dir = temp_case_dir("missing");
    let legacy = dir.join("nope").join("not_a_dir").join(META_DB_FILE_NAME);
    let target = dir.join("appdata").join(META_DB_FILE_NAME);
    assert!(migrate_meta_db(&legacy, &target).is_err());
    assert!(!target.exists());
    cleanup(&dir);
}

#[test]
fn default_paths_are_not_hardcoded_to_a_user() {
    let p = meta_db_path();
    assert!(p.ends_with(Path::new(APP_IDENTIFIER).join(META_DB_FILE_NAME)));
    assert!(default_data_base_dir().ends_with(Path::new("myLore").join("Data")));
    assert!(default_projects_base_dir().ends_with(Path::new("myLore").join("Projects")));
    let resolved = resolve_meta_db_path();
    assert!(resolved.ends_with(META_DB_FILE_NAME));
}

#[test]
fn migrate_meta_db_replaces_existing_empty_target() {
    let dir = temp_case_dir("replace_empty");
    let legacy = dir.join("legacy").join(META_DB_FILE_NAME);
    let target = dir.join("appdata").join(META_DB_FILE_NAME);
    fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    fs::create_dir_all(target.parent().unwrap()).unwrap();

    // target이 빈 시드 DB로 먼저 존재하는 상황 재현
    let empty_dst = Connection::open(&target).unwrap();
    empty_dst
        .execute_batch("CREATE TABLE lifelog_messages (id INTEGER PRIMARY KEY);")
        .unwrap();
    drop(empty_dst);
    assert_eq!(count_meta_db_records(&target), 0);

    // legacy에는 실데이터가 존재
    let src = Connection::open(&legacy).unwrap();
    src.execute_batch(
        "CREATE TABLE lifelog_messages (id INTEGER PRIMARY KEY);
         INSERT INTO lifelog_messages (id) VALUES (1), (2), (3);",
    )
    .unwrap();
    drop(src);
    assert_eq!(count_meta_db_records(&legacy), 3);

    migrate_meta_db(&legacy, &target).unwrap();
    assert_eq!(count_meta_db_records(&target), 3);

    cleanup(&dir);
}
