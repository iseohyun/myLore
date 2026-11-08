/**
 * @file CallScriptCompareModal.tsx
 * @description 통화 우클릭 메뉴 [🔍 각 스크립트 비교하기] 모달:
 * - 좌측: ASR 스크립트 고정 / 우측: 후처리 스크립트
 * - 우상단 아이콘 전용 버튼: [🎙️ ASR 재시도] [✨ 후처리 재시도] [✅ 현재 내용으로 확정] [✕ 닫기]
 * - 각 대사 좌클릭 시 해당 시각부터 즉시 재생, 우클릭 시 [화자 변환 / 스크립트 수정 / 시점 변환 / 삭제] 컨텍스트 메뉴 제공.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DocumentPayload, UserScriptEditEntry } from '../../types/mylore';
import {
  analyzeSingleCallAsrAndAb,
  confirmCallScriptWithUserEdits,
  getCallRecordingPlayInfo,
  openLifelogItemDocument,
  readDocument,
  saveDocument,
} from '../../services/tauriClient';
import {
  combineYamlAndBody,
  splitYamlFrontmatter,
} from '../../utils/markdownAutoFormat';
import {
  buildUserScriptEditEntry,
  CallPostprocessPromptPopupModal,
  extractDualScriptsFromMarkdown,
  LineContextMenuState,
  mutateLineInSectionMarkdown,
  parseDialogueLines,
  ParsedScriptLine,
  parseTimeInputToTag,
  rebuildFullMarkdownFromParsed,
} from '../dashboards/CallScriptAbComparisonPanel';
import {
  CallParticipantBackgroundEditorBox,
  CallScriptLineContextMenuAndModals,
  mutateBatchSpeakerOrDeleteInSectionMarkdown,
  mutateMergeLinesInSectionMarkdown,
  mutateSplitLineInSectionMarkdown,
  SplitModalState,
  TextOrTimeEditModalState,
  useParticipantBackgroundProfiles,
} from '../dashboards/callScriptCompareUtils';

export interface CallScriptCompareTarget {
  roomOrSender: string;
  attachmentUuid?: string;
  personName: string;
}

export interface CallScriptCompareModalProps {
  target: CallScriptCompareTarget | null;
  onClose: () => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  applyLoadedDocument?: (doc: DocumentPayload) => void;
  refreshAllLifelogMessages?: () => Promise<void>;
  refreshTree?: () => Promise<void>;
}

export function CallScriptCompareModal({
  target,
  onClose,
  setStatusMessage,
  applyLoadedDocument,
  refreshAllLifelogMessages,
  refreshTree,
}: CallScriptCompareModalProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRefLeft = useRef<HTMLDivElement | null>(null);
  const scrollRefRight = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<'LEFT' | 'RIGHT' | null>(null);
  const scrollUnlockTimerRef = useRef<number | null>(null);

  const [docPayload, setDocPayload] = useState<DocumentPayload | null>(null);
  const [initialPostScript, setInitialPostScript] = useState<string>('');
  const [sessionEdits, setSessionEdits] = useState<UserScriptEditEntry[]>([]);
  const [showPromptPopup, setShowPromptPopup] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [busyAction, setBusyAction] = useState<'asr' | 'post' | 'confirm' | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [currentAudioSec, setCurrentAudioSec] = useState<number>(0);
  const [lineMenu, setLineMenu] = useState<LineContextMenuState | null>(null);
  const [asrMenuOpen, setAsrMenuOpen] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'post' | 'prev_post'>('post');
  const [userComment, setUserComment] = useState<string>('');
  const [selectedSide, setSelectedSide] = useState<'LEFT' | 'RIGHT'>('RIGHT');
  const [selectedRawIdxs, setSelectedRawIdxs] = useState<number[]>([]);
  const [lastAnchorOrderIdx, setLastAnchorOrderIdx] = useState<number | null>(null);
  const [editingModal, setEditingModal] = useState<TextOrTimeEditModalState | null>(null);
  const [splitModal, setSplitModal] = useState<SplitModalState | null>(null);

  const bgProfiles = useParticipantBackgroundProfiles(target?.personName || '', setStatusMessage);

  useEffect(() => {
    if (!target) {
      setDocPayload(null);
      setAudioSrc(null);
      return;
    }
    let cancelled = false;
    setLoadingDoc(true);
    setCurrentAudioSec(0);
    setLineMenu(null);
    setEditingModal(null);
    setSplitModal(null);
    setSessionEdits([]);
    setSelectedRawIdxs([]);
    setLastAnchorOrderIdx(null);

    openLifelogItemDocument({
      source: 'call',
      roomOrSender: target.roomOrSender,
      attachmentUuid: target.attachmentUuid ?? null,
    })
      .then((doc) => {
        if (!cancelled) {
          setDocPayload(doc);
          const initParsed = extractDualScriptsFromMarkdown(doc.bodyContent || '');
          setInitialPostScript(initParsed.scriptPostMarkdown);
        }
      })
      .catch((err) => {
        if (!cancelled) setStatusMessage(`❌ 통화 문서 로드 실패: ${String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });

    getCallRecordingPlayInfo({
      roomOrSender: target.roomOrSender,
      attachmentUuid: target.attachmentUuid,
    })
      .then((info) => {
        if (cancelled) return;
        if (info.audioBase64) {
          setAudioSrc(`data:${info.mimeType || 'audio/mp4'};base64,${info.audioBase64}`);
        } else {
          setAudioSrc(info.audioUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setAudioSrc(null);
      });

    return () => {
      cancelled = true;
    };
  }, [target?.roomOrSender, target?.attachmentUuid]);

  const parsed = useMemo(
    () => extractDualScriptsFromMarkdown(docPayload?.bodyContent || ''),
    [docPayload?.bodyContent]
  );
  const hasUserEdits =
    sessionEdits.length > 0 ||
    parsed.scriptPostMarkdown.trim() !== initialPostScript.trim();

  const linesAsr = useMemo(
    () => parseDialogueLines(parsed.scriptAsrMarkdown).filter((l) => l.isDialogue),
    [parsed.scriptAsrMarkdown]
  );
  const linesPost = useMemo(
    () =>
      parseDialogueLines(
        rightTab === 'prev_post' && parsed.scriptPrevPostMarkdown
          ? parsed.scriptPrevPostMarkdown
          : parsed.scriptPostMarkdown
      ).filter((l) => l.isDialogue),
    [parsed.scriptPostMarkdown, parsed.scriptPrevPostMarkdown, rightTab]
  );

  const handleSeekAndPlay = (sec: number, timeTag: string, speaker: string) => {
    if (sec < 0 || !audioRef.current) return;
    audioRef.current.currentTime = sec;
    audioRef.current.playbackRate = playbackRate;
    setCurrentAudioSec(sec);
    void audioRef.current.play().catch(() => {});
    setStatusMessage(`▶️ [${timeTag}] ${speaker} 재생`);
  };

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.tagName === 'AUDIO' ||
          active.isContentEditable)
      ) {
        return;
      }
      if (editingModal || splitModal || showPromptPopup) return;
      const sourceLines = selectedSide === 'LEFT' ? linesAsr : linesPost;
      const selectedObjects = sourceLines.filter((l) => selectedRawIdxs.includes(l.rawLineIdx));
      if (selectedObjects.length === 0) return;
      e.preventDefault();
      const firstLine = [...selectedObjects].sort((a, b) => a.rawLineIdx - b.rawLineIdx)[0];
      handleSeekAndPlay(firstLine.sec, firstLine.timeTag, firstLine.speaker);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    target,
    selectedSide,
    selectedRawIdxs,
    linesAsr,
    linesPost,
    playbackRate,
    editingModal,
    splitModal,
    showPromptPopup,
  ]);

  if (!target) return null;

  const handleLineClick = (
    e: React.MouseEvent,
    side: 'LEFT' | 'RIGHT',
    line: ParsedScriptLine,
    orderIdx: number,
    list: ParsedScriptLine[]
  ) => {
    e.stopPropagation();
    setLineMenu(null);
    if (selectedSide !== side) {
      setSelectedSide(side);
      setSelectedRawIdxs([line.rawLineIdx]);
      setLastAnchorOrderIdx(orderIdx);
      return;
    }
    if (e.shiftKey && lastAnchorOrderIdx !== null) {
      const start = Math.min(lastAnchorOrderIdx, orderIdx);
      const end = Math.max(lastAnchorOrderIdx, orderIdx);
      const rangeRaw = list.slice(start, end + 1).map((item) => item.rawLineIdx);
      setSelectedRawIdxs(rangeRaw);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedRawIdxs((prev) =>
        prev.includes(line.rawLineIdx)
          ? prev.filter((id) => id !== line.rawLineIdx)
          : [...prev, line.rawLineIdx]
      );
      setLastAnchorOrderIdx(orderIdx);
      return;
    }
    setSelectedRawIdxs([line.rawLineIdx]);
    setLastAnchorOrderIdx(orderIdx);
  };

  const persistNextBody = async (nextBody: string) => {
    if (!docPayload) return;
    const pathKey = docPayload.fullPath || docPayload.relativePath;
    const loaded = await readDocument(pathKey);
    const split = splitYamlFrontmatter(loaded.rawContent);
    const combined = combineYamlAndBody(split.yamlRaw, nextBody);
    await saveDocument(pathKey, combined);
    const nextDoc = { ...docPayload, bodyContent: nextBody, rawContent: combined };
    setDocPayload(nextDoc);
    applyLoadedDocument?.(nextDoc);
  };

  const handleRetryAsrMode = async (
    mode: 'asr_full' | 'asr_time_only' | 'asr_time_speaker'
  ) => {
    if (busyAction || loadingDoc) return;
    setAsrMenuOpen(false);
    setBusyAction('asr');
    setStatusMessage(
      mode === 'asr_full'
        ? `🎙️ '${target.personName}' ASR 전면 재처리 중...`
        : mode === 'asr_time_only'
        ? `⏱️ '${target.personName}' ASR 시각만 재처리 중...`
        : `🗣️ '${target.personName}' ASR 시각/화자만 재처리 중...`
    );
    try {
      await bgProfiles.flushBothIfDirty();
      const updatedDoc = await analyzeSingleCallAsrAndAb({
        roomOrSender: target.roomOrSender,
        attachmentUuid: target.attachmentUuid,
        mode,
      });
      setDocPayload(updatedDoc);
      applyLoadedDocument?.(updatedDoc);
      await refreshAllLifelogMessages?.();
      await refreshTree?.();
      setStatusMessage(`✅ '${target.personName}' ASR(${mode}) 완료`);
    } catch (e) {
      setStatusMessage(`❌ ASR 재처리 실패: ${String(e)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRetryPostprocess = async (
    mode: 'ai_postprocess_full' | 'ai_postprocess_discard_prev' | 'ai_postprocess_with_comment'
  ) => {
    if (busyAction || loadingDoc) return;
    setPostMenuOpen(false);
    setBusyAction('post');
    setStatusMessage(
      mode === 'ai_postprocess_with_comment'
        ? `💬 '${target.personName}' 수정 내용 저장 및 코멘트 반영 후처리 중...`
        : mode === 'ai_postprocess_discard_prev'
        ? `🗑️ '${target.personName}' 기존 후처리 폐기 후 전면 재작성 중...`
        : `✨ '${target.personName}' AI 후처리 전면 재처리 중...`
    );
    try {
      await bgProfiles.flushBothIfDirty();
      const updatedDoc = await analyzeSingleCallAsrAndAb({
        roomOrSender: target.roomOrSender,
        attachmentUuid: target.attachmentUuid,
        mode,
        editEntries: mode === 'ai_postprocess_discard_prev' ? [] : sessionEdits,
        editedPostScript:
          mode === 'ai_postprocess_with_comment' ? parsed.scriptPostMarkdown : undefined,
        userComment: userComment.trim() || undefined,
      });
      setDocPayload(updatedDoc);
      const nextParsed = extractDualScriptsFromMarkdown(updatedDoc.bodyContent || '');
      setInitialPostScript(nextParsed.scriptPostMarkdown);
      setSessionEdits([]);
      setRightTab('post');
      applyLoadedDocument?.(updatedDoc);
      await refreshAllLifelogMessages?.();
      await refreshTree?.();
      setStatusMessage(
        mode === 'ai_postprocess_discard_prev'
          ? `✅ '${target.personName}' 기존 후처리 폐기 후 후처리 스크립트 전면 재작성 완료`
          : `✅ '${target.personName}' 후처리 스크립트 갱신 완료 (이전 후처리 보관됨)`
      );
    } catch (e) {
      setStatusMessage(`❌ 후처리 재시도 실패: ${String(e)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmCurrent = async () => {
    if (!docPayload || busyAction || loadingDoc) return;
    setBusyAction('confirm');
    try {
      await bgProfiles.flushBothIfDirty();
      const pathKey = docPayload.fullPath || docPayload.relativePath;
      const loaded = await readDocument(pathKey);
      const split = splitYamlFrontmatter(loaded.rawContent);
      const verifiedYaml = split.yamlRaw.replace(
        /transcript_status:\s*"?[^"\r\n]+"?/g,
        'transcript_status: "verified"'
      );
      const combined = combineYamlAndBody(verifiedYaml, docPayload.bodyContent);
      await saveDocument(pathKey, combined);
      const finalDoc = await confirmCallScriptWithUserEdits({
        roomOrSender: target.roomOrSender,
        attachmentUuid: target.attachmentUuid,
        originalPostScript: initialPostScript,
        finalPostScript: parsed.scriptPostMarkdown,
        editEntries: sessionEdits,
      });
      setDocPayload(finalDoc);
      applyLoadedDocument?.(finalDoc);
      await refreshAllLifelogMessages?.();
      await refreshTree?.();
      setStatusMessage(
        hasUserEdits
          ? `✅ '${target.personName}' 수정 후 확인 완료 (사용자 변경 로그 기록 및 프롬프트 반영됨)`
          : `✅ '${target.personName}' 확인 완료`
      );
      onClose();
    } catch (e) {
      setStatusMessage(`❌ 확정 처리 실패: ${String(e)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const commitSectionUpdate = async (
    side: 'LEFT' | 'RIGHT',
    updatedSection: string,
    newEntries: UserScriptEditEntry[],
    nextSelectedRawIdxs: number[] = []
  ) => {
    const nextFull = rebuildFullMarkdownFromParsed(
      parsed,
      side === 'LEFT' ? { asrMd: updatedSection } : { postMd: updatedSection }
    );
    if (newEntries.length > 0) {
      setSessionEdits((prev) => [...prev, ...newEntries]);
    }
    setSelectedRawIdxs(nextSelectedRawIdxs);
    setLineMenu(null);
    setEditingModal(null);
    setSplitModal(null);
    try {
      await persistNextBody(nextFull);
      setStatusMessage(`💾 대사 수정 사항이 반영되었습니다.`);
    } catch (e) {
      setStatusMessage(`❌ 대사 수정 저장 실패: ${String(e)}`);
    }
  };

  const getTargetLinesForAction = (side: 'LEFT' | 'RIGHT', fallbackLine: ParsedScriptLine) => {
    const list = side === 'LEFT' ? linesAsr : linesPost;
    if (
      selectedSide === side &&
      selectedRawIdxs.includes(fallbackLine.rawLineIdx) &&
      selectedRawIdxs.length > 1
    ) {
      return list.filter((l) => selectedRawIdxs.includes(l.rawLineIdx));
    }
    return [fallbackLine];
  };

  const applyLineMutation = async (
    side: 'LEFT' | 'RIGHT',
    line: ParsedScriptLine,
    mutation:
      | { type: 'toggle_speaker'; counterpartName: string }
      | { type: 'edit_text'; nextText: string }
      | { type: 'delete_line' }
      | { type: 'change_time'; nextTimeTag: string }
  ) => {
    const srcSection =
      side === 'LEFT' ? parsed.scriptAsrMarkdown : parsed.scriptPostMarkdown;
    const updatedSection = mutateLineInSectionMarkdown(srcSection, line, mutation);
    const editEntry = buildUserScriptEditEntry(line, mutation);
    await commitSectionUpdate(side, updatedSection, [editEntry], selectedRawIdxs);
  };

  const handleSyncScroll = (sourceCol: 'LEFT' | 'RIGHT') => {
    if (scrollLockRef.current && scrollLockRef.current !== sourceCol) return;
    scrollLockRef.current = sourceCol;
    if (scrollUnlockTimerRef.current !== null) window.clearTimeout(scrollUnlockTimerRef.current);
    scrollUnlockTimerRef.current = window.setTimeout(() => {
      scrollLockRef.current = null;
    }, 100);

    const srcEl = sourceCol === 'LEFT' ? scrollRefLeft.current : scrollRefRight.current;
    const dstEl = sourceCol === 'LEFT' ? scrollRefRight.current : scrollRefLeft.current;
    if (!srcEl || !dstEl) return;

    const maxSrcScroll = srcEl.scrollHeight - srcEl.clientHeight;
    const maxDstScroll = dstEl.scrollHeight - dstEl.clientHeight;
    if (maxSrcScroll <= 0 || maxDstScroll <= 0) return;

    if (srcEl.scrollTop <= 2) {
      dstEl.scrollTop = 0;
      return;
    }
    if (srcEl.scrollTop >= maxSrcScroll - 2) {
      dstEl.scrollTop = maxDstScroll;
      return;
    }

    const srcItems = Array.from(srcEl.querySelectorAll<HTMLElement>('[data-sec]'));
    const dstItems = Array.from(dstEl.querySelectorAll<HTMLElement>('[data-sec]'));
    if (srcItems.length === 0 || dstItems.length === 0) return;

    let anchorIdx = 0;
    for (let i = 0; i < srcItems.length; i++) {
      const el = srcItems[i];
      if (el.offsetTop - srcEl.offsetTop + el.offsetHeight > srcEl.scrollTop) {
        anchorIdx = i;
        break;
      }
    }
    const anchorEl = srcItems[anchorIdx];
    const anchorSec = Number(anchorEl.dataset.sec || 0);
    let prevDstIdx = 0;
    for (let k = 0; k < dstItems.length; k++) {
      if (Number(dstItems[k].dataset.sec || 0) <= anchorSec) prevDstIdx = k;
      else break;
    }
    const prevDstEl = dstItems[prevDstIdx];
    dstEl.scrollTop = prevDstEl.offsetTop - dstEl.offsetTop;
  };

  const renderScriptColumn = (lines: ParsedScriptLine[], side: 'LEFT' | 'RIGHT') => (
    <div
      ref={side === 'LEFT' ? scrollRefLeft : scrollRefRight}
      onScroll={() => handleSyncScroll(side)}
      style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '42vh', overflowY: 'auto', paddingRight: '4px' }}
    >
      {lines.length === 0 ? (
        <div style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12.5px' }}>
          표시할 대사가 없습니다. 우상단 {side === 'LEFT' ? '🎙️(ASR 재처리)' : '✨(후처리 다시시도)'} 메뉴를 눌러 생성하세요.
        </div>
      ) : (
        lines.map((line, idx) => {
          const nextDiag = lines.find((d, dIdx) => dIdx > idx && d.sec > line.sec);
          const endSec = nextDiag ? nextDiag.sec : line.sec + 6;
          const isPlayingNow = currentAudioSec > 0 && currentAudioSec >= line.sec && currentAudioSec < endSec;
          const isSelected = selectedSide === side && selectedRawIdxs.includes(line.rawLineIdx);
          const isMe = line.speaker === '나' || line.speaker === '정서현';

          return (
            <div
              key={`${side}-${idx}-${line.rawLineIdx}`}
              data-sec={line.sec}
              onClick={(e) => handleLineClick(e, side, line, idx, lines)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (selectedSide !== side || !selectedRawIdxs.includes(line.rawLineIdx)) {
                  setSelectedSide(side);
                  setSelectedRawIdxs([line.rawLineIdx]);
                  setLastAnchorOrderIdx(idx);
                }
                setLineMenu({ x: e.clientX, y: e.clientY, side, line });
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '6px 9px',
                borderRadius: '7px',
                cursor: 'pointer',
                userSelect: 'none',
                backgroundColor: isSelected
                  ? 'rgba(99, 102, 241, 0.28)'
                  : isPlayingNow
                  ? 'rgba(16, 185, 129, 0.22)'
                  : isMe
                  ? 'rgba(59, 130, 246, 0.08)'
                  : 'var(--bg-secondary)',
                border: isSelected
                  ? '1.5px solid #818cf8'
                  : isPlayingNow
                  ? '1.5px solid #10b981'
                  : '1px solid var(--border-color)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', backgroundColor: isPlayingNow ? '#10b981' : isSelected ? '#6366f1' : 'rgba(99, 102, 241, 0.16)', color: isPlayingNow ? '#052e16' : isSelected ? '#ffffff' : '#a5b4fc', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {line.timeTag}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: isMe ? '#38bdf8' : '#f59e0b', whiteSpace: 'nowrap', flexShrink: 0, minWidth: '48px' }}>
                {line.speaker}:
              </span>
              <span style={{ fontSize: '12.5px', color: 'var(--text-primary)', lineHeight: 1.45, wordBreak: 'keep-all' }}>
                {line.text}
              </span>
            </div>
          );
        })
      )}
    </div>
  );

  const selectedCountOnMenuSide =
    lineMenu && selectedSide === lineMenu.side && selectedRawIdxs.includes(lineMenu.line.rawLineIdx)
      ? selectedRawIdxs.length
      : 1;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(2, 6, 23, 0.76)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ width: 'min(1260px, 96vw)', maxHeight: '92vh', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}
        onClick={(e) => {
          e.stopPropagation();
          setLineMenu(null);
          setAsrMenuOpen(false);
          setPostMenuOpen(false);
        }}
      >
        {/* 모달 상단 헤더: 제목 + 결재 결정사항 3종 (1. ASR 재처리 / 2. 후처리 다시시도 / 3. 확인) + 닫기 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '15px', color: 'var(--heading-color)' }}>
              📞 {target.personName}
            </strong>
            {selectedRawIdxs.length > 0 && (
              <span style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '999px', backgroundColor: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc', fontWeight: 600 }}>
                {selectedRawIdxs.length}줄 선택됨 (Space: 재생)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="toolbar-btn"
              style={{ fontSize: '14px', padding: '4px 10px' }}
              onClick={() => setShowPromptPopup(true)}
              title="후처리 프롬프트(postprocess_prompt.md) & 사용자 변경 로그 확인·편집"
            >
              📜
            </button>

            {/* 1. ASR 재처리 */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="toolbar-btn"
                style={{ fontSize: '12.5px', padding: '4px 10px' }}
                disabled={busyAction !== null || loadingDoc}
                onClick={() => {
                  setAsrMenuOpen((v) => !v);
                  setPostMenuOpen(false);
                }}
                title="1. ASR 재처리 (전면 재처리 / 시각만 재처리 / 시각·화자만 재처리)"
              >
                {busyAction === 'asr' ? '⏳ ASR 처리중...' : '🎙️ ASR 재처리 ▾'}
              </button>
              {asrMenuOpen && (
                <div className="context-menu-popup" style={{ position: 'absolute', right: 0, top: '34px', zIndex: 10004, minWidth: '245px' }}>
                  <button type="button" className="menu-item" onClick={() => void handleRetryAsrMode('asr_full')}>
                    <span>🎙️ 전면 재처리 (Whisper+성문 · 15~45초)</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => void handleRetryAsrMode('asr_time_only')}>
                    <span>⏱️ 시각만 재처리 (타임태그 복원 · 0.3초)</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => void handleRetryAsrMode('asr_time_speaker')}>
                    <span>🗣️ 시각/화자만 재처리 (성문 재검증 · 2~4초)</span>
                  </button>
                </div>
              )}
            </div>

            {/* 2. 후처리 다시시도 */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="toolbar-btn"
                style={{ fontSize: '12.5px', padding: '4px 10px' }}
                disabled={busyAction !== null || loadingDoc}
                onClick={() => {
                  setPostMenuOpen((v) => !v);
                  setAsrMenuOpen(false);
                }}
                title="2. 후처리 다시시도 (전면 재처리 / 현재 수정 내용 저장 및 코멘트 추가 후 재처리)"
              >
                {busyAction === 'post' ? '⏳ 후처리중...' : '✨ 후처리 다시시도 ▾'}
              </button>
              {postMenuOpen && (
                <div className="context-menu-popup" style={{ position: 'absolute', right: 0, top: '34px', zIndex: 10004, minWidth: '280px' }}>
                  <button type="button" className="menu-item" onClick={() => void handleRetryPostprocess('ai_postprocess_full')}>
                    <span>✨ 전면 재처리 (기존 후처리 보관·참고)</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => void handleRetryPostprocess('ai_postprocess_discard_prev')}>
                    <span>🗑️ 전면 재처리 (기존 후처리 폐기·ASR만 사용)</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => void handleRetryPostprocess('ai_postprocess_with_comment')}>
                    <span>💬 현재 수정 저장 + 코멘트 반영 재처리</span>
                  </button>
                </div>
              )}
            </div>

            {/* 3. 확인 (수정 후 확인 / 확인) */}
            <button
              type="button"
              className="toolbar-btn primary"
              style={{ fontSize: '12.5px', padding: '4px 11px', backgroundColor: '#10b981', borderColor: '#059669' }}
              disabled={busyAction !== null || loadingDoc}
              onClick={() => void handleConfirmCurrent()}
              title={hasUserEdits ? '3. 수정 후 확인 (변경 로그 기록 후 확정)' : '3. 확인 (현재 내용으로 확정)'}
            >
              {busyAction === 'confirm' ? '⏳' : hasUserEdits ? '✅ 수정 후 확인' : '✅ 확인'}
            </button>
            <button
              type="button"
              className="toolbar-btn"
              style={{ fontSize: '15px', padding: '4px 10px' }}
              onClick={onClose}
              title="닫기"
            >
              ✕
            </button>
          </div>
        </div>

        {showPromptPopup && (
          <CallPostprocessPromptPopupModal
            onClose={() => setShowPromptPopup(false)}
            setStatusMessage={setStatusMessage}
          />
        )}

        {/* 오디오 컨트롤러 */}
        {audioSrc && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
            <audio
              ref={audioRef}
              controls
              src={audioSrc}
              style={{ height: '30px', flex: 1 }}
              onPlay={(e) => {
                e.currentTarget.playbackRate = playbackRate;
              }}
              onTimeUpdate={(e) => {
                setCurrentAudioSec(e.currentTarget.currentTime);
              }}
            />
            {[1.0, 1.25, 1.5, 2.0].map((rate) => (
              <button
                key={rate}
                type="button"
                className={`toolbar-btn ${playbackRate === rate ? 'primary' : ''}`}
                style={{ padding: '2px 7px', fontSize: '11px' }}
                onClick={() => {
                  setPlaybackRate(rate);
                  if (audioRef.current) audioRef.current.playbackRate = rate;
                }}
              >
                {rate}x
              </button>
            ))}
          </div>
        )}

        {/* 본문 2열 비교 영역: 왼쪽 = ASR 스크립트 + 나의 배경지식 / 오른쪽 = 후처리 스크립트 + 대화상대 배경지식 */}
        {loadingDoc ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>⏳ 스크립트 문서를 불러오는 중입니다...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '12px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderRadius: '10px', backgroundColor: 'var(--bg-primary)', border: '1.5px solid rgba(16, 185, 129, 0.45)' }}>
              <strong style={{ fontSize: '13px', color: '#34d399' }}>
                🎙️ 2. ASR 스크립트 ({linesAsr.length}문장)
              </strong>
              {renderScriptColumn(linesAsr, 'LEFT')}
              <CallParticipantBackgroundEditorBox
                title="🧑 내 상태 및 나에 대한 정보 (정서현 · 편집 가능)"
                accentColor="#34d399"
                value={bgProfiles.userProfileText}
                onChange={bgProfiles.setUserProfileText}
                onSave={() => void bgProfiles.saveUserProfileNow(false)}
                saving={bgProfiles.savingUser}
                dirty={bgProfiles.dirtyUser}
                placeholder="내 상태, 근황, 소속, 주요 관심사, 고유명사 등 나에 대한 정보를 편집하세요 (후처리 스크립트에 즉시 반영)..."
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderRadius: '10px', backgroundColor: 'var(--bg-primary)', border: '1.5px solid rgba(56, 189, 248, 0.45)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                <strong style={{ fontSize: '13px', color: '#38bdf8' }}>
                  {rightTab === 'prev_post' ? `📌 보관된 이전 후처리 (${linesPost.length}문장)` : `✨ 3. 후처리 스크립트 (${linesPost.length}문장)`}
                </strong>
                {parsed.scriptPrevPostMarkdown && (
                  <button
                    type="button"
                    className="toolbar-btn"
                    style={{ fontSize: '11px', padding: '2px 7px' }}
                    onClick={() => setRightTab((t) => (t === 'post' ? 'prev_post' : 'post'))}
                  >
                    {rightTab === 'post' ? '📌 이전 후처리 보관본 보기' : '✨ 최신 후처리 보기'}
                  </button>
                )}
              </div>
              {renderScriptColumn(linesPost, 'RIGHT')}
              <CallParticipantBackgroundEditorBox
                title={`👤 ${bgProfiles.resolvedContactName || target.personName}.md (${bgProfiles.contactPhones ? `${bgProfiles.contactPhones} · ` : ''}연락처 상대 정보 편집)`}
                accentColor="#38bdf8"
                value={bgProfiles.contactProfileText}
                onChange={bgProfiles.setContactProfileText}
                onSave={() => void bgProfiles.saveContactProfileNow(false)}
                saving={bgProfiles.savingContact}
                dirty={bgProfiles.dirtyContact}
                placeholder={`${bgProfiles.resolvedContactName || target.personName}.md 문서의 호칭·소속 모임·최근 history 등을 편집하세요...`}
              />
            </div>
          </div>
        )}

        {/* 하단 수정 요청사항(Multi-line) & 후처리 재작성 버튼 바 */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
          <textarea
            rows={3}
            className="input-field"
            style={{ flex: 1, fontSize: '12px', padding: '6px 9px', lineHeight: 1.45, resize: 'vertical' }}
            placeholder="수정 요청사항 / 후처리 다시시도 코멘트 입력 (여러 줄 입력 가능 · 예: 00:01:20 부근 화자 유지하고 고유명사 '계영'으로 수정해줘)..."
            value={userComment}
            onChange={(e) => setUserComment(e.target.value)}
          />
          <button
            type="button"
            className="toolbar-btn"
            style={{ fontSize: '12px', padding: '6px 12px' }}
            disabled={busyAction !== null || loadingDoc}
            onClick={() => void handleRetryPostprocess('ai_postprocess_with_comment')}
          >
            💬 수정저장+코멘트로 후처리 다시시도
          </button>
        </div>

        <CallScriptLineContextMenuAndModals
          lineMenu={lineMenu}
          setLineMenu={setLineMenu}
          selectedCountOnMenuSide={selectedCountOnMenuSide}
          counterpartName={target.personName}
          currentAudioSec={currentAudioSec}
          audioRef={audioRef}
          editingModal={editingModal}
          setEditingModal={setEditingModal}
          splitModal={splitModal}
          setSplitModal={setSplitModal}
          onToggleSpeaker={(side, line) => {
            const targets = getTargetLinesForAction(side, line);
            const srcSection = side === 'LEFT' ? parsed.scriptAsrMarkdown : parsed.scriptPostMarkdown;
            const res = mutateBatchSpeakerOrDeleteInSectionMarkdown(srcSection, targets, {
              type: 'toggle_speaker',
              counterpartName: target.personName,
            });
            void commitSectionUpdate(side, res.updatedSection, res.editEntries, selectedRawIdxs);
          }}
          onDeleteSelected={(side, line) => {
            const targets = getTargetLinesForAction(side, line);
            const srcSection = side === 'LEFT' ? parsed.scriptAsrMarkdown : parsed.scriptPostMarkdown;
            const res = mutateBatchSpeakerOrDeleteInSectionMarkdown(srcSection, targets, {
              type: 'delete_line',
            });
            void commitSectionUpdate(side, res.updatedSection, res.editEntries, []);
          }}
          onMergeSelected={(side) => {
            const list = side === 'LEFT' ? linesAsr : linesPost;
            const targets = list.filter((l) => selectedRawIdxs.includes(l.rawLineIdx));
            if (targets.length < 2) return;
            const srcSection = side === 'LEFT' ? parsed.scriptAsrMarkdown : parsed.scriptPostMarkdown;
            const res = mutateMergeLinesInSectionMarkdown(srcSection, targets);
            void commitSectionUpdate(
              side,
              res.updatedSection,
              res.editEntry ? [res.editEntry] : [],
              [res.mergedRawIdx]
            );
          }}
          onOpenSplitModal={(side, line) => {
            setSplitModal({
              side,
              line,
              value: line.text,
              toggleSecondSpeaker: false,
            });
            setLineMenu(null);
          }}
          onConfirmSplit={(splitIndex) => {
            if (!splitModal) return;
            const { side, line, value, toggleSecondSpeaker } = splitModal;
            const list = side === 'LEFT' ? linesAsr : linesPost;
            const linePos = list.findIndex((l) => l.rawLineIdx === line.rawLineIdx);
            const nextLine = linePos >= 0 && linePos + 1 < list.length ? list[linePos + 1] : undefined;
            const srcSection = side === 'LEFT' ? parsed.scriptAsrMarkdown : parsed.scriptPostMarkdown;
            const res = mutateSplitLineInSectionMarkdown(
              srcSection,
              { ...line, text: value },
              splitIndex,
              toggleSecondSpeaker,
              target.personName,
              nextLine?.sec
            );
            if (!res.editEntry) {
              setStatusMessage('⚠️ 분리할 위치(커서)를 문장 중간에 놓고 Enter를 눌러주세요.');
              return;
            }
            void commitSectionUpdate(side, res.updatedSection, [res.editEntry], []);
          }}
          onConfirmTextOrTime={() => {
            if (!editingModal) return;
            if (editingModal.mode === 'text') {
              void applyLineMutation(editingModal.side, editingModal.line, {
                type: 'edit_text',
                nextText: editingModal.value,
              });
            } else {
              const nextTag = parseTimeInputToTag(editingModal.value);
              if (nextTag) {
                void applyLineMutation(editingModal.side, editingModal.line, {
                  type: 'change_time',
                  nextTimeTag: nextTag,
                });
              }
            }
          }}
        />
      </div>
    </div>
  );
}
