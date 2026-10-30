//! 베이스 폴더 설정, 일괄 UUID 스캔(진행률), 가상 통합 트리.

use crate::*;

#[tauri::command]
pub(crate) fn get_base_folders(state: State<AppState>) -> Result<Vec<BaseFolderConfig>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let mut stmt = conn
        .prepare("SELECT id, role, path, label, purpose, enabled FROM base_folders")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(BaseFolderConfig {
                id: row.get(0)?,
                role: row.get(1)?,
                path: row.get(2)?,
                label: row.get(3)?,
                purpose: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn save_base_folders(
    state: State<AppState>,
    folders: Vec<BaseFolderConfig>,
) -> Result<Vec<BaseFolderConfig>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    conn.execute("DELETE FROM base_folders", [])
        .map_err(|e| e.to_string())?;
    for bf in &folders {
        conn.execute(
            "INSERT INTO base_folders (id, role, path, label, purpose, enabled) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                bf.id,
                bf.role,
                bf.path,
                bf.label,
                bf.purpose,
                if bf.enabled { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(folders)
}

#[tauri::command]
pub(crate) fn get_scan_progress(state: State<AppState>) -> Result<ScanProgressPayload, String> {
    let prog = state.scan_progress.lock().map_err(|e| e.to_string())?;
    Ok(prog.clone())
}

/// 백그라운드 스레드에서 사전 스캔(Pre-scan) -> 기등록 파일 스킵(이어하기) -> 실시간 프로그레스 이벤트 송출을 수행합니다.
#[tauri::command]
pub(crate) fn start_batch_uuid_scan(app: AppHandle, state: State<AppState>) -> Result<ScanProgressPayload, String> {
    {
        let prog = state.scan_progress.lock().map_err(|e| e.to_string())?;
        if prog.is_running {
            return Ok(prog.clone());
        }
    }

    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    let prog_arc = state.scan_progress.clone();

    thread::spawn(move || {
        // 1. 사전 스캔(Pre-scan): 전체 파일 목록과 이미 DB에 UUID가 등록된 파일 목록을 빠르게 대조
        let (folders, registered_paths) = {
            let _g = lock_arc.lock().unwrap();
            let conn = match open_db(&db_path) {
                Ok(c) => c,
                Err(_) => return,
            };
            let mut stmt = conn
                .prepare("SELECT id, role, path FROM base_folders WHERE enabled = 1 AND role != 'git'")
                .unwrap();
            let folders: Vec<(String, String, String)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            let mut reg_stmt = conn.prepare("SELECT full_path FROM files").unwrap();
            let reg_set: HashSet<String> = reg_stmt
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            (folders, reg_set)
        };

        struct PendingItem {
            base_id: String,
            role: String,
            full_path: PathBuf,
            full_path_str: String,
            rel_path_str: String,
            ext: String,
        }

        let mut total_files = 0usize;
        let mut already_registered = 0usize;
        let mut pending_list: Vec<PendingItem> = Vec::new();

        for (base_id, role, base_path_str) in folders {
            let base_path = PathBuf::from(&base_path_str);
            if !base_path.exists() {
                let _ = fs::create_dir_all(&base_path);
                continue;
            }
            for entry in WalkDir::new(&base_path)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file() && !is_internal_mylore_path(e.path()))
            {
                let full_path = entry.path().to_path_buf();
                let full_path_str = full_path.to_string_lossy().to_string();
                total_files += 1;

                // 이미 DB에 등록된 파일이면 즉시 건너뛰기 카운트에 포함 (이어하기!)
                if registered_paths.contains(&full_path_str) {
                    already_registered += 1;
                    continue;
                }

                let rel_path_str = full_path
                    .strip_prefix(&base_path)
                    .unwrap_or(&full_path)
                    .to_string_lossy()
                    .to_string();
                let ext = full_path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                pending_list.push(PendingItem {
                    base_id: base_id.clone(),
                    role: role.clone(),
                    full_path,
                    full_path_str,
                    rel_path_str,
                    ext,
                });
            }
        }

        let pending_files = pending_list.len();
        let start_percent = if total_files > 0 {
            (already_registered as f64 / total_files as f64) * 100.0
        } else {
            100.0
        };

        {
            let mut p = prog_arc.lock().unwrap();
            *p = ScanProgressPayload {
                is_running: pending_files > 0,
                phase: if pending_files > 0 {
                    "injecting".to_string()
                } else {
                    "done".to_string()
                },
                total_files,
                already_registered,
                pending_files,
                completed_files: already_registered,
                start_percent,
                current_percent: start_percent,
                uuids_injected: 0,
                media_indexed: 0,
                links_indexed: 0,
                current_file: if pending_files == 0 {
                    "모든 파일이 이미 등록되어 있습니다.".to_string()
                } else {
                    "미등록 파일 일괄 주입 시작...".to_string()
                },
                eta_seconds: 0.0,
            };
            let _ = app.emit("uuid-scan-progress", p.clone());
        }

        if pending_files == 0 {
            return;
        }

        let start_instant = Instant::now();
        let uri_re = Regex::new(r"mylore://(?:doc|media)/([a-fA-F0-9-]{36})").unwrap();

        let mut uuids_injected = 0usize;
        let mut media_indexed = 0usize;
        let mut links_indexed = 0usize;

        for (idx, item) in pending_list.into_iter().enumerate() {
            {
                let _g = lock_arc.lock().unwrap();
                if let Ok(conn) = open_db(&db_path) {
                    if item.ext == "md" {
                        if let Ok((uuid_val, raw_after, injected)) =
                            ensure_uuid_in_markdown_file(&item.full_path, None)
                        {
                            if injected {
                                uuids_injected += 1;
                            }
                            let hash_val = blake3::hash(raw_after.as_bytes()).to_hex().to_string();
                            let (_, body_after, fm_after) = parse_markdown_yaml(&raw_after);
                            let title = fm_after
                                .get("summary")
                                .or_else(|| fm_after.get("title"))
                                .cloned()
                                .unwrap_or_else(|| {
                                    item.full_path
                                        .file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("무제")
                                        .to_string()
                                });
                            let now_str = chrono::Local::now().to_rfc3339();
                            let _ = conn.execute(
                                "INSERT INTO files (uuid, full_path, relative_path, role, base_folder_id, extension, content_hash, title, updated_at)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                                 ON CONFLICT(uuid) DO UPDATE SET
                                    full_path = excluded.full_path,
                                    relative_path = excluded.relative_path,
                                    role = excluded.role,
                                    content_hash = excluded.content_hash,
                                    title = excluded.title,
                                    updated_at = excluded.updated_at",
                                params![
                                    uuid_val,
                                    item.full_path_str,
                                    item.rel_path_str,
                                    item.role,
                                    item.base_id,
                                    item.ext,
                                    hash_val,
                                    title,
                                    now_str
                                ],
                            );

                            let _ = conn.execute(
                                "DELETE FROM links WHERE source_uuid = ?1",
                                params![uuid_val],
                            );
                            for line in body_after.lines() {
                                for cap in uri_re.captures_iter(line) {
                                    if let Some(target_match) = cap.get(1) {
                                        let _ = conn.execute(
                                            "INSERT OR IGNORE INTO links (source_uuid, target_uuid, excerpt) VALUES (?1, ?2, ?3)",
                                            params![uuid_val, target_match.as_str(), line.trim()],
                                        );
                                        links_indexed += 1;
                                    }
                                }
                            }
                        }
                    } else if let Ok(bytes) = fs::read(&item.full_path) {
                        let hash_val = blake3::hash(&bytes).to_hex().to_string();
                        let existing_uuid: Option<String> = conn
                            .query_row(
                                "SELECT uuid FROM files WHERE full_path = ?1 OR content_hash = ?2 LIMIT 1",
                                params![item.full_path_str, hash_val],
                                |r| r.get(0),
                            )
                            .optional()
                            .unwrap_or(None);

                        let uuid_val =
                            existing_uuid.unwrap_or_else(|| Uuid::new_v4().to_string());
                        let title = item
                            .full_path
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("file")
                            .to_string();
                        let now_str = chrono::Local::now().to_rfc3339();

                        let _ = conn.execute(
                            "INSERT INTO files (uuid, full_path, relative_path, role, base_folder_id, extension, content_hash, title, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                             ON CONFLICT(uuid) DO UPDATE SET
                                full_path = excluded.full_path,
                                relative_path = excluded.relative_path,
                                content_hash = excluded.content_hash,
                                updated_at = excluded.updated_at",
                            params![
                                uuid_val,
                                item.full_path_str,
                                item.rel_path_str,
                                item.role,
                                item.base_id,
                                item.ext,
                                hash_val,
                                title,
                                now_str
                            ],
                        );
                        media_indexed += 1;
                    }
                }
            };

            let processed_pending = idx + 1;
            let completed_files = already_registered + processed_pending;
            let current_percent = if total_files > 0 {
                (completed_files as f64 / total_files as f64) * 100.0
            } else {
                100.0
            };

            let elapsed_secs = start_instant.elapsed().as_secs_f64();
            let avg_per_file = elapsed_secs / (processed_pending as f64);
            let remaining_files = pending_files.saturating_sub(processed_pending);
            let eta_seconds = avg_per_file * (remaining_files as f64);

            // 매 3개 파일마다 또는 마지막 파일일 때 실시간 진행률 이벤트 송출
            if processed_pending % 3 == 0 || processed_pending == pending_files {
                let mut p = prog_arc.lock().unwrap();
                p.is_running = processed_pending < pending_files;
                p.phase = if processed_pending < pending_files {
                    "injecting".to_string()
                } else {
                    "done".to_string()
                };
                p.completed_files = completed_files;
                p.current_percent = current_percent;
                p.uuids_injected = uuids_injected;
                p.media_indexed = media_indexed;
                p.links_indexed = links_indexed;
                p.current_file = item.rel_path_str.clone();
                p.eta_seconds = eta_seconds;
                let _ = app.emit("uuid-scan-progress", p.clone());
            }
        }
    });

    let prog = state.scan_progress.lock().map_err(|e| e.to_string())?;
    Ok(prog.clone())
}

#[tauri::command]
pub(crate) fn scan_and_inject_uuids(
    app: AppHandle,
    state: State<AppState>,
) -> Result<BatchScanSummary, String> {
    let prog = start_batch_uuid_scan(app, state)?;
    Ok(BatchScanSummary {
        scanned_files: prog.total_files,
        already_registered: prog.already_registered,
        pending_files: prog.pending_files,
        uuids_injected: prog.uuids_injected,
        media_indexed: prog.media_indexed,
        links_indexed: prog.links_indexed,
    })
}

#[tauri::command]
pub(crate) fn get_virtual_tree(state: State<AppState>) -> Result<Vec<FileNode>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut stmt = conn
        .prepare("SELECT id, role, path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let urgent_task_re = Regex::new(r"(?m)^\s*[-*+]\s+\[[!>]\]\s+").unwrap();
    let date_prefix_re = Regex::new(r"^(\d{4}-\d{2}-\d{2})").unwrap();

    let mut out = Vec::new();
    for (base_id, role, base_path_str) in folders {
        let base_path = Path::new(&base_path_str);
        if !base_path.exists() {
            continue;
        }
        for entry in WalkDir::new(base_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file() && !is_internal_mylore_path(e.path()))
        {
            let full_path = entry.path();
            let ext = full_path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext != "md" {
                continue;
            }
            let full_path_str = full_path.to_string_lossy().to_string();
            let rel_path_str = full_path
                .strip_prefix(base_path)
                .unwrap_or(full_path)
                .to_string_lossy()
                .to_string();
            let name = full_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            let db_info: Option<(String, String, Option<String>)> = conn
                .query_row(
                    "SELECT uuid, content_hash, title FROM files WHERE full_path = ?1",
                    params![full_path_str],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .unwrap_or(None);

            let (uuid_val, hash_val, title_val) =
                db_info.unwrap_or_else(|| (String::new(), String::new(), None));

            let mut project_status: Option<String> = None;
            let mut event_date: Option<String> = None;

            if role == "projects" {
                if rel_path_str.eq_ignore_ascii_case("main.md") {
                    project_status = Some("최우선".to_string());
                } else if let Ok(raw) = fs::read_to_string(full_path) {
                    let (_, body, fm) = parse_markdown_yaml(&raw);
                    let status_val = fm.get("status").map(|s| s.trim().to_lowercase()).unwrap_or_default();
                    let priority_val = fm.get("priority").map(|s| s.trim().to_lowercase()).unwrap_or_default();
                    let is_yaml_top = matches!(status_val.as_str(), "최우선" | "urgent" | "top" | "1")
                        || matches!(priority_val.as_str(), "1" | "최우선" | "urgent" | "high" | "!");
                    if is_yaml_top || urgent_task_re.is_match(&body) {
                        project_status = Some("최우선".to_string());
                    }
                }
            } else if role == "diary" {
                if let Some(cap) = date_prefix_re.captures(&name) {
                    event_date = cap.get(1).map(|m| m.as_str().to_string());
                }
            }

            out.push(FileNode {
                uuid: uuid_val,
                name,
                relative_path: rel_path_str,
                full_path: full_path_str,
                role: role.clone(),
                base_folder_id: base_id.clone(),
                is_dir: false,
                extension: ext,
                content_hash: hash_val,
                title: title_val,
                calendar_category: None,
                event_date,
                project_status,
                updated_at: String::new(),
                children: None,
            });
        }
    }

    out.sort_by(|a, b| b.relative_path.cmp(&a.relative_path));
    Ok(out)
}
