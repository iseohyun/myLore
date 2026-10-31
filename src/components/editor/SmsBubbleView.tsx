/**
 * @file SmsBubbleView.tsx
 * @description 모바일 문자(SMS/MMS/RCS) 문서 전용 보기 전환 헤더(`SmsHeaderBar`) 및 대화형 말풍선 뷰어(`SmsBubbleView`).
 */
import React, { useMemo } from 'react';
import { DocumentPayload } from '../../types/mylore';

export interface SmsBubbleViewProps {
  currentDoc: DocumentPayload;
  bodyText: string;
  smsRawEditMode: boolean;
  setSmsRawEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  smsBubbleScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  resolveContactName: (rawNumberOrName: string) => string;
}

interface ParsedSmsItem {
  dateStr: string;
  timeHms: string;
  isSentByMe: boolean;
  text: string;
}

const DATE_HEADER_RE = /^##\s*📅\s*(\d{4}-\d{2}-\d{2})/;
const SMS_LINE_RE =
  /^-\s*\*\*\[([^\]]+)\]\s*(?:\[([^\]]+)\]\s*)?([^*]+)\*\*:\s*(.*)$/;

export function SmsHeaderBar({
  currentDoc,
  smsRawEditMode,
  setSmsRawEditMode,
  resolveContactName,
}: Omit<SmsBubbleViewProps, 'bodyText' | 'smsBubbleScrollRef'>) {
  return (
    <div
      style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-secondary)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '15px', fontWeight: 700 }}>
          ✉️{' '}
          {resolveContactName(
            currentDoc.frontmatter['contact_name'] ||
              currentDoc.frontmatter['phone_number'] ||
              currentDoc.relativePath
                .replace(/^.*[\\/]/, '')
                .replace(/\.md$/i, '')
          )}
        </span>
        {currentDoc.frontmatter['phone_number'] &&
          resolveContactName(currentDoc.frontmatter['phone_number']) !==
            currentDoc.frontmatter['phone_number'] && (
            <span
              style={{
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-secondary)',
                padding: '2px 8px',
                borderRadius: '999px',
                backgroundColor: 'rgba(255,255,255,0.06)',
              }}
            >
              {currentDoc.frontmatter['phone_number']}
            </span>
          )}
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          className={`toolbar-btn ${!smsRawEditMode ? 'primary' : ''}`}
          style={{ padding: '4px 10px', fontSize: '12px' }}
          onClick={() => setSmsRawEditMode(false)}
        >
          💬 말풍선 보기 (기본)
        </button>
        <button
          className={`toolbar-btn ${smsRawEditMode ? 'primary' : ''}`}
          style={{ padding: '4px 10px', fontSize: '12px' }}
          onClick={() => setSmsRawEditMode(true)}
        >
          📝 마크다운 원문 편집
        </button>
      </div>
    </div>
  );
}

export function SmsBubbleView({
  bodyText,
  smsBubbleScrollRef,
}: Pick<SmsBubbleViewProps, 'bodyText' | 'smsBubbleScrollRef'>) {
  const parsedItems = useMemo<ParsedSmsItem[]>(() => {
    const items: ParsedSmsItem[] = [];
    let curDate = '';
    for (const rawLine of bodyText.split('\n')) {
      const trimmed = rawLine.trim();
      const dm = trimmed.match(DATE_HEADER_RE);
      if (dm) {
        curDate = dm[1];
        continue;
      }
      const lm = trimmed.match(SMS_LINE_RE);
      if (lm) {
        const rawTime = lm[1].trim();
        const dirTag = (lm[2] || '').trim();
        const senderStr = (lm[3] || '').trim();
        const rawMsgBody = (lm[4] || '').trim();
        const msgBody = rawMsgBody
          .replace(/^\[ì\s*œëª©ì—†ì\s*Œ\]\s*/g, '')
          .replace(/^\[제목없음\]\s*/g, '')
          .replace(/<br\s*\/?>/gi, '\n')
          .trim();
        const timeHms = /^\d{2}:\d{2}$/.test(rawTime)
          ? `${rawTime}:00`
          : rawTime;
        const isSentByMe =
          dirTag.includes('발신') ||
          senderStr.includes('나 (문자발신)') ||
          senderStr === '나';
        items.push({
          dateStr: curDate || '날짜 미상',
          timeHms,
          isSentByMe,
          text: msgBody,
        });
      }
    }
    return items;
  }, [bodyText]);

  let lastRenderedDate = '';

  return (
    <div
      ref={smsBubbleScrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      {parsedItems.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            padding: '40px 0',
          }}
        >
          표시할 문자 대화 내역이 없습니다.
        </div>
      ) : (
        parsedItems.map((item, idx) => {
          const showDateRow = item.dateStr !== lastRenderedDate;
          if (showDateRow) {
            lastRenderedDate = item.dateStr;
          }
          return (
            <React.Fragment key={`sms-b-${idx}`}>
              {showDateRow && (
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    margin: '14px 0 8px 0',
                  }}
                >
                  <span
                    style={{
                      padding: '4px 14px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(148, 163, 184, 0.14)',
                      border: '1px solid rgba(148, 163, 184, 0.25)',
                      color: 'var(--text-secondary)',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    📅 {item.dateStr}
                  </span>
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: item.isSentByMe ? 'flex-end' : 'flex-start',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    maxWidth: '72%',
                    padding: '10px 14px',
                    borderRadius: item.isSentByMe
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                    background: item.isSentByMe
                      ? 'linear-gradient(135deg, #2563eb, #3b82f6)'
                      : 'var(--bg-secondary)',
                    color: item.isSentByMe ? '#ffffff' : 'var(--text-primary)',
                    border: item.isSentByMe
                      ? '1px solid rgba(59, 130, 246, 0.5)'
                      : '1px solid var(--border-color)',
                    fontSize: '13.5px',
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.16)',
                  }}
                >
                  {item.text}
                </div>
                <span
                  style={{
                    marginTop: '3px',
                    padding: '0 4px',
                    fontSize: '10.5px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {item.timeHms}
                </span>
              </div>
            </React.Fragment>
          );
        })
      )}
    </div>
  );
}
