/**
 * @file DocumentWorkspace.tsx
 * @description 메인 문서 작업 영역: 인라인 찾기/바꾸기 바, YAML 드로어, 통화 재시도 배너, `<SmsBubbleView />`, 마크다운 에디터(`<textarea>`) 및 라이브 프리뷰.
 */
import React from 'react';
import {
  DocumentPayload,
  FileNode,
  GeminiApiKeyStatus,
  ViewMode,
} from '../../types/mylore';
import {
  openExternalUrlInChrome,
  readDocument,
  readDocumentByUuid,
  retryPendingCallTranscriptions,
} from '../../services/tauriClient';
import { updateTaskStatusInBody } from '../../utils/markdownAutoFormat';
import { MarkdownPreviewRenderer } from '../../utils/markdownRenderer';
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
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
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
  subDocFilter,
  setSubDocFilter,
  subDocViewStyle,
  setSubDocViewStyle,
  openDocumentByNode,
}: DocumentWorkspaceProps) {
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
      {findBarMode !== 'closed' && (
        <div className="find-replace-bar">
          <input
            autoFocus
            className="input-field"
            style={{ width: '200px' }}
            placeholder="문서 내 찾기..."
            value={docFindQuery}
            onChange={(e) => setDocFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJumpSearchMatch(1);
            }}
          />
          <button
            className="toolbar-btn"
            onClick={() => handleJumpSearchMatch(-1)}
          >
            ↑ 이전
          </button>
          <button
            className="toolbar-btn"
            onClick={() => handleJumpSearchMatch(1)}
          >
            ↓ 다음
          </button>
          {findBarMode === 'replace' && (
            <>
              <input
                className="input-field"
                style={{ width: '180px' }}
                placeholder="바꿀 내용..."
                value={docReplaceText}
                onChange={(e) => setDocReplaceText(e.target.value)}
              />
              <button
                className="toolbar-btn primary"
                onClick={() => {
                  if (!docFindQuery) return;
                  setBodyText((prev) =>
                    prev.replace(docFindQuery, docReplaceText)
                  );
                }}
              >
                바꾸기
              </button>
              <button
                className="toolbar-btn"
                onClick={() => {
                  if (!docFindQuery) return;
                  setBodyText((prev) =>
                    prev.split(docFindQuery).join(docReplaceText)
                  );
                }}
              >
                모두 바꾸기
              </button>
            </>
          )}
          <button
            className="toolbar-btn"
            onClick={() => setFindBarMode('closed')}
          >
            ✕
          </button>
        </div>
      )}

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
        (currentDoc.frontmatter['transcript_status'] === 'pending_quota' ||
          bodyText.includes('토큰 부족') ||
          bodyText.includes('생성 대기 중')) && (
          <div
            style={{
              margin: '8px 14px 0 14px',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1.5px solid #ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
                flexDirection: 'column',
                gap: '2px',
                fontSize: '12.5px',
              }}
            >
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
              style={{
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.25)',
              }}
              onClick={async () => {
                try {
                  setIsRetryingCalls(true);
                  setStatusMessage(
                    '🔄 미생성 통화 녹음의 LLM 요약+스크립트 변환을 즉시 재시도합니다...'
                  );
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
              {isRetryingCalls
                ? '⏳ LLM 변환 재시도 중...'
                : '🔄 지금 즉시 스크립트 생성 재시도'}
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
        <SmsBubbleView
          bodyText={bodyText}
          smsBubbleScrollRef={smsBubbleScrollRef}
        />
      ) : (
        <div className="editor-split-container">
          {(viewMode === 'split' || viewMode === 'editor') && (
            <div className="markdown-editor-pane">
              <textarea
                ref={editorRef}
                className="markdown-textarea"
                value={bodyText}
                onScroll={handleEditorScroll}
                onKeyDown={() => {
                  lastEditorKeyPressMsRef.current = Date.now();
                }}
                onChange={(e) => {
                  lastEditorKeyPressMsRef.current = Date.now();
                  const offset = e.target.selectionStart;
                  setBodyText(e.target.value);
                  if (currentDoc) {
                    recordEditPosition(currentDoc.fullPath, offset, false);
                  }
                }}
                onMouseUp={(e) => {
                  const selStart = e.currentTarget.selectionStart;
                  const selEnd = e.currentTarget.selectionEnd;
                  if (currentDoc) {
                    recordEditPosition(currentDoc.fullPath, selStart, false);
                  }
                  if (
                    isCurrentDocCall &&
                    audioScriptCues.length > 0 &&
                    selStart === selEnd
                  ) {
                    const clickedCue = audioScriptCues.find(
                      (c) => selStart >= c.charStart && selStart <= c.charEnd
                    );
                    if (clickedCue) {
                      handleSeekAudioTime(
                        clickedCue.startSec,
                        clickedCue.lineIndex
                      );
                    }
                  }
                }}
                placeholder="여기에 마크다운 본문을 작성하세요..."
              />
            </div>
          )}

          {(viewMode === 'split' || viewMode === 'preview') && (
            <div
              ref={previewPaneRef}
              className="markdown-preview-pane rendered-md"
            >
              <MarkdownPreviewRenderer
                bodyText={bodyText}
                onUpdateTaskStatus={(lineIdx, nextCode) => {
                  const next = updateTaskStatusInBody(
                    bodyText,
                    lineIdx,
                    nextCode
                  );
                  setBodyText(next);
                }}
                onNavigateUuid={async (targetUuid) => {
                  try {
                    const targetDoc = await readDocumentByUuid(targetUuid);
                    applyLoadedDocument(targetDoc);
                  } catch (e) {
                    setStatusMessage(`UUID 링크 이동 실패: ${String(e)}`);
                  }
                }}
                onOpenExternalUrl={(url) => {
                  openExternalUrlInChrome(url);
                }}
                activeAudioLineIndex={activeAudioLineIndex}
                onSeekAudioTime={handleSeekAudioTime}
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
                <div
                  style={{
                    marginTop: '32px',
                    paddingTop: '16px',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <h3 style={{ marginBottom: '10px' }}>
                    🔄 연결된 양방향 백링크 ({currentDoc.backlinks.length})
                  </h3>
                  {currentDoc.backlinks.map((bl, bIdx) => (
                    <div
                      key={bIdx}
                      className="rendered-task-row"
                      style={{ cursor: 'pointer' }}
                      onClick={async () => {
                        const d = await readDocument(bl.sourcePath);
                        applyLoadedDocument(d);
                      }}
                    >
                      <span className={`role-badge ${bl.sourceRole}`}>
                        {bl.sourceRole}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700 }}>{bl.sourceTitle}</div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {bl.excerpt}
                        </div>
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
