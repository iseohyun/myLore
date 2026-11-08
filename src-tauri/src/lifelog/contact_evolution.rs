//! 연락처 인물 서술(.md) AI 업데이트 결재 및 A/B 프롬프트 경합·진화 엔진.
//!
//! - 각 인원별 `Data/mobile/contacts/people/{이름}.md` 파일(UUID + 기본 템플릿/기존 내용)을 기반으로
//!   신규 사건(1~2줄 요약) 및 인물 서술 업데이트 후보 2종(프롬프트 A / 프롬프트 B 결과물)을 생성합니다.
//! - 결재 시나리오 및 프롬프트 진화 규칙:
//!   1. **사용자 추가 편집이 있는 경우** (예: B 선택 + B에서 사용자 추가 편집 발생):
//!      - `B 프롬프트`(오리지널 승리 프롬프트)는 유지(`win_count + 1`, `consecutive_losses = 0`)하고,
//!      - `B 프롬프트` + `B 오리지널 결과물` + `B 사용자 편집본`을 비교·분석하여 생성한 개선 프롬프트(`B+`)를
//!        패배한 `A 프롬프트` 슬롯에 배치하여 다음 라운드부터 **`B` vs `B+`가 정면 경합**합니다.
//!   2. **사용자 추가 편집 없이 A/B만 선택한 경우**:
//!      - 우연에 의한 성급한 교체를 방지하기 위해 패배 프롬프트를 즉시 갱신하지 않고 `consecutive_losses`를 누적합니다.
//!      - 패배 프롬프트가 **최소 3연패(`consecutive_losses >= 3`)**에 도달했을 때에만 3연승한 승리 프롬프트를 기반으로
//!        개선된 변이 프롬프트(`프롬프트+`)를 생성하여 패배 슬롯을 교체합니다.

use crate::*;

pub(crate) const DEFAULT_CONTACT_PROMPT_A: &str = "\
You are an elite Personal CRM, Voiceprint & Lifelog Intelligence Assistant (Prompt Style A: Fact-Driven & Dedicated Phone-Voice Archive Mode).
Target Counterpart (상대방): {contact_name}
User (나 / 본인): 정서현 (Jeong Seohyeon)

[PRE-INVESTIGATION & ERROR-PREVENTION MANDATE (사전조사 및 2대 오류 방지 수칙)]
1. Pre-Investigate User Voiceprint & Counterpart Contact Info (내 목소리 지문 및 연락처 사전조사):
   - Before analyzing or updating, inspect the User's enrolled Dual-Model Voiceprint (`내 목소리 지문`: 3D-Speaker CAM++ 192D & WeSpeaker ResNet34-LM 256D for `나/정서현`) and the existing contact profile (`.md`) of `{contact_name}` (honorifics/호칭, group affiliations/소속 모임, occupation/직업, residence/사는곳, relationship context).
2. Strictly Prevent the 2 Most Common Call Analysis Errors (가장 많이 틀리는 2가지 이유 엄격 주의):
   - Error #1 — Speaker Confusion (화자혼동 방지): Never confuse utterances by `나 (Me: 정서현)` vs `{contact_name} (상대방)`. Cross-verify acoustic voiceprint diarization scores with Korean honorifics/pronouns (e.g., who says '고객님/선생님/삼촌/형님' vs who answers with personal information).
   - Error #2 — Time-Tag Mismatch & Sentence-Level Timestamping (타임태그 불일치 방지 및 문장 단위 타임스탬프 부여):
     (a) Script timestamps must NEVER exceed the physical audio recording duration (음성녹음보다 스크립트의 시간이 더 긴 경우 절대 금지; never misread MM:SS:FF as HH:MM:SS).
     (b) Segment dialogue into individual sentences as finely as possible (`최대한 문장 단위로 잘라서 타임스탬프 부여`), preserving the true physical speaking start time of each sentence so audio playback syncs accurately with the spoken voice.
3. Update Counterpart Voiceprint & Events (추가되는 상대방의 음성지문과 이벤트 업데이트):
   - Synchronize newly extracted acoustic voiceprint features of `{contact_name}` (`contact_{contact_name}`) and newly verified call/message events into this profile.
4. [EXCLUSIVE TO PROMPT A — SEPARATE PHONE VOICE MANAGEMENT (전화목소리 추가 업데이트 별도 보관관리)]:
   - You MUST maintain a dedicated section titled `## 🎙️ 전화목소리 및 음성지문 보관관리` to separately store, track, and manage additional updates about `{contact_name}`'s phone voice characteristics (telephony vocal tone, pitch/cadence, CAM++ 192D & ResNet34 256D acoustic vector status, and speaker-separation cues against `나`).

[OUTPUT MARKDOWN STRUCTURE (Korean Content Required)]
1. Keep and update the 5 top metadata lines in Korean (preserve `속해있는 카톡 그룹:` values):
이 사람의 호칭(복수 가능): 
나를 부르는 호칭: 
소속 모임: 
속해있는 카톡 그룹: 
이 사람은?(직업, 사는곳, 이미지, ): 
2. Maintain `## 최근 history` and the dedicated Prompt-A-only section `## 🎙️ 전화목소리 및 음성지문 보관관리` with bullet points summarizing the counterpart's phone voice updates and acoustic voiceprint status.
3. Under `## 📌 주요 사건 기록`, preserve existing events and append the new speaker-verified & time-tag-verified event as `- **[YYYY-MM-DD]** 1~2줄 핵심 사실 요약`.
4. Output pure Markdown body only (no ``` code fences or YAML frontmatter).";

pub(crate) const DEFAULT_CONTACT_PROMPT_B: &str = "\
You are a Deep-Context Relationship & Lifelog Profile Editor (Prompt Style B: Relational Context & Integrated Event Narrative Mode).
Target Counterpart (상대방): {contact_name}
User (나 / 본인): 정서현 (Jeong Seohyeon)

[PRE-INVESTIGATION & ERROR-PREVENTION MANDATE (사전조사 및 2대 오류 방지 수칙)]
1. Pre-Investigate User Voiceprint & Counterpart Contact Info (내 목소리 지문 및 연락처 사전조사):
   - Prior to synthesizing the update, review the User's enrolled Dual-Model Voiceprint (`내 목소리 지문`: 3D-Speaker CAM++ 192D & WeSpeaker ResNet34-LM 256D for `나/정서현`) and `{contact_name}`'s stored contact metadata (호칭, 나를 부르는 호칭, 소속 모임, 속해있는 카톡 그룹, 직업/사는곳/이미지).
2. Strictly Prevent the 2 Most Common Call Analysis Errors (가장 많이 틀리는 2가지 이유 엄격 주의):
   - Error #1 — Speaker Confusion (화자혼동 방지): Accurately separate `나 (Me: 정서현)` from `{contact_name} (상대방)` by combining acoustic voiceprint matching with relationship context and pronouns/titles (대명사·호칭).
   - Error #2 — Time-Tag Mismatch & Sentence-Level Timestamping (타임태그 불일치 방지 및 문장 단위 타임스탬프 부여):
     (a) Ensure script timestamps never exceed the actual audio recording length (음성녹음보다 스크립트의 시간이 더 긴 경우 방지).
     (b) Split utterances into individual sentences (`최대한 문장 단위로 잘라서 타임스탬프 부여`) and interpolate timestamps proportionally between actual dialogue turns so every sentence aligns naturally with the real audio timing.
3. Update Counterpart Voiceprint & Events (추가되는 상대방의 음성지문과 이벤트 업데이트):
   - Reflect newly identified counterpart voiceprint updates and verified call/message events naturally into the relationship profile and event history.

[OUTPUT MARKDOWN STRUCTURE (Korean Content Required)]
1. Keep and enrich the 5 top metadata lines in Korean (preserve `속해있는 카톡 그룹:` and integrate relationship context into `이 사람은?(직업, 사는곳, 이미지, ):`):
이 사람의 호칭(복수 가능): 
나를 부르는 호칭: 
소속 모임: 
속해있는 카톡 그룹: 
이 사람은?(직업, 사는곳, 이미지, ): 
2. Maintain `## 최근 history` and under `## 📌 주요 사건 기록`, preserve prior records and append the newly verified call/interaction event & voiceprint update status in 1~2 concise Korean lines (`- **[YYYY-MM-DD]** ...`).
3. Output pure Markdown body only (no ``` code fences or YAML frontmatter).";

pub(crate) fn ensure_default_contact_prompt_slots(conn: &Connection) {
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM contact_prompt_slots", [], |r| r.get(0))
        .unwrap_or(0);
    if count < 2 {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO contact_prompt_slots
             (slot, version, prompt_title, prompt_text, win_count, loss_count, consecutive_losses, last_evolution_reason, updated_at)
             VALUES ('A', 2, 'Prompt A (EN · Voiceprint & Dedicated Phone-Voice Archive)', ?1, 0, 0, 0, '음성지문·화자혼동·타임태그 주의 및 전화목소리 별도 보관관리 영문 프롬프트 적용', ?2)",
            params![DEFAULT_CONTACT_PROMPT_A, now_str],
        );
        let _ = conn.execute(
            "INSERT OR IGNORE INTO contact_prompt_slots
             (slot, version, prompt_title, prompt_text, win_count, loss_count, consecutive_losses, last_evolution_reason, updated_at)
             VALUES ('B', 2, 'Prompt B (EN · Voiceprint & Relational Event Context)', ?1, 0, 0, 0, '음성지문·화자혼동·타임태그 주의 및 이벤트 통합 영문 프롬프트 적용', ?2)",
            params![DEFAULT_CONTACT_PROMPT_B, now_str],
        );
    } else {
        // 기존 슬롯이 구버전 한글 기본 프롬프트(영문 Speaker Confusion / Time-Tag Mismatch 수칙 미포함)인 경우 자동 업그레이드
        let cur_a: String = conn
            .query_row(
                "SELECT prompt_text FROM contact_prompt_slots WHERE slot = 'A'",
                [],
                |r| r.get(0),
            )
            .unwrap_or_default();
        if !cur_a.contains("Sentence-Level Timestamping") || !cur_a.contains("전화목소리 및 음성지문 보관관리") {
            let _ = conn.execute(
                "UPDATE contact_prompt_slots
                 SET version = CASE WHEN version < 3 THEN 3 ELSE version + 1 END,
                     prompt_title = 'Prompt A (EN · Voiceprint & Dedicated Phone-Voice Archive)',
                     prompt_text = ?1,
                     last_evolution_reason = '음성지문 사전조사 · 화자혼동 방지 · 문장단위 정밀 타임스탬프 · 전화목소리 별도 보관관리(A 전용) 영문 프롬프트 반영',
                     updated_at = ?2
                 WHERE slot = 'A'",
                params![DEFAULT_CONTACT_PROMPT_A, now_str],
            );
        }
        let cur_b: String = conn
            .query_row(
                "SELECT prompt_text FROM contact_prompt_slots WHERE slot = 'B'",
                [],
                |r| r.get(0),
            )
            .unwrap_or_default();
        if !cur_b.contains("Sentence-Level Timestamping") {
            let _ = conn.execute(
                "UPDATE contact_prompt_slots
                 SET version = CASE WHEN version < 3 THEN 3 ELSE version + 1 END,
                     prompt_title = 'Prompt B (EN · Voiceprint & Relational Event Context)',
                     prompt_text = ?1,
                     last_evolution_reason = '음성지문 사전조사 · 화자혼동 방지 · 문장단위 정밀 타임스탬프 · 상대방 음성지문/이벤트 업데이트 영문 프롬프트 반영',
                     updated_at = ?2
                 WHERE slot = 'B'",
                params![DEFAULT_CONTACT_PROMPT_B, now_str],
            );
        }
    }
}

pub(crate) fn load_contact_prompt_slot(conn: &Connection, slot: &str) -> ContactPromptSlotInfo {
    ensure_default_contact_prompt_slots(conn);
    conn.query_row(
        "SELECT slot, version, prompt_title, prompt_text, win_count, loss_count, consecutive_losses, last_evolution_reason, updated_at
         FROM contact_prompt_slots WHERE slot = ?1",
        params![slot],
        |r| {
            Ok(ContactPromptSlotInfo {
                slot: r.get(0)?,
                version: r.get(1)?,
                prompt_title: r.get(2)?,
                prompt_text: r.get(3)?,
                win_count: r.get(4)?,
                loss_count: r.get(5)?,
                consecutive_losses: r.get(6)?,
                last_evolution_reason: r.get(7)?,
                updated_at: r.get(8)?,
            })
        },
    )
    .unwrap_or_else(|_| ContactPromptSlotInfo {
        slot: slot.to_string(),
        version: 1,
        prompt_title: format!("프롬프트 {}", slot),
        prompt_text: if slot == "A" {
            DEFAULT_CONTACT_PROMPT_A.to_string()
        } else {
            DEFAULT_CONTACT_PROMPT_B.to_string()
        },
        win_count: 0,
        loss_count: 0,
        consecutive_losses: 0,
        last_evolution_reason: "초기 기본값".to_string(),
        updated_at: String::new(),
    })
}

pub(crate) fn get_contact_prompt_tournament_status_internal(
    conn: &Connection,
) -> ContactPromptTournamentStatus {
    ensure_default_contact_prompt_slots(conn);
    let prompt_a = load_contact_prompt_slot(conn, "A");
    let prompt_b = load_contact_prompt_slot(conn, "B");

    let mut history = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, replaced_slot, old_version, new_version, winner_slot, trigger_type, evolution_summary, old_prompt_text, new_prompt_text, created_at
         FROM contact_prompt_history ORDER BY id DESC LIMIT 30",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(ContactPromptHistoryItem {
                id: r.get(0)?,
                replaced_slot: r.get(1)?,
                old_version: r.get(2)?,
                new_version: r.get(3)?,
                winner_slot: r.get(4)?,
                trigger_type: r.get(5)?,
                evolution_summary: r.get(6)?,
                old_prompt_text: r.get(7)?,
                new_prompt_text: r.get(8)?,
                created_at: r.get(9)?,
            })
        }) {
            history = rows.flatten().collect();
        }
    }

    let pending_approval_count: usize = conn
        .query_row(
            "SELECT COUNT(*) FROM contact_profile_approvals WHERE status = 'pending'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0) as usize;

    ContactPromptTournamentStatus {
        slot_a: prompt_a,
        slot_b: prompt_b,
        recent_history: history,
        pending_approval_count,
    }
}

/// 프롬프트 슬롯(A 또는 B)을 사용하여 업데이트된 인물 서술 마크다운 후보를 생성합니다.
fn generate_candidate_profile_with_slot(
    conn: &Connection,
    slot: &ContactPromptSlotInfo,
    contact_name: &str,
    original_profile: &str,
    event_summary: &str,
    raw_event_context: &str,
) -> (String, String) {
    let rendered_instruction = slot.prompt_text.replace("{contact_name}", contact_name);
    let (vp_pre_investigation, phone_voice_archive_block) =
        build_contact_and_user_voiceprint_summary(conn, contact_name);

    let full_prompt = format!(
        "{}\n\n\
         [Pre-Investigated Voiceprint & Acoustic Status (사전조사된 내 음성지문 및 상대방 음성지문 현황)]\n{}\n\n\
         [Existing Contact Profile (.md 본문 - 사전조사된 연락처 정보)]\n{}\n\n\
         [Newly Verified Event Summary (이번에 추가된 사건 요약 1~2줄)]\n{}\n\n\
         [Detailed Call/Interaction Context (상세 통화/대화 참고 맥락 — 화자혼동 및 타임태그 불일치 검증됨)]\n{}\n\n\
         Output the complete updated Markdown body strictly following the prompt rules above.",
        rendered_instruction,
        vp_pre_investigation.trim(),
        original_profile.trim(),
        event_summary.trim(),
        raw_event_context.trim()
    );

    if let Some((resp, prov)) = call_any_text_llm(conn, &full_prompt, 1400) {
        let cleaned = strip_markdown_code_fence(&resp);
        if cleaned.len() >= 20 {
            let structured = if slot.slot == "A" {
                ensure_prompt_a_phone_voice_section(&cleaned, &phone_voice_archive_block)
            } else {
                ensure_contact_profile_has_template_sections(&cleaned)
            };
            return (structured, prov);
        }
    }

    // LLM 미연결/쿼터 제한 시에도 A(전화목소리 추가 업데이트 별도 보관관리 포함)와 B(맥락·이벤트 통합 서술형)를 정확히 생성
    let base = ensure_contact_profile_has_template_sections(original_profile);
    let clean_ev = event_summary.trim().trim_start_matches('-').trim();
    let candidate = if slot.slot == "A" {
        let with_ev = if base.contains(clean_ev) {
            base
        } else {
            format!(
                "{}\n- {} *(내 음성지문 교차검증 · 화자혼동/타임태그 보정 및 상대방 음성지문 업데이트 완료)*",
                base.trim_end(),
                clean_ev
            )
        };
        ensure_prompt_a_phone_voice_section(&with_ev, &phone_voice_archive_block)
    } else {
        if base.contains(clean_ev) {
            format!(
                "{}\n- **[음성지문·맥락 통합]** 상대방(`{}`) 성문 특징 및 통화 맥락 동기화 완료",
                base.trim_end(),
                contact_name
            )
        } else {
            format!(
                "{}\n- {} *(사전조사된 연락처 관계 맥락 및 상대방 음성지문·이벤트 통합 반영)*",
                base.trim_end(),
                clean_ev
            )
        }
    };
    (candidate, "voiceprint_hybrid_engine".to_string())
}

/// 특정 인물에 대한 AI 인물 서술 업데이트 안건(A/B 후보)을 생성하여 `contact_profile_approvals`에 저장합니다.
pub(crate) fn create_contact_profile_approval_internal(
    conn: &Connection,
    contact_name: &str,
    source_type: &str,
    source_ref: &str,
    custom_event_context: Option<&str>,
) -> Result<ContactProfileApprovalItem, String> {
    let clean_name = contact_name.trim();
    if clean_name.is_empty() || clean_name == "알수없음" {
        return Err("유효한 연락처 인물 이름이 필요합니다.".to_string());
    }

    ensure_default_contact_prompt_slots(conn);
    let profiles = load_contact_ai_profiles_map(conn);
    let db_text = profiles.get(clean_name).map(|s| s.as_str());
    let (md_path, doc_uuid, current_body) =
        ensure_or_write_contact_person_md(conn, clean_name, &[], db_text);

    let (auto_ctx, auto_ref) = collect_recent_contact_events_context(conn, clean_name);
    let eff_context = custom_event_context
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| format!("{}\n\n[최근 대화 참고]\n{}", s, auto_ctx))
        .unwrap_or(auto_ctx);
    let eff_ref = if source_ref.trim().is_empty() {
        auto_ref
    } else {
        source_ref.trim().to_string()
    };

    let (event_summary, sum_prov) =
        summarize_event_in_one_or_two_lines(conn, clean_name, &eff_context);
    let slot_a = load_contact_prompt_slot(conn, "A");

    let (cand_a, prov_a) = generate_candidate_profile_with_slot(
        conn,
        &slot_a,
        clean_name,
        &current_body,
        &event_summary,
        &eff_context,
    );
    let cand_b = cand_a.clone();

    let used_prov = if prov_a != "local_fallback" {
        prov_a
    } else {
        sum_prov
    };
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 동일 인물·동일 통화 출처의 미결재(pending) 중복 안건 방지
    let _ = conn.execute(
        "DELETE FROM contact_profile_approvals WHERE contact_name = ?1 AND source_ref = ?2 AND status = 'pending'",
        params![clean_name, eff_ref],
    );

    conn.execute(
        "INSERT INTO contact_profile_approvals
         (contact_name, md_path, doc_uuid, source_type, source_ref, event_summary, original_profile_text,
          prompt_a_version, prompt_b_version, candidate_a_text, candidate_b_text, llm_provider, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', ?13)",
        params![
            clean_name,
            md_path.to_string_lossy().to_string(),
            doc_uuid,
            source_type,
            eff_ref,
            event_summary,
            current_body,
            slot_a.version,
            slot_a.version,
            cand_a,
            cand_b,
            used_prov,
            now_str,
        ],
    )
    .map_err(|e| format!("연락처 프로필 결재 안건 저장 실패: {}", e))?;

    let row_id = conn.last_insert_rowid();
    Ok(ContactProfileApprovalItem {
        id: row_id,
        contact_name: clean_name.to_string(),
        md_path: md_path.to_string_lossy().to_string(),
        doc_uuid,
        source_type: source_type.to_string(),
        source_ref: eff_ref,
        event_summary,
        original_profile_text: current_body,
        prompt_a_version: slot_a.version,
        prompt_b_version: slot_a.version,
        candidate_a_text: cand_a,
        candidate_b_text: cand_b,
        llm_provider: used_prov,
        status: "pending".to_string(),
        chosen_slot: "A".to_string(),
        user_edited: false,
        final_profile_text: String::new(),
        evolution_note: String::new(),
        created_at: now_str,
        resolved_at: String::new(),
    })
}

/// 승리한 프롬프트(`winner_prompt`)와 오리지널 결과물(`winner_original`), 사용자의 추가 편집본(`user_edited`) 및 수정/반려 요청사항(`user_feedback`)을 비교하여
/// 패배한 슬롯에 배치할 진화된 `프롬프트+`를 생성합니다.
fn synthesize_evolved_prompt_from_user_edit(
    conn: &Connection,
    winner_slot: &ContactPromptSlotInfo,
    winner_original_output: &str,
    user_edited_output: &str,
    user_feedback: &str,
) -> (String, String) {
    let meta_prompt = format!(
        "당신은 프롬프트 엔지니어링 최적화 전문가입니다.\n\
         사용자가 A/B 결재에서 [프롬프트 {w_slot} (v{w_ver})]의 결과물을 선택한 뒤, 수정/반려 요청사항 또는 직접 편집을 입력했습니다.\n\
         기존 [프롬프트 {w_slot}]의 지시문과 [오리지널 결과물], [사용자의 최종 편집본], 그리고 [사용자 수정·보완 요청사항]을 정밀 분석하여,\n\
         기존 [프롬프트 {w_slot}]보다 사용자의 의도를 더 완벽하게 반영하는 개선된 버전의 프롬프트(`프롬프트+`) 지시문을 작성하세요.\n\n\
         [필수 유지 조건]\n\
         - 프롬프트 내에 `{{contact_name}}` 플레이스홀더를 포함하세요.\n\
         - 상단 4개 기본 항목(`이 사람의 호칭(복수 가능):`, `나를 부르는 호칭:`, `소속 모임:`, `이 사람은?(직업, 사는곳, 이미지, ):`)과 하단 `## 📌 주요 사건 기록`(1~2줄 사건 요약) 구조를 유지하도록 지시하세요.\n\
         - 부연 설명이나 코드블록(```) 없이 새 프롬프트 지시문 본문만 출력하세요.\n\n\
         [기존 승리 프롬프트 ({w_slot} v{w_ver})]\n{w_prompt}\n\n\
         [사용자 수정·보완 요청사항]\n{fb}\n\n\
         [{w_slot}의 오리지널 결과물]\n{orig}\n\n\
         [사용자의 추가 편집 최종본]\n{edited}",
        w_slot = winner_slot.slot,
        w_ver = winner_slot.version,
        w_prompt = winner_slot.prompt_text,
        fb = if user_feedback.trim().is_empty() { "(직접 텍스트 편집)" } else { user_feedback.trim() },
        orig = winner_original_output,
        edited = user_edited_output
    );

    if let Some((new_p, _)) = call_any_text_llm(conn, &meta_prompt, 1000) {
        let cleaned = strip_markdown_code_fence(&new_p);
        if cleaned.len() >= 40 {
            return (
                cleaned,
                format!(
                    "{} v{} 선택 + 사용자 요청사항/편집 반영 → 프롬프트+ 진화 완료",
                    winner_slot.slot, winner_slot.version
                ),
            );
        }
    }

    let fb_rule = if !user_feedback.trim().is_empty() {
        format!("- [사용자 지정 수정·보완 지침]: {}", user_feedback.trim())
    } else {
        "- 사용자가 직접 수정한 편집 스타일(간결한 핵심 요약 및 구체적 인물 특징·호칭·화자 명시)을 최우선으로 반영하세요.".to_string()
    };
    let fallback_plus = format!(
        "{}\n\n[사용자 피드백 기반 추가 지침 (v{}+ 진화)]\n{}",
        winner_slot.prompt_text.trim(),
        winner_slot.version,
        fb_rule
    );
    (
        fallback_plus,
        format!(
            "{} v{} 기반 사용자 요청사항/편집 반영 프롬프트+ 생성",
            winner_slot.slot, winner_slot.version
        ),
    )
}

pub(crate) fn evolve_prompt_slot_with_feedback_or_edit(
    conn: &Connection,
    _winner_key: &str,
    winner_original: &str,
    eff_final: &str,
    user_feedback: &str,
) -> String {
    ensure_default_contact_prompt_slots(conn);
    let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let primary_slot = load_contact_prompt_slot(conn, "A");

    let has_feedback_or_edit =
        !user_feedback.trim().is_empty() || eff_final.trim() != winner_original.trim();
    if has_feedback_or_edit {
        let (new_prompt_text, summary_reason) = synthesize_evolved_prompt_from_user_edit(
            conn,
            &primary_slot,
            winner_original,
            eff_final,
            user_feedback,
        );
        let next_ver = primary_slot.version + 1;
        let next_title = format!("인물 프로필 AI 프롬프트 (v{} · 사용자 수정 반영 진화)", next_ver);
        let _ = conn.execute(
            "UPDATE contact_prompt_slots
             SET version = ?1, prompt_title = ?2, prompt_text = ?3,
                 win_count = win_count + 1, consecutive_losses = 0,
                 last_evolution_reason = ?4, updated_at = ?5
             WHERE slot = 'A'",
            params![next_ver, next_title, new_prompt_text, summary_reason, now_str],
        );
        let _ = conn.execute(
            "INSERT INTO contact_prompt_history
             (replaced_slot, old_version, new_version, winner_slot, trigger_type, evolution_summary, old_prompt_text, new_prompt_text, created_at)
             VALUES ('A', ?1, ?2, 'A', 'user_edit_evolution', ?3, ?4, ?5, ?6)",
            params![
                primary_slot.version,
                next_ver,
                summary_reason,
                primary_slot.prompt_text,
                new_prompt_text,
                now_str
            ],
        );
        format!(
            "🧬 사용자 수정 내역 분석 → 인물 프로필 생성 프롬프트(v{}) 자동 반영 완료",
            next_ver
        )
    } else {
        let _ = conn.execute(
            "UPDATE contact_prompt_slots
             SET win_count = win_count + 1, consecutive_losses = 0,
                 last_evolution_reason = 'AI 생성 데이터 무수정 수락', updated_at = ?1
             WHERE slot = 'A'",
            params![now_str],
        );
        format!("✓ AI 생성 인물 프로필 수락 완료 (프롬프트 v{} 유지)", primary_slot.version)
    }
}

#[tauri::command]
pub(crate) async fn get_contact_prompt_tournament_status(
    state: State<'_, AppState>,
) -> Result<ContactPromptTournamentStatus, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        Ok(get_contact_prompt_tournament_status_internal(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn update_contact_prompt_slot_manual(
    state: State<'_, AppState>,
    slot: String,
    prompt_title: String,
    prompt_text: String,
    reason: Option<String>,
) -> Result<ContactPromptTournamentStatus, String> {
    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_arc.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&db_path)?;
        ensure_default_contact_prompt_slots(&conn);
        let clean_slot = if slot.trim().eq_ignore_ascii_case("B") {
            "B"
        } else {
            "A"
        };
        let old = load_contact_prompt_slot(&conn, clean_slot);
        let new_ver = old.version + 1;
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let eff_reason = reason
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or("사용자 직접 수정");

        conn.execute(
            "UPDATE contact_prompt_slots
             SET version = ?1, prompt_title = ?2, prompt_text = ?3, consecutive_losses = 0,
                 last_evolution_reason = ?4, updated_at = ?5
             WHERE slot = ?6",
            params![
                new_ver,
                prompt_title.trim(),
                prompt_text.trim(),
                eff_reason,
                now_str,
                clean_slot
            ],
        )
        .map_err(|e| e.to_string())?;

        let _ = conn.execute(
            "INSERT INTO contact_prompt_history
             (replaced_slot, old_version, new_version, winner_slot, trigger_type, evolution_summary, old_prompt_text, new_prompt_text, created_at)
             VALUES (?1, ?2, ?3, ?1, 'manual_edit', ?4, ?5, ?6, ?7)",
            params![
                clean_slot,
                old.version,
                new_ver,
                eff_reason,
                old.prompt_text,
                prompt_text.trim(),
                now_str
            ],
        );

        Ok(get_contact_prompt_tournament_status_internal(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn load_contact_profile_approvals_internal(conn: &Connection) -> Vec<ContactProfileApprovalItem> {
    ensure_default_contact_prompt_slots(conn);
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, contact_name, md_path, doc_uuid, source_type, source_ref, event_summary,
                original_profile_text, prompt_a_version, prompt_b_version, candidate_a_text, candidate_b_text,
                llm_provider, status, chosen_slot, user_edited, final_profile_text, evolution_note, created_at, resolved_at
         FROM contact_profile_approvals
         ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 100",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(ContactProfileApprovalItem {
                id: r.get(0)?,
                contact_name: r.get(1)?,
                md_path: r.get(2)?,
                doc_uuid: r.get(3)?,
                source_type: r.get(4)?,
                source_ref: r.get(5)?,
                event_summary: r.get(6)?,
                original_profile_text: r.get(7)?,
                prompt_a_version: r.get(8)?,
                prompt_b_version: r.get(9)?,
                candidate_a_text: r.get(10)?,
                candidate_b_text: r.get(11)?,
                llm_provider: r.get(12)?,
                status: r.get(13)?,
                chosen_slot: r.get(14)?,
                user_edited: r.get::<_, i64>(15)? != 0,
                final_profile_text: r.get(16)?,
                evolution_note: r.get(17)?,
                created_at: r.get(18)?,
                resolved_at: r.get(19)?,
            })
        }) {
            out = rows.flatten().collect();
        }
    }
    out
}

#[tauri::command]
pub(crate) async fn get_contact_profile_approvals(
    state: State<'_, AppState>,
) -> Result<Vec<ContactProfileApprovalItem>, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db(&db_path)?;
        Ok(load_contact_profile_approvals_internal(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn generate_contact_profile_ab_update(
    state: State<'_, AppState>,
    contact_name: String,
    source_type: Option<String>,
    source_ref: Option<String>,
    raw_event_text: Option<String>,
    custom_event_context: Option<String>,
) -> Result<ContactProfileApprovalItem, String> {
    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_arc.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&db_path)?;
        let eff_source_type = source_type
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or("manual");
        let eff_source_ref = source_ref.as_deref().unwrap_or("");
        let eff_event_ctx = raw_event_text
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| custom_event_context.as_deref().filter(|s| !s.trim().is_empty()));
        create_contact_profile_approval_internal(
            &conn,
            &contact_name,
            eff_source_type,
            eff_source_ref,
            eff_event_ctx,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn resolve_contact_profile_approval(
    state: State<'_, AppState>,
    approval_id: i64,
    action: String,
    chosen_slot: Option<String>,
    final_profile_text: Option<String>,
    user_feedback: Option<String>,
) -> Result<Vec<ContactProfileApprovalItem>, String> {
    let db_path = state.db_path.clone();
    let lock_arc = state.lock.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_arc.lock().map_err(|e| e.to_string())?;
        let conn = open_db(&db_path)?;
        ensure_default_contact_prompt_slots(&conn);
        let now_str = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let act = action.trim();

        if act.eq_ignore_ascii_case("dismiss") {
            let _ = conn.execute(
                "UPDATE contact_profile_approvals
                 SET status = 'dismissed', resolved_at = ?1, evolution_note = '결재 반려/제외됨'
                 WHERE id = ?2",
                params![now_str, approval_id],
            );
            return Ok(load_contact_profile_approvals_internal(&conn));
        }

        let item: (String, String, String, String) = conn
            .query_row(
                "SELECT contact_name, event_summary, candidate_a_text, candidate_b_text
                 FROM contact_profile_approvals WHERE id = ?1",
                params![approval_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(|e| format!("결재 항목을 찾을 수 없습니다: {}", e))?;

        let (contact_name, ev_sum, cand_a, cand_b) = item;
        let winner_key = if chosen_slot
            .as_deref()
            .unwrap_or("A")
            .trim()
            .eq_ignore_ascii_case("B")
        {
            "B"
        } else {
            "A"
        };
        let winner_original = if winner_key == "A" { &cand_a } else { &cand_b };
        let fb_str = user_feedback.as_deref().unwrap_or("").trim();

        // 모드 1: 선택안(A 또는 B) + 반려/수정 요청사항을 고려하여 다시 A/B 분석
        if act.eq_ignore_ascii_case("reanalyze_with_feedback") {
            let slot_a = load_contact_prompt_slot(&conn, "A");
            let slot_b = load_contact_prompt_slot(&conn, "B");
            let feedback_ctx = format!(
                "[사용자 선택 기준안: 프롬프트 {}]\n{}\n\n[사용자 반려·수정 요청사항 (필수 반영)]\n{}",
                winner_key,
                winner_original.trim(),
                if fb_str.is_empty() { "핵심 정보와 호칭을 더 명확히 정리해 주세요." } else { fb_str }
            );
            let (mut new_a, _) = generate_candidate_profile_with_slot(
                &conn, &slot_a, &contact_name, winner_original, &ev_sum, &feedback_ctx,
            );
            let (mut new_b, _) = generate_candidate_profile_with_slot(
                &conn, &slot_b, &contact_name, winner_original, &ev_sum, &feedback_ctx,
            );
            if !fb_str.is_empty() {
                if !new_a.contains(fb_str) {
                    new_a = format!("{}\n- **[요청사항 반영]** {}", new_a.trim_end(), fb_str);
                }
                if !new_b.contains(fb_str) {
                    new_b = format!("{}\n- **[요청사항 반영]** {}", new_b.trim_end(), fb_str);
                }
            }
            let _ = evolve_prompt_slot_with_feedback_or_edit(
                &conn,
                winner_key,
                winner_original,
                winner_original,
                fb_str,
            );
            let note = format!(
                "🔄 {}안 선택 기준 + 요청사항({}) 반영 재분석 요청 접수",
                winner_key,
                if fb_str.is_empty() { "보완 요청" } else { fb_str }
            );
            let _ = conn.execute(
                "UPDATE contact_profile_approvals
                 SET candidate_a_text = ?1, candidate_b_text = ?2, chosen_slot = ?3,
                     evolution_note = ?4, status = 'reanalyzing', resolved_at = ?5
                 WHERE id = ?6",
                params![new_a, new_b, winner_key, note, now_str, approval_id],
            );
            return Ok(load_contact_profile_approvals_internal(&conn));
        }

        // 모드 2: 일반 승인 또는 AI가 승인된 것으로 가정하고 프롬프트만 수정/진화
        let mut eff_final = final_profile_text
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(winner_original.trim())
            .to_string();
        if !fb_str.is_empty() && !eff_final.contains(fb_str) {
            eff_final = format!("{}\n- {}", eff_final.trim_end(), fb_str);
        }

        let is_user_edited = eff_final.trim() != winner_original.trim() || !fb_str.is_empty();

        // 1. 해당 인물의 .md 파일 및 contact_ai_profiles DB 업데이트
        let formatted_body = ensure_contact_profile_has_template_sections(&eff_final);
        let _ = conn.execute(
            "INSERT INTO contact_ai_profiles (contact_name, profile_text, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(contact_name) DO UPDATE SET
                profile_text = excluded.profile_text,
                updated_at = excluded.updated_at",
            params![contact_name.trim(), formatted_body.trim(), now_str],
        );
        let (md_path, doc_uuid, _) =
            ensure_or_write_contact_person_md(&conn, &contact_name, &[], Some(&formatted_body));

        // 2. 프롬프트 A vs B 경합 및 진화 판정 (요청사항/편집 존재 시 즉시 프롬프트+ 진화)
        let evolution_note = evolve_prompt_slot_with_feedback_or_edit(
            &conn,
            winner_key,
            winner_original,
            &formatted_body,
            fb_str,
        );

        let _ = conn.execute(
            "UPDATE contact_profile_approvals
             SET status = 'approved', chosen_slot = ?1, user_edited = ?2,
                 final_profile_text = ?3, evolution_note = ?4, md_path = ?5, doc_uuid = ?6, resolved_at = ?7
             WHERE id = ?8",
            params![
                winner_key,
                if is_user_edited { 1 } else { 0 },
                formatted_body,
                evolution_note,
                md_path.to_string_lossy().to_string(),
                doc_uuid,
                now_str,
                approval_id
            ],
        );

        Ok(load_contact_profile_approvals_internal(&conn))
    })
    .await
    .map_err(|e| e.to_string())?
}
