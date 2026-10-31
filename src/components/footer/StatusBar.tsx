/**
 * @file StatusBar.tsx
 * @description 하단 상태 표시줄: 일괄 UUID 스캔 진행률 바, 통화 녹음 `<audio>` 플레이어 바(기본 1.75x 배속 및 시점 이동 동기화),
 * AI 잔여 백분율(`AI: 93.1%`), 휴지통 복구 버튼, 상태창 우클릭 표시 항목 설정 메뉴.
 */
import React, { useEffect, useState } from 'react';
import {
  DirectCallPlayInfo,
  GeminiApiKeyStatus,
  MyLoreAppSettings,
  ScanProgressPayload,
  TrashedFileRecord,
} from '../../types/mylore';
import { showInExplorer } from '../../services/tauriClient';
import {
  calculateAiRemainingPercent,
  parseAiQuotaRetryInfo,
} from '../../utils/appearancePresets';

export interface StatusBarProps {
  directCallPlayInfo: DirectCallPlayInfo | null;
  setDirectCallPlayInfo: React.Dispatch<React.SetStateAction<DirectCallPlayInfo | null>>;
  setActiveAudioLineIndex: React.Dispatch<React.SetStateAction<number | null>>;
  callAudioRef: React.MutableRefObject<HTMLAudioElement | null>;
  pendingSeekSecondsRef: React.MutableRefObject<number | null>;
  handleAudioTimeUpdate: (
    eOrForce?: React.SyntheticEvent<HTMLAudioElement> | boolean
  ) => void;
  statusMessage: string;
  scanProgress: ScanProgressPayload | null;
  trashHistory: TrashedFileRecord[];
  handleRestoreTrashedDocument: () => void;
  autoSaveEnabled: boolean;
  appSettings?: MyLoreAppSettings;
  geminiStatus?: GeminiApiKeyStatus | null;
  handleUpdateAppSettings?: (partial: Partial<MyLoreAppSettings>) => Promise<void>;
}

const PLAYBACK_SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

function parseRetryAfterInfo(
  retryAfterAt: string | undefined,
  nowMs: number
): { isActive: boolean; shortText: string } {
  if (!retryAfterAt) return { isActive: false, shortText: '' };
  const trimmed = retryAfterAt.trim();
  if (!trimmed) return { isActive: false, shortText: '' };
  const m = trimmed.match(
    /^(\d{4})-(\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?/
  );
  if (!m) return { isActive: false, shortText: '' };
  const isoLocal = `${m[1]}-${m[2]}T${m[3]}:${m[4] || '00'}`;
  const targetMs = new Date(isoLocal).getTime();
  if (!Number.isFinite(targetMs) || nowMs >= targetMs) {
    return { isActive: false, shortText: '' };
  }
  return { isActive: true, shortText: `${m[2]} ${m[3]}` };
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
  appSettings,
  geminiStatus,
  handleUpdateAppSettings,
}: StatusBarProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!geminiStatus?.retryAfterAt) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15000);
    return () => window.clearInterval(timer);
  }, [geminiStatus?.retryAfterAt]);

  useEffect(() => {
    if (!menuPos) return;
    const closeMenu = () => setMenuPos(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [menuPos]);

  const playbackSpeed = appSettings?.callPlaybackSpeed || 1.75;

  useEffect(() => {
    const audioEl = callAudioRef.current;
    if (!audioEl) return;
    audioEl.defaultPlaybackRate = playbackSpeed;
    audioEl.playbackRate = playbackSpeed;
  }, [playbackSpeed, directCallPlayInfo?.audioUrl, callAudioRef]);

  const showAi = appSettings?.statusBarShowAi !== false;
  const showTrash = appSettings?.statusBarShowTrash !== false;
  const showAutoSave = appSettings?.statusBarShowAutoSave !== false;
  const showPort = appSettings?.statusBarShowPort !== false;

  const dailyLimit = appSettings?.aiDailyTokenLimit || 1000000;
  const todayUsed = geminiStatus?.todayUsedTokens || 0;
  const retryInfo = parseAiQuotaRetryInfo(geminiStatus?.retryAfterAt, nowMs);
  const aiPctText = calculateAiRemainingPercent(
    todayUsed,
    dailyLimit,
    geminiStatus?.retryAfterAt
  );
  const numericPct = parseFloat(aiPctText);
  const aiBadgeTone =
    retryInfo.isActive || numericPct <= 15
      ? 'low'
      : numericPct <= 40
        ? 'warn'
        : '';
  const aiDisplayText = retryInfo.isActive ? retryInfo.shortText : aiPctText;

  const toggleItem = (key: keyof MyLoreAppSettings, currentVal: boolean) => {
    if (!handleUpdateAppSettings) return;
    void handleUpdateAppSettings({ [key]: !currentVal });
  };

  return (
    <>
      <footer
        className="statusbar"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const menuWidth = 220;
          const menuHeight = 165;
          const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
          const y = Math.max(10, e.clientY - menuHeight);
          setMenuPos({ x, y });
        }}
        title="우클릭하여 상태창 표시 항목을 설정할 수 있습니다"
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
              onSeeked={() => handleAudioTimeUpdate(true)}
              onPlay={(e) => {
                e.currentTarget.defaultPlaybackRate = playbackSpeed;
                e.currentTarget.playbackRate = playbackSpeed;
                handleAudioTimeUpdate(true);
              }}
              onLoadedMetadata={(e) => {
                e.currentTarget.defaultPlaybackRate = playbackSpeed;
                e.currentTarget.playbackRate = playbackSpeed;
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
              <select
                className="task-status-select"
                style={{
                  padding: '2px 5px',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  height: '24px',
                }}
                value={String(playbackSpeed)}
                onChange={(e) => {
                  const nextSpd = parseFloat(e.target.value) || 1.75;
                  if (callAudioRef.current) {
                    callAudioRef.current.defaultPlaybackRate = nextSpd;
                    callAudioRef.current.playbackRate = nextSpd;
                  }
                  if (handleUpdateAppSettings) {
                    void handleUpdateAppSettings({
                      callPlaybackSpeed: nextSpd,
                    });
                  }
                }}
                title="통화 녹음 기본 재생 속도 설정 (기본 1.75x)"
              >
                {PLAYBACK_SPEED_OPTIONS.map((spd) => (
                  <option key={spd} value={String(spd)}>
                    {spd}x
                  </option>
                ))}
              </select>
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
              {showTrash && trashHistory.length > 0 && (
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
              {showAi && (
                <span
                  className={`statusbar-ai-badge ${
                    retryInfo.isActive ? 'low' : aiBadgeTone
                  }`}
                  title={
                    retryInfo.isActive
                      ? `AI 5시간 쿼터 락 대기 중 (해제 예정: ${geminiStatus?.retryAfterAt}) — 락 해제 전까지 사용량 유지: ${todayUsed.toLocaleString('ko-KR')} / ${dailyLimit.toLocaleString('ko-KR')} 토큰 (${geminiStatus?.todayRequestCount || 0}회 호출)`
                      : `금일 AI 토큰 사용량: ${todayUsed.toLocaleString('ko-KR')} / ${dailyLimit.toLocaleString('ko-KR')} 토큰 (${geminiStatus?.todayRequestCount || 0}회 호출)`
                  }
                >
                  AI: {aiDisplayText}
                </span>
              )}
              {showAutoSave && (
                <span>자동저장: {autoSaveEnabled ? 'ON' : 'OFF'}</span>
              )}
              {showPort && <span>포트: 18443</span>}
            </div>
          </>
        )}
      </footer>

      {menuPos && (
        <div
          className="statusbar-context-menu"
          style={{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="statusbar-context-header">
            상태창 표시 항목 설정
          </div>
          <button
            type="button"
            className="statusbar-context-item"
            onClick={() => toggleItem('statusBarShowAi', showAi)}
          >
            <span>{showAi ? '☑️' : '⬜'}</span>
            <span>AI 잔여 백분율 (AI: {aiDisplayText})</span>
          </button>
          <button
            type="button"
            className="statusbar-context-item"
            onClick={() => toggleItem('statusBarShowTrash', showTrash)}
          >
            <span>{showTrash ? '☑️' : '⬜'}</span>
            <span>휴지통 되돌리기</span>
          </button>
          <button
            type="button"
            className="statusbar-context-item"
            onClick={() => toggleItem('statusBarShowAutoSave', showAutoSave)}
          >
            <span>{showAutoSave ? '☑️' : '⬜'}</span>
            <span>자동저장 상태</span>
          </button>
          <button
            type="button"
            className="statusbar-context-item"
            onClick={() => toggleItem('statusBarShowPort', showPort)}
          >
            <span>{showPort ? '☑️' : '⬜'}</span>
            <span>서버 포트 (18443)</span>
          </button>
        </div>
      )}
    </>
  );
}
