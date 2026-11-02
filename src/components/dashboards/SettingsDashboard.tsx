/**
 * @file SettingsDashboard.tsx
 * @description 앱 환경설정 대시보드 (`mylore://dashboard/settings`):
 * 우측 사이드바(`Ctrl+B`) 카테고리 목차와 연동되어 7개 서브 대시보드
 * (`folders` · `appearance` · `shortcuts` · `sync_setting` · `sync_status` · `ai_setting` · `system_logs`)로 분할 렌더링합니다.
 */
import React from 'react';
import {
  BaseFolderConfig,
  BaseFolderRole,
  GeminiApiKeyStatus,
  KeybindingConfig,
  MobilePairingPayload,
  MobileSyncProgressPayload,
  MyLoreAppSettings,
  SettingsCategory,
  ThemePresetId,
} from '../../types/mylore';
import {
  DEFAULT_APP_SETTINGS,
  getBaseFolders,
  getServiceLogs,
  openNativeFolderDialog,
  pruneExpiredServiceLogs,
  saveBaseFolders,
  showInExplorer,
} from '../../services/tauriClient';
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDINGS_STORAGE_KEY,
} from '../../hooks/useKeybindings';
import { SettingsAppearanceSection } from './SettingsAppearanceSection';
import { SyncProgressCard } from './SyncProgressCard';
import { LifelogSettingsTab } from './LifelogSettingsTab';
import { LogDashboard } from './LogDashboard';
import { AiQueueSection } from './AiQueueSection';

export interface SettingsDashboardProps {
  settingsCategory?: SettingsCategory;
  setSettingsCategory?: React.Dispatch<React.SetStateAction<SettingsCategory>>;
  appSettings: MyLoreAppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<MyLoreAppSettings>>;
  handleUpdateAppSettings: (patch: Partial<MyLoreAppSettings>) => Promise<void>;
  handleApplyThemePreset: (presetId: Exclude<ThemePresetId, 'custom'>) => void;
  geminiStatus: GeminiApiKeyStatus | null;
  setGeminiStatus: React.Dispatch<
    React.SetStateAction<GeminiApiKeyStatus | null>
  >;
  geminiKeyInput: string;
  setGeminiKeyInput: React.Dispatch<React.SetStateAction<string>>;
  isVerifyingGemini: boolean;
  setAwaitingClipboardKey: React.Dispatch<React.SetStateAction<boolean>>;
  tryRegisterGeminiKeyString: (rawKey: string) => Promise<boolean>;
  handleToggleF11Viewer: () => void;
  setMenuBarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  baseFolders: BaseFolderConfig[];
  setBaseFolders: React.Dispatch<React.SetStateAction<BaseFolderConfig[]>>;
  refreshTree: () => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  openDashboardTab: (
    dashType: 'lifelog' | 'finance' | 'diary' | 'settings' | 'logs'
  ) => void;
  mobilePairing: MobilePairingPayload | null;
  setMobilePairing: React.Dispatch<
    React.SetStateAction<MobilePairingPayload | null>
  >;
  qrDataUrl: string;
  ssidInputText: string;
  setSsidInputText: React.Dispatch<React.SetStateAction<string>>;
  refreshMobilePairingInfo: () => Promise<void>;
  mobileSyncProgress: MobileSyncProgressPayload | null;
  setMobileSyncProgress: React.Dispatch<
    React.SetStateAction<MobileSyncProgressPayload | null>
  >;
  reconcileResultMsg: string;
  setReconcileResultMsg: React.Dispatch<React.SetStateAction<string>>;
  recordingShortcutTarget?: {
    id: string;
    field: 'shortcut' | 'secondaryShortcut';
  } | null;
  setRecordingShortcutTarget?: React.Dispatch<
    React.SetStateAction<{
      id: string;
      field: 'shortcut' | 'secondaryShortcut';
    } | null>
  >;
  keybindings?: KeybindingConfig[];
  setKeybindings?: React.Dispatch<React.SetStateAction<KeybindingConfig[]>>;
  helpSearchQuery?: string;
  setHelpSearchQuery?: React.Dispatch<React.SetStateAction<string>>;
  filteredKeybindings?: KeybindingConfig[];
}

const CATEGORY_TABS: Array<{
  id: SettingsCategory;
  icon: string;
  label: string;
  subtitle: string;
}> = [
  {
    id: 'folders',
    icon: '📁',
    label: '저장소 · 베이스 폴더',
    subtitle: '볼트 베이스 폴더 목록 및 setting.json 설정 파일 관리',
  },
  {
    id: 'appearance',
    icon: '🎨',
    label: '테마 · 글꼴 · 뷰어',
    subtitle: '5종 색상 테마, 폰트/크기, F11 뷰어 모드, 스크롤 동기화 및 에디터 기본값',
  },
  {
    id: 'shortcuts',
    icon: '⌨️',
    label: '단축키 설정',
    subtitle: '기능별 기본/보조 단축키 검색 및 실시간 키 입력 녹음 변경',
  },
  {
    id: 'sync_setting',
    icon: '📲',
    label: 'Sync Setting (기기 연결)',
    subtitle: '현재 NAT Wi-Fi 자동 포함 QR 페어링, IP/포트/토큰 및 연결된 모바일 기기 관리',
  },
  {
    id: 'sync_status',
    icon: '🔄',
    label: 'Sync Status (동기화 현황)',
    subtitle: '실시간 수신 진행률, 워터마크 재동기화, 미디어 원본 해시(M#1) 및 동선 추적(M#4)',
  },
  {
    id: 'ai_setting',
    icon: '🤖',
    label: 'AI Setting (멀티 LLM)',
    subtitle: 'Gemini · Claude · OpenAI · Grok 4대 LLM API 키/모델 연동 및 통화 분석 프롬프트 관리',
  },
  {
    id: 'ai_queue',
    icon: '🚥',
    label: 'AI Queue',
    subtitle: '분리된 독립 AI 큐 워커 프로세스 상태, 병렬 에이전트 슬롯 및 스크립팅 대기열(Queue) 관리',
  },
  {
    id: 'system_logs',
    icon: '📜',
    label: '시스템 로그 (Log)',
    subtitle: '통신 · 버전 · 시스템 · AI 4대 분야 실시간 로그 스트림 및 보관 주기 설정',
  },
];

export function SettingsDashboard({
  settingsCategory = 'folders',
  setSettingsCategory,
  appSettings,
  setAppSettings,
  handleUpdateAppSettings,
  handleApplyThemePreset,
  geminiStatus,
  setGeminiStatus,
  geminiKeyInput,
  setGeminiKeyInput,
  isVerifyingGemini,
  setAwaitingClipboardKey,
  tryRegisterGeminiKeyString,
  handleToggleF11Viewer,
  setMenuBarExpanded,
  baseFolders,
  setBaseFolders,
  refreshTree,
  setStatusMessage,
  openDashboardTab,
  mobilePairing,
  setMobilePairing,
  qrDataUrl,
  ssidInputText,
  setSsidInputText,
  refreshMobilePairingInfo,
  mobileSyncProgress,
  setMobileSyncProgress,
  reconcileResultMsg,
  setReconcileResultMsg,
  recordingShortcutTarget,
  setRecordingShortcutTarget,
  keybindings = [],
  setKeybindings,
  helpSearchQuery = '',
  setHelpSearchQuery,
  filteredKeybindings = [],
}: SettingsDashboardProps) {
  const activeMeta =
    CATEGORY_TABS.find((t) => t.id === settingsCategory) || CATEGORY_TABS[0];

  return (
    <div className="finance-workspace">
      {/* 상단 헤더 및 우측 사이드바 연동 안내 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>
            ⚙️ 설정 대쉬보드 — {activeMeta.icon} {activeMeta.label}
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '12.5px',
              marginTop: '4px',
            }}
          >
            {activeMeta.subtitle} (우측 사이드바 <kbd>Ctrl+B</kbd> 목차에서도
            카테고리를 빠르게 전환할 수 있습니다)
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="toolbar-btn"
            onClick={() =>
              handleUpdateAppSettings({
                ...DEFAULT_APP_SETTINGS,
                settingsFilePath: appSettings.settingsFilePath,
              })
            }
            title="글꼴, 크기, 테마, 색상 및 뷰어 설정을 기본값으로 초기화합니다"
          >
            ↺ 전체 설정 기본값 복원
          </button>
          <button
            className="toolbar-btn"
            onClick={() => showInExplorer(appSettings.settingsFilePath)}
            title="탐색기에서 Projects/.myLore/setting.json 위치 열기"
          >
            📂 setting.json 탐색기 열기
          </button>
        </div>
      </div>

      {/* 상단 빠른 카테고리 전환 바 */}
      <div
        style={{
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          padding: '6px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          marginBottom: '16px',
        }}
      >
        {CATEGORY_TABS.map((tab) => {
          const isActive = settingsCategory === tab.id;
          return (
            <button
              key={tab.id}
              className={`toolbar-btn ${isActive ? 'primary' : ''}`}
              style={{
                border: 'none',
                padding: '5px 11px',
                fontSize: '12px',
                fontWeight: 700,
              }}
              onClick={() => {
                setSettingsCategory?.(tab.id);
                if (
                  tab.id === 'sync_setting' ||
                  tab.id === 'sync_status' ||
                  tab.id === 'ai_setting'
                ) {
                  void refreshMobilePairingInfo();
                }
              }}
            >
              {tab.icon} {tab.label}
            </button>
          );
        })}
      </div>

      {/* 1. 저장소 · 베이스 폴더 */}
      {settingsCategory === 'folders' && (
        <>
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: '12.5px' }}>
              <span
                style={{ color: 'var(--text-secondary)', marginRight: '8px' }}
              >
                💾 설정 저장 파일:
              </span>
              <code style={{ color: 'var(--heading-color)', fontWeight: 700 }}>
                {appSettings.settingsFilePath}
              </code>
            </div>
            <span className="help-category-badge">
              변경 즉시 setting.json & 독립 뷰어 실시간 반영
            </span>
          </div>

          {/* 3대 카테고리(Docs · Git · Picture) 및 주제별 기본 폴더 지정 */}
          <div
            style={{
              padding: '18px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '15.5px', fontWeight: 700, margin: 0 }}>
                  🗂️ 3대 카테고리(`Docs` · `Git` · `Picture`) 및 주제별 기본 폴더 지정
                </h3>
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginTop: '3px',
                  }}
                >
                  <code>Docs</code> 루트 하위의 <code>Diary</code>(일기),{' '}
                  <code>Projects</code>(프로젝트), <code>Mobile</code>(모바일
                  라이프로그) 하위 폴더명(또는 절대 경로)과 <code>Git</code> ·{' '}
                  <code>Picture</code> 기본 폴더를 지정합니다.
                </p>
              </div>
              <button
                className="toolbar-btn primary"
                onClick={async () => {
                  await handleUpdateAppSettings({
                    topicFolderDocs: appSettings.topicFolderDocs || '',
                    topicFolderProjects:
                      appSettings.topicFolderProjects || 'Projects',
                    topicFolderDiary: appSettings.topicFolderDiary || 'Diary',
                    topicFolderMobile:
                      appSettings.topicFolderMobile || 'Mobile',
                    topicFolderGit: appSettings.topicFolderGit || 'C:\\git',
                    topicFolderPicture: appSettings.topicFolderPicture || '',
                  });
                  const synced = await getBaseFolders();
                  setBaseFolders(synced);
                  await refreshTree();
                  setStatusMessage(
                    '✅ 주제별 기본 폴더(Docs / Projects / Diary / Mobile / Git / Picture)가 베이스 폴더 및 트리에 반영되었습니다.'
                  );
                }}
              >
                ⚡ 주제별 기본 폴더 적용 및 트리 갱신
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
                gap: '10px',
              }}
            >
              {(
                [
                  {
                    key: 'topicFolderDocs',
                    badge: '1. Docs 루트',
                    title: '📂 Docs (통합 문서 루트 · 아카이브)',
                    placeholder: '예: C:\\Users\\iseoh\\iseohyun',
                  },
                  {
                    key: 'topicFolderProjects',
                    badge: 'Docs 하위',
                    title: '📌 Projects (프로젝트 폴더명 또는 경로)',
                    placeholder: '기본값: Projects',
                  },
                  {
                    key: 'topicFolderDiary',
                    badge: 'Docs 하위',
                    title: '📅 Diary (일기 · 캘린더 폴더명 또는 경로)',
                    placeholder: '기본값: Diary',
                  },
                  {
                    key: 'topicFolderMobile',
                    badge: 'Docs 하위',
                    title: '📱 Mobile (모바일 라이프로그 폴더명 또는 경로)',
                    placeholder: '기본값: Mobile (대문자 M)',
                  },
                  {
                    key: 'topicFolderGit',
                    badge: '2. Git 루트',
                    title: '💻 Git (개발 프로젝트 참고 폴더)',
                    placeholder: '기본값: C:\\git',
                  },
                  {
                    key: 'topicFolderPicture',
                    badge: '3. Picture 루트',
                    title: '🖼️ Picture (내 장치 및 과거 사진 통합 저장소)',
                    placeholder: '예: C:\\Users\\iseoh\\OneDrive\\Picture',
                  },
                ] as const
              ).map((item) => {
                const rawVal = String(appSettings[item.key] ?? '');
                const docsBase = (appSettings.topicFolderDocs || '').replace(
                  /[\\/]+$/,
                  ''
                );
                const resolvedPreview =
                  item.key === 'topicFolderProjects' ||
                  item.key === 'topicFolderDiary' ||
                  item.key === 'topicFolderMobile'
                    ? rawVal.includes(':') || rawVal.startsWith('\\\\')
                      ? rawVal
                      : docsBase
                      ? `${docsBase}\\${rawVal || item.placeholder.replace('기본값: ', '')}`
                      : rawVal
                    : rawVal;
                return (
                  <div
                    key={item.key}
                    style={{
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <strong
                        style={{
                          fontSize: '12.5px',
                          color: 'var(--heading-color)',
                        }}
                      >
                        {item.title}
                      </strong>
                      <span className="help-category-badge">{item.badge}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        className="input-field"
                        style={{
                          flex: 1,
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                        }}
                        value={rawVal}
                        placeholder={item.placeholder}
                        onChange={(e) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            [item.key]: e.target.value,
                          }))
                        }
                      />
                      <button
                        className="toolbar-btn"
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        onClick={async () => {
                          const picked = await openNativeFolderDialog();
                          if (picked) {
                            await handleUpdateAppSettings({
                              [item.key]: picked,
                            });
                            const synced = await getBaseFolders();
                            setBaseFolders(synced);
                            await refreshTree();
                          }
                        }}
                        title="폴더 선택 대화상자 열기"
                      >
                        📂 선택
                      </button>
                      {resolvedPreview && (
                        <button
                          className="toolbar-btn"
                          style={{ padding: '4px 8px', fontSize: '11.5px' }}
                          onClick={() => showInExplorer(resolvedPreview)}
                          title={`탐색기에서 열기: ${resolvedPreview}`}
                        >
                          ↗ 열기
                        </button>
                      )}
                    </div>
                    {resolvedPreview && resolvedPreview !== rawVal && (
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        ↳ 실제 경로: {resolvedPreview}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            style={{
              padding: '18px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div>
                <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
                  📁 베이스 폴더 상세 목록 및 폴더 목적 설정
                </h3>
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginTop: '4px',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {`Documents를 기본 폴더로 반드시 지정해야합니다.\n특수폴더(Diary, Project, Git, Picture)를 따로 지정하지 않으면 Document폴더 이하에 해당 폴더를 생성및 참조합니다.\nGit 및 Picture 타입으로 지정된 베이스 폴더는 마크다운 일괄 스캔에서 제외되며 YAML uuid를 주입하지 않습니다.`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="toolbar-btn"
                  onClick={() =>
                    setBaseFolders([
                      ...baseFolders,
                      {
                        id: `base-${Date.now()}`,
                        role: 'git',
                        path: 'C:\\git',
                        label: 'Git 폴더',
                        purpose:
                          'Git 코드/마크다운 저장소 (UUID 미주입, 스캔 제외)',
                        enabled: true,
                      },
                    ])
                  }
                >
                  + 베이스 폴더 추가
                </button>
                <button
                  className="toolbar-btn primary"
                  onClick={async () => {
                    await saveBaseFolders(baseFolders);
                    await refreshTree();
                    setStatusMessage(
                      '✅ 베이스 폴더 설정이 저장되고 트리가 갱신되었습니다.'
                    );
                  }}
                >
                  베이스 폴더 저장 및 트리 갱신
                </button>
              </div>
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              {baseFolders.map((bf, idx) => (
                <div
                  key={bf.id}
                  style={{
                    padding: '12px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                    }}
                  >
                    <select
                      className="task-status-select"
                      value={bf.role}
                      onChange={(e) => {
                        const next = [...baseFolders];
                        next[idx].role = e.target.value as BaseFolderRole;
                        setBaseFolders(next);
                      }}
                    >
                      <option value="data">Documents</option>
                      <option value="diary">Diary</option>
                      <option value="projects">Project</option>
                      <option value="git">Git</option>
                      <option value="picture">Picture</option>
                    </select>
                    <input
                      className="input-field"
                      style={{ flex: 1 }}
                      value={bf.path}
                      onChange={(e) => {
                        const next = [...baseFolders];
                        next[idx].path = e.target.value;
                        setBaseFolders(next);
                      }}
                    />
                    <button
                      className="toolbar-btn"
                      onClick={async () => {
                        const picked = await openNativeFolderDialog();
                        if (picked) {
                          const next = [...baseFolders];
                          next[idx].path = picked;
                          setBaseFolders(next);
                        }
                      }}
                      title="폴더 찾아보기"
                    >
                      📂 폴더 선택
                    </button>
                    <button
                      className="toolbar-btn"
                      style={{
                        color: '#f87171',
                        borderColor: 'rgba(248, 113, 113, 0.45)',
                        flexShrink: 0,
                      }}
                      onClick={async () => {
                        const next = baseFolders.filter((_, i) => i !== idx);
                        setBaseFolders(next);
                        await saveBaseFolders(next);
                        await refreshTree();
                        setStatusMessage(
                          `🗑️ 베이스 폴더 '${bf.path}'가 삭제되고 트리가 갱신되었습니다.`
                        );
                      }}
                      title="이 베이스 폴더를 목록에서 삭제하고 즉시 반영합니다"
                    >
                      🗑️ 삭제
                    </button>
                  </div>
                  <input
                    className="input-field"
                    value={bf.purpose}
                    onChange={(e) => {
                      const next = [...baseFolders];
                      next[idx].purpose = e.target.value;
                      setBaseFolders(next);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 2. 테마 · 글꼴 · 뷰어 */}
      {settingsCategory === 'appearance' && (
        <SettingsAppearanceSection
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          setStatusMessage={setStatusMessage}
          handleUpdateAppSettings={handleUpdateAppSettings}
          handleApplyThemePreset={handleApplyThemePreset}
          handleToggleF11Viewer={handleToggleF11Viewer}
          setMenuBarExpanded={setMenuBarExpanded}
        />
      )}

      {/* 3. 단축키 설정 */}
      {settingsCategory === 'shortcuts' && (
        <div
          style={{ padding: '18px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '10px' }}
        >
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}
          >
            <div>
              <h3 style={{ fontSize: '15.5px', fontWeight: 700, margin: 0 }}>
                ⌨️ 전체 단축키 설정 및 키 바인딩 녹음
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                기본/보조 단축키 버튼을 클릭한 뒤 원하는 키 조합을 누르면 즉시 반영됩니다.
              </p>
            </div>
            <button
              className="toolbar-btn"
              onClick={() => {
                setKeybindings?.(DEFAULT_KEYBINDINGS);
                localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(DEFAULT_KEYBINDINGS));
                setStatusMessage('↺ 단축키 설정이 기본값으로 초기화되었습니다.');
              }}
            >
              ↺ 단축키 기본값 초기화
            </button>
          </div>

          <div className="help-search-row" style={{ marginBottom: '12px' }}>
            <input
              type="text"
              className="input-field"
              placeholder="🔍 검색 (기능, 분류, 기본/보조 단축키, 조건으로 필터링...)"
              value={helpSearchQuery}
              onChange={(e) => setHelpSearchQuery?.(e.target.value)}
            />
            {helpSearchQuery && (
              <button className="toolbar-btn" onClick={() => setHelpSearchQuery?.('')}>
                초기화
              </button>
            )}
          </div>

          <div className="help-table-wrap" style={{ maxHeight: '540px' }}>
            <table className="help-table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>기능</th>
                  <th style={{ width: '14%' }}>분류</th>
                  <th style={{ width: '20%' }}>기본 단축키</th>
                  <th style={{ width: '20%' }}>보조 단축키</th>
                  <th style={{ width: '18%' }}>조건</th>
                </tr>
              </thead>
              <tbody>
                {(filteredKeybindings.length > 0 ? filteredKeybindings : keybindings).map((kb) => {
                  const isRecPrimary =
                    recordingShortcutTarget?.id === kb.id && recordingShortcutTarget.field === 'shortcut';
                  const isRecSecondary =
                    recordingShortcutTarget?.id === kb.id && recordingShortcutTarget.field === 'secondaryShortcut';
                  return (
                    <tr key={kb.id}>
                      <td style={{ fontWeight: 600 }}>{kb.label}</td>
                      <td>
                        <span className="help-category-badge">{kb.category}</span>
                      </td>
                      <td>
                        <button
                          className={`toolbar-btn help-shortcut-btn ${isRecPrimary ? 'primary' : ''}`}
                          disabled={kb.id === 'devtools_info'}
                          onClick={() => {
                            if (kb.id !== 'devtools_info') {
                              setRecordingShortcutTarget?.({ id: kb.id, field: 'shortcut' });
                            }
                          }}
                        >
                          {isRecPrimary ? '키 입력...' : kb.shortcut || '-'}
                        </button>
                      </td>
                      <td>
                        <button
                          className={`toolbar-btn help-shortcut-btn ${isRecSecondary ? 'primary' : ''}`}
                          disabled={kb.id === 'devtools_info'}
                          onClick={() => {
                            if (kb.id !== 'devtools_info') {
                              setRecordingShortcutTarget?.({ id: kb.id, field: 'secondaryShortcut' });
                            }
                          }}
                        >
                          {isRecSecondary ? '키 입력...' : kb.secondaryShortcut || '-'}
                        </button>
                      </td>
                      <td>
                        <span className="help-condition-badge">{kb.condition}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Sync Setting / 5. Sync Status / 6. AI Setting */}
      {(settingsCategory === 'sync_setting' ||
        settingsCategory === 'sync_status' ||
        settingsCategory === 'ai_setting') && (
        <>
          {settingsCategory === 'sync_status' && (
            <SyncProgressCard
              mobileSyncProgress={mobileSyncProgress}
              setMobileSyncProgress={setMobileSyncProgress}
            />
          )}

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

          {mobilePairing ? (
            <LifelogSettingsTab
              sectionFilter={settingsCategory}
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
          )}
        </>
      )}

      {/* 6-2. AI Queue (독립 AI 큐 프로세스 및 대기열 상태 대시보드) */}
      {settingsCategory === 'ai_queue' && (
        <AiQueueSection setStatusMessage={setStatusMessage} />
      )}

      {/* 7. 시스템 로그 (보관일 설정 + 실시간 로그 대시보드 통합) */}
      {settingsCategory === 'system_logs' && (
        <>
          <div
            style={{
              padding: '16px 18px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              marginBottom: '16px',
            }}
          >
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}
            >
              <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
                📋 4대 분야별 로그 기본 보관일 설정
              </h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  className="toolbar-btn"
                  onClick={async () => {
                    const removed = await pruneExpiredServiceLogs();
                    setStatusMessage(`🗑️ 보관 주기가 만료된 로그 파일 ${removed}개를 정리했습니다.`);
                  }}
                >
                  🗑️ 만료 로그 즉시 정리
                </button>
                <button
                  className="toolbar-btn"
                  onClick={async () => {
                    const info = await getServiceLogs({ limit: 1 });
                    if (info.logDirPath) await showInExplorer(info.logDirPath);
                  }}
                >
                  📂 log 폴더 열기
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
              {(
                [
                  { key: 'logRetentionCommDays', title: '📡 통신 로그 (comm)', color: '#38bdf8', defVal: 7 },
                  { key: 'logRetentionVersionDays', title: '🏷️ 버전 로그 (version)', color: '#4ade80', defVal: 30 },
                  { key: 'logRetentionSystemDays', title: '🖥️ 시스템 로그 (system)', color: '#a78bfa', defVal: 30 },
                  { key: 'logRetentionAiDays', title: '🤖 AI 로그 (ai)', color: '#fbbf24', defVal: 30 },
                ] as const
              ).map((item) => (
                <div
                  key={item.key}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '12.5px', color: item.color }}>{item.title}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="input-field"
                      style={{ width: '68px', padding: '3px 6px' }}
                      value={appSettings[item.key] ?? item.defVal}
                      onChange={(e) =>
                        handleUpdateAppSettings({
                          [item.key]: Math.max(1, Math.min(365, parseInt(e.target.value || String(item.defVal), 10))),
                        })
                      }
                    />
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>일</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ minHeight: '520px', height: '62vh' }}>
            <LogDashboard
              appSettings={appSettings}
              openDashboardTab={openDashboardTab}
              setStatusMessage={setStatusMessage}
            />
          </div>
        </>
      )}
    </div>
  );
}
