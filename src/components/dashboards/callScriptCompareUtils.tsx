/**
 * @file callScriptCompareUtils.tsx
 * @description 통화기록 검수(결재 패널 및 우클릭 스크립트 비교 모달) 공용 유틸리티 및 하위 컴포넌트:
 * - 다중 선택(Click / Ctrl+Click / Shift+Click) 및 Space바 재생(복수 선택 시 첫 대사부터 재생)
 * - 대사 분리(커서 위치에서 Enter 입력 시 즉시 분리) 및 대사 결합(복수 선택 시 합치기)
 * - 마우스 하단 위치 시 위쪽 방향으로 열리는 우클릭 컨텍스트 메뉴
 * - 나와 대화상대의 배경지식 멀티라인 에디터 (ASR 스크립트 아래 / 후처리 스크립트 아래 배치 및 즉시 반영)
 */
import React, { useEffect, useState } from 'react';
import {
  CallPostprocessPromptPayload,
  ContactPromptTournamentStatus,
  UserScriptEditEntry,
} from '../../types/mylore';
import {
  DEFAULT_CONTACT_PROFILE_TEMPLATE,
  getAppSettings,
  getCallPostprocessPromptAndLog,
  getContactAiProfiles,
  openContactPersonDocument,
  saveAppSettings,
  saveCallPostprocessPrompt,
  saveContactAiProfile,
  updateContactPromptSlotManual,
} from '../../services/tauriClient';
import {
  buildUserScriptEditEntry,
  formatSecToTimeTag,
  LineContextMenuState,
  ParsedScriptLine,
} from './CallScriptAbComparisonPanel';

export interface SplitModalState {
  side: 'LEFT' | 'RIGHT';
  line: ParsedScriptLine;
  nextLineSec?: number;
  value: string;
  toggleSecondSpeaker: boolean;
}

export interface TextOrTimeEditModalState {
  mode: 'text' | 'time';
  side: 'LEFT' | 'RIGHT';
  line: ParsedScriptLine;
  value: string;
}

/**
 * 단일 대사를 커서 위치(`splitIndex`) 기준으로 2개의 대사로 분리합니다.
 */
export function mutateSplitLineInSectionMarkdown(
  sectionMd: string,
  line: ParsedScriptLine,
  splitIndex: number,
  toggleSecondSpeaker: boolean,
  counterpartName: string,
  nextLineSec?: number
): { updatedSection: string; editEntry: UserScriptEditEntry | null } {
  const rawLines = sectionMd.split(/\r?\n/);
  if (line.rawLineIdx < 0 || line.rawLineIdx >= rawLines.length) {
    return { updatedSection: sectionMd, editEntry: null };
  }
  const fullText = line.text;
  const clampedIdx = Math.max(0, Math.min(fullText.length, splitIndex));
  const firstPart = fullText.slice(0, clampedIdx).trim();
  const secondPart = fullText.slice(clampedIdx).trim();
  if (!firstPart || !secondPart) {
    return { updatedSection: sectionMd, editEntry: null };
  }

  const isMe = line.speaker === '나' || line.speaker === '정서현';
  const secondSpeaker = toggleSecondSpeaker
    ? isMe
      ? counterpartName || '상대방'
      : '나'
    : line.speaker;

  let secondSec = line.sec;
  if (typeof nextLineSec === 'number' && nextLineSec > line.sec) {
    const ratio = firstPart.length / Math.max(1, fullText.length);
    secondSec = Math.min(
      nextLineSec,
      line.sec + Math.max(1, Math.round((nextLineSec - line.sec) * ratio))
    );
  }
  const secondTimeTag = formatSecToTimeTag(secondSec);

  const line1 = `- **[${line.timeTag}] ${line.speaker}**: ${firstPart}`;
  const line2 = `- **[${secondTimeTag}] ${secondSpeaker}**: ${secondPart}`;
  rawLines.splice(line.rawLineIdx, 1, line1, line2);

  const editEntry: UserScriptEditEntry = {
    editType: '대사 분리 (Line Split)',
    timeTag: line.timeTag,
    beforeText: `[${line.timeTag}] ${line.speaker}: ${line.text}`,
    afterText: `[${line.timeTag}] ${line.speaker}: ${firstPart} / [${secondTimeTag}] ${secondSpeaker}: ${secondPart}`,
  };
  return { updatedSection: rawLines.join('\n'), editEntry };
}

/**
 * 복수 선택된 대사들을 가장 앞선 대사의 시각·화자 기준으로 하나로 결합합니다.
 */
export function mutateMergeLinesInSectionMarkdown(
  sectionMd: string,
  selectedLines: ParsedScriptLine[]
): { updatedSection: string; editEntry: UserScriptEditEntry | null; mergedRawIdx: number } {
  const sorted = [...selectedLines].sort((a, b) => a.rawLineIdx - b.rawLineIdx);
  if (sorted.length < 2) {
    return {
      updatedSection: sectionMd,
      editEntry: null,
      mergedRawIdx: sorted[0]?.rawLineIdx ?? 0,
    };
  }
  const rawLines = sectionMd.split(/\r?\n/);
  const first = sorted[0];
  if (first.rawLineIdx < 0 || first.rawLineIdx >= rawLines.length) {
    return { updatedSection: sectionMd, editEntry: null, mergedRawIdx: 0 };
  }

  const mergedText = sorted
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join(' ');
  const mergedLineStr = `- **[${first.timeTag}] ${first.speaker}**: ${mergedText}`;
  rawLines[first.rawLineIdx] = mergedLineStr;

  for (let i = sorted.length - 1; i >= 1; i--) {
    const idx = sorted[i].rawLineIdx;
    if (idx >= 0 && idx < rawLines.length) {
      rawLines.splice(idx, 1);
    }
  }

  const beforeJoined = sorted
    .map((l) => `[${l.timeTag}] ${l.speaker}: ${l.text}`)
    .join(' + ');
  const editEntry: UserScriptEditEntry = {
    editType: `대사 결합 (${sorted.length}줄 병합 · Lines Merged)`,
    timeTag: first.timeTag,
    beforeText: beforeJoined,
    afterText: `[${first.timeTag}] ${first.speaker}: ${mergedText}`,
  };

  return {
    updatedSection: rawLines.join('\n'),
    editEntry,
    mergedRawIdx: first.rawLineIdx,
  };
}

/**
 * 단일 또는 복수 선택된 대사들에 대해 일괄 화자 변환 또는 일괄 삭제를 수행합니다.
 */
export function mutateBatchSpeakerOrDeleteInSectionMarkdown(
  sectionMd: string,
  targetLines: ParsedScriptLine[],
  mutation:
    | { type: 'toggle_speaker'; counterpartName: string }
    | { type: 'delete_line' }
): { updatedSection: string; editEntries: UserScriptEditEntry[] } {
  const sorted = [...targetLines].sort((a, b) => a.rawLineIdx - b.rawLineIdx);
  if (sorted.length === 0) {
    return { updatedSection: sectionMd, editEntries: [] };
  }
  const rawLines = sectionMd.split(/\r?\n/);
  const editEntries: UserScriptEditEntry[] = [];

  if (mutation.type === 'delete_line') {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const l = sorted[i];
      if (l.rawLineIdx >= 0 && l.rawLineIdx < rawLines.length) {
        rawLines.splice(l.rawLineIdx, 1);
        editEntries.unshift(buildUserScriptEditEntry(l, mutation));
      }
    }
    return { updatedSection: rawLines.join('\n').trim(), editEntries };
  }

  for (const l of sorted) {
    if (l.rawLineIdx >= 0 && l.rawLineIdx < rawLines.length) {
      const isMe = l.speaker === '나' || l.speaker === '정서현';
      const nextSpeaker = isMe ? mutation.counterpartName || '상대방' : '나';
      rawLines[l.rawLineIdx] = `- **[${l.timeTag}] ${nextSpeaker}**: ${l.text}`;
      editEntries.push(buildUserScriptEditEntry(l, mutation));
    }
  }
  return { updatedSection: rawLines.join('\n'), editEntries };
}

/**
 * 나(사용자)와 대화상대의 배경지식을 각각 ASR 스크립트 아래와 후처리 스크립트 아래에서
 * 직접 확인·편집·즉시 반영할 수 있는 2열 멀티라인 에디터 훅 & 컴포넌트
 */
const DEFAULT_USER_BACKGROUND_TEMPLATE =
  '이름: 정서현 (성: 정, 이름: 서현), 출생년도: 1983, 거주지: 거제, 출생지: 서울, 취미: 수영\n내 상태(근황/주요 관심사): \n자주 쓰는 고유명사/배경지식: ';

export function useParticipantBackgroundProfiles(
  contactName: string,
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>
) {
  const [userProfileText, setUserProfileText] = useState(DEFAULT_USER_BACKGROUND_TEMPLATE);
  const [contactProfileText, setContactProfileText] = useState(DEFAULT_CONTACT_PROFILE_TEMPLATE);
  const [resolvedContactName, setResolvedContactName] = useState(contactName || '');
  const [contactPhones, setContactPhones] = useState('');
  const [savingUser, setSavingUser] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [dirtyUser, setDirtyUser] = useState(false);
  const [dirtyContact, setDirtyContact] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDirtyUser(false);
    setDirtyContact(false);
    getAppSettings()
      .then((s) => {
        if (cancelled) return;
        const raw = (s.aiUserProfile || '').trim();
        if (!raw) {
          setUserProfileText(DEFAULT_USER_BACKGROUND_TEMPLATE);
        } else if (!raw.includes('내 상태')) {
          setUserProfileText(`${raw}\n내 상태(근황/주요 관심사): `);
        } else {
          setUserProfileText(raw);
        }
      })
      .catch(() => {});

    const cleanName = (contactName || '').trim();
    setResolvedContactName(cleanName);
    setContactPhones('');
    if (cleanName) {
      openContactPersonDocument(cleanName)
        .then((doc) => {
          if (cancelled) return;
          const cname = (doc.frontmatter?.contact_name || cleanName).trim();
          const phones = (doc.frontmatter?.phones || '').trim();
          setResolvedContactName(cname);
          setContactPhones(phones);
          const body = (doc.bodyContent || '').trim();
          setContactProfileText(body.length > 0 ? body : DEFAULT_CONTACT_PROFILE_TEMPLATE);
        })
        .catch(() => {
          getContactAiProfiles()
            .then((map) => {
              if (cancelled) return;
              const existing = map[cleanName];
              setContactProfileText(
                existing !== undefined && existing.trim().length > 0
                  ? existing
                  : DEFAULT_CONTACT_PROFILE_TEMPLATE
              );
            })
            .catch(() => {});
        });
    } else {
      setContactProfileText(DEFAULT_CONTACT_PROFILE_TEMPLATE);
    }
    return () => {
      cancelled = true;
    };
  }, [contactName]);

  const saveUserProfileNow = async (silent = false) => {
    if (savingUser) return;
    setSavingUser(true);
    try {
      const cur = await getAppSettings();
      await saveAppSettings({ ...cur, aiUserProfile: userProfileText });
      setDirtyUser(false);
      if (!silent) {
        setStatusMessage('💾 내 상태 및 나에 대한 정보(aiUserProfile) 수정 내용이 즉시 반영되었습니다.');
      }
    } catch (e) {
      if (!silent) setStatusMessage(`❌ 내 상태 저장 실패: ${String(e)}`);
    } finally {
      setSavingUser(false);
    }
  };

  const saveContactProfileNow = async (silent = false) => {
    const cleanName = (resolvedContactName || contactName || '').trim();
    if (!cleanName || savingContact) return;
    setSavingContact(true);
    try {
      await saveContactAiProfile(cleanName, contactProfileText);
      setDirtyContact(false);
      if (!silent) {
        setStatusMessage(`💾 '${cleanName}.md' 대화상대 정보 수정 내용이 그대로 반영되었습니다.`);
      }
    } catch (e) {
      if (!silent) setStatusMessage(`❌ 대화상대 .md 저장 실패: ${String(e)}`);
    } finally {
      setSavingContact(false);
    }
  };

  const flushBothIfDirty = async () => {
    if (dirtyUser) await saveUserProfileNow(true);
    if (dirtyContact) await saveContactProfileNow(true);
  };

  return {
    userProfileText,
    setUserProfileText: (val: string) => {
      setUserProfileText(val);
      setDirtyUser(true);
    },
    contactProfileText,
    setContactProfileText: (val: string) => {
      setContactProfileText(val);
      setDirtyContact(true);
    },
    resolvedContactName,
    contactPhones,
    savingUser,
    savingContact,
    dirtyUser,
    dirtyContact,
    saveUserProfileNow,
    saveContactProfileNow,
    flushBothIfDirty,
  };
}

export function CallParticipantBackgroundEditorBox({
  title,
  accentColor,
  value,
  onChange,
  onSave,
  saving,
  dirty,
  placeholder,
}: {
  title: string;
  accentColor: string;
  value: string;
  onChange: (val: string) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  placeholder: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        marginTop: '6px',
        paddingTop: '8px',
        borderTop: '1px dashed var(--border-color)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
        <strong style={{ fontSize: '12px', color: accentColor }}>{title}</strong>
        <button
          type="button"
          className={`toolbar-btn ${dirty ? 'primary' : ''}`}
          style={{ fontSize: '10.5px', padding: '2px 8px' }}
          disabled={saving}
          onClick={() => onSave()}
        >
          {saving ? '⏳ 저장중...' : dirty ? '💾 변경사항 반영' : '💾 반영됨'}
        </button>
      </div>
      <textarea
        rows={6}
        className="input-field"
        style={{
          fontSize: '12px',
          lineHeight: 1.5,
          fontFamily: 'var(--font-mono)',
          resize: 'vertical',
          minHeight: '112px',
        }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (dirty) onSave();
        }}
      />
    </div>
  );
}

export function CallScriptLineContextMenuAndModals({
  lineMenu,
  setLineMenu,
  selectedCountOnMenuSide,
  counterpartName,
  currentAudioSec,
  audioRef,
  editingModal,
  setEditingModal,
  splitModal,
  setSplitModal,
  onToggleSpeaker,
  onDeleteSelected,
  onMergeSelected,
  onOpenSplitModal,
  onConfirmSplit,
  onConfirmTextOrTime,
}: {
  lineMenu: LineContextMenuState | null;
  setLineMenu: React.Dispatch<React.SetStateAction<LineContextMenuState | null>>;
  selectedCountOnMenuSide: number;
  counterpartName: string;
  currentAudioSec: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  editingModal: TextOrTimeEditModalState | null;
  setEditingModal: React.Dispatch<React.SetStateAction<TextOrTimeEditModalState | null>>;
  splitModal: SplitModalState | null;
  setSplitModal: React.Dispatch<React.SetStateAction<SplitModalState | null>>;
  onToggleSpeaker: (side: 'LEFT' | 'RIGHT', line: ParsedScriptLine) => void;
  onDeleteSelected: (side: 'LEFT' | 'RIGHT', line: ParsedScriptLine) => void;
  onMergeSelected: (side: 'LEFT' | 'RIGHT') => void;
  onOpenSplitModal: (side: 'LEFT' | 'RIGHT', line: ParsedScriptLine) => void;
  onConfirmSplit: (splitIndex: number) => void;
  onConfirmTextOrTime: () => void;
}) {
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 900;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const openUpward = lineMenu ? lineMenu.y > viewportH - 270 : false;
  const clampedLeft = lineMenu ? Math.max(8, Math.min(lineMenu.x, viewportW - 220)) : 0;

  return (
    <>
      {lineMenu && (
        <div
          className="context-menu-popup"
          style={{
            position: 'fixed',
            left: clampedLeft,
            top: openUpward ? 'auto' : lineMenu.y,
            bottom: openUpward ? Math.max(8, viewportH - lineMenu.y) : 'auto',
            zIndex: 10001,
            minWidth: '195px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="menu-item"
            onClick={() => onToggleSpeaker(lineMenu.side, lineMenu.line)}
          >
            <span>
              🔄 화자 변환{selectedCountOnMenuSide > 1 ? ` (${selectedCountOnMenuSide}줄)` : ''}
            </span>
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setEditingModal({
                mode: 'text',
                side: lineMenu.side,
                line: lineMenu.line,
                value: lineMenu.line.text,
              });
              setLineMenu(null);
            }}
          >
            <span>✏️ 스크립트 수정</span>
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => onOpenSplitModal(lineMenu.side, lineMenu.line)}
          >
            <span>✂️ 대사 분리 (Enter 기점)</span>
          </button>
          {selectedCountOnMenuSide >= 2 && (
            <button
              type="button"
              className="menu-item"
              onClick={() => onMergeSelected(lineMenu.side)}
            >
              <span style={{ color: '#38bdf8', fontWeight: 700 }}>
                🔗 대사 결합 ({selectedCountOnMenuSide}줄 합치기)
              </span>
            </button>
          )}
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setEditingModal({
                mode: 'time',
                side: lineMenu.side,
                line: lineMenu.line,
                value: lineMenu.line.timeTag,
              });
              setLineMenu(null);
            }}
          >
            <span>⏱️ 시점 변환</span>
          </button>
          <div className="menu-divider" />
          <button
            type="button"
            className="menu-item"
            onClick={() => onDeleteSelected(lineMenu.side, lineMenu.line)}
          >
            <span style={{ color: '#f87171' }}>
              🗑️ 삭제{selectedCountOnMenuSide > 1 ? ` (${selectedCountOnMenuSide}줄)` : ''}
            </span>
          </button>
        </div>
      )}

      {/* ✂️ 대사 분리 모달: 원하는 위치에 커서를 놓고 Enter를 누르면 즉시 앞/뒤 대사로 분리 */}
      {splitModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10002,
            backgroundColor: 'rgba(2,6,23,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setSplitModal(null)}
        >
          <div
            style={{
              width: 'min(520px, 94vw)',
              padding: '16px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '13.5px' }}>
                ✂️ 대사 분리 — [{splitModal.line.timeTag}] {splitModal.line.speaker}
              </strong>
              <span style={{ fontSize: '11px', color: '#38bdf8' }}>
                분리할 지점에 커서를 놓고 Enter 입력
              </span>
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={splitModal.toggleSecondSpeaker}
                onChange={(e) =>
                  setSplitModal((prev) =>
                    prev ? { ...prev, toggleSecondSpeaker: e.target.checked } : null
                  )
                }
              />
              <span>
                분리된 뒷부분 화자를 상대편(
                {splitModal.line.speaker === '나' || splitModal.line.speaker === '정서현'
                  ? counterpartName || '상대방'
                  : '나'}
                )으로 자동 전환
              </span>
            </label>
            <textarea
              autoFocus
              rows={3}
              className="input-field"
              style={{ fontSize: '13px', lineHeight: 1.5, resize: 'vertical' }}
              value={splitModal.value}
              onChange={(e) =>
                setSplitModal((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onConfirmSplit(e.currentTarget.selectionStart ?? 0);
                } else if (e.key === 'Escape') {
                  setSplitModal(null);
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
              <button type="button" className="toolbar-btn" onClick={() => setSplitModal(null)}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 스크립트 수정(멀티라인 지원) / 시점 변환 팝업 */}
      {editingModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10002,
            backgroundColor: 'rgba(2,6,23,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setEditingModal(null)}
        >
          <div
            style={{
              width: 'min(480px, 92vw)',
              padding: '16px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <strong style={{ fontSize: '13.5px' }}>
              {editingModal.mode === 'text' ? '✏️ 스크립트 수정' : '⏱️ 시점 변환'}
            </strong>
            {editingModal.mode === 'time' && (
              <button
                type="button"
                className="toolbar-btn"
                style={{ fontSize: '12px', padding: '5px 10px' }}
                onClick={() =>
                  setEditingModal((prev) =>
                    prev
                      ? {
                          ...prev,
                          value: formatSecToTimeTag(
                            audioRef.current?.currentTime || currentAudioSec
                          ),
                        }
                      : null
                  )
                }
              >
                📍 현재 오디오 재생 위치로 설정 (
                {formatSecToTimeTag(audioRef.current?.currentTime || currentAudioSec)})
              </button>
            )}
            <input
              autoFocus
              type="text"
              className="input-field"
              value={editingModal.value}
              onChange={(e) =>
                setEditingModal((prev) => (prev ? { ...prev, value: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onConfirmTextOrTime();
                } else if (e.key === 'Escape') {
                  setEditingModal(null);
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
              <button type="button" className="toolbar-btn" onClick={() => setEditingModal(null)}>
                취소
              </button>
              <button
                type="button"
                className="toolbar-btn primary"
                onClick={() => onConfirmTextOrTime()}
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CallPostprocessPromptPopupModal({
  onClose,
  setStatusMessage,
}: {
  onClose: () => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}) {
  const [payload, setPayload] = useState<CallPostprocessPromptPayload | null>(null);
  const [promptText, setPromptText] = useState('');
  const [activeTab, setActiveTab] = useState<'prompt' | 'log'>('prompt');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCallPostprocessPromptAndLog()
      .then((res) => {
        setPayload(res);
        setPromptText(res.promptMarkdown);
      })
      .catch((err) => setStatusMessage(`❌ 후처리 프롬프트 로드 실패: ${String(err)}`));
  }, []);

  const handleSave = async (evolveFromLog = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await saveCallPostprocessPrompt({ promptMarkdown: promptText, evolveFromLog });
      setPayload(updated);
      setPromptText(updated.promptMarkdown);
      setStatusMessage(
        evolveFromLog
          ? '🧬 사용자 변경 로그를 반영하여 후처리 프롬프트가 발전·저장되었습니다.'
          : '💾 후처리 프롬프트(postprocess_prompt.md) 저장 완료'
      );
    } catch (e) {
      setStatusMessage(`❌ 저장 실패: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10005,
        backgroundColor: 'rgba(2,6,23,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(920px, 94vw)',
          maxHeight: '86vh',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              className={`toolbar-btn ${activeTab === 'prompt' ? 'primary' : ''}`}
              style={{ fontSize: '12px', padding: '4px 10px' }}
              onClick={() => setActiveTab('prompt')}
            >
              🛠️ 후처리 프롬프트 (postprocess_prompt.md)
            </button>
            <button
              type="button"
              className={`toolbar-btn ${activeTab === 'log' ? 'primary' : ''}`}
              style={{ fontSize: '12px', padding: '4px 10px' }}
              onClick={() => setActiveTab('log')}
            >
              📋 사용자 후처리 변경 로그
            </button>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <button
              type="button"
              className="toolbar-btn"
              style={{ fontSize: '12px', padding: '4px 10px' }}
              disabled={saving}
              onClick={() => void handleSave(true)}
              title="사용자 변경 로그를 바탕으로 프롬프트 자동 발전"
            >
              🧬 로그 반영 발전
            </button>
            <button
              type="button"
              className="toolbar-btn primary"
              style={{ fontSize: '12px', padding: '4px 10px' }}
              disabled={saving}
              onClick={() => void handleSave(false)}
              title="현재 프롬프트 저장"
            >
              💾 저장
            </button>
            <button
              type="button"
              className="toolbar-btn"
              style={{ fontSize: '13px', padding: '4px 9px' }}
              onClick={onClose}
              title="닫기"
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {activeTab === 'prompt'
            ? payload?.promptPath || 'mobile/calls/postprocess_prompt.md'
            : payload?.editLogPath || 'mobile/calls/postprocess_user_edit_log.md'}
        </div>

        {activeTab === 'prompt' ? (
          <textarea
            className="input-field"
            style={{ flex: 1, minHeight: '54vh', fontSize: '12px', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
          />
        ) : (
          <pre
            style={{
              flex: 1,
              minHeight: '54vh',
              maxHeight: '62vh',
              overflowY: 'auto',
              margin: 0,
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              fontSize: '12px',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'pre-wrap',
              color: 'var(--text-primary)',
            }}
          >
            {payload?.editLogMarkdown?.trim() ||
              '아직 기록된 사용자 후처리 변경 로그가 없습니다. (스크립트를 수정한 후 확정하면 이곳에 변경 내역이 자동 기록됩니다.)'}
          </pre>
        )}
      </div>
    </div>
  );
}

export interface PromptAbDiffViewerProps {
  tournamentStatus: ContactPromptTournamentStatus | null;
  setTournamentStatus?: React.Dispatch<React.SetStateAction<ContactPromptTournamentStatus | null>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
  onClose?: () => void;
}

export function PromptAbDiffViewer({
  tournamentStatus,
  setTournamentStatus,
  setStatusMessage,
  onClose,
}: PromptAbDiffViewerProps) {
  const [textA, setTextA] = useState('');
  useEffect(() => {
    if (tournamentStatus?.slotA) setTextA(tournamentStatus.slotA.promptText);
  }, [tournamentStatus]);
  if (!tournamentStatus) return null;

  const handleSaveSlot = async () => {
    if (!setTournamentStatus) return;
    try {
      const updated = await updateContactPromptSlotManual({
        slot: 'A',
        promptTitle: tournamentStatus.slotA.promptTitle,
        promptText: textA,
        reason: '인물 서술 AI 프롬프트 수동 수정',
      });
      setTournamentStatus(updated);
      setStatusMessage('💾 인물 서술 AI 프롬프트 저장 완료');
    } catch (e) {
      setStatusMessage(`프롬프트 저장 실패: ${String(e)}`);
    }
  };

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: '12.5px' }}>
          🧬 인물 서술 AI 프롬프트 (v{tournamentStatus.slotA.version} · 사용자 수정 시 자동 진화)
        </strong>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="toolbar-btn primary"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={() => void handleSaveSlot()}
          >
            💾 저장
          </button>
          {onClose && (
            <button
              type="button"
              className="toolbar-btn"
              style={{ padding: '2px 7px', fontSize: '11px' }}
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <textarea
        className="input-field"
        style={{ minHeight: '130px', fontSize: '11.5px', fontFamily: 'var(--font-mono)' }}
        value={textA}
        onChange={(e) => setTextA(e.target.value)}
      />
    </div>
  );
}
