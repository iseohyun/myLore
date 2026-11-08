/**
 * @file ContactProfileApprovalPanel.tsx
 * @description 연락처 인물 서술(.md + UUID) AI A/B 프롬프트 경합·진화 및 결재 패널.
 * - 시나리오 1 (사용자 추가 편집 발생): 승리 프롬프트(예: B)는 유지하고, [B 프롬프트 + B 오리지널 + B 사용자 편집본]을 비교해 만든 B+ 프롬프트를 패배 슬롯(A)에 배치하여 경합.
 * - 시나리오 2 (무편집 단순 선택): 패배 프롬프트 연패(consecutive_losses) 누적 후 3연패 도달 시에만 승리 프롬프트 기반으로 진화 교체.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ContactProfileApprovalItem,
  ContactPromptTournamentStatus,
  DocumentPayload,
} from '../../types/mylore';
import {
  generateContactProfileAbUpdate,
  getContactAiProfiles,
  getContactProfileApprovals,
  getContactPromptTournamentStatus,
  getMobileContactsMap,
  openContactPersonDocument,
  readDocument,
  resolveContactProfileApproval,
  showInExplorer,
  syncContactPersonMarkdownFiles,
  updateContactPromptSlotManual,
} from '../../services/tauriClient';
import { getProviderBadgeMeta } from './ApprovalDashboard';

export interface ContactProfileApprovalPanelProps {
  approvals: ContactProfileApprovalItem[];
  setApprovals: React.Dispatch<React.SetStateAction<ContactProfileApprovalItem[]>>;
  selectedApprovalId: number | null;
  setSelectedApprovalId: React.Dispatch<React.SetStateAction<number | null>>;
  tournamentStatus: ContactPromptTournamentStatus | null;
  setTournamentStatus: React.Dispatch<
    React.SetStateAction<ContactPromptTournamentStatus | null>
  >;
  reloadContactApprovals: () => Promise<void>;
  applyLoadedDocument: (doc: DocumentPayload) => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function ContactProfileApprovalPanel({
  approvals,
  setApprovals,
  selectedApprovalId,
  setSelectedApprovalId,
  tournamentStatus,
  setTournamentStatus,
  reloadContactApprovals,
  applyLoadedDocument,
  setStatusMessage,
}: ContactProfileApprovalPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [chosenSlot, setChosenSlot] = useState<'A' | 'B'>('B');
  const [editedFinalText, setEditedFinalText] = useState('');
  const [showOriginalMd, setShowOriginalMd] = useState(false);
  const [showPromptManager, setShowPromptManager] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingMdFiles, setIsSyncingMdFiles] = useState(false);
  const [isGeneratingAb, setIsGeneratingAb] = useState(false);

  // 수동 안건 생성 폼
  const [knownContacts, setKnownContacts] = useState<string[]>([]);
  const [targetContactName, setTargetContactName] = useState('');
  const [manualEventNote, setManualEventNote] = useState('');

  // 프롬프트 수동 편집 상태
  const [editPromptATitle, setEditPromptATitle] = useState('');
  const [editPromptAText, setEditPromptAText] = useState('');
  const [editPromptBTitle, setEditPromptBTitle] = useState('');
  const [editPromptBText, setEditPromptBText] = useState('');

  useEffect(() => {
    Promise.all([getMobileContactsMap(), getContactAiProfiles()])
      .then(([cMap, profMap]) => {
        const names = new Set<string>();
        Object.values(cMap).forEach((n) => {
          if (n && n.trim()) names.add(n.trim());
        });
        Object.keys(profMap).forEach((n) => {
          if (n && n.trim()) names.add(n.trim());
        });
        const sorted = Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
        setKnownContacts(sorted);
        if (!targetContactName && sorted.length > 0) {
          setTargetContactName(sorted[0]);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tournamentStatus?.slotA && tournamentStatus?.slotB) {
      setEditPromptATitle(tournamentStatus.slotA.promptTitle);
      setEditPromptAText(tournamentStatus.slotA.promptText);
      setEditPromptBTitle(tournamentStatus.slotB.promptTitle);
      setEditPromptBText(tournamentStatus.slotB.promptText);
    }
  }, [tournamentStatus]);

  const filteredList = useMemo(() => {
    return approvals.filter((item) => {
      if (statusFilter === 'pending') return item.status === 'pending';
      if (statusFilter === 'approved') return item.status === 'approved';
      return true;
    });
  }, [approvals, statusFilter]);

  const selectedItem = useMemo(() => {
    if (selectedApprovalId !== null) {
      const found = approvals.find((a) => a.id === selectedApprovalId);
      if (found) return found;
    }
    return filteredList[0] || approvals[0] || null;
  }, [approvals, filteredList, selectedApprovalId]);

  useEffect(() => {
    if (!selectedItem) {
      setEditedFinalText('');
      return;
    }
    const initSlot: 'A' | 'B' =
      selectedItem.chosenSlot === 'A' ? 'A' : 'B';
    setChosenSlot(initSlot);
    if (selectedItem.status === 'approved' && selectedItem.finalProfileText.trim()) {
      setEditedFinalText(selectedItem.finalProfileText);
    } else {
      setEditedFinalText(
        initSlot === 'A' ? selectedItem.candidateAText : selectedItem.candidateBText
      );
    }
  }, [selectedItem?.id]);

  const handleSelectCandidateSlot = (slot: 'A' | 'B') => {
    if (!selectedItem) return;
    setChosenSlot(slot);
    setEditedFinalText(
      slot === 'A' ? selectedItem.candidateAText : selectedItem.candidateBText
    );
  };

  const selectedOriginalCandidate = useMemo(() => {
    if (!selectedItem) return '';
    return chosenSlot === 'A'
      ? selectedItem.candidateAText
      : selectedItem.candidateBText;
  }, [selectedItem, chosenSlot]);

  const isUserModifiedFromCandidate = useMemo(() => {
    if (!selectedItem) return false;
    return (
      editedFinalText.trim().length > 0 &&
      editedFinalText.trim() !== selectedOriginalCandidate.trim()
    );
  }, [selectedItem, editedFinalText, selectedOriginalCandidate]);

  const loserSlot = chosenSlot === 'A' ? 'B' : 'A';
  const loserSlotInfo =
    loserSlot === 'A' ? tournamentStatus?.slotA : tournamentStatus?.slotB;

  const handleSyncAllPersonMd = async () => {
    if (isSyncingMdFiles) return;
    setIsSyncingMdFiles(true);
    try {
      const list = await syncContactPersonMarkdownFiles();
      setStatusMessage(
        `📂 연락처 인원별 .md 파일 일괄 생성·동기화 완료 (${list.length}명, 고유 UUID 및 기본 템플릿 부여됨)`
      );
    } catch (e) {
      setStatusMessage(`인원별 .md 동기화 실패: ${String(e)}`);
    } finally {
      setIsSyncingMdFiles(false);
    }
  };

  const handleGenerateManualAbUpdate = async () => {
    const cleanName = targetContactName.trim();
    if (!cleanName || isGeneratingAb) return;
    setIsGeneratingAb(true);
    try {
      setStatusMessage(
        `🤖 [${cleanName}] 사건 1~2줄 요약 및 A/B 프롬프트 후보 생성 중...`
      );
      const created = await generateContactProfileAbUpdate({
        contactName: cleanName,
        sourceType: 'manual_request',
        sourceRef: new Date().toISOString().slice(0, 10),
        rawEventText: manualEventNote.trim() || undefined,
      });
      await reloadContactApprovals();
      setSelectedApprovalId(created.id);
      setStatusFilter('pending');
      setManualEventNote('');
      setStatusMessage(
        `✅ [${cleanName}] 인물 서술 A/B 결재 안건이 생성되었습니다. 선호하는 편집(A/B)을 선택해 주세요.`
      );
    } catch (e) {
      setStatusMessage(`AI A/B 안건 생성 실패: ${String(e)}`);
    } finally {
      setIsGeneratingAb(false);
    }
  };

  const handleResolve = async (action: 'approve' | 'dismiss') => {
    if (!selectedItem || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const currentId = selectedItem.id;
      const updatedList = await resolveContactProfileApproval({
        approvalId: currentId,
        action,
        chosenSlot,
        finalProfileText: editedFinalText,
      });
      setApprovals(updatedList);
      const nextTournament = await getContactPromptTournamentStatus();
      setTournamentStatus(nextTournament);

      const resolvedRecord = updatedList.find((i) => i.id === currentId);
      const nextPending = updatedList.find(
        (i) => i.id !== currentId && i.status === 'pending'
      );
      setSelectedApprovalId(nextPending ? nextPending.id : currentId);

      if (action === 'approve') {
        setStatusMessage(
          `✅ [${selectedItem.contactName}] 인물 .md 업데이트 결재 완료 (${chosenSlot} 선택${isUserModifiedFromCandidate ? ' + 사용자 편집 → 패배 슬롯 진화' : ''}) — ${resolvedRecord?.evolutionNote || ''}`
        );
      } else {
        setStatusMessage(`🗑️ [${selectedItem.contactName}] 안건이 제외되었습니다.`);
      }
    } catch (e) {
      setStatusMessage(`결재 처리 오류: ${String(e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPersonMd = async (contactName: string, mdPath?: string) => {
    try {
      const doc = mdPath
        ? await readDocument(mdPath).catch(() => openContactPersonDocument(contactName))
        : await openContactPersonDocument(contactName);
      applyLoadedDocument(doc);
      setStatusMessage(`📄 [${contactName}] 인물 서술 .md 문서를 열었습니다.`);
    } catch (e) {
      setStatusMessage(`인물 .md 열기 실패: ${String(e)}`);
    }
  };

  const handleSaveManualPrompt = async (slot: 'A' | 'B') => {
    try {
      const title = slot === 'A' ? editPromptATitle : editPromptBTitle;
      const text = slot === 'A' ? editPromptAText : editPromptBText;
      const updated = await updateContactPromptSlotManual({
        slot,
        promptTitle: title,
        promptText: text,
        reason: `사용자가 프롬프트 ${slot}를 직접 수정함`,
      });
      setTournamentStatus(updated);
      setStatusMessage(`💾 프롬프트 ${slot} 수동 저장 완료 (버전 갱신됨)`);
    } catch (e) {
      setStatusMessage(`프롬프트 ${slot} 저장 실패: ${String(e)}`);
    }
  };

  const pendingCount = approvals.filter((a) => a.status === 'pending').length;
  const approvedCount = approvals.filter((a) => a.status === 'approved').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 1. A/B 프롬프트 경합 & 진화 상태 요약 카드 */}
      <div
        className="settings-card"
        style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div>
            <strong style={{ fontSize: '15px', color: 'var(--heading-color)' }}>
              🧬 인물 서술 A/B 프롬프트 경합 & 진화 엔진
            </strong>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              각 인원별 <code>Data/mobile/contacts/people/&#123;이름&#125;.md</code> (UUID 부여) ·
              사용자 추가 편집 시 승리 프롬프트 유지 + 패배 슬롯을 <code>프롬프트+</code>로 교체 ·
              무편집 시 <strong>3연패 도달 시에만</strong> 자동 진화
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="toolbar-btn"
              disabled={isSyncingMdFiles}
              onClick={() => void handleSyncAllPersonMd()}
              title="연락처의 모든 인원마다 기본 템플릿과 UUID가 부여된 개별 .md 파일을 생성/동기화합니다"
            >
              {isSyncingMdFiles
                ? '⏳ .md 동기화 중...'
                : '📂 전체 인원 .md 생성/동기화 (UUID)'}
            </button>
            <button
              type="button"
              className={`toolbar-btn ${showPromptManager ? 'primary' : ''}`}
              onClick={() => setShowPromptManager((v) => !v)}
            >
              {showPromptManager
                ? '🔽 프롬프트 A/B 상세 닫기'
                : '⚙️ 프롬프트 A/B 원문 & 진화이력'}
            </button>
          </div>
        </div>

        {tournamentStatus?.slotA && tournamentStatus?.slotB && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '10px',
            }}
          >
            {[tournamentStatus.slotA, tournamentStatus.slotB].map((slotInfo) => (
              <div
                key={slotInfo.slot}
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-primary)',
                  border:
                    slotInfo.slot === 'A'
                      ? '1px solid rgba(56, 189, 248, 0.45)'
                      : '1px solid rgba(168, 85, 247, 0.45)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong
                    style={{
                      fontSize: '13px',
                      color: slotInfo.slot === 'A' ? '#38bdf8' : '#c084fc',
                    }}
                  >
                    {slotInfo.slot === 'A' ? '🅰️' : '🅱️'} {slotInfo.promptTitle} (v{slotInfo.version})
                  </strong>
                  <span style={{ fontSize: '11.5px', fontWeight: 700 }}>
                    🏆 {slotInfo.winCount}승 · {slotInfo.lossCount}패 ·{' '}
                    <span
                      style={{
                        color:
                          slotInfo.consecutiveLosses >= 2 ? '#f59e0b' : 'var(--text-secondary)',
                      }}
                    >
                      연패 {slotInfo.consecutiveLosses}/3
                    </span>
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                  최근 진화 사유: {slotInfo.lastEvolutionReason || '초기 기본 프롬프트'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 프롬프트 A/B 원문 편집 & 진화 히스토리 */}
        {showPromptManager && tournamentStatus && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              paddingTop: '8px',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '12px',
              }}
            >
              {(['A', 'B'] as const).map((slot) => {
                const isA = slot === 'A';
                const titleVal = isA ? editPromptATitle : editPromptBTitle;
                const textVal = isA ? editPromptAText : editPromptBText;
                return (
                  <div
                    key={slot}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="input-field"
                        style={{ flex: 1, fontSize: '12px', fontWeight: 700 }}
                        value={titleVal}
                        onChange={(e) =>
                          isA
                            ? setEditPromptATitle(e.target.value)
                            : setEditPromptBTitle(e.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="toolbar-btn"
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                        onClick={() => void handleSaveManualPrompt(slot)}
                      >
                        💾 프롬프트 {slot} 저장
                      </button>
                    </div>
                    <textarea
                      className="input-field"
                      style={{
                        minHeight: '130px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)',
                        lineHeight: 1.5,
                      }}
                      value={textVal}
                      onChange={(e) =>
                        isA
                          ? setEditPromptAText(e.target.value)
                          : setEditPromptBText(e.target.value)
                      }
                    />
                  </div>
                );
              })}
            </div>

            {(tournamentStatus.recentHistory?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <strong style={{ fontSize: '12px', color: 'var(--heading-color)' }}>
                  📜 최근 프롬프트 진화 이력 ({tournamentStatus.recentHistory?.length ?? 0}건)
                </strong>
                <div
                  style={{
                    maxHeight: '140px',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {(tournamentStatus.recentHistory ?? []).map((h) => (
                    <div
                      key={h.id}
                      style={{
                        fontSize: '11.5px',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                        [{h.createdAt}] 슬롯 {h.replacedSlot} (v{h.oldVersion} → v{h.newVersion})
                      </span>{' '}
                      · 승리: {h.winnerSlot} · {h.evolutionSummary}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 수동 AI A/B 안건 생성 바 */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingTop: '6px',
            borderTop: '1px dashed var(--border-color)',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 700 }}>➕ 인물 업데이트 안건 생성:</span>
          <input
            type="text"
            list="contact-person-datalist"
            className="input-field"
            style={{ width: '160px', fontSize: '12.5px' }}
            placeholder="인물 이름 입력/선택..."
            value={targetContactName}
            onChange={(e) => setTargetContactName(e.target.value)}
          />
          <datalist id="contact-person-datalist">
            {knownContacts.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <input
            type="text"
            className="input-field"
            style={{ flex: 1, minWidth: '220px', fontSize: '12.5px' }}
            placeholder="추가 사건 내용 입력 (비워두면 최근 통화/문자/카톡 기록을 자동 분석하여 1~2줄 요약 후 A/B 생성)..."
            value={manualEventNote}
            onChange={(e) => setManualEventNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleGenerateManualAbUpdate();
            }}
          />
          <button
            type="button"
            className="toolbar-btn primary"
            disabled={isGeneratingAb || !targetContactName.trim()}
            onClick={() => void handleGenerateManualAbUpdate()}
          >
            {isGeneratingAb ? '⏳ AI A/B 생성 중...' : '🤖 AI A/B 업데이트 생성'}
          </button>
          {targetContactName.trim() && (
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => void handleOpenPersonMd(targetContactName.trim())}
              title="해당 인물의 .md 파일을 에디터에서 바로 엽니다"
            >
              📄 인물 .md 열기
            </button>
          )}
        </div>
      </div>

      {/* 2. 결재 안건 검수 및 A/B 선택 영역 */}
      <div
        className="settings-card"
        style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {(
              [
                { id: 'pending', label: `⏳ 결재 대기 (${pendingCount})` },
                { id: 'approved', label: `✅ 결재 완료 (${approvedCount})` },
                { id: 'all', label: `전체 (${approvals.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`toolbar-btn ${statusFilter === tab.id ? 'primary' : ''}`}
                style={{ fontSize: '12px', padding: '4px 10px' }}
                onClick={() => setStatusFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredList.length > 1 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {filteredList.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`toolbar-btn ${selectedItem?.id === item.id ? 'primary' : ''}`}
                  style={{ fontSize: '11.5px', padding: '3px 8px' }}
                  onClick={() => setSelectedApprovalId(item.id)}
                >
                  👤 {item.contactName}
                </button>
              ))}
            </div>
          )}
        </div>

        {!selectedItem ? (
          <div
            style={{
              padding: '28px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '13px',
            }}
          >
            결재 대기 중인 연락처 인물 서술 업데이트 안건이 없습니다. 상단에서 인물을 선택해{' '}
            <strong>🤖 AI A/B 업데이트 생성</strong>을 누르거나 통화 스크립트를 승인(4단계)하면 자동 생성됩니다.
          </div>
        ) : (
          <>
            {/* 선택된 인물 헤더 */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '16px', fontWeight: 800 }}>
                  👤 {selectedItem.contactName}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  UUID: {selectedItem.docUuid || '자동부여'}
                </span>
                {(() => {
                  const prov = getProviderBadgeMeta(selectedItem.llmProvider);
                  return (
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        color: prov.color,
                        backgroundColor: prov.bg,
                      }}
                    >
                      🤖 {prov.label}
                    </span>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => setShowOriginalMd((v) => !v)}
                >
                  {showOriginalMd ? '🙈 기존 .md 원문 닫기' : '📖 기존 .md 원문 보기'}
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() =>
                    void handleOpenPersonMd(selectedItem.contactName, selectedItem.mdPath)
                  }
                >
                  📄 인물 .md 에디터로 열기
                </button>
                {selectedItem.mdPath && (
                  <button
                    type="button"
                    className="toolbar-btn"
                    onClick={() => void showInExplorer(selectedItem.mdPath)}
                  >
                    📂 폴더 열기
                  </button>
                )}
              </div>
            </div>

            {/* 추가되는 사건 1~2줄 요약 배너 */}
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: '#38bdf8' }}>📌 추가 사건 1~2줄 요약:</strong>{' '}
              <span>{selectedItem.eventSummary}</span>
            </div>

            {showOriginalMd && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px dashed var(--border-color)',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '180px',
                  overflowY: 'auto',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  [업데이트 전 기존 인물 서술 (.md 본문)]
                </strong>
                {selectedItem.originalProfileText}
              </div>
            )}

            {/* AI 생성 결과물 + 사용자 수정 영역 (수정 시 프롬프트 자동 반영) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <strong style={{ fontSize: '13.5px', color: 'var(--heading-color)' }}>
                  ✏️ AI 생성 인물 프로필 (그대로 수락하거나 수정 후 수락 가능)
                </strong>
                {isUserModifiedFromCandidate ? (
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(16, 185, 129, 0.16)',
                      color: '#10b981',
                    }}
                  >
                    🧬 수정 감지됨 → 수락 시 수정 내용을 분석하여 프롬프트에 자동 반영합니다
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: '11.5px',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(56, 189, 248, 0.14)',
                      color: '#38bdf8',
                    }}
                  >
                    ✓ AI 생성 데이터 무수정 수락 모드
                  </span>
                )}
              </div>

              <textarea
                className="input-field"
                style={{
                  minHeight: '220px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  lineHeight: 1.6,
                }}
                value={editedFinalText}
                onChange={(e) => setEditedFinalText(e.target.value)}
              />

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {selectedItem.evolutionNote
                    ? `📌 처리 결과: ${selectedItem.evolutionNote}`
                    : `수락 시 Data/mobile/contacts/people/${selectedItem.contactName}.md 및 연락처 DB에 즉시 반영됩니다.`}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {isUserModifiedFromCandidate && (
                    <button
                      type="button"
                      className="toolbar-btn"
                      onClick={() => setEditedFinalText(selectedOriginalCandidate)}
                    >
                      ↩️ AI 원본으로 복원
                    </button>
                  )}
                  <button
                    type="button"
                    className="toolbar-btn"
                    disabled={isSubmitting}
                    onClick={() => void handleResolve('dismiss')}
                  >
                    🗑️ 제외
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn primary"
                    style={{ backgroundColor: '#10b981', borderColor: '#059669' }}
                    disabled={isSubmitting}
                    onClick={() => void handleResolve('approve')}
                  >
                    {isSubmitting
                      ? '⏳ 처리 중...'
                      : isUserModifiedFromCandidate
                        ? '✅ 수정 후 수락 (프롬프트 자동 반영)'
                        : '✅ AI 생성 데이터 수락'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
