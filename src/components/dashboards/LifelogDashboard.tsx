/**
 * @file LifelogDashboard.tsx
 * @description 모바일 라이프로그 대시보드 컨테이너 (`F7`, `mylore://dashboard/lifelog`):
 * 상단 동기화 상태바 및 [⚙️ 설정 / 💬 대화 / 🗂️ 기록 / 📊 모니터링] 4개 탭 전환 + 우측 사이드바 연동.
 */
import React from 'react';
import {
  GeminiApiKeyStatus,
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
  MobilePairingPayload,
  MobileSyncProgressPayload,
  MyLoreAppSettings,
} from '../../types/mylore';
import { SyncProgressCard } from './SyncProgressCard';
import { LifelogSettingsTab } from './LifelogSettingsTab';
import { LifelogMobileDataTab } from './LifelogMobileDataTab';
import { LifelogRecordsTab } from './LifelogRecordsTab';
import { PcActivityTab } from './PcActivityTab';

export interface LifelogDashboardProps {
  lifelogDashboardTab: 'settings' | 'chat' | 'records' | 'pc_activity';
  setLifelogDashboardTab: React.Dispatch<
    React.SetStateAction<'settings' | 'chat' | 'records' | 'pc_activity'>
  >;
  mobileSidebarTab: LifelogSourceType;
  setMobileSidebarTab: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  refreshMobilePairingInfo: () => Promise<void>;
  setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refreshAllLifelogMessages: () => Promise<void>;
  mobileSyncProgress: MobileSyncProgressPayload | null;
  setMobileSyncProgress: React.Dispatch<
    React.SetStateAction<MobileSyncProgressPayload | null>
  >;
  reconcileResultMsg: string;
  setReconcileResultMsg: React.Dispatch<React.SetStateAction<string>>;
  mobilePairing: MobilePairingPayload | null;
  setMobilePairing: React.Dispatch<
    React.SetStateAction<MobilePairingPayload | null>
  >;
  qrDataUrl: string;
  ssidInputText: string;
  setSsidInputText: React.Dispatch<React.SetStateAction<string>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  geminiStatus: GeminiApiKeyStatus | null;
  setGeminiStatus: React.Dispatch<
    React.SetStateAction<GeminiApiKeyStatus | null>
  >;
  geminiKeyInput: string;
  setGeminiKeyInput: React.Dispatch<React.SetStateAction<string>>;
  isVerifyingGemini: boolean;
  setAwaitingClipboardKey: React.Dispatch<React.SetStateAction<boolean>>;
  tryRegisterGeminiKeyString: (rawKey: string) => Promise<boolean>;
  appSettings: MyLoreAppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<MyLoreAppSettings>>;
  handleUpdateAppSettings?: (
    patch: Partial<MyLoreAppSettings>
  ) => Promise<void>;
  mobilePersonFilter: string;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  mobileSourceFilter: 'all' | LifelogSourceType;
  setMobileSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  allLifelogMessages: LifelogMessage[];
  contactsMap?: Record<string, string>;
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  resolveContactName: (rawNumberOrName: string) => string;
}

export function LifelogDashboard({
  lifelogDashboardTab,
  setLifelogDashboardTab,
  mobileSidebarTab,
  setMobileSidebarTab,
  refreshMobilePairingInfo,
  setRightSidebarOpen,
  refreshAllLifelogMessages,
  mobileSyncProgress,
  setMobileSyncProgress,
  reconcileResultMsg,
  setReconcileResultMsg,
  mobilePairing,
  setMobilePairing,
  qrDataUrl,
  ssidInputText,
  setSsidInputText,
  setStatusMessage,
  geminiStatus,
  setGeminiStatus,
  geminiKeyInput,
  setGeminiKeyInput,
  isVerifyingGemini,
  setAwaitingClipboardKey,
  tryRegisterGeminiKeyString,
  appSettings,
  setAppSettings,
  handleUpdateAppSettings,
  mobilePersonFilter,
  setMobilePersonFilter,
  mobileSourceFilter,
  setMobileSourceFilter,
  allLifelogMessages,
  contactsMap = {},
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  resolveContactName,
}: LifelogDashboardProps) {
  const chatCount = allLifelogMessages.filter(
    (m) => m.source === 'kakaotalk' || m.source === 'sms' || m.source === 'call'
  ).length;
  const notiCount = allLifelogMessages.filter(
    (m) => m.source === 'notification'
  ).length;
  const healthCount = allLifelogMessages.filter(
    (m) => m.source === 'health'
  ).length;

  const activeMonitoringSubTab: 'pc_log' | 'notification' | 'health' =
    mobileSidebarTab === 'notification' || mobileSidebarTab === 'health'
      ? mobileSidebarTab
      : 'pc_log';

  return (
    <div className="finance-workspace">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '14px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
            📱 라이프로그 대쉬보드
          </h2>
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '3px',
              gap: '4px',
              flexWrap: 'wrap',
            }}
          >
            <button
              className={`toolbar-btn ${
                lifelogDashboardTab === 'settings' ? 'primary' : ''
              }`}
              style={{ border: 'none', padding: '6px 14px', fontWeight: 700 }}
              onClick={() => {
                setLifelogDashboardTab('settings');
                refreshMobilePairingInfo();
              }}
            >
              ⚙️ 설정
            </button>
            <button
              className={`toolbar-btn ${
                lifelogDashboardTab === 'chat' ? 'primary' : ''
              }`}
              style={{ border: 'none', padding: '6px 14px', fontWeight: 700 }}
              onClick={() => {
                setLifelogDashboardTab('chat');
                setRightSidebarOpen(true);
                if (
                  mobileSidebarTab !== 'kakaotalk' &&
                  mobileSidebarTab !== 'sms' &&
                  mobileSidebarTab !== 'call'
                ) {
                  setMobileSidebarTab('kakaotalk');
                  setMobileSourceFilter('kakaotalk');
                } else {
                  setMobileSourceFilter(mobileSidebarTab);
                }
                refreshAllLifelogMessages();
              }}
            >
              💬 대화 ({chatCount}건)
            </button>
            <button
              className={`toolbar-btn ${
                lifelogDashboardTab === 'records' ? 'primary' : ''
              }`}
              style={{ border: 'none', padding: '6px 14px', fontWeight: 700 }}
              onClick={() => {
                setLifelogDashboardTab('records');
                setRightSidebarOpen(true);
                if (
                  mobileSidebarTab !== 'recording' &&
                  mobileSidebarTab !== 'media' &&
                  mobileSidebarTab !== 'contacts'
                ) {
                  setMobileSidebarTab('recording');
                }
                refreshAllLifelogMessages();
              }}
            >
              🗂️ 기록 (녹음·사진/영상·연락처)
            </button>
            <button
              className={`toolbar-btn ${
                lifelogDashboardTab === 'pc_activity' ? 'primary' : ''
              }`}
              style={{ border: 'none', padding: '6px 14px', fontWeight: 700 }}
              onClick={() => {
                setLifelogDashboardTab('pc_activity');
                setRightSidebarOpen(true);
                if (
                  mobileSidebarTab !== 'pc_log' &&
                  mobileSidebarTab !== 'notification' &&
                  mobileSidebarTab !== 'health'
                ) {
                  setMobileSidebarTab('pc_log');
                }
                refreshAllLifelogMessages();
              }}
            >
              📊 모니터링 (PC로그·M로그·헬스)
            </button>
          </div>
        </div>
      </div>

      {lifelogDashboardTab === 'settings' && (
        <>
          <SyncProgressCard
            mobileSyncProgress={mobileSyncProgress}
            setMobileSyncProgress={setMobileSyncProgress}
          />

          {reconcileResultMsg && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: 'var(--accent-soft)',
                border: '1px solid var(--accent-primary)',
                borderRadius: '8px',
                marginBottom: '14px',
                color: '#e0e7ff',
                fontWeight: 600,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ whiteSpace: 'pre-wrap' }}>
                {reconcileResultMsg}
              </span>
              <button
                className="toolbar-btn"
                style={{ padding: '2px 8px', fontSize: '11px' }}
                onClick={() => setReconcileResultMsg('')}
              >
                ✕
              </button>
            </div>
          )}
        </>
      )}

      {lifelogDashboardTab === 'settings' &&
        (mobilePairing ? (
          <LifelogSettingsTab
            mobilePairing={mobilePairing}
            setMobilePairing={setMobilePairing}
            qrDataUrl={qrDataUrl}
            ssidInputText={ssidInputText}
            setSsidInputText={setSsidInputText}
            refreshMobilePairingInfo={refreshMobilePairingInfo}
            setStatusMessage={setStatusMessage}
            setReconcileResultMsg={setReconcileResultMsg}
            geminiStatus={geminiStatus}
            setGeminiStatus={setGeminiStatus}
            geminiKeyInput={geminiKeyInput}
            setGeminiKeyInput={setGeminiKeyInput}
            isVerifyingGemini={isVerifyingGemini}
            setAwaitingClipboardKey={setAwaitingClipboardKey}
            tryRegisterGeminiKeyString={tryRegisterGeminiKeyString}
            appSettings={appSettings}
            setAppSettings={setAppSettings}
            handleUpdateAppSettings={handleUpdateAppSettings}
          />
        ) : (
          <div
            style={{
              padding: '28px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            🔄 모바일 페어링 정보 및 현재 Wi-Fi 자격 증명을 불러오는 중입니다...
          </div>
        ))}

      {lifelogDashboardTab === 'chat' && (
        <LifelogMobileDataTab
          mobilePersonFilter={mobilePersonFilter}
          setMobilePersonFilter={setMobilePersonFilter}
          mobileSourceFilter={mobileSourceFilter}
          setMobileSourceFilter={setMobileSourceFilter}
          mobileSidebarTab={mobileSidebarTab}
          setMobileSidebarTab={setMobileSidebarTab}
          allLifelogMessages={allLifelogMessages}
          handleSelectLifelogSidebarItem={handleSelectLifelogSidebarItem}
          setMobileContextMenu={setMobileContextMenu}
          resolveContactName={resolveContactName}
        />
      )}

      {lifelogDashboardTab === 'records' && (
        <LifelogRecordsTab
          allLifelogMessages={allLifelogMessages}
          contactsMap={contactsMap}
          mobileSidebarTab={mobileSidebarTab}
          setMobileSidebarTab={setMobileSidebarTab}
          mobilePersonFilter={mobilePersonFilter}
          setMobilePersonFilter={setMobilePersonFilter}
          setLifelogDashboardTab={setLifelogDashboardTab}
          handleSelectLifelogSidebarItem={handleSelectLifelogSidebarItem}
          setMobileContextMenu={setMobileContextMenu}
          resolveContactName={resolveContactName}
        />
      )}

      {lifelogDashboardTab === 'pc_activity' && (
        <div className="lifelog-records-container">
          <div className="lifelog-records-subtabs">
            <div className="lifelog-records-subtab-group">
              <button
                className={`toolbar-btn ${
                  activeMonitoringSubTab === 'pc_log' ? 'primary' : ''
                }`}
                onClick={() => setMobileSidebarTab('pc_log')}
              >
                🖥️ PC로그 (ActivityWatch)
              </button>
              <button
                className={`toolbar-btn ${
                  activeMonitoringSubTab === 'notification' ? 'primary' : ''
                }`}
                onClick={() => setMobileSidebarTab('notification')}
              >
                📱 M로그 ({notiCount})
              </button>
              <button
                className={`toolbar-btn ${
                  activeMonitoringSubTab === 'health' ? 'primary' : ''
                }`}
                onClick={() => setMobileSidebarTab('health')}
              >
                🏃 헬스 ({healthCount})
              </button>
            </div>
          </div>

          {activeMonitoringSubTab === 'pc_log' && <PcActivityTab />}

          {activeMonitoringSubTab === 'notification' && (
            <LifelogMobileDataTab
              fixedSource="notification"
              mobilePersonFilter={mobilePersonFilter}
              setMobilePersonFilter={setMobilePersonFilter}
              mobileSourceFilter="notification"
              setMobileSourceFilter={setMobileSourceFilter}
              mobileSidebarTab={mobileSidebarTab}
              setMobileSidebarTab={setMobileSidebarTab}
              allLifelogMessages={allLifelogMessages}
              handleSelectLifelogSidebarItem={handleSelectLifelogSidebarItem}
              setMobileContextMenu={setMobileContextMenu}
              resolveContactName={resolveContactName}
            />
          )}

          {activeMonitoringSubTab === 'health' && (
            <LifelogMobileDataTab
              fixedSource="health"
              mobilePersonFilter={mobilePersonFilter}
              setMobilePersonFilter={setMobilePersonFilter}
              mobileSourceFilter="health"
              setMobileSourceFilter={setMobileSourceFilter}
              mobileSidebarTab={mobileSidebarTab}
              setMobileSidebarTab={setMobileSidebarTab}
              allLifelogMessages={allLifelogMessages}
              handleSelectLifelogSidebarItem={handleSelectLifelogSidebarItem}
              setMobileContextMenu={setMobileContextMenu}
              resolveContactName={resolveContactName}
            />
          )}
        </div>
      )}
    </div>
  );
}
