//! 모바일 동기화 진행률 상태(인메모리) 및 프론트엔드 이벤트 발행.

use crate::*;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MobileSyncSegment {
    pub(crate) kind: String, // "skip" (파란색: 이미 보유하여 스킵) | "download" (녹색: 신규 다운로드)
    pub(crate) width_pct: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MobileSyncStepSummary {
    pub(crate) key: String,
    pub(crate) label: String,
    pub(crate) status: String, // "pending" | "running" | "done"
    pub(crate) percent: u32,
    pub(crate) total_count: usize,
    pub(crate) skipped_count: usize,
    pub(crate) downloaded_count: usize,
    pub(crate) segments: Vec<MobileSyncSegment>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MobileSyncProgressPayload {
    pub(crate) is_running: bool,
    pub(crate) is_completed: bool,
    pub(crate) current_step_index: usize,
    pub(crate) total_steps: usize,
    pub(crate) current_key: String,
    pub(crate) current_label: String,
    pub(crate) current_percent: u32,
    #[serde(default)]
    pub(crate) queued_jobs: usize,
    pub(crate) steps: Vec<MobileSyncStepSummary>,
}

pub(crate) static LIVE_SYNC_PROGRESS: std::sync::OnceLock<Mutex<MobileSyncProgressPayload>> =
    std::sync::OnceLock::new();

pub(crate) static SYNC_QUEUE_DEPTH: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub(crate) static IS_WORKER_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub(crate) static LAST_PROGRESS_EMIT_MS: std::sync::atomic::AtomicI64 =
    std::sync::atomic::AtomicI64::new(0);

pub(crate) static INITIAL_SYNC_CHECKED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub(crate) static LAST_APP_USAGE_DIGEST: std::sync::OnceLock<Mutex<(String, i64)>> =
    std::sync::OnceLock::new();

pub(crate) fn rebuild_step_segments(st: &mut MobileSyncStepSummary) {
    st.segments.clear();
    let pct = st.percent.clamp(0, 100);
    if pct == 0 {
        return;
    }
    let tot_processed = st.skipped_count + st.downloaded_count;
    if tot_processed == 0 {
        st.segments.push(MobileSyncSegment {
            kind: "skip".to_string(),
            width_pct: pct as f64,
        });
    } else {
        let skip_w = (pct as f64) * (st.skipped_count as f64 / tot_processed as f64);
        let dl_w = (pct as f64) - skip_w;
        if skip_w > 0.05 {
            st.segments.push(MobileSyncSegment {
                kind: "skip".to_string(),
                width_pct: skip_w,
            });
        }
        if dl_w > 0.05 {
            st.segments.push(MobileSyncSegment {
                kind: "download".to_string(),
                width_pct: dl_w,
            });
        }
    }
}

pub(crate) fn default_live_sync_progress() -> MobileSyncProgressPayload {
    let step_defs = [
        ("kakaotalk", "카카오톡 받아오는 중..."),
        ("notification", "알림목록 받아오는 중..."),
        ("sms", "문자 목록 받아오는 중..."),
        ("call", "통화 목록 받아오는 중..."),
        ("recording", "녹음 목록 받아오는 중..."),
        ("health", "헬스 데이터 받아오는 중..."),
    ];
    let steps = step_defs
        .iter()
        .map(|(k, lbl)| MobileSyncStepSummary {
            key: k.to_string(),
            label: lbl.to_string(),
            status: "pending".to_string(),
            percent: 0,
            total_count: 0,
            skipped_count: 0,
            downloaded_count: 0,
            segments: Vec::new(),
        })
        .collect();
    MobileSyncProgressPayload {
        is_running: false,
        is_completed: false,
        current_step_index: 0,
        total_steps: step_defs.len(),
        current_key: "kakaotalk".to_string(),
        current_label: "카카오톡 받아오는 중...".to_string(),
        current_percent: 0,
        queued_jobs: 0,
        steps,
    }
}

/// 메인 프로그램이 DB나 디스크 I/O 없이 순수 인메모리 진행 상태만 가볍게 모니터링할 수 있는 Tauri 커맨드
#[tauri::command]
pub(crate) fn get_mobile_sync_progress_state() -> MobileSyncProgressPayload {
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    if let Ok(mut guard) = mutex.lock() {
        let q = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
        let active = IS_WORKER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
        guard.queued_jobs = q;
        guard.is_running = active || q > 0;
        if guard.is_running {
            guard.is_completed = false;
        }
        return guard.clone();
    }
    default_live_sync_progress()
}

/// 백그라운드 스레드가 각 단계(카톡 -> 알림 -> 문자 -> 통화 -> 녹음 -> 헬스)를 다운로드·적재할 때
/// 이전 단계들을 자동으로 100%(done) 완료 처리하고 현재 단계의 백분위(%)와 구간 색상(파란색=스킵, 녹색=신규다운로드)을 갱신합니다.
pub(crate) fn emit_live_service_sync_progress(
    app: &AppHandle,
    service_key: &str,
    current_idx: usize,
    total_cnt: usize,
    skipped_add: usize,
    downloaded_add: usize,
    custom_label: Option<&str>,
) -> u32 {
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    let mut guard = match mutex.lock() {
        Ok(g) => g,
        Err(_) => return 100,
    };

    let prev_key = guard.current_key.clone();
    let step_pos = guard
        .steps
        .iter()
        .position(|s| s.key == service_key)
        .unwrap_or(0);

    // 현재 단계(step_pos) 이전의 단계들 중 아직 완료되지 않은 단계가 있다면 자동으로 100%(done, 파란색 스킵 반영) 처리
    for prev_i in 0..step_pos {
        let prev_st = &mut guard.steps[prev_i];
        if prev_st.status != "done" || prev_st.percent < 100 {
            prev_st.percent = 100;
            prev_st.status = "done".to_string();
            prev_st.total_count = prev_st
                .total_count
                .max(prev_st.skipped_count + prev_st.downloaded_count);
            rebuild_step_segments(prev_st);
        }
    }

    let pct = if total_cnt == 0 {
        100u32
    } else if current_idx == 0 {
        0u32
    } else {
        (((current_idx as f64 / total_cnt as f64) * 100.0).round() as u32).clamp(0, 100)
    };

    {
        let st = &mut guard.steps[step_pos];
        if current_idx == 0 {
            st.total_count = total_cnt.max(st.skipped_count + st.downloaded_count);
        } else {
            st.skipped_count += skipped_add;
            st.downloaded_count += downloaded_add;
            st.total_count = total_cnt.max(st.skipped_count + st.downloaded_count);
        }
        st.percent = pct;
        st.status = if pct >= 100 {
            "done".to_string()
        } else {
            "running".to_string()
        };
        rebuild_step_segments(st);
    }

    let q_depth = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
    let active = IS_WORKER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
    guard.queued_jobs = q_depth;
    guard.is_running = true;
    guard.is_completed = false;
    guard.current_step_index = step_pos;
    guard.current_key = service_key.to_string();
    guard.current_label = custom_label
        .map(|s| s.to_string())
        .unwrap_or_else(|| guard.steps[step_pos].label.clone());
    guard.current_percent = pct;

    let payload_clone = guard.clone();
    drop(guard);

    let now_ms = chrono::Local::now().timestamp_millis();
    let last_ms = LAST_PROGRESS_EMIT_MS.load(std::sync::atomic::Ordering::Relaxed);
    let force_emit =
        current_idx == 0 || (q_depth == 0 && !active && pct >= 100) || prev_key != service_key;
    if force_emit || (now_ms - last_ms) >= 180 {
        LAST_PROGRESS_EMIT_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
        let _ = app.emit("mobile-sync-progress", &payload_clone);
    }
    pct
}

/// 백그라운드 워커 스레드에서 DB의 실제 카테고리별 보유 건수(기보유=파란색 스킵, 당일/신규=녹색 다운로드)를 읽어와
/// 아직 완료되지 않은 모든 단계(카톡 -> 알림 -> 문자 -> 통화 -> 녹음 -> 헬스)를 0% -> 100%까지 순차적으로 점검·완료합니다.
pub(crate) fn complete_all_remaining_sync_steps(app: &AppHandle, db_path: &Path, reset_all_first: bool) {
    let step_keys = [
        "kakaotalk",
        "notification",
        "sms",
        "call",
        "recording",
        "health",
    ];
    let mut db_counts: Vec<(usize, usize)> = vec![(0, 0); step_keys.len()];
    if let Ok(conn) = open_db(db_path) {
        let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
        for (idx, key) in step_keys.iter().enumerate() {
            let total: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1",
                    params![*key],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let recent: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1 AND sent_date >= ?2",
                    params![*key, today_str],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let tot_u = total.max(0) as usize;
            let dl_u = (recent.max(0) as usize).min(tot_u);
            let skip_u = tot_u.saturating_sub(dl_u);
            db_counts[idx] = (skip_u, dl_u);
        }
    }

    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    if let Ok(mut guard) = mutex.lock() {
        guard.is_running = true;
        guard.is_completed = false;
        for (idx, st) in guard.steps.iter_mut().enumerate() {
            let (db_sk, db_dl) = db_counts[idx];
            if reset_all_first {
                st.status = "pending".to_string();
                st.percent = 0;
                st.skipped_count = db_sk;
                st.downloaded_count = db_dl;
                st.total_count = db_sk + db_dl;
                st.segments.clear();
            } else if st.skipped_count + st.downloaded_count == 0 {
                st.skipped_count = db_sk;
                st.downloaded_count = db_dl;
                st.total_count = db_sk + db_dl;
            } else {
                st.skipped_count = st.skipped_count.max(db_sk);
                st.total_count = st.skipped_count + st.downloaded_count;
            }
        }
    }

    for step_idx in 0..step_keys.len() {
        // 만약 도중에 새로운 실시간 동기화 작업이 큐에 들어왔다면 즉시 양보하여 실제 패킷부터 처리
        if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) > 0 && !reset_all_first {
            return;
        }
        let already_done = {
            if let Ok(guard) = mutex.lock() {
                guard.steps[step_idx].status == "done" && guard.steps[step_idx].percent >= 100
            } else {
                false
            }
        };
        if already_done {
            continue;
        }

        for pct in [25u32, 50, 75, 100] {
            if SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed) > 0 && !reset_all_first {
                return;
            }
            if let Ok(mut guard) = mutex.lock() {
                let q = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
                guard.queued_jobs = q;
                guard.is_running = true;
                guard.is_completed = false;
                guard.current_step_index = step_idx;
                guard.current_key = guard.steps[step_idx].key.clone();
                guard.current_label = guard.steps[step_idx].label.clone();
                guard.current_percent = pct;

                let st = &mut guard.steps[step_idx];
                st.percent = pct;
                st.status = if pct >= 100 {
                    "done".to_string()
                } else {
                    "running".to_string()
                };
                rebuild_step_segments(st);
                let _ = app.emit("mobile-sync-progress", &*guard);
            }
            thread::sleep(std::time::Duration::from_millis(55));
        }
    }

    IS_WORKER_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
    if let Ok(mut guard) = mutex.lock() {
        guard.queued_jobs = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
        guard.is_running = false;
        guard.is_completed = true;
        guard.current_step_index = guard.total_steps.saturating_sub(1);
        guard.current_key = "done".to_string();
        guard.current_label = "모든 라이프로그 항목 동기화 확인 완료 (100%)".to_string();
        guard.current_percent = 100;
        let _ = app.emit("mobile-sync-progress", &*guard);
    }
}

#[tauri::command]
pub(crate) fn trigger_sequential_mobile_sync(_app: AppHandle, _state: State<AppState>) -> Result<String, String> {
    let _ = broadcast_udp_pc_online();
    enqueue_sync_worker_job(SyncWorkerJob::StartSyncInspection {
        reset_watermarks: false,
    });
    Ok("백그라운드 동기화 스레드에 순차 동기화 점검 신호 전달 완료".to_string())
}
