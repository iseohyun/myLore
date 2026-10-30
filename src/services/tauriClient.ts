import { invoke } from '@tauri-apps/api/core';
import {
  BaseFolderConfig,
  BaseFolderRole,
  BatchScanSummary,
  DetachedPreviewState,
  DocumentPayload,
  FileNode,
  FinanceTransaction,
  GeminiApiKeyStatus,
  LifelogMessage,
  MediaInboxItem,
  MobilePairingPayload,
  MyLoreAppSettings,
  ScanProgressPayload,
  SearchMatchItem,
  TaskPriorityCode,
  ThemePresetId,
  TrashedFileRecord,
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
    label: 'iseohyunDocs (아카이브)',
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

export async function takePendingCliFiles(): Promise<string[]> {
  if (isTauriEnv()) {
    return await invoke<string[]>('take_pending_cli_files');
  }
  return [];
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

export async function trashDocument(
  fullPath: string
): Promise<TrashedFileRecord> {
  if (isTauriEnv()) {
    return await invoke<TrashedFileRecord>('trash_document', { fullPath });
  }
  throw new Error('Tauri 데스크톱 환경에서만 휴지통 이동이 지원됩니다.');
}

export async function restoreTrashedDocument(
  trashId?: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('restore_trashed_document', {
      trashId: trashId ?? null,
    });
  }
  throw new Error('Tauri 데스크톱 환경에서만 복구가 지원됩니다.');
}

export async function toggleDetachedPreviewWindow(
  initialState: DetachedPreviewState,
  forceOpen?: boolean
): Promise<boolean> {
  if (isTauriEnv()) {
    return await invoke<boolean>('toggle_detached_preview_window', {
      forceOpen: forceOpen ?? null,
      initialState,
    });
  }
  return false;
}

export async function syncDetachedPreviewState(
  payload: DetachedPreviewState
): Promise<void> {
  if (isTauriEnv()) {
    await invoke('sync_detached_preview_state', { payload });
  }
}

export async function getDetachedPreviewState(): Promise<DetachedPreviewState> {
  if (isTauriEnv()) {
    return await invoke<DetachedPreviewState>('get_detached_preview_state');
  }
  return {
    title: '',
    relativePath: '',
    fullPath: '',
    role: '',
    bodyText: '',
    yamlText: '',
  };
}

export async function emitDetachedPreviewAction(params: {
  actionType: 'open-uuid' | 'toggle-task';
  uuid?: string;
  lineIndex?: number;
  nextCode?: TaskPriorityCode;
}): Promise<void> {
  if (isTauriEnv()) {
    await invoke('emit_detached_preview_action', {
      actionType: params.actionType,
      uuid: params.uuid ?? null,
      lineIndex: params.lineIndex ?? null,
      nextCode: params.nextCode ?? null,
    });
  }
}

export const FONT_FAMILY_PRESETS: Array<{ label: string; value: string }> = [
  {
    label: 'Pretendard (기본 프리텐다드)',
    value:
      "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    label: '맑은 고딕 (Malgun Gothic)',
    value: "'Malgun Gothic', '맑은 고딕', sans-serif",
  },
  {
    label: '나눔고딕 (NanumGothic)',
    value: "'NanumGothic', '나눔고딕', 'Malgun Gothic', sans-serif",
  },
  {
    label: '나눔명조 (NanumMyeongjo — 서적/명조풍)',
    value: "'NanumMyeongjo', '나눔명조', 'Batang', serif",
  },
  {
    label: '나눔스퀘어네오 (NanumSquareNeo)',
    value: "'NanumSquareNeo', '나눔스퀘어 네오', 'Malgun Gothic', sans-serif",
  },
  {
    label: '고운돋움 (Gowun Dodum)',
    value: "'Gowun Dodum', '고운돋움', 'Malgun Gothic', sans-serif",
  },
  {
    label: '리디바탕 (RIDIBatang — 이북/바탕체)',
    value: "'RIDIBatang', '리디바탕', 'Batang', serif",
  },
  {
    label: '바탕체 (Batang — 정통 세리프)',
    value: "'Batang', '바탕', Georgia, serif",
  },
  {
    label: 'D2Coding (개발/표 고정폭)',
    value: "'D2Coding', 'Consolas', monospace",
  },
  {
    label: 'JetBrains Mono / Cascadia Code (고정폭)',
    value: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  },
];

export const THEME_PRESETS: Record<
  Exclude<ThemePresetId, 'custom'>,
  {
    name: string;
    desc: string;
    bgPrimary: string;
    bgSecondary: string;
    textPrimary: string;
    textSecondary: string;
    headingColor: string;
    accentPrimary: string;
    tableHeaderBg: string;
    tableHeaderColor: string;
    borderColor: string;
  }
> = {
  dark_indigo: {
    name: '🌙 다크 인디고 (기본)',
    desc: '깊은 다크 네이비 배경과 인디고/보라 포인트 테마',
    bgPrimary: '#0f1117',
    bgSecondary: '#161922',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    headingColor: '#a5b4fc',
    accentPrimary: '#6366f1',
    tableHeaderBg: '#1e2230',
    tableHeaderColor: '#a5b4fc',
    borderColor: '#2b3040',
  },
  light_clean: {
    name: '☀️ 화이트 클린 (라이트)',
    desc: '밝고 선명한 문서 작업용 화이트/블루 라이트 테마',
    bgPrimary: '#ffffff',
    bgSecondary: '#f8fafc',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    headingColor: '#1d4ed8',
    accentPrimary: '#2563eb',
    tableHeaderBg: '#f1f5f9',
    tableHeaderColor: '#1e3a8a',
    borderColor: '#cbd5e1',
  },
  nord_slate: {
    name: '❄️ 노드 슬레이트 (눈 보호 다크)',
    desc: '대비를 낮춘 북유럽풍 차분한 블루그레이 다크 테마',
    bgPrimary: '#242933',
    bgSecondary: '#2e3440',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    headingColor: '#88c0d0',
    accentPrimary: '#5e81ac',
    tableHeaderBg: '#3b4252',
    tableHeaderColor: '#88c0d0',
    borderColor: '#434c5e',
  },
  sepia_warm: {
    name: '📜 세피아 독서 (웜 라이트)',
    desc: '장시간 일기·집필에 적합한 따뜻한 미색 종이 질감 테마',
    bgPrimary: '#fbf7f0',
    bgSecondary: '#f3ece0',
    textPrimary: '#2c221e',
    textSecondary: '#6e5a4f',
    headingColor: '#8c3b1b',
    accentPrimary: '#b45309',
    tableHeaderBg: '#eaddc7',
    tableHeaderColor: '#78350f',
    borderColor: '#d6c7b2',
  },
  emerald_forest: {
    name: '🌲 에메랄드 포레스트 (다크)',
    desc: '차분한 딥 그린 & 민트 액센트 테마',
    bgPrimary: '#0b1512',
    bgSecondary: '#11221d',
    textPrimary: '#ecfdf5',
    textSecondary: '#86efac',
    headingColor: '#34d399',
    accentPrimary: '#10b981',
    tableHeaderBg: '#163029',
    tableHeaderColor: '#6ee7b7',
    borderColor: '#1f4238',
  },
};

export const DEFAULT_APP_SETTINGS: MyLoreAppSettings = {
  f11ViewerMode: 'detached',
  autoSaveEnabled: true,
  defaultEditorViewMode: 'split',
  defaultMenuBarExpanded: false,
  scrollSyncEnabled: true,
  autoCallTranscription: true,
  baseFontFamily: FONT_FAMILY_PRESETS[0].value,
  headingFontFamily: FONT_FAMILY_PRESETS[0].value,
  tableFontFamily: FONT_FAMILY_PRESETS[0].value,
  baseFontSize: 14,
  headingScale: 1.0,
  tableFontSize: 13,
  themePreset: 'dark_indigo',
  ...THEME_PRESETS.dark_indigo,
  settingsFilePath:
    'C:\\Users\\iseoh\\OneDrive\\Projects\\.myLore\\setting.json',
};

export function applyAppSettingsToDocument(settings: MyLoreAppSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--font-sans', settings.baseFontFamily);
  root.style.setProperty('--font-base', settings.baseFontFamily);
  root.style.setProperty('--font-heading', settings.headingFontFamily);
  root.style.setProperty('--font-table', settings.tableFontFamily);
  root.style.setProperty('--font-size-base', `${settings.baseFontSize}px`);
  root.style.setProperty('--font-size-table', `${settings.tableFontSize}px`);
  root.style.setProperty('--heading-scale', String(settings.headingScale));
  root.style.setProperty('--bg-primary', settings.bgPrimary);
  root.style.setProperty('--bg-secondary', settings.bgSecondary);
  root.style.setProperty('--bg-tertiary', settings.tableHeaderBg);
  root.style.setProperty('--bg-elevated', settings.bgSecondary);
  root.style.setProperty('--text-primary', settings.textPrimary);
  root.style.setProperty('--text-secondary', settings.textSecondary);
  root.style.setProperty('--heading-color', settings.headingColor);
  root.style.setProperty('--accent-primary', settings.accentPrimary);
  root.style.setProperty('--accent-hover', settings.accentPrimary);
  root.style.setProperty('--table-header-bg', settings.tableHeaderBg);
  root.style.setProperty('--table-header-color', settings.tableHeaderColor);
  root.style.setProperty('--border-color', settings.borderColor);
}

export async function getAppSettings(): Promise<MyLoreAppSettings> {
  if (isTauriEnv()) {
    const loaded = await invoke<MyLoreAppSettings>('get_app_settings');
    return { ...DEFAULT_APP_SETTINGS, ...loaded };
  }
  const saved = localStorage.getItem('mylore_app_settings');
  if (saved) {
    try {
      return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
  }
  return DEFAULT_APP_SETTINGS;
}

export async function saveAppSettings(
  settings: MyLoreAppSettings
): Promise<MyLoreAppSettings> {
  if (isTauriEnv()) {
    return await invoke<MyLoreAppSettings>('save_app_settings', {
      settings,
    });
  }
  const next: MyLoreAppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...settings,
  };
  localStorage.setItem('mylore_app_settings', JSON.stringify(next));
  return next;
}

export async function syncDetachedPreviewScroll(
  topLine: number,
  scrollRatio: number
): Promise<void> {
  if (isTauriEnv()) {
    await invoke('sync_detached_preview_scroll', { topLine, scrollRatio });
  }
}

export async function getMobilePairingInfo(): Promise<MobilePairingPayload> {
  if (isTauriEnv()) {
    return await invoke<MobilePairingPayload>('get_mobile_pairing_info');
  }
  const fallbackObj = {
    v: 1,
    pc_name: 'MYLORE-DESKTOP',
    ips: ['127.0.0.1'],
    port: 18443,
    token: 'mylore_sec_demo_token',
    ssids: ['iseohyun', 'seohyun5G'],
    created_at: Date.now(),
  };
  const qrJsonRaw = JSON.stringify(fallbackObj);
  return {
    qrJsonRaw,
    qrBase64: `myloresync://pair?data=${btoa(qrJsonRaw)}`,
    pcName: 'MYLORE-DESKTOP',
    ips: ['127.0.0.1'],
    port: 18443,
    token: 'mylore_sec_demo_token',
    ssids: ['iseohyun', 'seohyun5G'],
    pairedDevices: [],
    lastNotiTs: 0,
    lastSmsTs: 0,
    lastCallTs: 0,
  };
}

export async function updateMobilePairingConfig(
  ssids: string[],
  regenerateToken: boolean
): Promise<MobilePairingPayload> {
  if (isTauriEnv()) {
    return await invoke<MobilePairingPayload>('update_mobile_pairing_config', {
      ssids,
      regenerateToken,
    });
  }
  return await getMobilePairingInfo();
}

export async function removePairedMobileDevice(
  deviceId: string
): Promise<MobilePairingPayload> {
  if (isTauriEnv()) {
    return await invoke<MobilePairingPayload>('remove_paired_mobile_device', {
      deviceId,
    });
  }
  return await getMobilePairingInfo();
}

export async function triggerFullMobileResync(): Promise<MobilePairingPayload> {
  if (isTauriEnv()) {
    return await invoke<MobilePairingPayload>('trigger_full_mobile_resync');
  }
  return await getMobilePairingInfo();
}

export async function getAllLifelogMessages(
  limit?: number
): Promise<LifelogMessage[]> {
  if (isTauriEnv()) {
    return await invoke<LifelogMessage[]>('get_all_lifelog_messages', {
      limit: limit ?? 4000,
    });
  }
  return [];
}

export async function getMobileContactsMap(): Promise<Record<string, string>> {
  if (isTauriEnv()) {
    return await invoke<Record<string, string>>('get_mobile_contacts_map');
  }
  return {};
}

export async function openLifelogItemDocument(params: {
  source: string;
  roomOrSender: string;
  attachmentUuid?: string | null;
  sentDate?: string | null;
}): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('open_lifelog_item_document', {
      source: params.source,
      roomOrSender: params.roomOrSender,
      attachmentUuid: params.attachmentUuid ?? null,
      sentDate: params.sentDate ?? null,
    });
  }
  throw new Error('Tauri 환경에서만 동작합니다.');
}

export async function retryPendingCallTranscriptions(): Promise<GeminiApiKeyStatus> {
  if (isTauriEnv()) {
    return await invoke<GeminiApiKeyStatus>('retry_pending_call_transcriptions');
  }
  return await getGeminiApiKeyStatus();
}

export async function setAutoCallTranscription(
  enabled: boolean
): Promise<GeminiApiKeyStatus> {
  if (isTauriEnv()) {
    return await invoke<GeminiApiKeyStatus>('set_auto_call_transcription', {
      enabled,
    });
  }
  return await getGeminiApiKeyStatus();
}

export async function getCallRecordingPlayInfo(params: {
  roomOrSender: string;
  attachmentUuid?: string | null;
}): Promise<{
  audioUrl: string;
  fullPath: string;
  fileName: string;
  contactDisplay: string;
  hasTranscript: boolean;
  audioBase64?: string;
  mimeType?: string;
}> {
  if (isTauriEnv()) {
    return await invoke('get_call_recording_play_info', {
      roomOrSender: params.roomOrSender,
      attachmentUuid: params.attachmentUuid ?? null,
    });
  }
  throw new Error('Tauri 환경에서만 동작합니다.');
}

export async function transcribeSingleCallItem(params: {
  roomOrSender: string;
  attachmentUuid?: string | null;
}): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('transcribe_single_call_item', {
      roomOrSender: params.roomOrSender,
      attachmentUuid: params.attachmentUuid ?? null,
    });
  }
  throw new Error('Tauri 환경에서만 동작합니다.');
}

export async function sendMobileUdpWakeBroadcast(): Promise<string> {
  if (isTauriEnv()) {
    return await invoke<string>('send_mobile_udp_wake_broadcast');
  }
  return 'UDP 브로드캐스트 송출 완료';
}

export async function getGeminiApiKeyStatus(): Promise<GeminiApiKeyStatus> {
  if (isTauriEnv()) {
    return await invoke<GeminiApiKeyStatus>('get_gemini_api_key_status');
  }
  return {
    hasKey: false,
    maskedKey: '',
    modelName: 'gemini-3.8-flash',
    lastVerifiedAt: '',
    storageLocation: '%APPDATA%\\com.iseohyun.mylore\\gemini_secret.json',
  };
}

export async function saveAndVerifyGeminiApiKey(
  apiKey: string
): Promise<GeminiApiKeyStatus> {
  if (isTauriEnv()) {
    return await invoke<GeminiApiKeyStatus>('save_and_verify_gemini_api_key', {
      apiKey,
    });
  }
  return {
    hasKey: Boolean(apiKey.trim()),
    maskedKey: apiKey.trim() ? 'AIzaSy••••••••••••••••' : '',
    modelName: 'gemini-3.8-flash',
    lastVerifiedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    storageLocation: '%APPDATA%\\com.iseohyun.mylore\\gemini_secret.json',
  };
}

export async function transcribeLocalAudioFile(
  audioPath: string,
  contactName: string
): Promise<string> {
  if (isTauriEnv()) {
    return await invoke<string>('transcribe_local_audio_file', {
      audioPath,
      contactName,
    });
  }
  return '데모 환경 통화 녹음 스크립트 변환 결과입니다.';
}



