/**
 * @file RightSidebar.tsx
 * @description 우측 접이식 사이드바 컨테이너: 아이콘 탭 바 + 폴더 트리(`<FileTreePanel />`), 전체 검색/치환, 목차(TOC), 백링크, 일자별 라이프로그, `<MobileLifelogSidebar />`.
 */
import React from 'react';
import {
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
  } = props;

  return (
    <aside
      className={`right-sidebar ${rightSidebarOpen ? '' : 'collapsed'}`}
      onMouseDown={() => setIsFolderPaneFocused(true)}
    >
      {isMobileDataSidebarMode ? (
        <MobileLifelogSidebar {...props} />
      ) : (
        <>
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${rightTab === 'tree' ? 'active' : ''}`}
              onClick={() => setRightTab('tree')}
              title="파일 트리 (Del: 휴지통 이동 | 우클릭: 메뉴)"
            >
              📂
            </button>
            <button
              className={`sidebar-tab ${rightTab === 'search' ? 'active' : ''}`}
              onClick={() => setRightTab('search')}
              title="파일에서 찾기 결과 리스트 (클릭 시 해당 위치로 이동)"
            >
              🔍
            </button>
            <button
              className={`sidebar-tab ${rightTab === 'toc' ? 'active' : ''}`}
              onClick={() => setRightTab('toc')}
              title="문서 내 목차 (TOC)"
            >
              📑
            </button>
            <button
              className={`sidebar-tab ${rightTab === 'backlinks' ? 'active' : ''}`}
              onClick={() => setRightTab('backlinks')}
              title="양방향 백링크"
            >
              🔗
            </button>
            <button
              className={`sidebar-tab ${rightTab === 'lifelog' ? 'active' : ''}`}
              onClick={() => setRightTab('lifelog')}
              title="당일 라이프로그 (금융·카톡)"
            >
              📱
            </button>
          </div>

          <div className="sidebar-content">
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
