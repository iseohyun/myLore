/**
 * @file useLifelogAudio.ts
 * @description 통화 녹음 오디오 플레이어 상태, 본문 `[00:00:00]` 타임스탬프 큐(`audioScriptCues`) 파싱 및 오디오-에디터 양방향 시간 동기화 훅.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DirectCallPlayInfo,
  DocumentPayload,
  LifelogSourceType,
  ViewMode,
} from '../types/mylore';
import { getCallRecordingPlayInfo } from '../services/tauriClient';
import { parseAudioOffsetSecondsFromLine } from '../utils/markdownRenderer';

export interface UseLifelogAudioParams {
  currentDoc: DocumentPayload | null;
  bodyText: string;
  viewMode: ViewMode;
  activeTabPath: string | null;
  editorRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  previewPaneRef: React.MutableRefObject<HTMLDivElement | null>;
  lastEditorKeyPressMsRef: React.MutableRefObject<number>;
}

export function useLifelogAudio({
  currentDoc,
  bodyText,
  viewMode,
  activeTabPath,
  editorRef,
  previewPaneRef,
  lastEditorKeyPressMsRef,
}: UseLifelogAudioParams) {
  const [directCallPlayInfo, setDirectCallPlayInfo] =
    useState<DirectCallPlayInfo | null>(null);
  const [activeAudioLineIndex, setActiveAudioLineIndex] = useState<
    number | null
  >(null);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const lastSyncedAudioLineRef = useRef<number | null>(null);
  const lastProgrammaticAudioScrollMsRef = useRef<number>(0);

  // 현재 편집/열람 중인 모바일 문서의 카테고리('kakaotalk' | 'notification' | 'sms' | 'call' | 'recording' | 'health' | null) 판별
  const currentDocMobileSource = useMemo<LifelogSourceType | null>(() => {
    if (!currentDoc) return null;
    const cat = (currentDoc.frontmatter['category'] || '').toLowerCase();
    const fp = currentDoc.fullPath;
    if (
      cat === 'mobile/recordings' ||
      /[\\/]mobile[\\/]recordings[\\/]/i.test(fp)
    ) {
      return 'recording';
    }
    if (cat === 'mobile/health' || /[\\/]mobile[\\/]health[\\/]/i.test(fp)) {
      return 'health';
    }
    if (cat === 'mobile/calls' || /[\\/]mobile[\\/]calls[\\/]/i.test(fp)) {
      return 'call';
    }
    if (cat === 'mobile/sms' || /[\\/]mobile[\\/]sms[\\/]/i.test(fp)) {
      return 'sms';
    }
    if (cat === 'mobile/kakao' || /[\\/]mobile[\\/]kakao[\\/]/i.test(fp)) {
      return 'kakaotalk';
    }
    if (
      cat === 'mobile/notifications' ||
      /[\\/]mobile[\\/]notifications[\\/]/i.test(fp)
    ) {
      return 'notification';
    }
    return null;
  }, [currentDoc?.fullPath, currentDoc?.frontmatter]);

  const isCurrentDocMobileLifelog = Boolean(currentDocMobileSource);
  const isCurrentDocSms = currentDocMobileSource === 'sms';
  const isCurrentDocCall =
    currentDocMobileSource === 'call' || currentDocMobileSource === 'recording';

  // 라이프로그 대쉬보드(설정 탭이든 휴대폰데이터 탭이든 무관)가 활성화되었거나
  // 모바일 라이프로그(카톡/알림/문자/통화/녹음/헬스) 문서를 에디터 영역에서 열람 중일 때 6탭 사이드바 유지
  const isMobileDataSidebarMode =
    activeTabPath === 'mylore://dashboard/lifelog' ||
    viewMode === 'dashboard_lifelog' ||
    isCurrentDocMobileLifelog;

  const loadCallAudioIntoStatusBar = async (
    roomOrSender: string,
    attachmentUuid?: string,
    autoPlay = false,
    seekSec?: number
  ) => {
    try {
      const info = await getCallRecordingPlayInfo({
        roomOrSender,
        attachmentUuid,
      });
      let playUrl = info.audioUrl;
      if (info.audioBase64) {
        try {
          const binStr = atob(info.audioBase64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
          }
          const blob = new Blob([bytes], {
            type: info.mimeType || 'audio/mp4',
          });
          playUrl = URL.createObjectURL(blob);
        } catch (e) {
          console.error('Base64 오디오 디코딩 실패, URL 폴백:', e);
        }
      }
      if (typeof seekSec === 'number' && seekSec >= 0) {
        pendingSeekSecondsRef.current = seekSec;
      } else {
        pendingSeekSecondsRef.current = null;
      }
      setDirectCallPlayInfo((prev) => {
        if (prev?.audioUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(prev.audioUrl);
        }
        return {
          audioUrl: playUrl,
          fullPath: info.fullPath,
          fileName: info.fileName,
          contactDisplay: info.contactDisplay,
          autoPlay,
        };
      });
    } catch {
      // 오디오 파일이 없는 기록인 경우 무시
    }
  };

  // 통화/음성 문서가 열릴 때 하단 상태바에 오디오 재생바 자동 준비
  useEffect(() => {
    lastSyncedAudioLineRef.current = null;
    if (!currentDoc || !isCurrentDocCall) {
      setActiveAudioLineIndex(null);
      return;
    }
    const fmAudio = (currentDoc.frontmatter['audio_file'] || '').trim();
    if (!fmAudio) return;
    const audioFileName = fmAudio.replace(/^audio[\\/]/i, '').trim();
    const audioStem = audioFileName
      .replace(/\.(m4a|mp3|amr|wav|ogg|aac)$/i, '')
      .trim();
    if (
      directCallPlayInfo &&
      (directCallPlayInfo.fileName === audioFileName ||
        directCallPlayInfo.fullPath.endsWith(audioFileName))
    ) {
      return;
    }
    loadCallAudioIntoStatusBar(
      audioStem || currentDoc.frontmatter['contact_name'] || '',
      `transcribed:${audioStem}`,
      false
    );
  }, [currentDoc?.fullPath, isCurrentDocCall]);

  // 현재 문서 본문(`bodyText`) 내 `[00:00:00]` 오프셋 시각이 포함된 문장 목록 파싱
  const audioScriptCues = useMemo(() => {
    if (!isCurrentDocCall || !bodyText) return [];
    const lines = bodyText.replace(/\r\n/g, '\n').split('\n');
    const rawCues: Array<{
      lineIndex: number;
      startSec: number;
      endSec: number;
      charStart: number;
      charEnd: number;
    }> = [];
    let charCursor = 0;
    let inScriptSec = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const trimmed = line.trim();
      const lineCharStart = charCursor;
      const lineCharEnd = charCursor + line.length;
      charCursor = lineCharEnd + 1;

      if (/^#{1,4}\s+.*스크립트/.test(trimmed)) {
        inScriptSec = true;
        continue;
      }
      if (/^#{1,3}\s+/.test(trimmed) && !trimmed.includes('스크립트')) {
        inScriptSec = false;
      }
      if (!inScriptSec && !trimmed.startsWith('-') && !trimmed.startsWith('*')) {
        continue;
      }
      const sec = parseAudioOffsetSecondsFromLine(trimmed);
      if (sec !== null) {
        rawCues.push({
          lineIndex: idx,
          startSec: sec,
          endSec: Number.POSITIVE_INFINITY,
          charStart: lineCharStart,
          charEnd: lineCharEnd,
        });
      }
    }

    for (let i = 0; i < rawCues.length - 1; i++) {
      rawCues[i].endSec = Math.max(
        rawCues[i].startSec + 0.5,
        rawCues[i + 1].startSec
      );
    }
    return rawCues;
  }, [bodyText, isCurrentDocCall]);

  const scrollAndSelectCue = (
    matchedCue: {
      lineIndex: number;
      startSec: number;
      endSec: number;
      charStart: number;
      charEnd: number;
    },
    _forceSelect = false
  ) => {
    lastProgrammaticAudioScrollMsRef.current = Date.now();

    // 프리뷰 영역에서만 해당 대화 문장으로 스크롤 이동 (에디터 <textarea>의 커서·선택 영역은 건드리지 않아 Ctrl+C/V/A 등 기본 편집 동작 보장)
    if (previewPaneRef.current) {
      const pane = previewPaneRef.current;
      const targetNode = pane.querySelector(
        `[data-audio-line="${matchedCue.lineIndex}"]`
      ) as HTMLElement | null;
      if (targetNode) {
        const paneRect = pane.getBoundingClientRect();
        const nodeRect = targetNode.getBoundingClientRect();
        const nextScrollTop =
          pane.scrollTop +
          (nodeRect.top - paneRect.top) -
          pane.clientHeight * 0.38;
        pane.scrollTo({
          top: Math.max(0, nextScrollTop),
          behavior: 'smooth',
        });

        if (viewMode === 'preview' && typeof window !== 'undefined') {
          try {
            const sel = window.getSelection();
            if (sel) {
              const range = document.createRange();
              range.selectNodeContents(targetNode);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          } catch {
            // ignore DOM selection errors
          }
        }
      }
    }
  };

  // 오디오 재생 중 시각(`currentTime`) 또는 시점 이동(`onSeeked`) 시 해당 스크립트 문장을 자동 Select 및 스크롤 추적
  const handleAudioTimeUpdate = (
    eOrForce?: React.SyntheticEvent<HTMLAudioElement> | boolean
  ) => {
    const force = typeof eOrForce === 'boolean' ? eOrForce : false;
    const audioEl = callAudioRef.current;
    if (!audioEl || audioScriptCues.length === 0) return;
    const curSec = audioEl.currentTime;
    let matchedCue = audioScriptCues[0];
    for (const cue of audioScriptCues) {
      if (curSec >= cue.startSec) {
        matchedCue = cue;
      } else {
        break;
      }
    }
    if (!matchedCue) return;

    if (force || lastSyncedAudioLineRef.current !== matchedCue.lineIndex) {
      lastSyncedAudioLineRef.current = matchedCue.lineIndex;
      setActiveAudioLineIndex(matchedCue.lineIndex);
      scrollAndSelectCue(matchedCue, force);
    }
  };

  // 사용자가 스크립트의 특정 문장을 클릭/선택했을 때 해당 오프셋 시각으로 즉시 이동하여 재생
  const handleSeekAudioTime = async (seconds: number, lineIndex: number) => {
    lastSyncedAudioLineRef.current = lineIndex;
    setActiveAudioLineIndex(lineIndex);
    lastEditorKeyPressMsRef.current = 0;
    const targetCue = audioScriptCues.find((c) => c.lineIndex === lineIndex);
    if (targetCue) {
      scrollAndSelectCue(targetCue, true);
    }
    const audioEl = callAudioRef.current;
    if (audioEl && directCallPlayInfo) {
      audioEl.currentTime = seconds;
      audioEl.play().catch(() => {});
      return;
    }
    if (currentDoc && isCurrentDocCall) {
      const fmAudio = (currentDoc.frontmatter['audio_file'] || '')
        .replace(/^audio[\\/]/i, '')
        .replace(/\.(m4a|mp3|amr|wav|ogg|aac)$/i, '')
        .trim();
      await loadCallAudioIntoStatusBar(
        fmAudio || currentDoc.frontmatter['contact_name'] || '',
        fmAudio ? `transcribed:${fmAudio}` : undefined,
        true,
        seconds
      );
    }
  };

  return {
    directCallPlayInfo,
    setDirectCallPlayInfo,
    activeAudioLineIndex,
    setActiveAudioLineIndex,
    callAudioRef,
    pendingSeekSecondsRef,
    lastProgrammaticAudioScrollMsRef,
    currentDocMobileSource,
    isCurrentDocMobileLifelog,
    isCurrentDocSms,
    isCurrentDocCall,
    isMobileDataSidebarMode,
    loadCallAudioIntoStatusBar,
    audioScriptCues,
    handleAudioTimeUpdate,
    handleSeekAudioTime,
  };
}
