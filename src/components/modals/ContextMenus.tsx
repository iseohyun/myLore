/**
 * @file ContextMenus.tsx
 * @description 우클릭 컨텍스트 메뉴 2종: 파일 트리/탭 컨텍스트 메뉴 및 모바일 라이프로그 항목 컨텍스트 메뉴(단일 통화 Gemini 재스크립트화 및 실패 통화 글자색 실시간 변경 포함).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BaseFolderRole,
  ContextMenuState,
  DocumentPayload,
  GeminiApiKeyStatus,
  LifelogSourceType,
  MobileContextMenuState,
  MyLoreAppSettings,
  TrashedFileRecord,
} from '../../types/mylore';
import {
  getGeminiApiKeyStatus,
  showInExplorer,
  transcribeSingleCallItem,
  updateCallTranscriptStage,
} from '../../services/tauriClient';
import {
  CallScriptCompareModal,
  CallScriptCompareTarget,
} from './CallScriptCompareModal';

export interface ContextMenusProps {
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  handleMoveRole: (targetRole: BaseFolderRole, sourcePath?: string) => void;
  handleCreateEmptyDocInFolder: (
    targetRole: BaseFolderRole,
    targetSubDir?: string
  ) => Promise<void> | void;
  handleTrashDocument: (targetPath?: string) => void;
  trashHistory: TrashedFileRecord[];
  handleRestoreTrashedDocument: () => void;
  mobileContextMenu: MobileContextMenuState | null;
  setMobileContextMenu: React.Dispatch<React.SetStateAction<MobileContextMenuState | null>>;
  isTranscribingSingleCall: boolean;
  setIsTranscribingSingleCall: React.Dispatch<React.SetStateAction<boolean>>;
  loadCallAudioIntoStatusBar: (
    roomOrSender: string,
    attachmentUuid?: string,
    autoPlay?: boolean,
    seekSec?: number
  ) => Promise<void>;
  setGeminiStatus: React.Dispatch<React.SetStateAction<GeminiApiKeyStatus | null>>;
  refreshAllLifelogMessages: () => Promise<void>;
  applyOptimisticCallStageUpdate?: (
    targetStemOrRoom: string,
    nextStage: 1 | 2 | 3 | 4,
    reqText?: string,
    messageId?: number,
    audioFileHint?: string
  ) => void;
  refreshTree: () => Promise<void>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    options?: {
      highlightQuery?: string;
      lineNumber?: number;
      charOffset?: number;
    }
  ) => void;
  setLifelogDashboardTab: React.Dispatch<
    React.SetStateAction<'settings' | 'chat' | 'records' | 'pc_activity'>
  >;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  setMobileSourceFilter: React.Dispatch<React.SetStateAction<'all' | LifelogSourceType>>;
  appSettings?: MyLoreAppSettings;
  handleUpdateAppSettings?: (patch: Partial<MyLoreAppSettings>) => Promise<void>;
}

const FAILED_CALL_COLOR_SWATCHES: Array<{ hex: string; label: string }> = [
  { hex: '#991b1b', label: '딥 크림슨 (#991b1b)' },
  { hex: '#b91c1c', label: '어두운 레드 — 기본 (#b91c1c)' },
  { hex: '#dc2626', label: '루비 레드 (#dc2626)' },
  { hex: '#ef4444', label: '선명한 레드 (#ef4444)' },
  { hex: '#f87171', label: '소프트 코랄 (#f87171)' },
  { hex: '#e11d48', label: '로즈 레드 (#e11d48)' },
  { hex: '#c2410c', label: '다크 오렌지 (#c2410c)' },
  { hex: '#d97706', label: '앰버 골드 (#d97706)' },
];

export function ContextMenus({
  contextMenu,
  setContextMenu,
  setStatusMessage,
  handleMoveRole,
  handleCreateEmptyDocInFolder,
  handleTrashDocument,
  trashHistory,
  handleRestoreTrashedDocument,
  mobileContextMenu,
  setMobileContextMenu,
  isTranscribingSingleCall,
  setIsTranscribingSingleCall,
  loadCallAudioIntoStatusBar,
  setGeminiStatus,
  refreshAllLifelogMessages,
  applyOptimisticCallStageUpdate,
  refreshTree,
  applyLoadedDocument,
  setLifelogDashboardTab,
  setMobilePersonFilter,
  setMobileSourceFilter,
  appSettings,
  handleUpdateAppSettings,
}: ContextMenusProps) {
  const [ctxReqText, setCtxReqText] = useState<string>('');
  const [showCtxReqInput, setShowCtxReqInput] = useState<boolean>(false);
  const [showFailedColorPicker, setShowFailedColorPicker] =
    useState<boolean>(false);
  const [compareCallTarget, setCompareCallTarget] =
    useState<CallScriptCompareTarget | null>(null);
  const fileContextMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [fileMenuPos, setFileMenuPos] = useState<{ top: number; left: number }>(
    { top: 0, left: 0 }
  );
  const [mobileMenuPos, setMobileMenuPos] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });

  const computePopupPosition = (
    anchorX: number,
    anchorY: number,
    menuWidth: number,
    menuHeight: number
  ): { top: number; left: number } => {
    const margin = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

    // 우측 경계를 넘어가면 우클릭 좌표의 왼쪽(anchorX - menuWidth)으로 출력
    let left =
      anchorX + menuWidth > vw - margin ? anchorX - menuWidth : anchorX;
    if (left < margin) {
      left = Math.max(margin, vw - menuWidth - margin);
    }

    // 하단 경계를 넘어가면 위쪽으로 뒤집거나 창 내부로 클램핑
    let top =
      anchorY + menuHeight > vh - margin
        ? anchorY - menuHeight >= margin
          ? anchorY - menuHeight
          : vh - menuHeight - margin
        : anchorY;
    if (top < margin) {
      top = margin;
    }

    return { top, left };
  };

  useLayoutEffect(() => {
    if (!contextMenu) return;
    const el = fileContextMenuRef.current;
    const w = el?.offsetWidth || 235;
    const h = el?.offsetHeight || 260;
    setFileMenuPos(computePopupPosition(contextMenu.x, contextMenu.y, w, h));
  }, [contextMenu, trashHistory.length]);

  useLayoutEffect(() => {
    if (!mobileContextMenu) return;
    const el = mobileContextMenuRef.current;
    const w = el?.offsetWidth || 305;
    const h = el?.offsetHeight || 320;
    setMobileMenuPos(
      computePopupPosition(mobileContextMenu.x, mobileContextMenu.y, w, h)
    );
  }, [
    mobileContextMenu,
    showCtxReqInput,
    showFailedColorPicker,
    isTranscribingSingleCall,
  ]);

  useEffect(() => {
    setCtxReqText(
      mobileContextMenu?.messageItem?.transcriptRequirement || ''
    );
    setShowCtxReqInput(false);
    if (mobileContextMenu?.sourceKey === 'call') {
      const m = mobileContextMenu.messageItem;
      const isFailed =
        !m.hasAudioRecording &&
        (m.sender === '부재중통화' ||
          m.sender === '수신거절' ||
          m.sender === 'missed' ||
          m.sender === 'rejected' ||
          (m.message || '').includes('[부재중통화]') ||
          (m.message || '').includes('[수신거절]') ||
          ((m.message || '').startsWith('📞') &&
            !(m.message || '').includes('통화시간')));
      setShowFailedColorPicker(isFailed);
    } else {
      setShowFailedColorPicker(false);
    }
  }, [mobileContextMenu]);

  const currentFailedColor = appSettings?.failedCallTextColor || '#b91c1c';

  const applyFailedCallColorLive = (nextHex: string) => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty(
        '--failed-call-text-color',
        nextHex
      );
    }
    if (handleUpdateAppSettings) {
      void handleUpdateAppSettings({ failedCallTextColor: nextHex });
    }
  };

  return (
    <>
      {contextMenu && (
        <div
          ref={fileContextMenuRef}
          className="context-menu-popup"
          style={{
            top:
              fileMenuPos.top ||
              computePopupPosition(contextMenu.x, contextMenu.y, 235, 260).top,
            left:
              fileMenuPos.left ||
              computePopupPosition(contextMenu.x, contextMenu.y, 235, 260).left,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.folderRole && (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  const role = contextMenu.folderRole!;
                  const subDir = contextMenu.folderSubDir;
                  setContextMenu(null);
                  void handleCreateEmptyDocInFolder(role, subDir);
                }}
              >
                <span>📄 새 문서 생성</span>
                <span className="menu-item-shortcut">.md</span>
              </button>
              <div className="menu-divider" />
            </>
          )}
          <button
            className="menu-item"
            onClick={() => {
              showInExplorer(contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>📂 탐색기에서 보기</span>
            <span className="menu-item-shortcut">Explorer</span>
          </button>
          {contextMenu.targetUuid && (
            <button
              className="menu-item"
              onClick={() => {
                navigator.clipboard.writeText(
                  `[문서링크](mylore://doc/${contextMenu.targetUuid})`
                );
                setStatusMessage(
                  `🔗 복사됨: mylore://doc/${contextMenu.targetUuid}`
                );
                setContextMenu(null);
              }}
            >
              <span>🔗 UUID 링크 복사</span>
              <span className="menu-item-shortcut">mylore://</span>
            </button>
          )}
          {!contextMenu.isDirectory && (
            <>
              <div className="menu-divider" />
              <button
                className="menu-item"
                onClick={() => {
                  handleMoveRole('projects', contextMenu.targetPath);
                  setContextMenu(null);
                }}
              >
                <span>⭐ 프로젝트(Projects)로 이동</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  handleMoveRole('diary', contextMenu.targetPath);
                  setContextMenu(null);
                }}
              >
                <span>📅 일기(Diary)로 이동</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  handleMoveRole('data', contextMenu.targetPath);
                  setContextMenu(null);
                }}
              >
                <span>🗄️ 아카이브(Archive)로 이동</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  handleMoveRole('git', contextMenu.targetPath);
                  setContextMenu(null);
                }}
              >
                <span>💻 Git 저장소(Git)로 이동</span>
              </button>
              <div className="menu-divider" />
              <button
                className="menu-item"
                onClick={() => {
                  const target = contextMenu.targetPath;
                  setContextMenu(null);
                  handleTrashDocument(target);
                }}
              >
                <span style={{ color: '#f87171' }}>🗑️ 휴지통으로 이동</span>
                <span className="menu-item-shortcut">Del</span>
              </button>
            </>
          )}
          {trashHistory.length > 0 && (
            <button
              className="menu-item"
              onClick={() => {
                setContextMenu(null);
                handleRestoreTrashedDocument();
              }}
            >
              <span style={{ color: '#fbbf24' }}>↩ 방금 삭제한 파일 복구</span>
              <span className="menu-item-shortcut">Ctrl+Z</span>
            </button>
          )}
        </div>
      )}

      {mobileContextMenu && (
        <div
          ref={mobileContextMenuRef}
          className="context-menu-popup"
          style={{
            top:
              mobileMenuPos.top ||
              computePopupPosition(
                mobileContextMenu.x,
                mobileContextMenu.y,
                305,
                320
              ).top,
            left:
              mobileMenuPos.left ||
              computePopupPosition(
                mobileContextMenu.x,
                mobileContextMenu.y,
                305,
                320
              ).left,
            minWidth: '285px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(mobileContextMenu.sourceKey === 'call' ||
            mobileContextMenu.sourceKey === 'recording') &&
            (() => {
              const msgItem = mobileContextMenu.messageItem;
              const isVoiceRec = mobileContextMenu.sourceKey === 'recording';
              const hasRecording = Boolean(msgItem.hasAudioRecording);
              const isCallAlreadyTranscribed =
                Boolean(msgItem.attachmentUuid?.startsWith('transcribed:')) &&
                !(msgItem.message || '').includes('스크립트 미생성') &&
                !(msgItem.message || '').includes('토큰 부족') &&
                !(msgItem.message || '').includes('원본 보관');
              const isTranscribeDisabled =
                !hasRecording || isTranscribingSingleCall;
              const currentStage = !hasRecording
                ? 0
                : msgItem.transcriptStage ||
                  (isCallAlreadyTranscribed ? 2 : 1);

              const handleQuickStageUpdate = async (
                nextStage: 1 | 2 | 3 | 4,
                reqStr?: string,
                keepMenuOpen?: boolean
              ) => {
                if (!hasRecording) return;
                const targetMsg = mobileContextMenu.messageItem;
                const personDisplay = mobileContextMenu.personName;
                if (!keepMenuOpen) {
                  setMobileContextMenu(null);
                }
                const msgLabel =
                  nextStage === 1
                    ? '📥 1. 다운로드 (ASR 대기열)'
                    : nextStage === 2
                      ? '🎙️ 2. ASR처리 (AI 후처리 대기)'
                      : nextStage === 3
                        ? '✨ 3. 후처리 (확인 대기)'
                        : '✅ 4. 확인 (최종 확정)';
                // 0ms 낙관적(Optimistic) UI 즉시 반영
                applyOptimisticCallStageUpdate?.(
                  targetMsg.roomOrSender,
                  nextStage,
                  reqStr,
                  targetMsg.id,
                  targetMsg.attachmentUuid
                );
                setStatusMessage(
                  `✅ '${personDisplay}' 스크립트 상태가 ${msgLabel}(으)로 변경되었습니다.`
                );
                try {
                  const doc = await updateCallTranscriptStage({
                    roomOrSender: targetMsg.roomOrSender,
                    attachmentUuid: targetMsg.attachmentUuid,
                    stage: nextStage,
                    userRequirement: reqStr,
                  });
                  applyLoadedDocument(doc);
                  await Promise.all([
                    refreshAllLifelogMessages(),
                    getGeminiApiKeyStatus()
                      .then((gStat) => {
                        if (gStat) setGeminiStatus(gStat);
                      })
                      .catch(() => null),
                    refreshTree().catch(() => null),
                  ]);
                } catch (err) {
                  setStatusMessage(`❌ 단계 변경 실패: ${String(err)}`);
                  void refreshAllLifelogMessages();
                }
              };

              return (
                <>
                  <button
                    className="menu-item"
                    disabled={!hasRecording}
                    style={
                      !hasRecording
                        ? {
                            opacity: 0.42,
                            backgroundColor: 'rgba(15, 23, 42, 0.45)',
                            color: 'var(--text-muted)',
                            cursor: 'not-allowed',
                          }
                        : undefined
                    }
                    onClick={async () => {
                      if (!hasRecording) return;
                      const targetMsg = mobileContextMenu.messageItem;
                      setMobileContextMenu(null);
                      await loadCallAudioIntoStatusBar(
                        targetMsg.roomOrSender,
                        targetMsg.attachmentUuid,
                        true
                      );
                    }}
                  >
                    <span>
                      {hasRecording
                        ? isVoiceRec
                          ? '🎧 음성녹음 직접 듣기'
                          : '🎧 통화 직접 듣기'
                        : isVoiceRec
                          ? '🔇 음성녹음 직접 듣기 (녹음 미다운로드)'
                          : '🔇 통화 직접 듣기 (녹음 미다운로드)'}
                    </span>
                  </button>
                  <button
                    className="menu-item"
                    disabled={isTranscribeDisabled}
                    style={
                      isTranscribeDisabled
                        ? {
                            opacity: 0.42,
                            backgroundColor: !hasRecording
                              ? 'rgba(15, 23, 42, 0.45)'
                              : undefined,
                            color: !hasRecording
                              ? 'var(--text-muted)'
                              : undefined,
                            cursor: 'not-allowed',
                          }
                        : undefined
                    }
                    onClick={async () => {
                      if (isTranscribeDisabled) {
                        return;
                      }
                      const targetMsg = mobileContextMenu.messageItem;
                      setMobileContextMenu(null);
                      try {
                        setIsTranscribingSingleCall(true);
                        setStatusMessage(
                          isVoiceRec
                            ? `🎙️ '${mobileContextMenu.personName}' 음성녹음(회의록·음성메모 톤) 스크립트 추출 및 요약을 진행 중입니다...`
                            : `🎙️ '${mobileContextMenu.personName}' 통화 녹음의 스크립트 추출 및 요약을 진행 중입니다...`
                        );
                        const doc = await transcribeSingleCallItem({
                          roomOrSender: targetMsg.roomOrSender,
                          attachmentUuid: targetMsg.attachmentUuid,
                        });
                        const gStat = await getGeminiApiKeyStatus();
                        setGeminiStatus(gStat);
                        await refreshAllLifelogMessages();
                        await refreshTree();
                        applyLoadedDocument(doc);
                        setStatusMessage(
                          `✅ '${mobileContextMenu.personName}' 스크립트 추출 및 요약이 완료되었습니다! (❓ 2단계)`
                        );
                      } catch (err) {
                        const gStat = await getGeminiApiKeyStatus().catch(() => null);
                        if (gStat) setGeminiStatus(gStat);
                        await refreshAllLifelogMessages();
                        setStatusMessage(`❌ 스크립트 추출 실패: ${String(err)}`);
                      } finally {
                        setIsTranscribingSingleCall(false);
                      }
                    }}
                  >
                    <span>
                      {isVoiceRec
                        ? '🎙️ 스크립트 추출 및 요약 (회의록·음성메모)'
                        : isCallAlreadyTranscribed
                          ? '🎙️ 스크립트 즉시 재추출 (2단계로 회귀)'
                          : '🎙️ 스크립트 추출 및 요약'}
                      {!hasRecording ? ' (녹음 미다운로드)' : ''}
                    </span>
                  </button>
                  {hasRecording && (
                    <button
                      className="menu-item"
                      onClick={() => {
                        const targetMsg = mobileContextMenu.messageItem;
                        const personDisplay = mobileContextMenu.personName;
                        setMobileContextMenu(null);
                        setCompareCallTarget({
                          roomOrSender: targetMsg.roomOrSender,
                          attachmentUuid: targetMsg.attachmentUuid,
                          personName: personDisplay,
                        });
                      }}
                    >
                      <span>🔍 각 스크립트 비교하기</span>
                    </button>
                  )}
                  {hasRecording && (
                    <>
                      <div className="menu-divider" />
                      <button
                        className="menu-item"
                        onClick={() => handleQuickStageUpdate(4)}
                      >
                        <span>
                          ✅ 4. 확인 (사용자 최종 확인)
                          {currentStage === 4 ? ' (현재 상태)' : ''}
                        </span>
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => {
                          if (currentStage !== 3) {
                            setShowCtxReqInput(true);
                            void handleQuickStageUpdate(3, ctxReqText, true);
                          } else {
                            setShowCtxReqInput((prev) => !prev);
                          }
                        }}
                      >
                        <span>
                          ✨ 3. 후처리 (확인 대기 · 코멘트 입력...)
                          {currentStage === 3 ? ' (현재 상태)' : ''}
                        </span>
                      </button>
                      {showCtxReqInput && (
                        <div
                          style={{
                            padding: '6px 10px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            backgroundColor: 'rgba(15, 23, 42, 0.65)',
                            borderRadius: '6px',
                            margin: '2px 4px',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            className="input-field"
                            style={{ fontSize: '11.5px', padding: '5px 8px' }}
                            placeholder="후처리 코멘트 입력 후 Enter..."
                            value={ctxReqText}
                            onChange={(e) => setCtxReqText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleQuickStageUpdate(
                                  3,
                                  ctxReqText.trim() || '재검토 및 보완 요청'
                                );
                              }
                            }}
                          />
                          <button
                            className="toolbar-btn primary"
                            style={{ fontSize: '11.5px', padding: '4px 8px' }}
                            onClick={() =>
                              handleQuickStageUpdate(
                                3,
                                ctxReqText.trim() || '재검토 및 보완 요청'
                              )
                            }
                          >
                            ✨ 3. 후처리 코멘트 저장
                          </button>
                        </div>
                      )}
                      <button
                        className="menu-item"
                        onClick={() => handleQuickStageUpdate(2)}
                      >
                        <span>
                          🎙️ 2. ASR처리 (후처리 대기 상태로 변경)
                          {currentStage === 2 ? ' (현재 상태)' : ''}
                        </span>
                      </button>
                      <button
                        className="menu-item"
                        onClick={() => handleQuickStageUpdate(1)}
                      >
                        <span>
                          📥 1. 다운로드 (ASR 대기열에 넣기)
                          {currentStage === 1 ? ' (현재 상태)' : ''}
                        </span>
                      </button>
                    </>
                  )}

                  {mobileContextMenu.sourceKey === 'call' && (
                    <>
                      <div className="menu-divider" />
                      <button
                        className="menu-item"
                        onClick={() =>
                          setShowFailedColorPicker((prev) => !prev)
                        }
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🎨 실패 통화 글자색 실시간 변경</span>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '12px',
                              height: '12px',
                              borderRadius: '3px',
                              backgroundColor: currentFailedColor,
                              border: '1px solid rgba(255,255,255,0.4)',
                            }}
                          />
                        </span>
                      </button>
                      {showFailedColorPicker && (
                        <div
                          className="context-color-picker-box"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="context-color-picker-row">
                            <span
                              style={{
                                fontSize: '11.5px',
                                fontWeight: 700,
                                color: currentFailedColor,
                              }}
                            >
                              미리보기: {mobileContextMenu.personName}
                            </span>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                              }}
                            >
                              <input
                                type="color"
                                value={
                                  /^#[0-9a-fA-F]{6}$/.test(currentFailedColor)
                                    ? currentFailedColor
                                    : '#b91c1c'
                                }
                                onChange={(e) =>
                                  applyFailedCallColorLive(e.target.value)
                                }
                                style={{
                                  width: '24px',
                                  height: '22px',
                                  border: 'none',
                                  padding: 0,
                                  background: 'transparent',
                                  cursor: 'pointer',
                                }}
                                title="색상환에서 드래그하여 실시간으로 실패 통화 글자색을 변경합니다"
                              />
                              <code
                                style={{
                                  fontSize: '11px',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {currentFailedColor}
                              </code>
                            </div>
                          </div>
                          <div className="context-color-swatches">
                            {FAILED_CALL_COLOR_SWATCHES.map((sw) => (
                              <button
                                key={sw.hex}
                                type="button"
                                className={`context-color-swatch ${
                                  currentFailedColor.toLowerCase() ===
                                  sw.hex.toLowerCase()
                                    ? 'selected'
                                    : ''
                                }`}
                                style={{ backgroundColor: sw.hex }}
                                onClick={() => applyFailedCallColorLive(sw.hex)}
                                title={sw.label}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <div className="menu-divider" />
                </>
              );
            })()}

          <button
            className="menu-item"
            onClick={() => {
              setLifelogDashboardTab('chat');
              setMobilePersonFilter(mobileContextMenu.personName);
              setMobileSourceFilter(mobileContextMenu.sourceKey);
              setStatusMessage(
                `🔍 '${mobileContextMenu.personName}'님과의 '${mobileContextMenu.sourceLabel}' 기록을 검색합니다.`
              );
              setMobileContextMenu(null);
            }}
          >
            <span>
              🔍 &lsquo;{mobileContextMenu.personName}&rsquo;님과의 &lsquo;
              {mobileContextMenu.sourceLabel}&rsquo; 검색
            </span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setLifelogDashboardTab('chat');
              setMobilePersonFilter(mobileContextMenu.personName);
              setMobileSourceFilter('all');
              setStatusMessage(
                `📚 '${mobileContextMenu.personName}'님과의 모든기록(카톡·알림·문자·통화)을 검색합니다.`
              );
              setMobileContextMenu(null);
            }}
          >
            <span>
              📚 &lsquo;{mobileContextMenu.personName}&rsquo;님과의 모든기록 검색
            </span>
          </button>
        </div>
      )}

      <CallScriptCompareModal
        target={compareCallTarget}
        onClose={() => setCompareCallTarget(null)}
        setStatusMessage={setStatusMessage}
        applyLoadedDocument={applyLoadedDocument}
        refreshAllLifelogMessages={refreshAllLifelogMessages}
        refreshTree={refreshTree}
      />
    </>
  );
}
