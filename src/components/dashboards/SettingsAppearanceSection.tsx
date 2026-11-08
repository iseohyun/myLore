/**
 * @file SettingsAppearanceSection.tsx
 * @description 환경설정 대시보드 외관 섹션: 글꼴 프리셋(기본·제목·표), 5종 색상 테마 프리셋 및 커스텀 색상 피커.
 */
import React from 'react';
import { MyLoreAppSettings, ThemePresetId } from '../../types/mylore';
import {
  applyAppSettingsToDocument,
  FONT_FAMILY_PRESETS,
  getAppSettings,
  THEME_PRESETS,
} from '../../services/tauriClient';
import { DETACHED_PREVIEW_CHANNEL } from '../window/DetachedPreviewWindowView';

export interface SettingsAppearanceSectionProps {
  appSettings: MyLoreAppSettings;
  setAppSettings?: React.Dispatch<React.SetStateAction<MyLoreAppSettings>>;
  setStatusMessage?: React.Dispatch<React.SetStateAction<string>>;
  handleUpdateAppSettings: (patch: Partial<MyLoreAppSettings>) => Promise<void>;
  handleApplyThemePreset: (presetId: Exclude<ThemePresetId, 'custom'>) => void;
  handleToggleF11Viewer?: () => void;
  setMenuBarExpanded?: React.Dispatch<React.SetStateAction<boolean>>;
}

export function SettingsAppearanceSection({
  appSettings,
  setAppSettings,
  setStatusMessage,
  handleUpdateAppSettings,
  handleApplyThemePreset,
  handleToggleF11Viewer,
  setMenuBarExpanded,
}: SettingsAppearanceSectionProps) {
  const handleHotReloadSkin = async () => {
    try {
      const fresh = await getAppSettings();
      setAppSettings?.(fresh);
      applyAppSettingsToDocument(fresh);
      if (typeof document !== 'undefined') {
        document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
          const link = el as HTMLLinkElement;
          if (link.href) {
            const base = link.href.split('?')[0];
            link.href = `${base}?v=${Date.now()}`;
          }
        });
      }
      try {
        const bc = new BroadcastChannel(DETACHED_PREVIEW_CHANNEL);
        bc.postMessage({ type: 'settings', settings: fresh });
        bc.close();
      } catch {
        // ignore
      }
      setStatusMessage?.(
        `🎨 프로그램 재부팅 없이 UI 스킨·CSS 변수 핫 리로드 완료 (테마: ${fresh.themePreset})`
      );
    } catch (err) {
      setStatusMessage?.(`UI 스킨 다시 불러오기 실패: ${String(err)}`);
    }
  };
  return (
    <>
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
            marginBottom: '14px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
              🔤 글꼴 및 글꼴 크기 설정 (`기본글꼴` / `제목글꼴` / `표글꼴`)
            </h3>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                marginTop: '2px',
              }}
            >
              프리셋에서 글꼴을 선택하거나 시스템에 설치된 폰트 이름을 직접 입력할 수 있습니다.
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
            gap: '14px',
            marginBottom: '14px',
          }}
        >
          <div
            style={{
              padding: '14px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong
                style={{ fontSize: '13.5px', color: 'var(--heading-color)' }}
              >
                📝 기본 글꼴 (`baseFontFamily`)
              </strong>
              <span
                style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}
              >
                본문 및 에디터
              </span>
            </div>
            <select
              className="task-status-select"
              style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px' }}
              value={
                FONT_FAMILY_PRESETS.some(
                  (p) => p.value === appSettings.baseFontFamily
                )
                  ? appSettings.baseFontFamily
                  : '__custom__'
              }
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  handleUpdateAppSettings({
                    baseFontFamily: e.target.value,
                  });
                }
              }}
            >
              {FONT_FAMILY_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              <option value="__custom__">직접 입력 (사용자 정의 폰트)</option>
            </select>
            <input
              className="input-field"
              style={{ fontSize: '12px' }}
              value={appSettings.baseFontFamily}
              onChange={(e) =>
                handleUpdateAppSettings({ baseFontFamily: e.target.value })
              }
              placeholder="예: 'Malgun Gothic', sans-serif"
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginTop: '4px',
              }}
            >
              <span
                style={{ fontSize: '12px', color: 'var(--text-secondary)' }}
              >
                기본 글꼴 크기: <strong>{appSettings.baseFontSize}px</strong>
              </span>
              <input
                type="range"
                min={11}
                max={24}
                step={1}
                value={appSettings.baseFontSize}
                onChange={(e) =>
                  handleUpdateAppSettings({
                    baseFontSize: Number(e.target.value),
                  })
                }
                style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
              />
            </div>
          </div>

          <div
            style={{
              padding: '14px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong
                style={{ fontSize: '13.5px', color: 'var(--heading-color)' }}
              >
                🏷️ 제목 글꼴 (`headingFontFamily`)
              </strong>
              <span
                style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}
              >
                H1 ~ H6 헤딩
              </span>
            </div>
            <select
              className="task-status-select"
              style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px' }}
              value={
                FONT_FAMILY_PRESETS.some(
                  (p) => p.value === appSettings.headingFontFamily
                )
                  ? appSettings.headingFontFamily
                  : '__custom__'
              }
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  handleUpdateAppSettings({
                    headingFontFamily: e.target.value,
                  });
                }
              }}
            >
              {FONT_FAMILY_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              <option value="__custom__">직접 입력 (사용자 정의 폰트)</option>
            </select>
            <input
              className="input-field"
              style={{ fontSize: '12px' }}
              value={appSettings.headingFontFamily}
              onChange={(e) =>
                handleUpdateAppSettings({
                  headingFontFamily: e.target.value,
                })
              }
              placeholder="예: 'NanumSquare Neo', sans-serif"
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginTop: '4px',
              }}
            >
              <span
                style={{ fontSize: '12px', color: 'var(--text-secondary)' }}
              >
                제목 크기 배율:{' '}
                <strong>{Number(appSettings.headingScale).toFixed(2)}x</strong>
              </span>
              <input
                type="range"
                min={0.8}
                max={1.5}
                step={0.05}
                value={appSettings.headingScale}
                onChange={(e) =>
                  handleUpdateAppSettings({
                    headingScale: Number(e.target.value),
                  })
                }
                style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
              />
            </div>
          </div>

          <div
            style={{
              padding: '14px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <strong
                style={{ fontSize: '13.5px', color: 'var(--heading-color)' }}
              >
                📊 표 글꼴 (`tableFontFamily`)
              </strong>
              <span
                style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}
              >
                마크다운 표 & 데이터 표
              </span>
            </div>
            <select
              className="task-status-select"
              style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px' }}
              value={
                FONT_FAMILY_PRESETS.some(
                  (p) => p.value === appSettings.tableFontFamily
                )
                  ? appSettings.tableFontFamily
                  : '__custom__'
              }
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  handleUpdateAppSettings({
                    tableFontFamily: e.target.value,
                  });
                }
              }}
            >
              {FONT_FAMILY_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              <option value="__custom__">직접 입력 (사용자 정의 폰트)</option>
            </select>
            <input
              className="input-field"
              style={{ fontSize: '12px' }}
              value={appSettings.tableFontFamily}
              onChange={(e) =>
                handleUpdateAppSettings({ tableFontFamily: e.target.value })
              }
              placeholder="예: 'D2Coding', monospace"
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginTop: '4px',
              }}
            >
              <span
                style={{ fontSize: '12px', color: 'var(--text-secondary)' }}
              >
                표 글꼴 크기: <strong>{appSettings.tableFontSize}px</strong>
              </span>
              <input
                type="range"
                min={10}
                max={20}
                step={1}
                value={appSettings.tableFontSize}
                onChange={(e) =>
                  handleUpdateAppSettings({
                    tableFontSize: Number(e.target.value),
                  })
                }
                style={{ flex: 1, accentColor: 'var(--accent-primary)' }}
              />
            </div>
          </div>
        </div>

        <div
          className="rendered-md"
          style={{
            padding: '14px 18px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              color: 'var(--text-secondary)',
              marginBottom: '6px',
            }}
          >
            👁️ 실시간 글꼴·색상 미리보기
          </div>
          <h2 style={{ marginTop: 0 }}>제목 글꼴 미리보기 (H2 헤딩 샘플)</h2>
          <p>
            기본 글꼴 미리보기입니다. 가나다라마바사 ABCDEFG 0123456789 — 본문 텍스트와 에디터에 적용됩니다.
          </p>
          <div className="md-table-container" style={{ marginBottom: 0 }}>
            <table className="md-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>적용 대상</th>
                  <th>현재 크기</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>기본 글꼴</td>
                  <td>본문 단락, 목록, 에디터</td>
                  <td>{appSettings.baseFontSize}px</td>
                </tr>
                <tr>
                  <td>표 글꼴</td>
                  <td>마크다운 표, 대쉬보드 테이블</td>
                  <td>{appSettings.tableFontSize}px</td>
                </tr>
              </tbody>
            </table>
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
              🎨 테마 프리셋 및 각종 세부 색상 설정 (`themePreset` & Color Picker)
            </h3>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                marginTop: '2px',
              }}
            >
              테마 프리셋을 선택하거나 배경색, 글자색, 제목색, 강조색, 표 헤더색을 개별 컬러 피커로 자유롭게 커스터마이징하세요.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="toolbar-btn primary"
              onClick={handleHotReloadSkin}
              title="프로그램을 재시작하지 않고 setting.json 및 스타일시트(CSS 변수) 스킨만 즉시 다시 불러옵니다"
            >
              ⚡ 재부팅 없이 스킨 새로고침 (Hot Reload)
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
            gap: '10px',
            marginBottom: '16px',
          }}
        >
          {(
            Object.entries(THEME_PRESETS) as Array<
              [
                Exclude<ThemePresetId, 'custom'>,
                (typeof THEME_PRESETS)['dark_indigo']
              ]
            >
          ).map(([presetId, preset]) => {
            const isSelected = appSettings.themePreset === presetId;
            return (
              <div
                key={presetId}
                onClick={() => handleApplyThemePreset(presetId)}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  border: isSelected
                    ? '2px solid var(--accent-primary)'
                    : '1px solid var(--border-color)',
                  backgroundColor: preset.bgPrimary,
                  color: preset.textPrimary,
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                  }}
                >
                  <strong
                    style={{
                      fontSize: '13px',
                      color: preset.headingColor,
                    }}
                  >
                    {preset.name}
                  </strong>
                  {isSelected && (
                    <span
                      style={{
                        fontSize: '10.5px',
                        padding: '1px 6px',
                        borderRadius: '999px',
                        backgroundColor: preset.accentPrimary,
                        color: '#fff',
                        fontWeight: 700,
                      }}
                    >
                      적용됨
                    </span>
                  )}
                </div>
                <p
                  style={{
                    fontSize: '11.5px',
                    color: preset.textSecondary,
                    marginBottom: '8px',
                  }}
                >
                  {preset.desc}
                </p>
                <div style={{ display: 'flex', gap: '5px' }}>
                  {[
                    preset.bgPrimary,
                    preset.bgSecondary,
                    preset.accentPrimary,
                    preset.headingColor,
                    preset.tableHeaderBg,
                  ].map((c, idx) => (
                    <span
                      key={idx}
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '4px',
                        backgroundColor: c,
                        border: '1px solid rgba(148,163,184,0.35)',
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px',
          }}
        >
          {(
            [
              { key: 'bgPrimary', label: '기본 배경색 (에디터/뷰어)' },
              { key: 'bgSecondary', label: '보조 배경색 (패널/사이드바)' },
              { key: 'textPrimary', label: '기본 본문 글자색' },
              { key: 'textSecondary', label: '보조 설명 글자색' },
              { key: 'headingColor', label: '제목(H1~H4) 글자색' },
              { key: 'accentPrimary', label: '강조/포인트 색상' },
              { key: 'tableHeaderBg', label: '표 헤더 배경색' },
              { key: 'tableHeaderColor', label: '표 헤더 글자색' },
              { key: 'borderColor', label: '구분선/테두리 색상' },
              {
                key: 'failedCallTextColor',
                label: '통화 실패 수신/발신자 글자색',
              },
            ] as Array<{ key: keyof MyLoreAppSettings; label: string }>
          ).map((item) => {
            const colorVal = String(appSettings[item.key] || '#000000');
            return (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '9px 12px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                }}
              >
                <span style={{ fontSize: '12px', fontWeight: 600 }}>
                  {item.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="color"
                    value={
                      /^#[0-9a-fA-F]{6}$/.test(colorVal) ? colorVal : '#6366f1'
                    }
                    onChange={(e) =>
                      handleUpdateAppSettings({
                        themePreset: 'custom',
                        [item.key]: e.target.value,
                      })
                    }
                    style={{
                      width: '28px',
                      height: '26px',
                      border: 'none',
                      padding: 0,
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  />
                  <input
                    className="input-field"
                    style={{
                      width: '82px',
                      padding: '4px 6px',
                      fontSize: '11.5px',
                      fontFamily: 'var(--font-mono)',
                    }}
                    value={colorVal}
                    onChange={(e) =>
                      handleUpdateAppSettings({
                        themePreset: 'custom',
                        [item.key]: e.target.value,
                      })
                    }
                  />
                </div>
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
              🕒 통화·라이프로그 시간 표시 형식 (`lifelogTimeFormat`) 및 실패 통화 글자색 (`failedCallTextColor`)
            </h3>
            <p
              style={{
                fontSize: '12.5px',
                color: 'var(--text-secondary)',
                marginTop: '2px',
              }}
            >
              우측 사이드바(<kbd>Ctrl+B</kbd>) 통화 탭의 이벤트 시간 표시 형식과 통화 실패(부재중·거절·0초) 시 글자색을 설정합니다.
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <input
              className="input-field"
              style={{
                width: '175px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
              }}
              value={appSettings.lifelogTimeFormat || 'MM-DD(ddd) hh:mm'}
              onChange={(e) =>
                handleUpdateAppSettings({
                  lifelogTimeFormat: e.target.value,
                })
              }
              placeholder="MM-DD(ddd) hh:mm"
            />
            <input
              type="color"
              value={
                /^#[0-9a-fA-F]{6}$/.test(
                  appSettings.failedCallTextColor || '#b91c1c'
                )
                  ? appSettings.failedCallTextColor || '#b91c1c'
                  : '#b91c1c'
              }
              onChange={(e) =>
                handleUpdateAppSettings({
                  failedCallTextColor: e.target.value,
                })
              }
              style={{
                width: '28px',
                height: '26px',
                border: 'none',
                padding: 0,
                background: 'transparent',
                cursor: 'pointer',
              }}
            />
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
              원본 마크다운 에디터의 스크롤이 내려가면 병렬 뷰어 및 전용 독립 뷰어 창의 스크롤이 함께 동기화됩니다.
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
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <div>
            <h3 style={{ fontSize: '15.5px', fontWeight: 700 }}>
              🪟 <kbd>F11</kbd> 뷰어 토글 기본 옵션 (`f11ViewerMode`)
            </h3>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`toolbar-btn ${
                appSettings.f11ViewerMode === 'detached' ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({ f11ViewerMode: 'detached' })
              }
            >
              🪟 전용 독립 뷰어 (`detached`)
            </button>
            <button
              className={`toolbar-btn ${
                appSettings.f11ViewerMode === 'split' ? 'primary' : ''
              }`}
              onClick={() =>
                handleUpdateAppSettings({ f11ViewerMode: 'split' })
              }
            >
              📐 병렬 뷰어 (`split`)
            </button>
            {handleToggleF11Viewer && (
              <button
                className="toolbar-btn"
                onClick={handleToggleF11Viewer}
              >
                ⚡ 지금 F11 테스트
              </button>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '18px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px',
        }}
      >
        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>💾 자동 저장 (`autoSaveEnabled`)</h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`toolbar-btn ${appSettings.autoSaveEnabled ? 'primary' : ''}`} onClick={() => handleUpdateAppSettings({ autoSaveEnabled: true })}>✓ 자동 저장 ON</button>
            <button className={`toolbar-btn ${!appSettings.autoSaveEnabled ? 'primary' : ''}`} onClick={() => handleUpdateAppSettings({ autoSaveEnabled: false })}>자동 저장 OFF</button>
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>↹ Tab 들여쓰기 공백 수 (`tabIndentSpaces`)</h4>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[2, 4, 8].map((n) => (
              <button
                key={n}
                className={`toolbar-btn ${(appSettings.tabIndentSpaces || 2) === n ? 'primary' : ''}`}
                onClick={() => handleUpdateAppSettings({ tabIndentSpaces: n })}
              >
                {n === 2 ? '2칸 (기본)' : `${n}칸`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>☰ <kbd>F10</kbd> 상단 메뉴바 시작 시 기본 상태</h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`toolbar-btn ${!appSettings.defaultMenuBarExpanded ? 'primary' : ''}`} onClick={() => { setMenuBarExpanded?.(false); handleUpdateAppSettings({ defaultMenuBarExpanded: false }); }}>✓ 기본 닫힘 (OFF)</button>
            <button className={`toolbar-btn ${appSettings.defaultMenuBarExpanded ? 'primary' : ''}`} onClick={() => { setMenuBarExpanded?.(true); handleUpdateAppSettings({ defaultMenuBarExpanded: true }); }}>기본 열림 (ON)</button>
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>🖥️ 프로그램 시작 시 기본 편집 화면</h4>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['editor', 'split', 'preview'] as const).map((m) => (
              <button key={m} className={`toolbar-btn ${appSettings.defaultEditorViewMode === m ? 'primary' : ''}`} onClick={() => handleUpdateAppSettings({ defaultEditorViewMode: m })}>{m}</button>
            ))}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>📂 분할 시 기본 파일 열림 위치 (`defaultFileOpenPane`)</h4>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {([
              { id: 'left', label: '⬅️ 왼쪽 화면 (기본)' },
              { id: 'focused', label: '🎯 편집중인 화면' },
              { id: 'right', label: '➡️ 오른쪽 화면' },
            ] as const).map((opt) => (
              <button key={opt.id} className={`toolbar-btn ${(appSettings.defaultFileOpenPane || 'left') === opt.id ? 'primary' : ''}`} onClick={() => handleUpdateAppSettings({ defaultFileOpenPane: opt.id })}>{opt.label}</button>
            ))}
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px' }}>🔗 분할 시 문서 내 링크 열림 위치 (`linkOpenPane`)</h4>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {([
              { id: 'unfocused', label: '🔄 편집중이 아닌 화면 (기본)' },
              { id: 'left', label: '⬅️ 왼쪽 화면' },
              { id: 'right', label: '➡️ 오른쪽 화면' },
              { id: 'focused', label: '🎯 편집중인 화면' },
            ] as const).map((opt) => (
              <button key={opt.id} className={`toolbar-btn ${(appSettings.linkOpenPane || 'unfocused') === opt.id ? 'primary' : ''}`} onClick={() => handleUpdateAppSettings({ linkOpenPane: opt.id })}>{opt.label}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
