/**
 * @file HelpDashboard.tsx
 * @description `F1` 도움말 (단축키 설정) 대시보드 (`mylore://dashboard/help`):
 * - 기존 모달 방식 대신 독립 대시보드 탭으로 출력
 * - `분류` 열을 제거하고 4열(`기능` | `기본 단축키` | `보조 단축키` | `조건`) 구성 및 분류별 그룹핑
 * - 분류 제목 헤더 클릭 시 해당 분류 펼치기/접기 토글
 * - 우측 사이드바(`RightSidebar`)의 분류 목차 클릭 시 자동 펼침 및 부드러운 스크롤 이동 지원
 */
import React, { useMemo } from 'react';
import { KeybindingConfig } from '../../types/mylore';
import {
  DEFAULT_KEYBINDINGS,
  groupKeybindingsByCategory,
  KEYBINDINGS_STORAGE_KEY,
} from '../../hooks/useKeybindings';

export interface HelpDashboardProps {
  embedded?: boolean;
  keybindings?: KeybindingConfig[];
  setKeybindings?: React.Dispatch<React.SetStateAction<KeybindingConfig[]>>;
  helpSearchQuery?: string;
  setHelpSearchQuery?: React.Dispatch<React.SetStateAction<string>>;
  filteredKeybindings?: KeybindingConfig[];
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
  collapsedHelpCategories?: Set<string>;
  toggleHelpCategoryCollapse?: (category: string) => void;
  expandAllHelpCategories?: () => void;
  collapseAllHelpCategories?: (categories: string[]) => void;
  activeHelpCategory?: string;
  setActiveHelpCategory?: React.Dispatch<React.SetStateAction<string>>;
  setStatusMessage?: React.Dispatch<React.SetStateAction<string>>;
}

export function HelpDashboard({
  embedded = false,
  keybindings = [],
  setKeybindings,
  helpSearchQuery = '',
  setHelpSearchQuery,
  filteredKeybindings = [],
  recordingShortcutTarget = null,
  setRecordingShortcutTarget,
  collapsedHelpCategories = new Set(),
  toggleHelpCategoryCollapse,
  expandAllHelpCategories,
  collapseAllHelpCategories,
  activeHelpCategory,
  setActiveHelpCategory,
  setStatusMessage,
}: HelpDashboardProps) {
  const groupedCategories = useMemo(
    () => groupKeybindingsByCategory(filteredKeybindings),
    [filteredKeybindings]
  );

  const allCategoryKeys = useMemo(
    () => groupedCategories.map((g) => g.category),
    [groupedCategories]
  );

  const handleWorkspaceScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!setActiveHelpCategory || groupedCategories.length === 0) return;
    const containerRect = e.currentTarget.getBoundingClientRect();
    let currentCat = groupedCategories[0].category;
    for (const grp of groupedCategories) {
      const el = document.getElementById(
        `help-category-section-${grp.category}`
      );
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top - containerRect.top <= 120) {
          currentCat = grp.category;
        }
      }
    }
    if (currentCat && currentCat !== activeHelpCategory) {
      setActiveHelpCategory(currentCat);
    }
  };

  const content = (
    <>
      <div className="help-dashboard-toolbar">
        <div>
          <h2 style={{ fontSize: embedded ? '16px' : '20px', fontWeight: 700, margin: 0 }}>
            ❓ 도움말 — 단축키 설정 대쉬보드 (`F1`)
          </h2>
          <p
            style={{
              fontSize: '12.5px',
              color: 'var(--text-secondary)',
              marginTop: '4px',
            }}
          >
            분류 제목을 클릭하여 각 분류를 펼치거나 접을 수 있으며, 우측 사이드바(<kbd>Ctrl+B</kbd>)에서 분류를 클릭하면 해당 위치로 자동 스크롤됩니다. 기본/보조 단축키 버튼을 클릭한 뒤 원하는 키를 누르면 즉시 변경됩니다.
          </p>
        </div>
        <div className="help-dashboard-actions">
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => expandAllHelpCategories?.()}
            title="모든 단축키 분류 그룹을 펼칩니다"
          >
            ▾ 모두 펼치기
          </button>
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => collapseAllHelpCategories?.(allCategoryKeys)}
            title="모든 단축키 분류 그룹을 접습니다"
          >
            ▸ 모두 접기
          </button>
          {!embedded && (
            <button
              type="button"
              className="toolbar-btn"
              onClick={() => {
                setKeybindings?.(DEFAULT_KEYBINDINGS);
                localStorage.setItem(
                  KEYBINDINGS_STORAGE_KEY,
                  JSON.stringify(DEFAULT_KEYBINDINGS)
                );
                setStatusMessage?.(
                  '↺ 단축키 설정이 기본값으로 초기화되었습니다.'
                );
              }}
            >
              ↺ 기본값 초기화
            </button>
          )}
        </div>
      </div>

      <div className="help-search-row" style={{ marginBottom: '16px' }}>
        <input
          type="text"
          className="input-field"
          placeholder="🔍 검색 (기능, 분류, 기본/보조 단축키, 조건으로 실시간 필터링...)"
          value={helpSearchQuery}
          onChange={(e) => setHelpSearchQuery?.(e.target.value)}
        />
        {helpSearchQuery && (
          <button
            type="button"
            className="toolbar-btn"
            onClick={() => setHelpSearchQuery?.('')}
          >
            초기화
          </button>
        )}
        <span
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          표시 항목: <strong>{filteredKeybindings.length}</strong> /{' '}
          {keybindings.length}개
        </span>
      </div>

      {groupedCategories.length === 0 ? (
        <div className="help-empty-box">
          검색어 &ldquo;{helpSearchQuery}&rdquo;에 해당하는 단축키가 없습니다.
        </div>
      ) : (
        <div className="help-category-groups-list">
          {groupedCategories.map((group) => {
            const isCollapsed = collapsedHelpCategories.has(group.category);
            const isActiveCategory = activeHelpCategory === group.category;
            return (
              <section
                key={group.category}
                id={`help-category-section-${group.category}`}
                className={`help-category-group-card ${
                  isActiveCategory ? 'active-category' : ''
                }`}
              >
                <div
                  className="help-category-group-header"
                  onClick={() => {
                    setActiveHelpCategory?.(group.category);
                    toggleHelpCategoryCollapse?.(group.category);
                  }}
                  title="클릭하여 이 분류 펼치기 / 접기"
                >
                  <div className="help-category-group-title-left">
                    <span className="help-category-chevron">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    <span className="help-category-icon">{group.icon}</span>
                    <strong className="help-category-name">
                      {group.label}
                    </strong>
                    <span className="help-category-badge">
                      {group.items.length}개
                    </span>
                    <span className="help-category-desc">{group.desc}</span>
                  </div>
                  <span className="help-category-toggle-hint">
                    {isCollapsed ? '펼치기' : '접기'}
                  </span>
                </div>

                {!isCollapsed && (
                  <div className="help-category-table-container">
                    <table className="help-table">
                      <thead>
                        <tr>
                          <th style={{ width: '36%' }}>기능</th>
                          <th style={{ width: '23%' }}>기본 단축키</th>
                          <th style={{ width: '23%' }}>보조 단축키</th>
                          <th style={{ width: '18%' }}>조건</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((kb) => {
                          const isRecPrimary =
                            recordingShortcutTarget?.id === kb.id &&
                            recordingShortcutTarget.field === 'shortcut';
                          const isRecSecondary =
                            recordingShortcutTarget?.id === kb.id &&
                            recordingShortcutTarget.field ===
                              'secondaryShortcut';
                          return (
                            <tr key={kb.id}>
                              <td style={{ fontWeight: 600 }}>{kb.label}</td>
                              <td>
                                <button
                                  type="button"
                                  className={`toolbar-btn help-shortcut-btn ${
                                    isRecPrimary ? 'primary' : ''
                                  }`}
                                  disabled={kb.id === 'devtools_info'}
                                  onClick={() => {
                                    if (kb.id !== 'devtools_info') {
                                      setRecordingShortcutTarget?.({
                                        id: kb.id,
                                        field: 'shortcut',
                                      });
                                    }
                                  }}
                                >
                                  {isRecPrimary
                                    ? '키 입력...'
                                    : kb.shortcut || '-'}
                                </button>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className={`toolbar-btn help-shortcut-btn ${
                                    isRecSecondary ? 'primary' : ''
                                  }`}
                                  disabled={kb.id === 'devtools_info'}
                                  onClick={() => {
                                    if (kb.id !== 'devtools_info') {
                                      setRecordingShortcutTarget?.({
                                        id: kb.id,
                                        field: 'secondaryShortcut',
                                      });
                                    }
                                  }}
                                >
                                  {isRecSecondary
                                    ? '키 입력...'
                                    : kb.secondaryShortcut || '-'}
                                </button>
                              </td>
                              <td>
                                <span className="help-condition-badge">
                                  {kb.condition}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div onScroll={handleWorkspaceScroll}>{content}</div>;
  }

  return (
    <div className="finance-workspace" onScroll={handleWorkspaceScroll}>
      {content}
    </div>
  );
}
