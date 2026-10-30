//! Windows 휴지통 이동 및 휴지통 복원.

use crate::*;

#[repr(C)]
pub(crate) struct SHFILEOPSTRUCTW {
    pub(crate) hwnd: isize,
    pub(crate) w_func: u32,
    pub(crate) p_from: *const u16,
    pub(crate) p_to: *const u16,
    pub(crate) f_flags: u16,
    pub(crate) f_any_operations_aborted: i32,
    pub(crate) h_name_mappings: isize,
    pub(crate) lpsz_progress_title: *const u16,
}

#[link(name = "shell32")]
extern "system" {
    fn SHFileOperationW(lp_file_op: *mut SHFILEOPSTRUCTW) -> i32;
}

pub(crate) fn move_file_to_windows_recycle_bin(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    let abs = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let clean_str = abs
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string();
    let mut wide: Vec<u16> = std::ffi::OsStr::new(&clean_str).encode_wide().collect();
    wide.push(0);
    wide.push(0);

    let mut op = SHFILEOPSTRUCTW {
        hwnd: 0,
        w_func: 3, // FO_DELETE
        p_from: wide.as_ptr(),
        p_to: std::ptr::null(),
        f_flags: 0x0040 | 0x0010 | 0x0004 | 0x0400, // FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
        f_any_operations_aborted: 0,
        h_name_mappings: 0,
        lpsz_progress_title: std::ptr::null(),
    };
    let ret = unsafe { SHFileOperationW(&mut op) };
    ret == 0 && !path.exists()
}

/// 폴더 목록에서 선택한 문서를 휴지통으로 이동 (되돌리기용 백업 포함)
#[tauri::command]
pub(crate) fn trash_document(
    state: State<AppState>,
    full_path: String,
) -> Result<TrashedFileRecord, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let src_path = Path::new(&full_path);
    if !src_path.exists() || !src_path.is_file() {
        return Err("삭제할 파일이 존재하지 않습니다.".to_string());
    }

    let file_name = src_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("deleted.md")
        .to_string();
    let trash_id = Uuid::new_v4().to_string();

    let trash_dir = state
        .db_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(app_data_dir)
        .join("trash_undo");
    fs::create_dir_all(&trash_dir).map_err(|e| e.to_string())?;

    let backup_path = trash_dir.join(format!("{}_{}", trash_id, file_name));
    fs::copy(src_path, &backup_path).map_err(|e| format!("백업 생성 실패: {}", e))?;

    if !move_file_to_windows_recycle_bin(src_path) && src_path.exists() {
        fs::remove_file(src_path).map_err(|e| format!("파일 삭제 실패: {}", e))?;
    }

    let _ = conn.execute("DELETE FROM files WHERE full_path = ?1", params![full_path]);

    let record = TrashedFileRecord {
        trash_id,
        original_path: full_path,
        file_name,
        backup_path: backup_path.to_string_lossy().to_string(),
    };

    if let Ok(mut hist) = state.trash_history.lock() {
        hist.push(record.clone());
    }

    Ok(record)
}

/// 휴지통으로 이동된 문서를 원래 위치로 되돌리기 (복구)
#[tauri::command]
pub(crate) fn restore_trashed_document(
    state: State<AppState>,
    trash_id: Option<String>,
) -> Result<DocumentPayload, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let record = {
        let mut hist = state.trash_history.lock().map_err(|e| e.to_string())?;
        if let Some(ref tid) = trash_id {
            if let Some(pos) = hist.iter().rposition(|r| &r.trash_id == tid) {
                hist.remove(pos)
            } else {
                return Err("복구할 휴지통 항목을 찾을 수 없습니다.".to_string());
            }
        } else {
            hist.pop()
                .ok_or_else(|| "되돌릴 휴지통 이동 내역이 없습니다.".to_string())?
        }
    };

    let backup = Path::new(&record.backup_path);
    if !backup.exists() {
        return Err("백업 파일이 존재하지 않아 복구할 수 없습니다.".to_string());
    }

    let orig = Path::new(&record.original_path);
    if let Some(parent) = orig.parent() {
        let _ = fs::create_dir_all(parent);
    }

    fs::copy(backup, orig).map_err(|e| format!("파일 복구 실패: {}", e))?;
    let _ = fs::remove_file(backup);

    build_document_payload(&conn, orig)
}
