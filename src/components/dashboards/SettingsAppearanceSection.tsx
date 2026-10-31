/**
 * @file SettingsAppearanceSection.tsx
 * @description 환경설정 대시보드 외관 섹션: 글꼴 프리셋(기본·제목·표), 5종 색상 테마 프리셋 및 커스텀 색상 피커.
 */
import React from 'react';
import { MyLoreAppSettings, ThemePresetId } from '../../types/mylore';
import {
  DEFAULT_APP_SETTINGS,
  FONT_FAMILY_PRESETS,
  THEME_PRESETS,
} from '../../services/tauriClient';

export interface SettingsAppearanceSectionProps {
  appSettings: MyLoreAppSettings;
  handleUpdateAppSettings: (patch: Partial<MyLoreAppSettings>) => Promise<void>;
  handleApplyThemePreset: (presetId: Exclude<ThemePresetId, 'custom'>) => void;
}

export function SettingsAppearanceSection({
  appSettings,
  handleUpdateAppSettings,
  handleApplyThemePreset,
}: SettingsAppearanceSectionProps) {
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
          <button
            className="toolbar-btn"
            onClick={() =>
              handleUpdateAppSettings({
                baseFontFamily: DEFAULT_APP_SETTINGS.baseFontFamily,
                headingFontFamily: DEFAULT_APP_SETTINGS.headingFontFamily,
                tableFontFamily: DEFAULT_APP_SETTINGS.tableFontFamily,
                baseFontSize: DEFAULT_APP_SETTINGS.baseFontSize,
                headingScale: DEFAULT_APP_SETTINGS.headingScale,
                tableFontSize: DEFAULT_APP_SETTINGS.tableFontSize,
              })
            }
          >
            ↺ 글꼴/크기 초기화
          </button>
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
          <button
            className="toolbar-btn"
            onClick={() => handleApplyThemePreset('dark_indigo')}
          >
            ↺ 기본 다크 인디고 테마로 복원
          </button>
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
    </>
  );
}
