/**
 * @file CalendarNewDocModal.tsx
 * @description 달력 UI 기반 새 일기/일정 문서 생성 모달 (`Google Calendar Template.md` 통합 폼 지원).
 */
import React from 'react';
import { BaseFolderRole, FileNode } from '../../types/mylore';
import {
  GOOGLE_CALENDAR_COLOR_MAP,
  getDiaryScheduleColorStyle,
} from '../../utils/markdownAutoFormat';

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
  newDocLocation: string;
  setNewDocLocation: React.Dispatch<React.SetStateAction<string>>;
  newDocIncludeLocation: boolean;
  setNewDocIncludeLocation: React.Dispatch<React.SetStateAction<boolean>>;
  newDocDescriptionMode: 'File' | 'none';
  setNewDocDescriptionMode: React.Dispatch<
    React.SetStateAction<'File' | 'none'>
  >;
  newDocTransparency: 'transparent' | 'opaque';
  setNewDocTransparency: React.Dispatch<
    React.SetStateAction<'transparent' | 'opaque'>
  >;
  newDocVisibility: 'default' | 'public' | 'private' | 'confidential';
  setNewDocVisibility: React.Dispatch<
    React.SetStateAction<'default' | 'public' | 'private' | 'confidential'>
  >;
  newDocAttendeeEmail: string;
  setNewDocAttendeeEmail: React.Dispatch<React.SetStateAction<string>>;
  newDocAttendeeResponseStatus:
    | 'accepted'
    | 'declined'
    | 'tentative'
    | 'needsAction';
  setNewDocAttendeeResponseStatus: React.Dispatch<
    React.SetStateAction<'accepted' | 'declined' | 'tentative' | 'needsAction'>
  >;
  newDocEventStatus: 'confirmed' | 'tentative' | 'cancelled';
  setNewDocEventStatus: React.Dispatch<
    React.SetStateAction<'confirmed' | 'tentative' | 'cancelled'>
  >;
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
  newDocLocation,
  setNewDocLocation,
  newDocIncludeLocation,
  setNewDocIncludeLocation,
  newDocDescriptionMode,
  setNewDocDescriptionMode,
  newDocTransparency,
  setNewDocTransparency,
  newDocVisibility,
  setNewDocVisibility,
  newDocAttendeeEmail,
  setNewDocAttendeeEmail,
  newDocAttendeeResponseStatus,
  setNewDocAttendeeResponseStatus,
  newDocEventStatus,
  setNewDocEventStatus,
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
        style={{
          width: '820px',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '20px',
        }}
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
          날짜 칸(빈 일정)을 클릭하면 해당 일자로 선택되며, 아래 폼에서 일정 제목 입력 후 <code>Enter</code>로 즉시 생성하거나 세부 속성을 조정할 수 있습니다.
        </p>
        <div className="calendar-grid">
          {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
            <div key={w} className="calendar-weekday-header">
              {w}
            </div>
          ))}
          {calendarDays.map((cell, idx) =>
            cell.day === null ? (
              <div key={`ce-${idx}`} className="calendar-day-empty" />
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
                    style={getDiaryScheduleColorStyle(ev.calendarCategory)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCalendarModalOpen(false);
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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: '14px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 700, flexShrink: 0 }}>
              선택 일자: {newDocDate}
            </span>
            <input
              autoFocus
              className="input-field"
              placeholder="새 일정 제목 입력 (미입력 시 '새 일정', Enter로 즉시 생성)..."
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
              style={{ width: '180px', flexShrink: 0 }}
              value={newDocCalendar}
              onChange={(e) => setNewDocCalendar(e.target.value)}
            >
              {Object.entries(GOOGLE_CALENDAR_COLOR_MAP).map(([cat, info]) => (
                <option key={cat} value={cat}>
                  {cat} (colorId: {info.colorId})
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

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1fr 1fr 1fr',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11.5px',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={newDocIncludeLocation}
                  onChange={(e) => setNewDocIncludeLocation(e.target.checked)}
                />
                장소
              </label>
              <input
                className="input-field"
                disabled={!newDocIncludeLocation}
                placeholder="장소 (기본: 거제집)"
                value={newDocLocation}
                onChange={(e) => setNewDocLocation(e.target.value)}
              />
            </div>

            <select
              className="input-field"
              value={newDocDescriptionMode}
              onChange={(e) =>
                setNewDocDescriptionMode(e.target.value as 'File' | 'none')
              }
              title="description 속성 포함 여부"
            >
              <option value="File">내용 넣음 (description: File)</option>
              <option value="none">일정만 (description 생략)</option>
            </select>

            <select
              className="input-field"
              value={newDocTransparency}
              onChange={(e) =>
                setNewDocTransparency(
                  e.target.value as 'transparent' | 'opaque'
                )
              }
              title="한가함 / 바쁨 (transparency)"
            >
              <option value="transparent">한가함 (transparent)</option>
              <option value="opaque">바쁨 (opaque)</option>
            </select>

            <select
              className="input-field"
              value={newDocVisibility}
              onChange={(e) =>
                setNewDocVisibility(
                  e.target.value as
                    | 'default'
                    | 'public'
                    | 'private'
                    | 'confidential'
                )
              }
              title="공개 범위 (visibility)"
            >
              <option value="default">달력 설정에 따름 (default)</option>
              <option value="public">공개 (public)</option>
              <option value="private">비공개 (private)</option>
              <option value="confidential">조건부 비공개 (confidential)</option>
            </select>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                newDocAttendeeEmail.trim() !== '' ? '1.5fr 1fr 1fr' : '1fr',
              gap: '8px',
              alignItems: 'center',
            }}
          >
            <input
              className="input-field"
              placeholder="추가 참석자 이메일 입력 (없으면 비움 — 입력 시 참석자 응답/확정 상태 선택 활성화)"
              value={newDocAttendeeEmail}
              onChange={(e) => setNewDocAttendeeEmail(e.target.value)}
            />
            {newDocAttendeeEmail.trim() !== '' && (
              <>
                <select
                  className="input-field"
                  value={newDocAttendeeResponseStatus}
                  onChange={(e) =>
                    setNewDocAttendeeResponseStatus(
                      e.target.value as
                        | 'accepted'
                        | 'declined'
                        | 'tentative'
                        | 'needsAction'
                    )
                  }
                >
                  <option value="needsAction">참석자: 미응답 (needsAction)</option>
                  <option value="accepted">참석자: 수락됨 (accepted)</option>
                  <option value="declined">참석자: 거부됨 (declined)</option>
                  <option value="tentative">참석자: 보류됨 (tentative)</option>
                </select>
                <select
                  className="input-field"
                  value={newDocEventStatus}
                  onChange={(e) =>
                    setNewDocEventStatus(
                      e.target.value as 'confirmed' | 'tentative' | 'cancelled'
                    )
                  }
                >
                  <option value="confirmed">일정 상태: 확정 (confirmed)</option>
                  <option value="tentative">일정 상태: 미정/보류 (tentative)</option>
                  <option value="cancelled">일정 상태: 취소됨 (cancelled)</option>
                </select>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
