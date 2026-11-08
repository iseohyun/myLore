/**
 * @file SplitDocumentWorkspace.tsx
 * @description 에디터 좌우 수평 분할(`Ctrl+\`), 좌/우 에디터 문서 이동(`Ctrl+Alt+→` / `Ctrl+Alt+←`), 뷰어 토글(`Ctrl+E`) 래퍼 컴포넌트.
 * - 1단(분할 없음): 기존 `<DocumentWorkspace />`를 그대로 렌더링 (`Ctrl+E`: 에디터 → 뷰어 → 스플릿 순환)
 * - 2단(분할 중): 중복 문서 제목 탭 바 없이 좌/우 에디터 본문과 중앙 드래그 리사이저만 렌더링 (`Ctrl+E`: 포커스된 페인의 에디터 ↔ 뷰어 전환)
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { OpenDocumentTab } from '../../types/mylore';
import {
  DocumentWorkspace,
  DocumentWorkspaceProps,
} from './DocumentWorkspace';

export interface SplitDocumentWorkspaceProps extends DocumentWorkspaceProps {
  openTabs: OpenDocumentTab[];
  setOpenTabs: React.Dispatch<React.SetStateAction<OpenDocumentTab[]>>;
  activeTabPath: string | null;
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  isHorizontalSplitOpen: boolean;
  setIsHorizontalSplitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  focusedEditorPane: 'left' | 'right';
  setFocusedEditorPane: React.Dispatch<React.SetStateAction<'left' | 'right'>>;
  leftPaneTabPath: string | null;
  setLeftPaneTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  rightPaneTabPath: string | null;
  setRightPaneTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  rightPaneTabPaths: string[];
  setRightPaneTabPaths: React.Dispatch<React.SetStateAction<string[]>>;
  leftPaneViewMode: 'editor' | 'split' | 'preview';
  setLeftPaneViewMode: React.Dispatch<
    React.SetStateAction<'editor' | 'split' | 'preview'>
  >;
  rightPaneViewMode: 'editor' | 'split' | 'preview';
  setRightPaneViewMode: React.Dispatch<
    React.SetStateAction<'editor' | 'split' | 'preview'>
  >;
  horizontalSplitRatio: number;
  setHorizontalSplitRatio: React.Dispatch<React.SetStateAction<number>>;
  focusEditorPane: (pane: 'left' | 'right', targetPath?: string) => void;
  handleCycleViewerMode: () => void;
  handleToggleHorizontalSplit: () => void;
  handleMoveDocToRightEditor: () => void;
  handleMoveDocToLeftEditor: () => void;
  handleSelectDocViewMode: (
    nextMode: 'editor' | 'split' | 'preview'
  ) => Promise<void> | void;
  closeTab: (fullPath: string, e?: React.MouseEvent) => void;
  renderDashboardPane?: (dashPath: string) => React.ReactNode;
}

export function SplitDocumentWorkspace(props: SplitDocumentWorkspaceProps) {
  const {
    openTabs,
    setOpenTabs,
    activeTabPath,
    isHorizontalSplitOpen,
    focusedEditorPane,
    leftPaneTabPath,
    rightPaneTabPath,
    rightPaneTabPaths,
    leftPaneViewMode,
    rightPaneViewMode,
    horizontalSplitRatio,
    setHorizontalSplitRatio,
    focusEditorPane,
    viewMode,
    editorRef,
    previewPaneRef,
    findBarMode,
    renderDashboardPane,
  } = props;

  const leftEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const leftPreviewRef = useRef<HTMLDivElement | null>(null);
  const rightEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const rightPreviewRef = useRef<HTMLDivElement | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const leftTab = useMemo(() => {
    if (leftPaneTabPath) {
      const found = openTabs.find((t) => t.doc.fullPath === leftPaneTabPath);
      if (found) return found;
    }
    return (
      openTabs.find((t) => !rightPaneTabPaths.includes(t.doc.fullPath)) ||
      openTabs[0] ||
      null
    );
  }, [openTabs, leftPaneTabPath, rightPaneTabPaths]);

  const rightTab = useMemo(() => {
    if (rightPaneTabPath) {
      const found = openTabs.find((t) => t.doc.fullPath === rightPaneTabPath);
      if (found) return found;
    }
    const firstRight = openTabs.find((t) =>
      rightPaneTabPaths.includes(t.doc.fullPath)
    );
    return firstRight || leftTab || null;
  }, [openTabs, rightPaneTabPath, rightPaneTabPaths, leftTab]);

  // 포커스된 페인(left/right)의 textarea / preview ref를 상위 공용 editorRef / previewPaneRef에 동기화
  useEffect(() => {
    if (!isHorizontalSplitOpen) return;
    if (focusedEditorPane === 'right') {
      editorRef.current = rightEditorRef.current;
      previewPaneRef.current = rightPreviewRef.current;
    } else {
      editorRef.current = leftEditorRef.current;
      previewPaneRef.current = leftPreviewRef.current;
    }
  }, [
    isHorizontalSplitOpen,
    focusedEditorPane,
    leftTab?.doc.fullPath,
    rightTab?.doc.fullPath,
    viewMode,
    leftPaneViewMode,
    rightPaneViewMode,
  ]);

  // 1단(단일 화면 모드)일 때: 대시보드 탭이면 대시보드 렌더링, 문서 탭이면 DocumentWorkspace 렌더링
  if (!isHorizontalSplitOpen) {
    if (
      activeTabPath &&
      activeTabPath.startsWith('mylore://dashboard/') &&
      renderDashboardPane
    ) {
      return <>{renderDashboardPane(activeTabPath)}</>;
    }
    return <DocumentWorkspace {...props} />;
  }

  const createSetBodyTextForPath =
    (targetPath: string | undefined) =>
    (updater: string | ((prev: string) => string)) => {
      if (!targetPath) return;
      setOpenTabs((prev) =>
        prev.map((tab) => {
          if (tab.doc.fullPath !== targetPath) return tab;
          const nextBody =
            typeof updater === 'function' ? updater(tab.bodyText) : updater;
          return { ...tab, bodyText: nextBody, isDirty: true };
        })
      );
    };

  const createSetYamlTextForPath =
    (targetPath: string | undefined) => (nextYaml: string) => {
      if (!targetPath) return;
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.doc.fullPath === targetPath
            ? { ...tab, yamlText: nextYaml, isDirty: true }
            : tab
        )
      );
    };

  const handleDividerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relX = moveEvent.clientX - rect.left;
      const pct = Math.max(22, Math.min(78, (relX / rect.width) * 100));
      setHorizontalSplitRatio(Math.round(pct * 10) / 10);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const leftDocPath = leftTab?.doc.fullPath;
  const rightDocPath = rightTab?.doc.fullPath;
  const isLeftCall = Boolean(
    leftTab?.doc.frontmatter['source'] === 'mobile_call' ||
      leftTab?.doc.relativePath.includes('통화녹음') ||
      leftTab?.doc.relativePath.includes('Call')
  );
  const isRightCall = Boolean(
    rightTab?.doc.frontmatter['source'] === 'mobile_call' ||
      rightTab?.doc.relativePath.includes('통화녹음') ||
      rightTab?.doc.relativePath.includes('Call')
  );
  const isLeftSms = Boolean(
    leftTab?.doc.frontmatter['source'] === 'mobile_sms' ||
      leftTab?.doc.frontmatter['source'] === 'mobile_kakao'
  );
  const isRightSms = Boolean(
    rightTab?.doc.frontmatter['source'] === 'mobile_sms' ||
      rightTab?.doc.frontmatter['source'] === 'mobile_kakao'
  );

  // 2단 분할 중일 때 각 페인은 에디터('editor') 또는 뷰어('preview') 모드로 동작
  const effectiveLeftMode: 'editor' | 'preview' =
    leftPaneViewMode === 'preview' ? 'preview' : 'editor';
  const effectiveRightMode: 'editor' | 'preview' =
    rightPaneViewMode === 'preview' ? 'preview' : 'editor';

  return (
    <div
      ref={splitContainerRef}
      className="horizontal-editor-split-wrapper"
    >
      {/* 1. 왼쪽 페인 (문서 또는 대시보드) */}
      <div
        className={`horizontal-editor-group ${
          focusedEditorPane === 'left' ? 'focused-pane' : ''
        }`}
        style={{ width: `${horizontalSplitRatio}%` }}
        onMouseDown={() => {
          if (focusedEditorPane !== 'left') {
            focusEditorPane('left', leftDocPath);
          }
          editorRef.current = leftEditorRef.current;
          previewPaneRef.current = leftPreviewRef.current;
        }}
      >
        <div className="horizontal-pane-body">
          {leftDocPath &&
          leftDocPath.startsWith('mylore://dashboard/') &&
          renderDashboardPane ? (
            renderDashboardPane(leftDocPath)
          ) : (
            <DocumentWorkspace
              {...props}
              currentDoc={leftTab?.doc || null}
              yamlText={leftTab?.yamlText ?? ''}
              bodyText={leftTab?.bodyText ?? ''}
              setBodyText={createSetBodyTextForPath(leftDocPath)}
              setYamlText={createSetYamlTextForPath(leftDocPath)}
              isCurrentDocCall={isLeftCall}
              isCurrentDocSms={isLeftSms}
              viewMode={effectiveLeftMode}
              editorRef={leftEditorRef}
              previewPaneRef={leftPreviewRef}
              findBarMode={focusedEditorPane === 'left' ? findBarMode : 'closed'}
            />
          )}
        </div>
      </div>

      {/* 2. 수평 분할 드래그 리사이저 바 */}
      <div
        className="horizontal-editor-split-divider"
        onMouseDown={handleDividerMouseDown}
        onDoubleClick={() => setHorizontalSplitRatio(50)}
        title="드래그하여 좌/우 화면 폭 조절 (더블클릭: 50:50 초기화)"
      />

      {/* 3. 오른쪽 페인 (문서 또는 대시보드) */}
      <div
        className={`horizontal-editor-group ${
          focusedEditorPane === 'right' ? 'focused-pane' : ''
        }`}
        style={{ width: `${100 - horizontalSplitRatio}%` }}
        onMouseDown={() => {
          if (focusedEditorPane !== 'right') {
            focusEditorPane('right', rightDocPath);
          }
          editorRef.current = rightEditorRef.current;
          previewPaneRef.current = rightPreviewRef.current;
        }}
      >
        <div className="horizontal-pane-body">
          {rightDocPath &&
          rightDocPath.startsWith('mylore://dashboard/') &&
          renderDashboardPane ? (
            renderDashboardPane(rightDocPath)
          ) : (
            <DocumentWorkspace
              {...props}
              currentDoc={rightTab?.doc || null}
              yamlText={rightTab?.yamlText ?? ''}
              bodyText={rightTab?.bodyText ?? ''}
              setBodyText={createSetBodyTextForPath(rightDocPath)}
              setYamlText={createSetYamlTextForPath(rightDocPath)}
              isCurrentDocCall={isRightCall}
              isCurrentDocSms={isRightSms}
              viewMode={effectiveRightMode}
              editorRef={rightEditorRef}
              previewPaneRef={rightPreviewRef}
              findBarMode={focusedEditorPane === 'right' ? findBarMode : 'closed'}
            />
          )}
        </div>
      </div>
    </div>
  );
}
