import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import {
  BaseFolderConfig,
  BaseFolderRole,
  DetachedPreviewActionPayload,
  DetachedPreviewState,
  DetachedScrollPayload,
  DocumentPayload,
  FileNode,
  FinanceTransaction,
  GeminiApiKeyStatus,
  LifelogMessage,
  LifelogSourceType,
  MediaInboxItem,
  MobilePairingPayload,
  MobileSyncProgressPayload,
  MyLoreAppSettings,
  OpenDocumentTab,
  ScanProgressPayload,
  SearchMatchItem,
  TaskPriorityCode,
  ThemePresetId,
  TrashedFileRecord,
  VaultTemplateItem,
} from './types/mylore';
import {
  applyAppSettingsToDocument,
  createNewDocument,
  createTempMemo,
  DEFAULT_APP_SETTINGS,
  DEFAULT_BASE_FOLDERS,
  emitDetachedPreviewAction,
  FONT_FAMILY_PRESETS,
  getAllFinanceTransactions,
  getAllLifelogMessages,
  getAppSettings,
  getBaseFolders,
  getCallRecordingPlayInfo,
  getDetachedPreviewState,
  getGeminiApiKeyStatus,
  getLifelogForDate,
  getMobileContactsMap,
  getMobilePairingInfo,
  getMobileSyncProgressState,
  getScanProgress,
  getVaultTemplates,
  getVirtualTree,
  importFinanceRows,
  importKakaoChatText,
  moveDocumentToRole,
  openExternalUrlInChrome,
  openGoogleCalendarWeb,
  openInChromeAppMode,
  openLifelogItemDocument,
  openNativeFileDialog,
  openNativeFolderDialog,
  openRootMainMd,
  parseNotificationIntoFinance,
  promoteToProjectFolder,
  readDocument,
  readDocumentByUuid,
  removePairedMobileDevice,
  renameCurrentDocument,
  replaceInFiles,
  restoreTrashedDocument,
  retryPendingCallTranscriptions,
  saveAndVerifyGeminiApiKey,
  saveAppSettings,
  saveBaseFolders,
  saveDocument,
  searchInFiles,
  sendMobileUdpWakeBroadcast,
  setAutoCallTranscription,
  showInExplorer,
  startBatchUuidScan,
  syncDetachedPreviewScroll,
  syncDetachedPreviewState,
  takePendingCliFiles,
  THEME_PRESETS,
  toggleDetachedPreviewWindow,
  toggleWindowFullscreen,
  transcribeSingleCallItem,
  trashDocument,
  triggerFullMobileResync,
  updateMobilePairingConfig,
} from './services/tauriClient';
import {
  autoFormatMarkdownTasks,
  combineYamlAndBody,
  extractTasksFromBody,
  extractTocFromBody,
  GOOGLE_CALENDAR_COLOR_MAP,
  splitYamlFrontmatter,
  updateTaskStatusInBody,
} from './utils/markdownAutoFormat';
import {
  MarkdownPreviewRenderer,
  parseAudioOffsetSecondsFromLine,
  scrollPreviewPaneToSourceLine,
} from './utils/markdownRenderer';

type ViewMode =
  | 'split'
  | 'editor'
  | 'preview'
  | 'dashboard_projects'
  | 'dashboard_diary'
  | 'dashboard_finance'
  | 'dashboard_lifelog'
  | 'dashboard_settings';

type RightSidebarTab = 'tree' | 'search' | 'toc' | 'backlinks' | 'lifelog';
type PaletteMode = 'closed' | 'files' | 'commands';
type FolderSectionMode = 'open' | 'summary' | 'closed';

interface ArchiveTreeFolder {
  name: string;
  pathKey: string;
  folders: ArchiveTreeFolder[];
  files: FileNode[];
}

export interface KeybindingConfig {
  id: string;
  category: string;
  label: string;
  shortcut: string;
  secondaryShortcut: string;
  condition: string;
}

const KEYBINDINGS_STORAGE_KEY = 'mylore_keybindings_v7';

const DEFAULT_KEYBINDINGS: KeybindingConfig[] = [
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

const DETACHED_PREVIEW_CHANNEL = 'mylore_detached_preview_channel';

function DetachedPreviewWindowView() {
  const [previewState, setPreviewState] = useState<DetachedPreviewState>({
    title: '',
    relativePath: '',
    fullPath: '',
    role: '',
    bodyText: '',
    yamlText: '',
  });
  const previewStateRef = useRef(previewState);
  previewStateRef.current = previewState;
  const detachedPreviewPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getDetachedPreviewState()
      .then((initial) => {
        if (initial) setPreviewState(initial);
      })
      .catch(() => {});

    getAppSettings()
      .then((s) => {
        if (s) applyAppSettingsToDocument(s);
      })
      .catch(() => {});

    let unlisten: (() => void) | null = null;
    listen<DetachedPreviewState>('detached-preview-update', (event) => {
      if (event.payload) {
        setPreviewState(event.payload);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    let unlistenSettings: (() => void) | null = null;
    listen<MyLoreAppSettings>('app-settings-updated', (event) => {
      if (event.payload) {
        applyAppSettingsToDocument(event.payload);
      }
    })
      .then((fn) => {
        unlistenSettings = fn;
      })
      .catch(() => {});

    let unlistenScroll: (() => void) | null = null;
    listen<DetachedScrollPayload>('detached-preview-scroll', (event) => {
      if (event.payload) {
        scrollPreviewPaneToSourceLine(
          detachedPreviewPaneRef.current,
          event.payload.topLine,
          event.payload.scrollRatio
        );
      }
    })
      .then((fn) => {
        unlistenScroll = fn;
      })
      .catch(() => {});

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
      bc.onmessage = (ev) => {
        if (ev.data?.type === 'sync' && ev.data.payload) {
          setPreviewState(ev.data.payload);
        } else if (ev.data?.type === 'settings' && ev.data.settings) {
          applyAppSettingsToDocument(ev.data.settings);
        } else if (ev.data?.type === 'scroll') {
          scrollPreviewPaneToSourceLine(
            detachedPreviewPaneRef.current,
            Number(ev.data.topLine) || 0,
            Number(ev.data.scrollRatio) || 0
          );
        }
      };
    } catch {
      // ignore if BroadcastChannel unavailable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'F11' && !e.ctrlKey && !e.altKey && !e.shiftKey) ||
        e.key === 'Escape'
      ) {
        e.preventDefault();
        toggleDetachedPreviewWindow(previewStateRef.current, false).catch(
          () => {}
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (unlisten) unlisten();
      if (unlistenSettings) unlistenSettings();
      if (unlistenScroll) unlistenScroll();
      if (bc) bc.close();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleCloseDetached = () => {
    toggleDetachedPreviewWindow(previewStateRef.current, false).catch(() => {});
  };

  return (
    <div
      className="mylore-app"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
    >
      <header
        className="top-menubar"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 14px',
          minHeight: '40px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="help-category-badge">
            🪟 전용 독립 뷰어 ({previewState.role ? previewState.role.toUpperCase() : 'PREVIEW'})
          </span>
          <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
            {previewState.title || previewState.relativePath || '열린 문서 없음'}
          </strong>
          {previewState.relativePath && (
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
              ({previewState.relativePath})
            </span>
          )}
        </div>
        <button
          className="toolbar-btn"
          onClick={handleCloseDetached}
          title="전용 독립 뷰어 창을 닫습니다 (F11 또는 Esc)"
        >
          ✕ 독립 뷰어 닫기 (F11)
        </button>
      </header>

      <div
        ref={detachedPreviewPaneRef}
        className="markdown-preview-pane rendered-md"
        style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}
      >
        {previewState.fullPath || previewState.bodyText ? (
          <MarkdownPreviewRenderer
            bodyText={previewState.bodyText}
            onNavigateUuid={(targetUuid) => {
              emitDetachedPreviewAction({
                actionType: 'open-uuid',
                uuid: targetUuid,
              }).catch(() => {});
              try {
                const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
                bc.postMessage({ type: 'open-uuid', uuid: targetUuid });
                bc.close();
              } catch {
                // ignore
              }
            }}
            onOpenExternalUrl={(url) => {
              openExternalUrlInChrome(url);
            }}
            onUpdateTaskStatus={(lineIdx, nextCode) => {
              setPreviewState((prev) => ({
                ...prev,
                bodyText: updateTaskStatusInBody(
                  prev.bodyText,
                  lineIdx,
                  nextCode
                ),
              }));
              emitDetachedPreviewAction({
                actionType: 'toggle-task',
                lineIndex: lineIdx,
                nextCode,
              }).catch(() => {});
              try {
                const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
                bc.postMessage({
                  type: 'toggle-task',
                  lineIndex: lineIdx,
                  nextCode,
                });
                bc.close();
              } catch {
                // ignore
              }
            }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            메인 창에서 문서를 선택하면 실시간 미리보기가 이곳에 동기화됩니다.
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const isDetachedPreviewWindow = useMemo(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('detachedPreview') === '1',
    []
  );
  if (isDetachedPreviewWindow) {
    return <DetachedPreviewWindowView />;
  }
  const [baseFolders, setBaseFolders] =
    useState<BaseFolderConfig[]>(DEFAULT_BASE_FOLDERS);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeFilter, setTreeFilter] = useState('');

  // 폴더 목록 섹션별 토글 상태 (프로젝트: 열기/요약/닫기, 일기: 열기/요약/닫기, 아카이브: 요약/닫기, Git: 열기/요약/닫기)
  const [sectionModes, setSectionModes] = useState<
    Record<BaseFolderRole, FolderSectionMode>
  >({
    projects: 'summary',
    diary: 'summary',
    data: 'summary',
    git: 'summary',
  });
  // 아카이브(data) 파일트리에서 현재 열린 상위 폴더 경로 집합 (특정 파일 엑세스 시 해당 경로만 자동 오픈, 수동 닫기만 지원)
  const [openArchiveFolders, setOpenArchiveFolders] = useState<Set<string>>(
    () => new Set()
  );
  // 아카이브 폴더 내 5개 초과 항목 '...' 더보기 클릭으로 전체 펼침된 폴더 키 집합
  const [expandedArchiveMore, setExpandedArchiveMore] = useState<Set<string>>(
    () => new Set()
  );
  // 프로젝트(projects) 폴더 트리에서 현재 열린 폴더 경로 집합 (열린 프로젝트 위주로 자동 오픈)
  const [openProjectFolders, setOpenProjectFolders] = useState<Set<string>>(
    () => new Set()
  );
  // 각 프로젝트 main.md 뷰어 하단 하위 문서(Sub-MD) 필터 및 보기 스타일
  const [subDocFilter, setSubDocFilter] = useState('');
  const [subDocViewStyle, setSubDocViewStyle] = useState<'cards' | 'table'>(
    'cards'
  );

  // 다중 문서 탭 상태 (열린 문서 탭 목록 + 현재 활성 탭 경로 + 최근 엑세스 순서 히스토리 MRU)
  const [openTabs, setOpenTabs] = useState<OpenDocumentTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [tabAccessHistory, setTabAccessHistory] = useState<string[]>([]);
  const tabAccessHistoryRef = useRef<string[]>([]);
  const isSessionRestoredRef = useRef<boolean>(false);

  // 활성 탭이 변경될 때마다 MRU(가장 마지막에 엑세스된 파일/대쉬보드) 히스토리 갱신
  useEffect(() => {
    if (!activeTabPath) return;
    setTabAccessHistory((prev) => {
      const next = [...prev.filter((p) => p !== activeTabPath), activeTabPath];
      tabAccessHistoryRef.current = next;
      return next;
    });
  }, [activeTabPath]);

  const activeTab = useMemo(
    () => openTabs.find((t) => t.doc.fullPath === activeTabPath) || null,
    [openTabs, activeTabPath]
  );
  const currentDoc = activeTab?.doc || null;
  const yamlText = activeTab?.yamlText ?? '';
  const bodyText = activeTab?.bodyText ?? '';
  const isDirty = activeTab?.isDirty ?? false;

  const [isYamlVisible, setIsYamlVisible] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [appSettings, setAppSettings] =
    useState<MyLoreAppSettings>(DEFAULT_APP_SETTINGS);

  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [detachedPreviewOpen, setDetachedPreviewOpen] = useState(false);
  const preDetachedViewModeRef = useRef<'split' | 'editor' | 'preview'>('editor');
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightSidebarTab>('tree');

  // 3선 메뉴(☰) 및 상단 메뉴바 상태 (F10 기본 닫힘, setting.json에서 변경 가능), Alt 배지 상태
  const [menuBarExpanded, setMenuBarExpanded] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);
  const [altPressed, setAltPressed] = useState(false);

  // 명령어 팔레트
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('closed');
  const [paletteQuery, setPaletteQuery] = useState('');

  // 문서 내 찾기/바꾸기 바 상태
  const [findBarMode, setFindBarMode] = useState<'closed' | 'find' | 'replace'>('closed');
  const [docFindQuery, setDocFindQuery] = useState('');
  const [docReplaceText, setDocReplaceText] = useState('');

  // 전체 파일에서 찾기/바꾸기 상태 (우측 사이드바 🔍 연동)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalReplaceText, setGlobalReplaceText] = useState('');
  const [globalReplaceMode, setGlobalReplaceMode] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<SearchMatchItem[]>([]);
  const [activeSearchIdx, setActiveSearchIdx] = useState<number>(0);

  // 편집점(커서/문서 이동) 히스토리 및 북마크 줄 목록 (Alt+ArrowLeft / Alt+ArrowRight 지원)
  const [editHistory, setEditHistory] = useState<Array<{ path: string; offset: number }>>([]);
  const [editHistoryIdx, setEditHistoryIdx] = useState<number>(-1);
  const editHistoryRef = useRef<Array<{ path: string; offset: number }>>([]);
  const editHistoryIdxRef = useRef<number>(-1);
  const isNavigatingEditHistoryRef = useRef<boolean>(false);
  const [selectedLifelogMsgId, setSelectedLifelogMsgId] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<Array<{ path: string; line: number }>>([]);
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0);

  // 편집 위치(파일 + 커서 오프셋)를 히스토리 스택에 기록
  const recordEditPosition = (
    path: string,
    offset: number,
    forceNewStep = false
  ) => {
    if (!path || isNavigatingEditHistoryRef.current) return;
    const curHist = editHistoryRef.current;
    const curIdx = editHistoryIdxRef.current;
    const base =
      curIdx >= 0 && curIdx < curHist.length
        ? curHist.slice(0, curIdx + 1)
        : [...curHist];
    const last = base[base.length - 1];

    if (last && last.path === path) {
      if (!forceNewStep && Math.abs(last.offset - offset) < 80) {
        // 같은 문서의 인접 위치에서 연속 타이핑 시 마지막 히스토리 오프셋을 최신으로 갱신
        base[base.length - 1] = { path, offset };
        editHistoryRef.current = base;
        setEditHistory([...base]);
        return;
      }
      if (last.offset === offset) {
        return;
      }
    }

    const next = [...base, { path, offset }].slice(-60);
    const nextIdx = next.length - 1;
    editHistoryRef.current = next;
    editHistoryIdxRef.current = nextIdx;
    setEditHistory(next);
    setEditHistoryIdx(nextIdx);
  };

  // 휴지통 이동 되돌리기(Undo) 히스토리 및 폴더 인터페이스 포커스 상태
  const [trashHistory, setTrashHistory] = useState<TrashedFileRecord[]>([]);
  const [isFolderPaneFocused, setIsFolderPaneFocused] = useState(false);

  // 모달 상태들
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [helpSearchQuery, setHelpSearchQuery] = useState('');
  const [recordingShortcutTarget, setRecordingShortcutTarget] = useState<{
    id: string;
    field: 'shortcut' | 'secondaryShortcut';
  } | null>(null);
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

  // F2 현재 문서 제목 변경 모달
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameTitleInput, setRenameTitleInput] = useState('');

  // 새 프로젝트 / 새 일정(달력 UI) 모달
  const [newDocModalOpen, setNewDocModalOpen] = useState(false);
  const [newDocRole, setNewDocRole] = useState<BaseFolderRole>('projects');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocDate, setNewDocDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [newDocCalendar, setNewDocCalendar] = useState('개발');
  const [newDocLocation, setNewDocLocation] = useState('거제집');
  const [newDocTemplate, setNewDocTemplate] = useState('project_main.md');
  const [vaultTemplates, setVaultTemplates] = useState<VaultTemplateItem[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);

  // 새 일정 달력 모달 (`파일 > 새 파일 > 새 일정`)
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
  const [calendarYearMonth, setCalendarYearMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  // 줄 이동 모달 (`이동 > 줄 이동`)
  const [gotoLineModalOpen, setGotoLineModalOpen] = useState(false);
  const [gotoLineInput, setGotoLineInput] = useState('1');

  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [promoteProjectName, setPromoteProjectName] = useState('');

  // 우클릭 컨텍스트 메뉴 (`탐색기에서 보기` 등)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetPath: string;
    targetUuid?: string;
    targetName: string;
  } | null>(null);

  const [scanProgress, setScanProgress] =
    useState<ScanProgressPayload | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    '준비 완료 — F1: 도움말 | F2: 제목변경 | F3/F4: 이전/다음 선택 | F5: UUID 재스캔 | F10: 메뉴 | F11: 뷰어 토글(독립/병렬) | F12: 개발자모드'
  );

  // 라이프로그 & 3단계 금융 자동화 상태
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [dailyMessages, setDailyMessages] = useState<LifelogMessage[]>([]);
  const [dailyTransactions, setDailyTransactions] = useState<
    FinanceTransaction[]
  >([]);
  const [, setDailyMedia] = useState<MediaInboxItem[]>([]);
  const [allTransactions, setAllTransactions] = useState<FinanceTransaction[]>(
    []
  );

  const [simNotiTitle, setSimNotiTitle] = useState('[신한카드] 승인 안내');
  const [simNotiText, setSimNotiText] = useState(
    '[일시불] 18,000원 진대원흥남국밥 10/28 12:35 누적 452,000원'
  );
  const [simKakaoRoom, setSimKakaoRoom] = useState('거제 해풍단 단톡방');
  const [simKakaoRaw, setSimKakaoRaw] = useState(
    `--------------- 2026년 10월 28일 수요일 ---------------\n[진대원] [오후 12:10] 오늘 점심 흥남국밥 어떠신가요?\n[이서현] [오후 12:12] 좋습니다! 12시 반에 뵙겠습니다.`
  );
  const [reconcileResultMsg, setReconcileResultMsg] = useState('');

  // 모바일 연동(myLore Sync) QR 코드 페어링 및 상태 관리
  const [mobilePairing, setMobilePairing] =
    useState<MobilePairingPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [ssidInputText, setSsidInputText] = useState('iseohyun, seohyun5G');
  const [geminiStatus, setGeminiStatus] =
    useState<GeminiApiKeyStatus | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [isVerifyingGemini, setIsVerifyingGemini] = useState(false);
  const [awaitingClipboardKey, setAwaitingClipboardKey] = useState(false);
  const [directCallPlayInfo, setDirectCallPlayInfo] = useState<{
    audioUrl: string;
    fullPath: string;
    fileName: string;
    contactDisplay: string;
    autoPlay?: boolean;
  } | null>(null);
  const [activeAudioLineIndex, setActiveAudioLineIndex] = useState<number | null>(
    null
  );
  const docTabsBarRef = useRef<HTMLDivElement | null>(null);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastEditorKeyPressMsRef = useRef<number>(0);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const [isTranscribingSingleCall, setIsTranscribingSingleCall] =
    useState(false);

  // 라이프로그 수집 대쉬보드 2개 탭 (설정 | 휴대폰데이터) 및 휴대폰 데이터 사이드바 상태 (금융은 별도 대쉬보드 탭으로 분리)
  const [lifelogDashboardTab, setLifelogDashboardTab] = useState<
    'settings' | 'mobile'
  >('settings');
  const [mobileSidebarTab, setMobileSidebarTab] = useState<LifelogSourceType>(
    'kakaotalk'
  );
  const [allLifelogMessages, setAllLifelogMessages] = useState<
    LifelogMessage[]
  >([]);
  const [mobilePersonFilter, setMobilePersonFilter] = useState<string>('');
  const [mobileSourceFilter, setMobileSourceFilter] = useState<
    'all' | LifelogSourceType
  >('all');
  const [mobileSyncProgress, setMobileSyncProgress] =
    useState<MobileSyncProgressPayload | null>(null);
  const [financeSubTab, setFinanceSubTab] = useState<'all' | 'card' | 'bank'>(
    'all'
  );
  const [mobileContextMenu, setMobileContextMenu] = useState<{
    x: number;
    y: number;
    personName: string;
    sourceKey: LifelogSourceType;
    sourceLabel: string;
    messageItem: LifelogMessage;
  } | null>(null);
  const [contactsMap, setContactsMap] = useState<Record<string, string>>({});
  const [smsRawEditMode, setSmsRawEditMode] = useState<boolean>(false);
  const [isRetryingCalls, setIsRetryingCalls] = useState<boolean>(false);
  const smsBubbleScrollRef = useRef<HTMLDivElement | null>(null);

  const normalizePhoneDigits = (raw: string): string => {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.startsWith('8210') && digits.length === 12) {
      return `0${digits.slice(2)}`;
    }
    if (digits.startsWith('82') && digits.length >= 11) {
      return `0${digits.slice(2)}`;
    }
    return digits;
  };

  // 전화번호를 기본으로 하되, 연락처 주소록에 이미 저장된 번호라면 저장된 이름을 반환하며
  // `이름_전화번호_날짜` 포맷일 경우 전화번호와 날짜를 제거하고 순수 `이름`만 추출합니다.
  const resolveContactName = (rawNumberOrName: string): string => {
    let s = (rawNumberOrName || '')
      .trim()
      .replace(/^(통화\s*녹음[_\s]*|Call_)/i, '')
      .replace(/\s*\([0-9+\-\s]{7,}\)\s*$/, '')
      .replace(/_(\d{8})_(\d{6})$/, '')
      .replace(/_(\d{6})_(\d{6})$/, '')
      .replace(/_(\d{8,14})$/, '')
      .trim();
    if (!s) return '알수없음';

    if (s.includes('_')) {
      const parts = s
        .split('_')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        const first = parts[0];
        const firstDigits = normalizePhoneDigits(first);
        const isFirstPhone =
          firstDigits.length >= 7 && /^[0-9+\-]+$/.test(first);
        if (!isFirstPhone) {
          return contactsMap[first] || first;
        }
        if (contactsMap[first]) return contactsMap[first];
        if (contactsMap[firstDigits]) return contactsMap[firstDigits];
        return first;
      }
    }

    if (contactsMap[s]) return contactsMap[s];
    const digits = normalizePhoneDigits(s);
    if (digits.length >= 8 && contactsMap[digits]) {
      return contactsMap[digits];
    }
    return s;
  };

  // 현재 편집/열람 중인 모바일 문서의 카테고리('kakaotalk' | 'notification' | 'sms' | 'call' | 'recording' | 'health' | null) 판별
  const currentDocMobileSource = useMemo<LifelogSourceType | null>(() => {
    if (!currentDoc) return null;
    const cat = (currentDoc.frontmatter['category'] || '').toLowerCase();
    const fp = currentDoc.fullPath;
    if (
      cat === 'mobile/recordings' ||
      /[\\/]mobile[\\/]recordings[\\/]/i.test(fp)
    ) {
      return 'recording';
    }
    if (cat === 'mobile/health' || /[\\/]mobile[\\/]health[\\/]/i.test(fp)) {
      return 'health';
    }
    if (cat === 'mobile/calls' || /[\\/]mobile[\\/]calls[\\/]/i.test(fp)) {
      return 'call';
    }
    if (cat === 'mobile/sms' || /[\\/]mobile[\\/]sms[\\/]/i.test(fp)) {
      return 'sms';
    }
    if (cat === 'mobile/kakao' || /[\\/]mobile[\\/]kakao[\\/]/i.test(fp)) {
      return 'kakaotalk';
    }
    if (
      cat === 'mobile/notifications' ||
      /[\\/]mobile[\\/]notifications[\\/]/i.test(fp)
    ) {
      return 'notification';
    }
    return null;
  }, [currentDoc?.fullPath, currentDoc?.frontmatter]);

  const isCurrentDocMobileLifelog = Boolean(currentDocMobileSource);
  const isCurrentDocSms = currentDocMobileSource === 'sms';
  const isCurrentDocCall =
    currentDocMobileSource === 'call' || currentDocMobileSource === 'recording';

  // 라이프로그 대쉬보드(설정 탭이든 휴대폰데이터 탭이든 무관)가 활성화되었거나
  // 모바일 라이프로그(카톡/알림/문자/통화/녹음/헬스) 문서를 에디터 영역에서 열람 중일 때 6탭 사이드바 유지
  const isMobileDataSidebarMode =
    activeTabPath === 'mylore://dashboard/lifelog' ||
    viewMode === 'dashboard_lifelog' ||
    isCurrentDocMobileLifelog;

  // 현재 열람/편집 중인 모바일 문서에 해당하는 사이드바 항목인지 판별
  const isLifelogMessageMatchingCurrentDoc = (msg: LifelogMessage): boolean => {
    if (!currentDoc || !currentDocMobileSource) return false;
    if (msg.source !== currentDocMobileSource) return false;

    const docFileName = currentDoc.fullPath.split(/[\\/]/).pop() || '';
    const docStem = docFileName.replace(/\.md$/i, '').trim();
    const fmContact = (currentDoc.frontmatter['contact_name'] || '').trim();
    const fmPhone = (currentDoc.frontmatter['phone_number'] || '').trim();
    const fmAudio = (currentDoc.frontmatter['audio_file'] || '').trim();

    const stripCallDecorations = (s: string) =>
      (s || '')
        .replace(/^#+/, '')
        .replace(/\s*\([^)]*\)/g, '')
        .trim();

    if (msg.source === 'call' || msg.source === 'recording') {
      const rawAtt = (msg.attachmentUuid || '')
        .replace(/^transcribed:/, '')
        .replace(/^pending_transcript:/, '')
        .trim();
      if (fmAudio && rawAtt && rawAtt === fmAudio) return true;
      const attStem = rawAtt.replace(/\.(m4a|mp3|amr|wav|ogg|aac)$/i, '').trim();
      if (attStem && (attStem === docStem || docStem.includes(attStem))) {
        return true;
      }

      if (msg.source === 'recording') {
        const msgRoom = (msg.roomOrSender || '').trim();
        return Boolean(
          docStem &&
            (msgRoom === docStem ||
              docStem.includes(msgRoom) ||
              msgRoom.includes(docStem))
        );
      }

      const rawTarget =
        msg.sender && msg.sender !== '통화녹음' && !msg.sender.includes('통화')
          ? msg.sender
          : msg.roomOrSender;
      const msgContact = stripCallDecorations(resolveContactName(rawTarget));
      const msgRawContact = stripCallDecorations(rawTarget);

      const stemContact = stripCallDecorations(
        docStem
          .replace(/^통화\s*녹음\s*/i, '')
          .replace(/_\d{6}_\d{6}$/, '')
          .replace(/_\d{14}$/, '')
      );
      const docContact = stripCallDecorations(fmContact || stemContact);
      const resolvedDocContact = stripCallDecorations(
        resolveContactName(docContact)
      );

      if (
        docContact &&
        (msgContact === docContact ||
          msgContact === resolvedDocContact ||
          msgRawContact === docContact ||
          (normalizePhoneDigits(rawTarget).length >= 8 &&
            normalizePhoneDigits(rawTarget) === normalizePhoneDigits(docContact)))
      ) {
        return true;
      }
      return false;
    }

    if (msg.source === 'sms') {
      const msgTarget = (msg.roomOrSender || msg.sender || '').trim();
      const msgResolved = resolveContactName(msgTarget).trim();
      const msgDigits = normalizePhoneDigits(msgTarget);
      const docDigits = normalizePhoneDigits(fmPhone || docStem);

      if (
        msgDigits.length >= 8 &&
        docDigits.length >= 8 &&
        msgDigits === docDigits
      ) {
        return true;
      }
      if (
        (fmContact && (msgResolved === fmContact || msgTarget === fmContact)) ||
        (docStem && (msgResolved === docStem || msgTarget === docStem))
      ) {
        return true;
      }
      return false;
    }

    if (msg.source === 'kakaotalk') {
      const room = (msg.roomOrSender || msg.sender || '').trim();
      const safeRoom = room.replace(/[\\/:*?"<>|]/g, '_').trim();
      return (
        Boolean(docStem) &&
        (room === docStem || safeRoom === docStem || docStem.includes(room))
      );
    }

    if (msg.source === 'notification' || msg.source === 'health') {
      const ym = docStem.slice(0, 7);
      return Boolean(ym) && msg.sentDate.startsWith(ym);
    }

    return false;
  };

  const refreshAllLifelogMessages = async () => {
    try {
      const [msgs, cMap] = await Promise.all([
        getAllLifelogMessages(4000),
        getMobileContactsMap().catch(() => ({})),
      ]);
      setAllLifelogMessages(msgs);
      setContactsMap(cMap);
    } catch (e) {
      console.error(e);
    }
  };

  // 통화녹음이나 문자·카톡·알림 파일이 편집/활성화되면 사이드바를 열고 해당 리스트 탭으로 자동 전환
  useEffect(() => {
    if (currentDocMobileSource) {
      setRightSidebarOpen(true);
      setMobileSidebarTab(currentDocMobileSource);
    }
  }, [currentDoc?.fullPath, currentDocMobileSource]);

  useEffect(() => {
    if (
      activeTabPath === 'mylore://dashboard/lifelog' ||
      isMobileDataSidebarMode
    ) {
      setRightSidebarOpen(true);
      refreshAllLifelogMessages();
    }
  }, [activeTabPath, isMobileDataSidebarMode]);

  // 활성화된 파일(모바일 라이프로그 또는 일반 폴더 트리 문서)의 사이드바 목록 위치로 자동 스크롤
  useEffect(() => {
    if (!rightSidebarOpen || !currentDoc) return;
    const timer = setTimeout(() => {
      const sidebarEl = document.querySelector(
        '.right-sidebar .sidebar-content'
      );
      if (!sidebarEl) return;
      const targetEl = sidebarEl.querySelector(
        '[data-sidebar-active="true"], .tree-node-row.active'
      ) as HTMLElement | null;
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 90);
    return () => clearTimeout(timer);
  }, [
    currentDoc?.fullPath,
    currentDocMobileSource,
    mobileSidebarTab,
    isMobileDataSidebarMode,
    rightSidebarOpen,
    rightTab,
    allLifelogMessages.length,
  ]);

  const scrollEditorAndPreviewToLatest = () => {
    setTimeout(() => {
      if (smsBubbleScrollRef.current) {
        smsBubbleScrollRef.current.scrollTop =
          smsBubbleScrollRef.current.scrollHeight;
      }
      if (editorRef.current) {
        editorRef.current.scrollTop = editorRef.current.scrollHeight;
      }
      if (previewPaneRef.current) {
        previewPaneRef.current.scrollTop = previewPaneRef.current.scrollHeight;
      }
    }, 60);
  };

  useEffect(() => {
    if (isCurrentDocMobileLifelog) {
      scrollEditorAndPreviewToLatest();
    }
  }, [currentDoc?.fullPath, isCurrentDocMobileLifelog, isCurrentDocSms, smsRawEditMode]);

  // 편집기 상단 제목 탭 바(.doc-tabs-bar)에서 현재 활성화된 문서 탭이 항상 보이도록 부드럽게 스크롤 애니메이션 수행
  useEffect(() => {
    if (!activeTabPath || !docTabsBarRef.current) return;
    const timer = setTimeout(() => {
      const barEl = docTabsBarRef.current;
      if (!barEl) return;
      const activeTabEl = barEl.querySelector(
        '[data-tab-active="true"]'
      ) as HTMLElement | null;
      if (activeTabEl) {
        activeTabEl.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [activeTabPath, openTabs.length]);

  const loadCallAudioIntoStatusBar = async (
    roomOrSender: string,
    attachmentUuid?: string,
    autoPlay = false,
    seekSec?: number
  ) => {
    try {
      const info = await getCallRecordingPlayInfo({
        roomOrSender,
        attachmentUuid,
      });
      let playUrl = info.audioUrl;
      if (info.audioBase64) {
        try {
          const binStr = atob(info.audioBase64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) {
            bytes[i] = binStr.charCodeAt(i);
          }
          const blob = new Blob([bytes], {
            type: info.mimeType || 'audio/mp4',
          });
          playUrl = URL.createObjectURL(blob);
        } catch (e) {
          console.error('Base64 오디오 디코딩 실패, URL 폴백:', e);
        }
      }
      if (typeof seekSec === 'number' && seekSec >= 0) {
        pendingSeekSecondsRef.current = seekSec;
      } else {
        pendingSeekSecondsRef.current = null;
      }
      setDirectCallPlayInfo((prev) => {
        if (prev?.audioUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(prev.audioUrl);
        }
        return {
          audioUrl: playUrl,
          fullPath: info.fullPath,
          fileName: info.fileName,
          contactDisplay: info.contactDisplay,
          autoPlay,
        };
      });
    } catch {
      // 오디오 파일이 없는 기록인 경우 무시
    }
  };

  // 통화/음성 문서가 열릴 때 하단 상태바에 오디오 재생바 자동 준비
  useEffect(() => {
    if (!currentDoc || !isCurrentDocCall) {
      setActiveAudioLineIndex(null);
      return;
    }
    const fmAudio = (currentDoc.frontmatter['audio_file'] || '').trim();
    if (!fmAudio) return;
    const audioFileName = fmAudio.replace(/^audio[\\/]/i, '').trim();
    const audioStem = audioFileName
      .replace(/\.(m4a|mp3|amr|wav|ogg|aac)$/i, '')
      .trim();
    if (
      directCallPlayInfo &&
      (directCallPlayInfo.fileName === audioFileName ||
        directCallPlayInfo.fullPath.endsWith(audioFileName))
    ) {
      return;
    }
    loadCallAudioIntoStatusBar(
      audioStem || currentDoc.frontmatter['contact_name'] || '',
      `transcribed:${audioStem}`,
      false
    );
  }, [currentDoc?.fullPath, isCurrentDocCall]);

  // 현재 문서 본문(`bodyText`) 내 `[00:00:00]` 오프셋 시각이 포함된 문장 목록 파싱
  const audioScriptCues = useMemo(() => {
    if (!isCurrentDocCall || !bodyText) return [];
    const lines = bodyText.replace(/\r\n/g, '\n').split('\n');
    const rawCues: Array<{
      lineIndex: number;
      startSec: number;
      endSec: number;
      charStart: number;
      charEnd: number;
    }> = [];
    let charCursor = 0;
    let inScriptSec = false;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const trimmed = line.trim();
      const lineCharStart = charCursor;
      const lineCharEnd = charCursor + line.length;
      charCursor = lineCharEnd + 1;

      if (/^#{1,4}\s+.*스크립트/.test(trimmed)) {
        inScriptSec = true;
        continue;
      }
      if (/^#{1,3}\s+/.test(trimmed) && !trimmed.includes('스크립트')) {
        inScriptSec = false;
      }
      if (!inScriptSec && !trimmed.startsWith('-') && !trimmed.startsWith('*')) {
        continue;
      }
      const sec = parseAudioOffsetSecondsFromLine(trimmed);
      if (sec !== null) {
        rawCues.push({
          lineIndex: idx,
          startSec: sec,
          endSec: Number.POSITIVE_INFINITY,
          charStart: lineCharStart,
          charEnd: lineCharEnd,
        });
      }
    }

    for (let i = 0; i < rawCues.length - 1; i++) {
      rawCues[i].endSec = Math.max(
        rawCues[i].startSec + 0.5,
        rawCues[i + 1].startSec
      );
    }
    return rawCues;
  }, [bodyText, isCurrentDocCall]);

  // 오디오 재생 중 시각(`currentTime`)에 해당하는 스크립트 문장을 자동 Select 및 스크롤 추적
  const handleAudioTimeUpdate = () => {
    const audioEl = callAudioRef.current;
    if (!audioEl || audioScriptCues.length === 0) return;
    const curSec = audioEl.currentTime;
    let matchedCue = audioScriptCues[0];
    for (const cue of audioScriptCues) {
      if (curSec >= cue.startSec) {
        matchedCue = cue;
      } else {
        break;
      }
    }
    if (!matchedCue || curSec < audioScriptCues[0].startSec) return;

    if (activeAudioLineIndex !== matchedCue.lineIndex) {
      setActiveAudioLineIndex(matchedCue.lineIndex);

      // 1) 프리뷰 영역에서 해당 문장 부드럽게 스크롤 표시
      if (previewPaneRef.current) {
        const targetNode = previewPaneRef.current.querySelector(
          `[data-audio-line="${matchedCue.lineIndex}"]`
        ) as HTMLElement | null;
        if (targetNode) {
          targetNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      // 2) 에디터 영역에서 사용자가 타이핑 중이 아닐 때 해당 문장 줄 자동 Select 및 스크롤
      if (
        editorRef.current &&
        !audioEl.paused &&
        Date.now() - lastEditorKeyPressMsRef.current > 2000
      ) {
        const ta = editorRef.current;
        const totalLines = Math.max(1, bodyText.split('\n').length);
        const ratio = matchedCue.lineIndex / totalLines;
        const targetScrollTop = Math.max(
          0,
          ratio * ta.scrollHeight - ta.clientHeight * 0.4
        );
        ta.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
        if (document.activeElement !== ta || viewMode === 'editor') {
          try {
            ta.setSelectionRange(matchedCue.charStart, matchedCue.charEnd);
          } catch {
            // ignore selection error
          }
        }
      }
    }
  };

  // 사용자가 스크립트의 특정 문장을 클릭/선택했을 때 해당 오프셋 시각으로 즉시 이동하여 재생
  const handleSeekAudioTime = async (seconds: number, lineIndex: number) => {
    setActiveAudioLineIndex(lineIndex);
    const audioEl = callAudioRef.current;
    if (audioEl && directCallPlayInfo) {
      audioEl.currentTime = seconds;
      audioEl.play().catch(() => {});
      return;
    }
    if (currentDoc && isCurrentDocCall) {
      const fmAudio = (currentDoc.frontmatter['audio_file'] || '')
        .replace(/^audio[\\/]/i, '')
        .replace(/\.(m4a|mp3|amr|wav|ogg|aac)$/i, '')
        .trim();
      await loadCallAudioIntoStatusBar(
        fmAudio || currentDoc.frontmatter['contact_name'] || '',
        fmAudio ? `transcribed:${fmAudio}` : undefined,
        true,
        seconds
      );
    }
  };

  const handleSelectLifelogSidebarItem = async (msg: LifelogMessage) => {
    try {
      setSelectedLifelogMsgId(msg.id);
      const doc = await openLifelogItemDocument({
        source: msg.source,
        roomOrSender: msg.roomOrSender,
        attachmentUuid: msg.attachmentUuid,
        sentDate: msg.sentDate,
      });
      await refreshTree();

      if (msg.source === 'sms') {
        setSmsRawEditMode(false);
      }

      if (
        (msg.source === 'call' || msg.source === 'recording') &&
        msg.hasAudioRecording
      ) {
        loadCallAudioIntoStatusBar(
          msg.roomOrSender,
          msg.attachmentUuid,
          false
        );
      }

      const split = splitYamlFrontmatter(doc.rawContent);
      const lines = split.body.split('\n');
      const lastLineNumber = Math.max(1, lines.length);

      // 편집기 및 뷰어에서 가장 최근(하단) 기록으로 즉시 스크롤 이동
      applyLoadedDocument(doc, { lineNumber: lastLineNumber });
      scrollEditorAndPreviewToLatest();
    } catch (err) {
      setStatusMessage(`라이프로그 문서 열기 실패: ${String(err)}`);
    }
  };

  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const refreshMobilePairingInfo = async () => {
    try {
      const info = await getMobilePairingInfo();
      setMobilePairing(info);
      setSsidInputText(info.ssids.join(', '));
      const gStat = await getGeminiApiKeyStatus();
      setGeminiStatus(gStat);
      await refreshAllLifelogMessages();
    } catch (e) {
      console.error(e);
    }
  };

  // 방식 1: AI Studio에서 키를 복사한 뒤 myLore 창으로 돌아오거나 입력창에 붙여넣기(onPaste)할 때 자동 감지 및 등록
  const tryRegisterGeminiKeyString = async (rawCandidate: string) => {
    const match = rawCandidate.match(/(?:AIzaSy[0-9A-Za-z_-]{33}|AQ\.[0-9A-Za-z._-]{25,})/);
    const extracted = match ? match[0] : rawCandidate.trim();
    if (!extracted) {
      setStatusMessage('⚠️ 입력되거나 클립보드에 복사된 Gemini API 키가 없습니다.');
      return false;
    }
    try {
      setIsVerifyingGemini(true);
      setStatusMessage('🔄 백그라운드에서 Gemini Flash API 키 유효성 검증 중 (화면 조작이 멈추지 않습니다)...');
      const stat = await saveAndVerifyGeminiApiKey(extracted);
      setGeminiStatus(stat);
      setGeminiKeyInput('');
      setAwaitingClipboardKey(false);
      const okMsg = `✅ Gemini API 키 검증 및 보안 등록 완료! (${stat.maskedKey}, 모델: ${stat.modelName} — 통화 녹음 수신 시 자동 스크립트화 활성화됨)`;
      setStatusMessage(okMsg);
      setReconcileResultMsg(okMsg);
      return true;
    } catch (err) {
      const errMsg = `❌ Gemini API 키 검증 실패: ${String(err)}`;
      setStatusMessage(errMsg);
      setReconcileResultMsg(errMsg);
      return false;
    } finally {
      setIsVerifyingGemini(false);
    }
  };

  useEffect(() => {
    if (!awaitingClipboardKey) return;
    const onFocusWindow = async () => {
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText && /(?:AIzaSy[0-9A-Za-z_-]{33}|AQ\.[0-9A-Za-z._-]{25,})/.test(clipText)) {
          await tryRegisterGeminiKeyString(clipText);
        }
      } catch {
        // clipboard read permission ignored on focus
      }
    };
    window.addEventListener('focus', onFocusWindow);
    return () => window.removeEventListener('focus', onFocusWindow);
  }, [awaitingClipboardKey]);

  useEffect(() => {
    if (!mobilePairing) return;
    // QR 코드는 항상 Base64 Deep-Link (myloresync://pair?data=<Base64>) 만 제공
    QRCode.toDataURL(mobilePairing.qrBase64, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('QR 생성 오류:', err));
  }, [mobilePairing]);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  // 설정(글꼴, 크기, 테마, 색상) 변경 시 즉시 문서 루트(:root) CSS 변수에 반영
  useEffect(() => {
    applyAppSettingsToDocument(appSettings);
  }, [appSettings]);

  const getShortcutLabel = (id: string): string => {
    return keybindings.find((k) => k.id === id)?.shortcut || '';
  };

  // 현재 활성 탭의 본문/YAML 수정 헬퍼
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

  // 자동 저장 (Auto-Save checked 시 1.2초 디바운스 자동 저장 — 가상 대쉬보드 탭은 제외)
  useEffect(() => {
    if (
      !autoSaveEnabled ||
      !activeTab ||
      !activeTab.isDirty ||
      activeTab.doc.fullPath.startsWith('mylore://dashboard/')
    )
      return;
    const timer = setTimeout(async () => {
      try {
        const combined = combineYamlAndBody(
          activeTab.yamlText,
          activeTab.bodyText
        );
        const saved = await saveDocument(activeTab.doc.fullPath, combined);
        setOpenTabs((prev) =>
          prev.map((t) =>
            t.doc.fullPath === saved.fullPath
              ? { ...t, doc: saved, isDirty: false }
              : t
          )
        );
        setStatusMessage(`✓ 자동 저장됨: ${saved.relativePath}`);
      } catch (e) {
        console.error(e);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, activeTab?.bodyText, activeTab?.yamlText, activeTab?.isDirty]);

  // 외부 탐색기(.md 기본 연결 프로그램)에서 전달된 파일들을 에디터 전용 모드('editor')로 오픈
  const openCliFilesInEditorMode = async (filePaths: string[]) => {
    if (!filePaths || filePaths.length === 0) return;
    let lastLoaded: DocumentPayload | null = null;
    for (const fp of filePaths) {
      try {
        const doc = await readDocument(fp);
        applyLoadedDocument(doc);
        lastLoaded = doc;
      } catch (err) {
        setStatusMessage(`외부 .md 파일 열기 오류 (${fp}): ${String(err)}`);
      }
    }
    if (lastLoaded) {
      setViewMode('editor');
      await refreshTree();
      setStatusMessage(
        `✏️ 편집 모드로 열림: ${lastLoaded.relativePath} (${lastLoaded.fullPath})`
      );
      setTimeout(() => {
        editorRef.current?.focus();
      }, 60);
    }
  };

  const buildVirtualDashboardTab = (fullPath: string): OpenDocumentTab | null => {
    const dashType = fullPath.replace('mylore://dashboard/', '') as
      | 'lifelog'
      | 'finance'
      | 'diary'
      | 'settings';
    const titleMap: Record<'lifelog' | 'finance' | 'diary' | 'settings', string> = {
      lifelog: '📱 라이프로그',
      finance: '💳 금융',
      diary: '📅 일정',
      settings: '⚙️ 설정',
    };
    const label = titleMap[dashType];
    if (!label) return null;
    return {
      doc: {
        uuid: `dashboard-${dashType}`,
        fullPath,
        relativePath: label,
        role: 'projects',
        rawContent: '',
        yamlRaw: '',
        bodyContent: '',
        frontmatter: { title: label, summary: label },
        contentHash: '',
        backlinks: [],
      },
      yamlText: '',
      bodyText: '',
      isDirty: false,
    };
  };

  // 열린 탭 목록, 엑세스 히스토리(MRU), 가장 마지막에 활성화된 파일/대쉬보드를 localStorage에 지속 저장
  useEffect(() => {
    if (!isSessionRestoredRef.current) return;
    try {
      const sessionPayload = {
        openTabPaths: openTabs.map((t) => t.doc.fullPath),
        tabAccessHistory,
        activeTabPath,
        lifelogDashboardTab,
      };
      localStorage.setItem(
        'mylore_editor_session_v1',
        JSON.stringify(sessionPayload)
      );
    } catch {
      // ignore storage quota errors
    }
  }, [openTabs, tabAccessHistory, activeTabPath, lifelogDashboardTab]);

  // 초기 로드 및 Tauri 실시간 스캔 프로그레스 / 외부 .md 파일 열기 / 모바일 동기화 이벤트 리스너 등록
  useEffect(() => {
    let unlistenScanFn: (() => void) | null = null;
    let unlistenCliOpenFn: (() => void) | null = null;
    let unlistenMobileSyncFn: (() => void) | null = null;
    let unlistenMobileProgFn: (() => void) | null = null;
    (async () => {
      try {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          unlistenScanFn = await listen<ScanProgressPayload>(
            'uuid-scan-progress',
            (event) => {
              const p = event.payload;
              setScanProgress(p);
              if (p.phase === 'done') {
                setStatusMessage(
                  `✅ 일괄 스캔 완료: 총 ${p.totalFiles}개 중 기등록 ${p.alreadyRegistered}개 스킵(${p.startPercent.toFixed(1)}% 시작) → 미등록 ${p.pendingFiles}개 처리 완료 (신규 UUID 주입: ${p.uuidsInjected}개)`
                );
                refreshTree();
              } else {
                setStatusMessage(
                  `🔄 일괄 UUID 주입 중 (${p.currentPercent.toFixed(1)}%): 기등록 ${p.alreadyRegistered}개 건너뜀(${p.startPercent.toFixed(1)}%에서 시작) | 남은 파일 처리 중: ${p.currentFile}`
                );
              }
            }
          );

          unlistenCliOpenFn = await listen<string[]>(
            'cli-open-files',
            async (event) => {
              // 큐 비우기 및 전달받은 .md 파일들을 에디터 전용 모드로 즉시 오픈
              await takePendingCliFiles().catch(() => []);
              await openCliFilesInEditorMode(event.payload);
            }
          );

          let syncRefreshTimer: ReturnType<typeof setTimeout> | null = null;
          unlistenMobileSyncFn = await listen<{
            eventType?: string;
            type?: string;
            message: string;
            count?: number;
          }>('mobile-sync-event', (event) => {
            const p = event.payload;
            setStatusMessage(p.message);
            setReconcileResultMsg(p.message);
            // 백그라운드 워커 스레드에서 동기화 사이클이 완전히 종료되었을 때만 메인 데이터/DB 조회를 1회 실행 (통신 중 과부하 원천 차단)
            const evType = p.type || p.eventType || '';
            if (
              evType === 'sync_cycle_complete' ||
              evType === 'paired' ||
              evType === 'call_transcript_completed'
            ) {
              if (syncRefreshTimer) clearTimeout(syncRefreshTimer);
              syncRefreshTimer = setTimeout(() => {
                void refreshMobilePairingInfo();
                void refreshAllLifelogMessages();
                void refreshFinanceData();
                void loadLifelogForDate(selectedDateRef.current);
              }, 350);
            }
          });

          unlistenMobileProgFn = await listen<MobileSyncProgressPayload>(
            'mobile-sync-progress',
            (event) => {
              const p = event.payload;
              setMobileSyncProgress(p);
              const curStep =
                p.steps[p.currentStepIndex] || p.steps[p.steps.length - 1];
              if (p.isRunning && curStep) {
                const qBadge =
                  (p.queuedJobs ?? 0) > 0
                    ? ` | 워커 큐 대기: ${p.queuedJobs}건`
                    : '';
                setStatusMessage(
                  `📡 [${p.currentStepIndex + 1}/${p.totalSteps}] ${p.currentLabel} (${p.currentPercent}%) — 기보유 스킵(파란색): ${curStep.skippedCount}건 | 신규 다운로드(녹색): ${curStep.downloadedCount}건${qBadge}`
                );
              }
            }
          );
        }
        const loadedSettings = await getAppSettings();
        setAppSettings(loadedSettings);
        setAutoSaveEnabled(loadedSettings.autoSaveEnabled);
        setMenuBarExpanded(Boolean(loadedSettings.defaultMenuBarExpanded));
        if (
          loadedSettings.defaultEditorViewMode === 'editor' ||
          loadedSettings.defaultEditorViewMode === 'split' ||
          loadedSettings.defaultEditorViewMode === 'preview'
        ) {
          setViewMode(loadedSettings.defaultEditorViewMode);
          preDetachedViewModeRef.current = loadedSettings.defaultEditorViewMode;
        }

        const folders = await getBaseFolders();
        setBaseFolders(folders);
        await refreshTree();
        await refreshFinanceData();
        await refreshMobilePairingInfo();
        const tpls = await getVaultTemplates();
        setVaultTemplates(tpls);
        const initialProg = await getScanProgress();
        if (initialProg.totalFiles > 0) {
          setScanProgress(initialProg);
        }

        // 프로그램 시작 시 CLI 인자로 전달된 .md 파일이 있으면 즉시 편집 모드('editor')로 열기
        const initialCliFiles = await takePendingCliFiles();
        if (initialCliFiles.length > 0) {
          await openCliFilesInEditorMode(initialCliFiles);
        } else {
          // 이전 세션의 열린 탭 및 가장 마지막에 엑세스된 파일 또는 대쉬보드를 복원하여 활성화
          let restoredAny = false;
          try {
            const rawSession = localStorage.getItem('mylore_editor_session_v1');
            if (rawSession) {
              const parsed = JSON.parse(rawSession) as {
                openTabPaths?: string[];
                tabAccessHistory?: string[];
                activeTabPath?: string | null;
                lifelogDashboardTab?: 'settings' | 'mobile';
              };
              if (
                parsed.lifelogDashboardTab === 'settings' ||
                parsed.lifelogDashboardTab === 'mobile'
              ) {
                setLifelogDashboardTab(parsed.lifelogDashboardTab);
              }
              const pathsToOpen = Array.isArray(parsed.openTabPaths)
                ? parsed.openTabPaths
                : [];
              const restoredTabs: OpenDocumentTab[] = [];
              for (const fp of pathsToOpen) {
                if (!fp || restoredTabs.some((t) => t.doc.fullPath === fp)) {
                  continue;
                }
                if (fp.startsWith('mylore://dashboard/')) {
                  const vTab = buildVirtualDashboardTab(fp);
                  if (vTab) restoredTabs.push(vTab);
                } else {
                  try {
                    const doc = await readDocument(fp);
                    const split = splitYamlFrontmatter(doc.rawContent);
                    restoredTabs.push({
                      doc,
                      yamlText: split.yamlRaw,
                      bodyText: split.body,
                      isDirty: false,
                    });
                  } catch {
                    // 삭제되었거나 이동된 파일은 건너뜀
                  }
                }
              }
              if (restoredTabs.length > 0) {
                const validPaths = new Set(
                  restoredTabs.map((t) => t.doc.fullPath)
                );
                const validHistory = (
                  Array.isArray(parsed.tabAccessHistory)
                    ? parsed.tabAccessHistory
                    : []
                ).filter((p) => validPaths.has(p));
                const lastActive =
                  parsed.activeTabPath && validPaths.has(parsed.activeTabPath)
                    ? parsed.activeTabPath
                    : validHistory.length > 0
                      ? validHistory[validHistory.length - 1]
                      : restoredTabs[restoredTabs.length - 1].doc.fullPath;
                const finalHistory = [
                  ...validHistory.filter((p) => p !== lastActive),
                  lastActive,
                ];
                tabAccessHistoryRef.current = finalHistory;
                setTabAccessHistory(finalHistory);
                setOpenTabs(restoredTabs);
                setActiveTabPath(lastActive);
                restoredAny = true;
              }
            }
          } catch (e) {
            console.error('세션 복원 오류:', e);
          }

          if (!restoredAny) {
            try {
              const rootDoc = await openRootMainMd();
              applyLoadedDocument(rootDoc);
            } catch {
              // ignore if root main.md cannot be created
            }
          }
        }
        isSessionRestoredRef.current = true;
      } catch (err) {
        isSessionRestoredRef.current = true;
        console.error(err);
      }
    })();
    return () => {
      if (unlistenScanFn) unlistenScanFn();
      if (unlistenCliOpenFn) unlistenCliOpenFn();
      if (unlistenMobileSyncFn) unlistenMobileSyncFn();
      if (unlistenMobileProgFn) unlistenMobileProgFn();
    };
  }, []);

  // 백그라운드 동기화 워커가 동작 중일 때 메인 프로그램은 인메모리 진행 상태만 가볍게 모니터링
  useEffect(() => {
    if (!mobileSyncProgress?.isRunning) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const state = await getMobileSyncProgressState().catch(() => null);
      if (cancelled || !state) return;
      setMobileSyncProgress(state);
      if (!state.isRunning && state.isCompleted) {
        void refreshAllLifelogMessages();
        void refreshMobilePairingInfo();
      }
    }, 600);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [mobileSyncProgress?.isRunning]);

  // 선택된 문서의 날짜 또는 기본 날짜가 바뀔 때 라이프로그 갱신
  useEffect(() => {
    const docDate =
      currentDoc?.frontmatter['date'] ||
      currentDoc?.frontmatter['start'] ||
      currentDoc?.relativePath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ||
      selectedDate;
    if (docDate && /^\d{4}-\d{2}-\d{2}$/.test(docDate)) {
      setSelectedDate(docDate);
      loadLifelogForDate(docDate);
    }
  }, [currentDoc]);

  const loadLifelogForDate = async (dateStr: string) => {
    try {
      const res = await getLifelogForDate(dateStr);
      setDailyMessages(res.messages);
      setDailyTransactions(res.transactions);
      setDailyMedia(res.mediaInbox);
    } catch (e) {
      console.error(e);
    }
  };

  const refreshFinanceData = async () => {
    try {
      const txs = await getAllFinanceTransactions();
      setAllTransactions(txs);
    } catch (e) {
      console.error(e);
    }
  };

  const refreshTree = async () => {
    try {
      const nodes = await getVirtualTree();
      setFileTree(nodes);
    } catch (e) {
      console.error(e);
    }
  };

  // 모든 파일 평탄화
  const flattenedFiles = useMemo(() => {
    const list: FileNode[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (!n.isDir) list.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(fileTree);
    return list;
  }, [fileTree]);

  // 일기(Diary) 파일만 날짜순 정렬
  const diaryFilesSorted = useMemo(() => {
    return flattenedFiles
      .filter((f) => f.role === 'diary')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [flattenedFiles]);

  // 이번 주(월요일 ~ 일요일, ISO 주간 기준) 날짜 범위 계산
  const currentWeekRange = useMemo(() => {
    const now = new Date();
    const day = now.getDay(); // 0(일) ~ 6(토)
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + diffToMonday
    );
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6
    );
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
    return { start: fmt(monday), end: fmt(sunday) };
  }, []);

  // 아카이브(data) 문서가 엑세스(열람)되었을 때, 해당 파일까지의 상위 폴더 경로만 자동으로 열어줌
  useEffect(() => {
    if (!currentDoc || currentDoc.role !== 'data') return;
    const parts = currentDoc.relativePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 1) {
      setOpenArchiveFolders(new Set());
      return;
    }
    const nextOpen = new Set<string>();
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      nextOpen.add(acc);
    }
    setOpenArchiveFolders(nextOpen);
  }, [currentDoc?.fullPath, currentDoc?.role, currentDoc?.relativePath]);

  // 프로젝트(projects) 문서가 열렸을 때, 폴더 뷰어에서 해당 프로젝트 폴더 경로만 집중해서 자동으로 열어줌
  useEffect(() => {
    setSubDocFilter('');
    if (!currentDoc || currentDoc.role !== 'projects') return;
    const parts = currentDoc.relativePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 1) {
      setOpenProjectFolders(new Set());
      return;
    }
    const nextOpen = new Set<string>();
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      nextOpen.add(acc);
    }
    setOpenProjectFolders(nextOpen);
  }, [currentDoc?.fullPath, currentDoc?.role, currentDoc?.relativePath]);

  // 프로젝트 파일이 '최우선 프로젝트'인지 판별 (루트 main.md, YAML 최우선 상태, 또는 본문 내 - [!] 포함 여부)
  const isTopPriorityProjectNode = (node: FileNode): boolean => {
    if (node.relativePath.toLowerCase() === 'main.md') return true;
    if (currentDoc && currentDoc.fullPath === node.fullPath) {
      if (/^\s*[-*+]\s+\[[!>]\]\s+/m.test(bodyText)) return true;
      if (
        /^(?:status|priority)\s*:\s*"?(?:최우선|urgent|top|high|1|!)"?\s*$/im.test(
          yamlText
        )
      ) {
        return true;
      }
      return false;
    }
    return node.projectStatus === '최우선';
  };

  // 일기 파일이 '이번 주 일기'인지 판별
  const isThisWeekDiaryNode = (node: FileNode): boolean => {
    const dateStr =
      node.eventDate || node.name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
    if (!dateStr) return false;
    return dateStr >= currentWeekRange.start && dateStr <= currentWeekRange.end;
  };

  // 아카이브(data) 파일 목록으로 계층형 폴더 트리 구성
  const archiveRootTree = useMemo<ArchiveTreeFolder>(() => {
    const root: ArchiveTreeFolder = {
      name: '아카이브',
      pathKey: '',
      folders: [],
      files: [],
    };
    const filterLower = treeFilter.trim().toLowerCase();
    const archiveFiles = flattenedFiles.filter(
      (f) =>
        f.role === 'data' &&
        (filterLower === '' ||
          f.name.toLowerCase().includes(filterLower) ||
          f.relativePath.toLowerCase().includes(filterLower))
    );

    for (const file of archiveFiles) {
      const parts = file.relativePath.split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 1) {
        root.files.push(file);
        continue;
      }
      let curr = root;
      let accKey = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        accKey = accKey ? `${accKey}/${folderName}` : folderName;
        let nextFolder = curr.folders.find((fd) => fd.pathKey === accKey);
        if (!nextFolder) {
          nextFolder = {
            name: folderName,
            pathKey: accKey,
            folders: [],
            files: [],
          };
          curr.folders.push(nextFolder);
        }
        curr = nextFolder;
      }
      curr.files.push(file);
    }

    const sortTree = (folder: ArchiveTreeFolder) => {
      folder.folders.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      folder.files.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      for (const sub of folder.folders) {
        sortTree(sub);
      }
    };
    sortTree(root);
    return root;
  }, [flattenedFiles, treeFilter]);

  // 프로젝트(projects) 파일 목록으로 폴더 이름 기반 계층형 트리 구성
  const projectRootTree = useMemo<ArchiveTreeFolder>(() => {
    const root: ArchiveTreeFolder = {
      name: '프로젝트',
      pathKey: '',
      folders: [],
      files: [],
    };
    const filterLower = treeFilter.trim().toLowerCase();
    const projectFiles = flattenedFiles.filter(
      (f) =>
        f.role === 'projects' &&
        (filterLower === '' ||
          f.name.toLowerCase().includes(filterLower) ||
          f.relativePath.toLowerCase().includes(filterLower) ||
          (f.title || '').toLowerCase().includes(filterLower))
    );

    for (const file of projectFiles) {
      const parts = file.relativePath.split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 1) {
        root.files.push(file);
        continue;
      }
      let curr = root;
      let accKey = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        accKey = accKey ? `${accKey}/${folderName}` : folderName;
        let nextFolder = curr.folders.find((fd) => fd.pathKey === accKey);
        if (!nextFolder) {
          nextFolder = {
            name: folderName,
            pathKey: accKey,
            folders: [],
            files: [],
          };
          curr.folders.push(nextFolder);
        }
        curr = nextFolder;
      }
      curr.files.push(file);
    }

    const sortProjectTree = (folder: ArchiveTreeFolder) => {
      folder.folders.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      folder.files.sort((a, b) => {
        const aMain = a.name.toLowerCase() === 'main.md';
        const bMain = b.name.toLowerCase() === 'main.md';
        if (aMain && !bMain) return -1;
        if (!aMain && bMain) return 1;
        return a.name.localeCompare(b.name, 'ko');
      });
      for (const sub of folder.folders) {
        sortProjectTree(sub);
      }
    };
    sortProjectTree(root);
    return root;
  }, [flattenedFiles, treeFilter]);

  // Git(git) 파일 목록으로 저장소 폴더 이름 기반 계층형 트리 구성
  const gitRootTree = useMemo<ArchiveTreeFolder>(() => {
    const root: ArchiveTreeFolder = {
      name: 'Git',
      pathKey: 'git:',
      folders: [],
      files: [],
    };
    const filterLower = treeFilter.trim().toLowerCase();
    const gitFiles = flattenedFiles.filter(
      (f) =>
        f.role === 'git' &&
        (filterLower === '' ||
          f.name.toLowerCase().includes(filterLower) ||
          f.relativePath.toLowerCase().includes(filterLower) ||
          (f.title || '').toLowerCase().includes(filterLower))
    );

    for (const file of gitFiles) {
      const parts = file.relativePath.split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 1) {
        root.files.push(file);
        continue;
      }
      let curr = root;
      let accKey = 'git:';
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        accKey = `${accKey}/${folderName}`;
        let nextFolder = curr.folders.find((fd) => fd.pathKey === accKey);
        if (!nextFolder) {
          nextFolder = {
            name: folderName,
            pathKey: accKey,
            folders: [],
            files: [],
          };
          curr.folders.push(nextFolder);
        }
        curr = nextFolder;
      }
      curr.files.push(file);
    }

    const sortGitTree = (folder: ArchiveTreeFolder) => {
      folder.folders.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      folder.files.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      for (const sub of folder.folders) {
        sortGitTree(sub);
      }
    };
    sortGitTree(root);
    return root;
  }, [flattenedFiles, treeFilter]);

  // 현재 열람 중인 프로젝트 main.md의 하위 문서(Sub-MD) 목록 자동 추출
  const currentProjectSubDocs = useMemo<FileNode[]>(() => {
    if (!currentDoc || currentDoc.role !== 'projects') return [];
    const normRel = currentDoc.relativePath.replace(/\\/g, '/');
    const parts = normRel.split('/').filter(Boolean);
    const fileName = (parts[parts.length - 1] || '').toLowerCase();
    if (fileName !== 'main.md') return [];

    // 1) 루트 Projects/main.md 인 경우: 각 하위 프로젝트 폴더의 대표 문서(main.md 또는 첫 문서) 목록 반환
    if (parts.length === 1) {
      const list: FileNode[] = [];
      for (const subFolder of projectRootTree.folders) {
        const mainNode =
          subFolder.files.find((f) => f.name.toLowerCase() === 'main.md') ||
          subFolder.files[0];
        if (mainNode) {
          list.push(mainNode);
        }
      }
      return list;
    }

    // 2) 하위 프로젝트 폴더의 {프로젝트명}/main.md 인 경우: 해당 프로젝트 폴더 내부의 모든 하위 .md 문서 반환
    const folderPrefix = parts.slice(0, -1).join('/');
    return flattenedFiles
      .filter((f) => {
        if (f.role !== 'projects' || f.fullPath === currentDoc.fullPath) {
          return false;
        }
        const fRel = f.relativePath.replace(/\\/g, '/');
        return fRel.startsWith(`${folderPrefix}/`);
      })
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ko'));
  }, [currentDoc, flattenedFiles, projectRootTree]);

  // 프로젝트 폴더의 전체 하위 파일 수 및 최우선/활성 여부 계산 헬퍼
  const countFolderFiles = (folder: ArchiveTreeFolder): number => {
    return (
      folder.files.length +
      folder.folders.reduce((acc, sub) => acc + countFolderFiles(sub), 0)
    );
  };

  const isProjectFolderTopPriority = (folder: ArchiveTreeFolder): boolean => {
    if (folder.files.some(isTopPriorityProjectNode)) return true;
    return folder.folders.some(isProjectFolderTopPriority);
  };

  const isProjectFolderActive = (folder: ArchiveTreeFolder): boolean => {
    if (!currentDoc || currentDoc.role !== 'projects') return false;
    const normCur = currentDoc.relativePath.replace(/\\/g, '/');
    return normCur.startsWith(`${folder.pathKey}/`);
  };

  const toggleProjectFolderOpen = (
    pathKey: string,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    setOpenProjectFolders((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        for (const k of Array.from(next)) {
          if (k === pathKey || k.startsWith(`${pathKey}/`)) {
            next.delete(k);
          }
        }
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };

  // 프로젝트 폴더 이름 기반 계층형 트리 렌더링 (열기: 전체 프로젝트 폴더, 요약: 최우선 + 현재 열린 프로젝트 폴더 위주)
  const renderProjectFolderLevel = (
    folder: ArchiveTreeFolder,
    depth: number,
    mode: FolderSectionMode
  ): React.ReactNode => {
    const isFilterActive = treeFilter.trim() !== '';
    const visibleFolders =
      depth === 0 && mode === 'summary' && !isFilterActive
        ? folder.folders.filter(
            (sub) =>
              isProjectFolderTopPriority(sub) ||
              isProjectFolderActive(sub) ||
              openProjectFolders.has(sub.pathKey)
          )
        : folder.folders;

    const visibleRootFiles =
      depth === 0 && mode === 'summary' && !isFilterActive
        ? folder.files.filter(
            (f) =>
              isTopPriorityProjectNode(f) ||
              currentDoc?.fullPath === f.fullPath
          )
        : folder.files;

    return (
      <>
        {/* depth === 0 일 때 루트 파일(⭐ main.md)을 상단에 먼저 표시 */}
        {depth === 0 &&
          visibleRootFiles.map((node) => (
            <div
              key={node.fullPath}
              tabIndex={0}
              className={`tree-node-row ${
                currentDoc?.fullPath === node.fullPath ? 'active' : ''
              }`}
              style={{ paddingLeft: '8px' }}
              onClick={() => {
                setIsFolderPaneFocused(true);
                openDocumentByNode(node);
              }}
              onFocus={() => setIsFolderPaneFocused(true)}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsFolderPaneFocused(true);
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  targetPath: node.fullPath,
                  targetUuid: node.uuid,
                  targetName: node.relativePath,
                });
              }}
              title={`${node.fullPath}\n(루트 전체 프로젝트 마스터 | Del: 휴지통)`}
            >
              <div className="tree-node-label">
                <span>⭐</span>
                <span style={{ fontWeight: 700 }}>
                  {node.name === 'main.md'
                    ? 'main.md (전체 프로젝트 마스터)'
                    : node.name}
                </span>
              </div>
            </div>
          ))}

        {/* 프로젝트 하위 폴더 트리 (폴더 이름으로 표시) */}
        {visibleFolders.map((sub) => {
          const isOpen =
            openProjectFolders.has(sub.pathKey) || isFilterActive;
          const isActive = isProjectFolderActive(sub);
          const isPriority = isProjectFolderTopPriority(sub);
          const totalFiles = countFolderFiles(sub);
          const folderMainDoc = sub.files.find(
            (f) => f.name.toLowerCase() === 'main.md'
          );

          return (
            <div key={`proj-dir-${sub.pathKey}`}>
              <div
                tabIndex={0}
                className={`tree-node-row project-folder-row ${
                  isActive ? 'active-project' : ''
                }`}
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
                onClick={() => {
                  setIsFolderPaneFocused(true);
                  if (folderMainDoc) {
                    if (
                      isOpen &&
                      currentDoc?.fullPath === folderMainDoc.fullPath
                    ) {
                      toggleProjectFolderOpen(sub.pathKey);
                    } else {
                      openDocumentByNode(folderMainDoc);
                    }
                  } else {
                    toggleProjectFolderOpen(sub.pathKey);
                  }
                }}
                onContextMenu={(e) => {
                  if (folderMainDoc) {
                    e.preventDefault();
                    setIsFolderPaneFocused(true);
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      targetPath: folderMainDoc.fullPath,
                      targetUuid: folderMainDoc.uuid,
                      targetName: folderMainDoc.relativePath,
                    });
                  }
                }}
                title={
                  folderMainDoc
                    ? `${sub.pathKey}/main.md 클릭하여 프로젝트 열기 (하위 문서 ${totalFiles}개)`
                    : `${sub.pathKey} (하위 문서 ${totalFiles}개)`
                }
              >
                <div className="tree-node-label">
                  <span>{isOpen ? '📂' : '📁'}</span>
                  <span>{sub.name}</span>
                  <span className="tree-folder-count">({totalFiles})</span>
                  {isPriority && (
                    <span className="project-priority-dot" title="최우선 프로젝트">
                      !
                    </span>
                  )}
                </div>
                <button
                  className="tree-folder-close-btn"
                  onClick={(e) => toggleProjectFolderOpen(sub.pathKey, e)}
                  title={isOpen ? '프로젝트 폴더 접기' : '프로젝트 하위 문서 펼치기'}
                >
                  {isOpen ? '접기' : '펼치기'}
                </button>
              </div>

              {isOpen && (
                <div>
                  {/* 폴더 내 파일들 (main.md 허브 + 하위 md 파일들) */}
                  {sub.files.map((node) => {
                    const isMain = node.name.toLowerCase() === 'main.md';
                    const displayLabel = isMain
                      ? `main.md (${sub.name} 허브)`
                      : node.name.replace(/\.md$/i, '');
                    return (
                      <div
                        key={node.fullPath}
                        tabIndex={0}
                        className={`tree-node-row ${
                          currentDoc?.fullPath === node.fullPath ? 'active' : ''
                        }`}
                        style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
                        onClick={() => {
                          setIsFolderPaneFocused(true);
                          openDocumentByNode(node);
                        }}
                        onFocus={() => setIsFolderPaneFocused(true)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setIsFolderPaneFocused(true);
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            targetPath: node.fullPath,
                            targetUuid: node.uuid,
                            targetName: node.relativePath,
                          });
                        }}
                        title={`${node.fullPath}\n(Del: 휴지통으로 이동 | 우클릭: 메뉴)`}
                      >
                        <div className="tree-node-label">
                          <span>{isMain ? '⭐' : '📄'}</span>
                          <span style={{ fontWeight: isMain ? 700 : 400 }}>
                            {displayLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* 중첩된 하위 폴더가 있는 경우 재귀 렌더링 */}
                  {sub.folders.length > 0 &&
                    renderProjectFolderLevel(sub, depth + 1, mode)}
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  // 아카이브 열린 폴더 닫기 핸들러 (아카이브 하위 폴더는 열기가 없고 닫기만 존재)
  const handleCloseArchiveFolder = (pathKey: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenArchiveFolders((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (k !== pathKey && !k.startsWith(`${pathKey}/`)) {
          next.add(k);
        }
      }
      return next;
    });
  };

  // 섹션 헤더 토글 순환 핸들러 (프로젝트/일기: 열기 -> 요약 -> 닫기, 아카이브: 요약 -> 닫기)
  const cycleSectionMode = (roleKey: BaseFolderRole) => {
    setSectionModes((prev) => {
      const cur = prev[roleKey];
      if (roleKey === 'data') {
        const nextMode: FolderSectionMode =
          cur === 'closed' ? 'summary' : 'closed';
        if (nextMode === 'closed') {
          setExpandedArchiveMore(new Set());
        }
        return { ...prev, data: nextMode };
      }
      const nextMode: FolderSectionMode =
        cur === 'open' ? 'summary' : cur === 'summary' ? 'closed' : 'open';
      return { ...prev, [roleKey]: nextMode };
    });
  };

  // 아카이브 계층형 파일트리 렌더링 (기본 모두 닫힘 + 엑세스된 파일 경로만 열림 + 폴더당 최대 5개 표시 후 '...' 더보기)
  const renderArchiveFolderLevel = (
    folder: ArchiveTreeFolder,
    depth: number
  ): React.ReactNode => {
    type ArchiveEntry =
      | { kind: 'folder'; folder: ArchiveTreeFolder }
      | { kind: 'file'; file: FileNode };

    const allEntries: ArchiveEntry[] = [
      ...folder.folders.map((f) => ({ kind: 'folder' as const, folder: f })),
      ...folder.files.map((f) => ({ kind: 'file' as const, file: f })),
    ];

    if (allEntries.length === 0) {
      return null;
    }

    const levelKey = folder.pathKey || '__root__';
    const isFilterActive = treeFilter.trim() !== '';
    const isMoreExpanded =
      expandedArchiveMore.has(levelKey) || isFilterActive;
    const MAX_ITEMS = 5;

    let visibleEntries = allEntries;
    let omittedCount = 0;

    if (!isMoreExpanded && allEntries.length > MAX_ITEMS) {
      // 현재 엑세스된 파일 또는 그 경로상의 열린 폴더가 5번째 이후에 있다면 반드시 표시 목록(5개)에 포함
      const activeIdx = allEntries.findIndex((entry) =>
        entry.kind === 'file'
          ? currentDoc?.fullPath === entry.file.fullPath
          : openArchiveFolders.has(entry.folder.pathKey)
      );
      if (activeIdx >= MAX_ITEMS) {
        visibleEntries = [
          ...allEntries.slice(0, MAX_ITEMS - 1),
          allEntries[activeIdx],
        ];
      } else {
        visibleEntries = allEntries.slice(0, MAX_ITEMS);
      }
      omittedCount = allEntries.length - visibleEntries.length;
    }

    return (
      <>
        {visibleEntries.map((entry) => {
          if (entry.kind === 'folder') {
            const sub = entry.folder;
            const isOpen =
              openArchiveFolders.has(sub.pathKey) || isFilterActive;
            const childTotal = sub.folders.length + sub.files.length;

            return (
              <div key={`arch-dir-${sub.pathKey}`}>
                <div
                  className={`tree-node-row archive-folder-row ${
                    isOpen ? 'open-path' : 'closed-path'
                  }`}
                  style={{ paddingLeft: `${depth * 14 + 8}px` }}
                  onClick={() => {
                    if (isOpen) {
                      handleCloseArchiveFolder(sub.pathKey);
                    } else {
                      setStatusMessage(
                        `🗄️ 아카이브 폴더(${sub.name})는 닫기만 지원합니다. 해당 폴더 내 파일에 엑세스하면 경로가 자동으로 열립니다.`
                      );
                    }
                  }}
                  title={
                    isOpen
                      ? `${sub.pathKey} (열린 경로 — 클릭 시 닫기)`
                      : `${sub.pathKey} (닫힌 상태 — 하위 파일 엑세스 시 자동 열림)`
                  }
                >
                  <div className="tree-node-label">
                    <span>{isOpen ? '📂' : '📁'}</span>
                    <span>{sub.name}</span>
                    <span className="tree-folder-count">({childTotal})</span>
                  </div>
                  {isOpen ? (
                    <button
                      className="tree-folder-close-btn"
                      onClick={(e) => handleCloseArchiveFolder(sub.pathKey, e)}
                      title="이 폴더 닫기"
                    >
                      닫기
                    </button>
                  ) : (
                    <span className="tree-folder-closed-badge">닫힘</span>
                  )}
                </div>
                {isOpen && renderArchiveFolderLevel(sub, depth + 1)}
              </div>
            );
          }

          const node = entry.file;
          return (
            <div
              key={node.fullPath}
              tabIndex={0}
              className={`tree-node-row ${
                currentDoc?.fullPath === node.fullPath ? 'active' : ''
              }`}
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              onClick={() => {
                setIsFolderPaneFocused(true);
                openDocumentByNode(node);
              }}
              onFocus={() => setIsFolderPaneFocused(true)}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsFolderPaneFocused(true);
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  targetPath: node.fullPath,
                  targetUuid: node.uuid,
                  targetName: node.relativePath,
                });
              }}
              title={`${node.fullPath}\n(Del: 휴지통으로 이동 | 우클릭: 메뉴)`}
            >
              <div className="tree-node-label">
                <span>📄</span>
                <span>{node.name}</span>
              </div>
            </div>
          );
        })}

        {omittedCount > 0 && (
          <div
            key={`arch-more-${levelKey}`}
            className="tree-node-row archive-more-row"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            onClick={() => {
              setExpandedArchiveMore((prev) => {
                const next = new Set(prev);
                next.add(levelKey);
                return next;
              });
            }}
            title={`생략된 ${omittedCount}개 항목 모두 보이기`}
          >
            <span className="archive-more-dots">...</span>
            <span className="archive-more-hint">
              ({omittedCount}개 생략됨 — 클릭 시 모두 보이기)
            </span>
          </div>
        )}
      </>
    );
  };

  // 문서를 탭으로 열거나 이미 열린 탭 활성화 (옵션: 특정 줄/오프셋으로 이동)
  const applyLoadedDocument = (
    doc: DocumentPayload,
    jumpTo?: { lineNumber?: number; charOffset?: number; highlightLength?: number }
  ) => {
    const split = splitYamlFrontmatter(doc.rawContent);
    setOpenTabs((prev) => {
      const exists = prev.find((t) => t.doc.fullPath === doc.fullPath);
      if (exists) {
        return prev.map((t) =>
          t.doc.fullPath === doc.fullPath
            ? {
                ...t,
                doc,
                yamlText: split.yamlRaw,
                bodyText: split.body,
                isDirty: false,
              }
            : t
        );
      }
      return [
        ...prev,
        {
          doc,
          yamlText: split.yamlRaw,
          bodyText: split.body,
          isDirty: false,
        },
      ];
    });
    setActiveTabPath(doc.fullPath);
    if (viewMode.startsWith('dashboard_')) {
      setViewMode('split');
    }
    setStatusMessage(`열람 중: ${doc.relativePath}`);

    let initialOffset = jumpTo?.charOffset ?? 0;
    if (jumpTo?.lineNumber && jumpTo.charOffset === undefined) {
      const lines = split.body.split('\n');
      const lineIdx = Math.max(
        0,
        Math.min(lines.length - 1, jumpTo.lineNumber - 1)
      );
      initialOffset = lines
        .slice(0, lineIdx)
        .reduce((acc, l) => acc + l.length + 1, 0);
    }
    recordEditPosition(doc.fullPath, initialOffset, true);

    if (jumpTo) {
      setTimeout(() => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        let targetStart = initialOffset;
        let targetEnd = targetStart + (jumpTo.highlightLength || 0);
        if (jumpTo.lineNumber && jumpTo.charOffset === undefined) {
          const lines = split.body.split('\n');
          const lineIdx = Math.max(
            0,
            Math.min(lines.length - 1, jumpTo.lineNumber - 1)
          );
          targetEnd = targetStart + (lines[lineIdx]?.length || 0);
        }
        editorRef.current.setSelectionRange(targetStart, targetEnd);
        // 해당 줄 위치로 에디터 스크롤 이동
        const beforeText = split.body.slice(0, targetStart);
        const lineCount = beforeText.split('\n').length;
        const lineHeight = 23.8;
        editorRef.current.scrollTop = Math.max(0, (lineCount - 5) * lineHeight);
      }, 60);
    }
  };

  // 대쉬보드도 일반 .md 문서와 동일하게 상단 탭(.doc-tabs-bar)에 추가하여 열기
  const openDashboardTab = (
    dashType: 'lifelog' | 'finance' | 'diary' | 'settings'
  ) => {
    const fullPath = `mylore://dashboard/${dashType}`;
    const titleMap: Record<typeof dashType, string> = {
      lifelog: '📱 라이프로그',
      finance: '💳 금융',
      diary: '📅 일정',
      settings: '⚙️ 설정',
    };
    const label = titleMap[dashType];
    const virtualDoc: DocumentPayload = {
      uuid: `dashboard-${dashType}`,
      fullPath,
      relativePath: label,
      role: 'projects',
      rawContent: '',
      yamlRaw: '',
      bodyContent: '',
      frontmatter: { title: label, summary: label },
      contentHash: '',
      backlinks: [],
    };

    setOpenTabs((prev) => {
      const exists = prev.find((t) => t.doc.fullPath === fullPath);
      if (exists) return prev;
      return [
        ...prev,
        {
          doc: virtualDoc,
          yamlText: '',
          bodyText: '',
          isDirty: false,
        },
      ];
    });
    setActiveTabPath(fullPath);
    recordEditPosition(fullPath, 0, true);
    if (dashType === 'lifelog') {
      setRightSidebarOpen(true);
      refreshMobilePairingInfo();
      refreshAllLifelogMessages();
    } else if (dashType === 'finance') {
      refreshFinanceData();
    }
    setStatusMessage(`탭 열람 중: ${label} 대쉬보드`);
  };

  const openDocumentByNode = async (node: FileNode) => {
    if (node.isDir) return;
    try {
      const doc = await readDocument(node.fullPath);
      applyLoadedDocument(doc);
    } catch (err) {
      setStatusMessage(`문서 열기 오류: ${String(err)}`);
    }
  };

  // 탭 닫기 (Ctrl+W 또는 × 버튼 클릭): 닫힌 탭을 제거하고 이전에 사용 중이던 파일/대쉬보드(MRU)를 즉시 활성화
  const closeTab = (fullPath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const targetTab = openTabs.find((t) => t.doc.fullPath === fullPath);
    if (
      targetTab &&
      targetTab.isDirty &&
      autoSaveEnabled &&
      !fullPath.startsWith('mylore://dashboard/')
    ) {
      const combined = combineYamlAndBody(
        targetTab.yamlText,
        targetTab.bodyText
      );
      saveDocument(fullPath, combined).catch(() => {});
    }

    const nextHistory = tabAccessHistoryRef.current.filter(
      (p) => p !== fullPath
    );
    tabAccessHistoryRef.current = nextHistory;
    setTabAccessHistory(nextHistory);

    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.doc.fullPath !== fullPath);
      if (activeTabPath === fullPath) {
        let prevUsedPath: string | null = null;
        for (let i = nextHistory.length - 1; i >= 0; i--) {
          const candidate = nextHistory[i];
          if (next.some((t) => t.doc.fullPath === candidate)) {
            prevUsedPath = candidate;
            break;
          }
        }
        if (!prevUsedPath && next.length > 0) {
          prevUsedPath = next[next.length - 1].doc.fullPath;
        }
        setActiveTabPath(prevUsedPath);
        if (prevUsedPath) {
          const activatedTab = next.find(
            (t) => t.doc.fullPath === prevUsedPath
          );
          if (activatedTab) {
            setStatusMessage(
              `↩ 탭 닫힘 — 이전 사용 파일/대쉬보드로 복귀: ${activatedTab.doc.relativePath}`
            );
          }
        } else {
          setStatusMessage('열린 에디터/대쉬보드 탭을 닫았습니다.');
        }
      }
      return next;
    });
  };

  const handleSaveCurrentDoc = async () => {
    if (!currentDoc || currentDoc.fullPath.startsWith('mylore://dashboard/'))
      return;
    try {
      const combined = combineYamlAndBody(yamlText, bodyText);
      const saved = await saveDocument(currentDoc.fullPath, combined);
      applyLoadedDocument(saved);
      await refreshTree();
      setStatusMessage(`💾 저장 완료: ${saved.relativePath}`);
    } catch (err) {
      setStatusMessage(`저장 실패: ${String(err)}`);
    }
  };

  const handleAutoFormatTasks = () => {
    if (!currentDoc) return;
    const formatted = autoFormatMarkdownTasks(bodyText);
    setBodyText(formatted);
    setStatusMessage(
      '⚡ 서브 미션 Auto-Format 적용 완료 ([!] 핵심 → [/] 진행중 → [ ] 대기 → [-] 보류 → [x] 완료 순 재배치)'
    );
  };

  const handleRunBatchUuidScan = async () => {
    setStatusMessage(
      '🔍 전체 파일 수 및 기등록 UUID 현황 파악 중 (기등록 파일은 건너뛰고 이어서 진행합니다)...'
    );
    try {
      const initial = await startBatchUuidScan();
      setScanProgress(initial);
    } catch (err) {
      setStatusMessage(`스캔 오류: ${String(err)}`);
    }
  };

  const handleOpenGoogleCalendar = async () => {
    const targetDate = selectedDate || new Date().toISOString().slice(0, 10);
    const [y, m, d] = targetDate.split('-').map((n) => parseInt(n, 10));
    const url = await openGoogleCalendarWeb(y, m, d);
    setStatusMessage(`🌐 구글 캘린더 웹 오픈됨 (Chrome): ${url}`);
  };

  // 파일 > 새 파일 > 새 메모 (임시 메모장 출력, 프로젝트/임시에 자동 분류)
  const handleCreateTempMemo = async () => {
    try {
      const memoDoc = await createTempMemo();
      await refreshTree();
      applyLoadedDocument(memoDoc);
      setStatusMessage(
        `📝 새 임시 메모가 'Projects/임시/'에 생성되었습니다: ${memoDoc.relativePath}`
      );
    } catch (err) {
      setStatusMessage(`임시 메모 생성 실패: ${String(err)}`);
    }
  };

  // 파일 > 파일 열기
  const handleOpenNativeFile = async () => {
    try {
      const filePath = await openNativeFileDialog();
      if (filePath) {
        const doc = await readDocument(filePath);
        applyLoadedDocument(doc);
      }
    } catch (err) {
      setStatusMessage(`파일 열기 실패: ${String(err)}`);
    }
  };

  // 파일 > 폴더 열기
  const handleOpenNativeFolder = async () => {
    try {
      const folderPath = await openNativeFolderDialog();
      if (folderPath) {
        const folderName = folderPath.split(/[\\/]/).pop() || '추가폴더';
        const nextFolders: BaseFolderConfig[] = [
          ...baseFolders,
          {
            id: `base-${Date.now()}`,
            role: 'projects',
            path: folderPath,
            label: folderName,
            purpose: '폴더 열기로 추가된 워크스페이스 폴더',
            enabled: true,
          },
        ];
        await saveBaseFolders(nextFolders);
        setBaseFolders(nextFolders);
        await refreshTree();
        setStatusMessage(`📂 폴더가 열리고 트리에 연결되었습니다: ${folderPath}`);
      }
    } catch (err) {
      setStatusMessage(`폴더 열기 실패: ${String(err)}`);
    }
  };

  // 편집 & 선택 조작 함수들
  const handleEditorUndo = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('undo');
    }
  };

  const handleEditorRedo = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('redo');
    }
  };

  const handleEditorCut = async () => {
    if (!editorRef.current) return;
    const el = editorRef.current;
    const selected = bodyText.slice(el.selectionStart, el.selectionEnd);
    if (selected) {
      await navigator.clipboard.writeText(selected);
      const next =
        bodyText.slice(0, el.selectionStart) + bodyText.slice(el.selectionEnd);
      setBodyText(next);
    }
  };

  const handleEditorCopy = async () => {
    if (!editorRef.current) return;
    const el = editorRef.current;
    const selected = bodyText.slice(el.selectionStart, el.selectionEnd);
    if (selected) {
      await navigator.clipboard.writeText(selected);
      setStatusMessage('📋 클립보드에 복사되었습니다.');
    }
  };

  const handleEditorPaste = async () => {
    if (!editorRef.current) return;
    const el = editorRef.current;
    const clip = await navigator.clipboard.readText();
    const start = el.selectionStart;
    const next =
      bodyText.slice(0, start) + clip + bodyText.slice(el.selectionEnd);
    setBodyText(next);
  };

  const handleSelectAll = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      editorRef.current.select();
    }
  };

  // 선택 > 줄 위로 이동 / 줄 아래로 이동
  const handleMoveLine = (direction: 'up' | 'down') => {
    if (!editorRef.current || !currentDoc) return;
    const el = editorRef.current;
    const pos = el.selectionStart;
    const lines = bodyText.split('\n');
    let charCount = 0;
    let currentLineIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (pos <= charCount + lines[i].length) {
        currentLineIdx = i;
        break;
      }
      charCount += lines[i].length + 1;
    }

    const swapIdx = direction === 'up' ? currentLineIdx - 1 : currentLineIdx + 1;
    if (swapIdx < 0 || swapIdx >= lines.length) return;

    const temp = lines[currentLineIdx];
    lines[currentLineIdx] = lines[swapIdx];
    lines[swapIdx] = temp;
    const nextBody = lines.join('\n');
    setBodyText(nextBody);
    setStatusMessage(
      `↕ 현재 줄(${currentLineIdx + 1}행)을 ${direction === 'up' ? '위로' : '아래로'} 이동했습니다.`
    );
  };

  // 선택 > 위에 커서 추가 / 아래 커서 추가 (인접 줄 동일 컬럼 영역 확장 선택)
  const handleAddCursorVertical = (direction: 'up' | 'down') => {
    if (!editorRef.current) return;
    const el = editorRef.current;
    el.focus();
    const lines = bodyText.split('\n');
    const before = bodyText.slice(0, el.selectionStart).split('\n');
    const curLine = before.length - 1;
    const targetLine =
      direction === 'up'
        ? Math.max(0, curLine - 1)
        : Math.min(lines.length - 1, curLine + 1);
    const startLine = Math.min(curLine, targetLine);
    const endLine = Math.max(curLine, targetLine);
    const selStart = lines
      .slice(0, startLine)
      .reduce((acc, l) => acc + l.length + 1, 0);
    const selEnd =
      lines.slice(0, endLine).reduce((acc, l) => acc + l.length + 1, 0) +
      (lines[endLine]?.length || 0);
    el.setSelectionRange(selStart, selEnd);
    setStatusMessage(
      `커서 영역 확장: ${startLine + 1}행 ~ ${endLine + 1}행 선택됨`
    );
  };

  // 이동 > 다음 파일(탭)로 이동 / 이전 파일(탭)로 이동
  const handleSwitchTabCycle = (dir: 1 | -1) => {
    if (openTabs.length <= 1 || !activeTabPath) return;
    const curIdx = openTabs.findIndex((t) => t.doc.fullPath === activeTabPath);
    const nextIdx = (curIdx + dir + openTabs.length) % openTabs.length;
    setActiveTabPath(openTabs[nextIdx].doc.fullPath);
  };

  // 이동 > 이전/다음 편집점으로 이동 (Alt+ArrowLeft / Alt+ArrowRight)
  const handleMoveEditPoint = async (dir: 1 | -1) => {
    const hist = editHistoryRef.current;
    const curIdx = editHistoryIdxRef.current;
    if (hist.length === 0) {
      setStatusMessage('기록된 편집 위치 히스토리가 아직 없습니다.');
      return;
    }

    // 이동 전 현재 에디터의 커서 위치를 현재 히스토리 슬롯에 동기화
    if (
      editorRef.current &&
      currentDoc &&
      curIdx >= 0 &&
      curIdx < hist.length &&
      hist[curIdx].path === currentDoc.fullPath
    ) {
      hist[curIdx] = {
        path: currentDoc.fullPath,
        offset: editorRef.current.selectionStart,
      };
    }

    const nextIdx = Math.max(0, Math.min(hist.length - 1, curIdx + dir));
    if (nextIdx === curIdx) {
      setStatusMessage(
        dir === -1
          ? '⏮ 가장 처음 편집 위치입니다.'
          : '⏭ 가장 최근 편집 위치입니다.'
      );
      return;
    }

    isNavigatingEditHistoryRef.current = true;
    editHistoryIdxRef.current = nextIdx;
    setEditHistoryIdx(nextIdx);

    const item = hist[nextIdx];
    try {
      if (item.path.startsWith('mylore://dashboard/')) {
        const dashType = item.path.replace('mylore://dashboard/', '') as
          | 'lifelog'
          | 'finance'
          | 'diary'
          | 'settings';
        openDashboardTab(dashType);
        setStatusMessage(
          `${dir === -1 ? '⬅️ [Alt+←] 이전 위치' : '➡️ [Alt+→] 다음 위치'} (${nextIdx + 1}/${hist.length}): 대쉬보드 이동`
        );
      } else {
        const existingTab = openTabs.find((t) => t.doc.fullPath === item.path);
        let bodyForScroll = existingTab?.bodyText || '';
        let relLabel = existingTab?.doc.relativePath || item.path;
        if (existingTab) {
          setActiveTabPath(existingTab.doc.fullPath);
        } else {
          const loaded = await readDocument(item.path);
          const split = splitYamlFrontmatter(loaded.rawContent);
          bodyForScroll = split.body;
          relLabel = loaded.relativePath;
          setOpenTabs((prev) => [
            ...prev,
            {
              doc: loaded,
              yamlText: split.yamlRaw,
              bodyText: split.body,
              isDirty: false,
            },
          ]);
          setActiveTabPath(loaded.fullPath);
        }

        // 일반 문서인 경우 우측 사이드바 폴더 트리 탭으로 전환하여 해당 파일 위치로 스크롤 & 하이라이트 보장
        const isMobilePath = /[\\/]mobile[\\/](kakao|sms|calls|recordings|notifications|health)[\\/]/i.test(
          item.path
        );
        if (!isMobilePath && rightTab !== 'tree') {
          setRightTab('tree');
        }

        setTimeout(() => {
          if (editorRef.current) {
            editorRef.current.focus();
            const safeOffset = Math.max(
              0,
              Math.min(bodyForScroll.length, item.offset)
            );
            editorRef.current.setSelectionRange(safeOffset, safeOffset);
            const beforeText = bodyForScroll.slice(0, safeOffset);
            const lineCount = beforeText.split('\n').length;
            const lineHeight = 23.8;
            editorRef.current.scrollTop = Math.max(
              0,
              (lineCount - 5) * lineHeight
            );
          }
          isNavigatingEditHistoryRef.current = false;
        }, 65);

        const lineNum =
          bodyForScroll.slice(0, Math.max(0, item.offset)).split('\n').length ||
          1;
        setStatusMessage(
          `${dir === -1 ? '⬅️ [Alt+←] 이전 편집 위치' : '➡️ [Alt+→] 다음 편집 위치'} (${nextIdx + 1}/${hist.length}): ${relLabel} (${lineNum}행)`
        );
        return;
      }
    } catch (err) {
      setStatusMessage(`편집 위치 이동 실패: ${String(err)}`);
    } finally {
      setTimeout(() => {
        isNavigatingEditHistoryRef.current = false;
      }, 80);
    }
  };

  // 이동 > 괄호 이동
  const handleJumpToMatchingBracket = () => {
    if (!editorRef.current) return;
    const el = editorRef.current;
    const pos = el.selectionStart;
    const pairs: Record<string, string> = {
      '(': ')',
      '[': ']',
      '{': '}',
      ')': '(',
      ']': '[',
      '}': '{',
    };
    const ch = bodyText[pos] || bodyText[pos - 1];
    if (!ch || !pairs[ch]) {
      // 가장 가까운 괄호 탐색
      const nextBracket = bodyText.slice(pos).search(/[()[\]{}]/);
      if (nextBracket >= 0) {
        el.focus();
        el.setSelectionRange(pos + nextBracket, pos + nextBracket + 1);
      }
      return;
    }
    const target = pairs[ch];
    const isForward = '([{'.includes(ch);
    let idx = isForward ? bodyText.indexOf(target, pos + 1) : bodyText.lastIndexOf(target, pos - 1);
    if (idx >= 0) {
      el.focus();
      el.setSelectionRange(idx, idx + 1);
      setStatusMessage(`괄호 이동 완료 (위치: ${idx})`);
    }
  };

  // 이동 > 북마크 토글 및 순환 이동
  const handleBookmarkJumpOrToggle = () => {
    if (!currentDoc || !editorRef.current) return;
    const pos = editorRef.current.selectionStart;
    const curLine = bodyText.slice(0, pos).split('\n').length;
    const exists = bookmarks.some(
      (b) => b.path === currentDoc.fullPath && b.line === curLine
    );
    if (!exists) {
      const next = [...bookmarks, { path: currentDoc.fullPath, line: curLine }];
      setBookmarks(next);
      setStatusMessage(`🔖 북마크 등록됨: ${currentDoc.relativePath} (${curLine}행)`);
    } else if (bookmarks.length > 0) {
      const nextIdx = (bookmarkIdx + 1) % bookmarks.length;
      setBookmarkIdx(nextIdx);
      const bm = bookmarks[nextIdx];
      readDocument(bm.path).then((doc) =>
        applyLoadedDocument(doc, { lineNumber: bm.line })
      );
      setStatusMessage(`🔖 북마크 이동: ${bm.line}행`);
    }
  };

  // 이동 > main.md로 이동
  const handleGotoRootMainMd = async () => {
    try {
      const doc = await openRootMainMd();
      await refreshTree();
      applyLoadedDocument(doc);
      setStatusMessage('⭐ Projects/main.md 로 이동했습니다.');
    } catch (err) {
      setStatusMessage(`main.md 이동 실패: ${String(err)}`);
    }
  };

  // 이동 > 최신 / 이전 / 다음 diary로 이동
  const handleGotoDiary = async (mode: 'latest' | 'prev' | 'next') => {
    if (diaryFilesSorted.length === 0) {
      setStatusMessage('일기(Diary) 폴더에 문서가 없습니다.');
      return;
    }
    if (mode === 'latest') {
      const latest = diaryFilesSorted[diaryFilesSorted.length - 1];
      await openDocumentByNode(latest);
      return;
    }
    const curIdx = diaryFilesSorted.findIndex(
      (f) => f.fullPath === currentDoc?.fullPath
    );
    if (curIdx === -1) {
      await openDocumentByNode(diaryFilesSorted[diaryFilesSorted.length - 1]);
      return;
    }
    const targetIdx =
      mode === 'prev'
        ? Math.max(0, curIdx - 1)
        : Math.min(diaryFilesSorted.length - 1, curIdx + 1);
    await openDocumentByNode(diaryFilesSorted[targetIdx]);
  };

  // 전체 파일에서 찾기 실행 (오른쪽 사이드바 🔍 검색 결과 리스트 표시)
  const executeGlobalSearch = async (q?: string) => {
    const queryToUse = (q ?? globalSearchQuery).trim();
    if (!queryToUse) {
      setGlobalSearchResults([]);
      return;
    }
    try {
      const matches = await searchInFiles(queryToUse);
      setGlobalSearchResults(matches);
      setActiveSearchIdx(0);
      setRightSidebarOpen(true);
      setRightTab('search');
      setStatusMessage(
        `🔍 '${queryToUse}' 검색 결과: 총 ${matches.length}건 발견 (우측 사이드바에서 클릭 시 해당 위치로 이동)`
      );
    } catch (err) {
      setStatusMessage(`검색 오류: ${String(err)}`);
    }
  };

  // 이동 > 다음 찾기 목록으로 이동 / 이전 찾기 목록으로 이동
  const handleJumpSearchMatch = async (dir: 1 | -1) => {
    if (globalSearchResults.length > 0) {
      const nextIdx =
        (activeSearchIdx + dir + globalSearchResults.length) %
        globalSearchResults.length;
      setActiveSearchIdx(nextIdx);
      const item = globalSearchResults[nextIdx];
      const doc = await readDocument(item.fullPath);
      applyLoadedDocument(doc, {
        lineNumber: item.lineNumber,
        charOffset: item.charOffset,
        highlightLength: globalSearchQuery.length,
      });
      return;
    }
    // 문서 내 로컬 찾기 이동
    if (docFindQuery && editorRef.current) {
      const el = editorRef.current;
      const startPos = dir === 1 ? el.selectionEnd : Math.max(0, el.selectionStart - 1);
      const idx =
        dir === 1
          ? bodyText.toLowerCase().indexOf(docFindQuery.toLowerCase(), startPos)
          : bodyText.toLowerCase().lastIndexOf(docFindQuery.toLowerCase(), startPos);
      if (idx >= 0) {
        el.focus();
        el.setSelectionRange(idx, idx + docFindQuery.length);
      }
    }
  };

  // F2: 현재 문서 제목 변경 모달 열기 및 실행
  const handleOpenRenameDocModal = () => {
    if (!currentDoc) {
      setStatusMessage('이름을 변경할 문서가 열려있지 않습니다.');
      return;
    }
    const parts = currentDoc.relativePath.split(/[\\/]/);
    const fileName = parts[parts.length - 1] || '';
    const isSubProjectMain =
      fileName.toLowerCase() === 'main.md' && parts.length >= 2;
    const defaultTitle = isSubProjectMain
      ? parts[parts.length - 2]
      : currentDoc.frontmatter['summary'] ||
        currentDoc.frontmatter['title'] ||
        fileName.replace(/\.md$/i, '');
    setRenameTitleInput(defaultTitle);
    setRenameModalOpen(true);
  };

  const handleRenameCurrentDocSubmit = async () => {
    if (!currentDoc || !renameTitleInput.trim()) return;
    try {
      const oldPath = currentDoc.fullPath;
      // 변경 전 현재 수정 중인 본문/YAML이 있다면 먼저 저장
      if (isDirty) {
        const combined = combineYamlAndBody(yamlText, bodyText);
        await saveDocument(oldPath, combined);
      }
      const renamed = await renameCurrentDocument(
        oldPath,
        renameTitleInput.trim()
      );
      const split = splitYamlFrontmatter(renamed.rawContent);
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.doc.fullPath === oldPath
            ? {
                doc: renamed,
                yamlText: split.yamlRaw,
                bodyText: split.body,
                isDirty: false,
              }
            : t
        )
      );
      setTabAccessHistory((prev) => {
        const next = prev.map((p) => (p === oldPath ? renamed.fullPath : p));
        tabAccessHistoryRef.current = next;
        return next;
      });
      setActiveTabPath(renamed.fullPath);
      setRenameModalOpen(false);
      await refreshTree();
      setStatusMessage(
        `✏️ [F2] 문서 제목 변경 완료 (UUID 유지): ${renamed.relativePath}`
      );
    } catch (err) {
      setStatusMessage(`문서 제목 변경 실패: ${String(err)}`);
    }
  };

  // F3 / F4: 목록 이전 선택 / 목록 다음 선택 (찾기 목록 활성화 시 이전/다음 찾기 위치, 아닐 시 파일 목록에서 이전/다음 파일)
  const handleListSelectPrevOrNext = async (dir: 1 | -1) => {
    const isSearchActive =
      (rightSidebarOpen &&
        rightTab === 'search' &&
        globalSearchResults.length > 0) ||
      findBarMode !== 'closed';

    if (isSearchActive) {
      await handleJumpSearchMatch(dir);
      return;
    }

    if (flattenedFiles.length === 0) return;
    const curIdx = flattenedFiles.findIndex(
      (f) => f.fullPath === currentDoc?.fullPath
    );
    const nextIdx =
      curIdx === -1
        ? 0
        : (curIdx + dir + flattenedFiles.length) % flattenedFiles.length;
    const targetNode = flattenedFiles[nextIdx];
    if (targetNode) {
      await openDocumentByNode(targetNode);
      setStatusMessage(
        `${dir === -1 ? '⬆️ [F3] 목록 이전 파일' : '⬇️ [F4] 목록 다음 파일'} 선택 (${nextIdx + 1}/${flattenedFiles.length}): ${targetNode.relativePath}`
      );
    }
  };

  // F7: 구글 캘린더 싱크 및 열기
  const handleSyncAndOpenGoogleCalendar = async () => {
    if (currentDoc) {
      await handleSaveCurrentDoc();
    }
    await handleOpenGoogleCalendar();
    setStatusMessage(
      '📅 [F7] 현재 일정/문서 동기화 및 Google 캘린더(Chrome) 열기 완료'
    );
  };

  // F9: 프로그램 수행 (추후 업데이트 예정)
  const handleRunProgramPlaceholder = () => {
    setStatusMessage('🚀 [F9] 프로그램 수행 — 추후 업데이트 예정입니다.');
  };

  // 현재 문서를 독립 뷰어 창으로 동기화하기 위한 페이로드 구성
  const buildDetachedPreviewPayload = (): DetachedPreviewState => ({
    title:
      currentDoc?.frontmatter['summary'] ||
      currentDoc?.frontmatter['title'] ||
      currentDoc?.relativePath.split(/[\\/]/).pop() ||
      '',
    relativePath: currentDoc?.relativePath || '',
    fullPath: currentDoc?.fullPath || '',
    role: currentDoc?.role || '',
    bodyText,
    yamlText,
  });

  // Projects/.myLore/setting.json 설정 업데이트 및 즉시 저장
  const handleUpdateAppSettings = async (
    partial: Partial<MyLoreAppSettings>
  ) => {
    const merged: MyLoreAppSettings = {
      ...appSettings,
      ...partial,
    };

    try {
      const saved = await saveAppSettings(merged);
      setAppSettings(saved);
      setAutoSaveEnabled(saved.autoSaveEnabled);
      applyAppSettingsToDocument(saved);
      try {
        const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
        bc.postMessage({ type: 'settings', settings: saved });
        bc.close();
      } catch {
        // ignore
      }
      setStatusMessage(
        `⚙️ 설정 저장됨 (${saved.settingsFilePath}): 테마=${saved.themePreset}, F11=${
          saved.f11ViewerMode === 'detached'
            ? '전용 독립 뷰어'
            : '병렬 뷰어'
        }, 스크롤 동기화=${saved.scrollSyncEnabled ? 'ON' : 'OFF'}`
      );
    } catch (err) {
      setStatusMessage(`설정 저장 실패: ${String(err)}`);
    }
  };

  // 테마 프리셋 원클릭 적용
  const handleApplyThemePreset = async (
    presetId: Exclude<ThemePresetId, 'custom'>
  ) => {
    const preset = THEME_PRESETS[presetId];
    if (!preset) return;
    await handleUpdateAppSettings({
      themePreset: presetId,
      bgPrimary: preset.bgPrimary,
      bgSecondary: preset.bgSecondary,
      textPrimary: preset.textPrimary,
      textSecondary: preset.textSecondary,
      headingColor: preset.headingColor,
      accentPrimary: preset.accentPrimary,
      tableHeaderBg: preset.tableHeaderBg,
      tableHeaderColor: preset.tableHeaderColor,
      borderColor: preset.borderColor,
    });
  };

  // 원본 에디터 스크롤 시 뷰어(병렬 뷰어 & 전용 독립 뷰어) 스크롤을 해당 소스 줄 위치로 동기화
  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!appSettings.scrollSyncEnabled) return;
    const el = e.currentTarget;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const scrollRatio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;

    // 현재 에디터 상단(약간 안쪽 오프셋)에 위치한 마크다운 소스 줄 번호 계산
    const totalLines = Math.max(1, bodyText.split('\n').length);
    const computedStyle = window.getComputedStyle(el);
    const lineHeightPx =
      parseFloat(computedStyle.lineHeight) ||
      (appSettings.baseFontSize || 14) * 1.7;
    const paddingTopPx = parseFloat(computedStyle.paddingTop) || 20;
    const rawLine = Math.max(
      0,
      (el.scrollTop - paddingTopPx + lineHeightPx * 0.6) / lineHeightPx
    );
    // 스크롤 비율과 줄 높이 추정치를 보정 결합하여 긴 줄 줄바꿈(soft-wrap) 오차를 최소화
    const blendedTopLine =
      scrollRatio >= 0.995
        ? totalLines - 1
        : scrollRatio <= 0.005
          ? 0
          : Math.min(
              totalLines - 1,
              rawLine * 0.65 + scrollRatio * (totalLines - 1) * 0.35
            );

    if (previewPaneRef.current) {
      scrollPreviewPaneToSourceLine(
        previewPaneRef.current,
        blendedTopLine,
        scrollRatio
      );
    }

    if (detachedPreviewOpen) {
      syncDetachedPreviewScroll(blendedTopLine, scrollRatio).catch(() => {});
      try {
        const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
        bc.postMessage({
          type: 'scroll',
          topLine: blendedTopLine,
          scrollRatio,
        });
        bc.close();
      } catch {
        // ignore
      }
    }
  };

  // 에디터 전용 / 병렬(분할) 화면 / 뷰어 전용 모드 전환
  const handleSelectDocViewMode = async (
    nextMode: 'editor' | 'split' | 'preview'
  ) => {
    preDetachedViewModeRef.current = nextMode;
    setViewMode(nextMode);
    if (detachedPreviewOpen && nextMode !== 'editor') {
      setDetachedPreviewOpen(false);
      await toggleDetachedPreviewWindow(buildDetachedPreviewPayload(), false);
    }
    const modeName =
      nextMode === 'editor'
        ? '에디터 전용 모드'
        : nextMode === 'split'
          ? '병렬 뷰어 모드 (분할 화면)'
          : '뷰어 전용 모드';
    setStatusMessage(`👁️ 보기 모드 전환: ${modeName}`);
  };

  // 전용 독립 뷰어 창 켜기/끄기: 메인 창은 에디터 전용 모드로 전환하고 별도 독립 창에서 실시간 미리보기 동기화
  const handleToggleDetachedPreview = async (forceOpen?: boolean) => {
    const payload = buildDetachedPreviewPayload();
    try {
      const isOpenNow = await toggleDetachedPreviewWindow(payload, forceOpen);
      setDetachedPreviewOpen(isOpenNow);
      if (isOpenNow) {
        setViewMode('editor');
        setStatusMessage(
          '🪟 [F11] 전용 독립 뷰어 켜짐 — 메인 창은 편집 모드, 독립 창은 실시간 뷰어로 동작합니다. (다시 F11을 누르면 닫힙니다)'
        );
      } else {
        setViewMode('editor');
        setStatusMessage(
          '🪟 [F11] 전용 독립 뷰어 꺼짐 — 에디터 전용 모드로 전환되었습니다.'
        );
      }
    } catch (err) {
      setStatusMessage(`전용 독립 뷰어 창 전환 실패: ${String(err)}`);
    }
  };

  // F11: 설정(Projects/.myLore/setting.json)의 f11ViewerMode('detached' | 'split')에 따라 전용독립뷰어 또는 병렬뷰어 켜기/끄기 토글
  const handleToggleF11Viewer = async () => {
    if (appSettings.f11ViewerMode === 'detached') {
      await handleToggleDetachedPreview();
    } else {
      // 병렬 뷰어('split') 모드인 경우: 독립 뷰어 창이 열려 있다면 닫고, 메인 창에서 editor <-> split 토글
      if (detachedPreviewOpen) {
        setDetachedPreviewOpen(false);
        await toggleDetachedPreviewWindow(buildDetachedPreviewPayload(), false);
      }
      const nextMode = viewMode === 'split' ? 'editor' : 'split';
      preDetachedViewModeRef.current = nextMode;
      setViewMode(nextMode);
      setStatusMessage(
        nextMode === 'split'
          ? '📐 [F11] 병렬 뷰어 켜짐 (에디터 + 우측 병렬 뷰어)'
          : '📐 [F11] 병렬 뷰어 꺼짐 (에디터 전용 모드)'
      );
    }
  };

  // 메인 창 문서/본문 변경 시 독립 뷰어 창으로 실시간 동기화
  useEffect(() => {
    const payload = buildDetachedPreviewPayload();
    syncDetachedPreviewState(payload).catch(() => {});
    try {
      const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
      bc.postMessage({ type: 'sync', payload });
      bc.close();
    } catch {
      // ignore
    }
  }, [currentDoc?.fullPath, currentDoc?.relativePath, bodyText, yamlText]);

  // 독립 뷰어 창 닫힘 이벤트 및 독립 뷰어 내 체크박스/링크 상호작용 수신
  useEffect(() => {
    let unlistenClosed: (() => void) | null = null;
    let unlistenAction: (() => void) | null = null;

    listen('detached-preview-closed', () => {
      setDetachedPreviewOpen(false);
      setViewMode('editor');
      setStatusMessage(
        '🪟 전용 독립 뷰어 창이 닫혔습니다 (F11을 누르면 다시 열립니다).'
      );
    })
      .then((fn) => {
        unlistenClosed = fn;
      })
      .catch(() => {});

    listen<DetachedPreviewActionPayload>(
      'detached-preview-action',
      async (event) => {
        const data = event.payload;
        if (!data) return;
        if (
          data.actionType === 'toggle-task' &&
          typeof data.lineIndex === 'number' &&
          data.nextCode
        ) {
          setBodyText((prev) =>
            updateTaskStatusInBody(
              prev,
              data.lineIndex as number,
              data.nextCode as TaskPriorityCode
            )
          );
        } else if (data.actionType === 'open-uuid' && data.uuid) {
          try {
            const targetDoc = await readDocumentByUuid(data.uuid);
            applyLoadedDocument(targetDoc);
          } catch {
            // ignore
          }
        }
      }
    )
      .then((fn) => {
        unlistenAction = fn;
      })
      .catch(() => {});

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
      bc.onmessage = async (ev) => {
        if (ev.data?.type === 'toggle-task') {
          const { lineIndex, nextCode } = ev.data as {
            lineIndex: number;
            nextCode: TaskPriorityCode;
          };
          setBodyText((prev) =>
            updateTaskStatusInBody(prev, lineIndex, nextCode)
          );
        } else if (ev.data?.type === 'open-uuid' && ev.data.uuid) {
          try {
            const targetDoc = await readDocumentByUuid(ev.data.uuid);
            applyLoadedDocument(targetDoc);
          } catch {
            // ignore
          }
        }
      };
    } catch {
      // ignore
    }

    return () => {
      if (unlistenClosed) unlistenClosed();
      if (unlistenAction) unlistenAction();
      if (bc) bc.close();
    };
  }, [activeTabPath]);

  // 폴더 인터페이스에서 Del 키 입력 시 휴지통으로 이동 (되돌리기 가능)
  const handleTrashDocument = async (targetPath?: string) => {
    const pathToDelete = targetPath || currentDoc?.fullPath;
    if (!pathToDelete) {
      setStatusMessage('휴지통으로 이동할 파일이 선택되어 있지 않습니다.');
      return;
    }

    const curIdx = flattenedFiles.findIndex((f) => f.fullPath === pathToDelete);
    const nextCandidate =
      curIdx >= 0
        ? flattenedFiles[curIdx + 1] || flattenedFiles[curIdx - 1] || null
        : null;

    try {
      const record = await trashDocument(pathToDelete);
      setTrashHistory((prev) => [...prev, record]);

      // 열린 탭에 해당 파일이 있으면 탭 닫기 (이전에 사용 중이던 탭 활성화)
      closeTab(pathToDelete);

      await refreshTree();

      if (openTabs.length <= 1 && activeTabPath === pathToDelete && nextCandidate) {
        try {
          const nextDoc = await readDocument(nextCandidate.fullPath);
          applyLoadedDocument(nextDoc);
        } catch {
          // ignore
        }
      }

      setStatusMessage(
        `🗑️ 휴지통으로 이동됨: ${record.fileName} (되돌리기: Ctrl+Z 또는 [되돌리기] 버튼)`
      );
    } catch (err) {
      setStatusMessage(`휴지통 이동 실패: ${String(err)}`);
    }
  };

  // 휴지통 이동 되돌리기 (복구)
  const handleRestoreTrashedDocument = async (trashId?: string) => {
    try {
      const restoredDoc = await restoreTrashedDocument(trashId);
      setTrashHistory((prev) =>
        trashId ? prev.filter((r) => r.trashId !== trashId) : prev.slice(0, -1)
      );
      await refreshTree();
      applyLoadedDocument(restoredDoc);
      setStatusMessage(
        `↩ 휴지통에서 원래 위치로 복구됨: ${restoredDoc.relativePath}`
      );
    } catch (err) {
      setStatusMessage(`복구 실패: ${String(err)}`);
    }
  };

  // F11: 전체 화면 토글
  const handleToggleFullscreen = async () => {
    try {
      const nextFs = await toggleWindowFullscreen();
      setStatusMessage(
        `🖥️ [F11] 전체 화면 모드 ${nextFs ? '활성화됨' : '해제됨'}`
      );
    } catch (err) {
      setStatusMessage(`전체 화면 전환 실패: ${String(err)}`);
    }
  };

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
          localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(updated));
          setRecordingShortcutTarget(null);
          setStatusMessage('⌨️ 보조 단축키가 해제되었습니다.');
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
        setStatusMessage(`⌨️ 단축키가 [${combo}]로 변경되었습니다.`);
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
          setMenuBarExpanded(true);
          setActiveMenu(menuMap[k]);
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
        // F1: 도움말 (단축키 설정)
        e.preventDefault();
        setShortcutsModalOpen((prev) => !prev);
      } else if (matchKb('rename_doc')) {
        // F2: 현재 문서 제목 변경
        e.preventDefault();
        handleOpenRenameDocModal();
      } else if (matchKb('list_prev')) {
        // F3: 목록 이전 선택 (목록에서 이전 파일, 찾기목록에서 이전 위치 등)
        e.preventDefault();
        handleListSelectPrevOrNext(-1);
      } else if (matchKb('list_next')) {
        // F4: 목록 다음 선택 (목록에서 다음 파일, 찾기목록에서 다음 위치 등)
        e.preventDefault();
        handleListSelectPrevOrNext(1);
      } else if (matchKb('rescan_uuid')) {
        // F5: UUID 재스캔
        e.preventDefault();
        handleRunBatchUuidScan();
      } else if (matchKb('dashboard_projects')) {
        // F6: 프로젝트 (루트 Projects/main.md 탭 열기)
        e.preventDefault();
        handleGotoRootMainMd();
      } else if (matchKb('dashboard_lifelog')) {
        // F7: 라이프로그 대쉬보드 탭 열기
        e.preventDefault();
        openDashboardTab('lifelog');
      } else if (matchKb('dashboard_finance')) {
        // F8: 금융 대쉬보드 탭 열기
        e.preventDefault();
        openDashboardTab('finance');
      } else if (matchKb('dashboard_diary')) {
        // F9: 일정 대쉬보드 탭 열기
        e.preventDefault();
        openDashboardTab('diary');
      } else if (matchKb('sync_open_gcal')) {
        // 구글 캘린더 싱크 및 열기
        e.preventDefault();
        handleSyncAndOpenGoogleCalendar();
      } else if (matchKb('run_program')) {
        // 프로그램 수행 (추후 업데이트 예정)
        e.preventDefault();
        handleRunProgramPlaceholder();
      } else if (matchKb('menu_toggle')) {
        // F10: 상단 메뉴바 열기/닫기 토글
        e.preventDefault();
        setMenuBarExpanded((prev) => {
          const next = !prev;
          setActiveMenu(next ? 'file' : null);
          return next;
        });
      } else if (matchKb('toggle_viewer')) {
        // F11: 설정(Projects/.myLore/setting.json)에 따라 전용 독립 뷰어 또는 병렬 뷰어 켜기/끄기 토글
        e.preventDefault();
        handleToggleF11Viewer();
      } else if (matchKb('toggle_fullscreen')) {
        // Shift+F11: 전체 화면
        e.preventDefault();
        handleToggleFullscreen();
      } else if (matchKb('save_doc')) {
        e.preventDefault();
        handleSaveCurrentDoc();
      } else if (
        matchKb('close_tab') ||
        (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'w')
      ) {
        // Ctrl+W: 현재 활성화된 에디터 또는 대쉬보드 탭을 닫고 이전에 사용 중이던 파일/대쉬보드를 활성화
        e.preventDefault();
        e.stopPropagation();
        if (activeTabPath) {
          closeTab(activeTabPath);
        }
      } else if (matchKb('open_file')) {
        e.preventDefault();
        handleOpenNativeFile();
      } else if (matchKb('open_folder')) {
        e.preventDefault();
        handleOpenNativeFolder();
      } else if (matchKb('new_memo')) {
        e.preventDefault();
        handleCreateTempMemo();
      } else if (matchKb('open_settings')) {
        e.preventDefault();
        openDashboardTab('settings');
      } else if (matchKb('find_in_doc')) {
        e.preventDefault();
        setFindBarMode('find');
      } else if (matchKb('replace_in_doc')) {
        e.preventDefault();
        setFindBarMode('replace');
      } else if (matchKb('find_in_files')) {
        e.preventDefault();
        setRightSidebarOpen(true);
        setRightTab('search');
        setGlobalReplaceMode(false);
      } else if (matchKb('replace_in_files')) {
        e.preventDefault();
        setRightSidebarOpen(true);
        setRightTab('search');
        setGlobalReplaceMode(true);
      } else if (matchKb('move_line_up')) {
        e.preventDefault();
        handleMoveLine('up');
      } else if (matchKb('move_line_down')) {
        e.preventDefault();
        handleMoveLine('down');
      } else if (matchKb('add_cursor_up')) {
        e.preventDefault();
        handleAddCursorVertical('up');
      } else if (matchKb('add_cursor_down')) {
        e.preventDefault();
        handleAddCursorVertical('down');
      } else if (matchKb('view_editor')) {
        e.preventDefault();
        handleSelectDocViewMode('editor');
      } else if (matchKb('view_split')) {
        e.preventDefault();
        handleSelectDocViewMode('split');
      } else if (matchKb('view_preview')) {
        e.preventDefault();
        handleSelectDocViewMode('preview');
      } else if (matchKb('view_detached_preview')) {
        e.preventDefault();
        handleToggleDetachedPreview();
      } else if (matchKb('command_palette')) {
        e.preventDefault();
        setPaletteMode('commands');
        setPaletteQuery('');
      } else if (matchKb('quick_open')) {
        e.preventDefault();
        setPaletteMode('files');
        setPaletteQuery('');
      } else if (matchKb('toggle_sidebar')) {
        e.preventDefault();
        setRightSidebarOpen((v) => !v);
      } else if (matchKb('toggle_yaml')) {
        e.preventDefault();
        setIsYamlVisible((v) => !v);
      } else if (matchKb('next_file')) {
        e.preventDefault();
        handleSwitchTabCycle(1);
      } else if (matchKb('prev_file')) {
        e.preventDefault();
        handleSwitchTabCycle(-1);
      } else if (
        matchKb('next_edit_pos') ||
        (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        handleMoveEditPoint(1);
      } else if (
        matchKb('prev_edit_pos') ||
        (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'ArrowLeft')
      ) {
        e.preventDefault();
        handleMoveEditPoint(-1);
      } else if (matchKb('goto_line')) {
        e.preventDefault();
        setGotoLineModalOpen(true);
      } else if (matchKb('goto_bracket')) {
        e.preventDefault();
        handleJumpToMatchingBracket();
      } else if (matchKb('goto_bookmark')) {
        e.preventDefault();
        handleBookmarkJumpOrToggle();
      } else if (matchKb('goto_main_md')) {
        e.preventDefault();
        handleGotoRootMainMd();
      } else if (matchKb('auto_format')) {
        e.preventDefault();
        handleAutoFormatTasks();
      } else {
        const activeEl = document.activeElement as HTMLElement | null;
        const activeTag = activeEl?.tagName || '';
        const isTextInputFocused = ['INPUT', 'TEXTAREA'].includes(activeTag);
        const inFolderInterface =
          !isTextInputFocused &&
          rightSidebarOpen &&
          rightTab === 'tree' &&
          (isFolderPaneFocused || Boolean(activeEl?.closest('.right-sidebar')));

        if (inFolderInterface && (matchKb('trash_doc') || e.key === 'Delete')) {
          e.preventDefault();
          handleTrashDocument();
          return;
        }
        if (
          !isTextInputFocused &&
          trashHistory.length > 0 &&
          (matchKb('undo_trash_doc') ||
            (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z'))
        ) {
          e.preventDefault();
          handleRestoreTrashedDocument();
          return;
        }
        if (e.key === 'Escape') {
          setPaletteMode('closed');
          setActiveMenu(null);
          setActiveSubMenu(null);
          setContextMenu(null);
          setFindBarMode('closed');
          setRenameModalOpen(false);
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
  }, [
    recordingShortcutTarget,
    keybindings,
    currentDoc,
    yamlText,
    bodyText,
    openTabs,
    activeTabPath,
    globalSearchResults,
    activeSearchIdx,
    flattenedFiles,
    rightSidebarOpen,
    rightTab,
    findBarMode,
    isFolderPaneFocused,
    trashHistory,
    detachedPreviewOpen,
    viewMode,
    appSettings,
  ]);

  const handleCreateNewDocSubmit = async () => {
    if (!newDocTitle.trim()) return;
    try {
      const created = await createNewDocument({
        role: newDocRole,
        title: newDocTitle.trim(),
        dateStr: newDocDate,
        calendarCategory: newDocCalendar,
        location: newDocLocation,
        isProjectFolder: newDocRole === 'projects',
        templateFile: newDocTemplate,
      });
      setNewDocModalOpen(false);
      setCalendarModalOpen(false);
      setNewDocTitle('');
      await refreshTree();
      applyLoadedDocument(created);
      setStatusMessage(`새 문서 생성됨: ${created.relativePath}`);
    } catch (err) {
      setStatusMessage(`문서 생성 오류: ${String(err)}`);
    }
  };

  const handlePromoteToProject = async () => {
    if (!currentDoc || !promoteProjectName.trim()) return;
    try {
      const promoted = await promoteToProjectFolder(
        currentDoc.fullPath,
        promoteProjectName.trim()
      );
      setPromoteModalOpen(false);
      await refreshTree();
      applyLoadedDocument(promoted);
      setStatusMessage(
        `📁 프로젝트 폴더로 승격 완료: Projects/${promoteProjectName.trim()}/main.md`
      );
    } catch (err) {
      setStatusMessage(`프로젝트 승격 실패: ${String(err)}`);
    }
  };

  const handleMoveRole = async (targetRole: BaseFolderRole, sourcePath?: string) => {
    const pathToUse = sourcePath || currentDoc?.fullPath;
    if (!pathToUse) return;
    try {
      const moved = await moveDocumentToRole(pathToUse, targetRole);
      await refreshTree();
      applyLoadedDocument(moved);
      setStatusMessage(`🚚 [${targetRole.toUpperCase()}] 폴더로 이동 완료: ${moved.relativePath}`);
    } catch (err) {
      setStatusMessage(`문서 이동 오류: ${String(err)}`);
    }
  };

  // 1단계: 실시간 알림 파싱 테스트
  const handleSimulateRealtimeNotification = async () => {
    try {
      const nowTime = new Date().toTimeString().slice(0, 8);
      const tx = await parseNotificationIntoFinance(
        'com.shcard.smartpay',
        simNotiTitle,
        simNotiText,
        selectedDate,
        nowTime
      );
      await refreshFinanceData();
      await loadLifelogForDate(selectedDate);
      if (tx) {
        setReconcileResultMsg(
          `[1단계 실시간 적재 완료] ${tx.institution} | ${tx.merchant} | ${tx.amount.toLocaleString()}원`
        );
      }
    } catch (err) {
      setReconcileResultMsg(`알림 파싱 오류: ${String(err)}`);
    }
  };

  // 1단계: 카카오톡 대화 텍스트 파싱 적재
  const handleImportKakaoSample = async () => {
    try {
      const res = await importKakaoChatText(simKakaoRoom, simKakaoRaw);
      await loadLifelogForDate(selectedDate);
      setReconcileResultMsg(
        `[카톡 백업 파싱 완료] '${simKakaoRoom}' 대화 ${res.insertedCount}건 적재`
      );
    } catch (err) {
      setReconcileResultMsg(`카톡 파싱 오류: ${String(err)}`);
    }
  };

  // 3단계: 은행/카드사 엑셀 업로드
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        firstSheet,
        { defval: '' }
      );

      const mappedRows = jsonRows
        .map((r) => {
          const dateVal = String(
            r['거래일시'] || r['승인일'] || r['일자'] || r['날짜'] || selectedDate
          )
            .slice(0, 10)
            .replace(/\./g, '-');
          const timeVal = String(r['시간'] || r['승인시간'] || '12:00:00');
          const instVal = String(
            r['금융사'] || r['카드사'] || r['은행'] || '엑셀명세서'
          );
          const merchantVal = String(
            r['가맹점'] || r['적요'] || r['내용'] || r['사용처'] || '기타내역'
          );
          const rawAmt = String(
            r['금액'] || r['이용금액'] || r['출금액'] || r['승인금액'] || '0'
          ).replace(/[^0-9-]/g, '');
          const amount = parseInt(rawAmt || '0', 10);
          return {
            txDate: /^\d{4}-\d{2}-\d{2}$/.test(dateVal)
              ? dateVal
              : selectedDate,
            txTime: timeVal,
            institution: instVal,
            txType: 'expense',
            amount,
            merchant: merchantVal,
            category: String(r['분류'] || r['카테고리'] || '일반'),
            memo: `엑셀 파일(${file.name}) 적재`,
            source: 'excel' as const,
          };
        })
        .filter((r) => r.amount > 0);

      const summary = await importFinanceRows(mappedRows);
      await refreshFinanceData();
      await loadLifelogForDate(selectedDate);
      setReconcileResultMsg(
        `✅ [3단계 엑셀 대조 결과] 총 ${mappedRows.length}건 분석 → 확정(verified) ${summary.reconciledExisting}건, 신규 적재 ${summary.insertedNew}건`
      );
    } catch (err) {
      setReconcileResultMsg(`엑셀 파일 처리 오류: ${String(err)}`);
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const parsedTasks = useMemo(() => extractTasksFromBody(bodyText), [bodyText]);
  const tocHeadings = useMemo(() => extractTocFromBody(bodyText), [bodyText]);

  const insertIntoBody = (snippet: string) => {
    setBodyText((prev) => `${prev}\n${snippet}`);
    setStatusMessage('본문 하단에 선택한 항목이 삽입되었습니다.');
  };

  // 달력 그리드 생성 헬퍼 (`파일 > 새 파일 > 새 일정` 및 `대쉬보드 > 다이어리`)
  const calendarDays = useMemo(() => {
    const { year, month } = calendarYearMonth;
    const firstDay = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();
    const cells: Array<{ day: number | null; dateStr: string; events: FileNode[] }> = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push({ day: null, dateStr: '', events: [] });
    }
    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const events = diaryFilesSorted.filter((f) => f.name.startsWith(dateStr));
      cells.push({ day: d, dateStr, events });
    }
    return cells;
  }, [calendarYearMonth, diaryFilesSorted]);

  // 명령어 팔레트 목록
  const commandItems = [
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
      action: handleOpenRenameDocModal,
    },
    {
      id: 'cmd-new-project',
      label: '파일: 새 프로젝트 생성 (Projects/{폴더}/main.md)',
      shortcut: '',
      action: () => {
        setNewDocRole('projects');
        setNewDocTemplate('project_main.md');
        setNewDocModalOpen(true);
      },
    },
    {
      id: 'cmd-new-schedule',
      label: '파일: 새 일정 생성 (달력 UI 열기)',
      shortcut: '',
      action: () => setCalendarModalOpen(true),
    },
    {
      id: 'cmd-new-memo',
      label: '파일: 새 메모 작성 (프로젝트/임시에 자동 분류)',
      shortcut: getShortcutLabel('new_memo'),
      action: handleCreateTempMemo,
    },
    {
      id: 'cmd-find-in-files',
      label: '편집: 파일에서 찾기 (우측 사이드바 검색)',
      shortcut: getShortcutLabel('find_in_files'),
      action: () => {
        setRightSidebarOpen(true);
        setRightTab('search');
        setGlobalReplaceMode(false);
      },
    },
    {
      id: 'cmd-goto-main',
      label: '이동: main.md로 이동 (루트 Projects/main.md)',
      shortcut: getShortcutLabel('goto_main_md'),
      action: handleGotoRootMainMd,
    },
    {
      id: 'cmd-goto-latest-diary',
      label: '이동: 최신 diary로 이동',
      shortcut: '',
      action: () => handleGotoDiary('latest'),
    },
    {
      id: 'cmd-auto-format',
      label: '실행: 서브 미션 Auto-Format 정렬',
      shortcut: getShortcutLabel('auto_format'),
      action: handleAutoFormatTasks,
    },
    {
      id: 'cmd-scan-uuid',
      label: '실행: UUID 재스캔 (베이스 폴더 일괄 스캔)',
      shortcut: getShortcutLabel('rescan_uuid'),
      action: handleRunBatchUuidScan,
    },
    {
      id: 'cmd-f9-run',
      label: '실행: 프로그램 수행 (추후 업데이트 예정)',
      shortcut: getShortcutLabel('run_program'),
      action: handleRunProgramPlaceholder,
    },
    {
      id: 'cmd-open-templates',
      label: '실행: 볼트 템플릿 관리 및 삽입 (.myLore/templates)',
      shortcut: '',
      action: async () => {
        const tpls = await getVaultTemplates();
        setVaultTemplates(tpls);
        setTemplateModalOpen(true);
      },
    },
    {
      id: 'cmd-dash-projects',
      label: '대쉬보드: 프로젝트 (Projects/main.md 열기)',
      shortcut: getShortcutLabel('dashboard_projects'),
      action: handleGotoRootMainMd,
    },
    {
      id: 'cmd-dash-lifelog',
      label: '대쉬보드: 라이프로그 대쉬보드 탭 열기',
      shortcut: getShortcutLabel('dashboard_lifelog'),
      action: () => openDashboardTab('lifelog'),
    },
    {
      id: 'cmd-dash-finance',
      label: '대쉬보드: 금융 대쉬보드 탭 열기',
      shortcut: getShortcutLabel('dashboard_finance'),
      action: () => openDashboardTab('finance'),
    },
    {
      id: 'cmd-dash-diary',
      label: '대쉬보드: 일정 대쉬보드 탭 열기',
      shortcut: getShortcutLabel('dashboard_diary'),
      action: () => openDashboardTab('diary'),
    },
    {
      id: 'cmd-settings',
      label: '대쉬보드: 설정 대쉬보드 탭 열기 (.myLore/setting.json)',
      shortcut: getShortcutLabel('open_settings'),
      action: () => openDashboardTab('settings'),
    },
    {
      id: 'cmd-f11-viewer',
      label: `보기: F11 뷰어 켜기/끄기 (${
        appSettings.f11ViewerMode === 'detached'
          ? '전용 독립 뷰어'
          : '병렬 뷰어'
      })`,
      shortcut: getShortcutLabel('toggle_viewer'),
      action: handleToggleF11Viewer,
    },
  ];

  return (
    <div
      className="mylore-app"
      onClick={() => {
        setActiveMenu(null);
        setActiveSubMenu(null);
        setContextMenu(null);
        setMobileContextMenu(null);
      }}
    >
      {/* 1. 상단 헤더: 3선 아이콘(☰) + 메뉴(파일/편집/선택/보기/이동/실행/대쉬보드) + 열린 문서 탭 바 */}
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

          {menuBarExpanded && (
            <>
              {/* 1) 파일 (File) */}
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

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleOpenNativeFile();
                      }}
                    >
                      <span>파일 열기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('open_file')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleOpenNativeFolder();
                      }}
                    >
                      <span>폴더 열기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('open_folder')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleOpenRenameDocModal();
                      }}
                    >
                      <span>현재 문서 제목 변경</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('rename_doc')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSaveCurrentDoc();
                      }}
                    >
                      <span>저장</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('save_doc')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        handleUpdateAppSettings({
                          autoSaveEnabled: !autoSaveEnabled,
                        });
                      }}
                    >
                      <span>자동 저장</span>
                      <span className="menu-item-shortcut">
                        {autoSaveEnabled ? '✓ Checked' : 'Off'}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        openDashboardTab('settings');
                      }}
                    >
                      <span>설정 대쉬보드 (.myLore/setting.json)</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('open_settings')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setShortcutsModalOpen(true);
                      }}
                    >
                      <span>도움말 (단축키 설정)</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('open_shortcuts')}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* 2) 편집 (Edit) */}
              <div className="menu-dropdown-wrapper">
                <button
                  className={`menu-trigger ${activeMenu === 'edit' ? 'active' : ''}`}
                  onClick={() =>
                    setActiveMenu(activeMenu === 'edit' ? null : 'edit')
                  }
                >
                  편집
                  {altPressed && <span className="alt-keytip-badge">E</span>}
                </button>
                {activeMenu === 'edit' && (
                  <div className="menu-dropdown">
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleEditorUndo();
                      }}
                    >
                      <span>실행 취소</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('undo')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleEditorRedo();
                      }}
                    >
                      <span>다시 실행</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('redo')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleEditorCut();
                      }}
                    >
                      <span>잘라내기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('cut')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleEditorCopy();
                      }}
                    >
                      <span>복사</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('copy')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleEditorPaste();
                      }}
                    >
                      <span>붙여넣기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('paste')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setFindBarMode('find');
                      }}
                    >
                      <span>찾기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('find_in_doc')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setFindBarMode('replace');
                      }}
                    >
                      <span>바꾸기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('replace_in_doc')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setRightSidebarOpen(true);
                        setRightTab('search');
                        setGlobalReplaceMode(false);
                      }}
                    >
                      <span>파일에서 찾기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('find_in_files')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setRightSidebarOpen(true);
                        setRightTab('search');
                        setGlobalReplaceMode(true);
                      }}
                    >
                      <span>파일에서 바꾸기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('replace_in_files')}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* 3) 선택 (Selection) */}
              <div className="menu-dropdown-wrapper">
                <button
                  className={`menu-trigger ${activeMenu === 'selection' ? 'active' : ''}`}
                  onClick={() =>
                    setActiveMenu(
                      activeMenu === 'selection' ? null : 'selection'
                    )
                  }
                >
                  선택
                  {altPressed && <span className="alt-keytip-badge">S</span>}
                </button>
                {activeMenu === 'selection' && (
                  <div className="menu-dropdown">
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSelectAll();
                      }}
                    >
                      <span>모두 선택</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('select_all')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleMoveLine('up');
                      }}
                    >
                      <span>줄 위로 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('move_line_up')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleMoveLine('down');
                      }}
                    >
                      <span>줄 아래로 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('move_line_down')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleAddCursorVertical('up');
                      }}
                    >
                      <span>위에 커서 추가</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('add_cursor_up')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleAddCursorVertical('down');
                      }}
                    >
                      <span>아래 커서 추가</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('add_cursor_down')}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* 4) 보기 (View) */}
              <div className="menu-dropdown-wrapper">
                <button
                  className={`menu-trigger ${activeMenu === 'view' ? 'active' : ''}`}
                  onClick={() =>
                    setActiveMenu(activeMenu === 'view' ? null : 'view')
                  }
                >
                  보기
                  {altPressed && <span className="alt-keytip-badge">V</span>}
                </button>
                {activeMenu === 'view' && (
                  <div className="menu-dropdown">
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setPaletteMode('commands');
                        setPaletteQuery('');
                      }}
                    >
                      <span>명령어 팔레트 소환</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('command_palette')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setPaletteMode('files');
                        setPaletteQuery('');
                      }}
                    >
                      <span>빠른 문서 열기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('quick_open')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleToggleF11Viewer();
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#a5b4fc' }}>
                        {appSettings.f11ViewerMode === 'detached'
                          ? `${detachedPreviewOpen ? '✓ ' : ''}🪟 전용 독립 뷰어 켜기/끄기`
                          : `${viewMode === 'split' ? '✓ ' : ''}📐 병렬 뷰어 켜기/끄기`}
                      </span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('toggle_viewer')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSelectDocViewMode('editor');
                      }}
                    >
                      <span>
                        {viewMode === 'editor' && !detachedPreviewOpen ? '✓ ' : ''}
                        에디터 전용 모드
                      </span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('view_editor')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSelectDocViewMode('split');
                      }}
                    >
                      <span>
                        {viewMode === 'split' && !detachedPreviewOpen ? '✓ ' : ''}
                        병렬 뷰어 모드 (분할 화면)
                      </span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('view_split')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSelectDocViewMode('preview');
                      }}
                    >
                      <span>
                        {viewMode === 'preview' && !detachedPreviewOpen ? '✓ ' : ''}
                        뷰어 전용 모드
                      </span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('view_preview')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleToggleDetachedPreview();
                      }}
                    >
                      <span>
                        {detachedPreviewOpen ? '✓ ' : ''}
                        전용 독립 뷰어 창 모드
                      </span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('view_detached_preview')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setIsYamlVisible((v) => !v);
                      }}
                    >
                      <span>YAML 메타데이터 표시/숨기기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('toggle_yaml')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setRightSidebarOpen((v) => !v);
                      }}
                    >
                      <span>우측 사이드바 접기/펼치기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('toggle_sidebar')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleToggleFullscreen();
                      }}
                    >
                      <span>전체 화면</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('toggle_fullscreen')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={async () => {
                        setActiveMenu(null);
                        await openInChromeAppMode();
                      }}
                    >
                      <span>Google Chrome 앱 모드로 열기</span>
                      <span className="menu-item-shortcut">Chrome</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 5) 이동 (Go) */}
              <div className="menu-dropdown-wrapper">
                <button
                  className={`menu-trigger ${activeMenu === 'go' ? 'active' : ''}`}
                  onClick={() =>
                    setActiveMenu(activeMenu === 'go' ? null : 'go')
                  }
                >
                  이동
                  {altPressed && <span className="alt-keytip-badge">G</span>}
                </button>
                {activeMenu === 'go' && (
                  <div className="menu-dropdown">
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleListSelectPrevOrNext(-1);
                      }}
                    >
                      <span>목록 이전 선택 (파일 / 찾기 목록)</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('list_prev')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleListSelectPrevOrNext(1);
                      }}
                    >
                      <span>목록 다음 선택 (파일 / 찾기 목록)</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('list_next')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSwitchTabCycle(1);
                      }}
                    >
                      <span>다음 탭으로 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('next_file')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSwitchTabCycle(-1);
                      }}
                    >
                      <span>이전 탭으로 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('prev_file')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleMoveEditPoint(1);
                      }}
                    >
                      <span>다음 편집점으로 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('next_edit_pos')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleMoveEditPoint(-1);
                      }}
                    >
                      <span>이전 편집점으로 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('prev_edit_pos')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setGotoLineModalOpen(true);
                      }}
                    >
                      <span>줄 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('goto_line')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleJumpToMatchingBracket();
                      }}
                    >
                      <span>괄호 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('goto_bracket')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleBookmarkJumpOrToggle();
                      }}
                    >
                      <span>북마크 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('goto_bookmark')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleGotoRootMainMd();
                      }}
                    >
                      <span>main.md로 이동</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('goto_main_md')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleGotoDiary('latest');
                      }}
                    >
                      <span>최신 diary로 이동</span>
                      <span className="menu-item-shortcut">Latest Diary</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleGotoDiary('prev');
                      }}
                    >
                      <span>이전 diary로 이동</span>
                      <span className="menu-item-shortcut">Prev Diary</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleGotoDiary('next');
                      }}
                    >
                      <span>다음 diary로 이동</span>
                      <span className="menu-item-shortcut">Next Diary</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleSyncAndOpenGoogleCalendar();
                      }}
                    >
                      <span>구글 캘린더 싱크 및 열기</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('sync_open_gcal')}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* 6) 실행 (Run) */}
              <div className="menu-dropdown-wrapper">
                <button
                  className={`menu-trigger ${activeMenu === 'run' ? 'active' : ''}`}
                  onClick={() =>
                    setActiveMenu(activeMenu === 'run' ? null : 'run')
                  }
                >
                  실행
                  {altPressed && <span className="alt-keytip-badge">R</span>}
                </button>
                {activeMenu === 'run' && (
                  <div className="menu-dropdown">
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleRunProgramPlaceholder();
                      }}
                    >
                      <span>프로그램 수행 (추후 업데이트 예정)</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('run_program')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleRunBatchUuidScan();
                      }}
                    >
                      <span>UUID 재스캔</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('rescan_uuid')}
                      </span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleAutoFormatTasks();
                      }}
                    >
                      <span>서브미션 Auto-Format 정렬</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('auto_format')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={async () => {
                        setActiveMenu(null);
                        const tpls = await getVaultTemplates();
                        setVaultTemplates(tpls);
                        setTemplateModalOpen(true);
                      }}
                    >
                      <span>템플릿 관리 및 삽입 (.myLore)</span>
                      <span className="menu-item-shortcut">Templates</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        if (currentDoc) {
                          navigator.clipboard.writeText(
                            `[문서링크](mylore://doc/${currentDoc.uuid})`
                          );
                          setStatusMessage(
                            `🔗 복사됨: mylore://doc/${currentDoc.uuid}`
                          );
                        }
                      }}
                    >
                      <span>현재 문서 UUID 링크 복사</span>
                      <span className="menu-item-shortcut">mylore://</span>
                    </button>

                    <div className="menu-divider" />

                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        if (currentDoc) {
                          const baseName = currentDoc.relativePath
                            .split(/[\\/]/)
                            .pop()
                            ?.replace(/\.md$/i, '');
                          setPromoteProjectName(baseName || '새프로젝트');
                          setPromoteModalOpen(true);
                        }
                      }}
                    >
                      <span>현재 문서를 프로젝트(main.md)로 승격</span>
                      <span className="menu-item-shortcut">Promote</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleMoveRole('projects');
                      }}
                    >
                      <span>프로젝트(Projects) 폴더로 이동</span>
                      <span className="menu-item-shortcut">Move</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleMoveRole('diary');
                      }}
                    >
                      <span>일기(Diary) 폴더로 이동</span>
                      <span className="menu-item-shortcut">Move</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleMoveRole('data');
                      }}
                    >
                      <span>데이터(Archive) 폴더로 이동</span>
                      <span className="menu-item-shortcut">Move</span>
                    </button>
                  </div>
                )}
              </div>

              {/* 7) 대쉬보드 (Dashboard) */}
              <div className="menu-dropdown-wrapper">
                <button
                  className={`menu-trigger ${activeMenu === 'dashboard' ? 'active' : ''}`}
                  onClick={() =>
                    setActiveMenu(
                      activeMenu === 'dashboard' ? null : 'dashboard'
                    )
                  }
                >
                  대쉬보드
                  {altPressed && <span className="alt-keytip-badge">D</span>}
                </button>
                {activeMenu === 'dashboard' && (
                  <div className="menu-dropdown">
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        handleGotoRootMainMd();
                      }}
                    >
                      <span>📁 프로젝트 (Projects/main.md)</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('dashboard_projects')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        openDashboardTab('lifelog');
                      }}
                    >
                      <span>📱 라이프로그 대쉬보드</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('dashboard_lifelog')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        openDashboardTab('finance');
                      }}
                    >
                      <span>💳 금융 대쉬보드</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('dashboard_finance')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        openDashboardTab('diary');
                      }}
                    >
                      <span>📅 일정 대쉬보드</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('dashboard_diary')}
                      </span>
                    </button>
                    <div className="menu-divider" />
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        openDashboardTab('settings');
                      }}
                    >
                      <span>⚙️ 설정 대쉬보드 (.myLore/setting.json)</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('open_settings')}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 다중 문서 탭 바 (일반 .md 문서 및 대쉬보드를 동일한 탭으로 구분하고 현재 열린 탭 하이라이트) */}
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

        {/* 상단바 우측 정렬 바로가기 아이콘 (7개 순서: 프로젝트 / 라이프로그 / 금융 / 달력(일정) / 구글캘린더 / 설정 / 사이드바) */}
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

      {/* 2. 메인 바디 영역 */}
      <div className="workspace-body">
        <main
          className="main-stage"
          onMouseDown={() => setIsFolderPaneFocused(false)}
        >
          {activeTabPath === 'mylore://dashboard/diary' ? (
            /* 대쉬보드 > 일정 (달력 UI + 일정 생성/열람 — 일반 탭으로 동작) */
            <div className="finance-workspace">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>
                    📅 일정 대쉬보드 ({calendarYearMonth.year}년 {calendarYearMonth.month}월)
                  </h2>
                  <button
                    className="toolbar-btn"
                    onClick={() =>
                      setCalendarYearMonth((p) =>
                        p.month === 1
                          ? { year: p.year - 1, month: 12 }
                          : { year: p.year, month: p.month - 1 }
                      )
                    }
                  >
                    ◀ 이전 달
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() =>
                      setCalendarYearMonth((p) =>
                        p.month === 12
                          ? { year: p.year + 1, month: 1 }
                          : { year: p.year, month: p.month + 1 }
                      )
                    }
                  >
                    다음 달 ▶
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                빈 날짜 칸을 클릭하면 해당 날짜에 새 일정(`.md`)을 생성하고, 기존 일정 배지를 클릭하면 해당 문서를 즉시 탭으로 엽니다.
              </p>
              <div className="calendar-grid">
                {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
                  <div key={w} className="calendar-weekday-header">
                    {w}
                  </div>
                ))}
                {calendarDays.map((cell, idx) =>
                  cell.day === null ? (
                    <div key={`empty-${idx}`} />
                  ) : (
                    <div
                      key={cell.dateStr}
                      className={`calendar-day-cell ${
                        newDocDate === cell.dateStr ? 'selected' : ''
                      }`}
                      onClick={() => {
                        setNewDocRole('diary');
                        setNewDocDate(cell.dateStr);
                        setNewDocTemplate('diary_default.md');
                        setNewDocModalOpen(true);
                      }}
                    >
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 700,
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {cell.day}
                      </div>
                      {cell.events.map((ev) => (
                        <div
                          key={ev.fullPath}
                          className="calendar-event-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDocumentByNode(ev);
                          }}
                          title={ev.name}
                        >
                          {ev.name.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').replace(/\.md$/i, '')}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          ) : activeTabPath === 'mylore://dashboard/lifelog' ? (
            /* 대쉬보드 > 라이프로그 대쉬보드 (2탭: 설정 | 휴대폰데이터 — 일반 탭으로 동작) */
            <div className="finance-workspace">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '14px',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
                    📱 라이프로그 대쉬보드
                  </h2>
                  {/* 2개 메인 탭: 설정 | 휴대폰데이터 */}
                  <div
                    style={{
                      display: 'inline-flex',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '3px',
                      gap: '4px',
                    }}
                  >
                    <button
                      className={`toolbar-btn ${lifelogDashboardTab === 'settings' ? 'primary' : ''}`}
                      style={{ border: 'none', padding: '6px 14px', fontWeight: 700 }}
                      onClick={() => {
                        setLifelogDashboardTab('settings');
                        refreshMobilePairingInfo();
                      }}
                    >
                      ⚙️ 설정
                    </button>
                    <button
                      className={`toolbar-btn ${lifelogDashboardTab === 'mobile' ? 'primary' : ''}`}
                      style={{ border: 'none', padding: '6px 14px', fontWeight: 700 }}
                      onClick={() => {
                        setLifelogDashboardTab('mobile');
                        setRightSidebarOpen(true);
                        refreshAllLifelogMessages();
                      }}
                    >
                      📱 휴대폰데이터
                    </button>
                  </div>
                </div>
              </div>

              {mobileSyncProgress &&
                (() => {
                  const activeStep =
                    mobileSyncProgress.steps[
                      mobileSyncProgress.currentStepIndex
                    ] ||
                    mobileSyncProgress.steps[
                      mobileSyncProgress.steps.length - 1
                    ];
                  return (
                    <div
                      style={{
                        padding: '14px 16px',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--accent-primary)',
                        borderRadius: '10px',
                        marginBottom: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '13.5px',
                              color: '#e0e7ff',
                            }}
                          >
                            {mobileSyncProgress.isRunning
                              ? `🔄 [${mobileSyncProgress.currentStepIndex + 1}/${mobileSyncProgress.totalSteps}] ${mobileSyncProgress.currentLabel}`
                              : `✅ ${mobileSyncProgress.currentLabel}`}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12.5px',
                              fontWeight: 700,
                              color: '#4ade80',
                            }}
                          >
                            {mobileSyncProgress.currentPercent}%
                          </span>
                          {activeStep && (
                            <span
                              style={{
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              (총 {activeStep.totalCount}건)
                            </span>
                          )}
                          {mobileSyncProgress.isRunning && (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                fontWeight: 700,
                                fontFamily: 'var(--font-mono)',
                                backgroundColor: 'rgba(56, 189, 248, 0.16)',
                                border: '1px solid rgba(56, 189, 248, 0.4)',
                                color: '#7dd3fc',
                              }}
                              title="메인 UI 스레드와 분리된 전용 백그라운드 워커 스레드에서 비동기 일괄 적재 중"
                            >
                              ⚡ 백그라운드 스레드 처리 중
                              {(mobileSyncProgress.queuedJobs ?? 0) > 0
                                ? ` (큐 대기 ${mobileSyncProgress.queuedJobs}건)`
                                : ''}
                            </span>
                          )}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            fontSize: '11.5px',
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                            }}
                          >
                            <span
                              style={{
                                width: '10px',
                                height: '10px',
                                borderRadius: '2px',
                                backgroundColor: '#3b82f6',
                                display: 'inline-block',
                              }}
                            />
                            <span style={{ color: '#93c5fd', fontWeight: 600 }}>
                              이미 보유(스킵): {activeStep?.skippedCount ?? 0}건
                            </span>
                          </span>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                            }}
                          >
                            <span
                              style={{
                                width: '10px',
                                height: '10px',
                                borderRadius: '2px',
                                backgroundColor: '#22c55e',
                                display: 'inline-block',
                              }}
                            />
                            <span style={{ color: '#86efac', fontWeight: 600 }}>
                              신규 다운로드: {activeStep?.downloadedCount ?? 0}건
                            </span>
                          </span>
                          {!mobileSyncProgress.isRunning && (
                            <button
                              className="toolbar-btn"
                              style={{ padding: '2px 8px', fontSize: '11px' }}
                              onClick={() => setMobileSyncProgress(null)}
                            >
                              ✕ 닫기
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 구간별(Segmented) 진행률 바: 이미 보유하여 넘어간 구간은 파란색(#3b82f6), 다운로드 받은 구간은 녹색(#22c55e) */}
                      <div
                        style={{
                           display: 'flex',
                          width: '100%',
                          height: '14px',
                          backgroundColor: 'rgba(15, 23, 42, 0.75)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                          border: '1px solid rgba(148, 163, 184, 0.28)',
                        }}
                      >
                        {(activeStep?.segments || []).map((seg, idx) => (
                          <div
                            key={`seg-${idx}`}
                            style={{
                              width: `${seg.widthPct}%`,
                              height: '100%',
                              backgroundColor:
                                seg.kind === 'download' ? '#22c55e' : '#3b82f6',
                              transition: 'width 120ms linear',
                            }}
                            title={
                              seg.kind === 'download'
                                ? '신규 다운로드 구간 (녹색)'
                                : '이미 PC에 보유하여 스킵한 구간 (파란색)'
                            }
                          />
                        ))}
                      </div>

                      {/* 6개 카테고리 순환 단계 배지 */}
                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          flexWrap: 'wrap',
                          fontSize: '11.5px',
                        }}
                      >
                        {mobileSyncProgress.steps.map((st) => (
                          <span
                            key={st.key}
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              backgroundColor:
                                st.status === 'running'
                                  ? 'rgba(79, 70, 229, 0.22)'
                                  : 'var(--bg-primary)',
                              border:
                                st.status === 'running'
                                  ? '1px solid var(--accent-primary)'
                                  : '1px solid var(--border-color)',
                              opacity: st.status === 'pending' ? 0.55 : 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <strong style={{ color: '#e2e8f0' }}>
                              {st.status === 'done'
                                ? '✓ '
                                : st.status === 'running'
                                  ? '⏳ '
                                  : '• '}
                              {st.label.replace(' 받아오는 중...', '')} (
                              {st.percent}%)
                            </strong>
                            <span
                              style={{
                                color: '#93c5fd',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              스킵 {st.skippedCount}
                            </span>
                            <span
                              style={{
                                color: '#86efac',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              신규 {st.downloadedCount}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

              {reconcileResultMsg && (
                <div
                  style={{
                    padding: '10px 14px',
                    backgroundColor: 'var(--accent-soft)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: '8px',
                    marginBottom: '14px',
                    color: '#e0e7ff',
                    fontWeight: 600,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ whiteSpace: 'pre-wrap' }}>{reconcileResultMsg}</span>
                  <button
                    className="toolbar-btn"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => setReconcileResultMsg('')}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* =========================================================
                  탭 1: ⚙️ 설정 (QR 코드를 표보다 위에 배치 + 통합 설정 표)
                 ========================================================= */}
              {lifelogDashboardTab === 'settings' && mobilePairing && (
                <div
                  style={{
                    padding: '18px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  {/* 상단: QR 코드 (표보다 위에 표시) — Base64 딥링크(myloresync://pair?data=...)만 제공 */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      padding: '8px 0 4px 0',
                    }}
                  >
                    <div
                      style={{
                        padding: '12px',
                        backgroundColor: '#ffffff',
                        borderRadius: '10px',
                        border: '2px solid var(--accent-primary)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.25)',
                      }}
                      title="기본 카메라 앱으로 촬영 시 myLore Sync 앱이 열리며 즉시 연결됩니다 (myloresync://pair?data=...)"
                    >
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt="myLore Sync Pairing QR Code"
                          style={{ width: '200px', height: '200px', display: 'block' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '200px',
                            height: '200px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#334155',
                            fontSize: '12px',
                          }}
                        >
                          QR 생성 중...
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 하단 본문: 설정·상태 항목을 하나의 통합 표(Table)로 제공 */}
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ marginBottom: 0 }}>
                      <thead>
                        <tr>
                          <th style={{ width: '170px' }}>항목</th>
                          <th>설정 값 및 인라인 제어</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* 1. 호스트 이름 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>호스트 이름</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {mobilePairing.pcName}
                          </td>
                        </tr>

                        {/* 2. IPv4 주소 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>IPv4 주소</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {mobilePairing.ips.join(', ')}
                          </td>
                        </tr>

                        {/* 3. 포트 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>포트</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {mobilePairing.port} (UDP 브로드캐스트: 18444)
                          </td>
                        </tr>

                        {/* 4. 토큰 + [다른 기기 연결] + [과거 모든 데이터 받아오기] */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>토큰</td>
                          <td>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <code
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '12px',
                                  padding: '3px 8px',
                                  backgroundColor: 'var(--bg-primary)',
                                  borderRadius: '6px',
                                  border: '1px solid var(--border-color)',
                                }}
                              >
                                {mobilePairing.token}
                              </code>
                              <button
                                className="toolbar-btn primary"
                                onClick={async () => {
                                  await refreshMobilePairingInfo();
                                  const wakeMsg = await sendMobileUdpWakeBroadcast();
                                  const guideMsg = `📲 다른 기기 추가 연결 준비 완료: 상단 QR 코드를 추가할 휴대폰의 기본 카메라로 스캔하세요. (기존 기기 연결 유지됨 | ${wakeMsg})`;
                                  setStatusMessage(guideMsg);
                                  setReconcileResultMsg(guideMsg);
                                }}
                                title="기존 페어링된 기기를 유지한 채 새로운 모바일 기기를 추가로 등록합니다"
                              >
                                📱 다른 기기 연결
                              </button>
                              <button
                                className="toolbar-btn"
                                onClick={async () => {
                                  try {
                                    const updated = await triggerFullMobileResync();
                                    setMobilePairing(updated);
                                    const msg =
                                      '🔄 과거 모든 데이터 재수집(Full Resync) 신호(UDP 18444 & force_full_sync)가 송출되었으며 동기화 워터마크가 초기화되었습니다.';
                                    setStatusMessage(msg);
                                    setReconcileResultMsg(msg);
                                  } catch (err) {
                                    setStatusMessage(`전체 재수집 요청 오류: ${String(err)}`);
                                  }
                                }}
                                title="모바일 기기의 동기화 워터마크를 초기화하여 과거의 모든 카톡·알림·문자·통화·연락처 데이터를 처음부터 다시 받아옵니다"
                              >
                                🔄 과거 모든 데이터 받아오기
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* 5. SSID + 인라인 입력 + [SSID 변경] */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>SSID</td>
                          <td>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <input
                                className="input-field"
                                style={{
                                  flex: 1,
                                  minWidth: '200px',
                                  maxWidth: '340px',
                                  fontFamily: 'var(--font-mono)',
                                }}
                                value={ssidInputText}
                                onChange={(e) => setSsidInputText(e.target.value)}
                                placeholder="예: iseohyun, seohyun5G"
                              />
                              <button
                                className="toolbar-btn primary"
                                onClick={async () => {
                                  const parsed = ssidInputText
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean);
                                  const updated = await updateMobilePairingConfig(
                                    parsed,
                                    false
                                  );
                                  setMobilePairing(updated);
                                  setSsidInputText(updated.ssids.join(', '));
                                  const msg = `✅ 허용 Wi-Fi SSID가 [${updated.ssids.join(', ')}](으)로 변경되어 QR 코드에 반영되었습니다.`;
                                  setStatusMessage(msg);
                                  setReconcileResultMsg(msg);
                                }}
                              >
                                SSID 변경
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* 6. 등록 기기명 + 기기별 [기기 제거] 버튼 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>등록 기기명</td>
                          <td>
                            {mobilePairing.pairedDevices.length === 0 ? (
                              <span style={{ color: 'var(--text-muted)' }}>
                                미등록 (상단 QR 코드를 휴대폰 카메라로 스캔하세요)
                              </span>
                            ) : (
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                {mobilePairing.pairedDevices.map((dev) => (
                                  <span
                                    key={dev.deviceId}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      padding: '3px 10px',
                                      backgroundColor: 'var(--bg-primary)',
                                      border: '1px solid var(--border-color)',
                                      borderRadius: '6px',
                                      fontWeight: 700,
                                    }}
                                  >
                                    <span>📱 {dev.deviceName}</span>
                                    <button
                                      className="toolbar-btn"
                                      style={{
                                        padding: '1px 6px',
                                        fontSize: '11px',
                                        color: '#f87171',
                                        borderColor: 'rgba(248, 113, 113, 0.4)',
                                      }}
                                      onClick={async () => {
                                        const updated = await removePairedMobileDevice(
                                          dev.deviceId
                                        );
                                        setMobilePairing(updated);
                                        const msg = `🗑️ 기기 '${dev.deviceName}' (${dev.deviceId}) 연결이 제거되었습니다.`;
                                        setStatusMessage(msg);
                                        setReconcileResultMsg(msg);
                                      }}
                                      title={`${dev.deviceName} (${dev.deviceId}) 기기 등록 해제`}
                                    >
                                      기기 제거
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>

                        {/* 7. 기기 ID */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>기기 ID</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {mobilePairing.pairedDevices.length === 0
                              ? '-'
                              : mobilePairing.pairedDevices
                                  .map((d) => `${d.deviceName}: ${d.deviceId}`)
                                  .join(' | ')}
                          </td>
                        </tr>

                        {/* 8. 모델 버전 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>모델 버전</td>
                          <td>
                            {mobilePairing.pairedDevices.length === 0
                              ? '-'
                              : mobilePairing.pairedDevices
                                  .map((d) => `${d.deviceName}: ${d.model}`)
                                  .join(' | ')}
                          </td>
                        </tr>

                        {/* 9. 최초 페어링 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>최초 페어링</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                            {mobilePairing.pairedDevices.length === 0
                              ? '-'
                              : mobilePairing.pairedDevices
                                  .map((d) => `${d.deviceName}: ${d.pairedAt}`)
                                  .join(' | ')}
                          </td>
                        </tr>

                        {/* 10. 최근 페어링 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>최근 페어링</td>
                          <td
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              color:
                                mobilePairing.pairedDevices.length > 0
                                  ? '#4ade80'
                                  : 'var(--text-muted)',
                              fontWeight: 600,
                            }}
                          >
                            {mobilePairing.pairedDevices.length === 0
                              ? '-'
                              : mobilePairing.pairedDevices
                                  .map((d) => `${d.deviceName}: ${d.lastSeenAt}`)
                                  .join(' | ')}
                          </td>
                        </tr>

                        {/* 11. Gemini API 키 (붙여넣기 즉시 자동 검증 + [구글 API키 받기] + [저장]) */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>Gemini API 키</td>
                          <td>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <span
                                style={{
                                  padding: '3px 10px',
                                  borderRadius: '999px',
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  backgroundColor: geminiStatus?.hasKey
                                    ? 'rgba(34, 197, 94, 0.18)'
                                    : 'rgba(245, 158, 11, 0.18)',
                                  color: geminiStatus?.hasKey
                                    ? '#4ade80'
                                    : '#fbbf24',
                                }}
                              >
                                {isVerifyingGemini
                                  ? '⏳ 자동 검증 중...'
                                  : geminiStatus?.hasKey
                                    ? `✓ 연동됨 (${geminiStatus.maskedKey} · ${geminiStatus.modelName || 'gemini-3.8-flash'})`
                                    : '미등록'}
                              </span>

                              <input
                                type="password"
                                className="input-field"
                                style={{
                                  flex: 1,
                                  minWidth: '210px',
                                  maxWidth: '320px',
                                  fontFamily: 'var(--font-mono)',
                                }}
                                value={geminiKeyInput}
                                disabled={isVerifyingGemini}
                                onChange={(e) => setGeminiKeyInput(e.target.value)}
                                onPaste={(e) => {
                                  const pasted = e.clipboardData.getData('text');
                                  if (pasted && pasted.trim()) {
                                    e.preventDefault();
                                    setGeminiKeyInput(pasted.trim());
                                    setTimeout(() => {
                                      tryRegisterGeminiKeyString(pasted.trim());
                                    }, 20);
                                  }
                                }}
                                placeholder="AIzaSy... 붙여넣기 시 즉시 자동 검증·저장"
                              />

                              <button
                                className="toolbar-btn primary"
                                onClick={() => {
                                  setAwaitingClipboardKey(true);
                                  openExternalUrlInChrome(
                                    'https://aistudio.google.com/app/apikey'
                                  );
                                  setStatusMessage(
                                    '🌐 Google AI Studio가 열렸습니다. API 키를 복사하거나 입력창에 붙여넣으면 자동으로 검증·저장됩니다.'
                                  );
                                }}
                              >
                                구글 API키 받기
                              </button>

                              <button
                                className="toolbar-btn primary"
                                disabled={isVerifyingGemini}
                                onClick={async () => {
                                  if (geminiKeyInput.trim()) {
                                    await tryRegisterGeminiKeyString(geminiKeyInput);
                                  } else {
                                    try {
                                      const clip = await navigator.clipboard.readText();
                                      await tryRegisterGeminiKeyString(clip);
                                    } catch {
                                      await tryRegisterGeminiKeyString(geminiKeyInput);
                                    }
                                  }
                                }}
                              >
                                {isVerifyingGemini ? '검증 중...' : '저장'}
                              </button>

                              {geminiStatus?.hasKey && (
                                <button
                                  className="toolbar-btn"
                                  disabled={isVerifyingGemini}
                                  onClick={async () => {
                                    const stat = await saveAndVerifyGeminiApiKey('');
                                    setGeminiStatus(stat);
                                    setStatusMessage(
                                      '🗑️ 로컬 보안 저장소에서 Gemini API 키가 삭제되었습니다.'
                                    );
                                  }}
                                >
                                  삭제
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* 12. 자동 스크립트 추출 (기본 Yes: 가장 최근 통화음성부터 토큰이 허락하는 대로 자동 추출) */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>자동 스크립트 추출</td>
                          <td>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <div style={{ display: 'inline-flex', gap: '4px' }}>
                                <button
                                  className={`toolbar-btn ${
                                    (geminiStatus?.autoCallTranscription ??
                                      appSettings.autoCallTranscription ??
                                      true)
                                      ? 'primary'
                                      : ''
                                  }`}
                                  style={{ padding: '4px 12px', fontSize: '12px' }}
                                  onClick={async () => {
                                    const stat = await setAutoCallTranscription(true);
                                    setGeminiStatus(stat);
                                    setAppSettings((prev) => ({
                                      ...prev,
                                      autoCallTranscription: true,
                                    }));
                                    setStatusMessage(
                                      '✅ 자동 스크립트 추출(Yes) 활성화: 가장 최근 통화음성부터 토큰이 허락하는 대로 스크립트 및 요약을 자동 추출합니다.'
                                    );
                                  }}
                                >
                                  ✓ Yes (자동 추출)
                                </button>
                                <button
                                  className={`toolbar-btn ${
                                    !(
                                      geminiStatus?.autoCallTranscription ??
                                      appSettings.autoCallTranscription ??
                                      true
                                    )
                                      ? 'primary'
                                      : ''
                                  }`}
                                  style={{ padding: '4px 12px', fontSize: '12px' }}
                                  onClick={async () => {
                                    const stat = await setAutoCallTranscription(false);
                                    setGeminiStatus(stat);
                                    setAppSettings((prev) => ({
                                      ...prev,
                                      autoCallTranscription: false,
                                    }));
                                    setStatusMessage(
                                      '⏸️ 자동 스크립트 추출(No) 비활성화: 통화 우클릭 메뉴에서 원하는 통화만 선택하여 추출할 수 있습니다.'
                                    );
                                  }}
                                >
                                  No (수동만)
                                </button>
                              </div>
                              <span
                                style={{
                                  fontSize: '11.5px',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                가장 최근 통화음성부터 토큰이 허락하는 대로 자동 추출 · 토큰 부족 시 마지막 실패시각 기억 후 <strong>5시간 대기 뒤 자동 재시도</strong>
                              </span>
                            </div>
                          </td>
                        </tr>

                        {/* 13. LLM 토큰 사용량 및 쿼터 상태 */}
                        <tr>
                          <td style={{ fontWeight: 700 }}>토큰 사용량 / 상태</td>
                          <td>
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '12px',
                                  flexWrap: 'wrap',
                                  fontSize: '12px',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                <span>
                                  📊 오늘 사용:{' '}
                                  <strong style={{ color: '#4ade80' }}>
                                    {(
                                      geminiStatus?.todayUsedTokens ?? 0
                                    ).toLocaleString()}{' '}
                                    토큰
                                  </strong>{' '}
                                  ({geminiStatus?.todayRequestCount ?? 0}회 요청)
                                </span>
                                <span style={{ color: 'var(--border-color)' }}>|</span>
                                <span>
                                  누적 사용:{' '}
                                  <strong>
                                    {(
                                      geminiStatus?.totalUsedTokens ?? 0
                                    ).toLocaleString()}{' '}
                                    토큰
                                  </strong>
                                </span>
                                <span style={{ color: 'var(--border-color)' }}>|</span>
                                <span>
                                  직전 요청:{' '}
                                  {(
                                    geminiStatus?.lastRequestTokens ?? 0
                                  ).toLocaleString()}{' '}
                                  토큰
                                </span>
                                <span style={{ color: 'var(--border-color)' }}>|</span>
                                <span>
                                  대기 통화:{' '}
                                  <strong
                                    style={{
                                      color:
                                        (geminiStatus?.pendingCallCount ?? 0) > 0
                                          ? '#f87171'
                                          : '#94a3b8',
                                    }}
                                  >
                                    {geminiStatus?.pendingCallCount ?? 0}건
                                  </strong>
                                </span>
                                <button
                                  className="toolbar-btn"
                                  style={{ padding: '2px 8px', fontSize: '11px' }}
                                  onClick={() =>
                                    openExternalUrlInChrome(
                                      'https://aistudio.google.com/app/plan_information'
                                    )
                                  }
                                  title="Google AI Studio 공식 플랜 및 잔여 할당량(Rate Limit) 대시보드 열기"
                                >
                                  📈 AI Studio 잔여 한도 조회
                                </button>
                              </div>
                              {geminiStatus?.quotaExhaustedAt && (
                                <div
                                  style={{
                                    fontSize: '11.5px',
                                    color: '#fca5a5',
                                    fontWeight: 600,
                                  }}
                                >
                                  ⚠️ 마지막 토큰 부족 실패시각:{' '}
                                  <code>{geminiStatus.quotaExhaustedAt}</code> → 5시간 대기 후 재시도 예정:{' '}
                                  <code>{geminiStatus.retryAfterAt || '5시간 후'}</code>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* =========================================================
                  탭 2: 📱 휴대폰데이터 (우측 사이드바 4탭 자동 전환 + 인물/분류 검색 및 우클릭 컨텍스트 메뉴)
                 ========================================================= */}
              {lifelogDashboardTab === 'mobile' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* 상단 필터 & 우클릭 인물 검색 표시 바 */}
                  <div
                    style={{
                      padding: '12px 16px',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>
                        🔍 인물/키워드 검색:
                      </span>
                      <input
                        className="input-field"
                        style={{ width: '200px' }}
                        value={mobilePersonFilter}
                        onChange={(e) => setMobilePersonFilter(e.target.value)}
                        placeholder="예: 임현정, 캠핑..."
                      />
                      <div style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
                        {(
                          [
                            { key: 'all', label: '전체 기록' },
                            { key: 'kakaotalk', label: '카톡' },
                            { key: 'notification', label: '알림' },
                            { key: 'sms', label: '문자' },
                            { key: 'call', label: '통화' },
                            { key: 'recording', label: '녹음' },
                            { key: 'health', label: '헬스' },
                          ] as const
                        ).map((cat) => (
                          <button
                            key={cat.key}
                            className={`toolbar-btn ${
                              mobileSourceFilter === cat.key ? 'primary' : ''
                            }`}
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                            onClick={() => setMobileSourceFilter(cat.key)}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                      {(mobilePersonFilter || mobileSourceFilter !== 'all') && (
                        <button
                          className="toolbar-btn"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => {
                            setMobilePersonFilter('');
                            setMobileSourceFilter('all');
                          }}
                        >
                          ✕ 필터 해제
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 현재 적용된 인물 검색 필터 배지 */}
                  {mobilePersonFilter && (
                    <div
                      style={{
                        padding: '10px 14px',
                        backgroundColor: 'rgba(79, 70, 229, 0.16)',
                        border: '1px solid var(--accent-primary)',
                        borderRadius: '8px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#c7d2fe' }}>
                        📌 &lsquo;{mobilePersonFilter}&rsquo;님과의{' '}
                        {mobileSourceFilter === 'all'
                          ? '모든기록 (카톡·알림·문자·통화·녹음·헬스)'
                          : mobileSourceFilter === 'kakaotalk'
                            ? "'카톡'"
                            : mobileSourceFilter === 'notification'
                              ? "'알림'"
                              : mobileSourceFilter === 'sms'
                                ? "'문자'"
                                : mobileSourceFilter === 'call'
                                  ? "'통화'"
                                  : mobileSourceFilter === 'recording'
                                    ? "'녹음'"
                                    : "'헬스'"}{' '}
                        검색 결과
                      </span>
                      <button
                        className="toolbar-btn"
                        style={{ padding: '2px 8px', fontSize: '11.5px' }}
                        onClick={() => {
                          setMobilePersonFilter('');
                          setMobileSourceFilter('all');
                        }}
                      >
                        전체 보기로 복귀
                      </button>
                    </div>
                  )}

                  {/* 필터링된 휴대폰 데이터 테이블 */}
                  {(() => {
                    const q = mobilePersonFilter.trim().toLowerCase();
                    const filteredMsgs = allLifelogMessages.filter((m) => {
                      if (
                        mobileSourceFilter !== 'all' &&
                        m.source !== mobileSourceFilter
                      ) {
                        return false;
                      }
                      if (!q) return true;
                      return (
                        (m.roomOrSender || '').toLowerCase().includes(q) ||
                        (m.sender || '').toLowerCase().includes(q) ||
                        (m.message || '').toLowerCase().includes(q)
                      );
                    });

                    const sourceLabelMap: Record<string, string> = {
                      kakaotalk: '카톡',
                      notification: '알림',
                      sms: '문자',
                      call: '통화',
                      recording: '녹음',
                      health: '헬스',
                    };

                    return (
                      <div>
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            marginBottom: '8px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          조회된 휴대폰 라이프로그 ({filteredMsgs.length}건 / 전체{' '}
                          {allLifelogMessages.length}건)
                        </div>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th style={{ width: '80px' }}>구분</th>
                              <th style={{ width: '150px' }}>일시</th>
                              <th style={{ width: '180px' }}>대화방 / 상대방</th>
                              <th style={{ width: '130px' }}>발신자 / 상태</th>
                              <th>내용 / 통화 스크립트</th>
                              <th style={{ width: '120px' }}>수집 기기</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredMsgs.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={6}
                                  style={{
                                    textAlign: 'center',
                                    padding: '24px',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  조건에 해당하는 휴대폰 데이터가 없습니다.
                                </td>
                              </tr>
                            ) : (
                              filteredMsgs.slice(0, 500).map((m) => {
                                const personCandidate =
                                  m.source === 'kakaotalk'
                                    ? m.sender &&
                                      m.sender !== '회원님' &&
                                      m.sender !== '나'
                                      ? m.sender
                                      : m.roomOrSender
                                    : (m.roomOrSender || m.sender || '상대방')
                                        .replace(/\s*\([^)]*\)/g, '')
                                        .trim();
                                const srcKey = (
                                  [
                                    'kakaotalk',
                                    'notification',
                                    'sms',
                                    'call',
                                    'recording',
                                    'health',
                                  ].includes(m.source)
                                    ? m.source
                                    : 'notification'
                                ) as LifelogSourceType;

                                const isCallPendingRow =
                                  (m.source === 'call' || m.source === 'recording') &&
                                  (Boolean(
                                    m.attachmentUuid?.startsWith(
                                      'pending_transcript:'
                                    )
                                  ) ||
                                    (m.message || '').includes('토큰 부족') ||
                                    (m.message || '').includes(
                                      '스크립트 미생성'
                                    ) ||
                                    (m.message || '').includes('원본 보관'));

                                return (
                                  <tr
                                    key={m.id}
                                    style={{
                                      cursor: 'pointer',
                                      outline: isCallPendingRow
                                        ? '1.5px solid #ef4444'
                                        : undefined,
                                      backgroundColor: isCallPendingRow
                                        ? 'rgba(239, 68, 68, 0.08)'
                                        : undefined,
                                    }}
                                    onClick={() =>
                                      handleSelectLifelogSidebarItem(m)
                                    }
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setMobileContextMenu({
                                        x: e.clientX,
                                        y: e.clientY,
                                        personName: personCandidate || '상대방',
                                        sourceKey: srcKey,
                                        sourceLabel:
                                          sourceLabelMap[srcKey] || '기록',
                                        messageItem: m,
                                      });
                                    }}
                                    title="좌클릭: 에디터 영역에서 열기 | 우클릭: 이 인물과의 기록 검색 메뉴 열기"
                                  >
                                    <td>
                                      <span className="role-badge projects">
                                        {sourceLabelMap[m.source] || m.source}
                                      </span>
                                    </td>
                                    <td
                                      style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '12px',
                                      }}
                                    >
                                      {m.sentDate} {m.sentTime}
                                    </td>
                                    <td style={{ fontWeight: 700 }}>
                                      {m.source === 'sms'
                                        ? resolveContactName(m.roomOrSender)
                                        : m.roomOrSender}
                                    </td>
                                    <td>{m.sender}</td>
                                    <td style={{ whiteSpace: 'pre-wrap' }}>
                                      {m.message}
                                    </td>
                                    <td
                                      style={{
                                        fontSize: '11.5px',
                                        color: 'var(--text-secondary)',
                                      }}
                                    >
                                      {m.deviceName || m.deviceId || '기본 기기'}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ) : activeTabPath === 'mylore://dashboard/finance' ? (
            /* 대쉬보드 > 금융 대쉬보드 (별도 독립 탭 — F8) */
            <div className="finance-workspace">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '14px',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
                    💳 금융 대쉬보드
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                    카드사용목록 · 통장목록 · 은행 엑셀(.xlsx/.csv) 분석 및 금융 통합 데이터를 관리합니다.
                  </p>
                </div>
              </div>

              {reconcileResultMsg && (
                <div
                  style={{
                    padding: '10px 14px',
                    backgroundColor: 'var(--accent-soft)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: '8px',
                    marginBottom: '14px',
                    color: '#e0e7ff',
                    fontWeight: 600,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ whiteSpace: 'pre-wrap' }}>{reconcileResultMsg}</span>
                  <button
                    className="toolbar-btn"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => setReconcileResultMsg('')}
                  >
                    ✕
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* 상단 서브탭 (카드사용목록 | 통장목록 | 전체) 및 엑셀 업로드/은행 바로가기 */}
                <div
                  style={{
                    padding: '14px 16px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      className={`toolbar-btn ${financeSubTab === 'all' ? 'primary' : ''}`}
                      onClick={() => setFinanceSubTab('all')}
                    >
                      📊 전체 ({allTransactions.length})
                    </button>
                    <button
                      className={`toolbar-btn ${financeSubTab === 'card' ? 'primary' : ''}`}
                      onClick={() => setFinanceSubTab('card')}
                    >
                      💳 카드사용목록
                    </button>
                    <button
                      className={`toolbar-btn ${financeSubTab === 'bank' ? 'primary' : ''}`}
                      onClick={() => setFinanceSubTab('bank')}
                    >
                      🏦 통장목록
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      style={{ display: 'none' }}
                      onChange={handleExcelUpload}
                    />
                    <button
                      className="toolbar-btn primary"
                      onClick={() => excelInputRef.current?.click()}
                    >
                      📊 은행·카드 엑셀(.xlsx/.csv) 분석 및 최신 데이터 추가
                    </button>
                    <button
                      className="toolbar-btn"
                      onClick={() =>
                        openExternalUrlInChrome(
                          'https://obank.kbstar.com/quics?page=C025255'
                        )
                      }
                    >
                      🏦 KB국민 빠른조회
                    </button>
                    <button
                      className="toolbar-btn"
                      onClick={() =>
                        openExternalUrlInChrome(
                          'https://bank.shinhan.com/index.jsp#010101100000'
                        )
                      }
                    >
                      🏦 신한 간편조회
                    </button>
                    <button
                      className="toolbar-btn"
                      onClick={() =>
                        openExternalUrlInChrome(
                          'https://www.shinhancard.com/pconts/html/myPage/useList/MOBFM001/MOBFM001R01.html'
                        )
                      }
                    >
                      💳 신한카드 명세서
                    </button>
                  </div>
                </div>

                {/* 추후 마일스톤 안내 배너 */}
                <div
                  style={{
                    padding: '12px 16px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderLeft: '4px solid var(--accent-primary)',
                    borderRadius: '6px',
                    fontSize: '12.5px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: 'var(--text-primary)' }}>
                    📌 금융 데이터 통합 로드맵 (추후 마일스톤):
                  </strong>{' '}
                  <code>finance/금전관리.xlsx</code>, <code>금전관리2.xlsx</code> 및 하위{' '}
                  <code>backup</code> 폴더의 과거 데이터를 정밀 분석하여 중복 내역을 제거하고 순수{' '}
                  <strong>Raw Data</strong>만 추출·관리하며, 향후 카카오페이·온라인 주문목록 연동 및 전용 대시보드 차트가 이 탭에 순차적으로 업데이트됩니다.
                </div>

                {/* 필터링된 금융 거래내역 테이블 */}
                {(() => {
                  const filteredTx = allTransactions.filter((tx) => {
                    if (financeSubTab === 'all') return true;
                    const inst = (tx.institution || '').toLowerCase();
                    const isCard =
                      inst.includes('카드') ||
                      inst.includes('card') ||
                      inst.includes('페이') ||
                      inst.includes('현대') ||
                      inst.includes('삼성') ||
                      inst.includes('롯데');
                    return financeSubTab === 'card' ? isCard : !isCard;
                  });

                  return (
                    <div>
                      <h3 style={{ marginBottom: '10px', fontSize: '15px' }}>
                        {financeSubTab === 'card'
                          ? `💳 카드사용목록 (${filteredTx.length}건)`
                          : financeSubTab === 'bank'
                            ? `🏦 통장목록 (${filteredTx.length}건)`
                            : `🗄️ 전체 금융 거래내역 (${filteredTx.length}건)`}
                      </h3>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>상태</th>
                            <th>거래일시</th>
                            <th>금융사(카드/은행)</th>
                            <th>가맹점 / 적요</th>
                            <th>금액</th>
                            <th>분류</th>
                            <th>비고</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTx.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                style={{
                                  textAlign: 'center',
                                  padding: '24px',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                표시할 금융 내역이 없습니다. 우측 상단 [은행·카드 엑셀 분석 및 최신 데이터 추가] 버튼으로 엑셀을 불러오세요.
                              </td>
                            </tr>
                          ) : (
                            filteredTx.map((tx) => (
                              <tr key={tx.id}>
                                <td>
                                  <span
                                    className={`verify-badge ${tx.verifyStatus}`}
                                  >
                                    {tx.verifyStatus}
                                  </span>
                                </td>
                                <td style={{ fontFamily: 'var(--font-mono)' }}>
                                  {tx.txDate} {tx.txTime}
                                </td>
                                <td>{tx.institution}</td>
                                <td style={{ fontWeight: 600 }}>{tx.merchant}</td>
                                <td
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontWeight: 700,
                                  }}
                                >
                                  {tx.amount.toLocaleString()}원
                                </td>
                                <td>{tx.category}</td>
                                <td>{tx.memo}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : activeTabPath === 'mylore://dashboard/settings' ? (
            /* 대쉬보드 > 설정 대쉬보드 (Projects/.myLore/setting.json 연동 — 일반 탭으로 동작) */
            <div className="finance-workspace">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>
                    ⚙️ 설정 대쉬보드 (`Projects/.myLore/setting.json`)
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    글꼴(기본/제목/표), 글꼴 크기, 테마·색상, 원본↔뷰어 스크롤 동기화, <kbd>F10</kbd> 상단 메뉴바 기본 상태, <kbd>F11</kbd> 뷰어 토글 동작 및 볼트 베이스 폴더를 관리합니다.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="toolbar-btn"
                    onClick={() =>
                      handleUpdateAppSettings({
                        ...DEFAULT_APP_SETTINGS,
                        settingsFilePath: appSettings.settingsFilePath,
                      })
                    }
                    title="글꼴, 크기, 테마, 색상 및 뷰어 설정을 기본값으로 초기화합니다"
                  >
                    ↺ 전체 설정 기본값 복원
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => showInExplorer(appSettings.settingsFilePath)}
                    title="탐색기에서 Projects/.myLore/setting.json 위치 열기"
                  >
                    📂 setting.json 탐색기 열기
                  </button>
                </div>
              </div>

              {/* 1. 설정 파일 물리 경로 안내 배너 */}
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  marginBottom: '18px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: '12.5px' }}>
                  <span style={{ color: 'var(--text-secondary)', marginRight: '8px' }}>
                    💾 설정 저장 파일:
                  </span>
                  <code style={{ color: 'var(--heading-color)', fontWeight: 700 }}>
                    {appSettings.settingsFilePath}
                  </code>
                </div>
                <span className="help-category-badge">
                  변경 즉시 setting.json & 독립 뷰어 실시간 반영
                </span>
              </div>

              {/* 2. 글꼴(기본/제목/표) 및 글꼴 크기 설정 */}
              <div
                style={{
                  padding: '18px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  marginBottom: '20px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '14px',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                      🔤 글꼴 및 글꼴 크기 설정 (`기본글꼴` / `제목글꼴` / `표글꼴`)
                    </h3>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      프리셋에서 글꼴을 선택하거나 시스템에 설치된 폰트 이름을 직접 입력할 수 있습니다.
                    </p>
                  </div>
                  <button
                    className="toolbar-btn"
                    onClick={() =>
                      handleUpdateAppSettings({
                        baseFontFamily: DEFAULT_APP_SETTINGS.baseFontFamily,
                        headingFontFamily: DEFAULT_APP_SETTINGS.headingFontFamily,
                        tableFontFamily: DEFAULT_APP_SETTINGS.tableFontFamily,
                        baseFontSize: DEFAULT_APP_SETTINGS.baseFontSize,
                        headingScale: DEFAULT_APP_SETTINGS.headingScale,
                        tableFontSize: DEFAULT_APP_SETTINGS.tableFontSize,
                      })
                    }
                  >
                    ↺ 글꼴/크기 초기화
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
                    gap: '14px',
                    marginBottom: '14px',
                  }}
                >
                  {/* 기본 글꼴 & 기본 글꼴 크기 */}
                  <div
                    style={{
                      padding: '14px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '13.5px', color: 'var(--heading-color)' }}>
                        📝 기본 글꼴 (`baseFontFamily`)
                      </strong>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                        본문 및 에디터
                      </span>
                    </div>
                    <select
                      className="task-status-select"
                      style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px' }}
                      value={
                        FONT_FAMILY_PRESETS.some(
                          (p) => p.value === appSettings.baseFontFamily
                        )
                          ? appSettings.baseFontFamily
                          : '__custom__'
                      }
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          handleUpdateAppSettings({
                            baseFontFamily: e.target.value,
                          });
                        }
                      }}
                    >
                      {FONT_FAMILY_PRESETS.map((preset) => (
                        <option key={preset.label} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                      <option value="__custom__">직접 입력 (사용자 정의 폰트)</option>
                    </select>
                    <input
                      className="input-field"
                      style={{ fontSize: '12px' }}
                      value={appSettings.baseFontFamily}
                      onChange={(e) =>
                        handleUpdateAppSettings({ baseFontFamily: e.target.value })
                      }
                      placeholder="예: 'Malgun Gothic', sans-serif"
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        기본 글꼴 크기: <strong>{appSettings.baseFontSize}px</strong>
                      </span>
                      <input
                        type="range"
                        min={11}
                        max={24}
                        step={1}
                        value={appSettings.baseFontSize}
                        onChange={(e) =>
                          handleUpdateAppSettings({
                            baseFontSize: Number(e.target.value),
                          })
                        }
                        style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
                      />
                    </div>
                  </div>

                  {/* 제목 글꼴 & 제목 크기 배율 */}
                  <div
                    style={{
                      padding: '14px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '13.5px', color: 'var(--heading-color)' }}>
                        🏷️ 제목 글꼴 (`headingFontFamily`)
                      </strong>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                        H1 ~ H6 헤딩
                      </span>
                    </div>
                    <select
                      className="task-status-select"
                      style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px' }}
                      value={
                        FONT_FAMILY_PRESETS.some(
                          (p) => p.value === appSettings.headingFontFamily
                        )
                          ? appSettings.headingFontFamily
                          : '__custom__'
                      }
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          handleUpdateAppSettings({
                            headingFontFamily: e.target.value,
                          });
                        }
                      }}
                    >
                      {FONT_FAMILY_PRESETS.map((preset) => (
                        <option key={preset.label} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                      <option value="__custom__">직접 입력 (사용자 정의 폰트)</option>
                    </select>
                    <input
                      className="input-field"
                      style={{ fontSize: '12px' }}
                      value={appSettings.headingFontFamily}
                      onChange={(e) =>
                        handleUpdateAppSettings({
                          headingFontFamily: e.target.value,
                        })
                      }
                      placeholder="예: 'NanumSquare Neo', sans-serif"
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        제목 크기 배율: <strong>{Number(appSettings.headingScale).toFixed(2)}x</strong>
                      </span>
                      <input
                        type="range"
                        min={0.8}
                        max={1.5}
                        step={0.05}
                        value={appSettings.headingScale}
                        onChange={(e) =>
                          handleUpdateAppSettings({
                            headingScale: Number(e.target.value),
                          })
                        }
                        style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
                      />
                    </div>
                  </div>

                  {/* 표 글꼴 & 표 글꼴 크기 */}
                  <div
                    style={{
                      padding: '14px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '13.5px', color: 'var(--heading-color)' }}>
                        📊 표 글꼴 (`tableFontFamily`)
                      </strong>
                      <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                        마크다운 표 & 데이터 표
                      </span>
                    </div>
                    <select
                      className="task-status-select"
                      style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px' }}
                      value={
                        FONT_FAMILY_PRESETS.some(
                          (p) => p.value === appSettings.tableFontFamily
                        )
                          ? appSettings.tableFontFamily
                          : '__custom__'
                      }
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          handleUpdateAppSettings({
                            tableFontFamily: e.target.value,
                          });
                        }
                      }}
                    >
                      {FONT_FAMILY_PRESETS.map((preset) => (
                        <option key={preset.label} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                      <option value="__custom__">직접 입력 (사용자 정의 폰트)</option>
                    </select>
                    <input
                      className="input-field"
                      style={{ fontSize: '12px' }}
                      value={appSettings.tableFontFamily}
                      onChange={(e) =>
                        handleUpdateAppSettings({ tableFontFamily: e.target.value })
                      }
                      placeholder="예: 'D2Coding', monospace"
                    />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        표 글꼴 크기: <strong>{appSettings.tableFontSize}px</strong>
                      </span>
                      <input
                        type="range"
                        min={10}
                        max={20}
                        step={1}
                        value={appSettings.tableFontSize}
                        onChange={(e) =>
                          handleUpdateAppSettings({
                            tableFontSize: Number(e.target.value),
                          })
                        }
                        style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
                      />
                    </div>
                  </div>
                </div>

                {/* 실시간 타이포그래피 & 표 미리보기 박스 */}
                <div
                  className="rendered-md"
                  style={{
                    padding: '14px 18px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    👁️ 실시간 글꼴·색상 미리보기
                  </div>
                  <h2 style={{ marginTop: 0 }}>제목 글꼴 미리보기 (H2 헤딩 샘플)</h2>
                  <p>
                    기본 글꼴 미리보기입니다. 가나다라마바사 ABCDEFG 0123456789 — 본문 텍스트와 에디터에 적용됩니다.
                  </p>
                  <div className="md-table-container" style={{ marginBottom: 0 }}>
                    <table className="md-table">
                      <thead>
                        <tr>
                          <th>구분</th>
                          <th>적용 대상</th>
                          <th>현재 크기</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>기본 글꼴</td>
                          <td>본문 단락, 목록, 에디터</td>
                          <td>{appSettings.baseFontSize}px</td>
                        </tr>
                        <tr>
                          <td>표 글꼴</td>
                          <td>마크다운 표, 대쉬보드 테이블</td>
                          <td>{appSettings.tableFontSize}px</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* 3. 테마 프리셋 및 각종 세부 색상 설정 */}
              <div
                style={{
                  padding: '18px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  marginBottom: '20px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                      🎨 테마 프리셋 및 각종 세부 색상 설정 (`themePreset` & Color Picker)
                    </h3>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      테마 프리셋을 선택하거나 배경색, 글자색, 제목색, 강조색, 표 헤더색을 개별 컬러 피커로 자유롭게 커스터마이징하세요.
                    </p>
                  </div>
                  <button
                    className="toolbar-btn"
                    onClick={() => handleApplyThemePreset('dark_indigo')}
                  >
                    ↺ 기본 다크 인디고 테마로 복원
                  </button>
                </div>

                {/* 테마 프리셋 5종 카드 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
                    gap: '10px',
                    marginBottom: '16px',
                  }}
                >
                  {(
                    Object.entries(THEME_PRESETS) as Array<
                      [
                        Exclude<ThemePresetId, 'custom'>,
                        (typeof THEME_PRESETS)['dark_indigo']
                      ]
                    >
                  ).map(([presetId, preset]) => {
                    const isSelected = appSettings.themePreset === presetId;
                    return (
                      <div
                        key={presetId}
                        onClick={() => handleApplyThemePreset(presetId)}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          border: isSelected
                            ? '2px solid var(--accent-primary)'
                            : '1px solid var(--border-color)',
                          backgroundColor: preset.bgPrimary,
                          color: preset.textPrimary,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '6px',
                          }}
                        >
                          <strong
                            style={{
                              fontSize: '13px',
                              color: preset.headingColor,
                            }}
                          >
                            {preset.name}
                          </strong>
                          {isSelected && (
                            <span
                              style={{
                                fontSize: '10.5px',
                                padding: '1px 6px',
                                borderRadius: '999px',
                                backgroundColor: preset.accentPrimary,
                                color: '#fff',
                                fontWeight: 700,
                              }}
                            >
                              적용됨
                            </span>
                          )}
                        </div>
                        <p
                          style={{
                            fontSize: '11.5px',
                            color: preset.textSecondary,
                            marginBottom: '8px',
                          }}
                        >
                          {preset.desc}
                        </p>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          {[
                            preset.bgPrimary,
                            preset.bgSecondary,
                            preset.accentPrimary,
                            preset.headingColor,
                            preset.tableHeaderBg,
                          ].map((c, idx) => (
                            <span
                              key={idx}
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '4px',
                                backgroundColor: c,
                                border: '1px solid rgba(148,163,184,0.35)',
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 9종 세부 색상 컬러 피커 그리드 */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {(
                    [
                      { key: 'bgPrimary', label: '기본 배경색 (에디터/뷰어)' },
                      { key: 'bgSecondary', label: '보조 배경색 (패널/사이드바)' },
                      { key: 'textPrimary', label: '기본 본문 글자색' },
                      { key: 'textSecondary', label: '보조 설명 글자색' },
                      { key: 'headingColor', label: '제목(H1~H4) 글자색' },
                      { key: 'accentPrimary', label: '강조/포인트 색상' },
                      { key: 'tableHeaderBg', label: '표 헤더 배경색' },
                      { key: 'tableHeaderColor', label: '표 헤더 글자색' },
                      { key: 'borderColor', label: '구분선/테두리 색상' },
                    ] as Array<{ key: keyof MyLoreAppSettings; label: string }>
                  ).map((item) => {
                    const colorVal = String(appSettings[item.key] || '#000000');
                    return (
                      <div
                        key={item.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          padding: '9px 12px',
                          backgroundColor: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '8px',
                        }}
                      >
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>
                          {item.label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="color"
                            value={
                              /^#[0-9a-fA-F]{6}$/.test(colorVal)
                                ? colorVal
                                : '#6366f1'
                            }
                            onChange={(e) =>
                              handleUpdateAppSettings({
                                themePreset: 'custom',
                                [item.key]: e.target.value,
                              })
                            }
                            style={{
                              width: '28px',
                              height: '26px',
                              border: 'none',
                              padding: 0,
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          />
                          <input
                            className="input-field"
                            style={{
                              width: '82px',
                              padding: '4px 6px',
                              fontSize: '11.5px',
                              fontFamily: 'var(--font-mono)',
                            }}
                            value={colorVal}
                            onChange={(e) =>
                              handleUpdateAppSettings({
                                themePreset: 'custom',
                                [item.key]: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 4. 원본 ↔ 뷰어 스크롤 동기화 & F11 뷰어 토글 동작 설정 */}
              <div
                style={{
                  padding: '18px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  marginBottom: '20px',
                }}
              >
                {/* 통화 녹음 자동 스크립트 추출 설정 섹션 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: '16px',
                    marginBottom: '16px',
                    borderBottom: '1px solid var(--border-color)',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                      🎙️ 통화 녹음 자동 스크립트 추출 (`autoCallTranscription`)
                    </h3>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      <strong>가장 최근 통화음성부터</strong> 토큰이 허락하는 대로 요약 및 화자 분리 스크립트를 자동으로 추출합니다. (토큰 부족 시 마지막 실패시각을 기억하고 5시간 대기 후 자동 재시도)
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className={`toolbar-btn ${
                        (appSettings.autoCallTranscription ?? true) ? 'primary' : ''
                      }`}
                      onClick={async () => {
                        const stat = await setAutoCallTranscription(true);
                        setGeminiStatus(stat);
                        handleUpdateAppSettings({ autoCallTranscription: true });
                      }}
                    >
                      ✓ 자동 스크립트 추출: Yes (기본)
                    </button>
                    <button
                      className={`toolbar-btn ${
                        !(appSettings.autoCallTranscription ?? true) ? 'primary' : ''
                      }`}
                      onClick={async () => {
                        const stat = await setAutoCallTranscription(false);
                        setGeminiStatus(stat);
                        handleUpdateAppSettings({ autoCallTranscription: false });
                      }}
                    >
                      자동 스크립트 추출: No
                    </button>
                  </div>
                </div>

                {/* 스크롤 동기화 섹션 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingBottom: '16px',
                    marginBottom: '16px',
                    borderBottom: '1px solid var(--border-color)',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                      🔗 원본 에디터 ↔ 뷰어 스크롤 자동 동기화 (`scrollSyncEnabled`)
                    </h3>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      원본 마크다운 에디터의 스크롤이 내려가면 현재 편집 중인 소스 줄(`data-source-line`) 위치를 추적하여{' '}
                      <strong>병렬 뷰어</strong> 및 <strong>전용 독립 뷰어 창</strong>의 스크롤이 해당 블록 위치로 함께 내려갑니다.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className={`toolbar-btn ${
                        appSettings.scrollSyncEnabled ? 'primary' : ''
                      }`}
                      onClick={() =>
                        handleUpdateAppSettings({ scrollSyncEnabled: true })
                      }
                    >
                      ✓ 스크롤 동기화 켜기 (ON)
                    </button>
                    <button
                      className={`toolbar-btn ${
                        !appSettings.scrollSyncEnabled ? 'primary' : ''
                      }`}
                      onClick={() =>
                        handleUpdateAppSettings({ scrollSyncEnabled: false })
                      }
                    >
                      스크롤 동기화 끄기 (OFF)
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                      🪟 <kbd>F11</kbd> 뷰어 토글 기본 옵션 (`f11ViewerMode`)
                    </h3>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      문서 열람 중 <kbd>F11</kbd> 키를 눌렀을 때 전용 독립 뷰어 창을 켜고 끌지, 메인 창 내 병렬 뷰어를 켜고 끌지 선택합니다.
                    </p>
                  </div>
                  <button
                    className="toolbar-btn primary"
                    onClick={handleToggleF11Viewer}
                    title="현재 선택된 F11 동작을 즉시 테스트합니다"
                  >
                    ⚡ 지금 F11 토글 실행해보기
                  </button>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {/* 카드 1: 전용 독립 뷰어 */}
                  <div
                    onClick={() =>
                      handleUpdateAppSettings({ f11ViewerMode: 'detached' })
                    }
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border:
                        appSettings.f11ViewerMode === 'detached'
                          ? '2px solid var(--accent-primary)'
                          : '1px solid var(--border-color)',
                      backgroundColor:
                        appSettings.f11ViewerMode === 'detached'
                          ? 'var(--accent-soft)'
                          : 'var(--bg-primary)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px',
                      }}
                    >
                      <strong style={{ fontSize: '14.5px', color: 'var(--heading-color)' }}>
                        🪟 전용 독립 뷰어 (`detached`)
                      </strong>
                      {appSettings.f11ViewerMode === 'detached' && (
                        <span className="role-badge projects">✓ 현재 선택됨</span>
                      )}
                    </div>
                    <p
                      style={{
                        fontSize: '12.5px',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                      }}
                    >
                      <kbd>F11</kbd> 입력 시 <strong>별도의 전용 독립 뷰어 창</strong>을 켜고 끕니다.
                      독립 뷰어가 켜지면 메인 창은 에디터 전용 모드로 동작하며 실시간으로 본문과 스크롤이 동기화됩니다.
                    </p>
                  </div>

                  {/* 카드 2: 병렬 뷰어 */}
                  <div
                    onClick={() =>
                      handleUpdateAppSettings({ f11ViewerMode: 'split' })
                    }
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border:
                        appSettings.f11ViewerMode === 'split'
                          ? '2px solid var(--accent-primary)'
                          : '1px solid var(--border-color)',
                      backgroundColor:
                        appSettings.f11ViewerMode === 'split'
                          ? 'var(--accent-soft)'
                          : 'var(--bg-primary)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px',
                      }}
                    >
                      <strong style={{ fontSize: '14.5px', color: 'var(--heading-color)' }}>
                        📐 병렬 뷰어 (`split`)
                      </strong>
                      {appSettings.f11ViewerMode === 'split' && (
                        <span className="role-badge projects">✓ 현재 선택됨</span>
                      )}
                    </div>
                    <p
                      style={{
                        fontSize: '12.5px',
                        color: 'var(--text-secondary)',
                        lineHeight: 1.5,
                      }}
                    >
                      <kbd>F11</kbd> 입력 시 메인 창 안에서{' '}
                      <strong>에디터 전용 모드 ↔ 좌우 병렬(분할) 뷰어 모드</strong>를 즉시 켜고 끕니다.
                    </p>
                  </div>
                </div>
              </div>

              {/* 5. 에디터 기본 화면, F10 상단 메뉴바 기본 상태 및 자동 저장 설정 */}
              <div
                style={{
                  padding: '18px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  marginBottom: '20px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: '16px',
                }}
              >
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>
                    💾 자동 저장 (`autoSaveEnabled`)
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    본문/YAML 편집 후 1.2초 뒤 자동으로 디스크에 저장합니다.
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className={`toolbar-btn ${
                        appSettings.autoSaveEnabled ? 'primary' : ''
                      }`}
                      onClick={() =>
                        handleUpdateAppSettings({ autoSaveEnabled: true })
                      }
                    >
                      ✓ 자동 저장 켜기 (ON)
                    </button>
                    <button
                      className={`toolbar-btn ${
                        !appSettings.autoSaveEnabled ? 'primary' : ''
                      }`}
                      onClick={() =>
                        handleUpdateAppSettings({ autoSaveEnabled: false })
                      }
                    >
                      자동 저장 끄기 (OFF)
                    </button>
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>
                    ☰ <kbd>F10</kbd> 상단 메뉴바 시작 시 기본 상태 (`defaultMenuBarExpanded`)
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    프로그램 시작 시 상단 텍스트 메뉴바(`파일/편집/...`)의 기본 열림/닫힘 상태를 설정합니다. (<kbd>F10</kbd>으로 언제든 토글)
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className={`toolbar-btn ${
                        !appSettings.defaultMenuBarExpanded ? 'primary' : ''
                      }`}
                      onClick={() => {
                        setMenuBarExpanded(false);
                        handleUpdateAppSettings({
                          defaultMenuBarExpanded: false,
                        });
                      }}
                    >
                      ✓ 기본 닫힘 (OFF)
                    </button>
                    <button
                      className={`toolbar-btn ${
                        appSettings.defaultMenuBarExpanded ? 'primary' : ''
                      }`}
                      onClick={() => {
                        setMenuBarExpanded(true);
                        handleUpdateAppSettings({
                          defaultMenuBarExpanded: true,
                        });
                      }}
                    >
                      기본 열림 (ON)
                    </button>
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>
                    🖥️ 프로그램 시작 시 기본 편집 화면 (`defaultEditorViewMode`)
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    myLore 실행 시 기본으로 열릴 메인 창 모드를 지정합니다.
                  </p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className={`toolbar-btn ${
                        appSettings.defaultEditorViewMode === 'editor'
                          ? 'primary'
                          : ''
                      }`}
                      onClick={() =>
                        handleUpdateAppSettings({
                          defaultEditorViewMode: 'editor',
                        })
                      }
                    >
                      에디터 전용 (`editor`)
                    </button>
                    <button
                      className={`toolbar-btn ${
                        appSettings.defaultEditorViewMode === 'split'
                          ? 'primary'
                          : ''
                      }`}
                      onClick={() =>
                        handleUpdateAppSettings({
                          defaultEditorViewMode: 'split',
                        })
                      }
                    >
                      병렬 뷰어 (`split`)
                    </button>
                    <button
                      className={`toolbar-btn ${
                        appSettings.defaultEditorViewMode === 'preview'
                          ? 'primary'
                          : ''
                      }`}
                      onClick={() =>
                        handleUpdateAppSettings({
                          defaultEditorViewMode: 'preview',
                        })
                      }
                    >
                      뷰어 전용 (`preview`)
                    </button>
                  </div>
                </div>
              </div>

              {/* 6. 베이스 폴더 설정 */}
              <div
                style={{
                  padding: '18px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                      📁 베이스 폴더 목록 및 폴더 목적 설정
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      <code>Git (git)</code> 타입으로 지정된 베이스 폴더는 일괄 스캔에서 제외되며 YAML <code>uuid</code>를 주입하지 않고 열람·편집만 처리합니다.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="toolbar-btn"
                      onClick={() =>
                        setBaseFolders([
                          ...baseFolders,
                          {
                            id: `base-${Date.now()}`,
                            role: 'git',
                            path: 'C:\\git',
                            label: 'Git 폴더',
                            purpose: 'Git 코드/마크다운 저장소 (UUID 미주입, 스캔 제외)',
                            enabled: true,
                          },
                        ])
                      }
                    >
                      + 베이스 폴더 추가
                    </button>
                    <button
                      className="toolbar-btn primary"
                      onClick={async () => {
                        await saveBaseFolders(baseFolders);
                        await refreshTree();
                        setStatusMessage('✅ 베이스 폴더 설정이 저장되고 트리가 갱신되었습니다.');
                      }}
                    >
                      베이스 폴더 저장 및 트리 갱신
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {baseFolders.map((bf, idx) => (
                    <div
                      key={bf.id}
                      style={{
                        padding: '12px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <select
                          className="task-status-select"
                          value={bf.role}
                          onChange={(e) => {
                            const next = [...baseFolders];
                            next[idx].role = e.target.value as BaseFolderRole;
                            setBaseFolders(next);
                          }}
                        >
                          <option value="data">데이터 (Archive)</option>
                          <option value="diary">일기 (Diary)</option>
                          <option value="projects">프로젝트 (Projects)</option>
                          <option value="git">Git (스캔·UUID 제외)</option>
                        </select>
                        <input
                          className="input-field"
                          style={{ flex: 1 }}
                          value={bf.path}
                          onChange={(e) => {
                            const next = [...baseFolders];
                            next[idx].path = e.target.value;
                            setBaseFolders(next);
                          }}
                        />
                        <button
                          className="toolbar-btn"
                          onClick={async () => {
                            const picked = await openNativeFolderDialog();
                            if (picked) {
                              const next = [...baseFolders];
                              next[idx].path = picked;
                              setBaseFolders(next);
                            }
                          }}
                          title="폴더 찾아보기"
                        >
                          📂 폴더 선택
                        </button>
                        <button
                          className="toolbar-btn"
                          style={{
                            color: '#f87171',
                            borderColor: 'rgba(248, 113, 113, 0.45)',
                            flexShrink: 0,
                          }}
                          onClick={async () => {
                            const next = baseFolders.filter((_, i) => i !== idx);
                            setBaseFolders(next);
                            await saveBaseFolders(next);
                            await refreshTree();
                            setStatusMessage(
                              `🗑️ 베이스 폴더 '${bf.path}'가 삭제되고 트리가 갱신되었습니다.`
                            );
                          }}
                          title="이 베이스 폴더를 목록에서 삭제하고 즉시 반영합니다"
                        >
                          🗑️ 삭제
                        </button>
                      </div>
                      <input
                        className="input-field"
                        value={bf.purpose}
                        onChange={(e) => {
                          const next = [...baseFolders];
                          next[idx].purpose = e.target.value;
                          setBaseFolders(next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : currentDoc ? (
            <>
              {/* 캡처된 문서 상단 액션 바(.doc-header-bar)는 모두 제거되었으며 메뉴/탭바로 통합됨 */}

              {/* 문서 내 인라인 찾기/바꾸기 바 (편집 > 찾기 / 바꾸기) */}
              {findBarMode !== 'closed' && (
                <div className="find-replace-bar">
                  <input
                    autoFocus
                    className="input-field"
                    style={{ width: '200px' }}
                    placeholder="문서 내 찾기..."
                    value={docFindQuery}
                    onChange={(e) => setDocFindQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleJumpSearchMatch(1);
                    }}
                  />
                  <button
                    className="toolbar-btn"
                    onClick={() => handleJumpSearchMatch(-1)}
                  >
                    ↑ 이전
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => handleJumpSearchMatch(1)}
                  >
                    ↓ 다음
                  </button>
                  {findBarMode === 'replace' && (
                    <>
                      <input
                        className="input-field"
                        style={{ width: '180px' }}
                        placeholder="바꿀 내용..."
                        value={docReplaceText}
                        onChange={(e) => setDocReplaceText(e.target.value)}
                      />
                      <button
                        className="toolbar-btn primary"
                        onClick={() => {
                          if (!docFindQuery) return;
                          setBodyText((prev) =>
                            prev.replace(docFindQuery, docReplaceText)
                          );
                        }}
                      >
                        바꾸기
                      </button>
                      <button
                        className="toolbar-btn"
                        onClick={() => {
                          if (!docFindQuery) return;
                          setBodyText((prev) =>
                            prev.split(docFindQuery).join(docReplaceText)
                          );
                        }}
                      >
                        모두 바꾸기
                      </button>
                    </>
                  )}
                  <button
                    className="toolbar-btn"
                    onClick={() => setFindBarMode('closed')}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* YAML 메타데이터 편집 드로어 (기본 숨김, 보기 > YAML 토글 또는 Ctrl+;) */}
              {isYamlVisible && (
                <div className="yaml-drawer">
                  <div className="yaml-drawer-header">
                    <span>⚙️ YAML Frontmatter ({getShortcutLabel('toggle_yaml')})</span>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
                      UUID: {currentDoc.uuid}
                    </span>
                  </div>
                  <textarea
                    className="yaml-editor-textarea"
                    value={yamlText}
                    onChange={(e) => setYamlText(e.target.value)}
                  />
                </div>
              )}

              {/* 통화 녹음 스크립트 미생성(토큰 부족) 시 상단 5시간 후 재시도 안내 및 즉시 재시도 배너 */}
              {isCurrentDocCall &&
                (currentDoc.frontmatter['transcript_status'] ===
                  'pending_quota' ||
                  bodyText.includes('토큰 부족') ||
                  bodyText.includes('생성 대기 중')) && (
                  <div
                    style={{
                      margin: '8px 14px 0 14px',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      border: '1.5px solid #ef4444',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        fontSize: '12.5px',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: '#fca5a5' }}>
                        ⚠️ LLM 토큰 부족/대기로 인해 아직 통화 요약 및 스크립트가 생성되지 않았습니다.
                      </span>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>
                        {geminiStatus?.retryAfterAt
                          ? `고갈 감지 시점(${geminiStatus.quotaExhaustedAt || '방금'})으로부터 5시간 후인 ${geminiStatus.retryAfterAt} 에 자동으로 스크립트 변환을 재시도합니다.`
                          : '백그라운드 스케줄러가 토큰 고갈 시점으로부터 5시간 후 자동으로 재시도합니다.'}
                      </span>
                    </div>
                    <button
                      className="toolbar-btn primary"
                      disabled={isRetryingCalls}
                      style={{
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.25)',
                      }}
                      onClick={async () => {
                        try {
                          setIsRetryingCalls(true);
                          setStatusMessage(
                            '🔄 미생성 통화 녹음의 LLM 요약+스크립트 변환을 즉시 재시도합니다...'
                          );
                          const stat = await retryPendingCallTranscriptions();
                          setGeminiStatus(stat);
                          await refreshAllLifelogMessages();
                          const reloaded = await readDocument(
                            currentDoc.fullPath
                          );
                          applyLoadedDocument(reloaded);
                          setStatusMessage(
                            stat.pendingCallCount === 0
                              ? '✅ 통화 녹음 요약 및 스크립트 생성 완료!'
                              : `⚠️ 재시도 결과: 미완료 ${stat.pendingCallCount}건 (다음 자동 재시도: ${stat.retryAfterAt || '5시간 후'})`
                          );
                        } catch (err) {
                          setStatusMessage(`재시도 오류: ${String(err)}`);
                        } finally {
                          setIsRetryingCalls(false);
                        }
                      }}
                    >
                      {isRetryingCalls
                        ? '⏳ LLM 변환 재시도 중...'
                        : '🔄 지금 즉시 스크립트 생성 재시도'}
                    </button>
                  </div>
                )}

              {/* 문자(SMS) 문서 상단 보기 모드 전환 바 (기본: 말풍선 대화 뷰 | 마크다운 원문 편집) */}
              {isCurrentDocSms && (
                <div
                  style={{
                    padding: '8px 16px',
                    borderBottom: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-secondary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700 }}>
                      ✉️{' '}
                      {resolveContactName(
                        currentDoc.frontmatter['contact_name'] ||
                          currentDoc.frontmatter['phone_number'] ||
                          currentDoc.relativePath
                            .replace(/^.*[\\/]/, '')
                            .replace(/\.md$/i, '')
                      )}
                    </span>
                    {currentDoc.frontmatter['phone_number'] &&
                      resolveContactName(
                        currentDoc.frontmatter['phone_number']
                      ) !== currentDoc.frontmatter['phone_number'] && (
                        <span
                          style={{
                            fontSize: '12px',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-secondary)',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: 'rgba(255,255,255,0.06)',
                          }}
                        >
                          {currentDoc.frontmatter['phone_number']}
                        </span>
                      )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className={`toolbar-btn ${!smsRawEditMode ? 'primary' : ''}`}
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={() => setSmsRawEditMode(false)}
                    >
                      💬 말풍선 보기 (기본)
                    </button>
                    <button
                      className={`toolbar-btn ${smsRawEditMode ? 'primary' : ''}`}
                      style={{ padding: '4px 10px', fontSize: '12px' }}
                      onClick={() => setSmsRawEditMode(true)}
                    >
                      📝 마크다운 원문 편집
                    </button>
                  </div>
                </div>
              )}

              {/* 마크다운 에디터 & 라이브 뷰어 (문자 문서는 기본적으로 말풍선 뷰 출력) */}
              {isCurrentDocSms && !smsRawEditMode ? (
                <div
                  ref={smsBubbleScrollRef}
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '20px 28px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    backgroundColor: 'var(--bg-primary)',
                  }}
                >
                  {(() => {
                    interface ParsedSmsItem {
                      dateStr: string;
                      timeHms: string;
                      isSentByMe: boolean;
                      text: string;
                    }
                    const parsedItems: ParsedSmsItem[] = [];
                    let curDate = '';
                    const dateHeaderRe = /^##\s*📅\s*(\d{4}-\d{2}-\d{2})/;
                    const smsLineRe =
                      /^-\s*\*\*\[([^\]]+)\]\s*(?:\[([^\]]+)\]\s*)?([^*]+)\*\*:\s*(.*)$/;

                    for (const rawLine of bodyText.split('\n')) {
                      const trimmed = rawLine.trim();
                      const dm = trimmed.match(dateHeaderRe);
                      if (dm) {
                        curDate = dm[1];
                        continue;
                      }
                      const lm = trimmed.match(smsLineRe);
                      if (lm) {
                        const rawTime = lm[1].trim();
                        const dirTag = (lm[2] || '').trim();
                        const senderStr = (lm[3] || '').trim();
                        const rawMsgBody = (lm[4] || '').trim();
                        const msgBody = rawMsgBody
                          .replace(/^\[ì\s*œëª©ì—†ì\s*Œ\]\s*/g, '')
                          .replace(/^\[제목없음\]\s*/g, '')
                          .replace(/<br\s*\/?>/gi, '\n')
                          .trim();
                        const timeHms =
                          /^\d{2}:\d{2}$/.test(rawTime)
                            ? `${rawTime}:00`
                            : rawTime;
                        const isSentByMe =
                          dirTag.includes('발신') ||
                          senderStr.includes('나 (문자발신)') ||
                          senderStr === '나';
                        parsedItems.push({
                          dateStr: curDate || '날짜 미상',
                          timeHms,
                          isSentByMe,
                          text: msgBody,
                        });
                      }
                    }

                    if (parsedItems.length === 0) {
                      return (
                        <div
                          style={{
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            padding: '40px 0',
                          }}
                        >
                          표시할 문자 대화 내역이 없습니다.
                        </div>
                      );
                    }

                    let lastRenderedDate = '';
                    return parsedItems.map((item, idx) => {
                      const showDateRow = item.dateStr !== lastRenderedDate;
                      if (showDateRow) {
                        lastRenderedDate = item.dateStr;
                      }
                      return (
                        <React.Fragment key={`sms-b-${idx}`}>
                          {showDateRow && (
                            <div
                              style={{
                                width: '100%',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                margin: '14px 0 8px 0',
                              }}
                            >
                              <span
                                style={{
                                  padding: '4px 14px',
                                  borderRadius: '999px',
                                  backgroundColor: 'rgba(148, 163, 184, 0.14)',
                                  border: '1px solid rgba(148, 163, 184, 0.25)',
                                  color: 'var(--text-secondary)',
                                  fontSize: '11.5px',
                                  fontWeight: 700,
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                📅 {item.dateStr}
                              </span>
                            </div>
                          )}
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: item.isSentByMe
                                ? 'flex-end'
                                : 'flex-start',
                              width: '100%',
                            }}
                          >
                            <div
                              style={{
                                maxWidth: '72%',
                                padding: '10px 14px',
                                borderRadius: item.isSentByMe
                                  ? '16px 16px 4px 16px'
                                  : '16px 16px 16px 4px',
                                background: item.isSentByMe
                                  ? 'linear-gradient(135deg, #2563eb, #3b82f6)'
                                  : 'var(--bg-secondary)',
                                color: item.isSentByMe
                                  ? '#ffffff'
                                  : 'var(--text-primary)',
                                border: item.isSentByMe
                                  ? '1px solid rgba(59, 130, 246, 0.5)'
                                  : '1px solid var(--border-color)',
                                fontSize: '13.5px',
                                lineHeight: 1.5,
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-wrap',
                                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.16)',
                              }}
                            >
                              {item.text}
                            </div>
                            <span
                              style={{
                                marginTop: '3px',
                                padding: '0 4px',
                                fontSize: '10.5px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {item.timeHms}
                            </span>
                          </div>
                        </React.Fragment>
                      );
                    });
                  })()}
                </div>
              ) : (
              <div className="editor-split-container">
                {(viewMode === 'split' || viewMode === 'editor') && (
                  <div className="markdown-editor-pane">
                    <textarea
                      ref={editorRef}
                      className="markdown-textarea"
                      value={bodyText}
                      onScroll={handleEditorScroll}
                      onKeyDown={() => {
                        lastEditorKeyPressMsRef.current = Date.now();
                      }}
                      onChange={(e) => {
                        lastEditorKeyPressMsRef.current = Date.now();
                        const offset = e.target.selectionStart;
                        setBodyText(e.target.value);
                        if (currentDoc) {
                          recordEditPosition(currentDoc.fullPath, offset, false);
                        }
                      }}
                      onMouseUp={(e) => {
                        const selStart = e.currentTarget.selectionStart;
                        const selEnd = e.currentTarget.selectionEnd;
                        if (currentDoc) {
                          recordEditPosition(
                            currentDoc.fullPath,
                            selStart,
                            false
                          );
                        }
                        if (
                          isCurrentDocCall &&
                          audioScriptCues.length > 0 &&
                          selStart === selEnd
                        ) {
                          const clickedCue = audioScriptCues.find(
                            (c) => selStart >= c.charStart && selStart <= c.charEnd
                          );
                          if (clickedCue) {
                            handleSeekAudioTime(
                              clickedCue.startSec,
                              clickedCue.lineIndex
                            );
                          }
                        }
                      }}
                      placeholder="여기에 마크다운 본문을 작성하세요..."
                    />
                  </div>
                )}

                {(viewMode === 'split' || viewMode === 'preview') && (
                  <div
                    ref={previewPaneRef}
                    className="markdown-preview-pane rendered-md"
                  >
                    <MarkdownPreviewRenderer
                      bodyText={bodyText}
                      onUpdateTaskStatus={(lineIdx, nextCode) => {
                        const next = updateTaskStatusInBody(
                          bodyText,
                          lineIdx,
                          nextCode
                        );
                        setBodyText(next);
                      }}
                      onNavigateUuid={async (targetUuid) => {
                        try {
                          const targetDoc =
                            await readDocumentByUuid(targetUuid);
                          applyLoadedDocument(targetDoc);
                        } catch (e) {
                          setStatusMessage(`UUID 링크 이동 실패: ${String(e)}`);
                        }
                      }}
                      onOpenExternalUrl={(url) => {
                        openExternalUrlInChrome(url);
                      }}
                      activeAudioLineIndex={activeAudioLineIndex}
                      onSeekAudioTime={handleSeekAudioTime}
                      enableAudioTimestampSync={isCurrentDocCall}
                    />

                    {currentProjectSubDocs.length > 0 &&
                      (() => {
                        const filterQ = subDocFilter.trim().toLowerCase();
                        const filteredSubDocs = currentProjectSubDocs.filter(
                          (doc) =>
                            filterQ === '' ||
                            doc.name.toLowerCase().includes(filterQ) ||
                            doc.relativePath.toLowerCase().includes(filterQ) ||
                            (doc.title || '').toLowerCase().includes(filterQ)
                        );
                        const isRootProjectsMain =
                          currentDoc.relativePath
                            .replace(/\\/g, '/')
                            .toLowerCase() === 'main.md';

                        return (
                          <div className="subdocs-hub-section">
                            <div className="subdocs-hub-header">
                              <div className="subdocs-hub-title">
                                <span>📂</span>
                                <span>
                                  {isRootProjectsMain
                                    ? `하위 프로젝트 허브 (${filteredSubDocs.length}/${currentProjectSubDocs.length})`
                                    : `이 프로젝트의 하위 문서 (${filteredSubDocs.length}/${currentProjectSubDocs.length})`}
                                </span>
                              </div>
                              <div className="subdocs-hub-controls">
                                <input
                                  className="input-field"
                                  style={{
                                    width: '180px',
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                  }}
                                  placeholder="하위 문서 빠른 필터..."
                                  value={subDocFilter}
                                  onChange={(e) =>
                                    setSubDocFilter(e.target.value)
                                  }
                                />
                                <button
                                  className={`tree-mode-pill ${
                                    subDocViewStyle === 'cards' ? 'active' : ''
                                  }`}
                                  onClick={() => setSubDocViewStyle('cards')}
                                  title="카드 그리드 보기"
                                >
                                  카드형
                                </button>
                                <button
                                  className={`tree-mode-pill ${
                                    subDocViewStyle === 'table' ? 'active' : ''
                                  }`}
                                  onClick={() => setSubDocViewStyle('table')}
                                  title="표 목록 보기"
                                >
                                  표형
                                </button>
                              </div>
                            </div>

                            {filteredSubDocs.length === 0 ? (
                              <div className="tree-empty-hint">
                                검색어와 일치하는 하위 문서가 없습니다.
                              </div>
                            ) : subDocViewStyle === 'cards' ? (
                              <div className="subdocs-card-grid">
                                {filteredSubDocs.map((subDoc) => {
                                  const relNorm = subDoc.relativePath.replace(
                                    /\\/g,
                                    '/'
                                  );
                                  const relParts = relNorm.split('/');
                                  const folderBadge =
                                    relParts.length > 1
                                      ? relParts.slice(0, -1).join('/')
                                      : '루트';
                                  const displayTitle =
                                    subDoc.title ||
                                    (subDoc.name.toLowerCase() === 'main.md'
                                      ? `${folderBadge} (프로젝트 허브)`
                                      : subDoc.name.replace(/\.md$/i, ''));

                                  return (
                                    <div
                                      key={subDoc.fullPath}
                                      className="subdoc-card"
                                      onClick={() => openDocumentByNode(subDoc)}
                                      title={`${subDoc.fullPath}\n클릭하여 문서 열기`}
                                    >
                                      <div className="subdoc-card-title">
                                        <span>
                                          {subDoc.name.toLowerCase() ===
                                          'main.md'
                                            ? '⭐'
                                            : '📄'}
                                        </span>
                                        <span>{displayTitle}</span>
                                      </div>
                                      <div className="subdoc-card-meta">
                                        <span>📁 {relNorm}</span>
                                        {subDoc.projectStatus && (
                                          <span
                                            style={{
                                              color:
                                                subDoc.projectStatus ===
                                                '최우선'
                                                  ? '#f87171'
                                                  : 'var(--accent-hover)',
                                              fontWeight: 600,
                                            }}
                                          >
                                            {subDoc.projectStatus}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="md-table-wrapper">
                                <table className="md-table">
                                  <thead>
                                    <tr>
                                      <th>문서명</th>
                                      <th>상대 경로</th>
                                      <th style={{ width: '90px' }}>상태</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {filteredSubDocs.map((subDoc) => {
                                      const relNorm =
                                        subDoc.relativePath.replace(/\\/g, '/');
                                      const relParts = relNorm.split('/');
                                      const folderBadge =
                                        relParts.length > 1
                                          ? relParts.slice(0, -1).join('/')
                                          : '루트';
                                      const displayTitle =
                                        subDoc.title ||
                                        (subDoc.name.toLowerCase() === 'main.md'
                                          ? `${folderBadge} (프로젝트 허브)`
                                          : subDoc.name.replace(/\.md$/i, ''));
                                      return (
                                        <tr
                                          key={subDoc.fullPath}
                                          style={{ cursor: 'pointer' }}
                                          onClick={() =>
                                            openDocumentByNode(subDoc)
                                          }
                                          title={`${subDoc.fullPath}\n클릭하여 문서 열기`}
                                        >
                                          <td
                                            style={{
                                              fontWeight: 600,
                                              color: 'var(--accent-hover)',
                                            }}
                                          >
                                            {subDoc.name.toLowerCase() ===
                                            'main.md'
                                              ? '⭐ '
                                              : '📄 '}
                                            {displayTitle}
                                          </td>
                                          <td
                                            style={{
                                              fontSize: '12px',
                                              color: 'var(--text-secondary)',
                                            }}
                                          >
                                            {relNorm}
                                          </td>
                                          <td>
                                            {subDoc.projectStatus ? (
                                              <span className="role-badge projects">
                                                {subDoc.projectStatus}
                                              </span>
                                            ) : (
                                              <span
                                                style={{
                                                  fontSize: '11px',
                                                  color: 'var(--text-muted)',
                                                }}
                                              >
                                                문서
                                              </span>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                    {currentDoc.backlinks && currentDoc.backlinks.length > 0 && (
                      <div
                        style={{
                          marginTop: '32px',
                          paddingTop: '16px',
                          borderTop: '1px solid var(--border-color)',
                        }}
                      >
                        <h3 style={{ marginBottom: '10px' }}>
                          🔄 연결된 양방향 백링크 ({currentDoc.backlinks.length})
                        </h3>
                        {currentDoc.backlinks.map((bl, bIdx) => (
                          <div
                            key={bIdx}
                            className="rendered-task-row"
                            style={{ cursor: 'pointer' }}
                            onClick={async () => {
                              const d = await readDocument(bl.sourcePath);
                              applyLoadedDocument(d);
                            }}
                          >
                            <span className={`role-badge ${bl.sourceRole}`}>
                              {bl.sourceRole}
                            </span>
                            <div>
                              <div style={{ fontWeight: 700 }}>
                                {bl.sourceTitle}
                              </div>
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                {bl.excerpt}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}
            </>
          ) : (
            /* 초기 빈 화면 */
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                padding: '32px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              <p>
                우측 사이드바(`📂`)에서 문서를 선택하거나 상단 메뉴(`파일`, `이동`)를 통해 문서를 여세요.
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                단축키 설정: <kbd>F12</kbd> | 상단 메뉴: <kbd>F10</kbd> 또는 <kbd>Alt</kbd> | 빠른 열기: <kbd>Ctrl+P</kbd>
              </p>
            </div>
          )}
        </main>

        {/* 3. 우측 접이식 사이드바 (휴대폰 데이터 탭 활성 시 [카톡 / 알림 / 문자 / 통화 / 녹음 / 헬스] 6탭 자동 전환, 그 외 기본 5개 아이콘) */}
        <aside
          className={`right-sidebar ${rightSidebarOpen ? '' : 'collapsed'}`}
          onMouseDown={() => setIsFolderPaneFocused(true)}
        >
          {isMobileDataSidebarMode ? (
            <>
              <div
                className="sidebar-tabs"
                style={{ gap: '2px', padding: '5px 4px', flexWrap: 'nowrap' }}
              >
                {(
                  [
                    { key: 'kakaotalk', label: '카톡' },
                    { key: 'notification', label: '알림' },
                    { key: 'sms', label: '문자' },
                    { key: 'call', label: '통화' },
                    { key: 'recording', label: '녹음' },
                    { key: 'health', label: '헬스' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    className={`sidebar-tab ${mobileSidebarTab === t.key ? 'active' : ''}`}
                    style={{
                      flex: 1,
                      fontSize: '11.5px',
                      fontWeight: 700,
                      padding: '5px 3px',
                      whiteSpace: 'nowrap',
                    }}
                    onClick={() => setMobileSidebarTab(t.key)}
                    title={`${t.label} (우클릭: 인물별 기록 검색)`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {mobileSyncProgress &&
                (() => {
                  const sbStep =
                    mobileSyncProgress.steps[
                      mobileSyncProgress.currentStepIndex
                    ] ||
                    mobileSyncProgress.steps[
                      mobileSyncProgress.steps.length - 1
                    ];
                  return (
                    <div
                      style={{
                        padding: '8px 10px',
                        backgroundColor: 'rgba(15, 23, 42, 0.85)',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '11px',
                          fontWeight: 700,
                        }}
                      >
                        <span style={{ color: '#e0e7ff' }}>
                          {mobileSyncProgress.isRunning
                            ? `🔄 ${mobileSyncProgress.currentLabel}`
                            : `✅ ${mobileSyncProgress.currentLabel}`}
                        </span>
                        <span
                          style={{
                            color: '#4ade80',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {mobileSyncProgress.currentPercent}%
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          width: '100%',
                          height: '8px',
                          backgroundColor: 'rgba(30, 41, 59, 0.9)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                        }}
                      >
                        {(sbStep?.segments || []).map((seg, idx) => (
                          <div
                            key={`sb-seg-${idx}`}
                            style={{
                              width: `${seg.widthPct}%`,
                              height: '100%',
                              backgroundColor:
                                seg.kind === 'download' ? '#22c55e' : '#3b82f6',
                            }}
                          />
                        ))}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '10px',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <span style={{ color: '#93c5fd' }}>
                          🟦 기보유 스킵: {sbStep?.skippedCount ?? 0}
                        </span>
                        <span style={{ color: '#86efac' }}>
                          🟩 신규 다운로드: {sbStep?.downloadedCount ?? 0}
                        </span>
                      </div>
                    </div>
                  );
                })()}

              <div className="sidebar-content">
                {(() => {
                  const nowLocal = new Date();
                  const todayStr = `${nowLocal.getFullYear()}-${String(
                    nowLocal.getMonth() + 1
                  ).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;
                  const dayOfWeek = nowLocal.getDay();
                  const weekStartObj = new Date(nowLocal);
                  weekStartObj.setDate(nowLocal.getDate() - dayOfWeek);
                  const weekStartStr = `${weekStartObj.getFullYear()}-${String(
                    weekStartObj.getMonth() + 1
                  ).padStart(2, '0')}-${String(weekStartObj.getDate()).padStart(2, '0')}`;
                  const monthStartStr = `${nowLocal.getFullYear()}-${String(
                    nowLocal.getMonth() + 1
                  ).padStart(2, '0')}-01`;

                  const sourceLabelMap: Record<LifelogSourceType, string> = {
                    kakaotalk: '카톡',
                    notification: '알림',
                    sms: '문자',
                    call: '통화',
                    recording: '녹음',
                    health: '헬스',
                  };

                  const rawCategoryMsgs = allLifelogMessages.filter(
                    (m) => m.source === mobileSidebarTab
                  );

                  // 사이드바에서는 최신 목록만 보이고 동일한 사용자(대화방/발신자)와의 이전 기록은 숨김 (녹음·헬스는 개별 기록 단위로 모두 표시)
                  const getPersonDedupKey = (m: LifelogMessage): string => {
                    if (m.source === 'recording' || m.source === 'health') {
                      return `${m.source}-${m.id}-${m.sentDate}-${m.sentTime}-${m.roomOrSender}`;
                    }
                    if (m.source === 'sms') {
                      return resolveContactName(
                        m.roomOrSender || m.sender
                      ).trim();
                    }
                    if (m.source === 'call') {
                      const rawTarget =
                        m.sender &&
                        m.sender !== '통화녹음' &&
                        !m.sender.includes('통화')
                          ? m.sender
                          : m.roomOrSender;
                      return resolveContactName(rawTarget)
                        .replace(/\s*\([^)]*\)/g, '')
                        .trim();
                    }
                    if (m.source === 'kakaotalk') {
                      return (m.roomOrSender || m.sender || '카카오톡').trim();
                    }
                    return (m.roomOrSender || m.sender || '알림').trim();
                  };

                  const personMap = new Map<string, LifelogMessage>();
                  const categoryMsgs: LifelogMessage[] = [];
                  for (const m of rawCategoryMsgs) {
                    const key = getPersonDedupKey(m) || `id-${m.id}`;
                    const existing = personMap.get(key);
                    if (!existing) {
                      const clone = { ...m };
                      personMap.set(key, clone);
                      categoryMsgs.push(clone);
                    } else if (
                      (m.source === 'call' || m.source === 'recording') &&
                      !existing.hasAudioRecording &&
                      m.hasAudioRecording &&
                      existing.sentDate === m.sentDate
                    ) {
                      existing.hasAudioRecording = true;
                      if (!existing.attachmentUuid && m.attachmentUuid) {
                        existing.attachmentUuid = m.attachmentUuid;
                      }
                    }
                  }

                  // 현재 편집/열람 중인 파일과 일치하는 사이드바 목록 항목 찾기
                  const activeMatchingMsg =
                    (selectedLifelogMsgId &&
                      categoryMsgs.find(
                        (m) =>
                          m.id === selectedLifelogMsgId &&
                          isLifelogMessageMatchingCurrentDoc(m)
                      )) ||
                    categoryMsgs.find((m) =>
                      isLifelogMessageMatchingCurrentDoc(m)
                    );
                  const activeLifelogMsgId = activeMatchingMsg?.id ?? null;

                  const todayList = categoryMsgs.filter(
                    (m) => m.sentDate >= todayStr
                  );
                  const thisWeekList = categoryMsgs.filter(
                    (m) => m.sentDate >= weekStartStr && m.sentDate < todayStr
                  );
                  const thisMonthList = categoryMsgs.filter(
                    (m) => m.sentDate >= monthStartStr && m.sentDate < weekStartStr
                  );
                  const olderList = categoryMsgs.filter(
                    (m) => m.sentDate < monthStartStr
                  );

                  const renderMsgItem = (msg: LifelogMessage) => {
                    const isActiveDocItem = msg.id === activeLifelogMsgId;

                    const resolvedSenderOrRoom =
                      msg.source === 'sms'
                        ? resolveContactName(msg.roomOrSender || msg.sender)
                        : msg.source === 'call'
                          ? resolveContactName(
                              msg.sender && msg.sender !== '통화녹음'
                                ? msg.sender
                                : msg.roomOrSender
                            )
                          : msg.roomOrSender || msg.sender;

                    const personName =
                      msg.source === 'kakaotalk'
                        ? msg.sender &&
                          msg.sender !== '회원님' &&
                          msg.sender !== '나'
                          ? msg.sender
                          : msg.roomOrSender
                        : resolvedSenderOrRoom
                            .replace(/\s*\([^)]*\)/g, '')
                            .trim();

                    // 통화/음성 녹음 파일이 PC에 다운로드되어 있지 않은 경우 음영(Shaded) 표시
                    const isCallRecordingMissing =
                      (msg.source === 'call' || msg.source === 'recording') &&
                      !msg.hasAudioRecording;

                    // LLM 토큰 부족 또는 미생성 통화/녹음 스크립트 여부 (빨간색 테두리 피드백)
                    const isCallTranscriptPending =
                      (msg.source === 'call' || msg.source === 'recording') &&
                      Boolean(msg.hasAudioRecording) &&
                      (Boolean(
                        msg.attachmentUuid?.startsWith('pending_transcript:')
                      ) ||
                        (msg.message || '').includes('토큰 부족') ||
                        (msg.message || '').includes('스크립트 미생성') ||
                        (msg.message || '').includes('원본 보관'));

                    const recordingSourceBadge =
                      msg.source === 'recording'
                        ? msg.sender || msg.deviceName || 'SM-S901N'
                        : '';

                    const headerTitle =
                      msg.source === 'kakaotalk'
                        ? `${msg.roomOrSender} · ${msg.sender}`
                        : msg.source === 'sms'
                          ? resolvedSenderOrRoom
                          : msg.source === 'call'
                            ? resolvedSenderOrRoom
                            : msg.source === 'recording'
                              ? msg.roomOrSender || '음성 녹음'
                              : msg.source === 'health'
                                ? `${msg.roomOrSender} (${msg.sender})`
                                : msg.roomOrSender || msg.sender;

                    const cleanedPreviewMessage = (msg.message || '')
                      .replace(/^\[ì\s*œëª©ì—†ì\s*Œ\]\s*/g, '')
                      .replace(/^\[제목없음\]\s*/g, '')
                      .replace(/<br\s*\/?>/gi, ' ');

                    return (
                      <div
                        key={msg.id}
                        data-sidebar-active={isActiveDocItem ? 'true' : undefined}
                        className={`tree-node-row ${isActiveDocItem ? 'active' : ''}`}
                        style={{
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: '3px',
                          padding: '6px 8px',
                          cursor: 'pointer',
                          opacity: isActiveDocItem
                            ? 1
                            : isCallRecordingMissing
                              ? 0.46
                              : 1,
                          border: isActiveDocItem
                            ? '1.5px solid var(--accent-primary)'
                            : isCallTranscriptPending
                              ? '1.5px solid #ef4444'
                              : isCallRecordingMissing
                                ? '1px solid rgba(100, 116, 139, 0.22)'
                                : undefined,
                          backgroundColor: isActiveDocItem
                            ? 'rgba(99, 102, 241, 0.22)'
                            : isCallTranscriptPending
                              ? 'rgba(239, 68, 68, 0.09)'
                              : isCallRecordingMissing
                                ? 'rgba(15, 23, 42, 0.55)'
                                : undefined,
                          boxShadow: isActiveDocItem
                            ? '0 0 0 1px rgba(99, 102, 241, 0.35), 0 4px 12px rgba(0, 0, 0, 0.25)'
                            : isCallTranscriptPending
                              ? '0 0 0 1px rgba(239, 68, 68, 0.22)'
                              : undefined,
                          borderRadius: '6px',
                          marginBottom:
                            isActiveDocItem ||
                            isCallTranscriptPending ||
                            isCallRecordingMissing
                              ? '3px'
                              : undefined,
                        }}
                        onClick={() => {
                          setMobilePersonFilter(personName || '');
                          setMobileSourceFilter(mobileSidebarTab);
                          handleSelectLifelogSidebarItem(msg);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMobileContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            personName: personName || '상대방',
                            sourceKey: mobileSidebarTab,
                            sourceLabel: sourceLabelMap[mobileSidebarTab],
                            messageItem: msg,
                          });
                        }}
                        title={
                          isActiveDocItem
                            ? `✏️ 현재 에디터에서 열람/편집 중인 항목 ('${headerTitle}') | 우클릭: 메뉴`
                            : isCallRecordingMissing
                              ? `🔇 녹음 미다운로드 (음영 표시) — '${headerTitle}' 기록 열기 | 우클릭: 메뉴`
                              : isCallTranscriptPending
                                ? `⚠️ LLM 토큰 부족으로 스크립트 미생성 (${geminiStatus?.retryAfterAt ? `${geminiStatus.retryAfterAt} 에 5시간 후 자동 재시도` : '5시간 후 자동 재시도'}) | 클릭하여 열기`
                                : `좌클릭: 에디터 영역에 '${headerTitle}' 출력 | 우클릭: '${personName}'님과의 검색 팝업`
                        }
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            width: '100%',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            color: isActiveDocItem
                              ? '#e0e7ff'
                              : isCallTranscriptPending
                                ? '#fca5a5'
                                : isCallRecordingMissing
                                  ? 'var(--text-muted)'
                                  : '#a5b4fc',
                            gap: '6px',
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <span>
                              {isCallRecordingMissing
                                ? '🔇 '
                                : msg.source === 'call'
                                  ? '🎧 '
                                  : msg.source === 'recording'
                                    ? '🎙️ '
                                    : msg.source === 'health'
                                      ? '🏃 '
                                      : ''}
                              {headerTitle}
                            </span>
                            {recordingSourceBadge && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  padding: '1px 5px',
                                  borderRadius: '999px',
                                  backgroundColor:
                                    recordingSourceBadge.includes('워치')
                                      ? 'rgba(16, 185, 129, 0.22)'
                                      : 'rgba(59, 130, 246, 0.22)',
                                  color: recordingSourceBadge.includes('워치')
                                    ? '#6ee7b7'
                                    : '#93c5fd',
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {recordingSourceBadge}
                              </span>
                            )}
                            {isActiveDocItem && (
                              <span
                                style={{
                                  fontSize: '9.5px',
                                  padding: '1px 5px',
                                  borderRadius: '999px',
                                  backgroundColor: 'var(--accent-primary)',
                                  color: '#ffffff',
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                편집중
                              </span>
                            )}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '10.5px',
                              color: isActiveDocItem
                                ? '#c7d2fe'
                                : isCallTranscriptPending
                                  ? '#f87171'
                                  : 'var(--text-muted)',
                              flexShrink: 0,
                            }}
                          >
                            {msg.sentDate.slice(5)} {msg.sentTime.slice(0, 5)}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: isCallTranscriptPending
                              ? '#fecaca'
                              : isCallRecordingMissing
                                ? 'var(--text-muted)'
                                : 'var(--text-primary)',
                            width: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {cleanedPreviewMessage}
                        </div>
                        {isCallTranscriptPending && (
                          <div
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              color: '#f87171',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <span>
                              ⏳ 토큰 부족 미생성 ·{' '}
                              {geminiStatus?.retryAfterAt
                                ? `5시간 후(${geminiStatus.retryAfterAt.slice(11, 16)}) 재시도`
                                : '5시간 후 자동 재시도'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  };

                  const sections: Array<{
                    title: string;
                    items: LifelogMessage[];
                  }> = [
                    { title: '오늘 목록', items: todayList },
                    { title: '이번주', items: thisWeekList },
                    { title: '이번달', items: thisMonthList },
                    { title: '오래됨', items: olderList },
                  ];

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {sections.map((sec, sIdx) => (
                        <React.Fragment key={sec.title}>
                          {sIdx > 0 && (
                            <hr
                              style={{
                                border: 'none',
                                borderTop: '1px solid var(--border-color)',
                                margin: '6px 0',
                              }}
                            />
                          )}
                          <div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '11.5px',
                                fontWeight: 700,
                                color: 'var(--text-secondary)',
                                padding: '2px 4px',
                                marginBottom: '4px',
                              }}
                            >
                              <span>{sec.title}</span>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  color: 'var(--text-muted)',
                                }}
                              >
                                {sec.items.length}건
                              </span>
                            </div>
                            {sec.items.length === 0 ? (
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--text-muted)',
                                  padding: '4px 8px',
                                }}
                              >
                                내역 없음
                              </div>
                            ) : (
                              (() => {
                                const sliced = sec.items.slice(0, 150);
                                if (
                                  activeLifelogMsgId &&
                                  !sliced.some((m) => m.id === activeLifelogMsgId)
                                ) {
                                  const activeInSec = sec.items.find(
                                    (m) => m.id === activeLifelogMsgId
                                  );
                                  if (activeInSec) {
                                    sliced.push(activeInSec);
                                  }
                                }
                                return sliced.map(renderMsgItem);
                              })()
                            )}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </>
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
            {rightTab === 'tree' && (
              <>
                <input
                  className="input-field"
                  style={{ marginBottom: '10px' }}
                  placeholder="파일 또는 제목 필터..."
                  value={treeFilter}
                  onChange={(e) => setTreeFilter(e.target.value)}
                />

                {trashHistory.length > 0 && (
                  <button
                    className="toolbar-btn"
                    style={{
                      width: '100%',
                      marginBottom: '10px',
                      justifyContent: 'center',
                      borderColor: '#f59e0b',
                      color: '#fbbf24',
                    }}
                    onClick={() => handleRestoreTrashedDocument()}
                    title="방금 휴지통으로 이동한 파일을 원래 위치로 되돌립니다 (Ctrl+Z)"
                  >
                    ↩ 되돌리기: {trashHistory[trashHistory.length - 1].fileName} 복구
                  </button>
                )}

                {(
                  ['projects', 'diary', 'data', 'git'] as BaseFolderRole[]
                ).map((roleKey) => {
                  const roleLabel =
                    roleKey === 'projects'
                      ? '📁 프로젝트'
                      : roleKey === 'diary'
                        ? '📅 일기'
                        : roleKey === 'data'
                          ? '🗄️ 아카이브'
                          : '💻 Git';
                  const mode = sectionModes[roleKey];
                  const roleFiles = flattenedFiles.filter(
                    (f) =>
                      f.role === roleKey &&
                      (treeFilter.trim() === '' ||
                        f.name
                          .toLowerCase()
                          .includes(treeFilter.toLowerCase()) ||
                        f.relativePath
                          .toLowerCase()
                          .includes(treeFilter.toLowerCase()))
                  );

                  const displayedFiles =
                    roleKey === 'projects'
                      ? mode === 'open'
                        ? roleFiles
                        : mode === 'summary'
                          ? roleFiles.filter(isTopPriorityProjectNode)
                          : []
                      : roleKey === 'diary'
                        ? mode === 'open'
                          ? roleFiles
                          : mode === 'summary'
                            ? roleFiles.filter(
                                (f) =>
                                  isThisWeekDiaryNode(f) ||
                                  currentDoc?.fullPath === f.fullPath
                              )
                            : []
                        : roleKey === 'git'
                          ? roleFiles
                          : [];

                  return (
                    <div key={roleKey} className="tree-group-section">
                      <div
                        className="tree-group-header"
                        onClick={() => cycleSectionMode(roleKey)}
                        title={
                          roleKey === 'data'
                            ? '클릭하여 요약 / 닫기 토글 (아카이브는 열기가 없으며 닫기/요약만 지원)'
                            : roleKey === 'git'
                              ? '클릭하여 열기 / 요약 / 닫기 토글 (Git 폴더는 UUID 스캔·주입 제외, 열람·편집만 처리)'
                              : '클릭하여 열기 / 요약 / 닫기 토글'
                        }
                      >
                        <div className="tree-group-title-wrap">
                          <span>{roleLabel}</span>
                          <span className="tree-group-count">
                            {roleKey === 'data' || roleKey === 'git'
                              ? roleFiles.length
                              : roleKey === 'projects'
                                ? `${projectRootTree.folders.length}개 프로젝트 (${roleFiles.length})`
                                : mode === 'closed'
                                  ? roleFiles.length
                                  : `${displayedFiles.length}/${roleFiles.length}`}
                          </span>
                        </div>

                        <div
                          className="tree-mode-toggle-group"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {roleKey !== 'data' && (
                            <button
                              className={`tree-mode-pill ${
                                mode === 'open' ? 'active' : ''
                              }`}
                              onClick={() =>
                                setSectionModes((prev) => ({
                                  ...prev,
                                  [roleKey]: 'open',
                                }))
                              }
                              title="열기: 모든 파일 보이기"
                            >
                              열기
                            </button>
                          )}
                          <button
                            className={`tree-mode-pill ${
                              mode === 'summary' ? 'active' : ''
                            }`}
                            onClick={() => {
                              if (roleKey === 'data') {
                                setExpandedArchiveMore(new Set());
                              }
                              setSectionModes((prev) => ({
                                ...prev,
                                [roleKey]: 'summary',
                              }));
                            }}
                            title={
                              roleKey === 'projects'
                                ? '요약: 최우선 프로젝트 및 현재 열람 중인 프로젝트 폴더만 출력'
                                : roleKey === 'diary'
                                  ? `요약: 이번 주(${currentWeekRange.start} ~ ${currentWeekRange.end}) 일기만 표시`
                                  : roleKey === 'git'
                                    ? '요약: Git 저장소 폴더 트리 보기'
                                    : '요약: 파일트리를 모두 닫힌 상태로 표시 (엑세스된 파일 경로만 열림, 5개 초과 시 ... 생략)'
                            }
                          >
                            요약
                          </button>
                          <button
                            className={`tree-mode-pill ${
                              mode === 'closed' ? 'active' : ''
                            }`}
                            onClick={() =>
                              setSectionModes((prev) => ({
                                ...prev,
                                [roleKey]: 'closed',
                              }))
                            }
                            title="닫기: 모든 내용 생략"
                          >
                            닫기
                          </button>
                        </div>
                      </div>

                      {mode !== 'closed' && roleKey === 'projects' && (
                        <div className="archive-tree-container">
                          {renderProjectFolderLevel(
                            projectRootTree,
                            0,
                            mode
                          )}
                        </div>
                      )}

                      {mode !== 'closed' && roleKey === 'diary' && (
                        <>
                          {displayedFiles.length === 0 ? (
                            <div className="tree-empty-hint">
                              {`이번 주(${currentWeekRange.start.slice(5)}~${currentWeekRange.end.slice(5)}) 일기가 없습니다.`}
                            </div>
                          ) : (
                            displayedFiles.map((node) => (
                              <div
                                key={node.fullPath}
                                tabIndex={0}
                                className={`tree-node-row ${
                                  currentDoc?.fullPath === node.fullPath
                                    ? 'active'
                                    : ''
                                }`}
                                onClick={() => {
                                  setIsFolderPaneFocused(true);
                                  openDocumentByNode(node);
                                }}
                                onFocus={() => setIsFolderPaneFocused(true)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setIsFolderPaneFocused(true);
                                  setContextMenu({
                                    x: e.clientX,
                                    y: e.clientY,
                                    targetPath: node.fullPath,
                                    targetUuid: node.uuid,
                                    targetName: node.relativePath,
                                  });
                                }}
                                title={`${node.fullPath}\n(Del: 휴지통으로 이동 | 우클릭: 메뉴)`}
                              >
                                <div className="tree-node-label">
                                  <span>
                                    {node.name === 'main.md' ? '⭐' : '📄'}
                                  </span>
                                  <span>{node.relativePath}</span>
                                </div>
                              </div>
                            ))
                          )}
                        </>
                      )}

                      {mode !== 'closed' && roleKey === 'data' && (
                        <div className="archive-tree-container">
                          {renderArchiveFolderLevel(archiveRootTree, 0)}
                        </div>
                      )}

                      {mode !== 'closed' && roleKey === 'git' && (
                        <div className="archive-tree-container">
                          {roleFiles.length === 0 ? (
                            <div className="tree-empty-hint">
                              등록된 Git 베이스 폴더가 없거나 .md 파일이 없습니다. (설정 대쉬보드에서 Git 베이스 폴더를 추가할 수 있습니다)
                            </div>
                          ) : (
                            renderProjectFolderLevel(gitRootTree, 0, 'open')
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* 🔍 파일에서 찾기/바꾸기 결과 리스트 (선택 시 해당 문서의 해당 줄 위치로 즉시 이동) */}
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
      </div>

      {/* 4. 하단 상태 표시줄 (통화/음성 오디오 활성 시 파일명·메타데이터 없이 최대 길이 재생바 + 아이콘 버튼 표시) */}
      <footer
        className="statusbar"
        style={
          directCallPlayInfo
            ? {
                padding: '3px 10px',
                backgroundColor: '#1e1b4b',
                borderTop: '1.5px solid var(--accent-primary)',
                gap: '8px',
              }
            : undefined
        }
      >
        {directCallPlayInfo ? (
          <>
            <audio
              ref={callAudioRef}
              controls
              autoPlay={Boolean(directCallPlayInfo.autoPlay)}
              src={directCallPlayInfo.audioUrl}
              onTimeUpdate={handleAudioTimeUpdate}
              onLoadedMetadata={(e) => {
                if (pendingSeekSecondsRef.current !== null) {
                  e.currentTarget.currentTime = pendingSeekSecondsRef.current;
                  pendingSeekSecondsRef.current = null;
                  e.currentTarget.play().catch(() => {});
                }
              }}
              style={{
                flex: 1,
                width: '100%',
                minWidth: 0,
                height: '28px',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                flexShrink: 0,
              }}
            >
              <button
                className="toolbar-btn"
                style={{
                  padding: '3px 7px',
                  fontSize: '13px',
                  lineHeight: 1,
                }}
                onClick={() => showInExplorer(directCallPlayInfo.fullPath)}
                title="파일 위치 열기"
              >
                📂
              </button>
              <button
                className="toolbar-btn"
                style={{
                  padding: '3px 7px',
                  fontSize: '13px',
                  lineHeight: 1,
                }}
                onClick={() => {
                  if (directCallPlayInfo?.audioUrl?.startsWith('blob:')) {
                    URL.revokeObjectURL(directCallPlayInfo.audioUrl);
                  }
                  setDirectCallPlayInfo(null);
                  setActiveAudioLineIndex(null);
                }}
                title="닫기"
              >
                ✕
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {statusMessage}
            </div>

            {scanProgress && scanProgress.totalFiles > 0 && (
              <div className="scan-progress-container">
                <div className="scan-progress-track">
                  <div
                    className="scan-progress-base-fill"
                    style={{ width: `${scanProgress.startPercent}%` }}
                  />
                  <div
                    className="scan-progress-active-fill"
                    style={{ width: `${scanProgress.currentPercent}%` }}
                  />
                </div>
                <div className="scan-progress-meta">
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>
                    {scanProgress.currentPercent.toFixed(1)}%
                  </span>
                  <span>
                    ({scanProgress.completedFiles}/{scanProgress.totalFiles})
                  </span>
                  {scanProgress.isRunning && (
                    <span style={{ color: '#fbbf24' }}>
                      남은시간: 약 {scanProgress.etaSeconds.toFixed(1)}초
                    </span>
                  )}
                </div>
              </div>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexShrink: 0,
              }}
            >
              {trashHistory.length > 0 && (
                <button
                  className="toolbar-btn"
                  style={{
                    padding: '2px 8px',
                    fontSize: '11px',
                    borderColor: '#f59e0b',
                    color: '#fbbf24',
                  }}
                  onClick={() => handleRestoreTrashedDocument()}
                  title="휴지통으로 이동한 파일 복구 (Ctrl+Z)"
                >
                  ↩ 휴지통 되돌리기 ({trashHistory.length})
                </button>
              )}
              <span>자동저장: {autoSaveEnabled ? 'ON' : 'OFF'}</span>
              <span>포트: 18443</span>
            </div>
          </>
        )}
      </footer>

      {/* 5. 우클릭 컨텍스트 메뉴 (`탐색기에서 보기` 포함) */}
      {contextMenu && (
        <div
          className="context-menu-popup"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="menu-item"
            onClick={() => {
              showInExplorer(contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>📂 탐색기에서 보기</span>
            <span className="menu-item-shortcut">Explorer</span>
          </button>
          {contextMenu.targetUuid && (
            <button
              className="menu-item"
              onClick={() => {
                navigator.clipboard.writeText(
                  `[문서링크](mylore://doc/${contextMenu.targetUuid})`
                );
                setStatusMessage(
                  `🔗 복사됨: mylore://doc/${contextMenu.targetUuid}`
                );
                setContextMenu(null);
              }}
            >
              <span>🔗 UUID 링크 복사</span>
              <span className="menu-item-shortcut">mylore://</span>
            </button>
          )}
          <div className="menu-divider" />
          <button
            className="menu-item"
            onClick={() => {
              handleMoveRole('projects', contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>🚚 프로젝트(Projects)로 이동</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              handleMoveRole('diary', contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>🚚 일기(Diary)로 이동</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              handleMoveRole('data', contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>🚚 데이터(Archive)로 이동</span>
          </button>
          <div className="menu-divider" />
          <button
            className="menu-item"
            onClick={() => {
              const target = contextMenu.targetPath;
              setContextMenu(null);
              handleTrashDocument(target);
            }}
          >
            <span style={{ color: '#f87171' }}>🗑️ 휴지통으로 이동</span>
            <span className="menu-item-shortcut">Del</span>
          </button>
          {trashHistory.length > 0 && (
            <button
              className="menu-item"
              onClick={() => {
                setContextMenu(null);
                handleRestoreTrashedDocument();
              }}
            >
              <span style={{ color: '#fbbf24' }}>↩ 방금 삭제한 파일 복구</span>
              <span className="menu-item-shortcut">Ctrl+Z</span>
            </button>
          )}
        </div>
      )}

      {/* 5-2. 휴대폰 데이터 우클릭 컨텍스트 메뉴 ('통화 직접 듣기' / '스크립트 추출 및 요약' / 인물별 검색) */}
      {mobileContextMenu && (
        <div
          className="context-menu-popup"
          style={{
            top: Math.min(mobileContextMenu.y, window.innerHeight - 200),
            left: Math.min(mobileContextMenu.x, window.innerWidth - 300),
            minWidth: '275px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(mobileContextMenu.sourceKey === 'call' ||
            mobileContextMenu.sourceKey === 'recording') &&
            (() => {
              const msgItem = mobileContextMenu.messageItem;
              const isVoiceRec = mobileContextMenu.sourceKey === 'recording';
              const hasRecording = Boolean(msgItem.hasAudioRecording);
              const isCallAlreadyTranscribed =
                Boolean(msgItem.attachmentUuid?.startsWith('transcribed:')) &&
                !(msgItem.message || '').includes('스크립트 미생성') &&
                !(msgItem.message || '').includes('토큰 부족') &&
                !(msgItem.message || '').includes('원본 보관');
              const isTranscribeDisabled =
                !hasRecording ||
                isCallAlreadyTranscribed ||
                isTranscribingSingleCall;

              return (
                <>
                  <button
                    className="menu-item"
                    disabled={!hasRecording}
                    style={
                      !hasRecording
                        ? {
                            opacity: 0.42,
                            backgroundColor: 'rgba(15, 23, 42, 0.45)',
                            color: 'var(--text-muted)',
                            cursor: 'not-allowed',
                          }
                        : undefined
                    }
                    onClick={async () => {
                      if (!hasRecording) return;
                      const targetMsg = mobileContextMenu.messageItem;
                      setMobileContextMenu(null);
                      await loadCallAudioIntoStatusBar(
                        targetMsg.roomOrSender,
                        targetMsg.attachmentUuid,
                        true
                      );
                    }}
                  >
                    <span>
                      {hasRecording
                        ? isVoiceRec
                          ? '🎧 음성녹음 직접 듣기'
                          : '🎧 통화 직접 듣기'
                        : isVoiceRec
                          ? '🔇 음성녹음 직접 듣기 (녹음 미다운로드)'
                          : '🔇 통화 직접 듣기 (녹음 미다운로드)'}
                    </span>
                  </button>
                  <button
                    className="menu-item"
                    disabled={isTranscribeDisabled}
                    style={
                      isTranscribeDisabled
                        ? {
                            opacity: 0.42,
                            backgroundColor: !hasRecording
                              ? 'rgba(15, 23, 42, 0.45)'
                              : undefined,
                            color: !hasRecording
                              ? 'var(--text-muted)'
                              : undefined,
                            cursor: 'not-allowed',
                          }
                        : undefined
                    }
                    onClick={async () => {
                      if (isTranscribeDisabled) {
                        return;
                      }
                      const targetMsg = mobileContextMenu.messageItem;
                      setMobileContextMenu(null);
                      try {
                        setIsTranscribingSingleCall(true);
                        setStatusMessage(
                          isVoiceRec
                            ? `🎙️ '${mobileContextMenu.personName}' 음성녹음(회의록·음성메모 톤) 스크립트 추출 및 요약을 진행 중입니다...`
                            : `🎙️ '${mobileContextMenu.personName}' 통화 녹음의 스크립트 추출 및 요약을 진행 중입니다...`
                        );
                        const doc = await transcribeSingleCallItem({
                          roomOrSender: targetMsg.roomOrSender,
                          attachmentUuid: targetMsg.attachmentUuid,
                        });
                        const gStat = await getGeminiApiKeyStatus();
                        setGeminiStatus(gStat);
                        await refreshAllLifelogMessages();
                        await refreshTree();
                        applyLoadedDocument(doc);
                        setStatusMessage(
                          `✅ '${mobileContextMenu.personName}' 스크립트 추출 및 요약이 완료되었습니다!`
                        );
                      } catch (err) {
                        const gStat = await getGeminiApiKeyStatus().catch(() => null);
                        if (gStat) setGeminiStatus(gStat);
                        await refreshAllLifelogMessages();
                        setStatusMessage(`❌ 스크립트 추출 실패: ${String(err)}`);
                      } finally {
                        setIsTranscribingSingleCall(false);
                      }
                    }}
                  >
                    <span>
                      {isVoiceRec
                        ? '🎙️ 스크립트 추출 및 요약 (회의록·음성메모)'
                        : '🎙️ 스크립트 추출 및 요약'}
                      {!hasRecording
                        ? ' (녹음 미다운로드)'
                        : isCallAlreadyTranscribed
                          ? ' (이미 완료됨)'
                          : ''}
                    </span>
                  </button>
                  <div className="menu-divider" />
                </>
              );
            })()}

          <button
            className="menu-item"
            onClick={() => {
              setLifelogDashboardTab('mobile');
              setMobilePersonFilter(mobileContextMenu.personName);
              setMobileSourceFilter(mobileContextMenu.sourceKey);
              setStatusMessage(
                `🔍 '${mobileContextMenu.personName}'님과의 '${mobileContextMenu.sourceLabel}' 기록을 검색합니다.`
              );
              setMobileContextMenu(null);
            }}
          >
            <span>
              🔍 &lsquo;{mobileContextMenu.personName}&rsquo;님과의 &lsquo;
              {mobileContextMenu.sourceLabel}&rsquo; 검색
            </span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setLifelogDashboardTab('mobile');
              setMobilePersonFilter(mobileContextMenu.personName);
              setMobileSourceFilter('all');
              setStatusMessage(
                `📚 '${mobileContextMenu.personName}'님과의 모든기록(카톡·알림·문자·통화)을 검색합니다.`
              );
              setMobileContextMenu(null);
            }}
          >
            <span>
              📚 &lsquo;{mobileContextMenu.personName}&rsquo;님과의 모든기록 검색
            </span>
          </button>
        </div>
      )}

      {/* 6. 명령어 팔레트 / 빠른 파일 열기 모달 */}
      {paletteMode !== 'closed' && (
        <div
          className="modal-backdrop"
          onClick={() => setPaletteMode('closed')}
        >
          <div className="palette-box" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="palette-input"
              placeholder={
                paletteMode === 'commands'
                  ? '> 실행할 명령어를 검색하세요...'
                  : '열고 싶은 문서 파일명 또는 경로를 입력하세요...'
              }
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
            />
            <div className="palette-list">
              {paletteMode === 'commands'
                ? commandItems
                    .filter((c) =>
                      c.label.toLowerCase().includes(paletteQuery.toLowerCase())
                    )
                    .map((cmd) => (
                      <button
                        key={cmd.id}
                        className="palette-item"
                        onClick={() => {
                          setPaletteMode('closed');
                          cmd.action();
                        }}
                      >
                        <span>{cmd.label}</span>
                        <span className="menu-item-shortcut">
                          {cmd.shortcut}
                        </span>
                      </button>
                    ))
                : flattenedFiles
                    .filter(
                      (f) =>
                        f.name
                          .toLowerCase()
                          .includes(paletteQuery.toLowerCase()) ||
                        f.relativePath
                          .toLowerCase()
                          .includes(paletteQuery.toLowerCase())
                    )
                    .slice(0, 30)
                    .map((file) => (
                      <button
                        key={file.fullPath}
                        className="palette-item"
                        onClick={() => {
                          setPaletteMode('closed');
                          openDocumentByNode(file);
                        }}
                      >
                        <span>
                          [{file.role.toUpperCase()}] {file.relativePath}
                        </span>
                        <span className="menu-item-shortcut">
                          {file.uuid.slice(0, 8)}
                        </span>
                      </button>
                    ))}
            </div>
          </div>
        </div>
      )}

      {/* 7. 파일 > 새 파일 > 새 일정 (달력 UI 모달) */}
      {calendarModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setCalendarModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '760px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ fontSize: '16px' }}>
                  📅 새 일정 생성 및 기존 일정 달력 ({calendarYearMonth.year}년 {calendarYearMonth.month}월)
                </h3>
                <button
                  className="toolbar-btn"
                  onClick={() =>
                    setCalendarYearMonth((p) =>
                      p.month === 1
                        ? { year: p.year - 1, month: 12 }
                        : { year: p.year, month: p.month - 1 }
                    )
                  }
                >
                  ◀
                </button>
                <button
                  className="toolbar-btn"
                  onClick={() =>
                    setCalendarYearMonth((p) =>
                      p.month === 12
                        ? { year: p.year + 1, month: 1 }
                        : { year: p.year, month: p.month + 1 }
                    )
                  }
                >
                  ▶
                </button>
              </div>
              <button
                className="toolbar-btn"
                onClick={() => setCalendarModalOpen(false)}
              >
                닫기
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              날짜 칸(빈 일정)을 클릭하면 해당 일자로 선택되며, 아래에 일정 제목을 입력해 즉시 생성하거나 기존 일정을 클릭해 열 수 있습니다.
            </p>
            <div className="calendar-grid">
              {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
                <div key={w} className="calendar-weekday-header">
                  {w}
                </div>
              ))}
              {calendarDays.map((cell, idx) =>
                cell.day === null ? (
                  <div key={`ce-${idx}`} />
                ) : (
                  <div
                    key={cell.dateStr}
                    className={`calendar-day-cell ${
                      newDocDate === cell.dateStr ? 'selected' : ''
                    }`}
                    onClick={() => {
                      setNewDocDate(cell.dateStr);
                      setNewDocRole('diary');
                    }}
                  >
                    <div style={{ fontSize: '11.5px', fontWeight: 700 }}>
                      {cell.day}
                    </div>
                    {cell.events.map((ev) => (
                      <div
                        key={ev.fullPath}
                        className="calendar-event-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCalendarModalOpen(false);
                          openDocumentByNode(ev);
                        }}
                      >
                        {ev.name.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').replace(/\.md$/i, '')}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                marginTop: '14px',
                paddingTop: '12px',
                borderTop: '1px solid var(--border-color)',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12.5px', fontWeight: 700, flexShrink: 0 }}>
                선택 일자: {newDocDate}
              </span>
              <input
                autoFocus
                className="input-field"
                placeholder="새 일정 제목 입력 (예: 반다비 수영 강습)..."
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setNewDocRole('diary');
                    handleCreateNewDocSubmit();
                  }
                }}
              />
              <select
                className="input-field"
                style={{ width: '160px' }}
                value={newDocCalendar}
                onChange={(e) => setNewDocCalendar(e.target.value)}
              >
                {Object.entries(GOOGLE_CALENDAR_COLOR_MAP).map(([cat]) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <button
                className="toolbar-btn primary"
                style={{ flexShrink: 0 }}
                onClick={() => {
                  setNewDocRole('diary');
                  handleCreateNewDocSubmit();
                }}
              >
                일정 생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. F1 도움말 (단축키 설정 변경) 모달 — 5열 표 + 검색 기능 */}
      {shortcutsModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setRecordingShortcutTarget(null);
            setShortcutsModalOpen(false);
          }}
        >
          <div
            className="palette-box help-modal-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="help-header-row">
              <h3 style={{ fontSize: '16px' }}>
                ⌨️ 도움말 — 단축키 설정 (`F1` 또는 `파일 &gt; 도움말`)
              </h3>
              <button
                className="toolbar-btn"
                onClick={() => {
                  setKeybindings(DEFAULT_KEYBINDINGS);
                  localStorage.setItem(
                    KEYBINDINGS_STORAGE_KEY,
                    JSON.stringify(DEFAULT_KEYBINDINGS)
                  );
                }}
              >
                기본값 초기화
              </button>
            </div>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '10px',
              }}
            >
              기본/보조 단축키 버튼을 클릭한 뒤 원하는 키 조합을 누르면 즉시 반영됩니다. (보조 단축키 녹음 중 `Backspace`/`Delete` 입력 시 해제, `F12`는 개발자모드로 현행 유지)
            </p>
            <div className="help-search-row">
              <input
                type="text"
                className="input-field"
                placeholder="🔍 검색 (기능, 분류, 기본/보조 단축키, 조건으로 필터링...)"
                value={helpSearchQuery}
                onChange={(e) => setHelpSearchQuery(e.target.value)}
                autoFocus
              />
              {helpSearchQuery && (
                <button
                  className="toolbar-btn"
                  onClick={() => setHelpSearchQuery('')}
                >
                  초기화
                </button>
              )}
            </div>
            <div className="help-table-wrap">
              <table className="help-table">
                <thead>
                  <tr>
                    <th style={{ width: '28%' }}>기능</th>
                    <th style={{ width: '14%' }}>분류</th>
                    <th style={{ width: '20%' }}>기본 단축키</th>
                    <th style={{ width: '20%' }}>보조 단축키</th>
                    <th style={{ width: '18%' }}>조건</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredKeybindings.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          textAlign: 'center',
                          padding: '24px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        검색어 &ldquo;{helpSearchQuery}&rdquo;에 해당하는 단축키가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredKeybindings.map((kb) => {
                      const isRecPrimary =
                        recordingShortcutTarget?.id === kb.id &&
                        recordingShortcutTarget.field === 'shortcut';
                      const isRecSecondary =
                        recordingShortcutTarget?.id === kb.id &&
                        recordingShortcutTarget.field === 'secondaryShortcut';
                      return (
                        <tr key={kb.id}>
                          <td style={{ fontWeight: 600 }}>{kb.label}</td>
                          <td>
                            <span className="help-category-badge">
                              {kb.category}
                            </span>
                          </td>
                          <td>
                            <button
                              className={`toolbar-btn help-shortcut-btn ${
                                isRecPrimary ? 'primary' : ''
                              }`}
                              disabled={kb.id === 'devtools_info'}
                              onClick={() => {
                                if (kb.id !== 'devtools_info') {
                                  setRecordingShortcutTarget({
                                    id: kb.id,
                                    field: 'shortcut',
                                  });
                                }
                              }}
                            >
                              {isRecPrimary
                                ? '키 입력...'
                                : kb.shortcut || '-'}
                            </button>
                          </td>
                          <td>
                            <button
                              className={`toolbar-btn help-shortcut-btn ${
                                isRecSecondary ? 'primary' : ''
                              }`}
                              disabled={kb.id === 'devtools_info'}
                              onClick={() => {
                                if (kb.id !== 'devtools_info') {
                                  setRecordingShortcutTarget({
                                    id: kb.id,
                                    field: 'secondaryShortcut',
                                  });
                                }
                              }}
                            >
                              {isRecSecondary
                                ? '키 입력...'
                                : kb.secondaryShortcut || '-'}
                            </button>
                          </td>
                          <td>
                            <span className="help-condition-badge">
                              {kb.condition}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '14px',
              }}
            >
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                표시 항목: {filteredKeybindings.length} / {keybindings.length}개
              </span>
              <button
                className="toolbar-btn"
                onClick={() => {
                  setRecordingShortcutTarget(null);
                  setShortcutsModalOpen(false);
                }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8-2. F2 현재 문서 제목 변경 모달 */}
      {renameModalOpen && currentDoc && (
        <div
          className="modal-backdrop"
          onClick={() => setRenameModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '460px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '8px', fontSize: '16px' }}>
              ✏️ 현재 문서 제목 변경 (`F2`)
            </h3>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '12px',
              }}
            >
              문서 제목(또는 프로젝트 폴더명)이 변경되더라도 내부 고유{' '}
              <code>UUID ({currentDoc.uuid.slice(0, 8)})</code>와 백링크 연결은 그대로 유지됩니다.
            </p>
            <input
              autoFocus
              className="input-field"
              placeholder="새 문서 제목 입력..."
              value={renameTitleInput}
              onChange={(e) => setRenameTitleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameCurrentDocSubmit();
                } else if (e.key === 'Escape') {
                  setRenameModalOpen(false);
                }
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '14px',
              }}
            >
              <button
                className="toolbar-btn"
                onClick={() => setRenameModalOpen(false)}
              >
                취소
              </button>
              <button
                className="toolbar-btn primary"
                onClick={handleRenameCurrentDocSubmit}
              >
                제목 변경 적용
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. 줄 이동 모달 */}
      {gotoLineModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setGotoLineModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '360px', padding: '18px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '10px', fontSize: '15px' }}>
              줄 이동 (Go to Line)
            </h3>
            <input
              autoFocus
              type="number"
              className="input-field"
              value={gotoLineInput}
              onChange={(e) => setGotoLineInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && currentDoc) {
                  const lineNum = parseInt(gotoLineInput || '1', 10);
                  setGotoLineModalOpen(false);
                  applyLoadedDocument(currentDoc, { lineNumber: lineNum });
                }
              }}
            />
          </div>
        </div>
      )}

      {/* 10. 베이스 폴더 설정 모달 */}
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div
            className="palette-box"
            style={{ width: '720px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '12px', fontSize: '16px' }}>
              ⚙️ 베이스 폴더 목록 및 폴더 목적 설정
            </h3>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                maxHeight: '380px',
                overflowY: 'auto',
              }}
            >
              {baseFolders.map((bf, idx) => (
                <div
                  key={bf.id}
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      className="task-status-select"
                      value={bf.role}
                      onChange={(e) => {
                        const next = [...baseFolders];
                        next[idx].role = e.target.value as BaseFolderRole;
                        setBaseFolders(next);
                      }}
                    >
                      <option value="data">데이터 (Archive)</option>
                      <option value="diary">일기 (Diary)</option>
                      <option value="projects">프로젝트 (Projects)</option>
                      <option value="git">Git (스캔·UUID 제외)</option>
                    </select>
                    <input
                      className="input-field"
                      style={{ flex: 1 }}
                      value={bf.path}
                      onChange={(e) => {
                        const next = [...baseFolders];
                        next[idx].path = e.target.value;
                        setBaseFolders(next);
                      }}
                    />
                    <button
                      className="toolbar-btn"
                      style={{
                        color: '#f87171',
                        borderColor: 'rgba(248, 113, 113, 0.45)',
                        flexShrink: 0,
                      }}
                      onClick={() => {
                        const next = baseFolders.filter((_, i) => i !== idx);
                        setBaseFolders(next);
                      }}
                      title="이 베이스 폴더 삭제"
                    >
                      🗑️ 삭제
                    </button>
                  </div>
                  <input
                    className="input-field"
                    value={bf.purpose}
                    onChange={(e) => {
                      const next = [...baseFolders];
                      next[idx].purpose = e.target.value;
                      setBaseFolders(next);
                    }}
                  />
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '16px',
              }}
            >
              <button
                className="toolbar-btn"
                onClick={() =>
                  setBaseFolders([
                    ...baseFolders,
                    {
                      id: `base-${Date.now()}`,
                      role: 'data',
                      path: 'C:\\',
                      label: '추가 베이스 폴더',
                      purpose: '폴더 목적 설명',
                      enabled: true,
                    },
                  ])
                }
              >
                + 베이스 폴더 추가
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="toolbar-btn"
                  onClick={() => setSettingsOpen(false)}
                >
                  취소
                </button>
                <button
                  className="toolbar-btn primary"
                  onClick={async () => {
                    await saveBaseFolders(baseFolders);
                    setSettingsOpen(false);
                    await refreshTree();
                  }}
                >
                  저장 및 트리 갱신
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 11. 새 프로젝트 생성 모달 */}
      {newDocModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setNewDocModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '480px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '12px' }}>
              {newDocRole === 'diary'
                ? `📅 새 일정 생성 (${newDocDate})`
                : '📁 새 프로젝트 폴더 생성 (Projects/{이름}/main.md)'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                autoFocus
                className="input-field"
                placeholder={
                  newDocRole === 'diary'
                    ? '일정 제목'
                    : '프로젝트 폴더명 (예: Webcel)'
                }
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateNewDocSubmit();
                }}
              />
              <select
                className="input-field"
                value={newDocTemplate}
                onChange={(e) => setNewDocTemplate(e.target.value)}
              >
                {vaultTemplates.map((tpl) => (
                  <option key={tpl.fileName} value={tpl.fileName}>
                    {tpl.fileName} — {tpl.description}
                  </option>
                ))}
              </select>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  marginTop: '8px',
                }}
              >
                <button
                  className="toolbar-btn"
                  onClick={() => setNewDocModalOpen(false)}
                >
                  취소
                </button>
                <button
                  className="toolbar-btn primary"
                  onClick={handleCreateNewDocSubmit}
                >
                  생성하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 12. 프로젝트 승격 모달 */}
      {promoteModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setPromoteModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '460px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '10px' }}>
              📁 프로젝트 폴더(`Projects/{'{이름}'}/main.md`)로 승격
            </h3>
            <input
              autoFocus
              className="input-field"
              value={promoteProjectName}
              onChange={(e) => setPromoteProjectName(e.target.value)}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '14px',
              }}
            >
              <button
                className="toolbar-btn"
                onClick={() => setPromoteModalOpen(false)}
              >
                취소
              </button>
              <button
                className="toolbar-btn primary"
                onClick={handlePromoteToProject}
              >
                승격 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 13. 볼트 템플릿 관리 모달 */}
      {templateModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setTemplateModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '680px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '10px' }}>
              📋 1번 프로젝트 볼트 템플릿 (`Projects\.myLore\templates`)
            </h3>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                maxHeight: '380px',
                overflowY: 'auto',
              }}
            >
              {vaultTemplates.map((tpl) => (
                <div
                  key={tpl.fileName}
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: '#a5b4fc' }}>
                      📄 {tpl.fileName}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      {tpl.description}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {currentDoc && (
                      <button
                        className="toolbar-btn primary"
                        onClick={() => {
                          insertIntoBody(tpl.bodyContent);
                          setTemplateModalOpen(false);
                        }}
                      >
                        + 현재 문서에 삽입
                      </button>
                    )}
                    <button
                      className="toolbar-btn"
                      onClick={async () => {
                        const doc = await readDocument(tpl.fullPath);
                        applyLoadedDocument(doc);
                        setTemplateModalOpen(false);
                      }}
                    >
                      ✏️ 템플릿 원본 편집
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
