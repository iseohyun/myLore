/**
 * @file LifelogMobileDataTab.tsx
 * @description 라이프로그 대시보드 [휴대폰데이터] 탭: 수집된 카톡·문자·통화·녹음·알림 메시지 필터링 및 테이블 조회.
 */
import React, { useMemo } from 'react';
import {
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
} from '../../types/mylore';

export interface LifelogMobileDataTabProps {
  mobilePersonFilter: string;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  mobileSourceFilter: 'all' | LifelogSourceType;
  setMobileSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  allLifelogMessages: LifelogMessage[];
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  resolveContactName: (rawNumberOrName: string) => string;
}

const SOURCE_LABEL_MAP: Record<string, string> = {
  kakaotalk: '카톡',
  notification: '알림',
  sms: '문자',
  call: '통화',
  recording: '녹음',
  health: '헬스',
};

export function LifelogMobileDataTab({
  mobilePersonFilter,
  setMobilePersonFilter,
  mobileSourceFilter,
  setMobileSourceFilter,
  allLifelogMessages,
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  resolveContactName,
}: LifelogMobileDataTabProps) {
  const filteredMsgs = useMemo(() => {
    const q = mobilePersonFilter.trim().toLowerCase();
    return allLifelogMessages.filter((m) => {
      if (mobileSourceFilter !== 'all' && m.source !== mobileSourceFilter) {
        return false;
      }
      if (!q) return true;
      return (
        (m.roomOrSender || '').toLowerCase().includes(q) ||
        (m.sender || '').toLowerCase().includes(q) ||
        (m.message || '').toLowerCase().includes(q)
      );
    });
  }, [allLifelogMessages, mobilePersonFilter, mobileSourceFilter]);

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
          <span style={{ fontWeight: 700, fontSize: '13px' }}>
            🔍 인물/키워드 검색:
          </span>
          <input
            className="input-field"
            style={{ width: '200px' }}
            value={mobilePersonFilter}
            onChange={(e) => setMobilePersonFilter(e.target.value)}
            placeholder="예: 임현정, 캠핑..."
          />
          <div style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
            {(
              [
                { key: 'all', label: '전체 기록' },
                { key: 'kakaotalk', label: '카톡' },
                { key: 'notification', label: '알림' },
                { key: 'sms', label: '문자' },
                { key: 'call', label: '통화' },
                { key: 'recording', label: '녹음' },
                { key: 'health', label: '헬스' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.key}
                className={`toolbar-btn ${
                  mobileSourceFilter === cat.key ? 'primary' : ''
                }`}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setMobileSourceFilter(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </div>
          {(mobilePersonFilter || mobileSourceFilter !== 'all') && (
            <button
              className="toolbar-btn"
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => {
                setMobilePersonFilter('');
                setMobileSourceFilter('all');
              }}
            >
              ✕ 필터 해제
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
            {mobileSourceFilter === 'all'
              ? '모든기록 (카톡·알림·문자·통화·녹음·헬스)'
              : mobileSourceFilter === 'kakaotalk'
                ? "'카톡'"
                : mobileSourceFilter === 'notification'
                  ? "'알림'"
                  : mobileSourceFilter === 'sms'
                    ? "'문자'"
                    : mobileSourceFilter === 'call'
                      ? "'통화'"
                      : mobileSourceFilter === 'recording'
                        ? "'녹음'"
                        : "'헬스'"}{' '}
            검색 결과
          </span>
          <button
            className="toolbar-btn"
            style={{ padding: '2px 8px', fontSize: '11.5px' }}
            onClick={() => {
              setMobilePersonFilter('');
              setMobileSourceFilter('all');
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
          조회된 휴대폰 라이프로그 ({filteredMsgs.length}건 / 전체{' '}
          {allLifelogMessages.length}건)
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
                  조건에 해당하는 휴대폰 데이터가 없습니다.
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
                    <td>
                      <span className="role-badge projects">
                        {SOURCE_LABEL_MAP[m.source] || m.source}
                      </span>
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                      }}
                    >
                      {m.sentDate} {m.sentTime}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {m.source === 'sms'
                        ? resolveContactName(m.roomOrSender)
                        : m.roomOrSender}
                    </td>
                    <td>{m.sender}</td>
                    <td style={{ whiteSpace: 'pre-wrap' }}>{m.message}</td>
                    <td
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--text-secondary)',
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
