//! 문서 읽기/저장/생성/이름변경, 파일 내 검색·치환, 템플릿, 역할 이동.

use crate::*;

pub(crate) fn build_document_payload(conn: &Connection, full_path: &Path) -> Result<DocumentPayload, String> {
    if !full_path.exists() {
        return Err(format!("파일이 존재하지 않습니다: {}", full_path.display()));
    }
    let full_path_str = full_path.to_string_lossy().to_string();

    let mut stmt = conn
        .prepare("SELECT id, role, path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut matched_role = "data".to_string();
    let mut matched_base_id = "base-data-1".to_string();
    let mut rel_path_str = full_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    for (b_id, b_role, b_path) in folders {
        let bp = Path::new(&b_path);
        if let Ok(stripped) = full_path.strip_prefix(bp) {
            matched_role = b_role;
            matched_base_id = b_id;
            rel_path_str = stripped.to_string_lossy().to_string();
            break;
        }
    }

    // git 역할 폴더의 파일은 YAML UUID를 원본 파일에 주입하지 않고 열람·편집만 수행
    let (uuid_val, raw_content) = if matched_role == "git" {
        let raw = fs::read_to_string(full_path).map_err(|e| e.to_string())?;
        let (_, _, fm) = parse_markdown_yaml(&raw);
        let existing_db_uuid: Option<String> = conn
            .query_row(
                "SELECT uuid FROM files WHERE full_path = ?1 LIMIT 1",
                params![full_path_str],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        let u = fm
            .get("uuid")
            .cloned()
            .filter(|s| !s.trim().is_empty())
            .or(existing_db_uuid)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        (u, raw)
    } else {
        let (u, raw, _) = ensure_uuid_in_markdown_file(full_path, None)?;
        (u, raw)
    };

    let (yaml_raw, body_content, frontmatter) = parse_markdown_yaml(&raw_content);
    let content_hash = blake3::hash(raw_content.as_bytes()).to_hex().to_string();

    let title = frontmatter
        .get("summary")
        .or_else(|| frontmatter.get("title"))
        .cloned()
        .unwrap_or_else(|| rel_path_str.clone());
    let now_str = chrono::Local::now().to_rfc3339();

    let _ = conn.execute(
        "INSERT INTO files (uuid, full_path, relative_path, role, base_folder_id, extension, content_hash, title, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'md', ?6, ?7, ?8)
         ON CONFLICT(uuid) DO UPDATE SET
            full_path = excluded.full_path,
            relative_path = excluded.relative_path,
            role = excluded.role,
            content_hash = excluded.content_hash,
            title = excluded.title,
            updated_at = excluded.updated_at",
        params![
            uuid_val,
            full_path_str,
            rel_path_str,
            matched_role,
            matched_base_id,
            content_hash,
            title,
            now_str
        ],
    );

    let mut bl_stmt = conn
        .prepare(
            "SELECT f.uuid, COALESCE(f.title, f.relative_path), f.full_path, f.role, l.excerpt
             FROM links l
             JOIN files f ON f.uuid = l.source_uuid
             WHERE l.target_uuid = ?1",
        )
        .map_err(|e| e.to_string())?;
    let backlinks: Vec<BacklinkItem> = bl_stmt
        .query_map(params![uuid_val], |r| {
            Ok(BacklinkItem {
                source_uuid: r.get(0)?,
                source_title: r.get(1)?,
                source_path: r.get(2)?,
                source_role: r.get(3)?,
                excerpt: r.get(4)?,
                date: None,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(DocumentPayload {
        uuid: uuid_val,
        full_path: full_path_str,
        relative_path: rel_path_str,
        role: matched_role,
        raw_content,
        yaml_raw,
        body_content,
        frontmatter,
        content_hash,
        backlinks,
    })
}

#[tauri::command]
pub(crate) async fn read_document(
    state: State<'_, AppState>,
    full_path: String,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        build_document_payload(&conn, Path::new(&full_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn read_document_by_uuid(
    state: State<'_, AppState>,
    uuid: String,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let full_path: String = conn
            .query_row(
                "SELECT full_path FROM files WHERE uuid = ?1",
                params![uuid],
                |r| r.get(0),
            )
            .map_err(|_| format!("UUID({})에 해당하는 문서를 찾을 수 없습니다.", uuid))?;
        build_document_payload(&conn, Path::new(&full_path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn save_document(
    state: State<AppState>,
    full_path: String,
    raw_content: String,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let path = Path::new(&full_path);
    fs::write(path, &raw_content).map_err(|e| e.to_string())?;
    let payload = build_document_payload(&conn, path)?;

    let uri_re = cached_regex!(r"mylore://(?:doc|media)/([a-fA-F0-9-]{36})");
    let _ = conn.execute(
        "DELETE FROM links WHERE source_uuid = ?1",
        params![payload.uuid],
    );
    for line in payload.body_content.lines() {
        for cap in uri_re.captures_iter(line) {
            if let Some(m) = cap.get(1) {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO links (source_uuid, target_uuid, excerpt) VALUES (?1, ?2, ?3)",
                    params![payload.uuid, m.as_str(), line.trim()],
                );
            }
        }
    }

    let cat = payload.frontmatter.get("category").map(|s| s.as_str()).unwrap_or("");
    if cat == "mobile/calls" || cat == "mobile/recordings" {
        if let Some(stem) = path.file_stem().map(|s| s.to_string_lossy().to_string()) {
            let safe_stem = sanitize_filename_stem(&stem);
            let status = payload.frontmatter.get("transcript_status").map(|s| s.as_str()).unwrap_or("");
            let req = payload.frontmatter.get("user_requirement").cloned().unwrap_or_default();
            let stage = match status {
                "verified" | "stage4" => 4u8,
                "needs_revision" | "stage3" => 3u8,
                "unverified" | "completed" | "stage2" => 2u8,
                "pending" | "pending_quota" | "stage1" => 1u8,
                _ => if !req.trim().is_empty() { 3u8 } else { 2u8 },
            };
            upsert_call_transcript_meta(&conn, &safe_stem, stage, &req);
            let attach_tag = if stage == 1 || stage == 3 {
                format!("pending_transcript:{}", safe_stem)
            } else {
                format!("transcribed:{}", safe_stem)
            };
            let _ = conn.execute(
                "UPDATE lifelog_messages SET attachment_uuid = ?1 WHERE room_or_sender = ?2 OR attachment_uuid IN (?3, ?4)",
                params![
                    attach_tag,
                    safe_stem,
                    format!("transcribed:{}", safe_stem),
                    format!("pending_transcript:{}", safe_stem)
                ],
            );
        }
    }

    build_document_payload(&conn, path)
}

#[tauri::command]
pub(crate) fn create_new_document(
    state: State<AppState>,
    params: CreateDocParams,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let base_path_str: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = ?1 AND enabled = 1 LIMIT 1",
            params![params.role],
            |r| r.get(0),
        )
        .map_err(|_| format!("역할({})에 해당하는 베이스 폴더가 설정되어 있지 않습니다.", params.role))?;

    let base_path = Path::new(&base_path_str);
    let _ = fs::create_dir_all(base_path);
    let new_uuid = Uuid::new_v4().to_string();

    let templates_dir = ensure_projects_mylore_templates(&conn);
    let date_str = params
        .date_str
        .clone()
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());

    let load_template_body = |file_name: &str| -> Option<String> {
        let tpl_path = templates_dir.join(file_name);
        if let Ok(raw) = fs::read_to_string(tpl_path) {
            let (_, body, _) = parse_markdown_yaml(&raw);
            Some(
                body.replace("{{title}}", &params.title)
                    .replace("{{date}}", &date_str),
            )
        } else {
            None
        }
    };

    let target_file_path =
        if params.role == "projects" && params.is_project_folder.unwrap_or(true) {
            let proj_dir = base_path.join(&params.title);
            let _ = fs::create_dir_all(&proj_dir);
            let p = proj_dir.join("main.md");
            if !p.exists() {
                let tpl_name = params
                    .template_file
                    .as_deref()
                    .unwrap_or("project_main.md");
                let body = load_template_body(tpl_name).unwrap_or_else(|| {
                    format!(
                        "# {}\n\n## 서브 미션 (Tasks)\n- [!] 내일 해야 할 핵심 과제를 여기에 작성하세요\n- [/] 현재 진행 중인 작업\n- [ ] 대기 중인 백로그 과제\n",
                        params.title
                    )
                });
                let content = format!(
                    "---\nuuid: \"{}\"\ntitle: \"{}\"\nstatus: \"진행중\"\nmilestone: \"초기 설계 및 할 일 정의\"\n---\n{}",
                    new_uuid, params.title, body
                );
                fs::write(&p, content).map_err(|e| e.to_string())?;
            }
            p
        } else if params.role == "diary" {
            let clean_title = if params.title.trim().is_empty() {
                "새 일정".to_string()
            } else {
                params.title.trim().to_string()
            };
            let cal_cat = params
                .calendar_category
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or("개발")
                .to_string();
            let color_id = match cal_cat.as_str() {
                "개발" => "11",
                "이벤트" => "6",
                "수영" => "10",
                "기록" => "7",
                "식단" => "9",
                "일상" => "3",
                "알림" => "1",
                _ => "8",
            };

            let include_loc = params.include_location.unwrap_or(true);
            let loc_line = if !include_loc {
                String::new()
            } else {
                let raw_loc = params.location.as_deref().unwrap_or("").trim();
                let eff_loc = if raw_loc.is_empty() { "거제집" } else { raw_loc };
                format!("location: \"{}\"\n", eff_loc.replace('"', "\\\""))
            };

            let transparency_val = params
                .transparency
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or("transparent");
            let visibility_val = params
                .visibility
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or("default");
            let desc_mode = params
                .description_mode
                .as_deref()
                .map(|s| s.trim())
                .unwrap_or("File");
            let desc_line = if desc_mode.eq_ignore_ascii_case("File") {
                "description: \"File\"\n".to_string()
            } else {
                String::new()
            };

            let email_trimmed = params
                .attendee_email
                .as_deref()
                .map(|s| s.trim())
                .unwrap_or("");
            let (attendees_block, status_val) = if !email_trimmed.is_empty() {
                let resp_status = params
                    .attendee_response_status
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("needsAction");
                let st_choice = params
                    .event_status
                    .as_deref()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("confirmed");
                (
                    format!(
                        "attendees:\n  - email: \"{}\"\n    responseStatus: \"{}\"\n",
                        email_trimmed.replace('"', "\\\""),
                        resp_status
                    ),
                    st_choice,
                )
            } else {
                (String::new(), "confirmed")
            };

            let mut filename = format!("{} {}.md", date_str, clean_title);
            let mut p = base_path.join(&filename);
            let mut idx = 1;
            while p.exists() {
                filename = format!("{} {}-{}.md", date_str, clean_title, idx);
                p = base_path.join(&filename);
                idx += 1;
            }

            let tpl_name = params.template_file.as_deref().unwrap_or("");
            let body = if tpl_name.is_empty() || tpl_name == "none" {
                String::new()
            } else {
                load_template_body(tpl_name).unwrap_or_default()
            };

            let content = format!(
                "---\nuuid: \"{}\"\nsummary: \"{}\"\nstart:\n  date: \"{}\"\nend:\n  date: \"{}\"\ncalendar: \"{}\"\n{}transparency: \"{}\"\nvisibility: \"{}\"\ncolorId: \"{}\"\n{}{}status: \"{}\"\n---\n{}",
                new_uuid,
                clean_title.replace('"', "\\\""),
                date_str,
                date_str,
                cal_cat,
                loc_line,
                transparency_val,
                visibility_val,
                color_id,
                desc_line,
                attendees_block,
                status_val,
                body
            );
            fs::write(&p, content).map_err(|e| e.to_string())?;
            if let Err(e) = try_upload_diary_markdown_to_gcal(&p) {
                log_comm(
                    "WARN",
                    &format!("[GoogleCalendar] 신규 일정 업로드 보류 ({}): {}", filename, e),
                );
            }
            p
        } else {
            let target_dir = if let Some(sf) = &params.sub_folder {
                let d = base_path.join(sf);
                let _ = fs::create_dir_all(&d);
                d
            } else {
                base_path.to_path_buf()
            };
            let p = target_dir.join(format!("{}.md", params.title));
            let body = params
                .template_file
                .as_deref()
                .and_then(load_template_body)
                .unwrap_or_else(|| format!("# {}\n\n", params.title));
            let content = format!(
                "---\nuuid: \"{}\"\ntitle: \"{}\"\n---\n{}",
                new_uuid, params.title, body
            );
            fs::write(&p, content).map_err(|e| e.to_string())?;
            p
        };

    build_document_payload(&conn, &target_file_path)
}

/// 새 메모 (임시 메모장 출력, 프로젝트/임시에 자동 분류)
#[tauri::command]
pub(crate) fn create_temp_memo(state: State<AppState>, title: Option<String>) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let projects_base: String = projects_base_path_string(&conn);

    let temp_dir = Path::new(&projects_base).join("임시");
    let _ = fs::create_dir_all(&temp_dir);

    let now = chrono::Local::now();
    let memo_title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| format!("임시메모_{}", now.format("%Y-%m-%d_%H%M%S")));

    let file_path = temp_dir.join(format!("{}.md", memo_title));
    if !file_path.exists() {
        let new_uuid = Uuid::new_v4().to_string();
        let content = format!(
            "---\nuuid: \"{}\"\ntitle: \"{}\"\ncategory: \"임시메모\"\ncreated: \"{}\"\n---\n# 📝 {}\n\n- [!] 빠른 메모 내용을 여기에 기록하세요\n",
            new_uuid,
            memo_title,
            now.format("%Y-%m-%d %H:%M:%S"),
            memo_title
        );
        fs::write(&file_path, content).map_err(|e| e.to_string())?;
    }

    build_document_payload(&conn, &file_path)
}

/// 폴더 우클릭 메뉴 > "새 문서 생성": 해당 폴더에 빈 `.md` 문서(UUID 미주입)를 생성하여 반환하고,
/// 프론트엔드에서 제목 수정창(`F2` 모달)을 통해 제목을 입력받으면 `rename_current_document`에서 UUID를 주입합니다.
#[tauri::command]
pub(crate) fn create_empty_document_in_folder(
    state: State<AppState>,
    role: String,
    sub_dir: Option<String>,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let base_path_str: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = ?1 AND enabled = 1 LIMIT 1",
            params![role],
            |r| r.get(0),
        )
        .map_err(|_| format!("역할({})에 해당하는 베이스 폴더가 설정되어 있지 않습니다.", role))?;

    let clean_sub_dir = sub_dir
        .unwrap_or_default()
        .trim()
        .trim_start_matches("git:")
        .trim_matches(|c| c == '/' || c == '\\')
        .replace('/', "\\");

    let base_path = Path::new(&base_path_str);
    let target_dir = if clean_sub_dir.is_empty() {
        base_path.to_path_buf()
    } else {
        base_path.join(&clean_sub_dir)
    };
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

    let mut file_name = "새 문서.md".to_string();
    let mut file_path = target_dir.join(&file_name);
    let mut idx = 1usize;
    while file_path.exists() {
        file_name = format!("새 문서-{}.md", idx);
        file_path = target_dir.join(&file_name);
        idx += 1;
    }

    // 빈 md 문서 생성 (제목 입력 후 rename_current_document에서 UUID 주입)
    fs::write(&file_path, "").map_err(|e| e.to_string())?;

    let full_path_str = file_path.to_string_lossy().to_string();
    let rel_path_str = file_path
        .strip_prefix(base_path)
        .unwrap_or(&file_path)
        .to_string_lossy()
        .to_string();
    let content_hash = blake3::hash(b"").to_hex().to_string();

    Ok(DocumentPayload {
        uuid: String::new(),
        full_path: full_path_str,
        relative_path: rel_path_str,
        role,
        raw_content: String::new(),
        yaml_raw: String::new(),
        body_content: String::new(),
        frontmatter: HashMap::new(),
        content_hash,
        backlinks: Vec::new(),
    })
}

/// 루트 Projects/main.md 로 즉시 이동 (파일이 없으면 생성)
#[tauri::command]
pub(crate) fn open_root_main_md(state: State<AppState>) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let projects_base: String = projects_base_path_string(&conn);

    let _ = fs::create_dir_all(&projects_base);
    let root_main = Path::new(&projects_base).join("main.md");
    if !root_main.exists() {
        let new_uuid = Uuid::new_v4().to_string();
        let content = format!(
            "---\nuuid: \"{}\"\ntitle: \"전체 프로젝트 마스터 (main.md)\"\nstatus: \"활성\"\n---\n# ⭐ 전체 프로젝트 마스터 (`Projects/main.md`)\n\n| 구분 | 설명 | 단축 이동 |\n| :--- | :--- | :--- |\n| **전체 프로젝트** | 각 하위 폴더의 `{{프로젝트명}}/main.md`와 연동되는 최상위 문서 | `이동 > main.md로 이동` |\n| **임시 메모** | `Projects/임시/` 폴더에 자동 분류 | `파일 > 새 파일 > 새 메모` |\n\n---\n\n## 🎯 핵심 우선순위 과제 (Tasks)\n- [!] 오늘/내일 집중할 최우선 프로젝트 항목\n- [/] 현재 진행 중인 프로젝트 점검\n- [ ] 백로그 및 자료조사(개발 커리어·사색·수영 아티클/영상 기획)\n",
            new_uuid
        );
        fs::write(&root_main, content).map_err(|e| e.to_string())?;
    }

    build_document_payload(&conn, &root_main)
}

/// F2: 현재 문서 제목(파일명 또는 프로젝트 폴더명) 변경 (UUID 불변 유지)
#[tauri::command]
pub(crate) fn rename_current_document(
    state: State<AppState>,
    source_full_path: String,
    new_title: String,
) -> Result<DocumentPayload, String> {
    let clean_title = new_title.trim().replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    if clean_title.is_empty() {
        return Err("새 제목이 비어 있습니다.".to_string());
    }

    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&source_full_path);
    if !src_path.exists() {
        return Err("원본 파일이 존재하지 않습니다.".to_string());
    }

    let (uuid_val, raw_content, _) = ensure_uuid_in_markdown_file(src_path, None)?;
    let (yaml_raw, body, _) = parse_markdown_yaml(&raw_content);

    let file_name_only = src_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let is_main_md = file_name_only.eq_ignore_ascii_case("main.md");

    // YAML 내부에 이미 summary 또는 title이 있거나 main.md인 경우 새 제목으로 동기화
    let mut updated_yaml_lines: Vec<String> = Vec::new();
    let mut title_updated_in_yaml = false;
    for line in yaml_raw.lines() {
        let t = line.trim_start();
        if t.starts_with("title:") {
            updated_yaml_lines.push(format!("title: \"{}\"", clean_title));
            title_updated_in_yaml = true;
        } else if t.starts_with("summary:") {
            updated_yaml_lines.push(format!("summary: \"{}\"", clean_title));
            title_updated_in_yaml = true;
        } else {
            updated_yaml_lines.push(line.to_string());
        }
    }
    if !title_updated_in_yaml && is_main_md && !yaml_raw.is_empty() {
        updated_yaml_lines.push(format!("title: \"{}\"", clean_title));
    }
    let new_raw = if updated_yaml_lines.is_empty() {
        raw_content
    } else {
        format!("---\n{}\n---\n{}", updated_yaml_lines.join("\n"), body)
    };
    let _ = fs::write(src_path, &new_raw);

    let target_path = if is_main_md {
        // 프로젝트 하위 폴더의 main.md인 경우 부모 프로젝트 폴더 이름을 변경
        if let Some(parent_dir) = src_path.parent() {
            if let Some(grand_parent) = parent_dir.parent() {
                let new_proj_dir = grand_parent.join(&clean_title);
                if new_proj_dir != parent_dir {
                    fs::rename(parent_dir, &new_proj_dir).map_err(|e| e.to_string())?;
                }
                new_proj_dir.join("main.md")
            } else {
                src_path.to_path_buf()
            }
        } else {
            src_path.to_path_buf()
        }
    } else if let Some(parent_dir) = src_path.parent() {
        let new_file_name = if clean_title.to_lowercase().ends_with(".md") {
            clean_title.clone()
        } else {
            format!("{}.md", clean_title)
        };
        let dst = parent_dir.join(new_file_name);
        if dst != src_path {
            fs::rename(src_path, &dst).map_err(|e| e.to_string())?;
        }
        dst
    } else {
        src_path.to_path_buf()
    };

    let _ = conn.execute(
        "UPDATE files SET full_path = ?1, title = ?2 WHERE uuid = ?3",
        params![
            target_path.to_string_lossy().to_string(),
            clean_title,
            uuid_val
        ],
    );

    build_document_payload(&conn, &target_path)
}

/// 전체 볼트 파일에서 키워드 검색 (오른쪽 사이드바 검색 결과 리스트 연동)
#[tauri::command]
pub(crate) fn search_in_files(
    state: State<AppState>,
    query: String,
) -> Result<Vec<SearchMatchItem>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let q_lower = q.to_lowercase();

    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut stmt = conn
        .prepare("SELECT role, path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::new();
    for (role, base_path_str) in folders {
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
            if full_path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(full_path) {
                let (_, body, _) = parse_markdown_yaml(&raw);
                let rel_path_str = full_path
                    .strip_prefix(base_path)
                    .unwrap_or(full_path)
                    .to_string_lossy()
                    .to_string();
                let file_name = full_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                let full_path_str = full_path.to_string_lossy().to_string();

                let mut running_offset = 0usize;
                for (idx, line) in body.lines().enumerate() {
                    if line.to_lowercase().contains(&q_lower) {
                        results.push(SearchMatchItem {
                            full_path: full_path_str.clone(),
                            relative_path: rel_path_str.clone(),
                            role: role.clone(),
                            file_name: file_name.clone(),
                            line_number: idx + 1,
                            line_text: line.trim().chars().take(120).collect(),
                            char_offset: running_offset,
                        });
                        if results.len() >= 250 {
                            return Ok(results);
                        }
                    }
                    running_offset += line.len() + 1;
                }
            }
        }
    }

    Ok(results)
}

/// 전체 파일에서 일괄 바꾸기 (파일에서 바꾸기)
#[tauri::command]
pub(crate) fn replace_in_files(
    state: State<AppState>,
    query: String,
    replacement: String,
) -> Result<usize, String> {
    if query.is_empty() {
        return Ok(0);
    }
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut stmt = conn
        .prepare("SELECT path FROM base_folders WHERE enabled = 1")
        .map_err(|e| e.to_string())?;
    let folders: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut modified_files = 0usize;
    for base_path_str in folders {
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
            if full_path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(full_path) {
                let (yaml_raw, body, _) = parse_markdown_yaml(&raw);
                if body.contains(&query) {
                    let new_body = body.replace(&query, &replacement);
                    let new_raw = if yaml_raw.is_empty() {
                        new_body
                    } else {
                        format!("---\n{}\n---\n{}", yaml_raw, new_body)
                    };
                    if fs::write(full_path, new_raw).is_ok() {
                        modified_files += 1;
                    }
                }
            }
        }
    }

    Ok(modified_files)
}

#[tauri::command]
pub(crate) fn get_vault_templates(state: State<AppState>) -> Result<Vec<VaultTemplateItem>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let templates_dir = ensure_projects_mylore_templates(&conn);

    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&templates_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("md") {
                if let Ok(raw) = fs::read_to_string(&path) {
                    let (_, body, fm) = parse_markdown_yaml(&raw);
                    let file_name = path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let name = fm
                        .get("title")
                        .cloned()
                        .unwrap_or_else(|| file_name.clone());
                    let desc = fm.get("description").cloned().unwrap_or_else(|| {
                        "1번 Projects 볼트(.myLore/templates) 사용자 템플릿".to_string()
                    });
                    out.push(VaultTemplateItem {
                        id: file_name.clone(),
                        name,
                        file_name,
                        full_path: path.to_string_lossy().to_string(),
                        description: desc,
                        body_content: body,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(out)
}

#[tauri::command]
pub(crate) fn promote_to_project_folder(
    state: State<AppState>,
    source_full_path: String,
    project_name: String,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&source_full_path);
    if !src_path.exists() {
        return Err("원본 문서가 존재하지 않습니다.".to_string());
    }

    let (uuid_val, _, _) = ensure_uuid_in_markdown_file(src_path, None)?;

    let projects_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = 'projects' AND enabled = 1 LIMIT 1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "프로젝트(Projects) 베이스 폴더가 설정되어 있지 않습니다.".to_string())?;

    let target_dir = Path::new(&projects_base).join(&project_name);
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let target_file = target_dir.join("main.md");

    fs::rename(src_path, &target_file).map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "UPDATE files SET full_path = ?1, relative_path = ?2, role = 'projects' WHERE uuid = ?3",
        params![
            target_file.to_string_lossy().to_string(),
            format!("{}\\main.md", project_name),
            uuid_val
        ],
    );

    build_document_payload(&conn, &target_file)
}

#[tauri::command]
pub(crate) fn move_document_to_role(
    state: State<AppState>,
    source_full_path: String,
    target_role: String,
    new_file_name: Option<String>,
    target_sub_dir: Option<String>,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&source_full_path);
    if !src_path.exists() {
        return Err("원본 파일이 존재하지 않습니다.".to_string());
    }
    let (uuid_val, _, _) = ensure_uuid_in_markdown_file(src_path, None)?;

    let target_base: String = conn
        .query_row(
            "SELECT path FROM base_folders WHERE role = ?1 AND enabled = 1 LIMIT 1",
            params![target_role],
            |r| r.get(0),
        )
        .map_err(|_| format!("{} 역할의 베이스 폴더를 찾을 수 없습니다.", target_role))?;

    let file_name = new_file_name.unwrap_or_else(|| {
        src_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("moved.md")
            .to_string()
    });

    let clean_sub_dir = target_sub_dir
        .unwrap_or_default()
        .trim()
        .trim_start_matches("git:")
        .trim_matches(|c| c == '/' || c == '\\')
        .replace('/', "\\");

    let base_dir_path = Path::new(&target_base);
    let target_dir = if clean_sub_dir.is_empty() {
        base_dir_path.to_path_buf()
    } else {
        base_dir_path.join(&clean_sub_dir)
    };
    let _ = fs::create_dir_all(&target_dir);
    let target_file = target_dir.join(&file_name);

    if target_file == src_path {
        return build_document_payload(&conn, &target_file);
    }
    if target_file.exists() {
        return Err(format!(
            "대상 폴더에 동일한 이름의 파일('{}')이 이미 존재합니다.",
            file_name
        ));
    }

    fs::rename(src_path, &target_file).map_err(|e| e.to_string())?;

    let rel_path = target_file
        .strip_prefix(base_dir_path)
        .unwrap_or(&target_file)
        .to_string_lossy()
        .to_string();

    let _ = conn.execute(
        "UPDATE files SET full_path = ?1, relative_path = ?2, role = ?3 WHERE uuid = ?4",
        params![
            target_file.to_string_lossy().to_string(),
            rel_path,
            target_role,
            uuid_val
        ],
    );

    build_document_payload(&conn, &target_file)
}
