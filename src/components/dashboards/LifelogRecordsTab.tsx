/**
 * @file LifelogRecordsTab.tsx
 * @description 라이프로그 대시보드 [🗂️ 기록] 탭:
 * 녹음(`recording`), 사진/영상(`media`), 연락처(`contacts`) 3개 하위 분류 뷰 (우측 사이드바 탭과 동기화).
 * 연락처 탭에서 특정 연락처 클릭 시 인물 서술(호칭·소속 모임·특징) 멀티라인 편집기 및 소속 모임 후보 자동완성을 제공합니다.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CONTACT_PROFILE_TEMPLATE,
  getContactAiProfiles,
  saveContactAiProfile,
} from '../../services/tauriClient';
import { formatLifelogEventTime } from '../sidebar/MobileLifelogSidebar';
import {
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
} from '../../types/mylore';

export type LifelogRecordSubTab = 'recording' | 'media' | 'contacts';

export interface LifelogRecordsTabProps {
  allLifelogMessages: LifelogMessage[];
  contactsMap: Record<string, string>;
  mobileSidebarTab?: LifelogSourceType;
  setMobileSidebarTab?: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  mobilePersonFilter?: string;
  setMobilePersonFilter?: React.Dispatch<React.SetStateAction<string>>;
  setLifelogDashboardTab?: React.Dispatch<
    React.SetStateAction<'settings' | 'chat' | 'records' | 'pc_activity'>
  >;
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  resolveContactName: (rawNumberOrName: string) => string;
}

function extractGroupsFromProfileText(text?: string): string[] {
  if (!text) return [];
  const groups: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (
      trimmed.startsWith('소속 모임:') ||
      trimmed.startsWith('소속모임:')
    ) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx >= 0) {
        const val = trimmed.slice(colonIdx + 1).trim();
        for (const token of val.split(/[,/;·|]+/)) {
          const g = token.trim();
          if (g && !groups.includes(g)) {
            groups.push(g);
          }
        }
      }
    }
  }
  return groups;
}

function summarizeContactProfile(text?: string): {
  hasData: boolean;
  theirTitle: string;
  myTitle: string;
  groups: string[];
  about: string;
  extraLines: string[];
} {
  if (!text || !text.trim()) {
    return {
      hasData: false,
      theirTitle: '',
      myTitle: '',
      groups: [],
      about: '',
      extraLines: [],
    };
  }
  let theirTitle = '';
  let myTitle = '';
  const groups = extractGroupsFromProfileText(text);
  let about = '';
  const extraLines: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('이 사람의 호칭')) {
      const idx = line.indexOf(':');
      if (idx >= 0) theirTitle = line.slice(idx + 1).trim();
    } else if (line.startsWith('나를 부르는 호칭')) {
      const idx = line.indexOf(':');
      if (idx >= 0) myTitle = line.slice(idx + 1).trim();
    } else if (line.startsWith('소속 모임') || line.startsWith('소속모임')) {
      // handled by extractGroupsFromProfileText
    } else if (line.startsWith('이 사람은?')) {
      const idx = line.indexOf(':');
      if (idx >= 0) about = line.slice(idx + 1).trim();
    } else {
      extraLines.push(line);
    }
  }

  const hasData = Boolean(
    theirTitle || myTitle || groups.length > 0 || about || extraLines.length > 0
  );
  return { hasData, theirTitle, myTitle, groups, about, extraLines };
}

function toggleGroupOnProfileLine(
  text: string,
  groupName: string
): { nextText: string; caretPos: number } {
  const lines = text.split(/\r?\n/);
  let foundIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    if (t.startsWith('소속 모임:') || t.startsWith('소속모임:')) {
      foundIdx = i;
      break;
    }
  }

  if (foundIdx === -1) {
    const newLine = `소속 모임: ${groupName}`;
    lines.push(newLine);
    const nextText = lines.join('\n');
    return { nextText, caretPos: nextText.length };
  }

  const currentGroups = extractGroupsFromProfileText(lines[foundIdx]);
  const exists = currentGroups.includes(groupName);
  const nextGroups = exists
    ? currentGroups.filter((g) => g !== groupName)
    : [...currentGroups, groupName];

  lines[foundIdx] = `소속 모임: ${nextGroups.join(', ')}`;
  const nextText = lines.join('\n');

  let caretPos = 0;
  for (let i = 0; i <= foundIdx; i++) {
    caretPos += lines[i].length;
    if (i < foundIdx) caretPos += 1;
  }
  return { nextText, caretPos };
}

interface ExtractedMediaRecord {
  id: string;
  kind: 'photo' | 'video';
  fileName: string;
  mediaUrl: string;
  roomOrSender: string;
  sender: string;
  sentDate: string;
  sentTime: string;
  sourceMessage: LifelogMessage;
}

function extractBacktickFileNames(text: string): string[] {
  const results: string[] = [];
  const regex = /`([^`\r\n]+\.[a-zA-Z0-9]{2,5})`/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const fname = match[1].trim();
    if (fname && !results.includes(fname)) {
      results.push(fname);
    }
  }
  return results;
}

export function LifelogRecordsTab({
  allLifelogMessages,
  contactsMap,
  mobileSidebarTab,
  setMobileSidebarTab,
  mobilePersonFilter,
  setMobilePersonFilter,
  setLifelogDashboardTab,
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  resolveContactName,
}: LifelogRecordsTabProps) {
  const [localSubTab, setLocalSubTab] =
    useState<LifelogRecordSubTab>('recording');
  const [searchQuery, setSearchQuery] = useState('');

  // 연락처 인물 서술(AI 프로필) 상태
  const [contactProfiles, setContactProfiles] = useState<
    Record<string, string>
  >({});
  const [selectedContactName, setSelectedContactName] = useState<string | null>(
    null
  );
  const [draftProfileText, setDraftProfileText] = useState<string>(
    DEFAULT_CONTACT_PROFILE_TEMPLATE
  );
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'editing' | 'saving' | 'saved'
  >('idle');
  const [isCaretOnGroupLine, setIsCaretOnGroupLine] = useState<boolean>(false);
  const profileTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const subTab: LifelogRecordSubTab =
    mobileSidebarTab === 'recording' ||
    mobileSidebarTab === 'media' ||
    mobileSidebarTab === 'contacts'
      ? mobileSidebarTab
      : localSubTab;

  const handleSwitchSubTab = (next: LifelogRecordSubTab) => {
    setLocalSubTab(next);
    setMobileSidebarTab?.(next);
  };

  useEffect(() => {
    getContactAiProfiles()
      .then((map) => {
        setContactProfiles(map || {});
      })
      .catch(() => {});
  }, [subTab]);

  const checkCaretLineState = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el) {
        setIsCaretOnGroupLine(false);
        return;
      }
      const pos = el.selectionStart ?? 0;
      const text = el.value || '';
      const lineStart =
        pos > 0 ? text.lastIndexOf('\n', pos - 1) + 1 : 0;
      const nextNewline = text.indexOf('\n', pos);
      const lineEnd = nextNewline === -1 ? text.length : nextNewline;
      const currentLine = text.slice(lineStart, lineEnd).trimStart();
      setIsCaretOnGroupLine(
        currentLine.startsWith('소속 모임:') ||
          currentLine.startsWith('소속모임:') ||
          currentLine === '소속 모임' ||
          currentLine === '소속모임'
      );
    },
    []
  );

  const persistContactProfile = useCallback(
    async (targetName: string, textToSave: string) => {
      if (!targetName) return;
      const summary = summarizeContactProfile(textToSave);
      const hadExisting = Boolean(contactProfiles[targetName]?.trim());
      if (!summary.hasData && !hadExisting) {
        setSaveStatus('idle');
        return;
      }
      setSaveStatus('saving');
      try {
        const updatedMap = await saveContactAiProfile(
          targetName,
          summary.hasData ? textToSave : ''
        );
        setContactProfiles(updatedMap);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('editing');
      }
    },
    [contactProfiles]
  );

  const handleSelectContactRow = useCallback(
    (name: string) => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (selectedContactName && selectedContactName !== name) {
        void persistContactProfile(selectedContactName, draftProfileText);
      }
      if (selectedContactName === name) {
        void persistContactProfile(name, draftProfileText);
        setSelectedContactName(null);
        setIsCaretOnGroupLine(false);
        return;
      }
      const existing = contactProfiles[name];
      setSelectedContactName(name);
      setDraftProfileText(
        existing && existing.trim()
          ? existing
          : DEFAULT_CONTACT_PROFILE_TEMPLATE
      );
      setSaveStatus(existing && existing.trim() ? 'saved' : 'idle');
      setIsCaretOnGroupLine(false);
    },
    [
      contactProfiles,
      draftProfileText,
      persistContactProfile,
      selectedContactName,
    ]
  );

  // 우측 사이드바 연락처 클릭 연동
  useEffect(() => {
    if (
      subTab === 'contacts' &&
      mobilePersonFilter &&
      mobilePersonFilter.trim()
    ) {
      const target = mobilePersonFilter.trim();
      if (selectedContactName !== target) {
        const existing = contactProfiles[target];
        setSelectedContactName(target);
        setDraftProfileText(
          existing && existing.trim()
            ? existing
            : DEFAULT_CONTACT_PROFILE_TEMPLATE
        );
        setSaveStatus(existing && existing.trim() ? 'saved' : 'idle');
        setIsCaretOnGroupLine(false);
      }
    }
  }, [subTab, mobilePersonFilter, contactProfiles, selectedContactName]);

  // 다른 사람들의 '소속 모임'에서 중복 제거한 후보 목록 추출
  const otherContactGroupCandidates = useMemo(() => {
    const set = new Set<string>();
    for (const [person, text] of Object.entries(contactProfiles)) {
      if (selectedContactName && person === selectedContactName) continue;
      for (const g of extractGroupsFromProfileText(text)) {
        set.add(g);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [contactProfiles, selectedContactName]);

  const currentContactGroups = useMemo(
    () => extractGroupsFromProfileText(draftProfileText),
    [draftProfileText]
  );

  const handleDraftProfileChange = (nextVal: string) => {
    setDraftProfileText(nextVal);
    setSaveStatus('editing');
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    if (selectedContactName) {
      const target = selectedContactName;
      saveTimerRef.current = window.setTimeout(() => {
        void persistContactProfile(target, nextVal);
      }, 650);
    }
  };

  const handleToggleGroupCandidate = (groupName: string) => {
    if (!selectedContactName) return;
    const { nextText, caretPos } = toggleGroupOnProfileLine(
      draftProfileText,
      groupName
    );
    setDraftProfileText(nextText);
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void persistContactProfile(selectedContactName, nextText);
    window.requestAnimationFrame(() => {
      const el = profileTextareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caretPos, caretPos);
        setIsCaretOnGroupLine(true);
      }
    });
  };

  const mediaItems = useMemo(() => {
    const items: ExtractedMediaRecord[] = [];
    const seenKeys = new Set<string>();

    const isVideoExt = (lower: string) =>
      lower.endsWith('.mp4') ||
      lower.endsWith('.mov') ||
      lower.endsWith('.webm') ||
      lower.endsWith('.mkv') ||
      lower.endsWith('.m4v') ||
      lower.endsWith('.3gp') ||
      lower.endsWith('.avi');

    const isPhotoExt = (lower: string) =>
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.bmp') ||
      lower.endsWith('.heic');

    for (const m of allLifelogMessages) {
      if (m.source === 'media') {
        const fileName = (m.attachmentUuid || '').trim();
        if (!fileName || seenKeys.has(fileName)) continue;
        const lower = fileName.toLowerCase();
        if (!isVideoExt(lower) && !isPhotoExt(lower)) continue;
        seenKeys.add(fileName);
        const mediaUrl = `http://127.0.0.1:18443/api/v1/local-media?sub=extern&file=${encodeURIComponent(
          fileName
        )}`;
        items.push({
          id: `media_${m.id}_${fileName}`,
          kind: isVideoExt(lower) ? 'video' : 'photo',
          fileName,
          mediaUrl,
          roomOrSender: m.roomOrSender || 'SM-S901N',
          sender: m.sender || '사진첩',
          sentDate: m.sentDate,
          sentTime: m.sentTime,
          sourceMessage: m,
        });
        continue;
      }

      if (m.source !== 'kakaotalk') continue;
      const msg = m.message || '';
      const hasLinkedLocalMedia =
        msg.includes('로컬 미디어 연결됨') || msg.includes('로컬 동영상 연결됨');
      if (!hasLinkedLocalMedia) continue;

      const files = extractBacktickFileNames(msg);
      for (const fileName of files) {
        if (seenKeys.has(fileName)) continue;
        const lower = fileName.toLowerCase();
        const mediaUrl = `http://127.0.0.1:18443/api/v1/local-media?sub=kakao&file=${encodeURIComponent(
          fileName
        )}`;
        if (isVideoExt(lower)) {
          seenKeys.add(fileName);
          items.push({
            id: `${m.id}_${fileName}`,
            kind: 'video',
            fileName,
            mediaUrl,
            roomOrSender: resolveContactName(m.roomOrSender),
            sender: resolveContactName(m.sender),
            sentDate: m.sentDate,
            sentTime: m.sentTime,
            sourceMessage: m,
          });
        } else if (isPhotoExt(lower)) {
          seenKeys.add(fileName);
          items.push({
            id: `${m.id}_${fileName}`,
            kind: 'photo',
            fileName,
            mediaUrl,
            roomOrSender: resolveContactName(m.roomOrSender),
            sender: resolveContactName(m.sender),
            sentDate: m.sentDate,
            sentTime: m.sentTime,
            sourceMessage: m,
          });
        }
      }
    }
    return items.sort(
      (a, b) =>
        b.sentDate.localeCompare(a.sentDate) ||
        b.sentTime.localeCompare(a.sentTime)
    );
  }, [allLifelogMessages, resolveContactName]);

  const recordingItems = useMemo(() => {
    return allLifelogMessages.filter((m) => m.source === 'recording');
  }, [allLifelogMessages]);

  const contactEntries = useMemo(() => {
    const grouped = new Map<string, Set<string>>();
    for (const [phoneKey, rawName] of Object.entries(contactsMap)) {
      const name = (rawName || '').trim();
      const cleanPhone = (phoneKey || '').trim();
      if (!name || !cleanPhone) continue;
      if (!grouped.has(name)) {
        grouped.set(name, new Set<string>());
      }
      grouped.get(name)!.add(cleanPhone);
    }

    const list: Array<{
      name: string;
      phones: string[];
      interactionCount: number;
    }> = [];

    const interactionMap = new Map<string, number>();
    for (const m of allLifelogMessages) {
      const target = resolveContactName(m.roomOrSender || m.sender);
      if (target) {
        interactionMap.set(target, (interactionMap.get(target) || 0) + 1);
      }
    }

    for (const [name, phoneSet] of grouped.entries()) {
      const allPhones = Array.from(phoneSet);
      const formattedPhones = allPhones.filter((p) => p.includes('-'));
      const displayPhones =
        formattedPhones.length > 0 ? formattedPhones : allPhones.slice(0, 2);
      list.push({
        name,
        phones: displayPhones,
        interactionCount: interactionMap.get(name) || 0,
      });
    }

    return list.sort(
      (a, b) =>
        b.interactionCount - a.interactionCount ||
        a.name.localeCompare(b.name, 'ko')
    );
  }, [contactsMap, allLifelogMessages, resolveContactName]);

  const q = searchQuery.trim().toLowerCase();

  const filteredMedia = useMemo(
    () =>
      !q
        ? mediaItems
        : mediaItems.filter(
            (item) =>
              item.fileName.toLowerCase().includes(q) ||
              item.roomOrSender.toLowerCase().includes(q) ||
              item.sender.toLowerCase().includes(q) ||
              item.sentDate.includes(q)
          ),
    [mediaItems, q]
  );

  const filteredRecordings = useMemo(
    () =>
      !q
        ? recordingItems
        : recordingItems.filter((r) => {
            const name = resolveContactName(
              r.roomOrSender || r.sender
            ).toLowerCase();
            return (
              name.includes(q) ||
              (r.message || '').toLowerCase().includes(q) ||
              r.sentDate.includes(q)
            );
          }),
    [recordingItems, q, resolveContactName]
  );

  const filteredContacts = useMemo(
    () =>
      !q
        ? contactEntries
        : contactEntries.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.phones.some((p) => p.toLowerCase().includes(q)) ||
              (contactProfiles[c.name] || '').toLowerCase().includes(q)
          ),
    [contactEntries, contactProfiles, q]
  );

  const renderStageBadge = (stage?: number) => {
    switch (stage) {
      case 1:
        return '🔊 1단계 (대기)';
      case 2:
        return '❓ 2단계 (확인전)';
      case 3:
        return '❗ 3단계 (재요청)';
      case 4:
        return '📄 4단계 (확인됨)';
      default:
        return '🎙️ 녹음보유';
    }
  };

  return (
    <div className="lifelog-records-container">
      <div className="lifelog-records-subtabs">
        <div className="lifelog-records-subtab-group">
          <button
            className={`toolbar-btn ${
              subTab === 'recording' ? 'primary' : ''
            }`}
            onClick={() => handleSwitchSubTab('recording')}
          >
            🎙️ 녹음 ({recordingItems.length})
          </button>
          <button
            className={`toolbar-btn ${subTab === 'media' ? 'primary' : ''}`}
            onClick={() => handleSwitchSubTab('media')}
          >
            🖼️ 사진/영상 ({mediaItems.length})
          </button>
          <button
            className={`toolbar-btn ${subTab === 'contacts' ? 'primary' : ''}`}
            onClick={() => handleSwitchSubTab('contacts')}
          >
            📇 연락처 ({contactEntries.length})
          </button>
        </div>

        <input
          type="text"
          className="lifelog-records-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="기록 내 이름·파일명·날짜 검색..."
        />
      </div>

      {subTab === 'media' &&
        (filteredMedia.length === 0 ? (
          <div className="lifelog-phase3-banner">
            🖼️ 표시할 사진/영상 기록이 없습니다. 모바일 동기화로 수신된 이미지 및 동영상 파일이 이곳에 자동 분류됩니다.
          </div>
        ) : (
          <div className="lifelog-records-grid">
            {filteredMedia.map((item) => (
              <div
                key={item.id}
                className="lifelog-record-card"
                onClick={() => {
                  if (item.sourceMessage.source === 'media') {
                    if (item.kind === 'photo') {
                      window.open(item.mediaUrl, '_blank');
                    }
                  } else if (item.kind === 'photo') {
                    handleSelectLifelogSidebarItem(item.sourceMessage);
                  }
                }}
                title={
                  item.sourceMessage.source === 'media'
                    ? `${item.fileName} (${item.roomOrSender})`
                    : '클릭하여 해당 사진/영상이 연결된 원본 마크다운 문서 열기'
                }
              >
                {item.kind === 'video' ? (
                  <video
                    src={item.mediaUrl}
                    controls
                    preload="metadata"
                    className="lifelog-record-video"
                  />
                ) : (
                  <img
                    src={item.mediaUrl}
                    alt={item.fileName}
                    className="lifelog-record-thumb"
                    loading="lazy"
                  />
                )}
                <div
                  className="lifelog-record-meta"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.sourceMessage.source === 'media') {
                      window.open(item.mediaUrl, '_blank');
                    } else {
                      handleSelectLifelogSidebarItem(item.sourceMessage);
                    }
                  }}
                >
                  <div className="lifelog-record-title">
                    {item.kind === 'video' ? '🎬' : '🖼️'} {item.fileName}
                  </div>
                  <div className="lifelog-record-sub">
                    <span>
                      {item.roomOrSender} · {item.sender}
                    </span>
                    <span>
                      {item.sentDate} {item.sentTime.slice(0, 5)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

      {subTab === 'recording' && (
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
          }}
        >
          <div style={{ maxHeight: '560px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>일시</th>
                  <th>대상 / 출처</th>
                  <th>스크립트 단계</th>
                  <th>요약 및 내용 미리보기</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecordings.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                      }}
                    >
                      수신된 음성녹음 파일이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredRecordings.map((m) => {
                    const displayPerson = resolveContactName(
                      m.roomOrSender || m.sender
                    );
                    const cleanMsg = (m.message || '')
                      .replace(/<br\s*\/?>/gi, ' ')
                      .replace(/\s+/g, ' ')
                      .trim();
                    return (
                      <tr
                        key={m.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleSelectLifelogSidebarItem(m)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMobileContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            personName: displayPerson,
                            sourceKey: m.source,
                            sourceLabel: '음성녹음',
                            messageItem: m,
                          });
                        }}
                        title="좌클릭: 스크립트 문서 열기 및 오디오 플레이어 로드 | 우클릭: AI 스크립트 단계/재추출 메뉴"
                      >
                        <td style={{ whiteSpace: 'nowrap' }}>음성녹음</td>
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
                        <td
                          style={{
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {displayPerson}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                          {renderStageBadge(m.transcriptStage)}
                        </td>
                        <td
                          style={{ fontSize: '12.5px', whiteSpace: 'nowrap' }}
                          title={cleanMsg}
                        >
                          {cleanMsg.length > 10
                            ? `${cleanMsg.slice(0, 10)}...`
                            : cleanMsg}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'contacts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="lifelog-phase3-banner">
            📇 <strong>연락처 + 인물 서술 및 AI 컨텍스트 연동</strong>: 휴대폰 동기화 주소록(총{' '}
            <strong>{contactEntries.length}명</strong>)에서 연락처를 클릭하면 호칭·소속 모임·특징을 서술하는 멀티라인 입력창이 열리며, 향후 Gemini 통화 스크립트 생성 시 배경지식으로 활용됩니다.
          </div>

          <div
            style={{
              padding: '16px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
            }}
          >
            <div style={{ maxHeight: '560px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '180px' }}>이름</th>
                    <th style={{ width: '220px' }}>전화번호</th>
                    <th style={{ width: '120px' }}>누적 대화/통화</th>
                    <th>인물 서술 및 AI 배경지식 (클릭하여 작성)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                        }}
                      >
                        표시할 연락처가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredContacts.map((c) => {
                      const isSelected = selectedContactName === c.name;
                      const summary = summarizeContactProfile(
                        isSelected ? draftProfileText : contactProfiles[c.name]
                      );
                      return (
                        <React.Fragment key={c.name}>
                          <tr
                            className={`contact-row-selectable ${isSelected ? 'selected' : ''}`}
                            onClick={() => handleSelectContactRow(c.name)}
                            title="클릭하여 이 인원에 대한 호칭·소속 모임·특징 멀티라인 서술 편집"
                          >
                            <td style={{ fontWeight: 700 }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ fontSize: '10px', opacity: 0.8 }}>{isSelected ? '▾' : '▸'}</span>
                                <span>👤 {c.name}</span>
                              </span>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                              {c.phones.join(', ')}
                            </td>
                            <td style={{ fontSize: '12px' }}>
                              {c.interactionCount > 0 ? (
                                <strong style={{ color: '#a5b4fc' }}>{c.interactionCount}건</strong>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>0건</span>
                              )}
                            </td>
                            <td style={{ fontSize: '12px', color: summary.hasData ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {summary.hasData ? (
                                <div className="contact-summary-badges">
                                  {summary.groups.map((g) => (
                                    <span key={g} className="contact-summary-pill">🏷️ {g}</span>
                                  ))}
                                  {summary.theirTitle && <span style={{ color: '#e0e7ff' }}>호칭: {summary.theirTitle}</span>}
                                  {summary.myTitle && <span style={{ color: '#93c5fd' }}>나를: {summary.myTitle}</span>}
                                  {summary.about && <span style={{ color: 'var(--text-secondary)' }}>· {summary.about}</span>}
                                </div>
                              ) : (
                                <span>✏️ 클릭하여 호칭·소속 모임·인물 설명 입력...</span>
                              )}
                            </td>
                          </tr>
                          {isSelected && (
                            <tr className="contact-ai-editor-row">
                              <td colSpan={4}>
                                <div className="contact-ai-editor-panel" onClick={(e) => e.stopPropagation()}>
                                  <div className="contact-ai-editor-header">
                                    <div className="contact-ai-editor-title">
                                      <span>📝 <strong>{c.name}</strong> 인물 서술 (AI 통화 스크립트 배경지식)</span>
                                      <span
                                        style={{
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          color: saveStatus === 'saved' ? '#34d399' : saveStatus === 'saving' ? '#fbbf24' : 'var(--text-muted)',
                                        }}
                                      >
                                        {saveStatus === 'saved'
                                          ? '✅ 저장됨 (AI 컨텍스트 반영)'
                                          : saveStatus === 'saving'
                                            ? '⏳ 저장 중...'
                                            : saveStatus === 'editing'
                                              ? '✏️ 입력 중 (자동 저장)'
                                              : '기본 템플릿'}
                                      </span>
                                    </div>
                                    <div className="contact-ai-editor-actions">
                                      {setLifelogDashboardTab && setMobilePersonFilter && (
                                        <button
                                          type="button"
                                          className="toolbar-btn"
                                          style={{ padding: '3px 9px', fontSize: '11.5px' }}
                                          onClick={() => {
                                            void persistContactProfile(c.name, draftProfileText);
                                            setMobilePersonFilter(c.name);
                                            setLifelogDashboardTab('chat');
                                          }}
                                        >
                                          💬 대화/통화 내역 보기
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="toolbar-btn primary"
                                        style={{ padding: '3px 10px', fontSize: '11.5px' }}
                                        onClick={() => void persistContactProfile(c.name, draftProfileText)}
                                      >
                                        💾 저장
                                      </button>
                                      <button
                                        type="button"
                                        className="toolbar-btn"
                                        style={{ padding: '3px 9px', fontSize: '11.5px' }}
                                        onClick={() => {
                                          void persistContactProfile(c.name, draftProfileText);
                                          setSelectedContactName(null);
                                          setIsCaretOnGroupLine(false);
                                        }}
                                      >
                                        닫기
                                      </button>
                                    </div>
                                  </div>

                                  <textarea
                                    ref={profileTextareaRef}
                                    className="contact-ai-profile-textarea"
                                    rows={5}
                                    value={draftProfileText}
                                    onChange={(e) => {
                                      handleDraftProfileChange(e.target.value);
                                      checkCaretLineState(e.currentTarget);
                                    }}
                                    onFocus={(e) => checkCaretLineState(e.currentTarget)}
                                    onClick={(e) => checkCaretLineState(e.currentTarget)}
                                    onKeyUp={(e) => checkCaretLineState(e.currentTarget)}
                                    onSelect={(e) => checkCaretLineState(e.currentTarget)}
                                    onBlur={() => void persistContactProfile(c.name, draftProfileText)}
                                    onKeyDown={(e) => {
                                      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'Enter')) {
                                        e.preventDefault();
                                        void persistContactProfile(c.name, draftProfileText);
                                      }
                                    }}
                                  />

                                  {isCaretOnGroupLine && (
                                    <div className="contact-group-candidates-bar">
                                      <div className="contact-group-candidates-label">
                                        <span>
                                          🏷️ <strong>소속 모임 입력 후보</strong> (다른 사람의 소속 모임에서 선택하거나 직접 입력하세요)
                                        </span>
                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                          복수 모임은 쉼표(,)로 구분
                                        </span>
                                      </div>
                                      <div className="contact-group-candidates-chips">
                                        {otherContactGroupCandidates.length === 0 ? (
                                          <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                                            아직 다른 연락처에 등록된 소속 모임이 없습니다. 위 줄에 직접 입력하면 다음 연락처부터 선택 후보로 제공됩니다.
                                          </span>
                                        ) : (
                                          otherContactGroupCandidates.map((groupName) => {
                                            const isAdded = currentContactGroups.includes(groupName);
                                            return (
                                              <button
                                                key={groupName}
                                                type="button"
                                                className={`contact-group-chip ${isAdded ? 'active' : ''}`}
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={() => handleToggleGroupCandidate(groupName)}
                                                title={isAdded ? `클릭하여 '${groupName}' 소속 모임 해제` : `클릭하여 '${groupName}' 소속 모임 추가`}
                                              >
                                                <span>{isAdded ? '✓' : '+'}</span>
                                                <span>{groupName}</span>
                                              </button>
                                            );
                                          })
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
