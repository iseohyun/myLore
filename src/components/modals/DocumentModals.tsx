/**
 * @file DocumentModals.tsx
 * @description 문서 조작 모달 5종: 제목 변경(`F2`), 줄 번호 이동(`Ctrl+G`), 새 프로젝트 생성, 프로젝트 폴더 승격, 볼트 템플릿(`.myLore/templates`) 관리.
 */
import React from 'react';
import {
  BaseFolderRole,
  DocumentPayload,
  VaultTemplateItem,
} from '../../types/mylore';
import { readDocument } from '../../services/tauriClient';

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
              ✏️ 현재 문서 제목 변경 (`F2`)
            </h3>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginBottom: '12px',
              }}
            >
              문서 제목(또는 프로젝트 폴더명)이 변경되더라도 내부 고유{' '}
              <code>UUID ({currentDoc.uuid.slice(0, 8)})</code>와 백링크 연결은 그대로 유지됩니다.
            </p>
            <input
              autoFocus
              className="input-field"
              placeholder="새 문서 제목 입력..."
              value={renameTitleInput}
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
            style={{ width: '480px', padding: '20px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '12px' }}>
              {newDocRole === 'diary'
                ? `📅 새 일정 생성 (${newDocDate})`
                : '📁 새 프로젝트 폴더 생성 (Projects/{이름}/main.md)'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                autoFocus
                className="input-field"
                placeholder={
                  newDocRole === 'diary'
                    ? '일정 제목'
                    : '프로젝트 폴더명 (예: Webcel)'
                }
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateNewDocSubmit();
                }}
              />
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
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
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
