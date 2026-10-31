/**
 * @file CalendarNewDocModal.tsx
 * @description 달력 UI 기반 새 일기/일정 문서 생성 모달 (구글 캘린더 색상 선택 지원).
 */
import React from 'react';
import { BaseFolderRole, FileNode } from '../../types/mylore';
import { GOOGLE_CALENDAR_COLOR_MAP } from '../../utils/markdownAutoFormat';

export interface CalendarNewDocModalProps {
  calendarModalOpen: boolean;
  setCalendarModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
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
  setNewDocDate: React.Dispatch<React.SetStateAction<string>>;
  setNewDocRole: React.Dispatch<React.SetStateAction<BaseFolderRole>>;
  openDocumentByNode: (node: FileNode) => void;
  newDocTitle: string;
  setNewDocTitle: React.Dispatch<React.SetStateAction<string>>;
  newDocCalendar: string;
  setNewDocCalendar: React.Dispatch<React.SetStateAction<string>>;
  handleCreateNewDocSubmit: () => void;
}

export function CalendarNewDocModal({
  calendarModalOpen,
  setCalendarModalOpen,
  calendarYearMonth,
  setCalendarYearMonth,
  calendarDays,
  newDocDate,
  setNewDocDate,
  setNewDocRole,
  openDocumentByNode,
  newDocTitle,
  setNewDocTitle,
  newDocCalendar,
  setNewDocCalendar,
  handleCreateNewDocSubmit,
}: CalendarNewDocModalProps) {
  if (!calendarModalOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => setCalendarModalOpen(false)}
    >
      <div
        className="palette-box"
        style={{ width: '760px', padding: '20px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ fontSize: '16px' }}>
              📅 새 일정 생성 및 기존 일정 달력 ({calendarYearMonth.year}년 {calendarYearMonth.month}월)
            </h3>
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
              ◀
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
              ▶
            </button>
          </div>
          <button
            className="toolbar-btn"
            onClick={() => setCalendarModalOpen(false)}
          >
            닫기
          </button>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          날짜 칸(빈 일정)을 클릭하면 해당 일자로 선택되며, 아래에 일정 제목을 입력해 즉시 생성하거나 기존 일정을 클릭해 열 수 있습니다.
        </p>
        <div className="calendar-grid">
          {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
            <div key={w} className="calendar-weekday-header">
              {w}
            </div>
          ))}
          {calendarDays.map((cell, idx) =>
            cell.day === null ? (
              <div key={`ce-${idx}`} />
            ) : (
              <div
                key={cell.dateStr}
                className={`calendar-day-cell ${
                  newDocDate === cell.dateStr ? 'selected' : ''
                }`}
                onClick={() => {
                  setNewDocDate(cell.dateStr);
                  setNewDocRole('diary');
                }}
              >
                <div style={{ fontSize: '11.5px', fontWeight: 700 }}>
                  {cell.day}
                </div>
                {cell.events.map((ev) => (
                  <div
                    key={ev.fullPath}
                    className="calendar-event-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCalendarModalOpen(false);
                      openDocumentByNode(ev);
                    }}
                  >
                    {ev.name.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').replace(/\.md$/i, '')}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginTop: '14px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '12.5px', fontWeight: 700, flexShrink: 0 }}>
            선택 일자: {newDocDate}
          </span>
          <input
            autoFocus
            className="input-field"
            placeholder="새 일정 제목 입력 (예: 반다비 수영 강습)..."
            value={newDocTitle}
            onChange={(e) => setNewDocTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setNewDocRole('diary');
                handleCreateNewDocSubmit();
              }
            }}
          />
          <select
            className="input-field"
            style={{ width: '160px' }}
            value={newDocCalendar}
            onChange={(e) => setNewDocCalendar(e.target.value)}
          >
            {Object.entries(GOOGLE_CALENDAR_COLOR_MAP).map(([cat]) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <button
            className="toolbar-btn primary"
            style={{ flexShrink: 0 }}
            onClick={() => {
              setNewDocRole('diary');
              handleCreateNewDocSubmit();
            }}
          >
            일정 생성
          </button>
        </div>
      </div>
    </div>
  );
}
