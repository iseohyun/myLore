/**
 * @file DetachedPreviewWindowView.tsx
 * @description 전용 독립 뷰어 창(`?detachedPreview=1`) 렌더러 및 `BroadcastChannel`(`DETACHED_PREVIEW_CHANNEL`) 동기화.
 */
import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  DetachedPreviewState,
  DetachedScrollPayload,
  MyLoreAppSettings,
} from '../../types/mylore';
import {
  applyAppSettingsToDocument,
  emitDetachedPreviewAction,
  getAppSettings,
  getDetachedPreviewState,
  openExternalUrlInChrome,
  toggleDetachedPreviewWindow,
} from '../../services/tauriClient';
import { updateTaskStatusInBody } from '../../utils/markdownAutoFormat';
import {
  MarkdownPreviewRenderer,
  scrollPreviewPaneToSourceLine,
} from '../../utils/markdownRenderer';

export const DETACHED_PREVIEW_CHANNEL = 'mylore_detached_preview_channel';

export function DetachedPreviewWindowView() {
  const [previewState, setPreviewState] = useState<DetachedPreviewState>({
    title: '',
    relativePath: '',
    fullPath: '',
    role: '',
    bodyText: '',
    yamlText: '',
  });
  const previewStateRef = useRef(previewState);
  previewStateRef.current = previewState;
  const detachedPreviewPaneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getDetachedPreviewState()
      .then((initial) => {
        if (initial) setPreviewState(initial);
      })
      .catch(() => {});

    getAppSettings()
      .then((s) => {
        if (s) applyAppSettingsToDocument(s);
      })
      .catch(() => {});

    let unlisten: (() => void) | null = null;
    listen<DetachedPreviewState>('detached-preview-update', (event) => {
      if (event.payload) {
        setPreviewState(event.payload);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    let unlistenSettings: (() => void) | null = null;
    listen<MyLoreAppSettings>('app-settings-updated', (event) => {
      if (event.payload) {
        applyAppSettingsToDocument(event.payload);
      }
    })
      .then((fn) => {
        unlistenSettings = fn;
      })
      .catch(() => {});

    let unlistenScroll: (() => void) | null = null;
    listen<DetachedScrollPayload>('detached-preview-scroll', (event) => {
      if (event.payload) {
        scrollPreviewPaneToSourceLine(
          detachedPreviewPaneRef.current,
          event.payload.topLine,
          event.payload.scrollRatio
        );
      }
    })
      .then((fn) => {
        unlistenScroll = fn;
      })
      .catch(() => {});

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
      bc.onmessage = (ev) => {
        if (ev.data?.type === 'sync' && ev.data.payload) {
          setPreviewState(ev.data.payload);
        } else if (ev.data?.type === 'settings' && ev.data.settings) {
          applyAppSettingsToDocument(ev.data.settings);
        } else if (ev.data?.type === 'scroll') {
          scrollPreviewPaneToSourceLine(
            detachedPreviewPaneRef.current,
            Number(ev.data.topLine) || 0,
            Number(ev.data.scrollRatio) || 0
          );
        }
      };
    } catch {
      // ignore if BroadcastChannel unavailable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'F11' && !e.ctrlKey && !e.altKey && !e.shiftKey) ||
        e.key === 'Escape'
      ) {
        e.preventDefault();
        toggleDetachedPreviewWindow(previewStateRef.current, false).catch(
          () => {}
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (unlisten) unlisten();
      if (unlistenSettings) unlistenSettings();
      if (unlistenScroll) unlistenScroll();
      if (bc) bc.close();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleCloseDetached = () => {
    toggleDetachedPreviewWindow(previewStateRef.current, false).catch(() => {});
  };

  return (
    <div
      className="mylore-app"
      style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}
    >
      <header
        className="top-menubar"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 14px',
          minHeight: '40px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="help-category-badge">
            🪟 전용 독립 뷰어 ({previewState.role ? previewState.role.toUpperCase() : 'PREVIEW'})
          </span>
          <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>
            {previewState.title || previewState.relativePath || '열린 문서 없음'}
          </strong>
          {previewState.relativePath && (
            <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
              ({previewState.relativePath})
            </span>
          )}
        </div>
        <button
          className="toolbar-btn"
          onClick={handleCloseDetached}
          title="전용 독립 뷰어 창을 닫습니다 (F11 또는 Esc)"
        >
          ✕ 독립 뷰어 닫기 (F11)
        </button>
      </header>

      <div
        ref={detachedPreviewPaneRef}
        className="markdown-preview-pane rendered-md"
        style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}
      >
        {previewState.fullPath || previewState.bodyText ? (
          <MarkdownPreviewRenderer
            bodyText={previewState.bodyText}
            onNavigateUuid={(targetUuid) => {
              emitDetachedPreviewAction({
                actionType: 'open-uuid',
                uuid: targetUuid,
              }).catch(() => {});
              try {
                const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
                bc.postMessage({ type: 'open-uuid', uuid: targetUuid });
                bc.close();
              } catch {
                // ignore
              }
            }}
            onOpenExternalUrl={(url) => {
              openExternalUrlInChrome(url);
            }}
            onUpdateTaskStatus={(lineIdx, nextCode) => {
              setPreviewState((prev) => ({
                ...prev,
                bodyText: updateTaskStatusInBody(
                  prev.bodyText,
                  lineIdx,
                  nextCode
                ),
              }));
              emitDetachedPreviewAction({
                actionType: 'toggle-task',
                lineIndex: lineIdx,
                nextCode,
              }).catch(() => {});
              try {
                const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
                bc.postMessage({
                  type: 'toggle-task',
                  lineIndex: lineIdx,
                  nextCode,
                });
                bc.close();
              } catch {
                // ignore
              }
            }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            메인 창에서 문서를 선택하면 실시간 미리보기가 이곳에 동기화됩니다.
          </div>
        )}
      </div>
    </div>
  );
}
