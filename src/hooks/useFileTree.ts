/**
 * @file useFileTree.ts
 * @description 가상 파일 트리 상태·갱신(`refreshTree`), 역할별 파생 트리(`projectRootTree`, `archiveRootTree`, `gitRootTree`), 이번 주 일기 및 달력 셀 계산 훅.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArchiveTreeFolder,
  BaseFolderConfig,
  BaseFolderRole,
  DocumentPayload,
  FileNode,
  FolderSectionMode,
} from '../types/mylore';
import { DEFAULT_BASE_FOLDERS, getVirtualTree } from '../services/tauriClient';

export interface UseFileTreeParams {
  currentDoc: DocumentPayload | null;
  bodyText: string;
  yamlText: string;
}

export function useFileTree({
  currentDoc,
  bodyText,
  yamlText,
}: UseFileTreeParams) {
  const [baseFolders, setBaseFolders] =
    useState<BaseFolderConfig[]>(DEFAULT_BASE_FOLDERS);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [treeFilter, setTreeFilter] = useState('');
  const [activeTreeRoleTab, setActiveTreeRoleTab] =
    useState<BaseFolderRole>('projects');

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

  // 새 일정 달력 모달 (`파일 > 새 파일 > 새 일정`) 및 다이어리 대쉬보드 월 선택
  const [calendarYearMonth, setCalendarYearMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

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

  // 아카이브(data) 문서가 엑세스(열람)되었을 때, 해당 파일까지의 상위 폴더 경로를 열어줌
  useEffect(() => {
    if (!currentDoc || currentDoc.role !== 'data') return;
    const parts = currentDoc.relativePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 1) return;
    setOpenArchiveFolders((prev) => {
      const next = new Set(prev);
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        next.add(acc);
      }
      return next;
    });
  }, [currentDoc?.fullPath, currentDoc?.role, currentDoc?.relativePath]);

  // 프로젝트/일기/Git 문서가 열렸을 때, 폴더 뷰어에서 해당 상위 폴더 경로를 열어줌
  useEffect(() => {
    setSubDocFilter('');
    if (
      currentDoc?.role &&
      (['projects', 'diary', 'data', 'git'] as string[]).includes(
        currentDoc.role
      )
    ) {
      setActiveTreeRoleTab(currentDoc.role as BaseFolderRole);
    }
    if (!currentDoc || currentDoc.role === 'data') return;
    const parts = currentDoc.relativePath.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 1) return;
    const prefix =
      currentDoc.role === 'git'
        ? 'git:'
        : currentDoc.role === 'diary'
          ? 'diary:'
          : '';
    setOpenProjectFolders((prev) => {
      const next = new Set(prev);
      let acc = prefix;
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc
          ? acc.endsWith(':')
            ? `${acc}/${parts[i]}`
            : `${acc}/${parts[i]}`
          : parts[i];
        next.add(acc);
      }
      return next;
    });
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

  // 일기(diary) 파일 목록으로 폴더 계층형 트리 구성
  const diaryRootTree = useMemo<ArchiveTreeFolder>(() => {
    const root: ArchiveTreeFolder = {
      name: '일기',
      pathKey: 'diary:',
      folders: [],
      files: [],
    };
    const filterLower = treeFilter.trim().toLowerCase();
    const diaryFiles = flattenedFiles.filter(
      (f) =>
        f.role === 'diary' &&
        (filterLower === '' ||
          f.name.toLowerCase().includes(filterLower) ||
          f.relativePath.toLowerCase().includes(filterLower) ||
          (f.title || '').toLowerCase().includes(filterLower))
    );

    for (const file of diaryFiles) {
      const parts = file.relativePath.split(/[\\/]+/).filter(Boolean);
      if (parts.length <= 1) {
        root.files.push(file);
        continue;
      }
      let curr = root;
      let accKey = 'diary:';
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

    const sortDiaryTree = (folder: ArchiveTreeFolder) => {
      folder.folders.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      folder.files.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      for (const sub of folder.folders) {
        sortDiaryTree(sub);
      }
    };
    sortDiaryTree(root);
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

  // 달력 그리드 생성 헬퍼 (`파일 > 새 파일 > 새 일정` 및 `대쉬보드 > 다이어리`)
  const calendarDays = useMemo(() => {
    const { year, month } = calendarYearMonth;
    const firstDay = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();
    const cells: Array<{
      day: number | null;
      dateStr: string;
      events: FileNode[];
    }> = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push({ day: null, dateStr: '', events: [] });
    }
    for (let d = 1; d <= lastDate; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(
        d
      ).padStart(2, '0')}`;
      const events = diaryFilesSorted.filter((f) => f.name.startsWith(dateStr));
      cells.push({ day: d, dateStr, events });
    }
    return cells;
  }, [calendarYearMonth, diaryFilesSorted]);

  return {
    baseFolders,
    setBaseFolders,
    fileTree,
    setFileTree,
    treeFilter,
    setTreeFilter,
    activeTreeRoleTab,
    setActiveTreeRoleTab,
    sectionModes,
    setSectionModes,
    openArchiveFolders,
    setOpenArchiveFolders,
    expandedArchiveMore,
    setExpandedArchiveMore,
    openProjectFolders,
    setOpenProjectFolders,
    subDocFilter,
    setSubDocFilter,
    subDocViewStyle,
    setSubDocViewStyle,
    calendarYearMonth,
    setCalendarYearMonth,
    refreshTree,
    flattenedFiles,
    diaryFilesSorted,
    currentWeekRange,
    isTopPriorityProjectNode,
    isThisWeekDiaryNode,
    archiveRootTree,
    projectRootTree,
    gitRootTree,
    diaryRootTree,
    currentProjectSubDocs,
    calendarDays,
  };
}
