/**
 * @file ShortcutsHelpModal.tsx
 * @description `F1` 단축키 도움말 조회, 검색, 실시간 키 입력 녹음 변경 및 기본값 초기화 모달.
 */
import React from 'react';
import { KeybindingConfig } from '../../types/mylore';

export interface ShortcutsHelpModalProps {
  shortcutsModalOpen: boolean;
  setShortcutsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  recordingShortcutTarget: {
    id: string;
    field: 'shortcut' | 'secondaryShortcut';
  } | null;
  setRecordingShortcutTarget: React.Dispatch<
    React.SetStateAction<{
      id: string;
      field: 'shortcut' | 'secondaryShortcut';
    } | null>
  >;
  keybindings: KeybindingConfig[];
  setKeybindings: React.Dispatch<React.SetStateAction<KeybindingConfig[]>>;
  defaultKeybindings: KeybindingConfig[];
  keybindingsStorageKey: string;
  helpSearchQuery: string;
  setHelpSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  filteredKeybindings: KeybindingConfig[];
}

export function ShortcutsHelpModal({
  shortcutsModalOpen,
  setShortcutsModalOpen,
  recordingShortcutTarget,
  setRecordingShortcutTarget,
  keybindings,
  setKeybindings,
  defaultKeybindings,
  keybindingsStorageKey,
  helpSearchQuery,
  setHelpSearchQuery,
  filteredKeybindings,
}: ShortcutsHelpModalProps) {
  if (!shortcutsModalOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        setRecordingShortcutTarget(null);
        setShortcutsModalOpen(false);
      }}
    >
      <div
        className="palette-box help-modal-box"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-header-row">
          <h3 style={{ fontSize: '16px' }}>
            ⌨️ 도움말 — 단축키 설정 (`F1` 또는 `파일 &gt; 도움말`)
          </h3>
          <button
            className="toolbar-btn"
            onClick={() => {
              setKeybindings(defaultKeybindings);
              localStorage.setItem(
                keybindingsStorageKey,
                JSON.stringify(defaultKeybindings)
              );
            }}
          >
            기본값 초기화
          </button>
        </div>
        <p
          style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            marginBottom: '10px',
          }}
        >
          기본/보조 단축키 버튼을 클릭한 뒤 원하는 키 조합을 누르면 즉시 반영됩니다. (보조 단축키 녹음 중 `Backspace`/`Delete` 입력 시 해제, `F12`는 개발자모드로 현행 유지)
        </p>
        <div className="help-search-row">
          <input
            type="text"
            className="input-field"
            placeholder="🔍 검색 (기능, 분류, 기본/보조 단축키, 조건으로 필터링...)"
            value={helpSearchQuery}
            onChange={(e) => setHelpSearchQuery(e.target.value)}
            autoFocus
          />
          {helpSearchQuery && (
            <button
              className="toolbar-btn"
              onClick={() => setHelpSearchQuery('')}
            >
              초기화
            </button>
          )}
        </div>
        <div className="help-table-wrap">
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
              {filteredKeybindings.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      textAlign: 'center',
                      padding: '24px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    검색어 &ldquo;{helpSearchQuery}&rdquo;에 해당하는 단축키가 없습니다.
                  </td>
                </tr>
              ) : (
                filteredKeybindings.map((kb) => {
                  const isRecPrimary =
                    recordingShortcutTarget?.id === kb.id &&
                    recordingShortcutTarget.field === 'shortcut';
                  const isRecSecondary =
                    recordingShortcutTarget?.id === kb.id &&
                    recordingShortcutTarget.field === 'secondaryShortcut';
                  return (
                    <tr key={kb.id}>
                      <td style={{ fontWeight: 600 }}>{kb.label}</td>
                      <td>
                        <span className="help-category-badge">
                          {kb.category}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`toolbar-btn help-shortcut-btn ${
                            isRecPrimary ? 'primary' : ''
                          }`}
                          disabled={kb.id === 'devtools_info'}
                          onClick={() => {
                            if (kb.id !== 'devtools_info') {
                              setRecordingShortcutTarget({
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
                          className={`toolbar-btn help-shortcut-btn ${
                            isRecSecondary ? 'primary' : ''
                          }`}
                          disabled={kb.id === 'devtools_info'}
                          onClick={() => {
                            if (kb.id !== 'devtools_info') {
                              setRecordingShortcutTarget({
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
                })
              )}
            </tbody>
          </table>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '14px',
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            표시 항목: {filteredKeybindings.length} / {keybindings.length}개
          </span>
          <button
            className="toolbar-btn"
            onClick={() => {
              setRecordingShortcutTarget(null);
              setShortcutsModalOpen(false);
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
