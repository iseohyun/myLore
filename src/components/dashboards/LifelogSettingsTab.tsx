/**
 * @file LifelogSettingsTab.tsx
 * @description 라이프로그 대시보드 [설정] 탭: Wi-Fi 자격 증명 포함 QR 페어링, 항목별 동기화 워터마크 표, Gemini API 키 검증 및 쿼터 표시.
 */
import React from 'react';
import {
  GeminiApiKeyStatus,
  MobilePairingPayload,
  MyLoreAppSettings,
} from '../../types/mylore';
import {
  openExternalUrlInChrome,
  removePairedMobileDevice,
  saveAndVerifyGeminiApiKey,
  sendMobileUdpWakeBroadcast,
  setAutoCallTranscription,
  triggerFullMobileResync,
  updateMobilePairingConfig,
} from '../../services/tauriClient';

export interface LifelogSettingsTabProps {
  mobilePairing: MobilePairingPayload;
  setMobilePairing: React.Dispatch<React.SetStateAction<MobilePairingPayload | null>>;
  qrDataUrl: string;
  ssidInputText: string;
  setSsidInputText: React.Dispatch<React.SetStateAction<string>>;
  refreshMobilePairingInfo: () => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  setReconcileResultMsg: React.Dispatch<React.SetStateAction<string>>;
  geminiStatus: GeminiApiKeyStatus | null;
  setGeminiStatus: React.Dispatch<React.SetStateAction<GeminiApiKeyStatus | null>>;
  geminiKeyInput: string;
  setGeminiKeyInput: React.Dispatch<React.SetStateAction<string>>;
  isVerifyingGemini: boolean;
  setAwaitingClipboardKey: React.Dispatch<React.SetStateAction<boolean>>;
  tryRegisterGeminiKeyString: (rawKey: string) => Promise<boolean>;
  appSettings: MyLoreAppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<MyLoreAppSettings>>;
}

export function LifelogSettingsTab({
  mobilePairing,
  setMobilePairing,
  qrDataUrl,
  ssidInputText,
  setSsidInputText,
  refreshMobilePairingInfo,
  setStatusMessage,
  setReconcileResultMsg,
  geminiStatus,
  setGeminiStatus,
  geminiKeyInput,
  setGeminiKeyInput,
  isVerifyingGemini,
  setAwaitingClipboardKey,
  tryRegisterGeminiKeyString,
  appSettings,
  setAppSettings,
}: LifelogSettingsTabProps) {
  return (
    <div
      style={{
        padding: '18px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '8px 0 4px 0',
        }}
      >
        <div
          style={{
            padding: '12px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '2px solid var(--accent-primary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            boxShadow: '0 6px 18px rgba(0, 0, 0, 0.25)',
          }}
          title="기본 카메라 앱으로 촬영 시 myLore Sync 앱이 열리며 즉시 연결됩니다 (myloresync://pair?data=...)"
        >
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="myLore Sync Pairing QR Code"
              style={{ width: '200px', height: '200px', display: 'block' }}
            />
          ) : (
            <div
              style={{
                width: '200px',
                height: '200px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#334155',
                fontSize: '12px',
              }}
            >
              QR 생성 중...
            </div>
          )}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th style={{ width: '170px' }}>항목</th>
              <th>설정 값 및 인라인 제어</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 700 }}>호스트 이름</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {mobilePairing.pcName}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>IPv4 주소</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {mobilePairing.ips.join(', ')}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>포트</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {mobilePairing.port} (UDP 브로드캐스트: 18444)
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>토큰</td>
              <td>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      padding: '3px 8px',
                      backgroundColor: 'var(--bg-primary)',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    {mobilePairing.token}
                  </code>
                  <button
                    className="toolbar-btn primary"
                    onClick={async () => {
                      await refreshMobilePairingInfo();
                      const wakeMsg = await sendMobileUdpWakeBroadcast();
                      const guideMsg = `📲 다른 기기 추가 연결 준비 완료: 상단 QR 코드를 추가할 휴대폰의 기본 카메라로 스캔하세요. (기존 기기 연결 유지됨 | ${wakeMsg})`;
                      setStatusMessage(guideMsg);
                      setReconcileResultMsg(guideMsg);
                    }}
                    title="기존 페어링된 기기를 유지한 채 새로운 모바일 기기를 추가로 등록합니다"
                  >
                    📱 다른 기기 연결
                  </button>
                  <button
                    className="toolbar-btn"
                    onClick={async () => {
                      try {
                        const updated = await triggerFullMobileResync();
                        setMobilePairing(updated);
                        const msg =
                          '🔄 과거 모든 데이터 재수집(Full Resync) 신호(UDP 18444 & force_full_sync)가 송출되었으며 동기화 워터마크가 초기화되었습니다.';
                        setStatusMessage(msg);
                        setReconcileResultMsg(msg);
                      } catch (err) {
                        setStatusMessage(`전체 재수집 요청 오류: ${String(err)}`);
                      }
                    }}
                    title="모바일 기기의 동기화 워터마크를 초기화하여 과거의 모든 카톡·알림·문자·통화·연락처 데이터를 처음부터 다시 받아옵니다"
                  >
                    🔄 과거 모든 데이터 받아오기
                  </button>
                </div>
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>SSID</td>
              <td>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <input
                    className="input-field"
                    style={{
                      flex: 1,
                      minWidth: '200px',
                      maxWidth: '340px',
                      fontFamily: 'var(--font-mono)',
                    }}
                    value={ssidInputText}
                    onChange={(e) => setSsidInputText(e.target.value)}
                    placeholder="비워 두면 PC의 현재 Wi-Fi가 QR에 자동 포함 (예: MyHomeWiFi, MyHomeWiFi_5G)"
                  />
                  <button
                    className="toolbar-btn primary"
                    onClick={async () => {
                      const parsed = ssidInputText
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const updated = await updateMobilePairingConfig(
                        parsed,
                        false
                      );
                      setMobilePairing(updated);
                      setSsidInputText(updated.ssids.join(', '));
                      const msg = `✅ 허용 Wi-Fi SSID가 [${updated.ssids.join(', ')}](으)로 변경되어 QR 코드에 반영되었습니다.`;
                      setStatusMessage(msg);
                      setReconcileResultMsg(msg);
                    }}
                  >
                    SSID 변경
                  </button>
                  {mobilePairing.ssid && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      📶 현재 QR 포함:{' '}
                      <strong>{mobilePairing.ssid}</strong> (
                      {mobilePairing.wifiAuth || 'WPA2'}
                      {mobilePairing.hasWifiPassword
                        ? ' · 접속 키 자동 포함됨'
                        : ' · 접속 키 없음'}
                      )
                    </span>
                  )}
                </div>
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>등록 기기명</td>
              <td>
                {mobilePairing.pairedDevices.length === 0 ? (
                  <span style={{ color: 'var(--text-muted)' }}>
                    미등록 (상단 QR 코드를 휴대폰 카메라로 스캔하세요)
                  </span>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {mobilePairing.pairedDevices.map((dev) => (
                      <span
                        key={dev.deviceId}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '3px 10px',
                          backgroundColor: 'var(--bg-primary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          fontWeight: 700,
                        }}
                      >
                        <span>📱 {dev.deviceName}</span>
                        <button
                          className="toolbar-btn"
                          style={{
                            padding: '1px 6px',
                            fontSize: '11px',
                            color: '#f87171',
                            borderColor: 'rgba(248, 113, 113, 0.4)',
                          }}
                          onClick={async () => {
                            const updated = await removePairedMobileDevice(
                              dev.deviceId
                            );
                            setMobilePairing(updated);
                            const msg = `🗑️ 기기 '${dev.deviceName}' (${dev.deviceId}) 연결이 제거되었습니다.`;
                            setStatusMessage(msg);
                            setReconcileResultMsg(msg);
                          }}
                          title={`${dev.deviceName} (${dev.deviceId}) 기기 등록 해제`}
                        >
                          기기 제거
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>기기 ID</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                {mobilePairing.pairedDevices.length === 0
                  ? '-'
                  : mobilePairing.pairedDevices
                      .map((d) => `${d.deviceName}: ${d.deviceId}`)
                      .join(' | ')}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>모델 버전</td>
              <td>
                {mobilePairing.pairedDevices.length === 0
                  ? '-'
                  : mobilePairing.pairedDevices
                      .map((d) => `${d.deviceName}: ${d.model}`)
                      .join(' | ')}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>최초 페어링</td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                {mobilePairing.pairedDevices.length === 0
                  ? '-'
                  : mobilePairing.pairedDevices
                      .map((d) => `${d.deviceName}: ${d.pairedAt}`)
                      .join(' | ')}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>최근 페어링</td>
              <td
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color:
                    mobilePairing.pairedDevices.length > 0
                      ? '#4ade80'
                      : 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                {mobilePairing.pairedDevices.length === 0
                  ? '-'
                  : mobilePairing.pairedDevices
                      .map((d) => `${d.deviceName}: ${d.lastSeenAt}`)
                      .join(' | ')}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>Gemini API 키</td>
              <td>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      backgroundColor: geminiStatus?.hasKey
                        ? 'rgba(34, 197, 94, 0.18)'
                        : 'rgba(245, 158, 11, 0.18)',
                      color: geminiStatus?.hasKey
                        ? '#4ade80'
                        : '#fbbf24',
                    }}
                  >
                    {isVerifyingGemini
                      ? '⏳ 자동 검증 중...'
                      : geminiStatus?.hasKey
                        ? `✓ 연동됨 (${geminiStatus.maskedKey} · ${geminiStatus.modelName || 'gemini-3.8-flash'})`
                        : '미등록'}
                  </span>

                  <input
                    type="password"
                    className="input-field"
                    style={{
                      flex: 1,
                      minWidth: '210px',
                      maxWidth: '320px',
                      fontFamily: 'var(--font-mono)',
                    }}
                    value={geminiKeyInput}
                    disabled={isVerifyingGemini}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData('text');
                      if (pasted && pasted.trim()) {
                        e.preventDefault();
                        setGeminiKeyInput(pasted.trim());
                        setTimeout(() => {
                          tryRegisterGeminiKeyString(pasted.trim());
                        }, 20);
                      }
                    }}
                    placeholder="AIzaSy... 붙여넣기 시 즉시 자동 검증·저장"
                  />

                  <button
                    className="toolbar-btn primary"
                    onClick={() => {
                      setAwaitingClipboardKey(true);
                      openExternalUrlInChrome(
                        'https://aistudio.google.com/app/apikey'
                      );
                      setStatusMessage(
                        '🌐 Google AI Studio가 열렸습니다. API 키를 복사하거나 입력창에 붙여넣으면 자동으로 검증·저장됩니다.'
                      );
                    }}
                  >
                    구글 API키 받기
                  </button>

                  <button
                    className="toolbar-btn primary"
                    disabled={isVerifyingGemini}
                    onClick={async () => {
                      if (geminiKeyInput.trim()) {
                        await tryRegisterGeminiKeyString(geminiKeyInput);
                      } else {
                        try {
                          const clip = await navigator.clipboard.readText();
                          await tryRegisterGeminiKeyString(clip);
                        } catch {
                          await tryRegisterGeminiKeyString(geminiKeyInput);
                        }
                      }
                    }}
                  >
                    {isVerifyingGemini ? '검증 중...' : '저장'}
                  </button>

                  {geminiStatus?.hasKey && (
                    <button
                      className="toolbar-btn"
                      disabled={isVerifyingGemini}
                      onClick={async () => {
                        const stat = await saveAndVerifyGeminiApiKey('');
                        setGeminiStatus(stat);
                        setStatusMessage(
                          '🗑️ 로컬 보안 저장소에서 Gemini API 키가 삭제되었습니다.'
                        );
                      }}
                    >
                      삭제
                    </button>
                  )}
                </div>
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>자동 스크립트 추출</td>
              <td>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'inline-flex', gap: '4px' }}>
                    <button
                      className={`toolbar-btn ${
                        (geminiStatus?.autoCallTranscription ??
                          appSettings.autoCallTranscription ??
                          true)
                          ? 'primary'
                          : ''
                      }`}
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      onClick={async () => {
                        const stat = await setAutoCallTranscription(true);
                        setGeminiStatus(stat);
                        setAppSettings((prev) => ({
                          ...prev,
                          autoCallTranscription: true,
                        }));
                        setStatusMessage(
                          '✅ 자동 스크립트 추출(Yes) 활성화: 가장 최근 통화음성부터 토큰이 허락하는 대로 스크립트 및 요약을 자동 추출합니다.'
                        );
                      }}
                    >
                      ✓ Yes (자동 추출)
                    </button>
                    <button
                      className={`toolbar-btn ${
                        !(
                          geminiStatus?.autoCallTranscription ??
                          appSettings.autoCallTranscription ??
                          true
                        )
                          ? 'primary'
                          : ''
                      }`}
                      style={{ padding: '4px 12px', fontSize: '12px' }}
                      onClick={async () => {
                        const stat = await setAutoCallTranscription(false);
                        setGeminiStatus(stat);
                        setAppSettings((prev) => ({
                          ...prev,
                          autoCallTranscription: false,
                        }));
                        setStatusMessage(
                          '⏸️ 자동 스크립트 추출(No) 비활성화: 통화 우클릭 메뉴에서 원하는 통화만 선택하여 추출할 수 있습니다.'
                        );
                      }}
                    >
                      No (수동만)
                    </button>
                  </div>
                  <span
                    style={{
                      fontSize: '11.5px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    가장 최근 통화음성부터 토큰이 허락하는 대로 자동 추출 · 토큰 부족 시 마지막 실패시각 기억 후 <strong>5시간 대기 뒤 자동 재시도</strong>
                  </span>
                </div>
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>토큰 사용량 / 상태</td>
              <td>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      flexWrap: 'wrap',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <span>
                      📊 오늘 사용:{' '}
                      <strong style={{ color: '#4ade80' }}>
                        {(geminiStatus?.todayUsedTokens ?? 0).toLocaleString()}{' '}
                        토큰
                      </strong>{' '}
                      ({geminiStatus?.todayRequestCount ?? 0}회 요청)
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span>
                      누적 사용:{' '}
                      <strong>
                        {(geminiStatus?.totalUsedTokens ?? 0).toLocaleString()}{' '}
                        토큰
                      </strong>
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span>
                      직전 요청:{' '}
                      {(geminiStatus?.lastRequestTokens ?? 0).toLocaleString()}{' '}
                      토큰
                    </span>
                    <span style={{ color: 'var(--border-color)' }}>|</span>
                    <span>
                      대기 통화:{' '}
                      <strong
                        style={{
                          color:
                            (geminiStatus?.pendingCallCount ?? 0) > 0
                              ? '#f87171'
                              : '#94a3b8',
                        }}
                      >
                        {geminiStatus?.pendingCallCount ?? 0}건
                      </strong>
                    </span>
                    <button
                      className="toolbar-btn"
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={() =>
                        openExternalUrlInChrome(
                          'https://aistudio.google.com/app/plan_information'
                        )
                      }
                      title="Google AI Studio 공식 플랜 및 잔여 할당량(Rate Limit) 대시보드 열기"
                    >
                      📈 AI Studio 잔여 한도 조회
                    </button>
                  </div>
                  {geminiStatus?.quotaExhaustedAt && (
                    <div
                      style={{
                        fontSize: '11.5px',
                        color: '#fca5a5',
                        fontWeight: 600,
                      }}
                    >
                      ⚠️ 마지막 토큰 부족 실패시각:{' '}
                      <code>{geminiStatus.quotaExhaustedAt}</code> → 5시간 대기 후 재시도 예정:{' '}
                      <code>{geminiStatus.retryAfterAt || '5시간 후'}</code>
                    </div>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
