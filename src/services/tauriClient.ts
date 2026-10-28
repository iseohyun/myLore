import { invoke } from '@tauri-apps/api/core';
import {
  BaseFolderConfig,
  BaseFolderRole,
  BatchScanSummary,
  DocumentPayload,
  FileNode,
  FinanceTransaction,
  LifelogMessage,
  MediaInboxItem,
  ScanProgressPayload,
  SearchMatchItem,
  VaultTemplateItem,
} from '../types/mylore';

const isTauriEnv = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export const DEFAULT_BASE_FOLDERS: BaseFolderConfig[] = [
  {
    id: 'base-data-1',
    role: 'data',
    path: 'C:\\Users\\iseoh\\OneDrive\\iseohyunDocs',
    label: 'iseohyunDocs (데이터/아카이브)',
    purpose: '과거 문서, 위키, 부동산/재정, 미디어 원본 아카이브 및 분류 대기 문서',
    enabled: true,
  },
  {
    id: 'base-diary-1',
    role: 'diary',
    path: 'C:\\Users\\iseoh\\OneDrive\\Diary',
    label: 'OneDrive Diary (일기)',
    purpose: '매일의 주관적 작업/일상 기록 및 구글 캘린더 1:1 양방향 동기화 폴더',
    enabled: true,
  },
  {
    id: 'base-projects-1',
    role: 'projects',
    path: 'C:\\Users\\iseoh\\OneDrive\\Projects',
    label: 'OneDrive Projects (프로젝트)',
    purpose: '폴더별 main.md 기반 개발·아티클·영상 제작 프로젝트 관리 폴더',
    enabled: true,
  },
];

export async function getBaseFolders(): Promise<BaseFolderConfig[]> {
  if (isTauriEnv()) {
    return await invoke<BaseFolderConfig[]>('get_base_folders');
  }
  const saved = localStorage.getItem('mylore_base_folders');
  return saved ? JSON.parse(saved) : DEFAULT_BASE_FOLDERS;
}

export async function saveBaseFolders(
  folders: BaseFolderConfig[]
): Promise<BaseFolderConfig[]> {
  if (isTauriEnv()) {
    return await invoke<BaseFolderConfig[]>('save_base_folders', { folders });
  }
  localStorage.setItem('mylore_base_folders', JSON.stringify(folders));
  return folders;
}

export async function startBatchUuidScan(): Promise<ScanProgressPayload> {
  if (isTauriEnv()) {
    return await invoke<ScanProgressPayload>('start_batch_uuid_scan');
  }
  return {
    isRunning: false,
    phase: 'done',
    totalFiles: 0,
    alreadyRegistered: 0,
    pendingFiles: 0,
    completedFiles: 0,
    startPercent: 100,
    currentPercent: 100,
    uuidsInjected: 0,
    mediaIndexed: 0,
    linksIndexed: 0,
    currentFile: '',
    etaSeconds: 0,
  };
}

export async function getScanProgress(): Promise<ScanProgressPayload> {
  if (isTauriEnv()) {
    return await invoke<ScanProgressPayload>('get_scan_progress');
  }
  return {
    isRunning: false,
    phase: 'idle',
    totalFiles: 0,
    alreadyRegistered: 0,
    pendingFiles: 0,
    completedFiles: 0,
    startPercent: 0,
    currentPercent: 0,
    uuidsInjected: 0,
    mediaIndexed: 0,
    linksIndexed: 0,
    currentFile: '',
    etaSeconds: 0,
  };
}

export async function scanAndInjectUuids(): Promise<BatchScanSummary> {
  if (isTauriEnv()) {
    return await invoke<BatchScanSummary>('scan_and_inject_uuids');
  }
  return {
    scannedFiles: 0,
    uuidsInjected: 0,
    mediaIndexed: 0,
    linksIndexed: 0,
  };
}

export async function getVirtualTree(): Promise<FileNode[]> {
  if (isTauriEnv()) {
    return await invoke<FileNode[]>('get_virtual_tree');
  }
  return [];
}

export async function readDocument(fullPath: string): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('read_document', { fullPath });
  }
  throw new Error('Tauri runtime required to read local files');
}

export async function readDocumentByUuid(
  uuid: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('read_document_by_uuid', { uuid });
  }
  throw new Error('Tauri runtime required');
}

export async function saveDocument(
  fullPath: string,
  rawContent: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('save_document', {
      fullPath,
      rawContent,
    });
  }
  throw new Error('Tauri runtime required');
}

export async function createNewDocument(params: {
  role: BaseFolderRole;
  title: string;
  dateStr?: string;
  calendarCategory?: string;
  location?: string;
  isProjectFolder?: boolean;
  templateFile?: string;
  subFolder?: string;
}): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('create_new_document', { params });
  }
  throw new Error('Tauri runtime required');
}

export async function createTempMemo(title?: string): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('create_temp_memo', {
      title: title ?? null,
    });
  }
  throw new Error('Tauri runtime required');
}

export async function openRootMainMd(): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('open_root_main_md');
  }
  throw new Error('Tauri runtime required');
}

export async function showInExplorer(fullPath: string): Promise<void> {
  if (isTauriEnv()) {
    await invoke('show_in_explorer', { fullPath });
  }
}

export async function renameCurrentDocument(
  sourceFullPath: string,
  newTitle: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('rename_current_document', {
      sourceFullPath,
      newTitle,
    });
  }
  throw new Error('Tauri runtime required');
}

export async function toggleWindowFullscreen(): Promise<boolean> {
  if (isTauriEnv()) {
    return await invoke<boolean>('toggle_window_fullscreen');
  }
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen().catch(() => {});
    return true;
  } else {
    await document.exitFullscreen().catch(() => {});
    return false;
  }
}

export async function searchInFiles(query: string): Promise<SearchMatchItem[]> {
  if (isTauriEnv()) {
    return await invoke<SearchMatchItem[]>('search_in_files', { query });
  }
  return [];
}

export async function replaceInFiles(
  query: string,
  replacement: string
): Promise<number> {
  if (isTauriEnv()) {
    return await invoke<number>('replace_in_files', { query, replacement });
  }
  return 0;
}

export async function openNativeFileDialog(): Promise<string | null> {
  if (isTauriEnv()) {
    return await invoke<string | null>('open_native_file_dialog');
  }
  return null;
}

export async function openNativeFolderDialog(): Promise<string | null> {
  if (isTauriEnv()) {
    return await invoke<string | null>('open_native_folder_dialog');
  }
  return null;
}

export async function getVaultTemplates(): Promise<VaultTemplateItem[]> {
  if (isTauriEnv()) {
    return await invoke<VaultTemplateItem[]>('get_vault_templates');
  }
  return [];
}

export async function openInChromeAppMode(): Promise<void> {
  if (isTauriEnv()) {
    await invoke('open_in_chrome_app_mode');
    return;
  }
  window.open('http://127.0.0.1:18443', '_blank');
}

export async function promoteToProjectFolder(
  sourceFullPath: string,
  projectName: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('promote_to_project_folder', {
      sourceFullPath,
      projectName,
    });
  }
  throw new Error('Tauri runtime required');
}

export async function moveDocumentToRole(
  sourceFullPath: string,
  targetRole: BaseFolderRole,
  newFileName?: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('move_document_to_role', {
      sourceFullPath,
      targetRole,
      newFileName: newFileName ?? null,
    });
  }
  throw new Error('Tauri runtime required');
}

export async function openExternalUrlInChrome(
  url: string,
  browserPath?: string
): Promise<string> {
  if (isTauriEnv()) {
    await invoke('open_google_calendar_web', {
      url,
      browserPath: browserPath ?? null,
    });
    return url;
  }
  window.open(url, '_blank');
  return url;
}

export async function openGoogleCalendarWeb(
  year: number,
  month: number,
  day: number,
  browserPath?: string
): Promise<string> {
  const url = `https://calendar.google.com/calendar/u/0/r/month/${year}/${month}/${day}?pli=1`;
  return await openExternalUrlInChrome(url, browserPath);
}

export async function getLifelogForDate(dateStr: string): Promise<{
  messages: LifelogMessage[];
  transactions: FinanceTransaction[];
  mediaInbox: MediaInboxItem[];
}> {
  if (isTauriEnv()) {
    return await invoke('get_lifelog_for_date', { dateStr });
  }
  return { messages: [], transactions: [], mediaInbox: [] };
}

export async function getAllFinanceTransactions(): Promise<
  FinanceTransaction[]
> {
  if (isTauriEnv()) {
    return await invoke<FinanceTransaction[]>('get_all_finance_transactions');
  }
  return [];
}

export async function importFinanceRows(
  rows: Array<{
    txDate: string;
    txTime: string;
    institution: string;
    txType: string;
    amount: number;
    merchant: string;
    category: string;
    memo: string;
    source: 'realtime' | 'excel';
  }>
): Promise<{
  insertedNew: number;
  reconciledExisting: number;
  skippedDuplicate: number;
}> {
  if (isTauriEnv()) {
    return await invoke('import_finance_rows', { rows });
  }
  return { insertedNew: 0, reconciledExisting: 0, skippedDuplicate: 0 };
}

export async function parseNotificationIntoFinance(
  packageName: string,
  title: string,
  text: string,
  dateStr: string,
  timeStr: string
): Promise<FinanceTransaction | null> {
  if (isTauriEnv()) {
    return await invoke('parse_notification_into_finance', {
      packageName,
      title,
      text,
      dateStr,
      timeStr,
    });
  }
  return null;
}

export async function importKakaoChatText(
  roomName: string,
  rawText: string
): Promise<{ insertedCount: number }> {
  if (isTauriEnv()) {
    return await invoke('import_kakao_chat_text', { roomName, rawText });
  }
  return { insertedCount: 0 };
}
