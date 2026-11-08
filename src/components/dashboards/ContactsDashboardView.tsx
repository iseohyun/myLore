/**
 * @file ContactsDashboardView.tsx
 * @description 연락처 대시보드 전용 뷰:
 * - 상단 바: 전체 연락처 인원수 + 검색창(입력 중 실시간 자동완성 제공) + 새로고침 아이콘(🔄 클릭 시 인명부만 Sync와 동기화)만 제공 (전체 테이블 리스트 제거)
 * - 우측 사이드바에서 클릭되거나 검색(자동완성)된 인원에 대해서만 아래 상세 출력:
 *   1) 카드: 이름 / 전화번호 / 누적 문자(클릭 시 문자 대시보드 검색 이동) / 카톡(선톡/대화한 날, 클릭 시 카톡 대시보드 검색 이동) / 통화(송신/수신, 클릭 시 통화 대시보드 검색 이동) / 마지막연락 / 파일명
 *   2) 편집 가능한 multi-line 입력칸 (`{대화상대}.md` 본문): 상하좌우 여백 없이(`margin: 0, padding: 0`) 배치
 *   3) AI A/B 컨셉 전면 제거: 단일 AI 생성 데이터를 수락 또는 수정하고, 수정 시 해당 내용을 분석하여 프롬프트에 자동 반영
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CONTACT_PROFILE_TEMPLATE,
  generateContactProfileAbUpdate,
  getContactAiProfiles,
  getContactProfileApprovals,
  getMobileContactsMap,
  openContactPersonDocument,
  resolveContactProfileApproval,
  saveContactAiProfile,
  syncContactPersonMarkdownFiles,
} from '../../services/tauriClient';
import {
  ContactProfileApprovalItem,
  LifelogMessage,
  LifelogSourceType,
} from '../../types/mylore';

export interface ContactsDashboardViewProps {
  allLifelogMessages: LifelogMessage[];
  contactsMap: Record<string, string>;
  mobilePersonFilter?: string;
  setMobilePersonFilter?: React.Dispatch<React.SetStateAction<string>>;
  setMobileSidebarTab?: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  setMobileSourceFilter?: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  setLifelogDashboardTab?: React.Dispatch<
    React.SetStateAction<'settings' | 'chat' | 'records' | 'pc_activity'>
  >;
  openDashboardTab?: (dashType: any) => void;
  resolveContactName: (rawNumberOrName: string) => string;
  setStatusMessage?: React.Dispatch<React.SetStateAction<string>>;
}

interface ContactEntryItem {
  name: string;
  phones: string[];
  fileName: string;
}

function extractGroupsFromProfileText(text?: string): string[] {
  if (!text) return [];
  const groups: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('소속 모임:') || trimmed.startsWith('소속모임:')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx >= 0) {
        for (const token of trimmed.slice(colonIdx + 1).trim().split(/[,/;·|]+/)) {
          const g = token.trim();
          if (g && !groups.includes(g)) groups.push(g);
        }
      }
    }
  }
  return groups;
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
    lines.push(`소속 모임: ${groupName}`);
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

export function ContactsDashboardView({
  allLifelogMessages,
  contactsMap: initialContactsMap,
  mobilePersonFilter,
  setMobilePersonFilter,
  setMobileSidebarTab,
  setMobileSourceFilter,
  setLifelogDashboardTab,
  openDashboardTab,
  resolveContactName,
  setStatusMessage,
}: ContactsDashboardViewProps) {
  const [localContactsMap, setLocalContactsMap] =
    useState<Record<string, string>>(initialContactsMap);
  const [contactProfiles, setContactProfiles] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [activeAutoIdx, setActiveAutoIdx] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(
    mobilePersonFilter?.trim() || null
  );
  const [draftText, setDraftText] = useState<string>(
    DEFAULT_CONTACT_PROFILE_TEMPLATE
  );
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'editing' | 'saving' | 'saved'
  >('idle');
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [isCaretOnGroupLine, setIsCaretOnGroupLine] = useState(false);

  // 단일 AI 프로필 생성/수락 상태 (A/B 컨셉 제거)
  const [pendingAiApproval, setPendingAiApproval] =
    useState<ContactProfileApprovalItem | null>(null);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isResolvingAi, setIsResolvingAi] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setLocalContactsMap(initialContactsMap);
  }, [initialContactsMap]);

  const reloadContactsAndProfiles = useCallback(async () => {
    try {
      const [cMap, pMap, approvals] = await Promise.all([
        getMobileContactsMap(),
        getContactAiProfiles(),
        getContactProfileApprovals().catch(() => [] as ContactProfileApprovalItem[]),
      ]);
      setLocalContactsMap(cMap || {});
      setContactProfiles(pMap || {});
      if (selectedName) {
        const pending = approvals.find(
          (a) => a.contactName === selectedName && a.status === 'pending'
        );
        setPendingAiApproval(pending || null);
      }
    } catch {
      // ignore
    }
  }, [selectedName]);

  useEffect(() => {
    void reloadContactsAndProfiles();
  }, [reloadContactsAndProfiles]);

  // 전체 연락처 목록 집계
  const contactEntries = useMemo<ContactEntryItem[]>(() => {
    const grouped = new Map<string, Set<string>>();
    for (const [phoneKey, rawName] of Object.entries(localContactsMap)) {
      const name = (rawName || '').trim();
      const cleanPhone = (phoneKey || '').trim();
      if (!name || !cleanPhone) continue;
      if (!grouped.has(name)) grouped.set(name, new Set<string>());
      grouped.get(name)!.add(cleanPhone);
    }
    for (const name of Object.keys(contactProfiles)) {
      const clean = name.trim();
      if (clean && !grouped.has(clean)) {
        grouped.set(clean, new Set<string>());
      }
    }
    const list: ContactEntryItem[] = [];
    for (const [name, phoneSet] of grouped.entries()) {
      const allPhones = Array.from(phoneSet);
      const formatted = allPhones.filter((p) => p.includes('-'));
      const displayPhones = formatted.length > 0 ? formatted : allPhones.slice(0, 2);
      const safeStem = name.replace(/[\\/:*?"<>|]/g, '_').trim() || '이름없음';
      list.push({
        name,
        phones: displayPhones,
        fileName: `${safeStem}.md`,
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [localContactsMap, contactProfiles]);

  // 자동완성 후보 (검색 중일 때 최대 12명 표시)
  const autocompleteSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return contactEntries
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phones.some((p) => p.toLowerCase().includes(q)) ||
          (contactProfiles[c.name] || '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [contactEntries, contactProfiles, searchQuery]);

  const loadPersonProfileIntoEditor = useCallback(
    async (name: string) => {
      const clean = name.trim();
      if (!clean) return;
      try {
        const [doc, approvals] = await Promise.all([
          openContactPersonDocument(clean),
          getContactProfileApprovals().catch(() => [] as ContactProfileApprovalItem[]),
        ]);
        const pending = approvals.find(
          (a) => a.contactName === clean && a.status === 'pending'
        );
        setPendingAiApproval(pending || null);
        if (pending && pending.candidateAText?.trim()) {
          setDraftText(pending.candidateAText.trim());
          setSaveStatus('editing');
        } else {
          const body = (doc.bodyContent || '').trim();
          setDraftText(body.length > 0 ? body : DEFAULT_CONTACT_PROFILE_TEMPLATE);
          setSaveStatus('saved');
        }
      } catch {
        const existing = contactProfiles[clean];
        setDraftText(
          existing && existing.trim() ? existing : DEFAULT_CONTACT_PROFILE_TEMPLATE
        );
        setSaveStatus(existing && existing.trim() ? 'saved' : 'idle');
      }
    },
    [contactProfiles]
  );

  // 우측 사이드바에서 인원 클릭 시 연동
  useEffect(() => {
    const target = (mobilePersonFilter || '').trim();
    if (target && target !== selectedName) {
      setSelectedName(target);
      setSearchQuery(target);
      void loadPersonProfileIntoEditor(target);
    }
  }, [mobilePersonFilter, selectedName, loadPersonProfileIntoEditor]);

  const persistProfileNow = useCallback(
    async (targetName: string, textToSave: string) => {
      if (!targetName.trim()) return;
      setSaveStatus('saving');
      try {
        const updatedMap = await saveContactAiProfile(targetName.trim(), textToSave);
        setContactProfiles(updatedMap);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('editing');
      }
    },
    []
  );

  const handleSelectPerson = useCallback(
    (name: string) => {
      const clean = name.trim();
      if (!clean) return;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (selectedName && selectedName !== clean && !pendingAiApproval) {
        void persistProfileNow(selectedName, draftText);
      }
      setSelectedName(clean);
      setSearchQuery(clean);
      setShowAutocomplete(false);
      setMobilePersonFilter?.(clean);
      void loadPersonProfileIntoEditor(clean);
    },
    [
      selectedName,
      pendingAiApproval,
      draftText,
      persistProfileNow,
      setMobilePersonFilter,
      loadPersonProfileIntoEditor,
    ]
  );

  // 새로고침 아이콘: 인명부만 Sync와 동기화
  const handleRefreshContactsOnly = async () => {
    if (isSyncingContacts) return;
    setIsSyncingContacts(true);
    try {
      const synced = await syncContactPersonMarkdownFiles();
      await reloadContactsAndProfiles();
      if (selectedName) {
        await loadPersonProfileIntoEditor(selectedName);
      }
      setStatusMessage?.(
        `🔄 인명부 동기화 완료 (전체 ${synced.length}명 .md 및 주소록 갱신)`
      );
    } catch (e) {
      setStatusMessage?.(`❌ 인명부 동기화 실패: ${String(e)}`);
    } finally {
      setIsSyncingContacts(false);
    }
  };

  const selectedEntry = useMemo<ContactEntryItem | null>(() => {
    if (!selectedName) return null;
    const found = contactEntries.find((c) => c.name === selectedName);
    if (found) return found;
    const safeStem = selectedName.replace(/[\\/:*?"<>|]/g, '_').trim() || '이름없음';
    return {
      name: selectedName,
      phones: [],
      fileName: `${safeStem}.md`,
    };
  }, [contactEntries, selectedName]);

  // 선택된 인원의 상세 통계: 누적 문자 / 카톡(선톡/대화한 날) / 통화(송신/수신) / 마지막연락
  const selectedStats = useMemo(() => {
    if (!selectedEntry) return null;
    const targetName = selectedEntry.name;
    let smsCount = 0;
    let kakaoTotalCount = 0;
    let callOutCount = 0;
    let callInCount = 0;
    let callTotalCount = 0;

    // 날짜별 카톡 첫 발화자 추적 (대화한 날 & 선톡 횟수)
    const kakaoByDate = new Map<string, LifelogMessage[]>();

    let lastContactDate = '';
    let lastContactTime = '';
    let lastContactSourceLabel = '';

    const updateLastContact = (m: LifelogMessage, label: string) => {
      const d = (m.sentDate || '').trim();
      const t = (m.sentTime || '').trim();
      if (!d) return;
      if (
        !lastContactDate ||
        d > lastContactDate ||
        (d === lastContactDate && t > lastContactTime)
      ) {
        lastContactDate = d;
        lastContactTime = t;
        lastContactSourceLabel = label;
      }
    };

    for (const m of allLifelogMessages) {
      const roomResolved = resolveContactName(m.roomOrSender || '')
        .replace(/\s*\([^)]*\)/g, '')
        .trim();
      const senderResolved = resolveContactName(m.sender || '')
        .replace(/\s*\([^)]*\)/g, '')
        .trim();
      const isMatch =
        roomResolved === targetName ||
        senderResolved === targetName ||
        (m.roomOrSender || '').includes(targetName) ||
        (m.sender || '').includes(targetName);

      if (!isMatch) continue;

      if (m.source === 'sms') {
        smsCount += 1;
        updateLastContact(m, '문자');
      } else if (m.source === 'kakaotalk') {
        kakaoTotalCount += 1;
        const d = (m.sentDate || '').trim();
        if (d) {
          if (!kakaoByDate.has(d)) kakaoByDate.set(d, []);
          kakaoByDate.get(d)!.push(m);
        }
        updateLastContact(m, '카톡');
      } else if (m.source === 'call') {
        callTotalCount += 1;
        const msgTxt = m.message || '';
        const isOutgoing =
          m.sender === '발신통화' ||
          m.sender === 'outgoing' ||
          msgTxt.includes('[발신통화]');
        if (isOutgoing) {
          callOutCount += 1;
        } else {
          callInCount += 1;
        }
        updateLastContact(m, '통화');
      }
    }

    let kakaoChatDays = kakaoByDate.size;
    let kakaoFirstDays = 0; // 상대방 선톡 일수
    let kakaoMyFirstDays = 0; // 내 선톡 일수
    for (const [, dayMsgs] of kakaoByDate.entries()) {
      const sorted = dayMsgs
        .slice()
        .sort(
          (a, b) =>
            (a.sentTime || '').localeCompare(b.sentTime || '') || a.id - b.id
        );
      const first = sorted[0];
      if (!first) continue;
      const firstSender = resolveContactName(first.sender || '')
        .replace(/\s*\([^)]*\)/g, '')
        .trim();
      if (
        firstSender === '회원님' ||
        firstSender === '나' ||
        firstSender === '정서현'
      ) {
        kakaoMyFirstDays += 1;
      } else {
        kakaoFirstDays += 1;
      }
    }

    return {
      smsCount,
      kakaoTotalCount,
      kakaoChatDays,
      kakaoFirstDays,
      kakaoMyFirstDays,
      callOutCount,
      callInCount,
      callTotalCount,
      lastContactDate,
      lastContactTime,
      lastContactSourceLabel,
    };
  }, [selectedEntry, allLifelogMessages, resolveContactName]);

  // 카드에서 누적 문자 / 카톡 / 통화 클릭 시 해당 대시보드에서 해당 인물이 검색된 상태로 이동
  const handleNavigateToSourceWithPerson = (
    targetSource: 'sms' | 'kakaotalk' | 'call'
  ) => {
    if (!selectedEntry) return;
    if (!pendingAiApproval) {
      void persistProfileNow(selectedEntry.name, draftText);
    }
    setMobilePersonFilter?.(selectedEntry.name);
    setMobileSourceFilter?.(targetSource);
    setMobileSidebarTab?.(targetSource);
    setLifelogDashboardTab?.('chat');
    if (openDashboardTab) {
      openDashboardTab(targetSource);
    }
    setStatusMessage?.(
      `🔍 '${selectedEntry.name}'님의 ${
        targetSource === 'sms'
          ? '문자'
          : targetSource === 'kakaotalk'
            ? '카카오톡'
            : '통화'
      } 대시보드로 이동했습니다.`
    );
  };

  // 단일 AI 프로필 생성 (A/B 컨셉 제거)
  const handleGenerateAiProfile = async () => {
    if (!selectedEntry || isGeneratingAi) return;
    setIsGeneratingAi(true);
    try {
      await persistProfileNow(selectedEntry.name, draftText);
      const created = await generateContactProfileAbUpdate({
        contactName: selectedEntry.name,
        sourceType: 'contacts_dashboard',
      });
      setPendingAiApproval(created);
      if (created.candidateAText?.trim()) {
        setDraftText(created.candidateAText.trim());
      }
      setStatusMessage?.(
        `🤖 '${selectedEntry.name}' AI 프로필 초안이 생성되었습니다. 그대로 수락하거나 수정 후 수락하면 수정 내용이 프롬프트에 자동 반영됩니다.`
      );
    } catch (e) {
      setStatusMessage?.(`❌ AI 프로필 생성 실패: ${String(e)}`);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // AI 생성 데이터 수락 (수정 시 프롬프트에 자동 반영)
  const handleAcceptAiProfile = async () => {
    if (!selectedEntry || !pendingAiApproval || isResolvingAi) return;
    setIsResolvingAi(true);
    try {
      const isModified =
        draftText.trim() !== (pendingAiApproval.candidateAText || '').trim();
      await resolveContactProfileApproval({
        approvalId: pendingAiApproval.id,
        action: 'approve',
        chosenSlot: 'A',
        finalProfileText: draftText,
      });
      setPendingAiApproval(null);
      setSaveStatus('saved');
      const updatedMap = await getContactAiProfiles();
      setContactProfiles(updatedMap);
      setStatusMessage?.(
        isModified
          ? `✅ '${selectedEntry.name}' 프로필 수정 후 수락 완료 (수정 내역 분석 → 프롬프트에 자동 반영됨)`
          : `✅ '${selectedEntry.name}' AI 생성 프로필 수락 완료`
      );
    } catch (e) {
      setStatusMessage?.(`❌ AI 프로필 수락 오류: ${String(e)}`);
    } finally {
      setIsResolvingAi(false);
    }
  };

  const handleDismissAiProfile = async () => {
    if (!selectedEntry || !pendingAiApproval || isResolvingAi) return;
    setIsResolvingAi(true);
    try {
      await resolveContactProfileApproval({
        approvalId: pendingAiApproval.id,
        action: 'dismiss',
      });
      setPendingAiApproval(null);
      await loadPersonProfileIntoEditor(selectedEntry.name);
      setStatusMessage?.(`↩️ AI 생성 초안을 취소하고 기존 프로필을 유지합니다.`);
    } catch (e) {
      setStatusMessage?.(`❌ 취소 실패: ${String(e)}`);
    } finally {
      setIsResolvingAi(false);
    }
  };

  const checkCaretLineState = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) {
      setIsCaretOnGroupLine(false);
      return;
    }
    const pos = el.selectionStart ?? 0;
    const text = el.value || '';
    const lineStart = pos > 0 ? text.lastIndexOf('\n', pos - 1) + 1 : 0;
    const nextNewline = text.indexOf('\n', pos);
    const lineEnd = nextNewline === -1 ? text.length : nextNewline;
    const currentLine = text.slice(lineStart, lineEnd).trimStart();
    setIsCaretOnGroupLine(
      currentLine.startsWith('소속 모임:') ||
        currentLine.startsWith('소속모임:') ||
        currentLine === '소속 모임' ||
        currentLine === '소속모임'
    );
  }, []);

  const otherContactGroupCandidates = useMemo(() => {
    const set = new Set<string>();
    for (const [person, text] of Object.entries(contactProfiles)) {
      if (selectedName && person === selectedName) continue;
      for (const g of extractGroupsFromProfileText(text)) {
        set.add(g);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [contactProfiles, selectedName]);

  const currentContactGroups = useMemo(
    () => extractGroupsFromProfileText(draftText),
    [draftText]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 상단 바: 전체 연락처 인원수 + 검색(자동완성) + 새로고침 아이콘(인명부만 Sync와 동기화) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 14px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '14px', color: 'var(--heading-color)' }}>
            📇 전체 연락처 {contactEntries.length.toLocaleString()}명
          </strong>
          <button
            type="button"
            className="toolbar-btn"
            style={{ padding: '4px 9px', fontSize: '13px' }}
            disabled={isSyncingContacts}
            onClick={() => void handleRefreshContactsOnly()}
            title="인명부만 Sync와 동기화 (연락처 주소록 및 인원별 .md 동기화)"
          >
            {isSyncingContacts ? '⏳' : '🔄'}
          </button>
        </div>

        {/* 검색창 + 실시간 자동완성 드롭다운 */}
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: '420px' }}>
          <input
            type="text"
            className="input-field"
            style={{ width: '100%', fontSize: '13px', padding: '6px 12px' }}
            value={searchQuery}
            placeholder="이름 또는 전화번호 검색 (자동완성 지원)..."
            onFocus={() => setShowAutocomplete(true)}
            onBlur={() => {
              window.setTimeout(() => setShowAutocomplete(false), 160);
            }}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setActiveAutoIdx(0);
              setShowAutocomplete(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveAutoIdx((prev) =>
                  Math.min(
                    Math.max(0, autocompleteSuggestions.length - 1),
                    prev + 1
                  )
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveAutoIdx((prev) => Math.max(0, prev - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const picked =
                  autocompleteSuggestions[activeAutoIdx] ||
                  autocompleteSuggestions[0];
                if (picked) {
                  handleSelectPerson(picked.name);
                } else if (searchQuery.trim()) {
                  handleSelectPerson(searchQuery.trim());
                }
              } else if (e.key === 'Escape') {
                setShowAutocomplete(false);
              }
            }}
          />

          {showAutocomplete && autocompleteSuggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                zIndex: 90,
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
                maxHeight: '280px',
                overflowY: 'auto',
              }}
            >
              {autocompleteSuggestions.map((item, idx) => (
                <div
                  key={item.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectPerson(item.name);
                  }}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 12px',
                    cursor: 'pointer',
                    fontSize: '12.5px',
                    backgroundColor:
                      idx === activeAutoIdx
                        ? 'rgba(99, 102, 241, 0.22)'
                        : 'transparent',
                    borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                  }}
                >
                  <strong style={{ color: 'var(--text-primary)' }}>
                    👤 {item.name}
                  </strong>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {item.phones.join(', ') || item.fileName}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 사이드바에서 클릭되거나 검색된 인원에 대해서만 아래 출력 */}
      {selectedEntry && selectedStats ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-secondary)',
            overflow: 'hidden',
          }}
        >
          {/* 상단 인물 요약 카드 (이름 / 전화번호 / 누적 문자 / 카톡(선톡·대화한 날) / 통화(송신·수신) / 마지막연락 / 파일명) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
              gap: '8px',
              padding: '12px',
              borderBottom: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)',
            }}
          >
            {/* 1. 이름 */}
            <div
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                이름
              </span>
              <strong style={{ fontSize: '14px', color: 'var(--heading-color)' }}>
                👤 {selectedEntry.name}
              </strong>
            </div>

            {/* 2. 전화번호 */}
            <div
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                전화번호
              </span>
              <strong
                style={{
                  fontSize: '12.5px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                }}
              >
                {selectedEntry.phones.join(', ') || '-'}
              </strong>
            </div>

            {/* 3. 누적 문자 (클릭 시 문자 대시보드에서 해당 인물 검색 상태로 이동) */}
            <div
              onClick={() => handleNavigateToSourceWithPerson('sms')}
              title="클릭하여 문자(SMS) 대시보드에서 이 인물이 검색된 상태로 이동"
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700 }}>
                ✉️ 누적 문자 ↗
              </span>
              <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
                {selectedStats.smsCount.toLocaleString()}건
              </strong>
            </div>

            {/* 4. 카톡 (선톡 / 대화한 날) (클릭 시 카톡 대시보드에서 해당 인물 검색 상태로 이동) */}
            <div
              onClick={() => handleNavigateToSourceWithPerson('kakaotalk')}
              title="클릭하여 카카오톡 대시보드에서 이 인물이 검색된 상태로 이동"
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid rgba(250, 204, 21, 0.45)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span style={{ fontSize: '11px', color: '#facc15', fontWeight: 700 }}>
                💬 카톡 (선톡 / 대화한 날) ↗
              </span>
              <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                선톡 {selectedStats.kakaoFirstDays}일 / {selectedStats.kakaoChatDays}일
              </strong>
              <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                내 선톡 {selectedStats.kakaoMyFirstDays}일 · 총{' '}
                {selectedStats.kakaoTotalCount.toLocaleString()}건
              </span>
            </div>

            {/* 5. 통화 (송신 / 수신) (클릭 시 통화 대시보드에서 해당 인물 검색 상태로 이동) */}
            <div
              onClick={() => handleNavigateToSourceWithPerson('call')}
              title="클릭하여 통화 대시보드에서 이 인물이 검색된 상태로 이동"
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 700 }}>
                📞 통화 (송신 / 수신) ↗
              </span>
              <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                송신 {selectedStats.callOutCount}건 / 수신 {selectedStats.callInCount}건
              </strong>
              <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                총 {selectedStats.callTotalCount.toLocaleString()}건
              </span>
            </div>

            {/* 6. 마지막 연락 */}
            <div
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                마지막 연락
              </span>
              <strong
                style={{
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-primary)',
                }}
              >
                {selectedStats.lastContactDate
                  ? `${selectedStats.lastContactDate} ${selectedStats.lastContactTime.slice(0, 5)}`
                  : '기록 없음'}
              </strong>
              {selectedStats.lastContactSourceLabel && (
                <span style={{ fontSize: '10.5px', color: '#a5b4fc' }}>
                  {selectedStats.lastContactSourceLabel}
                </span>
              )}
            </div>

            {/* 7. 파일명 + 단일 AI 생성/수락 컨트롤 */}
            <div
              style={{
                padding: '9px 11px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '4px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  파일명
                </span>
                <span
                  style={{
                    fontSize: '10.5px',
                    fontWeight: 600,
                    color:
                      saveStatus === 'saved'
                        ? '#34d399'
                        : saveStatus === 'saving'
                          ? '#fbbf24'
                          : 'var(--text-muted)',
                  }}
                >
                  {saveStatus === 'saved'
                    ? '✅ 저장됨'
                    : saveStatus === 'saving'
                      ? '⏳ 저장중'
                      : '✏️ 편집중'}
                </span>
              </div>
              <strong
                style={{
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  color: '#a5b4fc',
                }}
              >
                📄 {selectedEntry.fileName}
              </strong>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {!pendingAiApproval ? (
                  <button
                    type="button"
                    className="toolbar-btn"
                    style={{ fontSize: '10.5px', padding: '2px 7px' }}
                    disabled={isGeneratingAi}
                    onClick={() => void handleGenerateAiProfile()}
                    title="최근 통화·대화 맥락으로 AI 프로필 초안을 생성합니다 (수정 후 수락 시 프롬프트에 자동 반영)"
                  >
                    {isGeneratingAi ? '⏳ 생성중...' : '🤖 AI 업데이트 생성'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="toolbar-btn primary"
                      style={{
                        fontSize: '10.5px',
                        padding: '2px 7px',
                        backgroundColor: '#10b981',
                        borderColor: '#059669',
                      }}
                      disabled={isResolvingAi}
                      onClick={() => void handleAcceptAiProfile()}
                    >
                      {draftText.trim() !==
                      (pendingAiApproval.candidateAText || '').trim()
                        ? '✅ 수정 수락 (프롬프트 반영)'
                        : '✅ AI 초안 수락'}
                    </button>
                    <button
                      type="button"
                      className="toolbar-btn"
                      style={{ fontSize: '10.5px', padding: '2px 6px' }}
                      disabled={isResolvingAi}
                      onClick={() => void handleDismissAiProfile()}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 편집 가능한 multi-line 입력칸: 상하좌우 여백 없이(margin: 0, padding: 0) 배치 */}
          <textarea
            ref={textareaRef}
            rows={14}
            value={draftText}
            onChange={(e) => {
              const nextVal = e.target.value;
              setDraftText(nextVal);
              setSaveStatus('editing');
              checkCaretLineState(e.currentTarget);
              if (!pendingAiApproval) {
                if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
                const target = selectedEntry.name;
                saveTimerRef.current = window.setTimeout(() => {
                  void persistProfileNow(target, nextVal);
                }, 650);
              }
            }}
            onFocus={(e) => checkCaretLineState(e.currentTarget)}
            onClick={(e) => checkCaretLineState(e.currentTarget)}
            onKeyUp={(e) => checkCaretLineState(e.currentTarget)}
            onSelect={(e) => checkCaretLineState(e.currentTarget)}
            onBlur={() => {
              if (!pendingAiApproval) {
                void persistProfileNow(selectedEntry.name, draftText);
              }
            }}
            onKeyDown={(e) => {
              if (
                (e.ctrlKey || e.metaKey) &&
                (e.key === 's' || e.key === 'S' || e.key === 'Enter')
              ) {
                e.preventDefault();
                if (pendingAiApproval) {
                  void handleAcceptAiProfile();
                } else {
                  void persistProfileNow(selectedEntry.name, draftText);
                }
              }
            }}
            style={{
              width: '100%',
              minHeight: '320px',
              margin: 0,
              padding: 0,
              border: 'none',
              outline: 'none',
              borderRadius: 0,
              boxSizing: 'border-box',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              lineHeight: 1.55,
              resize: 'vertical',
              display: 'block',
            }}
          />

          {isCaretOnGroupLine && otherContactGroupCandidates.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px',
                padding: '6px 10px',
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700 }}>
                🏷️ 소속 모임 자동완성:
              </span>
              {otherContactGroupCandidates.map((groupName) => {
                const isAdded = currentContactGroups.includes(groupName);
                return (
                  <button
                    key={groupName}
                    type="button"
                    className={`contact-group-chip ${isAdded ? 'active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const { nextText, caretPos } = toggleGroupOnProfileLine(
                        draftText,
                        groupName
                      );
                      setDraftText(nextText);
                      if (!pendingAiApproval) {
                        void persistProfileNow(selectedEntry.name, nextText);
                      }
                      window.requestAnimationFrame(() => {
                        const el = textareaRef.current;
                        if (el) {
                          el.focus();
                          el.setSelectionRange(caretPos, caretPos);
                          setIsCaretOnGroupLine(true);
                        }
                      });
                    }}
                  >
                    <span>{isAdded ? '✓' : '+'}</span>
                    <span>{groupName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
