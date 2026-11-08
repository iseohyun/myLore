/**
 * @file useEditorCommands.ts
 * @description 에디터 텍스트 편집·줄 이동·다중 커서, 편집점 히스토리 이동(`Alt+←/→`), 괄호/북마크/일기 점프, 문서 내 찾기 및 볼트 전체 검색/치환 훅.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DashboardTabType,
  DocumentPayload,
  FileNode,
  OpenDocumentTab,
  RightSidebarTab,
  SearchMatchItem,
} from '../types/mylore';
import {
  openRootMainMd,
  readDocument,
  searchInFiles,
} from '../services/tauriClient';
import {
  extractTocFromBody,
  splitYamlFrontmatter,
} from '../utils/markdownAutoFormat';
import {
  applyPatternReplace,
  computeIndentOrOutdent,
  findMatchesInDocumentBody,
  unescapeReplacePattern,
} from '../utils/editorSearchAndIndent';

export { applyPatternReplace, unescapeReplacePattern };

export interface SearchFocusRequest {
  target: 'doc_find' | 'doc_replace' | 'global_find';
  seq: number;
}

export interface UseEditorCommandsParams {
  openTabs: OpenDocumentTab[];
  setOpenTabs: React.Dispatch<React.SetStateAction<OpenDocumentTab[]>>;
  activeTabPath: string | null;
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  currentDoc: DocumentPayload | null;
  bodyText: string;
  setBodyText: (updater: string | ((prev: string) => string)) => void;
  editorRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  editHistoryRef: React.MutableRefObject<
    Array<{ path: string; offset: number }>
  >;
  editHistoryIdxRef: React.MutableRefObject<number>;
  isNavigatingEditHistoryRef: React.MutableRefObject<boolean>;
  lastCursorOffsetByPathRef?: React.MutableRefObject<Record<string, number>>;
  restoreEditorCursorToLastPos?: (targetPath: string) => void;
  rightSidebarOpen: boolean;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightTab: RightSidebarTab;
  setRightTab: React.Dispatch<React.SetStateAction<RightSidebarTab>>;
  flattenedFiles: FileNode[];
  diaryFilesSorted: FileNode[];
  refreshTree: () => Promise<void>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
  openDashboardTab: (dashType: DashboardTabType) => void;
  openDocumentByNode: (node: FileNode) => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function useEditorCommands({
  openTabs,
  setOpenTabs,
  activeTabPath,
  setActiveTabPath,
  currentDoc,
  bodyText,
  setBodyText,
  editorRef,
  editHistoryRef,
  editHistoryIdxRef,
  isNavigatingEditHistoryRef,
  lastCursorOffsetByPathRef,
  restoreEditorCursorToLastPos,
  rightSidebarOpen,
  setRightSidebarOpen,
  rightTab,
  setRightTab,
  flattenedFiles,
  diaryFilesSorted,
  refreshTree,
  applyLoadedDocument,
  openDashboardTab,
  openDocumentByNode,
  setStatusMessage,
}: UseEditorCommandsParams) {
  // 문서 내 찾기/바꾸기 바 상태 (정규식 + 이스케이프 지원 포함)
  const [findBarMode, setFindBarMode] = useState<'closed' | 'find' | 'replace'>(
    'closed'
  );
  const [docFindQuery, setDocFindQuery] = useState('');
  const [docReplaceText, setDocReplaceText] = useState('');
  const [docFindUseRegex, setDocFindUseRegex] = useState(false);
  const [docReplaceUseEscape, setDocReplaceUseEscape] = useState(true);
  const [docFindMatchRange, setDocFindMatchRange] = useState<{
    start: number;
    end: number;
    seq?: number;
  } | null>(null);

  // 전체 파일에서 찾기/바꾸기 상태 (우측 사이드바 🔍 연동 · 정규식 + 이스케이프 지원 포함)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalReplaceText, setGlobalReplaceText] = useState('');
  const [globalReplaceMode, setGlobalReplaceMode] = useState(true);
  const [globalSearchUseRegex, setGlobalSearchUseRegex] = useState(false);
  const [globalReplaceUseEscape, setGlobalReplaceUseEscape] = useState(true);
  const [globalSearchResults, setGlobalSearchResults] = useState<
    SearchMatchItem[]
  >([]);
  const [activeSearchIdx, setActiveSearchIdx] = useState<number>(0);

  // 순환 검색 여부 (기본값 true) 및 2초간 표시되는 "대상이 없습니다" 토스트 알림
  const [searchWrapAround, setSearchWrapAround] = useState(true);
  const [searchNoMatchToast, setSearchNoMatchToast] = useState<string | null>(
    null
  );
  const noMatchToastTimerRef = useRef<number | null>(null);

  const triggerNoMatchToast = (msg: string = '대상이 없습니다') => {
    setSearchNoMatchToast(msg);
    setStatusMessage(`⚠️ ${msg}`);
    if (noMatchToastTimerRef.current !== null) {
      window.clearTimeout(noMatchToastTimerRef.current);
    }
    noMatchToastTimerRef.current = window.setTimeout(() => {
      setSearchNoMatchToast(null);
      noMatchToastTimerRef.current = null;
    }, 2000);
  };

  // 찾기 / 바꾸기 / 모든 파일에서 찾기 실행 시 해당 입력창으로 커서 포커스 요청
  const [searchFocusRequest, setSearchFocusRequest] =
    useState<SearchFocusRequest | null>(null);

  const openDocFindPanel = (mode: 'find' | 'replace' = 'find') => {
    const ta = editorRef.current;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n')) {
        setDocFindQuery(sel);
      }
    }
    setRightSidebarOpen(true);
    if (rightTab === 'search') {
      setRightTab('tree');
    }
    setFindBarMode(mode);
    setSearchFocusRequest({
      target: mode === 'replace' ? 'doc_replace' : 'doc_find',
      seq: Date.now() + Math.random(),
    });
  };

  const openGlobalSearchPanel = () => {
    const ta = editorRef.current;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n')) {
        setGlobalSearchQuery(sel);
        void executeGlobalSearch(sel);
      }
    }
    setFindBarMode('closed');
    setRightSidebarOpen(true);
    setRightTab('search');
    setGlobalReplaceMode(true);
    setSearchFocusRequest({
      target: 'global_find',
      seq: Date.now() + Math.random(),
    });
  };

  const [bookmarks, setBookmarks] = useState<
    Array<{ path: string; line: number }>
  >([]);
  const [bookmarkIdx, setBookmarkIdx] = useState<number>(0);

  // 줄 이동 모달 (`이동 > 줄 이동`)
  const [gotoLineModalOpen, setGotoLineModalOpen] = useState(false);
  const [gotoLineInput, setGotoLineInput] = useState('1');

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

  const handleMoveLine = (direction: 'up' | 'down') => {
    if (!editorRef.current || !currentDoc) return;
    const el = editorRef.current;
    const text = el.value ?? bodyText;
    const pos = el.selectionStart;
    const lines = text.split('\n');
    let charCount = 0;
    let currentLineIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (pos <= charCount + lines[i].length) {
        currentLineIdx = i;
        break;
      }
      charCount += lines[i].length + 1;
    }

    const colOffset = Math.max(
      0,
      Math.min(lines[currentLineIdx]?.length ?? 0, pos - charCount)
    );

    const swapIdx =
      direction === 'up' ? currentLineIdx - 1 : currentLineIdx + 1;
    if (swapIdx < 0 || swapIdx >= lines.length) return;

    const temp = lines[currentLineIdx];
    lines[currentLineIdx] = lines[swapIdx];
    lines[swapIdx] = temp;
    const nextBody = lines.join('\n');

    let newLineStart = 0;
    for (let i = 0; i < swapIdx; i++) {
      newLineStart += lines[i].length + 1;
    }
    const nextCaretPos = newLineStart + colOffset;
    const prevScrollTop = el.scrollTop;

    // 동기적으로 textarea 값 및 커서(이동된 행 · 동일한 열)를 즉시 갱신하고 렌더 후에도 유지
    el.value = nextBody;
    el.focus();
    el.setSelectionRange(nextCaretPos, nextCaretPos);
    if (lastCursorOffsetByPathRef && currentDoc.fullPath) {
      lastCursorOffsetByPathRef.current[currentDoc.fullPath] = nextCaretPos;
    }
    setBodyText(nextBody);

    window.requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.focus();
        editorRef.current.setSelectionRange(nextCaretPos, nextCaretPos);
        editorRef.current.scrollTop = prevScrollTop;
      }
    });

    setStatusMessage(
      `↕ 줄 ${direction === 'up' ? '위로' : '아래로'} 이동 완료 (${swapIdx + 1}행 ${colOffset + 1}열)`
    );
  };

  /**
   * Tab / Shift+Tab : 현재 줄(또는 선택된 다중 줄) 맨 앞에 띄어쓰기 2개(기본값) 추가 또는 삭제
   */
  const handleIndentLine = (
    mode: 'indent' | 'outdent',
    indentSpaces: number = 2
  ) => {
    if (!editorRef.current || !currentDoc) return;
    const el = editorRef.current;
    const text = el.value ?? bodyText;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;
    const prevScrollTop = el.scrollTop;

    const { nextText, nextStart, nextEnd, modifiedLines } =
      computeIndentOrOutdent(text, selStart, selEnd, mode, indentSpaces);

    if (modifiedLines === 0) {
      return;
    }

    el.value = nextText;
    el.focus();
    el.setSelectionRange(nextStart, nextEnd);
    if (lastCursorOffsetByPathRef && currentDoc.fullPath) {
      lastCursorOffsetByPathRef.current[currentDoc.fullPath] = nextStart;
    }
    setBodyText(nextText);

    window.requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.focus();
        editorRef.current.setSelectionRange(nextStart, nextEnd);
        editorRef.current.scrollTop = prevScrollTop;
      }
    });

    setStatusMessage(
      mode === 'indent'
        ? `⇥ 현재 줄 맨 앞에 띄어쓰기 ${indentSpaces}칸 추가`
        : `⇤ 현재 줄 맨 앞 띄어쓰기 삭제`
    );
  };

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

  const handleSwitchTabCycle = (dir: 1 | -1) => {
    if (openTabs.length <= 1 || !activeTabPath) return;
    if (
      !activeTabPath.startsWith('mylore://dashboard/') &&
      editorRef.current &&
      lastCursorOffsetByPathRef
    ) {
      lastCursorOffsetByPathRef.current[activeTabPath] =
        editorRef.current.selectionStart;
    }
    const curIdx = openTabs.findIndex((t) => t.doc.fullPath === activeTabPath);
    const nextIdx = (curIdx + dir + openTabs.length) % openTabs.length;
    const nextPath = openTabs[nextIdx].doc.fullPath;
    setActiveTabPath(nextPath);
    restoreEditorCursorToLastPos?.(nextPath);
  };

  const handleMoveEditPoint = async (dir: 1 | -1) => {
    const hist = editHistoryRef.current;
    const curIdx = editHistoryIdxRef.current;
    if (hist.length === 0) {
      setStatusMessage('기록된 편집 위치 히스토리가 아직 없습니다.');
      return;
    }

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
          `${
            dir === -1 ? '⬅️ [Alt+←] 이전 위치' : '➡️ [Alt+→] 다음 위치'
          } (${nextIdx + 1}/${hist.length}): 대쉬보드 이동`
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

        const isMobilePath =
          /[\\/]mobile[\\/](kakao|sms|calls|recordings|notifications|health)[\\/]/i.test(
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
          `${
            dir === -1
              ? '⬅️ [Alt+←] 이전 편집 위치'
              : '➡️ [Alt+→] 다음 편집 위치'
          } (${nextIdx + 1}/${hist.length}): ${relLabel} (${lineNum}행)`
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
      const nextBracket = bodyText.slice(pos).search(/[()[\]{}]/);
      if (nextBracket >= 0) {
        el.focus();
        el.setSelectionRange(pos + nextBracket, pos + nextBracket + 1);
      }
      return;
    }
    const target = pairs[ch];
    const isForward = '([{'.includes(ch);
    const idx = isForward
      ? bodyText.indexOf(target, pos + 1)
      : bodyText.lastIndexOf(target, pos - 1);
    if (idx >= 0) {
      el.focus();
      el.setSelectionRange(idx, idx + 1);
      setStatusMessage(`괄호 이동 완료 (위치: ${idx})`);
    }
  };

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
      setStatusMessage(
        `🔖 북마크 등록됨: ${currentDoc.relativePath} (${curLine}행)`
      );
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

  const handleGotoRootMainMd = async () => {
    try {
      setRightTab('tree');
      const doc = await openRootMainMd();
      await refreshTree();
      applyLoadedDocument(doc);
      setStatusMessage('⭐ Projects/main.md 로 이동했습니다.');
    } catch (err) {
      setStatusMessage(`main.md 이동 실패: ${String(err)}`);
    }
  };

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

  const executeGlobalSearch = async (q?: string, useRegexOverride?: boolean) => {
    const queryToUse = (q ?? globalSearchQuery).trim();
    if (!queryToUse) {
      setGlobalSearchResults([]);
      return;
    }
    const useRegex = useRegexOverride ?? globalSearchUseRegex;
    try {
      const matches = await searchInFiles(queryToUse, useRegex);
      setGlobalSearchResults(matches);
      setActiveSearchIdx(0);
      setRightSidebarOpen(true);
      setRightTab('search');
      setStatusMessage(
        `🔍 '${queryToUse}'${useRegex ? ' (정규식)' : ''} 검색 결과: 총 ${matches.length}건 발견`
      );
    } catch (err) {
      setStatusMessage(`검색 오류: ${String(err)}`);
    }
  };

  const docFindMatches = useMemo(
    () => findMatchesInDocumentBody(bodyText, docFindQuery, docFindUseRegex),
    [bodyText, docFindQuery, docFindUseRegex]
  );

  const selectMatchInEditor = (
    start: number,
    end: number,
    focusEditor: boolean = false
  ) => {
    setDocFindMatchRange({ start, end, seq: Date.now() + Math.random() });
    const el = editorRef.current;
    if (!el) return;
    const activeEl = document.activeElement;
    const isFocusInFindBar =
      activeEl instanceof HTMLElement &&
      Boolean(
        activeEl.closest('.find-replace-bar') ||
          activeEl.closest('.sidebar-search-panel')
      );
    // 찾기/바꾸기 입력창에 커서가 있을 때는 setSelectionRange가 포커스를 빼앗지 않도록 보호
    if (focusEditor || (!isFocusInFindBar && findBarMode === 'closed')) {
      el.focus();
      try {
        el.setSelectionRange(start, end);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    if (findBarMode === 'closed') {
      setDocFindMatchRange(null);
      return;
    }
    const ta = editorRef.current;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && !sel.includes('\n') && sel !== docFindQuery) {
        setDocFindQuery(sel);
        return;
      }
    }
  }, [findBarMode]);

  useEffect(() => {
    if (findBarMode === 'closed' || !docFindQuery) {
      setDocFindMatchRange(null);
      return;
    }
    if (docFindMatches.length > 0) {
      selectMatchInEditor(docFindMatches[0].start, docFindMatches[0].end);
    } else {
      setDocFindMatchRange(null);
    }
  }, [findBarMode, docFindQuery, docFindUseRegex, currentDoc?.fullPath]);

  const handleJumpSearchMatch = async (dir: 1 | -1) => {
    if (findBarMode === 'closed') {
      if (globalSearchResults.length === 0) {
        triggerNoMatchToast('대상이 없습니다');
        return;
      }
      let nextIdx = activeSearchIdx + dir;
      if (nextIdx >= globalSearchResults.length || nextIdx < 0) {
        if (!searchWrapAround) {
          triggerNoMatchToast('대상이 없습니다');
          return;
        }
        nextIdx =
          (activeSearchIdx + dir + globalSearchResults.length) %
          globalSearchResults.length;
      }
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

    if (!docFindQuery || docFindMatches.length === 0) {
      triggerNoMatchToast('대상이 없습니다');
      return;
    }

    const curMatchIdx = docFindMatchRange
      ? docFindMatches.findIndex(
          (m) =>
            m.start === docFindMatchRange.start &&
            m.end === docFindMatchRange.end
        )
      : -1;

    let targetIdx = -1;
    if (curMatchIdx >= 0) {
      const candidate = curMatchIdx + dir;
      if (candidate >= 0 && candidate < docFindMatches.length) {
        targetIdx = candidate;
      } else if (searchWrapAround) {
        targetIdx = dir === 1 ? 0 : docFindMatches.length - 1;
      } else {
        triggerNoMatchToast('대상이 없습니다');
        return;
      }
    } else {
      const el = editorRef.current;
      const curStart = el ? el.selectionStart : 0;
      if (dir === 1) {
        const found = docFindMatches.findIndex((m) => m.start >= curStart);
        if (found >= 0) targetIdx = found;
        else if (searchWrapAround) targetIdx = 0;
        else {
          triggerNoMatchToast('대상이 없습니다');
          return;
        }
      } else {
        let found = -1;
        for (let i = docFindMatches.length - 1; i >= 0; i--) {
          if (docFindMatches[i].start < curStart) {
            found = i;
            break;
          }
        }
        if (found >= 0) targetIdx = found;
        else if (searchWrapAround) targetIdx = docFindMatches.length - 1;
        else {
          triggerNoMatchToast('대상이 없습니다');
          return;
        }
      }
    }

    const match = docFindMatches[targetIdx];
    if (match) {
      selectMatchInEditor(match.start, match.end, false);
      setStatusMessage(
        `🔍 찾은 대상 선택 (${targetIdx + 1}/${docFindMatches.length} · :${match.lineNumber}행)`
      );
    }
  };

  /**
   * 현재 선택된 찾은 단어를 바꾸기 적용한 뒤, 즉시 다음 찾은 단어로 이동 및 선택 (Ctrl+Enter)
   */
  const handleReplaceCurrentInDoc = () => {
    if (!docFindQuery || docFindMatches.length === 0) {
      setDocFindMatchRange(null);
      triggerNoMatchToast('대상이 없습니다');
      return;
    }
    const targetMatch =
      docFindMatches.find(
        (m) =>
          docFindMatchRange &&
          m.start === docFindMatchRange.start &&
          m.end === docFindMatchRange.end
      ) || docFindMatches[0];

    const targetStart = targetMatch.start;
    const targetEnd = targetMatch.end;
    const matchedStr = bodyText.slice(targetStart, targetEnd);
    const replacementStr = applyPatternReplace(
      matchedStr,
      docFindQuery,
      docReplaceText,
      docFindUseRegex,
      docReplaceUseEscape,
      false
    );

    const nextBody =
      bodyText.slice(0, targetStart) +
      replacementStr +
      bodyText.slice(targetEnd);
    setBodyText(nextBody);

    // 변경된 본문에서 다음 찾은 단어로 즉시 이동 및 선택
    const nextSearchFrom = targetStart + replacementStr.length;
    const remainingMatches = findMatchesInDocumentBody(
      nextBody,
      docFindQuery,
      docFindUseRegex
    );

    if (remainingMatches.length === 0) {
      setDocFindMatchRange(null);
      triggerNoMatchToast('대상이 없습니다');
      return;
    }

    const nextAfterIdx = remainingMatches.findIndex(
      (m) => m.start >= nextSearchFrom
    );
    if (nextAfterIdx >= 0) {
      const nextMatch = remainingMatches[nextAfterIdx];
      setDocFindMatchRange({
        start: nextMatch.start,
        end: nextMatch.end,
        seq: Date.now() + Math.random(),
      });
      setStatusMessage(
        `✏️ '${matchedStr}' → '${replacementStr}' 변경 후 다음 대상 선택 (${nextAfterIdx + 1}/${remainingMatches.length})`
      );
    } else if (searchWrapAround) {
      const wrappedMatch = remainingMatches[0];
      setDocFindMatchRange({
        start: wrappedMatch.start,
        end: wrappedMatch.end,
        seq: Date.now() + Math.random(),
      });
      setStatusMessage(
        `✏️ '${matchedStr}' → '${replacementStr}' 변경 후 처음으로 순환 선택 (1/${remainingMatches.length})`
      );
    } else {
      setDocFindMatchRange(null);
      triggerNoMatchToast('대상이 없습니다');
    }
  };

  const handleReplaceAllInDoc = () => {
    if (!docFindQuery) {
      triggerNoMatchToast('대상이 없습니다');
      return;
    }
    try {
      const pattern = docFindUseRegex
        ? docFindQuery
        : docFindQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(pattern, 'gi');
      const matches = bodyText.match(regex);
      const count = matches ? matches.length : 0;
      if (count === 0) {
        triggerNoMatchToast('대상이 없습니다');
        return;
      }
      const nextBody = applyPatternReplace(
        bodyText,
        docFindQuery,
        docReplaceText,
        docFindUseRegex,
        docReplaceUseEscape,
        true
      );
      setBodyText(nextBody);
      setDocFindMatchRange(null);
      setStatusMessage(
        `✏️ '${docFindQuery}' → '${docReplaceText}' 총 ${count}건 모두 적용 완료`
      );
    } catch (err) {
      setStatusMessage(`정규식 오류: ${String(err)}`);
    }
  };

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
        `${
          dir === -1 ? '⬆️ [F3] 목록 이전 파일' : '⬇️ [F4] 목록 다음 파일'
        } 선택 (${nextIdx + 1}/${flattenedFiles.length}): ${
          targetNode.relativePath
        }`
      );
    }
  };

  const tocHeadings = useMemo(() => extractTocFromBody(bodyText), [bodyText]);

  const insertIntoBody = (snippet: string) => {
    setBodyText((prev) => `${prev}\n${snippet}`);
    setStatusMessage('본문 하단에 선택한 항목이 삽입되었습니다.');
  };

  return {
    findBarMode,
    setFindBarMode,
    docFindQuery,
    setDocFindQuery,
    docReplaceText,
    setDocReplaceText,
    docFindUseRegex,
    setDocFindUseRegex,
    docReplaceUseEscape,
    setDocReplaceUseEscape,
    docFindMatches,
    docFindMatchRange,
    setDocFindMatchRange,
    selectMatchInEditor,
    handleReplaceCurrentInDoc,
    handleReplaceAllInDoc,
    globalSearchQuery,
    setGlobalSearchQuery,
    globalReplaceText,
    setGlobalReplaceText,
    globalReplaceMode,
    setGlobalReplaceMode,
    globalSearchUseRegex,
    setGlobalSearchUseRegex,
    globalReplaceUseEscape,
    setGlobalReplaceUseEscape,
    globalSearchResults,
    setGlobalSearchResults,
    activeSearchIdx,
    setActiveSearchIdx,
    searchFocusRequest,
    setSearchFocusRequest,
    searchWrapAround,
    setSearchWrapAround,
    searchNoMatchToast,
    triggerNoMatchToast,
    openDocFindPanel,
    openGlobalSearchPanel,
    bookmarks,
    setBookmarks,
    bookmarkIdx,
    setBookmarkIdx,
    gotoLineModalOpen,
    setGotoLineModalOpen,
    gotoLineInput,
    setGotoLineInput,
    handleEditorUndo,
    handleEditorRedo,
    handleEditorCut,
    handleEditorCopy,
    handleEditorPaste,
    handleSelectAll,
    handleMoveLine,
    handleIndentLine,
    handleAddCursorVertical,
    handleSwitchTabCycle,
    handleMoveEditPoint,
    handleJumpToMatchingBracket,
    handleBookmarkJumpOrToggle,
    handleGotoRootMainMd,
    handleGotoDiary,
    executeGlobalSearch,
    handleJumpSearchMatch,
    handleListSelectPrevOrNext,
    tocHeadings,
    insertIntoBody,
  };
}
