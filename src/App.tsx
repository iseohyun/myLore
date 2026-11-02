/**
 * @file App.tsx
 * @description 최상위 컴포넌트 진입점(`App`: 독립 뷰어 분기) 및 9개 도메인 훅·24개 UI 컴포넌트를 조합하는 레이아웃 오케스트레이터(`MainApp`).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ApprovalCategory,
  CallApprovalItem,
  ContextMenuState,
  OpenDocumentTab,
  PaletteMode,
  RightSidebarTab,
  SettingsCategory,
  ViewMode,
} from './types/mylore';
import { getCallApprovalItems } from './services/tauriClient';
import { DetachedPreviewWindowView } from './components/window/DetachedPreviewWindowView';
import { StatusBar } from './components/footer/StatusBar';
import { LogTerminalDrawer } from './components/footer/LogTerminalDrawer';
import { ContextMenus } from './components/modals/ContextMenus';
import { CommandPaletteModal } from './components/modals/CommandPaletteModal';
import { CalendarNewDocModal } from './components/modals/CalendarNewDocModal';
import { ShortcutsHelpModal } from './components/modals/ShortcutsHelpModal';
import { DocumentModals } from './components/modals/DocumentModals';
import { DiaryDashboard } from './components/dashboards/DiaryDashboard';
import { LifelogDashboard } from './components/dashboards/LifelogDashboard';
import { FinanceDashboard } from './components/dashboards/FinanceDashboard';
import { SettingsDashboard } from './components/dashboards/SettingsDashboard';
import { ApprovalDashboard } from './components/dashboards/ApprovalDashboard';
import { AppHeader } from './components/header/AppHeader';
import { DocumentWorkspace } from './components/editor/DocumentWorkspace';
import { RightSidebar } from './components/sidebar/RightSidebar';
import { useFileTree } from './hooks/useFileTree';
import { useLifelogAudio } from './hooks/useLifelogAudio';
import { useDocuments } from './hooks/useDocuments';
import { useDocumentActions } from './hooks/useDocumentActions';
import { useEditorCommands } from './hooks/useEditorCommands';
import { useDetachedPreviewAndSettings } from './hooks/useDetachedPreviewAndSettings';
import { useLifelogAndFinance } from './hooks/useLifelogAndFinance';
import { useAppStartup } from './hooks/useAppStartup';
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDINGS_STORAGE_KEY,
  useKeybindings,
} from './hooks/useKeybindings';

function MainApp() {
  // 다중 문서 탭 상태 (열린 문서 탭 목록 + 현재 활성 탭 경로)
  const [openTabs, setOpenTabs] = useState<OpenDocumentTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  const activeTab = useMemo(
    () => openTabs.find((t) => t.doc.fullPath === activeTabPath) || null,
    [openTabs, activeTabPath]
  );
  const currentDoc = activeTab?.doc || null;
  const yamlText = activeTab?.yamlText ?? '';
  const bodyText = activeTab?.bodyText ?? '';
  const isDirty = activeTab?.isDirty ?? false;

  const setBodyText = (updater: string | ((prev: string) => string)) => {
    if (!activeTabPath) return;
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.doc.fullPath !== activeTabPath) return tab;
        const nextBody =
          typeof updater === 'function' ? updater(tab.bodyText) : updater;
        return { ...tab, bodyText: nextBody, isDirty: true };
      })
    );
  };

  const setYamlText = (nextYaml: string) => {
    if (!activeTabPath) return;
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.doc.fullPath === activeTabPath
          ? { ...tab, yamlText: nextYaml, isDirty: true }
          : tab
      )
    );
  };

  // 레이아웃 쉘 상태
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightSidebarTab>('tree');
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>('folders');
  const [approvalCategory, setApprovalCategory] =
    useState<ApprovalCategory>('call_scripts');
  const [approvalStageFilter, setApprovalStageFilter] = useState<
    'pending' | 'revising' | 'verified' | 'all'
  >('pending');
  const [approvalItems, setApprovalItems] = useState<CallApprovalItem[]>([]);
  const [selectedApprovalStem, setSelectedApprovalStem] = useState<
    string | null
  >(null);
  const reloadApprovalItems = useCallback(async () => {
    const items = await getCallApprovalItems();
    setApprovalItems(items);
    return items;
  }, []);
  const [menuBarExpanded, setMenuBarExpanded] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('closed');
  const [paletteQuery, setPaletteQuery] = useState('');
  const [isFolderPaneFocused, setIsFolderPaneFocused] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [logTerminalOpen, setLogTerminalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    '준비 완료 — F1: 도움말 | F2: 제목변경 | F3/F4: 이전/다음 선택 | F5: UUID 재스캔 | F10: 메뉴 | F11: 뷰어 토글(독립/병렬) | F12: 개발자모드'
  );

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  const lastEditorKeyPressMsRef = useRef<number>(0);

  const baseCtx = {
    openTabs,
    setOpenTabs,
    activeTabPath,
    setActiveTabPath,
    activeTab,
    currentDoc,
    yamlText,
    bodyText,
    isDirty,
    setBodyText,
    setYamlText,
    viewMode,
    setViewMode,
    rightSidebarOpen,
    setRightSidebarOpen,
    rightTab,
    setRightTab,
    settingsCategory,
    setSettingsCategory,
    approvalCategory,
    setApprovalCategory,
    approvalStageFilter,
    setApprovalStageFilter,
    approvalItems,
    setApprovalItems,
    selectedApprovalStem,
    setSelectedApprovalStem,
    reloadApprovalItems,
    menuBarExpanded,
    setMenuBarExpanded,
    activeMenu,
    setActiveMenu,
    activeSubMenu,
    setActiveSubMenu,
    paletteMode,
    setPaletteMode,
    paletteQuery,
    setPaletteQuery,
    isFolderPaneFocused,
    setIsFolderPaneFocused,
    contextMenu,
    setContextMenu,
    logTerminalOpen,
    setLogTerminalOpen,
    statusMessage,
    setStatusMessage,
    editorRef,
    previewPaneRef,
    lastEditorKeyPressMsRef,
  };

  // 1. 파일 트리 및 캘린더 훅
  const tree = useFileTree({ currentDoc, bodyText, yamlText });

  // 2. 통화 녹음 오디오 재생 및 스크립트 큐 동기화 훅
  const audio = useLifelogAudio(baseCtx);

  // 3. 문서 탭 / 저장 / 열기 훅
  const docs = useDocuments({ ...baseCtx, ...tree });

  // 4. 문서 이름 변경 / 생성 / 승격 / 휴지통 액션 훅
  const docActions = useDocumentActions({ ...baseCtx, ...tree, ...docs });

  // 5. 모바일 라이프로그 / Gemini API / 가계부 훅
  const lifelog = useLifelogAndFinance({
    ...baseCtx,
    ...tree,
    ...audio,
    ...docs,
  });

  // 6. 에디터 명령 및 검색 훅
  const editorCmds = useEditorCommands({ ...baseCtx, ...tree, ...docs });

  // 7. 독립 뷰어 창 및 앱 설정 훅
  const previewSettings = useDetachedPreviewAndSettings({
    ...baseCtx,
    ...audio,
    ...docs,
    ...lifelog,
  });

  // 8. 초기 로드, 세션 복원 및 Tauri 실시간 이벤트 리스너 훅
  useAppStartup({
    ...baseCtx,
    ...tree,
    ...docs,
    ...docActions,
    ...lifelog,
    ...previewSettings,
  });

  // 9. 전역 단축키 및 명령어 팔레트 항목 훅
  const kb = useKeybindings({
    ...baseCtx,
    ...docs,
    ...docActions,
    ...editorCmds,
    ...previewSettings,
  });

  const ctx = {
    ...baseCtx,
    ...tree,
    ...audio,
    ...docs,
    ...docActions,
    ...lifelog,
    ...editorCmds,
    ...previewSettings,
    ...kb,
  };

  return (
    <div
      className="mylore-app"
      onClick={() => {
        setActiveMenu(null);
        setActiveSubMenu(null);
        setContextMenu(null);
        lifelog.setMobileContextMenu(null);
      }}
    >
      {/* 1. 상단 헤더: 3선 아이콘(☰) + 메뉴 + 열린 문서 탭 바 */}
      <AppHeader {...ctx} />

      {/* 2. 메인 바디 영역 */}
      <div className="workspace-body">
        <main
          className="main-stage"
          onMouseDown={() => setIsFolderPaneFocused(false)}
        >
          {activeTabPath === 'mylore://dashboard/diary' ? (
            <DiaryDashboard {...ctx} />
          ) : activeTabPath === 'mylore://dashboard/lifelog' ? (
            <LifelogDashboard {...ctx} />
          ) : activeTabPath === 'mylore://dashboard/finance' ? (
            <FinanceDashboard {...ctx} />
          ) : activeTabPath === 'mylore://dashboard/settings' ? (
            <SettingsDashboard {...ctx} />
          ) : activeTabPath === 'mylore://dashboard/logs' ? (
            <ApprovalDashboard {...ctx} />
          ) : (
            <DocumentWorkspace {...ctx} />
          )}
        </main>

        {/* 3. 우측 사이드바 */}
        <RightSidebar {...ctx} />
      </div>

      {/* 4. 통합 로그 터미널 드로어 (Ctrl+`) 및 하단 상태 표시줄 */}
      <LogTerminalDrawer {...ctx} />
      <StatusBar {...ctx} />

      {/* 5. 우클릭 컨텍스트 메뉴 (파일 트리 / 탭 바 / 모바일 라이프로그) */}
      <ContextMenus {...ctx} />

      {/* 6. 명령어 팔레트 / 빠른 파일 열기 모달 */}
      <CommandPaletteModal {...ctx} />

      {/* 7. 파일 > 새 파일 > 새 일정 (달력 UI 모달) */}
      <CalendarNewDocModal {...ctx} />

      {/* 8. F1 도움말 (단축키 설정 변경) 모달 */}
      <ShortcutsHelpModal
        {...ctx}
        defaultKeybindings={DEFAULT_KEYBINDINGS}
        keybindingsStorageKey={KEYBINDINGS_STORAGE_KEY}
      />

      {/* 9. 문서 관련 모달 (제목 변경, 줄 이동, 새 프로젝트, 프로젝트 승격, 볼트 템플릿) */}
      <DocumentModals {...ctx} />
    </div>
  );
}

export default function App() {
  const isDetachedPreviewWindow = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('detachedPreview') === '1' ||
      params.get('detached_preview') === '1'
    );
  }, []);
  if (isDetachedPreviewWindow) {
    return <DetachedPreviewWindowView />;
  }
  return <MainApp />;
}
