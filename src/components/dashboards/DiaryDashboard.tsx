/**
 * @file DiaryDashboard.tsx
 * @description 일정(다이어리) 월간 캘린더 대시보드 (`F9`, `mylore://dashboard/diary`).
 */
import React from 'react';
import { BaseFolderRole, FileNode } from '../../types/mylore';

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
}: DiaryDashboardProps) {
  return (
    <div className="finance-workspace">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
            <div key={`empty-${idx}`} />
          ) : (
            <div
              key={cell.dateStr}
              className={`calendar-day-cell ${
                newDocDate === cell.dateStr ? 'selected' : ''
              }`}
              onClick={() => {
                setNewDocRole('diary');
                setNewDocDate(cell.dateStr);
                setNewDocTemplate('diary_default.md');
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
                  onClick={(e) => {
                    e.stopPropagation();
                    openDocumentByNode(ev);
                  }}
                  title={ev.name}
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
