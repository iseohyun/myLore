//! 동기화 워커 작업: 연락처 / 앱 사용량 (백그라운드 메타데이터).

use crate::*;

/// `SyncWorkerJob::Contacts` 처리
pub(crate) fn handle_contacts_job(
    conn: &Connection,
    md_coalesced: &mut MdCoalesced,
    job: SyncWorkerJob,
) {
    let SyncWorkerJob::Contacts { dev_id, items } = job else {
        return;
    };
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut max_ts = 0i64;
    for (name, phones, org, memo, ts) in items {
        if ts > max_ts {
            max_ts = ts;
        }
        let phone_joined = phones.join(", ");
        let md_line = format!(
            "- **{}** | 전화: `{}`{}{}",
            name,
            phone_joined,
            if org.is_empty() {
                String::new()
            } else {
                format!(" | 소속: {}", org)
            },
            if memo.is_empty() {
                String::new()
            } else {
                format!(" | 메모: {}", memo)
            }
        );
        md_coalesced
            .entry((
                "contacts".to_string(),
                "연락처_주소록".to_string(),
                "[스마트폰 연락처/주소록] 통합 목록".to_string(),
                "[\"연락처\", \"주소록\", \"전화번호\", \"전화번호부\", \"지인\"]".to_string(),
            ))
            .or_default()
            .push((today_str.clone(), md_line));
    }
    if max_ts > 0 {
        set_meta_i64_max(&conn, "last_contact_ts", max_ts);
        if !dev_id.is_empty() {
            let _ = conn.execute(
                "UPDATE paired_devices SET last_contact_ts = MAX(COALESCE(last_contact_ts, 0), ?1) WHERE device_id = ?2",
                params![max_ts, dev_id],
            );
        }
    }
}

/// `SyncWorkerJob::AppUsage` 처리
pub(crate) fn handle_app_usage_job(
    conn: &Connection,
    md_coalesced: &mut MdCoalesced,
    job: SyncWorkerJob,
) {
    let SyncWorkerJob::AppUsage { dev_id, items } = job else {
        return;
    };
    let mut max_ts = 0i64;
    for (date_str, pkg, app_name, fg_ms, launch_count, last_used) in items {
        if last_used > max_ts {
            max_ts = last_used;
        }
        let mins = fg_ms / 60_000;
        let secs = (fg_ms % 60_000) / 1000;
        let ym = if date_str.len() >= 7 {
            &date_str[..7]
        } else {
            "2026-10"
        };
        let md_line = format!(
            "- **{}** (`{}`): 사용시간 **{}분 {}초** (실행 {}회)",
            app_name, pkg, mins, secs, launch_count
        );
        md_coalesced
            .entry((
                "usage".to_string(),
                format!("{}_휴대폰사용량", ym),
                format!("[휴대폰 사용량/스크린타임] {}", ym),
                "[\"휴대폰사용량\", \"사용시간\", \"스크린타임\", \"앱사용시간\", \"디지털웰빙\"]"
                    .to_string(),
            ))
            .or_default()
            .push((date_str, md_line));
    }
    if max_ts > 0 {
        set_meta_i64_max(&conn, "last_usage_ts", max_ts);
        if !dev_id.is_empty() {
            let _ = conn.execute(
                "UPDATE paired_devices SET last_usage_ts = MAX(COALESCE(last_usage_ts, 0), ?1) WHERE device_id = ?2",
                params![max_ts, dev_id],
            );
        }
    }
}
