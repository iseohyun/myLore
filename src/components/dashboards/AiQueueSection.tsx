/**
 * @file AiQueueSection.tsx
 * @description 설정 대시보드 > [🤖 AI & 시스템 로그 > 🚥 AI Queue]:
 * 독립 OS 프로세스(`mylore.exe --ai-queue-worker`, `DETACHED_PROCESS`)의 실시간 큐 상태,
 * 4개사 AI 에이전트 워커 슬롯 상태, 대기열(Queue) 항목 목록 및 최근 완료 내역을 모니터링하고 제어하는 대시보드.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AiQueueDashboardPayload } from '../../types/mylore';
import {
  controlAiQueueWorker,
  getAiQueueDashboardStatus,
} from '../../services/tauriClient';

function formatBytesText(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const PROVIDER_COLORS: Record<string, string> = {
  gemini: '#4285F4',
  claude: '#D97757',
  openai: '#10A37F',
  grok: '#A855F7',
};

export interface AiQueueSectionProps {
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function AiQueueSection({ setStatusMessage }: AiQueueSectionProps) {
  const [status, setStatus] = useState<AiQueueDashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [activeSubView, setActiveSubView] = useState<'pending' | 'completed'>(
    'pending'
  );

  const loadQueueStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAiQueueDashboardStatus();
      setStatus(data);
    } catch (e) {
      setStatusMessage(`AI Queue 상태 조회 실패: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setStatusMessage]);

  useEffect(() => {
    void loadQueueStatus();
    const timer = window.setInterval(() => {
      void loadQueueStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadQueueStatus]);

  const handleControlWorker = async (action: 'start_now' | 'stop_worker') => {
    if (controlling) return;
    setControlling(true);
    try {
      const updated = await controlAiQueueWorker(action);
      setStatus(updated);
      setStatusMessage(
        action === 'start_now'
          ? '🚀 독립 AI Queue 워커 프로세스 즉시 기동 요청 완료'
          : '⏹️ 독립 AI Queue 워커 프로세스 중지 및 락 해제 완료'
      );
    } catch (e) {
      setStatusMessage(`AI Queue 워커 제어 오류: ${String(e)}`);
    } finally {
      setControlling(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 1. 독립 프로세스 상태 요약 배너 */}
      <div
        className="stat-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: status?.workerRunning
            ? '1.5px solid #34d399'
            : '1px solid var(--border-color)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15px', fontWeight: 800 }}>
              🚥 독립 AI Queue 워커 프로세스 (`--ai-queue-worker`)
            </span>
            <span
              style={{
                padding: '3px 10px',
                borderRadius: '999px',
                fontSize: '11.5px',
                fontWeight: 700,
                backgroundColor: status?.workerRunning
                  ? 'rgba(16, 185, 129, 0.2)'
                  : 'rgba(148, 163, 184, 0.16)',
                color: status?.workerRunning
                  ? '#34d399'
                  : 'var(--text-secondary)',
              }}
            >
              {status?.workerRunning
                ? `🟢 가동 중 (PID: ${status.workerPid})`
                : '⚪ 대기 중 (Idle)'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => void loadQueueStatus()}
              disabled={loading}
            >
              {loading ? '⏳ 갱신 중...' : '🔄 상태 새로고침'}
            </button>
            <button
              type="button"
              className="toolbar-btn primary"
              onClick={() => void handleControlWorker('start_now')}
              disabled={controlling}
              title="독립 프로세스(mylore.exe --ai-queue-worker --force-now)를 즉시 기동하여 큐 처리를 시작합니다"
            >
              🚀 워커 즉시 기동 (큐 실행)
            </button>
            {status?.workerRunning && (
              <button
                type="button"
                className="toolbar-btn"
                style={{
                  borderColor: 'rgba(239, 68, 68, 0.45)',
                  color: '#f87171',
                }}
                onClick={() => void handleControlWorker('stop_worker')}
                disabled={controlling}
              >
                ⏹️ 워커 강제 중지
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          메인 GUI 프로세스와 분리된 OS 독립 서브프로세스(`DETACHED_PROCESS`)로
          실행되어 메인 창을 닫거나 재시작하더라도 현재 큐에 할당된 AI 전사·요약
          작업을 끝까지 완료한 뒤 자동 종료됩니다. (5초 간격 자동 갱신)
          {status?.workerHeartbeatAt && (
            <span style={{ marginLeft: '8px', color: '#a5b4fc' }}>
              · 최근 하트비트: {status.workerHeartbeatAt}
            </span>
          )}
        </div>

        {/* 핵심 지표 4종 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '10px',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              📥 총 대기 큐 (용량)
            </div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 800,
                color: '#f59e0b',
                marginTop: '3px',
              }}
            >
              {(status?.totalPendingCount ?? 0).toLocaleString()}건{' '}
              <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                ({formatBytesText(status?.totalPendingBytes ?? 0)})
              </span>
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              🔊 1단계 신규 / ❗ 3단계 재작성
            </div>
            <div
              style={{
                fontSize: '16px',
                fontWeight: 800,
                color: 'var(--text-primary)',
                marginTop: '3px',
              }}
            >
              신규 {status?.stage1PendingCount ?? 0}건 · 반려{' '}
              {status?.stage3RevisionCount ?? 0}건
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              🤖 가용 병렬 에이전트 슬롯
            </div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 800,
                color:
                  (status?.unlockedAgentCount ?? 0) > 0 ? '#34d399' : '#f87171',
                marginTop: '3px',
              }}
            >
              {status?.unlockedAgentCount ?? 0} / 4개 가용
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              ✅ 금일 큐 처리 완료
            </div>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 800,
                color: '#60a5fa',
                marginTop: '3px',
              }}
            >
              {(status?.completedTodayCount ?? 0).toLocaleString()}건
            </div>
          </div>
        </div>
      </div>

      {/* 2. 4개사 병렬 에이전트 워커 슬롯 현황 */}
      <div className="stat-card">
        <div
          style={{
            fontSize: '13.5px',
            fontWeight: 800,
            marginBottom: '10px',
          }}
        >
          ⚡ 병렬 에이전트 워커 슬롯 (1-Gemini · 2-Claude · 3-Grok · 4-OpenAI)
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px',
          }}
        >
          {(status?.agentSlots || []).map((slot) => {
            const color = PROVIDER_COLORS[slot.provider] || '#6366f1';
            return (
              <div
                key={slot.provider}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-primary)',
                  border: `1.5px solid ${
                    slot.isUsable ? color : 'var(--border-color)'
                  }`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: '12.5px',
                      color,
                    }}
                  >
                    ● {slot.displayName}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '1px 7px',
                      borderRadius: '999px',
                      backgroundColor: slot.isUsable
                        ? 'rgba(16, 185, 129, 0.16)'
                        : 'rgba(239, 68, 68, 0.14)',
                      color: slot.isUsable ? '#34d399' : '#f87171',
                    }}
                  >
                    {slot.statusLabel}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '11.5px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span>잔여/상태: {slot.creditOrQuotaText}</span>
                  <span>
                    금일 {slot.todayRequestCount}회 (
                    {slot.todayUsedTokens.toLocaleString()} tok)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. 대기열(Queue) 항목 및 최근 완료 로그 테이블 */}
      <div className="stat-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className={`toolbar-btn ${
                activeSubView === 'pending' ? 'primary' : ''
              }`}
              onClick={() => setActiveSubView('pending')}
            >
              📋 대기 중인 큐 항목 ({status?.totalPendingCount ?? 0}건 · 최신순)
            </button>
            <button
              type="button"
              className={`toolbar-btn ${
                activeSubView === 'completed' ? 'primary' : ''
              }`}
              onClick={() => setActiveSubView('completed')}
            >
              ✅ 금일 최근 완료 내역 ({status?.recentCompleted.length ?? 0}건)
            </button>
          </div>
          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            최신 녹음부터 우선 배정되며, 실패 시 큐 선두에 복귀되어 다음 가용
            에이전트가 즉시 이어받습니다.
          </span>
        </div>

        {activeSubView === 'pending' ? (
          (status?.pendingItems.length ?? 0) === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '13px',
              }}
            >
              🎉 현재 대기 중인 AI 스크립팅 큐 항목이 없습니다.
            </div>
          ) : (
            <div
              style={{
                maxHeight: '420px',
                overflowY: 'auto',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
              }}
            >
              <table className="lifelog-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: '56px' }}>순번</th>
                    <th style={{ width: '90px' }}>단계</th>
                    <th style={{ width: '150px' }}>대상 / 연락처</th>
                    <th style={{ width: '145px' }}>녹음 일시</th>
                    <th style={{ width: '85px', textAlign: 'right' }}>용량</th>
                    <th>파일명 / 반려 요구사항</th>
                  </tr>
                </thead>
                <tbody>
                  {(status?.pendingItems || []).map((item) => (
                    <tr key={item.safeStem}>
                      <td
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                        }}
                      >
                        #{item.queueOrder}
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: item.stage === 3 ? '#f59e0b' : '#f87171',
                          }}
                        >
                          {item.stage === 3 ? '❗ 3단계(재작성)' : '🔊 1단계(신규)'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {item.isVoiceMemo ? '🎙️ ' : '📞 '}
                        {item.contactName}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {item.recDate} {item.recTime}
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {formatBytesText(item.fileBytes)}
                      </td>
                      <td
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <div>{item.fileName}</div>
                        {item.userRequirement && (
                          <div style={{ color: '#fcd34d', fontWeight: 600 }}>
                            📌 요구사항: {item.userRequirement}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (status?.recentCompleted.length ?? 0) === 0 ? (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
            }}
          >
            금일 완료된 AI 변환 내역이 없습니다.
          </div>
        ) : (
          <div
            style={{
              maxHeight: '420px',
              overflowY: 'auto',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
            }}
          >
            <table className="lifelog-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: '160px' }}>완료 시각</th>
                  <th style={{ width: '100px' }}>처리 에이전트</th>
                  <th>완료 항목</th>
                </tr>
              </thead>
              <tbody>
                {(status?.recentCompleted || []).map((rc, idx) => {
                  const color = PROVIDER_COLORS[rc.provider] || '#4285F4';
                  return (
                    <tr key={`${rc.timestamp}_${idx}`}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {rc.timestamp}
                      </td>
                      <td>
                        <span
                          style={{
                            fontWeight: 800,
                            color,
                            textTransform: 'uppercase',
                            fontSize: '11.5px',
                          }}
                        >
                          ● {rc.provider}
                        </span>
                      </td>
                      <td>{rc.safeStem}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
