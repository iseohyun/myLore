export type BaseFolderRole = 'data' | 'diary' | 'projects';

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

export interface LifelogMessage {
  id: number;
  source: 'kakaotalk' | 'sms' | 'notification';
  roomOrSender: string;
  sender: string;
  message: string;
  sentDate: string; // YYYY-MM-DD
  sentTime: string; // HH:mm:ss
  attachmentUuid?: string;
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
