/**
 * @file LoginDashboard.tsx
 * @description 로그인 및 연동 통합 대시보드 (`mylore://dashboard/login`):
 * 1) Google 및 멀티 소셜 계정(네이버 · 카카오 · 페이스북 등) 로그인 지원 및 연동 상태 확인
 * 2) Google 캘린더 OAuth 2.0 로그인 및 양방향 동기화 상태 확인
 * 3) AI API 계정 및 키 등록 · 검증 · 크레딧($) 잔액 확인 (Gemini · Claude · OpenAI · Grok)
 * 4) 모바일 Sync 페어링 연결 (현재 Wi-Fi 포함 QR 제공) 및 연결 기기 상태 확인
 */
import React, { useEffect, useState } from 'react';
import {
  GeminiApiKeyStatus,
  GoogleCalendarSyncStatus,
  MobilePairingPayload,
  MyLoreAppSettings,
} from '../../types/mylore';
import {
  getGoogleCalendarSyncStatus,
  openExternalUrlInChrome,
  startGoogleCalendarOauthLogin,
  syncGoogleCalendarEvents,
} from '../../services/tauriClient';
import { LifelogSettingsTab } from './LifelogSettingsTab';

export interface SocialAccountEntry {
  id: string;
  provider: string;
  icon: string;
  accountHint: string;
  loginUrl: string;
  connected: boolean;
  lastCheckedAt: string;
}

const DEFAULT_SOCIAL_ACCOUNTS: SocialAccountEntry[] = [
  {
    id: 'google',
    provider: 'Google 계정',
    icon: '🌐',
    accountHint: 'Google Workspace · Drive · YouTube',
    loginUrl: 'https://accounts.google.com',
    connected: false,
    lastCheckedAt: '',
  },
  {
    id: 'naver',
    provider: '네이버 (Naver)',
    icon: '🟢',
    accountHint: '네이버 메일 · 캘린더 · 클라우드',
    loginUrl: 'https://nid.naver.com/nidlogin.login',
    connected: false,
    lastCheckedAt: '',
  },
  {
    id: 'kakao',
    provider: '카카오 (Kakao)',
    icon: '💬',
    accountHint: '카카오계정 · 카카오톡 채널',
    loginUrl: 'https://accounts.kakao.com',
    connected: false,
    lastCheckedAt: '',
  },
  {
    id: 'facebook',
    provider: '페이스북 (Meta)',
    icon: '📘',
    accountHint: 'Facebook · Instagram 계정',
    loginUrl: 'https://www.facebook.com/login',
    connected: false,
    lastCheckedAt: '',
  },
  {
    id: 'github',
    provider: 'GitHub',
    icon: '🐙',
    accountHint: 'Git 저장소 · Copilot 연동',
    loginUrl: 'https://github.com/login',
    connected: false,
    lastCheckedAt: '',
  },
];

export interface LoginDashboardProps {
  appSettings: MyLoreAppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<MyLoreAppSettings>>;
  handleUpdateAppSettings: (patch: Partial<MyLoreAppSettings>) => Promise<void>;
  geminiStatus: GeminiApiKeyStatus | null;
  setGeminiStatus: React.Dispatch<React.SetStateAction<GeminiApiKeyStatus | null>>;
  geminiKeyInput: string;
  setGeminiKeyInput: React.Dispatch<React.SetStateAction<string>>;
  isVerifyingGemini: boolean;
  setAwaitingClipboardKey: React.Dispatch<React.SetStateAction<boolean>>;
  tryRegisterGeminiKeyString: (rawKey: string) => Promise<boolean>;
  mobilePairing: MobilePairingPayload | null;
  setMobilePairing: React.Dispatch<React.SetStateAction<MobilePairingPayload | null>>;
  qrDataUrl: string;
  ssidInputText: string;
  setSsidInputText: React.Dispatch<React.SetStateAction<string>>;
  refreshMobilePairingInfo: () => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  setReconcileResultMsg: React.Dispatch<React.SetStateAction<string>>;
}

export function LoginDashboard({
  appSettings,
  setAppSettings,
  handleUpdateAppSettings,
  geminiStatus,
  setGeminiStatus,
  geminiKeyInput,
  setGeminiKeyInput,
  isVerifyingGemini,
  setAwaitingClipboardKey,
  tryRegisterGeminiKeyString,
  mobilePairing,
  setMobilePairing,
  qrDataUrl,
  ssidInputText,
  setSsidInputText,
  refreshMobilePairingInfo,
  setStatusMessage,
  setReconcileResultMsg,
}: LoginDashboardProps) {
  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarSyncStatus | null>(null);
  const [isSyncingGcal, setIsSyncingGcal] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountEntry[]>(() => {
    try {
      const saved = localStorage.getItem('mylore_social_accounts_v1');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return DEFAULT_SOCIAL_ACCOUNTS;
  });

  const refreshCalendarStatus = async () => {
    try {
      const st = await getGoogleCalendarSyncStatus();
      setGcalStatus(st);
      if (st.isConnected) {
        setSocialAccounts((prev) =>
          prev.map((acc) =>
            acc.id === 'google'
              ? {
                  ...acc,
                  connected: true,
                  lastCheckedAt: st.lastSyncAt || new Date().toISOString().slice(0, 16).replace('T', ' '),
                }
              : acc
          )
        );
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void refreshCalendarStatus();
    void refreshMobilePairingInfo();
  }, []);

  const saveSocialAccounts = (next: SocialAccountEntry[]) => {
    setSocialAccounts(next);
    try {
      localStorage.setItem('mylore_social_accounts_v1', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleOpenSocialLogin = async (acc: SocialAccountEntry) => {
    await openExternalUrlInChrome(acc.loginUrl);
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const next = socialAccounts.map((item) =>
      item.id === acc.id
        ? { ...item, connected: true, lastCheckedAt: nowStr }
        : item
    );
    saveSocialAccounts(next);
    setStatusMessage(`🔐 ${acc.provider} 브라우저 로그인 창을 열었습니다.`);
  };

  const handleToggleSocialConnected = (id: string) => {
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const next = socialAccounts.map((item) =>
      item.id === id
        ? {
            ...item,
            connected: !item.connected,
            lastCheckedAt: !item.connected ? nowStr : item.lastCheckedAt,
          }
        : item
    );
    saveSocialAccounts(next);
  };

  const handleStartGcalLogin = async () => {
    try {
      setIsSyncingGcal(true);
      const msg = await startGoogleCalendarOauthLogin();
      setStatusMessage(msg || '📅 Google Calendar OAuth 인증 완료');
      await refreshCalendarStatus();
    } catch (err) {
      setStatusMessage(`Google Calendar 로그인 오류: ${String(err)}`);
    } finally {
      setIsSyncingGcal(false);
    }
  };

  const handleSyncGcalNow = async () => {
    try {
      setIsSyncingGcal(true);
      const res = await syncGoogleCalendarEvents();
      setStatusMessage(`📅 캘린더 동기화: ${res.message}`);
      await refreshCalendarStatus();
    } catch (err) {
      setStatusMessage(`캘린더 동기화 실패: ${String(err)}`);
    } finally {
      setIsSyncingGcal(false);
    }
  };

  return (
    <div className="finance-workspace">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
            🔐 로그인 · AI API 키 · Sync 연결 대시보드
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '12.5px',
              marginTop: '4px',
            }}
          >
            계정 로그인(Google·네이버·카카오·페이스북), 캘린더 OAuth 연동, 멀티 LLM API 키/잔액 확인, 모바일 Sync QR 연결을 한곳에서 관리합니다.
          </p>
        </div>
      </div>

      {/* 1. 계정 로그인 및 캘린더 OAuth 연동 */}
      <div
        id="login-section-accounts"
        style={{
          padding: '18px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          marginBottom: '18px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
          🌐 1. 외부 계정 로그인 및 Google 캘린더 연동 상태
        </h3>

        {/* Google Calendar OAuth 전용 카드 */}
        <div
          id="login-section-calendar"
          style={{
            padding: '14px 16px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            marginBottom: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '14px' }}>📅 Google Calendar OAuth 2.0 연동</strong>
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontWeight: 700,
                  backgroundColor: gcalStatus?.isConnected
                    ? 'rgba(16, 185, 129, 0.16)'
                    : 'rgba(245, 158, 11, 0.16)',
                  color: gcalStatus?.isConnected ? '#34d399' : '#fbbf24',
                }}
              >
                {gcalStatus?.isConnected ? '✓ 연결됨' : '미연결'}
              </span>
            </div>
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
              }}
            >
              캘린더 ID: {gcalStatus?.defaultCalendarId || 'primary'} | 최근 동기화:{' '}
              {gcalStatus?.lastSyncAt || '기록 없음'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="toolbar-btn primary"
              disabled={isSyncingGcal}
              onClick={handleStartGcalLogin}
            >
              🔑 Google 캘린더 OAuth 로그인
            </button>
            <button
              className="toolbar-btn"
              disabled={isSyncingGcal}
              onClick={handleSyncGcalNow}
            >
              🔄 지금 캘린더 동기화
            </button>
          </div>
        </div>

        {/* 멀티 소셜 계정 테이블 */}
        <table className="data-table" style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '180px' }}>플랫폼</th>
              <th>용도 및 계정 메모</th>
              <th style={{ width: '130px' }}>상태</th>
              <th style={{ width: '210px' }}>동작</th>
            </tr>
          </thead>
          <tbody>
            {socialAccounts.map((acc) => (
              <tr key={acc.id}>
                <td style={{ fontWeight: 700 }}>
                  {acc.icon} {acc.provider}
                </td>
                <td>
                  <input
                    className="input-field"
                    style={{ fontSize: '12px', padding: '4px 8px' }}
                    value={acc.accountHint}
                    onChange={(e) => {
                      const next = socialAccounts.map((item) =>
                        item.id === acc.id
                          ? { ...item, accountHint: e.target.value }
                          : item
                      );
                      saveSocialAccounts(next);
                    }}
                    placeholder="연동 계정 이메일 또는 메모 입력"
                  />
                </td>
                <td>
                  <span
                    style={{
                      fontSize: '11.5px',
                      fontWeight: 700,
                      color: acc.connected ? '#34d399' : 'var(--text-secondary)',
                    }}
                  >
                    {acc.connected ? '✓ 로그인 확인됨' : '미확인'}
                  </span>
                  {acc.lastCheckedAt && (
                    <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                      {acc.lastCheckedAt}
                    </div>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      className="toolbar-btn primary"
                      style={{ fontSize: '11.5px', padding: '4px 9px' }}
                      onClick={() => handleOpenSocialLogin(acc)}
                    >
                      로그인 창 열기
                    </button>
                    <button
                      className="toolbar-btn"
                      style={{ fontSize: '11.5px', padding: '4px 8px' }}
                      onClick={() => handleToggleSocialConnected(acc.id)}
                    >
                      {acc.connected ? '연동 해제' : '상태 체크'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 2. AI API 키 등록 · 검증 · 잔액 확인 */}
      <div id="login-section-ai" style={{ marginBottom: '18px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px' }}>
          🤖 2. AI API 계정 · 키 등록 및 크레딧($) 잔액 확인
        </h3>
        {mobilePairing && (
          <LifelogSettingsTab
            sectionFilter="ai_setting"
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
        )}
      </div>

      {/* 3. Sync 페어링 연결 (QR 제공) 및 상태 확인 */}
      <div id="login-section-sync">
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px' }}>
          📲 3. 모바일 Sync 페어링 연결 (QR 코드) 및 기기 상태 확인
        </h3>
        {mobilePairing && (
          <LifelogSettingsTab
            sectionFilter="sync_setting"
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
        )}
      </div>
    </div>
  );
}
