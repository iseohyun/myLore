/**
 * @file StatusBar.tsx
 * @description 하단 상태 표시줄: 일괄 UUID 스캔 진행률 바, 통화 녹음 `<audio>` 플레이어 바(기본 1.75x 배속 및 시점 이동 동기화),
 * AI 잔여 백분율(`AI: 93.1%`), 휴지통 복구 버튼, 상태창 우클릭 표시 항목 설정 메뉴.
 */
import React, { useEffect, useState } from 'react';
import {
  DirectCallPlayInfo,
  GeminiApiKeyStatus,
  MultiLlmProvidersStatus,
  MyLoreAppSettings,
  ScanProgressPayload,
  TrashedFileRecord,
} from '../../types/mylore';
import {
  getMultiLlmProvidersStatus,
  openExternalUrlInChrome,
  showInExplorer,
} from '../../services/tauriClient';
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
  const [multiLlmStatus, setMultiLlmStatus] =
    useState<MultiLlmProvidersStatus | null>(null);

  useEffect(() => {
    const refreshMulti = () => {
      getMultiLlmProvidersStatus()
        .then(setMultiLlmStatus)
        .catch(() => {});
    };
    refreshMulti();
    window.addEventListener('mylore-multi-llm-updated', refreshMulti);
    const interval = window.setInterval(refreshMulti, 30000);
    return () => {
      window.removeEventListener('mylore-multi-llm-updated', refreshMulti);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
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

  const showGemini = appSettings?.statusBarShowGemini !== false;
  const showClaude = appSettings?.statusBarShowClaude !== false;
  const showOpenai = appSettings?.statusBarShowOpenai !== false;
  const showGrok = appSettings?.statusBarShowGrok !== false;
  const showTrash = appSettings?.statusBarShowTrash !== false;
  const showAutoSave = appSettings?.statusBarShowAutoSave !== false;
  const showPort = appSettings?.statusBarShowPort !== false;

  const dailyLimit = appSettings?.aiDailyTokenLimit || 1000000;

  const buildProviderBadgeMeta = (
    key: 'gemini' | 'claude' | 'openai' | 'grok',
    label: string,
    color: string,
    settingKey:
      | 'statusBarShowGemini'
      | 'statusBarShowClaude'
      | 'statusBarShowOpenai'
      | 'statusBarShowGrok',
    visible: boolean,
    hasKey: boolean,
    todayTokens: number,
    todayReqs: number,
    retryAfterAt: string | undefined,
    lastError: string | undefined,
    usageUrl: string,
    creditDisplayText?: string,
    remainingCreditUsd?: number,
    creditExhausted?: boolean
  ) => {
    const rawRetry = parseAiQuotaRetryInfo(retryAfterAt, nowMs);
    const pctText = calculateAiRemainingPercent(
      todayTokens,
      dailyLimit,
      retryAfterAt
    );
    const numPct = parseFloat(pctText);
    const fallbackLockStr = (() => {
      const d = new Date(nowMs + 5 * 3600 * 1000);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${mm}-${dd} ${hh}:${mi}`;
    })();
    const isPaidProvider = key !== 'gemini';
    const effectiveRetryActive = isPaidProvider
      ? false
      : (rawRetry.isActive && (todayTokens > 0 || todayReqs > 0)) ||
        (hasKey && todayTokens >= dailyLimit);
    const effectiveShortText =
      rawRetry.isActive && rawRetry.shortText
        ? rawRetry.shortText
        : fallbackLockStr;

    const isZeroCredit =
      isPaidProvider &&
      (Boolean(creditExhausted) ||
        creditDisplayText === '0$' ||
        (remainingCreditUsd !== undefined && remainingCreditUsd <= 0.0001) ||
        Boolean(
          lastError &&
            /no credits|insufficient_quota|credit balance|exhausted|exceeded your current quota|billing|prepaid/i.test(
              lastError
            )
        ));

    const paidDollarStr = isZeroCredit
      ? '0$'
      : creditDisplayText ||
        `${(remainingCreditUsd !== undefined ? remainingCreditUsd : 5.0).toFixed(2)}$`;

    const tone: '' | 'warn' | 'low' = !hasKey
      ? ''
      : isPaidProvider
        ? isZeroCredit ||
          (remainingCreditUsd !== undefined && remainingCreditUsd <= 0.5)
          ? 'low'
          : remainingCreditUsd !== undefined && remainingCreditUsd <= 1.5
            ? 'warn'
            : ''
        : effectiveRetryActive || numPct <= 15
          ? 'low'
          : numPct <= 40
            ? 'warn'
            : '';

    const displayValue = !hasKey
      ? '미등록'
      : isPaidProvider
        ? paidDollarStr
        : effectiveRetryActive
          ? effectiveShortText
          : pctText;

    return {
      key,
      label,
      color,
      settingKey,
      visible,
      hasKey,
      todayTokens,
      todayReqs,
      retryAfterAt,
      lastError,
      usageUrl,
      isLocked: effectiveRetryActive,
      isZeroCredit,
      tone,
      displayValue,
    };
  };

  const providerBadges = [
    buildProviderBadgeMeta(
      'gemini',
      'Gemini',
      '#4285F4',
      'statusBarShowGemini',
      showGemini,
      Boolean(geminiStatus?.hasKey),
      geminiStatus?.todayUsedTokens || 0,
      geminiStatus?.todayRequestCount || 0,
      geminiStatus?.retryAfterAt,
      geminiStatus?.lastQuotaError,
      'https://aistudio.google.com/app/plan_information'
    ),
    buildProviderBadgeMeta(
      'claude',
      'Claude',
      '#D97757',
      'statusBarShowClaude',
      showClaude,
      Boolean(multiLlmStatus?.claude?.hasKey),
      multiLlmStatus?.claude?.todayUsedTokens || 0,
      multiLlmStatus?.claude?.todayRequestCount || 0,
      multiLlmStatus?.claude?.retryAfterAt || undefined,
      multiLlmStatus?.claude?.lastError,
      'https://console.anthropic.com/settings/billing',
      multiLlmStatus?.claude?.creditDisplayText,
      multiLlmStatus?.claude?.remainingCreditUsd,
      multiLlmStatus?.claude?.creditExhausted
    ),
    buildProviderBadgeMeta(
      'openai',
      'OpenAI',
      '#10A37F',
      'statusBarShowOpenai',
      showOpenai,
      Boolean(multiLlmStatus?.openai?.hasKey),
      multiLlmStatus?.openai?.todayUsedTokens || 0,
      multiLlmStatus?.openai?.todayRequestCount || 0,
      multiLlmStatus?.openai?.retryAfterAt || undefined,
      multiLlmStatus?.openai?.lastError,
      'https://platform.openai.com/usage',
      multiLlmStatus?.openai?.creditDisplayText,
      multiLlmStatus?.openai?.remainingCreditUsd,
      multiLlmStatus?.openai?.creditExhausted
    ),
    buildProviderBadgeMeta(
      'grok',
      'Grok',
      '#A855F7',
      'statusBarShowGrok',
      showGrok,
      Boolean(multiLlmStatus?.grok?.hasKey),
      multiLlmStatus?.grok?.todayUsedTokens || 0,
      multiLlmStatus?.grok?.todayRequestCount || 0,
      multiLlmStatus?.grok?.retryAfterAt || undefined,
      multiLlmStatus?.grok?.lastError,
      'https://console.x.ai/',
      multiLlmStatus?.grok?.creditDisplayText,
      multiLlmStatus?.grok?.remainingCreditUsd,
      multiLlmStatus?.grok?.creditExhausted
    ),
  ];

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
          const menuWidth = 390;
          const menuHeight = 290;
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
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexWrap: 'nowrap',
                }}
              >
                {providerBadges
                  .filter((p) => p.visible)
                  .map((p) => (
                    <span
                      key={p.key}
                      className={`statusbar-ai-badge ${p.tone}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title={
                        p.isLocked
                          ? `[${p.label}] 5시간 대기 락 중 (해제 예정: ${p.retryAfterAt}) — 금일 요청 토큰: ${p.todayTokens.toLocaleString('ko-KR')} 토큰 (${p.todayReqs}회)${p.lastError ? `\n사유: ${p.lastError}` : ''}\n(우클릭하여 ON/OFF 및 Usage 페이지 바로가기)`
                          : `[${p.label}] 금일 요청 토큰: ${p.todayTokens.toLocaleString('ko-KR')} / ${dailyLimit.toLocaleString('ko-KR')} 토큰 (${p.todayReqs}회 호출)\n(우클릭하여 ON/OFF 및 Usage 페이지 바로가기)`
                      }
                    >
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          backgroundColor: p.color,
                          display: 'inline-block',
                        }}
                      />
                      <span>
                        {p.label}:{p.displayValue}
                      </span>
                    </span>
                  ))}
              </div>
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
          style={{
            left: `${menuPos.x}px`,
            top: `${menuPos.y}px`,
            minWidth: '380px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="statusbar-context-header">
            🤖 4대 LLM 경고창 개별 표시 · 금일 토큰 · Usage 바로가기
          </div>
          {providerBadges.map((p) => (
            <div
              key={p.key}
              className="statusbar-context-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                cursor: 'default',
              }}
            >
              <button
                type="button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '12px',
                  fontWeight: 700,
                }}
                onClick={() => toggleItem(p.settingKey, p.visible)}
                title={`${p.label} 상태창 배지 표시 ON/OFF 전환`}
              >
                <span>{p.visible ? '☑️' : '⬜'}</span>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: p.color,
                    display: 'inline-block',
                  }}
                />
                <span>
                  {p.label} ({p.displayValue})
                </span>
              </button>

              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '11.5px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>
                  금일{' '}
                  <strong style={{ color: '#e2e8f0' }}>
                    {p.todayTokens.toLocaleString('ko-KR')}
                  </strong>{' '}
                  토큰 ({p.todayReqs}회)
                </span>
                <button
                  type="button"
                  className="toolbar-btn"
                  style={{
                    padding: '2px 7px',
                    fontSize: '11px',
                    lineHeight: 1.2,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openExternalUrlInChrome(p.usageUrl);
                    setMenuPos(null);
                  }}
                  title={`${p.label} 공식 API Usage / Billing 페이지 열기`}
                >
                  ↗ Usage
                </button>
              </div>
            </div>
          ))}

          <div
            className="statusbar-context-header"
            style={{
              marginTop: '6px',
              borderTop: '1px solid var(--border-color)',
              paddingTop: '6px',
            }}
          >
            상태창 기타 표시 항목
          </div>
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
