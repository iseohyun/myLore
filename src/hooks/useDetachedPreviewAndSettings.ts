/**
 * @file useDetachedPreviewAndSettings.ts
 * @description 독립 뷰어 창(`BroadcastChannel`) 상태·스크롤 동기화, `F11` 뷰어/전체화면 토글, 앱 설정(`setting.json`) 및 테마 프리셋 적용 훅.
 */
import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  DetachedPreviewActionPayload,
  DetachedPreviewState,
  DocumentPayload,
  MyLoreAppSettings,
  TaskPriorityCode,
  ThemePresetId,
  ViewMode,
} from '../types/mylore';
import {
  applyAppSettingsToDocument,
  DEFAULT_APP_SETTINGS,
  openGoogleCalendarWeb,
  readDocumentByUuid,
  saveAppSettings,
  syncDetachedPreviewScroll,
  syncDetachedPreviewState,
  THEME_PRESETS,
  toggleDetachedPreviewWindow,
  toggleWindowFullscreen,
} from '../services/tauriClient';
import { updateTaskStatusInBody } from '../utils/markdownAutoFormat';
import { scrollPreviewPaneToSourceLine } from '../utils/markdownRenderer';
import { DETACHED_PREVIEW_CHANNEL } from '../components/window/DetachedPreviewWindowView';

export interface UseDetachedPreviewAndSettingsParams {
  activeTabPath: string | null;
  currentDoc: DocumentPayload | null;
  yamlText: string;
  bodyText: string;
  setBodyText: (updater: string | ((prev: string) => string)) => void;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  previewPaneRef: React.MutableRefObject<HTMLDivElement | null>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
  handleSaveCurrentDoc: () => Promise<void>;
  setAutoSaveEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDate: string;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function useDetachedPreviewAndSettings({
  activeTabPath,
  currentDoc,
  yamlText,
  bodyText,
  setBodyText,
  viewMode,
  setViewMode,
  previewPaneRef,
  applyLoadedDocument,
  handleSaveCurrentDoc,
  setAutoSaveEnabled,
  selectedDate,
  setStatusMessage,
}: UseDetachedPreviewAndSettingsParams) {
  const [appSettings, setAppSettings] =
    useState<MyLoreAppSettings>(DEFAULT_APP_SETTINGS);
  const [detachedPreviewOpen, setDetachedPreviewOpen] = useState(false);
  const preDetachedViewModeRef = useRef<'split' | 'editor' | 'preview'>(
    'editor'
  );

  // 설정(글꼴, 크기, 테마, 색상) 변경 시 즉시 문서 루트(:root) CSS 변수에 반영
  useEffect(() => {
    applyAppSettingsToDocument(appSettings);
  }, [appSettings]);

  const handleOpenGoogleCalendar = async () => {
    const targetDate = selectedDate || new Date().toISOString().slice(0, 10);
    const [y, m, d] = targetDate.split('-').map((n) => parseInt(n, 10));
    const url = await openGoogleCalendarWeb(y, m, d);
    setStatusMessage(`🌐 구글 캘린더 웹 오픈됨 (Chrome): ${url}`);
  };

  const handleSyncAndOpenGoogleCalendar = async () => {
    if (currentDoc) {
      await handleSaveCurrentDoc();
    }
    await handleOpenGoogleCalendar();
    setStatusMessage(
      '📅 [F7] 현재 일정/문서 동기화 및 Google 캘린더(Chrome) 열기 완료'
    );
  };

  const handleRunProgramPlaceholder = () => {
    setStatusMessage('🚀 [F9] 프로그램 수행 — 추후 업데이트 예정입니다.');
  };

  const buildDetachedPreviewPayload = (): DetachedPreviewState => ({
    title:
      currentDoc?.frontmatter['summary'] ||
      currentDoc?.frontmatter['title'] ||
      currentDoc?.relativePath.split(/[\\/]/).pop() ||
      '',
    relativePath: currentDoc?.relativePath || '',
    fullPath: currentDoc?.fullPath || '',
    role: currentDoc?.role || '',
    bodyText,
    yamlText,
  });

  const handleUpdateAppSettings = async (
    partial: Partial<MyLoreAppSettings>
  ) => {
    const merged: MyLoreAppSettings = {
      ...appSettings,
      ...partial,
    };

    try {
      const saved = await saveAppSettings(merged);
      setAppSettings(saved);
      setAutoSaveEnabled(saved.autoSaveEnabled);
      applyAppSettingsToDocument(saved);
      try {
        const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
        bc.postMessage({ type: 'settings', settings: saved });
        bc.close();
      } catch {
        // ignore
      }
      setStatusMessage(
        `⚙️ 설정 저장됨 (${saved.settingsFilePath}): 테마=${saved.themePreset}, F11=${
          saved.f11ViewerMode === 'detached' ? '전용 독립 뷰어' : '병렬 뷰어'
        }, 스크롤 동기화=${saved.scrollSyncEnabled ? 'ON' : 'OFF'}`
      );
    } catch (err) {
      setStatusMessage(`설정 저장 실패: ${String(err)}`);
    }
  };

  const handleApplyThemePreset = async (
    presetId: Exclude<ThemePresetId, 'custom'>
  ) => {
    const preset = THEME_PRESETS[presetId];
    if (!preset) return;
    await handleUpdateAppSettings({
      themePreset: presetId,
      bgPrimary: preset.bgPrimary,
      bgSecondary: preset.bgSecondary,
      textPrimary: preset.textPrimary,
      textSecondary: preset.textSecondary,
      headingColor: preset.headingColor,
      accentPrimary: preset.accentPrimary,
      tableHeaderBg: preset.tableHeaderBg,
      tableHeaderColor: preset.tableHeaderColor,
      borderColor: preset.borderColor,
    });
  };

  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!appSettings.scrollSyncEnabled) return;
    const el = e.currentTarget;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const scrollRatio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;

    const totalLines = Math.max(1, bodyText.split('\n').length);
    const computedStyle = window.getComputedStyle(el);
    const lineHeightPx =
      parseFloat(computedStyle.lineHeight) ||
      (appSettings.baseFontSize || 14) * 1.7;
    const paddingTopPx = parseFloat(computedStyle.paddingTop) || 20;
    const rawLine = Math.max(
      0,
      (el.scrollTop - paddingTopPx + lineHeightPx * 0.6) / lineHeightPx
    );
    const blendedTopLine =
      scrollRatio >= 0.995
        ? totalLines - 1
        : scrollRatio <= 0.005
          ? 0
          : Math.min(
              totalLines - 1,
              rawLine * 0.65 + scrollRatio * (totalLines - 1) * 0.35
            );

    if (previewPaneRef.current) {
      scrollPreviewPaneToSourceLine(
        previewPaneRef.current,
        blendedTopLine,
        scrollRatio
      );
    }

    if (detachedPreviewOpen) {
      syncDetachedPreviewScroll(blendedTopLine, scrollRatio).catch(() => {});
      try {
        const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
        bc.postMessage({
          type: 'scroll',
          topLine: blendedTopLine,
          scrollRatio,
        });
        bc.close();
      } catch {
        // ignore
      }
    }
  };

  const handleSelectDocViewMode = async (
    nextMode: 'editor' | 'split' | 'preview'
  ) => {
    preDetachedViewModeRef.current = nextMode;
    setViewMode(nextMode);
    if (detachedPreviewOpen && nextMode !== 'editor') {
      setDetachedPreviewOpen(false);
      await toggleDetachedPreviewWindow(buildDetachedPreviewPayload(), false);
    }
    const modeName =
      nextMode === 'editor'
        ? '에디터 전용 모드'
        : nextMode === 'split'
          ? '병렬 뷰어 모드 (분할 화면)'
          : '뷰어 전용 모드';
    setStatusMessage(`👁️ 보기 모드 전환: ${modeName}`);
  };

  const handleToggleDetachedPreview = async (forceOpen?: boolean) => {
    const payload = buildDetachedPreviewPayload();
    try {
      const isOpenNow = await toggleDetachedPreviewWindow(payload, forceOpen);
      setDetachedPreviewOpen(isOpenNow);
      if (isOpenNow) {
        setViewMode('editor');
        setStatusMessage(
          '🪟 [F11] 전용 독립 뷰어 켜짐 — 메인 창은 편집 모드, 독립 창은 실시간 뷰어로 동작합니다. (다시 F11을 누르면 닫힙니다)'
        );
      } else {
        setViewMode('editor');
        setStatusMessage(
          '🪟 [F11] 전용 독립 뷰어 꺼짐 — 에디터 전용 모드로 전환되었습니다.'
        );
      }
    } catch (err) {
      setStatusMessage(`전용 독립 뷰어 창 전환 실패: ${String(err)}`);
    }
  };

  const handleToggleF11Viewer = async () => {
    if (appSettings.f11ViewerMode === 'detached') {
      await handleToggleDetachedPreview();
    } else {
      if (detachedPreviewOpen) {
        setDetachedPreviewOpen(false);
        await toggleDetachedPreviewWindow(
          buildDetachedPreviewPayload(),
          false
        );
      }
      const nextMode = viewMode === 'split' ? 'editor' : 'split';
      preDetachedViewModeRef.current = nextMode;
      setViewMode(nextMode);
      setStatusMessage(
        nextMode === 'split'
          ? '📐 [F11] 병렬 뷰어 켜짐 (에디터 + 우측 병렬 뷰어)'
          : '📐 [F11] 병렬 뷰어 꺼짐 (에디터 전용 모드)'
      );
    }
  };

  const handleToggleFullscreen = async () => {
    try {
      const nextFs = await toggleWindowFullscreen();
      setStatusMessage(
        `🖥️ [F11] 전체 화면 모드 ${nextFs ? '활성화됨' : '해제됨'}`
      );
    } catch (err) {
      setStatusMessage(`전체 화면 전환 실패: ${String(err)}`);
    }
  };

  useEffect(() => {
    const payload = buildDetachedPreviewPayload();
    syncDetachedPreviewState(payload).catch(() => {});
    try {
      const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
      bc.postMessage({ type: 'sync', payload });
      bc.close();
    } catch {
      // ignore
    }
  }, [currentDoc?.fullPath, currentDoc?.relativePath, bodyText, yamlText]);

  useEffect(() => {
    let unlistenClosed: (() => void) | null = null;
    let unlistenAction: (() => void) | null = null;

    listen('detached-preview-closed', () => {
      setDetachedPreviewOpen(false);
      setViewMode('editor');
      setStatusMessage(
        '🪟 전용 독립 뷰어 창이 닫혔습니다 (F11을 누르면 다시 열립니다).'
      );
    })
      .then((fn) => {
        unlistenClosed = fn;
      })
      .catch(() => {});

    listen<DetachedPreviewActionPayload>(
      'detached-preview-action',
      async (event) => {
        const data = event.payload;
        if (!data) return;
        if (
          data.actionType === 'toggle-task' &&
          typeof data.lineIndex === 'number' &&
          data.nextCode
        ) {
          setBodyText((prev) =>
            updateTaskStatusInBody(
              prev,
              data.lineIndex as number,
              data.nextCode as TaskPriorityCode
            )
          );
        } else if (data.actionType === 'open-uuid' && data.uuid) {
          try {
            const targetDoc = await readDocumentByUuid(data.uuid);
            applyLoadedDocument(targetDoc);
          } catch {
            // ignore
          }
        }
      }
    )
      .then((fn) => {
        unlistenAction = fn;
      })
      .catch(() => {});

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
      bc.onmessage = async (ev) => {
        if (ev.data?.type === 'toggle-task') {
          const { lineIndex, nextCode } = ev.data as {
            lineIndex: number;
            nextCode: TaskPriorityCode;
          };
          setBodyText((prev) =>
            updateTaskStatusInBody(prev, lineIndex, nextCode)
          );
        } else if (ev.data?.type === 'open-uuid' && ev.data.uuid) {
          try {
            const targetDoc = await readDocumentByUuid(ev.data.uuid);
            applyLoadedDocument(targetDoc);
          } catch {
            // ignore
          }
        }
      };
    } catch {
      // ignore
    }

    return () => {
      if (unlistenClosed) unlistenClosed();
      if (unlistenAction) unlistenAction();
      if (bc) bc.close();
    };
  }, [activeTabPath]);

  return {
    appSettings,
    setAppSettings,
    detachedPreviewOpen,
    setDetachedPreviewOpen,
    preDetachedViewModeRef,
    handleOpenGoogleCalendar,
    handleSyncAndOpenGoogleCalendar,
    handleRunProgramPlaceholder,
    buildDetachedPreviewPayload,
    handleUpdateAppSettings,
    handleApplyThemePreset,
    handleEditorScroll,
    handleSelectDocViewMode,
    handleToggleDetachedPreview,
    handleToggleF11Viewer,
    handleToggleFullscreen,
  };
}
