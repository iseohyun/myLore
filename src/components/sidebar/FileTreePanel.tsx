/**
 * @file FileTreePanel.tsx
 * @description 우측 사이드바 가상 통합 파일 트리: 프로젝트(`main.md` 우선순위)·이번 주 일기·아카이브·Git 저장소 계층형 폴더 트리 렌더링.
 */
import React from 'react';
import {
  ArchiveTreeFolder,
  BaseFolderRole,
  ContextMenuState,
  DocumentPayload,
  FileNode,
  FolderSectionMode,
  TrashedFileRecord,
} from '../../types/mylore';

export interface FileTreePanelProps {
  treeFilter: string;
  setTreeFilter: React.Dispatch<React.SetStateAction<string>>;
  trashHistory: TrashedFileRecord[];
  handleRestoreTrashedDocument: () => void;
  sectionModes: Record<BaseFolderRole, FolderSectionMode>;
  setSectionModes: React.Dispatch<
    React.SetStateAction<Record<BaseFolderRole, FolderSectionMode>>
  >;
  flattenedFiles: FileNode[];
  isTopPriorityProjectNode: (f: FileNode) => boolean;
  isThisWeekDiaryNode: (f: FileNode) => boolean;
  currentDoc: DocumentPayload | null;
  projectRootTree: ArchiveTreeFolder;
  archiveRootTree: ArchiveTreeFolder;
  gitRootTree: ArchiveTreeFolder;
  currentWeekRange: { start: string; end: string };
  openProjectFolders: Set<string>;
  setOpenProjectFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  openArchiveFolders: Set<string>;
  setOpenArchiveFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedArchiveMore: Set<string>;
  setExpandedArchiveMore: React.Dispatch<React.SetStateAction<Set<string>>>;
  setIsFolderPaneFocused: React.Dispatch<React.SetStateAction<boolean>>;
  openDocumentByNode: (node: FileNode) => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function FileTreePanel({
  treeFilter,
  setTreeFilter,
  trashHistory,
  handleRestoreTrashedDocument,
  sectionModes,
  setSectionModes,
  flattenedFiles,
  isTopPriorityProjectNode,
  isThisWeekDiaryNode,
  currentDoc,
  projectRootTree,
  archiveRootTree,
  gitRootTree,
  currentWeekRange,
  openProjectFolders,
  setOpenProjectFolders,
  openArchiveFolders,
  setOpenArchiveFolders,
  expandedArchiveMore,
  setExpandedArchiveMore,
  setIsFolderPaneFocused,
  openDocumentByNode,
  setContextMenu,
  setStatusMessage,
}: FileTreePanelProps) {
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

  return (
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

      {(['projects', 'diary', 'data', 'git'] as BaseFolderRole[]).map(
        (roleKey) => {
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
                f.name.toLowerCase().includes(treeFilter.toLowerCase()) ||
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
                  {renderProjectFolderLevel(projectRootTree, 0, mode)}
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
                          currentDoc?.fullPath === node.fullPath ? 'active' : ''
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
                          <span>{node.name === 'main.md' ? '⭐' : '📄'}</span>
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
        }
      )}
    </>
  );
}
