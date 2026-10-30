import React from 'react';
import { TaskPriorityCode } from '../types/mylore';

export interface MarkdownRendererProps {
  bodyText: string;
  onUpdateTaskStatus: (lineIndex: number, nextCode: TaskPriorityCode) => void;
  onNavigateUuid: (uuid: string) => void;
  onOpenExternalUrl?: (url: string) => void;
  activeAudioLineIndex?: number | null;
  onSeekAudioTime?: (seconds: number, lineIndex: number) => void;
  enableAudioTimestampSync?: boolean;
}

/**
 * 문장 내 `[00:00:00]` (`[HH:MM:SS]`) 또는 `[MM:SS]` 오프셋 시각을 초(seconds) 단위로 파싱합니다.
 */
export function parseAudioOffsetSecondsFromLine(line: string): number | null {
  const hmsMatch = line.match(/\[(\d{1,2}):(\d{2}):(\d{2})\]/);
  if (hmsMatch) {
    const h = parseInt(hmsMatch[1], 10);
    const m = parseInt(hmsMatch[2], 10);
    const s = parseInt(hmsMatch[3], 10);
    if (!Number.isNaN(h) && !Number.isNaN(m) && !Number.isNaN(s)) {
      return h * 3600 + m * 60 + s;
    }
  }
  const msMatch = line.match(/\[(\d{1,2}):(\d{2})\]/);
  if (msMatch) {
    const m = parseInt(msMatch[1], 10);
    const s = parseInt(msMatch[2], 10);
    if (!Number.isNaN(m) && !Number.isNaN(s)) {
      return m * 60 + s;
    }
  }
  return null;
}

type TableAlignment = 'left' | 'center' | 'right' | undefined;

/**
 * 마크다운 표의 구분선 행(예: | :--- | :---: | ---: |)인지 판별하고 정렬 배열을 반환합니다.
 */
function parseTableDelimiterRow(line: string): TableAlignment[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;

  const rawCells = splitTableCells(trimmed);
  if (rawCells.length === 0) return null;

  const alignments: TableAlignment[] = [];
  for (const cell of rawCells) {
    const c = cell.trim();
    if (!/^:?-{3,}:?$/.test(c)) {
      return null;
    }
    if (c.startsWith(':') && c.endsWith(':')) {
      alignments.push('center');
    } else if (c.endsWith(':')) {
      alignments.push('right');
    } else if (c.startsWith(':')) {
      alignments.push('left');
    } else {
      alignments.push(undefined);
    }
  }
  return alignments;
}

/**
 * 마크다운 표의 한 줄을 파이프(|) 기준으로 셀 배열로 분리합니다 (이스케이프된 \| 제외).
 */
function splitTableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '|') {
      current += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += s[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 수평선(Horizontal Rule: ---, ***, ___, 또는 <hr>, <hr/>) 여부 판별
 */
function isHorizontalRuleLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^<hr\s*\/?>$/i.test(trimmed)) return true;
  if (/^(-\s*){3,}$/.test(trimmed)) return true;
  if (/^(\*\s*){3,}$/.test(trimmed)) return true;
  if (/^(_\s*){3,}$/.test(trimmed)) return true;
  return false;
}

/**
 * 블록 레벨 Raw HTML 시작 여부 판별 (마크다운 표준에 따라 HTML 태그 직접 기술 시 스타일 적용 결과물 렌더링)
 */
function isRawHtmlBlockStart(line: string): { tag: string; selfClosing: boolean } | null {
  const trimmed = line.trim();
  const match = trimmed.match(
    /^<(details|summary|table|thead|tbody|tr|td|th|div|section|article|aside|header|footer|blockquote|pre|ul|ol|li|dl|dt|dd|figure|figcaption|center|p|h[1-6]|callout)(\s[^>]*)?>/i
  );
  if (match) {
    const tag = match[1].toLowerCase();
    const selfClosing =
      trimmed.endsWith('/>') ||
      new RegExp(`</${tag}>\\s*$`, 'i').test(trimmed);
    return { tag, selfClosing };
  }
  return null;
}

/**
 * 인라인 마크다운 + 인라인 Raw HTML + mylore:// 링크를 React 노드로 변환합니다.
 */
export function renderInlineMarkdown(
  text: string,
  onNavigateUuid: (uuid: string) => void,
  onOpenExternalUrl?: (url: string) => void
): React.ReactNode {
  if (!text) return null;

  // 토큰 정규식:
  // 1. 인라인 코드: `...`
  // 2. mylore URI 마크다운 링크: [텍스트](mylore://doc/uuid)
  // 3. 일반 마크다운 링크: [텍스트](https://...)
  // 4. 단독 mylore URI: mylore://doc/uuid
  // 5. 굵게+기울임: ***...***
  // 6. 굵게: **...** 또는 __...__
  // 7. 기울임: *...*
  // 8. 취소선: ~~...~~
  // 9. 하이라이트: ==...==
  // 10. 인라인 Raw HTML 태그: <br>, <hr>, <kbd>...</kbd>, <mark>...</mark>, <u>...</u>, <span ...>...</span>, <b>...</b>, <i>...</i>, <sup>...</sup>, <sub>...</sub>, <font ...>...</font>, <a ...>...</a>, <img ...>
  const tokenRegex =
    /(`[^`]+`)|(\[([^\]]+)\]\((mylore:\/\/(?:doc|media)\/([a-fA-F0-9-]+))\))|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(mylore:\/\/(?:doc|media)\/([a-fA-F0-9-]+))|(\*\*\*([^*]+)\*\*\*)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(~~([^~]+)~~)|(==([^=]+)==)|(<(?:br|hr)\s*\/?>|<img\s+[^>]*\/?>|<(kbd|mark|u|b|i|strong|em|sup|sub|span|font|small|big|code|del|ins|a)(\s[^>]*)?>([\s\S]*?)<\/\22>)/gi;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keySeq = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const full = match[0];

    if (match[1]) {
      // 1. 인라인 코드 `code`
      nodes.push(
        <code key={`ic-${keySeq++}`} className="md-inline-code">
          {full.slice(1, -1)}
        </code>
      );
    } else if (match[2]) {
      // 2. [라벨](mylore://doc/{uuid})
      const label = match[3];
      const targetUuid = match[5];
      nodes.push(
        <span
          key={`ml-${keySeq++}`}
          className="mylore-uri-link"
          onClick={() => onNavigateUuid(targetUuid)}
          title={`내부 문서 이동: ${match[4]}`}
        >
          🔗 {label}
        </span>
      );
    } else if (match[6]) {
      // 3. [라벨](https://...)
      const label = match[7];
      const url = match[8];
      nodes.push(
        <a
          key={`el-${keySeq++}`}
          href={url}
          className="md-external-link"
          onClick={(e) => {
            if (onOpenExternalUrl) {
              e.preventDefault();
              onOpenExternalUrl(url);
            }
          }}
          target="_blank"
          rel="noreferrer"
        >
          {label} ↗
        </a>
      );
    } else if (match[9]) {
      // 4. 단독 mylore://doc/{uuid}
      const targetUuid = match[10];
      nodes.push(
        <span
          key={`mu-${keySeq++}`}
          className="mylore-uri-link"
          onClick={() => onNavigateUuid(targetUuid)}
          title="클릭하여 해당 UUID 문서 열기"
        >
          🔗 {full}
        </span>
      );
    } else if (match[11]) {
      // 5. ***굵은 기울임***
      nodes.push(
        <strong key={`bi-${keySeq++}`}>
          <em>{match[12]}</em>
        </strong>
      );
    } else if (match[13] || match[15]) {
      // 6. **굵게** or __굵게__
      nodes.push(<strong key={`b-${keySeq++}`}>{match[14] || match[16]}</strong>);
    } else if (match[17]) {
      // 7. *기울임*
      nodes.push(<em key={`i-${keySeq++}`}>{match[18]}</em>);
    } else if (match[19]) {
      // 8. ~~취소선~~
      nodes.push(<del key={`s-${keySeq++}`}>{match[20]}</del>);
    } else if (match[21]) {
      // 9. ==하이라이트==
      nodes.push(
        <mark key={`m-${keySeq++}`} className="md-mark">
          {match[22]}
        </mark>
      );
    } else if (match[23]) {
      // 10. 인라인 Raw HTML 태그 (<br>, <hr>, <span style="...">, <mark>, <kbd>, <u> 등)
      const lower = full.toLowerCase();
      if (lower.startsWith('<br')) {
        nodes.push(<br key={`br-${keySeq++}`} />);
      } else if (lower.startsWith('<hr')) {
        nodes.push(<hr key={`hr-${keySeq++}`} className="md-hr" />);
      } else {
        nodes.push(
          <span
            key={`html-in-${keySeq++}`}
            className="md-raw-html-inline"
            dangerouslySetInnerHTML={{ __html: full }}
          />
        );
      }
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length === 1 ? nodes[0] : nodes;
}

/**
 * 표준 CommonMark + GFM(표, 취소선, 체크리스트) + Raw HTML Passthrough + myLore 확장 문법 렌더러
 */
export const MarkdownPreviewRenderer: React.FC<MarkdownRendererProps> = ({
  bodyText,
  onUpdateTaskStatus,
  onNavigateUuid,
  onOpenExternalUrl,
  activeAudioLineIndex,
  onSeekAudioTime,
  enableAudioTimestampSync,
}) => {
  const lines = bodyText.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let inScriptSection = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^#{1,4}\s+.*스크립트/.test(trimmed)) {
      inScriptSection = true;
    } else if (/^#{1,3}\s+/.test(trimmed) && !trimmed.includes('스크립트')) {
      inScriptSection = false;
    }

    // 1. 빈 줄
    if (trimmed === '') {
      i++;
      continue;
    }

    // 2. 펜스 코드 블록 (``` 또는 ~~~)
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const fenceChars = fenceMatch[1];
      const lang = fenceMatch[2].trim();
      const codeLines: string[] = [];
      const startLine = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fenceChars)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 닫는 펜스 소비
      const endLine = Math.max(startLine, i - 1);
      const codeContent = codeLines.join('\n');
      elements.push(
        <div
          key={`code-${startLine}`}
          className="md-code-block-wrapper"
          data-source-line={startLine}
          data-source-line-end={endLine}
        >
          {lang && <div className="md-code-lang-badge">{lang}</div>}
          <pre className="md-code-pre">
            <code>{codeContent}</code>
          </pre>
        </div>
      );
      continue;
    }

    // 3. 수평선 (---, ***, ___, <hr>, <hr/>)
    if (isHorizontalRuleLine(line)) {
      elements.push(
        <hr
          key={`hr-${i}`}
          className="md-hr"
          data-source-line={i}
          data-source-line-end={i}
        />
      );
      i++;
      continue;
    }

    // 4. GFM 마크다운 표 (현재 줄에 |가 있고, 다음 줄이 | --- | 구분선인 경우)
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      parseTableDelimiterRow(lines[i + 1]) !== null
    ) {
      const tableStart = i;
      const headerCells = splitTableCells(lines[i]);
      const alignments = parseTableDelimiterRow(lines[i + 1]) || [];
      i += 2; // 헤더 행 + 구분선 행 소비

      const bodyRows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        lines[i].includes('|') &&
        !isHorizontalRuleLine(lines[i])
      ) {
        bodyRows.push(splitTableCells(lines[i]));
        i++;
      }
      const tableEnd = Math.max(tableStart, i - 1);

      elements.push(
        <div
          key={`tbl-${tableStart}`}
          className="md-table-container"
          data-source-line={tableStart}
          data-source-line-end={tableEnd}
        >
          <table className="md-table">
            <thead>
              <tr>
                {headerCells.map((hCell, colIdx) => (
                  <th
                    key={`th-${colIdx}`}
                    style={{ textAlign: alignments[colIdx] || 'left' }}
                  >
                    {renderInlineMarkdown(
                      hCell,
                      onNavigateUuid,
                      onOpenExternalUrl
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((rCells, rowIdx) => (
                <tr key={`tr-${rowIdx}`}>
                  {headerCells.map((_, colIdx) => (
                    <td
                      key={`td-${rowIdx}-${colIdx}`}
                      style={{ textAlign: alignments[colIdx] || 'left' }}
                    >
                      {renderInlineMarkdown(
                        rCells[colIdx] ?? '',
                        onNavigateUuid,
                        onOpenExternalUrl
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 5. 블록 레벨 Raw HTML (예: <details>...</details>, <table>...</table>, <div ...>...</div> 등)
    const htmlBlockStart = isRawHtmlBlockStart(line);
    if (htmlBlockStart) {
      const blockStart = i;
      if (htmlBlockStart.selfClosing) {
        elements.push(
          <div
            key={`html-blk-${blockStart}`}
            className="md-raw-html-block"
            data-source-line={blockStart}
            data-source-line-end={blockStart}
            dangerouslySetInnerHTML={{ __html: line }}
          />
        );
        i++;
        continue;
      }

      const closeRegex = new RegExp(`</${htmlBlockStart.tag}>`, 'i');
      const htmlLines: string[] = [line];
      i++;
      while (i < lines.length) {
        htmlLines.push(lines[i]);
        if (closeRegex.test(lines[i])) {
          i++;
          break;
        }
        i++;
      }
      const blockEnd = Math.max(blockStart, i - 1);
      elements.push(
        <div
          key={`html-blk-${blockStart}`}
          className="md-raw-html-block"
          data-source-line={blockStart}
          data-source-line-end={blockEnd}
          dangerouslySetInnerHTML={{ __html: htmlLines.join('\n') }}
        />
      );
      continue;
    }

    // 6. ATX 헤딩 (# ~ ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInlineMarkdown(
        headingMatch[2],
        onNavigateUuid,
        onOpenExternalUrl
      );
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      elements.push(
        <Tag key={`h-${i}`} data-source-line={i} data-source-line-end={i}>
          {content}
        </Tag>
      );
      i++;
      continue;
    }

    // 7. 인용구 (> Blockquote)
    if (trimmed.startsWith('>')) {
      const quoteStart = i;
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const quoteEnd = Math.max(quoteStart, i - 1);
      elements.push(
        <blockquote
          key={`bq-${quoteStart}`}
          className="md-blockquote"
          data-source-line={quoteStart}
          data-source-line-end={quoteEnd}
        >
          {quoteLines.map((qLine, qIdx) => (
            <p key={qIdx}>
              {renderInlineMarkdown(qLine, onNavigateUuid, onOpenExternalUrl)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 8. myLore 확장 서브미션 체크박스 (- [!], - [/], - [ ], - [-], - [x])
    const taskMatch = line.match(/^\s*[-*+]\s+\[([!>/ \-xX])\]\s+(.*)$/);
    if (taskMatch) {
      const lineIdx = i;
      const rawCode = taskMatch[1];
      const text = taskMatch[2];
      const normCode: TaskPriorityCode =
        rawCode === '!' || rawCode === '>'
          ? '!'
          : rawCode === '/'
            ? '/'
            : rawCode === '-'
              ? '-'
              : rawCode === 'x' || rawCode === 'X'
                ? 'x'
                : ' ';
      const rowClass =
        normCode === '!'
          ? 'priority-urgent'
          : normCode === '/'
            ? 'priority-doing'
            : normCode === 'x'
              ? 'priority-done'
              : '';
      elements.push(
        <div
          key={`task-${lineIdx}`}
          className={`rendered-task-row ${rowClass}`}
          data-source-line={lineIdx}
          data-source-line-end={lineIdx}
        >
          <select
            className="task-status-select"
            value={normCode}
            onChange={(e) =>
              onUpdateTaskStatus(lineIdx, e.target.value as TaskPriorityCode)
            }
          >
            <option value="!">[!] 핵심/내일할일</option>
            <option value="/">[/] 진행중</option>
            <option value=" ">[ ] 대기</option>
            <option value="-">[-] 보류</option>
            <option value="x">[x] 완료</option>
          </select>
          <span
            style={{
              flex: 1,
              textDecoration: normCode === 'x' ? 'line-through' : 'none',
            }}
          >
            {renderInlineMarkdown(text, onNavigateUuid, onOpenExternalUrl)}
          </span>
        </div>
      );
      i++;
      continue;
    }

    // 9. 일반 순서 없는 목록 (- , * , + )
    if (/^\s*[-*+]\s+/.test(line)) {
      const listStart = i;
      const items: { idx: number; text: string; indent: number }[] = [];
      while (
        i < lines.length &&
        /^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*[-*+]\s+\[([!>/ \-xX])\]\s+/.test(lines[i]) &&
        !isHorizontalRuleLine(lines[i])
      ) {
        const m = lines[i].match(/^(\s*)[-*+]\s+(.*)$/);
        if (m) {
          items.push({
            idx: i,
            indent: Math.floor(m[1].length / 2),
            text: m[2],
          });
        }
        i++;
      }
      const listEnd = Math.max(listStart, i - 1);
      elements.push(
        <ul
          key={`ul-${listStart}`}
          className="md-list"
          data-source-line={listStart}
          data-source-line-end={listEnd}
        >
          {items.map((it) => {
            const isImgMeta = it.text.startsWith('🖼️ **[연결된 이미지 정보]**');
            const isVidMeta = it.text.startsWith('🎬 **[연결된 동영상 정보]**');
            const mediaFileMatch = it.text.match(
              /`([^`]+\.(?:jpg|jpeg|png|gif|webp|bmp|mp4|mov|webm|mkv|avi|m4v|3gp))`/i
            );
            const mediaFileName = mediaFileMatch ? mediaFileMatch[1].trim() : '';

            const audioOffsetSec =
              enableAudioTimestampSync || inScriptSection
                ? parseAudioOffsetSecondsFromLine(it.text)
                : null;
            const isAudioCue = audioOffsetSec !== null && Boolean(onSeekAudioTime);
            const isActiveAudioCue =
              isAudioCue && activeAudioLineIndex === it.idx;

            return (
              <li
                key={`li-${it.idx}`}
                data-source-line={it.idx}
                data-source-line-end={it.idx}
                data-audio-line={isAudioCue ? it.idx : undefined}
                data-audio-active={isActiveAudioCue ? 'true' : undefined}
                className={
                  isAudioCue
                    ? `md-audio-cue-line ${isActiveAudioCue ? 'active' : ''}`
                    : undefined
                }
                onClick={
                  isAudioCue && onSeekAudioTime && audioOffsetSec !== null
                    ? () => onSeekAudioTime(audioOffsetSec, it.idx)
                    : undefined
                }
                title={
                  isAudioCue
                    ? '클릭하여 이 문장 위치부터 음성 재생'
                    : undefined
                }
                style={{
                  marginLeft: `${it.indent * 16}px`,
                  listStyleType: isImgMeta || isVidMeta ? 'none' : undefined,
                }}
              >
                {isImgMeta || isVidMeta ? (
                  <div
                    style={{
                      margin: '4px 0 8px 0',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: isImgMeta
                        ? 'rgba(56, 189, 248, 0.08)'
                        : 'rgba(168, 85, 247, 0.09)',
                      border: isImgMeta
                        ? '1px solid rgba(56, 189, 248, 0.28)'
                        : '1px solid rgba(168, 85, 247, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      maxWidth: '520px',
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', lineHeight: 1.4 }}>
                      {renderInlineMarkdown(
                        it.text,
                        onNavigateUuid,
                        onOpenExternalUrl
                      )}
                    </div>
                    {isImgMeta && mediaFileName && (
                      <img
                        src={`http://127.0.0.1:18443/api/v1/local-media?sub=kakao&file=${encodeURIComponent(mediaFileName)}`}
                        alt={mediaFileName}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '280px',
                          borderRadius: '6px',
                          objectFit: 'contain',
                          alignSelf: 'flex-start',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            'none';
                        }}
                      />
                    )}
                    {isVidMeta && mediaFileName && (
                      <video
                        controls
                        preload="metadata"
                        src={`http://127.0.0.1:18443/api/v1/local-media?sub=kakao&file=${encodeURIComponent(mediaFileName)}`}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '280px',
                          borderRadius: '6px',
                        }}
                        onError={(e) => {
                          (e.currentTarget as HTMLVideoElement).style.display =
                            'none';
                        }}
                      />
                    )}
                  </div>
                ) : (
                  renderInlineMarkdown(
                    it.text,
                    onNavigateUuid,
                    onOpenExternalUrl
                  )
                )}
              </li>
            );
          })}
        </ul>
      );
      continue;
    }

    // 10. 순서 있는 목록 (1. , 2. )
    if (/^\s*\d+\.\s+/.test(line)) {
      const listStart = i;
      const items: { idx: number; text: string; indent: number }[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
        if (m) {
          items.push({
            idx: i,
            indent: Math.floor(m[1].length / 2),
            text: m[2],
          });
        }
        i++;
      }
      const listEnd = Math.max(listStart, i - 1);
      elements.push(
        <ol
          key={`ol-${listStart}`}
          className="md-list md-ordered-list"
          data-source-line={listStart}
          data-source-line-end={listEnd}
        >
          {items.map((it) => (
            <li
              key={`oli-${it.idx}`}
              style={{ marginLeft: `${it.indent * 16}px` }}
            >
              {renderInlineMarkdown(it.text, onNavigateUuid, onOpenExternalUrl)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // 11. Setext 스타일 헤딩 (다음 줄이 === 또는 --- 인 경우, 단 현재 줄이 일반 텍스트일 때)
    if (
      i + 1 < lines.length &&
      lines[i + 1].trim().length >= 3 &&
      (/^=+$/.test(lines[i + 1].trim()) || /^-+$/.test(lines[i + 1].trim()))
    ) {
      const isH1 = lines[i + 1].trim().startsWith('=');
      const content = renderInlineMarkdown(
        line,
        onNavigateUuid,
        onOpenExternalUrl
      );
      elements.push(
        isH1 ? (
          <h1
            key={`sh1-${i}`}
            data-source-line={i}
            data-source-line-end={i + 1}
          >
            {content}
          </h1>
        ) : (
          <h2
            key={`sh2-${i}`}
            data-source-line={i}
            data-source-line-end={i + 1}
          >
            {content}
          </h2>
        )
      );
      i += 2;
      continue;
    }

    // 12. 일반 문단
    const pAudioOffset =
      enableAudioTimestampSync || inScriptSection
        ? parseAudioOffsetSecondsFromLine(line)
        : null;
    const isPAudioCue = pAudioOffset !== null && Boolean(onSeekAudioTime);
    const isPActiveCue = isPAudioCue && activeAudioLineIndex === i;
    const pLineIdx = i;
    elements.push(
      <p
        key={`p-${pLineIdx}`}
        data-source-line={pLineIdx}
        data-source-line-end={pLineIdx}
        data-audio-line={isPAudioCue ? pLineIdx : undefined}
        data-audio-active={isPActiveCue ? 'true' : undefined}
        className={
          isPAudioCue
            ? `md-audio-cue-line ${isPActiveCue ? 'active' : ''}`
            : undefined
        }
        onClick={
          isPAudioCue && onSeekAudioTime && pAudioOffset !== null
            ? () => onSeekAudioTime(pAudioOffset, pLineIdx)
            : undefined
        }
        title={isPAudioCue ? '클릭하여 이 문장 위치부터 음성 재생' : undefined}
      >
        {renderInlineMarkdown(line, onNavigateUuid, onOpenExternalUrl)}
      </p>
    );
    i++;
  }

  return <>{elements}</>;
};

/**
 * 원본 마크다운 에디터의 상단 줄 번호(topLine) 및 스크롤 비율(scrollRatio)에 맞추어
 * 뷰어 컨테이너(병렬 뷰어 또는 전용 독립 뷰어)의 스크롤 위치를 선형 보간으로 정밀 동기화합니다.
 */
export function scrollPreviewPaneToSourceLine(
  container: HTMLElement | null,
  topLine: number,
  scrollRatio: number
): void {
  if (!container) return;
  const maxScroll = Math.max(
    0,
    container.scrollHeight - container.clientHeight
  );
  if (maxScroll <= 0) return;

  if (scrollRatio <= 0.005) {
    container.scrollTop = 0;
    return;
  }
  if (scrollRatio >= 0.995) {
    container.scrollTop = maxScroll;
    return;
  }

  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>('[data-source-line]')
  );
  if (blocks.length === 0) {
    container.scrollTop = scrollRatio * maxScroll;
    return;
  }

  const containerRectTop = container.getBoundingClientRect().top;
  const getRelTop = (el: HTMLElement): number =>
    el.getBoundingClientRect().top - containerRectTop + container.scrollTop;

  let prevEl: HTMLElement | null = null;
  let prevStart = 0;
  let prevEnd = 0;
  let nextEl: HTMLElement | null = null;
  let nextStart = 0;

  for (const el of blocks) {
    const s = Number(el.getAttribute('data-source-line') || '0');
    const e = Number(el.getAttribute('data-source-line-end') || String(s));
    if (s <= topLine) {
      prevEl = el;
      prevStart = s;
      prevEnd = e;
    } else {
      nextEl = el;
      nextStart = s;
      break;
    }
  }

  if (!prevEl) {
    container.scrollTop = scrollRatio * maxScroll;
    return;
  }

  const prevTop = getRelTop(prevEl);
  if (!nextEl) {
    // 마지막 블록 이후 영역 보간
    const span = Math.max(1, prevEnd - prevStart + 1);
    const localFrac = Math.min(1, Math.max(0, (topLine - prevStart) / span));
    const target = prevTop + localFrac * prevEl.offsetHeight;
    container.scrollTop = Math.min(maxScroll, Math.max(0, target - 16));
    return;
  }

  const nextTop = getRelTop(nextEl);
  const lineSpan = Math.max(1, nextStart - prevStart);
  const frac = Math.min(1, Math.max(0, (topLine - prevStart) / lineSpan));
  const interpolatedTop = prevTop + frac * (nextTop - prevTop);
  container.scrollTop = Math.min(maxScroll, Math.max(0, interpolatedTop - 16));
}
