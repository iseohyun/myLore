/**
 * @file mylore.ts
 * @description Rust 백엔드 DTO(`src-tauri/src/models.rs`, `settings.rs`)와 1:1 대응하는 인터페이스 및 프론트엔드 UI 공용 타입 정의.
 */
export type BaseFolderRole = 'data' | 'diary' | 'projects' | 'git';

export interface BaseFolderConfig {
  id: string;
  role: BaseFolderRole;
  path: string;
  label: string;
  purpose: string;
  enabled: boolean;
}

export interface FileNode {
  uuid: string;
  name: string;
  relativePath: string;
  fullPath: string;
  role: BaseFolderRole;
  baseFolderId: string;
  isDir: boolean;
  extension: string;
  contentHash: string;
  title?: string;
  calendarCategory?: string;
  eventDate?: string;
  projectStatus?: string;
  updatedAt: string;
  children?: FileNode[];
}

export interface DocumentPayload {
  uuid: string;
  fullPath: string;
  relativePath: string;
  role: BaseFolderRole;
  rawContent: string;
  yamlRaw: string;
  bodyContent: string;
  frontmatter: Record<string, string>;
  contentHash: string;
  backlinks: BacklinkItem[];
}

export interface BacklinkItem {
  sourceUuid: string;
  sourceTitle: string;
  sourcePath: string;
  sourceRole: BaseFolderRole;
  excerpt: string;
  date?: string;
}

export interface TocHeading {
  level: number;
  text: string;
  lineIndex: number;
}

export type TaskPriorityCode = '!' | '/' | ' ' | '-' | 'x';

export interface ParsedTaskItem {
  lineIndex: number;
  code: TaskPriorityCode;
  text: string;
  subLines: string[];
}

export type LifelogSourceType =
  | 'kakaotalk'
  | 'sms'
  | 'notification'
  | 'call'
  | 'recording'
  | 'health'
  | 'media'
  | 'contacts'
  | 'pc_log';

export interface LifelogMessage {
  id: number;
  source: LifelogSourceType;
  roomOrSender: string;
  sender: string;
  message: string;
  sentDate: string; // YYYY-MM-DD
  sentTime: string; // HH:mm:ss
  attachmentUuid?: string;
  deviceId?: string | null;
  deviceName?: string | null;
  hasAudioRecording?: boolean;
  transcriptStage?: number; // 0: 녹음없음(🔇), 1: 미생성대기(🔊), 2: 확인전(❓), 3: 추가요구사항(❗), 4: 확인완료(📄)
  transcriptRequirement?: string | null;
}

export interface PairedDeviceItem {
  deviceId: string;
  deviceName: string;
  model: string;
  pairedAt: string;
  lastSeenAt: string;
}

export interface MobilePairingPayload {
  qrJsonRaw: string;
  qrBase64: string;
  pcName: string;
  ips: string[];
  port: number;
  token: string;
  ssid?: string;
  wifiAuth?: string;
  hasWifiPassword?: boolean;
  ssids: string[];
  pairedDevices: PairedDeviceItem[];
  lastNotiTs: number;
  lastSmsTs: number;
  lastCallTs: number;
}

export interface FinanceTransaction {
  id: number;
  txDate: string; // YYYY-MM-DD
  txTime: string; // HH:mm:ss
  institution: string; // 신한카드, KB국민은행 등
  txType: 'expense' | 'income' | 'transfer';
  amount: number;
  merchant: string;
  category: string;
  memo: string;
  verifyStatus: 'realtime' | 'verified' | 'excel_only';
  dedupKey: string;
}

export interface MediaInboxItem {
  uuid: string;
  fileName: string;
  fullPath: string;
  takenDate: string; // YYYY-MM-DD (from EXIF or file mtime)
  takenTime: string;
  fileSize: number;
  contentHash: string;
  status: 'inbox' | 'archived';
}

export interface BatchScanSummary {
  scannedFiles: number;
  alreadyRegistered?: number;
  pendingFiles?: number;
  uuidsInjected: number;
  mediaIndexed: number;
  linksIndexed: number;
}

export interface ScanProgressPayload {
  isRunning: boolean;
  phase: 'idle' | 'prescan' | 'injecting' | 'done';
  totalFiles: number;
  alreadyRegistered: number;
  pendingFiles: number;
  completedFiles: number;
  startPercent: number;
  currentPercent: number;
  uuidsInjected: number;
  mediaIndexed: number;
  linksIndexed: number;
  currentFile: string;
  etaSeconds: number;
}

export interface VaultTemplateItem {
  id: string;
  name: string;
  fileName: string;
  fullPath: string;
  description: string;
  bodyContent: string;
}

export interface SearchMatchItem {
  fullPath: string;
  relativePath: string;
  role: BaseFolderRole;
  fileName: string;
  lineNumber: number;
  lineText: string;
  charOffset: number;
}

export interface OpenDocumentTab {
  doc: DocumentPayload;
  yamlText: string;
  bodyText: string;
  isDirty: boolean;
  cursorOffset?: number;
}

export interface TrashedFileRecord {
  trashId: string;
  originalPath: string;
  fileName: string;
  backupPath: string;
}

export interface DetachedPreviewState {
  title: string;
  relativePath: string;
  fullPath: string;
  role: string;
  bodyText: string;
  yamlText: string;
  scrollTopLine?: number;
  scrollRatio?: number;
}

export interface DetachedScrollPayload {
  topLine: number;
  scrollRatio: number;
}

export interface DetachedPreviewActionPayload {
  actionType: 'open-uuid' | 'toggle-task';
  uuid?: string;
  lineIndex?: number;
  nextCode?: TaskPriorityCode;
}

export type F11ViewerMode = 'detached' | 'split';

export type ThemePresetId =
  | 'dark_indigo'
  | 'light_clean'
  | 'nord_slate'
  | 'sepia_warm'
  | 'emerald_forest'
  | 'custom';

export interface MyLoreAppSettings {
  f11ViewerMode: F11ViewerMode;
  autoSaveEnabled: boolean;
  defaultEditorViewMode: 'editor' | 'split' | 'preview';
  defaultMenuBarExpanded: boolean;
  scrollSyncEnabled: boolean;
  autoCallTranscription: boolean;
  aiUserProfile: string;
  aiDailyTokenLimit: number;
  statusBarShowAi: boolean;
  statusBarShowTrash: boolean;
  statusBarShowAutoSave: boolean;
  statusBarShowPort: boolean;
  baseFontFamily: string;
  headingFontFamily: string;
  tableFontFamily: string;
  baseFontSize: number;
  headingScale: number;
  tableFontSize: number;
  themePreset: ThemePresetId;
  bgPrimary: string;
  bgSecondary: string;
  textPrimary: string;
  textSecondary: string;
  headingColor: string;
  accentPrimary: string;
  tableHeaderBg: string;
  tableHeaderColor: string;
  borderColor: string;
  failedCallTextColor: string;
  lifelogTimeFormat: string;
  callPlaybackSpeed: number;
  logRetentionCommDays: number;
  logRetentionVersionDays: number;
  logRetentionSystemDays: number;
  logRetentionAiDays: number;
  settingsFilePath: string;
}

export interface ServiceLogEntry {
  id?: number;
  timestamp: string;
  service: string; // 'comm' | 'version' | 'system' | 'ai'
  level: string; // 'INFO' | 'WARN' | 'ERROR'
  message: string;
}

export interface ServiceLogsPayload {
  logDirPath: string;
  entries: ServiceLogEntry[];
  logFiles?: string[];
  retentionCommDays: number;
  retentionVersionDays: number;
  retentionSystemDays: number;
  retentionAiDays: number;
}

export interface GeminiApiKeyStatus {
  hasKey: boolean;
  maskedKey: string;
  modelName: string;
  lastVerifiedAt: string;
  storageLocation: string;
  quotaExhaustedAt?: string;
  retryAfterAt?: string;
  pendingCallCount?: number;
  lastQuotaError?: string;
  todayUsedTokens?: number;
  totalUsedTokens?: number;
  todayRequestCount?: number;
  lastRequestTokens?: number;
  autoCallTranscription?: boolean;
}

export interface CallPlayInfoPayload {
  audioUrl: string;
  fullPath: string;
  fileName: string;
  contactDisplay: string;
  hasTranscript: boolean;
  audioBase64?: string;
  mimeType?: string;
}

export interface MobileSyncSegment {
  kind: 'skip' | 'download';
  widthPct: number;
}

export interface MobileSyncStepSummary {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done';
  percent: number;
  totalCount: number;
  skippedCount: number;
  downloadedCount: number;
  totalBytes?: number;
  syncedBytes?: number;
  segments: MobileSyncSegment[];
}

export interface MobileSyncProgressPayload {
  isRunning: boolean;
  isCompleted: boolean;
  sessionId?: string;
  isReady?: boolean;
  sessionTotalBytes?: number;
  sessionSyncedBytes?: number;
  sessionTotalCount?: number;
  sessionSyncedCount?: number;
  currentStepIndex: number;
  totalSteps: number;
  currentKey: string;
  currentLabel: string;
  currentPercent: number;
  queuedJobs?: number;
  steps: MobileSyncStepSummary[];
}

export type ViewMode =
  | 'split'
  | 'editor'
  | 'preview'
  | 'dashboard_projects'
  | 'dashboard_diary'
  | 'dashboard_finance'
  | 'dashboard_lifelog'
  | 'dashboard_settings'
  | 'dashboard_logs';

export type RightSidebarTab = 'tree' | 'search' | 'toc' | 'backlinks' | 'lifelog';
export type PaletteMode = 'closed' | 'files' | 'commands';
export type FolderSectionMode = 'open' | 'summary' | 'closed';

export interface ArchiveTreeFolder {
  name: string;
  pathKey: string;
  folders: ArchiveTreeFolder[];
  files: FileNode[];
}

export interface KeybindingConfig {
  id: string;
  category: string;
  label: string;
  shortcut: string;
  secondaryShortcut: string;
  condition: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetUuid?: string;
  targetName: string;
  isDirectory?: boolean;
  folderRole?: BaseFolderRole;
  folderSubDir?: string;
}

export interface MobileContextMenuState {
  x: number;
  y: number;
  personName: string;
  sourceKey: LifelogSourceType;
  sourceLabel: string;
  messageItem: LifelogMessage;
}

export interface DirectCallPlayInfo {
  audioUrl: string;
  fullPath: string;
  fileName: string;
  contactDisplay: string;
  autoPlay?: boolean;
}

export interface CommandPaletteItem {
  id: string;
  label: string;
  shortcut: string;
  action: () => void;
}

export interface PcAppUsageItem {
  appName: string;
  totalSec: number;
  percentage: number;
  eventCount: number;
  topTitles: string[];
}

export interface PcWindowTimelineEvent {
  id: number;
  localTime: string;
  durationSec: number;
  appName: string;
  windowTitle: string;
}

export interface PcDailyUsageItem {
  date: string;
  totalWindowSec: number;
  notAfkSec: number;
  topApp: string;
}

export interface PcActivitySummaryPayload {
  isAwAvailable: boolean;
  awDbPath: string;
  hostname: string;
  targetDate: string;
  syncedNewEvents: number;
  totalStoredEvents: number;
  totalWindowSec: number;
  activeNotAfkSec: number;
  afkSec: number;
  eventCount: number;
  hourlyBreakdown: number[];
  topApps: PcAppUsageItem[];
  recentTimeline: PcWindowTimelineEvent[];
  weeklySummary: PcDailyUsageItem[];
}

export interface GoogleCalendarSyncStatus {
  isConnected: boolean;
  clientId: string;
  defaultCalendarId: string;
  lastSyncAt: string;
  lastError: string;
  storageLocation: string;
}

export interface GoogleCalendarSyncResult {
  uploadedCount: number;
  downloadedCount: number;
  updatedCount: number;
  skippedCount: number;
  needsAuth: boolean;
  message: string;
  lastSyncAt: string;
}






