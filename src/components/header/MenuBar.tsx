/**
 * @file MenuBar.tsx
 * @description VSCode 스타일 7대 상단 드롭다운 메뉴바 (파일·편집·선택·보기·이동·실행·대시보드) 및 `Alt` 니모닉 배지.
 */
import React from 'react';
import {
  BaseFolderRole,
  DocumentPayload,
  MyLoreAppSettings,
  PaletteMode,
  RightSidebarTab,
  VaultTemplateItem,
  ViewMode,
} from '../../types/mylore';
import {
  getVaultTemplates,
  openInChromeAppMode,
} from '../../services/tauriClient';

export interface MenuBarProps {
  menuBarExpanded: boolean;
  activeMenu: string | null;
  setActiveMenu: React.Dispatch<React.SetStateAction<string | null>>;
  activeSubMenu: string | null;
  setActiveSubMenu: React.Dispatch<React.SetStateAction<string | null>>;
  altPressed: boolean;
  getShortcutLabel: (id: string) => string;
  setNewDocRole: React.Dispatch<React.SetStateAction<BaseFolderRole>>;
  setNewDocTemplate: React.Dispatch<React.SetStateAction<string>>;
  setNewDocModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCalendarModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateTempMemo: () => void;
  handleOpenNativeFile: () => void;
  handleOpenNativeFolder: () => void;
  handleOpenRenameDocModal: () => void;
  handleSaveCurrentDoc: () => void;
  autoSaveEnabled: boolean;
  handleUpdateAppSettings: (patch: Partial<MyLoreAppSettings>) => Promise<void>;
  openDashboardTab: (
    dashType: 'lifelog' | 'finance' | 'diary' | 'settings' | 'logs'
  ) => void;
  setShortcutsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleEditorUndo: () => void;
  handleEditorRedo: () => void;
  handleEditorCut: () => void;
  handleEditorCopy: () => void;
  handleEditorPaste: () => void;
  setFindBarMode: React.Dispatch<
    React.SetStateAction<'closed' | 'find' | 'replace'>
  >;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRightTab: React.Dispatch<React.SetStateAction<RightSidebarTab>>;
  setGlobalReplaceMode: React.Dispatch<React.SetStateAction<boolean>>;
  handleSelectAll: () => void;
  handleMoveLine: (dir: 'up' | 'down') => void;
  handleAddCursorVertical: (dir: 'up' | 'down') => void;
  setPaletteMode: React.Dispatch<React.SetStateAction<PaletteMode>>;
  setPaletteQuery: React.Dispatch<React.SetStateAction<string>>;
  appSettings: MyLoreAppSettings;
  detachedPreviewOpen: boolean;
  viewMode: ViewMode;
  handleToggleF11Viewer: () => void;
  handleSelectDocViewMode: (nextMode: 'editor' | 'split' | 'preview') => void;
  handleToggleDetachedPreview: () => void;
  setIsYamlVisible: React.Dispatch<React.SetStateAction<boolean>>;
  handleToggleFullscreen: () => void;
  handleListSelectPrevOrNext: (dir: 1 | -1) => void;
  handleSwitchTabCycle: (dir: 1 | -1) => void;
  handleMoveEditPoint: (dir: 1 | -1) => void;
  setGotoLineModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleJumpToMatchingBracket: () => void;
  handleBookmarkJumpOrToggle: () => void;
  handleGotoRootMainMd: () => void;
  handleGotoDiary: (mode: 'latest' | 'prev' | 'next') => void;
  handleSyncAndOpenGoogleCalendar: () => void;
  handleRunProgramPlaceholder: () => void;
  handleRunBatchUuidScan: () => void;
  handleAutoFormatTasks: () => void;
  setVaultTemplates: React.Dispatch<React.SetStateAction<VaultTemplateItem[]>>;
  setTemplateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentDoc: DocumentPayload | null;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  setPromoteProjectName: React.Dispatch<React.SetStateAction<string>>;
  setPromoteModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleMoveRole: (targetRole: BaseFolderRole, sourcePath?: string) => void;
}

interface MenuEntry {
  type?: 'item' | 'divider';
  label?: string;
  shortcut?: string;
  highlight?: boolean;
  keepOpen?: boolean;
  action?: () => void;
}

export function MenuBar({
  menuBarExpanded,
  activeMenu,
  setActiveMenu,
  activeSubMenu,
  setActiveSubMenu,
  altPressed,
  getShortcutLabel,
  setNewDocRole,
  setNewDocTemplate,
  setNewDocModalOpen,
  setCalendarModalOpen,
  handleCreateTempMemo,
  handleOpenNativeFile,
  handleOpenNativeFolder,
  handleOpenRenameDocModal,
  handleSaveCurrentDoc,
  autoSaveEnabled,
  handleUpdateAppSettings,
  openDashboardTab,
  setShortcutsModalOpen,
  handleEditorUndo,
  handleEditorRedo,
  handleEditorCut,
  handleEditorCopy,
  handleEditorPaste,
  setFindBarMode,
  setRightSidebarOpen,
  setRightTab,
  setGlobalReplaceMode,
  handleSelectAll,
  handleMoveLine,
  handleAddCursorVertical,
  setPaletteMode,
  setPaletteQuery,
  appSettings,
  detachedPreviewOpen,
  viewMode,
  handleToggleF11Viewer,
  handleSelectDocViewMode,
  handleToggleDetachedPreview,
  setIsYamlVisible,
  handleToggleFullscreen,
  handleListSelectPrevOrNext,
  handleSwitchTabCycle,
  handleMoveEditPoint,
  setGotoLineModalOpen,
  handleJumpToMatchingBracket,
  handleBookmarkJumpOrToggle,
  handleGotoRootMainMd,
  handleGotoDiary,
  handleSyncAndOpenGoogleCalendar,
  handleRunProgramPlaceholder,
  handleRunBatchUuidScan,
  handleAutoFormatTasks,
  setVaultTemplates,
  setTemplateModalOpen,
  currentDoc,
  setStatusMessage,
  setPromoteProjectName,
  setPromoteModalOpen,
  handleMoveRole,
}: MenuBarProps) {
  if (!menuBarExpanded) return null;

  const renderMenuEntries = (entries: MenuEntry[]) =>
    entries.map((entry, idx) =>
      entry.type === 'divider' ? (
        <div key={`div-${idx}`} className="menu-divider" />
      ) : (
        <button
          key={entry.label || idx}
          className="menu-item"
          onClick={() => {
            if (!entry.keepOpen) setActiveMenu(null);
            entry.action?.();
          }}
        >
          <span
            style={
              entry.highlight
                ? { fontWeight: 700, color: '#a5b4fc' }
                : undefined
            }
          >
            {entry.label}
          </span>
          {entry.shortcut !== undefined && (
            <span className="menu-item-shortcut">{entry.shortcut}</span>
          )}
        </button>
      )
    );

  const fileEntries: MenuEntry[] = [
    { type: 'divider' },
    {
      label: '파일 열기',
      shortcut: getShortcutLabel('open_file'),
      action: () => {
        setPaletteMode('files');
        setPaletteQuery('');
      },
    },
    {
      label: '폴더 열기',
      shortcut: getShortcutLabel('open_folder'),
      action: handleOpenNativeFolder,
    },
    { type: 'divider' },
    {
      label: '현재 문서 제목 변경',
      shortcut: getShortcutLabel('rename_doc'),
      action: handleOpenRenameDocModal,
    },
    {
      label: '저장',
      shortcut: getShortcutLabel('save_doc'),
      action: handleSaveCurrentDoc,
    },
    {
      label: '자동 저장',
      shortcut: autoSaveEnabled ? '✓ Checked' : 'Off',
      keepOpen: true,
      action: () =>
        handleUpdateAppSettings({ autoSaveEnabled: !autoSaveEnabled }),
    },
    { type: 'divider' },
    {
      label: '설정 대쉬보드 (.myLore/setting.json)',
      shortcut: getShortcutLabel('open_settings'),
      action: () => openDashboardTab('settings'),
    },
    {
      label: '도움말 (단축키 설정)',
      shortcut: getShortcutLabel('open_shortcuts'),
      action: () => setShortcutsModalOpen(true),
    },
  ];

  const editEntries: MenuEntry[] = [
    {
      label: '실행 취소',
      shortcut: getShortcutLabel('undo'),
      action: handleEditorUndo,
    },
    {
      label: '다시 실행',
      shortcut: getShortcutLabel('redo'),
      action: handleEditorRedo,
    },
    { type: 'divider' },
    {
      label: '잘라내기',
      shortcut: getShortcutLabel('cut'),
      action: handleEditorCut,
    },
    {
      label: '복사',
      shortcut: getShortcutLabel('copy'),
      action: handleEditorCopy,
    },
    {
      label: '붙여넣기',
      shortcut: getShortcutLabel('paste'),
      action: handleEditorPaste,
    },
    { type: 'divider' },
    {
      label: '찾기',
      shortcut: getShortcutLabel('find_in_doc'),
      action: () => setFindBarMode('find'),
    },
    {
      label: '바꾸기',
      shortcut: getShortcutLabel('replace_in_doc'),
      action: () => setFindBarMode('replace'),
    },
    {
      label: '파일에서 찾기',
      shortcut: getShortcutLabel('find_in_files'),
      action: () => {
        setRightSidebarOpen(true);
        setRightTab('search');
        setGlobalReplaceMode(false);
      },
    },
    {
      label: '파일에서 바꾸기',
      shortcut: getShortcutLabel('replace_in_files'),
      action: () => {
        setRightSidebarOpen(true);
        setRightTab('search');
        setGlobalReplaceMode(true);
      },
    },
  ];

  const selectionEntries: MenuEntry[] = [
    {
      label: '모두 선택',
      shortcut: getShortcutLabel('select_all'),
      action: handleSelectAll,
    },
    { type: 'divider' },
    {
      label: '줄 위로 이동',
      shortcut: getShortcutLabel('move_line_up'),
      action: () => handleMoveLine('up'),
    },
    {
      label: '줄 아래로 이동',
      shortcut: getShortcutLabel('move_line_down'),
      action: () => handleMoveLine('down'),
    },
    { type: 'divider' },
    {
      label: '위에 커서 추가',
      shortcut: getShortcutLabel('add_cursor_up'),
      action: () => handleAddCursorVertical('up'),
    },
    {
      label: '아래 커서 추가',
      shortcut: getShortcutLabel('add_cursor_down'),
      action: () => handleAddCursorVertical('down'),
    },
  ];

  const viewEntries: MenuEntry[] = [
    {
      label: '명령어 팔레트 소환',
      shortcut: getShortcutLabel('command_palette'),
      action: () => {
        setPaletteMode('commands');
        setPaletteQuery('');
      },
    },
    { type: 'divider' },
    {
      label:
        appSettings.f11ViewerMode === 'detached'
          ? `${detachedPreviewOpen ? '✓ ' : ''}🪟 전용 독립 뷰어 켜기/끄기`
          : `${viewMode === 'split' ? '✓ ' : ''}📐 병렬 뷰어 켜기/끄기`,
      shortcut: getShortcutLabel('toggle_viewer'),
      highlight: true,
      action: handleToggleF11Viewer,
    },
    { type: 'divider' },
    {
      label: `${viewMode === 'editor' && !detachedPreviewOpen ? '✓ ' : ''}에디터 전용 모드`,
      shortcut: getShortcutLabel('view_editor'),
      action: () => handleSelectDocViewMode('editor'),
    },
    {
      label: `${viewMode === 'split' && !detachedPreviewOpen ? '✓ ' : ''}병렬 뷰어 모드 (분할 화면)`,
      shortcut: getShortcutLabel('view_split'),
      action: () => handleSelectDocViewMode('split'),
    },
    {
      label: `${viewMode === 'preview' && !detachedPreviewOpen ? '✓ ' : ''}뷰어 전용 모드`,
      shortcut: getShortcutLabel('view_preview'),
      action: () => handleSelectDocViewMode('preview'),
    },
    {
      label: `${detachedPreviewOpen ? '✓ ' : ''}전용 독립 뷰어 창 모드`,
      shortcut: getShortcutLabel('view_detached_preview'),
      action: handleToggleDetachedPreview,
    },
    { type: 'divider' },
    {
      label: 'YAML 메타데이터 표시/숨기기',
      shortcut: getShortcutLabel('toggle_yaml'),
      action: () => setIsYamlVisible((v) => !v),
    },
    {
      label: '우측 사이드바 접기/펼치기',
      shortcut: getShortcutLabel('toggle_sidebar'),
      action: () => setRightSidebarOpen((v) => !v),
    },
    {
      label: '📑 문서 내 목차(TOC) 사이드바',
      shortcut: getShortcutLabel('sidebar_toc') || 'Ctrl+1',
      action: () => {
        setRightSidebarOpen(true);
        setRightTab('toc');
      },
    },
    {
      label: '🔗 양방향 백링크 사이드바',
      shortcut: getShortcutLabel('sidebar_backlinks') || 'Ctrl+2',
      action: () => {
        setRightSidebarOpen(true);
        setRightTab('backlinks');
      },
    },
    {
      label: '📋 로그 대쉬보드 열기',
      shortcut: getShortcutLabel('toggle_log_terminal') || 'Ctrl+`',
      action: () => openDashboardTab('logs'),
    },
    {
      label: '전체 화면',
      shortcut: getShortcutLabel('toggle_fullscreen'),
      action: handleToggleFullscreen,
    },
    { type: 'divider' },
    {
      label: 'Google Chrome 앱 모드로 열기',
      shortcut: 'Chrome',
      action: () => {
        openInChromeAppMode();
      },
    },
  ];

  const goEntries: MenuEntry[] = [
    {
      label: '목록 이전 선택 (파일 / 찾기 목록)',
      shortcut: getShortcutLabel('list_prev'),
      action: () => handleListSelectPrevOrNext(-1),
    },
    {
      label: '목록 다음 선택 (파일 / 찾기 목록)',
      shortcut: getShortcutLabel('list_next'),
      action: () => handleListSelectPrevOrNext(1),
    },
    {
      label: '다음 탭으로 이동',
      shortcut: getShortcutLabel('next_file'),
      action: () => handleSwitchTabCycle(1),
    },
    {
      label: '이전 탭으로 이동',
      shortcut: getShortcutLabel('prev_file'),
      action: () => handleSwitchTabCycle(-1),
    },
    {
      label: '다음 편집점으로 이동',
      shortcut: getShortcutLabel('next_edit_pos'),
      action: () => handleMoveEditPoint(1),
    },
    {
      label: '이전 편집점으로 이동',
      shortcut: getShortcutLabel('prev_edit_pos'),
      action: () => handleMoveEditPoint(-1),
    },
    {
      label: '줄 이동',
      shortcut: getShortcutLabel('goto_line'),
      action: () => setGotoLineModalOpen(true),
    },
    {
      label: '괄호 이동',
      shortcut: getShortcutLabel('goto_bracket'),
      action: handleJumpToMatchingBracket,
    },
    {
      label: '북마크 이동',
      shortcut: getShortcutLabel('goto_bookmark'),
      action: handleBookmarkJumpOrToggle,
    },
    { type: 'divider' },
    {
      label: 'main.md로 이동',
      shortcut: getShortcutLabel('goto_main_md'),
      action: handleGotoRootMainMd,
    },
    {
      label: '최신 diary로 이동',
      shortcut: 'Latest Diary',
      action: () => handleGotoDiary('latest'),
    },
    {
      label: '이전 diary로 이동',
      shortcut: 'Prev Diary',
      action: () => handleGotoDiary('prev'),
    },
    {
      label: '다음 diary로 이동',
      shortcut: 'Next Diary',
      action: () => handleGotoDiary('next'),
    },
    {
      label: '구글 캘린더 싱크 및 열기',
      shortcut: getShortcutLabel('sync_open_gcal'),
      action: handleSyncAndOpenGoogleCalendar,
    },
  ];

  const runEntries: MenuEntry[] = [
    {
      label: '프로그램 수행 (추후 업데이트 예정)',
      shortcut: getShortcutLabel('run_program'),
      action: handleRunProgramPlaceholder,
    },
    {
      label: 'UUID 재스캔',
      shortcut: getShortcutLabel('rescan_uuid'),
      action: handleRunBatchUuidScan,
    },
    { type: 'divider' },
    {
      label: '서브미션 Auto-Format 정렬',
      shortcut: getShortcutLabel('auto_format'),
      action: handleAutoFormatTasks,
    },
    {
      label: '템플릿 관리 및 삽입 (.myLore)',
      shortcut: 'Templates',
      action: async () => {
        const tpls = await getVaultTemplates();
        setVaultTemplates(tpls);
        setTemplateModalOpen(true);
      },
    },
    {
      label: '현재 문서 UUID 링크 복사',
      shortcut: 'mylore://',
      action: () => {
        if (currentDoc) {
          navigator.clipboard.writeText(
            `[문서링크](mylore://doc/${currentDoc.uuid})`
          );
          setStatusMessage(`🔗 복사됨: mylore://doc/${currentDoc.uuid}`);
        }
      },
    },
    { type: 'divider' },
    {
      label: '현재 문서를 프로젝트(main.md)로 승격',
      shortcut: 'Promote',
      action: () => {
        if (currentDoc) {
          const baseName = currentDoc.relativePath
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.md$/i, '');
          setPromoteProjectName(baseName || '새프로젝트');
          setPromoteModalOpen(true);
        }
      },
    },
    {
      label: '⭐ 프로젝트(Projects) 폴더로 이동',
      shortcut: 'Move',
      action: () => handleMoveRole('projects'),
    },
    {
      label: '📅 일기(Diary) 폴더로 이동',
      shortcut: 'Move',
      action: () => handleMoveRole('diary'),
    },
    {
      label: '🗄️ 데이터(Archive) 폴더로 이동',
      shortcut: 'Move',
      action: () => handleMoveRole('data'),
    },
    {
      label: '💻 Git 폴더로 이동',
      shortcut: 'Move',
      action: () => handleMoveRole('git'),
    },
  ];

  const dashboardEntries: MenuEntry[] = [
    {
      label: '⭐ 프로젝트 (Projects/main.md)',
      shortcut: getShortcutLabel('dashboard_projects'),
      action: handleGotoRootMainMd,
    },
    {
      label: '📱 라이프로그 대쉬보드',
      shortcut: getShortcutLabel('dashboard_lifelog'),
      action: () => openDashboardTab('lifelog'),
    },
    {
      label: '💳 금융 대쉬보드',
      shortcut: getShortcutLabel('dashboard_finance'),
      action: () => openDashboardTab('finance'),
    },
    {
      label: '📅 일정 대쉬보드',
      shortcut: getShortcutLabel('dashboard_diary'),
      action: () => openDashboardTab('diary'),
    },
    {
      label: '📋 로그 대쉬보드',
      shortcut: getShortcutLabel('toggle_log_terminal') || 'Ctrl+`',
      action: () => openDashboardTab('logs'),
    },
    { type: 'divider' },
    {
      label: '⚙️ 설정 대쉬보드 (.myLore/setting.json)',
      shortcut: getShortcutLabel('open_settings'),
      action: () => openDashboardTab('settings'),
    },
  ];

  const menus: Array<{
    key: string;
    label: string;
    keytip: string;
    entries: MenuEntry[];
  }> = [
    { key: 'edit', label: '편집', keytip: 'E', entries: editEntries },
    { key: 'selection', label: '선택', keytip: 'S', entries: selectionEntries },
    { key: 'view', label: '보기', keytip: 'V', entries: viewEntries },
    { key: 'go', label: '이동', keytip: 'G', entries: goEntries },
    { key: 'run', label: '실행', keytip: 'R', entries: runEntries },
    { key: 'dashboard', label: '대쉬보드', keytip: 'D', entries: dashboardEntries },
  ];

  return (
    <>
      <div className="menu-dropdown-wrapper">
        <button
          className={`menu-trigger ${activeMenu === 'file' ? 'active' : ''}`}
          onClick={() => {
            setActiveMenu(activeMenu === 'file' ? null : 'file');
            setActiveSubMenu(null);
          }}
        >
          파일
          {altPressed && <span className="alt-keytip-badge">F</span>}
        </button>
        {activeMenu === 'file' && (
          <div className="menu-dropdown">
            <div
              className="menu-sub-wrapper"
              onMouseEnter={() => setActiveSubMenu('new_file')}
            >
              <button className="menu-item">
                <span>새 파일</span>
                <span className="menu-item-shortcut">▸</span>
              </button>
              {activeSubMenu === 'new_file' && (
                <div className="menu-sub-dropdown">
                  <button
                    className="menu-item"
                    onClick={() => {
                      setActiveMenu(null);
                      setNewDocRole('projects');
                      setNewDocTemplate('project_main.md');
                      setNewDocModalOpen(true);
                    }}
                  >
                    <span>새 프로젝트</span>
                    <span className="menu-item-shortcut">Projects/main.md</span>
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setActiveMenu(null);
                      setCalendarModalOpen(true);
                    }}
                  >
                    <span>새 일정</span>
                    <span className="menu-item-shortcut">달력 UI</span>
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      setActiveMenu(null);
                      handleCreateTempMemo();
                    }}
                  >
                    <span>새 메모</span>
                    <span className="menu-item-shortcut">
                      {getShortcutLabel('new_memo')}
                    </span>
                  </button>
                </div>
              )}
            </div>
            {renderMenuEntries(fileEntries)}
          </div>
        )}
      </div>

      {menus.map((m) => (
        <div key={m.key} className="menu-dropdown-wrapper">
          <button
            className={`menu-trigger ${activeMenu === m.key ? 'active' : ''}`}
            onClick={() => setActiveMenu(activeMenu === m.key ? null : m.key)}
          >
            {m.label}
            {altPressed && <span className="alt-keytip-badge">{m.keytip}</span>}
          </button>
          {activeMenu === m.key && (
            <div className="menu-dropdown">{renderMenuEntries(m.entries)}</div>
          )}
        </div>
      ))}
    </>
  );
}
