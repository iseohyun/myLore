/**
 * @file useDocumentActions.ts
 * @description 문서 조작 액션 훅: 제목 변경(`F2`), 새 문서/일정 생성, 단일 문서→프로젝트 폴더 승격, 역할 이동, Windows 휴지통 이동 및 복원.
 */
import React, { useState } from 'react';
import {
  BaseFolderRole,
  DocumentPayload,
  FileNode,
  OpenDocumentTab,
  TrashedFileRecord,
  VaultTemplateItem,
} from '../types/mylore';
import {
  createNewDocument,
  moveDocumentToRole,
  promoteToProjectFolder,
  readDocument,
  renameCurrentDocument,
  restoreTrashedDocument,
  saveDocument,
  trashDocument,
} from '../services/tauriClient';
import {
  combineYamlAndBody,
  splitYamlFrontmatter,
} from '../utils/markdownAutoFormat';

export interface UseDocumentActionsParams {
  openTabs: OpenDocumentTab[];
  setOpenTabs: React.Dispatch<React.SetStateAction<OpenDocumentTab[]>>;
  activeTabPath: string | null;
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  setTabAccessHistory: React.Dispatch<React.SetStateAction<string[]>>;
  tabAccessHistoryRef: React.MutableRefObject<string[]>;
  currentDoc: DocumentPayload | null;
  yamlText: string;
  bodyText: string;
  isDirty: boolean;
  flattenedFiles: FileNode[];
  refreshTree: () => Promise<void>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
  closeTab: (fullPath: string, e?: React.MouseEvent) => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function useDocumentActions({
  openTabs,
  setOpenTabs,
  activeTabPath,
  setActiveTabPath,
  setTabAccessHistory,
  tabAccessHistoryRef,
  currentDoc,
  yamlText,
  bodyText,
  isDirty,
  flattenedFiles,
  refreshTree,
  applyLoadedDocument,
  closeTab,
  setStatusMessage,
}: UseDocumentActionsParams) {
  const [trashHistory, setTrashHistory] = useState<TrashedFileRecord[]>([]);

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

  const [promoteModalOpen, setPromoteModalOpen] = useState(false);
  const [promoteProjectName, setPromoteProjectName] = useState('');

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
      closeTab(pathToDelete);
      await refreshTree();

      if (
        openTabs.length <= 1 &&
        activeTabPath === pathToDelete &&
        nextCandidate
      ) {
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

  const handleMoveRole = async (
    targetRole: BaseFolderRole,
    sourcePath?: string
  ) => {
    const pathToUse = sourcePath || currentDoc?.fullPath;
    if (!pathToUse) return;
    try {
      const moved = await moveDocumentToRole(pathToUse, targetRole);
      await refreshTree();
      applyLoadedDocument(moved);
      setStatusMessage(
        `🚚 [${targetRole.toUpperCase()}] 폴더로 이동 완료: ${moved.relativePath}`
      );
    } catch (err) {
      setStatusMessage(`문서 이동 오류: ${String(err)}`);
    }
  };

  return {
    trashHistory,
    setTrashHistory,
    renameModalOpen,
    setRenameModalOpen,
    renameTitleInput,
    setRenameTitleInput,
    newDocModalOpen,
    setNewDocModalOpen,
    newDocRole,
    setNewDocRole,
    newDocTitle,
    setNewDocTitle,
    newDocDate,
    setNewDocDate,
    newDocCalendar,
    setNewDocCalendar,
    newDocLocation,
    setNewDocLocation,
    newDocTemplate,
    setNewDocTemplate,
    vaultTemplates,
    setVaultTemplates,
    templateModalOpen,
    setTemplateModalOpen,
    calendarModalOpen,
    setCalendarModalOpen,
    promoteModalOpen,
    setPromoteModalOpen,
    promoteProjectName,
    setPromoteProjectName,
    handleOpenRenameDocModal,
    handleRenameCurrentDocSubmit,
    handleTrashDocument,
    handleRestoreTrashedDocument,
    handleCreateNewDocSubmit,
    handlePromoteToProject,
    handleMoveRole,
  };
}
