/**
 * @file CommandPaletteModal.tsx
 * @description VSCode 스타일 명령어 팔레트(`Ctrl+Shift+P`) 및 빠른 파일 열기(`Ctrl+P`) 모달.
 */
import React from 'react';
import {
  CommandPaletteItem,
  FileNode,
  PaletteMode,
} from '../../types/mylore';

export interface CommandPaletteModalProps {
  paletteMode: PaletteMode;
  setPaletteMode: React.Dispatch<React.SetStateAction<PaletteMode>>;
  paletteQuery: string;
  setPaletteQuery: React.Dispatch<React.SetStateAction<string>>;
  commandItems: CommandPaletteItem[];
  flattenedFiles: FileNode[];
  openDocumentByNode: (node: FileNode) => void;
}

export function CommandPaletteModal({
  paletteMode,
  setPaletteMode,
  paletteQuery,
  setPaletteQuery,
  commandItems,
  flattenedFiles,
  openDocumentByNode,
}: CommandPaletteModalProps) {
  if (paletteMode === 'closed') return null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => setPaletteMode('closed')}
    >
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder={
            paletteMode === 'commands'
              ? '> 실행할 명령어를 검색하세요...'
              : '열고 싶은 문서 파일명 또는 경로를 입력하세요...'
          }
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
        />
        <div className="palette-list">
          {paletteMode === 'commands'
            ? commandItems
                .filter((c) =>
                  c.label.toLowerCase().includes(paletteQuery.toLowerCase())
                )
                .map((cmd) => (
                  <button
                    key={cmd.id}
                    className="palette-item"
                    onClick={() => {
                      setPaletteMode('closed');
                      cmd.action();
                    }}
                  >
                    <span>{cmd.label}</span>
                    <span className="menu-item-shortcut">
                      {cmd.shortcut}
                    </span>
                  </button>
                ))
            : flattenedFiles
                .filter(
                  (f) =>
                    f.name
                      .toLowerCase()
                      .includes(paletteQuery.toLowerCase()) ||
                    f.relativePath
                      .toLowerCase()
                      .includes(paletteQuery.toLowerCase())
                )
                .slice(0, 30)
                .map((file) => (
                  <button
                    key={file.fullPath}
                    className="palette-item"
                    onClick={() => {
                      setPaletteMode('closed');
                      openDocumentByNode(file);
                    }}
                  >
                    <span>
                      [{file.role.toUpperCase()}] {file.relativePath}
                    </span>
                    <span className="menu-item-shortcut">
                      {file.uuid.slice(0, 8)}
                    </span>
                  </button>
                ))}
        </div>
      </div>
    </div>
  );
}
