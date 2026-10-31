/**
 * @file useAppStartup.ts
 * @description 앱 최초 기동 시 설정·베이스 폴더·파일 트리·페어링·세션 복원 및 Tauri 실시간 이벤트(`uuid-scan-progress`, `cli-open-files`, `mobile-sync-*`) 구독 훅.
 */
import React, { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  BaseFolderConfig,
  DocumentPayload,
  MobileSyncProgressPayload,
  MyLoreAppSettings,
  OpenDocumentTab,
  ScanProgressPayload,
  VaultTemplateItem,
  ViewMode,
} from '../types/mylore';
import {
  getAppSettings,
  getBaseFolders,
  getScanProgress,
  getVaultTemplates,
  openRootMainMd,
  readDocument,
  takePendingCliFiles,
} from '../services/tauriClient';
import { splitYamlFrontmatter } from '../utils/markdownAutoFormat';

export interface UseAppStartupParams {
  openTabs: OpenDocumentTab[];
  setOpenTabs: React.Dispatch<React.SetStateAction<OpenDocumentTab[]>>;
  tabAccessHistory: string[];
  setTabAccessHistory: React.Dispatch<React.SetStateAction<string[]>>;
  tabAccessHistoryRef: React.MutableRefObject<string[]>;
  activeTabPath: string | null;
  setActiveTabPath: React.Dispatch<React.SetStateAction<string | null>>;
  isSessionRestoredRef: React.MutableRefObject<boolean>;
  lifelogDashboardTab: 'settings' | 'mobile';
  setLifelogDashboardTab: React.Dispatch<
    React.SetStateAction<'settings' | 'mobile'>
  >;
  selectedDate: string;
  setScanProgress: React.Dispatch<
    React.SetStateAction<ScanProgressPayload | null>
  >;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  setReconcileResultMsg: React.Dispatch<React.SetStateAction<string>>;
  setMobileSyncProgress: React.Dispatch<
    React.SetStateAction<MobileSyncProgressPayload | null>
  >;
  setAppSettings: React.Dispatch<React.SetStateAction<MyLoreAppSettings>>;
  setAutoSaveEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setMenuBarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  preDetachedViewModeRef: React.MutableRefObject<
    'split' | 'editor' | 'preview'
  >;
  setBaseFolders: React.Dispatch<React.SetStateAction<BaseFolderConfig[]>>;
  setVaultTemplates: React.Dispatch<React.SetStateAction<VaultTemplateItem[]>>;
  refreshTree: () => Promise<void>;
  refreshFinanceData: () => Promise<void>;
  refreshMobilePairingInfo: () => Promise<void>;
  refreshAllLifelogMessages: () => Promise<void>;
  loadLifelogForDate: (dateStr: string) => Promise<void>;
  openCliFilesInEditorMode: (filePaths: string[]) => Promise<void>;
  buildVirtualDashboardTab: (fullPath: string) => OpenDocumentTab | null;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
}

export function useAppStartup({
  openTabs,
  setOpenTabs,
  tabAccessHistory,
  setTabAccessHistory,
  tabAccessHistoryRef,
  activeTabPath,
  setActiveTabPath,
  isSessionRestoredRef,
  lifelogDashboardTab,
  setLifelogDashboardTab,
  selectedDate,
  setScanProgress,
  setStatusMessage,
  setReconcileResultMsg,
  setMobileSyncProgress,
  setAppSettings,
  setAutoSaveEnabled,
  setMenuBarExpanded,
  setViewMode,
  preDetachedViewModeRef,
  setBaseFolders,
  setVaultTemplates,
  refreshTree,
  refreshFinanceData,
  refreshMobilePairingInfo,
  refreshAllLifelogMessages,
  loadLifelogForDate,
  openCliFilesInEditorMode,
  buildVirtualDashboardTab,
  applyLoadedDocument,
}: UseAppStartupParams) {
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // 동기화 진행률은 백엔드 `mobile-sync-progress` 이벤트(listen)로만 갱신합니다.
  // 실행 중 → 완료로 바뀌는 순간을 감지하기 위해 직전 isRunning 값을 보관합니다.
  const mobileSyncWasRunningRef = useRef(false);

  // 열린 탭 목록, 엑세스 히스토리(MRU), 가장 마지막에 활성화된 파일/대쉬보드를 localStorage에 지속 저장
  useEffect(() => {
    if (!isSessionRestoredRef.current) return;
    try {
      const sessionPayload = {
        openTabPaths: openTabs.map((t) => t.doc.fullPath),
        tabAccessHistory,
        activeTabPath,
        lifelogDashboardTab,
      };
      localStorage.setItem(
        'mylore_editor_session_v1',
        JSON.stringify(sessionPayload)
      );
    } catch {
      // ignore storage quota errors
    }
  }, [openTabs, tabAccessHistory, activeTabPath, lifelogDashboardTab]);

  // 초기 로드 및 Tauri 실시간 스캔 프로그레스 / 외부 .md 파일 열기 / 모바일 동기화 이벤트 리스너 등록
  useEffect(() => {
    let unlistenScanFn: (() => void) | null = null;
    let unlistenCliOpenFn: (() => void) | null = null;
    let unlistenMobileSyncFn: (() => void) | null = null;
    let unlistenMobileProgFn: (() => void) | null = null;
    (async () => {
      try {
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
          unlistenScanFn = await listen<ScanProgressPayload>(
            'uuid-scan-progress',
            (event) => {
              const p = event.payload;
              setScanProgress(p);
              if (p.phase === 'done') {
                setStatusMessage(
                  `✅ 일괄 스캔 완료: 총 ${p.totalFiles}개 중 기등록 ${p.alreadyRegistered}개 스킵(${p.startPercent.toFixed(1)}% 시작) → 미등록 ${p.pendingFiles}개 처리 완료 (신규 UUID 주입: ${p.uuidsInjected}개)`
                );
                refreshTree();
              } else {
                setStatusMessage(
                  `🔄 일괄 UUID 주입 중 (${p.currentPercent.toFixed(1)}%): 기등록 ${p.alreadyRegistered}개 건너뜀(${p.startPercent.toFixed(1)}%에서 시작) | 남은 파일 처리 중: ${p.currentFile}`
                );
              }
            }
          );

          unlistenCliOpenFn = await listen<string[]>(
            'cli-open-files',
            async (event) => {
              // 큐 비우기 및 전달받은 .md 파일들을 에디터 전용 모드로 즉시 오픈
              await takePendingCliFiles().catch(() => []);
              await openCliFilesInEditorMode(event.payload);
            }
          );

          let syncRefreshTimer: ReturnType<typeof setTimeout> | null = null;
          unlistenMobileSyncFn = await listen<{
            eventType?: string;
            type?: string;
            message: string;
            count?: number;
          }>('mobile-sync-event', (event) => {
            const p = event.payload;
            setStatusMessage(p.message);
            setReconcileResultMsg(p.message);
            // 백그라운드 워커 스레드에서 동기화 사이클이 완전히 종료되었을 때만 메인 데이터/DB 조회를 1회 실행
            const evType = p.type || p.eventType || '';
            if (
              evType === 'sync_cycle_complete' ||
              evType === 'paired' ||
              evType === 'call_transcript_completed'
            ) {
              if (syncRefreshTimer) clearTimeout(syncRefreshTimer);
              syncRefreshTimer = setTimeout(() => {
                void refreshMobilePairingInfo();
                void refreshAllLifelogMessages();
                void refreshFinanceData();
                void loadLifelogForDate(selectedDateRef.current);
              }, 350);
            }
          });

          unlistenMobileProgFn = await listen<MobileSyncProgressPayload>(
            'mobile-sync-progress',
            (event) => {
              const p = event.payload;
              setMobileSyncProgress(p);
              const wasRunning = mobileSyncWasRunningRef.current;
              mobileSyncWasRunningRef.current = p.isRunning;
              if (wasRunning && !p.isRunning && p.isCompleted) {
                void refreshAllLifelogMessages();
                void refreshMobilePairingInfo();
              }
              const curStep =
                p.steps[p.currentStepIndex] || p.steps[p.steps.length - 1];
              if (p.isRunning && curStep) {
                const qBadge =
                  (p.queuedJobs ?? 0) > 0
                    ? ` | 워커 큐 대기: ${p.queuedJobs}건`
                    : '';
                setStatusMessage(
                  `📡 [${p.currentStepIndex + 1}/${p.totalSteps}] ${
                    p.currentLabel
                  } (${p.currentPercent}%) — 기보유 스킵(파란색): ${
                    curStep.skippedCount
                  }건 | 신규 다운로드(녹색): ${
                    curStep.downloadedCount
                  }건${qBadge}`
                );
              }
            }
          );
        }
        const loadedSettings = await getAppSettings();
        setAppSettings(loadedSettings);
        setAutoSaveEnabled(loadedSettings.autoSaveEnabled);
        setMenuBarExpanded(Boolean(loadedSettings.defaultMenuBarExpanded));
        if (
          loadedSettings.defaultEditorViewMode === 'editor' ||
          loadedSettings.defaultEditorViewMode === 'split' ||
          loadedSettings.defaultEditorViewMode === 'preview'
        ) {
          setViewMode(loadedSettings.defaultEditorViewMode);
          preDetachedViewModeRef.current = loadedSettings.defaultEditorViewMode;
        }

        const folders = await getBaseFolders();
        setBaseFolders(folders);
        await refreshTree();
        await refreshFinanceData();
        await refreshMobilePairingInfo();
        const tpls = await getVaultTemplates();
        setVaultTemplates(tpls);
        const initialProg = await getScanProgress();
        if (initialProg.totalFiles > 0) {
          setScanProgress(initialProg);
        }

        // 프로그램 시작 시 CLI 인자로 전달된 .md 파일이 있으면 즉시 편집 모드('editor')로 열기
        const initialCliFiles = await takePendingCliFiles();
        if (initialCliFiles.length > 0) {
          await openCliFilesInEditorMode(initialCliFiles);
        } else {
          // 이전 세션의 열린 탭 및 가장 마지막에 엑세스된 파일 또는 대쉬보드를 복원하여 활성화
          let restoredAny = false;
          try {
            const rawSession = localStorage.getItem('mylore_editor_session_v1');
            if (rawSession) {
              const parsed = JSON.parse(rawSession) as {
                openTabPaths?: string[];
                tabAccessHistory?: string[];
                activeTabPath?: string | null;
                lifelogDashboardTab?: 'settings' | 'mobile';
              };
              if (
                parsed.lifelogDashboardTab === 'settings' ||
                parsed.lifelogDashboardTab === 'mobile'
              ) {
                setLifelogDashboardTab(parsed.lifelogDashboardTab);
              }
              const pathsToOpen = Array.isArray(parsed.openTabPaths)
                ? parsed.openTabPaths
                : [];
              const restoredTabs: OpenDocumentTab[] = [];
              for (const fp of pathsToOpen) {
                if (!fp || restoredTabs.some((t) => t.doc.fullPath === fp)) {
                  continue;
                }
                if (fp.startsWith('mylore://dashboard/')) {
                  const vTab = buildVirtualDashboardTab(fp);
                  if (vTab) restoredTabs.push(vTab);
                } else {
                  try {
                    const doc = await readDocument(fp);
                    const split = splitYamlFrontmatter(doc.rawContent);
                    restoredTabs.push({
                      doc,
                      yamlText: split.yamlRaw,
                      bodyText: split.body,
                      isDirty: false,
                    });
                  } catch {
                    // 삭제되었거나 이동된 파일은 건너뜀
                  }
                }
              }
              if (restoredTabs.length > 0) {
                const validPaths = new Set(
                  restoredTabs.map((t) => t.doc.fullPath)
                );
                const validHistory = (
                  Array.isArray(parsed.tabAccessHistory)
                    ? parsed.tabAccessHistory
                    : []
                ).filter((p) => validPaths.has(p));
                const lastActive =
                  parsed.activeTabPath && validPaths.has(parsed.activeTabPath)
                    ? parsed.activeTabPath
                    : validHistory.length > 0
                      ? validHistory[validHistory.length - 1]
                      : restoredTabs[restoredTabs.length - 1].doc.fullPath;
                const finalHistory = [
                  ...validHistory.filter((p) => p !== lastActive),
                  lastActive,
                ];
                tabAccessHistoryRef.current = finalHistory;
                setTabAccessHistory(finalHistory);
                setOpenTabs(restoredTabs);
                setActiveTabPath(lastActive);
                restoredAny = true;
              }
            }
          } catch (e) {
            console.error('세션 복원 오류:', e);
          }

          if (!restoredAny) {
            try {
              const rootDoc = await openRootMainMd();
              applyLoadedDocument(rootDoc);
            } catch {
              // ignore if root main.md cannot be created
            }
          }
        }
        isSessionRestoredRef.current = true;
      } catch (err) {
        isSessionRestoredRef.current = true;
        console.error(err);
      }
    })();
    return () => {
      if (unlistenScanFn) unlistenScanFn();
      if (unlistenCliOpenFn) unlistenCliOpenFn();
      if (unlistenMobileSyncFn) unlistenMobileSyncFn();
      if (unlistenMobileProgFn) unlistenMobileProgFn();
    };
  }, []);
}
