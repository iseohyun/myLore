/**
 * @file ApprovalDashboard.tsx
 * @description 의사결재 센터 대시보드 (`Ctrl+\``):
 * - 첫 카드: 분야별 결재 건수만 간략 그래프 표시
 * - 본문: 각 카테고리마다 제목만 표시(자세한 설명 생략)하고 카테고리당 대표(1st) 안건 1개만 출력
 * - 1st 안건 처리 시 자동으로 2nd 안건으로 갱신
 * - 우측 사이드바에서 카테고리/안건 클릭 시 해당 카테고리 위치로 스크롤 및 대표 안건 교체
 * - 통화 & 연락처 프로필: A/B 중 택1 후 수정·요청사항이 있을 때 [선택안+요청사항 재분석] 또는 [승인 가정 & 프롬프트만 수정] 지원
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApprovalCategory,
  CallApprovalItem,
  ContactProfileApprovalItem,
  ContactPromptTournamentStatus,
  DocumentPayload,
  KakaoUpdateRequestItem,
  LifelogSourceType,
} from '../../types/mylore';
import {
  getCallApprovalItems,
  getCallRecordingPlayInfo,
  getContactProfileApprovals,
  getContactPromptTournamentStatus,
  getKakaoUpdateRequests,
  openContactPersonDocument,
  readDocument,
  reanalyzeRecentPendingApprovalCalls,
  resolveCallAbDecisionWithFeedback,
  resolveContactProfileApproval,
  resolveKakaoUpdateRequest,
  saveDocument,
  updateCallTranscriptStage,
} from '../../services/tauriClient';
import {
  combineYamlAndBody,
  splitYamlFrontmatter,
} from '../../utils/markdownAutoFormat';
import {
  CallScriptAbComparisonInspector,
  hasDualAbScript,
  PromptAbDiffViewer,
} from './CallScriptAbComparisonPanel';

export interface ApprovalDashboardProps {
  approvalCategory: ApprovalCategory;
  setApprovalCategory: React.Dispatch<React.SetStateAction<ApprovalCategory>>;
  approvalStageFilter: 'pending' | 'revising' | 'verified' | 'all';
  setApprovalStageFilter: React.Dispatch<
    React.SetStateAction<'pending' | 'revising' | 'verified' | 'all'>
  >;
  approvalItems: CallApprovalItem[];
  setApprovalItems: React.Dispatch<React.SetStateAction<CallApprovalItem[]>>;
  selectedApprovalStem: string | null;
  setSelectedApprovalStem: React.Dispatch<React.SetStateAction<string | null>>;
  reloadApprovalItems: () => Promise<CallApprovalItem[]>;
  applyLoadedDocument: (doc: DocumentPayload) => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMobileSidebarTab?: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  setFilterUnverifiedCallsOnly?: React.Dispatch<React.SetStateAction<boolean>>;
  handleRetryPendingCallTranscripts?: () => Promise<void>;
  isRetryingTranscripts?: boolean;
}

export interface ApprovalNavigateDetail {
  category: ApprovalCategory;
  callStem?: string;
  contactId?: number;
  kakaoRoom?: string;
}

const PROVIDER_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  gemini: { label: 'Gemini', color: '#4285F4', bg: 'rgba(66, 133, 244, 0.14)' },
  claude: { label: 'Claude', color: '#D97757', bg: 'rgba(217, 119, 87, 0.15)' },
  openai: { label: 'OpenAI', color: '#10A37F', bg: 'rgba(16, 163, 127, 0.15)' },
  grok: { label: 'Grok', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.15)' },
};

export function getProviderBadgeMeta(provider: string) {
  const key = (provider || 'gemini').trim().toLowerCase();
  if (key === 'gpt') return PROVIDER_META.openai;
  return PROVIDER_META[key] || PROVIDER_META.gemini;
}

/**
 * 통화 안건 정렬:
 * 1순위: 결재 대기(stage === 2) 여부
 * 2순위: A/B 동시 분석 스크립트(hasDualAbScript) 보유 여부
 * 3순위: 최신 일시 순
 */
export function sortCallApprovalItemsAbFirst(
  items: CallApprovalItem[]
): CallApprovalItem[] {
  return [...items].sort((a, b) => {
    const aPending = a.stage === 3 ? 1 : 0;
    const bPending = b.stage === 3 ? 1 : 0;
    if (bPending !== aPending) return bPending - aPending;

    const aDual = hasDualAbScript(a) ? 1 : 0;
    const bDual = hasDualAbScript(b) ? 1 : 0;
    if (bDual !== aDual) return bDual - aDual;

    const dCmp = b.recDate.localeCompare(a.recDate);
    if (dCmp !== 0) return dCmp;
    return b.recTime.localeCompare(a.recTime);
  });
}

export function ApprovalDashboard({
  approvalCategory,
  setApprovalCategory,
  approvalItems,
  setApprovalItems,
  selectedApprovalStem,
  setSelectedApprovalStem,
  reloadApprovalItems,
  applyLoadedDocument,
  setStatusMessage,
  setRightSidebarOpen,
  handleRetryPendingCallTranscripts,
  isRetryingTranscripts = false,
}: ApprovalDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [kakaoRequests, setKakaoRequests] = useState<KakaoUpdateRequestItem[]>([]);
  const [selectedKakaoRoom, setSelectedKakaoRoom] = useState<string | null>(null);
  const [contactApprovals, setContactApprovals] = useState<ContactProfileApprovalItem[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [tournamentStatus, setTournamentStatus] = useState<ContactPromptTournamentStatus | null>(null);

  // 통화 대표 안건 상태 (`editedDraft`에 `stem`을 함께 저장하여 다른 통화 스크립트가 노출되거나 백그라운드 리프레시에 덮어써지는 현상 원천 차단)
  const [isProcessingDecision, setIsProcessingDecision] = useState(false);
  const [rejectRequirement, setRejectRequirement] = useState('');
  const [editedDraft, setEditedDraft] = useState<{ stem: string; body: string }>({
    stem: '',
    body: '',
  });
  const [isSavingScript, setIsSavingScript] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isReanalyzing1, setIsReanalyzing1] = useState(false);

  // 연락처 프로필 대표 안건 상태
  const [chosenContactSlot, setChosenContactSlot] = useState<'A' | 'B'>('A');
  const [editedContactText, setEditedContactText] = useState('');
  const [contactFeedback, setContactFeedback] = useState('');
  const [showContactPromptDiff, setShowContactPromptDiff] = useState(false);
  const [isResolvingContact, setIsResolvingContact] = useState(false);

  // 카테고리별 섹션 ref (사이드바/그래프 클릭 시 스크롤 이동)
  const sectionRefs = useRef<Record<ApprovalCategory, HTMLDivElement | null>>({
    call_scripts: null,
    contact_profiles: null,
    kakao_updates: null,
    future_design: null,
  });

  const scrollToCategory = (cat: ApprovalCategory) => {
    sectionRefs.current[cat]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const reloadContactApprovals = async () => {
    const [cList, tStat] = await Promise.all([getContactProfileApprovals(), getContactPromptTournamentStatus()]);
    setContactApprovals(cList);
    setTournamentStatus(tStat);
  };

  const refreshAllApprovalData = async () => {
    setLoading(true);
    try {
      const [, kList] = await Promise.all([reloadApprovalItems(), getKakaoUpdateRequests(), reloadContactApprovals()]);
      setKakaoRequests(kList);
    } catch (e) {
      setStatusMessage(`결재 목록 로드 실패: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setRightSidebarOpen(true);
    void refreshAllApprovalData();
  }, []);

  // 처리 완료(승인/반려/재분석 요청)된 안건이 재처리되기 전까지 다시 노출·순환되지 않도록 세션 추적
  const [processedCallMap, setProcessedCallMap] = useState<Record<string, string>>({});
  const [manualSidebarCallStem, setManualSidebarCallStem] = useState<string | null>(null);
  const [processedContactIds, setProcessedContactIds] = useState<number[]>([]);
  const [manualSidebarContactId, setManualSidebarContactId] = useState<number | null>(null);

  useEffect(() => {
    const onNavigate = (ev: Event) => {
      const detail = (ev as CustomEvent<ApprovalNavigateDetail>).detail;
      if (!detail) return;
      if (detail.callStem) {
        setManualSidebarCallStem(detail.callStem);
        setSelectedApprovalStem(detail.callStem);
      }
      if (typeof detail.contactId === 'number') {
        setManualSidebarContactId(detail.contactId);
        setSelectedContactId(detail.contactId);
      }
      if (detail.kakaoRoom) setSelectedKakaoRoom(detail.kakaoRoom);
      setApprovalCategory(detail.category);
      requestAnimationFrame(() => scrollToCategory(detail.category));
    };
    const onExternalRefresh = () => void refreshAllApprovalData();
    window.addEventListener('mylore-approval-navigate', onNavigate);
    window.addEventListener('mylore-approval-refresh', onExternalRefresh);
    return () => {
      window.removeEventListener('mylore-approval-navigate', onNavigate);
      window.removeEventListener('mylore-approval-refresh', onExternalRefresh);
    };
  }, []);

  const isCallEligibleForPendingQueue = (item: CallApprovalItem, mapSnap: Record<string, string>): boolean => {
    if (item.stage !== 3) return false;
    const marker = mapSnap[item.safeStem];
    if (!marker) return true;
    if (marker === 'APPROVED' || marker === 'REPROCESSING') return false;
    return Boolean(item.updatedAt && item.updatedAt > marker);
  };

  const orderedCalls = useMemo(() => sortCallApprovalItemsAbFirst(approvalItems), [approvalItems]);
  const pendingCalls = useMemo(
    () => orderedCalls.filter((i) => isCallEligibleForPendingQueue(i, processedCallMap)),
    [orderedCalls, processedCallMap]
  );

  const representativeCall = useMemo(() => {
    if (selectedApprovalStem) {
      const foundPending = pendingCalls.find((i) => i.safeStem === selectedApprovalStem);
      if (foundPending) return foundPending;
      // 사용자가 사이드바에서 선택했거나 현재 편집 중인 안건(방금 승인/반려 처리하여 다음 안건으로 넘긴 경우가 아닌 안건)은
      // 백그라운드 새로고침 시에도 `pendingCalls[0]`(다른 통화)으로 멋대로 점프하지 않고 그대로 유지합니다.
      if (
        (manualSidebarCallStem && manualSidebarCallStem === selectedApprovalStem) ||
        !processedCallMap[selectedApprovalStem]
      ) {
        const foundSelected = orderedCalls.find((i) => i.safeStem === selectedApprovalStem);
        if (foundSelected) return foundSelected;
      }
    }
    return pendingCalls[0] || null;
  }, [orderedCalls, pendingCalls, selectedApprovalStem, manualSidebarCallStem, processedCallMap]);

  const editedBody =
    representativeCall && editedDraft.stem === representativeCall.safeStem
      ? editedDraft.body
      : representativeCall?.scriptMarkdown || '';

  const setEditedBody: React.Dispatch<React.SetStateAction<string>> = (updater) => {
    if (!representativeCall) return;
    const curStem = representativeCall.safeStem;
    const fallbackMd = representativeCall.scriptMarkdown || '';
    setEditedDraft((prev) => {
      const base = prev.stem === curStem ? prev.body : fallbackMd;
      const nextBody = typeof updater === 'function' ? updater(base) : updater;
      return { stem: curStem, body: nextBody };
    });
  };

  useEffect(() => {
    if (representativeCall && selectedApprovalStem !== representativeCall.safeStem) {
      setSelectedApprovalStem(representativeCall.safeStem);
    } else if (!representativeCall && selectedApprovalStem !== null) {
      setSelectedApprovalStem(null);
    }
  }, [representativeCall?.safeStem]);

  const pendingContacts = useMemo(
    () => contactApprovals.filter((a) => a.status === 'pending' && !processedContactIds.includes(a.id)),
    [contactApprovals, processedContactIds]
  );
  const representativeContact = useMemo(() => {
    if (selectedContactId !== null) {
      const foundPending = pendingContacts.find((a) => a.id === selectedContactId);
      if (foundPending) return foundPending;
      if (manualSidebarContactId !== null && manualSidebarContactId === selectedContactId) {
        const foundManual = contactApprovals.find((a) => a.id === selectedContactId);
        if (foundManual) return foundManual;
      }
    }
    return pendingContacts[0] || null;
  }, [contactApprovals, pendingContacts, selectedContactId, manualSidebarContactId]);

  useEffect(() => {
    if (!representativeContact) {
      setEditedContactText('');
      setContactFeedback('');
      return;
    }
    const slot: 'A' | 'B' =
      representativeContact.chosenSlot === 'B' ? 'B' : 'A';
    setChosenContactSlot(slot);
    setEditedContactText(
      slot === 'A'
        ? representativeContact.candidateAText
        : representativeContact.candidateBText
    );
    setContactFeedback('');
  }, [representativeContact?.id, representativeContact?.candidateAText, representativeContact?.candidateBText]);

  // 3. 카톡 업데이트 요청 대표(1st) 안건 결정
  const representativeKakao = useMemo(() => {
    if (selectedKakaoRoom) {
      const found = kakaoRequests.find((r) => r.roomName === selectedKakaoRoom);
      if (found) return found;
    }
    return kakaoRequests[0] || null;
  }, [kakaoRequests, selectedKakaoRoom]);

  // 통화 대표 안건 변경 시 오디오 및 편집 본문 로드 (동일 safeStem 편집 중 백그라운드 리프레시가 와도 편집 중인 초안을 보존)
  useEffect(() => {
    if (!representativeCall) {
      setAudioSrc(null);
      return;
    }
    setRejectRequirement(representativeCall.userRequirement || '');
    setEditedDraft((prev) =>
      prev.stem === representativeCall.safeStem
        ? prev
        : {
            stem: representativeCall.safeStem,
            body: representativeCall.scriptMarkdown || '',
          }
    );

    let cancelled = false;
    setAudioLoading(true);
    getCallRecordingPlayInfo({
      roomOrSender: representativeCall.safeStem,
      attachmentUuid: representativeCall.fileName,
    })
      .then((info) => {
        if (cancelled) return;
        if (info.audioBase64) {
          setAudioSrc(
            `data:${info.mimeType || 'audio/mp4'};base64,${info.audioBase64}`
          );
        } else {
          setAudioSrc(info.audioUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setAudioSrc(null);
      })
      .finally(() => {
        if (!cancelled) setAudioLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [representativeCall?.safeStem]);

  // 다음(2nd) 통화 안건 선택 헬퍼: 오직 미처리 결재 대기(stage === 2) 안건 중에서만 선택하며, 완료/반려 안건으로 순환 폴백하지 않음
  const pickNextCallStem = (
    items: CallApprovalItem[],
    excludeStem: string,
    nextMapSnap: Record<string, string>
  ): string | null => {
    const sorted = sortCallApprovalItemsAbFirst(items);
    const nextPending = sorted.find(
      (i) =>
        i.safeStem !== excludeStem &&
        isCallEligibleForPendingQueue(i, nextMapSnap)
    );
    return nextPending ? nextPending.safeStem : null;
  };

  const isScriptModified = Boolean(
    representativeCall &&
      editedBody.trim() &&
      editedBody.trim() !== (representativeCall.scriptMarkdown || '').trim()
  );

  const handleSaveEditedScript = async () => {
    if (!representativeCall || isSavingScript || !editedBody.trim()) return;
    setIsSavingScript(true);
    try {
      const loaded = await readDocument(representativeCall.mdPath);
      const split = splitYamlFrontmatter(loaded.rawContent);
      const combined = combineYamlAndBody(split.yamlRaw, editedBody);
      await saveDocument(representativeCall.mdPath, combined);
      setApprovalItems((prev) =>
        prev.map((it) =>
          it.safeStem === representativeCall.safeStem
            ? { ...it, scriptMarkdown: editedBody }
            : it
        )
      );
      setStatusMessage(`💾 저장 완료: ${representativeCall.contactName}`);
    } catch (e) {
      setStatusMessage(`저장 실패: ${String(e)}`);
    } finally {
      setIsSavingScript(false);
    }
  };

  // 통화 1st 안건 승인 시 자동으로 2nd 안건으로 갱신 (승인된 안건은 재노출 금지)
  const handleApproveCall = async () => {
    if (!representativeCall || isProcessingDecision) return;
    setIsProcessingDecision(true);
    try {
      const currentStem = representativeCall.safeStem;
      const nextMap: Record<string, string> = {
        ...processedCallMap,
        [currentStem]: 'APPROVED',
      };
      setProcessedCallMap(nextMap);
      setManualSidebarCallStem(null);

      if (
        editedBody.trim() &&
        editedBody.trim() !== representativeCall.scriptMarkdown.trim()
      ) {
        const loaded = await readDocument(representativeCall.mdPath);
        const split = splitYamlFrontmatter(loaded.rawContent);
        const verifiedYaml = split.yamlRaw.replace(
          /transcript_status:\s*"?unverified"?/g,
          'transcript_status: "verified"'
        );
        const combined = combineYamlAndBody(verifiedYaml, editedBody);
        await saveDocument(representativeCall.mdPath, combined);
      }
      await updateCallTranscriptStage({
        roomOrSender: representativeCall.safeStem,
        attachmentUuid: representativeCall.fileName,
        stage: 4,
        userRequirement: rejectRequirement.trim() || null,
      });
      const updated = await getCallApprovalItems();
      setApprovalItems(updated);
      await reloadContactApprovals();
      const nextStem = pickNextCallStem(updated, currentStem, nextMap);
      setSelectedApprovalStem(nextStem);
      window.dispatchEvent(new CustomEvent('mylore-approval-sidebar-sync'));
      setStatusMessage(
        `✅ 승인 완료: ${representativeCall.contactName} (다음 대기 안건으로 이동)`
      );
    } catch (e) {
      setStatusMessage(`승인 오류: ${String(e)}`);
    } finally {
      setIsProcessingDecision(false);
    }
  };

  // 통화 1st 안건 반려 시 3단계(반려/재처리 대기)로 전환 후 다음 대기 안건으로 이동 (재처리 전까지 재노출 금지)
  const handleRejectCall = async () => {
    if (!representativeCall || isProcessingDecision) return;
    const reqText =
      rejectRequirement.trim() ||
      '화자 분리 및 타임스탬프를 재검토하여 교정해 주세요.';
    setIsProcessingDecision(true);
    try {
      const currentStem = representativeCall.safeStem;
      await updateCallTranscriptStage({
        roomOrSender: representativeCall.safeStem,
        attachmentUuid: representativeCall.fileName,
        stage: 3,
        userRequirement: reqText,
      });
      const updated = await getCallApprovalItems();
      const targetAfter = updated.find((i) => i.safeStem === currentStem);
      const stamp =
        targetAfter?.updatedAt ||
        representativeCall.updatedAt ||
        new Date().toISOString();
      const nextMap: Record<string, string> = {
        ...processedCallMap,
        [currentStem]: stamp,
      };
      setProcessedCallMap(nextMap);
      setManualSidebarCallStem(null);
      setApprovalItems(updated);
      const nextStem = pickNextCallStem(updated, currentStem, nextMap);
      setSelectedApprovalStem(nextStem);
      window.dispatchEvent(new CustomEvent('mylore-approval-sidebar-sync'));
      setStatusMessage(
        `↩️ 반려 접수 완료(재처리 대기): ${representativeCall.contactName} (다음 대기 안건으로 이동)`
      );
    } catch (e) {
      setStatusMessage(`반려 오류: ${String(e)}`);
    } finally {
      setIsProcessingDecision(false);
    }
  };

  // 통화 후처리 재시도 결정 시: 우선 결재 목록(pendingCalls)에서 즉시 제외하고 다음 안건으로 전환한 뒤, 후처리 완료 시 다시 결재 목록에 올림
  const handlePostprocessRetryLifecycle = async (
    phase: 'start' | 'done' | 'error',
    stem: string,
    contactName: string
  ) => {
    if (phase === 'start') {
      const nextMap: Record<string, string> = { ...processedCallMap, [stem]: 'REPROCESSING' };
      setProcessedCallMap(nextMap);
      setManualSidebarCallStem(null);
      setEditedDraft((prev) => (prev.stem === stem ? { stem: '', body: '' } : prev));
      const nextItems = approvalItems.map((it) => (it.safeStem === stem ? { ...it, stage: 2 } : it));
      setApprovalItems(nextItems);
      const nextStem = pickNextCallStem(nextItems, stem, nextMap);
      setSelectedApprovalStem(nextStem);
      window.dispatchEvent(new CustomEvent('mylore-approval-sidebar-sync'));
    } else {
      setProcessedCallMap((prev) => {
        const copy = { ...prev };
        delete copy[stem];
        return copy;
      });
      setEditedDraft((prev) => (prev.stem === stem ? { stem: '', body: '' } : prev));
      try {
        const updated = await getCallApprovalItems();
        setApprovalItems(updated);
        window.dispatchEvent(new CustomEvent('mylore-approval-sidebar-sync'));
        if (phase === 'done') {
          setStatusMessage(`✅ '${contactName}' 후처리 완료 · 결재 목록에 다시 등록되었습니다.`);
        }
      } catch {
        // ignore
      }
    }
  };

  // 통화 A/B/ASR 선택 후 요청사항 기반 [재분석 요청 접수] 또는 [승인 가정 & 프롬프트만 수정]
  const handleCallFeedbackDecision = async (
    action: 'reanalyze_with_feedback' | 'approve_and_evolve_prompt',
    chosenSlot: 'ASR' | 'A' | 'B' | 'BOTH',
    feedback: string
  ) => {
    if (!representativeCall || isProcessingDecision) return;
    setIsProcessingDecision(true);
    const effSlot: 'ASR' | 'A' | 'B' =
      chosenSlot === 'ASR' ? 'ASR' : chosenSlot === 'B' ? 'B' : 'A';
    const currentStem = representativeCall.safeStem;
    const currentContact = representativeCall.contactName;
    const editedSnap = isScriptModified ? editedBody : undefined;
    try {
      if (action === 'reanalyze_with_feedback') {
        await handlePostprocessRetryLifecycle('start', currentStem, currentContact);
        setStatusMessage(`🔄 [${currentContact}] 후처리 재시도 진행 중 (결재 목록에서 일시 제외 · 완료 시 복귀)`);
        setIsProcessingDecision(false);
        await resolveCallAbDecisionWithFeedback({
          safeStem: currentStem,
          chosenSlot: effSlot,
          action,
          userFeedback: feedback.trim() || undefined,
          editedScript: editedSnap,
        });
        await handlePostprocessRetryLifecycle('done', currentStem, currentContact);
        return;
      }
      const updated = await resolveCallAbDecisionWithFeedback({
        safeStem: currentStem,
        chosenSlot: effSlot,
        action,
        userFeedback: feedback.trim() || undefined,
        editedScript: editedSnap,
      });
      const nextMap: Record<string, string> = { ...processedCallMap, [currentStem]: 'APPROVED' };
      setProcessedCallMap(nextMap);
      setManualSidebarCallStem(null);
      setApprovalItems(updated);
      const nextTournament = await getContactPromptTournamentStatus();
      setTournamentStatus(nextTournament);
      window.dispatchEvent(new CustomEvent('mylore-approval-sidebar-sync'));
      const nextStem = pickNextCallStem(updated, currentStem, nextMap);
      setSelectedApprovalStem(nextStem);
      setStatusMessage(`🧬 [${currentContact}] ${effSlot}안 승인 가정 & 프롬프트 진화 완료 (다음 안건으로 이동)`);
    } catch (e) {
      if (action === 'reanalyze_with_feedback') {
        await handlePostprocessRetryLifecycle('error', currentStem, currentContact);
      }
      setStatusMessage(`통화 A/B 피드백 처리 오류: ${String(e)}`);
    } finally {
      setIsProcessingDecision(false);
    }
  };

  // 연락처 프로필 1st 안건 처리 ([승인] / [제외] / [선택안+요청 재분석] / [승인 가정 & 프롬프트만 수정])
  const handleResolveContact = async (
    action:
      | 'approve'
      | 'dismiss'
      | 'reanalyze_with_feedback'
      | 'approve_and_evolve_prompt'
  ) => {
    if (!representativeContact || isResolvingContact) return;
    setIsResolvingContact(true);
    try {
      const currentId = representativeContact.id;
      const nextProcessedIds = processedContactIds.includes(currentId)
        ? processedContactIds
        : [...processedContactIds, currentId];
      setProcessedContactIds(nextProcessedIds);
      setManualSidebarContactId(null);

      const updatedList = await resolveContactProfileApproval({
        approvalId: currentId,
        action,
        chosenSlot: chosenContactSlot,
        finalProfileText: editedContactText,
        userFeedback: contactFeedback.trim() || undefined,
      });
      setContactApprovals(updatedList);
      const nextTournament = await getContactPromptTournamentStatus();
      setTournamentStatus(nextTournament);
      window.dispatchEvent(new CustomEvent('mylore-approval-sidebar-sync'));

      const nextPending = updatedList.find(
        (i) =>
          i.id !== currentId &&
          i.status === 'pending' &&
          !nextProcessedIds.includes(i.id)
      );
      setSelectedContactId(nextPending ? nextPending.id : null);
      setStatusMessage(
        action === 'reanalyze_with_feedback'
          ? `🔄 [${representativeContact.contactName}] ${chosenContactSlot}안 + 요청사항 재분석 접수 (다음 안건으로 이동)`
          : action === 'approve_and_evolve_prompt'
            ? `🧬 [${representativeContact.contactName}] ${chosenContactSlot}안 승인 가정 & 프롬프트만 수정 완료 (다음 안건으로 이동)`
            : action === 'approve'
              ? `✅ 인물 프로필 승인 완료: ${representativeContact.contactName}`
              : `✕ 인물 프로필 안건 제외: ${representativeContact.contactName}`
      );
    } catch (e) {
      setStatusMessage(`인물 결재 오류: ${String(e)}`);
    } finally {
      setIsResolvingContact(false);
    }
  };

  // 카톡 1st 안건 처리 시 자동으로 2nd 안건으로 갱신
  const handleResolveKakao = async (
    roomName: string,
    action: 'dismiss' | 'mark_auto_channel'
  ) => {
    try {
      const updated = await resolveKakaoUpdateRequest(roomName, action);
      setKakaoRequests(updated);
      const nextRoom = updated.find((r) => r.roomName !== roomName);
      setSelectedKakaoRoom(nextRoom ? nextRoom.roomName : null);
      window.dispatchEvent(new CustomEvent('mylore-approval-sidebar-sync'));
      setStatusMessage(`✓ 카톡 안건 처리 완료: ${roomName}`);
    } catch (e) {
      setStatusMessage(`카톡 처리 오류: ${String(e)}`);
    }
  };

  const handleReanalyzeRecent1PendingCall = async () => {
    if (isReanalyzing1) return;
    setIsReanalyzing1(true);
    try {
      const updatedCalls = await reanalyzeRecentPendingApprovalCalls(1);
      setApprovalItems(updatedCalls);
      await reloadContactApprovals();
      const sorted = sortCallApprovalItemsAbFirst(updatedCalls);
      if (sorted[0]) setSelectedApprovalStem(sorted[0].safeStem);
      setStatusMessage('✅ 최근 1통화 기본 A/B 재분석 완료');
    } catch (e) {
      setStatusMessage(`재분석 실패: ${String(e)}`);
    } finally {
      setIsReanalyzing1(false);
    }
  };

  // 첫 카드: 분야별 건수 그래프 데이터
  const graphItems: Array<{
    cat: ApprovalCategory;
    label: string;
    count: number;
    color: string;
  }> = [
    { cat: 'call_scripts', label: '📞 통화기록 검수', count: pendingCalls.length, color: '#f59e0b' },
    { cat: 'contact_profiles', label: '👤 연락처 프로필', count: pendingContacts.length, color: '#38bdf8' },
    { cat: 'kakao_updates', label: '💬 카톡 업데이트', count: kakaoRequests.length, color: '#eab308' },
    { cat: 'future_design', label: '🗓️ 일정 업데이트', count: 4, color: '#a855f7' },
  ];
  const maxGraphCount = Math.max(...graphItems.map((g) => g.count), 1);

  return (
    <div
      className="lifelog-dashboard"
      style={{ padding: '18px 22px', overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      {/* 상단 간결 헤더 (설명 생략) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '17px' }}>⚖️ 의사결재 센터</h2>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="toolbar-btn primary"
            style={{ padding: '4px 10px', fontSize: '12px' }}
            disabled={isReanalyzing1}
            onClick={() => void handleReanalyzeRecent1PendingCall()}
          >
            {isReanalyzing1 ? '⏳ A/B 분석 중...' : '🎙️ 최근 1통화 A/B 재분석'}
          </button>
          {handleRetryPendingCallTranscripts && (
            <button
              type="button"
              className="toolbar-btn"
              style={{ padding: '4px 10px', fontSize: '12px' }}
              disabled={isRetryingTranscripts}
              onClick={() => void handleRetryPendingCallTranscripts()}
            >
              {isRetryingTranscripts ? '⏳ AI 배분 중...' : '🤖 AI 배분'}
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn"
            style={{ padding: '4px 10px', fontSize: '12px' }}
            disabled={loading}
            onClick={() => void refreshAllApprovalData()}
          >
            🔄
          </button>
        </div>
      </div>

      {/* 첫 카드: 분야별 건수 그래프만 간략 표시 */}
      <div
        className="settings-card"
        style={{ padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}
      >
        {graphItems.map((g) => {
          const pct = Math.max(Math.round((g.count / maxGraphCount) * 100), 4);
          const isActive = approvalCategory === g.cat;
          return (
            <div
              key={g.cat}
              onClick={() => {
                setApprovalCategory(g.cat);
                scrollToCategory(g.cat);
              }}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-primary)',
                border: isActive ? `1.5px solid ${g.color}` : '1px solid var(--border-color)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 700 }}>{g.label}</span>
                <strong style={{ fontSize: '14px', color: g.color }}>{g.count}건</strong>
              </div>
              <div style={{ width: '100%', height: '7px', borderRadius: '999px', backgroundColor: 'var(--bg-secondary)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: '999px', backgroundColor: g.color, transition: 'width 0.25s ease' }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 카테고리 1: 통화기록 검수 (제목만 표시, A/B 동시 분석 우선 1st 대표 안건 1개만 출력) */}
      <div
        ref={(el) => { sectionRefs.current.call_scripts = el; }}
        id="approval-cat-call_scripts"
        className="settings-card"
        style={{
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: approvalCategory === 'call_scripts' ? '1.5px solid var(--accent-primary)' : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '15px', color: 'var(--heading-color)' }}>📞 통화기록 검수</strong>
          <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(245, 158, 11, 0.16)', color: '#f59e0b' }}>
            {pendingCalls.length}건
          </span>
        </div>

        {representativeCall ? (
          <CallScriptAbComparisonInspector
            key={representativeCall.safeStem}
            selectedItem={representativeCall}
            providerBadge={getProviderBadgeMeta(representativeCall.llmProvider)}
            audioSrc={audioSrc}
            audioLoading={audioLoading}
            playbackRate={playbackRate}
            setPlaybackRate={setPlaybackRate}
            editedBody={editedBody}
            setEditedBody={setEditedBody}
            isScriptModified={isScriptModified}
            isSavingScript={isSavingScript}
            isProcessingDecision={isProcessingDecision}
            rejectRequirement={rejectRequirement}
            setRejectRequirement={setRejectRequirement}
            handleApproveItem={handleApproveCall}
            handleSaveEditedScript={handleSaveEditedScript}
            handleRejectAndReassign={handleRejectCall}
            onCallFeedbackDecision={handleCallFeedbackDecision}
            onPostprocessRetryLifecycle={handlePostprocessRetryLifecycle}
            setStatusMessage={setStatusMessage}
            tournamentStatus={tournamentStatus}
            setTournamentStatus={setTournamentStatus}
          />
        ) : (
          <div style={{ padding: '14px', textAlign: 'center', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            대기 안건 없음
          </div>
        )}
      </div>

      {/* 카테고리 2: 연락처 프로필 업데이트 (제목만 표시, 대표 안건 1개만 출력) */}
      <div
        ref={(el) => { sectionRefs.current.contact_profiles = el; }}
        id="approval-cat-contact_profiles"
        className="settings-card"
        style={{
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          border: approvalCategory === 'contact_profiles' ? '1.5px solid var(--accent-primary)' : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '15px', color: 'var(--heading-color)' }}>👤 연락처 프로필 업데이트</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className={`toolbar-btn ${showContactPromptDiff ? 'primary' : ''}`}
              style={{ padding: '2px 8px', fontSize: '11.5px' }}
              onClick={() => setShowContactPromptDiff((v) => !v)}
              title="인물 서술 AI 생성 프롬프트 확인·편집"
            >
              🧬 프롬프트
            </button>
            <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(56, 189, 248, 0.16)', color: '#38bdf8' }}>
              {pendingContacts.length}건
            </span>
          </div>
        </div>

        {showContactPromptDiff && (
          <PromptAbDiffViewer
            tournamentStatus={tournamentStatus}
            setTournamentStatus={setTournamentStatus}
            setStatusMessage={setStatusMessage}
            onClose={() => setShowContactPromptDiff(false)}
          />
        )}

        {representativeContact ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ fontSize: '14px' }}>👤 {representativeContact.contactName}</strong>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {representativeContact.sourceRef}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="toolbar-btn"
                  style={{ padding: '3px 8px', fontSize: '11.5px' }}
                  onClick={async () => {
                    try {
                      const doc = await openContactPersonDocument(representativeContact.contactName);
                      applyLoadedDocument(doc);
                    } catch (e) {
                      setStatusMessage(`문서 열기 실패: ${String(e)}`);
                    }
                  }}
                >
                  📄 {representativeContact.contactName}.md
                </button>
                <button
                  type="button"
                  className="toolbar-btn primary"
                  style={{ backgroundColor: '#10b981', borderColor: '#059669', padding: '3px 10px', fontSize: '11.5px' }}
                  disabled={isResolvingContact}
                  onClick={() => void handleResolveContact('approve')}
                  title="AI 생성 데이터를 그대로 수락하거나, 아래에서 수정한 경우 수정 내용을 분석하여 프롬프트에 자동 반영합니다"
                >
                  {editedContactText.trim() !== (representativeContact.candidateAText || '').trim()
                    ? '✅ 수정 후 수락 (프롬프트 자동 반영)'
                    : '✅ 수락'}
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  style={{ padding: '3px 8px', fontSize: '11.5px' }}
                  disabled={isResolvingContact}
                  onClick={() => void handleResolveContact('dismiss')}
                >
                  ✕ 제외
                </button>
              </div>
            </div>

            <textarea
              rows={8}
              className="input-field"
              style={{
                width: '100%',
                margin: 0,
                padding: '8px 10px',
                fontSize: '12.5px',
                fontFamily: 'var(--font-mono)',
                lineHeight: 1.5,
                resize: 'vertical',
              }}
              value={editedContactText}
              onChange={(e) => setEditedContactText(e.target.value)}
            />
          </div>
        ) : (
          <div style={{ padding: '14px', textAlign: 'center', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            대기 안건 없음
          </div>
        )}
      </div>

      {/* 카테고리 3: 카톡 업데이트 요청 (제목만 표시, 대표 안건 1개만 출력) */}
      <div
        ref={(el) => { sectionRefs.current.kakao_updates = el; }}
        id="approval-cat-kakao_updates"
        className="settings-card"
        style={{
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          border: approvalCategory === 'kakao_updates' ? '1.5px solid var(--accent-primary)' : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '15px', color: 'var(--heading-color)' }}>💬 카톡 업데이트 요청</strong>
          <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(234, 179, 8, 0.16)', color: '#eab308' }}>
            {kakaoRequests.length}건
          </span>
        </div>

        {representativeKakao ? (
          <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '13.5px' }}>💬 {representativeKakao.roomName}</strong>
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '1px 6px', borderRadius: '999px', color: '#eab308', backgroundColor: 'rgba(250, 204, 21, 0.16)' }}>{representativeKakao.pendingNotiCount}건</span>
                <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{representativeKakao.lastNotiDate} {representativeKakao.lastNotiTime}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{representativeKakao.lastMessagePreview}</span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button type="button" className="toolbar-btn" style={{ padding: '3px 8px', fontSize: '11.5px' }} onClick={async () => { try { const doc = await openContactPersonDocument(representativeKakao.roomName); applyLoadedDocument(doc); } catch (e) { setStatusMessage(`연락처 문서 열기 실패: ${String(e)}`); } }}>👤 연락처 .md</button>
                <button type="button" className="toolbar-btn" style={{ padding: '3px 8px', fontSize: '11.5px' }} onClick={() => void handleResolveKakao(representativeKakao.roomName, 'mark_auto_channel')}>🤖 채널지정</button>
                <button type="button" className="toolbar-btn" style={{ padding: '3px 8px', fontSize: '11.5px' }} onClick={() => void handleResolveKakao(representativeKakao.roomName, 'dismiss')}>✕ 제외</button>
              </div>
            </div>
            {(representativeKakao.candidateRoomsHint || (representativeKakao.kakaoGroups && representativeKakao.kakaoGroups.length > 0)) && (
              <div style={{ fontSize: '11.5px', color: '#fbbf24', backgroundColor: 'rgba(234, 179, 8, 0.08)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(234, 179, 8, 0.25)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {representativeKakao.candidateRoomsHint && (
                  <span>📌 <strong>{representativeKakao.candidateRoomsHint}</strong></span>
                )}
                {representativeKakao.kakaoGroups && representativeKakao.kakaoGroups.length > 0 && (
                  <span style={{ color: 'var(--text-secondary)' }}>👥 속해있는 카톡 그룹: {representativeKakao.kakaoGroups.join(' / ')}</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '14px', textAlign: 'center', fontSize: '12.5px', color: 'var(--text-secondary)' }}>대기 안건 없음</div>
        )}
      </div>

      {/* 카테고리 4: 일정 업데이트 (제목만 표시, 대표 안건 1개만 출력) */}
      <div
        ref={(el) => { sectionRefs.current.future_design = el; }}
        id="approval-cat-future_design"
        className="settings-card"
        style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px', border: approvalCategory === 'future_design' ? '1.5px solid var(--accent-primary)' : undefined }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '15px', color: 'var(--heading-color)' }}>🗓️ 일정 업데이트</strong>
          <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(168, 85, 247, 0.16)', color: '#a855f7' }}>4건</span>
        </div>
        <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', fontSize: '12.5px', color: 'var(--text-primary)' }}>
          🗓️ 2026-11-06 통화 기반 신규 일정 후보 1건
        </div>
      </div>
    </div>
  );
}
