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
    #[serde(default)]
    pub(crate) total_bytes: u64,
    #[serde(default)]
    pub(crate) synced_bytes: u64,
    pub(crate) segments: Vec<MobileSyncSegment>,
}

pub(crate) fn format_bytes_human(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MobileSyncProgressPayload {
    pub(crate) is_running: bool,
    pub(crate) is_completed: bool,
    #[serde(default)]
    pub(crate) session_id: String,
    #[serde(default)]
    pub(crate) is_ready: bool,
    #[serde(default)]
    pub(crate) session_total_bytes: u64,
    #[serde(default)]
    pub(crate) session_synced_bytes: u64,
    #[serde(default)]
    pub(crate) session_total_count: usize,
    #[serde(default)]
    pub(crate) session_synced_count: usize,
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

pub(crate) static RECONCILE_PENDING_COMPLETION: std::sync::atomic::AtomicBool =
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
    // 프로토콜 v2.0 방안 A 우선순위:
    // 1. notification ➔ 2. sms ➔ 3. call(통화기록+녹음) ➔ 4. kakaotalk(kakao) ➔ 5. recording(일반녹음) ➔ 6. health
    let step_defs = [
        ("notification", "알림목록 받아오는 중..."),
        ("sms", "문자 목록 받아오는 중..."),
        ("call", "통화 목록·녹음 받아오는 중..."),
        ("kakaotalk", "카카오톡 받아오는 중..."),
        ("recording", "일반 녹음 받아오는 중..."),
        ("health", "헬스 데이터 받아오는 중..."),
        ("photo", "사진·동영상 받아오는 중..."),
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
            total_bytes: 0,
            synced_bytes: 0,
            segments: Vec::new(),
        })
        .collect();
    MobileSyncProgressPayload {
        is_running: false,
        is_completed: false,
        session_id: String::new(),
        is_ready: true,
        session_total_bytes: 0,
        session_synced_bytes: 0,
        session_total_count: 0,
        session_synced_count: 0,
        current_step_index: 0,
        total_steps: step_defs.len(),
        current_key: "notification".to_string(),
        current_label: "알림목록 받아오는 중...".to_string(),
        current_percent: 0,
        queued_jobs: 0,
        steps,
    }
}

/// 각 단계의 바이트/건수 합산을 기반으로 세션 전체 `session_total_bytes`, `session_synced_bytes`,
/// `session_total_count`, `session_synced_count`를 재계산합니다 (동적 볼륨 확장 지원).
pub(crate) fn recompute_session_totals(guard: &mut MobileSyncProgressPayload) {
    let mut sum_tot_b = 0u64;
    let mut sum_syn_b = 0u64;
    let mut sum_tot_c = 0usize;
    let mut sum_syn_c = 0usize;

    for st in &mut guard.steps {
        // DB형(notification, sms)은 바이트 합산 제외, 파일형(call, kakaotalk, recording, health, photo)만 바이트 합산
        if st.key != "notification" && st.key != "sms" {
            if st.total_bytes > 0 && st.synced_bytes > st.total_bytes {
                st.synced_bytes = st.total_bytes;
            }
            sum_tot_b = sum_tot_b.saturating_add(st.total_bytes);
            sum_syn_b = sum_syn_b.saturating_add(st.synced_bytes);
        }
        sum_tot_c = sum_tot_c.saturating_add(st.total_count);
        let step_done_c = (st.skipped_count + st.downloaded_count).min(if st.total_count > 0 {
            st.total_count
        } else {
            usize::MAX
        });
        sum_syn_c = sum_syn_c.saturating_add(step_done_c);
    }

    guard.session_total_bytes = guard.session_total_bytes.max(sum_tot_b);
    let mut next_syn_b = guard.session_synced_bytes.max(sum_syn_b);
    if guard.session_total_bytes > 0 {
        next_syn_b = next_syn_b.min(guard.session_total_bytes);
    }
    guard.session_synced_bytes = next_syn_b;

    guard.session_total_count = guard.session_total_count.max(sum_tot_c);
    let mut next_syn_c = guard.session_synced_count.max(sum_syn_c);
    if guard.session_total_count > 0 {
        next_syn_c = next_syn_c.min(guard.session_total_count);
    }
    guard.session_synced_count = next_syn_c;
}

/// `POST /api/v1/sync/session-plan` 요청 데이터를 인메모리 진행 상태에 반영하고 프론트엔드로 브로드캐스트합니다.
pub(crate) fn apply_session_plan_to_live_progress(
    app: &AppHandle,
    session_id: &str,
    is_ready: bool,
    req_total_bytes: u64,
    req_synced_bytes: u64,
    req_total_count: usize,
    req_synced_count: usize,
    volumes: &[(String, usize, usize, u64, u64)], // (norm_key, total_count, synced_count, total_bytes, synced_bytes)
) -> u32 {
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    let mut guard = match mutex.lock() {
        Ok(g) => g,
        Err(_) => return 0,
    };

    let is_new_session = !session_id.is_empty() && guard.session_id != session_id;
    let was_already_completed = guard.is_completed
        || guard
            .steps
            .iter()
            .filter(|s| s.key != "photo")
            .all(|s| s.status == "done" && s.percent >= 100);
    // 증분 세션 여부 판별: 이미 한 번 전체 동기화가 완료된 상태에서 소량 알림/이벤트만 포함된 신규 세션인 경우
    // 완료된 다른 단계들을 0%("알림목록 받아오는 중...")로 리셋하지 않고 기존 100%(done) 상태를 보존합니다.
    let has_non_noti_work = volumes
        .iter()
        .any(|(k, tc, sc, tb, sb)| k != "notification" && (*tc > *sc || *tb > *sb));

    if is_new_session {
        if was_already_completed && !has_non_noti_work {
            guard.session_id = session_id.to_string();
            for st in &mut guard.steps {
                if st.status != "done" || st.percent < 100 {
                    st.status = "done".to_string();
                    st.percent = 100;
                    rebuild_step_segments(st);
                }
            }
            guard.is_ready = true;
            guard.is_running = false;
            guard.is_completed = true;
            guard.current_key = "done".to_string();
            guard.current_label = "모든 라이프로그 항목 동기화 확인 완료 (100%)".to_string();
            guard.current_percent = 100;
            return 100;
        } else if was_already_completed {
            // 다른 도메인(문자·통화·카톡 등)에 실제 증분 작업이 있는 세션인 경우에도 이미 0건으로 완료된 도메인은 100%(done) 유지
            guard.session_id = session_id.to_string();
            for st in &mut guard.steps {
                let vol_opt = volumes.iter().find(|(k, _, _, _, _)| k == &st.key);
                let has_work = vol_opt
                    .map(|(_, tc, sc, tb, sb)| *tc > *sc || *tb > *sb)
                    .unwrap_or(false);
                if !has_work && st.status == "done" && st.percent >= 100 {
                    continue;
                }
            }
        } else {
            *guard = default_live_sync_progress();
            guard.session_id = session_id.to_string();
        }
    } else if !session_id.is_empty() && guard.session_id.is_empty() {
        guard.session_id = session_id.to_string();
    }

    guard.is_ready = is_ready;
    guard.is_running = true;
    guard.is_completed = false;
    guard.queued_jobs = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);

    for (norm_key, tc, sc, tb, sb) in volumes {
        if let Some(st) = guard.steps.iter_mut().find(|s| &s.key == norm_key) {
            if *tc == 0 && *tb == 0 && st.status == "done" && st.percent >= 100 {
                continue;
            }
            if *tc > 0 {
                st.total_count = st.total_count.max(*tc);
            }
            if *sc > 0 {
                st.downloaded_count = sc.saturating_sub(st.skipped_count);
            }
            if *tb > 0 {
                st.total_bytes = *tb;
            }
            // session-plan의 synced_bytes는 클라이언트가 집계한 정확한 누적치이므로 워커의 비동기 가산으로 인한 이중 합산(Double-Counting)을 덮어쓰고 보정
            if *tb > 0 || *sb > 0 {
                st.synced_bytes = if st.total_bytes > 0 {
                    (*sb).min(st.total_bytes)
                } else {
                    *sb
                };
            }

            let cur_cnt = st.skipped_count + st.downloaded_count;
            let pct = if st.total_bytes > 0 {
                if st.synced_bytes == 0 {
                    0u32
                } else if st.synced_bytes < st.total_bytes {
                    (((st.synced_bytes as f64 / st.total_bytes as f64) * 100.0).floor() as u32)
                        .clamp(0, 99)
                } else {
                    100u32
                }
            } else if st.total_count > 0 {
                if cur_cnt == 0 {
                    0u32
                } else if cur_cnt < st.total_count {
                    (((cur_cnt as f64 / st.total_count as f64) * 100.0).floor() as u32)
                        .clamp(0, 99)
                } else {
                    100u32
                }
            } else {
                0u32
            };
            st.percent = pct;
            if pct >= 100 && (st.total_bytes > 0 || st.total_count > 0) {
                st.status = "done".to_string();
            } else if pct > 0 || *tc > 0 || *tb > 0 {
                st.status = "running".to_string();
            }
            rebuild_step_segments(st);
        }
    }

    if req_total_bytes > 0 {
        guard.session_total_bytes = req_total_bytes;
    }
    if req_synced_bytes > 0 || guard.session_synced_bytes == 0 {
        guard.session_synced_bytes = if guard.session_total_bytes > 0 {
            req_synced_bytes.min(guard.session_total_bytes)
        } else {
            req_synced_bytes
        };
    }
    if req_total_count > 0 {
        guard.session_total_count = req_total_count;
    }
    if req_synced_count > 0 || guard.session_synced_count == 0 {
        guard.session_synced_count = if guard.session_total_count > 0 {
            req_synced_count.min(guard.session_total_count)
        } else {
            req_synced_count
        };
    }
    recompute_session_totals(&mut guard);

    let overall_pct = if guard.session_total_bytes > 0 {
        if guard.session_synced_bytes == 0 {
            0u32
        } else if guard.session_synced_bytes < guard.session_total_bytes {
            (((guard.session_synced_bytes as f64 / guard.session_total_bytes as f64) * 100.0)
                .floor() as u32)
                .clamp(0, 99)
        } else {
            100u32
        }
    } else if guard.session_total_count > 0 {
        if guard.session_synced_count == 0 {
            0u32
        } else if guard.session_synced_count < guard.session_total_count {
            (((guard.session_synced_count as f64 / guard.session_total_count as f64) * 100.0)
                .floor() as u32)
                .clamp(0, 99)
        } else {
            100u32
        }
    } else {
        guard.current_percent
    };

    if !is_ready {
        guard.current_label = format!(
            "전송 준비 및 초기 동기화 중... ({} / {} [{} / {}개])",
            format_bytes_human(guard.session_synced_bytes),
            format_bytes_human(guard.session_total_bytes),
            guard.session_synced_count,
            guard.session_total_count
        );
    } else if guard.session_total_bytes > 0 {
        guard.current_label = format!(
            "통합 세션 동기화 중 ({} / {} [{} / {}개] · {}%)",
            format_bytes_human(guard.session_synced_bytes),
            format_bytes_human(guard.session_total_bytes),
            guard.session_synced_count,
            guard.session_total_count,
            overall_pct
        );
    }
    guard.current_percent = overall_pct;

    let payload_clone = guard.clone();
    drop(guard);

    LAST_PROGRESS_EMIT_MS.store(
        chrono::Local::now().timestamp_millis(),
        std::sync::atomic::Ordering::Relaxed,
    );
    let _ = app.emit("mobile-sync-progress", &payload_clone);
    overall_pct
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

/// 특정 서비스 단계의 누적 전송 바이트(`synced_bytes`)를 더하고 `(synced_bytes, total_bytes)`를 반환합니다.
pub(crate) fn add_live_service_synced_bytes(service_key: &str, add_bytes: u64) -> (u64, u64) {
    let norm_key = normalize_sync_service_key(service_key);
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    if let Ok(mut guard) = mutex.lock() {
        let mut res = (0, 0);
        if let Some(st) = guard.steps.iter_mut().find(|s| s.key == norm_key) {
            let next_synced = st.synced_bytes.saturating_add(add_bytes);
            st.synced_bytes = if st.total_bytes > 0 {
                next_synced.min(st.total_bytes)
            } else {
                next_synced
            };
            res = (st.synced_bytes, st.total_bytes);
        }
        recompute_session_totals(&mut guard);
        return res;
    }
    (0, 0)
}

/// 모바일 기기가 전체 용량(`total_bytes`) 및 완료 용량(`synced_bytes`)을 선전송하거나 백그라운드 스캔 중 Lazy 갱신할 때
/// 서버 진행률을 실제 바이트 비중(예: 4.5GB 중 8%)으로 정확히 갱신합니다.
pub(crate) fn update_live_service_byte_progress(
    app: &AppHandle,
    service_key: &str,
    synced_bytes: u64,
    total_bytes: u64,
    total_cnt: usize,
    is_lazy_update: bool,
    custom_label: Option<&str>,
) -> u32 {
    let norm_key = normalize_sync_service_key(service_key);
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    let mut guard = match mutex.lock() {
        Ok(g) => g,
        Err(_) => return 0,
    };

    let step_pos = guard
        .steps
        .iter()
        .position(|s| s.key == norm_key)
        .unwrap_or(0);

    let pct = {
        let st = &mut guard.steps[step_pos];
        if !is_lazy_update {
            if total_bytes > 0 {
                st.total_bytes = total_bytes;
            }
            if synced_bytes > 0 || st.synced_bytes == 0 {
                st.synced_bytes = synced_bytes;
            }
            if total_cnt > 0 {
                st.total_count = total_cnt;
            }
        } else {
            if total_bytes > 0 {
                st.total_bytes = st.total_bytes.max(total_bytes);
            }
            if synced_bytes > 0 {
                st.synced_bytes = st.synced_bytes.max(synced_bytes);
            }
            if total_cnt > 0 {
                st.total_count = st.total_count.max(total_cnt);
            }
        }

        let computed_pct = if st.total_bytes > 0 {
            if st.synced_bytes == 0 {
                0u32
            } else if st.synced_bytes < st.total_bytes {
                (((st.synced_bytes as f64 / st.total_bytes as f64) * 100.0).floor() as u32)
                    .clamp(0, 99)
            } else {
                100u32
            }
        } else if st.total_count > 0 {
            let cur = st.skipped_count + st.downloaded_count;
            if cur == 0 {
                0u32
            } else if cur < st.total_count {
                (((cur as f64 / st.total_count as f64) * 100.0).floor() as u32).clamp(0, 99)
            } else {
                100u32
            }
        } else {
            0u32
        };

        st.percent = computed_pct;
        st.status = if computed_pct >= 100 && st.total_bytes > 0 && st.synced_bytes >= st.total_bytes {
            "done".to_string()
        } else {
            "running".to_string()
        };
        rebuild_step_segments(st);
        computed_pct
    };

    recompute_session_totals(&mut guard);

    let q_depth = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
    guard.queued_jobs = q_depth;
    guard.is_running = true;
    guard.is_completed = false;
    guard.current_step_index = step_pos;
    guard.current_key = norm_key.to_string();
    if let Some(lbl) = custom_label {
        guard.current_label = lbl.to_string();
    } else if guard.steps[step_pos].total_bytes > 0 {
        let st = &guard.steps[step_pos];
        guard.current_label = format!(
            "{} ({} / {} · {}%)",
            st.label.trim_end_matches("..."),
            format_bytes_human(st.synced_bytes),
            format_bytes_human(st.total_bytes),
            pct
        );
    }
    guard.current_percent = pct;

    let payload_clone = guard.clone();
    drop(guard);

    LAST_PROGRESS_EMIT_MS.store(
        chrono::Local::now().timestamp_millis(),
        std::sync::atomic::Ordering::Relaxed,
    );
    let _ = app.emit("mobile-sync-progress", &payload_clone);
    pct
}

/// 백그라운드 스레드가 각 단계(알림 -> 문자 -> 통화 -> 카톡 -> 녹음 -> 헬스)를 다운로드·적재할 때
/// 해당 단계의 백분위(%)와 구간 색상(파란색=스킵, 녹색=신규다운로드)을 갱신합니다.
/// (아직 전송되지 않은 다른 단계들을 임의로 100% 완료 처리하지 않으며, 미완료 시 반올림으로 100%가 되는 현상을 차단합니다.)
pub(crate) fn emit_live_service_sync_progress(
    app: &AppHandle,
    service_key: &str,
    current_idx: usize,
    total_cnt: usize,
    skipped_add: usize,
    downloaded_add: usize,
    custom_label: Option<&str>,
) -> u32 {
    let norm_key = normalize_sync_service_key(service_key);
    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    let mut guard = match mutex.lock() {
        Ok(g) => g,
        Err(_) => return 100,
    };

    let prev_key = guard.current_key.clone();
    let step_pos = guard
        .steps
        .iter()
        .position(|s| s.key == norm_key)
        .unwrap_or(0);

    let pct = {
        let st = &mut guard.steps[step_pos];
        if current_idx == 0 {
            if st.skipped_count == 0 && st.downloaded_count == 0 {
                st.total_count = total_cnt;
            } else {
                st.total_count = st.total_count.max(total_cnt);
            }
        } else {
            st.skipped_count += skipped_add;
            st.downloaded_count += downloaded_add;
            st.total_count = st.total_count.max(total_cnt);
        }

        let (eff_cur, eff_tot) = if current_idx == 0 {
            let cur = st.skipped_count + st.downloaded_count;
            (cur, st.total_count.max(cur))
        } else if total_cnt <= 1 && st.total_count > 1 {
            // batch-init 으로 전체 파일 개수(st.total_count)를 먼저 받고, 개별 파일(1, 1)씩 처리하는 경우 (녹음, 헬스 등)
            let cur = st.skipped_count + st.downloaded_count;
            let tot = st.total_count.max(cur);
            st.total_count = tot;
            (cur, tot)
        } else {
            let tot = st.total_count.max(total_cnt).max(current_idx);
            st.total_count = tot;
            (current_idx, tot)
        };

        // 1) 전체 용량(total_bytes)이 파악된 단계(예: 카톡 4.5GB)에서는 실제 수신 바이트 비중을 최우선 적용
        // 2) 그렇지 않은 경우에도 eff_cur < eff_tot 이면 절대로 반올림하여 100%로 표시하지 않고 최대 99%로 제한
        let computed_pct = if st.total_bytes > 0 && st.synced_bytes < st.total_bytes {
            if st.synced_bytes == 0 {
                if eff_tot > 0 && eff_cur > 0 {
                    (((eff_cur as f64 / eff_tot as f64) * 100.0).floor() as u32).clamp(1, 95)
                } else {
                    0u32
                }
            } else {
                (((st.synced_bytes as f64 / st.total_bytes as f64) * 100.0).floor() as u32)
                    .clamp(0, 99)
            }
        } else if eff_tot == 0 {
            0u32
        } else if eff_cur == 0 {
            0u32
        } else if eff_cur < eff_tot {
            (((eff_cur as f64 / eff_tot as f64) * 100.0).floor() as u32).clamp(0, 99)
        } else {
            100u32
        };

        st.percent = computed_pct;
        st.status = if computed_pct >= 100 {
            "done".to_string()
        } else {
            "running".to_string()
        };
        rebuild_step_segments(st);
        computed_pct
    };

    recompute_session_totals(&mut guard);

    let q_depth = SYNC_QUEUE_DEPTH.load(std::sync::atomic::Ordering::Relaxed);
    let active = IS_WORKER_ACTIVE.load(std::sync::atomic::Ordering::Relaxed);
    guard.queued_jobs = q_depth;
    guard.is_running = true;
    guard.is_completed = false;
    guard.current_step_index = step_pos;
    guard.current_key = norm_key.to_string();
    guard.current_label = custom_label
        .map(|s| s.to_string())
        .unwrap_or_else(|| guard.steps[step_pos].label.clone());
    guard.current_percent = pct;

    let payload_clone = guard.clone();
    drop(guard);

    let now_ms = chrono::Local::now().timestamp_millis();
    let last_ms = LAST_PROGRESS_EMIT_MS.load(std::sync::atomic::Ordering::Relaxed);
    let force_emit =
        current_idx == 0 || (q_depth == 0 && !active && pct >= 100) || prev_key != norm_key;
    if force_emit || (now_ms - last_ms) >= 180 {
        LAST_PROGRESS_EMIT_MS.store(now_ms, std::sync::atomic::Ordering::Relaxed);
        let _ = app.emit("mobile-sync-progress", &payload_clone);
    }
    pct
}

/// 서버 기동 시 DB에 보유된 건수만 초기 로드하되, 모바일 기기가 실제로 동기화를 완료(`complete`/`reconcile`)하기 전까지는
/// 가짜 100% 완료 상태를 표시하지 않고 대기 상태(`pending`, 0%)로 초기화합니다.
pub(crate) fn init_sync_progress_from_db(app: &AppHandle, db_path: &Path) {
    let step_keys = [
        "notification",
        "sms",
        "call",
        "kakaotalk",
        "recording",
        "health",
        "photo",
    ];
    let mut db_counts: Vec<(usize, usize)> = vec![(0, 0); step_keys.len()];
    let mut kakao_bytes: (u64, u64) = (0, 0); // (synced_bytes, total_bytes)
    if let Ok(conn) = open_db(db_path) {
        let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
        for (idx, key) in step_keys.iter().enumerate() {
            let (total, recent): (i64, i64) = if *key == "photo" {
                let tot = conn
                    .query_row(
                        "SELECT COUNT(*) FROM media_inbox WHERE status = 'device_photo'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let rec = conn
                    .query_row(
                        "SELECT COUNT(*) FROM media_inbox WHERE status = 'device_photo' AND taken_date >= ?1",
                        params![today_str],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (tot, rec)
            } else {
                let tot = conn
                    .query_row(
                        "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1",
                        params![*key],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let rec = conn
                    .query_row(
                        "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1 AND sent_date >= ?2",
                        params![*key, today_str],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (tot, rec)
            };
            let tot_u = total.max(0) as usize;
            let dl_u = (recent.max(0) as usize).min(tot_u);
            let skip_u = tot_u.saturating_sub(dl_u);
            db_counts[idx] = (skip_u, dl_u);
        }
        if let Ok(raw) = conn.query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'manifest_kakao_rooms'",
            [],
            |r| r.get::<_, String>(0),
        ) {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                let mut tot_b = 0u64;
                let mut syn_b = 0u64;
                for item in arr {
                    let tb = item
                        .get("total_bytes")
                        .or_else(|| item.get("totalBytes"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let sb = item
                        .get("synced_bytes")
                        .or_else(|| item.get("syncedBytes"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    tot_b = tot_b.saturating_add(tb);
                    syn_b = syn_b.saturating_add(sb.min(tb));
                }
                kakao_bytes = (syn_b, tot_b);
            }
        }
    }

    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    if let Ok(mut guard) = mutex.lock() {
        *guard = default_live_sync_progress();
        guard.is_running = false;
        guard.is_completed = false;
        guard.current_step_index = 0;
        guard.current_key = "notification".to_string();
        guard.current_label = "모바일 기기 동기화 대기 중...".to_string();
        guard.current_percent = 0;
        for (idx, st) in guard.steps.iter_mut().enumerate() {
            let (db_sk, db_dl) = db_counts[idx];
            st.status = "pending".to_string();
            st.percent = 0;
            st.skipped_count = db_sk;
            st.downloaded_count = db_dl;
            st.total_count = db_sk + db_dl;
            if st.key == "kakaotalk" && kakao_bytes.1 > 0 {
                st.synced_bytes = kakao_bytes.0;
                st.total_bytes = kakao_bytes.1;
                if kakao_bytes.0 < kakao_bytes.1 {
                    st.percent = (((kakao_bytes.0 as f64 / kakao_bytes.1 as f64) * 100.0).floor()
                        as u32)
                        .clamp(0, 99);
                }
            }
            st.segments.clear();
            if st.percent > 0 {
                rebuild_step_segments(st);
            }
        }
        recompute_session_totals(&mut guard);
        let _ = app.emit("mobile-sync-progress", &*guard);
    }
}

/// 백그라운드 워커 스레드에서 DB의 실제 카테고리별 보유 건수(기보유=파란색 스킵, 당일/신규=녹색 다운로드)를 읽어와
/// 아직 완료되지 않은 모든 단계(알림 -> 문자 -> 통화 -> 카톡 -> 녹음 -> 헬스)를 점검·완료합니다.
/// 단, 전체 용량(`total_bytes`) 대비 미전송 바이트가 남아 있는 단계(예: 카톡 4.5GB 중 8% 완료)는 100%로 강제 덮어쓰지 않고 실제 바이트 진행률을 유지합니다.
pub(crate) fn complete_all_remaining_sync_steps(app: &AppHandle, db_path: &Path, reset_all_first: bool) {
    let step_keys = [
        "notification",
        "sms",
        "call",
        "kakaotalk",
        "recording",
        "health",
        "photo",
    ];
    let mut db_counts: Vec<(usize, usize)> = vec![(0, 0); step_keys.len()];
    let mut kakao_bytes: (u64, u64) = (0, 0);
    if let Ok(conn) = open_db(db_path) {
        let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
        for (idx, key) in step_keys.iter().enumerate() {
            let (total, recent): (i64, i64) = if *key == "photo" {
                let tot = conn
                    .query_row(
                        "SELECT COUNT(*) FROM media_inbox WHERE status = 'device_photo'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let rec = conn
                    .query_row(
                        "SELECT COUNT(*) FROM media_inbox WHERE status = 'device_photo' AND taken_date >= ?1",
                        params![today_str],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (tot, rec)
            } else {
                let tot = conn
                    .query_row(
                        "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1",
                        params![*key],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let rec = conn
                    .query_row(
                        "SELECT COUNT(*) FROM lifelog_messages WHERE source = ?1 AND sent_date >= ?2",
                        params![*key, today_str],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (tot, rec)
            };
            let tot_u = total.max(0) as usize;
            let dl_u = (recent.max(0) as usize).min(tot_u);
            let skip_u = tot_u.saturating_sub(dl_u);
            db_counts[idx] = (skip_u, dl_u);
        }
        if let Ok(raw) = conn.query_row(
            "SELECT value FROM mobile_sync_meta WHERE key = 'manifest_kakao_rooms'",
            [],
            |r| r.get::<_, String>(0),
        ) {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) {
                let mut tot_b = 0u64;
                let mut syn_b = 0u64;
                for item in arr {
                    let tb = item
                        .get("total_bytes")
                        .or_else(|| item.get("totalBytes"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    let sb = item
                        .get("synced_bytes")
                        .or_else(|| item.get("syncedBytes"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    tot_b = tot_b.saturating_add(tb);
                    syn_b = syn_b.saturating_add(sb.min(tb));
                }
                kakao_bytes = (syn_b, tot_b);
            }
        }
    }

    let mutex = LIVE_SYNC_PROGRESS.get_or_init(|| Mutex::new(default_live_sync_progress()));
    if let Ok(mut guard) = mutex.lock() {
        guard.is_running = true;
        guard.is_completed = false;
        for (idx, st) in guard.steps.iter_mut().enumerate() {
            let (db_sk, db_dl) = db_counts[idx];
            if st.key == "kakaotalk" && kakao_bytes.1 > 0 {
                st.total_bytes = st.total_bytes.max(kakao_bytes.1);
                st.synced_bytes = st.synced_bytes.max(kakao_bytes.0);
            }
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
        let (already_done, byte_cap_pct) = {
            if let Ok(guard) = mutex.lock() {
                let st = &guard.steps[step_idx];
                let done = st.status == "done" && st.percent >= 100;
                let cap = if st.total_bytes > 0 && st.synced_bytes < st.total_bytes {
                    Some(
                        (((st.synced_bytes as f64 / st.total_bytes as f64) * 100.0).floor() as u32)
                            .clamp(0, 99),
                    )
                } else {
                    None
                };
                (done && cap.is_none(), cap)
            } else {
                (false, None)
            }
        };
        if already_done {
            continue;
        }

        if let Some(target_pct) = byte_cap_pct {
            if let Ok(mut guard) = mutex.lock() {
                let st = &mut guard.steps[step_idx];
                st.percent = target_pct;
                st.status = "running".to_string();
                rebuild_step_segments(st);
                let _ = app.emit("mobile-sync-progress", &*guard);
            }
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
        let all_done = guard
            .steps
            .iter()
            .all(|s| s.status == "done" && s.percent >= 100);
        guard.is_completed = all_done;
        if all_done {
            guard.current_step_index = guard.total_steps.saturating_sub(1);
            guard.current_key = "done".to_string();
            guard.current_label = "모든 라이프로그 항목 동기화 확인 완료 (100%)".to_string();
            guard.current_percent = 100;
        } else if let Some((idx, inc)) = guard
            .steps
            .iter()
            .enumerate()
            .find(|(_, s)| s.percent < 100)
            .map(|(i, s)| (i, s.clone()))
        {
            guard.current_step_index = idx;
            guard.current_key = inc.key.clone();
            guard.current_percent = inc.percent;
            if inc.total_bytes > 0 {
                guard.current_label = format!(
                    "{} ({} / {} · {}%)",
                    inc.label.trim_end_matches("..."),
                    format_bytes_human(inc.synced_bytes),
                    format_bytes_human(inc.total_bytes),
                    inc.percent
                );
            } else {
                guard.current_label = inc.label.clone();
            }
        }
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
