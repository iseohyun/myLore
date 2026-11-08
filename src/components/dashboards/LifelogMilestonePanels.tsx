/**
 * @file LifelogMilestonePanels.tsx
 * @description 마일스톤 Step-by-Step 컴포넌트 모음:
 * - CallPromptManagerPanel (AI #5 / M#2 Step 1): 통화 분석 프롬프트 설정 및 프롬프트 A / B 원문 열람·관리
 * - MultiLlmSettingsRows (AI #6·#7·#8 / M#3 Step 1·2·3): Claude · GPT · Grok 개별 API 연동 및 크레딧($) 잔액 관리
 * - MediaOriginRegistryPanel (ADD #8 / M#1 Step 1): 미디어 원본(origin) 해시 DB화 및 중복 방지 추적
 * - LocationMovementTrackerPanel (ADD #9·#10 / M#4 Step 1·2): 모바일 GPS·Wi-Fi 동선 로깅 수집 및 지도 연동 추적
 */
import React, { useEffect, useState } from 'react';
import {
  ContactPromptTournamentStatus,
  LocationMovementSummary,
  MediaOriginRegistrySummary,
  MultiLlmProvidersStatus,
  MyLoreAppSettings,
} from '../../types/mylore';
import {
  DEFAULT_CALL_ANALYSIS_PROMPT,
  getAppSettings,
  getContactPromptTournamentStatus,
  getLocationMovementLogs,
  getMediaOriginRegistrySummary,
  getMultiLlmProvidersStatus,
  openExternalUrlInChrome,
  recordLocationMovementEntry,
  saveAndVerifyLlmProviderKey,
  saveAppSettings,
  saveLlmProviderBillingConfig,
  setActiveTextLlmProvider,
  updateContactPromptSlotManual,
  updateMediaOriginStatus,
} from '../../services/tauriClient';

// ============================================================================
// 1. AI #5 (M#2 Step 1): 통화 분석 프롬프트 설정 및 프롬프트 A / B 관리 패널
// ============================================================================

export interface CallPromptManagerPanelProps {
  compactInDashboard?: boolean;
  appSettings?: MyLoreAppSettings;
  onSettingsUpdated?: (next: MyLoreAppSettings) => void;
  setStatusMessage?: (msg: string) => void;
}

export function CallPromptManagerPanel({
  compactInDashboard = true,
  appSettings,
  onSettingsUpdated,
  setStatusMessage,
}: CallPromptManagerPanelProps) {
  const [isOpen, setIsOpen] = useState(!compactInDashboard);
  const [promptDraft, setPromptDraft] = useState(
    appSettings?.callAnalysisPrompt || DEFAULT_CALL_ANALYSIS_PROMPT
  );
  const [saveMsg, setSaveMsg] = useState('');
  const [abStatus, setAbStatus] = useState<ContactPromptTournamentStatus | null>(null);
  const [titleA, setTitleA] = useState('');
  const [textA, setTextA] = useState('');
  const [titleB, setTitleB] = useState('');
  const [textB, setTextB] = useState('');

  useEffect(() => {
    if (appSettings?.callAnalysisPrompt) {
      setPromptDraft(appSettings.callAnalysisPrompt);
    } else {
      getAppSettings()
        .then((s) => setPromptDraft(s.callAnalysisPrompt || DEFAULT_CALL_ANALYSIS_PROMPT))
        .catch(() => {});
    }
    getContactPromptTournamentStatus()
      .then((st) => {
        setAbStatus(st);
        if (st?.slotA) {
          setTitleA(st.slotA.promptTitle);
          setTextA(st.slotA.promptText);
        }
        if (st?.slotB) {
          setTitleB(st.slotB.promptTitle);
          setTextB(st.slotB.promptText);
        }
      })
      .catch(() => {});
  }, [appSettings?.callAnalysisPrompt]);

  const handleSavePrompt = async () => {
    try {
      const current = appSettings || (await getAppSettings());
      const nextPrompt = promptDraft.trim() || DEFAULT_CALL_ANALYSIS_PROMPT;
      const saved = await saveAppSettings({ ...current, callAnalysisPrompt: nextPrompt });
      setPromptDraft(saved.callAnalysisPrompt || nextPrompt);
      onSettingsUpdated?.(saved);
      const msg = '✅ 통화 AI 분석 프롬프트 및 연락처 관계 열람 정책이 저장되었습니다.';
      setSaveMsg(msg);
      setStatusMessage?.(msg);
      window.setTimeout(() => setSaveMsg(''), 3500);
    } catch (err) {
      setSaveMsg(`저장 오류: ${String(err)}`);
    }
  };

  const handleSaveAbSlot = async (slot: 'A' | 'B') => {
    try {
      const next = await updateContactPromptSlotManual({
        slot,
        promptTitle: slot === 'A' ? titleA : titleB,
        promptText: slot === 'A' ? textA : textB,
        reason: `설정 > AI Setting에서 프롬프트 ${slot} 수정`,
      });
      setAbStatus(next);
      const msg = `✅ 프롬프트 ${slot} 저장 완료 (v${slot === 'A' ? next.slotA.version : next.slotB.version})`;
      setSaveMsg(msg);
      setStatusMessage?.(msg);
      window.setTimeout(() => setSaveMsg(''), 3500);
    } catch (err) {
      setSaveMsg(`프롬프트 ${slot} 저장 오류: ${String(err)}`);
    }
  };

  return (
    <div style={{ padding: '12px 16px', marginBottom: compactInDashboard ? '12px' : 0, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--heading-color)' }}>
            📝 통화 분석 프롬프트 & 프롬프트 A / B 원문 관리 (M#2 Step 1)
          </span>
          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: 'rgba(99, 102, 241, 0.16)', color: '#a5b4fc', fontWeight: 600 }}>
            {'{contact_name}'} 자동 치환 · 프롬프트 A(전화목소리 보관관리) / B 동시 열람·편집
          </span>
        </div>
        {compactInDashboard && (
          <button className="toolbar-btn" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setIsOpen((prev) => !prev)}>
            {isOpen ? '▾ 프롬프트 편집기 접기' : '▸ 통화 분석 & 프롬프트 A/B 열람·수정'}
          </button>
        )}
      </div>

      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {abStatus && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '10px' }}>
              {(['A', 'B'] as const).map((slot) => {
                const isA = slot === 'A';
                const tVal = isA ? titleA : titleB;
                const bVal = isA ? textA : textB;
                const info = isA ? abStatus.slotA : abStatus.slotB;
                return (
                  <div
                    key={slot}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-primary)',
                      border: isA ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(168, 85, 247, 0.45)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ fontSize: '12.5px', color: isA ? '#38bdf8' : '#c084fc' }}>
                        {isA ? '🅰️ 프롬프트 A (전화목소리 별도 보관관리 포함)' : '🅱️ 프롬프트 B (표준 경합 프롬프트)'} · v{info.version}
                      </strong>
                      <button
                        type="button"
                        className="toolbar-btn primary"
                        style={{ padding: '3px 9px', fontSize: '11.5px' }}
                        onClick={() => void handleSaveAbSlot(slot)}
                      >
                        💾 프롬프트 {slot} 저장
                      </button>
                    </div>
                    <input
                      type="text"
                      className="input-field"
                      style={{ fontSize: '12px', fontWeight: 700 }}
                      value={tVal}
                      onChange={(e) => (isA ? setTitleA(e.target.value) : setTitleB(e.target.value))}
                    />
                    <textarea
                      className="ai-profile-textarea"
                      style={{ minHeight: '150px', fontFamily: 'var(--font-mono)', fontSize: '11.5px', lineHeight: 1.45 }}
                      value={bVal}
                      onChange={(e) => (isA ? setTextA(e.target.value) : setTextB(e.target.value))}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--heading-color)' }}>
            🎙️ 기본 통화 오디오 전사 프롬프트 (문장 단위 타임스탬프 · 화자혼동 방지)
          </div>
          <textarea
            className="ai-profile-textarea"
            style={{ minHeight: '135px', fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder={DEFAULT_CALL_ANALYSIS_PROMPT}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              💡 음성통화를 LLM에 의뢰할 때 위 프롬프트와 함께 <code>[👤 사용자 개인화 정보]</code> 및 <code>[📇 연락처 당사자 관계 · 소속 모임 배경지식]</code>이 자동으로 결합되어 전달됩니다.
              {saveMsg && <strong style={{ marginLeft: '8px', color: '#4ade80' }}>{saveMsg}</strong>}
            </span>
            <button className="toolbar-btn primary" onClick={handleSavePrompt}>
              💾 통화 프롬프트 저장
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. AI #6·#7·#8 (M#3 Step 1·2·3): Claude · GPT · Grok 개별 API 연동 설정 행
// ============================================================================

export interface MultiLlmSettingsRowsProps {
  setStatusMessage: (msg: string) => void;
}

const PROVIDER_META: Array<{
  key: 'claude' | 'openai' | 'grok';
  stepLabel: string;
  title: string;
  placeholder: string;
  consoleUrl: string;
  consoleBtnLabel: string;
  models: string[];
}> = [
  {
    key: 'claude',
    stepLabel: 'M#3 Step 1',
    title: 'Claude API 키 (Anthropic)',
    placeholder: 'sk-ant-... 전체 키 입력 또는 붙여넣기 시 검증·저장',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleBtnLabel: 'Claude 키 발급',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-sonnet-4-0', 'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
  },
  {
    key: 'openai',
    stepLabel: 'M#3 Step 2',
    title: 'GPT API 키 (OpenAI)',
    placeholder: 'sk-proj-... 입력 또는 붙여넣기 시 검증·저장',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleBtnLabel: 'OpenAI 키 발급',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  },
  {
    key: 'grok',
    stepLabel: 'M#3 Step 3',
    title: 'Grok API 키 (xAI)',
    placeholder: 'xai-... 입력 또는 붙여넣기 시 검증·저장',
    consoleUrl: 'https://console.x.ai/',
    consoleBtnLabel: 'Grok 키 발급',
    models: ['grok-3-mini', 'grok-3-latest', 'grok-2-latest', 'grok-beta'],
  },
];

export function MultiLlmSettingsRows({ setStatusMessage }: MultiLlmSettingsRowsProps) {
  const [multiStatus, setMultiStatus] = useState<MultiLlmProvidersStatus | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({ claude: '', openai: '', grok: '' });
  const [modelSelections, setModelSelections] = useState<Record<string, string>>({
    claude: 'claude-haiku-4-5',
    openai: 'gpt-4o-mini',
    grok: 'grok-3-mini',
  });
  const [chargedCredits, setChargedCredits] = useState<Record<string, string>>({
    claude: '5.00',
    openai: '0.00',
    grok: '5.00',
  });
  const [adminKeyInputs, setAdminKeyInputs] = useState<Record<string, string>>({ claude: '', openai: '', grok: '' });
  const [teamIdInputs, setTeamIdInputs] = useState<Record<string, string>>({ claude: '', openai: '', grok: '' });
  const [verifyingProvider, setVerifyingProvider] = useState<string | null>(null);

  const syncFromStatus = (res: MultiLlmProvidersStatus) => {
    setMultiStatus(res);
    setModelSelections({
      claude: res.claude.modelName || 'claude-haiku-4-5',
      openai: res.openai.modelName || 'gpt-4o-mini',
      grok: res.grok.modelName || 'grok-3-mini',
    });
    setChargedCredits({
      claude: (res.claude.chargedCreditUsd ?? 5.0).toFixed(2),
      openai: (res.openai.chargedCreditUsd ?? 0.0).toFixed(2),
      grok: (res.grok.chargedCreditUsd ?? 5.0).toFixed(2),
    });
    setTeamIdInputs({
      claude: res.claude.teamId || '',
      openai: res.openai.teamId || '',
      grok: res.grok.teamId || '',
    });
  };

  useEffect(() => {
    getMultiLlmProvidersStatus().then(syncFromStatus).catch(() => {});
  }, []);

  const handleSaveProviderKey = async (provider: 'claude' | 'openai' | 'grok', rawKey: string) => {
    const trimmed = rawKey.trim();
    const alreadyHasKey = Boolean(multiStatus?.[provider]?.hasKey);
    if (!trimmed && !alreadyHasKey) {
      setStatusMessage(`⚠️ ${provider.toUpperCase()} API 키를 입력해 주세요.`);
      return;
    }
    setVerifyingProvider(provider);
    try {
      const updated = await saveAndVerifyLlmProviderKey(provider, trimmed, modelSelections[provider]);
      syncFromStatus(updated);
      setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      window.dispatchEvent(new CustomEvent('mylore-multi-llm-updated'));
      const savedProv = updated[provider];
      if (savedProv?.lastError) {
        setStatusMessage(`✅ ${provider.toUpperCase()} API 키가 정상 등록되었습니다 (잔여 크레딧/쿼터 제한 상태: ${savedProv.lastError})`);
      } else {
        setStatusMessage(`✅ ${provider.toUpperCase()} API 키 검증 및 연동이 완료되었습니다 (${savedProv?.modelName || ''}).`);
      }
    } catch (err) {
      setStatusMessage(`❌ ${provider.toUpperCase()} API 검증 실패: ${String(err)}`);
      getMultiLlmProvidersStatus().then(syncFromStatus).catch(() => {});
    } finally {
      setVerifyingProvider(null);
    }
  };

  const handleSaveBillingConfig = async (provider: 'claude' | 'openai' | 'grok') => {
    setVerifyingProvider(provider);
    try {
      const parsedUsd = parseFloat(chargedCredits[provider] || '0');
      const updated = await saveLlmProviderBillingConfig({
        provider,
        chargedCreditUsd: Number.isFinite(parsedUsd) ? parsedUsd : undefined,
        adminApiKey: (adminKeyInputs[provider] || '').trim() || undefined,
        teamId: (teamIdInputs[provider] || '').trim() || undefined,
      });
      syncFromStatus(updated);
      setAdminKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      window.dispatchEvent(new CustomEvent('mylore-multi-llm-updated'));
      const savedProv = updated[provider];
      setStatusMessage(`💰 ${provider.toUpperCase()} 크레딧 잔액 설정 완료: ${savedProv.creditDisplayText || '0$'} (${savedProv.balanceSource || ''})`);
    } catch (err) {
      setStatusMessage(`⚠️ ${provider.toUpperCase()} 크레딧/Management API 조회 오류: ${String(err)}`);
      getMultiLlmProvidersStatus().then(syncFromStatus).catch(() => {});
    } finally {
      setVerifyingProvider(null);
    }
  };

  const handleDeleteProviderKey = async (provider: 'claude' | 'openai' | 'grok') => {
    setVerifyingProvider(provider);
    try {
      const updated = await saveAndVerifyLlmProviderKey(provider, '__DELETE__');
      syncFromStatus(updated);
      window.dispatchEvent(new CustomEvent('mylore-multi-llm-updated'));
      setStatusMessage(`🗑️ ${provider.toUpperCase()} API 키가 보안 저장소에서 삭제되었습니다.`);
    } catch (err) {
      setStatusMessage(`삭제 실패: ${String(err)}`);
    } finally {
      setVerifyingProvider(null);
    }
  };

  return (
    <>
      {PROVIDER_META.map((meta) => {
        const stat = multiStatus ? multiStatus[meta.key] : null;
        const isVerifying = verifyingProvider === meta.key;

        return (
          <tr key={meta.key}>
            <td style={{ fontWeight: 700 }}>
              <div>{meta.title}</div>
              <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>({meta.stepLabel})</div>
            </td>
            <td>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontSize: '11.5px',
                      fontWeight: 700,
                      backgroundColor: stat?.hasKey
                        ? stat?.lastError || stat?.retryAfterAt
                          ? 'rgba(245, 158, 11, 0.18)'
                          : 'rgba(34, 197, 94, 0.18)'
                        : 'rgba(148, 163, 184, 0.16)',
                      color: stat?.hasKey
                        ? stat?.lastError || stat?.retryAfterAt
                          ? '#fbbf24'
                          : '#4ade80'
                        : 'var(--text-secondary)',
                    }}
                  >
                    {isVerifying
                      ? '⏳ 검증 중...'
                      : stat?.hasKey
                        ? stat?.lastError || stat?.retryAfterAt
                          ? `⚠️ 키 등록됨 · 5시간 대기 (${stat.maskedKey} · ${stat.modelName})`
                          : `✓ 연동됨 (${stat.maskedKey} · ${stat.modelName})`
                        : '미등록'}
                  </span>

                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: '999px',
                      fontSize: '11.5px',
                      fontWeight: 800,
                      fontFamily: 'var(--font-mono)',
                      backgroundColor: stat?.creditExhausted || (stat?.remainingCreditUsd ?? 0) <= 0.005 ? 'rgba(239, 68, 68, 0.18)' : 'rgba(56, 189, 248, 0.16)',
                      color: stat?.creditExhausted || (stat?.remainingCreditUsd ?? 0) <= 0.005 ? '#f87171' : '#38bdf8',
                    }}
                    title={`충전: $${(stat?.chargedCreditUsd ?? 0).toFixed(2)} | 사용 차감: $${(stat?.spentCreditUsd ?? 0).toFixed(4)} (${stat?.balanceSource || '-'})`}
                  >
                    💰 잔액: {stat?.creditDisplayText || '0$'}
                  </span>

                  <select
                    className="task-status-select"
                    style={{ padding: '4px 8px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    value={modelSelections[meta.key] || meta.models[0]}
                    onChange={(e) => setModelSelections((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                  >
                    {meta.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>

                  <input
                    type="password"
                    className="input-field"
                    style={{ flex: 1, minWidth: '180px', maxWidth: '250px', fontFamily: 'var(--font-mono)' }}
                    value={keyInputs[meta.key] || ''}
                    disabled={isVerifying}
                    onChange={(e) => setKeyInputs((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData('text');
                      if (pasted && pasted.trim()) {
                        e.preventDefault();
                        const clean = pasted.trim();
                        setKeyInputs((prev) => ({ ...prev, [meta.key]: clean }));
                        setTimeout(() => handleSaveProviderKey(meta.key, clean), 20);
                      }
                    }}
                    placeholder={meta.placeholder}
                  />

                  <button className="toolbar-btn" onClick={() => openExternalUrlInChrome(meta.consoleUrl)}>
                    {meta.consoleBtnLabel}
                  </button>

                  <button className="toolbar-btn primary" disabled={isVerifying} onClick={() => handleSaveProviderKey(meta.key, keyInputs[meta.key] || '')}>
                    {isVerifying ? '검증 중...' : '검증·저장'}
                  </button>

                  {stat?.hasKey && (
                    <button className="toolbar-btn" disabled={isVerifying} onClick={() => handleDeleteProviderKey(meta.key)}>
                      삭제
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '11.5px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>충전 크레딧($):</span>
                  <input
                    type="number"
                    step="0.01"
                    className="input-field"
                    style={{ width: '80px', padding: '3px 6px', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}
                    value={chargedCredits[meta.key] ?? '0.00'}
                    onChange={(e) => setChargedCredits((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                  />
                  {meta.key === 'grok' && (
                    <>
                      <input
                        type="password"
                        className="input-field"
                        style={{ width: '165px', padding: '3px 6px', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}
                        value={adminKeyInputs.grok || ''}
                        onChange={(e) => setAdminKeyInputs((prev) => ({ ...prev, grok: e.target.value }))}
                        placeholder={stat?.hasAdminKey ? `Management키 (${stat.maskedAdminKey})` : 'xAI Management API Key (선택)'}
                      />
                      <input
                        type="text"
                        className="input-field"
                        style={{ width: '140px', padding: '3px 6px', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}
                        value={teamIdInputs.grok || ''}
                        onChange={(e) => setTeamIdInputs((prev) => ({ ...prev, grok: e.target.value }))}
                        placeholder="xAI Team ID (선택)"
                      />
                    </>
                  )}
                  {meta.key === 'claude' && (
                    <input
                      type="password"
                      className="input-field"
                      style={{ width: '220px', padding: '3px 6px', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}
                      value={adminKeyInputs.claude || ''}
                      onChange={(e) => setAdminKeyInputs((prev) => ({ ...prev, claude: e.target.value }))}
                      placeholder={stat?.hasAdminKey ? `Admin키 (${stat.maskedAdminKey})` : 'sk-ant-admin-... (조직 Admin 키 · 선택)'}
                    />
                  )}
                  <button className="toolbar-btn" style={{ padding: '3px 9px', fontSize: '11.5px' }} disabled={isVerifying} onClick={() => handleSaveBillingConfig(meta.key)}>
                    💰 잔액 동기화·저장
                  </button>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    (소진: ${(stat?.spentCreditUsd ?? 0).toFixed(4)} · {stat?.balanceSource || '토큰 자동 차감'})
                  </span>
                </div>

                {(stat?.hasKey || stat?.lastError) && (
                  <div style={{ fontSize: '11.5px', fontFamily: 'var(--font-mono)', color: stat?.lastError ? '#fca5a5' : 'var(--text-secondary)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {stat?.hasKey && (
                      <span>
                        📊 오늘 사용: {(stat.todayUsedTokens || 0).toLocaleString('ko-KR')} 토큰 ({stat.todayRequestCount || 0}회) | 누적:{' '}
                        {(stat.totalUsedTokens || 0).toLocaleString('ko-KR')} 토큰 |{' '}
                        {stat.retryAfterAt ? `⏳ 5시간 대기 (해제 예정: ${stat.retryAfterAt})` : `상태: ${stat.verifiedAt || '-'}`}
                      </span>
                    )}
                    {stat?.lastError && <span>⚠️ {stat.lastError}</span>}
                  </div>
                )}
              </div>
            </td>
          </tr>
        );
      })}

      <tr>
        <td style={{ fontWeight: 700 }}>기본 텍스트 분석 LLM</td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {(
              [
                { id: 'gemini', label: '✨ Google Gemini' },
                { id: 'claude', label: '🧠 Anthropic Claude' },
                { id: 'openai', label: '🤖 OpenAI GPT' },
                { id: 'grok', label: '🚀 xAI Grok' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                className={`toolbar-btn ${(multiStatus?.activeTextProvider || 'gemini') === p.id ? 'primary' : ''}`}
                style={{ padding: '4px 12px', fontSize: '12px' }}
                onClick={async () => {
                  try {
                    const updated = await setActiveTextLlmProvider(p.id);
                    setMultiStatus(updated);
                    setStatusMessage(`✅ 기본 텍스트/문서 분석 LLM 공급자가 '${p.label}'로 설정되었습니다.`);
                  } catch (err) {
                    setStatusMessage(`공급자 변경 오류: ${String(err)}`);
                  }
                }}
              >
                {p.label}
              </button>
            ))}
            <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
              * 각 대형 LLM을 개별 연동해 두고 파츠별(통화·요약·스케줄 복기)로 분담 활용합니다.
            </span>
          </div>
        </td>
      </tr>
    </>
  );
}

// ============================================================================
// 3. ADD #8 (M#1 Step 1): 미디어 원본(origin) 해시 DB화 및 중복 방지 추적 패널
// ============================================================================

export function MediaOriginRegistryPanel() {
  const [summary, setSummary] = useState<MediaOriginRegistrySummary | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const loadRegistry = async (rescan: boolean) => {
    setIsScanning(true);
    try {
      setSummary(await getMediaOriginRegistrySummary(rescan));
    } catch {
      // ignore
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    loadRegistry(false);
  }, []);

  if (!summary) return null;

  return (
    <div style={{ padding: '12px 16px', marginBottom: '12px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--heading-color)' }}>
            🛡️ M#1 Step 1: 미디어 원본(Origin) 해시 추적 & 중복 방지 레지스트리
          </span>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            등록된 원본 해시 총 <strong>{summary.totalOriginCount}건</strong> · 원본 유지 <strong style={{ color: '#4ade80' }}>{summary.originalKeptCount}건</strong> · 편집/이름변경 <strong style={{ color: '#60a5fa' }}>{summary.editedOrRenamedCount}건</strong> · 삭제 후 재수신 차단 <strong style={{ color: '#fbbf24' }}>{summary.deletedBlockedCount}건</strong>
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button className="toolbar-btn primary" style={{ padding: '4px 10px', fontSize: '12px' }} disabled={isScanning} onClick={() => loadRegistry(true)}>
            {isScanning ? '⏳ 디스크 대조 중...' : '🔄 디스크 상태·해시 대조'}
          </button>
          <button className="toolbar-btn" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setShowTable((prev) => !prev)}>
            {showTable ? '▾ 해시 레지스트리 접기' : '▸ 원본 해시 추적 목록 보기'}
          </button>
        </div>
      </div>

      {showTable && (
        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>상태</th>
                <th>원본 파일명</th>
                <th>촬영 일시</th>
                <th>원본 SHA-256 해시</th>
                <th>이력 메모</th>
                <th>추적 관리</th>
              </tr>
            </thead>
            <tbody>
              {summary.items.slice(0, 100).map((item) => (
                <tr key={item.originHash}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
                    {item.currentStatus === 'original' ? '🟢 원본유지' : item.currentStatus === 'edited' ? '🔵 편집본' : item.currentStatus === 'deleted' ? '🚫 삭제(차단)' : item.currentStatus}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{item.originFileName}</td>
                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>{item.takenDate} {item.takenTime}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }} title={item.originHash}>{item.originHash.slice(0, 14)}...</td>
                  <td style={{ fontSize: '11.5px' }}>{item.historyNote}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'inline-flex', gap: '4px' }}>
                      <button
                        className="toolbar-btn"
                        style={{ padding: '2px 7px', fontSize: '11px' }}
                        onClick={async () => {
                          const next = await updateMediaOriginStatus({ originHash: item.originHash, status: 'edited', note: '편집/개선 완료 표시 (원본 재수신 차단)' });
                          setSummary(next);
                        }}
                      >
                        편집됨 표시
                      </button>
                      <button
                        className="toolbar-btn"
                        style={{ padding: '2px 7px', fontSize: '11px', color: '#fca5a5' }}
                        onClick={async () => {
                          const next = await updateMediaOriginStatus({ originHash: item.originHash, status: 'deleted', deleteDiskFile: false });
                          setSummary(next);
                        }}
                        title="원본 해시를 차단 목록에 유지하여 파일을 지워도 모바일에서 다시 받지 않습니다"
                      >
                        재수신 차단
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. ADD #9·#10 (M#4 Step 1·2): 모바일 GPS · Wi-Fi 로깅 수집 및 구글지도 동선 · 시간대별 라벨 추적
// ============================================================================

export function LocationMovementTrackerPanel({
  allLifelogMessages = [],
}: {
  allLifelogMessages?: Array<{
    id: number;
    source: string;
    roomOrSender: string;
    sender: string;
    message: string;
    sentDate: string;
    sentTime: string;
  }>;
}) {
  const [locSummary, setLocSummary] = useState<LocationMovementSummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [placeInput, setPlaceInput] = useState('');
  const [ssidInput, setSsidInput] = useState('');
  const [latInput, setLatInput] = useState('34.8806');
  const [lngInput, setLngInput] = useState('128.6211');
  const [showAddForm, setShowAddForm] = useState(false);

  const loadLogs = async () => {
    try {
      const res = await getLocationMovementLogs({ limit: 500 });
      setLocSummary(res);
      if (!selectedDate && res.logs.length > 0) setSelectedDate(res.logs[0].logDate);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadLogs();
    const onSelectDate = (e: Event) => {
      const d = (e as CustomEvent<{ date?: string }>).detail?.date;
      if (d) setSelectedDate(d);
    };
    window.addEventListener('mylore-select-location-date', onSelectDate);
    return () => window.removeEventListener('mylore-select-location-date', onSelectDate);
  }, []);

  const availableDates = Array.from(new Set((locSummary?.logs || []).map((l) => l.logDate).filter(Boolean))).sort((a, b) => b.localeCompare(a));
  const activeDate = selectedDate || availableDates[0] || new Date().toISOString().slice(0, 10);
  const dayLogs = (locSummary?.logs || [])
    .filter((l) => l.logDate === activeDate)
    .slice()
    .sort((a, b) => (a.logTime || '').localeCompare(b.logTime || ''));

  const gpsLogs = dayLogs.filter((l) => Math.abs(l.latitude) > 0.0001 && Math.abs(l.longitude) > 0.0001);
  const centerLat = gpsLogs.length > 0 ? gpsLogs[gpsLogs.length - 1].latitude : 34.8806;
  const centerLng = gpsLogs.length > 0 ? gpsLogs[gpsLogs.length - 1].longitude : 128.6211;
  const googleDirUrl =
    gpsLogs.length >= 2
      ? `https://www.google.com/maps/dir/${gpsLogs.map((g) => `${g.latitude.toFixed(6)},${g.longitude.toFixed(6)}`).join('/')}`
      : `https://www.google.com/maps/search/?api=1&query=${centerLat.toFixed(6)},${centerLng.toFixed(6)}`;

  const dayLifelogs = allLifelogMessages
    .filter((m) => m.sentDate === activeDate && (m.source === 'call' || m.source === 'health' || m.source === 'notification'))
    .slice(0, 12);

  const handleAddLocationEntry = async () => {
    const lat = parseFloat(latInput) || 0;
    const lng = parseFloat(lngInput) || 0;
    const eventType = ssidInput.trim() ? 'wifi_connect' : 'gps_passive';
    const updated = await recordLocationMovementEntry({
      eventType,
      placeLabel: placeInput.trim(),
      wifiSsid: ssidInput.trim(),
      latitude: lat,
      longitude: lng,
      accuracyM: 12,
    });
    setLocSummary(updated);
    if (updated.logs.length > 0) setSelectedDate(updated.logs[0].logDate);
    setPlaceInput('');
    setSsidInput('');
  };

  return (
    <div style={{ padding: '12px 16px', marginBottom: '12px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--heading-color)' }}>
            📍 날짜별 GPS · Wi-Fi 이동 동선 및 구글지도 타임라인 ({activeDate})
          </span>
          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            선택일 포인트 <strong>{dayLogs.length}건</strong> / 전체 누적 <strong>{locSummary?.totalLogs ?? 0}건</strong> (Wi-Fi {locSummary?.wifiLogsCount ?? 0}건 · GPS {locSummary?.gpsLogsCount ?? 0}건)
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {availableDates.length > 0 && (
            <select
              className="input-field"
              style={{ width: '135px', padding: '4px 8px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
              value={activeDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                window.dispatchEvent(new CustomEvent('mylore-location-date-changed', { detail: { date: e.target.value } }));
              }}
            >
              {availableDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          <button className="toolbar-btn primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => openExternalUrlInChrome(googleDirUrl)} title="해당 날짜의 전체 이동 경로를 구글 지도 다중 경유지로 엽니다">
            🌏 구글지도 전체 동선 열기
          </button>
          <button className="toolbar-btn" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setShowAddForm((prev) => !prev)}>
            {showAddForm ? '▾ 거점 추가 닫기' : '➕ 거점/GPS 기록'}
          </button>
          <button className="toolbar-btn" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={loadLogs}>
            🔄 새로고침
          </button>
        </div>
      </div>

      {showAddForm && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '10px', backgroundColor: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <input className="input-field" style={{ width: '160px' }} value={placeInput} onChange={(e) => setPlaceInput(e.target.value)} placeholder="장소명 (예: 거제집, 수영장)" />
          <input className="input-field" style={{ width: '140px', fontFamily: 'var(--font-mono)' }} value={ssidInput} onChange={(e) => setSsidInput(e.target.value)} placeholder="Wi-Fi SSID (선택)" />
          <input className="input-field" style={{ width: '110px', fontFamily: 'var(--font-mono)' }} value={latInput} onChange={(e) => setLatInput(e.target.value)} placeholder="위도 (34.8806)" />
          <input className="input-field" style={{ width: '110px', fontFamily: 'var(--font-mono)' }} value={lngInput} onChange={(e) => setLngInput(e.target.value)} placeholder="경도 (128.6211)" />
          <button className="toolbar-btn primary" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={handleAddLocationEntry}>
            📍 동선 기록 추가
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1.1fr) minmax(280px, 1fr)', gap: '12px' }}>
        <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)', minHeight: '230px', backgroundColor: 'var(--bg-primary)' }}>
          <iframe
            title="Google Maps Trajectory"
            width="100%"
            height="235"
            style={{ border: 0, display: 'block' }}
            loading="lazy"
            src={`https://maps.google.com/maps?q=${centerLat.toFixed(6)},${centerLng.toFixed(6)}&hl=ko&z=14&output=embed`}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '235px', overflowY: 'auto', padding: '10px', backgroundColor: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#a5b4fc' }}>
            🕒 {activeDate} 주요 시간대별 이동 동선 & 라이프로그 라벨
          </div>
          {dayLogs.map((l) => (
            <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', fontSize: '11.5px', padding: '4px 6px', borderRadius: '6px', backgroundColor: 'var(--bg-secondary)' }}>
              <span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>[{l.logTime.slice(0, 5)}]</strong>{' '}
                <strong>{l.placeLabel}</strong>{' '}
                <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                  {l.wifiSsid ? `(📶 ${l.wifiSsid})` : `(${l.latitude.toFixed(4)}, ${l.longitude.toFixed(4)})`}
                </span>
              </span>
              <button className="toolbar-btn" style={{ padding: '1px 6px', fontSize: '10.5px' }} onClick={() => openExternalUrlInChrome(l.googleMapUrl)}>
                구글지도
              </button>
            </div>
          ))}
          {dayLifelogs.map((m) => (
            <div key={`ll-${m.id}`} style={{ fontSize: '11px', color: 'var(--text-secondary)', padding: '3px 6px', borderLeft: '2px solid var(--accent-primary)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: '#c084fc' }}>[{m.sentTime.slice(0, 5)}]</span>{' '}
              [{m.source === 'call' ? '📞통화' : m.source === 'health' ? '🏃헬스' : '📱알림'}] {m.roomOrSender}: {(m.message || '').slice(0, 42)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
