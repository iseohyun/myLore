/**
 * @file LifelogDashboard.tsx
 * @description 단일 라이프로그 패널 대시보드 컨테이너 (`mylore://dashboard/{source}`).
 * 라이프로그 전체 통합·소규모 통합을 전면 제거하고, 왼쪽 액티비티 바에서 선택한 단일 카테고리만 출력합니다.
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
  SettingsCategory,
} from '../../types/mylore';
import { LifelogMobileDataTab } from './LifelogMobileDataTab';
import { LifelogRecordsTab } from './LifelogRecordsTab';
import { PcActivityTab } from './PcActivityTab';
import { LocationMovementTrackerPanel } from './LifelogMilestonePanels';

export interface LifelogDashboardProps {
  activeLifelogSource?: LifelogSourceType;
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
  openDashboardTab?: (dashType: any) => void;
  setSettingsCategory?: React.Dispatch<React.SetStateAction<SettingsCategory>>;
}

const LIFELOG_SOURCE_HEADERS: Record<
  LifelogSourceType,
  { icon: string; title: string; subtitle: string }
> = {
  call: {
    icon: '📞',
    title: '통화 대시보드',
    subtitle: '통화 기록, 녹음 재생 및 AI 자동 스크립트 변환 현황',
  },
  sms: {
    icon: '✉️',
    title: '문자 (SMS / MMS) 대시보드',
    subtitle: '모바일에서 동기화된 문자 메시지 내역',
  },
  kakaotalk: {
    icon: '💬',
    title: '카카오톡 대시보드',
    subtitle: '카카오톡 대화방별 메시지 및 알림 동기화 내역',
  },
  recording: {
    icon: '🎙️',
    title: '음성 녹음 대시보드',
    subtitle: '보이스레코더 음성 메모 및 전사 스크립트 보관함',
  },
  media: {
    icon: '🖼️',
    title: '사진 / 영상 미디어 대시보드',
    subtitle: '원본 해시 레지스트리 및 모바일 동기화 사진·동영상',
  },
  contacts: {
    icon: '📇',
    title: '연락처 대시보드',
    subtitle: '연락처 목록 및 인물 관계·소속 모임 AI 컨텍스트 편집',
  },
  pc_log: {
    icon: '💻',
    title: 'PC로그 대시보드 (ActivityWatch)',
    subtitle: '데스크톱 창 제목·앱 사용 시간 및 타임라인 분석',
  },
  notification: {
    icon: '📱',
    title: 'M로그 대시보드 (모바일 앱 사용)',
    subtitle: '스마트폰 앱 알림 및 모바일 활동 기록',
  },
  health: {
    icon: '❤️',
    title: '헬스 대시보드',
    subtitle: '걸음 수·수면·심박 등 모바일 헬스 케어 기록',
  },
  location: {
    icon: '📍',
    title: 'GPS · Wi-Fi 동선 대시보드',
    subtitle: '시간대별 위치 좌표, 체류 장소 및 Wi-Fi 연결 동선',
  },
};

export function LifelogDashboard({
  activeLifelogSource,
  setLifelogDashboardTab,
  mobileSidebarTab,
  setMobileSidebarTab,
  refreshAllLifelogMessages,
  setStatusMessage,
  mobilePersonFilter,
  setMobilePersonFilter,
  setMobileSourceFilter,
  allLifelogMessages,
  contactsMap = {},
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  resolveContactName,
  openDashboardTab,
}: LifelogDashboardProps) {
  const source: LifelogSourceType = activeLifelogSource || mobileSidebarTab || 'call';
  const meta = LIFELOG_SOURCE_HEADERS[source] || LIFELOG_SOURCE_HEADERS.call;

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
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
            {meta.icon} {meta.title}
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '12.5px',
              marginTop: '4px',
            }}
          >
            {meta.subtitle}
          </p>
        </div>
        {source !== 'contacts' && (
          <button
            className="toolbar-btn"
            onClick={() => void refreshAllLifelogMessages()}
            title="데이터 새로고침"
          >
            🔄 새로고침
          </button>
        )}
      </div>

      {(source === 'call' ||
        source === 'sms' ||
        source === 'kakaotalk' ||
        source === 'notification' ||
        source === 'health') && (
        <LifelogMobileDataTab
          fixedSource={source}
          mobilePersonFilter={mobilePersonFilter}
          setMobilePersonFilter={setMobilePersonFilter}
          mobileSourceFilter={source}
          setMobileSourceFilter={setMobileSourceFilter}
          mobileSidebarTab={source}
          setMobileSidebarTab={setMobileSidebarTab}
          allLifelogMessages={allLifelogMessages}
          handleSelectLifelogSidebarItem={handleSelectLifelogSidebarItem}
          setMobileContextMenu={setMobileContextMenu}
          resolveContactName={resolveContactName}
        />
      )}

      {(source === 'recording' ||
        source === 'media' ||
        source === 'contacts') && (
        <LifelogRecordsTab
          allLifelogMessages={allLifelogMessages}
          contactsMap={contactsMap}
          mobileSidebarTab={source}
          setMobileSidebarTab={setMobileSidebarTab}
          mobilePersonFilter={mobilePersonFilter}
          setMobilePersonFilter={setMobilePersonFilter}
          setMobileSourceFilter={setMobileSourceFilter}
          setLifelogDashboardTab={setLifelogDashboardTab}
          openDashboardTab={openDashboardTab}
          setStatusMessage={setStatusMessage}
          handleSelectLifelogSidebarItem={handleSelectLifelogSidebarItem}
          setMobileContextMenu={setMobileContextMenu}
          resolveContactName={resolveContactName}
        />
      )}

      {source === 'pc_log' && <PcActivityTab />}

      {source === 'location' && (
        <LocationMovementTrackerPanel
          allLifelogMessages={allLifelogMessages}
        />
      )}
    </div>
  );
}
