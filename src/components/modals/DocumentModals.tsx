/**
 * @file DocumentModals.tsx
 * @description 문서 조작 모달 5종: 제목 변경(`F2`), 줄 번호 이동(`Ctrl+G`), 새 프로젝트/새 다이어리 생성(`Google Calendar Template.md` 루틴 지원), 프로젝트 폴더 승격, 볼트 템플릿(`.myLore/templates`) 관리.
 */
import React from 'react';
import {
  BaseFolderRole,
  DocumentPayload,
  VaultTemplateItem,
} from '../../types/mylore';
import { readDocument } from '../../services/tauriClient';
import { GOOGLE_CALENDAR_COLOR_MAP } from '../../utils/markdownAutoFormat';

export interface DocumentModalsProps {
  currentDoc: DocumentPayload | null;
  renameModalOpen: boolean;
  setRenameModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  renameTitleInput: string;
  setRenameTitleInput: React.Dispatch<React.SetStateAction<string>>;
  handleRenameCurrentDocSubmit: () => void;
  gotoLineModalOpen: boolean;
  setGotoLineModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  gotoLineInput: string;
  setGotoLineInput: React.Dispatch<React.SetStateAction<string>>;
  applyLoadedDocument: (
    doc: DocumentPayload,
    options?: {
      highlightQuery?: string;
      lineNumber?: number;
      charOffset?: number;
    }
  ) => void;
  newDocModalOpen: boolean;
  setNewDocModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newDocRole: BaseFolderRole;
  newDocDate: string;
  newDocTitle: string;
  setNewDocTitle: React.Dispatch<React.SetStateAction<string>>;
  newDocCalendar: string;
  setNewDocCalendar: React.Dispatch<React.SetStateAction<string>>;
  newDocLocation: string;
  setNewDocLocation: React.Dispatch<React.SetStateAction<string>>;
  newDocIncludeLocation: boolean;
  setNewDocIncludeLocation: React.Dispatch<React.SetStateAction<boolean>>;
  newDocDescriptionMode: 'File' | 'none';
  setNewDocDescriptionMode: React.Dispatch<
    React.SetStateAction<'File' | 'none'>
  >;
  newDocTransparency: 'transparent' | 'opaque';
  setNewDocTransparency: React.Dispatch<
    React.SetStateAction<'transparent' | 'opaque'>
  >;
  newDocVisibility: 'default' | 'public' | 'private' | 'confidential';
  setNewDocVisibility: React.Dispatch<
    React.SetStateAction<'default' | 'public' | 'private' | 'confidential'>
  >;
  newDocAttendeeEmail: string;
  setNewDocAttendeeEmail: React.Dispatch<React.SetStateAction<string>>;
  newDocAttendeeResponseStatus:
    | 'accepted'
    | 'declined'
    | 'tentative'
    | 'needsAction';
  setNewDocAttendeeResponseStatus: React.Dispatch<
    React.SetStateAction<'accepted' | 'declined' | 'tentative' | 'needsAction'>
  >;
  newDocEventStatus: 'confirmed' | 'tentative' | 'cancelled';
  setNewDocEventStatus: React.Dispatch<
    React.SetStateAction<'confirmed' | 'tentative' | 'cancelled'>
  >;
  newDocTemplate: string;
  setNewDocTemplate: React.Dispatch<React.SetStateAction<string>>;
  vaultTemplates: VaultTemplateItem[];
  handleCreateNewDocSubmit: () => void;
  promoteModalOpen: boolean;
  setPromoteModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  promoteProjectName: string;
  setPromoteProjectName: React.Dispatch<React.SetStateAction<string>>;
  handlePromoteToProject: () => void;
  templateModalOpen: boolean;
  setTemplateModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  insertIntoBody: (snippet: string) => void;
}

export function DocumentModals({
  currentDoc,
  renameModalOpen,
  setRenameModalOpen,
  renameTitleInput,
  setRenameTitleInput,
  handleRenameCurrentDocSubmit,
  gotoLineModalOpen,
  setGotoLineModalOpen,
  gotoLineInput,
  setGotoLineInput,
  applyLoadedDocument,
  newDocModalOpen,
  setNewDocModalOpen,
  newDocRole,
  newDocDate,
  newDocTitle,
  setNewDocTitle,
  newDocCalendar,
  setNewDocCalendar,
  newDocLocation,
  setNewDocLocation,
  newDocIncludeLocation,
  setNewDocIncludeLocation,
  newDocDescriptionMode,
  setNewDocDescriptionMode,
  newDocTransparency,
  setNewDocTransparency,
  newDocVisibility,
  setNewDocVisibility,
  newDocAttendeeEmail,
  setNewDocAttendeeEmail,
  newDocAttendeeResponseStatus,
  setNewDocAttendeeResponseStatus,
  newDocEventStatus,
  setNewDocEventStatus,
  newDocTemplate,
  setNewDocTemplate,
  vaultTemplates,
  handleCreateNewDocSubmit,
  promoteModalOpen,
  setPromoteModalOpen,
  promoteProjectName,
  setPromoteProjectName,
  handlePromoteToProject,
  templateModalOpen,
  setTemplateModalOpen,
  insertIntoBody,
}: DocumentModalsProps) {
  return (
    <>
      {renameModalOpen && currentDoc && (
        <div
          className="modal-backdrop"
          onClick={() => setRenameModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '460px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '8px', fontSize: '16px' }}>
              {currentDoc.uuid
                ? '✏️ 현재 문서 제목 변경 (`F2`)'
                : '📄 새 문서 제목 입력 (확인 시 UUID 자동 주입)'}
            </h3>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '12px',
              }}
            >
              문서 제목(또는 프로젝트 폴더명)이 변경되더라도 내부 고유{' '}
              <code>
                UUID (
                {currentDoc.uuid
                  ? currentDoc.uuid.slice(0, 8)
                  : '입력 후 자동 생성'}
                )
              </code>
              와 백링크 연결은 그대로 유지됩니다.
            </p>
            <input
              autoFocus
              className="input-field"
              placeholder="새 문서 제목 입력..."
              value={renameTitleInput}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setRenameTitleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameCurrentDocSubmit();
                } else if (e.key === 'Escape') {
                  setRenameModalOpen(false);
                }
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '14px',
              }}
            >
              <button
                className="toolbar-btn"
                onClick={() => setRenameModalOpen(false)}
              >
                취소
              </button>
              <button
                className="toolbar-btn primary"
                onClick={handleRenameCurrentDocSubmit}
              >
                제목 변경 적용
              </button>
            </div>
          </div>
        </div>
      )}

      {gotoLineModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setGotoLineModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '360px', padding: '18px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '10px', fontSize: '15px' }}>
              줄 이동 (Go to Line)
            </h3>
            <input
              autoFocus
              type="number"
              className="input-field"
              value={gotoLineInput}
              onChange={(e) => setGotoLineInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && currentDoc) {
                  const lineNum = parseInt(gotoLineInput || '1', 10);
                  setGotoLineModalOpen(false);
                  applyLoadedDocument(currentDoc, { lineNumber: lineNum });
                }
              }}
            />
          </div>
        </div>
      )}

      {newDocModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setNewDocModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '560px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '12px' }}>
              {newDocRole === 'diary'
                ? `📅 새 다이어리(일정) 생성 (${newDocDate})`
                : '📁 새 프로젝트 폴더 생성 (Projects/{이름}/main.md)'}
            </h3>
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <input
                autoFocus
                className="input-field"
                placeholder={
                  newDocRole === 'diary'
                    ? '문서 제목 입력 (미입력 시 "새 일정", Enter로 즉시 생성)'
                    : '프로젝트 폴더명 (예: Webcel)'
                }
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateNewDocSubmit();
                }}
              />

              {newDocRole === 'diary' ? (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px',
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '11.5px',
                          color: 'var(--text-secondary)',
                          marginBottom: '4px',
                        }}
                      >
                        캘린더 카테고리 (colorId 자동 매핑)
                      </label>
                      <select
                        className="input-field"
                        value={newDocCalendar}
                        onChange={(e) => setNewDocCalendar(e.target.value)}
                      >
                        {Object.entries(GOOGLE_CALENDAR_COLOR_MAP).map(
                          ([cat, info]) => (
                            <option key={cat} value={cat}>
                              {cat} (colorId: {info.colorId}) — {info.desc}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '11.5px',
                          color: 'var(--text-secondary)',
                          marginBottom: '4px',
                        }}
                      >
                        내용 포함 여부 (description)
                      </label>
                      <select
                        className="input-field"
                        value={newDocDescriptionMode}
                        onChange={(e) =>
                          setNewDocDescriptionMode(
                            e.target.value as 'File' | 'none'
                          )
                        }
                      >
                        <option value="File">예 (내용 넣음 — description: File)</option>
                        <option value="none">아니오 (일정만 — description 생략)</option>
                      </select>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={newDocIncludeLocation}
                        onChange={(e) =>
                          setNewDocIncludeLocation(e.target.checked)
                        }
                      />
                      장소(location) 포함
                    </label>
                    <input
                      className="input-field"
                      disabled={!newDocIncludeLocation}
                      placeholder="장소 입력 (기본값: 거제집)"
                      value={newDocLocation}
                      onChange={(e) => setNewDocLocation(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateNewDocSubmit();
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px',
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '11.5px',
                          color: 'var(--text-secondary)',
                          marginBottom: '4px',
                        }}
                      >
                        한가함 / 바쁨 (transparency)
                      </label>
                      <select
                        className="input-field"
                        value={newDocTransparency}
                        onChange={(e) =>
                          setNewDocTransparency(
                            e.target.value as 'transparent' | 'opaque'
                          )
                        }
                      >
                        <option value="transparent">한가함 (transparent)</option>
                        <option value="opaque">바쁨 (opaque)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '11.5px',
                          color: 'var(--text-secondary)',
                          marginBottom: '4px',
                        }}
                      >
                        공개 범위 (visibility)
                      </label>
                      <select
                        className="input-field"
                        value={newDocVisibility}
                        onChange={(e) =>
                          setNewDocVisibility(
                            e.target.value as
                              | 'default'
                              | 'public'
                              | 'private'
                              | 'confidential'
                          )
                        }
                      >
                        <option value="default">달력 설정에 따름 (default)</option>
                        <option value="public">공개 (public)</option>
                        <option value="private">비공개 (private)</option>
                        <option value="confidential">조건부 비공개 (confidential)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11.5px',
                        color: 'var(--text-secondary)',
                        marginBottom: '4px',
                      }}
                    >
                      추가 참석자 이메일 (attendees — 없으면 비워두세요)
                    </label>
                    <input
                      className="input-field"
                      placeholder="예: example@gmail.com (입력 시 참석자 상태 선택 활성화)"
                      value={newDocAttendeeEmail}
                      onChange={(e) => setNewDocAttendeeEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateNewDocSubmit();
                      }}
                    />
                  </div>

                  {newDocAttendeeEmail.trim() !== '' && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px',
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: '11.5px',
                            color: 'var(--text-secondary)',
                            marginBottom: '4px',
                          }}
                        >
                          참석자 응답 상태 (responseStatus)
                        </label>
                        <select
                          className="input-field"
                          value={newDocAttendeeResponseStatus}
                          onChange={(e) =>
                            setNewDocAttendeeResponseStatus(
                              e.target.value as
                                | 'accepted'
                                | 'declined'
                                | 'tentative'
                                | 'needsAction'
                            )
                          }
                        >
                          <option value="needsAction">미응답 (needsAction)</option>
                          <option value="accepted">수락됨 (accepted)</option>
                          <option value="declined">거부됨 (declined)</option>
                          <option value="tentative">보류됨 (tentative)</option>
                        </select>
                      </div>

                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: '11.5px',
                            color: 'var(--text-secondary)',
                            marginBottom: '4px',
                          }}
                        >
                          일정 확정 상태 (status)
                        </label>
                        <select
                          className="input-field"
                          value={newDocEventStatus}
                          onChange={(e) =>
                            setNewDocEventStatus(
                              e.target.value as
                                | 'confirmed'
                                | 'tentative'
                                | 'cancelled'
                            )
                          }
                        >
                          <option value="confirmed">확정 (confirmed)</option>
                          <option value="tentative">미정/보류 (tentative)</option>
                          <option value="cancelled">취소됨 (cancelled)</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '11.5px',
                        color: 'var(--text-secondary)',
                        marginBottom: '4px',
                      }}
                    >
                      본문 초기 템플릿
                    </label>
                    <select
                      className="input-field"
                      value={newDocTemplate}
                      onChange={(e) => setNewDocTemplate(e.target.value)}
                    >
                      <option value="none">
                        빈 본문으로 시작 (YAML Frontmatter만 생성 — 권장)
                      </option>
                      {vaultTemplates.map((tpl) => (
                        <option key={tpl.fileName} value={tpl.fileName}>
                          {tpl.fileName} — {tpl.description}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <select
                  className="input-field"
                  value={newDocTemplate}
                  onChange={(e) => setNewDocTemplate(e.target.value)}
                >
                  {vaultTemplates.map((tpl) => (
                    <option key={tpl.fileName} value={tpl.fileName}>
                      {tpl.fileName} — {tpl.description}
                    </option>
                  ))}
                </select>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  marginTop: '8px',
                }}
              >
                <button
                  className="toolbar-btn"
                  onClick={() => setNewDocModalOpen(false)}
                >
                  취소
                </button>
                <button
                  className="toolbar-btn primary"
                  onClick={handleCreateNewDocSubmit}
                >
                  생성하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {promoteModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setPromoteModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '460px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '10px' }}>
              📁 프로젝트 폴더(`Projects/{'{이름}'}/main.md`)로 승격
            </h3>
            <input
              autoFocus
              className="input-field"
              value={promoteProjectName}
              onChange={(e) => setPromoteProjectName(e.target.value)}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '8px',
                marginTop: '14px',
              }}
            >
              <button
                className="toolbar-btn"
                onClick={() => setPromoteModalOpen(false)}
              >
                취소
              </button>
              <button
                className="toolbar-btn primary"
                onClick={handlePromoteToProject}
              >
                승격 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {templateModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setTemplateModalOpen(false)}
        >
          <div
            className="palette-box"
            style={{ width: '680px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '10px' }}>
              📋 1번 프로젝트 볼트 템플릿 (`Projects\.myLore\templates`)
            </h3>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                maxHeight: '380px',
                overflowY: 'auto',
              }}
            >
              {vaultTemplates.map((tpl) => (
                <div
                  key={tpl.fileName}
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: '#a5b4fc' }}>
                      📄 {tpl.fileName}
                    </div>
                    <div
                      style={{ fontSize: '12px', color: 'var(--text-secondary)' }}
                    >
                      {tpl.description}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {currentDoc && (
                      <button
                        className="toolbar-btn primary"
                        onClick={() => {
                          insertIntoBody(tpl.bodyContent);
                          setTemplateModalOpen(false);
                        }}
                      >
                        + 현재 문서에 삽입
                      </button>
                    )}
                    <button
                      className="toolbar-btn"
                      onClick={async () => {
                        const doc = await readDocument(tpl.fullPath);
                        applyLoadedDocument(doc);
                        setTemplateModalOpen(false);
                      }}
                    >
                      ✏️ 템플릿 원본 편집
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
