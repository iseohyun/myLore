/**
 * @file DiaryDashboard.tsx
 * @description 일정(다이어리) 월간 캘린더 대시보드 (`F9`, `mylore://dashboard/diary`).
 */
import React, { useEffect, useState } from 'react';
import {
  getGoogleCalendarSyncStatus,
  openExternalUrlInChrome,
  startGoogleCalendarOauthLogin,
  syncGoogleCalendarEvents,
} from '../../services/tauriClient';
import {
  BaseFolderRole,
  FileNode,
  GoogleCalendarSyncStatus,
} from '../../types/mylore';
import {
  GOOGLE_CALENDAR_COLOR_ID_OPTIONS,
  getDiaryScheduleColorStyle,
} from '../../utils/markdownAutoFormat';

export interface DiaryDashboardProps {
  calendarYearMonth: { year: number; month: number };
  setCalendarYearMonth: React.Dispatch<
    React.SetStateAction<{ year: number; month: number }>
  >;
  calendarDays: Array<{
    day: number | null;
    dateStr: string;
    events: FileNode[];
  }>;
  newDocDate: string;
  setNewDocRole: React.Dispatch<React.SetStateAction<BaseFolderRole>>;
  setNewDocDate: React.Dispatch<React.SetStateAction<string>>;
  setNewDocTemplate: React.Dispatch<React.SetStateAction<string>>;
  setNewDocModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openDocumentByNode: (node: FileNode) => void;
  refreshTree?: () => Promise<void>;
  setStatusMessage?: React.Dispatch<React.SetStateAction<string>>;
}

export function DiaryDashboard({
  calendarYearMonth,
  setCalendarYearMonth,
  calendarDays,
  newDocDate,
  setNewDocRole,
  setNewDocDate,
  setNewDocTemplate,
  setNewDocModalOpen,
  openDocumentByNode,
  refreshTree,
  setStatusMessage,
}: DiaryDashboardProps) {
  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarSyncStatus | null>(
    null
  );
  const [isSyncingGcal, setIsSyncingGcal] = useState(false);

  const loadGcalStatus = async () => {
    try {
      const st = await getGoogleCalendarSyncStatus();
      setGcalStatus(st);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadGcalStatus();
  }, [calendarYearMonth.year, calendarYearMonth.month]);

  const handleManualSync = async () => {
    if (isSyncingGcal) return;
    setIsSyncingGcal(true);
    setStatusMessage?.(
      `🔄 [F5] 구글 캘린더 일정 동기화 중 (${calendarYearMonth.year}년 ${calendarYearMonth.month}월)...`
    );
    try {
      const res = await syncGoogleCalendarEvents(
        calendarYearMonth.year,
        calendarYearMonth.month
      );
      setStatusMessage?.(res.message);
      if (refreshTree) await refreshTree();
      await loadGcalStatus();
    } catch (err) {
      setStatusMessage?.(`구글 캘린더 동기화 실패: ${String(err)}`);
    } finally {
      setIsSyncingGcal(false);
    }
  };

  const handleOauthLogin = async () => {
    try {
      await startGoogleCalendarOauthLogin();
      setStatusMessage?.(
        '🔑 브라우저에서 Google 계정 로그인 및 권한 승인 후 자동으로 동기화됩니다.'
      );
      setTimeout(() => {
        void loadGcalStatus();
      }, 4000);
    } catch (err) {
      setStatusMessage?.(`구글 캘린더 OAuth 로그인 오류: ${String(err)}`);
    }
  };
  return (
    <div className="finance-workspace diary-dashboard-workspace">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>
            📅 일정 대쉬보드 ({calendarYearMonth.year}년 {calendarYearMonth.month}월)
          </h2>
          <button
            className="toolbar-btn"
            onClick={() =>
              setCalendarYearMonth((p) =>
                p.month === 1
                  ? { year: p.year - 1, month: 12 }
                  : { year: p.year, month: p.month - 1 }
              )
            }
          >
            ◀ 이전 달
          </button>
          <button
            className="toolbar-btn"
            onClick={() =>
              setCalendarYearMonth((p) =>
                p.month === 12
                  ? { year: p.year + 1, month: 1 }
                  : { year: p.year, month: p.month + 1 }
              )
            }
          >
            다음 달 ▶
          </button>
          <button
            className="toolbar-btn"
            onClick={() =>
              openExternalUrlInChrome('https://calendar.google.com')
            }
            title="구글 캘린더 열기 (https://calendar.google.com)"
          >
            📅 구글 달력 열기
          </button>
          <button
            className="toolbar-btn"
            onClick={() => void handleManualSync()}
            disabled={isSyncingGcal}
            title="구글 캘린더 일정 다운로드 및 업로드 대기 일정 동기화 (단축키: 일정 대쉬보드에서 F5)"
          >
            {isSyncingGcal ? '⏳ 동기화 중...' : '🔄 동기화 (F5)'}
          </button>
          {(!gcalStatus || !gcalStatus.isConnected) ? (
            <button
              className="toolbar-btn"
              onClick={() => void handleOauthLogin()}
              title="구글 캘린더 OAuth 2.0 계정 로그인 및 연동"
              style={{
                borderColor: 'var(--accent-primary)',
                color: 'var(--accent-primary)',
                fontWeight: 600,
              }}
            >
              🔑 구글 연동
            </button>
          ) : (
            <button
              className="toolbar-btn"
              onClick={() => void handleOauthLogin()}
              title={`구글 캘린더 연동됨${
                gcalStatus.lastSyncAt
                  ? ` (최근 동기화: ${gcalStatus.lastSyncAt})`
                  : ''
              } — 클릭 시 계정 재인증`}
              style={{ fontSize: '11.5px', opacity: 0.85 }}
            >
              ✅ 구글 연동됨{gcalStatus.lastSyncAt ? ` (${gcalStatus.lastSyncAt.slice(5, 16)})` : ''}
            </button>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {GOOGLE_CALENDAR_COLOR_ID_OPTIONS.map((info) => (
            <span
              key={info.colorId}
              title={`${info.label} (colorId: ${info.colorId})`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                padding: '2px 7px',
                borderRadius: '4px',
                backgroundColor: info.bgColor,
                color: info.textColor,
                borderLeft: `3px solid ${info.colorHex}`,
              }}
            >
              {info.label}
            </span>
          ))}
        </div>
      </div>
      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
        빈 날짜 칸을 클릭하면 해당 날짜에 새 일정(`.md`)을 생성하고, 기존 일정 배지를 클릭하면 해당 문서를 즉시 탭으로 엽니다.
      </p>
      <div className="calendar-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
          <div key={w} className="calendar-weekday-header">
            {w}
          </div>
        ))}
        {calendarDays.map((cell, idx) =>
          cell.day === null ? (
            <div key={`empty-${idx}`} className="calendar-day-empty" />
          ) : (
            <div
              key={cell.dateStr}
              className={`calendar-day-cell ${
                newDocDate === cell.dateStr ? 'selected' : ''
              }`}
              onClick={() => {
                setNewDocRole('diary');
                setNewDocDate(cell.dateStr);
                setNewDocTemplate('none');
                setNewDocModalOpen(true);
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                }}
              >
                {cell.day}
              </div>
              {cell.events.map((ev) => (
                <div
                  key={ev.fullPath}
                  className="calendar-event-pill"
                  style={getDiaryScheduleColorStyle(ev.calendarCategory)}
                  onClick={(e) => {
                    e.stopPropagation();
                    openDocumentByNode(ev);
                  }}
                  title={`${ev.name}${ev.calendarCategory ? ` [${ev.calendarCategory}]` : ''}`}
                >
                  {ev.name.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').replace(/\.md$/i, '')}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
