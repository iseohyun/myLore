/**
 * @file SidebarSpecialTabs.tsx
 * @description 모바일 라이프로그 우측 사이드바의 특수 탭 렌더러:
 * 1) 연락처(`contacts`) 목록
 * 2) PC 활동 로그(`pc_log`) 요약 목록
 * 3) 동선(`location`, ADD #10): 날짜별(오늘 / 이번주 / 이번달 / 연도별) GPS · Wi-Fi 동선 그룹화 및 구글지도 연동 선택
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  LifelogMessage,
  LifelogSourceType,
  LocationMovementLogItem,
  LocationMovementSummary,
  PcActivitySummaryPayload,
} from '../../types/mylore';
import { getLocationMovementLogs } from '../../services/tauriClient';

const KOR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatLifelogEventTime(
  sentDate: string,
  sentTime: string,
  formatPattern?: string
): string {
  const pattern =
    (formatPattern || 'MM-DD(ddd) hh:mm').trim() || 'MM-DD(ddd) hh:mm';
  const dateParts = (sentDate || '').split('-');
  const yyyy = dateParts[0] || '0000';
  const yy = yyyy.slice(-2);
  const mm = (dateParts[1] || '01').padStart(2, '0');
  const dd = (dateParts[2] || '01').padStart(2, '0');

  let ddd = '';
  if (dateParts.length === 3) {
    const yNum = Number(yyyy);
    const mNum = Number(mm);
    const dNum = Number(dd);
    if (!Number.isNaN(yNum) && !Number.isNaN(mNum) && !Number.isNaN(dNum)) {
      const dt = new Date(yNum, mNum - 1, dNum);
      ddd = KOR_WEEKDAYS[dt.getDay()] || '';
    }
  }

  const rawTime = (sentTime || '00:00:00').trim();
  const isPm = rawTime.includes('오후') || /pm/i.test(rawTime);
  const isAm = rawTime.includes('오전') || /am/i.test(rawTime);
  const cleanTime = rawTime.replace(/오전|오후|am|pm/gi, '').trim();
  const timeParts = (cleanTime || '00:00:00').split(':');
  let rawHour = Number(timeParts[0] || 0);
  if (Number.isNaN(rawHour)) rawHour = 0;
  if (isPm && rawHour < 12) rawHour += 12;
  if (isAm && rawHour === 12) rawHour = 0;
  const hour24 = String(rawHour).padStart(2, '0');
  const hour12Num = rawHour % 12 === 0 ? 12 : rawHour % 12;
  const hour12 = String(Number.isNaN(hour12Num) ? 12 : hour12Num).padStart(
    2,
    '0'
  );
  const minStr = (timeParts[1] || '00').trim().padStart(2, '0');
  const secStr = (timeParts[2] || '00').trim().slice(0, 2).padStart(2, '0');
  const ampm = rawHour >= 12 ? '오후' : '오전';
  const hasAmPmToken = pattern.includes('A') || pattern.includes('a');

  return pattern
    .replace(/YYYY/g, yyyy)
    .replace(/YY/g, yy)
    .replace(/MM/g, mm)
    .replace(/DD/g, dd)
    .replace(/ddd/g, ddd)
    .replace(/A/g, ampm)
    .replace(/a/g, ampm)
    .replace(/HH/g, hour24)
    .replace(/hh/g, hasAmPmToken ? hour12 : hour24)
    .replace(/mm/g, minStr)
    .replace(/ss/g, secStr);
}

export function getEffectiveCallTranscriptStage(msg: LifelogMessage): number {
  if (!msg.hasAudioRecording) return 0;
  if (
    msg.transcriptStage &&
    msg.transcriptStage >= 1 &&
    msg.transcriptStage <= 4
  ) {
    return msg.transcriptStage;
  }
  const isPending =
    Boolean(msg.attachmentUuid?.startsWith('pending_transcript:')) ||
    (msg.message || '').includes('토큰 부족') ||
    (msg.message || '').includes('스크립트 미생성') ||
    (msg.message || '').includes('원본 보관');
  return isPending ? 1 : 2;
}

export interface LocationDaySummary {
  date: string;
  logs: LocationMovementLogItem[];
  lifelogCount: number;
  placeLabels: string[];
  wifiCount: number;
  gpsCount: number;
}

export interface SidebarSpecialTabsProps {
  mobileSidebarTab: 'contacts' | 'pc_log' | 'location';
  contactSidebarEntries: Array<{ name: string; phone: string; count: number }>;
  pcSummary: PcActivitySummaryPayload | null;
  allLifelogMessages: LifelogMessage[];
  todayStr: string;
  weekStartStr: string;
  monthStartStr: string;
  collapsedSections: Set<string>;
  toggleSectionCollapse: (title: string) => void;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  setLifelogDashboardTab?: React.Dispatch<
    React.SetStateAction<'settings' | 'chat' | 'records' | 'pc_activity'>
  >;
  setMobileSidebarTab: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
}

export function SidebarSpecialTabs({
  mobileSidebarTab,
  contactSidebarEntries,
  pcSummary,
  allLifelogMessages,
  todayStr,
  weekStartStr,
  monthStartStr,
  collapsedSections,
  toggleSectionCollapse,
  setMobilePersonFilter,
  setLifelogDashboardTab,
  setMobileSidebarTab,
}: SidebarSpecialTabsProps) {
  const [locSummary, setLocSummary] = useState<LocationMovementSummary | null>(
    null
  );
  const [selectedLocDate, setSelectedLocDate] = useState<string>(todayStr);

  useEffect(() => {
    if (mobileSidebarTab === 'location') {
      getLocationMovementLogs({ limit: 500 })
        .then((res) => {
          setLocSummary(res);
          if (res.logs.length > 0 && !selectedLocDate) {
            setSelectedLocDate(res.logs[0].logDate);
          }
        })
        .catch(() => null);
    }
  }, [mobileSidebarTab]);

  useEffect(() => {
    const onDateSelected = (e: Event) => {
      const detail = (e as CustomEvent<{ date?: string }>).detail;
      if (detail?.date) {
        setSelectedLocDate(detail.date);
      }
    };
    window.addEventListener('mylore-location-date-changed', onDateSelected);
    return () =>
      window.removeEventListener('mylore-location-date-changed', onDateSelected);
  }, []);

  // 날짜별 GPS/Wi-Fi 동선 + 라이프로그 결합 요약 생성
  const locationDayList = useMemo<LocationDaySummary[]>(() => {
    if (mobileSidebarTab !== 'location') return [];
    const byDate = new Map<string, LocationMovementLogItem[]>();
    for (const log of locSummary?.logs || []) {
      const d = (log.logDate || '').trim();
      if (!d) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(log);
    }

    const lifelogCountByDate = new Map<string, number>();
    for (const m of allLifelogMessages) {
      const d = (m.sentDate || '').trim();
      if (!d) continue;
      lifelogCountByDate.set(d, (lifelogCountByDate.get(d) || 0) + 1);
      // 헬스/운동이나 주요 기록이 있는 날짜도 동선 후보 날짜에 포함
      if (m.source === 'health' && !byDate.has(d)) {
        byDate.set(d, []);
      }
    }

    const days: LocationDaySummary[] = [];
    for (const [date, logs] of byDate.entries()) {
      const chronological = logs
        .slice()
        .sort((a, b) => (a.logTime || '').localeCompare(b.logTime || ''));
      const labels: string[] = [];
      for (const l of chronological) {
        const lbl = (l.placeLabel || l.wifiSsid || '').trim();
        if (lbl && labels[labels.length - 1] !== lbl) {
          labels.push(lbl);
        }
      }
      days.push({
        date,
        logs: chronological,
        lifelogCount: lifelogCountByDate.get(date) || 0,
        placeLabels: labels,
        wifiCount: logs.filter((l) => Boolean(l.wifiSsid)).length,
        gpsCount: logs.filter((l) => Math.abs(l.latitude) > 0.0001).length,
      });
    }

    return days.sort((a, b) => b.date.localeCompare(a.date));
  }, [mobileSidebarTab, locSummary, allLifelogMessages]);

  const locationSections = useMemo(() => {
    const todayList = locationDayList.filter((d) => d.date >= todayStr);
    const thisWeekList = locationDayList.filter(
      (d) => d.date >= weekStartStr && d.date < todayStr
    );
    const thisMonthList = locationDayList.filter(
      (d) => d.date >= monthStartStr && d.date < weekStartStr
    );
    const olderList = locationDayList.filter((d) => d.date < monthStartStr);

    const currentYear =
      Number((todayStr || '').slice(0, 4)) || new Date().getFullYear();
    let minYear = currentYear;
    for (const d of locationDayList) {
      const y = Number((d.date || '').slice(0, 4));
      if (!Number.isNaN(y) && y >= 1990 && y < minYear) {
        minYear = y;
      }
    }

    const yearSections: Array<{ title: string; items: LocationDaySummary[] }> =
      [];
    for (let y = currentYear; y >= minYear; y--) {
      const yearPrefix = `${y}-`;
      const yearItems = olderList.filter((d) => d.date.startsWith(yearPrefix));
      if (yearItems.length > 0 || y === currentYear) {
        yearSections.push({ title: String(y), items: yearItems });
      }
    }

    return [
      { title: '오늘', items: todayList },
      { title: '이번주', items: thisWeekList },
      { title: '이번달', items: thisMonthList },
      ...yearSections,
    ];
  }, [locationDayList, todayStr, weekStartStr, monthStartStr]);

  if (mobileSidebarTab === 'contacts') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            padding: '4px 6px',
          }}
        >
          📇 동기화 연락처 ({contactSidebarEntries.length}명)
        </div>
        {contactSidebarEntries.map((c) => (
          <div
            key={c.name}
            className="tree-node-row"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '5px 8px',
              cursor: 'pointer',
            }}
            onClick={() => {
              setMobilePersonFilter(c.name);
              setLifelogDashboardTab?.('records');
              setMobileSidebarTab('contacts');
            }}
            title={`${c.name} (${c.phone}) — 클릭하여 연락처 인물 서술 열기`}
          >
            <span style={{ fontWeight: 700, fontSize: '12px' }}>
              👤 {c.name}
            </span>
            <span
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
              }}
            >
              {c.count > 0 ? `${c.count}건` : c.phone}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (mobileSidebarTab === 'pc_log') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div
          style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            padding: '4px 6px',
          }}
        >
          🖥️ 최근 PC 활동 로그 ({pcSummary?.hostname || '로컬 PC'})
        </div>
        {(pcSummary?.weeklySummary || []).map((day) => (
          <div
            key={day.date}
            className="tree-node-row"
            style={{
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '2px',
              padding: '6px 8px',
              cursor: 'pointer',
            }}
            onClick={() => setLifelogDashboardTab?.('pc_activity')}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                fontSize: '11.5px',
                fontWeight: 700,
                color: '#a5b4fc',
              }}
            >
              <span>📅 {day.date}</span>
              <span>
                활성 {Math.round(day.notAfkSec / 60)}분 / 총{' '}
                {Math.round(day.totalWindowSec / 60)}분
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              주요 앱: {day.topApp || '-'}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div
        style={{
          fontSize: '11.5px',
          fontWeight: 700,
          color: 'var(--text-secondary)',
          padding: '4px 6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>📍 날짜별 이동 동선 (GPS · Wi-Fi)</span>
        <span style={{ fontSize: '10.5px', fontFamily: 'var(--font-mono)' }}>
          총 {locSummary?.totalLogs ?? 0}포인트
        </span>
      </div>

      {locationSections.map((sec, sIdx) => {
        const isCollapsed = collapsedSections.has(`loc_${sec.title}`);
        return (
          <React.Fragment key={sec.title}>
            {sIdx > 0 && (
              <hr
                style={{
                  border: 'none',
                  borderTop: '1px solid var(--border-color)',
                  margin: '4px 0',
                }}
              />
            )}
            <div>
              <div
                onClick={() => toggleSectionCollapse(`loc_${sec.title}`)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  padding: '4px 6px',
                  marginBottom: isCollapsed ? '0' : '4px',
                  cursor: 'pointer',
                  borderRadius: '5px',
                  userSelect: 'none',
                  backgroundColor: isCollapsed
                    ? 'rgba(148, 163, 184, 0.08)'
                    : undefined,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <span style={{ fontSize: '10px', width: '10px' }}>
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span>{sec.title}</span>
                </span>
                <span
                  style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}
                >
                  {sec.items.length}일
                </span>
              </div>

              {!isCollapsed &&
                (sec.items.length === 0 ? (
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      padding: '4px 8px',
                    }}
                  >
                    동선 기록 없음
                  </div>
                ) : (
                  sec.items.map((dayItem) => {
                    const isActive = selectedLocDate === dayItem.date;
                    const routeText =
                      dayItem.placeLabels.length > 0
                        ? dayItem.placeLabels.slice(0, 4).join(' → ')
                        : '헬스/라이프로그 활동 기록';
                    return (
                      <div
                        key={dayItem.date}
                        className={`tree-node-row ${isActive ? 'active' : ''}`}
                        style={{
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: '3px',
                          padding: '6px 8px',
                          cursor: 'pointer',
                          borderRadius: '6px',
                          border: isActive
                            ? '1.5px solid var(--accent-primary)'
                            : undefined,
                          backgroundColor: isActive
                            ? 'rgba(99, 102, 241, 0.22)'
                            : undefined,
                        }}
                        onClick={() => {
                          setSelectedLocDate(dayItem.date);
                          setLifelogDashboardTab?.('pc_activity');
                          setMobileSidebarTab('location');
                          window.dispatchEvent(
                            new CustomEvent('mylore-select-location-date', {
                              detail: { date: dayItem.date },
                            })
                          );
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            width: '100%',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: isActive ? '#e0e7ff' : '#a5b4fc',
                          }}
                        >
                          <span>📍 {dayItem.date}</span>
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            GPS {dayItem.gpsCount} · Wi-Fi {dayItem.wifiCount} ·
                            로그 {dayItem.lifelogCount}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '11.5px',
                            color: 'var(--text-primary)',
                            width: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {routeText}
                        </div>
                      </div>
                    );
                  })
                ))}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
