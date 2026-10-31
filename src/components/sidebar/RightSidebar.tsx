/**
 * @file RightSidebar.tsx
 * @description 우측 접이식 사이드바 컨테이너: 아이콘 탭 바 + 폴더 트리(`<FileTreePanel />`), 전체 검색/치환, 목차(TOC), 백링크, 일자별 라이프로그, `<MobileLifelogSidebar />`.
 */
import React, { useRef, useState } from 'react';
import {
  BaseFolderRole,
  DocumentPayload,
  FinanceTransaction,
  LifelogMessage,
  RightSidebarTab,
  SearchMatchItem,
  TocHeading,
} from '../../types/mylore';
import { readDocument, replaceInFiles } from '../../services/tauriClient';
import { FileTreePanel, FileTreePanelProps } from './FileTreePanel';
import {
  MobileLifelogSidebar,
  MobileLifelogSidebarProps,
} from './MobileLifelogSidebar';

export interface RightSidebarProps
  extends FileTreePanelProps,
    MobileLifelogSidebarProps {
  rightSidebarOpen: boolean;
  isMobileDataSidebarMode: boolean;
  rightTab: RightSidebarTab;
  setRightTab: React.Dispatch<React.SetStateAction<RightSidebarTab>>;
  globalSearchQuery: string;
  setGlobalSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  executeGlobalSearch: () => Promise<void>;
  globalReplaceMode: boolean;
  globalReplaceText: string;
  setGlobalReplaceText: React.Dispatch<React.SetStateAction<string>>;
  globalSearchResults: SearchMatchItem[];
  activeSearchIdx: number;
  setActiveSearchIdx: React.Dispatch<React.SetStateAction<number>>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
  tocHeadings: TocHeading[];
  selectedDate: string;
  setSelectedDate: React.Dispatch<React.SetStateAction<string>>;
  loadLifelogForDate: (dateStr: string) => Promise<void>;
  dailyTransactions: FinanceTransaction[];
  dailyMessages: LifelogMessage[];
  insertIntoBody: (snippet: string) => void;
}

export function RightSidebar(props: RightSidebarProps) {
  const {
    rightSidebarOpen,
    setIsFolderPaneFocused,
    isMobileDataSidebarMode,
    rightTab,
    setRightTab,
    globalSearchQuery,
    setGlobalSearchQuery,
    executeGlobalSearch,
    globalReplaceMode,
    globalReplaceText,
    setGlobalReplaceText,
    setStatusMessage,
    globalSearchResults,
    activeSearchIdx,
    setActiveSearchIdx,
    applyLoadedDocument,
    setContextMenu,
    tocHeadings,
    currentDoc,
    selectedDate,
    setSelectedDate,
    loadLifelogForDate,
    dailyTransactions,
    dailyMessages,
    insertIntoBody,
    activeTreeRoleTab,
    setActiveTreeRoleTab,
    handleMoveRole,
    baseFolders,
  } = props;

  const [dragOverRoleTab, setDragOverRoleTab] = useState<BaseFolderRole | null>(
    null
  );
  const hoverSwitchTimerRef = useRef<number | null>(null);

  const clearHoverSwitchTimer = () => {
    if (hoverSwitchTimerRef.current !== null) {
      window.clearTimeout(hoverSwitchTimerRef.current);
      hoverSwitchTimerRef.current = null;
    }
  };

  return (
    <aside
      className={`right-sidebar ${rightSidebarOpen ? '' : 'collapsed'}`}
      onMouseDown={() => setIsFolderPaneFocused(true)}
    >
      {isMobileDataSidebarMode ? (
        <MobileLifelogSidebar {...props} />
      ) : (
        <>
          <div className="sidebar-tabs sidebar-role-tabs">
            {(
              [
                {
                  key: 'projects',
                  label: '프로젝트',
                  title:
                    '⭐ 프로젝트 파일 트리 (클릭: 전환 | 파일을 이 탭으로 드래그하여 프로젝트 루트로 이동)',
                },
                {
                  key: 'diary',
                  label: '일기',
                  title:
                    '📅 일기 파일 트리 (클릭: 전환 | 파일을 이 탭으로 드래그하여 일기 폴더로 이동)',
                },
                {
                  key: 'data',
                  label: '아카이브',
                  title:
                    '🗄️ 아카이브 파일 트리 (클릭: 전환 | 파일을 이 탭으로 드래그하여 아카이브 루트로 이동)',
                },
                {
                  key: 'git',
                  label: 'Git',
                  title:
                    '💻 Git 파일 트리 (클릭: 전환 | 파일을 이 탭으로 드래그하여 Git 루트로 이동)',
                },
              ] as const
            ).map((t) => {
              const isTabActive =
                rightTab === 'tree' && activeTreeRoleTab === t.key;
              const isDragTarget = dragOverRoleTab === t.key;
              return (
                <button
                  key={t.key}
                  className={`sidebar-tab sidebar-role-tab ${isTabActive ? 'active' : ''} ${isDragTarget ? 'drag-over' : ''}`}
                  onClick={() => {
                    setRightTab('tree');
                    setActiveTreeRoleTab(t.key);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setRightTab('tree');
                    setActiveTreeRoleTab(t.key);
                    const basePath =
                      baseFolders.find((b) => b.role === t.key && b.enabled)
                        ?.path ||
                      baseFolders.find((b) => b.role === t.key)?.path ||
                      '';
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      targetPath: basePath,
                      targetName: t.label,
                      isDirectory: true,
                      folderRole: t.key,
                      folderSubDir: '',
                    });
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverRoleTab !== t.key) {
                      setDragOverRoleTab(t.key);
                      clearHoverSwitchTimer();
                      hoverSwitchTimerRef.current = window.setTimeout(() => {
                        setRightTab('tree');
                        setActiveTreeRoleTab(t.key);
                      }, 380);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverRoleTab === t.key) {
                      setDragOverRoleTab(null);
                    }
                    clearHoverSwitchTimer();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverRoleTab(null);
                    clearHoverSwitchTimer();
                    const srcPath =
                      e.dataTransfer.getData('application/x-mylore-filepath') ||
                      e.dataTransfer.getData('text/plain');
                    if (srcPath) {
                      setRightTab('tree');
                      setActiveTreeRoleTab(t.key);
                      void handleMoveRole(t.key, srcPath, '');
                    }
                  }}
                  title={t.title}
                >
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="sidebar-content">
            {rightTab !== 'tree' && (
              <div className="sidebar-special-panel-header">
                <span>
                  {rightTab === 'search'
                    ? '🔍 파일에서 찾기 (Ctrl+Shift+F)'
                    : rightTab === 'toc'
                      ? '📑 문서 내 목차 (Ctrl+1)'
                      : rightTab === 'backlinks'
                        ? '🔗 양방향 백링크 (Ctrl+2)'
                        : '📱 당일 라이프로그'}
                </span>
                <button
                  type="button"
                  className="toolbar-btn sidebar-special-close-btn"
                  onClick={() => setRightTab('tree')}
                  title="파일 트리로 돌아가기"
                >
                  ✕ 닫기
                </button>
              </div>
            )}
            {rightTab === 'tree' && <FileTreePanel {...props} />}

            {rightTab === 'search' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    autoFocus
                    className="input-field"
                    placeholder="전체 파일에서 검색할 키워드..."
                    value={globalSearchQuery}
                    onChange={(e) => setGlobalSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') executeGlobalSearch();
                    }}
                  />
                  <button
                    className="toolbar-btn primary"
                    onClick={() => executeGlobalSearch()}
                  >
                    검색
                  </button>
                </div>

                {globalReplaceMode && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      className="input-field"
                      placeholder="바꿀 문자열..."
                      value={globalReplaceText}
                      onChange={(e) => setGlobalReplaceText(e.target.value)}
                    />
                    <button
                      className="toolbar-btn"
                      onClick={async () => {
                        if (!globalSearchQuery.trim()) return;
                        const count = await replaceInFiles(
                          globalSearchQuery,
                          globalReplaceText
                        );
                        await executeGlobalSearch();
                        setStatusMessage(
                          `🔄 전체 파일 바꾸기 완료: 총 ${count}개 문서가 수정되었습니다.`
                        );
                      }}
                    >
                      일괄 바꾸기
                    </button>
                  </div>
                )}

                <div
                  style={{
                    fontSize: '11.5px',
                    color: 'var(--text-secondary)',
                    marginTop: '4px',
                  }}
                >
                  검색 결과 ({globalSearchResults.length}건) — 항목 클릭 시 해당 위치로 이동
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {globalSearchResults.map((item, idx) => (
                    <div
                      key={`${item.fullPath}-${item.lineNumber}-${idx}`}
                      className={`tree-node-row ${
                        idx === activeSearchIdx ? 'active' : ''
                      }`}
                      style={{
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '2px',
                      }}
                      onClick={async () => {
                        setActiveSearchIdx(idx);
                        const doc = await readDocument(item.fullPath);
                        applyLoadedDocument(doc, {
                          lineNumber: item.lineNumber,
                          charOffset: item.charOffset,
                          highlightLength: globalSearchQuery.length,
                        });
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          targetPath: item.fullPath,
                          targetName: item.relativePath,
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
                          color: '#a5b4fc',
                        }}
                      >
                        <span>{item.relativePath}</span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>
                          :{item.lineNumber}행
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-primary)',
                          width: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.lineText}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rightTab === 'toc' && (
              <div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginBottom: '8px',
                  }}
                >
                  문서 내 목차 ({tocHeadings.length})
                </div>
                {tocHeadings.map((h, i) => (
                  <div
                    key={i}
                    className="tree-node-row"
                    style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
                    onClick={() => {
                      if (currentDoc) {
                        applyLoadedDocument(currentDoc, {
                          lineNumber: h.lineIndex + 1,
                        });
                      }
                    }}
                  >
                    <span>{h.text}</span>
                  </div>
                ))}
              </div>
            )}

            {rightTab === 'backlinks' && (
              <div>
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginBottom: '8px',
                  }}
                >
                  양방향 백링크 ({currentDoc?.backlinks.length || 0})
                </div>
                {currentDoc?.backlinks.map((bl, idx) => (
                  <div
                    key={idx}
                    className="tree-node-row"
                    onClick={async () => {
                      const doc = await readDocument(bl.sourcePath);
                      applyLoadedDocument(doc);
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{bl.sourceTitle}</div>
                      <div
                        style={{
                          fontSize: '11.5px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {bl.excerpt}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rightTab === 'lifelog' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="date"
                  className="input-field"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    loadLifelogForDate(e.target.value);
                  }}
                />
                <div>
                  <div className="tree-group-header">
                    <span>💳 당일 금융 내역</span>
                    <span>{dailyTransactions.length}건</span>
                  </div>
                  {dailyTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="tree-node-row"
                      onClick={() =>
                        insertIntoBody(
                          `- 💳 [${tx.txTime}] **${tx.merchant}** (${tx.amount.toLocaleString()}원, ${tx.institution})`
                        )
                      }
                    >
                      <span>
                        {tx.merchant} ({tx.amount.toLocaleString()}원)
                      </span>
                      <span style={{ fontSize: '11px', color: '#a5b4fc' }}>
                        +삽입
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="tree-group-header">
                    <span>💬 당일 카톡 / 문자</span>
                    <span>{dailyMessages.length}건</span>
                  </div>
                  {dailyMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className="tree-node-row"
                      onClick={() =>
                        insertIntoBody(
                          `> 💬 **[${msg.roomOrSender} - ${msg.sender}] (${msg.sentTime})**: ${msg.message}`
                        )
                      }
                    >
                      <div className="tree-node-label">
                        <span>
                          [{msg.sender}] {msg.message}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
