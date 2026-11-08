/**
 * @file App.tsx
 * @description 최상위 컴포넌트 진입점(`App`: 독립 뷰어 분기) 및 도메인 훅·UI 컴포넌트를 조합하는 레이아웃 오케스트레이터(`MainApp`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityBarItemId,
  ApprovalCategory,
  CallApprovalItem,
  ContextMenuState,
  FileOpenPanePolicy,
  LifelogSourceType,
  LinkOpenPanePolicy,
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
import { HelpDashboard } from './components/dashboards/HelpDashboard';
import { LoginDashboard } from './components/dashboards/LoginDashboard';
import { AppHeader } from './components/header/AppHeader';
import { SplitDocumentWorkspace } from './components/editor/SplitDocumentWorkspace';
import { ActivityBar } from './components/sidebar/ActivityBar';
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

const LIFELOG_ACTIVITY_IDS = new Set<string>([
  'call',
  'sms',
  'kakaotalk',
  'recording',
  'media',
  'contacts',
  'pc_log',
  'notification',
  'health',
  'location',
]);

function MainApp() {
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
  const [activityBarOpen, setActivityBarOpen] = useState(true);
  const [activeActivityItem, setActiveActivityItem] =
    useState<ActivityBarItemId>('projects');
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightSidebarTab>('tree');
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>('basic');
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
    '준비 완료 — F1: 단축키 | F2: 제목변경 | F3/F4: 이전/다음 선택 | F5: UUID 재스캔 | F10: 메뉴 | F11: 뷰어 토글'
  );

  // 분할 화면 파일/링크 열림 정책 스냅샷
  const [defaultFileOpenPane, setDefaultFileOpenPane] =
    useState<FileOpenPanePolicy>('left');
  const [linkOpenPane, setLinkOpenPane] =
    useState<LinkOpenPanePolicy>('unfocused');

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
    activityBarOpen,
    setActivityBarOpen,
    activeActivityItem,
    setActiveActivityItem,
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
    defaultFileOpenPane,
    linkOpenPane,
  };

  const tree = useFileTree({ currentDoc, bodyText, yamlText });
  const audio = useLifelogAudio(baseCtx);
  const docs = useDocuments({ ...baseCtx, ...tree });
  const docActions = useDocumentActions({ ...baseCtx, ...tree, ...docs });
  const lifelog = useLifelogAndFinance({
    ...baseCtx,
    ...tree,
    ...audio,
    ...docs,
  });
  const editorCmds = useEditorCommands({ ...baseCtx, ...tree, ...docs });
  const previewSettings = useDetachedPreviewAndSettings({
    ...baseCtx,
    ...audio,
    ...docs,
    ...lifelog,
  });

  useEffect(() => {
    setDefaultFileOpenPane(
      previewSettings.appSettings.defaultFileOpenPane || 'left'
    );
    setLinkOpenPane(
      previewSettings.appSettings.linkOpenPane || 'unfocused'
    );
  }, [
    previewSettings.appSettings.defaultFileOpenPane,
    previewSettings.appSettings.linkOpenPane,
  ]);

  useAppStartup({
    ...baseCtx,
    ...tree,
    ...docs,
    ...docActions,
    ...lifelog,
    ...previewSettings,
  });

  const kb = useKeybindings({
    ...baseCtx,
    ...docs,
    ...docActions,
    ...editorCmds,
    ...previewSettings,
  });

  // activeTabPath 변경 시 액티비티 바 아이콘 및 오른쪽 사이드바 상태 자동 동기화
  useEffect(() => {
    if (!activeTabPath) return;
    if (activeTabPath.startsWith('mylore://dashboard/')) {
      const dash = activeTabPath.replace('mylore://dashboard/', '');
      if (dash === 'logs') setActiveActivityItem('approval');
      else if (dash === 'lifelog') setActiveActivityItem('call');
      else if (LIFELOG_ACTIVITY_IDS.has(dash)) {
        const src = dash as LifelogSourceType;
        setActiveActivityItem(src);
        lifelog.setMobileSidebarTab(src);
      } else if (
        dash === 'finance' ||
        dash === 'diary' ||
        dash === 'settings' ||
        dash === 'login' ||
        dash === 'help'
      ) {
        setActiveActivityItem(dash);
      }
      return;
    }
    if (currentDoc?.role === 'diary') {
      setActiveActivityItem('diary');
      return;
    }
    const norm = activeTabPath.replace(/\\/g, '/').toLowerCase();
    if (norm.includes('/mobile/calls/')) {
      setActiveActivityItem('call');
      lifelog.setMobileSidebarTab('call');
    } else if (norm.includes('/mobile/sms/')) {
      setActiveActivityItem('sms');
      lifelog.setMobileSidebarTab('sms');
    } else if (norm.includes('/mobile/kakao/')) {
      setActiveActivityItem('kakaotalk');
      lifelog.setMobileSidebarTab('kakaotalk');
    } else if (norm.includes('/mobile/recordings/')) {
      setActiveActivityItem('recording');
      lifelog.setMobileSidebarTab('recording');
    } else if (norm.includes('/mobile/notifications/')) {
      setActiveActivityItem('notification');
      lifelog.setMobileSidebarTab('notification');
    } else if (norm.includes('/mobile/health/')) {
      setActiveActivityItem('health');
      lifelog.setMobileSidebarTab('health');
    } else {
      setActiveActivityItem('projects');
    }
  }, [activeTabPath, currentDoc?.role]);

  const handleSelectActivityBarItem = (item: ActivityBarItemId) => {
    setActiveActivityItem(item);
    setRightSidebarOpen(true);

    if (item === 'approval') {
      docs.openDashboardTab('logs');
    } else if (item === 'projects') {
      tree.setActiveTreeRoleTab('projects');
      void editorCmds.handleGotoRootMainMd();
    } else if (item === 'diary') {
      tree.setActiveTreeRoleTab('diary');
      docs.openDashboardTab('diary');
    } else if (LIFELOG_ACTIVITY_IDS.has(item)) {
      const src = item as LifelogSourceType;
      lifelog.setMobileSidebarTab(src);
      lifelog.setMobileSourceFilter(src);
      docs.openDashboardTab(src);
      void lifelog.refreshAllLifelogMessages();
    } else if (
      item === 'finance' ||
      item === 'settings' ||
      item === 'login' ||
      item === 'help'
    ) {
      docs.openDashboardTab(item);
    }
  };

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

  const renderDashboardPane = (dashPath: string) => {
    const dash = dashPath.replace('mylore://dashboard/', '');
    if (dash === 'diary') return <DiaryDashboard {...ctx} />;
    if (dash === 'finance') return <FinanceDashboard {...ctx} />;
    if (dash === 'settings') return <SettingsDashboard {...ctx} />;
    if (dash === 'logs') return <ApprovalDashboard {...ctx} />;
    if (dash === 'help') return <HelpDashboard {...ctx} />;
    if (dash === 'login') return <LoginDashboard {...ctx} />;
    if (dash === 'lifelog' || LIFELOG_ACTIVITY_IDS.has(dash)) {
      const src = (dash === 'lifelog' ? 'call' : dash) as LifelogSourceType;
      return <LifelogDashboard {...ctx} activeLifelogSource={src} />;
    }
    return <LifelogDashboard {...ctx} activeLifelogSource="call" />;
  };

  const pendingApprovalBadgeCount = useMemo(
    () => approvalItems.filter((i) => i.stage === 2).length,
    [approvalItems]
  );

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
      {/* 1. 상단 헤더: ☰ 메뉴 + ◧ 액티비티 바 토글 + 열린 문서 탭 바 + ◫ 오른쪽 사이드바 토글 */}
      <AppHeader {...ctx} />

      {/* 2. 메인 바디 영역: 왼쪽 액티비티 바 + 메인 스테이지(1단/2단 수평 분할) + 오른쪽 사이드바 */}
      <div className="workspace-body">
        {activityBarOpen && (
          <ActivityBar
            activeItem={activeActivityItem}
            onSelectItem={handleSelectActivityBarItem}
            totalApprovalPendingCount={pendingApprovalBadgeCount}
            hiddenItems={previewSettings.appSettings.activityBarHiddenItems || []}
            topOrder={previewSettings.appSettings.activityBarTopOrder}
            bottomOrder={previewSettings.appSettings.activityBarBottomOrder}
            onChangeActivityBarConfig={(patch) => {
              void previewSettings.handleUpdateAppSettings(patch);
            }}
          />
        )}

        <main
          className="main-stage"
          onMouseDown={() => setIsFolderPaneFocused(false)}
        >
          <SplitDocumentWorkspace
            {...ctx}
            renderDashboardPane={renderDashboardPane}
          />
        </main>

        {/* 3. 우측 사이드바 (현재 선택된 패널 단독 표시 + TOC 기본 제공 + 선택적 찾기 패널) */}
        <RightSidebar {...ctx} />
      </div>

      {/* 4. 통합 로그 터미널 드로어 및 하단 상태 표시줄 */}
      <LogTerminalDrawer {...ctx} />
      <StatusBar {...ctx} />

      {/* 5. 우클릭 컨텍스트 메뉴 */}
      <ContextMenus {...ctx} />

      {/* 6. 명령어 팔레트 / 빠른 파일 열기 모달 */}
      <CommandPaletteModal {...ctx} />

      {/* 7. 파일 > 새 파일 > 새 일정 (달력 UI 모달) */}
      <CalendarNewDocModal {...ctx} />

      {/* 8. F1 도움말 모달 */}
      <ShortcutsHelpModal
        {...ctx}
        defaultKeybindings={DEFAULT_KEYBINDINGS}
        keybindingsStorageKey={KEYBINDINGS_STORAGE_KEY}
      />

      {/* 9. 문서 관련 모달 */}
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
