//! 통화 녹음의 단어 단위 음성인식엔진(`faster-whisper` ASR) + 음성지문(`CAM++`·`ResNet34`) 교차검증 화자 분리,
//! 상대방 음성지문(`contact_*`) 누적 업데이트, A/B/ASR 3종 스크립트 생성 및 의사결재 피드백 처리 모듈.

use crate::*;

/// 통화 오디오 파일을 단어 단위 음성인식엔진(`asr_diarize`) 및 등록된 내 음성지문(`user_server_mic` + `user_sync_mobile`)으로 분석하고,
/// 상대방 발화 구간에서 상대방의 음성지문(`contact_{contact_name}`)을 추출·누적 업데이트하며 `### 음성인식엔진` 스크립트를 반환합니다.
pub(crate) fn analyze_call_with_voiceprint_and_update_counterpart(
    conn: &Connection,
    audio_path: &Path,
    contact_name: &str,
    file_name: &str,
) -> Result<(f64, Vec<(f64, f64, bool)>, String, String), String> {
    let srv_prof = load_voiceprint_profile(conn, "user_server_mic", "내 목소리 지문 (서버 마이크 생성)", "server_mic");
    let sync_prof = load_voiceprint_profile(conn, "user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile");
    let clean_contact = contact_name.trim();
    let contact_pid = format!("contact_{}", sanitize_filename_stem(if clean_contact.is_empty() { "상대방" } else { clean_contact }));
    let contact_prof = load_voiceprint_profile(conn, &contact_pid, &format!("{} 통화 상대방 음성지문", clean_contact), "call_counterpart");

    let extracted = run_dual_model_extractor(audio_path, "asr_diarize", false)?;
    let duration_sec = extracted.duration_sec;

    let calc_my_and_other_sim = |ea: &[f64], eb: &[f64]| -> (f64, f64) {
        let sa_srv = if !srv_prof.embedding_a.is_empty() { cosine_similarity_vec(&srv_prof.embedding_a, ea) } else { 0.0 };
        let sb_srv = if !srv_prof.embedding_b.is_empty() { cosine_similarity_vec(&srv_prof.embedding_b, eb) } else { 0.0 };
        let sa_sy = if !sync_prof.embedding_a.is_empty() { cosine_similarity_vec(&sync_prof.embedding_a, ea) } else { 0.0 };
        let sb_sy = if !sync_prof.embedding_b.is_empty() { cosine_similarity_vec(&sync_prof.embedding_b, eb) } else { 0.0 };
        let my_sim = (sa_srv.max(sa_sy) + sb_srv.max(sb_sy)) * 0.5;
        let other_sim = if !contact_prof.embedding_a.is_empty() && !contact_prof.embedding_b.is_empty() {
            (cosine_similarity_vec(&contact_prof.embedding_a, ea) + cosine_similarity_vec(&contact_prof.embedding_b, eb)) * 0.5
        } else {
            0.0
        };
        (my_sim, other_sim)
    };

    let mut raw_scores: Vec<(f64, f64, f64, f64, Vec<f64>, Vec<f64>)> = Vec::new();
    for seg in &extracted.segments {
        let (my_sim, other_sim) = calc_my_and_other_sim(&seg.embedding_a, &seg.embedding_b);
        raw_scores.push((seg.start_sec, seg.end_sec, my_sim, other_sim, seg.embedding_a.clone(), seg.embedding_b.clone()));
    }

    let mut sorted_sc: Vec<f64> = raw_scores.iter().map(|x| x.2).collect();
    sorted_sc.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_sc = if sorted_sc.is_empty() { 0.48 } else { sorted_sc[sorted_sc.len() / 2] };
    let threshold = median_sc.clamp(0.42, 0.56);

    let mut acoustic_segments: Vec<(f64, f64, bool)> = Vec::new();
    let mut counterpart_embs_a: Vec<Vec<f64>> = Vec::new();
    let mut counterpart_embs_b: Vec<Vec<f64>> = Vec::new();
    let mut my_seg_count = 0usize;
    let mut other_seg_count = 0usize;
    let mut my_sim_sum = 0.0f64;
    let mut other_sim_sum = 0.0f64;

    for (st, en, my_sc, oth_sc, ea, eb) in raw_scores {
        let is_me = if oth_sc > 0.35 && (my_sc - oth_sc).abs() >= 0.05 {
            my_sc > oth_sc
        } else {
            my_sc >= threshold
        };
        acoustic_segments.push((st, en, is_me));
        if is_me {
            my_seg_count += 1;
            my_sim_sum += my_sc;
        } else {
            other_seg_count += 1;
            other_sim_sum += my_sc;
            if ea.len() == 192 && eb.len() == 256 {
                counterpart_embs_a.push(ea);
                counterpart_embs_b.push(eb);
            }
        }
    }

    // 단어 단위 음성인식엔진(`asr_utterances`) + 구간별 성문 직접 매칭으로 `### 음성인식엔진` 스크립트 생성
    let mut asr_lines: Vec<String> = Vec::new();
    let mut prev_asr_spk = String::new();
    let spk_other = if clean_contact.is_empty() { "상대방" } else { clean_contact };
    for utt in &extracted.asr_utterances {
        let txt = utt.text.trim();
        if txt.is_empty() { continue; }
        let (u_my_sim, u_oth_sim) = if !utt.embedding_a.is_empty() && !utt.embedding_b.is_empty() {
            calc_my_and_other_sim(&utt.embedding_a, &utt.embedding_b)
        } else {
            let mid = (utt.start_sec + utt.end_sec) * 0.5;
            let seg_is_me = acoustic_segments.iter().find(|(s, e, _)| mid >= *s - 0.8 && mid <= *e + 0.8).map(|(_, _, m)| *m).unwrap_or(false);
            (if seg_is_me { threshold + 0.06 } else { threshold - 0.06 }, 0.0)
        };
        let utt_is_me = if u_oth_sim > 0.35 && (u_my_sim - u_oth_sim).abs() >= 0.04 {
            u_my_sim >= u_oth_sim
        } else {
            u_my_sim >= threshold
        };
        let acoustic_hint = if utt_is_me { "나" } else { spk_other };
        let verified_spk = resolve_verified_speaker_label(acoustic_hint, txt, spk_other, &prev_asr_spk, Some(utt_is_me));
        prev_asr_spk = verified_spk.clone();

        let sec_u = utt.start_sec.round().max(0.0) as u64;
        let ts = format!("{:02}:{:02}:{:02}", sec_u / 3600, (sec_u % 3600) / 60, sec_u % 60);
        asr_lines.push(format!("- **[{}] {}**: {}", ts, verified_spk, txt));
    }
    let asr_script_md = asr_lines.join("\n");

    if !clean_contact.is_empty() && clean_contact != "알수없음" && !counterpart_embs_a.is_empty() {
        let n_seg = counterpart_embs_a.len() as f64;
        let mut avg_a = vec![0.0f64; 192];
        let mut avg_b = vec![0.0f64; 256];
        for v in &counterpart_embs_a {
            for (i, val) in v.iter().enumerate() { avg_a[i] += val / n_seg; }
        }
        for v in &counterpart_embs_b {
            for (i, val) in v.iter().enumerate() { avg_b[i] += val / n_seg; }
        }
        let (norm_a, _) = l2_normalize_vec(&avg_a);
        let (norm_b, _) = l2_normalize_vec(&avg_b);
        let disp_name = format!("{} 통화 상대방 음성지문", clean_contact);
        let prev = contact_prof;
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let (merged_a, merged_b, next_cnt, con_a, con_b) =
            if prev.sample_count == 0 || prev.embedding_a.len() != 192 || prev.embedding_b.len() != 256 {
                (norm_a, norm_b, 1usize, 88.5, 89.2)
            } else {
                let sa = cosine_similarity_vec(&prev.embedding_a, &norm_a);
                let sb = cosine_similarity_vec(&prev.embedding_b, &norm_b);
                let wp = prev.sample_count as f64;
                let ra: Vec<f64> = prev.embedding_a.iter().zip(norm_a.iter()).map(|(p, n)| (p * wp + n) / (wp + 1.0)).collect();
                let rb: Vec<f64> = prev.embedding_b.iter().zip(norm_b.iter()).map(|(p, n)| (p * wp + n) / (wp + 1.0)).collect();
                let (na, _) = l2_normalize_vec(&ra);
                let (nb, _) = l2_normalize_vec(&rb);
                let cnt = prev.sample_count + 1;
                let ca = (((sa - 0.30) / 0.50).clamp(0.65, 1.0) * 1000.0).round() / 10.0;
                let cb = (((sb - 0.30) / 0.50).clamp(0.65, 1.0) * 1000.0).round() / 10.0;
                (na, nb, cnt, ca, cb)
            };

        let cross_agree = (((con_a + con_b) * 0.5) * 10.0).round() / 10.0;
        let mut metas = prev.samples_meta;
        let other_avg_sim = if other_seg_count > 0 { ((other_sim_sum / other_seg_count as f64) * 1000.0).round() / 10.0 } else { 0.0 };
        metas.push(VoiceprintSampleMeta {
            phrase_text: format!("통화 상대방 발화 {}구간 추출 (전체 {:.1}초 중 나 {}구간 / {} {}구간)", other_seg_count, duration_sec, my_seg_count, clean_contact, other_seg_count),
            source_label: file_name.to_string(),
            duration_sec,
            sim_a: con_a,
            sim_b: other_avg_sim,
            created_at: now_str.clone(),
        });
        if metas.len() > 25 {
            let d = metas.len() - 25;
            metas.drain(0..d);
        }

        let _ = conn.execute(
            "INSERT INTO voiceprint_profiles
             (profile_id, target_type, display_name, source_mode, model_a_name, model_b_name,
              embedding_a_json, embedding_b_json, sample_count, consistency_a, consistency_b,
              cross_agreement_score, samples_meta_json, updated_at)
             VALUES (?1, 'contact', ?2, 'call_counterpart', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(profile_id) DO UPDATE SET
                target_type = 'contact', display_name = excluded.display_name,
                embedding_a_json = excluded.embedding_a_json, embedding_b_json = excluded.embedding_b_json,
                sample_count = excluded.sample_count, consistency_a = excluded.consistency_a,
                consistency_b = excluded.consistency_b, cross_agreement_score = excluded.cross_agreement_score,
                samples_meta_json = excluded.samples_meta_json, updated_at = excluded.updated_at",
            params![
                contact_pid, disp_name, MODEL_A_LABEL, MODEL_B_LABEL,
                serde_json::to_string(&merged_a).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&merged_b).unwrap_or_else(|_| "[]".to_string()),
                next_cnt as i64, con_a, con_b, cross_agree,
                serde_json::to_string(&metas).unwrap_or_else(|_| "[]".to_string()),
                now_str,
            ],
        );
    }

    let dur_u = duration_sec.floor() as u64;
    let dur_hms = format!("{:02}:{:02}:{:02}", dur_u / 3600, (dur_u % 3600) / 60, dur_u % 60);
    let my_avg_pct = if my_seg_count > 0 { (my_sim_sum / my_seg_count as f64) * 100.0 } else { 0.0 };
    let audit_note = format!(
        "원본 오디오 `{}` ({:.1}초) · 단어별 음성인식엔진(ASR {}문장) + 내 음성지문(`CAM++`·`ResNet34`) 일치 {}구간(평균 {:.1}%) vs `{}` {}구간 분리 완료",
        dur_hms, duration_sec, asr_lines.len(), my_seg_count, my_avg_pct, clean_contact, other_seg_count
    );

    Ok((duration_sec, acoustic_segments, asr_script_md, audit_note))
}

/// 기존 `## 📜 스크립트` 본문에서 `### 음성인식엔진`을 제외한 기존 LLM/후처리 섹션들을 삭제하지 않고 그대로 추출합니다.
fn extract_existing_non_asr_sections(orig_script: &str) -> String {
    let trimmed = orig_script.trim();
    if trimmed.is_empty() || trimmed.contains("스크립트 미생성") || trimmed.contains("대기 중입니다") {
        return String::new();
    }
    if let Some(asr_idx) = trimmed.find("### 음성인식엔진") {
        let before = trimmed[..asr_idx].trim().trim_end_matches("---").trim();
        let after_header = &trimmed[asr_idx + "### 음성인식엔진".len()..];
        let next_h3 = after_header.find("\n### ").map(|i| i + 1);
        let after = match next_h3 {
            Some(pos) => after_header[pos..].trim(),
            None => "",
        };
        match (!before.is_empty(), !after.is_empty()) {
            (true, true) => format!("{}\n\n---\n\n{}", before, after),
            (true, false) => before.to_string(),
            (false, true) => after.to_string(),
            (false, false) => String::new(),
        }
    } else if trimmed.contains("### ✨ AI 후처리")
        || trimmed.contains("### 🅰️ 프롬프트 A")
        || trimmed.contains("### 🅱️ 프롬프트 B")
        || trimmed.contains("### 📎 기존 AI 스크립트")
    {
        trimmed.to_string()
    } else if trimmed.contains("- **[") || trimmed.contains("* **[") {
        format!("### 📎 기존 AI 스크립트 (참고용)\n\n{}", trimmed)
    } else {
        String::new()
    }
}

/// 기존 스크립트에서 `### 음성인식엔진` 대사 본문만 추출합니다.
fn extract_asr_only_section(orig_script: &str) -> String {
    let trimmed = orig_script.trim();
    let Some(asr_idx) = trimmed.find("### 음성인식엔진") else {
        return String::new();
    };
    let after_header = &trimmed[asr_idx + "### 음성인식엔진".len()..];
    let body = match after_header.find("\n### ") {
        Some(pos) => &after_header[..pos],
        None => after_header,
    };
    body.trim().trim_end_matches("---").trim().to_string()
}

/// 1단계 전용: 오디오에서 로컬 ASR(`faster-whisper` + 성문 매칭)만 수행하여 `### 음성인식엔진`을 추가/갱신하고,
/// 기존에 LLM이 작성해 둔 스크립트 내용은 삭제하지 않고 그대로 보존합니다.
pub(crate) fn run_call_asr_only_and_preserve_existing(
    conn: &Connection,
    _safe_stem: &str,
    file_stem: &str,
    file_name: &str,
    rec_date: &str,
    rec_time: &str,
    contact_name: &str,
    audio_path: &Path,
    md_path: &Path,
) -> Result<String, String> {
    let (_dur_sec, _acoustic_segs, asr_script_md, audit_note) =
        analyze_call_with_voiceprint_and_update_counterpart(conn, audio_path, contact_name, file_name)?;

    let raw_md = fs::read_to_string(md_path).unwrap_or_default();
    let (_, body) = parse_frontmatter_and_body_simple(&raw_md);
    let (orig_summary, orig_script) = split_summary_and_transcript(&body);

    let preserved_non_asr = extract_existing_non_asr_sections(&orig_script);
    let effective_asr = asr_script_md.trim();

    let final_script_section = if preserved_non_asr.is_empty() {
        format!("### 음성인식엔진\n\n{}", effective_asr)
    } else {
        format!("### 음성인식엔진\n\n{}\n\n---\n\n{}", effective_asr, preserved_non_asr)
    };

    let cleaned_sum_lines: Vec<String> = orig_summary
        .lines()
        .filter(|l| !l.contains("[음성지문·연락처 사전조사 재분석 완료]"))
        .map(|l| l.to_string())
        .collect();
    let existing_sum_body = cleaned_sum_lines.join("\n").trim().to_string();
    let updated_summary = if existing_sum_body.is_empty() {
        format!("- 🎙️ **[음성지문·연락처 사전조사 재분석 완료]**: {}", audit_note)
    } else {
        format!("- 🎙️ **[음성지문·연락처 사전조사 재분석 완료]**: {}\n{}", audit_note, existing_sum_body)
    };

    let merged_transcript = format!(
        "## 💡 요약\n\n{}\n\n## 📜 스크립트\n\n{}",
        updated_summary.trim(),
        final_script_section.trim()
    );

    write_call_recording_markdown(conn, file_name, contact_name, rec_date, rec_time, Some(&merged_transcript), None);
    upsert_single_recording_into_lifelog_db(conn, false, file_stem, contact_name, rec_date, rec_time, Some(&merged_transcript), "", "모바일 통화녹음");
    Ok(merged_transcript)
}

fn extract_h3_section_body(orig_script: &str, h3_prefix: &str) -> String {
    let trimmed = orig_script.trim();
    let Some(idx) = trimmed.find(h3_prefix) else { return String::new() };
    let after_prefix = &trimmed[idx..];
    let line_end = after_prefix.find('\n').unwrap_or(after_prefix.len());
    let after_header = &after_prefix[line_end..];
    let body = match after_header.find("\n### ") {
        Some(pos) => &after_header[..pos],
        None => after_header,
    };
    body.trim().trim_end_matches("---").trim().to_string()
}

/// 2단계→3단계: `### 음성인식엔진`(ASR) 텍스트를 기반으로 AI 후처리를 수행합니다.
/// 기존 후처리본(`### ✨ AI 후처리 스크립트`)이나 사용자 수정본이 있으면 삭제하지 않고 `### 📌 이전 AI 후처리 스크립트 (보관/참고용)`에 보관하며,
/// 이를 참고하여 정확한 ASR 타임스탬프 기준으로 `### ✨ AI 후처리 스크립트`를 재작성합니다.
pub(crate) fn run_call_ai_postprocess_from_asr(
    conn: &Connection,
    safe_stem: &str,
    file_stem: &str,
    file_name: &str,
    rec_date: &str,
    rec_time: &str,
    contact_name: &str,
    audio_path: &Path,
    md_path: &Path,
) -> Result<String, String> {
    run_call_ai_postprocess_from_asr_ext(
        conn, safe_stem, file_stem, file_name, rec_date, rec_time, contact_name, audio_path, md_path, None, None, false,
    )
}

pub(crate) fn run_call_ai_postprocess_from_asr_ext(
    conn: &Connection,
    safe_stem: &str,
    file_stem: &str,
    file_name: &str,
    rec_date: &str,
    rec_time: &str,
    contact_name: &str,
    audio_path: &Path,
    md_path: &Path,
    edited_post_script: Option<&str>,
    user_comment: Option<&str>,
    discard_previous: bool,
) -> Result<String, String> {
    if !md_path.exists() || !fs::read_to_string(md_path).unwrap_or_default().contains("### 음성인식엔진") {
        let _ = run_call_asr_only_and_preserve_existing(
            conn, safe_stem, file_stem, file_name, rec_date, rec_time, contact_name, audio_path, md_path,
        );
    }

    // 만약 과거 버그로 `### 음성인식엔진`의 마지막 타임스탬프가 실제 오디오 길이 대비 65% 미만으로 압축되어 있다면 즉시 시각 복원 수행
    let raw_check = fs::read_to_string(md_path).unwrap_or_default();
    if raw_check.contains("### 📎 기존 AI 스크립트") {
        let re_dur = cached_regex!(r"\(([0-9]+(?:\.[0-9]+)?)초\)");
        let re_ts = cached_regex!(r"\[(\d{2}):(\d{2}):(\d{2})\]");
        if let Some(dc) = re_dur.captures(&raw_check) {
            let dur_s: f64 = dc[1].parse().unwrap_or(0.0);
            let (_, b_chk) = parse_frontmatter_and_body_simple(&raw_check);
            let (_, sc_chk) = split_summary_and_transcript(&b_chk);
            let asr_chk = extract_asr_only_section(&sc_chk);
            let max_asr_s = re_ts
                .captures_iter(&asr_chk)
                .map(|c| {
                    c[1].parse::<u64>().unwrap_or(0) * 3600
                        + c[2].parse::<u64>().unwrap_or(0) * 60
                        + c[3].parse::<u64>().unwrap_or(0)
                })
                .max()
                .unwrap_or(0);
            if dur_s >= 25.0 && (max_asr_s as f64) < dur_s * 0.65 {
                let _ = run_call_asr_partial_reprocess(
                    conn, safe_stem, file_stem, file_name, rec_date, rec_time, contact_name, audio_path, md_path, false,
                );
            }
        }
    }

    let raw_md = fs::read_to_string(md_path).unwrap_or_default();
    let (_, body) = parse_frontmatter_and_body_simple(&raw_md);
    let (orig_summary, orig_script) = split_summary_and_transcript(&body);
    let asr_text = extract_asr_only_section(&orig_script);
    if asr_text.is_empty() {
        return Err("ASR(### 음성인식엔진) 스크립트가 비어 있어 후처리를 진행할 수 없습니다.".to_string());
    }

    // 기존 후처리 결과(또는 사용자가 방금 편집한 후처리본) 추출 -> `discard_previous`가 아닐 때만 `.md` 보관 및 재작성 프롬프트에 주입
    let (preserved_prev_post, legacy_ref_body) = if discard_previous {
        (String::new(), String::new())
    } else {
        let cur_post_body = extract_h3_section_body(&orig_script, "### ✨ AI 후처리");
        let prev_archived_body = extract_h3_section_body(&orig_script, "### 📌 이전 AI 후처리");
        let prev_post = edited_post_script
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if !cur_post_body.is_empty() {
                    cur_post_body
                } else {
                    prev_archived_body
                }
            });
        let leg_body = extract_h3_section_body(&orig_script, "### 📎 기존 AI 스크립트");
        (prev_post, leg_body)
    };

    let clean_comment = user_comment.map(|s| s.trim()).unwrap_or("");
    // 후처리 재시도가 시작되면 우선 2단계(ASR완료·후처리진행중)로 설정하여 결재 목록(3단계)에서 일시 제외
    upsert_call_transcript_meta(conn, safe_stem, 2, clean_comment);

    let user_profile = read_ai_user_profile(conn);
    let combined_profile = match build_contact_ai_context_for_target(conn, contact_name, false) {
        Some(ctx) => format!("{}{}", user_profile, ctx),
        None => user_profile,
    };

    let (user_full_name, user_surname, user_given_name) = resolve_user_identity();
    let prompt_spec_md = apply_user_identity_placeholders(&ensure_or_read_call_postprocess_prompt_md(conn))
        .replace("{COUNTERPART}", contact_name);

    let mut extra_ref_blocks = String::new();
    if !preserved_prev_post.is_empty() {
        extra_ref_blocks.push_str(&format!(
            "\n\n[Reference: Preserved Previous AI Post-Processed Script (### 📌 이전 AI 후처리 스크립트 — 자연스러운 문맥·어휘·화자 분리 및 사용자 수정 내역 참고용. 단, 각 대사의 [HH:MM:SS] 시각은 반드시 위 ### 음성인식엔진 타임라인에 맞출 것!)]\n{}",
            preserved_prev_post
        ));
    }
    if !legacy_ref_body.is_empty() {
        extra_ref_blocks.push_str(&format!(
            "\n\n[Reference: Legacy AI Script (### 📎 기존 AI 스크립트 — 문맥 및 고유명사 참고용)]\n{}",
            legacy_ref_body
        ));
    }
    if !clean_comment.is_empty() {
        extra_ref_blocks.push_str(&format!(
            "\n\n[🔥 Priority User Re-processing Comment / Instruction (사용자 후처리 재작성 코멘트 — 최우선 반영 필수!)]\n{}",
            clean_comment
        ));
    }

    let post_prompt = format!(
        "{spec}\n\n\
         ---\n\
         [Call Metadata]\n\
         - User (`나`): `{u_full}` (Surname/성: `{u_sur}`, Given Name/이름: `{u_giv}`)\n\
         - Counterpart (`{{COUNTERPART}}`): `{contact}`\n\
         - Call Date/Time: `{d} {t}`\n\
         - Speaker labels MUST strictly be `나` or `{contact}`.\n\n\
         [Pre-investigated Contact (`.md` + `## 최근 history` + 2-Hop Group Glossary) & User Context]\n\
         {prof}\n\n\
         [Input ASR + Voiceprint Script (### 음성인식엔진 — Master Timeline)]\n\
         {asr}{extra}",
        spec = prompt_spec_md,
        u_full = user_full_name,
        u_sur = user_surname,
        u_giv = user_given_name,
        contact = contact_name,
        d = rec_date,
        t = rec_time,
        prof = combined_profile,
        asr = asr_text,
        extra = extra_ref_blocks,
    );

    let (ai_summary, ai_script, used_prov) = if let Some((llm_out, prov)) = call_any_text_llm(conn, &post_prompt, 8192) {
        let (s_part, sc_part) = split_summary_and_transcript(&llm_out);
        let clean_sc = sc_part
            .lines()
            .filter(|l| l.trim_start().starts_with("- **[") || l.trim_start().starts_with("* **["))
            .collect::<Vec<&str>>()
            .join("\n");
        if !clean_sc.is_empty() {
            clear_gemini_quota_exhaustion(conn);
            (s_part, clean_sc, prov)
        } else {
            return Err("AI 후처리 응답에서 유효한 대사 라인(`- **[HH:MM:SS] 화자**:`)을 추출하지 못했습니다.".to_string());
        }
    } else {
        return Err("가용한 텍스트 LLM 에이전트 호출에 실패하여 후처리를 보류합니다.".to_string());
    };

    let mut sections: Vec<String> = vec![
        format!("### 음성인식엔진\n\n{}", asr_text.trim()),
        format!("### ✨ AI 후처리 스크립트\n\n{}", ai_script.trim()),
    ];
    if !preserved_prev_post.is_empty() && preserved_prev_post.trim() != ai_script.trim() {
        sections.push(format!(
            "### 📌 이전 AI 후처리 스크립트 (보관/참고용)\n\n{}",
            preserved_prev_post.trim()
        ));
    }
    if !legacy_ref_body.is_empty() {
        sections.push(format!(
            "### 📎 기존 AI 스크립트 (참고용)\n\n{}",
            legacy_ref_body.trim()
        ));
    }
    let final_script_section = sections.join("\n\n---\n\n");

    let audit_line = orig_summary
        .lines()
        .find(|l| l.contains("[음성지문·연락처 사전조사 재분석 완료]"))
        .map(|s| s.to_string())
        .unwrap_or_default();
    let clean_ai_sum = ai_summary
        .lines()
        .filter(|l| !l.contains("[음성지문·연락처 사전조사 재분석 완료]"))
        .collect::<Vec<&str>>()
        .join("\n")
        .trim()
        .to_string();
    let updated_summary = if !audit_line.is_empty() && !clean_ai_sum.is_empty() {
        format!("{}\n{}", audit_line, clean_ai_sum)
    } else if !clean_ai_sum.is_empty() {
        clean_ai_sum
    } else {
        orig_summary
    };

    let merged_transcript = format!(
        "## 💡 요약\n\n{}\n\n## 📜 스크립트\n\n{}",
        updated_summary.trim(),
        final_script_section.trim()
    );

    write_call_recording_markdown(conn, file_name, contact_name, rec_date, rec_time, Some(&merged_transcript), None);
    inject_llm_provider_into_md(md_path, &used_prov);
    // 후처리가 완료되면 즉시 3단계(후처리 완료 · 결재 대기)로 복귀시켜 결재 목록에 다시 올림
    upsert_call_transcript_meta(conn, safe_stem, 3, clean_comment);
    upsert_single_recording_into_lifelog_db(conn, false, file_stem, contact_name, rec_date, rec_time, Some(&merged_transcript), "", "모바일 통화녹음");
    notify_main_process_ai_event(
        "call_transcribed",
        &format!("✨ [후처리 완료 · 결재 대기 복귀] {} ({} {})", contact_name, rec_date, rec_time),
    );

    Ok(merged_transcript)
}

/// 단일 통화 파일에 대해 기존 LLM 스크립트를 보존하면서 `### 음성인식엔진`을 추가하고, 후처리본이 없을 때만 AI 후처리를 수행합니다.
pub(crate) fn build_and_save_call_asr_and_ab_scripts(
    conn: &Connection,
    safe_stem: &str,
    file_stem: &str,
    file_name: &str,
    rec_date: &str,
    rec_time: &str,
    contact_name: &str,
    audio_path: &Path,
    md_path: &Path,
) -> Result<String, String> {
    let cur_raw = if md_path.exists() {
        fs::read_to_string(md_path).unwrap_or_default()
    } else {
        String::new()
    };
    let asr_merged = if cur_raw.contains("### 음성인식엔진") {
        cur_raw
    } else {
        run_call_asr_only_and_preserve_existing(
            conn, safe_stem, file_stem, file_name, rec_date, rec_time, contact_name, audio_path, md_path,
        )?
    };
    if asr_merged.contains("### ✨ AI 후처리") {
        return Ok(asr_merged);
    }
    run_call_ai_postprocess_from_asr(
        conn, safe_stem, file_stem, file_name, rec_date, rec_time, contact_name, audio_path, md_path,
    )
}

/// 결재를 기다리는(2단계 `unverified` 또는 3단계 `needs_revision`) 통화 녹음을 현재 음성지문 및 단어별 ASR 기준으로 재분석합니다.
pub(crate) fn reanalyze_recent_pending_approval_calls_internal(
    conn: &Connection,
    count: usize,
) -> Result<Vec<CallApprovalItem>, String> {
    ensure_default_contact_prompt_slots(conn);
    let contacts_map = load_mobile_contacts_map(conn);
    let calls_dir = get_archive_mobile_dir(conn, "calls");
    let audio_dir = calls_dir.join("audio");

    let mut meta_map: HashMap<String, (u8, String)> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT safe_stem, stage, user_requirement FROM call_transcript_meta") {
        if let Ok(iter) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2).unwrap_or_default()))) {
            for (k, st, req) in iter.flatten() {
                meta_map.insert(k, (st.clamp(1, 4) as u8, req));
            }
        }
    }

    let mut pending_candidates: Vec<(bool, bool, String, String, String, String, String, PathBuf, PathBuf)> = Vec::new();
    if let Ok(entries) = fs::read_dir(&audio_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() { continue; }
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            if !["m4a", "amr", "mp3", "wav", "ogg", "aac"].contains(&ext.as_str()) { continue; }
            let file_name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let file_stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if file_stem.is_empty() { continue; }
            let safe_stem = sanitize_filename_stem(&file_stem);
            let md_path = calls_dir.join(format!("{}.md", safe_stem));
            if !md_path.exists() { continue; }
            let Ok(md_raw) = fs::read_to_string(&md_path) else { continue };
            let (fm, _) = parse_frontmatter_and_body_simple(&md_raw);
            let status_str = fm.get("transcript_status").map(|s| s.as_str()).unwrap_or("");
            let mut stage: u8 = match status_str {
                "unverified" | "completed" => 2,
                "needs_revision" => 3,
                "verified" => 4,
                _ => 1,
            };
            if let Some((m_st, _)) = meta_map.get(&safe_stem) {
                stage = *m_st;
            }
            if stage != 2 && stage != 3 { continue; }
            let is_stage3 = stage == 3;
            let needs_ab = is_stage3
                || !md_raw.contains("### 음성인식엔진")
                || !md_raw.contains("### 🅰️ 프롬프트 A 스크립트")
                || !md_raw.contains("### 🅱️ 프롬프트 B 스크립트");
            let (_contact_name, rec_date, rec_time) = parse_call_audio_filename_meta(&file_stem, &contacts_map);
            pending_candidates.push((is_stage3, needs_ab, rec_date, rec_time, safe_stem, file_stem, file_name, p, md_path));
        }
    }

    pending_candidates.sort_by(|a, b| {
        b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)).then_with(|| b.2.cmp(&a.2)).then_with(|| b.3.cmp(&a.3)).then_with(|| b.4.cmp(&a.4))
    });
    let target_list: Vec<_> = pending_candidates.into_iter().take(count.max(1)).collect();

    for (_is_stage3, _needs_ab, rec_date, rec_time, safe_stem, file_stem, file_name, audio_path, md_path) in target_list {
        let (contact_name, _, _) = parse_call_audio_filename_meta(&file_stem, &contacts_map);
        let _ = build_and_save_call_asr_and_ab_scripts(
            conn, &safe_stem, &file_stem, &file_name, &rec_date, &rec_time, &contact_name, &audio_path, &md_path,
        );
    }

    get_call_approval_items_from_conn(conn)
}

#[tauri::command]
pub(crate) async fn analyze_single_call_asr_and_ab(
    state: State<'_, AppState>,
    room_or_sender: String,
    attachment_uuid: Option<String>,
    mode: Option<String>,
    edit_entries: Option<Vec<UserScriptEditEntry>>,
    edited_post_script: Option<String>,
    user_comment: Option<String>,
) -> Result<DocumentPayload, String> {
    let db_path = state.db_path.clone();
    let eff_mode = mode.unwrap_or_else(|| "both".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        ensure_default_contact_prompt_slots(&conn);
        let contacts_map = load_mobile_contacts_map(&conn);

        let (audio_path, file_name, file_stem, md_path, _) =
            find_call_audio_and_md(&conn, &room_or_sender, attachment_uuid.as_deref())
                .ok_or_else(|| format!("통화 오디오 파일을 찾을 수 없습니다: {}", room_or_sender))?;
        let safe_stem = sanitize_filename_stem(&file_stem);
        let (contact_name, rec_date, rec_time) = parse_call_audio_filename_meta(&file_stem, &contacts_map);

        if let Some(ref edits) = edit_entries {
            if !edits.is_empty() {
                let _ = append_user_postprocess_edit_log_and_evolve_prompt(
                    &conn, &safe_stem, &contact_name, &rec_date, &rec_time, edits,
                );
            }
        }

        match eff_mode.as_str() {
            "asr_only" | "asr_full" => {
                run_call_asr_only_and_preserve_existing(
                    &conn, &safe_stem, &file_stem, &file_name, &rec_date, &rec_time, &contact_name, &audio_path, &md_path,
                )?;
            }
            "asr_time_only" => {
                run_call_asr_partial_reprocess(
                    &conn, &safe_stem, &file_stem, &file_name, &rec_date, &rec_time, &contact_name, &audio_path, &md_path, false,
                )?;
            }
            "asr_time_speaker" => {
                run_call_asr_partial_reprocess(
                    &conn, &safe_stem, &file_stem, &file_name, &rec_date, &rec_time, &contact_name, &audio_path, &md_path, true,
                )?;
            }
            "ai_postprocess" | "ai_postprocess_full" | "ai_postprocess_with_comment" | "ai_postprocess_discard_prev" => {
                let discard_prev = eff_mode == "ai_postprocess_discard_prev";
                run_call_ai_postprocess_from_asr_ext(
                    &conn, &safe_stem, &file_stem, &file_name, &rec_date, &rec_time, &contact_name, &audio_path, &md_path,
                    if discard_prev { None } else { edited_post_script.as_deref() },
                    user_comment.as_deref(),
                    discard_prev,
                )?;
            }
            _ => {
                build_and_save_call_asr_and_ab_scripts(
                    &conn, &safe_stem, &file_stem, &file_name, &rec_date, &rec_time, &contact_name, &audio_path, &md_path,
                )?;
            }
        }
        build_document_payload(&conn, &md_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn reanalyze_recent_pending_approval_calls(
    state: State<'_, AppState>,
    count: Option<usize>,
) -> Result<Vec<CallApprovalItem>, String> {
    let db_path = state.db_path.clone();
    let n = count.unwrap_or(1).clamp(1, 20);
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        reanalyze_recent_pending_approval_calls_internal(&conn, n)?;
        get_call_approval_items_from_conn(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 통화기록 결재 결정(`reanalyze_with_feedback`: 코멘트/수정 저장 후 후처리 재작성 / `approve_and_evolve_prompt`: 4단계 확인 완료)
#[tauri::command]
pub(crate) async fn resolve_call_ab_decision_with_feedback(
    state: State<'_, AppState>,
    safe_stem: String,
    action: String,
    chosen_slot: Option<String>,
    user_feedback: Option<String>,
    edited_script: Option<String>,
) -> Result<Vec<CallApprovalItem>, String> {
    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_arc.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&db_path)?;
        ensure_default_contact_prompt_slots(&conn);

        let clean_stem = sanitize_filename_stem(&safe_stem);
        let calls_dir = get_archive_mobile_dir(&conn, "calls");
        let md_path = calls_dir.join(format!("{}.md", clean_stem));
        if !md_path.exists() {
            return Err(format!("통화 마크다운 파일이 존재하지 않습니다: {}", clean_stem));
        }

        let raw_md = fs::read_to_string(&md_path).map_err(|e| e.to_string())?;
        let (fm, body) = parse_frontmatter_and_body_simple(&raw_md);
        let (orig_summary, orig_script) = split_summary_and_transcript(&body);
        let contacts_map = load_mobile_contacts_map(&conn);
        let (contact_name, rec_date, rec_time) = parse_call_audio_filename_meta(&clean_stem, &contacts_map);
        let audio_file_rel = fm.get("audio_file").cloned().unwrap_or_else(|| format!("audio/{}.m4a", clean_stem));
        let file_name = Path::new(&audio_file_rel)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("{}.m4a", clean_stem));
        let audio_path = calls_dir.join("audio").join(&file_name);

        let raw_choice = chosen_slot.as_deref().unwrap_or("A").trim().to_uppercase();
        let winner_key = if raw_choice == "B" { "B" } else { "A" };
        let fb_str = user_feedback.as_deref().unwrap_or("").trim();
        let orig_post = extract_h3_section_body(&orig_script, "### ✨ AI 후처리");
        let base_asr = extract_asr_only_section(&orig_script);
        let selected_base = if !orig_post.is_empty() { &orig_post } else { &base_asr };

        if action.trim().eq_ignore_ascii_case("reanalyze_with_feedback") {
            if let Some(ref ed) = edited_script {
                let diffs = compute_script_diff_entries(selected_base, ed, &[]);
                if !diffs.is_empty() {
                    let _ = append_user_postprocess_edit_log_and_evolve_prompt(
                        &conn, &clean_stem, &contact_name, &rec_date, &rec_time, &diffs,
                    );
                }
            }
            let _ = run_call_ai_postprocess_from_asr_ext(
                &conn, &clean_stem, &clean_stem, &file_name, &rec_date, &rec_time, &contact_name, &audio_path, &md_path,
                edited_script.as_deref(), Some(fb_str), false,
            );
        } else {
            if let Some(ref ed) = edited_script {
                let diffs = compute_script_diff_entries(selected_base, ed, &[]);
                if !diffs.is_empty() {
                    let _ = append_user_postprocess_edit_log_and_evolve_prompt(
                        &conn, &clean_stem, &contact_name, &rec_date, &rec_time, &diffs,
                    );
                }
            }
            let final_md_body = edited_script
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("## 💡 요약\n\n{}\n\n## 📜 스크립트\n\n{}", orig_summary.trim(), orig_script.trim()));

            write_call_recording_markdown(&conn, &file_name, &contact_name, &rec_date, &rec_time, Some(&final_md_body), None);
            if let Ok(cur_raw) = fs::read_to_string(&md_path) {
                let updated_raw = cur_raw
                    .replace("transcript_status: \"postprocessed\"", "transcript_status: \"verified\"")
                    .replace("transcript_status: \"asr_completed\"", "transcript_status: \"verified\"")
                    .replace("transcript_status: \"unverified\"", "transcript_status: \"verified\"");
                let _ = fs::write(&md_path, updated_raw);
            }
            upsert_call_transcript_meta(&conn, &clean_stem, 4, fb_str);
            let _ = evolve_prompt_slot_with_feedback_or_edit(&conn, winner_key, selected_base, &final_md_body, fb_str);
        }

        drop(_guard);
        get_call_approval_items_from_conn(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn test_voiceprint_verification(
    state: State<'_, AppState>,
    audio_base64: Option<String>,
    file_path: Option<String>,
) -> Result<VoiceprintTestResult, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        let srv_prof = load_voiceprint_profile(&conn, "user_server_mic", "내 목소리 지문 (서버 마이크 생성)", "server_mic");
        let sync_prof = load_voiceprint_profile(&conn, "user_sync_mobile", "내 목소리 지문 (Sync 모바일 연동 생성)", "sync_mobile");
        if srv_prof.embedding_a.is_empty() && sync_prof.embedding_a.is_empty() {
            return Err("먼저 [서버에서 녹음] 또는 [Sync 앱에서 녹음]으로 내 음성지문을 최소 1회 이상 생성해 주세요.".to_string());
        }

        let mut temp_to_clean: Option<PathBuf> = None;
        let (target_path, target_label) = if let Some(fp) = file_path.filter(|s| !s.trim().is_empty()) {
            let p = PathBuf::from(&fp);
            if !p.is_file() {
                return Err(format!("테스트할 오디오 파일이 존재하지 않습니다: {}", fp));
            }
            let lbl = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or(fp);
            (p, lbl)
        } else if let Some(b64) = audio_base64.filter(|s| !s.trim().is_empty()) {
            let clean = b64.split(',').last().unwrap_or(&b64).trim();
            let bytes = base64_decode(clean);
            if bytes.len() < 300 {
                return Err("테스트 오디오 Base64 디코딩 실패 또는 빈 데이터".to_string());
            }
            let tmp_dir = std::env::temp_dir().join("mylore_voiceprint");
            let _ = fs::create_dir_all(&tmp_dir);
            let tp = tmp_dir.join(format!("test_{}.webm", Uuid::new_v4()));
            fs::write(&tp, &bytes).map_err(|e| e.to_string())?;
            temp_to_clean = Some(tp.clone());
            (tp, "실시간 마이크 녹음 테스트".to_string())
        } else {
            return Err("테스트할 오디오 입력이 없습니다.".to_string());
        };

        let extracted = run_dual_model_extractor(&target_path, "diarize_test", false);
        if let Some(tp) = temp_to_clean {
            let _ = fs::remove_file(tp);
        }
        let extracted = extracted?;

        let sim_a_srv = cosine_similarity_vec(&srv_prof.embedding_a, &extracted.embedding_a);
        let sim_b_srv = cosine_similarity_vec(&srv_prof.embedding_b, &extracted.embedding_b);
        let sim_a_sync = cosine_similarity_vec(&sync_prof.embedding_a, &extracted.embedding_a);
        let sim_b_sync = cosine_similarity_vec(&sync_prof.embedding_b, &extracted.embedding_b);

        let best_a = sim_a_srv.max(sim_a_sync);
        let best_b = sim_b_srv.max(sim_b_sync);
        let consensus = ((best_a + best_b) * 0.5 * 1000.0).round() / 10.0;
        let is_me = best_a >= 0.52 && best_b >= 0.52;

        let mut seg_items: Vec<VoiceprintSegmentTestItem> = Vec::new();
        for seg in extracted.segments {
            let sa_srv = cosine_similarity_vec(&srv_prof.embedding_a, &seg.embedding_a);
            let sb_srv = cosine_similarity_vec(&srv_prof.embedding_b, &seg.embedding_b);
            let sa_sy = cosine_similarity_vec(&sync_prof.embedding_a, &seg.embedding_a);
            let sb_sy = cosine_similarity_vec(&sync_prof.embedding_b, &seg.embedding_b);
            let ba = sa_srv.max(sa_sy);
            let bb = sb_srv.max(sb_sy);
            let comb = ((ba + bb) * 0.5 * 1000.0).round() / 10.0;
            let (pass_a, pass_b) = (ba >= 0.50, bb >= 0.50);
            let agreed = pass_a == pass_b;
            let speaker = if pass_a && pass_b {
                "나 (정서현 · 2개 모델 교차검증 일치)".to_string()
            } else if !pass_a && !pass_b {
                "상대방 (타인 · 2개 모델 교차검증 일치)".to_string()
            } else {
                "판정 보류 (모델 간 의견 불일치 · 문맥 위임)".to_string()
            };
            seg_items.push(VoiceprintSegmentTestItem {
                index: seg.index, start_sec: seg.start_sec, end_sec: seg.end_sec,
                sim_a_server: (sa_srv * 1000.0).round() / 10.0,
                sim_b_server: (sb_srv * 1000.0).round() / 10.0,
                sim_a_sync: (sa_sy * 1000.0).round() / 10.0,
                sim_b_sync: (sb_sy * 1000.0).round() / 10.0,
                combined_score: comb, cross_agreed: agreed, predicted_speaker: speaker,
            });
        }

        let verdict_summary = if is_me {
            format!(
                "✅ [교차검증 통과: '나(사용자)' 음성 일치] CAM++ {:.1}% / ResNet34 {:.1}% (합산 {:.1}%)",
                best_a * 100.0, best_b * 100.0, consensus
            )
        } else {
            format!(
                "👤 [상대방 또는 다중 화자 통화] 전체 평균 CAM++ {:.1}% / ResNet34 {:.1}%",
                best_a * 100.0, best_b * 100.0
            )
        };

        Ok(VoiceprintTestResult {
            target_label, duration_sec: extracted.duration_sec,
            whole_sim_a_server: (sim_a_srv * 1000.0).round() / 10.0,
            whole_sim_b_server: (sim_b_srv * 1000.0).round() / 10.0,
            whole_sim_a_sync: (sim_a_sync * 1000.0).round() / 10.0,
            whole_sim_b_sync: (sim_b_sync * 1000.0).round() / 10.0,
            cross_consensus_score: consensus, cross_verified_is_me: is_me,
            verdict_summary, segments: seg_items,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) fn save_voiceprint_raw_json(
    state: State<'_, AppState>,
    profile_id: String,
    raw_json_text: String,
) -> Result<VoiceprintDashboardPayload, String> {
    let conn = open_db(&state.db_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw_json_text).map_err(|e| format!("JSON 문법 오류: {}", e))?;
    let emb_a: Vec<f64> = parsed.get("modelA").and_then(|m| m.get("embedding")).and_then(|a| serde_json::from_value(a.clone()).ok())
        .ok_or_else(|| "JSON 내에 modelA.embedding 배열이 필요합니다.".to_string())?;
    let emb_b: Vec<f64> = parsed.get("modelB").and_then(|m| m.get("embedding")).and_then(|a| serde_json::from_value(a.clone()).ok())
        .ok_or_else(|| "JSON 내에 modelB.embedding 배열이 필요합니다.".to_string())?;

    let (normed_a, _) = l2_normalize_vec(&emb_a);
    let (normed_b, _) = l2_normalize_vec(&emb_b);
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let sample_count = parsed.get("sampleCount").and_then(|v| v.as_i64()).unwrap_or(1).max(1);
    let con_a = parsed.get("consistencyA").and_then(|v| v.as_f64()).unwrap_or(100.0);
    let con_b = parsed.get("consistencyB").and_then(|v| v.as_f64()).unwrap_or(100.0);
    let cross_sc = parsed.get("crossAgreementScore").and_then(|v| v.as_f64()).unwrap_or(100.0);
    let disp_name = parsed.get("displayName").and_then(|v| v.as_str()).unwrap_or("사용자 편집 음성지문");
    let src_mode = if profile_id == "user_sync_mobile" { "sync_mobile" } else { "server_mic" };

    conn.execute(
        "INSERT INTO voiceprint_profiles
         (profile_id, target_type, display_name, source_mode, model_a_name, model_b_name,
          embedding_a_json, embedding_b_json, sample_count, consistency_a, consistency_b,
          cross_agreement_score, samples_meta_json, updated_at)
         VALUES (?1, 'user', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '[]', ?12)
         ON CONFLICT(profile_id) DO UPDATE SET
            display_name = excluded.display_name, embedding_a_json = excluded.embedding_a_json,
            embedding_b_json = excluded.embedding_b_json, sample_count = excluded.sample_count,
            consistency_a = excluded.consistency_a, consistency_b = excluded.consistency_b,
            cross_agreement_score = excluded.cross_agreement_score, updated_at = excluded.updated_at",
        params![
            profile_id, disp_name, src_mode, MODEL_A_LABEL, MODEL_B_LABEL,
            serde_json::to_string(&normed_a).unwrap_or_default(),
            serde_json::to_string(&normed_b).unwrap_or_default(),
            sample_count, con_a, con_b, cross_sc, now_str,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(build_voiceprint_dashboard_payload(&conn))
}

#[tauri::command]
pub(crate) fn reset_voiceprint_profile(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<VoiceprintDashboardPayload, String> {
    let conn = open_db(&state.db_path)?;
    if profile_id == "all" {
        let _ = conn.execute("DELETE FROM voiceprint_profiles", []);
    } else {
        let _ = conn.execute("DELETE FROM voiceprint_profiles WHERE profile_id = ?1", params![profile_id]);
    }
    Ok(build_voiceprint_dashboard_payload(&conn))
}

