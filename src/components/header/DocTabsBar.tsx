/**
 * @file DocTabsBar.tsx
 * @description 열린 다중 문서 및 가상 대시보드 탭 바 (`.doc-tabs-bar`),
 * 일반 파일은 현재 파일 이름(`.md` 제외)만 간결하게 표시하고,
 * 에디터 2단 수평 분할 시 현재 좌/우 에디터 문서의 배경 왼쪽 50% / 오른쪽 50% 연한 색 하이라이트 표시.
 */
import React from 'react';
import { ContextMenuState, OpenDocumentTab } from '../../types/mylore';

export interface DocTabsBarProps {
  docTabsBarRef: React.MutableRefObject<HTMLDivElement | null>;
  openTabs: OpenDocumentTab[];
  activeTabPath: string | null;
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  isHorizontalSplitOpen?: boolean;
  focusedEditorPane?: 'left' | 'right';
  leftPaneTabPath?: string | null;
  setLeftPaneTabPath?: React.Dispatch<React.SetStateAction<string | null>>;
  rightPaneTabPath?: string | null;
  setRightPaneTabPath?: React.Dispatch<React.SetStateAction<string | null>>;
  rightPaneTabPaths?: string[];
  focusEditorPane?: (pane: 'left' | 'right', targetPath?: string) => void;
  restoreEditorCursorToLastPos?: (targetPath: string) => void;
  recordEditPosition: (
    path: string,
    offset: number,
    forceNewStep?: boolean
  ) => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  closeTab: (fullPath: string, e?: React.MouseEvent) => void;
}

export function DocTabsBar({
  docTabsBarRef,
  openTabs,
  activeTabPath,
  setActiveTabPath,
  isHorizontalSplitOpen = false,
  focusedEditorPane = 'left',
  leftPaneTabPath = null,
  setLeftPaneTabPath,
  rightPaneTabPath = null,
  setRightPaneTabPath,
  rightPaneTabPaths = [],
  focusEditorPane,
  restoreEditorCursorToLastPos,
  setContextMenu,
  closeTab,
}: DocTabsBarProps) {
  const effectiveLeftPath =
    leftPaneTabPath && openTabs.some((t) => t.doc.fullPath === leftPaneTabPath)
      ? leftPaneTabPath
      : (
          openTabs.find((t) => !rightPaneTabPaths.includes(t.doc.fullPath)) ||
          openTabs[0]
        )?.doc.fullPath || null;

  const effectiveRightPath =
    rightPaneTabPath && openTabs.some((t) => t.doc.fullPath === rightPaneTabPath)
      ? rightPaneTabPath
      : openTabs.find((t) => rightPaneTabPaths.includes(t.doc.fullPath))?.doc
          .fullPath ||
        effectiveLeftPath ||
        null;

  return (
    <div
      ref={docTabsBarRef}
      className="doc-tabs-bar"
      onWheel={(e) => {
        if (docTabsBarRef.current && e.deltaY !== 0) {
          docTabsBarRef.current.scrollLeft += e.deltaY;
        }
      }}
    >
      {openTabs.map((tab) => {
        const isActive = tab.doc.fullPath === activeTabPath;
        const isVirtualDashboard =
          tab.doc.fullPath.startsWith('mylore://dashboard/');
        const rawFileName =
          tab.doc.fullPath.split(/[\\/]/).pop() ||
          tab.doc.relativePath.split(/[\\/]/).pop() ||
          tab.doc.relativePath;
        const tabTitle = isVirtualDashboard
          ? tab.doc.frontmatter['title'] || tab.doc.relativePath
          : rawFileName.replace(/\.md$/i, '');

        const showSplitHalf = isHorizontalSplitOpen;
        const isLeftSplitDoc =
          showSplitHalf && tab.doc.fullPath === effectiveLeftPath;
        const isRightSplitDoc =
          showSplitHalf && tab.doc.fullPath === effectiveRightPath;

        let splitHighlightClass = '';
        if (isLeftSplitDoc && isRightSplitDoc) {
          splitHighlightClass =
            focusedEditorPane === 'right'
              ? 'split-half-both focus-right'
              : 'split-half-both focus-left';
        } else if (isLeftSplitDoc) {
          splitHighlightClass = `split-half-left ${
            focusedEditorPane === 'left' ? 'pane-focused' : ''
          }`;
        } else if (isRightSplitDoc) {
          splitHighlightClass = `split-half-right ${
            focusedEditorPane === 'right' ? 'pane-focused' : ''
          }`;
        }

        const tabActiveClass = showSplitHalf
          ? isLeftSplitDoc || isRightSplitDoc
            ? 'split-active'
            : ''
          : isActive
            ? 'active'
            : '';

        return (
          <div
            key={tab.doc.fullPath}
            className={`doc-tab ${tabActiveClass} ${splitHighlightClass}`.trim()}
            data-tab-active={
              isActive || isLeftSplitDoc || isRightSplitDoc ? 'true' : undefined
            }
            onClick={() => {
              if (isHorizontalSplitOpen) {
                if (rightPaneTabPaths.includes(tab.doc.fullPath)) {
                  setRightPaneTabPath?.(tab.doc.fullPath);
                  focusEditorPane?.('right', tab.doc.fullPath);
                } else {
                  setLeftPaneTabPath?.(tab.doc.fullPath);
                  focusEditorPane?.('left', tab.doc.fullPath);
                }
              } else {
                setActiveTabPath(tab.doc.fullPath);
              }
              if (!isVirtualDashboard) {
                restoreEditorCursorToLastPos?.(tab.doc.fullPath);
              }
            }}
            onContextMenu={(e) => {
              if (isVirtualDashboard) return;
              e.preventDefault();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                targetPath: tab.doc.fullPath,
                targetUuid: tab.doc.uuid,
                targetName: tabTitle,
              });
            }}
            title={
              isVirtualDashboard
                ? `${tabTitle} 대쉬보드 탭`
                : isLeftSplitDoc && isRightSplitDoc
                  ? `${tab.doc.fullPath} (왼쪽·오른쪽 에디터 열람 중)`
                  : isLeftSplitDoc
                    ? `${tab.doc.fullPath} (왼쪽 에디터 열람 중)`
                    : isRightSplitDoc
                      ? `${tab.doc.fullPath} (오른쪽 에디터 열람 중)`
                      : `${tab.doc.fullPath} (우클릭: 탐색기에서 보기)`
            }
          >
            <span className="doc-tab-title">{tabTitle}</span>
            {tab.isDirty && <span className="doc-tab-dirty">●</span>}
            <button
              className="doc-tab-close"
              onClick={(e) => closeTab(tab.doc.fullPath, e)}
              title="탭 닫기"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
