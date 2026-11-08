/**
 * @file tauriClient.ts
 * @description Rust 백엔드 `#[tauri::command]` 94개에 대응하는 `invoke()` 래퍼 함수 모음 및 비-Tauri 브라우저 미리보기 폴백.
 */
import { invoke } from '@tauri-apps/api/core';
import {
  BaseFolderConfig, BaseFolderRole, BatchScanSummary, CallAiTranscriptionStats, CallApprovalItem,
  DetachedPreviewState, DocumentPayload, FileNode, FinanceTransaction, GeminiApiKeyStatus,
  GoogleCalendarSyncResult, GoogleCalendarSyncStatus, LifelogMessage, LocationMovementSummary,
  MediaInboxItem, MediaOriginRegistrySummary, MobilePairingPayload, MobileSyncProgressPayload,
  MultiLlmProvidersStatus, MyLoreAppSettings, PcActivitySummaryPayload, ScanProgressPayload,
  SearchMatchItem, ServiceLogsPayload, TaskPriorityCode, TrashedFileRecord, VaultTemplateItem,
} from '../types/mylore';

const isTauriEnv = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// 브라우저(비 Tauri) 미리보기 전용 기본값. 실제 앱에서는 백엔드(db.rs)가
// `%USERPROFILE%\Documents\myLore\{Data,Diary,Projects}`를 기본 베이스 폴더로 등록합니다.
export const DEFAULT_BASE_FOLDERS: BaseFolderConfig[] = [
  { id: 'base-data-1', role: 'data', path: '%USERPROFILE%\\Documents\\myLore\\Data', label: '데이터 (아카이브)', purpose: '과거 문서, 위키, 미디어 원본 아카이브 및 분류 대기 문서', enabled: true },
  { id: 'base-diary-1', role: 'diary', path: '%USERPROFILE%\\Documents\\myLore\\Diary', label: '일기', purpose: '매일의 작업/일상 기록 및 구글 캘린더 1:1 동기화 폴더', enabled: true },
  { id: 'base-projects-1', role: 'projects', path: '%USERPROFILE%\\Documents\\myLore\\Projects', label: '프로젝트', purpose: '폴더별 main.md 기반 프로젝트 관리 폴더', enabled: true },
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
    isRunning: false, phase: 'done', totalFiles: 0, alreadyRegistered: 0, pendingFiles: 0,
    completedFiles: 0, startPercent: 100, currentPercent: 100, uuidsInjected: 0, mediaIndexed: 0,
    linksIndexed: 0, currentFile: '', etaSeconds: 0,
  };
}

export async function getScanProgress(): Promise<ScanProgressPayload> {
  if (isTauriEnv()) {
    return await invoke<ScanProgressPayload>('get_scan_progress');
  }
  return {
    isRunning: false, phase: 'idle', totalFiles: 0, alreadyRegistered: 0, pendingFiles: 0,
    completedFiles: 0, startPercent: 0, currentPercent: 0, uuidsInjected: 0, mediaIndexed: 0,
    linksIndexed: 0, currentFile: '', etaSeconds: 0,
  };
}

export async function scanAndInjectUuids(): Promise<BatchScanSummary> {
  if (isTauriEnv()) {
    return await invoke<BatchScanSummary>('scan_and_inject_uuids');
  }
  return { scannedFiles: 0, uuidsInjected: 0, mediaIndexed: 0, linksIndexed: 0 };
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
  includeLocation?: boolean;
  descriptionMode?: string;
  transparency?: string;
  visibility?: string;
  attendeeEmail?: string;
  attendeeResponseStatus?: string;
  eventStatus?: string;
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

export async function createEmptyDocumentInFolder(
  role: BaseFolderRole,
  subDir?: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('create_empty_document_in_folder', {
      role,
      subDir: subDir ?? null,
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

export async function searchInFiles(
  query: string,
  useRegex?: boolean
): Promise<SearchMatchItem[]> {
  if (isTauriEnv()) {
    return await invoke<SearchMatchItem[]>('search_in_files', {
      query,
      useRegex: Boolean(useRegex),
    });
  }
  return [];
}

export async function replaceInFiles(
  query: string,
  replacement: string,
  useRegex?: boolean,
  useEscape?: boolean
): Promise<number> {
  if (isTauriEnv()) {
    return await invoke<number>('replace_in_files', {
      query,
      replacement,
      useRegex: Boolean(useRegex),
      useEscape: useEscape ?? true,
    });
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
  newFileName?: string,
  targetSubDir?: string
): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('move_document_to_role', {
      sourceFullPath,
      targetRole,
      newFileName: newFileName ?? null,
      targetSubDir: targetSubDir ?? null,
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

export {
  FONT_FAMILY_PRESETS,
  THEME_PRESETS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CALL_ANALYSIS_PROMPT,
  applyAppSettingsToDocument,
} from '../utils/appearancePresets';
import { DEFAULT_APP_SETTINGS } from '../utils/appearancePresets';

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
    ssids: ['MyHomeWiFi'],
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
    ssids: ['MyHomeWiFi'],
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

export async function triggerSequentialMobileSync(): Promise<string> {
  if (isTauriEnv()) {
    return await invoke<string>('trigger_sequential_mobile_sync');
  }
  return 'Tauri 환경에서만 동작합니다.';
}

export async function getMobileSyncProgressState(): Promise<MobileSyncProgressPayload | null> {
  if (isTauriEnv()) {
    return await invoke<MobileSyncProgressPayload>('get_mobile_sync_progress_state');
  }
  return null;
}

export async function getAllLifelogMessages(limit?: number): Promise<LifelogMessage[]> {
  if (isTauriEnv()) return await invoke<LifelogMessage[]>('get_all_lifelog_messages', { limit: limit ?? 4000 });
  return [];
}

export async function getMobileContactsMap(): Promise<Record<string, string>> {
  if (isTauriEnv()) return await invoke<Record<string, string>>('get_mobile_contacts_map');
  return {};
}

export const DEFAULT_CONTACT_PROFILE_TEMPLATE =
  '이 사람의 호칭(복수 가능): \n나를 부르는 호칭: \n소속 모임: \n이 사람은?(직업, 사는곳, 이미지, ): ';

export async function getContactAiProfiles(): Promise<Record<string, string>> {
  if (isTauriEnv()) return await invoke<Record<string, string>>('get_contact_ai_profiles');
  return {};
}

export async function saveContactAiProfile(contactName: string, profileText: string): Promise<Record<string, string>> {
  if (isTauriEnv()) return await invoke<Record<string, string>>('save_contact_ai_profile', { contactName, profileText });
  return { [contactName]: profileText };
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
  roomOrSender: string; attachmentUuid?: string | null; userRequirement?: string | null;
}): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('transcribe_single_call_item', {
      roomOrSender: params.roomOrSender, attachmentUuid: params.attachmentUuid ?? null, userRequirement: params.userRequirement ?? null,
    });
  }
  throw new Error('Tauri 환경에서만 동작합니다.');
}

export async function updateCallTranscriptStage(params: {
  roomOrSender: string; attachmentUuid?: string | null; stage: number; userRequirement?: string | null;
}): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('update_call_transcript_stage', {
      roomOrSender: params.roomOrSender, attachmentUuid: params.attachmentUuid ?? null, stage: params.stage, userRequirement: params.userRequirement ?? null,
    });
  }
  throw new Error('Tauri 환경에서만 동작합니다.');
}

export async function sendMobileUdpWakeBroadcast(): Promise<string> {
  if (isTauriEnv()) return await invoke<string>('send_mobile_udp_wake_broadcast');
  return 'UDP 브로드캐스트 송출 완료';
}

export async function getGeminiApiKeyStatus(): Promise<GeminiApiKeyStatus> {
  if (isTauriEnv()) return await invoke<GeminiApiKeyStatus>('get_gemini_api_key_status');
  return { hasKey: false, maskedKey: '', modelName: 'gemini-3.8-flash', lastVerifiedAt: '', storageLocation: '%APPDATA%\\com.iseohyun.mylore\\gemini_secret.json' };
}

export async function saveAndVerifyGeminiApiKey(apiKey: string): Promise<GeminiApiKeyStatus> {
  if (isTauriEnv()) return await invoke<GeminiApiKeyStatus>('save_and_verify_gemini_api_key', { apiKey });
  return { hasKey: Boolean(apiKey.trim()), maskedKey: apiKey.trim() ? 'AIzaSy••••••••••••••••' : '', modelName: 'gemini-3.8-flash', lastVerifiedAt: '', storageLocation: '%APPDATA%\\com.iseohyun.mylore\\gemini_secret.json' };
}

export async function transcribeLocalAudioFile(audioPath: string, contactName: string): Promise<string> {
  if (isTauriEnv()) return await invoke<string>('transcribe_local_audio_file', { audioPath, contactName });
  return '데모 환경 통화 녹음 스크립트 변환 결과입니다.';
}

export async function getCallAiTranscriptionStats(): Promise<CallAiTranscriptionStats> {
  if (isTauriEnv()) return await invoke<CallAiTranscriptionStats>('get_call_ai_transcription_stats');
  return { totalAudioCalls: 0, completedCalls: 0, remainingCalls: 0, dailyStats: [] };
}

export async function getCallApprovalItems(): Promise<CallApprovalItem[]> {
  if (isTauriEnv()) return await invoke<CallApprovalItem[]>('get_call_approval_items');
  return [];
}

export async function getKakaoUpdateRequests(): Promise<import('../types/mylore').KakaoUpdateRequestItem[]> {
  if (isTauriEnv()) return await invoke('get_kakao_update_requests');
  return [];
}

export async function resolveKakaoUpdateRequest(
  roomName: string,
  action: 'dismiss' | 'mark_auto_channel' | 'clear_all'
): Promise<import('../types/mylore').KakaoUpdateRequestItem[]> {
  if (isTauriEnv()) return await invoke('resolve_kakao_update_request', { roomName, action });
  return [];
}

export async function syncContactPersonMarkdownFiles(): Promise<import('../types/mylore').ContactPersonDocInfo[]> {
  if (isTauriEnv()) return await invoke('sync_contact_person_markdown_files');
  return [];
}

export async function openContactPersonDocument(contactName: string): Promise<DocumentPayload> {
  if (isTauriEnv()) return await invoke<DocumentPayload>('open_contact_person_document', { contactName });
  throw new Error('Tauri runtime required');
}

export async function getContactPromptTournamentStatus(): Promise<import('../types/mylore').ContactPromptTournamentStatus> {
  if (isTauriEnv()) return await invoke('get_contact_prompt_tournament_status');
  const emptySlot = (slot: 'A' | 'B') => ({
    slot, version: 1, promptTitle: `프롬프트 ${slot} (v1)`, promptText: '',
    winCount: 0, lossCount: 0, consecutiveLosses: 0, lastEvolutionReason: '', updatedAt: '',
  });
  return { slotA: emptySlot('A'), slotB: emptySlot('B'), recentHistory: [] };
}

export async function updateContactPromptSlotManual(params: {
  slot: 'A' | 'B'; promptTitle: string; promptText: string; reason?: string;
}): Promise<import('../types/mylore').ContactPromptTournamentStatus> {
  if (isTauriEnv()) return await invoke('update_contact_prompt_slot_manual', { ...params, reason: params.reason ?? null });
  return await getContactPromptTournamentStatus();
}

export async function getContactProfileApprovals(statusFilter?: string): Promise<import('../types/mylore').ContactProfileApprovalItem[]> {
  if (isTauriEnv()) return await invoke('get_contact_profile_approvals', { statusFilter: statusFilter ?? null });
  return [];
}

export async function generateContactProfileAbUpdate(params: {
  contactName: string; sourceType?: string; sourceRef?: string; rawEventText?: string;
}): Promise<import('../types/mylore').ContactProfileApprovalItem> {
  if (isTauriEnv()) {
    return await invoke('generate_contact_profile_ab_update', {
      contactName: params.contactName, sourceType: params.sourceType ?? null,
      sourceRef: params.sourceRef ?? null, rawEventText: params.rawEventText ?? null,
    });
  }
  throw new Error('Tauri runtime required');
}

export async function resolveContactProfileApproval(params: {
  approvalId: number;
  action: 'approve' | 'dismiss' | 'reanalyze_with_feedback' | 'approve_and_evolve_prompt';
  chosenSlot?: 'A' | 'B';
  finalProfileText?: string;
  userFeedback?: string;
}): Promise<import('../types/mylore').ContactProfileApprovalItem[]> {
  if (isTauriEnv()) {
    return await invoke('resolve_contact_profile_approval', {
      approvalId: params.approvalId,
      action: params.action,
      chosenSlot: params.chosenSlot ?? null,
      finalProfileText: params.finalProfileText ?? null,
      userFeedback: params.userFeedback ?? null,
    });
  }
  return [];
}

export async function getServiceLogs(params?: { serviceFilter?: string | null; limit?: number }): Promise<ServiceLogsPayload> {
  if (isTauriEnv()) {
    return await invoke<ServiceLogsPayload>('get_service_logs', {
      serviceFilter: params?.serviceFilter ?? null, limit: params?.limit ?? 300,
    });
  }
  return {
    logDirPath: '%APPDATA%\\com.iseohyun.mylore\\logs', entries: [], logFiles: [],
    retentionCommDays: 7, retentionVersionDays: 30, retentionSystemDays: 30, retentionAiDays: 30,
  };
}

export async function clearServiceLogs(serviceFilter?: string | null): Promise<ServiceLogsPayload> {
  if (isTauriEnv()) return await invoke<ServiceLogsPayload>('clear_service_logs', { serviceFilter: serviceFilter ?? null });
  return await getServiceLogs();
}

export async function pruneExpiredServiceLogs(): Promise<number> {
  if (isTauriEnv()) return await invoke<number>('prune_expired_service_logs');
  return 0;
}

export async function getPcActivitySummary(date?: string): Promise<PcActivitySummaryPayload> {
  if (isTauriEnv()) return await invoke<PcActivitySummaryPayload>('get_pc_activity_summary', { date: date ?? null });
  return {
    isAwAvailable: false, awDbPath: '', hostname: 'LocalPC',
    targetDate: date || new Date().toISOString().slice(0, 10),
    syncedNewEvents: 0, totalStoredEvents: 0, totalWindowSec: 0,
    activeNotAfkSec: 0, afkSec: 0, eventCount: 0,
    hourlyBreakdown: new Array(24).fill(0), topApps: [], recentTimeline: [], weeklySummary: [],
  };
}

export async function getGoogleCalendarSyncStatus(): Promise<GoogleCalendarSyncStatus> {
  if (isTauriEnv()) return await invoke<GoogleCalendarSyncStatus>('get_google_calendar_sync_status');
  return {
    isConnected: false, clientId: '', defaultCalendarId: '', lastSyncAt: '', lastError: '',
    storageLocation: '%APPDATA%\\com.iseohyun.mylore\\google_calendar_secret.json',
  };
}

export async function syncGoogleCalendarEvents(year?: number, month?: number): Promise<GoogleCalendarSyncResult> {
  if (isTauriEnv()) {
    return await invoke<GoogleCalendarSyncResult>('sync_google_calendar_events', { year: year ?? null, month: month ?? null });
  }
  return {
    uploadedCount: 0, downloadedCount: 0, updatedCount: 0, skippedCount: 0,
    needsAuth: true, message: '브라우저 미리보기 모드입니다.', lastSyncAt: '',
  };
}

export async function startGoogleCalendarOauthLogin(): Promise<string> {
  if (isTauriEnv()) return await invoke<string>('start_google_calendar_oauth_login');
  return '';
}

export async function getMultiLlmProvidersStatus(): Promise<MultiLlmProvidersStatus> {
  if (isTauriEnv()) return await invoke<MultiLlmProvidersStatus>('get_multi_llm_providers_status');
  const emptyProv = (provider: string, displayName: string, modelName: string) => ({
    provider, displayName, hasKey: false, maskedKey: '', modelName, verifiedAt: '',
    todayUsedTokens: 0, totalUsedTokens: 0, todayRequestCount: 0, lastError: '',
  });
  return {
    activeTextProvider: 'gemini',
    storageLocation: '%APPDATA%\\com.iseohyun.mylore\\multi_llm_secrets.json',
    claude: emptyProv('claude', 'Anthropic Claude', 'claude-3-7-sonnet-latest'),
    openai: emptyProv('openai', 'OpenAI GPT', 'gpt-4o-mini'),
    grok: emptyProv('grok', 'xAI Grok', 'grok-3-mini'),
  };
}

export async function setActiveTextLlmProvider(provider: string): Promise<MultiLlmProvidersStatus> {
  if (isTauriEnv()) return await invoke<MultiLlmProvidersStatus>('set_active_text_llm_provider', { provider });
  return await getMultiLlmProvidersStatus();
}

export async function saveAndVerifyLlmProviderKey(provider: string, apiKey: string, modelName?: string): Promise<MultiLlmProvidersStatus> {
  if (isTauriEnv()) {
    return await invoke<MultiLlmProvidersStatus>('save_and_verify_llm_provider_key', {
      provider, apiKey, modelName: modelName ?? null,
    });
  }
  return await getMultiLlmProvidersStatus();
}

export async function saveLlmProviderBillingConfig(params: {
  provider: string; chargedCreditUsd?: number; adminApiKey?: string; teamId?: string;
}): Promise<MultiLlmProvidersStatus> {
  if (isTauriEnv()) {
    return await invoke<MultiLlmProvidersStatus>('save_llm_provider_billing_config', {
      provider: params.provider, chargedCreditUsd: params.chargedCreditUsd ?? null,
      adminApiKey: params.adminApiKey ?? null, teamId: params.teamId ?? null,
    });
  }
  return await getMultiLlmProvidersStatus();
}

export async function getMediaOriginRegistrySummary(rescanDisk?: boolean): Promise<MediaOriginRegistrySummary> {
  if (isTauriEnv()) return await invoke<MediaOriginRegistrySummary>('get_media_origin_registry_summary', { rescanDisk: rescanDisk ?? false });
  return { totalOriginCount: 0, originalKeptCount: 0, editedOrRenamedCount: 0, deletedBlockedCount: 0, items: [] };
}

export async function updateMediaOriginStatus(params: {
  originHash: string; status: string; note?: string; deleteDiskFile?: boolean;
}): Promise<MediaOriginRegistrySummary> {
  if (isTauriEnv()) {
    return await invoke<MediaOriginRegistrySummary>('update_media_origin_status', {
      originHash: params.originHash, status: params.status,
      note: params.note ?? null, deleteDiskFile: params.deleteDiskFile ?? false,
    });
  }
  return await getMediaOriginRegistrySummary(false);
}

export async function getLocationMovementLogs(params?: { dateFilter?: string | null; limit?: number }): Promise<LocationMovementSummary> {
  if (isTauriEnv()) {
    return await invoke<LocationMovementSummary>('get_location_movement_logs', {
      dateFilter: params?.dateFilter ?? null, limit: params?.limit ?? 200,
    });
  }
  return { totalLogs: 0, wifiLogsCount: 0, gpsLogsCount: 0, distinctPlaces: [], logs: [] };
}

export async function recordLocationMovementEntry(params: {
  eventType: string; placeLabel: string; wifiSsid: string; latitude: number; longitude: number; accuracyM?: number;
}): Promise<LocationMovementSummary> {
  if (isTauriEnv()) {
    return await invoke<LocationMovementSummary>('record_location_movement_entry', {
      eventType: params.eventType, placeLabel: params.placeLabel, wifiSsid: params.wifiSsid,
      latitude: params.latitude, longitude: params.longitude, accuracyM: params.accuracyM ?? 10.0,
    });
  }
  return await getLocationMovementLogs();
}

export async function getAiQueueDashboardStatus(): Promise<import('../types/mylore').AiQueueDashboardPayload> {
  if (isTauriEnv()) return await invoke('get_ai_queue_dashboard_status');
  return {
    workerRunning: false, workerPid: 0, workerHeartbeatAt: '', lockFilePath: '',
    autoTranscriptionEnabled: true, unlockedAgentCount: 0, totalPendingCount: 0,
    totalPendingBytes: 0, stage1PendingCount: 0, stage3RevisionCount: 0,
    completedTodayCount: 0, agentSlots: [], pendingItems: [], recentCompleted: [],
  };
}

export async function controlAiQueueWorker(action: 'start_now' | 'stop_worker'): Promise<import('../types/mylore').AiQueueDashboardPayload> {
  if (isTauriEnv()) return await invoke('control_ai_queue_worker', { action });
  return await getAiQueueDashboardStatus();
}

export async function reanalyzeRecentPendingApprovalCalls(count = 1): Promise<CallApprovalItem[]> {
  if (isTauriEnv()) return await invoke<CallApprovalItem[]>('reanalyze_recent_pending_approval_calls', { count });
  return await getCallApprovalItems();
}

export async function resolveCallAbDecisionWithFeedback(params: {
  safeStem: string; action: 'reanalyze_with_feedback' | 'approve_and_evolve_prompt';
  chosenSlot?: 'ASR' | 'A' | 'B' | 'BOTH'; userFeedback?: string; editedScript?: string;
}): Promise<CallApprovalItem[]> {
  if (isTauriEnv()) {
    return await invoke<CallApprovalItem[]>('resolve_call_ab_decision_with_feedback', {
      safeStem: params.safeStem, action: params.action, chosenSlot: params.chosenSlot ?? null,
      userFeedback: params.userFeedback ?? null, editedScript: params.editedScript ?? null,
    });
  }
  return await getCallApprovalItems();
}

export async function analyzeSingleCallAsrAndAb(params: {
  roomOrSender: string; attachmentUuid?: string;
  mode?: 'asr_only' | 'asr_full' | 'asr_time_only' | 'asr_time_speaker' | 'ai_postprocess' | 'ai_postprocess_full' | 'ai_postprocess_discard_prev' | 'ai_postprocess_with_comment' | 'both';
  editEntries?: import('../types/mylore').UserScriptEditEntry[];
  editedPostScript?: string; userComment?: string;
}): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('analyze_single_call_asr_and_ab', {
      roomOrSender: params.roomOrSender, attachmentUuid: params.attachmentUuid ?? null,
      mode: params.mode ?? 'both', editEntries: params.editEntries ?? [],
      editedPostScript: params.editedPostScript ?? null, userComment: params.userComment ?? null,
    });
  }
  throw new Error('Tauri 환경에서만 동작합니다.');
}

export async function getCallPostprocessPromptAndLog(): Promise<import('../types/mylore').CallPostprocessPromptPayload> {
  if (isTauriEnv()) return await invoke('get_call_postprocess_prompt_and_log');
  return { promptMarkdown: '', promptPath: 'mobile/calls/postprocess_prompt.md', editLogMarkdown: '', editLogPath: 'mobile/calls/postprocess_user_edit_log.md' };
}

export async function saveCallPostprocessPrompt(params: {
  promptMarkdown: string; evolveFromLog?: boolean;
}): Promise<import('../types/mylore').CallPostprocessPromptPayload> {
  if (isTauriEnv()) return await invoke('save_call_postprocess_prompt', { promptMarkdown: params.promptMarkdown, evolveFromLog: params.evolveFromLog ?? false });
  return await getCallPostprocessPromptAndLog();
}

export async function confirmCallScriptWithUserEdits(params: {
  roomOrSender: string; attachmentUuid?: string; originalPostScript?: string; finalPostScript?: string;
  editEntries?: import('../types/mylore').UserScriptEditEntry[];
}): Promise<DocumentPayload> {
  if (isTauriEnv()) {
    return await invoke<DocumentPayload>('confirm_call_script_with_user_edits', {
      roomOrSender: params.roomOrSender, attachmentUuid: params.attachmentUuid ?? null,
      originalPostScript: params.originalPostScript ?? null, finalPostScript: params.finalPostScript ?? null,
      editEntries: params.editEntries ?? [],
    });
  }
  throw new Error('Tauri 환경에서만 동작합니다.');
}
