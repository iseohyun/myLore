/**
 * @file ContextMenus.tsx
 * @description 우클릭 컨텍스트 메뉴 2종: 파일 트리/탭 컨텍스트 메뉴 및 모바일 라이프로그 항목 컨텍스트 메뉴(단일 통화 Gemini 재스크립트화 포함).
 */
import React from 'react';
import {
  BaseFolderRole,
  ContextMenuState,
  DocumentPayload,
  GeminiApiKeyStatus,
  LifelogSourceType,
  MobileContextMenuState,
  TrashedFileRecord,
} from '../../types/mylore';
import {
  getGeminiApiKeyStatus,
  showInExplorer,
  transcribeSingleCallItem,
} from '../../services/tauriClient';

export interface ContextMenusProps {
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  handleMoveRole: (targetRole: BaseFolderRole, sourcePath?: string) => void;
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
  refreshTree: () => Promise<void>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    options?: {
      highlightQuery?: string;
      lineNumber?: number;
      charOffset?: number;
    }
  ) => void;
  setLifelogDashboardTab: React.Dispatch<React.SetStateAction<'settings' | 'mobile'>>;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  setMobileSourceFilter: React.Dispatch<React.SetStateAction<'all' | LifelogSourceType>>;
}

export function ContextMenus({
  contextMenu,
  setContextMenu,
  setStatusMessage,
  handleMoveRole,
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
  refreshTree,
  applyLoadedDocument,
  setLifelogDashboardTab,
  setMobilePersonFilter,
  setMobileSourceFilter,
}: ContextMenusProps) {
  return (
    <>
      {contextMenu && (
        <div
          className="context-menu-popup"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
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
          <div className="menu-divider" />
          <button
            className="menu-item"
            onClick={() => {
              handleMoveRole('projects', contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>🚚 프로젝트(Projects)로 이동</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              handleMoveRole('diary', contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>🚚 일기(Diary)로 이동</span>
          </button>
          <button
            className="menu-item"
            onClick={() => {
              handleMoveRole('data', contextMenu.targetPath);
              setContextMenu(null);
            }}
          >
            <span>🚚 데이터(Archive)로 이동</span>
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
          className="context-menu-popup"
          style={{
            top: Math.min(mobileContextMenu.y, window.innerHeight - 200),
            left: Math.min(mobileContextMenu.x, window.innerWidth - 300),
            minWidth: '275px',
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
                !hasRecording ||
                isCallAlreadyTranscribed ||
                isTranscribingSingleCall;

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
                          `✅ '${mobileContextMenu.personName}' 스크립트 추출 및 요약이 완료되었습니다!`
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
                        : '🎙️ 스크립트 추출 및 요약'}
                      {!hasRecording
                        ? ' (녹음 미다운로드)'
                        : isCallAlreadyTranscribed
                          ? ' (이미 완료됨)'
                          : ''}
                    </span>
                  </button>
                  <div className="menu-divider" />
                </>
              );
            })()}

          <button
            className="menu-item"
            onClick={() => {
              setLifelogDashboardTab('mobile');
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
              setLifelogDashboardTab('mobile');
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
    </>
  );
}
