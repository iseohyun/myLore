/**
 * @file LifelogDashboard.tsx
 * @description 모바일 라이프로그 대시보드 컨테이너 (`F7`, `mylore://dashboard/lifelog`): 상단 동기화 상태바 및 설정/휴대폰데이터 탭 전환.
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

export interface LifelogDashboardProps {
  lifelogDashboardTab: 'settings' | 'mobile';
  setLifelogDashboardTab: React.Dispatch<
    React.SetStateAction<'settings' | 'mobile'>
  >;
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
  mobilePersonFilter: string;
  setMobilePersonFilter: React.Dispatch<React.SetStateAction<string>>;
  mobileSourceFilter: 'all' | LifelogSourceType;
  setMobileSourceFilter: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  allLifelogMessages: LifelogMessage[];
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  resolveContactName: (rawNumberOrName: string) => string;
}

export function LifelogDashboard({
  lifelogDashboardTab,
  setLifelogDashboardTab,
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
  mobilePersonFilter,
  setMobilePersonFilter,
  mobileSourceFilter,
  setMobileSourceFilter,
  allLifelogMessages,
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  resolveContactName,
}: LifelogDashboardProps) {
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
                lifelogDashboardTab === 'mobile' ? 'primary' : ''
              }`}
              style={{ border: 'none', padding: '6px 14px', fontWeight: 700 }}
              onClick={() => {
                setLifelogDashboardTab('mobile');
                setRightSidebarOpen(true);
                refreshAllLifelogMessages();
              }}
            >
              📱 휴대폰데이터
            </button>
          </div>
        </div>
      </div>

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
          <span style={{ whiteSpace: 'pre-wrap' }}>{reconcileResultMsg}</span>
          <button
            className="toolbar-btn"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => setReconcileResultMsg('')}
          >
            ✕
          </button>
        </div>
      )}

      {lifelogDashboardTab === 'settings' && mobilePairing && (
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
        />
      )}

      {lifelogDashboardTab === 'mobile' && (
        <LifelogMobileDataTab
          mobilePersonFilter={mobilePersonFilter}
          setMobilePersonFilter={setMobilePersonFilter}
          mobileSourceFilter={mobileSourceFilter}
          setMobileSourceFilter={setMobileSourceFilter}
          allLifelogMessages={allLifelogMessages}
          handleSelectLifelogSidebarItem={handleSelectLifelogSidebarItem}
          setMobileContextMenu={setMobileContextMenu}
          resolveContactName={resolveContactName}
        />
      )}
    </div>
  );
}
