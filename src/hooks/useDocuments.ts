/**
 * @file useDocuments.ts
 * @description 열린 문서 탭(MRU), 1.2초 디바운스 자동 저장, 세션 저장, 문서/대시보드 탭 열기·닫기·저장, 편집점 이력(`recordEditPosition`) 관리 훅.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  BaseFolderConfig,
  DocumentPayload,
  FileNode,
  OpenDocumentTab,
  ScanProgressPayload,
  ViewMode,
} from '../types/mylore';
import {
  createTempMemo,
  openNativeFileDialog,
  openNativeFolderDialog,
  readDocument,
  readDocumentByUuid,
  saveBaseFolders,
  saveDocument,
  startBatchUuidScan,
  syncGoogleCalendarEvents,
} from '../services/tauriClient';
import {
  autoFormatMarkdownTasks,
  combineYamlAndBody,
  splitYamlFrontmatter,
  syncProjectSubmissionTableProgress,
} from '../utils/markdownAutoFormat';

export interface UseDocumentsParams {
  openTabs: OpenDocumentTab[];
  setOpenTabs: React.Dispatch<React.SetStateAction<OpenDocumentTab[]>>;
  activeTabPath: string | null;
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  activeTab: OpenDocumentTab | null;
  currentDoc: DocumentPayload | null;
  yamlText: string;
  bodyText: string;
  setBodyText: (updater: string | ((prev: string) => string)) => void;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  editorRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  baseFolders: BaseFolderConfig[];
  setBaseFolders: React.Dispatch<React.SetStateAction<BaseFolderConfig[]>>;
  flattenedFiles?: FileNode[];
  calendarYearMonth?: { year: number; month: number };
  refreshTree: () => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function useDocuments({
  openTabs,
  setOpenTabs,
  activeTabPath,
  setActiveTabPath,
  activeTab,
  currentDoc,
  yamlText,
  bodyText,
  setBodyText,
  viewMode,
  setViewMode,
  editorRef,
  baseFolders,
  setBaseFolders,
  flattenedFiles = [],
  calendarYearMonth,
  refreshTree,
  setStatusMessage,
}: UseDocumentsParams) {
  const [tabAccessHistory, setTabAccessHistory] = useState<string[]>([]);
  const tabAccessHistoryRef = useRef<string[]>([]);
  const isSessionRestoredRef = useRef<boolean>(false);
  const docTabsBarRef = useRef<HTMLDivElement | null>(null);

  // 편집점(커서/문서 이동) 히스토리 (Alt+ArrowLeft / Alt+ArrowRight 지원)
  const editHistoryRef = useRef<Array<{ path: string; offset: number }>>([]);
  const editHistoryIdxRef = useRef<number>(-1);
  const isNavigatingEditHistoryRef = useRef<boolean>(false);

  const [isYamlVisible, setIsYamlVisible] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [scanProgress, setScanProgress] =
    useState<ScanProgressPayload | null>(null);

  // 활성 탭이 변경될 때마다 MRU(가장 마지막에 엑세스된 파일/대쉬보드) 히스토리 갱신
  useEffect(() => {
    if (!activeTabPath) return;
    setTabAccessHistory((prev) => {
      const next = [...prev.filter((p) => p !== activeTabPath), activeTabPath];
      tabAccessHistoryRef.current = next;
      return next;
    });
  }, [activeTabPath]);

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
        base[base.length - 1] = { path, offset };
        editHistoryRef.current = base;
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
  }, [
    autoSaveEnabled,
    activeTab?.bodyText,
    activeTab?.yamlText,
    activeTab?.isDirty,
  ]);

  const applyLoadedDocument = (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
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
        const beforeText = split.body.slice(0, targetStart);
        const lineCount = beforeText.split('\n').length;
        const lineHeight = 23.8;
        editorRef.current.scrollTop = Math.max(0, (lineCount - 5) * lineHeight);
      }, 60);
    }
  };

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

  const buildVirtualDashboardTab = (
    fullPath: string
  ): OpenDocumentTab | null => {
    const dashType = fullPath.replace('mylore://dashboard/', '') as
      | 'lifelog'
      | 'finance'
      | 'diary'
      | 'settings'
      | 'logs';
    const titleMap: Record<
      'lifelog' | 'finance' | 'diary' | 'settings' | 'logs',
      string
    > = {
      lifelog: '📱 라이프로그',
      finance: '💳 금융',
      diary: '📅 일정',
      settings: '⚙️ 설정',
      logs: '📋 로그 기록',
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

  // 대쉬보드도 일반 .md 문서와 동일하게 상단 탭(.doc-tabs-bar)에 추가하여 열기
  const openDashboardTab = (
    dashType: 'lifelog' | 'finance' | 'diary' | 'settings' | 'logs'
  ) => {
    const fullPath = `mylore://dashboard/${dashType}`;
    const titleMap: Record<typeof dashType, string> = {
      lifelog: '📱 라이프로그',
      finance: '💳 금융',
      diary: '📅 일정',
      settings: '⚙️ 설정',
      logs: '📋 로그 기록',
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

  const handleAutoFormatTasks = async () => {
    if (!currentDoc) return;
    const formatted = autoFormatMarkdownTasks(bodyText);
    const { nextBody, updatedCount } = await syncProjectSubmissionTableProgress(
      formatted,
      currentDoc.fullPath,
      flattenedFiles,
      readDocument,
      readDocumentByUuid
    );
    setBodyText(nextBody);
    if (updatedCount > 0) {
      setStatusMessage(
        `⚡ 서브 미션 Auto-Format 및 진행율 자동 갱신 완료 (하위 미션 ${updatedCount}건의 수행 개수·성공률 반영)`
      );
    } else {
      setStatusMessage(
        '⚡ 서브 미션 Auto-Format 적용 완료 ([!] 핵심 → [/] 진행중 → [ ] 대기 → [-] 보류 → [x] 완료 순 재배치)'
      );
    }
  };

  const handleRunBatchUuidScan = async () => {
    if (activeTabPath === 'mylore://dashboard/diary') {
      setStatusMessage(
        `🔄 [F5] 구글 캘린더 일정 동기화 중 (${calendarYearMonth?.year || ''}년 ${calendarYearMonth?.month || ''}월)...`
      );
      try {
        const res = await syncGoogleCalendarEvents(
          calendarYearMonth?.year,
          calendarYearMonth?.month
        );
        await refreshTree();
        setStatusMessage(res.message);
      } catch (err) {
        setStatusMessage(`구글 캘린더 동기화 오류: ${String(err)}`);
      }
      return;
    }

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

  return {
    tabAccessHistory,
    setTabAccessHistory,
    tabAccessHistoryRef,
    isSessionRestoredRef,
    docTabsBarRef,
    editHistoryRef,
    editHistoryIdxRef,
    isNavigatingEditHistoryRef,
    recordEditPosition,
    isYamlVisible,
    setIsYamlVisible,
    autoSaveEnabled,
    setAutoSaveEnabled,
    scanProgress,
    setScanProgress,
    applyLoadedDocument,
    openCliFilesInEditorMode,
    buildVirtualDashboardTab,
    openDashboardTab,
    openDocumentByNode,
    closeTab,
    handleSaveCurrentDoc,
    handleAutoFormatTasks,
    handleRunBatchUuidScan,
    handleCreateTempMemo,
    handleOpenNativeFile,
    handleOpenNativeFolder,
  };
}
