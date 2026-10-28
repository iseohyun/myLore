import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import * as XLSX from 'xlsx';
import {
  BaseFolderConfig,
  BaseFolderRole,
  DocumentPayload,
  FileNode,
  FinanceTransaction,
  LifelogMessage,
  MediaInboxItem,
  OpenDocumentTab,
  ScanProgressPayload,
  SearchMatchItem,
  TaskPriorityCode,
  VaultTemplateItem,
} from './types/mylore';
import {
  createNewDocument,
  createTempMemo,
  DEFAULT_BASE_FOLDERS,
  getAllFinanceTransactions,
  getBaseFolders,
  getLifelogForDate,
  getScanProgress,
  getVaultTemplates,
  getVirtualTree,
  importFinanceRows,
  importKakaoChatText,
  moveDocumentToRole,
  openExternalUrlInChrome,
  openGoogleCalendarWeb,
  openInChromeAppMode,
  openNativeFileDialog,
  openNativeFolderDialog,
  openRootMainMd,
  parseNotificationIntoFinance,
  promoteToProjectFolder,
  readDocument,
  readDocumentByUuid,
  renameCurrentDocument,
  replaceInFiles,
  saveBaseFolders,
  saveDocument,
  searchInFiles,
  showInExplorer,
  startBatchUuidScan,
  toggleWindowFullscreen,
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
import { MarkdownPreviewRenderer } from './utils/markdownRenderer';

type ViewMode =
  | 'split'
  | 'editor'
  | 'preview'
  | 'dashboard_projects'
  | 'dashboard_diary'
  | 'dashboard_finance'
  | 'dashboard_lifelog';

type RightSidebarTab = 'tree' | 'search' | 'toc' | 'backlinks' | 'lifelog';
type PaletteMode = 'closed' | 'files' | 'commands';

export interface KeybindingConfig {
  id: string;
  category: string;
  label: string;
  shortcut: string;
}

const DEFAULT_KEYBINDINGS: KeybindingConfig[] = [
  { id: 'open_shortcuts', category: 'F1~F12 기능키', label: 'F1: 도움말 (단축키 설정)', shortcut: 'F1' },
  { id: 'rename_doc', category: 'F1~F12 기능키', label: 'F2: 현재 문서 제목 변경', shortcut: 'F2' },
  { id: 'list_prev', category: 'F1~F12 기능키', label: 'F3: 목록 이전 선택 (이전 파일 / 찾기 이전 위치)', shortcut: 'F3' },
  { id: 'list_next', category: 'F1~F12 기능키', label: 'F4: 목록 다음 선택 (다음 파일 / 찾기 다음 위치)', shortcut: 'F4' },
  { id: 'rescan_uuid', category: 'F1~F12 기능키', label: 'F5: UUID 재스캔', shortcut: 'F5' },
  { id: 'dashboard_projects', category: 'F1~F12 기능키', label: 'F6: 프로젝트 대시보드', shortcut: 'F6' },
  { id: 'sync_open_gcal', category: 'F1~F12 기능키', label: 'F7: 구글 캘린더 싱크 및 열기', shortcut: 'F7' },
  { id: 'dashboard_lifelog', category: 'F1~F12 기능키', label: 'F8: 라이프로그 수집 대쉬보드', shortcut: 'F8' },
  { id: 'run_program', category: 'F1~F12 기능키', label: 'F9: 프로그램 수행 (추후 업데이트 예정)', shortcut: 'F9' },
  { id: 'menu_toggle', category: 'F1~F12 기능키', label: 'F10: 메뉴 열기', shortcut: 'F10' },
  { id: 'toggle_fullscreen', category: 'F1~F12 기능키', label: 'F11: 전체 화면', shortcut: 'F11' },
  { id: 'devtools_info', category: 'F1~F12 기능키', label: 'F12: 개발자모드 (현행 유지)', shortcut: 'F12' },
  { id: 'save_doc', category: '파일', label: '저장', shortcut: 'Ctrl+S' },
  { id: 'open_file', category: '파일', label: '파일 열기', shortcut: 'Ctrl+O' },
  { id: 'open_folder', category: '파일', label: '폴더 열기', shortcut: 'Ctrl+Shift+O' },
  { id: 'new_memo', category: '파일', label: '새 메모 (프로젝트/임시)', shortcut: 'Ctrl+N' },
  { id: 'open_settings', category: '파일', label: '설정 열기', shortcut: 'Ctrl+,' },
  { id: 'undo', category: '편집', label: '실행 취소', shortcut: 'Ctrl+Z' },
  { id: 'redo', category: '편집', label: '다시 실행', shortcut: 'Ctrl+Y' },
  { id: 'cut', category: '편집', label: '잘라내기', shortcut: 'Ctrl+X' },
  { id: 'copy', category: '편집', label: '복사', shortcut: 'Ctrl+C' },
  { id: 'paste', category: '편집', label: '붙여넣기', shortcut: 'Ctrl+V' },
  { id: 'find_in_doc', category: '편집', label: '찾기', shortcut: 'Ctrl+F' },
  { id: 'replace_in_doc', category: '편집', label: '바꾸기', shortcut: 'Ctrl+H' },
  { id: 'find_in_files', category: '편집', label: '파일에서 찾기', shortcut: 'Ctrl+Shift+F' },
  { id: 'replace_in_files', category: '편집', label: '파일에서 바꾸기', shortcut: 'Ctrl+Shift+H' },
  { id: 'select_all', category: '선택', label: '모두 선택', shortcut: 'Ctrl+A' },
  { id: 'move_line_up', category: '선택', label: '줄 위로 이동', shortcut: 'Alt+ArrowUp' },
  { id: 'move_line_down', category: '선택', label: '줄 아래로 이동', shortcut: 'Alt+ArrowDown' },
  { id: 'add_cursor_up', category: '선택', label: '위에 커서 추가', shortcut: 'Ctrl+Alt+ArrowUp' },
  { id: 'add_cursor_down', category: '선택', label: '아래 커서 추가', shortcut: 'Ctrl+Alt+ArrowDown' },
  { id: 'command_palette', category: '보기', label: '명령어 팔레트 소환', shortcut: 'Ctrl+Shift+P' },
  { id: 'quick_open', category: '보기', label: '빠른 문서 열기', shortcut: 'Ctrl+P' },
  { id: 'toggle_sidebar', category: '보기', label: '우측 사이드바 접기/펼치기', shortcut: 'Ctrl+B' },
  { id: 'toggle_yaml', category: '보기', label: 'YAML 메타데이터 편집 토글', shortcut: 'Ctrl+;' },
  { id: 'next_file', category: '이동', label: '다음 파일로 이동', shortcut: 'Ctrl+Tab' },
  { id: 'prev_file', category: '이동', label: '이전 파일로 이동', shortcut: 'Ctrl+Shift+Tab' },
  { id: 'next_edit_pos', category: '이동', label: '다음 편집점으로 이동', shortcut: 'Alt+ArrowRight' },
  { id: 'prev_edit_pos', category: '이동', label: '이전 편집점으로 이동', shortcut: 'Alt+ArrowLeft' },
  { id: 'goto_line', category: '이동', label: '줄 이동', shortcut: 'Ctrl+G' },
  { id: 'goto_bracket', category: '이동', label: '괄호 이동', shortcut: 'Ctrl+Shift+\\' },
  { id: 'goto_bookmark', category: '이동', label: '북마크 이동', shortcut: 'Ctrl+F2' },
  { id: 'goto_main_md', category: '이동', label: 'main.md로 이동', shortcut: 'Alt+M' },
  { id: 'auto_format', category: '실행', label: '서브미션 Auto-Format 정렬', shortcut: 'Alt+Shift+F' },
];

export default function App() {
  const [baseFolders, setBaseFolders] =
    useState<BaseFolderConfig[]>(DEFAULT_BASE_FOLDERS);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeFilter, setTreeFilter] = useState('');

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

  const [isYamlVisible, setIsYamlVisible] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightSidebarTab>('tree');

  // 3선 메뉴(☰) 및 상단 메뉴바 상태, Alt 배지 상태
  const [menuBarExpanded, setMenuBarExpanded] = useState(true);
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

  // 편집점(커서) 히스토리 및 북마크 줄 목록
  const [editHistory, setEditHistory] = useState<Array<{ path: string; offset: number }>>([]);
  const [editHistoryIdx, setEditHistoryIdx] = useState<number>(-1);
  const [bookmarks, setBookmarks] = useState<Array<{ path: string; line: number }>>([]);
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0);

  // 모달 상태들
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);
  const [keybindings, setKeybindings] = useState<KeybindingConfig[]>(() => {
    const saved = localStorage.getItem('mylore_keybindings_v2');
    return saved ? JSON.parse(saved) : DEFAULT_KEYBINDINGS;
  });

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
    '준비 완료 — F1: 도움말(단축키) | F2: 제목변경 | F3/F4: 이전/다음 선택 | F5: UUID 재스캔 | F10: 메뉴 | F11: 전체화면 | F12: 개발자모드'
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

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

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

  // 자동 저장 (Auto-Save checked 시 1.2초 디바운스 자동 저장)
  useEffect(() => {
    if (!autoSaveEnabled || !activeTab || !activeTab.isDirty) return;
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

  // 초기 로드 및 Tauri 실시간 스캔 프로그레스 이벤트 리스너 등록
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    (async () => {
      try {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          unlistenFn = await listen<ScanProgressPayload>(
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
        }
        const folders = await getBaseFolders();
        setBaseFolders(folders);
        await refreshTree();
        await refreshFinanceData();
        const tpls = await getVaultTemplates();
        setVaultTemplates(tpls);
        const initialProg = await getScanProgress();
        if (initialProg.totalFiles > 0) {
          setScanProgress(initialProg);
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

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
    if (
      viewMode.startsWith('dashboard_')
    ) {
      setViewMode('split');
    }
    setStatusMessage(`열람 중: ${doc.relativePath}`);

    if (jumpTo) {
      setTimeout(() => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        let targetStart = jumpTo.charOffset ?? 0;
        let targetEnd = targetStart + (jumpTo.highlightLength || 0);
        if (jumpTo.lineNumber && jumpTo.charOffset === undefined) {
          const lines = split.body.split('\n');
          const lineIdx = Math.max(
            0,
            Math.min(lines.length - 1, jumpTo.lineNumber - 1)
          );
          targetStart = lines
            .slice(0, lineIdx)
            .reduce((acc, l) => acc + l.length + 1, 0);
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

  const openDocumentByNode = async (node: FileNode) => {
    if (node.isDir) return;
    try {
      const doc = await readDocument(node.fullPath);
      applyLoadedDocument(doc);
    } catch (err) {
      setStatusMessage(`문서 열기 오류: ${String(err)}`);
    }
  };

  const closeTab = (fullPath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t.doc.fullPath !== fullPath);
      if (activeTabPath === fullPath) {
        const last = next[next.length - 1];
        setActiveTabPath(last ? last.doc.fullPath : null);
      }
      return next;
    });
  };

  const handleSaveCurrentDoc = async () => {
    if (!currentDoc) return;
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

  // 이동 > 이전/다음 편집점으로 이동
  const handleMoveEditPoint = (dir: 1 | -1) => {
    if (editHistory.length === 0) {
      setStatusMessage('기록된 편집점 히스토리가 아직 없습니다.');
      return;
    }
    const nextIdx = Math.max(
      0,
      Math.min(editHistory.length - 1, editHistoryIdx + dir)
    );
    setEditHistoryIdx(nextIdx);
    const item = editHistory[nextIdx];
    const tab = openTabs.find((t) => t.doc.fullPath === item.path);
    if (tab) {
      setActiveTabPath(tab.doc.fullPath);
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.focus();
          editorRef.current.setSelectionRange(item.offset, item.offset);
        }
      }, 40);
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
      if (recordingShortcutId) {
        e.preventDefault();
        e.stopPropagation();
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        const combo = normalizeKeyEvent(e);
        const updated = keybindings.map((kb) =>
          kb.id === recordingShortcutId ? { ...kb, shortcut: combo } : kb
        );
        setKeybindings(updated);
        localStorage.setItem('mylore_keybindings_v2', JSON.stringify(updated));
        setRecordingShortcutId(null);
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
      const matchKb = (id: string) =>
        getShortcutLabel(id).toLowerCase() === pressed.toLowerCase();

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
        // F6: 프로젝트 대시보드
        e.preventDefault();
        setViewMode('dashboard_projects');
      } else if (matchKb('sync_open_gcal')) {
        // F7: 구글 캘린더 싱크 및 열기
        e.preventDefault();
        handleSyncAndOpenGoogleCalendar();
      } else if (matchKb('dashboard_lifelog')) {
        // F8: 라이프로그 수집 대쉬보드
        e.preventDefault();
        setViewMode('dashboard_lifelog');
      } else if (matchKb('run_program')) {
        // F9: 프로그램 수행 (추후 업데이트 예정)
        e.preventDefault();
        handleRunProgramPlaceholder();
      } else if (matchKb('menu_toggle')) {
        // F10: 메뉴 열기
        e.preventDefault();
        setMenuBarExpanded(true);
        setActiveMenu((prev) => (prev ? null : 'file'));
      } else if (matchKb('toggle_fullscreen')) {
        // F11: 전체 화면
        e.preventDefault();
        handleToggleFullscreen();
      } else if (matchKb('save_doc')) {
        e.preventDefault();
        handleSaveCurrentDoc();
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
        setSettingsOpen(true);
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
      } else if (matchKb('next_edit_pos')) {
        e.preventDefault();
        handleMoveEditPoint(1);
      } else if (matchKb('prev_edit_pos')) {
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
      } else if (e.key === 'Escape') {
        setPaletteMode('closed');
        setActiveMenu(null);
        setActiveSubMenu(null);
        setContextMenu(null);
        setFindBarMode('closed');
        setRenameModalOpen(false);
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
    recordingShortcutId,
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
      id: 'cmd-settings',
      label: '파일: 베이스 폴더 설정',
      shortcut: getShortcutLabel('open_settings'),
      action: () => setSettingsOpen(true),
    },
  ];

  return (
    <div
      className="mylore-app"
      onClick={() => {
        setActiveMenu(null);
        setActiveSubMenu(null);
        setContextMenu(null);
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
                        setAutoSaveEnabled((v) => !v);
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
                        setSettingsOpen(true);
                      }}
                    >
                      <span>설정</span>
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
                        setViewMode('split');
                      }}
                    >
                      <span>분할 화면 (에디터 + 뷰어)</span>
                      <span className="menu-item-shortcut">
                        {viewMode === 'split' ? '✓' : ''}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setViewMode('editor');
                      }}
                    >
                      <span>에디터 전용 모드</span>
                      <span className="menu-item-shortcut">
                        {viewMode === 'editor' ? '✓' : ''}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setViewMode('preview');
                      }}
                    >
                      <span>뷰어 전용 모드</span>
                      <span className="menu-item-shortcut">
                        {viewMode === 'preview' ? '✓' : ''}
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
                        setViewMode('dashboard_projects');
                      }}
                    >
                      <span>프로젝트 대시보드</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('dashboard_projects')}
                      </span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setViewMode('dashboard_diary');
                      }}
                    >
                      <span>다이어리 대시보드</span>
                      <span className="menu-item-shortcut">Diary</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setViewMode('dashboard_finance');
                      }}
                    >
                      <span>가계부 대시보드</span>
                      <span className="menu-item-shortcut">Finance</span>
                    </button>
                    <button
                      className="menu-item"
                      onClick={() => {
                        setActiveMenu(null);
                        setViewMode('dashboard_lifelog');
                      }}
                    >
                      <span>라이프로그 수집 대쉬보드</span>
                      <span className="menu-item-shortcut">
                        {getShortcutLabel('dashboard_lifelog')}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 다중 문서 탭 바 (열린 문서들을 탭으로 구분하고 현재 열린 문서를 하이라이트 표시) */}
        <div className="doc-tabs-bar">
          {openTabs.map((tab) => {
            const isActive =
              tab.doc.fullPath === activeTabPath &&
              !viewMode.startsWith('dashboard_');
            const tabTitle =
              tab.doc.frontmatter['summary'] ||
              tab.doc.frontmatter['title'] ||
              tab.doc.relativePath.split(/[\\/]/).pop() ||
              tab.doc.relativePath;
            return (
              <div
                key={tab.doc.fullPath}
                className={`doc-tab ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveTabPath(tab.doc.fullPath);
                  if (viewMode.startsWith('dashboard_')) {
                    setViewMode('split');
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    targetPath: tab.doc.fullPath,
                    targetUuid: tab.doc.uuid,
                    targetName: tabTitle,
                  });
                }}
                title={`${tab.doc.fullPath} (우클릭: 탐색기에서 보기)`}
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
      </header>

      {/* 2. 메인 바디 영역 */}
      <div className="workspace-body">
        <main className="main-stage">
          {viewMode === 'dashboard_projects' ? (
            /* 대쉬보드 > 프로젝트 */
            <div className="finance-workspace">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>
                    📁 프로젝트 대쉬보드 (`Projects` 폴더별 `main.md` 현황)
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    모든 프로젝트 폴더의 `main.md` 및 임시 메모(`Projects/임시`)를 한눈에 관리합니다.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="toolbar-btn primary"
                    onClick={handleGotoRootMainMd}
                  >
                    ⭐ 루트 main.md 열기
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={() => setViewMode('split')}
                  >
                    ← 에디터로 돌아가기
                  </button>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>프로젝트 / 문서 경로</th>
                    <th>제목</th>
                    <th>UUID</th>
                    <th>동작</th>
                  </tr>
                </thead>
                <tbody>
                  {flattenedFiles
                    .filter((f) => f.role === 'projects')
                    .map((f) => (
                      <tr key={f.fullPath}>
                        <td style={{ fontWeight: 700 }}>
                          {f.name === 'main.md' ? '⭐ ' : '📄 '}
                          {f.relativePath}
                        </td>
                        <td>{f.title || f.name}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                          {f.uuid ? f.uuid.slice(0, 8) : '-'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              className="toolbar-btn primary"
                              onClick={() => openDocumentByNode(f)}
                            >
                              열기
                            </button>
                            <button
                              className="toolbar-btn"
                              onClick={() => showInExplorer(f.fullPath)}
                            >
                              탐색기에서 보기
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : viewMode === 'dashboard_diary' ? (
            /* 대쉬보드 > 다이어리 (달력 UI + 일정 생성/열람) */
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
                    📅 다이어리 달력 대쉬보드 ({calendarYearMonth.year}년 {calendarYearMonth.month}월)
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
                <button
                  className="toolbar-btn"
                  onClick={() => setViewMode('split')}
                >
                  ← 에디터로 돌아가기
                </button>
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
          ) : viewMode === 'dashboard_finance' ||
            viewMode === 'dashboard_lifelog' ? (
            /* 대쉬보드 > 가계부 / 라이프로그 */
            <div className="finance-workspace">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: 700 }}>
                    {viewMode === 'dashboard_finance'
                      ? '💳 가계부 대쉬보드 (은행·카드 3단계 자동화 & 누적 내역)'
                      : '📱 라이프로그 대쉬보드 (카카오톡 Chats 백업·문자·사진 통합)'}
                  </h2>
                </div>
                <button
                  className="toolbar-btn"
                  onClick={() => setViewMode('split')}
                >
                  ← 문서 에디터로 돌아가기
                </button>
              </div>

              {reconcileResultMsg && (
                <div
                  style={{
                    padding: '12px 16px',
                    backgroundColor: 'var(--accent-soft)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    color: '#e0e7ff',
                    fontWeight: 600,
                  }}
                >
                  {reconcileResultMsg}
                </div>
              )}

              <div className="stage-grid">
                <div className="stage-card">
                  <div className="stage-card-title">
                    <span className="stage-step-badge">1단계 (개입 0%)</span>
                    <span>실시간 카드/은행 알림 & 카톡 백업 수신</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                      className="input-field"
                      value={simNotiTitle}
                      onChange={(e) => setSimNotiTitle(e.target.value)}
                      placeholder="알림 제목"
                    />
                    <input
                      className="input-field"
                      value={simNotiText}
                      onChange={(e) => setSimNotiText(e.target.value)}
                      placeholder="알림 본문"
                    />
                    <button
                      className="toolbar-btn primary"
                      onClick={handleSimulateRealtimeNotification}
                    >
                      ⚡ 1단계: 실시간 알림 파싱 & DB 적재
                    </button>
                  </div>
                  <div
                    style={{
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '8px',
                      marginTop: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <input
                      className="input-field"
                      value={simKakaoRoom}
                      onChange={(e) => setSimKakaoRoom(e.target.value)}
                    />
                    <textarea
                      className="input-field"
                      rows={3}
                      value={simKakaoRaw}
                      onChange={(e) => setSimKakaoRaw(e.target.value)}
                    />
                    <button
                      className="toolbar-btn"
                      onClick={handleImportKakaoSample}
                    >
                      💬 카톡 대화 파싱 & DB 적재
                    </button>
                  </div>
                </div>

                <div className="stage-card">
                  <div className="stage-card-title">
                    <span className="stage-step-badge">2단계 (보안 우회)</span>
                    <span>PC 은행 빠른조회 & 카드사 런처</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                    <button
                      className="toolbar-btn"
                      onClick={() =>
                        openExternalUrlInChrome(
                          'https://obank.kbstar.com/quics?page=C025255'
                        )
                      }
                    >
                      🏦 KB국민은행 빠른조회 (Chrome)
                    </button>
                    <button
                      className="toolbar-btn"
                      onClick={() =>
                        openExternalUrlInChrome(
                          'https://bank.shinhan.com/index.jsp#010101100000'
                        )
                      }
                    >
                      🏦 신한은행 간편조회 (Chrome)
                    </button>
                    <button
                      className="toolbar-btn"
                      onClick={() =>
                        openExternalUrlInChrome(
                          'https://www.shinhancard.com/pconts/html/myPage/useList/MOBFM001/MOBFM001R01.html'
                        )
                      }
                    >
                      💳 카드사 명세서(.xlsx) 다운로드 (Chrome)
                    </button>
                  </div>
                </div>

                <div className="stage-card">
                  <div className="stage-card-title">
                    <span className="stage-step-badge">3단계 (중복 대조)</span>
                    <span>엑셀(.xlsx/.csv) 비교 & 신규 내역 누적 적재</span>
                  </div>
                  <input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={handleExcelUpload}
                  />
                  <button
                    className="toolbar-btn primary"
                    style={{ padding: '12px', justifyContent: 'center', marginTop: '8px' }}
                    onClick={() => excelInputRef.current?.click()}
                  >
                    📊 엑셀(.xlsx/.csv) 파일 선택하여 대조·적재 실행
                  </button>
                </div>
              </div>

              <h3 style={{ marginBottom: '10px', fontSize: '15px' }}>
                🗄️ 금융 거래내역 통합 테이블 (`finance_transactions` — 총 {allTransactions.length}건)
              </h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>상태</th>
                    <th>거래일시</th>
                    <th>금융사</th>
                    <th>가맹점</th>
                    <th>금액</th>
                    <th>분류</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {allTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td>
                        <span className={`verify-badge ${tx.verifyStatus}`}>
                          {tx.verifyStatus}
                        </span>
                      </td>
                      <td>
                        {tx.txDate} {tx.txTime}
                      </td>
                      <td>{tx.institution}</td>
                      <td style={{ fontWeight: 600 }}>{tx.merchant}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {tx.amount.toLocaleString()}원
                      </td>
                      <td>{tx.category}</td>
                      <td>{tx.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

              {/* 마크다운 에디터 & 라이브 뷰어 */}
              <div className="editor-split-container">
                {(viewMode === 'split' || viewMode === 'editor') && (
                  <div className="markdown-editor-pane">
                    <textarea
                      ref={editorRef}
                      className="markdown-textarea"
                      value={bodyText}
                      onChange={(e) => {
                        const offset = e.target.selectionStart;
                        setBodyText(e.target.value);
                        if (currentDoc) {
                          setEditHistory((prev) => [
                            ...prev.slice(-30),
                            { path: currentDoc.fullPath, offset },
                          ]);
                          setEditHistoryIdx((prev) => Math.min(30, prev + 1));
                        }
                      }}
                      placeholder="여기에 마크다운 본문을 작성하세요..."
                    />
                  </div>
                )}

                {(viewMode === 'split' || viewMode === 'preview') && (
                  <div className="markdown-preview-pane rendered-md">
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
                    />

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

        {/* 3. 우측 접이식 사이드바 (아이콘만 표시: 📂 파일트리, 🔍 검색, 📑 TOC, 🔗 백링크, 📱 라이프로그) */}
        <aside
          className={`right-sidebar ${rightSidebarOpen ? '' : 'collapsed'}`}
        >
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${rightTab === 'tree' ? 'active' : ''}`}
              onClick={() => setRightTab('tree')}
              title="파일 트리 (우클릭: 탐색기에서 보기)"
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

                {(['projects', 'diary', 'data'] as BaseFolderRole[]).map(
                  (roleKey) => {
                    const roleLabel =
                      roleKey === 'projects'
                        ? '📁 프로젝트 (Projects)'
                        : roleKey === 'diary'
                          ? '📅 일기 (Diary)'
                          : '🗄️ 데이터 (Data)';
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

                    return (
                      <div key={roleKey} className="tree-group-section">
                        <div className="tree-group-header">
                          <span>{roleLabel}</span>
                          <span>{roleFiles.length}</span>
                        </div>
                        {roleFiles.slice(0, 100).map((node) => (
                          <div
                            key={node.fullPath}
                            className={`tree-node-row ${
                              currentDoc?.fullPath === node.fullPath
                                ? 'active'
                                : ''
                            }`}
                            onClick={() => openDocumentByNode(node)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                targetPath: node.fullPath,
                                targetUuid: node.uuid,
                                targetName: node.relativePath,
                              });
                            }}
                            title={`${node.fullPath}\n(우클릭: 탐색기에서 보기)`}
                          >
                            <div className="tree-node-label">
                              <span>
                                {node.name === 'main.md' ? '⭐' : '📄'}
                              </span>
                              <span>{node.relativePath}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  }
                )}
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
        </aside>
      </div>

      {/* 4. 하단 상태 표시줄 및 실시간 UUID 스캔 프로그레스 바 */}
      <footer className="statusbar">
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

        <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
          <span>자동저장: {autoSaveEnabled ? 'ON' : 'OFF'}</span>
          <span>포트: 18443</span>
        </div>
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

      {/* 8. F1 도움말 (단축키 설정 변경) 모달 */}
      {shortcutsModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setRecordingShortcutId(null);
            setShortcutsModalOpen(false);
          }}
        >
          <div
            className="palette-box"
            style={{ width: '680px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
              }}
            >
              <h3 style={{ fontSize: '16px' }}>
                ⌨️ 도움말 — 단축키 설정 변경 (`F1` 또는 `파일 &gt; 도움말 (단축키 설정)`)
              </h3>
              <button
                className="toolbar-btn"
                onClick={() => {
                  setKeybindings(DEFAULT_KEYBINDINGS);
                  localStorage.setItem(
                    'mylore_keybindings_v2',
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
                marginBottom: '12px',
              }}
            >
              변경하려는 항목의 우측 단축키 버튼을 클릭한 뒤 원하는 키 조합을 누르면 즉시 반영됩니다. (`F12`는 개발자모드로 현행 유지됩니다.)
            </p>
            <div
              style={{
                maxHeight: '400px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {keybindings.map((kb) => (
                <div
                  key={kb.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#a5b4fc',
                        marginRight: '8px',
                        fontWeight: 700,
                      }}
                    >
                      [{kb.category}]
                    </span>
                    <span>{kb.label}</span>
                  </div>
                  <button
                    className={`toolbar-btn ${
                      recordingShortcutId === kb.id ? 'primary' : ''
                    }`}
                    disabled={kb.id === 'devtools_info'}
                    onClick={() => {
                      if (kb.id !== 'devtools_info') {
                        setRecordingShortcutId(kb.id);
                      }
                    }}
                  >
                    {recordingShortcutId === kb.id
                      ? '키 조합을 누르세요...'
                      : kb.shortcut}
                  </button>
                </div>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '14px',
              }}
            >
              <button
                className="toolbar-btn"
                onClick={() => {
                  setRecordingShortcutId(null);
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
                  <div style={{ display: 'flex', gap: '8px' }}>
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
                    </select>
                    <input
                      className="input-field"
                      value={bf.path}
                      onChange={(e) => {
                        const next = [...baseFolders];
                        next[idx].path = e.target.value;
                        setBaseFolders(next);
                      }}
                    />
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
