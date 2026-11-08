/**
 * @file useDocuments.ts
 * @description 열린 문서 탭(MRU), 1.2초 디바운스 자동 저장, 세션 저장, 문서/대시보드 탭 열기·닫기·저장, 편집점 이력(`recordEditPosition`) 관리 훅.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  BaseFolderConfig,
  DashboardTabType,
  DocumentPayload,
  FileNode,
  FileOpenPanePolicy,
  LinkOpenPanePolicy,
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
  defaultFileOpenPane?: FileOpenPanePolicy;
  linkOpenPane?: LinkOpenPanePolicy;
  refreshTree: () => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

const DASHBOARD_TITLE_MAP: Record<DashboardTabType, string> = {
  logs: '✅ 결제',
  call: '📞 통화',
  sms: '✉️ 문자',
  kakaotalk: '💬 카톡',
  recording: '🎙️ 녹음',
  media: '🖼️ 사진',
  contacts: '📇 연락처',
  pc_log: '💻 PC로그',
  notification: '📱 M로그',
  health: '❤️ 헬스',
  location: '📍 GPS',
  finance: '💳 finance',
  diary: '📅 Diary',
  settings: '⚙️ 설정',
  login: '🔐 로그인',
  help: '⌨️ 단축키',
  lifelog: '📞 통화',
};

export function useDocuments({
  openTabs,
  setOpenTabs,
  activeTabPath,
  setActiveTabPath,
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
  defaultFileOpenPane = 'left',
  linkOpenPane = 'unfocused',
  refreshTree,
  setStatusMessage,
}: UseDocumentsParams) {
  const [tabAccessHistory, setTabAccessHistory] = useState<string[]>([]);
  const tabAccessHistoryRef = useRef<string[]>([]);
  const isSessionRestoredRef = useRef<boolean>(false);
  const docTabsBarRef = useRef<HTMLDivElement | null>(null);

  // 편집점(커서/문서 이동) 히스토리 (Alt+ArrowLeft / Alt+ArrowRight 지원) 및 문서별 마지막 커서 위치 기억
  const editHistoryRef = useRef<Array<{ path: string; offset: number }>>([]);
  const editHistoryIdxRef = useRef<number>(-1);
  const isNavigatingEditHistoryRef = useRef<boolean>(false);
  const lastCursorOffsetByPathRef = useRef<Record<string, number>>({});

  // 문서 전환(Ctrl+Tab, 탭 클릭, 좌/우 분할 이동 등) 시 해당 문서의 마지막 편집점(커서 위치)으로 복원
  const restoreEditorCursorToLastPos = (targetPath: string) => {
    if (!targetPath || targetPath.startsWith('mylore://dashboard/')) return;
    let savedOffset = lastCursorOffsetByPathRef.current[targetPath];
    if (savedOffset === undefined) {
      const hist = editHistoryRef.current;
      for (let i = hist.length - 1; i >= 0; i--) {
        if (hist[i].path === targetPath) {
          savedOffset = hist[i].offset;
          break;
        }
      }
    }
    const finalOffset = savedOffset ?? 0;
    setTimeout(() => {
      const ta = editorRef.current;
      if (!ta) return;
      ta.focus();
      const clamped = Math.max(0, Math.min(ta.value.length, finalOffset));
      try {
        ta.setSelectionRange(clamped, clamped);
      } catch {
        // ignore
      }
      const beforeText = ta.value.slice(0, clamped);
      const lineCount = beforeText.split('\n').length;
      const lineHeight = 23.8;
      const approxTop = Math.max(0, (lineCount - 5) * lineHeight);
      if (
        approxTop < ta.scrollTop ||
        approxTop > ta.scrollTop + Math.max(80, ta.clientHeight - 80)
      ) {
        ta.scrollTop = approxTop;
      }
    }, 25);
  };

  const [isYamlVisible, setIsYamlVisible] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [scanProgress, setScanProgress] =
    useState<ScanProgressPayload | null>(null);

  // 에디터 수평 분할(Ctrl+\) 및 좌/우 에디터 문서 이동(Ctrl+Alt+←/→) 상태
  const [isHorizontalSplitOpen, setIsHorizontalSplitOpen] = useState(false);
  const [focusedEditorPane, setFocusedEditorPane] = useState<'left' | 'right'>('left');
  const [leftPaneTabPath, setLeftPaneTabPath] = useState<string | null>(null);
  const [rightPaneTabPath, setRightPaneTabPath] = useState<string | null>(null);
  const [rightPaneTabPaths, setRightPaneTabPaths] = useState<string[]>([]);
  const [leftPaneViewMode, setLeftPaneViewMode] = useState<'editor' | 'split' | 'preview'>('editor');
  const [rightPaneViewMode, setRightPaneViewMode] = useState<'editor' | 'split' | 'preview'>('editor');
  const [horizontalSplitRatio, setHorizontalSplitRatio] = useState<number>(50);

  // Ctrl+E : 뷰어 토글 (1단: editor -> preview -> split 순환 | 2단: 포커스 페인의 editor <-> preview 토글)
  const handleCycleViewerMode = () => {
    if (!isHorizontalSplitOpen) {
      const cur: 'editor' | 'preview' | 'split' =
        viewMode === 'editor' || viewMode === 'preview' || viewMode === 'split' ? viewMode : 'split';
      const next: 'editor' | 'preview' | 'split' =
        cur === 'editor' ? 'preview' : cur === 'preview' ? 'split' : 'editor';
      setViewMode(next);
      const labelMap = {
        editor: '✏️ 에디터 전용 모드',
        preview: '👁️ 뷰어 전용 모드',
        split: '◫ 스플릿(병렬) 모드',
      };
      setStatusMessage(`${labelMap[next]}로 전환되었습니다 (Ctrl+E)`);
    } else if (focusedEditorPane === 'right') {
      const next: 'editor' | 'preview' = rightPaneViewMode === 'editor' ? 'preview' : 'editor';
      setRightPaneViewMode(next);
      setStatusMessage(`[오른쪽 에디터] ${next === 'preview' ? '👁️ 뷰어 모드' : '✏️ 에디터 모드'}로 전환되었습니다 (Ctrl+E)`);
    } else {
      const next: 'editor' | 'preview' = leftPaneViewMode === 'editor' ? 'preview' : 'editor';
      setLeftPaneViewMode(next);
      setStatusMessage(`[왼쪽 에디터] ${next === 'preview' ? '👁️ 뷰어 모드' : '✏️ 에디터 모드'}로 전환되었습니다 (Ctrl+E)`);
    }
  };

  // activeTabPath가 변경될 때 해당 문서/대시보드가 속한 페인(rightPaneTabPaths 포함 여부)에 맞춰 활성 탭 경로 동기화
  useEffect(() => {
    if (!activeTabPath) return;
    if (!isHorizontalSplitOpen) {
      setLeftPaneTabPath(activeTabPath);
      return;
    }
    if (rightPaneTabPaths.includes(activeTabPath)) {
      setRightPaneTabPath(activeTabPath);
      if (leftPaneTabPath !== activeTabPath) setFocusedEditorPane('right');
    } else {
      setLeftPaneTabPath(activeTabPath);
      setFocusedEditorPane('left');
    }
  }, [activeTabPath, isHorizontalSplitOpen]);

  // 분할 시 기본 파일 열림 위치(defaultFileOpenPane) 및 링크 열림 위치(linkOpenPane)에 따라 좌/우 페인 배정
  const assignTabToSplitPane = (fullPath: string, openAsLink?: boolean) => {
    if (!isHorizontalSplitOpen) {
      setLeftPaneTabPath(fullPath);
      setActiveTabPath(fullPath);
      return;
    }
    let targetPane: 'left' | 'right' = 'left';
    if (openAsLink) {
      if (linkOpenPane === 'left') targetPane = 'left';
      else if (linkOpenPane === 'right') targetPane = 'right';
      else if (linkOpenPane === 'focused') targetPane = focusedEditorPane;
      else targetPane = focusedEditorPane === 'left' ? 'right' : 'left';
    } else {
      if (defaultFileOpenPane === 'right') targetPane = 'right';
      else if (defaultFileOpenPane === 'focused') targetPane = focusedEditorPane;
      else targetPane = 'left';
    }

    if (targetPane === 'right') {
      setRightPaneTabPaths((prev) =>
        prev.includes(fullPath) ? prev : [...prev, fullPath]
      );
      setRightPaneTabPath(fullPath);
      setFocusedEditorPane('right');
    } else {
      setRightPaneTabPaths((prev) => {
        if (!prev.includes(fullPath)) return prev;
        const filtered = prev.filter((p) => p !== fullPath);
        return filtered.length > 0 ? filtered : prev;
      });
      setLeftPaneTabPath(fullPath);
      setFocusedEditorPane('left');
    }
    setActiveTabPath(fullPath);
  };

  const focusEditorPane = (pane: 'left' | 'right', targetPath?: string) => {
    if (!isHorizontalSplitOpen) {
      editorRef.current?.focus();
      setStatusMessage('현재 단일 편집 화면입니다 (Ctrl+\\ 로 2단 수평 분할 가능)');
      return;
    }
    if (activeTabPath && !activeTabPath.startsWith('mylore://dashboard/') && editorRef.current) {
      lastCursorOffsetByPathRef.current[activeTabPath] = editorRef.current.selectionStart;
    }
    setFocusedEditorPane(pane);
    const nextPath = targetPath ?? (pane === 'right' ? rightPaneTabPath : leftPaneTabPath);
    if (nextPath && openTabs.some((t) => t.doc.fullPath === nextPath)) {
      setActiveTabPath(nextPath);
      restoreEditorCursorToLastPos(nextPath);
    } else {
      window.setTimeout(() => {
        editorRef.current?.focus();
      }, 25);
    }
    setStatusMessage(
      pane === 'left'
        ? '⬅️ 왼쪽 분할 편집기로 포커스 이동 (Alt+←)'
        : '➡️ 오른쪽 분할 편집기로 포커스 이동 (Alt+→)'
    );
  };

  // Ctrl+\ : 에디터 수평 분할 토글 (대쉬보드 탭도 분할 창에서 선택 가능)
  const handleToggleHorizontalSplit = () => {
    if (activeTabPath && !activeTabPath.startsWith('mylore://dashboard/') && editorRef.current) {
      lastCursorOffsetByPathRef.current[activeTabPath] = editorRef.current.selectionStart;
    }
    if (!isHorizontalSplitOpen) {
      if (openTabs.length === 0) {
        setStatusMessage('⚠️ 수평 분할할 열린 문서나 대시보드가 없습니다.');
        return;
      }
      const currentValidPath =
        activeTabPath && openTabs.some((t) => t.doc.fullPath === activeTabPath)
          ? activeTabPath
          : leftPaneTabPath && openTabs.some((t) => t.doc.fullPath === leftPaneTabPath)
            ? leftPaneTabPath
            : openTabs[openTabs.length - 1].doc.fullPath;

      const nextLeft =
        leftPaneTabPath && openTabs.some((t) => t.doc.fullPath === leftPaneTabPath)
          ? leftPaneTabPath
          : currentValidPath;
      const existingRightList = rightPaneTabPaths.filter((p) =>
        openTabs.some((t) => t.doc.fullPath === p)
      );
      const nextRightList =
        existingRightList.length > 0 ? existingRightList : [currentValidPath];
      const nextRight =
        rightPaneTabPath && nextRightList.includes(rightPaneTabPath)
          ? rightPaneTabPath
          : nextRightList[nextRightList.length - 1];

      setLeftPaneTabPath(nextLeft);
      setRightPaneTabPaths(nextRightList);
      setRightPaneTabPath(nextRight);
      setIsHorizontalSplitOpen(true);
      setFocusedEditorPane('right');
      setActiveTabPath(nextRight);
      restoreEditorCursorToLastPos(nextRight);
      setStatusMessage(
        '◫ 에디터 수평 분할 활성화 (Ctrl+\\ : 분할 닫기 | Ctrl+Alt+←/→ : 현재 문서/대시보드 옆 분할창으로 이동)'
      );
    } else {
      setIsHorizontalSplitOpen(false);
      setFocusedEditorPane('left');
      setRightPaneTabPaths([]);
      setRightPaneTabPath(null);
      const fallbackPath =
        activeTabPath ||
        (leftPaneTabPath && openTabs.some((t) => t.doc.fullPath === leftPaneTabPath)
          ? leftPaneTabPath
          : rightPaneTabPath && openTabs.some((t) => t.doc.fullPath === rightPaneTabPath)
            ? rightPaneTabPath
            : null);
      if (fallbackPath) {
        setLeftPaneTabPath(fallbackPath);
        setActiveTabPath(fallbackPath);
        restoreEditorCursorToLastPos(fallbackPath);
      }
      setStatusMessage('◫ 에디터 수평 분할을 닫고 단일 화면으로 병합했습니다.');
    }
  };

  // Ctrl+Alt+→ : 현재 문서/대시보드만 오른쪽 분할창으로 이동
  const handleMoveDocToRightEditor = () => {
    const targetPath =
      activeTabPath ||
      (leftPaneTabPath && openTabs.some((t) => t.doc.fullPath === leftPaneTabPath)
        ? leftPaneTabPath
        : null);

    if (!targetPath) {
      setStatusMessage('⚠️ 오른쪽 분할창으로 이동할 탭이 없습니다.');
      return;
    }

    if (!targetPath.startsWith('mylore://dashboard/') && editorRef.current) {
      lastCursorOffsetByPathRef.current[targetPath] =
        editorRef.current.selectionStart;
    }

    const validRightList = rightPaneTabPaths.filter((p) =>
      openTabs.some((t) => t.doc.fullPath === p)
    );

    if (
      isHorizontalSplitOpen &&
      validRightList.includes(targetPath) &&
      leftPaneTabPath !== targetPath
    ) {
      setRightPaneTabPath(targetPath);
      setFocusedEditorPane('right');
      setActiveTabPath(targetPath);
      restoreEditorCursorToLastPos(targetPath);
      setStatusMessage('➡️ 현재 탭이 이미 오른쪽 분할창에 있습니다.');
      return;
    }

    const nextRightList = validRightList.includes(targetPath)
      ? validRightList
      : [...validRightList, targetPath];

    const remainingLeftDocs = openTabs.filter(
      (t) => !nextRightList.includes(t.doc.fullPath)
    );

    if (remainingLeftDocs.length === 0) {
      if (!isHorizontalSplitOpen) {
        setLeftPaneTabPath(targetPath);
        setRightPaneTabPaths([targetPath]);
        setRightPaneTabPath(targetPath);
        setIsHorizontalSplitOpen(true);
        setFocusedEditorPane('right');
        setActiveTabPath(targetPath);
        restoreEditorCursorToLastPos(targetPath);
        setStatusMessage(
          '➡️ 현재 탭을 오른쪽 분할창에 열었습니다 (Ctrl+Alt+→)'
        );
        return;
      } else {
        setIsHorizontalSplitOpen(false);
        setRightPaneTabPaths([]);
        setRightPaneTabPath(null);
        setLeftPaneTabPath(targetPath);
        setFocusedEditorPane('left');
        setActiveTabPath(targetPath);
        restoreEditorCursorToLastPos(targetPath);
        setStatusMessage(
          '➡️ 마지막 탭을 이동하여 단일 화면으로 병합되었습니다.'
        );
        return;
      }
    }

    if (
      !leftPaneTabPath ||
      leftPaneTabPath === targetPath ||
      !remainingLeftDocs.some((t) => t.doc.fullPath === leftPaneTabPath)
    ) {
      let replacementLeft: string | null = null;
      const history = tabAccessHistoryRef.current;
      for (let i = history.length - 1; i >= 0; i--) {
        const cand = history[i];
        if (remainingLeftDocs.some((t) => t.doc.fullPath === cand)) {
          replacementLeft = cand;
          break;
        }
      }
      if (!replacementLeft) {
        replacementLeft =
          remainingLeftDocs[remainingLeftDocs.length - 1].doc.fullPath;
      }
      setLeftPaneTabPath(replacementLeft);
    }

    setRightPaneTabPaths(nextRightList);
    setRightPaneTabPath(targetPath);
    setIsHorizontalSplitOpen(true);
    setFocusedEditorPane('right');
    setActiveTabPath(targetPath);
    restoreEditorCursorToLastPos(targetPath);

    const movedTitle = (targetPath.split(/[\\/]/).pop() || targetPath).replace(
      /\.md$/i,
      ''
    );
    setStatusMessage(
      `➡️ 오른쪽 분할창으로 이동했습니다: ${movedTitle} (Ctrl+Alt+→)`
    );
  };

  // Ctrl+Alt+← : 현재 문서/대시보드만 왼쪽 분할창으로 이동
  const handleMoveDocToLeftEditor = () => {
    if (!isHorizontalSplitOpen) {
      setFocusedEditorPane('left');
      setStatusMessage('⬅️ 이미 왼쪽(기본) 화면에 있습니다.');
      return;
    }

    const targetPath =
      activeTabPath ||
      (focusedEditorPane === 'right' ? rightPaneTabPath : leftPaneTabPath);

    if (!targetPath) {
      setStatusMessage('⚠️ 왼쪽 분할창으로 이동할 탭이 없습니다.');
      return;
    }

    if (!targetPath.startsWith('mylore://dashboard/') && editorRef.current) {
      lastCursorOffsetByPathRef.current[targetPath] =
        editorRef.current.selectionStart;
    }

    const validRightList = rightPaneTabPaths.filter((p) =>
      openTabs.some((t) => t.doc.fullPath === p)
    );

    if (!validRightList.includes(targetPath)) {
      setLeftPaneTabPath(targetPath);
      setFocusedEditorPane('left');
      setActiveTabPath(targetPath);
      restoreEditorCursorToLastPos(targetPath);
      setStatusMessage('⬅️ 현재 탭이 이미 왼쪽 분할창에 있습니다.');
      return;
    }

    const remainingRight = validRightList.filter((p) => p !== targetPath);
    setRightPaneTabPaths(remainingRight);
    setLeftPaneTabPath(targetPath);
    setFocusedEditorPane('left');
    setActiveTabPath(targetPath);
    restoreEditorCursorToLastPos(targetPath);

    const movedTitle = (targetPath.split(/[\\/]/).pop() || targetPath).replace(
      /\.md$/i,
      ''
    );

    if (remainingRight.length === 0) {
      setRightPaneTabPath(null);
      setIsHorizontalSplitOpen(false);
      setStatusMessage(
        `⬅️ 왼쪽 분할창으로 이동하고 빈 오른쪽 창을 닫았습니다: ${movedTitle}`
      );
    } else {
      let nextRightPath: string | null = null;
      const history = tabAccessHistoryRef.current;
      for (let i = history.length - 1; i >= 0; i--) {
        const cand = history[i];
        if (remainingRight.includes(cand)) {
          nextRightPath = cand;
          break;
        }
      }
      if (!nextRightPath) {
        nextRightPath = remainingRight[remainingRight.length - 1];
      }
      setRightPaneTabPath(nextRightPath);
      setStatusMessage(
        `⬅️ 왼쪽 분할창으로 이동했습니다: ${movedTitle} (Ctrl+Alt+←)`
      );
    }
  };

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

  // 편집 위치(파일 + 커서 오프셋)를 히스토리 스택 및 문서별 마지막 커서 위치 맵에 기록
  const recordEditPosition = (
    path: string,
    offset: number,
    forceNewStep = false
  ) => {
    if (!path || isNavigatingEditHistoryRef.current) return;
    lastCursorOffsetByPathRef.current[path] = offset;
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

  // 자동 저장 (Auto-Save checked 시 1.2초 디바운스 자동 저장 — 좌/우 분할 에디터의 모든 수정된 문서 탭 포함, 가상 대쉬보드 탭은 제외)
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const dirtyDocTabs = openTabs.filter(
      (t) => t.isDirty && !t.doc.fullPath.startsWith('mylore://dashboard/')
    );
    if (dirtyDocTabs.length === 0) return;

    const timer = setTimeout(async () => {
      for (const tab of dirtyDocTabs) {
        try {
          const combined = combineYamlAndBody(tab.yamlText, tab.bodyText);
          const saved = await saveDocument(tab.doc.fullPath, combined);
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
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, openTabs]);

  const applyLoadedDocument = (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
      openAsLink?: boolean;
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
    assignTabToSplitPane(doc.fullPath, jumpTo?.openAsLink);
    if (viewMode.startsWith('dashboard_')) {
      setViewMode('split');
    }
    setStatusMessage(`열람 중: ${doc.relativePath}`);

    let initialOffset =
      jumpTo?.charOffset ??
      lastCursorOffsetByPathRef.current[doc.fullPath] ??
      0;
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
    const dashType = fullPath.replace(
      'mylore://dashboard/',
      ''
    ) as DashboardTabType;
    const label = DASHBOARD_TITLE_MAP[dashType];
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

  // 대쉬보드도 일반 .md 문서와 동일하게 상단 탭(.doc-tabs-bar) 및 분할 화면에 추가하여 열기
  const openDashboardTab = (dashType: DashboardTabType) => {
    const normalizedDashType: DashboardTabType =
      dashType === 'lifelog' ? 'call' : dashType;
    const fullPath = `mylore://dashboard/${normalizedDashType}`;
    const label = DASHBOARD_TITLE_MAP[normalizedDashType] || '대시보드';
    const virtualDoc: DocumentPayload = {
      uuid: `dashboard-${normalizedDashType}`,
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
    assignTabToSplitPane(fullPath, false);
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

      // 수평 분할 상태의 좌/우 탭 경로 정리 (대시보드 탭 포함)
      const nextRightPaths = rightPaneTabPaths.filter(
        (p) => p !== fullPath && next.some((t) => t.doc.fullPath === p)
      );
      setRightPaneTabPaths(nextRightPaths);
      if (rightPaneTabPath === fullPath) {
        const nextRightActive =
          nextRightPaths.length > 0
            ? nextRightPaths[nextRightPaths.length - 1]
            : null;
        setRightPaneTabPath(nextRightActive);
        if (!nextRightActive && isHorizontalSplitOpen) {
          setIsHorizontalSplitOpen(false);
          setFocusedEditorPane('left');
        }
      }
      if (leftPaneTabPath === fullPath) {
        const fallbackLeft =
          next.find((t) => !nextRightPaths.includes(t.doc.fullPath))
            ?.doc.fullPath ||
          next[next.length - 1]?.doc.fullPath ||
          null;
        setLeftPaneTabPath(fallbackLeft);
      }

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
    tabAccessHistory, setTabAccessHistory, tabAccessHistoryRef, isSessionRestoredRef, docTabsBarRef,
    editHistoryRef, editHistoryIdxRef, isNavigatingEditHistoryRef, lastCursorOffsetByPathRef,
    restoreEditorCursorToLastPos, recordEditPosition,
    isYamlVisible, setIsYamlVisible, autoSaveEnabled, setAutoSaveEnabled, scanProgress, setScanProgress,
    isHorizontalSplitOpen, setIsHorizontalSplitOpen, focusedEditorPane, setFocusedEditorPane,
    leftPaneTabPath, setLeftPaneTabPath, rightPaneTabPath, setRightPaneTabPath,
    rightPaneTabPaths, setRightPaneTabPaths, leftPaneViewMode, setLeftPaneViewMode,
    rightPaneViewMode, setRightPaneViewMode, horizontalSplitRatio, setHorizontalSplitRatio,
    focusEditorPane, handleCycleViewerMode, handleToggleHorizontalSplit,
    handleMoveDocToRightEditor, handleMoveDocToLeftEditor,
    applyLoadedDocument, openCliFilesInEditorMode, buildVirtualDashboardTab, openDashboardTab,
    openDocumentByNode, closeTab, handleSaveCurrentDoc, handleAutoFormatTasks,
    handleRunBatchUuidScan, handleCreateTempMemo, handleOpenNativeFile, handleOpenNativeFolder,
  };
}
