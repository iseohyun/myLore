/**
 * @file LifelogMobileDataTab.tsx
 * @description 라이프로그 대시보드 뷰:
 * - 통화(`call`) 대시보드: 5단계 파이프라인(다운로드% → ASR 변환율% → AI 후처리 및 요약% → 결재대기% → 확정%) 막대그래프 + 최근 7일 LLM 처리량 그래프
 * - 인물 검색, 통화 분석 프롬프트 관리 패널, 조회된 기록 리스트는 사용자 요청에 따라 제거됨.
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

export interface LifelogMobileDataTabProps {
  mobilePersonFilter: string;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  mobileSourceFilter: 'all' | LifelogSourceType;
  setMobileSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  mobileSidebarTab?: LifelogSourceType;
  setMobileSidebarTab?: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  fixedSource?: 'kakaotalk' | 'sms' | 'call' | 'notification' | 'health';
  allLifelogMessages: LifelogMessage[];
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  resolveContactName: (rawNumberOrName: string) => string;
}

const SOURCE_LABEL_MAP: Record<string, string> = {
  kakaotalk: '카카오톡',
  notification: 'M로그',
  sms: '문자 (SMS/MMS)',
  call: '통화',
  recording: '음성녹음',
  health: '헬스',
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
  mobileSidebarTab,
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

  const searchedPersonTrimmed = (mobilePersonFilter || '').trim();
  const searchedPersonMessages = useMemo(() => {
    if (!searchedPersonTrimmed) return [];
    const q = searchedPersonTrimmed.toLowerCase();
    return baseMessages
      .filter((m) => {
        const roomName = resolveContactName(m.roomOrSender || '')
          .replace(/\s*\([^)]*\)/g, '')
          .trim()
          .toLowerCase();
        const senderName = resolveContactName(m.sender || '')
          .replace(/\s*\([^)]*\)/g, '')
          .trim()
          .toLowerCase();
        return (
          roomName.includes(q) ||
          senderName.includes(q) ||
          (m.roomOrSender || '').toLowerCase().includes(q) ||
          (m.sender || '').toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          (b.sentDate || '').localeCompare(a.sentDate || '') ||
          (b.sentTime || '').localeCompare(a.sentTime || '') ||
          b.id - a.id
      );
  }, [baseMessages, searchedPersonTrimmed, resolveContactName]);

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

    let fbAudioCalls = 0;
    const seen = new Set<string>();
    let audioCallCount = fbAudioCalls;
    for (const m of allLifelogMessages) {
      if (m.source !== 'call') continue;
      if (!m.hasAudioRecording) continue;
      const key = `${m.sentDate}-${m.sentTime}-${m.roomOrSender}`;
      if (seen.has(key)) continue;
      seen.add(key);
      audioCallCount += 1;
    }

    const totalAudioCalls =
      callAiStats && callAiStats.totalAudioCalls > 0
        ? callAiStats.totalAudioCalls
        : audioCallCount;
    // 통화 녹음이 없이 통화 목록(부재중·수신거절·미녹음 통화)에만 존재하는 항목은 제외하고
    // 통화 녹음이 존재하는 대상만 파이프라인 모수로 취급
    const totalCallRecords = Math.max(
      totalAudioCalls,
      callAiStats?.totalCallRecords ?? totalAudioCalls
    );
    const downloadedCalls = callAiStats?.downloadedCalls ?? totalAudioCalls;
    const asrConvertedCalls = callAiStats?.asrConvertedCalls ?? 0;
    const aiPostprocessedCalls = callAiStats?.aiPostprocessedCalls ?? 0;
    const pendingApprovalCalls = callAiStats?.pendingApprovalCalls ?? 0;
    const verifiedCalls = callAiStats?.verifiedCalls ?? 0;

    const pct = (num: number, den: number) =>
      den > 0 ? Math.min(100, Math.max(0, (num / den) * 100)) : 0;

    const pipelineStages = [
      {
        key: 'download',
        label: '1. 다운로드',
        pct: pct(downloadedCalls, totalCallRecords),
        countText: `${downloadedCalls} / ${totalCallRecords}건`,
        color: '#38bdf8',
      },
      {
        key: 'asr',
        label: '2. ASR처리',
        pct: pct(asrConvertedCalls, totalAudioCalls),
        countText: `${asrConvertedCalls} / ${totalAudioCalls}건`,
        color: '#34d399',
      },
      {
        key: 'postprocess',
        label: '3. 후처리',
        pct: pct(aiPostprocessedCalls, totalAudioCalls),
        countText: `${aiPostprocessedCalls} / ${totalAudioCalls}건 (결재 대기 ${pendingApprovalCalls}건)`,
        color: '#818cf8',
      },
      {
        key: 'verified',
        label: '4. 확인',
        pct: pct(verifiedCalls, totalAudioCalls),
        countText: `${verifiedCalls} / ${totalAudioCalls}건`,
        color: '#10b981',
      },
    ];

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

    const maxDailyBytes = Math.max(
      1,
      ...dailyStats.map((d) => d.totalBytes ?? 0)
    );
    const maxDailyCount = Math.max(1, ...dailyStats.map((d) => d.count));

    return {
      pipelineStages,
      dailyStats,
      maxDailyBytes,
      maxDailyCount,
    };
  }, [effectiveSource, callAiStats, allLifelogMessages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {effectiveSource === 'call' && callProgressSummary ? (
        <>
          {/* 1. 통화 5단계 파이프라인 막대그래프: 다운로드% -> ASR변환율% -> AI 후처리 및 요약% -> 결재대기% -> 확정% */}
          <div
            style={{
              padding: '16px 18px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <strong style={{ fontSize: '14px', color: 'var(--heading-color)' }}>
                📊 통화 처리 4단계 파이프라인 진행률 (1. 다운로드 → 2. ASR처리 → 3. 후처리 → 4. 확인)
              </strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {callProgressSummary.pipelineStages.map((st, idx) => (
                <div key={st.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: st.color, display: 'inline-block' }} />
                      {st.label}
                      {idx < callProgressSummary.pipelineStages.length - 1 && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 400 }}>→</span>
                      )}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: st.color }}>
                      {st.pct.toFixed(1)}% <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>({st.countText})</span>
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '12px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(148, 163, 184, 0.16)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(st.pct > 0 ? 2 : 0, st.pct)}%`,
                        height: '100%',
                        backgroundColor: st.color,
                        borderRadius: '999px',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. 기존 LLM 처리량 그래프 (상단 요약 설명 삭제, 일별 처리량 막대그래프 유지) */}
          <div
            style={{
              padding: '14px 16px',
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
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
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
                        ? `${day.date}: 0 B (0건)`
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
        </>
      ) : (
        <div
          style={{
            padding: '18px 20px',
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
          <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--heading-color)' }}>
            📌 {SOURCE_LABEL_MAP[effectiveSource] || effectiveSource} 총 보관 건수: {baseMessages.length.toLocaleString()}건
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            오른쪽 사이드바에서 개별 대화방·항목을 선택하여 열람할 수 있습니다.
          </span>
        </div>
      )}
      {searchedPersonTrimmed && (
        <div
          style={{
            padding: '14px 16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1.5px solid var(--accent-primary)',
            borderRadius: '10px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '14px', color: 'var(--heading-color)' }}>
                🔍 검색된 인물: 👤 {searchedPersonTrimmed}
              </strong>
              <span
                style={{
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  color: '#a5b4fc',
                  fontWeight: 700,
                }}
              >
                ({SOURCE_LABEL_MAP[effectiveSource] || effectiveSource}{' '}
                {searchedPersonMessages.length.toLocaleString()}건)
              </span>
            </div>
            <button
              type="button"
              className="toolbar-btn"
              style={{ fontSize: '12px', padding: '3px 9px' }}
              onClick={() => setMobilePersonFilter('')}
              title="인물 검색 필터 해제"
            >
              ✕ 검색 해제
            </button>
          </div>

          <div
            style={{
              maxHeight: '420px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
            }}
          >
            {searchedPersonMessages.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  textAlign: 'center',
                  fontSize: '12.5px',
                  color: 'var(--text-muted)',
                }}
              >
                &apos;{searchedPersonTrimmed}&apos;님의 해당 분류 기록이 없습니다.
              </div>
            ) : (
              searchedPersonMessages.slice(0, 200).map((m) => {
                const displayPerson = resolveContactName(
                  m.roomOrSender || m.sender
                );
                const cleanMsg = (m.message || '')
                  .replace(/<br\s*\/?>/gi, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                return (
                  <div
                    key={m.id}
                    onClick={() => handleSelectLifelogSidebarItem(m)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMobileContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        personName: displayPerson,
                        sourceKey: m.source,
                        sourceLabel:
                          SOURCE_LABEL_MAP[m.source] || m.source,
                        messageItem: m,
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '7px 10px',
                      borderRadius: '7px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      fontSize: '12.5px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11.5px',
                        color: '#a5b4fc',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.sentDate} {m.sentTime.slice(0, 8)}
                    </span>
                    <strong style={{ whiteSpace: 'nowrap', color: '#38bdf8' }}>
                      {displayPerson}
                    </strong>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {cleanMsg}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
