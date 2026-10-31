/**
 * @file LifelogMobileDataTab.tsx
 * @description 라이프로그 대시보드 [💬 대화] 탭(카톡·문자·통화 3탭) 및 [📊 모니터링] 하위(M로그·헬스) 테이블 뷰.
 */
import React, { useMemo } from 'react';
import {
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
} from '../../types/mylore';
import { formatLifelogEventTime } from '../sidebar/MobileLifelogSidebar';

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
              filteredMsgs.slice(0, 500).map((m) => {
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
