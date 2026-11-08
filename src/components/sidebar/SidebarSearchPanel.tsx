/**
 * @file SidebarSearchPanel.tsx
 * @description 우측 사이드바 상단에 선택적으로 표시되는 문서 내 찾기/바꾸기(`Ctrl+F`/`Ctrl+H`) 및 모든 파일에서 찾기/바꾸기(`Ctrl+Alt+Shift+F`) 통합 패널.
 * - 정규식(`$1`, `$2`, `$&`, `\1`) 및 이스케이프(`\n`, `\t`) 패턴 치환과 첫 서치대상 실시간 미리보기 제공
 * - `순환` 체크박스 옵션 및 대상 없을 시 2초간 `"대상이 없습니다"` 토스트 알림 표시
 * - 찾기/바꾸기 입력창 내 단축키 지원:
 *   · `Enter` / `Shift+Enter`: 다음/이전 찾기로 이동 및 에디터 선택 하이라이트 (커서는 입력창 유지)
 *   · `Ctrl+Enter`: 현재 찾은 단어 바꾸기 적용 후 즉시 다음 찾은 단어로 이동 및 선택
 *   · `Ctrl+A`: 모두 바꾸기(모두 적용) 즉시 실행
 */
import React, { useEffect, useRef } from 'react';
import {
  DocumentPayload,
  OpenDocumentTab,
  RightSidebarTab,
  SearchMatchItem,
  ContextMenuState,
} from '../../types/mylore';
import { readDocument, replaceInFiles } from '../../services/tauriClient';
import {
  applyPatternReplace,
  SearchFocusRequest,
} from '../../hooks/useEditorCommands';

export interface SidebarSearchPanelProps {
  rightTab: RightSidebarTab;
  setRightTab: React.Dispatch<React.SetStateAction<RightSidebarTab>>;
  findBarMode?: 'closed' | 'find' | 'replace';
  setFindBarMode?: React.Dispatch<
    React.SetStateAction<'closed' | 'find' | 'replace'>
  >;
  docFindQuery?: string;
  setDocFindQuery?: React.Dispatch<React.SetStateAction<string>>;
  docReplaceText?: string;
  setDocReplaceText?: React.Dispatch<React.SetStateAction<string>>;
  docFindUseRegex?: boolean;
  setDocFindUseRegex?: React.Dispatch<React.SetStateAction<boolean>>;
  docReplaceUseEscape?: boolean;
  setDocReplaceUseEscape?: React.Dispatch<React.SetStateAction<boolean>>;
  docFindMatches?: Array<{
    start: number;
    end: number;
    lineNumber: number;
    lineText: string;
  }>;
  selectMatchInEditor?: (
    start: number,
    end: number,
    focusEditor?: boolean
  ) => void;
  handleJumpSearchMatch?: (dir: 1 | -1) => Promise<void>;
  handleReplaceCurrentInDoc?: () => void;
  handleReplaceAllInDoc?: () => void;
  searchWrapAround?: boolean;
  setSearchWrapAround?: React.Dispatch<React.SetStateAction<boolean>>;
  searchNoMatchToast?: string | null;
  triggerNoMatchToast?: (msg?: string) => void;
  globalSearchQuery: string;
  setGlobalSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  executeGlobalSearch: (
    q?: string,
    useRegexOverride?: boolean
  ) => Promise<void>;
  globalReplaceMode: boolean;
  setGlobalReplaceMode?: React.Dispatch<React.SetStateAction<boolean>>;
  globalReplaceText: string;
  setGlobalReplaceText: React.Dispatch<React.SetStateAction<string>>;
  globalSearchUseRegex?: boolean;
  setGlobalSearchUseRegex?: React.Dispatch<React.SetStateAction<boolean>>;
  globalReplaceUseEscape?: boolean;
  setGlobalReplaceUseEscape?: React.Dispatch<React.SetStateAction<boolean>>;
  globalSearchResults: SearchMatchItem[];
  activeSearchIdx: number;
  setActiveSearchIdx: React.Dispatch<React.SetStateAction<number>>;
  searchFocusRequest?: SearchFocusRequest | null;
  openDocFindPanel?: (mode?: 'find' | 'replace') => void;
  openGlobalSearchPanel?: () => void;
  openTabs?: OpenDocumentTab[];
  setOpenTabs?: React.Dispatch<React.SetStateAction<OpenDocumentTab[]>>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function SidebarSearchPanel(props: SidebarSearchPanelProps) {
  const {
    rightTab,
    setRightTab,
    findBarMode = 'closed',
    setFindBarMode,
    docFindQuery = '',
    setDocFindQuery,
    docReplaceText = '',
    setDocReplaceText,
    docFindUseRegex = false,
    setDocFindUseRegex,
    docReplaceUseEscape = true,
    setDocReplaceUseEscape,
    docFindMatches = [],
    selectMatchInEditor,
    handleJumpSearchMatch,
    handleReplaceCurrentInDoc,
    handleReplaceAllInDoc,
    searchWrapAround = true,
    setSearchWrapAround,
    searchNoMatchToast = null,
    triggerNoMatchToast,
    globalSearchQuery,
    setGlobalSearchQuery,
    executeGlobalSearch,
    globalReplaceText,
    setGlobalReplaceText,
    globalSearchUseRegex = false,
    setGlobalSearchUseRegex,
    globalReplaceUseEscape = true,
    setGlobalReplaceUseEscape,
    globalSearchResults,
    activeSearchIdx,
    setActiveSearchIdx,
    searchFocusRequest,
    openDocFindPanel,
    openGlobalSearchPanel,
    openTabs,
    setOpenTabs,
    applyLoadedDocument,
    setContextMenu,
    setStatusMessage,
  } = props;

  const docFindInputRef = useRef<HTMLInputElement | null>(null);
  const docReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const globalFindInputRef = useRef<HTMLInputElement | null>(null);

  const isDocSearchOpen = findBarMode !== 'closed';
  const isGlobalSearchOpen = rightTab === 'search';
  const isSearchPanelVisible = isDocSearchOpen || isGlobalSearchOpen;

  // 단축키(Ctrl+F / Ctrl+H / Ctrl+Alt+Shift+F) 또는 메뉴 호출 시 해당 입력창에 즉시 커서 포커스 및 선택
  useEffect(() => {
    if (!searchFocusRequest) return;
    const timer = window.setTimeout(() => {
      if (searchFocusRequest.target === 'doc_find') {
        docFindInputRef.current?.focus();
        docFindInputRef.current?.select();
      } else if (searchFocusRequest.target === 'doc_replace') {
        docReplaceInputRef.current?.focus();
        docReplaceInputRef.current?.select();
      } else if (searchFocusRequest.target === 'global_find') {
        globalFindInputRef.current?.focus();
        globalFindInputRef.current?.select();
      }
    }, 20);
    return () => window.clearTimeout(timer);
  }, [searchFocusRequest]);

  // 모든 파일에서 찾기 모드에서 검색어/정규식 변경 시 자동 검색 수행 (첫 서치대상 미리보기 즉시 갱신)
  useEffect(() => {
    if (!isGlobalSearchOpen) return;
    const trimmed = globalSearchQuery.trim();
    if (!trimmed) return;
    const timer = window.setTimeout(() => {
      void executeGlobalSearch(trimmed, globalSearchUseRegex);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isGlobalSearchOpen, globalSearchQuery, globalSearchUseRegex]);

  if (!isSearchPanelVisible) return null;

  const isGlobalMode = isGlobalSearchOpen && !isDocSearchOpen;

  // 첫 번째 검색 대상에 대한 바꾸기 미리보기 계산
  const firstGlobalMatch = globalSearchResults[0] || null;
  const globalPreviewAfter = firstGlobalMatch
    ? applyPatternReplace(
        firstGlobalMatch.lineText,
        globalSearchQuery,
        globalReplaceText,
        globalSearchUseRegex,
        globalReplaceUseEscape,
        true
      )
    : '';

  const firstDocMatch = docFindMatches[0] || null;
  const docPreviewAfter = firstDocMatch
    ? applyPatternReplace(
        firstDocMatch.lineText,
        docFindQuery,
        docReplaceText,
        docFindUseRegex,
        docReplaceUseEscape,
        false
      )
    : '';

  const handleGlobalReplaceAll = async () => {
    if (!globalSearchQuery.trim() || globalSearchResults.length === 0) {
      triggerNoMatchToast?.('대상이 없습니다');
      return;
    }
    const count = await replaceInFiles(
      globalSearchQuery,
      globalReplaceText,
      globalSearchUseRegex,
      globalReplaceUseEscape
    );
    if (count === 0) {
      triggerNoMatchToast?.('대상이 없습니다');
      return;
    }
    if (openTabs && setOpenTabs && count > 0) {
      setOpenTabs((prev) =>
        prev.map((tab) => {
          if (tab.doc.fullPath.startsWith('mylore://dashboard/')) {
            return tab;
          }
          const updated = applyPatternReplace(
            tab.bodyText,
            globalSearchQuery,
            globalReplaceText,
            globalSearchUseRegex,
            globalReplaceUseEscape,
            true
          );
          if (updated === tab.bodyText) return tab;
          return { ...tab, bodyText: updated };
        })
      );
    }
    await executeGlobalSearch();
    setStatusMessage(
      `🔄 모든 파일 바꾸기 완료: 총 ${count}개 문서가 수정되었습니다.`
    );
  };

  return (
    <div className="sidebar-search-panel">
      <div className="sidebar-search-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            className={`toolbar-btn ${!isGlobalMode ? 'primary' : ''}`}
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => {
              if (openDocFindPanel) openDocFindPanel('find');
              else {
                setRightTab('tree');
                setFindBarMode?.('find');
              }
            }}
            title="현재 문서 내 찾기 (Ctrl+F)"
          >
            📄 문서 내 찾기
          </button>
          <button
            type="button"
            className={`toolbar-btn ${isGlobalMode ? 'primary' : ''}`}
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => {
              if (openGlobalSearchPanel) openGlobalSearchPanel();
              else {
                setFindBarMode?.('closed');
                setRightTab('search');
              }
            }}
            title="모든 파일에서 찾기 / 바꾸기 (Ctrl+Alt+Shift+F)"
          >
            🌐 모든 파일 찾기
          </button>
        </div>
        <button
          type="button"
          className="toolbar-btn"
          style={{ padding: '2px 6px', fontSize: '11px' }}
          onClick={() => {
            setFindBarMode?.('closed');
            if (rightTab === 'search') setRightTab('tree');
          }}
          title="찾기 패널 닫기 (Esc)"
        >
          ✕
        </button>
      </div>

      {/* 정규식, 이스케이프(\n, \t), 순환 체크박스 옵션 바 */}
      <div className="sidebar-search-options-row">
        <label
          className="sidebar-search-checkbox-label"
          title="정규식(Regular Expression) 및 캡처 그룹($1, $2, $&, \1) 사용"
        >
          <input
            type="checkbox"
            checked={isGlobalMode ? globalSearchUseRegex : docFindUseRegex}
            onChange={(e) => {
              const next = e.target.checked;
              if (isGlobalMode) {
                setGlobalSearchUseRegex?.(next);
                if (globalSearchQuery.trim()) {
                  void executeGlobalSearch(globalSearchQuery, next);
                }
              } else {
                setDocFindUseRegex?.(next);
              }
            }}
          />
          <span>.* 정규식</span>
        </label>
        <label
          className="sidebar-search-checkbox-label"
          title="바꾸기 문자열에서 이스케이프 문자(\n 줄바꿈, \t 탭, \\) 변환 사용 (기본 선택)"
        >
          <input
            type="checkbox"
            checked={
              isGlobalMode ? globalReplaceUseEscape : docReplaceUseEscape
            }
            onChange={(e) => {
              const next = e.target.checked;
              if (isGlobalMode) setGlobalReplaceUseEscape?.(next);
              else setDocReplaceUseEscape?.(next);
            }}
          />
          <span>\n·\t 이스케이프</span>
        </label>
        <label
          className="sidebar-search-checkbox-label"
          title="마지막 찾기 대상에서 첫 번째 대상으로 순환 이동 (해제 시 끝에서 '대상이 없습니다' 알림 표시)"
        >
          <input
            type="checkbox"
            checked={searchWrapAround}
            onChange={(e) => setSearchWrapAround?.(e.target.checked)}
          />
          <span>🔁 순환</span>
        </label>
        <span
          className="sidebar-search-pattern-hint"
          title="Enter: 다음 이동 · Ctrl+Enter: 바꾸기 후 다음 이동 · Ctrl+A: 모두 적용"
        >
          패턴: $1·\n
        </span>
      </div>

      {/* 2초간 나타났다가 사라지는 '대상이 없습니다' 알림 */}
      {searchNoMatchToast && (
        <div className="search-no-match-toast" role="status">
          ⚠️ {searchNoMatchToast}
        </div>
      )}

      {!isGlobalMode ? (
        /* Ctrl+F / Ctrl+H: 현재 문서 내 찾기/바꾸기 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              ref={docFindInputRef}
              autoFocus={findBarMode === 'find'}
              className="input-field"
              style={{ fontSize: '12px', padding: '5px 8px' }}
              placeholder={
                docFindUseRegex
                  ? '문서 내 정규식 검색 (Enter: 다음, Ctrl+Enter: 바꾸기, Ctrl+A: 모두)'
                  : '현재 문서 내 검색어 입력 (Enter: 다음, Ctrl+A: 모두 적용)...'
              }
              value={docFindQuery}
              onChange={(e) => setDocFindQuery?.(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.ctrlKey &&
                  !e.altKey &&
                  !e.shiftKey &&
                  e.key.toLowerCase() === 'a'
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleReplaceAllInDoc?.();
                } else if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleReplaceCurrentInDoc?.();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleJumpSearchMatch?.(e.shiftKey ? -1 : 1);
                } else if (e.key === 'Escape') {
                  setFindBarMode?.('closed');
                }
              }}
            />
            <button
              type="button"
              className="toolbar-btn"
              style={{ padding: '4px 7px', fontSize: '11.5px' }}
              onClick={() => void handleJumpSearchMatch?.(-1)}
              title="이전 일치 항목 (Shift+Enter)"
            >
              ↑
            </button>
            <button
              type="button"
              className="toolbar-btn"
              style={{ padding: '4px 7px', fontSize: '11.5px' }}
              onClick={() => void handleJumpSearchMatch?.(1)}
              title="다음 일치 항목 (Enter)"
            >
              ↓
            </button>
            <button
              type="button"
              className={`toolbar-btn ${
                findBarMode === 'replace' ? 'primary' : ''
              }`}
              style={{ padding: '4px 7px', fontSize: '11px' }}
              onClick={() => {
                const nextMode = findBarMode === 'replace' ? 'find' : 'replace';
                if (openDocFindPanel) openDocFindPanel(nextMode);
                else setFindBarMode?.(nextMode);
              }}
              title="바꾸기 입력창 펼치기/접기 (Ctrl+H)"
            >
              ⇄
            </button>
          </div>

          {findBarMode === 'replace' && (
            <>
              <div style={{ display: 'flex', gap: '4px' }}>
                <input
                  ref={docReplaceInputRef}
                  autoFocus
                  className="input-field"
                  style={{ fontSize: '12px', padding: '5px 8px' }}
                  placeholder="바꿀 문자열 (Ctrl+Enter: 바꾸기·다음, Ctrl+A: 모두)..."
                  value={docReplaceText}
                  onChange={(e) => setDocReplaceText?.(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.ctrlKey &&
                      !e.altKey &&
                      !e.shiftKey &&
                      e.key.toLowerCase() === 'a'
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      handleReplaceAllInDoc?.();
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleReplaceCurrentInDoc?.();
                    } else if (e.key === 'Escape') {
                      setFindBarMode?.('closed');
                    }
                  }}
                />
                <button
                  type="button"
                  className="toolbar-btn"
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => handleReplaceCurrentInDoc?.()}
                  title="현재 항목 바꾸기 후 다음 항목 선택 (Ctrl+Enter)"
                >
                  바꾸기
                </button>
                <button
                  type="button"
                  className="toolbar-btn primary"
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => handleReplaceAllInDoc?.()}
                  title="모두 바꾸기 / 모두 적용 (Ctrl+A)"
                >
                  모두
                </button>
              </div>

              {firstDocMatch && (
                <div className="replace-preview-box">
                  <div className="replace-preview-title">
                    🔍 바꾸기 미리보기 (첫 서치대상 · :{firstDocMatch.lineNumber}행)
                  </div>
                  <div className="replace-preview-line before">
                    <span className="replace-preview-tag">전</span>
                    <span className="replace-preview-text">
                      {firstDocMatch.lineText}
                    </span>
                  </div>
                  <div className="replace-preview-line after">
                    <span className="replace-preview-tag">후</span>
                    <span className="replace-preview-text">
                      {docPreviewAfter}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            문서 내 일치 결과 ({docFindMatches.length}건)
          </div>
          {docFindMatches.length > 0 && (
            <div
              style={{
                maxHeight: '160px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
              }}
            >
              {docFindMatches.slice(0, 80).map((m, idx) => (
                <div
                  key={`${m.lineNumber}-${m.start}-${idx}`}
                  className="tree-node-row"
                  style={{
                    padding: '4px 8px',
                    fontSize: '11.5px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '6px',
                  }}
                  onClick={() => selectMatchInEditor?.(m.start, m.end, true)}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.lineText}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10.5px',
                      color: '#a5b4fc',
                      flexShrink: 0,
                    }}
                  >
                    :{m.lineNumber}행
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Ctrl+Alt+Shift+F: 모든 파일에서 찾기 및 바꾸기 통합 인터페이스 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              ref={globalFindInputRef}
              autoFocus
              className="input-field"
              style={{ fontSize: '12px', padding: '5px 8px' }}
              placeholder={
                globalSearchUseRegex
                  ? '모든 파일 정규식 검색 (Enter: 다음 이동, Ctrl+A: 모두 적용)'
                  : '모든 파일에서 검색할 키워드 (Enter: 다음, Ctrl+A: 모두 적용)...'
              }
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              onKeyDown={async (e) => {
                if (
                  e.ctrlKey &&
                  !e.altKey &&
                  !e.shiftKey &&
                  e.key.toLowerCase() === 'a'
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  await handleGlobalReplaceAll();
                } else if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  await handleGlobalReplaceAll();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (globalSearchResults.length > 0) {
                    await handleJumpSearchMatch?.(e.shiftKey ? -1 : 1);
                    window.setTimeout(() => {
                      globalFindInputRef.current?.focus();
                    }, 20);
                  } else {
                    await executeGlobalSearch();
                    if (globalSearchResults.length === 0) {
                      triggerNoMatchToast?.('대상이 없습니다');
                    }
                  }
                } else if (e.key === 'Escape') {
                  setRightTab('tree');
                }
              }}
            />
            <button
              type="button"
              className="toolbar-btn primary"
              style={{
                padding: '4px 10px',
                fontSize: '11.5px',
                whiteSpace: 'nowrap',
              }}
              onClick={() => void executeGlobalSearch()}
            >
              찾기
            </button>
          </div>

          {/* 바꾸기 입력창 및 일괄 바꾸기 버튼 기본 제공 */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              className="input-field"
              style={{ fontSize: '12px', padding: '5px 8px' }}
              placeholder="바꿀 문자열 (패턴: $1, $2, $&, \n, \t · Ctrl+A: 일괄 바꾸기)..."
              value={globalReplaceText}
              onChange={(e) => setGlobalReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.ctrlKey &&
                  !e.altKey &&
                  !e.shiftKey &&
                  e.key.toLowerCase() === 'a'
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleGlobalReplaceAll();
                } else if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleGlobalReplaceAll();
                } else if (e.key === 'Escape') {
                  setRightTab('tree');
                }
              }}
            />
            <button
              type="button"
              className="toolbar-btn primary"
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                whiteSpace: 'nowrap',
              }}
              onClick={() => void handleGlobalReplaceAll()}
              title="모든 파일 일괄 바꾸기 (Ctrl+A)"
            >
              일괄 바꾸기
            </button>
          </div>

          {/* 바꾸기 미리보기 (첫 서치대상) */}
          <div className="replace-preview-box">
            <div className="replace-preview-title">
              🔍 바꾸기 미리보기 (첫 서치대상
              {firstGlobalMatch
                ? ` · ${firstGlobalMatch.relativePath}:${firstGlobalMatch.lineNumber}행`
                : ''}
              )
            </div>
            {firstGlobalMatch ? (
              <>
                <div className="replace-preview-line before">
                  <span className="replace-preview-tag">전</span>
                  <span className="replace-preview-text">
                    {firstGlobalMatch.lineText}
                  </span>
                </div>
                <div className="replace-preview-line after">
                  <span className="replace-preview-tag">후</span>
                  <span className="replace-preview-text">
                    {globalPreviewAfter}
                  </span>
                </div>
              </>
            ) : (
              <div className="replace-preview-empty">
                검색 결과가 있을 때 첫 번째 대상의 바꾸기 미리보기가 표시됩니다.
              </div>
            )}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            모든 파일 검색 결과 ({globalSearchResults.length}건)
          </div>
          {globalSearchResults.length > 0 && (
            <div
              style={{
                maxHeight: '200px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
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
                    padding: '5px 8px',
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
                      fontSize: '11px',
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
                      fontSize: '11.5px',
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
          )}
        </div>
      )}
    </div>
  );
}
