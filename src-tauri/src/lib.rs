//! myLore Tauri 백엔드 크레이트 루트.
//!
//! 도메인별 모듈 구성 (자세한 색인: `docs/CODEMAP.md`):
//! - [`util`]: 공통 유틸리티 (Windows 프로세스 플래그, base64, URL 디코딩, 시간 변환, 파일명 정리).
//! - [`models`]: 프론트엔드와 주고받는 공용 직렬화 모델(DTO) 모음.
//! - [`state`]: Tauri 전역 관리 상태(`AppState`).
//! - [`settings`]: 앱 설정(`setting.json`) 모델, 기본값 및 조회/저장 커맨드.
//! - [`db`]: SQLite 메타 DB 연결, 스키마 생성/마이그레이션 및 `mobile_sync_meta` 키-값 헬퍼.
//! - [`vault`]: 볼트(베이스 폴더) 문서 관리: 마크다운, 스캔, 문서 CRUD, 휴지통.
//! - [`system`]: OS 연동: 탐색기, 네이티브 파일 대화상자, Chrome/구글 캘린더 실행, CLI 인자·단일 인스턴스.
//! - [`window`]: 창 제어: 전체 화면 토글 및 분리(Detached) 미리보기 창 동기화.
//! - [`lifelog`]: 모바일 라이프로그(연락처·문자·통화·녹음·카톡) 파싱/저장/조회.
//! - [`finance`]: 가계부: 금융 거래 조회, 알림 문자 파싱, 엑셀 행 가져오기.
//! - [`gemini`]: Gemini LLM 연동(통화/음성 녹음 스크립트화).
//! - [`mobile`]: 모바일 동반 앱(myLoreSync) 연동: 페어링, HTTP 서버, 동기화 워커.
//!
//! 각 모듈은 `use crate::*;` 로 공용 네임스페이스(외부 crate import + 모든 모듈 항목)를 공유합니다.

#![allow(unused_imports)]

use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;
use walkdir::WalkDir;

mod util;
mod paths;
#[cfg(test)]
mod paths_tests;
mod models;
mod state;
mod settings;
mod db;
mod vault;
mod system;
mod window;
mod lifelog;
mod finance;
mod gemini;
mod logger;
mod mobile;
mod calendar_sync;

pub(crate) use util::*;
pub(crate) use paths::*;
pub(crate) use models::*;
pub(crate) use state::*;
pub(crate) use settings::*;
pub(crate) use db::*;
pub(crate) use vault::*;
pub(crate) use system::*;
pub(crate) use window::*;
pub(crate) use lifelog::*;
pub(crate) use finance::*;
pub(crate) use gemini::*;
pub(crate) use logger::*;
pub(crate) use mobile::*;
pub(crate) use calendar_sync::*;

const _FRONTEND_DIST_INDEX_SYNC: &str = include_str!("../../dist/index.html");

// 테스트 바이너리 전용: tauri-build가 만든 Windows 리소스(Common Controls v6 매니페스트)를 링크합니다.
// 없으면 `cargo test` 실행 파일이 comctl32 v5를 로드하여 `TaskDialogIndirect` 진입점 누락으로 시작조차 하지 못합니다.
// (검색 경로는 build.rs에서 추가, 일반 bin 빌드에는 영향 없음)
#[cfg(all(test, windows, target_env = "gnu"))]
#[link(name = "resource", kind = "static", modifiers = "+whole-archive")]
extern "C" {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. 분리된 독립 AI 큐 워커 서브프로세스 모드 (`mylore.exe --ai-queue-worker`):
    //    메인 GUI 프로세스가 종료되거나 재시작되더라도 DETACHED_PROCESS로 살아남아
    //    현재 큐의 AI 스크립트 변환을 끝까지 처리한 후 자동 종료됩니다.
    if std::env::args().any(|a| a.trim() == "--ai-queue-worker") {
        let force_now = std::env::args().any(|a| a.trim() == "--force-now");
        run_detached_ai_queue_worker_process(force_now);
        return;
    }

    // 1-b. 결재 대기 최근 통화녹음 음성지문·타임태그·화자혼동 재분석 및 프롬프트 A/B 결재안건 생성 CLI 모드
    if std::env::args().any(|a| a.trim() == "--reanalyze-pending-calls") {
        let db_path = resolve_meta_db_path();
        if let Ok(conn) = open_db(&db_path) {
            let calls_dir = get_archive_mobile_dir(&conn, "calls");
            let log_p = app_data_dir().join("reanalyze_status.txt");
            match reanalyze_recent_pending_approval_calls_internal(&conn, 5) {
                Ok(_) => {
                    let items = get_call_approval_items_from_conn(&conn).unwrap_or_default();
                    let pending_n = items.iter().filter(|i| i.stage == 2).count();
                    let _ = fs::write(
                        &log_p,
                        format!(
                            "OK: db={} calls_dir={} total_items={} stage2_pending={}",
                            db_path.display(),
                            calls_dir.display(),
                            items.len(),
                            pending_n
                        ),
                    );
                }
                Err(e) => {
                    let _ = fs::write(&log_p, format!("ERR: {}", e));
                }
            }
        }
        return;
    }

    let cli_paths = extract_cli_md_paths();
    // 이미 실행 중인 myLore 인스턴스가 있으면 해당 창으로 파일 경로를 전달하고 포커스한 뒤 즉시 종료 (단일 인스턴스)
    if try_forward_to_existing_instance(&cli_paths) {
        return;
    }

    // 메타 DB는 OneDrive 같은 동기화 폴더가 아닌 PC 로컬(%APPDATA%\com.iseohyun.mylore)에 둡니다.
    // 이전 버전의 OneDrive\Projects\.myLore\mylore_meta.db가 있으면 최초 1회 자동 이전합니다. (paths.rs)
    let db_path = resolve_meta_db_path();
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(conn) = open_db(&db_path) {
        let setting_path = resolve_projects_setting_json_path(&conn);
        if !setting_path.exists() {
            let mut def = MyLoreAppSettings::default();
            def.settings_file_path = setting_path.to_string_lossy().to_string();
            if let Ok(json_str) = serde_json::to_string_pretty(&def) {
                let _ = fs::write(&setting_path, json_str);
            }
        }
        sync_all_kakao_group_memberships_to_contacts(&conn);
    }

    let pending_cli_files = Arc::new(Mutex::new(cli_paths));
    let db_path_for_server = db_path.clone();
    let db_path_for_retry = db_path.clone();
    let pending_for_server = pending_cli_files.clone();

    tauri::Builder::default()
        .manage(AppState {
            db_path,
            lock: Arc::new(Mutex::new(())),
            scan_progress: Arc::new(Mutex::new(ScanProgressPayload::default())),
            pending_cli_files,
            trash_history: Arc::new(Mutex::new(Vec::new())),
            detached_preview: Arc::new(Mutex::new(DetachedPreviewState::default())),
        })
        .setup(move |app| {
            init_logger_and_prune(app.handle(), &db_path_for_server);
            log_system("INFO", "myLore 데스크톱 서버 기동 및 백그라운드 워커 초기화 시작");
            spawn_mobile_sync_worker_thread(
                app.handle().clone(),
                db_path_for_server.clone(),
            );
            spawn_mobile_companion_http_server(
                app.handle().clone(),
                db_path_for_server.clone(),
                pending_for_server.clone(),
            );
            spawn_call_transcript_retry_worker(
                app.handle().clone(),
                db_path_for_retry.clone(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_base_folders,
            save_base_folders,
            scan_and_inject_uuids,
            start_batch_uuid_scan,
            get_scan_progress,
            get_virtual_tree,
            read_document,
            read_document_by_uuid,
            save_document,
            create_new_document,
            create_empty_document_in_folder,
            create_temp_memo,
            open_root_main_md,
            show_in_explorer,
            rename_current_document,
            toggle_window_fullscreen,
            search_in_files,
            replace_in_files,
            open_native_file_dialog,
            open_native_folder_dialog,
            get_vault_templates,
            open_in_chrome_app_mode,
            promote_to_project_folder,
            move_document_to_role,
            open_google_calendar_web,
            get_lifelog_for_date,
            get_all_finance_transactions,
            parse_notification_into_finance,
            import_finance_rows,
            import_kakao_chat_text,
            get_kakao_update_requests,
            resolve_kakao_update_request,
            take_pending_cli_files,
            trash_document,
            restore_trashed_document,
            get_app_settings,
            save_app_settings,
            sync_detached_preview_scroll,
            toggle_detached_preview_window,
            emit_detached_preview_action,
            sync_detached_preview_state,
            get_detached_preview_state,
            get_mobile_pairing_info,
            update_mobile_pairing_config,
            remove_paired_mobile_device,
            trigger_full_mobile_resync,
            send_mobile_udp_wake_broadcast,
            trigger_sequential_mobile_sync,
            get_mobile_sync_progress_state,
            get_all_lifelog_messages,
            get_mobile_contacts_map,
            get_contact_ai_profiles,
            save_contact_ai_profile,
            sync_contact_person_markdown_files,
            open_contact_person_document,
            get_contact_prompt_tournament_status,
            update_contact_prompt_slot_manual,
            get_contact_profile_approvals,
            generate_contact_profile_ab_update,
            resolve_contact_profile_approval,
            open_lifelog_item_document,
            retry_pending_call_transcriptions,
            get_gemini_api_key_status,
            set_auto_call_transcription,
            get_call_recording_play_info,
            transcribe_single_call_item,
            update_call_transcript_stage,
            save_and_verify_gemini_api_key,
            transcribe_local_audio_file,
            get_call_ai_transcription_stats,
            get_call_approval_items,
            get_ai_queue_dashboard_status,
            control_ai_queue_worker,
            get_multi_llm_providers_status,
            set_active_text_llm_provider,
            save_and_verify_llm_provider_key,
            save_llm_provider_billing_config,
            get_media_origin_registry_summary,
            update_media_origin_status,
            get_location_movement_logs,
            record_location_movement_entry,
            get_service_logs,
            clear_service_logs,
            prune_expired_service_logs,
            get_pc_activity_summary,
            get_google_calendar_sync_status,
            sync_google_calendar_events,
            start_google_calendar_oauth_login,
            get_voiceprint_dashboard_status,
            enroll_voiceprint_from_base64_audio,
            enroll_voiceprint_from_synced_file,
            test_voiceprint_verification,
            save_voiceprint_raw_json,
            reset_voiceprint_profile,
            reanalyze_recent_pending_approval_calls,
            resolve_call_ab_decision_with_feedback,
            analyze_single_call_asr_and_ab,
            get_call_postprocess_prompt_and_log,
            save_call_postprocess_prompt,
            confirm_call_script_with_user_edits
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
