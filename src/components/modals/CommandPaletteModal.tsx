/**
 * @file CommandPaletteModal.tsx
 * @description VSCode 스타일 명령어 팔레트(`Ctrl+Shift+P`) 및 파일 열기(`Ctrl+O`) 모달.
 */
import React, { useEffect, useState } from 'react';
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
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [paletteMode, paletteQuery]);

  if (paletteMode === 'closed') return null;

  const filteredCommands = commandItems.filter((c) =>
    c.label.toLowerCase().includes(paletteQuery.toLowerCase())
  );

  const filteredFiles = flattenedFiles
    .filter(
      (f) =>
        f.name.toLowerCase().includes(paletteQuery.toLowerCase()) ||
        f.relativePath.toLowerCase().includes(paletteQuery.toLowerCase())
    )
    .slice(0, 30);

  const totalCount =
    paletteMode === 'commands' ? filteredCommands.length : filteredFiles.length;
  const safeIdx =
    totalCount > 0 ? Math.min(selectedIndex, totalCount - 1) : 0;

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
              : '열고 싶은 문서 파일명 또는 경로를 입력하세요 (Ctrl+O)...'
          }
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (totalCount > 0) {
                setSelectedIndex((prev) => (prev + 1) % totalCount);
              }
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (totalCount > 0) {
                setSelectedIndex((prev) => (prev - 1 + totalCount) % totalCount);
              }
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (paletteMode === 'commands') {
                const cmd = filteredCommands[safeIdx];
                if (cmd) {
                  setPaletteMode('closed');
                  cmd.action();
                }
              } else {
                const file = filteredFiles[safeIdx];
                if (file) {
                  setPaletteMode('closed');
                  openDocumentByNode(file);
                }
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setPaletteMode('closed');
            }
          }}
        />
        <div className="palette-list">
          {paletteMode === 'commands'
            ? filteredCommands.map((cmd, idx) => (
                <button
                  key={cmd.id}
                  className={`palette-item ${idx === safeIdx ? 'active' : ''}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    setPaletteMode('closed');
                    cmd.action();
                  }}
                >
                  <span>{cmd.label}</span>
                  <span className="menu-item-shortcut">{cmd.shortcut}</span>
                </button>
              ))
            : filteredFiles.map((file, idx) => (
                <button
                  key={file.fullPath}
                  className={`palette-item ${idx === safeIdx ? 'active' : ''}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    setPaletteMode('closed');
                    openDocumentByNode(file);
                  }}
                >
                  <span>
                    [{file.role.toUpperCase()}] {file.relativePath}
                  </span>
                  <span className="menu-item-shortcut">
                    {file.uuid ? file.uuid.slice(0, 8) : '-'}
                  </span>
                </button>
              ))}
        </div>
      </div>
    </div>
  );
}
