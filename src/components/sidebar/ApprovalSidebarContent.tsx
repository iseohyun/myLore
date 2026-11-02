/**
 * @file ApprovalSidebarContent.tsx
 * @description 의사결재 대시보드(`Ctrl+\``) 전용 우측 사이드바(`Ctrl+B`) 패널:
 * - 1. 통화기록 검수 리스트 (`call_scripts`)
 * - 2. 카톡 업데이트 요청 대화방 리스트 (`kakao_updates` — 본문에는 배치하지 않고 사이드바에만 배치)
 * - 3. 추후 계획 항목 (`future_design`)
 */
import React, { useEffect, useState } from 'react';
import {
  ApprovalCategory,
  CallApprovalItem,
  DocumentPayload,
  KakaoUpdateRequestItem,
} from '../../types/mylore';
import {
  getKakaoUpdateRequests,
  readDocument,
  resolveKakaoUpdateRequest,
} from '../../services/tauriClient';
import { getProviderBadgeMeta } from '../dashboards/ApprovalDashboard';

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

export function ApprovalSidebarContent({
  approvalCategory,
  setApprovalCategory,
  approvalStageFilter,
  setApprovalStageFilter,
  approvalItems,
  selectedApprovalStem,
  setSelectedApprovalStem,
  applyLoadedDocument,
  setStatusMessage,
}: ApprovalSidebarContentProps) {
  const [kakaoRequests, setKakaoRequests] = useState<KakaoUpdateRequestItem[]>(
    []
  );
  const [loadingKakao, setLoadingKakao] = useState(false);

  const loadKakaoList = async () => {
    setLoadingKakao(true);
    try {
      const list = await getKakaoUpdateRequests();
      setKakaoRequests(list);
    } catch (e) {
      setStatusMessage(`카톡 업데이트 요청 조회 실패: ${String(e)}`);
    } finally {
      setLoadingKakao(false);
    }
  };

  useEffect(() => {
    void loadKakaoList();
  }, [approvalCategory]);

  const pendingApprovalCount = approvalItems.filter((i) => i.stage === 2).length;
  const filteredApprovalItems = approvalItems.filter((item) => {
    if (approvalStageFilter === 'pending') return item.stage === 2;
    if (approvalStageFilter === 'revising') return item.stage === 3;
    if (approvalStageFilter === 'verified') return item.stage === 4;
    return true;
  });

  const handleResolveKakao = async (
    roomName: string,
    action: 'dismiss' | 'mark_auto_channel' | 'clear_all',
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    try {
      const updated = await resolveKakaoUpdateRequest(roomName, action);
      setKakaoRequests(updated);
      if (action === 'mark_auto_channel') {
        setStatusMessage(
          `🤖 [${roomName}] 채널이 비즈니스/알림톡 자동 기록 채널로 등록되어 목록에서 제외되었습니다.`
        );
      } else if (action === 'dismiss') {
        setStatusMessage(
          `✓ [${roomName}] 대화방이 카톡 업데이트 요청 목록에서 제외되었습니다.`
        );
      } else {
        setStatusMessage(`🧹 카톡 업데이트 요청 목록을 모두 비웠습니다.`);
      }
    } catch (err) {
      setStatusMessage(`카톡 업데이트 요청 처리 오류: ${String(err)}`);
    }
  };

  return (
    <div
      className="sidebar-content"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px 10px',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong style={{ fontSize: '13px', color: 'var(--heading-color)' }}>
          ⚖️ 결재 검토 사이드바
        </strong>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Ctrl+B
        </span>
      </div>

      {/* 1. 통화기록 검수 */}
      <div
        className={`tree-node-row ${approvalCategory === 'call_scripts' ? 'active' : ''}`}
        style={{
          padding: '9px 10px',
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
        onClick={() => setApprovalCategory?.('call_scripts')}
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
                { id: 'pending', label: `⏳ 대기(${pendingApprovalCount})` },
                {
                  id: 'revising',
                  label: `↩️ 반려(${approvalItems.filter((i) => i.stage === 3).length})`,
                },
                {
                  id: 'verified',
                  label: `✅ 완료(${approvalItems.filter((i) => i.stage === 4).length})`,
                },
                { id: 'all', label: `전체(${approvalItems.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`toolbar-btn ${approvalStageFilter === tab.id ? 'primary' : ''}`}
                style={{ padding: '3px 7px', fontSize: '11px', flex: 1 }}
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
              gap: '5px',
              maxHeight: '340px',
              overflowY: 'auto',
              paddingRight: '2px',
            }}
          >
            {filteredApprovalItems.length === 0 ? (
              <div
                style={{
                  padding: '16px 10px',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                }}
              >
                해당 상태의 통화 스크립트가 없습니다.
              </div>
            ) : (
              filteredApprovalItems.map((item) => {
                const isSelected = selectedApprovalStem === item.safeStem;
                const prov = getProviderBadgeMeta(item.llmProvider);
                return (
                  <div
                    key={item.safeStem}
                    data-sidebar-active={isSelected ? 'true' : undefined}
                    className={`tree-node-row ${isSelected ? 'active' : ''}`}
                    style={{
                      padding: '8px 9px',
                      borderRadius: '7px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '4px',
                      cursor: 'pointer',
                      border: isSelected
                        ? '1px solid var(--accent-primary)'
                        : '1px solid var(--border-color)',
                    }}
                    onClick={() => {
                      setApprovalCategory?.('call_scripts');
                      setSelectedApprovalStem?.(item.safeStem);
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
                        {item.stage === 2
                          ? '⏳'
                          : item.stage === 3
                            ? '↩️'
                            : '✅'}{' '}
                        {item.contactName}
                      </strong>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '999px',
                          color: prov.color,
                          backgroundColor: prov.bg,
                          flexShrink: 0,
                        }}
                      >
                        {prov.label}
                      </span>
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
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        lineHeight: 1.4,
                      }}
                    >
                      {item.summaryText}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* 2. 카톡 업데이트 요청 (사이드바 전용 배치) */}
      <div
        className={`tree-node-row ${approvalCategory === 'kakao_updates' ? 'active' : ''}`}
        style={{
          padding: '9px 10px',
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
        onClick={() => setApprovalCategory?.('kakao_updates')}
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
            gap: '6px',
            flex: 1,
            overflowY: 'auto',
            paddingRight: '2px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
              }}
            >
              비즈니스·알림톡은 자동 기록 후 알림 삭제됨
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                className="toolbar-btn"
                style={{ padding: '2px 6px', fontSize: '10.5px' }}
                disabled={loadingKakao}
                onClick={() => void loadKakaoList()}
              >
                🔄
              </button>
              {kakaoRequests.length > 0 && (
                <button
                  type="button"
                  className="toolbar-btn"
                  style={{ padding: '2px 6px', fontSize: '10.5px' }}
                  onClick={(e) => void handleResolveKakao('', 'clear_all', e)}
                  title="카톡 업데이트 요청 목록 전체 비우기"
                >
                  🧹 전체비움
                </button>
              )}
            </div>
          </div>

          {kakaoRequests.length === 0 ? (
            <div
              style={{
                padding: '18px 10px',
                textAlign: 'center',
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              대화내용 내보내기 업데이트가 필요한 카톡 대화방이 없습니다.
            </div>
          ) : (
            kakaoRequests.map((req) => (
              <div
                key={req.roomName}
                className="tree-node-row"
                style={{
                  padding: '8px 9px',
                  borderRadius: '7px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '4px',
                  cursor: req.mdPath ? 'pointer' : 'default',
                  border: '1px solid var(--border-color)',
                }}
                onClick={async () => {
                  if (!req.mdPath) {
                    setStatusMessage(
                      `💬 [${req.roomName}] 아직 내보내기된 카톡 대화 문서가 없습니다. 모바일 카카오톡에서 대화 내용 내보내기를 수행해 주세요.`
                    );
                    return;
                  }
                  try {
                    const doc = await readDocument(req.mdPath);
                    applyLoadedDocument(doc);
                  } catch (e) {
                    setStatusMessage(`카톡 문서 열기 실패: ${String(e)}`);
                  }
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
                    💬 {req.roomName}
                  </strong>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '999px',
                      color: '#eab308',
                      backgroundColor: 'rgba(250, 204, 21, 0.16)',
                      flexShrink: 0,
                    }}
                  >
                    미반영 알림 {req.pendingNotiCount}건
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '10.5px',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  최근 알림: {req.lastNotiDate} {req.lastNotiTime}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.35,
                  }}
                >
                  {req.lastMessagePreview}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    width: '100%',
                    marginTop: '2px',
                    gap: '4px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {req.lastSyncedDate
                      ? `최근 백업: ${req.lastSyncedDate}`
                      : '백업 이력 없음'}
                  </span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="toolbar-btn"
                      style={{ padding: '2px 6px', fontSize: '10px' }}
                      onClick={(e) =>
                        void handleResolveKakao(
                          req.roomName,
                          'mark_auto_channel',
                          e
                        )
                      }
                      title="이 대화방을 비즈니스/알림톡 채널로 지정하여 앞으로 알림 수신 즉시 자동 기록 후 삭제합니다"
                    >
                      🤖 채널지정
                    </button>
                    <button
                      type="button"
                      className="toolbar-btn"
                      style={{ padding: '2px 6px', fontSize: '10px' }}
                      onClick={(e) =>
                        void handleResolveKakao(req.roomName, 'dismiss', e)
                      }
                      title="업데이트 요청 목록에서 제외"
                    >
                      ✕ 제외
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 3. 연락처 프로필 / 일정 업데이트 (추후 계획) */}
      <div
        className={`tree-node-row ${approvalCategory === 'future_design' ? 'active' : ''}`}
        style={{
          padding: '9px 10px',
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
        onClick={() => setApprovalCategory?.('future_design')}
      >
        <span style={{ fontWeight: 700, fontSize: '12.5px' }}>
          🚧 프로필·일정 업데이트 (추후 계획)
        </span>
        <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
          상세계획 예정
        </span>
      </div>
    </div>
  );
}
