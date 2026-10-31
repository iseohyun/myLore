/**
 * @file useEditorCommands.ts
 * @description 에디터 텍스트 편집·줄 이동·다중 커서, 편집점 히스토리 이동(`Alt+←/→`), 괄호/북마크/일기 점프, 문서 내 찾기 및 볼트 전체 검색/치환 훅.
 */
import React, { useMemo, useState } from 'react';
import {
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
  openDashboardTab: (
    dashType: 'lifelog' | 'finance' | 'diary' | 'settings'
  ) => void;
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
  // 문서 내 찾기/바꾸기 바 상태
  const [findBarMode, setFindBarMode] = useState<'closed' | 'find' | 'replace'>(
    'closed'
  );
  const [docFindQuery, setDocFindQuery] = useState('');
  const [docReplaceText, setDocReplaceText] = useState('');

  // 전체 파일에서 찾기/바꾸기 상태 (우측 사이드바 🔍 연동)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalReplaceText, setGlobalReplaceText] = useState('');
  const [globalReplaceMode, setGlobalReplaceMode] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<
    SearchMatchItem[]
  >([]);
  const [activeSearchIdx, setActiveSearchIdx] = useState<number>(0);

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

    const swapIdx =
      direction === 'up' ? currentLineIdx - 1 : currentLineIdx + 1;
    if (swapIdx < 0 || swapIdx >= lines.length) return;

    const temp = lines[currentLineIdx];
    lines[currentLineIdx] = lines[swapIdx];
    lines[swapIdx] = temp;
    const nextBody = lines.join('\n');
    setBodyText(nextBody);
    setStatusMessage(
      `↕ 현재 줄(${currentLineIdx + 1}행)을 ${
        direction === 'up' ? '위로' : '아래로'
      } 이동했습니다.`
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
    const curIdx = openTabs.findIndex((t) => t.doc.fullPath === activeTabPath);
    const nextIdx = (curIdx + dir + openTabs.length) % openTabs.length;
    setActiveTabPath(openTabs[nextIdx].doc.fullPath);
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
    if (docFindQuery && editorRef.current) {
      const el = editorRef.current;
      const startPos =
        dir === 1 ? el.selectionEnd : Math.max(0, el.selectionStart - 1);
      const idx =
        dir === 1
          ? bodyText.toLowerCase().indexOf(docFindQuery.toLowerCase(), startPos)
          : bodyText
              .toLowerCase()
              .lastIndexOf(docFindQuery.toLowerCase(), startPos);
      if (idx >= 0) {
        el.focus();
        el.setSelectionRange(idx, idx + docFindQuery.length);
      }
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
    globalSearchQuery,
    setGlobalSearchQuery,
    globalReplaceText,
    setGlobalReplaceText,
    globalReplaceMode,
    setGlobalReplaceMode,
    globalSearchResults,
    setGlobalSearchResults,
    activeSearchIdx,
    setActiveSearchIdx,
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
