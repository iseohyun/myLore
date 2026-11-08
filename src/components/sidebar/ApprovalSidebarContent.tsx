/**
 * @file ApprovalSidebarContent.tsx
 * @description 의사결재 대시보드(`Ctrl+\``) 전용 우측 사이드바(`Ctrl+B`) 패널:
 * - 카테고리 또는 특정 안건 클릭 시 대시보드의 해당 카테고리 위치로 스크롤 이동
 * - 대표 안건이 아닌 안건 클릭 시 해당 카테고리로 이동 후 대시보드의 대표 안건을 클릭된 안건으로 즉시 교체
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ApprovalCategory,
  CallApprovalItem,
  ContactProfileApprovalItem,
  DocumentPayload,
  KakaoUpdateRequestItem,
} from '../../types/mylore';
import {
  getContactProfileApprovals,
  getKakaoUpdateRequests,
  resolveKakaoUpdateRequest,
} from '../../services/tauriClient';
import {
  ApprovalNavigateDetail,
  getProviderBadgeMeta,
  sortCallApprovalItemsAbFirst,
} from '../dashboards/ApprovalDashboard';
import { hasDualAbScript } from '../dashboards/CallScriptAbComparisonPanel';

export interface ApprovalSidebarContentProps {
  approvalCategory: ApprovalCategory;
  setApprovalCategory?: React.Dispatch<React.SetStateAction<ApprovalCategory>>;
  approvalStageFilter: 'pending' | 'revising' | 'verified' | 'all';
  setApprovalStageFilter?: React.Dispatch<
    React.SetStateAction<'pending' | 'revising' | 'verified' | 'all'>
  >;
  approvalItems: CallApprovalItem[];
  selectedApprovalStem?: string | null;
  setSelectedApprovalStem?: React.Dispatch<React.SetStateAction<string | null>>;
  applyLoadedDocument: (doc: DocumentPayload) => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

function dispatchApprovalNavigate(detail: ApprovalNavigateDetail) {
  window.dispatchEvent(
    new CustomEvent<ApprovalNavigateDetail>('mylore-approval-navigate', {
      detail,
    })
  );
}

export function ApprovalSidebarContent({
  approvalCategory,
  setApprovalCategory,
  approvalStageFilter,
  setApprovalStageFilter,
  approvalItems,
  selectedApprovalStem,
  setSelectedApprovalStem,
  setStatusMessage,
}: ApprovalSidebarContentProps) {
  const [kakaoRequests, setKakaoRequests] = useState<KakaoUpdateRequestItem[]>(
    []
  );
  const [contactApprovals, setContactApprovals] = useState<
    ContactProfileApprovalItem[]
  >([]);
  const [activeContactId, setActiveContactId] = useState<number | null>(null);
  const [activeKakaoRoom, setActiveKakaoRoom] = useState<string | null>(null);

  const loadSidebarLists = async () => {
    try {
      const [list, cList] = await Promise.all([
        getKakaoUpdateRequests(),
        getContactProfileApprovals(),
      ]);
      setKakaoRequests(list);
      setContactApprovals(cList);
    } catch (e) {
      setStatusMessage(`목록 조회 실패: ${String(e)}`);
    }
  };

  useEffect(() => {
    void loadSidebarLists();
  }, [approvalCategory]);

  useEffect(() => {
    const onSync = () => {
      void loadSidebarLists();
    };
    window.addEventListener('mylore-approval-sidebar-sync', onSync);
    return () => {
      window.removeEventListener('mylore-approval-sidebar-sync', onSync);
    };
  }, []);

  const sortedCalls = useMemo(
    () => sortCallApprovalItemsAbFirst(approvalItems),
    [approvalItems]
  );

  const pendingApprovalCount = sortedCalls.filter((i) => i.stage === 3).length;
  const filteredApprovalItems = useMemo(() => {
    return sortedCalls.filter((item) => {
      if (approvalStageFilter === 'pending') return item.stage === 3;
      if (approvalStageFilter === 'revising') return item.stage === 2;
      if (approvalStageFilter === 'verified') return item.stage === 4;
      return true;
    });
  }, [sortedCalls, approvalStageFilter]);

  const pendingContacts = useMemo(
    () => contactApprovals.filter((a) => a.status === 'pending'),
    [contactApprovals]
  );

  const handleResolveKakao = async (
    roomName: string,
    action: 'dismiss' | 'mark_auto_channel' | 'clear_all',
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    try {
      const updated = await resolveKakaoUpdateRequest(roomName, action);
      setKakaoRequests(updated);
      window.dispatchEvent(new CustomEvent('mylore-approval-refresh'));
    } catch (err) {
      setStatusMessage(`카톡 처리 오류: ${String(err)}`);
    }
  };

  return (
    <div
      className="sidebar-content"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* 1. 통화기록 검수 */}
      <div
        className={`tree-node-row ${approvalCategory === 'call_scripts' ? 'active' : ''}`}
        style={{
          padding: '8px 10px',
          borderRadius: '7px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          border:
            approvalCategory === 'call_scripts'
              ? '1px solid var(--accent-primary)'
              : '1px solid var(--border-color)',
        }}
        onClick={() => {
          setApprovalCategory?.('call_scripts');
          dispatchApprovalNavigate({ category: 'call_scripts' });
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '12.5px' }}>
          📞 통화기록 검수
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: '999px',
            backgroundColor:
              pendingApprovalCount > 0
                ? 'rgba(245, 158, 11, 0.2)'
                : 'rgba(16, 185, 129, 0.16)',
            color: pendingApprovalCount > 0 ? '#f59e0b' : '#10b981',
          }}
        >
          {pendingApprovalCount}건
        </span>
      </div>

      {approvalCategory === 'call_scripts' && (
        <>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {(
              [
                { id: 'pending', label: `3.후처리(${pendingApprovalCount})` },
                {
                  id: 'revising',
                  label: `2.ASR(${sortedCalls.filter((i) => i.stage === 2).length})`,
                },
                {
                  id: 'verified',
                  label: `4.확인(${sortedCalls.filter((i) => i.stage === 4).length})`,
                },
                { id: 'all', label: `전체(${sortedCalls.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`toolbar-btn ${approvalStageFilter === tab.id ? 'primary' : ''}`}
                style={{ padding: '2px 6px', fontSize: '10.5px', flex: 1 }}
                onClick={() => setApprovalStageFilter?.(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              maxHeight: '280px',
              overflowY: 'auto',
              paddingRight: '2px',
            }}
          >
            {filteredApprovalItems.map((item, idx) => {
              const isSelected = selectedApprovalStem === item.safeStem;
              const isDual = hasDualAbScript(item);
              const prov = getProviderBadgeMeta(item.llmProvider);
              return (
                <div
                  key={item.safeStem}
                  data-sidebar-active={isSelected ? 'true' : undefined}
                  className={`tree-node-row ${isSelected ? 'active' : ''}`}
                  style={{
                    padding: '7px 9px',
                    borderRadius: '7px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '3px',
                    cursor: 'pointer',
                    border: isSelected
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-color)',
                  }}
                  onClick={() => {
                    setApprovalCategory?.('call_scripts');
                    setSelectedApprovalStem?.(item.safeStem);
                    dispatchApprovalNavigate({
                      category: 'call_scripts',
                      callStem: item.safeStem,
                    });
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      gap: '4px',
                    }}
                  >
                    <strong
                      style={{
                        fontSize: '12px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {idx === 0 ? '★ ' : ''}
                      {item.contactName}
                    </strong>
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                      {isDual && (
                        <span
                          style={{
                            fontSize: '9.5px',
                            fontWeight: 800,
                            padding: '1px 5px',
                            borderRadius: '999px',
                            backgroundColor: 'rgba(168, 85, 247, 0.2)',
                            color: '#c084fc',
                          }}
                        >
                          A/B
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: '9.5px',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: '999px',
                          color: prov.color,
                          backgroundColor: prov.bg,
                        }}
                      >
                        {prov.label}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {item.recDate} {item.recTime}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 2. 연락처 프로필 업데이트 */}
      <div
        className={`tree-node-row ${approvalCategory === 'contact_profiles' ? 'active' : ''}`}
        style={{
          padding: '8px 10px',
          borderRadius: '7px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          border:
            approvalCategory === 'contact_profiles'
              ? '1px solid var(--accent-primary)'
              : '1px solid var(--border-color)',
        }}
        onClick={() => {
          setApprovalCategory?.('contact_profiles');
          dispatchApprovalNavigate({ category: 'contact_profiles' });
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '12.5px' }}>
          👤 연락처 프로필 업데이트
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: '999px',
            backgroundColor: 'rgba(56, 189, 248, 0.2)',
            color: '#38bdf8',
          }}
        >
          {pendingContacts.length}건
        </span>
      </div>

      {approvalCategory === 'contact_profiles' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            maxHeight: '260px',
            overflowY: 'auto',
            paddingRight: '2px',
          }}
        >
          {(pendingContacts.length > 0 ? pendingContacts : contactApprovals).map(
            (cItem, idx) => {
              const isSelected = activeContactId === cItem.id;
              return (
                <div
                  key={cItem.id}
                  className={`tree-node-row ${isSelected ? 'active' : ''}`}
                  style={{
                    padding: '7px 9px',
                    borderRadius: '7px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                    border: isSelected
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-color)',
                  }}
                  onClick={() => {
                    setActiveContactId(cItem.id);
                    setApprovalCategory?.('contact_profiles');
                    dispatchApprovalNavigate({
                      category: 'contact_profiles',
                      contactId: cItem.id,
                    });
                  }}
                >
                  <strong style={{ fontSize: '12px' }}>
                    {idx === 0 ? '★ ' : ''}👤 {cItem.contactName}
                  </strong>
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    A/B
                  </span>
                </div>
              );
            }
          )}
        </div>
      )}

      {/* 3. 카톡 업데이트 요청 */}
      <div
        className={`tree-node-row ${approvalCategory === 'kakao_updates' ? 'active' : ''}`}
        style={{
          padding: '8px 10px',
          borderRadius: '7px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          border:
            approvalCategory === 'kakao_updates'
              ? '1px solid var(--accent-primary)'
              : '1px solid var(--border-color)',
        }}
        onClick={() => {
          setApprovalCategory?.('kakao_updates');
          dispatchApprovalNavigate({ category: 'kakao_updates' });
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '12.5px' }}>
          💬 카톡 업데이트 요청
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: '999px',
            backgroundColor:
              kakaoRequests.length > 0
                ? 'rgba(250, 204, 21, 0.22)'
                : 'rgba(16, 185, 129, 0.16)',
            color: kakaoRequests.length > 0 ? '#eab308' : '#10b981',
          }}
        >
          {kakaoRequests.length}건
        </span>
      </div>

      {approvalCategory === 'kakao_updates' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            maxHeight: '260px',
            overflowY: 'auto',
            paddingRight: '2px',
          }}
        >
          {kakaoRequests.map((req, idx) => {
            const isSelected = activeKakaoRoom === req.roomName;
            return (
              <div
                key={req.roomName}
                className={`tree-node-row ${isSelected ? 'active' : ''}`}
                style={{
                  padding: '7px 9px',
                  borderRadius: '7px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                  border: isSelected
                    ? '1px solid var(--accent-primary)'
                    : '1px solid var(--border-color)',
                }}
                onClick={() => {
                  setActiveKakaoRoom(req.roomName);
                  setApprovalCategory?.('kakao_updates');
                  dispatchApprovalNavigate({
                    category: 'kakao_updates',
                    kakaoRoom: req.roomName,
                  });
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, gap: '2px' }}>
                  <strong
                    style={{
                      fontSize: '12px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {idx === 0 ? '★ ' : ''}💬 {req.roomName}
                  </strong>
                  {req.kakaoGroups && req.kakaoGroups.length > 0 && (
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#fbbf24',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={req.candidateRoomsHint || `속해있는 카톡 그룹: ${req.kakaoGroups.join(' / ')}`}
                    >
                      단톡 {req.kakaoGroups.length}개: {req.kakaoGroups.join(', ')}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                  <button
                    type="button"
                    className="toolbar-btn"
                    style={{ padding: '1px 5px', fontSize: '10px' }}
                    onClick={(e) =>
                      void handleResolveKakao(
                        req.roomName,
                        'mark_auto_channel',
                        e
                      )
                    }
                    title="자동 기록 채널 지정"
                  >
                    🤖
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn"
                    style={{ padding: '1px 5px', fontSize: '10px' }}
                    onClick={(e) =>
                      void handleResolveKakao(req.roomName, 'dismiss', e)
                    }
                    title="제외"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. 일정 업데이트 */}
      <div
        className={`tree-node-row ${approvalCategory === 'future_design' ? 'active' : ''}`}
        style={{
          padding: '8px 10px',
          borderRadius: '7px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          border:
            approvalCategory === 'future_design'
              ? '1px solid var(--accent-primary)'
              : '1px solid var(--border-color)',
        }}
        onClick={() => {
          setApprovalCategory?.('future_design');
          dispatchApprovalNavigate({ category: 'future_design' });
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '12.5px' }}>
          🗓️ 일정 업데이트
        </span>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            padding: '1px 7px',
            borderRadius: '999px',
            backgroundColor: 'rgba(168, 85, 247, 0.2)',
            color: '#a855f7',
          }}
        >
          4건
        </span>
      </div>
    </div>
  );
}
