/**
 * @file ProjectSubDocsPanel.tsx
 * @description 프로젝트 대표 문서(`main.md`) 하단에 표시되는 하위 문서(Sub-MD) 카드/테이블 탐색 패널.
 */
import React from 'react';
import { DocumentPayload, FileNode } from '../../types/mylore';

export interface ProjectSubDocsPanelProps {
  currentDoc: DocumentPayload;
  currentProjectSubDocs: FileNode[];
  subDocFilter: string;
  setSubDocFilter: React.Dispatch<React.SetStateAction<string>>;
  subDocViewStyle: 'cards' | 'table';
  setSubDocViewStyle: React.Dispatch<React.SetStateAction<'cards' | 'table'>>;
  openDocumentByNode: (node: FileNode) => void;
}

export function ProjectSubDocsPanel({
  currentDoc,
  currentProjectSubDocs,
  subDocFilter,
  setSubDocFilter,
  subDocViewStyle,
  setSubDocViewStyle,
  openDocumentByNode,
}: ProjectSubDocsPanelProps) {
  if (currentProjectSubDocs.length === 0) return null;

  const filterQ = subDocFilter.trim().toLowerCase();
  const filteredSubDocs = currentProjectSubDocs.filter(
    (doc) =>
      filterQ === '' ||
      doc.name.toLowerCase().includes(filterQ) ||
      doc.relativePath.toLowerCase().includes(filterQ) ||
      (doc.title || '').toLowerCase().includes(filterQ)
  );
  const isRootProjectsMain =
    currentDoc.relativePath.replace(/\\/g, '/').toLowerCase() === 'main.md';

  return (
    <div className="subdocs-hub-section">
      <div className="subdocs-hub-header">
        <div className="subdocs-hub-title">
          <span>📂</span>
          <span>
            {isRootProjectsMain
              ? `하위 프로젝트 허브 (${filteredSubDocs.length}/${currentProjectSubDocs.length})`
              : `이 프로젝트의 하위 문서 (${filteredSubDocs.length}/${currentProjectSubDocs.length})`}
          </span>
        </div>
        <div className="subdocs-hub-controls">
          <input
            className="input-field"
            style={{
              width: '180px',
              padding: '4px 8px',
              fontSize: '12px',
            }}
            placeholder="하위 문서 빠른 필터..."
            value={subDocFilter}
            onChange={(e) => setSubDocFilter(e.target.value)}
          />
          <button
            className={`tree-mode-pill ${
              subDocViewStyle === 'cards' ? 'active' : ''
            }`}
            onClick={() => setSubDocViewStyle('cards')}
            title="카드 그리드 보기"
          >
            카드형
          </button>
          <button
            className={`tree-mode-pill ${
              subDocViewStyle === 'table' ? 'active' : ''
            }`}
            onClick={() => setSubDocViewStyle('table')}
            title="표 목록 보기"
          >
            표형
          </button>
        </div>
      </div>

      {filteredSubDocs.length === 0 ? (
        <div className="tree-empty-hint">
          검색어와 일치하는 하위 문서가 없습니다.
        </div>
      ) : subDocViewStyle === 'cards' ? (
        <div className="subdocs-card-grid">
          {filteredSubDocs.map((subDoc) => {
            const relNorm = subDoc.relativePath.replace(/\\/g, '/');
            const relParts = relNorm.split('/');
            const folderBadge =
              relParts.length > 1 ? relParts.slice(0, -1).join('/') : '루트';
            const displayTitle =
              subDoc.title ||
              (subDoc.name.toLowerCase() === 'main.md'
                ? `${folderBadge} (프로젝트 허브)`
                : subDoc.name.replace(/\.md$/i, ''));

            return (
              <div
                key={subDoc.fullPath}
                className="subdoc-card"
                onClick={() => openDocumentByNode(subDoc)}
                title={`${subDoc.fullPath}\n클릭하여 문서 열기`}
              >
                <div className="subdoc-card-title">
                  <span>
                    {subDoc.name.toLowerCase() === 'main.md' ? '⭐' : '📄'}
                  </span>
                  <span>{displayTitle}</span>
                </div>
                <div className="subdoc-card-meta">
                  <span>📁 {relNorm}</span>
                  {subDoc.projectStatus && (
                    <span
                      style={{
                        color:
                          subDoc.projectStatus === '최우선'
                            ? '#f87171'
                            : 'var(--accent-hover)',
                        fontWeight: 600,
                      }}
                    >
                      {subDoc.projectStatus}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="md-table-wrapper">
          <table className="md-table">
            <thead>
              <tr>
                <th>문서명</th>
                <th>상대 경로</th>
                <th style={{ width: '90px' }}>상태</th>
              </tr>
            </thead>
            <tbody>
              {filteredSubDocs.map((subDoc) => {
                const relNorm = subDoc.relativePath.replace(/\\/g, '/');
                const relParts = relNorm.split('/');
                const folderBadge =
                  relParts.length > 1
                    ? relParts.slice(0, -1).join('/')
                    : '루트';
                const displayTitle =
                  subDoc.title ||
                  (subDoc.name.toLowerCase() === 'main.md'
                    ? `${folderBadge} (프로젝트 허브)`
                    : subDoc.name.replace(/\.md$/i, ''));
                return (
                  <tr
                    key={subDoc.fullPath}
                    style={{ cursor: 'pointer' }}
                    onClick={() => openDocumentByNode(subDoc)}
                    title={`${subDoc.fullPath}\n클릭하여 문서 열기`}
                  >
                    <td
                      style={{
                        fontWeight: 600,
                        color: 'var(--accent-hover)',
                      }}
                    >
                      {subDoc.name.toLowerCase() === 'main.md' ? '⭐ ' : '📄 '}
                      {displayTitle}
                    </td>
                    <td
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {relNorm}
                    </td>
                    <td>
                      {subDoc.projectStatus ? (
                        <span className="role-badge projects">
                          {subDoc.projectStatus}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          문서
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
