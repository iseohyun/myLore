//! OS 연동: 탐색기, 네이티브 파일 대화상자, Chrome/구글 캘린더 실행, CLI 인자·단일 인스턴스.

use crate::*;

/// 우클릭 -> 탐색기에서 보기 (Windows Explorer /select 실행)
#[tauri::command]
pub(crate) fn show_in_explorer(full_path: String) -> Result<(), String> {
    let p = Path::new(&full_path);
    if p.exists() {
        let _ = Command::new("explorer.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .arg(format!("/select,{}", p.display()))
            .spawn();
    } else if let Some(parent) = p.parent() {
        let _ = Command::new("explorer.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .arg(parent.as_os_str())
            .spawn();
    }
    Ok(())
}

/// Windows 네이티브 파일 선택 다이얼로그 (파일 > 파일 열기)
#[tauri::command]
pub(crate) fn open_native_file_dialog() -> Result<Option<String>, String> {
    let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = "Markdown Files (*.md)|*.md|All Files (*.*)|*.*"
$dlg.InitialDirectory = "C:\Users\iseoh\OneDrive"
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dlg.FileName
}
"#;
    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-STA", "-Command", ps_script])
        .output()
        .map_err(|e| e.to_string())?;
    let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_str.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path_str))
    }
}

/// Windows 네이티브 폴더 선택 다이얼로그 (파일 > 폴더 열기)
#[tauri::command]
pub(crate) fn open_native_folder_dialog() -> Result<Option<String>, String> {
    let ps_script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.SelectedPath = "C:\Users\iseoh\OneDrive"
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dlg.SelectedPath
}
"#;
    let output = Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-STA", "-Command", ps_script])
        .output()
        .map_err(|e| e.to_string())?;
    let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_str.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path_str))
    }
}

#[tauri::command]
pub(crate) fn open_in_chrome_app_mode() -> Result<(), String> {
    let app_url = "http://127.0.0.1:18443";
    let chrome_candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for candidate in chrome_candidates {
        if Path::new(candidate).exists() {
            let _ = Command::new(candidate)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(format!("--app={}", app_url))
                .spawn();
            return Ok(());
        }
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let user_chrome =
            Path::new(&local_app_data).join(r"Google\Chrome\Application\chrome.exe");
        if user_chrome.exists() {
            let _ = Command::new(user_chrome)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(format!("--app={}", app_url))
                .spawn();
            return Ok(());
        }
    }
    open_google_calendar_web(app_url.to_string(), None)
}

#[tauri::command]
pub(crate) fn open_google_calendar_web(url: String, browser_path: Option<String>) -> Result<(), String> {
    if let Some(bp) = browser_path {
        if !bp.trim().is_empty() && Path::new(&bp).exists() {
            let _ = Command::new(bp)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(&url)
                .spawn();
            return Ok(());
        }
    }

    let chrome_candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    for candidate in chrome_candidates {
        if Path::new(candidate).exists() {
            let _ = Command::new(candidate)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(&url)
                .spawn();
            return Ok(());
        }
    }

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let user_chrome =
            Path::new(&local_app_data).join(r"Google\Chrome\Application\chrome.exe");
        if user_chrome.exists() {
            let _ = Command::new(user_chrome)
                .creation_flags(CREATE_NO_WINDOW)
                .arg(&url)
                .spawn();
            return Ok(());
        }
    }

    let _ = Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["/C", "start", "chrome", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn take_pending_cli_files(state: State<AppState>) -> Result<Vec<String>, String> {
    let mut guard = state.pending_cli_files.lock().map_err(|e| e.to_string())?;
    let files = guard.clone();
    guard.clear();
    Ok(files)
}

pub(crate) fn extract_cli_md_paths() -> Vec<String> {
    let mut paths = Vec::new();
    for arg in std::env::args().skip(1) {
        let trimmed = arg.trim().trim_matches('"');
        if trimmed.is_empty() || trimmed.starts_with('-') {
            continue;
        }
        let p = Path::new(trimmed);
        if p.exists() && p.is_file() {
            if let Ok(canon) = fs::canonicalize(p) {
                let s = canon.to_string_lossy().to_string();
                let clean = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
                paths.push(clean);
            } else {
                paths.push(p.to_string_lossy().to_string());
            }
        }
    }
    paths
}

pub(crate) fn try_forward_to_existing_instance(paths: &[String]) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr: SocketAddr = match "127.0.0.1:18443".parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(250)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));

    let body = serde_json::to_string(paths).unwrap_or_else(|_| "[]".to_string());
    let req = format!(
        "POST /api/v1/open-files HTTP/1.1\r\nHost: 127.0.0.1:18443\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut resp = String::new();
    let _ = stream.read_to_string(&mut resp);
    resp.contains("200")
}
