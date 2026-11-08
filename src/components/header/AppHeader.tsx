/**
 * @file AppHeader.tsx
 * @description 상단 헤더 컨테이너: 햄버거 메뉴 토글, 액티비티 바 열기/닫기, `<MenuBar />`, `<DocTabsBar />`, 우측 사이드바 열기/닫기(`◫`) 아이콘.
 */
import React from 'react';
import { DocTabsBar, DocTabsBarProps } from './DocTabsBar';
import { MenuBar, MenuBarProps } from './MenuBar';

export interface AppHeaderProps extends MenuBarProps, DocTabsBarProps {
  setMenuBarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarOpen: boolean;
  activityBarOpen: boolean;
  setActivityBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function AppHeader(props: AppHeaderProps) {
  const {
    menuBarExpanded,
    setMenuBarExpanded,
    altPressed,
    getShortcutLabel,
    rightSidebarOpen,
    setRightSidebarOpen,
    activityBarOpen,
    setActivityBarOpen,
  } = props;

  return (
    <header className="top-menubar" onClick={(e) => e.stopPropagation()}>
      <div className="menubar-left">
        <button
          className={`hamburger-menu-btn ${menuBarExpanded ? 'active' : ''}`}
          onClick={() => setMenuBarExpanded((v) => !v)}
          title="메뉴 열기/닫기 (F10 또는 Alt)"
        >
          ☰
          {altPressed && <span className="alt-keytip-badge">F10</span>}
        </button>
        <button
          className={`hamburger-menu-btn ${activityBarOpen ? 'active' : ''}`}
          onClick={() => setActivityBarOpen((v) => !v)}
          title="왼쪽 액티비티 바 열기/닫기"
        >
          ◧
        </button>

        <MenuBar {...props} />
      </div>

      <DocTabsBar {...props} />

      <div
        className="menubar-right"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          marginLeft: 'auto',
          flexShrink: 0,
        }}
      >
        <button
          className={`hamburger-menu-btn ${rightSidebarOpen ? 'active' : ''}`}
          onClick={() => setRightSidebarOpen((v) => !v)}
          title={`오른쪽 사이드바 열기/닫기 (${
            getShortcutLabel('toggle_sidebar') || 'Ctrl+B'
          })`}
        >
          ◫
        </button>
      </div>
    </header>
  );
}
