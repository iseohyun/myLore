/**
 * @file useKeybindings.ts
 * @description 전역 단축키 설정(`localStorage`), `useRef` 기반 무재등록 전역 `keydown`/`keyup` 리스너 및 명령어 팔레트(`commandItems`) 구성 훅.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BaseFolderRole,
  CommandPaletteItem,
  ContextMenuState,
  KeybindingConfig,
  MyLoreAppSettings,
  PaletteMode,
  RightSidebarTab,
  TrashedFileRecord,
  VaultTemplateItem,
} from '../types/mylore';
import { getVaultTemplates } from '../services/tauriClient';

export const KEYBINDINGS_STORAGE_KEY = 'mylore_keybindings_v7';

export const DEFAULT_KEYBINDINGS: KeybindingConfig[] = [
  { id: 'open_shortcuts', category: 'Function', label: '단축키 설정', shortcut: 'F1', secondaryShortcut: '', condition: '전역' },
  { id: 'rename_doc', category: 'Function', label: '현재 문서 제목 변경', shortcut: 'F2', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'list_prev', category: 'Function', label: '목록 이전 선택', shortcut: 'F3', secondaryShortcut: 'Shift+F3', condition: '파일 목록 / 찾기 시' },
  { id: 'list_next', category: 'Function', label: '목록 다음 선택', shortcut: 'F4', secondaryShortcut: '', condition: '파일 목록 / 찾기 시' },
  { id: 'rescan_uuid', category: 'Function', label: 'UUID 재스캔', shortcut: 'F5', secondaryShortcut: '', condition: '전역' },
  { id: 'dashboard_projects', category: 'Function', label: '프로젝트 (Projects/main.md)', shortcut: 'F6', secondaryShortcut: '', condition: '전역' },
  { id: 'dashboard_lifelog', category: 'Function', label: '라이프로그 대쉬보드', shortcut: 'F7', secondaryShortcut: '', condition: '전역' },
  { id: 'dashboard_finance', category: 'Function', label: '금융 대쉬보드', shortcut: 'F8', secondaryShortcut: '', condition: '전역' },
  { id: 'dashboard_diary', category: 'Function', label: '일정 대쉬보드', shortcut: 'F9', secondaryShortcut: '', condition: '전역' },
  { id: 'menu_toggle', category: 'Function', label: '메뉴 열기/닫기', shortcut: 'F10', secondaryShortcut: '', condition: '전역' },
  { id: 'toggle_viewer', category: 'Function', label: '뷰어 켜기/끄기 (독립/병렬)', shortcut: 'F11', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'devtools_info', category: 'Function', label: '개발자 모드', shortcut: 'F12', secondaryShortcut: 'Ctrl+Shift+I', condition: '전역' },
  { id: 'sync_open_gcal', category: '이동', label: '구글 캘린더 싱크 및 열기', shortcut: '', secondaryShortcut: '', condition: '전역' },
  { id: 'run_program', category: '실행', label: '프로그램 수행', shortcut: '', secondaryShortcut: '', condition: '전역' },
  { id: 'save_doc', category: '파일', label: '저장', shortcut: 'Ctrl+S', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'close_tab', category: '파일', label: '현재 에디터/대쉬보드 탭 닫기', shortcut: 'Ctrl+W', secondaryShortcut: 'Ctrl+F4', condition: '전역' },
  { id: 'open_file', category: '파일', label: '파일 열기', shortcut: 'Ctrl+O', secondaryShortcut: '', condition: '전역' },
  { id: 'open_folder', category: '파일', label: '폴더 열기', shortcut: 'Ctrl+Shift+O', secondaryShortcut: '', condition: '전역' },
  { id: 'new_memo', category: '파일', label: '새 메모', shortcut: 'Ctrl+N', secondaryShortcut: '', condition: '전역' },
  { id: 'trash_doc', category: '파일', label: '휴지통으로 이동', shortcut: 'Delete', secondaryShortcut: '', condition: '폴더 목록에서' },
  { id: 'undo_trash_doc', category: '파일', label: '휴지통 이동 되돌리기', shortcut: 'Ctrl+Z', secondaryShortcut: '', condition: '폴더 목록에서' },
  { id: 'open_settings', category: '파일', label: '설정 대쉬보드 열기', shortcut: 'Ctrl+,', secondaryShortcut: '', condition: '전역' },
  { id: 'undo', category: '편집', label: '실행 취소', shortcut: 'Ctrl+Z', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'redo', category: '편집', label: '다시 실행', shortcut: 'Ctrl+Y', secondaryShortcut: 'Ctrl+Shift+Z', condition: '편집모드에서' },
  { id: 'cut', category: '편집', label: '잘라내기', shortcut: 'Ctrl+X', secondaryShortcut: 'Shift+Delete', condition: '편집모드에서' },
  { id: 'copy', category: '편집', label: '복사', shortcut: 'Ctrl+C', secondaryShortcut: 'Ctrl+Insert', condition: '편집모드에서' },
  { id: 'paste', category: '편집', label: '붙여넣기', shortcut: 'Ctrl+V', secondaryShortcut: 'Shift+Insert', condition: '편집모드에서' },
  { id: 'find_in_doc', category: '편집', label: '찾기', shortcut: 'Ctrl+F', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'replace_in_doc', category: '편집', label: '바꾸기', shortcut: 'Ctrl+H', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'find_in_files', category: '편집', label: '파일에서 찾기', shortcut: 'Ctrl+Shift+F', secondaryShortcut: '', condition: '전역' },
  { id: 'replace_in_files', category: '편집', label: '파일에서 바꾸기', shortcut: 'Ctrl+Shift+H', secondaryShortcut: '', condition: '전역' },
  { id: 'select_all', category: '선택', label: '모두 선택', shortcut: 'Ctrl+A', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'move_line_up', category: '선택', label: '줄 위로 이동', shortcut: 'Alt+ArrowUp', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'move_line_down', category: '선택', label: '줄 아래로 이동', shortcut: 'Alt+ArrowDown', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'add_cursor_up', category: '선택', label: '위에 커서 추가', shortcut: 'Ctrl+Alt+ArrowUp', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'add_cursor_down', category: '선택', label: '아래 커서 추가', shortcut: 'Ctrl+Alt+ArrowDown', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'view_editor', category: '보기', label: '에디터 전용 모드', shortcut: '', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'view_split', category: '보기', label: '병렬 뷰어 모드 (분할 화면)', shortcut: '', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'view_preview', category: '보기', label: '뷰어 전용 모드', shortcut: '', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'view_detached_preview', category: '보기', label: '전용 독립 뷰어 창 모드', shortcut: '', secondaryShortcut: '', condition: '문서 열람 시' },
  { id: 'toggle_fullscreen', category: '보기', label: '전체 화면', shortcut: 'Shift+F11', secondaryShortcut: '', condition: '전역' },
  { id: 'command_palette', category: '보기', label: '명령어 팔레트', shortcut: 'Ctrl+Shift+P', secondaryShortcut: '', condition: '전역' },
  { id: 'quick_open', category: '보기', label: '빠른 문서 열기', shortcut: 'Ctrl+P', secondaryShortcut: 'Ctrl+E', condition: '전역' },
  { id: 'toggle_sidebar', category: '보기', label: '우측 사이드바 접기/펼치기', shortcut: 'Ctrl+B', secondaryShortcut: '', condition: '전역' },
  { id: 'toggle_yaml', category: '보기', label: 'YAML 메타데이터 편집 토글', shortcut: 'Ctrl+;', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'next_file', category: '이동', label: '다음 파일로 이동', shortcut: 'Ctrl+Tab', secondaryShortcut: 'Ctrl+PageDown', condition: '다중 탭 열람 시' },
  { id: 'prev_file', category: '이동', label: '이전 파일로 이동', shortcut: 'Ctrl+Shift+Tab', secondaryShortcut: 'Ctrl+PageUp', condition: '다중 탭 열람 시' },
  { id: 'next_edit_pos', category: '이동', label: '다음 편집점으로 이동', shortcut: 'Alt+ArrowRight', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'prev_edit_pos', category: '이동', label: '이전 편집점으로 이동', shortcut: 'Alt+ArrowLeft', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'goto_line', category: '이동', label: '줄 이동', shortcut: 'Ctrl+G', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'goto_bracket', category: '이동', label: '괄호 이동', shortcut: 'Ctrl+Shift+\\', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'goto_bookmark', category: '이동', label: '북마크 이동', shortcut: 'Ctrl+F2', secondaryShortcut: '', condition: '편집모드에서' },
  { id: 'goto_main_md', category: '이동', label: 'main.md로 이동', shortcut: 'Alt+M', secondaryShortcut: '', condition: '전역' },
  { id: 'auto_format', category: '실행', label: '서브미션 Auto-Format 정렬', shortcut: 'Alt+Shift+F', secondaryShortcut: '', condition: '편집모드에서' },
];

export interface UseKeybindingsParams {
  activeTabPath: string | null;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightTab: RightSidebarTab;
  setRightTab: React.Dispatch<React.SetStateAction<RightSidebarTab>>;
  isFolderPaneFocused: boolean;
  trashHistory: TrashedFileRecord[];
  setMenuBarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveMenu: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveSubMenu: React.Dispatch<React.SetStateAction<string | null>>;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setPaletteMode: React.Dispatch<React.SetStateAction<PaletteMode>>;
  setPaletteQuery: React.Dispatch<React.SetStateAction<string>>;
  setFindBarMode: React.Dispatch<
    React.SetStateAction<'closed' | 'find' | 'replace'>
  >;
  setGlobalReplaceMode: React.Dispatch<React.SetStateAction<boolean>>;
  setIsYamlVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setGotoLineModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRenameModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  handleOpenRenameDocModal: () => void;
  handleListSelectPrevOrNext: (dir: 1 | -1) => Promise<void> | void;
  handleRunBatchUuidScan: () => Promise<void> | void;
  handleGotoRootMainMd: () => Promise<void> | void;
  openDashboardTab: (
    dashType: 'lifelog' | 'finance' | 'diary' | 'settings'
  ) => void;
  handleSyncAndOpenGoogleCalendar: () => Promise<void> | void;
  handleRunProgramPlaceholder: () => void;
  handleToggleF11Viewer: () => Promise<void> | void;
  handleToggleFullscreen: () => Promise<void> | void;
  handleSaveCurrentDoc: () => Promise<void> | void;
  closeTab: (fullPath: string, e?: React.MouseEvent) => void;
  handleOpenNativeFile: () => Promise<void> | void;
  handleOpenNativeFolder: () => Promise<void> | void;
  handleCreateTempMemo: () => Promise<void> | void;
  handleMoveLine: (dir: 'up' | 'down') => void;
  handleAddCursorVertical: (dir: 'up' | 'down') => void;
  handleSelectDocViewMode: (
    nextMode: 'editor' | 'split' | 'preview'
  ) => Promise<void> | void;
  handleToggleDetachedPreview: (forceOpen?: boolean) => Promise<void> | void;
  handleSwitchTabCycle: (dir: 1 | -1) => void;
  handleMoveEditPoint: (dir: 1 | -1) => Promise<void> | void;
  handleJumpToMatchingBracket: () => void;
  handleBookmarkJumpOrToggle: () => void;
  handleAutoFormatTasks: () => void;
  handleTrashDocument: (targetPath?: string) => Promise<void> | void;
  handleRestoreTrashedDocument: (trashId?: string) => Promise<void> | void;
  setNewDocRole: React.Dispatch<React.SetStateAction<BaseFolderRole>>;
  setNewDocTemplate: React.Dispatch<React.SetStateAction<string>>;
  setNewDocModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCalendarModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleGotoDiary: (mode: 'latest' | 'prev' | 'next') => Promise<void> | void;
  setVaultTemplates: React.Dispatch<React.SetStateAction<VaultTemplateItem[]>>;
  setTemplateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  appSettings: MyLoreAppSettings;
}

export function useKeybindings(params: UseKeybindingsParams) {
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [helpSearchQuery, setHelpSearchQuery] = useState('');
  const [recordingShortcutTarget, setRecordingShortcutTarget] = useState<{
    id: string;
    field: 'shortcut' | 'secondaryShortcut';
  } | null>(null);
  const [altPressed, setAltPressed] = useState(false);
  const [keybindings, setKeybindings] = useState<KeybindingConfig[]>(() => {
    const saved = localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (!saved) return DEFAULT_KEYBINDINGS;
    try {
      const parsed: KeybindingConfig[] = JSON.parse(saved);
      const missing = DEFAULT_KEYBINDINGS.filter(
        (def) => !parsed.some((p) => p.id === def.id)
      );
      return missing.length > 0 ? [...parsed, ...missing] : parsed;
    } catch {
      return DEFAULT_KEYBINDINGS;
    }
  });

  const filteredKeybindings = useMemo(() => {
    const q = helpSearchQuery.trim().toLowerCase();
    if (!q) return keybindings;
    const tokens = q.split(/\s+/).filter(Boolean);
    return keybindings.filter((kb) => {
      const searchable = [
        kb.label,
        kb.category,
        kb.shortcut,
        kb.secondaryShortcut || '',
        kb.condition || '',
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((tok) => searchable.includes(tok));
    });
  }, [keybindings, helpSearchQuery]);

  const getShortcutLabel = (id: string): string => {
    return keybindings.find((k) => k.id === id)?.shortcut || '';
  };

  // 최신 핸들러 및 상태를 ref에 보관하여 본문 타이핑 시마다 전역 keydown 리스너가 재등록되지 않도록 최적화
  const latestRef = useRef(params);
  latestRef.current = params;

  // 전역 키보드 단축키 및 Alt 배지 리스너
  useEffect(() => {
    const normalizeKeyEvent = (e: KeyboardEvent): string => {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        parts.push(k);
      }
      return parts.join('+');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const ctx = latestRef.current;

      // 단축키 변경 모달에서 새 단축키 녹음 중일 때
      if (recordingShortcutTarget) {
        e.preventDefault();
        e.stopPropagation();
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        if (e.key === 'Escape') {
          setRecordingShortcutTarget(null);
          return;
        }
        // 보조 단축키 녹음 중 Backspace/Delete 단독 입력 시 보조 단축키 비우기
        if (
          recordingShortcutTarget.field === 'secondaryShortcut' &&
          (e.key === 'Backspace' || e.key === 'Delete') &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.shiftKey
        ) {
          const updated = keybindings.map((kb) =>
            kb.id === recordingShortcutTarget.id
              ? { ...kb, secondaryShortcut: '' }
              : kb
          );
          setKeybindings(updated);
          localStorage.setItem(
            KEYBINDINGS_STORAGE_KEY,
            JSON.stringify(updated)
          );
          setRecordingShortcutTarget(null);
          ctx.setStatusMessage('⌨️ 보조 단축키가 해제되었습니다.');
          return;
        }
        const combo = normalizeKeyEvent(e);
        const updated = keybindings.map((kb) =>
          kb.id === recordingShortcutTarget.id
            ? { ...kb, [recordingShortcutTarget.field]: combo }
            : kb
        );
        setKeybindings(updated);
        localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(updated));
        setRecordingShortcutTarget(null);
        ctx.setStatusMessage(`⌨️ 단축키가 [${combo}]로 변경되었습니다.`);
        return;
      }

      // F12: 개발자모드 (현행 유지 — 브라우저/WebView2 기본 DevTools가 열리도록 가로채지 않음)
      if (e.key === 'F12' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        return;
      }

      if (e.key === 'Alt') {
        setAltPressed(true);
      }

      // Alt + 니모닉 키로 상단 메뉴 즉시 열기
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        const menuMap: Record<string, string> = {
          f: 'file',
          e: 'edit',
          s: 'selection',
          v: 'view',
          g: 'go',
          r: 'run',
          d: 'dashboard',
        };
        if (menuMap[k]) {
          e.preventDefault();
          ctx.setMenuBarExpanded(true);
          ctx.setActiveMenu(menuMap[k]);
          return;
        }
      }

      const pressed = normalizeKeyEvent(e);
      const matchKb = (id: string) => {
        const kb = keybindings.find((k) => k.id === id);
        if (!kb) return false;
        const p = pressed.toLowerCase();
        return (
          (Boolean(kb.shortcut) && kb.shortcut.toLowerCase() === p) ||
          (Boolean(kb.secondaryShortcut) &&
            kb.secondaryShortcut.toLowerCase() === p)
        );
      };

      if (matchKb('open_shortcuts')) {
        e.preventDefault();
        setShortcutsModalOpen((prev) => !prev);
      } else if (matchKb('rename_doc')) {
        e.preventDefault();
        ctx.handleOpenRenameDocModal();
      } else if (matchKb('list_prev')) {
        e.preventDefault();
        void ctx.handleListSelectPrevOrNext(-1);
      } else if (matchKb('list_next')) {
        e.preventDefault();
        void ctx.handleListSelectPrevOrNext(1);
      } else if (matchKb('rescan_uuid')) {
        e.preventDefault();
        void ctx.handleRunBatchUuidScan();
      } else if (matchKb('dashboard_projects')) {
        e.preventDefault();
        void ctx.handleGotoRootMainMd();
      } else if (matchKb('dashboard_lifelog')) {
        e.preventDefault();
        ctx.openDashboardTab('lifelog');
      } else if (matchKb('dashboard_finance')) {
        e.preventDefault();
        ctx.openDashboardTab('finance');
      } else if (matchKb('dashboard_diary')) {
        e.preventDefault();
        ctx.openDashboardTab('diary');
      } else if (matchKb('sync_open_gcal')) {
        e.preventDefault();
        void ctx.handleSyncAndOpenGoogleCalendar();
      } else if (matchKb('run_program')) {
        e.preventDefault();
        ctx.handleRunProgramPlaceholder();
      } else if (matchKb('menu_toggle')) {
        e.preventDefault();
        ctx.setMenuBarExpanded((prev) => {
          const next = !prev;
          ctx.setActiveMenu(next ? 'file' : null);
          return next;
        });
      } else if (matchKb('toggle_viewer')) {
        e.preventDefault();
        void ctx.handleToggleF11Viewer();
      } else if (matchKb('toggle_fullscreen')) {
        e.preventDefault();
        void ctx.handleToggleFullscreen();
      } else if (matchKb('save_doc')) {
        e.preventDefault();
        void ctx.handleSaveCurrentDoc();
      } else if (
        matchKb('close_tab') ||
        (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'w')
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (ctx.activeTabPath) {
          ctx.closeTab(ctx.activeTabPath);
        }
      } else if (matchKb('open_file')) {
        e.preventDefault();
        void ctx.handleOpenNativeFile();
      } else if (matchKb('open_folder')) {
        e.preventDefault();
        void ctx.handleOpenNativeFolder();
      } else if (matchKb('new_memo')) {
        e.preventDefault();
        void ctx.handleCreateTempMemo();
      } else if (matchKb('open_settings')) {
        e.preventDefault();
        ctx.openDashboardTab('settings');
      } else if (matchKb('find_in_doc')) {
        e.preventDefault();
        ctx.setFindBarMode('find');
      } else if (matchKb('replace_in_doc')) {
        e.preventDefault();
        ctx.setFindBarMode('replace');
      } else if (matchKb('find_in_files')) {
        e.preventDefault();
        ctx.setRightSidebarOpen(true);
        ctx.setRightTab('search');
        ctx.setGlobalReplaceMode(false);
      } else if (matchKb('replace_in_files')) {
        e.preventDefault();
        ctx.setRightSidebarOpen(true);
        ctx.setRightTab('search');
        ctx.setGlobalReplaceMode(true);
      } else if (matchKb('move_line_up')) {
        e.preventDefault();
        ctx.handleMoveLine('up');
      } else if (matchKb('move_line_down')) {
        e.preventDefault();
        ctx.handleMoveLine('down');
      } else if (matchKb('add_cursor_up')) {
        e.preventDefault();
        ctx.handleAddCursorVertical('up');
      } else if (matchKb('add_cursor_down')) {
        e.preventDefault();
        ctx.handleAddCursorVertical('down');
      } else if (matchKb('view_editor')) {
        e.preventDefault();
        void ctx.handleSelectDocViewMode('editor');
      } else if (matchKb('view_split')) {
        e.preventDefault();
        void ctx.handleSelectDocViewMode('split');
      } else if (matchKb('view_preview')) {
        e.preventDefault();
        void ctx.handleSelectDocViewMode('preview');
      } else if (matchKb('view_detached_preview')) {
        e.preventDefault();
        void ctx.handleToggleDetachedPreview();
      } else if (matchKb('command_palette')) {
        e.preventDefault();
        ctx.setPaletteMode('commands');
        ctx.setPaletteQuery('');
      } else if (matchKb('quick_open')) {
        e.preventDefault();
        ctx.setPaletteMode('files');
        ctx.setPaletteQuery('');
      } else if (matchKb('toggle_sidebar')) {
        e.preventDefault();
        ctx.setRightSidebarOpen((v) => !v);
      } else if (matchKb('toggle_yaml')) {
        e.preventDefault();
        ctx.setIsYamlVisible((v) => !v);
      } else if (matchKb('next_file')) {
        e.preventDefault();
        ctx.handleSwitchTabCycle(1);
      } else if (matchKb('prev_file')) {
        e.preventDefault();
        ctx.handleSwitchTabCycle(-1);
      } else if (
        matchKb('next_edit_pos') ||
        (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        void ctx.handleMoveEditPoint(1);
      } else if (
        matchKb('prev_edit_pos') ||
        (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowLeft')
      ) {
        e.preventDefault();
        void ctx.handleMoveEditPoint(-1);
      } else if (matchKb('goto_line')) {
        e.preventDefault();
        ctx.setGotoLineModalOpen(true);
      } else if (matchKb('goto_bracket')) {
        e.preventDefault();
        ctx.handleJumpToMatchingBracket();
      } else if (matchKb('goto_bookmark')) {
        e.preventDefault();
        ctx.handleBookmarkJumpOrToggle();
      } else if (matchKb('goto_main_md')) {
        e.preventDefault();
        void ctx.handleGotoRootMainMd();
      } else if (matchKb('auto_format')) {
        e.preventDefault();
        ctx.handleAutoFormatTasks();
      } else {
        const activeEl = document.activeElement as HTMLElement | null;
        const activeTag = activeEl?.tagName || '';
        const isTextInputFocused = ['INPUT', 'TEXTAREA'].includes(activeTag);
        const inFolderInterface =
          !isTextInputFocused &&
          ctx.rightSidebarOpen &&
          ctx.rightTab === 'tree' &&
          (ctx.isFolderPaneFocused ||
            Boolean(activeEl?.closest('.right-sidebar')));

        if (inFolderInterface && (matchKb('trash_doc') || e.key === 'Delete')) {
          e.preventDefault();
          void ctx.handleTrashDocument();
          return;
        }
        if (
          !isTextInputFocused &&
          ctx.trashHistory.length > 0 &&
          (matchKb('undo_trash_doc') ||
            (e.ctrlKey &&
              !e.shiftKey &&
              !e.altKey &&
              e.key.toLowerCase() === 'z'))
        ) {
          e.preventDefault();
          void ctx.handleRestoreTrashedDocument();
          return;
        }
        if (e.key === 'Escape') {
          ctx.setPaletteMode('closed');
          ctx.setActiveMenu(null);
          ctx.setActiveSubMenu(null);
          ctx.setContextMenu(null);
          ctx.setFindBarMode('closed');
          ctx.setRenameModalOpen(false);
          setShortcutsModalOpen(false);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setAltPressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [recordingShortcutTarget, keybindings]);

  const commandItems: CommandPaletteItem[] = [
    {
      id: 'cmd-f1-help',
      label: '도움말 (단축키 설정 모달 열기)',
      shortcut: getShortcutLabel('open_shortcuts'),
      action: () => setShortcutsModalOpen(true),
    },
    {
      id: 'cmd-f2-rename',
      label: '파일: 현재 문서 제목 변경 (UUID 유지)',
      shortcut: getShortcutLabel('rename_doc'),
      action: params.handleOpenRenameDocModal,
    },
    {
      id: 'cmd-new-project',
      label: '파일: 새 프로젝트 생성 (Projects/{폴더}/main.md)',
      shortcut: '',
      action: () => {
        params.setNewDocRole('projects');
        params.setNewDocTemplate('project_main.md');
        params.setNewDocModalOpen(true);
      },
    },
    {
      id: 'cmd-new-schedule',
      label: '파일: 새 일정 생성 (달력 UI 열기)',
      shortcut: '',
      action: () => params.setCalendarModalOpen(true),
    },
    {
      id: 'cmd-new-memo',
      label: '파일: 새 메모 작성 (프로젝트/임시에 자동 분류)',
      shortcut: getShortcutLabel('new_memo'),
      action: () => void params.handleCreateTempMemo(),
    },
    {
      id: 'cmd-find-in-files',
      label: '편집: 파일에서 찾기 (우측 사이드바 검색)',
      shortcut: getShortcutLabel('find_in_files'),
      action: () => {
        params.setRightSidebarOpen(true);
        params.setRightTab('search');
        params.setGlobalReplaceMode(false);
      },
    },
    {
      id: 'cmd-goto-main',
      label: '이동: main.md로 이동 (루트 Projects/main.md)',
      shortcut: getShortcutLabel('goto_main_md'),
      action: () => void params.handleGotoRootMainMd(),
    },
    {
      id: 'cmd-goto-latest-diary',
      label: '이동: 최신 diary로 이동',
      shortcut: '',
      action: () => void params.handleGotoDiary('latest'),
    },
    {
      id: 'cmd-auto-format',
      label: '실행: 서브 미션 Auto-Format 정렬',
      shortcut: getShortcutLabel('auto_format'),
      action: params.handleAutoFormatTasks,
    },
    {
      id: 'cmd-scan-uuid',
      label: '실행: UUID 재스캔 (베이스 폴더 일괄 스캔)',
      shortcut: getShortcutLabel('rescan_uuid'),
      action: () => void params.handleRunBatchUuidScan(),
    },
    {
      id: 'cmd-f9-run',
      label: '실행: 프로그램 수행 (추후 업데이트 예정)',
      shortcut: getShortcutLabel('run_program'),
      action: params.handleRunProgramPlaceholder,
    },
    {
      id: 'cmd-open-templates',
      label: '실행: 볼트 템플릿 관리 및 삽입 (.myLore/templates)',
      shortcut: '',
      action: async () => {
        const tpls = await getVaultTemplates();
        params.setVaultTemplates(tpls);
        params.setTemplateModalOpen(true);
      },
    },
    {
      id: 'cmd-dash-projects',
      label: '대쉬보드: 프로젝트 (Projects/main.md 열기)',
      shortcut: getShortcutLabel('dashboard_projects'),
      action: () => void params.handleGotoRootMainMd(),
    },
    {
      id: 'cmd-dash-lifelog',
      label: '대쉬보드: 라이프로그 대쉬보드 탭 열기',
      shortcut: getShortcutLabel('dashboard_lifelog'),
      action: () => params.openDashboardTab('lifelog'),
    },
    {
      id: 'cmd-dash-finance',
      label: '대쉬보드: 금융 대쉬보드 탭 열기',
      shortcut: getShortcutLabel('dashboard_finance'),
      action: () => params.openDashboardTab('finance'),
    },
    {
      id: 'cmd-dash-diary',
      label: '대쉬보드: 일정 대쉬보드 탭 열기',
      shortcut: getShortcutLabel('dashboard_diary'),
      action: () => params.openDashboardTab('diary'),
    },
    {
      id: 'cmd-settings',
      label: '대쉬보드: 설정 대쉬보드 탭 열기 (.myLore/setting.json)',
      shortcut: getShortcutLabel('open_settings'),
      action: () => params.openDashboardTab('settings'),
    },
    {
      id: 'cmd-f11-viewer',
      label: `보기: F11 뷰어 켜기/끄기 (${
        params.appSettings.f11ViewerMode === 'detached'
          ? '전용 독립 뷰어'
          : '병렬 뷰어'
      })`,
      shortcut: getShortcutLabel('toggle_viewer'),
      action: () => void params.handleToggleF11Viewer(),
    },
  ];

  return {
    shortcutsModalOpen,
    setShortcutsModalOpen,
    helpSearchQuery,
    setHelpSearchQuery,
    recordingShortcutTarget,
    setRecordingShortcutTarget,
    altPressed,
    setAltPressed,
    keybindings,
    setKeybindings,
    filteredKeybindings,
    getShortcutLabel,
    commandItems,
  };
}
