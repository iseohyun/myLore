/**
 * @file CallScriptAbComparisonPanel.tsx
 * @description 통화녹음 스크립트 비교 뷰어 (좌측: ASR 스크립트 고정 / 우측: 후처리 스크립트),
 * 대사 좌클릭 즉시 재생, 대사 우클릭 메뉴(화자변환·스크립트 수정·삭제·시점 변환), 우상단 아이콘 액션바 컴포넌트.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CallApprovalItem,
  ContactPromptTournamentStatus,
  UserScriptEditEntry,
} from '../../types/mylore';
import {
  analyzeSingleCallAsrAndAb,
  confirmCallScriptWithUserEdits,
} from '../../services/tauriClient';
import {
  CallParticipantBackgroundEditorBox,
  CallPostprocessPromptPopupModal,
  CallScriptLineContextMenuAndModals,
  mutateBatchSpeakerOrDeleteInSectionMarkdown,
  mutateMergeLinesInSectionMarkdown,
  mutateSplitLineInSectionMarkdown,
  PromptAbDiffViewer,
  PromptAbDiffViewerProps,
  SplitModalState,
  TextOrTimeEditModalState,
  useParticipantBackgroundProfiles,
} from './callScriptCompareUtils';

export { CallPostprocessPromptPopupModal, PromptAbDiffViewer };
export type { PromptAbDiffViewerProps };

export interface ParsedScriptLine {
  rawLine: string;
  rawLineIdx: number;
  isDialogue: boolean;
  timeTag: string;
  sec: number;
  speaker: string;
  text: string;
}

export function formatSecToTimeTag(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function parseTimeInputToTag(input: string): string | null {
  const clean = input.trim().replace(/^\[|\]$/g, '');
  const parts = clean.split(':').map((p) => parseInt(p.trim(), 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  if (parts.length === 3) return formatSecToTimeTag(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return formatSecToTimeTag(parts[0] * 60 + parts[1]);
  if (parts.length === 1) return formatSecToTimeTag(parts[0]);
  return null;
}

export function hasDualAbScript(item: CallApprovalItem): boolean {
  const md = item.scriptMarkdown || '';
  return (
    md.includes('### 음성인식엔진') ||
    md.includes('### ✨ AI 후처리') ||
    (md.includes('### 🅰️ 프롬프트 A 스크립트') && md.includes('### 🅱️ 프롬프트 B 스크립트'))
  );
}

export function parseDialogueLines(markdownSection: string): ParsedScriptLine[] {
  const lines = markdownSection.split(/\r?\n/);
  const reFull = /^[-*]\s*\*\*\[(\d{1,2}):(\d{2}):(\d{2})\](?:\s*([^*:]+))?\*\*:?\s*(.*)$/;
  const reMs = /^[-*]\s*\*\*\[(\d{1,2}):(\d{2})\](?:\s*([^*:]+))?\*\*:?\s*(.*)$/;
  return lines.map((raw, rawLineIdx) => {
    const trimmed = raw.trim();
    const mFull = trimmed.match(reFull);
    if (mFull) {
      const [h, m, s] = [parseInt(mFull[1], 10) || 0, parseInt(mFull[2], 10) || 0, parseInt(mFull[3], 10) || 0];
      return {
        rawLine: raw, rawLineIdx, isDialogue: true,
        timeTag: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
        sec: h * 3600 + m * 60 + s, speaker: (mFull[4] || '').trim(), text: (mFull[5] || '').trim(),
      };
    }
    const mMs = trimmed.match(reMs);
    if (mMs) {
      const [m, s] = [parseInt(mMs[1], 10) || 0, parseInt(mMs[2], 10) || 0];
      return {
        rawLine: raw, rawLineIdx, isDialogue: true,
        timeTag: `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
        sec: m * 60 + s, speaker: (mMs[3] || '').trim(), text: (mMs[4] || '').trim(),
      };
    }
    return { rawLine: raw, rawLineIdx, isDialogue: false, timeTag: '', sec: -1, speaker: '', text: trimmed };
  });
}

export function mutateLineInSectionMarkdown(
  sectionMd: string,
  line: ParsedScriptLine,
  mutation:
    | { type: 'toggle_speaker'; counterpartName: string }
    | { type: 'edit_text'; nextText: string }
    | { type: 'delete_line' }
    | { type: 'change_time'; nextTimeTag: string }
): string {
  const rawLines = sectionMd.split(/\r?\n/);
  if (line.rawLineIdx < 0 || line.rawLineIdx >= rawLines.length) return sectionMd;
  if (mutation.type === 'delete_line') {
    rawLines.splice(line.rawLineIdx, 1);
    return rawLines.join('\n').trim();
  }
  const isMe = line.speaker === '나' || line.speaker === '정서현';
  const nextSpeaker = mutation.type === 'toggle_speaker' ? (isMe ? mutation.counterpartName || '상대방' : '나') : line.speaker;
  const nextTime = mutation.type === 'change_time' ? mutation.nextTimeTag : line.timeTag;
  const nextText = mutation.type === 'edit_text' ? mutation.nextText.trim() : line.text;
  rawLines[line.rawLineIdx] = `- **[${nextTime}] ${nextSpeaker}**: ${nextText}`;
  return rawLines.join('\n');
}

export function buildUserScriptEditEntry(
  line: ParsedScriptLine,
  mutation:
    | { type: 'toggle_speaker'; counterpartName: string }
    | { type: 'edit_text'; nextText: string }
    | { type: 'delete_line' }
    | { type: 'change_time'; nextTimeTag: string }
): UserScriptEditEntry {
  const beforeStr = `[${line.timeTag}] ${line.speaker}: ${line.text}`;
  if (mutation.type === 'delete_line') {
    return { editType: '대사 삭제 (Line Deleted)', timeTag: line.timeTag, beforeText: beforeStr, afterText: '(삭제됨)' };
  }
  const isMe = line.speaker === '나' || line.speaker === '정서현';
  const nextSpeaker = mutation.type === 'toggle_speaker' ? (isMe ? mutation.counterpartName || '상대방' : '나') : line.speaker;
  const nextTime = mutation.type === 'change_time' ? mutation.nextTimeTag : line.timeTag;
  const nextText = mutation.type === 'edit_text' ? mutation.nextText.trim() : line.text;
  const afterStr = `[${nextTime}] ${nextSpeaker}: ${nextText}`;
  const editType =
    mutation.type === 'toggle_speaker'
      ? '화자 변환 (Speaker Change)'
      : mutation.type === 'edit_text'
        ? '스크립트 수정 (Text Correction)'
        : '시점 변환 (Timestamp Shift)';
  return { editType, timeTag: nextTime, beforeText: beforeStr, afterText: afterStr };
}

export interface ExtractedCallScripts {
  hasDualAb: boolean;
  hasThreeScripts: boolean;
  hasAsr: boolean;
  hasPost: boolean;
  hasPrevPost: boolean;
  hasLegacyRef: boolean;
  hasA: boolean;
  hasB: boolean;
  headerAndSummaryPart: string;
  scriptAsrMarkdown: string;
  scriptPostMarkdown: string;
  scriptPrevPostMarkdown: string;
  scriptLegacyRefMarkdown: string;
  scriptAMarkdown: string;
  scriptBMarkdown: string;
  singleScriptPart: string;
}

function cleanTrailingRule(s: string): string {
  return s.trim().replace(/\n---\s*$/, '').trim();
}

export function extractDualScriptsFromMarkdown(fullBody: string): ExtractedCallScripts {
  const scriptHeaderIdx = fullBody.indexOf('## 📜 스크립트');
  const headerAndSummaryPart =
    scriptHeaderIdx >= 0
      ? fullBody.slice(0, scriptHeaderIdx + '## 📜 스크립트'.length).trim()
      : '## 📜 스크립트';
  const scriptSection =
    scriptHeaderIdx >= 0
      ? fullBody.slice(scriptHeaderIdx + '## 📜 스크립트'.length).trim()
      : fullBody.trim();

  const markers: Array<{ key: 'ASR' | 'POST' | 'PREV_POST' | 'LEGACY' | 'A' | 'B'; header: string; idx: number }> = [
    { key: 'ASR' as const, header: '### 음성인식엔진', idx: scriptSection.indexOf('### 음성인식엔진') },
    { key: 'POST' as const, header: '### ✨ AI 후처리 스크립트', idx: scriptSection.indexOf('### ✨ AI 후처리 스크립트') },
    { key: 'PREV_POST' as const, header: '### 📌 이전 AI 후처리 스크립트 (보관/참고용)', idx: scriptSection.indexOf('### 📌 이전 AI 후처리 스크립트 (보관/참고용)') },
    { key: 'LEGACY' as const, header: '### 📎 기존 AI 스크립트 (참고용)', idx: scriptSection.indexOf('### 📎 기존 AI 스크립트 (참고용)') },
    { key: 'A' as const, header: '### 🅰️ 프롬프트 A 스크립트', idx: scriptSection.indexOf('### 🅰️ 프롬프트 A 스크립트') },
    { key: 'B' as const, header: '### 🅱️ 프롬프트 B 스크립트', idx: scriptSection.indexOf('### 🅱️ 프롬프트 B 스크립트') },
  ]
    .filter((m) => m.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  let rawAsr = '';
  let rawPost = '';
  let rawPrevPost = '';
  let rawLegacy = '';
  let rawA = '';
  let rawB = '';

  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const startPos = cur.idx + cur.header.length;
    const endPos = i + 1 < markers.length ? markers[i + 1].idx : scriptSection.length;
    const slice = cleanTrailingRule(scriptSection.slice(startPos, endPos));
    if (cur.key === 'ASR') rawAsr = slice;
    if (cur.key === 'POST') rawPost = slice;
    if (cur.key === 'PREV_POST') rawPrevPost = slice;
    if (cur.key === 'LEGACY') rawLegacy = slice;
    if (cur.key === 'A') rawA = slice;
    if (cur.key === 'B') rawB = slice;
  }

  if (markers.length === 0 && scriptSection.includes('**[')) {
    rawPost = cleanTrailingRule(scriptSection);
  } else if (markers.length === 1 && markers[0].key === 'ASR') {
    const beforeAsr = cleanTrailingRule(scriptSection.slice(0, markers[0].idx));
    if (beforeAsr.includes('**[')) {
      rawPost = beforeAsr;
    }
  }

  const effectivePost = rawPost || rawPrevPost || rawLegacy || rawA || rawB;
  const hasAsr = Boolean(rawAsr);
  const hasPost = Boolean(effectivePost);
  const hasPrevPost = Boolean(rawPrevPost);
  const hasLegacyRef = Boolean(rawLegacy);
  const hasA = Boolean(rawA);
  const hasB = Boolean(rawB);
  const count = (hasAsr ? 1 : 0) + (rawPost ? 1 : 0) + (hasA ? 1 : 0) + (hasB ? 1 : 0);

  return {
    hasDualAb: count >= 2 || (hasAsr && hasPost),
    hasThreeScripts: hasAsr && hasA && hasB,
    hasAsr,
    hasPost,
    hasPrevPost,
    hasLegacyRef,
    hasA,
    hasB,
    headerAndSummaryPart,
    scriptAsrMarkdown: rawAsr,
    scriptPostMarkdown: effectivePost,
    scriptPrevPostMarkdown: rawPrevPost,
    scriptLegacyRefMarkdown: rawLegacy,
    scriptAMarkdown: rawA || effectivePost,
    scriptBMarkdown: rawB || effectivePost,
    singleScriptPart: scriptSection,
  };
}

export function rebuildFullMarkdownFromParsed(
  parsed: ExtractedCallScripts,
  patch: {
    asrMd?: string;
    postMd?: string;
    aMd?: string;
    bMd?: string;
  }
): string {
  const nextAsr = (patch.asrMd ?? parsed.scriptAsrMarkdown).trim();
  const nextPost = (patch.postMd ?? parsed.scriptPostMarkdown).trim();
  const nextPrevPost = parsed.scriptPrevPostMarkdown.trim();
  const nextLegacy = parsed.scriptLegacyRefMarkdown.trim();
  const nextA = (patch.aMd ?? parsed.scriptAMarkdown).trim();
  const nextB = (patch.bMd ?? parsed.scriptBMarkdown).trim();

  const sections: string[] = [];
  if (nextAsr) sections.push(`### 음성인식엔진\n\n${nextAsr}`);
  if (nextPost && (parsed.hasPost || (!parsed.hasA && !parsed.hasB) || patch.postMd !== undefined)) {
    sections.push(`### ✨ AI 후처리 스크립트\n\n${nextPost}`);
  }
  if (nextPrevPost && nextPrevPost !== nextPost) {
    sections.push(`### 📌 이전 AI 후처리 스크립트 (보관/참고용)\n\n${nextPrevPost}`);
  }
  if (nextLegacy && nextLegacy !== nextPost) {
    sections.push(`### 📎 기존 AI 스크립트 (참고용)\n\n${nextLegacy}`);
  }
  if (parsed.hasA && nextA && nextA !== nextPost) {
    sections.push(`### 🅰️ 프롬프트 A 스크립트\n\n${nextA}`);
  }
  if (parsed.hasB && nextB && nextB !== nextPost) {
    sections.push(`### 🅱️ 프롬프트 B 스크립트\n\n${nextB}`);
  }
  if (sections.length === 0 && nextPost) {
    sections.push(`### ✨ AI 후처리 스크립트\n\n${nextPost}`);
  }
  return `${parsed.headerAndSummaryPart}\n\n${sections.join('\n\n---\n\n')}\n`;
}

export interface LineContextMenuState {
  x: number;
  y: number;
  side: 'LEFT' | 'RIGHT';
  line: ParsedScriptLine;
}

export interface CallScriptAbComparisonInspectorProps {
  selectedItem: CallApprovalItem;
  providerBadge: { label: string; color: string; bg: string };
  audioSrc: string | null;
  audioLoading: boolean;
  playbackRate: number;
  setPlaybackRate: React.Dispatch<React.SetStateAction<number>>;
  editedBody: string;
  setEditedBody: React.Dispatch<React.SetStateAction<string>>;
  isScriptModified: boolean;
  isSavingScript: boolean;
  isProcessingDecision: boolean;
  rejectRequirement: string;
  setRejectRequirement: React.Dispatch<React.SetStateAction<string>>;
  handleApproveItem: () => Promise<void>;
  handleSaveEditedScript: () => Promise<void>;
  handleRejectAndReassign: () => Promise<void>;
  onCallFeedbackDecision?: (
    action: 'reanalyze_with_feedback' | 'approve_and_evolve_prompt',
    chosenSlot: 'ASR' | 'A' | 'B' | 'BOTH',
    feedback: string
  ) => Promise<void>;
  onPostprocessRetryLifecycle?: (
    phase: 'start' | 'done' | 'error',
    stem: string,
    contactName: string
  ) => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  tournamentStatus?: ContactPromptTournamentStatus | null;
  setTournamentStatus?: React.Dispatch<React.SetStateAction<ContactPromptTournamentStatus | null>>;
}

export function CallScriptAbComparisonInspector({
  selectedItem,
  audioSrc,
  audioLoading,
  playbackRate,
  setPlaybackRate,
  editedBody,
  setEditedBody,
  isProcessingDecision,
  rejectRequirement,
  setRejectRequirement,
  handleApproveItem,
  handleSaveEditedScript,
  handleRejectAndReassign,
  onPostprocessRetryLifecycle,
  setStatusMessage,
}: CallScriptAbComparisonInspectorProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRefLeft = useRef<HTMLDivElement | null>(null);
  const scrollRefRight = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<'LEFT' | 'RIGHT' | null>(null);
  const scrollUnlockTimerRef = useRef<number | null>(null);

  const [currentAudioSec, setCurrentAudioSec] = useState<number>(0);
  const [busyMode, setBusyMode] = useState<'asr' | 'post' | null>(null);
  const [showPromptPopup, setShowPromptPopup] = useState(false);
  const [sessionEdits, setSessionEdits] = useState<UserScriptEditEntry[]>([]);
  const [lineMenu, setLineMenu] = useState<LineContextMenuState | null>(null);
  const [asrMenuOpen, setAsrMenuOpen] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [rightTab, setRightTab] = useState<'post' | 'prev_post'>('post');
  const [selectedSide, setSelectedSide] = useState<'LEFT' | 'RIGHT'>('RIGHT');
  const [selectedRawIdxs, setSelectedRawIdxs] = useState<number[]>([]);
  const [lastAnchorOrderIdx, setLastAnchorOrderIdx] = useState<number | null>(null);
  const [editingModal, setEditingModal] = useState<TextOrTimeEditModalState | null>(null);
  const [splitModal, setSplitModal] = useState<SplitModalState | null>(null);

  const bgProfiles = useParticipantBackgroundProfiles(
    selectedItem.contactName,
    setStatusMessage
  );

  const initialDual = useMemo(
    () => extractDualScriptsFromMarkdown(selectedItem.scriptMarkdown || ''),
    [selectedItem.scriptMarkdown]
  );
  const parsedDual = useMemo(
    () => extractDualScriptsFromMarkdown(editedBody || selectedItem.scriptMarkdown || ''),
    [editedBody, selectedItem.scriptMarkdown]
  );
  const hasUserEdits =
    sessionEdits.length > 0 ||
    parsedDual.scriptPostMarkdown.trim() !== initialDual.scriptPostMarkdown.trim();

  const linesAsr = useMemo(
    () => parseDialogueLines(parsedDual.scriptAsrMarkdown).filter((l) => l.isDialogue),
    [parsedDual.scriptAsrMarkdown]
  );
  const linesPost = useMemo(
    () =>
      parseDialogueLines(
        rightTab === 'prev_post' && parsedDual.scriptPrevPostMarkdown
          ? parsedDual.scriptPrevPostMarkdown
          : parsedDual.scriptPostMarkdown
      ).filter((l) => l.isDialogue),
    [parsedDual.scriptPostMarkdown, parsedDual.scriptPrevPostMarkdown, rightTab]
  );

  useEffect(() => {
    setCurrentAudioSec(0);
    setLineMenu(null);
    setEditingModal(null);
    setSplitModal(null);
    setSessionEdits([]);
    setSelectedRawIdxs([]);
    setLastAnchorOrderIdx(null);
    setAsrMenuOpen(false);
    setPostMenuOpen(false);
    setRightTab('post');
  }, [selectedItem.safeStem]);

  const handleSeekAndPlay = (sec: number, timeTag: string, speaker: string) => {
    if (sec < 0) return;
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = sec;
    el.playbackRate = playbackRate;
    setCurrentAudioSec(sec);
    void el.play().catch(() => {});
    setStatusMessage(`▶️ [${timeTag}] ${speaker} 재생`);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const activeList = selectedSide === 'LEFT' ? linesAsr : linesPost;
      const selLines = activeList
        .filter((l) => selectedRawIdxs.includes(l.rawLineIdx))
        .sort((a, b) => a.rawLineIdx - b.rawLineIdx);
      if (selLines.length > 0) {
        const first = selLines[0];
        handleSeekAndPlay(first.sec, first.timeTag, first.speaker);
      } else if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.playbackRate = playbackRate;
          void audioRef.current.play().catch(() => {});
        } else {
          audioRef.current.pause();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedSide, selectedRawIdxs, linesAsr, linesPost, playbackRate]);

  const handleLineClick = (
    e: React.MouseEvent,
    side: 'LEFT' | 'RIGHT',
    line: ParsedScriptLine,
    orderIdx: number,
    lines: ParsedScriptLine[]
  ) => {
    e.stopPropagation();
    setLineMenu(null);
    if (e.shiftKey && selectedSide === side && lastAnchorOrderIdx !== null) {
      const start = Math.min(lastAnchorOrderIdx, orderIdx);
      const end = Math.max(lastAnchorOrderIdx, orderIdx);
      const rangeIdxs = lines.slice(start, end + 1).map((l) => l.rawLineIdx);
      setSelectedRawIdxs((prev) => Array.from(new Set([...prev, ...rangeIdxs])));
    } else if (e.ctrlKey || e.metaKey) {
      if (selectedSide !== side) {
        setSelectedSide(side);
        setSelectedRawIdxs([line.rawLineIdx]);
      } else {
        setSelectedRawIdxs((prev) =>
          prev.includes(line.rawLineIdx)
            ? prev.filter((id) => id !== line.rawLineIdx)
            : [...prev, line.rawLineIdx]
        );
      }
      setLastAnchorOrderIdx(orderIdx);
    } else {
      setSelectedSide(side);
      setSelectedRawIdxs([line.rawLineIdx]);
      setLastAnchorOrderIdx(orderIdx);
    }
  };

  const handleRunMode = async (
    mode: 'asr_full' | 'asr_time_only' | 'asr_time_speaker' | 'ai_postprocess_full' | 'ai_postprocess_discard_prev' | 'ai_postprocess_with_comment'
  ) => {
    if (busyMode) return;
    setAsrMenuOpen(false);
    setPostMenuOpen(false);
    await bgProfiles.flushBothIfDirty();
    const isAsr = mode.startsWith('asr_');
    const targetStem = selectedItem.safeStem;
    const targetFile = selectedItem.fileName;
    const targetContact = selectedItem.contactName;
    const editsSnap = isAsr || mode === 'ai_postprocess_discard_prev' ? [] : [...sessionEdits];
    const postMdSnap = mode === 'ai_postprocess_with_comment' ? parsedDual.scriptPostMarkdown : undefined;
    const commentSnap = rejectRequirement.trim() || undefined;

    if (!isAsr && onPostprocessRetryLifecycle) {
      await onPostprocessRetryLifecycle('start', targetStem, targetContact);
      setStatusMessage(
        mode === 'ai_postprocess_discard_prev'
          ? `🗑️ '${targetContact}' 기존 후처리 폐기 후 전면 재작성 중 (결재 목록에서 일시 제외 · 완료 시 복귀)...`
          : `✨ '${targetContact}' 후처리 재작성 중 (결재 목록에서 일시 제외 · 완료 시 복귀)...`
      );
      void analyzeSingleCallAsrAndAb({
        roomOrSender: targetStem,
        attachmentUuid: targetFile,
        mode,
        editEntries: editsSnap,
        editedPostScript: postMdSnap,
        userComment: commentSnap,
      })
        .then(() => onPostprocessRetryLifecycle('done', targetStem, targetContact))
        .catch((e) => {
          void onPostprocessRetryLifecycle('error', targetStem, targetContact);
          setStatusMessage(`❌ '${targetContact}' 후처리 실패: ${String(e)}`);
        });
      return;
    }

    setBusyMode(isAsr ? 'asr' : 'post');
    setStatusMessage(
      mode === 'asr_full' ? `🎙️ '${targetContact}' ASR 전면 재처리 중...`
      : mode === 'asr_time_only' ? `⏱️ '${targetContact}' ASR 시각만 재처리 중...`
      : mode === 'asr_time_speaker' ? `🗣️ '${targetContact}' ASR 시각/화자 재처리 중...`
      : `✨ '${targetContact}' AI 후처리 재처리 중...`
    );
    try {
      const updatedDoc = await analyzeSingleCallAsrAndAb({
        roomOrSender: targetStem,
        attachmentUuid: targetFile,
        mode,
        editEntries: editsSnap,
        editedPostScript: postMdSnap,
        userComment: commentSnap,
      });
      if (updatedDoc?.bodyContent) {
        setEditedBody(updatedDoc.bodyContent);
        if (!isAsr) {
          setSessionEdits([]);
          setRightTab('post');
        }
      }
      setStatusMessage(isAsr ? `✅ ASR(${mode}) 갱신 완료` : `✅ AI 후처리(${mode}) 갱신 완료`);
    } catch (e) {
      setStatusMessage(`❌ 작업 실패: ${String(e)}`);
    } finally {
      setBusyMode(null);
    }
  };

  const commitSectionUpdate = (
    side: 'LEFT' | 'RIGHT',
    updatedSection: string,
    newEntries: UserScriptEditEntry[],
    nextSelectedRawIdxs: number[] = []
  ) => {
    const nextFull = rebuildFullMarkdownFromParsed(
      parsedDual,
      side === 'LEFT' ? { asrMd: updatedSection } : { postMd: updatedSection }
    );
    if (newEntries.length > 0) {
      setSessionEdits((prev) => [...prev, ...newEntries]);
    }
    setEditedBody(nextFull);
    setSelectedRawIdxs(nextSelectedRawIdxs);
    setLineMenu(null);
    setEditingModal(null);
    setSplitModal(null);
  };

  const getTargetLinesForAction = (side: 'LEFT' | 'RIGHT', fallbackLine: ParsedScriptLine) => {
    const list = side === 'LEFT' ? linesAsr : linesPost;
    if (selectedSide === side && selectedRawIdxs.includes(fallbackLine.rawLineIdx) && selectedRawIdxs.length > 1) {
      return list.filter((l) => selectedRawIdxs.includes(l.rawLineIdx));
    }
    return [fallbackLine];
  };

  const handleConfirmWithOptionalEditLog = async () => {
    await bgProfiles.flushBothIfDirty();
    if (sessionEdits.length > 0 || parsedDual.scriptPostMarkdown.trim() !== initialDual.scriptPostMarkdown.trim()) {
      try {
        await confirmCallScriptWithUserEdits({
          roomOrSender: selectedItem.safeStem,
          attachmentUuid: selectedItem.fileName,
          originalPostScript: initialDual.scriptPostMarkdown,
          finalPostScript: parsedDual.scriptPostMarkdown,
          editEntries: sessionEdits,
        });
      } catch {
        // fallback to standard approval below
      }
    }
    await handleApproveItem();
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

  const renderInteractiveLines = (lines: ParsedScriptLine[], side: 'LEFT' | 'RIGHT') => (
    <div
      ref={side === 'LEFT' ? scrollRefLeft : scrollRefRight}
      onScroll={() => handleSyncScroll(side)}
      style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}
    >
      {lines.map((line, idx) => {
        const nextDiag = lines.find((d, dIdx) => dIdx > idx && d.sec > line.sec);
        const endSec = nextDiag ? nextDiag.sec : line.sec + 6;
        const isPlayingNow = currentAudioSec > 0 && currentAudioSec >= line.sec && currentAudioSec < endSec;
        const isSelected = selectedSide === side && selectedRawIdxs.includes(line.rawLineIdx);
        const isMe = line.speaker === '나' || line.speaker === '정서현';

        return (
          <div
            key={`${side}-line-${idx}-${line.rawLineIdx}`}
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
      })}
    </div>
  );

  const selectedCountOnMenuSide =
    lineMenu && selectedSide === lineMenu.side && selectedRawIdxs.includes(lineMenu.line.rawLineIdx)
      ? selectedRawIdxs.length
      : 1;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
      onClick={() => {
        setLineMenu(null);
        setAsrMenuOpen(false);
        setPostMenuOpen(false);
      }}
    >
      {/* 상단 통화 헤더 & 결재 결정사항 3종 (1. ASR 재처리 · 2. 후처리 다시시도 · 3. 확인) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '14.5px' }}>
            {selectedItem.isVoiceMemo ? '🎙️' : '📞'} {selectedItem.contactName}
          </strong>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {selectedItem.recDate} {selectedItem.recTime}
          </span>
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
            style={{ padding: '4px 9px', fontSize: '13px' }}
            onClick={() => setShowPromptPopup(true)}
            title="후처리 프롬프트(postprocess_prompt.md) & 사용자 변경 로그 확인·편집"
          >
            📜
          </button>

          {/* 1. ASR 재처리 (전면 / 시각만 / 시각·화자만) */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="toolbar-btn"
              style={{ padding: '4px 9px', fontSize: '12px' }}
              disabled={busyMode !== null}
              onClick={() => {
                setAsrMenuOpen((v) => !v);
                setPostMenuOpen(false);
              }}
              title="1. ASR 재처리 (전면 재처리 / 시각만 재처리 / 시각·화자만 재처리)"
            >
              {busyMode === 'asr' ? '⏳ ASR 처리중...' : '🎙️ ASR 재처리 ▾'}
            </button>
            {asrMenuOpen && (
              <div className="context-menu-popup" style={{ position: 'absolute', right: 0, top: '32px', zIndex: 10003, minWidth: '240px' }}>
                <button type="button" className="menu-item" onClick={() => void handleRunMode('asr_full')}>
                  <span>🎙️ 전면 재처리 (Whisper+성문 · 15~45초)</span>
                </button>
                <button type="button" className="menu-item" onClick={() => void handleRunMode('asr_time_only')}>
                  <span>⏱️ 시각만 재처리 (타임태그 복원 · 0.3초)</span>
                </button>
                <button type="button" className="menu-item" onClick={() => void handleRunMode('asr_time_speaker')}>
                  <span>🗣️ 시각/화자만 재처리 (성문 재검증 · 2~4초)</span>
                </button>
              </div>
            )}
          </div>

          {/* 2. 후처리 다시시도 (전면 재처리 / 수정 저장 및 코멘트 추가 후 재처리) */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="toolbar-btn"
              style={{ padding: '4px 9px', fontSize: '12px' }}
              disabled={busyMode !== null}
              onClick={() => {
                setPostMenuOpen((v) => !v);
                setAsrMenuOpen(false);
              }}
              title="2. 후처리 다시시도 (전면 재처리 / 수정 저장 및 코멘트 추가 후 재처리)"
            >
              {busyMode === 'post' ? '⏳ 후처리중...' : '✨ 후처리 다시시도 ▾'}
            </button>
            {postMenuOpen && (
              <div className="context-menu-popup" style={{ position: 'absolute', right: 0, top: '32px', zIndex: 10003, minWidth: '280px' }}>
                <button type="button" className="menu-item" onClick={() => void handleRunMode('ai_postprocess_full')}>
                  <span>✨ 전면 재처리 (기존 후처리 보관·참고)</span>
                </button>
                <button type="button" className="menu-item" onClick={() => void handleRunMode('ai_postprocess_discard_prev')}>
                  <span>🗑️ 전면 재처리 (기존 후처리 폐기·ASR만 사용)</span>
                </button>
                <button type="button" className="menu-item" onClick={() => void handleRunMode('ai_postprocess_with_comment')}>
                  <span>💬 현재 수정 저장 + 코멘트 반영 재처리</span>
                </button>
              </div>
            )}
          </div>

          {/* 3. 확인 (수정 후 확인 / 확인) */}
          <button
            type="button"
            className="toolbar-btn primary"
            style={{ backgroundColor: '#10b981', borderColor: '#059669', padding: '4px 10px', fontSize: '12px' }}
            disabled={isProcessingDecision}
            onClick={() => void handleConfirmWithOptionalEditLog()}
            title={hasUserEdits ? '3. 수정 후 확인 (변경 로그 기록 후 확정)' : '3. 확인 (현재 후처리 내용으로 확정)'}
          >
            {hasUserEdits ? '✅ 수정 후 확인' : '✅ 확인'}
          </button>
        </div>
      </div>

      {showPromptPopup && (
        <CallPostprocessPromptPopupModal onClose={() => setShowPromptPopup(false)} setStatusMessage={setStatusMessage} />
      )}

      {/* 오디오 플레이어 */}
      {audioSrc && !audioLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
          <audio
            ref={audioRef}
            controls
            src={audioSrc}
            style={{ height: '30px', flex: 1 }}
            onPlay={(e) => { e.currentTarget.playbackRate = playbackRate; }}
            onTimeUpdate={(e) => { setCurrentAudioSec(e.currentTarget.currentTime); }}
          />
          {[1.0, 1.25, 1.5, 2.0].map((rate) => (
            <button
              key={rate}
              type="button"
              className={`toolbar-btn ${playbackRate === rate ? 'primary' : ''}`}
              style={{ padding: '2px 6px', fontSize: '10.5px' }}
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

      {/* 좌측: ASR 스크립트 + 나의 배경지식 / 우측: 후처리 스크립트 + 대화상대 배경지식 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid rgba(16, 185, 129, 0.4)' }}>
          <strong style={{ fontSize: '12.5px', color: '#34d399' }}>🎙️ 2. ASR 스크립트 ({linesAsr.length}문장)</strong>
          {renderInteractiveLines(linesAsr, 'LEFT')}
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderRadius: '8px', backgroundColor: 'var(--bg-primary)', border: '1px solid rgba(56, 189, 248, 0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <strong style={{ fontSize: '12.5px', color: '#38bdf8' }}>
              {rightTab === 'prev_post' ? '📌 보관된 이전 후처리 스크립트' : `✨ 3. 후처리 스크립트 (${linesPost.length}문장)`}
            </strong>
            {parsedDual.scriptPrevPostMarkdown && (
              <button
                type="button"
                className="toolbar-btn"
                style={{ fontSize: '10.5px', padding: '2px 7px' }}
                onClick={() => setRightTab((t) => (t === 'post' ? 'prev_post' : 'post'))}
              >
                {rightTab === 'post' ? '📌 이전 후처리 보관본 보기' : '✨ 최신 후처리 보기'}
              </button>
            )}
          </div>
          {renderInteractiveLines(linesPost, 'RIGHT')}
          <CallParticipantBackgroundEditorBox
            title={`👤 ${bgProfiles.resolvedContactName || selectedItem.contactName}.md (${bgProfiles.contactPhones ? `${bgProfiles.contactPhones} · ` : ''}연락처 상대 정보 편집)`}
            accentColor="#38bdf8"
            value={bgProfiles.contactProfileText}
            onChange={bgProfiles.setContactProfileText}
            onSave={() => void bgProfiles.saveContactProfileNow(false)}
            saving={bgProfiles.savingContact}
            dirty={bgProfiles.dirtyContact}
            placeholder={`${bgProfiles.resolvedContactName || selectedItem.contactName}.md 문서의 호칭·소속 모임·최근 history 등을 편집하세요...`}
          />
        </div>
      </div>

      {/* 하단 수정 요청사항(Multi-line) & 저장/반려 보조 바 */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'stretch' }}>
        <textarea
          rows={3}
          className="input-field"
          style={{ flex: 1, minWidth: '240px', fontSize: '12px', padding: '6px 9px', lineHeight: 1.45, resize: 'vertical' }}
          placeholder="수정 요청사항 / 후처리 재작성 코멘트 또는 반려 사유 입력 (여러 줄 입력 가능 · 예: 화자 교정 유지하고 고유명사 '계영'으로 수정해줘)..."
          value={rejectRequirement}
          onChange={(e) => setRejectRequirement(e.target.value)}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', justifyContent: 'center' }}>
          <button type="button" className="toolbar-btn" style={{ fontSize: '11.5px', padding: '5px 12px' }} onClick={() => void handleSaveEditedScript()}>
            💾 저장
          </button>
          <button type="button" className="toolbar-btn" style={{ fontSize: '11.5px', padding: '5px 12px' }} disabled={isProcessingDecision} onClick={() => void handleRejectAndReassign()}>
            ↩️ 반려
          </button>
        </div>
      </div>

      <CallScriptLineContextMenuAndModals
        lineMenu={lineMenu}
        setLineMenu={setLineMenu}
        selectedCountOnMenuSide={selectedCountOnMenuSide}
        counterpartName={selectedItem.contactName}
        currentAudioSec={currentAudioSec}
        audioRef={audioRef}
        editingModal={editingModal}
        setEditingModal={setEditingModal}
        splitModal={splitModal}
        setSplitModal={setSplitModal}
        onToggleSpeaker={(side, line) => {
          const targets = getTargetLinesForAction(side, line);
          const srcSection = side === 'LEFT' ? parsedDual.scriptAsrMarkdown : parsedDual.scriptPostMarkdown;
          const res = mutateBatchSpeakerOrDeleteInSectionMarkdown(srcSection, targets, { type: 'toggle_speaker', counterpartName: selectedItem.contactName });
          commitSectionUpdate(side, res.updatedSection, res.editEntries, selectedRawIdxs);
        }}
        onDeleteSelected={(side, line) => {
          const targets = getTargetLinesForAction(side, line);
          const srcSection = side === 'LEFT' ? parsedDual.scriptAsrMarkdown : parsedDual.scriptPostMarkdown;
          const res = mutateBatchSpeakerOrDeleteInSectionMarkdown(srcSection, targets, { type: 'delete_line' });
          commitSectionUpdate(side, res.updatedSection, res.editEntries, []);
        }}
        onMergeSelected={(side) => {
          const list = side === 'LEFT' ? linesAsr : linesPost;
          const targets = list.filter((l) => selectedRawIdxs.includes(l.rawLineIdx));
          if (targets.length < 2) return;
          const srcSection = side === 'LEFT' ? parsedDual.scriptAsrMarkdown : parsedDual.scriptPostMarkdown;
          const res = mutateMergeLinesInSectionMarkdown(srcSection, targets);
          commitSectionUpdate(side, res.updatedSection, res.editEntry ? [res.editEntry] : [], [res.mergedRawIdx]);
        }}
        onOpenSplitModal={(side, line) => {
          setSplitModal({ side, line, value: line.text, toggleSecondSpeaker: false });
          setLineMenu(null);
        }}
        onConfirmSplit={(splitIndex) => {
          if (!splitModal) return;
          const { side, line, value, toggleSecondSpeaker } = splitModal;
          const list = side === 'LEFT' ? linesAsr : linesPost;
          const linePos = list.findIndex((l) => l.rawLineIdx === line.rawLineIdx);
          const nextLine = linePos >= 0 && linePos + 1 < list.length ? list[linePos + 1] : undefined;
          const srcSection = side === 'LEFT' ? parsedDual.scriptAsrMarkdown : parsedDual.scriptPostMarkdown;
          const res = mutateSplitLineInSectionMarkdown(srcSection, { ...line, text: value }, splitIndex, toggleSecondSpeaker, selectedItem.contactName, nextLine?.sec);
          if (!res.editEntry) {
            setStatusMessage('⚠️ 분리할 위치(커서)를 문장 중간에 놓고 Enter를 눌러주세요.');
            return;
          }
          commitSectionUpdate(side, res.updatedSection, [res.editEntry], []);
        }}
        onConfirmTextOrTime={() => {
          if (!editingModal) return;
          const srcSection = editingModal.side === 'LEFT' ? parsedDual.scriptAsrMarkdown : parsedDual.scriptPostMarkdown;
          if (editingModal.mode === 'text') {
            const mutation = { type: 'edit_text' as const, nextText: editingModal.value };
            commitSectionUpdate(editingModal.side, mutateLineInSectionMarkdown(srcSection, editingModal.line, mutation), [buildUserScriptEditEntry(editingModal.line, mutation)], selectedRawIdxs);
          } else {
            const nextTag = parseTimeInputToTag(editingModal.value);
            if (nextTag) {
              const mutation = { type: 'change_time' as const, nextTimeTag: nextTag };
              commitSectionUpdate(editingModal.side, mutateLineInSectionMarkdown(srcSection, editingModal.line, mutation), [buildUserScriptEditEntry(editingModal.line, mutation)], selectedRawIdxs);
            }
          }
        }}
      />
    </div>
  );
}
