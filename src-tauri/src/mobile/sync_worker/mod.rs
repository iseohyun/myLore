//! 백그라운드 동기화 작업 큐(`SyncWorkerJob`)와 워커 스레드.
//!
//! 이 파일은 큐/배치/트랜잭션/진행률 루프만 담당하며, 작업 종류별 처리는 `jobs_*` 모듈의 `handle_*_job` 함수에 있습니다.

mod jobs_files;
mod jobs_messages;
mod jobs_meta;

use crate::*;

/// 배치 처리 중 파일별로 모아 두는 마크다운 라인: (sub, file_stem, doc_title, source_aliases) -> Vec<(date_str, md_line)>
pub(crate) type MdCoalesced = HashMap<(String, String, String, String), Vec<(String, String)>>;

pub(crate) enum SyncWorkerJob {
    StartSyncInspection {
        reset_watermarks: bool,
    },
    BatchInit {
        service: String,
        total_count: usize,
    },
    Notifications {
        dev_id: String,
        dev_name: String,
        items: Vec<(String, String, String, i64)>, // (pkg, title, text, ts)
        current_index: usize,
        total_count: usize,
    },
    Sms {
        dev_id: String,
        dev_name: String,
        items: Vec<(String, String, String, i64)>, // (address, clean_body, sms_type, ts)
    },
    CallLogs {
        dev_id: String,
        dev_name: String,
        items: Vec<(String, String, String, i64, i64)>, // (number, name, call_type, duration_sec, ts)
    },
    KakaoChat {
        dev_id: String,
        room_name: String,
        raw_folder_name: String,
        raw_text: String,
        file_hash: String,
        folder_index: usize,
        total_folders: usize,
        now_ms: i64,
    },
    Contacts {
        dev_id: String,
        items: Vec<(String, Vec<String>, String, String, i64)>, // (name, phones, org, memo, ts)
    },
    AppUsage {
        dev_id: String,
        items: Vec<(String, String, String, i64, i64, i64)>, // (date, pkg, app_name, fg_ms, launch_count, last_used)
    },
    CallRecording {
        dev_id: String,
        dev_name: String,
        file_hash: String,
        file_name: String,
        contact_label: String,
        transcript_text: String,
        audio_bytes: Vec<u8>,
        now_ms: i64,
    },
    Media {
        file_name: String,
        source_type: String,
        folder_name: String,
        file_bytes: Vec<u8>,
        taken_date: String,
        taken_time: String,
        media_uuid: String,
        content_hash: String,
    },
    SamsungHealth {
        dev_id: String,
        dev_name: String,
        raw_bytes: Vec<u8>,
        now_ms: i64,
    },
}

impl SyncWorkerJob {
    /// 6대 라이프로그 수집 진행률(카톡·알림·문자·통화·녹음·헬스)에 반영되는 포그라운드 동기화 작업인지 여부
    /// - 5초마다 백그라운드로 수신되는 `AppUsage`, `Contacts`는 진행률 바나 워커 배지를 깜빡이게 하지 않습니다.
    pub(crate) fn is_foreground_sync_job(&self) -> bool {
        !matches!(
            self,
            SyncWorkerJob::Contacts { .. } | SyncWorkerJob::AppUsage { .. }
        )
    }
}

pub(crate) static SYNC_WORKER_TX: std::sync::OnceLock<
    Mutex<std::sync::mpsc::Sender<SyncWorkerJob>>,
> = std::sync::OnceLock::new();

pub(crate) fn enqueue_sync_worker_job(job: SyncWorkerJob) {
    if let Some(tx_mutex) = SYNC_WORKER_TX.get() {
        if let Ok(tx) = tx_mutex.lock() {
            let is_fg = job.is_foreground_sync_job();
            if is_fg {
                SYNC_QUEUE_DEPTH.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                IS_WORKER_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            if tx.send(job).is_err() && is_fg {
                SYNC_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }
}

/// 메인 프로그램(UI/IPC/DB)과 완전히 분리된 전용 백그라운드 동기화 워커 스레드
/// - 모든 HTTP 동기화 패킷의 디스크 `.md` 병합 및 SQLite 적재를 큐(Channel)로 받아 단일 트랜잭션(`BEGIN IMMEDIATE ... COMMIT`)과 파일별 1회 배치 쓰기로 처리합니다.
/// - 연속 수신 중에는 `mobile-sync-event`를 발생시키지 않고 진행률(`LIVE_SYNC_PROGRESS`)만 갱신하며, 큐가 모두 비워진 후에만 단 1회 완료 이벤트를 발생시킵니다.
pub(crate) fn spawn_mobile_sync_worker_thread(app_handle: AppHandle, db_path: PathBuf) {
    let (tx, rx) = std::sync::mpsc::channel::<SyncWorkerJob>();
    let _ = SYNC_WORKER_TX.set(Mutex::new(tx));

    let _ = thread::Builder::new()
        .name("mylore-mobile-sync-worker".to_string())
        .spawn(move || {
            let android_msg_re = Regex::new(
                r"^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+(오전|오후)\s*(\d{1,2}:\d{2}),\s*([^:]+?)\s*:\s*(.*)$",
            )
            .unwrap();
            let date_re = Regex::new(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일").unwrap();
            let pc_msg_re = Regex::new(r"^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$").unwrap();

            // 서버 기동 시 DB에 저장된 워터마크를 인메모리 캐시에 로드하고 초기 6단계 동기화 점검 수행
            if let Ok(conn) = open_db(&db_path) {
                update_atomic_max_i64(&MEM_LAST_KAKAO_TS, get_meta_i64(&conn, "last_kakao_ts"));
                update_atomic_max_i64(&MEM_LAST_NOTI_TS, get_meta_i64(&conn, "last_noti_ts"));
                update_atomic_max_i64(&MEM_LAST_SMS_TS, get_meta_i64(&conn, "last_sms_ts"));
                update_atomic_max_i64(&MEM_LAST_CALL_TS, get_meta_i64(&conn, "last_call_ts"));
                update_atomic_max_i64(
                    &MEM_LAST_RECORDING_TS,
                    get_meta_i64(&conn, "last_recording_ts"),
                );
                update_atomic_max_i64(&MEM_LAST_HEALTH_TS, get_meta_i64(&conn, "last_health_ts"));
                update_atomic_max_i64(&MEM_LAST_CONTACT_TS, get_meta_i64(&conn, "last_contact_ts"));
                update_atomic_max_i64(&MEM_LAST_USAGE_TS, get_meta_i64(&conn, "last_usage_ts"));
            }
            let _ = broadcast_udp_pc_online();
            complete_all_remaining_sync_steps(&app_handle, &db_path, true);

            let mut next_first_job: Option<SyncWorkerJob> = None;
            let mut cycle_had_foreground_job = false;
            let mut waiting_for_initial_phone_burst = false;

            loop {
                let first_job = match next_first_job.take() {
                    Some(j) => j,
                    None => match rx.recv() {
                        Ok(j) => j,
                        Err(_) => break,
                    },
                };

                let mut batch: Vec<SyncWorkerJob> = Vec::with_capacity(64);
                batch.push(first_job);
                while batch.len() < 128 {
                    match rx.try_recv() {
                        Ok(j) => batch.push(j),
                        Err(_) => break,
                    }
                }

                if batch.iter().any(|j| j.is_foreground_sync_job()) {
                    cycle_had_foreground_job = true;
                    IS_WORKER_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
                }

                if let Ok(conn) = open_db(&db_path) {
                    let _ = conn.execute_batch("BEGIN IMMEDIATE;");

                    // (sub, file_stem, doc_title, source_aliases) -> Vec<(date_str, md_line)>
                    let mut md_coalesced: MdCoalesced = HashMap::new();
                    let mut need_transcript_trigger = false;

                    for job in batch {
                        let is_fg = job.is_foreground_sync_job();
                        match job {
                            SyncWorkerJob::StartSyncInspection { reset_watermarks } => {
                                waiting_for_initial_phone_burst = true;
                                let mutex = LIVE_SYNC_PROGRESS
                                    .get_or_init(|| Mutex::new(default_live_sync_progress()));
                                if let Ok(mut guard) = mutex.lock() {
                                    *guard = default_live_sync_progress();
                                    guard.is_running = true;
                                    guard.is_completed = false;
                                    guard.queued_jobs = SYNC_QUEUE_DEPTH
                                        .load(std::sync::atomic::Ordering::Relaxed);
                                    guard.current_label = if reset_watermarks {
                                        "카카오톡 받아오는 중... (전체 데이터 재요청 송출)"
                                            .to_string()
                                    } else {
                                        "카카오톡 받아오는 중... (모바일 동기화 점검)".to_string()
                                    };
                                    if let Some(first_step) = guard.steps.first_mut() {
                                        first_step.status = "running".to_string();
                                    }
                                    let _ = app_handle.emit("mobile-sync-progress", &*guard);
                                }
                                let _ = broadcast_udp_pc_online();
                            }
                            SyncWorkerJob::BatchInit {
                                service,
                                total_count,
                            } => {
                                waiting_for_initial_phone_burst = false;
                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    &service,
                                    0,
                                    total_count.max(1),
                                    0,
                                    0,
                                    Some(&format!("총 {}건 전송 준비 완료 (0%)", total_count)),
                                );
                            }
                            job @ SyncWorkerJob::Notifications { .. } => {
                                jobs_messages::handle_notifications_job(&app_handle, &conn, &mut md_coalesced, job);
                            }
                            job @ SyncWorkerJob::Sms { .. } => {
                                jobs_messages::handle_sms_job(&app_handle, &conn, &mut md_coalesced, job);
                            }
                            job @ SyncWorkerJob::CallLogs { .. } => {
                                jobs_messages::handle_call_logs_job(&app_handle, &conn, &mut md_coalesced, job);
                            }
                            job @ SyncWorkerJob::KakaoChat { .. } => {
                                jobs_messages::handle_kakao_chat_job(&app_handle, &conn, &android_msg_re, &date_re, &pc_msg_re, job);
                            }
                            job @ SyncWorkerJob::Contacts { .. } => {
                                jobs_meta::handle_contacts_job(&conn, &mut md_coalesced, job);
                            }
                            job @ SyncWorkerJob::AppUsage { .. } => {
                                jobs_meta::handle_app_usage_job(&conn, &mut md_coalesced, job);
                            }
                            job @ SyncWorkerJob::CallRecording { .. } => {
                                jobs_files::handle_call_recording_job(&app_handle, &conn, &mut need_transcript_trigger, job);
                            }
                            job @ SyncWorkerJob::Media { .. } => {
                                jobs_files::handle_media_job(&app_handle, &conn, job);
                            }
                            SyncWorkerJob::SamsungHealth {
                                dev_id,
                                dev_name,
                                raw_bytes,
                                now_ms,
                            } => {
                                let (added, skipped, _) = process_samsung_health_sync_payload(
                                    &conn, &dev_id, &dev_name, &raw_bytes, now_ms,
                                );
                                let _ = emit_live_service_sync_progress(
                                    &app_handle,
                                    "health",
                                    (added + skipped).max(1),
                                    (added + skipped).max(1),
                                    skipped,
                                    added,
                                    None,
                                );
                            }
                        }
                        if is_fg {
                            SYNC_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                        }
                    }

                    let _ = conn.execute_batch("COMMIT;");

                    // 큐에서 병합된 마크다운 라인들을 파일당 단 1회씩만 디스크에 기록
                    for ((sub, file_stem, doc_title, source_aliases), entries) in md_coalesced {
                        append_lines_to_mobile_md_batch(
                            &conn,
                            &sub,
                            &file_stem,
                            &doc_title,
                            &source_aliases,
                            &entries,
                        );
                    }

                    if need_transcript_trigger && is_auto_call_transcription_enabled(&conn) {
                        let db_bg = db_path.clone();
                        let app_bg = app_handle.clone();
                        thread::spawn(move || {
                            let _ = process_pending_call_transcriptions(
                                &db_bg,
                                Some(&app_bg),
                                false,
                            );
                        });
                    }
                } else {
                    for job in &batch {
                        if job.is_foreground_sync_job() {
                            SYNC_QUEUE_DEPTH.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                        }
                    }
                }

                // 백그라운드 메타데이터(AppUsage/Contacts)만 처리된 경우 진행률 상태나 배지를 건드리지 않음
                if !cycle_had_foreground_job {
                    continue;
                }

                // 연속 도착하는 동기화 패킷 사이에 추가 작업이 들어오는지 대기 (초기 요청 시 2800ms, 일반 패킷 간 1200ms)
                if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) == 0 {
                    let wait_ms = if waiting_for_initial_phone_burst {
                        2800
                    } else {
                        1200
                    };
                    match rx.recv_timeout(std::time::Duration::from_millis(wait_ms)) {
                        Ok(j) => {
                            if j.is_foreground_sync_job() {
                                waiting_for_initial_phone_burst = false;
                            }
                            next_first_job = Some(j);
                            continue;
                        }
                        Err(_) => {
                            if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) == 0 {
                                waiting_for_initial_phone_burst = false;
                                cycle_had_foreground_job = false;
                                complete_all_remaining_sync_steps(&app_handle, &db_path, false);
                                let _ = app_handle.emit(
                                    "mobile-sync-event",
                                    serde_json::json!({
                                        "type": "sync_cycle_complete",
                                        "message": "✅ 모바일 백그라운드 동기화 큐 처리가 모두 완료되었습니다."
                                    }),
                                );
                            }
                        }
                    }
                }
            }
        });
}
