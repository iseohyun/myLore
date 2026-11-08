/**
 * @file DocumentWorkspace.tsx
 * @description 메인 문서 작업 영역: 인라인 찾기/바꾸기 바, YAML 드로어, 통화 재시도 배너, `<SmsBubbleView />`, 마크다운 에디터(`<textarea>`) 및 라이브 프리뷰.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DocumentPayload,
  FileNode,
  GeminiApiKeyStatus,
  ViewMode,
} from '../../types/mylore';
import {
  getGeminiApiKeyStatus,
  openExternalUrlInChrome,
  readDocument,
  readDocumentByUuid,
  retryPendingCallTranscriptions,
  transcribeSingleCallItem,
  updateCallTranscriptStage,
} from '../../services/tauriClient';
import { updateTaskStatusInBody } from '../../utils/markdownAutoFormat';
import { MarkdownPreviewRenderer } from '../../utils/markdownRenderer';
import {
  BracketLinkTrigger,
  buildCompletedMarkdownLink,
  detectBracketLinkTrigger,
  filterLinkCandidates,
  LinkAutocompletePopup,
} from './LinkAutocompletePopup';
import { ProjectSubDocsPanel } from './ProjectSubDocsPanel';
import { SmsBubbleView, SmsHeaderBar } from './SmsBubbleView';

export interface AudioScriptCue {
  lineIndex: number;
  startSec: number;
  endSec: number;
  charStart: number;
  charEnd: number;
}

export interface DocumentWorkspaceProps {
  currentDoc: DocumentPayload | null;
  findBarMode: 'closed' | 'find' | 'replace';
  setFindBarMode: React.Dispatch<
    React.SetStateAction<'closed' | 'find' | 'replace'>
  >;
  docFindQuery: string;
  setDocFindQuery: React.Dispatch<React.SetStateAction<string>>;
  docReplaceText: string;
  setDocReplaceText: React.Dispatch<React.SetStateAction<string>>;
  docFindMatchRange?: { start: number; end: number; seq?: number } | null;
  handleReplaceCurrentInDoc?: () => void;
  handleReplaceAllInDoc?: () => void;
  handleJumpSearchMatch: (dir: 1 | -1) => void;
  yamlText: string;
  setYamlText: (nextYaml: string) => void;
  bodyText: string;
  setBodyText: (updater: string | ((prev: string) => string)) => void;
  isYamlVisible: boolean;
  getShortcutLabel: (id: string) => string;
  isCurrentDocCall: boolean;
  geminiStatus: GeminiApiKeyStatus | null;
  setGeminiStatus: React.Dispatch<
    React.SetStateAction<GeminiApiKeyStatus | null>
  >;
  isRetryingCalls: boolean;
  setIsRetryingCalls: React.Dispatch<React.SetStateAction<boolean>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  refreshAllLifelogMessages: () => Promise<void>;
  applyOptimisticCallStageUpdate?: (
    targetStemOrRoom: string,
    nextStage: 1 | 2 | 3 | 4,
    reqText?: string,
    messageId?: number,
    audioFileHint?: string
  ) => void;
  selectedLifelogMsgId?: number | null;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
      openAsLink?: boolean;
    }
  ) => void;
  isCurrentDocSms: boolean;
  smsRawEditMode: boolean;
  setSmsRawEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  smsBubbleScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  resolveContactName: (rawNumberOrName: string) => string;
  viewMode: ViewMode;
  editorRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  previewPaneRef: React.MutableRefObject<HTMLDivElement | null>;
  handleEditorScroll: (e: React.UIEvent<HTMLTextAreaElement>) => void;
  lastEditorKeyPressMsRef: React.MutableRefObject<number>;
  recordEditPosition: (
    path: string,
    offset: number,
    forceNewStep?: boolean
  ) => void;
  audioScriptCues: AudioScriptCue[];
  handleSeekAudioTime: (seconds: number, lineIndex: number) => Promise<void> | void;
  activeAudioLineIndex: number | null;
  currentProjectSubDocs: FileNode[];
  flattenedFiles?: FileNode[];
  subDocFilter: string;
  setSubDocFilter: React.Dispatch<React.SetStateAction<string>>;
  subDocViewStyle: 'cards' | 'table';
  setSubDocViewStyle: React.Dispatch<React.SetStateAction<'cards' | 'table'>>;
  openDocumentByNode: (node: FileNode) => void;
}

export function DocumentWorkspace({
  currentDoc,
  findBarMode,
  setFindBarMode,
  docFindQuery,
  setDocFindQuery,
  docReplaceText,
  setDocReplaceText,
  docFindMatchRange,
  handleReplaceCurrentInDoc,
  handleReplaceAllInDoc,
  handleJumpSearchMatch,
  yamlText,
  setYamlText,
  bodyText,
  setBodyText,
  isYamlVisible,
  getShortcutLabel,
  isCurrentDocCall,
  geminiStatus,
  setGeminiStatus,
  isRetryingCalls,
  setIsRetryingCalls,
  setStatusMessage,
  refreshAllLifelogMessages,
  applyOptimisticCallStageUpdate,
  selectedLifelogMsgId,
  applyLoadedDocument,
  isCurrentDocSms,
  smsRawEditMode,
  setSmsRawEditMode,
  smsBubbleScrollRef,
  resolveContactName,
  viewMode,
  editorRef,
  previewPaneRef,
  handleEditorScroll,
  lastEditorKeyPressMsRef,
  recordEditPosition,
  audioScriptCues,
  handleSeekAudioTime,
  activeAudioLineIndex,
  currentProjectSubDocs,
  flattenedFiles = [],
  subDocFilter,
  setSubDocFilter,
  subDocViewStyle,
  setSubDocViewStyle,
  openDocumentByNode,
}: DocumentWorkspaceProps) {
  const [callReqInput, setCallReqInput] = useState<string>('');
  const [isReqEditorOpen, setIsReqEditorOpen] = useState<boolean>(false);
  const [optimisticDocStage, setOptimisticDocStage] = useState<{
    path: string;
    stage: 1 | 2 | 3 | 4;
  } | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const editorBackdropRef = useRef<HTMLDivElement | null>(null);
  const [linkTrigger, setLinkTrigger] = useState<BracketLinkTrigger | null>(
    null
  );
  const [linkSelectedIndex, setLinkSelectedIndex] = useState<number>(0);

  const linkCandidates = useMemo(() => {
    if (!linkTrigger) return [];
    return filterLinkCandidates(
      linkTrigger.query,
      flattenedFiles,
      currentDoc?.fullPath
    );
  }, [linkTrigger, flattenedFiles, currentDoc?.fullPath]);

  useEffect(() => {
    setLinkTrigger(null);
    setLinkSelectedIndex(0);
  }, [currentDoc?.fullPath]);

  const handleCompleteBracketLink = (node: FileNode) => {
    if (!linkTrigger) return;
    const completed = buildCompletedMarkdownLink(node);
    const nextText =
      bodyText.slice(0, linkTrigger.replaceStart) +
      completed +
      bodyText.slice(linkTrigger.replaceEnd);
    const nextCaret = linkTrigger.replaceStart + completed.length;

    setBodyText(nextText);
    setLinkTrigger(null);
    setLinkSelectedIndex(0);
    setStatusMessage(`🔗 문서 링크 삽입: ${completed}`);

    setTimeout(() => {
      const ta = editorRef.current;
      if (ta) {
        ta.focus();
        try {
          ta.setSelectionRange(nextCaret, nextCaret);
        } catch {
          // ignore
        }
      }
    }, 0);
  };

  const handleNavigateDocByName = async (rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const withExt = trimmed.toLowerCase().endsWith('.md')
      ? trimmed
      : `${trimmed}.md`;

    // 1순위: 현재 열람 중인 문서와 같은 폴더의 하위/형제 문서 조회
    if (currentDoc?.fullPath) {
      const normCur = currentDoc.fullPath.replace(/\//g, '\\');
      const lastSlash = normCur.lastIndexOf('\\');
      if (lastSlash >= 0) {
        const siblingPath = `${normCur.slice(0, lastSlash)}\\${withExt}`;
        try {
          const siblingDoc = await readDocument(siblingPath);
          applyLoadedDocument(siblingDoc);
          return;
        } catch {
          // 2순위로 폴백
        }
      }
    }

    // 2순위: flattenedFiles에서 파일명 또는 제목 매칭
    const lowerWithExt = withExt.toLowerCase();
    const lowerRaw = trimmed.toLowerCase();
    const matched = flattenedFiles.find(
      (f) =>
        f.name.toLowerCase() === lowerWithExt ||
        (f.title && f.title.toLowerCase() === lowerRaw) ||
        f.relativePath.toLowerCase().endsWith(`\\${lowerWithExt}`) ||
        f.relativePath.toLowerCase().endsWith(`/${lowerWithExt}`)
    );
    if (matched) {
      try {
        const doc = await readDocument(matched.fullPath);
        applyLoadedDocument(doc, { openAsLink: true });
        return;
      } catch (e) {
        setStatusMessage(`문서 열기 실패: ${String(e)}`);
        return;
      }
    }
    setStatusMessage(`⚠️ 연결된 문서를 찾을 수 없습니다: ${trimmed}`);
  };

  useEffect(() => {
    if (findBarMode !== 'closed') {
      if (isCurrentDocSms && !smsRawEditMode) {
        setSmsRawEditMode(true);
      }
    }
  }, [findBarMode]);

  useEffect(() => {
    if (findBarMode === 'closed' || !docFindMatchRange) return;
    const ta = editorRef.current;
    const backdrop = editorBackdropRef.current;
    if (ta && backdrop) {
      backdrop.style.width = `${ta.clientWidth}px`;
      const markEl = backdrop.querySelector(
        '.editor-find-selection-mark'
      ) as HTMLElement | null;
      if (markEl) {
        const targetTop = Math.max(
          0,
          markEl.offsetTop - Math.floor(ta.clientHeight * 0.35)
        );
        ta.scrollTop = targetTop;
        backdrop.scrollTop = targetTop;
      } else {
        const lineNum = bodyText
          .slice(0, docFindMatchRange.start)
          .split('\n').length;
        const approxTop = Math.max(0, (lineNum - 4) * 24);
        ta.scrollTop = approxTop;
        backdrop.scrollTop = approxTop;
      }
      if (document.activeElement === ta) {
        try {
          ta.setSelectionRange(docFindMatchRange.start, docFindMatchRange.end);
        } catch {
          // ignore
        }
      }
    }

    const previewEl = previewPaneRef.current;
    if (previewEl && bodyText.length > 0) {
      if (ta && ta.scrollHeight > ta.clientHeight) {
        const ratio =
          ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight);
        previewEl.scrollTop = Math.round(
          ratio * Math.max(0, previewEl.scrollHeight - previewEl.clientHeight)
        );
      } else {
        const approxRatio =
          docFindMatchRange.start / Math.max(1, bodyText.length);
        previewEl.scrollTop = Math.round(
          approxRatio *
            Math.max(0, previewEl.scrollHeight - previewEl.clientHeight)
        );
      }
    }
  }, [docFindMatchRange, findBarMode, smsRawEditMode, viewMode]);

  useEffect(() => {
    if (!isCurrentDocCall || activeAudioLineIndex === null || findBarMode !== 'closed') return;
    if (Date.now() - lastEditorKeyPressMsRef.current < 2200) return;
    const activeCue = audioScriptCues.find((c) => c.lineIndex === activeAudioLineIndex);
    if (!activeCue) return;
    const ta = editorRef.current;
    const backdrop = editorBackdropRef.current;
    if (ta && backdrop) {
      backdrop.style.width = `${ta.clientWidth}px`;
      const markEl = backdrop.querySelector('.editor-find-selection-mark') as HTMLElement | null;
      if (markEl) {
        const targetTop = Math.max(0, markEl.offsetTop - Math.floor(ta.clientHeight * 0.38));
        ta.scrollTop = targetTop;
        backdrop.scrollTop = targetTop;
      }
      try {
        ta.setSelectionRange(activeCue.charStart, activeCue.charEnd);
      } catch {
        // ignore
      }
    }
  }, [activeAudioLineIndex, isCurrentDocCall, findBarMode]);

  useEffect(() => {
    const reqFromFm = currentDoc?.frontmatter?.['user_requirement'] || '';
    setCallReqInput(reqFromFm);
    setIsReqEditorOpen(currentDoc?.frontmatter?.['transcript_status'] === 'needs_revision');
    setOptimisticDocStage(null);
  }, [currentDoc?.fullPath, currentDoc?.frontmatter?.['user_requirement'], currentDoc?.frontmatter?.['transcript_status']]);

  if (!currentDoc) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '32px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <p>
          우측 사이드바(`📂`)에서 문서를 선택하거나 상단 메뉴(`파일`, `이동`)를 통해 문서를 여세요.
        </p>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          단축키 설정: <kbd>F12</kbd> | 상단 메뉴: <kbd>F10</kbd> 또는 <kbd>Alt</kbd> | 빠른 열기: <kbd>Ctrl+P</kbd>
        </p>
      </div>
    );
  }

  return (
    <>
      {isYamlVisible && (
        <div className="yaml-drawer">
          <div className="yaml-drawer-header">
            <span>⚙️ YAML Frontmatter ({getShortcutLabel('toggle_yaml')})</span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
              UUID: {currentDoc.uuid}
            </span>
          </div>
          <textarea
            className="yaml-editor-textarea"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
          />
        </div>
      )}

      {isCurrentDocCall &&
        Boolean(currentDoc.frontmatter['audio_file']) &&
        (() => {
          const rawStatus =
            currentDoc.frontmatter['transcript_status'] || 'unverified';
          const fmStage: 1 | 2 | 3 | 4 =
            rawStatus === 'pending' || rawStatus === 'pending_quota'
              ? 1
              : rawStatus === 'needs_revision'
                ? 3
                : rawStatus === 'verified'
                  ? 4
                  : 2;
          const currentStage: 1 | 2 | 3 | 4 =
            optimisticDocStage && optimisticDocStage.path === currentDoc.fullPath
              ? optimisticDocStage.stage
              : fmStage;
          const docFileStem = currentDoc.fullPath
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            ?.replace(/\.md$/i, '') || '';
          const audioFileHint = (
            currentDoc.frontmatter['audio_file'] || ''
          ).trim();

          const handleStageChange = async (
            nextStage: 1 | 2 | 3 | 4,
            reqText?: string
          ) => {
            const stageMsgMap: Record<1 | 2 | 3 | 4, string> = {
              1: '🔊 1단계(스크립트 미생성 · AI 대기열 등록)로 설정되었습니다.',
              2: '❓ 2단계(스크립트 확인 전 · AI 대기열 제외)로 설정되었습니다.',
              3: '❗ 3단계(사용자 추가 요구사항 등록 · AI 대기열 포함)로 설정되었습니다.',
              4: '📄 4단계(사용자 스크립트 확인 완료 · AI 대기열 제외)로 설정되었습니다.',
            };
            // 1) 0ms 낙관적(Optimistic) UI 즉시 반영: 배너 + 사이드바/리스트(? 필터 및 아이콘)
            setOptimisticDocStage({
              path: currentDoc.fullPath,
              stage: nextStage,
            });
            applyOptimisticCallStageUpdate?.(
              docFileStem,
              nextStage,
              reqText,
              selectedLifelogMsgId ?? undefined,
              audioFileHint
            );
            setStatusMessage(stageMsgMap[nextStage]);

            try {
              const updatedDoc = await updateCallTranscriptStage({
                roomOrSender: docFileStem,
                attachmentUuid: audioFileHint || docFileStem,
                stage: nextStage,
                userRequirement: reqText,
              });
              applyLoadedDocument(updatedDoc);
              await Promise.all([
                refreshAllLifelogMessages(),
                getGeminiApiKeyStatus()
                  .then((stat) => {
                    if (stat) setGeminiStatus(stat);
                  })
                  .catch(() => null),
              ]);
            } catch (err) {
              setOptimisticDocStage(null);
              setStatusMessage(`스크립트 단계 변경 오류: ${String(err)}`);
              void refreshAllLifelogMessages();
            }
          };

          return (
            <div
              style={{
                margin: '8px 14px 0 14px',
                padding: '9px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12.5px',
                  }}
                >
                  <span style={{ fontWeight: 700, color: 'var(--heading-color)' }}>
                    {currentStage === 1
                      ? '🔊 1단계: 아직 스크립트화가 진행되지 않았습니다 (AI 대기열 포함)'
                      : currentStage === 2
                        ? '❓ 2단계: 스크립트가 진행되었으나 사용자 확인 전입니다 (AI 대기열 제외)'
                        : currentStage === 3
                          ? '❗ 3단계: 사용자 추가 요구사항이 있습니다 (AI 대기열 포함 · 완료 시 2단계 회귀)'
                          : '📄 4단계: 스크립트가 진행되었고 사용자가 확인했습니다 (AI 대기열 제외)'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {currentStage !== 4 ? (
                    <button
                      className="toolbar-btn primary"
                      onClick={() => handleStageChange(4)}
                      title="스크립트 내용을 확인했음을 표시하고 4단계(📄)로 전환합니다"
                    >
                      📄 사용자 확인 완료 (4단계)
                    </button>
                  ) : (
                    <button
                      className="toolbar-btn"
                      onClick={() => handleStageChange(2)}
                      title="미확인 상태인 2단계(❓)로 되돌립니다"
                    >
                      ❓ 미확인(2단계)으로 변경
                    </button>
                  )}
                  <button
                    className={`toolbar-btn ${
                      isReqEditorOpen || currentStage === 3 ? 'primary' : ''
                    }`}
                    onClick={() => {
                      if (currentStage !== 3) {
                        setIsReqEditorOpen(true);
                        void handleStageChange(3, callReqInput);
                      } else {
                        setIsReqEditorOpen((prev) => !prev);
                      }
                    }}
                    title="스크립트에 대한 추가 요구사항을 입력하고 3단계(❗) 대기열에 넣습니다"
                  >
                    ❗ 추가 요구사항 (3단계)
                  </button>
                  {currentStage !== 1 && (
                    <button
                      className="toolbar-btn"
                      onClick={() => handleStageChange(1)}
                      title="1단계(🔊 스크립트 대기열)로 되돌립니다"
                    >
                      🔊 1단계 대기열 등록
                    </button>
                  )}
                </div>
              </div>

              {(isReqEditorOpen || currentStage === 3) && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                    paddingTop: '6px',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <input
                    className="input-field"
                    style={{ flex: 1, minWidth: '240px', fontSize: '12px' }}
                    placeholder="추가 요구사항 입력 (예: 화자 이름을 김대리로 수정하고 일정/금액 합의를 상세히 요약해줘)"
                    value={callReqInput}
                    onChange={(e) => setCallReqInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleStageChange(
                          3,
                          callReqInput.trim() || '재검토 및 보완 요청'
                        );
                      }
                    }}
                  />
                  <button
                    className="toolbar-btn primary"
                    onClick={() =>
                      handleStageChange(
                        3,
                        callReqInput.trim() || '재검토 및 보완 요청'
                      )
                    }
                  >
                    ❗ 3단계 대기열 등록
                  </button>
                  <button
                    className="toolbar-btn"
                    disabled={isRetryingCalls}
                    onClick={async () => {
                      try {
                        setIsRetryingCalls(true);
                        setStatusMessage(
                          '🎙️ 사용자 추가 요구사항을 반영하여 즉시 재스크립트화를 진행합니다...'
                        );
                        const doc = await transcribeSingleCallItem({
                          roomOrSender: docFileStem,
                          attachmentUuid: audioFileHint || docFileStem,
                          userRequirement: callReqInput,
                        });
                        setOptimisticDocStage({
                          path: currentDoc.fullPath,
                          stage: 2,
                        });
                        applyOptimisticCallStageUpdate?.(
                          docFileStem,
                          2,
                          callReqInput,
                          selectedLifelogMsgId ?? undefined,
                          audioFileHint
                        );
                        applyLoadedDocument(doc);
                        setIsReqEditorOpen(false);
                        setStatusMessage(
                          '✅ 추가 요구사항 반영 재스크립트 완료! (❓ 2단계로 회귀되었습니다)'
                        );
                        await Promise.all([
                          refreshAllLifelogMessages(),
                          getGeminiApiKeyStatus()
                            .then((stat) => {
                              if (stat) setGeminiStatus(stat);
                            })
                            .catch(() => null),
                        ]);
                      } catch (err) {
                        setStatusMessage(`재스크립트 오류: ${String(err)}`);
                      } finally {
                        setIsRetryingCalls(false);
                      }
                    }}
                  >
                    🎙️ 요구사항 반영 즉시 재스크립트
                  </button>
                </div>
              )}
            </div>
          );
        })()}

      {isCurrentDocCall &&
        (currentDoc.frontmatter['transcript_status'] === 'pending_quota' ||
          bodyText.includes('토큰 부족') ||
          bodyText.includes('생성 대기 중')) && (
          <div style={{ margin: '8px 14px 0 14px', padding: '10px 14px', borderRadius: '8px', border: '1.5px solid #ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '12.5px' }}>
              <span style={{ fontWeight: 700, color: '#fca5a5' }}>
                ⚠️ LLM 토큰 부족/대기로 인해 아직 통화 요약 및 스크립트가 생성되지 않았습니다.
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                {geminiStatus?.retryAfterAt
                  ? `고갈 감지 시점(${geminiStatus.quotaExhaustedAt || '방금'})으로부터 5시간 후인 ${geminiStatus.retryAfterAt} 에 자동으로 스크립트 변환을 재시도합니다.`
                  : '백그라운드 스케줄러가 토큰 고갈 시점으로부터 5시간 후 자동으로 재시도합니다.'}
              </span>
            </div>
            <button
              className="toolbar-btn primary"
              disabled={isRetryingCalls}
              style={{ borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.25)' }}
              onClick={async () => {
                try {
                  setIsRetryingCalls(true);
                  setStatusMessage('🔄 미생성 통화 녹음의 LLM 요약+스크립트 변환을 즉시 재시도합니다...');
                  const stat = await retryPendingCallTranscriptions();
                  setGeminiStatus(stat);
                  await refreshAllLifelogMessages();
                  const reloaded = await readDocument(currentDoc.fullPath);
                  applyLoadedDocument(reloaded);
                  setStatusMessage(
                    stat.pendingCallCount === 0
                      ? '✅ 통화 녹음 요약 및 스크립트 생성 완료!'
                      : `⚠️ 재시도 결과: 미완료 ${stat.pendingCallCount}건 (다음 자동 재시도: ${stat.retryAfterAt || '5시간 후'})`
                  );
                } catch (err) {
                  setStatusMessage(`재시도 오류: ${String(err)}`);
                } finally {
                  setIsRetryingCalls(false);
                }
              }}
            >
              {isRetryingCalls ? '⏳ LLM 변환 재시도 중...' : '🔄 지금 즉시 스크립트 생성 재시도'}
            </button>
          </div>
        )}

      {isCurrentDocSms && (
        <SmsHeaderBar
          currentDoc={currentDoc}
          smsRawEditMode={smsRawEditMode}
          setSmsRawEditMode={setSmsRawEditMode}
          resolveContactName={resolveContactName}
        />
      )}

      {isCurrentDocSms && !smsRawEditMode ? (
        <SmsBubbleView bodyText={bodyText} smsBubbleScrollRef={smsBubbleScrollRef} />
      ) : (
        <div className="editor-split-container">
          {(viewMode === 'split' || viewMode === 'editor') && (
            <div className="markdown-editor-pane">
              {linkTrigger && linkCandidates.length > 0 && (
                <LinkAutocompletePopup
                  query={linkTrigger.query}
                  candidates={linkCandidates}
                  selectedIndex={linkSelectedIndex}
                  setSelectedIndex={setLinkSelectedIndex}
                  onSelectCandidate={handleCompleteBracketLink}
                  onClose={() => setLinkTrigger(null)}
                  currentDocFullPath={currentDoc.fullPath}
                />
              )}
              {(() => {
                const activeCue =
                  isCurrentDocCall && activeAudioLineIndex !== null
                    ? audioScriptCues.find((c) => c.lineIndex === activeAudioLineIndex)
                    : null;
                const highlightRange =
                  findBarMode !== 'closed' && docFindMatchRange
                    ? docFindMatchRange
                    : activeCue
                      ? { start: activeCue.charStart, end: activeCue.charEnd }
                      : null;
                if (!highlightRange) return null;
                return (
                  <div ref={editorBackdropRef} className="markdown-textarea-backdrop" aria-hidden="true">
                    {bodyText.slice(0, highlightRange.start)}
                    <mark className="editor-find-selection-mark">
                      {bodyText.slice(highlightRange.start, highlightRange.end)}
                    </mark>
                    {bodyText.slice(highlightRange.end)}
                    {'\n'}
                  </div>
                );
              })()}
              <textarea
                ref={editorRef}
                className="markdown-textarea"
                value={bodyText}
                onScroll={(e) => {
                  if (editorBackdropRef.current) {
                    editorBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                  }
                  handleEditorScroll(e);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Control' && e.key !== 'Meta') {
                    lastEditorKeyPressMsRef.current = Date.now();
                  }
                  if (linkTrigger && linkCandidates.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setLinkSelectedIndex((prev) => (prev + 1) % linkCandidates.length);
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setLinkSelectedIndex((prev) => (prev - 1 + linkCandidates.length) % linkCandidates.length);
                      return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      const chosen = linkCandidates[linkSelectedIndex] || linkCandidates[0];
                      if (chosen) handleCompleteBracketLink(chosen);
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setLinkTrigger(null);
                      return;
                    }
                  }
                }}
                onMouseDown={(e) => {
                  if (!e.ctrlKey && !e.metaKey) lastEditorKeyPressMsRef.current = Date.now();
                  setLinkTrigger(null);
                }}
                onChange={(e) => {
                  lastEditorKeyPressMsRef.current = Date.now();
                  const nextVal = e.target.value;
                  const offset = e.target.selectionStart;
                  setBodyText(nextVal);
                  setLinkTrigger(detectBracketLinkTrigger(nextVal, offset));
                  setLinkSelectedIndex(0);
                  if (currentDoc) recordEditPosition(currentDoc.fullPath, offset, false);
                }}
                onClick={(e) => {
                  if ((e.ctrlKey || e.metaKey) && isCurrentDocCall && audioScriptCues.length > 0) {
                    const ta = e.currentTarget;
                    if (ta.selectionStart === ta.selectionEnd) {
                      const caret = ta.selectionStart;
                      const clickedCue = audioScriptCues.find((c) => caret >= c.charStart && caret <= c.charEnd);
                      if (clickedCue) void handleSeekAudioTime(clickedCue.startSec, clickedCue.lineIndex);
                    }
                  }
                }}
                onMouseUp={(e) => {
                  if (currentDoc) {
                    lastEditorKeyPressMsRef.current = Date.now();
                    recordEditPosition(currentDoc.fullPath, e.currentTarget.selectionStart, false);
                  }
                }}
                onKeyUp={(e) => {
                  if (currentDoc && !e.ctrlKey && !e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                    recordEditPosition(currentDoc.fullPath, e.currentTarget.selectionStart, false);
                  }
                }}
                placeholder="여기에 마크다운 본문을 작성하세요..."
              />
            </div>
          )}

          {(viewMode === 'split' || viewMode === 'preview') && (
            <div ref={previewPaneRef} className="markdown-preview-pane rendered-md">
              <MarkdownPreviewRenderer
                bodyText={bodyText}
                onUpdateTaskStatus={(lineIdx, nextCode) => setBodyText(updateTaskStatusInBody(bodyText, lineIdx, nextCode))}
                onNavigateUuid={async (targetUuid) => {
                  try {
                    applyLoadedDocument(await readDocumentByUuid(targetUuid), {
                      openAsLink: true,
                    });
                  } catch (e) {
                    setStatusMessage(`UUID 링크 이동 실패: ${String(e)}`);
                  }
                }}
                onNavigateDocName={(docName) => void handleNavigateDocByName(docName)}
                onOpenExternalUrl={(url) => openExternalUrlInChrome(url)}
                activeAudioLineIndex={activeAudioLineIndex}
                onSeekAudioTime={handleSeekAudioTime}
                onEditSourceLine={(lineIdx) => {
                  const ta = editorRef.current;
                  if (!ta) return;
                  lastEditorKeyPressMsRef.current = Date.now();
                  const lines = bodyText.replace(/\r\n/g, '\n').split('\n');
                  let charOffset = 0;
                  for (let k = 0; k < Math.min(lineIdx, lines.length); k++) {
                    charOffset += lines[k].length + 1;
                  }
                  const targetPos = charOffset + (lines[lineIdx]?.length ?? 0);
                  ta.focus();
                  try {
                    ta.setSelectionRange(targetPos, targetPos);
                  } catch {
                    // ignore
                  }
                  if (currentDoc) recordEditPosition(currentDoc.fullPath, targetPos, false);
                }}
                enableAudioTimestampSync={isCurrentDocCall}
              />

              <ProjectSubDocsPanel
                currentDoc={currentDoc}
                currentProjectSubDocs={currentProjectSubDocs}
                subDocFilter={subDocFilter}
                setSubDocFilter={setSubDocFilter}
                subDocViewStyle={subDocViewStyle}
                setSubDocViewStyle={setSubDocViewStyle}
                openDocumentByNode={openDocumentByNode}
              />

              {currentDoc.backlinks && currentDoc.backlinks.length > 0 && (
                <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                  <h3 style={{ marginBottom: '10px' }}>🔄 연결된 양방향 백링크 ({currentDoc.backlinks.length})</h3>
                  {currentDoc.backlinks.map((bl, bIdx) => (
                    <div
                      key={bIdx}
                      className="rendered-task-row"
                      style={{ cursor: 'pointer' }}
                      onClick={async () =>
                        applyLoadedDocument(await readDocument(bl.sourcePath), {
                          openAsLink: true,
                        })
                      }
                    >
                      <span className={`role-badge ${bl.sourceRole}`}>{bl.sourceRole}</span>
                      <div>
                        <div style={{ fontWeight: 700 }}>{bl.sourceTitle}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{bl.excerpt}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
