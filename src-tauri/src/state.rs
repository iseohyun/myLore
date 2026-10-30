//! Tauri 전역 관리 상태(`AppState`).

use crate::*;

pub struct AppState {
    pub db_path: PathBuf,
    pub lock: Arc<Mutex<()>>,
    pub scan_progress: Arc<Mutex<ScanProgressPayload>>,
    pub pending_cli_files: Arc<Mutex<Vec<String>>>,
    pub trash_history: Arc<Mutex<Vec<TrashedFileRecord>>>,
    pub detached_preview: Arc<Mutex<DetachedPreviewState>>,
}
