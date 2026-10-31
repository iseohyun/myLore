/**
 * @file StatusBar.tsx
 * @description 하단 상태 표시줄: 일괄 UUID 스캔 진행률 바, 통화 녹음 `<audio>` 플레이어 바, 휴지통 복구 버튼 및 상태 메시지.
 */
import React from 'react';
import {
  DirectCallPlayInfo,
  ScanProgressPayload,
  TrashedFileRecord,
} from '../../types/mylore';
import { showInExplorer } from '../../services/tauriClient';

export interface StatusBarProps {
  directCallPlayInfo: DirectCallPlayInfo | null;
  setDirectCallPlayInfo: React.Dispatch<React.SetStateAction<DirectCallPlayInfo | null>>;
  setActiveAudioLineIndex: React.Dispatch<React.SetStateAction<number | null>>;
  callAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
  pendingSeekSecondsRef: React.MutableRefObject<number | null>;
  handleAudioTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => void;
  statusMessage: string;
  scanProgress: ScanProgressPayload | null;
  trashHistory: TrashedFileRecord[];
  handleRestoreTrashedDocument: () => void;
  autoSaveEnabled: boolean;
}

export function StatusBar({
  directCallPlayInfo,
  setDirectCallPlayInfo,
  setActiveAudioLineIndex,
  callAudioRef,
  pendingSeekSecondsRef,
  handleAudioTimeUpdate,
  statusMessage,
  scanProgress,
  trashHistory,
  handleRestoreTrashedDocument,
  autoSaveEnabled,
}: StatusBarProps) {
  return (
    <footer
      className="statusbar"
      style={
        directCallPlayInfo
          ? {
              padding: '3px 10px',
              backgroundColor: '#1e1b4b',
              borderTop: '1.5px solid var(--accent-primary)',
              gap: '8px',
            }
          : undefined
      }
    >
      {directCallPlayInfo ? (
        <>
          <audio
            ref={callAudioRef}
            controls
            autoPlay={Boolean(directCallPlayInfo.autoPlay)}
            src={directCallPlayInfo.audioUrl}
            onTimeUpdate={handleAudioTimeUpdate}
            onLoadedMetadata={(e) => {
              if (pendingSeekSecondsRef.current !== null) {
                e.currentTarget.currentTime = pendingSeekSecondsRef.current;
                pendingSeekSecondsRef.current = null;
                e.currentTarget.play().catch(() => {});
              }
            }}
            style={{
              flex: 1,
              width: '100%',
              minWidth: 0,
              height: '28px',
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0,
            }}
          >
            <button
              className="toolbar-btn"
              style={{
                padding: '3px 7px',
                fontSize: '13px',
                lineHeight: 1,
              }}
              onClick={() => showInExplorer(directCallPlayInfo.fullPath)}
              title="파일 위치 열기"
            >
              📂
            </button>
            <button
              className="toolbar-btn"
              style={{
                padding: '3px 7px',
                fontSize: '13px',
                lineHeight: 1,
              }}
              onClick={() => {
                if (directCallPlayInfo?.audioUrl?.startsWith('blob:')) {
                  URL.revokeObjectURL(directCallPlayInfo.audioUrl);
                }
                setDirectCallPlayInfo(null);
                setActiveAudioLineIndex(null);
              }}
              title="닫기"
            >
              ✕
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {statusMessage}
          </div>

          {scanProgress && scanProgress.totalFiles > 0 && (
            <div className="scan-progress-container">
              <div className="scan-progress-track">
                <div
                  className="scan-progress-base-fill"
                  style={{ width: `${scanProgress.startPercent}%` }}
                />
                <div
                  className="scan-progress-active-fill"
                  style={{ width: `${scanProgress.currentPercent}%` }}
                />
              </div>
              <div className="scan-progress-meta">
                <span style={{ color: '#4ade80', fontWeight: 700 }}>
                  {scanProgress.currentPercent.toFixed(1)}%
                </span>
                <span>
                  ({scanProgress.completedFiles}/{scanProgress.totalFiles})
                </span>
                {scanProgress.isRunning && (
                  <span style={{ color: '#fbbf24' }}>
                    남은시간: 약 {scanProgress.etaSeconds.toFixed(1)}초
                  </span>
                )}
              </div>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0,
            }}
          >
            {trashHistory.length > 0 && (
              <button
                className="toolbar-btn"
                style={{
                  padding: '2px 8px',
                  fontSize: '11px',
                  borderColor: '#f59e0b',
                  color: '#fbbf24',
                }}
                onClick={() => handleRestoreTrashedDocument()}
                title="휴지통으로 이동한 파일 복구 (Ctrl+Z)"
              >
                ↩ 휴지통 되돌리기 ({trashHistory.length})
              </button>
            )}
            <span>자동저장: {autoSaveEnabled ? 'ON' : 'OFF'}</span>
            <span>포트: 18443</span>
          </div>
        </>
      )}
    </footer>
  );
}
