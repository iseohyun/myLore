/**
 * @file LifelogMobileDataTab.tsx
 * @description 라이프로그 대시보드 [💬 대화] 탭(카톡·문자·통화 3탭) 및 [📊 모니터링] 하위(M로그·헬스) 테이블 뷰.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  CallAiDailyStat,
  CallAiTranscriptionStats,
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
} from '../../types/mylore';
import { getCallAiTranscriptionStats } from '../../services/tauriClient';
import {
  formatLifelogEventTime,
  getEffectiveCallTranscriptStage,
} from '../sidebar/MobileLifelogSidebar';
import {
  CallPromptManagerPanel,
  LocationMovementTrackerPanel,
} from './LifelogMilestonePanels';

export interface LifelogMobileDataTabProps {
  mobilePersonFilter: string;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  mobileSourceFilter: 'all' | LifelogSourceType;
  setMobileSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  mobileSidebarTab?: LifelogSourceType;
  setMobileSidebarTab?: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  fixedSource?: 'notification' | 'health';
  allLifelogMessages: LifelogMessage[];
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  resolveContactName: (rawNumberOrName: string) => string;
}

const SOURCE_LABEL_MAP: Record<string, string> = {
  kakaotalk: '카톡',
  notification: 'M로그',
  sms: '문자',
  call: '통화',
  recording: '녹음',
  health: '헬스',
  media: '사진/영상',
  contacts: '연락처',
  pc_log: 'PC로그',
};

const CHAT_SOURCES = new Set<LifelogSourceType>(['kakaotalk', 'sms', 'call']);

function formatBytesSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function LifelogMobileDataTab({
  mobilePersonFilter,
  setMobilePersonFilter,
  mobileSourceFilter,
  setMobileSourceFilter,
  mobileSidebarTab,
  setMobileSidebarTab,
  fixedSource,
  allLifelogMessages,
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  resolveContactName,
}: LifelogMobileDataTabProps) {
  const effectiveSource: 'all' | LifelogSourceType = fixedSource
    ? fixedSource
    : mobileSourceFilter === 'all' || CHAT_SOURCES.has(mobileSourceFilter)
      ? mobileSourceFilter
      : mobileSidebarTab && CHAT_SOURCES.has(mobileSidebarTab)
        ? mobileSidebarTab
        : 'kakaotalk';

  const baseMessages = useMemo(() => {
    if (fixedSource) {
      return allLifelogMessages.filter((m) => m.source === fixedSource);
    }
    return allLifelogMessages.filter((m) => CHAT_SOURCES.has(m.source));
  }, [allLifelogMessages, fixedSource]);

  const filteredMsgs = useMemo(() => {
    const q = mobilePersonFilter.trim().toLowerCase();
    return baseMessages.filter((m) => {
      if (
        !fixedSource &&
        effectiveSource !== 'all' &&
        m.source !== effectiveSource
      ) {
        return false;
      }
      if (!q) return true;
      return (
        (m.roomOrSender || '').toLowerCase().includes(q) ||
        (m.sender || '').toLowerCase().includes(q) ||
        (m.message || '').toLowerCase().includes(q)
      );
    });
  }, [baseMessages, mobilePersonFilter, effectiveSource, fixedSource]);

  const [callAiStats, setCallAiStats] =
    useState<CallAiTranscriptionStats | null>(null);

  useEffect(() => {
    if (effectiveSource !== 'call') return;
    let cancelled = false;
    getCallAiTranscriptionStats()
      .then((res) => {
        if (!cancelled) setCallAiStats(res);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [effectiveSource, allLifelogMessages]);

  const callProgressSummary = useMemo(() => {
    if (effectiveSource !== 'call') return null;

    let fbCompleted = 0;
    let fbRemaining = 0;
    const seen = new Set<string>();
    for (const m of allLifelogMessages) {
      if (m.source !== 'call' || !m.hasAudioRecording) continue;
      const key = `${m.sentDate}-${m.sentTime}-${m.roomOrSender}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const st = getEffectiveCallTranscriptStage(m);
      if (st === 2 || st === 4) fbCompleted += 1;
      else if (st === 1 || st === 3) fbRemaining += 1;
    }
    const fbTotal = fbCompleted + fbRemaining;

    const totalCalls =
      callAiStats && callAiStats.totalAudioCalls > 0
        ? callAiStats.totalAudioCalls
        : fbTotal;
    const completedCalls =
      callAiStats && callAiStats.totalAudioCalls > 0
        ? callAiStats.completedCalls
        : fbCompleted;
    const remainingCalls =
      callAiStats && callAiStats.totalAudioCalls > 0
        ? callAiStats.remainingCalls
        : fbRemaining;

    const totalAudioBytes = callAiStats?.totalAudioBytes ?? 0;
    const completedAudioBytes = callAiStats?.completedAudioBytes ?? 0;
    const remainingAudioBytes = callAiStats?.remainingAudioBytes ?? 0;

    // 진행률도 용량 기준으로 산정 (용량 정보가 없으면 건수 폴백)
    const progressNum =
      totalAudioBytes > 0
        ? (completedAudioBytes / totalAudioBytes) * 100
        : totalCalls > 0
          ? (completedCalls / totalCalls) * 100
          : 100;
    const progressPct = progressNum.toFixed(1);

    const korWeekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const dailyStats: CallAiDailyStat[] =
      callAiStats?.dailyStats && callAiStats.dailyStats.length > 0
        ? callAiStats.dailyStats
        : Array.from({ length: 7 }, (_, idx) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - idx));
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return {
              date: `${yyyy}-${mm}-${dd}`,
              label: `${mm}-${dd}(${korWeekdays[d.getDay()]})`,
              count: 0,
              geminiCount: 0,
              claudeCount: 0,
              openaiCount: 0,
              grokCount: 0,
              totalBytes: 0,
              geminiBytes: 0,
              claudeBytes: 0,
              openaiBytes: 0,
              grokBytes: 0,
            };
          });

    // 전체 4개사 최근 7일 용량 및 건수 합계
    const totalWeekBytes = dailyStats.reduce(
      (acc, d) => acc + (d.totalBytes ?? 0),
      0
    );
    const totalWeekConverted = dailyStats.reduce((acc, d) => acc + d.count, 0);

    // 완료시기(ETA) 산정: 3사(Claude/OpenAI/Grok) 추가구매는 가정하지 않고,
    // 무료 일일 할당량이 매일 충전되는 Gemini의 일평균 처리 용량(0인 날짜 제외)을 기준으로 산정
    const geminiActiveDays = dailyStats.filter(
      (d) => (d.geminiBytes ?? 0) > 0 || (d.geminiCount ?? 0) > 0
    );
    const totalGeminiWeekBytes = geminiActiveDays.reduce(
      (acc, d) => acc + (d.geminiBytes ?? 0),
      0
    );
    const totalGeminiWeekCount = geminiActiveDays.reduce(
      (acc, d) => acc + (d.geminiCount ?? 0),
      0
    );
    const geminiAvgBytesPerDay =
      geminiActiveDays.length > 0
        ? totalGeminiWeekBytes / geminiActiveDays.length
        : 0;
    const geminiAvgCountPerDay =
      geminiActiveDays.length > 0
        ? totalGeminiWeekCount / geminiActiveDays.length
        : 0;

    let etaText = 'Gemini 최근 7일 변환 이력 없음';
    if (remainingAudioBytes <= 0 && remainingCalls <= 0) {
      etaText = '모두 완료됨';
    } else if (geminiAvgBytesPerDay > 0 && remainingAudioBytes > 0) {
      const remainingDays = remainingAudioBytes / geminiAvgBytesPerDay;
      const etaDate = new Date(
        Date.now() + remainingDays * 24 * 60 * 60 * 1000
      );
      const ey = etaDate.getFullYear();
      const em = etaDate.getMonth() + 1;
      const ed = etaDate.getDate();
      const edow = korWeekdays[etaDate.getDay()];
      const eh = String(etaDate.getHours()).padStart(2, '0');
      etaText = `${ey}-${em}-${ed}(${edow}) ${eh}시 종료 예상`;
    } else if (geminiAvgCountPerDay > 0 && remainingCalls > 0) {
      const remainingDays = remainingCalls / geminiAvgCountPerDay;
      const etaDate = new Date(
        Date.now() + remainingDays * 24 * 60 * 60 * 1000
      );
      const ey = etaDate.getFullYear();
      const em = etaDate.getMonth() + 1;
      const ed = etaDate.getDate();
      const edow = korWeekdays[etaDate.getDay()];
      const eh = String(etaDate.getHours()).padStart(2, '0');
      etaText = `${ey}-${em}-${ed}(${edow}) ${eh}시 종료 예상`;
    }

    const maxDailyBytes = Math.max(
      1,
      ...dailyStats.map((d) => d.totalBytes ?? 0)
    );
    const maxDailyCount = Math.max(1, ...dailyStats.map((d) => d.count));

    return {
      totalCalls,
      completedCalls,
      remainingCalls,
      totalAudioBytes,
      completedAudioBytes,
      remainingAudioBytes,
      progressNum,
      progressPct,
      dailyStats,
      geminiActiveDaysCount: geminiActiveDays.length,
      totalWeekBytes,
      totalWeekConverted,
      geminiAvgBytesPerDay,
      geminiAvgCountPerDay,
      etaText,
      maxDailyBytes,
      maxDailyCount,
    };
  }, [effectiveSource, callAiStats, allLifelogMessages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {!fixedSource && (
            <div style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
              {(
                [
                  { key: 'kakaotalk', label: '💬 카톡' },
                  { key: 'sms', label: '✉️ 문자' },
                  { key: 'call', label: '📞 통화' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.key}
                  className={`toolbar-btn ${
                    effectiveSource === cat.key ? 'primary' : ''
                  }`}
                  style={{
                    padding: '5px 14px',
                    fontSize: '12.5px',
                    fontWeight: 700,
                  }}
                  onClick={() => {
                    setMobileSourceFilter(cat.key);
                    setMobileSidebarTab?.(cat.key);
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}

          <span style={{ fontWeight: 700, fontSize: '13px', marginLeft: fixedSource ? '0' : '6px' }}>
            🔍 인물/키워드 검색:
          </span>
          <input
            className="input-field"
            style={{ width: '200px' }}
            value={mobilePersonFilter}
            onChange={(e) => setMobilePersonFilter(e.target.value)}
            placeholder="예: 임현정, 캠핑..."
          />
          {mobilePersonFilter && (
            <button
              className="toolbar-btn"
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => {
                setMobilePersonFilter('');
              }}
            >
              ✕ 검색어 해제
            </button>
          )}
        </div>
      </div>

      {mobilePersonFilter && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(79, 70, 229, 0.16)',
            border: '1px solid var(--accent-primary)',
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 700, color: '#c7d2fe' }}>
            📌 &lsquo;{mobilePersonFilter}&rsquo;님과의{' '}
            {effectiveSource === 'all'
              ? '모든 대화 (카톡·문자·통화)'
              : `'${SOURCE_LABEL_MAP[effectiveSource] || effectiveSource}'`}{' '}
            검색 결과
          </span>
          <button
            className="toolbar-btn"
            style={{ padding: '2px 8px', fontSize: '11.5px' }}
            onClick={() => {
              setMobilePersonFilter('');
            }}
          >
            전체 보기로 복귀
          </button>
        </div>
      )}

      <div>
        {fixedSource === 'notification' && <LocationMovementTrackerPanel />}

        {effectiveSource === 'call' && (
          <CallPromptManagerPanel compactInDashboard={true} />
        )}

        {effectiveSource === 'call' && callProgressSummary && (
          <div
            style={{
              padding: '14px 16px',
              marginBottom: '12px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
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
                style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}
                title={`전체 통화 건수: 완료 ${callProgressSummary.completedCalls}건 / 전체 ${callProgressSummary.totalCalls}건 (남은 통화 ${callProgressSummary.remainingCalls}건)\n최근 7일 전체 변환: ${callProgressSummary.totalWeekConverted}건 (${formatBytesSize(callProgressSummary.totalWeekBytes)})\nGemini 일평균(0일 제외 ${callProgressSummary.geminiActiveDaysCount}일): ${formatBytesSize(callProgressSummary.geminiAvgBytesPerDay)}/일 (${callProgressSummary.geminiAvgCountPerDay.toFixed(1)}건/일)`}
              >
                <span
                  style={{
                    fontSize: '13.5px',
                    fontWeight: 700,
                    color: 'var(--heading-color)',
                  }}
                >
                  📊 최근 일주일 AI 변환 통화 수 및 진행 현황 (용량 기준 · 마우스오버 시 건수 표시)
                </span>
                <span
                  style={{
                    fontSize: '11.5px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  완료 {formatBytesSize(callProgressSummary.completedAudioBytes)} / 전체 녹음{' '}
                  {formatBytesSize(callProgressSummary.totalAudioBytes)} · 남은 용량{' '}
                  <strong style={{ color: '#fca5a5' }}>
                    {formatBytesSize(callProgressSummary.remainingAudioBytes)}
                  </strong>{' '}
                  · 최근 7일 변환 {formatBytesSize(callProgressSummary.totalWeekBytes)} (3사 추가구매 제외 · Gemini 0일 제외{' '}
                  {callProgressSummary.geminiActiveDaysCount}일 평균{' '}
                  {formatBytesSize(callProgressSummary.geminiAvgBytesPerDay)}/일 기준 산정)
                </span>
              </div>
              <div
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(99, 102, 241, 0.16)',
                  border: '1px solid rgba(129, 140, 248, 0.4)',
                  fontSize: '13px',
                  fontWeight: 800,
                  color: '#e0e7ff',
                  fontFamily: 'var(--font-mono)',
                }}
                title={`완료 건수: ${callProgressSummary.completedCalls}건 / 전체 ${callProgressSummary.totalCalls}건 (남은 건수: ${callProgressSummary.remainingCalls}건)\nGemini 일평균 처리량(${formatBytesSize(callProgressSummary.geminiAvgBytesPerDay)}/일, ${callProgressSummary.geminiAvgCountPerDay.toFixed(1)}건/일) 기준 산정`}
              >
                작업진행률({callProgressSummary.progressPct}%,{' '}
                {callProgressSummary.etaText})
              </div>
            </div>

            <div
              style={{
                width: '100%',
                height: '7px',
                borderRadius: '999px',
                backgroundColor: 'rgba(148, 163, 184, 0.18)',
                overflow: 'hidden',
              }}
              title={`완료: ${formatBytesSize(callProgressSummary.completedAudioBytes)} (${callProgressSummary.completedCalls}건) / 남은 용량: ${formatBytesSize(callProgressSummary.remainingAudioBytes)} (${callProgressSummary.remainingCalls}건)`}
            >
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, callProgressSummary.progressNum))}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #6366f1, #34d399)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                paddingTop: '4px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  flexWrap: 'wrap',
                  fontSize: '11.5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                }}
              >
                {(
                  [
                    {
                      key: 'gemini',
                      label: 'Gemini (Google)',
                      color: '#4285F4',
                      totalBytes: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.geminiBytes ?? 0),
                        0
                      ),
                      totalCount: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.geminiCount ?? d.count),
                        0
                      ),
                    },
                    {
                      key: 'claude',
                      label: 'Claude (Anthropic)',
                      color: '#D97757',
                      totalBytes: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.claudeBytes ?? 0),
                        0
                      ),
                      totalCount: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.claudeCount ?? 0),
                        0
                      ),
                    },
                    {
                      key: 'openai',
                      label: 'OpenAI (GPT)',
                      color: '#10A37F',
                      totalBytes: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.openaiBytes ?? 0),
                        0
                      ),
                      totalCount: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.openaiCount ?? 0),
                        0
                      ),
                    },
                    {
                      key: 'grok',
                      label: 'Grok (xAI)',
                      color: '#A855F7',
                      totalBytes: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.grokBytes ?? 0),
                        0
                      ),
                      totalCount: callProgressSummary.dailyStats.reduce(
                        (s, d) => s + (d.grokCount ?? 0),
                        0
                      ),
                    },
                  ] as const
                ).map((prov) => (
                  <span
                    key={prov.key}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      cursor: 'help',
                    }}
                    title={`${prov.label}: 최근 7일 총 ${prov.totalCount}건 변환 (${formatBytesSize(prov.totalBytes)})`}
                  >
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '2px',
                        backgroundColor: prov.color,
                        display: 'inline-block',
                      }}
                    />
                    <span>
                      {prov.label}: <strong>{formatBytesSize(prov.totalBytes)}</strong>
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gap: '8px',
                alignItems: 'end',
                height: '116px',
                paddingTop: '10px',
                borderTop: '1px dashed rgba(148, 163, 184, 0.2)',
              }}
            >
              {callProgressSummary.dailyStats.map((day) => {
                const dayBytes = day.totalBytes ?? 0;
                const isZero = dayBytes === 0 && day.count === 0;
                const barHeightPx = isZero
                  ? 4
                  : Math.max(
                      12,
                      Math.round(
                        (dayBytes > 0
                          ? dayBytes / callProgressSummary.maxDailyBytes
                          : day.count / callProgressSummary.maxDailyCount) * 72
                      )
                    );
                const gCnt =
                  day.geminiCount !== undefined ? day.geminiCount : day.count;
                const cCnt = day.claudeCount ?? 0;
                const oCnt = day.openaiCount ?? 0;
                const xCnt = day.grokCount ?? 0;

                const gBytes = day.geminiBytes ?? 0;
                const cBytes = day.claudeBytes ?? 0;
                const oBytes = day.openaiBytes ?? 0;
                const xBytes = day.grokBytes ?? 0;

                const segments = [
                  {
                    key: 'gemini',
                    label: 'Gemini',
                    count: gCnt,
                    bytes: gBytes,
                    color: '#4285F4',
                  },
                  {
                    key: 'claude',
                    label: 'Claude',
                    count: cCnt,
                    bytes: cBytes,
                    color: '#D97757',
                  },
                  {
                    key: 'openai',
                    label: 'OpenAI',
                    count: oCnt,
                    bytes: oBytes,
                    color: '#10A37F',
                  },
                  {
                    key: 'grok',
                    label: 'Grok',
                    count: xCnt,
                    bytes: xBytes,
                    color: '#A855F7',
                  },
                ].filter((s) => s.bytes > 0 || s.count > 0);

                const breakdownTooltip = segments
                  .map(
                    (s) =>
                      `${s.label}: ${s.count}건 (${formatBytesSize(s.bytes)})`
                  )
                  .join(' / ');

                return (
                  <div
                    key={day.date}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      height: '100%',
                      gap: '5px',
                      opacity: isZero ? 0.55 : 1,
                      cursor: 'help',
                    }}
                    title={
                      isZero
                        ? `${day.date}: 0 B (0건 · 처리량 0인 날짜로 평균 계산에서 제외)`
                        : `${day.date}: 총 ${day.count}건 완료 · ${formatBytesSize(dayBytes)} (${breakdownTooltip})`
                    }
                  >
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        color: isZero ? 'var(--text-muted)' : '#a5b4fc',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatBytesSize(dayBytes)}
                    </span>
                    <div
                      style={{
                        width: '62%',
                        maxWidth: '46px',
                        height: `${barHeightPx}px`,
                        borderRadius: '5px 5px 2px 2px',
                        background: isZero
                          ? 'rgba(148, 163, 184, 0.28)'
                          : 'transparent',
                        boxShadow: isZero
                          ? 'none'
                          : '0 2px 8px rgba(66, 133, 244, 0.35)',
                        transition: 'height 0.25s ease',
                        display: 'flex',
                        flexDirection: 'column-reverse',
                        overflow: 'hidden',
                      }}
                    >
                      {!isZero &&
                        segments.map((seg) => (
                          <div
                            key={seg.key}
                            title={`${day.date} [${seg.label}]: ${seg.count}건 (${formatBytesSize(seg.bytes)})`}
                            style={{
                              width: '100%',
                              height: `${
                                dayBytes > 0
                                  ? (seg.bytes / Math.max(1, dayBytes)) * 100
                                  : (seg.count / Math.max(1, day.count)) * 100
                              }%`,
                              backgroundColor: seg.color,
                              minHeight: '2px',
                            }}
                          />
                        ))}
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        color: isZero
                          ? 'var(--text-muted)'
                          : 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {day.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div
          style={{
            fontSize: '13px',
            fontWeight: 700,
            marginBottom: '8px',
            color: 'var(--text-secondary)',
          }}
        >
          조회된 기록 ({filteredMsgs.length}건 / 해당 분류 전체{' '}
          {baseMessages.length}건)
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '80px' }}>구분</th>
              <th style={{ width: '150px' }}>일시</th>
              <th style={{ width: '180px' }}>대화방 / 상대방</th>
              <th style={{ width: '130px' }}>발신자 / 상태</th>
              <th>내용 / 통화 스크립트</th>
              <th style={{ width: '120px' }}>수집 기기</th>
            </tr>
          </thead>
          <tbody>
            {filteredMsgs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: 'center',
                    padding: '24px',
                    color: 'var(--text-muted)',
                  }}
                >
                  조건에 해당하는 데이터가 없습니다.
                </td>
              </tr>
            ) : (
              filteredMsgs.slice(0, 5000).map((m) => {
                const personCandidate =
                  m.source === 'kakaotalk'
                    ? m.sender &&
                      m.sender !== '회원님' &&
                      m.sender !== '나'
                      ? m.sender
                      : m.roomOrSender
                    : (m.roomOrSender || m.sender || '상대방')
                        .replace(/\s*\([^)]*\)/g, '')
                        .trim();
                const srcKey = (
                  [
                    'kakaotalk',
                    'notification',
                    'sms',
                    'call',
                    'recording',
                    'health',
                  ].includes(m.source)
                    ? m.source
                    : 'notification'
                ) as LifelogSourceType;

                const isCallPendingRow =
                  (m.source === 'call' || m.source === 'recording') &&
                  (Boolean(
                    m.attachmentUuid?.startsWith('pending_transcript:')
                  ) ||
                    (m.message || '').includes('토큰 부족') ||
                    (m.message || '').includes('스크립트 미생성') ||
                    (m.message || '').includes('원본 보관'));

                return (
                  <tr
                    key={m.id}
                    style={{
                      cursor: 'pointer',
                      outline: isCallPendingRow
                        ? '1.5px solid #ef4444'
                        : undefined,
                      backgroundColor: isCallPendingRow
                        ? 'rgba(239, 68, 68, 0.08)'
                        : undefined,
                    }}
                    onClick={() => handleSelectLifelogSidebarItem(m)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMobileContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        personName: personCandidate || '상대방',
                        sourceKey: srcKey,
                        sourceLabel: SOURCE_LABEL_MAP[srcKey] || '기록',
                        messageItem: m,
                      });
                    }}
                    title="좌클릭: 에디터 영역에서 열기 | 우클릭: 이 인물과의 기록 검색 메뉴 열기"
                  >
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {SOURCE_LABEL_MAP[m.source] || m.source}
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatLifelogEventTime(
                        m.sentDate,
                        m.sentTime,
                        'YYYYMMDD(ddd) hh:mm:ss'
                      )}
                    </td>
                    <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {m.source === 'sms'
                        ? resolveContactName(m.roomOrSender)
                        : m.roomOrSender}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{m.sender}</td>
                    <td
                      style={{ whiteSpace: 'nowrap' }}
                      title={(m.message || '').replace(/<br\s*\/?>/gi, '\n')}
                    >
                      {(() => {
                        const clean = (m.message || '')
                          .replace(/<br\s*\/?>/gi, ' ')
                          .replace(/\s+/g, ' ')
                          .trim();
                        return clean.length > 10
                          ? `${clean.slice(0, 10)}...`
                          : clean;
                      })()}
                    </td>
                    <td
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.deviceName || m.deviceId || '기본 기기'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
