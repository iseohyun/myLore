/**
 * @file LinkAutocompletePopup.tsx
 * @description 마크다운 에디터에서 대괄호(`[`, `[[`)를 열었을 때 문서 제목/파일명으로 `.md` 문서를 실시간 검색하고 방향키(`↑`/`↓`) 및 `Enter`/`Tab`으로 링크를 자동완성하는 팝업 컴포넌트.
 */
import React from 'react';
import { FileNode } from '../../types/mylore';

export interface BracketLinkTrigger {
  query: string;
  replaceStart: number;
  replaceEnd: number;
  isDoubleBracket: boolean;
}

/**
 * 에디터 본문과 현재 커서 위치(caretOffset)를 분석하여 대괄호(`[`) 링크 입력 중인지 판별합니다.
 */
export function detectBracketLinkTrigger(
  text: string,
  caretOffset: number
): BracketLinkTrigger | null {
  if (caretOffset <= 0 || caretOffset > text.length) return null;

  const lineStart = text.lastIndexOf('\n', caretOffset - 1) + 1;
  const lineBeforeCaret = text.slice(lineStart, caretOffset);
  const lastOpenIdx = lineBeforeCaret.lastIndexOf('[');
  if (lastOpenIdx === -1) return null;

  // 열린 대괄호와 커서 사이에 닫는 대괄호(])가 이미 있으면 자동완성 비활성화
  const afterOpen = lineBeforeCaret.slice(lastOpenIdx + 1);
  if (afterOpen.includes(']') || afterOpen.includes('(')) {
    return null;
  }

  const isDoubleBracket =
    lastOpenIdx > 0 && lineBeforeCaret[lastOpenIdx - 1] === '[';
  const openCol = isDoubleBracket ? lastOpenIdx - 1 : lastOpenIdx;

  // 마크다운 이미지 문법 ![alt] 제외
  if (openCol > 0 && lineBeforeCaret[openCol - 1] === '!') {
    return null;
  }

  const prefixBeforeBracket = lineBeforeCaret.slice(0, openCol);
  const query = afterOpen;

  // 할 일 체크박스(- [ ], - [!], - [/], - [-], - [x]) 입력 시에는 방해하지 않도록 제외
  if (
    !isDoubleBracket &&
    /^\s*[-*+]\s+$/.test(prefixBeforeBracket) &&
    query.length <= 1 &&
    /^[!>/ \-xX]?$/.test(query)
  ) {
    return null;
  }

  const replaceStart = lineStart + openCol;
  const restOfText = text.slice(caretOffset);
  const closingMatch = restOfText.match(/^(\]{1,2})/);
  const replaceEnd =
    caretOffset + (closingMatch ? closingMatch[1].length : 0);

  return {
    query,
    replaceStart,
    replaceEnd,
    isDoubleBracket,
  };
}

/**
 * 검색어(query)와 현재 열람 중인 문서 경로를 기준으로 `.md` 문서 후보 목록을 정렬·반환합니다.
 */
export function filterLinkCandidates(
  query: string,
  flattenedFiles: FileNode[],
  currentDocFullPath?: string
): FileNode[] {
  const q = query.trim().toLowerCase();
  const normCur = (currentDocFullPath || '').replace(/\//g, '\\').toLowerCase();
  const lastSlash = normCur.lastIndexOf('\\');
  const currentDir = lastSlash >= 0 ? normCur.slice(0, lastSlash) : '';

  const scored: Array<{ node: FileNode; score: number }> = [];

  for (const f of flattenedFiles) {
    if (f.extension.toLowerCase() !== 'md') continue;
    const normPath = f.fullPath.replace(/\//g, '\\').toLowerCase();
    if (normPath === normCur) continue;

    const fSlash = normPath.lastIndexOf('\\');
    const fDir = fSlash >= 0 ? normPath.slice(0, fSlash) : '';
    const isSameFolder = Boolean(currentDir && fDir === currentDir);

    const nameLower = f.name.toLowerCase();
    const stemLower = nameLower.replace(/\.md$/i, '');
    const titleLower = (f.title || '').toLowerCase();
    const relLower = f.relativePath.toLowerCase();

    if (q !== '') {
      const matched =
        nameLower.includes(q) ||
        titleLower.includes(q) ||
        relLower.includes(q);
      if (!matched) continue;
    }

    let score = 0;
    if (isSameFolder) score += 1000;
    if (f.role === 'projects') score += 100;
    if (q !== '') {
      if (stemLower === q || nameLower === q || titleLower === q) {
        score += 500;
      } else if (
        stemLower.startsWith(q) ||
        nameLower.startsWith(q) ||
        titleLower.startsWith(q)
      ) {
        score += 250;
      } else if (nameLower.includes(q) || titleLower.includes(q)) {
        score += 100;
      }
    }

    scored.push({ node: f, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.node.name.localeCompare(b.node.name, 'ko');
  });

  return scored.slice(0, 12).map((s) => s.node);
}

/**
 * 선택된 FileNode에 대해 마크다운 링크 문자열을 생성합니다.
 */
export function buildCompletedMarkdownLink(node: FileNode): string {
  const displayTitle = node.name;
  if (node.uuid && node.uuid.trim() !== '') {
    return `[${displayTitle}](mylore://doc/${node.uuid})`;
  }
  return `[${displayTitle}]`;
}

export interface LinkAutocompletePopupProps {
  query: string;
  candidates: FileNode[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  onSelectCandidate: (node: FileNode) => void;
  onClose: () => void;
  currentDocFullPath?: string;
}

export function LinkAutocompletePopup({
  query,
  candidates,
  selectedIndex,
  setSelectedIndex,
  onSelectCandidate,
  onClose,
  currentDocFullPath,
}: LinkAutocompletePopupProps) {
  if (candidates.length === 0) return null;

  const normCur = (currentDocFullPath || '').replace(/\//g, '\\').toLowerCase();
  const lastSlash = normCur.lastIndexOf('\\');
  const currentDir = lastSlash >= 0 ? normCur.slice(0, lastSlash) : '';

  return (
    <div
      className="md-link-autocomplete-popup"
      onMouseDown={(e) => {
        // 에디터 포커스가 풀리지 않도록 기본 포커스 이동 방지
        e.preventDefault();
      }}
    >
      <div className="md-link-autocomplete-header">
        <span>
          🔗 문서 링크 자동완성{' '}
          {query ? `("${query}")` : '(제목/파일명 입력)'}
        </span>
        <span className="md-link-autocomplete-hint">
          ↑↓ 이동 · Enter/Tab 완성 · Esc 닫기
        </span>
      </div>
      <div className="md-link-autocomplete-list">
        {candidates.map((item, idx) => {
          const normPath = item.fullPath.replace(/\//g, '\\').toLowerCase();
          const fSlash = normPath.lastIndexOf('\\');
          const fDir = fSlash >= 0 ? normPath.slice(0, fSlash) : '';
          const isSibling = Boolean(currentDir && fDir === currentDir);
          const roleIcon =
            item.role === 'projects'
              ? '⭐'
              : item.role === 'diary'
                ? '📅'
                : item.role === 'git'
                  ? '💻'
                  : '📄';

          return (
            <button
              key={item.fullPath}
              type="button"
              className={`md-link-autocomplete-item ${
                idx === selectedIndex ? 'active' : ''
              }`}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => {
                onSelectCandidate(item);
                onClose();
              }}
            >
              <div className="md-link-autocomplete-main">
                <span>{roleIcon}</span>
                <span className="md-link-autocomplete-name">{item.name}</span>
                {item.title &&
                  item.title !== item.name &&
                  item.title !== item.name.replace(/\.md$/i, '') && (
                    <span className="md-link-autocomplete-title">
                      — {item.title}
                    </span>
                  )}
                {isSibling && (
                  <span className="md-link-autocomplete-sibling">현재 폴더</span>
                )}
              </div>
              <span className="md-link-autocomplete-path">
                {item.relativePath}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
