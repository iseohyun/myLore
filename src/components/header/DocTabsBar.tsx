/**
 * @file DocTabsBar.tsx
 * @description 열린 다중 문서 및 가상 대시보드 탭 바 (`.doc-tabs-bar`), 수정 표시(`●`), 탭 닫기 및 우클릭 메뉴 연결.
 */
import React from 'react';
import { ContextMenuState, OpenDocumentTab } from '../../types/mylore';

export interface DocTabsBarProps {
  docTabsBarRef: React.MutableRefObject<HTMLDivElement | null>;
  openTabs: OpenDocumentTab[];
  activeTabPath: string | null;
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>;
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
  recordEditPosition,
  setContextMenu,
  closeTab,
}: DocTabsBarProps) {
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
        const tabTitle =
          tab.doc.frontmatter['summary'] ||
          tab.doc.frontmatter['title'] ||
          tab.doc.relativePath.split(/[\\/]/).pop() ||
          tab.doc.relativePath;
        return (
          <div
            key={tab.doc.fullPath}
            className={`doc-tab ${isActive ? 'active' : ''}`}
            data-tab-active={isActive ? 'true' : undefined}
            onClick={() => {
              setActiveTabPath(tab.doc.fullPath);
              recordEditPosition(
                tab.doc.fullPath,
                tab.cursorOffset ?? 0,
                true
              );
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
