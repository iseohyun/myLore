//! 창 제어: 전체 화면 토글 및 분리(Detached) 미리보기 창 동기화.

use crate::*;

/// F11: 전체 화면(Fullscreen) 토글
#[tauri::command]
pub(crate) fn toggle_window_fullscreen(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_full = window.is_fullscreen().unwrap_or(false);
        let next_full = !is_full;
        window
            .set_fullscreen(next_full)
            .map_err(|e| e.to_string())?;
        return Ok(next_full);
    }
    Ok(false)
}

#[tauri::command]
pub(crate) fn sync_detached_preview_scroll(
    app: AppHandle,
    top_line: f64,
    scroll_ratio: f64,
) -> Result<(), String> {
    let payload = DetachedScrollPayload {
        top_line,
        scroll_ratio,
    };
    let _ = app.emit("detached-preview-scroll", &payload);
    Ok(())
}

#[tauri::command]
pub(crate) async fn toggle_detached_preview_window(
    app: AppHandle,
    state: State<'_, AppState>,
    force_open: Option<bool>,
    initial_state: DetachedPreviewState,
) -> Result<bool, String> {
    if let Ok(mut guard) = state.detached_preview.lock() {
        *guard = initial_state.clone();
    }

    if let Some(existing) = app.get_webview_window("detached-preview") {
        match force_open {
            Some(true) => {
                let _ = existing.unminimize();
                let _ = existing.show();
                let _ = existing.set_focus();
                let _ = app.emit("detached-preview-update", &initial_state);
                return Ok(true);
            }
            _ => {
                let _ = existing.close();
                return Ok(false);
            }
        }
    }

    if force_open == Some(false) {
        return Ok(false);
    }

    let win_title = if initial_state.title.is_empty() && initial_state.relative_path.is_empty() {
        "myLore — 전용 독립 뷰어 (F11)".to_string()
    } else if !initial_state.title.is_empty() {
        format!("myLore 독립 뷰어 — {}", initial_state.title)
    } else {
        format!("myLore 독립 뷰어 — {}", initial_state.relative_path)
    };

    let win = WebviewWindowBuilder::new(
        &app,
        "detached-preview",
        WebviewUrl::App("index.html?detachedPreview=1".into()),
    )
    .title(win_title)
    .inner_size(860.0, 880.0)
    .resizable(true)
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = win.show();
    let _ = win.set_focus();

    let app_for_event = app.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app_for_event.emit("detached-preview-closed", ());
        }
    });

    Ok(true)
}

#[tauri::command]
pub(crate) fn emit_detached_preview_action(
    app: AppHandle,
    action_type: String,
    uuid: Option<String>,
    line_index: Option<usize>,
    next_code: Option<String>,
) -> Result<(), String> {
    let payload = DetachedPreviewActionPayload {
        action_type,
        uuid,
        line_index,
        next_code,
    };
    let _ = app.emit("detached-preview-action", &payload);
    Ok(())
}

#[tauri::command]
pub(crate) fn sync_detached_preview_state(
    app: AppHandle,
    state: State<AppState>,
    payload: DetachedPreviewState,
) -> Result<(), String> {
    if let Ok(mut guard) = state.detached_preview.lock() {
        *guard = payload.clone();
    }
    if let Some(win) = app.get_webview_window("detached-preview") {
        let win_title = if payload.title.is_empty() && payload.relative_path.is_empty() {
            "myLore — 전용 독립 뷰어 (F11)".to_string()
        } else if !payload.title.is_empty() {
            format!("myLore 독립 뷰어 — {}", payload.title)
        } else {
            format!("myLore 독립 뷰어 — {}", payload.relative_path)
        };
        let _ = win.set_title(&win_title);
        let _ = app.emit("detached-preview-update", &payload);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_detached_preview_state(state: State<AppState>) -> Result<DetachedPreviewState, String> {
    let guard = state.detached_preview.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}
