/**
 * @file AppHeader.tsx
 * @description 상단 헤더 컨테이너: 햄버거 메뉴 토글, `<MenuBar />`, `<DocTabsBar />`, 우측 대시보드·사이드바 바로가기 아이콘.
 */
import React from 'react';
import { openExternalUrlInChrome } from '../../services/tauriClient';
import { DocTabsBar, DocTabsBarProps } from './DocTabsBar';
import { MenuBar, MenuBarProps } from './MenuBar';

export interface AppHeaderProps extends MenuBarProps, DocTabsBarProps {
  setMenuBarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  rightSidebarOpen: boolean;
}

export function AppHeader(props: AppHeaderProps) {
  const {
    menuBarExpanded,
    setMenuBarExpanded,
    altPressed,
    currentDoc,
    activeTabPath,
    handleGotoRootMainMd,
    getShortcutLabel,
    openDashboardTab,
    rightSidebarOpen,
    setRightSidebarOpen,
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
          className={`hamburger-menu-btn ${
            currentDoc?.relativePath.replace(/\\/g, '/').toLowerCase() ===
              'main.md' &&
            !activeTabPath?.startsWith('mylore://dashboard/')
              ? 'active'
              : ''
          }`}
          onClick={handleGotoRootMainMd}
          title={`프로젝트 (Projects/main.md 열기 — ${
            getShortcutLabel('dashboard_projects') || 'F6'
          })`}
        >
          📁
        </button>
        <button
          className={`hamburger-menu-btn ${
            activeTabPath === 'mylore://dashboard/lifelog' ? 'active' : ''
          }`}
          onClick={() => openDashboardTab('lifelog')}
          title={`라이프로그 대쉬보드 (${
            getShortcutLabel('dashboard_lifelog') || 'F7'
          })`}
        >
          📱
        </button>
        <button
          className={`hamburger-menu-btn ${
            activeTabPath === 'mylore://dashboard/finance' ? 'active' : ''
          }`}
          onClick={() => openDashboardTab('finance')}
          title={`금융 대쉬보드 (${
            getShortcutLabel('dashboard_finance') || 'F8'
          })`}
        >
          💳
        </button>
        <button
          className={`hamburger-menu-btn ${
            activeTabPath === 'mylore://dashboard/diary' ? 'active' : ''
          }`}
          onClick={() => openDashboardTab('diary')}
          title={`달력(일정) 대쉬보드 (${
            getShortcutLabel('dashboard_diary') || 'F9'
          })`}
        >
          🗓️
        </button>
        <button
          className="hamburger-menu-btn"
          onClick={() =>
            openExternalUrlInChrome('https://calendar.google.com')
          }
          title="구글 캘린더 열기 (https://calendar.google.com)"
        >
          📅
        </button>
        <button
          className={`hamburger-menu-btn ${
            activeTabPath === 'mylore://dashboard/settings' ? 'active' : ''
          }`}
          onClick={() => openDashboardTab('settings')}
          title={`설정 대쉬보드 (${
            getShortcutLabel('open_settings') || 'Ctrl+,'
          })`}
        >
          ⚙️
        </button>
        <button
          className={`hamburger-menu-btn ${rightSidebarOpen ? 'active' : ''}`}
          onClick={() => setRightSidebarOpen((v) => !v)}
          title={`우측 사이드바 열기/닫기 (${
            getShortcutLabel('toggle_sidebar') || 'Ctrl+B'
          })`}
        >
          ◫
        </button>
      </div>
    </header>
  );
}
