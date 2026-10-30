//! 가계부: 금융 거래 조회, 알림 문자 파싱, 엑셀 행 가져오기.

use crate::*;

#[tauri::command]
pub(crate) fn get_all_finance_transactions(state: State<AppState>) -> Result<Vec<FinanceTransaction>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key
             FROM finance_transactions ORDER BY tx_date DESC, tx_time DESC, id DESC LIMIT 300",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(FinanceTransaction {
                id: r.get(0)?,
                tx_date: r.get(1)?,
                tx_time: r.get(2)?,
                institution: r.get(3)?,
                tx_type: r.get(4)?,
                amount: r.get(5)?,
                merchant: r.get(6)?,
                category: r.get(7)?,
                memo: r.get(8)?,
                verify_status: r.get(9)?,
                dedup_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[tauri::command]
pub(crate) fn parse_notification_into_finance(
    state: State<AppState>,
    package_name: String,
    title: String,
    text: String,
    date_str: String,
    time_str: String,
) -> Result<Option<FinanceTransaction>, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let amt_re = cached_regex!(r"([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)원");
    let mut amount: i64 = 0;
    if let Some(cap) = amt_re.captures(&text) {
        if let Some(m) = cap.get(1) {
            amount = m.as_str().replace(',', "").parse::<i64>().unwrap_or(0);
        }
    }
    if amount <= 0 {
        return Ok(None);
    }

    let institution = if title.contains("신한") {
        "신한카드".to_string()
    } else if title.contains("국민") || title.contains("KB") {
        "KB국민".to_string()
    } else if title.contains("현대") {
        "현대카드".to_string()
    } else {
        package_name
    };

    let merchant_re = cached_regex!(r"원\s+([^\s0-9/]+)");
    let merchant = merchant_re
        .captures(&text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| text.clone());

    let dedup_raw = format!("{}|{}|{}", date_str, amount, merchant);
    let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

    conn.execute(
        "INSERT OR IGNORE INTO finance_transactions
         (tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key)
         VALUES (?1, ?2, ?3, 'expense', ?4, ?5, '미분류', '모바일 실시간 알림 자동 적재', 'realtime', ?6)",
        params![date_str, time_str, institution, amount, merchant, dedup_key],
    )
    .map_err(|e| e.to_string())?;

    let tx = conn
        .query_row(
            "SELECT id, tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key
             FROM finance_transactions WHERE dedup_key = ?1",
            params![dedup_key],
            |r| {
                Ok(FinanceTransaction {
                    id: r.get(0)?,
                    tx_date: r.get(1)?,
                    tx_time: r.get(2)?,
                    institution: r.get(3)?,
                    tx_type: r.get(4)?,
                    amount: r.get(5)?,
                    merchant: r.get(6)?,
                    category: r.get(7)?,
                    memo: r.get(8)?,
                    verify_status: r.get(9)?,
                    dedup_key: r.get(10)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(tx)
}

#[tauri::command]
pub(crate) fn import_finance_rows(
    state: State<AppState>,
    rows: Vec<FinanceImportRow>,
) -> Result<FinanceImportSummary, String> {
    let _guard = state.lock.lock().map_err(|e| e.to_string())?;
    let conn = open_db(&state.db_path)?;

    let mut inserted_new = 0usize;
    let mut reconciled_existing = 0usize;
    let mut skipped_duplicate = 0usize;

    for row in rows {
        let existing_match: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, verify_status FROM finance_transactions
                 WHERE tx_date = ?1 AND amount = ?2 AND (merchant = ?3 OR instr(merchant, ?3) > 0 OR instr(?3, merchant) > 0)
                 LIMIT 1",
                params![row.tx_date, row.amount, row.merchant],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .unwrap_or(None);

        if let Some((existing_id, status)) = existing_match {
            if status == "realtime" {
                conn.execute(
                    "UPDATE finance_transactions SET verify_status = 'verified', category = ?1, memo = '실시간 알림 + 엑셀 명세서 대조 확정' WHERE id = ?2",
                    params![row.category, existing_id],
                )
                .map_err(|e| e.to_string())?;
                reconciled_existing += 1;
            } else {
                skipped_duplicate += 1;
            }
            continue;
        }

        let dedup_raw = format!("{}|{}|{}", row.tx_date, row.amount, row.merchant);
        let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();
        let verify_status = if row.source == "realtime" {
            "realtime"
        } else {
            "excel_only"
        };

        let affected = conn
            .execute(
                "INSERT OR IGNORE INTO finance_transactions
                 (tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    row.tx_date,
                    row.tx_time,
                    row.institution,
                    row.tx_type,
                    row.amount,
                    row.merchant,
                    row.category,
                    row.memo,
                    verify_status,
                    dedup_key
                ],
            )
            .map_err(|e| e.to_string())?;

        if affected > 0 {
            inserted_new += 1;
        } else {
            skipped_duplicate += 1;
        }
    }

    Ok(FinanceImportSummary {
        inserted_new,
        reconciled_existing,
        skipped_duplicate,
    })
}

pub(crate) fn try_insert_finance_from_mobile_text(
    conn: &Connection,
    pkg_or_addr: &str,
    title: &str,
    text: &str,
    date_str: &str,
    time_str: &str,
    source_label: &str,
) -> bool {
    let combined = format!("{} {} {}", pkg_or_addr, title, text);
    let combined_lower = combined.to_lowercase();
    let finance_keywords = [
        "카드", "은행", "뱅크", "페이", "승인", "결제", "입금", "출금", "일시불", "할부", "체크",
        "신한", "국민", "kb", "현대", "삼성", "우리", "하나", "농협", "nh", "카카오뱅크", "토스",
        "shcard", "kbcard", "hyundaicard", "samsungcard", "woori", "hana", "kakaobank", "toss",
        "payco", "1588", "1577", "1544", "1644",
    ];
    if !finance_keywords.iter().any(|k| combined_lower.contains(k)) {
        return false;
    }

    let amt_re = cached_regex!(r"([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s*원");
    let mut amount: i64 = 0;
    if let Some(cap) = amt_re.captures(&combined) {
        if let Some(m) = cap.get(1) {
            amount = m.as_str().replace(',', "").parse::<i64>().unwrap_or(0);
        }
    }
    if amount <= 0 {
        return false;
    }

    let institution = if combined.contains("신한") || combined_lower.contains("shcard") {
        "신한카드".to_string()
    } else if combined.contains("국민") || combined.contains("KB") || combined_lower.contains("kbcard") {
        "KB국민".to_string()
    } else if combined.contains("현대") || combined_lower.contains("hyundaicard") {
        "현대카드".to_string()
    } else if combined.contains("삼성") || combined_lower.contains("samsungcard") {
        "삼성카드".to_string()
    } else if combined.contains("우리") || combined_lower.contains("woori") {
        "우리카드/은행".to_string()
    } else if combined.contains("하나") || combined_lower.contains("hana") {
        "하나카드/은행".to_string()
    } else if combined.contains("농협") || combined.contains("NH") {
        "NH농협".to_string()
    } else if combined.contains("카카오뱅크") || combined_lower.contains("kakaobank") {
        "카카오뱅크".to_string()
    } else if combined.contains("토스") || combined_lower.contains("toss") {
        "토스뱅크/페이".to_string()
    } else if !title.trim().is_empty() {
        title.trim().to_string()
    } else {
        pkg_or_addr.to_string()
    };

    let tx_type = if combined.contains("입금") {
        "income"
    } else {
        "expense"
    };

    let merchant_re = cached_regex!(r"원\s+([^\s0-9/]+)");
    let merchant = merchant_re
        .captures(text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| {
            let clean = text.replace('\n', " ").trim().to_string();
            if clean.chars().count() > 28 {
                clean.chars().take(28).collect()
            } else {
                clean
            }
        });

    let dedup_raw = format!("{}|{}|{}", date_str, amount, merchant);
    let dedup_key = blake3::hash(dedup_raw.as_bytes()).to_hex().to_string();

    let affected = conn
        .execute(
            "INSERT OR IGNORE INTO finance_transactions
             (tx_date, tx_time, institution, tx_type, amount, merchant, category, memo, verify_status, dedup_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '미분류', ?7, 'realtime', ?8)",
            params![
                date_str,
                time_str,
                institution,
                tx_type,
                amount,
                merchant,
                source_label,
                dedup_key
            ],
        )
        .unwrap_or(0);

    affected > 0
}
