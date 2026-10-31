/**
 * @file PcActivityTab.tsx
 * @description 라이프로그 대시보드 [🖥️ PC 활동] 탭:
 * ActivityWatch (`aw-watcher-window`, `aw-watcher-afk`) 로컬 DB 연동 기반
 * 일간/주간 작업 시간 통계, 시간대별 타임라인, 프로그램별 사용 비중 그래프 및 상세 창 전환 로그 뷰.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PcActivitySummaryPayload } from '../../types/mylore';
import {
  getPcActivitySummary,
  openExternalUrlInChrome,
} from '../../services/tauriClient';

function formatDurationKorean(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  if (hrs > 0) {
    return `${hrs}시간 ${mins}분`;
  }
  if (mins > 0) {
    return `${mins}분 ${remSec}초`;
  }
  return `${remSec}초`;
}

function shiftDateString(dateStr: string, deltaDays: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return new Date().toISOString().slice(0, 10);
  }
  const dt = new Date(parts[0], parts[1] - 1, parts[2] + deltaDays);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function PcActivityTab() {
  const [targetDate, setTargetDate] = useState<string>(() =>
    getTodayLocalDate()
  );
  const [summary, setSummary] = useState<PcActivitySummaryPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [filterQuery, setFilterQuery] = useState<string>('');

  const loadSummary = useCallback(async (dateToLoad: string) => {
    setLoading(true);
    try {
      const data = await getPcActivitySummary(dateToLoad);
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary(targetDate);
  }, [targetDate, loadSummary]);

  const filteredTimeline = useMemo(() => {
    if (!summary) return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return summary.recentTimeline;
    return summary.recentTimeline.filter(
      (ev) =>
        ev.appName.toLowerCase().includes(q) ||
        ev.windowTitle.toLowerCase().includes(q)
    );
  }, [summary, filterQuery]);

  const maxWeeklySec = useMemo(() => {
    if (!summary || summary.weeklySummary.length === 0) return 1;
    return Math.max(
      1,
      ...summary.weeklySummary.map((d) =>
        Math.max(d.totalWindowSec, d.notAfkSec)
      )
    );
  }, [summary]);

  const maxHourlySec = useMemo(() => {
    if (!summary || summary.hourlyBreakdown.length === 0) return 1;
    return Math.max(60, ...summary.hourlyBreakdown);
  }, [summary]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 상단 날짜 컨트롤 및 ActivityWatch 연동 상태 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '12px 16px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
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
          <span style={{ fontWeight: 700, fontSize: '14px' }}>
            🖥️ 내 컴퓨터 모니터링 ({summary?.hostname || 'LocalPC'})
          </span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '999px',
              backgroundColor: summary?.isAwAvailable
                ? 'rgba(16, 185, 129, 0.18)'
                : 'rgba(239, 68, 68, 0.18)',
              color: summary?.isAwAvailable ? '#34d399' : '#f87171',
              fontWeight: 600,
            }}
          >
            {summary?.isAwAvailable
              ? `ActivityWatch 연동됨 (총 ${summary.totalStoredEvents.toLocaleString()}건 보관)`
              : 'ActivityWatch DB 미감지'}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          <button
            className="toolbar-btn"
            onClick={() => setTargetDate((d) => shiftDateString(d, -1))}
          >
            ◀ 이전 날
          </button>
          <input
            type="date"
            className="input-field"
            style={{ width: '140px' }}
            value={targetDate}
            onChange={(e) => {
              if (e.target.value) setTargetDate(e.target.value);
            }}
          />
          <button
            className="toolbar-btn"
            onClick={() => setTargetDate((d) => shiftDateString(d, 1))}
          >
            다음 날 ▶
          </button>
          <button
            className="toolbar-btn"
            onClick={() => setTargetDate(getTodayLocalDate())}
          >
            오늘
          </button>
          <button
            className="toolbar-btn primary"
            onClick={() => void loadSummary(targetDate)}
            disabled={loading}
          >
            {loading ? '⏳ 수집 중...' : '🔄 새로고침'}
          </button>
          <button
            className="toolbar-btn"
            onClick={() => openExternalUrlInChrome('http://localhost:5600')}
            title="ActivityWatch 로컬 웹 대시보드 열기"
          >
            🌐 AW 대시보드
          </button>
        </div>
      </div>

      {/* 핵심 지표 카드 4종 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '10px',
        }}
      >
        <div className="stat-card">
          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
            ⏱️ 활성 창 사용 시간 ({targetDate})
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              marginTop: '4px',
              color: 'var(--accent-primary)',
            }}
          >
            {formatDurationKorean(summary?.totalWindowSec || 0)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            창 전환 이벤트 {(summary?.eventCount || 0).toLocaleString()}회
          </div>
        </div>

        <div className="stat-card">
          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
            ⌨️ 키보드/마우스 입력 활성 (Not-AFK)
          </div>
          <div
            style={{
              fontSize: '20px',
              fontWeight: 800,
              marginTop: '4px',
              color: '#34d399',
            }}
          >
            {formatDurationKorean(summary?.activeNotAfkSec || 0)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            자리 비움(AFK): {formatDurationKorean(summary?.afkSec || 0)}
          </div>
        </div>

        <div className="stat-card">
          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
            🏆 최다 사용 프로그램
          </div>
          <div
            style={{
              fontSize: '18px',
              fontWeight: 800,
              marginTop: '4px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {summary?.topApps?.[0]?.appName || '-'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {summary?.topApps?.[0]
              ? `${formatDurationKorean(
                  summary.topApps[0].totalSec
                )} (${summary.topApps[0].percentage.toFixed(1)}%)`
              : '기록 없음'}
          </div>
        </div>
      </div>

      {/* 주간(최근 7일) 추이 & 시간대별(0~23시) 타임라인 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '12px',
        }}
      >
        <div
          style={{
            padding: '14px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
          }}
        >
          <div
            style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}
          >
            📅 최근 7일 활동 추이 (클릭하여 날짜 이동)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(summary?.weeklySummary || []).map((day) => {
              const ratio = Math.min(
                100,
                (day.totalWindowSec / maxWeeklySec) * 100
              );
              const isSelected = day.date === targetDate;
              return (
                <div
                  key={day.date}
                  onClick={() => setTargetDate(day.date)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '88px 1fr 90px',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 6px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: isSelected
                      ? 'var(--accent-soft)'
                      : 'transparent',
                  }}
                >
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: isSelected ? 700 : 500,
                    }}
                  >
                    {day.date.slice(5)}
                  </span>
                  <div
                    style={{
                      height: '10px',
                      backgroundColor: 'var(--bg-tertiary)',
                      borderRadius: '999px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${ratio}%`,
                        height: '100%',
                        backgroundColor: 'var(--accent-primary)',
                        borderRadius: '999px',
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: '11.5px',
                      textAlign: 'right',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {formatDurationKorean(day.totalWindowSec)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            padding: '14px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
          }}
        >
          <div
            style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}
          >
            🕒 시간대별(00시~23시) 작업 밀도
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(24, minmax(0, 1fr))',
              alignItems: 'end',
              height: '120px',
              gap: '3px',
              paddingTop: '10px',
            }}
          >
            {(summary?.hourlyBreakdown || new Array(24).fill(0)).map(
              (sec, hr) => {
                const hPct = Math.min(100, (sec / maxHourlySec) * 100);
                return (
                  <div
                    key={hr}
                    title={`${hr}시: ${formatDurationKorean(sec)}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      height: '100%',
                      justifyContent: 'flex-end',
                      gap: '4px',
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: `${Math.max(sec > 0 ? 6 : 2, hPct)}%`,
                        backgroundColor:
                          sec > 0
                            ? 'var(--accent-primary)'
                            : 'var(--bg-tertiary)',
                        borderRadius: '3px 3px 0 0',
                      }}
                    />
                    <span
                      style={{ fontSize: '9.5px', color: 'var(--text-muted)' }}
                    >
                      {hr}
                    </span>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </div>

      {/* 프로그램별 사용 비중 & 상세 창 타임라인 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '12px',
        }}
      >
        {/* 프로그램별 사용 비중 */}
        <div
          style={{
            padding: '14px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
          }}
        >
          <div
            style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px' }}
          >
            📊 프로그램별 사용 비중 ({summary?.topApps.length || 0}개 앱)
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxHeight: '360px',
              overflowY: 'auto',
            }}
          >
            {(summary?.topApps || []).map((app) => (
              <div
                key={app.appName}
                onClick={() =>
                  setFilterQuery((prev) =>
                    prev === app.appName ? '' : app.appName
                  )
                }
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border:
                    filterQuery === app.appName
                      ? '1px solid var(--accent-primary)'
                      : '1px solid transparent',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12.5px',
                    fontWeight: 700,
                    marginBottom: '4px',
                  }}
                >
                  <span>{app.appName}</span>
                  <span>
                    {formatDurationKorean(app.totalSec)} (
                    {app.percentage.toFixed(1)}%)
                  </span>
                </div>
                <div
                  style={{
                    height: '6px',
                    backgroundColor: 'var(--bg-primary)',
                    borderRadius: '999px',
                    overflow: 'hidden',
                    marginBottom: app.topTitles.length > 0 ? '5px' : '0',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, app.percentage)}%`,
                      height: '100%',
                      backgroundColor: '#60a5fa',
                    }}
                  />
                </div>
                {app.topTitles.length > 0 && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {app.topTitles.join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 시간순 창 전환 상세 로그 */}
        <div
          style={{
            padding: '14px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '10px',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '13px' }}>
              📜 창 활성 타임라인 ({filteredTimeline.length}건)
            </span>
            <input
              className="input-field"
              style={{ width: '170px', fontSize: '12px' }}
              placeholder="앱/창 제목 필터..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '5px',
              maxHeight: '360px',
              overflowY: 'auto',
            }}
          >
            {filteredTimeline.map((ev) => (
              <div
                key={ev.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '64px 110px 1fr 68px',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '6px 8px',
                  backgroundColor: 'var(--bg-tertiary)',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>
                  {ev.localTime}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: '#93c5fd',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {ev.appName}
                </span>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={ev.windowTitle}
                >
                  {ev.windowTitle || '(제목 없음)'}
                </span>
                <span
                  style={{
                    textAlign: 'right',
                    color: 'var(--text-secondary)',
                    fontSize: '11.5px',
                  }}
                >
                  {formatDurationKorean(ev.durationSec)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
