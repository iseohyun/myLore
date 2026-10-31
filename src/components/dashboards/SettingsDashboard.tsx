/**
 * @file SettingsDashboard.tsx
 * @description 앱 환경설정 대시보드 (`mylore://dashboard/settings`): `<SettingsAppearanceSection />`, 스크롤·통화 스크립트·에디터 기본값, 베이스 폴더 관리.
 */
import React from 'react';
import {
  BaseFolderConfig,
  BaseFolderRole,
  GeminiApiKeyStatus,
  MyLoreAppSettings,
  ThemePresetId,
} from '../../types/mylore';
import {
  DEFAULT_APP_SETTINGS,
  openNativeFolderDialog,
  saveBaseFolders,
  setAutoCallTranscription,
  showInExplorer,
} from '../../services/tauriClient';
import { SettingsAppearanceSection } from './SettingsAppearanceSection';

export interface SettingsDashboardProps {
  appSettings: MyLoreAppSettings;
  handleUpdateAppSettings: (patch: Partial<MyLoreAppSettings>) => Promise<void>;
  handleApplyThemePreset: (presetId: Exclude<ThemePresetId, 'custom'>) => void;
  setGeminiStatus: React.Dispatch<
    React.SetStateAction<GeminiApiKeyStatus | null>
  >;
  handleToggleF11Viewer: () => void;
  setMenuBarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  baseFolders: BaseFolderConfig[];
  setBaseFolders: React.Dispatch<React.SetStateAction<BaseFolderConfig[]>>;
  refreshTree: () => Promise<void>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

export function SettingsDashboard({
  appSettings,
  handleUpdateAppSettings,
  handleApplyThemePreset,
  setGeminiStatus,
  handleToggleF11Viewer,
  setMenuBarExpanded,
  baseFolders,
  setBaseFolders,
  refreshTree,
  setStatusMessage,
}: SettingsDashboardProps) {
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
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>
            ⚙️ 설정 대쉬보드 (`Projects/.myLore/setting.json`)
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
            글꼴(기본/제목/표), 글꼴 크기, 테마·색상, 원본↔뷰어 스크롤 동기화, <kbd>F10</kbd> 상단 메뉴바 기본 상태, <kbd>F11</kbd> 뷰어 토글 동작 및 볼트 베이스 폴더를 관리합니다.
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

      <div
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          marginBottom: '18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: '12.5px' }}>
          <span style={{ color: 'var(--text-secondary)', marginRight: '8px' }}>
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

      <SettingsAppearanceSection
        appSettings={appSettings}
        handleUpdateAppSettings={handleUpdateAppSettings}
        handleApplyThemePreset={handleApplyThemePreset}
      />

      <div
        style={{
          padding: '18px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          marginBottom: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '16px',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-color)',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
              🎙️ 통화 녹음 자동 스크립트 추출 (`autoCallTranscription`)
            </h3>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                marginTop: '2px',
              }}
            >
              <strong>가장 최근 통화음성부터</strong> 토큰이 허락하는 대로 요약 및 화자 분리 스크립트를 자동으로 추출합니다. (토큰 부족 시 마지막 실패시각을 기억하고 5시간 대기 후 자동 재시도)
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`toolbar-btn ${
                (appSettings.autoCallTranscription ?? true) ? 'primary' : ''
              }`}
              onClick={async () => {
                const stat = await setAutoCallTranscription(true);
                setGeminiStatus(stat);
                handleUpdateAppSettings({ autoCallTranscription: true });
              }}
            >
              ✓ 자동 스크립트 추출: Yes (기본)
            </button>
            <button
              className={`toolbar-btn ${
                !(appSettings.autoCallTranscription ?? true) ? 'primary' : ''
              }`}
              onClick={async () => {
                const stat = await setAutoCallTranscription(false);
                setGeminiStatus(stat);
                handleUpdateAppSettings({ autoCallTranscription: false });
              }}
            >
              자동 스크립트 추출: No
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '16px',
            marginBottom: '16px',
            borderBottom: '1px solid var(--border-color)',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
              🔗 원본 에디터 ↔ 뷰어 스크롤 자동 동기화 (`scrollSyncEnabled`)
            </h3>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                marginTop: '2px',
              }}
            >
              원본 마크다운 에디터의 스크롤이 내려가면 현재 편집 중인 소스 줄(`data-source-line`) 위치를 추적하여{' '}
              <strong>병렬 뷰어</strong> 및 <strong>전용 독립 뷰어 창</strong>의 스크롤이 해당 블록 위치로 함께 내려갑니다.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`toolbar-btn ${
                appSettings.scrollSyncEnabled ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({ scrollSyncEnabled: true })
              }
            >
              ✓ 스크롤 동기화 켜기 (ON)
            </button>
            <button
              className={`toolbar-btn ${
                !appSettings.scrollSyncEnabled ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({ scrollSyncEnabled: false })
              }
            >
              스크롤 동기화 끄기 (OFF)
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
              🪟 <kbd>F11</kbd> 뷰어 토글 기본 옵션 (`f11ViewerMode`)
            </h3>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                marginTop: '2px',
              }}
            >
              문서 열람 중 <kbd>F11</kbd> 키를 눌렀을 때 전용 독립 뷰어 창을 켜고 끌지, 메인 창 내 병렬 뷰어를 켜고 끌지 선택합니다.
            </p>
          </div>
          <button
            className="toolbar-btn primary"
            onClick={handleToggleF11Viewer}
            title="현재 선택된 F11 동작을 즉시 테스트합니다"
          >
            ⚡ 지금 F11 토글 실행해보기
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '12px',
          }}
        >
          <div
            onClick={() =>
              handleUpdateAppSettings({ f11ViewerMode: 'detached' })
            }
            style={{
              padding: '16px',
              borderRadius: '8px',
              cursor: 'pointer',
              border:
                appSettings.f11ViewerMode === 'detached'
                  ? '2px solid var(--accent-primary)'
                  : '1px solid var(--border-color)',
              backgroundColor:
                appSettings.f11ViewerMode === 'detached'
                  ? 'var(--accent-soft)'
                  : 'var(--bg-primary)',
              transition: 'all 0.15s ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <strong
                style={{ fontSize: '14.5px', color: 'var(--heading-color)' }}
              >
                🪟 전용 독립 뷰어 (`detached`)
              </strong>
              {appSettings.f11ViewerMode === 'detached' && (
                <span className="role-badge projects">✓ 현재 선택됨</span>
              )}
            </div>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              <kbd>F11</kbd> 입력 시 <strong>별도의 전용 독립 뷰어 창</strong>을 켜고 끕니다.
              독립 뷰어가 켜지면 메인 창은 에디터 전용 모드로 동작하며 실시간으로 본문과 스크롤이 동기화됩니다.
            </p>
          </div>

          <div
            onClick={() => handleUpdateAppSettings({ f11ViewerMode: 'split' })}
            style={{
              padding: '16px',
              borderRadius: '8px',
              cursor: 'pointer',
              border:
                appSettings.f11ViewerMode === 'split'
                  ? '2px solid var(--accent-primary)'
                  : '1px solid var(--border-color)',
              backgroundColor:
                appSettings.f11ViewerMode === 'split'
                  ? 'var(--accent-soft)'
                  : 'var(--bg-primary)',
              transition: 'all 0.15s ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <strong
                style={{ fontSize: '14.5px', color: 'var(--heading-color)' }}
              >
                📐 병렬 뷰어 (`split`)
              </strong>
              {appSettings.f11ViewerMode === 'split' && (
                <span className="role-badge projects">✓ 현재 선택됨</span>
              )}
            </div>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}
            >
              <kbd>F11</kbd> 입력 시 메인 창 안에서{' '}
              <strong>에디터 전용 모드 ↔ 좌우 병렬(분할) 뷰어 모드</strong>를 즉시 켜고 끕니다.
            </p>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '18px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          marginBottom: '20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px',
        }}
      >
        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>
            💾 자동 저장 (`autoSaveEnabled`)
          </h4>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '10px',
            }}
          >
            본문/YAML 편집 후 1.2초 뒤 자동으로 디스크에 저장합니다.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`toolbar-btn ${
                appSettings.autoSaveEnabled ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({ autoSaveEnabled: true })
              }
            >
              ✓ 자동 저장 켜기 (ON)
            </button>
            <button
              className={`toolbar-btn ${
                !appSettings.autoSaveEnabled ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({ autoSaveEnabled: false })
              }
            >
              자동 저장 끄기 (OFF)
            </button>
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>
            ☰ <kbd>F10</kbd> 상단 메뉴바 시작 시 기본 상태 (`defaultMenuBarExpanded`)
          </h4>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '10px',
            }}
          >
            프로그램 시작 시 상단 텍스트 메뉴바(`파일/편집/...`)의 기본 열림/닫힘 상태를 설정합니다. (<kbd>F10</kbd>으로 언제든 토글)
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`toolbar-btn ${
                !appSettings.defaultMenuBarExpanded ? 'primary' : ''
              }`}
              onClick={() => {
                setMenuBarExpanded(false);
                handleUpdateAppSettings({
                  defaultMenuBarExpanded: false,
                });
              }}
            >
              ✓ 기본 닫힘 (OFF)
            </button>
            <button
              className={`toolbar-btn ${
                appSettings.defaultMenuBarExpanded ? 'primary' : ''
              }`}
              onClick={() => {
                setMenuBarExpanded(true);
                handleUpdateAppSettings({
                  defaultMenuBarExpanded: true,
                });
              }}
            >
              기본 열림 (ON)
            </button>
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>
            🖥️ 프로그램 시작 시 기본 편집 화면 (`defaultEditorViewMode`)
          </h4>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: '10px',
            }}
          >
            myLore 실행 시 기본으로 열릴 메인 창 모드를 지정합니다.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`toolbar-btn ${
                appSettings.defaultEditorViewMode === 'editor' ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({
                  defaultEditorViewMode: 'editor',
                })
              }
            >
              에디터 전용 (`editor`)
            </button>
            <button
              className={`toolbar-btn ${
                appSettings.defaultEditorViewMode === 'split' ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({
                  defaultEditorViewMode: 'split',
                })
              }
            >
              병렬 뷰어 (`split`)
            </button>
            <button
              className={`toolbar-btn ${
                appSettings.defaultEditorViewMode === 'preview' ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({
                  defaultEditorViewMode: 'preview',
                })
              }
            >
              뷰어 전용 (`preview`)
            </button>
          </div>
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
              📁 베이스 폴더 목록 및 폴더 목적 설정
            </h3>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '2px',
              }}
            >
              <code>Git (git)</code> 타입으로 지정된 베이스 폴더는 일괄 스캔에서 제외되며 YAML <code>uuid</code>를 주입하지 않고 열람·편집만 처리합니다.
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
                    purpose: 'Git 코드/마크다운 저장소 (UUID 미주입, 스캔 제외)',
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  className="task-status-select"
                  value={bf.role}
                  onChange={(e) => {
                    const next = [...baseFolders];
                    next[idx].role = e.target.value as BaseFolderRole;
                    setBaseFolders(next);
                  }}
                >
                  <option value="data">데이터 (Archive)</option>
                  <option value="diary">일기 (Diary)</option>
                  <option value="projects">프로젝트 (Projects)</option>
                  <option value="git">Git (스캔·UUID 제외)</option>
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
    </div>
  );
}
