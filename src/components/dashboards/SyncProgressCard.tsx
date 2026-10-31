/**
 * @file SyncProgressCard.tsx
 * @description 모바일 동기화 단계별 실시간 진행률 카드 (`LifelogDashboard` 및 `MobileLifelogSidebar` 공용 컴포넌트).
 */
import React from 'react';
import { MobileSyncProgressPayload } from '../../types/mylore';

export interface SyncProgressCardProps {
  mobileSyncProgress: MobileSyncProgressPayload | null;
  setMobileSyncProgress: React.Dispatch<
    React.SetStateAction<MobileSyncProgressPayload | null>
  >;
}

function formatBytesHuman(bytes?: number): string {
  const b = bytes ?? 0;
  if (b <= 0) return '0 B';
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (b >= gb) return `${(b / gb).toFixed(2)} GB`;
  if (b >= mb) return `${(b / mb).toFixed(1)} MB`;
  if (b >= kb) return `${(b / kb).toFixed(1)} KB`;
  return `${b} B`;
}

export function SyncProgressCard({
  mobileSyncProgress,
  setMobileSyncProgress,
}: SyncProgressCardProps) {
  if (!mobileSyncProgress) return null;

  const activeStep =
    mobileSyncProgress.steps[mobileSyncProgress.currentStepIndex] ||
    mobileSyncProgress.steps[mobileSyncProgress.steps.length - 1];

  return (
    <div
      style={{
        padding: '14px 16px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--accent-primary)',
        borderRadius: '10px',
        marginBottom: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: '13.5px',
              color: '#e0e7ff',
            }}
          >
            {mobileSyncProgress.isRunning
              ? `🔄 [${mobileSyncProgress.currentStepIndex + 1}/${mobileSyncProgress.totalSteps}] ${mobileSyncProgress.currentLabel}`
              : `✅ ${mobileSyncProgress.currentLabel}`}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#4ade80',
            }}
          >
            {mobileSyncProgress.currentPercent}%
          </span>
          {activeStep && (
            <span
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
              }}
            >
              (총 {activeStep.totalCount}건
              {(activeStep.totalBytes ?? 0) > 0
                ? ` · ${formatBytesHuman(activeStep.syncedBytes)} / ${formatBytesHuman(activeStep.totalBytes)}`
                : ''}
              )
            </span>
          )}
          {(mobileSyncProgress.sessionTotalBytes ?? 0) > 0 && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '11.5px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'rgba(251, 191, 36, 0.14)',
                border: '1px solid rgba(251, 191, 36, 0.38)',
                color: '#fbbf24',
              }}
              title="세션 통합 전송 용량 및 볼륨 진행 현황 (동적 볼륨 확장 지원)"
            >
              📦 {formatBytesHuman(mobileSyncProgress.sessionSyncedBytes)} /{' '}
              {formatBytesHuman(mobileSyncProgress.sessionTotalBytes)} [
              {mobileSyncProgress.sessionSyncedCount ?? 0} /{' '}
              {mobileSyncProgress.sessionTotalCount ?? 0}개]
            </span>
          )}
          {mobileSyncProgress.isReady === false && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: 'rgba(245, 158, 11, 0.18)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                color: '#fcd34d',
              }}
              title="단말이 로컬 캐시로 즉시 전송을 시작하고 백그라운드에서 전체 볼륨을 정밀 스캔 중입니다."
            >
              ⏳ 전송 준비 및 초기 동기화 중...
            </span>
          )}
          {mobileSyncProgress.isRunning && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                backgroundColor: 'rgba(56, 189, 248, 0.16)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                color: '#7dd3fc',
              }}
              title="메인 UI 스레드와 분리된 전용 백그라운드 워커 스레드에서 비동기 일괄 적재 중"
            >
              ⚡ 백그라운드 스레드 처리 중
              {(mobileSyncProgress.queuedJobs ?? 0) > 0
                ? ` (큐 대기 ${mobileSyncProgress.queuedJobs}건)`
                : ''}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '11.5px',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '2px',
                backgroundColor: '#3b82f6',
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#93c5fd', fontWeight: 600 }}>
              이미 보유(스킵): {activeStep?.skippedCount ?? 0}건
            </span>
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '2px',
                backgroundColor: '#22c55e',
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#86efac', fontWeight: 600 }}>
              신규 다운로드: {activeStep?.downloadedCount ?? 0}건
            </span>
          </span>
          {!mobileSyncProgress.isRunning && (
            <button
              className="toolbar-btn"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => setMobileSyncProgress(null)}
            >
              ✕ 닫기
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '14px',
          backgroundColor: 'rgba(15, 23, 42, 0.75)',
          borderRadius: '999px',
          overflow: 'hidden',
          border: '1px solid rgba(148, 163, 184, 0.28)',
        }}
      >
        {(activeStep?.segments || []).map((seg, idx) => (
          <div
            key={`seg-${idx}`}
            style={{
              width: `${seg.widthPct}%`,
              height: '100%',
              backgroundColor:
                seg.kind === 'download' ? '#22c55e' : '#3b82f6',
              transition: 'width 120ms linear',
            }}
            title={
              seg.kind === 'download'
                ? '신규 다운로드 구간 (녹색)'
                : '이미 PC에 보유하여 스킵한 구간 (파란색)'
            }
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          fontSize: '11.5px',
        }}
      >
        {mobileSyncProgress.steps.map((st) => (
          <span
            key={st.key}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor:
                st.status === 'running'
                  ? 'rgba(79, 70, 229, 0.22)'
                  : 'var(--bg-primary)',
              border:
                st.status === 'running'
                  ? '1px solid var(--accent-primary)'
                  : '1px solid var(--border-color)',
              opacity: st.status === 'pending' ? 0.55 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <strong style={{ color: '#e2e8f0' }}>
              {st.status === 'done'
                ? '✓ '
                : st.status === 'running'
                  ? '⏳ '
                  : '• '}
              {st.label.replace(' 받아오는 중...', '')} ({st.percent}%)
            </strong>
            <span
              style={{
                color: '#93c5fd',
                fontFamily: 'var(--font-mono)',
              }}
            >
              스킵 {st.skippedCount}
            </span>
            <span
              style={{
                color: '#86efac',
                fontFamily: 'var(--font-mono)',
              }}
            >
              신규 {st.downloadedCount}
            </span>
            {(st.totalBytes ?? 0) > 0 && (
              <span
                style={{
                  color: '#fbbf24',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {formatBytesHuman(st.syncedBytes)} / {formatBytesHuman(st.totalBytes)}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
