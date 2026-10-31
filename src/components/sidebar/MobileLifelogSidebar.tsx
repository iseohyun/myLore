/**
 * @file MobileLifelogSidebar.tsx
 * @description 모바일 라이프로그 문서 열람 시 활성화되는 우측 사이드바 6탭 뷰 (`useMemo` 기반 메시지 필터링·그룹핑 최적화 포함).
 */
import React, { useMemo } from 'react';
import {
  DocumentPayload,
  GeminiApiKeyStatus,
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
  MobileSyncProgressPayload,
} from '../../types/mylore';

export interface MobileLifelogSidebarProps {
  mobileSidebarTab: LifelogSourceType;
  setMobileSidebarTab: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  mobileSyncProgress: MobileSyncProgressPayload | null;
  allLifelogMessages: LifelogMessage[];
  resolveContactName: (rawNumberOrName: string) => string;
  selectedLifelogMsgId: number | null;
  currentDoc: DocumentPayload | null;
  contactsMap: Record<string, string>;
  isLifelogMessageMatchingCurrentDoc: (m: LifelogMessage) => boolean;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  setMobileSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  geminiStatus: GeminiApiKeyStatus | null;
}

const SOURCE_LABEL_MAP: Record<LifelogSourceType, string> = {
  kakaotalk: '카톡',
  notification: '알림',
  sms: '문자',
  call: '통화',
  recording: '녹음',
  health: '헬스',
};

export function MobileLifelogSidebar({
  mobileSidebarTab,
  setMobileSidebarTab,
  mobileSyncProgress,
  allLifelogMessages,
  resolveContactName,
  selectedLifelogMsgId,
  currentDoc,
  contactsMap,
  isLifelogMessageMatchingCurrentDoc,
  setMobilePersonFilter,
  setMobileSourceFilter,
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  geminiStatus,
}: MobileLifelogSidebarProps) {
  const { categoryMsgs, todayStr, weekStartStr, monthStartStr } = useMemo(() => {
    const nowLocal = new Date();
    const tStr = `${nowLocal.getFullYear()}-${String(
      nowLocal.getMonth() + 1
    ).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
    const dayOfWeek = nowLocal.getDay();
    const weekStartObj = new Date(nowLocal);
    weekStartObj.setDate(nowLocal.getDate() - dayOfWeek);
    const wStr = `${weekStartObj.getFullYear()}-${String(
      weekStartObj.getMonth() + 1
    ).padStart(2, '0')}-${String(weekStartObj.getDate()).padStart(2, '0')}`;
    const mStr = `${nowLocal.getFullYear()}-${String(
      nowLocal.getMonth() + 1
    ).padStart(2, '0')}-01`;

    const rawCategoryMsgs = allLifelogMessages.filter(
      (m) => m.source === mobileSidebarTab
    );

    const getPersonDedupKey = (m: LifelogMessage): string => {
      if (m.source === 'recording' || m.source === 'health') {
        return `${m.source}-${m.id}-${m.sentDate}-${m.sentTime}-${m.roomOrSender}`;
      }
      if (m.source === 'sms') {
        return resolveContactName(m.roomOrSender || m.sender).trim();
      }
      if (m.source === 'call') {
        const rawTarget =
          m.sender &&
          m.sender !== '통화녹음' &&
          !m.sender.includes('통화')
            ? m.sender
            : m.roomOrSender;
        return resolveContactName(rawTarget)
          .replace(/\s*\([^)]*\)/g, '')
          .trim();
      }
      if (m.source === 'kakaotalk') {
        return (m.roomOrSender || m.sender || '카카오톡').trim();
      }
      return (m.roomOrSender || m.sender || '알림').trim();
    };

    const personMap = new Map<string, LifelogMessage>();
    const dedupedMsgs: LifelogMessage[] = [];
    for (const m of rawCategoryMsgs) {
      const key = getPersonDedupKey(m) || `id-${m.id}`;
      const existing = personMap.get(key);
      if (!existing) {
        const clone = { ...m };
        personMap.set(key, clone);
        dedupedMsgs.push(clone);
      } else if (
        (m.source === 'call' || m.source === 'recording') &&
        !existing.hasAudioRecording &&
        m.hasAudioRecording &&
        existing.sentDate === m.sentDate
      ) {
        existing.hasAudioRecording = true;
        if (!existing.attachmentUuid && m.attachmentUuid) {
          existing.attachmentUuid = m.attachmentUuid;
        }
      }
    }

    return {
      categoryMsgs: dedupedMsgs,
      todayStr: tStr,
      weekStartStr: wStr,
      monthStartStr: mStr,
    };
  }, [allLifelogMessages, mobileSidebarTab, contactsMap]);

  const activeLifelogMsgId = useMemo(() => {
    const activeMatchingMsg =
      (selectedLifelogMsgId &&
        categoryMsgs.find(
          (m) =>
            m.id === selectedLifelogMsgId &&
            isLifelogMessageMatchingCurrentDoc(m)
        )) ||
      categoryMsgs.find((m) => isLifelogMessageMatchingCurrentDoc(m));
    return activeMatchingMsg?.id ?? null;
  }, [categoryMsgs, selectedLifelogMsgId, currentDoc, contactsMap]);

  const sections = useMemo(() => {
    const todayList = categoryMsgs.filter((m) => m.sentDate >= todayStr);
    const thisWeekList = categoryMsgs.filter(
      (m) => m.sentDate >= weekStartStr && m.sentDate < todayStr
    );
    const thisMonthList = categoryMsgs.filter(
      (m) => m.sentDate >= monthStartStr && m.sentDate < weekStartStr
    );
    const olderList = categoryMsgs.filter((m) => m.sentDate < monthStartStr);

    return [
      { title: '오늘 목록', items: todayList },
      { title: '이번주', items: thisWeekList },
      { title: '이번달', items: thisMonthList },
      { title: '오래됨', items: olderList },
    ];
  }, [categoryMsgs, todayStr, weekStartStr, monthStartStr]);

  const renderMsgItem = (msg: LifelogMessage) => {
    const isActiveDocItem = msg.id === activeLifelogMsgId;

    const resolvedSenderOrRoom =
      msg.source === 'sms'
        ? resolveContactName(msg.roomOrSender || msg.sender)
        : msg.source === 'call'
          ? resolveContactName(
              msg.sender && msg.sender !== '통화녹음'
                ? msg.sender
                : msg.roomOrSender
            )
          : msg.roomOrSender || msg.sender;

    const personName =
      msg.source === 'kakaotalk'
        ? msg.sender && msg.sender !== '회원님' && msg.sender !== '나'
          ? msg.sender
          : msg.roomOrSender
        : resolvedSenderOrRoom.replace(/\s*\([^)]*\)/g, '').trim();

    const isCallRecordingMissing =
      (msg.source === 'call' || msg.source === 'recording') &&
      !msg.hasAudioRecording;

    const isCallTranscriptPending =
      (msg.source === 'call' || msg.source === 'recording') &&
      Boolean(msg.hasAudioRecording) &&
      (Boolean(msg.attachmentUuid?.startsWith('pending_transcript:')) ||
        (msg.message || '').includes('토큰 부족') ||
        (msg.message || '').includes('스크립트 미생성') ||
        (msg.message || '').includes('원본 보관'));

    const recordingSourceBadge =
      msg.source === 'recording'
        ? msg.sender || msg.deviceName || 'SM-S901N'
        : '';

    const headerTitle =
      msg.source === 'kakaotalk'
        ? `${msg.roomOrSender} · ${msg.sender}`
        : msg.source === 'sms'
          ? resolvedSenderOrRoom
          : msg.source === 'call'
            ? resolvedSenderOrRoom
            : msg.source === 'recording'
              ? msg.roomOrSender || '음성 녹음'
              : msg.source === 'health'
                ? `${msg.roomOrSender} (${msg.sender})`
                : msg.roomOrSender || msg.sender;

    const cleanedPreviewMessage = (msg.message || '')
      .replace(/^\[ì\s*œëª©ì—†ì\s*Œ\]\s*/g, '')
      .replace(/^\[제목없음\]\s*/g, '')
      .replace(/<br\s*\/?>/gi, ' ');

    return (
      <div
        key={msg.id}
        data-sidebar-active={isActiveDocItem ? 'true' : undefined}
        className={`tree-node-row ${isActiveDocItem ? 'active' : ''}`}
        style={{
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '3px',
          padding: '6px 8px',
          cursor: 'pointer',
          opacity: isActiveDocItem ? 1 : isCallRecordingMissing ? 0.46 : 1,
          border: isActiveDocItem
            ? '1.5px solid var(--accent-primary)'
            : isCallTranscriptPending
              ? '1.5px solid #ef4444'
              : isCallRecordingMissing
                ? '1px solid rgba(100, 116, 139, 0.22)'
                : undefined,
          backgroundColor: isActiveDocItem
            ? 'rgba(99, 102, 241, 0.22)'
            : isCallTranscriptPending
              ? 'rgba(239, 68, 68, 0.09)'
              : isCallRecordingMissing
                ? 'rgba(15, 23, 42, 0.55)'
                : undefined,
          boxShadow: isActiveDocItem
            ? '0 0 0 1px rgba(99, 102, 241, 0.35), 0 4px 12px rgba(0, 0, 0, 0.25)'
            : isCallTranscriptPending
              ? '0 0 0 1px rgba(239, 68, 68, 0.22)'
              : undefined,
          borderRadius: '6px',
          marginBottom:
            isActiveDocItem || isCallTranscriptPending || isCallRecordingMissing
              ? '3px'
              : undefined,
        }}
        onClick={() => {
          setMobilePersonFilter(personName || '');
          setMobileSourceFilter(mobileSidebarTab);
          handleSelectLifelogSidebarItem(msg);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMobileContextMenu({
            x: e.clientX,
            y: e.clientY,
            personName: personName || '상대방',
            sourceKey: mobileSidebarTab,
            sourceLabel: SOURCE_LABEL_MAP[mobileSidebarTab],
            messageItem: msg,
          });
        }}
        title={
          isActiveDocItem
            ? `✏️ 현재 에디터에서 열람/편집 중인 항목 ('${headerTitle}') | 우클릭: 메뉴`
            : isCallRecordingMissing
              ? `🔇 녹음 미다운로드 (음영 표시) — '${headerTitle}' 기록 열기 | 우클릭: 메뉴`
              : isCallTranscriptPending
                ? `⚠️ LLM 토큰 부족으로 스크립트 미생성 (${geminiStatus?.retryAfterAt ? `${geminiStatus.retryAfterAt} 에 5시간 후 자동 재시도` : '5시간 후 자동 재시도'}) | 클릭하여 열기`
                : `좌클릭: 에디터 영역에 '${headerTitle}' 출력 | 우클릭: '${personName}'님과의 검색 팝업`
        }
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            fontSize: '11.5px',
            fontWeight: 700,
            color: isActiveDocItem
              ? '#e0e7ff'
              : isCallTranscriptPending
                ? '#fca5a5'
                : isCallRecordingMissing
                  ? 'var(--text-muted)'
                  : '#a5b4fc',
            gap: '6px',
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>
              {isCallRecordingMissing
                ? '🔇 '
                : msg.source === 'call'
                  ? '🎧 '
                  : msg.source === 'recording'
                    ? '🎙️ '
                    : msg.source === 'health'
                      ? '🏃 '
                      : ''}
              {headerTitle}
            </span>
            {recordingSourceBadge && (
              <span
                style={{
                  fontSize: '9.5px',
                  padding: '1px 5px',
                  borderRadius: '999px',
                  backgroundColor: recordingSourceBadge.includes('워치')
                    ? 'rgba(16, 185, 129, 0.22)'
                    : 'rgba(59, 130, 246, 0.22)',
                  color: recordingSourceBadge.includes('워치')
                    ? '#6ee7b7'
                    : '#93c5fd',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {recordingSourceBadge}
              </span>
            )}
            {isActiveDocItem && (
              <span
                style={{
                  fontSize: '9.5px',
                  padding: '1px 5px',
                  borderRadius: '999px',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#ffffff',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                편집중
              </span>
            )}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10.5px',
              color: isActiveDocItem
                ? '#c7d2fe'
                : isCallTranscriptPending
                  ? '#f87171'
                  : 'var(--text-muted)',
              flexShrink: 0,
            }}
          >
            {msg.sentDate.slice(5)} {msg.sentTime.slice(0, 5)}
          </span>
        </div>
        <div
          style={{
            fontSize: '12px',
            color: isCallTranscriptPending
              ? '#fecaca'
              : isCallRecordingMissing
                ? 'var(--text-muted)'
                : 'var(--text-primary)',
            width: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {cleanedPreviewMessage}
        </div>
        {isCallTranscriptPending && (
          <div
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              color: '#f87171',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>
              ⏳ 토큰 부족 미생성 ·{' '}
              {geminiStatus?.retryAfterAt
                ? `5시간 후(${geminiStatus.retryAfterAt.slice(11, 16)}) 재시도`
                : '5시간 후 자동 재시도'}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className="sidebar-tabs"
        style={{ gap: '2px', padding: '5px 4px', flexWrap: 'nowrap' }}
      >
        {(
          [
            { key: 'kakaotalk', label: '카톡' },
            { key: 'notification', label: '알림' },
            { key: 'sms', label: '문자' },
            { key: 'call', label: '통화' },
            { key: 'recording', label: '녹음' },
            { key: 'health', label: '헬스' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            className={`sidebar-tab ${mobileSidebarTab === t.key ? 'active' : ''}`}
            style={{
              flex: 1,
              fontSize: '11.5px',
              fontWeight: 700,
              padding: '5px 3px',
              whiteSpace: 'nowrap',
            }}
            onClick={() => setMobileSidebarTab(t.key)}
            title={`${t.label} (우클릭: 인물별 기록 검색)`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mobileSyncProgress &&
        (() => {
          const sbStep =
            mobileSyncProgress.steps[mobileSyncProgress.currentStepIndex] ||
            mobileSyncProgress.steps[mobileSyncProgress.steps.length - 1];
          return (
            <div
              style={{
                padding: '8px 10px',
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                <span style={{ color: '#e0e7ff' }}>
                  {mobileSyncProgress.isRunning
                    ? `🔄 ${mobileSyncProgress.currentLabel}`
                    : `✅ ${mobileSyncProgress.currentLabel}`}
                </span>
                <span
                  style={{
                    color: '#4ade80',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {mobileSyncProgress.currentPercent}%
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  width: '100%',
                  height: '8px',
                  backgroundColor: 'rgba(30, 41, 59, 0.9)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                }}
              >
                {(sbStep?.segments || []).map((seg, idx) => (
                  <div
                    key={`sb-seg-${idx}`}
                    style={{
                      width: `${seg.widthPct}%`,
                      height: '100%',
                      backgroundColor:
                        seg.kind === 'download' ? '#22c55e' : '#3b82f6',
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '10px',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: '#93c5fd' }}>
                  🟦 기보유 스킵: {sbStep?.skippedCount ?? 0}
                </span>
                <span style={{ color: '#86efac' }}>
                  🟩 신규 다운로드: {sbStep?.downloadedCount ?? 0}
                </span>
              </div>
            </div>
          );
        })()}

      <div className="sidebar-content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sections.map((sec, sIdx) => (
            <React.Fragment key={sec.title}>
              {sIdx > 0 && (
                <hr
                  style={{
                    border: 'none',
                    borderTop: '1px solid var(--border-color)',
                    margin: '6px 0',
                  }}
                />
              )}
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '11.5px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    padding: '2px 4px',
                    marginBottom: '4px',
                  }}
                >
                  <span>{sec.title}</span>
                  <span
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {sec.items.length}건
                  </span>
                </div>
                {sec.items.length === 0 ? (
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      padding: '4px 8px',
                    }}
                  >
                    내역 없음
                  </div>
                ) : (
                  (() => {
                    const sliced = sec.items.slice(0, 150);
                    if (
                      activeLifelogMsgId &&
                      !sliced.some((m) => m.id === activeLifelogMsgId)
                    ) {
                      const activeInSec = sec.items.find(
                        (m) => m.id === activeLifelogMsgId
                      );
                      if (activeInSec) {
                        sliced.push(activeInSec);
                      }
                    }
                    return sliced.map(renderMsgItem);
                  })()
                )}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </>
  );
}
