/**
 * @file MobileLifelogSidebar.tsx
 * @description 모바일 라이프로그 우측 사이드바:
 * 대시보드 탭(대화 / 기록 / 모니터링)에 연동되는 3탭 구성 및 [오늘 / 이번주 / 이번달 / 오래됨] 접기·열기 토글 지원.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  DocumentPayload,
  GeminiApiKeyStatus,
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
  MobileSyncProgressPayload,
  MyLoreAppSettings,
  PcActivitySummaryPayload,
} from '../../types/mylore';
import { getPcActivitySummary } from '../../services/tauriClient';
import {
  SidebarSpecialTabs,
  formatLifelogEventTime,
  getEffectiveCallTranscriptStage,
} from './SidebarSpecialTabs';

export { formatLifelogEventTime, getEffectiveCallTranscriptStage };

export interface MobileLifelogSidebarProps {
  activeTabPath?: string | null;
  lifelogDashboardTab?: 'settings' | 'chat' | 'records' | 'pc_activity';
  setLifelogDashboardTab?: React.Dispatch<
    React.SetStateAction<'settings' | 'chat' | 'records' | 'pc_activity'>
  >;
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
  appSettings?: MyLoreAppSettings;
  filterUnverifiedCallsOnly?: boolean;
  setFilterUnverifiedCallsOnly?: React.Dispatch<React.SetStateAction<boolean>>;
}

const SOURCE_LABEL_MAP: Record<LifelogSourceType, string> = {
  kakaotalk: '카톡',
  notification: 'M로그',
  sms: '문자',
  call: '통화',
  recording: '녹음',
  health: '헬스',
  media: '사진/영상',
  contacts: '연락처',
  pc_log: 'PC로그',
  location: '동선',
};

export function MobileLifelogSidebar({
  activeTabPath,
  lifelogDashboardTab,
  setLifelogDashboardTab,
  mobileSidebarTab,
  setMobileSidebarTab,
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
  appSettings,
  filterUnverifiedCallsOnly: externalFilterUnverified,
  setFilterUnverifiedCallsOnly: externalSetFilterUnverified,
}: MobileLifelogSidebarProps) {
  const [internalFilterUnverified, setInternalFilterUnverified] =
    useState(false);
  const filterUnverifiedCallsOnly =
    externalFilterUnverified ?? internalFilterUnverified;
  const setFilterUnverifiedCallsOnly =
    externalSetFilterUnverified ?? setInternalFilterUnverified;
  // 오늘 / 이번주 / 이번달 / 오래됨 접기·열기 토글 상태
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set()
  );
  const [pcSummary, setPcSummary] = useState<PcActivitySummaryPayload | null>(
    null
  );

  const toggleSectionCollapse = (sectionTitle: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionTitle)) {
        next.delete(sectionTitle);
      } else {
        next.add(sectionTitle);
      }
      return next;
    });
  };

  const isOnLifelogDashboard = activeTabPath === 'mylore://dashboard/lifelog';

  // 현재 활성화된 대시보드 탭 또는 사이드바 탭에 따라 표시할 3개 탭 결정
  const sidebarTabGroup = useMemo<
    ReadonlyArray<{ key: LifelogSourceType; label: string }>
  >(() => {
    const isRecordsMode =
      (isOnLifelogDashboard && lifelogDashboardTab === 'records') ||
      (!isOnLifelogDashboard &&
        (mobileSidebarTab === 'recording' ||
          mobileSidebarTab === 'media' ||
          mobileSidebarTab === 'contacts'));

    const isMonitoringMode =
      (isOnLifelogDashboard && lifelogDashboardTab === 'pc_activity') ||
      (!isOnLifelogDashboard &&
        (mobileSidebarTab === 'pc_log' ||
          mobileSidebarTab === 'notification' ||
          mobileSidebarTab === 'health' ||
          mobileSidebarTab === 'location'));

    if (isRecordsMode) {
      return [
        { key: 'recording', label: '녹음' },
        { key: 'media', label: '사진/영상' },
        { key: 'contacts', label: '연락처' },
      ];
    }
    if (isMonitoringMode) {
      return [
        { key: 'pc_log', label: 'PC로그' },
        { key: 'notification', label: 'M로그' },
        { key: 'health', label: '헬스' },
        { key: 'location', label: '동선' },
      ];
    }
    return [
      { key: 'kakaotalk', label: '카톡' },
      { key: 'sms', label: '문자' },
      { key: 'call', label: '통화' },
    ];
  }, [isOnLifelogDashboard, lifelogDashboardTab, mobileSidebarTab]);

  useEffect(() => {
    if (mobileSidebarTab === 'pc_log') {
      getPcActivitySummary()
        .then((res) => setPcSummary(res))
        .catch(() => null);
    }
  }, [mobileSidebarTab]);

  // 통화 탭 전체에서 `?`(2단계: 스크립트 진행되었으나 사용자 확인 전) 항목 개수 집계
  const unverifiedCallCount = useMemo(() => {
    const rawCalls = allLifelogMessages.filter((m) => m.source === 'call');
    const personMap = new Map<string, LifelogMessage>();
    const dedupedCalls: LifelogMessage[] = [];
    for (const m of rawCalls) {
      const key = `${m.source}-${m.id}-${m.sentDate}-${m.sentTime}-${m.roomOrSender}`;
      const existing = personMap.get(key);
      if (!existing) {
        const clone = { ...m };
        personMap.set(key, clone);
        dedupedCalls.push(clone);
      } else if (
        !existing.hasAudioRecording &&
        m.hasAudioRecording &&
        existing.sentDate === m.sentDate
      ) {
        existing.hasAudioRecording = true;
        if (!existing.attachmentUuid && m.attachmentUuid) {
          existing.attachmentUuid = m.attachmentUuid;
        }
        if (!existing.transcriptStage && m.transcriptStage) {
          existing.transcriptStage = m.transcriptStage;
          existing.transcriptRequirement = m.transcriptRequirement;
        }
      }
    }
    return dedupedCalls.filter((m) => getEffectiveCallTranscriptStage(m) === 2)
      .length;
  }, [allLifelogMessages]);

  useEffect(() => {
    if (unverifiedCallCount === 0 && filterUnverifiedCallsOnly) {
      setFilterUnverifiedCallsOnly(false);
    }
  }, [unverifiedCallCount, filterUnverifiedCallsOnly]);

  const { categoryMsgs, rawCategoryMsgs, todayStr, weekStartStr, monthStartStr } =
    useMemo(() => {
      const nowLocal = new Date();
      const tStr = `${nowLocal.getFullYear()}-${String(
        nowLocal.getMonth() + 1
      ).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
      // 일요일이나 매월 1일에도 어제 및 최근 7일/30일 기록이 '오래됨'으로 밀려나지 않도록
      // 최근 7일(이번주) 및 최근 30일(이번달) 기준일을 산출
      const weekStartObj = new Date(nowLocal);
      weekStartObj.setDate(nowLocal.getDate() - 7);
      const wStr = `${weekStartObj.getFullYear()}-${String(
        weekStartObj.getMonth() + 1
      ).padStart(2, '0')}-${String(weekStartObj.getDate()).padStart(2, '0')}`;
      const monthStartObj = new Date(nowLocal);
      monthStartObj.setDate(nowLocal.getDate() - 30);
      const mStr = `${monthStartObj.getFullYear()}-${String(
        monthStartObj.getMonth() + 1
      ).padStart(2, '0')}-${String(monthStartObj.getDate()).padStart(2, '0')}`;

      const rawCategoryMsgs = (
        mobileSidebarTab === 'media'
          ? allLifelogMessages.filter((m) => {
              if (m.source === 'media') return true;
              if (m.source !== 'kakaotalk') return false;
              const txt = m.message || '';
              return (
                txt.includes('로컬 미디어 연결됨') ||
                txt.includes('로컬 동영상 연결됨')
              );
            })
          : allLifelogMessages.filter((m) => m.source === mobileSidebarTab)
      )
        .slice()
        .sort(
          (a, b) =>
            (b.sentDate || '').trim().localeCompare((a.sentDate || '').trim()) ||
            b.id - a.id
        );

      const getPersonDedupKey = (m: LifelogMessage): string => {
        if (mobileSidebarTab === 'media') {
          return `media-${m.id}-${m.sentDate}-${m.sentTime}`;
        }
        if (
          m.source === 'call' ||
          m.source === 'recording' ||
          m.source === 'health'
        ) {
          return `${m.source}-${m.id}-${m.sentDate}-${m.sentTime}-${m.roomOrSender}`;
        }
        if (m.source === 'sms') {
          return resolveContactName(m.roomOrSender || m.sender).trim();
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
          if (!existing.transcriptStage && m.transcriptStage) {
            existing.transcriptStage = m.transcriptStage;
            existing.transcriptRequirement = m.transcriptRequirement;
          }
        }
      }

      const finalMsgs =
        mobileSidebarTab === 'call' && filterUnverifiedCallsOnly
          ? dedupedMsgs.filter((m) => getEffectiveCallTranscriptStage(m) === 2)
          : dedupedMsgs;

      return {
        categoryMsgs: finalMsgs,
        rawCategoryMsgs,
        todayStr: tStr,
        weekStartStr: wStr,
        monthStartStr: mStr,
      };
    }, [
      allLifelogMessages,
      mobileSidebarTab,
      contactsMap,
      filterUnverifiedCallsOnly,
    ]);

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

    const currentYear =
      Number((todayStr || '').slice(0, 4)) || new Date().getFullYear();
    let minYear = currentYear;
    for (const m of rawCategoryMsgs) {
      const y = Number((m.sentDate || '').slice(0, 4));
      if (!Number.isNaN(y) && y >= 1990 && y < minYear) {
        minYear = y;
      }
    }

    const yearSections: Array<{ title: string; items: LifelogMessage[] }> = [];
    for (let y = currentYear; y >= minYear; y--) {
      const yearPrefix = `${y}-`;
      const yearItems = olderList.filter((m) => {
        const sd = (m.sentDate || '').trim();
        if (sd.startsWith(yearPrefix)) return true;
        if (y === minYear) {
          const itemYear = Number(sd.slice(0, 4));
          return Number.isNaN(itemYear) || itemYear < minYear;
        }
        return false;
      });
      yearSections.push({ title: String(y), items: yearItems });
    }

    return [
      { title: '오늘', items: todayList },
      { title: '이번주', items: thisWeekList },
      { title: '이번달', items: thisMonthList },
      ...yearSections,
    ];
  }, [categoryMsgs, rawCategoryMsgs, todayStr, weekStartStr, monthStartStr]);

  const contactSidebarEntries = useMemo(() => {
    if (mobileSidebarTab !== 'contacts') return [];
    const grouped = new Map<string, Set<string>>();
    for (const [phoneKey, rawName] of Object.entries(contactsMap)) {
      const name = (rawName || '').trim();
      const cleanPhone = (phoneKey || '').trim();
      if (!name || !cleanPhone) continue;
      if (!grouped.has(name)) grouped.set(name, new Set<string>());
      grouped.get(name)!.add(cleanPhone);
    }
    const interactionMap = new Map<string, number>();
    for (const m of allLifelogMessages) {
      const target = resolveContactName(m.roomOrSender || m.sender);
      if (target) {
        interactionMap.set(target, (interactionMap.get(target) || 0) + 1);
      }
    }
    const list: Array<{ name: string; phone: string; count: number }> = [];
    for (const [name, phoneSet] of grouped.entries()) {
      const allPhones = Array.from(phoneSet);
      const formatted = allPhones.filter((p) => p.includes('-'));
      list.push({
        name,
        phone: (formatted[0] || allPhones[0] || '').trim(),
        count: interactionMap.get(name) || 0,
      });
    }
    return list.sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')
    );
  }, [mobileSidebarTab, contactsMap, allLifelogMessages, resolveContactName]);

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

    if (msg.source === 'call' && mobileSidebarTab === 'call') {
      const rawCallTarget =
        msg.roomOrSender &&
        !['발신통화', '수신통화', '부재중통화', '수신거절', '통화녹음'].includes(
          msg.roomOrSender
        )
          ? msg.roomOrSender
          : msg.sender;
      const callTargetDisplay = resolveContactName(rawCallTarget);
      const isRejectedCall =
        msg.sender === '수신거절' ||
        msg.sender === 'rejected' ||
        (msg.message || '').includes('[수신거절]') ||
        (msg.message || '').includes('수신거절') ||
        (msg.message || '').includes('통화거절');
      const isOutgoingCall =
        !isRejectedCall &&
        (msg.sender === '발신통화' ||
          msg.sender === 'outgoing' ||
          (msg.message || '').includes('[발신통화]'));
      const isCallFailed =
        !msg.hasAudioRecording &&
        (isRejectedCall ||
          msg.sender === '부재중통화' ||
          msg.sender === 'missed' ||
          (msg.message || '').includes('[부재중통화]') ||
          ((msg.message || '').startsWith('📞') &&
            !(msg.message || '').includes('통화시간')));

      const formattedTime = formatLifelogEventTime(
        msg.sentDate,
        msg.sentTime,
        appSettings?.lifelogTimeFormat
      );
      const failedTextColor =
        appSettings?.failedCallTextColor ||
        'var(--failed-call-text-color, #b91c1c)';

      const effStage = getEffectiveCallTranscriptStage(msg);

      const stageIcon =
        effStage === 0
          ? '🔇'
          : effStage === 1
            ? '🔊'
            : effStage === 2
              ? '❓'
              : effStage === 3
                ? '❗'
                : '📄';

      const stageDesc =
        effStage === 0
          ? '녹음 파일 없음'
          : effStage === 1
            ? '1단계: 아직 스크립트화가 진행되지 않았습니다. (AI 스크립팅 대기열 포함)'
            : effStage === 2
              ? '2단계: 스크립트가 진행되었으나, 사용자가 확인 전입니다. (AI 대기열 제외)'
              : effStage === 3
                ? `3단계: 스크립트가 진행되었으나, 사용자 추가 요구사항이 있습니다.${
                    msg.transcriptRequirement
                      ? ` [요구사항: ${msg.transcriptRequirement}]`
                      : ''
                  } (AI 스크립팅 대기열 포함)`
                : '4단계: 스크립트가 진행되었고, 사용자가 확인했습니다. (AI 대기열 제외)';

      const callTypeIcon = isRejectedCall ? '🚫' : isOutgoingCall ? '↗' : '↙';
      const callTypeLabel = isRejectedCall
        ? '통화거절 (🚫)'
        : isOutgoingCall
          ? '발신통화 (↗)'
          : '수신통화 (↙)';

      return (
        <div
          key={msg.id}
          data-sidebar-active={isActiveDocItem ? 'true' : undefined}
          className={`tree-node-row ${isActiveDocItem ? 'active' : ''}`}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px',
            padding: '5px 8px',
            cursor: 'pointer',
            borderRadius: '6px',
            border: isActiveDocItem
              ? '1.5px solid var(--accent-primary)'
              : effStage === 1 || effStage === 3
                ? '1px solid rgba(239, 68, 68, 0.45)'
                : undefined,
            backgroundColor: isActiveDocItem
              ? 'rgba(99, 102, 241, 0.22)'
              : effStage === 3
                ? 'rgba(245, 158, 11, 0.12)'
                : effStage === 1
                  ? 'rgba(239, 68, 68, 0.07)'
                  : undefined,
          }}
          onClick={() => {
            setMobilePersonFilter(callTargetDisplay || '');
            setMobileSourceFilter('call');
            handleSelectLifelogSidebarItem(msg);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMobileContextMenu({
              x: e.clientX,
              y: e.clientY,
              personName: callTargetDisplay || '상대방',
              sourceKey: 'call',
              sourceLabel: SOURCE_LABEL_MAP.call,
              messageItem: msg,
            });
          }}
          title={`${callTypeLabel} · ${
            isCallFailed ? '통화 실패' : '통화 성공'
          } · ${callTargetDisplay} (${formattedTime})\n${stageDesc}`}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                backgroundColor: isRejectedCall
                  ? 'rgba(239, 68, 68, 0.16)'
                  : isOutgoingCall
                    ? 'rgba(56, 189, 248, 0.16)'
                    : 'rgba(52, 211, 153, 0.16)',
                color: isRejectedCall
                  ? '#f87171'
                  : isOutgoingCall
                    ? '#38bdf8'
                    : '#34d399',
                fontWeight: 800,
                fontSize: isRejectedCall ? '11px' : '12px',
                lineHeight: 1,
              }}
            >
              {callTypeIcon}
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: isCallFailed
                  ? failedTextColor
                  : isActiveDocItem
                    ? '#e0e7ff'
                    : msg.hasAudioRecording
                      ? '#a5b4fc'
                      : 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {callTargetDisplay}
            </span>
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontSize: '11.5px',
                lineHeight: 1,
                opacity: effStage === 0 ? 0.55 : 1,
              }}
              title={stageDesc}
            >
              {stageIcon}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10.5px',
                color: isActiveDocItem ? '#c7d2fe' : 'var(--text-muted)',
              }}
            >
              {formattedTime}
            </span>
          </span>
        </div>
      );
    }

    const recordingSourceBadge =
      msg.source === 'recording'
        ? msg.sender || msg.deviceName || 'SM-S901N'
        : '';

    const headerTitle =
      msg.source === 'kakaotalk' || msg.source === 'media'
        ? `${msg.roomOrSender} · ${msg.sender}`
        : msg.source === 'sms'
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
          borderRadius: '6px',
          marginBottom:
            isActiveDocItem || isCallTranscriptPending || isCallRecordingMissing
              ? '3px'
              : undefined,
        }}
        onClick={() => {
          if (msg.source === 'media') {
            setLifelogDashboardTab?.('records');
            setMobileSidebarTab('media');
            return;
          }
          setMobilePersonFilter(personName || '');
          setMobileSourceFilter(msg.source);
          handleSelectLifelogSidebarItem(msg);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMobileContextMenu({
            x: e.clientX,
            y: e.clientY,
            personName: personName || '상대방',
            sourceKey: msg.source,
            sourceLabel: SOURCE_LABEL_MAP[msg.source] || '기록',
            messageItem: msg,
          });
        }}
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
                : msg.source === 'recording'
                  ? '🎙️ '
                  : msg.source === 'health'
                    ? '🏃 '
                    : mobileSidebarTab === 'media'
                      ? '🖼️ '
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
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10.5px',
                color: isActiveDocItem
                  ? '#c7d2fe'
                  : isCallTranscriptPending
                    ? '#f87171'
                    : 'var(--text-muted)',
              }}
            >
              {msg.sentDate.slice(5)} {msg.sentTime.slice(0, 5)}
            </span>
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
                ? `5시간 후(${geminiStatus.retryAfterAt.slice(5, 16)}) 재시도`
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
        style={{ gap: '3px', padding: '5px 4px', flexWrap: 'nowrap' }}
      >
        {sidebarTabGroup.map((t) => (
          <button
            key={t.key}
            className={`sidebar-tab ${mobileSidebarTab === t.key ? 'active' : ''}`}
            style={{
              flex: 1,
              fontSize: '12px',
              fontWeight: 700,
              padding: '6px 4px',
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={() => {
              if (
                t.key === 'call' &&
                mobileSidebarTab === 'call' &&
                filterUnverifiedCallsOnly
              ) {
                setFilterUnverifiedCallsOnly(false);
              }
              setMobileSidebarTab(t.key);
              if (
                t.key === 'kakaotalk' ||
                t.key === 'sms' ||
                t.key === 'call'
              ) {
                setMobileSourceFilter(t.key);
              }
            }}
            title={`${t.label} 탭으로 전환`}
          >
            <span>{t.label}</span>
            {t.key === 'call' && unverifiedCallCount > 0 && (
              <span
                className={`sidebar-tab-question-badge ${
                  mobileSidebarTab === 'call' && filterUnverifiedCallsOnly
                    ? 'active'
                    : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (mobileSidebarTab !== 'call') {
                    setMobileSidebarTab('call');
                    setFilterUnverifiedCallsOnly(true);
                  } else {
                    setFilterUnverifiedCallsOnly((prev) => !prev);
                  }
                }}
                title={`미확인 스크립트(❓ 2단계) ${unverifiedCallCount}건 존재 — 클릭하여 ? 목록만 필터링`}
              >
                ?
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-content">
        {mobileSidebarTab === 'call' && filterUnverifiedCallsOnly && (
          <div className="sidebar-call-filter-banner">
            <span>❓ 미확인 스크립트({unverifiedCallCount}건)만 표시 중</span>
            <button
              type="button"
              className="toolbar-btn"
              style={{ padding: '1px 7px', fontSize: '10.5px' }}
              onClick={() => setFilterUnverifiedCallsOnly(false)}
            >
              전체 통화 보기
            </button>
          </div>
        )}

        {mobileSidebarTab === 'contacts' ||
        mobileSidebarTab === 'pc_log' ||
        mobileSidebarTab === 'location' ? (
          <SidebarSpecialTabs
            mobileSidebarTab={mobileSidebarTab}
            contactSidebarEntries={contactSidebarEntries}
            pcSummary={pcSummary}
            allLifelogMessages={allLifelogMessages}
            todayStr={todayStr}
            weekStartStr={weekStartStr}
            monthStartStr={monthStartStr}
            collapsedSections={collapsedSections}
            toggleSectionCollapse={toggleSectionCollapse}
            setMobilePersonFilter={setMobilePersonFilter}
            setLifelogDashboardTab={setLifelogDashboardTab}
            setMobileSidebarTab={setMobileSidebarTab}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {sections.map((sec, sIdx) => {
              const isCollapsed = collapsedSections.has(sec.title);
              return (
                <React.Fragment key={sec.title}>
                  {sIdx > 0 && (
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
                  )}
                  <div>
                    <div
                      onClick={() => toggleSectionCollapse(sec.title)}
                      title={isCollapsed ? `'${sec.title}' 목록 펼치기 (클릭)` : `'${sec.title}' 목록 접기 (클릭)`}
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
                        backgroundColor: isCollapsed ? 'rgba(148, 163, 184, 0.08)' : undefined,
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '10px', width: '10px' }}>{isCollapsed ? '▸' : '▾'}</span>
                        <span>{sec.title}</span>
                      </span>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                        {sec.items.length}건
                      </span>
                    </div>
                    {!isCollapsed &&
                      (sec.items.length === 0 ? (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '4px 8px' }}>
                          내역 없음
                        </div>
                      ) : (
                        (() => {
                          const sliced = sec.items.slice(0, 5000);
                          if (activeLifelogMsgId && !sliced.some((m) => m.id === activeLifelogMsgId)) {
                            const activeInSec = sec.items.find((m) => m.id === activeLifelogMsgId);
                            if (activeInSec) sliced.push(activeInSec);
                          }
                          return sliced.map(renderMsgItem);
                        })()
                      ))}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
