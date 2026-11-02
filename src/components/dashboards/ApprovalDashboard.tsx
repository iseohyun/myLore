/**
 * @file ApprovalDashboard.tsx
 * @description 의사결재 대시보드 (`Ctrl+\`` · `mylore://dashboard/logs`):
 * 결재창 본문에는 전체 결재 현황 요약 보드(AI변경건 · 통화기록 검수 · 카톡 업데이트 요청 · 연락처 프로필 업데이트 · 일정 업데이트 · 추후 계획)를 배치하고,
 * 카톡 업데이트 요청 대화방 상세 목록 등은 우측 사이드바(`Ctrl+B`)에만 배치합니다.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ApprovalCategory,
  CallApprovalItem,
  DocumentPayload,
  KakaoUpdateRequestItem,
  LifelogSourceType,
} from '../../types/mylore';
import {
  getCallApprovalItems,
  getCallRecordingPlayInfo,
  getKakaoUpdateRequests,
  readDocument,
  saveDocument,
  showInExplorer,
  transcribeSingleCallItem,
  updateCallTranscriptStage,
} from '../../services/tauriClient';
import {
  combineYamlAndBody,
  splitYamlFrontmatter,
} from '../../utils/markdownAutoFormat';

export interface ApprovalDashboardProps {
  approvalCategory: ApprovalCategory;
  setApprovalCategory: React.Dispatch<React.SetStateAction<ApprovalCategory>>;
  approvalStageFilter: 'pending' | 'revising' | 'verified' | 'all';
  setApprovalStageFilter: React.Dispatch<
    React.SetStateAction<'pending' | 'revising' | 'verified' | 'all'>
  >;
  approvalItems: CallApprovalItem[];
  setApprovalItems: React.Dispatch<React.SetStateAction<CallApprovalItem[]>>;
  selectedApprovalStem: string | null;
  setSelectedApprovalStem: React.Dispatch<React.SetStateAction<string | null>>;
  reloadApprovalItems: () => Promise<CallApprovalItem[]>;
  applyLoadedDocument: (doc: DocumentPayload) => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMobileSidebarTab?: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  setFilterUnverifiedCallsOnly?: React.Dispatch<React.SetStateAction<boolean>>;
  handleRetryPendingCallTranscripts?: () => Promise<void>;
  isRetryingTranscripts?: boolean;
}

const PROVIDER_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  gemini: { label: 'Gemini', color: '#4285F4', bg: 'rgba(66, 133, 244, 0.14)' },
  claude: { label: 'Claude', color: '#D97757', bg: 'rgba(217, 119, 87, 0.15)' },
  openai: { label: 'OpenAI', color: '#10A37F', bg: 'rgba(16, 163, 127, 0.15)' },
  grok: { label: 'Grok', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.15)' },
};

export function getProviderBadgeMeta(provider: string) {
  const key = (provider || 'gemini').trim().toLowerCase();
  if (key === 'gpt') return PROVIDER_META.openai;
  return PROVIDER_META[key] || PROVIDER_META.gemini;
}

export function ApprovalDashboard({
  approvalCategory,
  setApprovalCategory,
  approvalStageFilter,
  setApprovalStageFilter,
  approvalItems,
  setApprovalItems,
  selectedApprovalStem,
  setSelectedApprovalStem,
  reloadApprovalItems,
  applyLoadedDocument,
  setStatusMessage,
  setRightSidebarOpen,
  setMobileSidebarTab,
  setFilterUnverifiedCallsOnly,
  handleRetryPendingCallTranscripts,
  isRetryingTranscripts = false,
}: ApprovalDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [kakaoRequests, setKakaoRequests] = useState<KakaoUpdateRequestItem[]>(
    []
  );
  const [showInlineCallInspector, setShowInlineCallInspector] = useState(false);
  const [isProcessingDecision, setIsProcessingDecision] = useState(false);
  const [rejectRequirement, setRejectRequirement] = useState('');
  const [editedBody, setEditedBody] = useState('');
  const [isEditingScript, setIsEditingScript] = useState(true);
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  const refreshAllApprovalData = async () => {
    setLoading(true);
    try {
      const [, kList] = await Promise.all([
        reloadApprovalItems(),
        getKakaoUpdateRequests(),
      ]);
      setKakaoRequests(kList);
    } catch (e) {
      setStatusMessage(`결재 목록 로드 실패: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRightSidebarOpen(true);
    void refreshAllApprovalData();
  }, []);

  useEffect(() => {
    getKakaoUpdateRequests()
      .then(setKakaoRequests)
      .catch(() => {});
  }, [approvalCategory]);

  const counts = useMemo(() => {
    let pending = 0;
    let revising = 0;
    let verified = 0;
    for (const item of approvalItems) {
      if (item.stage === 2) pending += 1;
      else if (item.stage === 3) revising += 1;
      else if (item.stage === 4) verified += 1;
    }
    return { pending, revising, verified, total: approvalItems.length };
  }, [approvalItems]);

  const filteredItems = useMemo(() => {
    return approvalItems.filter((item) => {
      if (approvalStageFilter === 'pending') return item.stage === 2;
      if (approvalStageFilter === 'revising') return item.stage === 3;
      if (approvalStageFilter === 'verified') return item.stage === 4;
      return true;
    });
  }, [approvalItems, approvalStageFilter]);

  const selectedItem = useMemo(() => {
    if (selectedApprovalStem) {
      const found = approvalItems.find(
        (i) => i.safeStem === selectedApprovalStem
      );
      if (found) return found;
    }
    return filteredItems[0] || approvalItems[0] || null;
  }, [approvalItems, filteredItems, selectedApprovalStem]);

  useEffect(() => {
    if (!selectedItem || !showInlineCallInspector) {
      setAudioSrc(null);
      return;
    }
    setRejectRequirement(selectedItem.userRequirement || '');
    setEditedBody(selectedItem.scriptMarkdown || '');
    setIsEditingScript(true);

    let cancelled = false;
    setAudioLoading(true);
    getCallRecordingPlayInfo({
      roomOrSender: selectedItem.safeStem,
      attachmentUuid: selectedItem.fileName,
    })
      .then((info) => {
        if (cancelled) return;
        if (info.audioBase64) {
          setAudioSrc(
            `data:${info.mimeType || 'audio/mp4'};base64,${info.audioBase64}`
          );
        } else {
          setAudioSrc(info.audioUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setAudioSrc(null);
      })
      .finally(() => {
        if (!cancelled) setAudioLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedItem?.safeStem, showInlineCallInspector]);

  const pickNextPendingStem = (
    items: CallApprovalItem[],
    excludeStem: string
  ): string | null => {
    const nextPending = items.find(
      (i) => i.safeStem !== excludeStem && i.stage === 2
    );
    if (nextPending) return nextPending.safeStem;
    const nextAny = items.find((i) => i.safeStem !== excludeStem);
    return nextAny ? nextAny.safeStem : null;
  };

  const latestUnverifiedItem = useMemo(() => {
    return (
      approvalItems.find((i) => i.stage === 2) ||
      selectedItem ||
      approvalItems[0] ||
      null
    );
  }, [approvalItems, selectedItem]);

  const handleJumpToCallEditorWithUnverifiedFilter = async (
    targetItem: CallApprovalItem | null
  ) => {
    const item = targetItem || latestUnverifiedItem;
    if (!item) return;
    try {
      const doc = await readDocument(item.mdPath);
      setRightSidebarOpen(true);
      setMobileSidebarTab?.('call');
      setFilterUnverifiedCallsOnly?.(true);
      applyLoadedDocument(doc);
      setStatusMessage(
        `📄 최신 미확인 통화 에디터로 이동 완료 — 우측 사이드바 '❓ 미확인 스크립트(${counts.pending}건)만 표시 중' 필터가 활성화되었습니다.`
      );
    } catch (e) {
      setStatusMessage(`통화 에디터 이동 실패: ${String(e)}`);
    }
  };

  const isScriptModified = Boolean(
    selectedItem &&
      editedBody.trim() &&
      editedBody.trim() !== (selectedItem.scriptMarkdown || '').trim()
  );

  const handleSaveEditedScript = async () => {
    if (!selectedItem || isSavingScript || !editedBody.trim()) return;
    setIsSavingScript(true);
    try {
      const loaded = await readDocument(selectedItem.mdPath);
      const split = splitYamlFrontmatter(loaded.rawContent);
      const combined = combineYamlAndBody(split.yamlRaw, editedBody);
      await saveDocument(selectedItem.mdPath, combined);
      setApprovalItems((prev) =>
        prev.map((it) =>
          it.safeStem === selectedItem.safeStem
            ? { ...it, scriptMarkdown: editedBody }
            : it
        )
      );
      setStatusMessage(
        `💾 통화 스크립트 수정 내용 저장 완료: [${selectedItem.contactName}] ${selectedItem.recDate} ${selectedItem.recTime}`
      );
    } catch (e) {
      setStatusMessage(`스크립트 저장 오류: ${String(e)}`);
    } finally {
      setIsSavingScript(false);
    }
  };

  const handleApproveItem = async () => {
    if (!selectedItem || isProcessingDecision) return;
    setIsProcessingDecision(true);
    try {
      const currentStem = selectedItem.safeStem;
      if (
        editedBody.trim() &&
        editedBody.trim() !== selectedItem.scriptMarkdown.trim()
      ) {
        const loaded = await readDocument(selectedItem.mdPath);
        const split = splitYamlFrontmatter(loaded.rawContent);
        const combined = combineYamlAndBody(split.yamlRaw, editedBody);
        await saveDocument(selectedItem.mdPath, combined);
      }
      await updateCallTranscriptStage({
        roomOrSender: selectedItem.safeStem,
        attachmentUuid: selectedItem.fileName,
        stage: 4,
        userRequirement: rejectRequirement.trim() || null,
      });
      const updated = await getCallApprovalItems();
      setApprovalItems(updated);
      const nextStem = pickNextPendingStem(updated, currentStem);
      setSelectedApprovalStem(nextStem);
      setStatusMessage(
        `✅ 결재 승인 완료 (4단계 확정): [${selectedItem.contactName}] ${selectedItem.recDate} ${selectedItem.recTime}`
      );
    } catch (e) {
      setStatusMessage(`결재 승인 오류: ${String(e)}`);
    } finally {
      setIsProcessingDecision(false);
    }
  };

  const handleRejectAndReassign = async () => {
    if (!selectedItem || isProcessingDecision) return;
    const reqText =
      rejectRequirement.trim() ||
      '화자 분리 및 문맥 오탈자를 재검토하여 요약과 스크립트를 교정해 주세요.';
    setIsProcessingDecision(true);
    try {
      const currentStem = selectedItem.safeStem;
      setStatusMessage(
        `↩️ 반려 및 재작성 의뢰 중 (가용 AI 에이전트 순차 배정): [${selectedItem.contactName}]...`
      );
      await transcribeSingleCallItem({
        roomOrSender: selectedItem.safeStem,
        attachmentUuid: selectedItem.fileName,
        userRequirement: reqText,
      });
      const updated = await getCallApprovalItems();
      setApprovalItems(updated);
      setSelectedApprovalStem(currentStem);
      setStatusMessage(
        `✅ 반려 재작성 완료 (2단계 결재 대기로 갱신됨): [${selectedItem.contactName}]`
      );
    } catch (e) {
      const updated = await getCallApprovalItems().catch(() => approvalItems);
      setApprovalItems(updated);
      setStatusMessage(`⚠️ 반려 재작성 요청 중 오류: ${String(e)}`);
    } finally {
      setIsProcessingDecision(false);
    }
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '12px',
    padding: '14px 18px',
    borderRadius: '10px',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
  };

  return (
    <div
      className="lifelog-dashboard"
      style={{
        padding: '20px 24px',
        overflowY: 'auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {/* 상단 결재창 헤더 */}
      <div
        className="settings-card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>
              ⚖️ 의사결재 센터 (Approval Center)
            </h2>
            <span
              style={{
                fontSize: '11.5px',
                padding: '2px 8px',
                borderRadius: '999px',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--accent-primary)',
                fontWeight: 700,
              }}
            >
              Ctrl+`
            </span>
          </div>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: '12.5px',
              color: 'var(--text-secondary)',
            }}
          >
            전체 결재 안건 현황을 한눈에 확인하고, 세부 목록은 우측 사이드바(
            <code>Ctrl+B</code>)에서 검토합니다.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {handleRetryPendingCallTranscripts && (
            <button
              type="button"
              className="toolbar-btn"
              disabled={isRetryingTranscripts}
              onClick={() => void handleRetryPendingCallTranscripts()}
              title="남아있는 미완료 통화 녹음을 가용 AI 에이전트에게 병렬 배분하여 실행합니다"
            >
              {isRetryingTranscripts
                ? '⏳ AI 병렬 배분 중...'
                : '🤖 미완료 통화 AI 배분'}
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn"
            disabled={loading}
            onClick={() => void refreshAllApprovalData()}
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* 결재창 메인 요약 보드 (사용자 지정 UI 레이아웃) */}
      <div
        className="settings-card"
        style={{
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {/* 1. AI변경건 */}
        <div style={rowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '14px', minWidth: '150px', color: 'var(--heading-color)' }}>
              🤖 AI변경건:
            </strong>
            <span style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
              음성통화 프롬프트 변경 반영, 일정 정리 프롬프트 변경건, 연락처 프로필 반영 프롬프트
            </span>
          </div>
          <span
            style={{
              fontSize: '11.5px',
              padding: '3px 9px',
              borderRadius: '999px',
              backgroundColor: 'rgba(99, 102, 241, 0.14)',
              color: 'var(--accent-primary)',
              fontWeight: 700,
            }}
          >
            프롬프트 파이프라인
          </span>
        </div>

        {/* 2. 통화기록 검수 */}
        <div
          style={{
            ...rowStyle,
            border:
              approvalCategory === 'call_scripts'
                ? '1.5px solid var(--accent-primary)'
                : '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '14px', minWidth: '150px', color: 'var(--heading-color)' }}>
              📞 통화기록 검수:
            </strong>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 800,
                color: counts.pending > 0 ? '#f59e0b' : '#10b981',
              }}
            >
              {counts.pending.toLocaleString()}건
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              (반려/재작성 {counts.revising}건 · 검수완료 {counts.verified}건)
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="toolbar-btn primary"
              onClick={() =>
                void handleJumpToCallEditorWithUnverifiedFilter(
                  latestUnverifiedItem
                )
              }
              title="최신 미확인 통화의 에디터 탭으로 이동하고 우측 사이드바(Ctrl+B)의 '미확인 스크립트만 표시 중' 기능을 활성화합니다"
            >
              📄 최신 통화 에디터 탭으로 이동 (미확인 {counts.pending}건 필터)
            </button>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => {
                setRightSidebarOpen(true);
                setApprovalCategory('call_scripts');
                setShowInlineCallInspector((v) => !v);
              }}
            >
              {showInlineCallInspector ? '🔽 인라인 검수창 닫기' : '🔎 결재창 내 검수 열기'}
            </button>
          </div>
        </div>

        {/* 3. 카톡 업데이트 요청 (상세 목록은 사이드바 전용 배치) */}
        <div
          style={{
            ...rowStyle,
            cursor: 'pointer',
            border:
              approvalCategory === 'kakao_updates'
                ? '1.5px solid var(--accent-primary)'
                : '1px solid var(--border-color)',
          }}
          onClick={() => {
            setRightSidebarOpen(true);
            setApprovalCategory('kakao_updates');
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '14px', minWidth: '150px', color: 'var(--heading-color)' }}>
              💬 카톡 업데이트 요청:
            </strong>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 800,
                color: kakaoRequests.length > 0 ? '#eab308' : '#10b981',
              }}
            >
              {kakaoRequests.length.toLocaleString()}건
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              — 비즈니스/알림톡 채널은 자동 기록 후 알림 삭제됨 · 상세 대화방 목록은 우측 사이드바(
              <code>Ctrl+B</code>)에 표시
            </span>
          </div>
          <button
            type="button"
            className={`toolbar-btn ${approvalCategory === 'kakao_updates' ? 'primary' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setRightSidebarOpen(true);
              setApprovalCategory('kakao_updates');
            }}
          >
            👉 사이드바에서 목록 열기 ({kakaoRequests.length}건)
          </button>
        </div>

        {/* 4. 연락처 프로필 업데이트 */}
        <div
          style={rowStyle}
          onClick={() => {
            setRightSidebarOpen(true);
            setApprovalCategory('future_design');
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '14px', minWidth: '150px', color: 'var(--heading-color)' }}>
              👤 연락처 프로필 업데이트:
            </strong>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#38bdf8' }}>
              3건(신규3건)
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              - 각종 연락이나 사용자의 요청에 의한 대상평가/배경지식/큰 사건 등을 넣는 장소 (추후 상세계획작성할 예정)
            </span>
          </div>
        </div>

        {/* 5. 일정 업데이트 */}
        <div
          style={rowStyle}
          onClick={() => {
            setRightSidebarOpen(true);
            setApprovalCategory('future_design');
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '14px', minWidth: '150px', color: 'var(--heading-color)' }}>
              🗓️ 일정 업데이트:
            </strong>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#a855f7' }}>
              4건
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              - 일별 사건들을 업데이트하여 이벤트로 남길지. 또는 기존 이벤트에 추가할지 (추후 상세 작성)
            </span>
          </div>
        </div>

        {/* 6. ...(추후 계획) */}
        <div
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}
        >
          ...(추후 계획)
        </div>
      </div>

      {/* 선택적 인라인 통화 스크립트 검수기 (사용자가 '결재창 내 검수 열기'를 눌렀을 때만 표시) */}
      {showInlineCallInspector && selectedItem && (
        <div
          className="settings-card"
          style={{
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '16px', fontWeight: 800 }}>
                {selectedItem.isVoiceMemo ? '🎙️' : '📞'} {selectedItem.contactName}
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {selectedItem.recDate} {selectedItem.recTime}
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
                className="toolbar-btn primary"
                style={{ backgroundColor: '#10b981', borderColor: '#059669' }}
                disabled={isProcessingDecision}
                onClick={() => void handleApproveItem()}
              >
                ✅ 승인 (4단계 확정)
              </button>
              <button
                type="button"
                className="toolbar-btn"
                disabled={isSavingScript || !isScriptModified}
                onClick={() => void handleSaveEditedScript()}
              >
                💾 스크립트 저장
              </button>
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => void showInExplorer(selectedItem.audioPath)}
              >
                📂 파일 위치
              </button>
            </div>
          </div>

          {audioSrc && !audioLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <audio
                controls
                src={audioSrc}
                style={{ height: '32px', flex: 1 }}
                onPlay={(e) => {
                  e.currentTarget.playbackRate = playbackRate;
                }}
              />
              {[1.0, 1.25, 1.5, 2.0].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={`toolbar-btn ${playbackRate === rate ? 'primary' : ''}`}
                  style={{ padding: '2px 7px', fontSize: '11px' }}
                  onClick={() => setPlaybackRate(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="input-field"
              style={{ flex: 1 }}
              placeholder="반려 사유 / 재작성 프롬프트 지시사항..."
              value={rejectRequirement}
              onChange={(e) => setRejectRequirement(e.target.value)}
            />
            <button
              type="button"
              className="toolbar-btn"
              disabled={isProcessingDecision}
              onClick={() => void handleRejectAndReassign()}
            >
              ↩️ 반려 및 재작성
            </button>
          </div>

          {isEditingScript ? (
            <textarea
              className="input-field"
              style={{
                minHeight: '300px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                lineHeight: 1.6,
              }}
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
            />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px' }}>
              {editedBody || selectedItem.scriptMarkdown}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
