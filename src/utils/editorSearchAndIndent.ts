/**
 * @file editorSearchAndIndent.ts
 * @description 에디터 줄 들여쓰기/내어쓰기(`Tab`/`Shift+Tab`) 및 정규식·이스케이프 패턴 찾기/바꾸기 순수 계산 유틸리티.
 */

export interface DocFindMatchItem {
  start: number;
  end: number;
  lineNumber: number;
  lineText: string;
}

/**
 * 바꾸기 패턴 문자열에서 이스케이프(`\n`, `\t`, `\r`, `\\`) 및 정규식 캡처 그룹(`\1`~`\9`, `$0`)을 JS `.replace` 규격으로 변환합니다.
 */
export function unescapeReplacePattern(
  rawReplace: string,
  useRegex: boolean,
  useEscape: boolean
): string {
  let out = '';
  for (let i = 0; i < rawReplace.length; i++) {
    const ch = rawReplace[i];
    if (ch === '\\' && i + 1 < rawReplace.length) {
      const next = rawReplace[i + 1];
      if (useEscape && next === 'n') {
        out += '\n';
        i++;
        continue;
      }
      if (useEscape && next === 't') {
        out += '\t';
        i++;
        continue;
      }
      if (useEscape && next === 'r') {
        out += '\r';
        i++;
        continue;
      }
      if (useRegex && next >= '0' && next <= '9') {
        out += next === '0' ? '$&' : `$${next}`;
        i++;
        continue;
      }
      if (useEscape && next === '\\') {
        out += '\\';
        i++;
        continue;
      }
    }
    if (
      useRegex &&
      ch === '$' &&
      i + 1 < rawReplace.length &&
      rawReplace[i + 1] === '0'
    ) {
      out += '$&';
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 정규식 캡처 그룹(`$1`, `$2`, `$&`, `\1`, `\2`, `${1}`) 및 이스케이프 문자(`\n`, `\t`)를 적용한 바꾸기 결과를 반환합니다.
 */
export function applyPatternReplace(
  sourceText: string,
  findQuery: string,
  rawReplace: string,
  useRegex: boolean,
  useEscape: boolean,
  replaceAll: boolean = true
): string {
  if (!findQuery) return sourceText;
  try {
    const pattern = useRegex
      ? findQuery
      : findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = replaceAll ? 'gi' : 'i';
    const re = new RegExp(pattern, flags);
    const formatted = unescapeReplacePattern(rawReplace, useRegex, useEscape);
    if (useRegex) {
      const jsNormalized = formatted.replace(/\$\{(\d+)\}/g, (_, d) =>
        d === '0' ? '$&' : `$${d}`
      );
      return sourceText.replace(re, jsNormalized);
    }
    return sourceText.replace(re, () => formatted);
  } catch {
    return sourceText;
  }
}

/**
 * 본문 텍스트에서 검색어(일반 또는 정규식)와 일치하는 모든 위치 목록을 반환합니다.
 */
export function findMatchesInDocumentBody(
  bodyText: string,
  query: string,
  useRegex: boolean
): DocFindMatchItem[] {
  if (!query) return [];
  const results: DocFindMatchItem[] = [];
  try {
    const pattern = useRegex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(pattern, 'gi');
    const lines = bodyText.split('\n');
    let runningOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        results.push({
          start: runningOffset + m.index,
          end: runningOffset + m.index + m[0].length,
          lineNumber: i + 1,
          lineText: line.trim().slice(0, 120),
        });
        if (results.length >= 250) return results;
      }
      runningOffset += line.length + 1;
    }
  } catch {
    // 타이핑 중 불완전한 정규식 무시
  }
  return results;
}

/**
 * Tab / Shift+Tab 줄 맨 앞 공백 추가·삭제 및 커서/선택 영역 보정 계산
 */
export function computeIndentOrOutdent(
  text: string,
  selStart: number,
  selEnd: number,
  mode: 'indent' | 'outdent',
  indentSpaces: number = 2
): {
  nextText: string;
  nextStart: number;
  nextEnd: number;
  modifiedLines: number;
} {
  const spacesCount = Math.max(1, Math.min(16, indentSpaces || 2));
  const pad = ' '.repeat(spacesCount);
  const lines = text.split('\n');

  let running = 0;
  let startLineIdx = 0;
  let startLineOffset = 0;
  let endLineIdx = lines.length - 1;

  for (let i = 0; i < lines.length; i++) {
    const lineEnd = running + lines[i].length;
    if (selStart >= running && selStart <= lineEnd) {
      startLineIdx = i;
      startLineOffset = running;
      break;
    }
    running = lineEnd + 1;
  }

  running = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = running + lines[i].length;
    if (selEnd >= running && selEnd <= lineEnd) {
      // 다중 줄 선택 시 끝 커서가 줄의 맨 앞(0열)에 걸쳐 있으면 직전 줄까지만 대상에 포함
      if (selEnd > selStart && selEnd === running && i > startLineIdx) {
        endLineIdx = i - 1;
      } else {
        endLineIdx = i;
      }
      break;
    }
    running = lineEnd + 1;
  }

  if (mode === 'indent') {
    let modifiedLines = 0;
    for (let i = startLineIdx; i <= endLineIdx; i++) {
      lines[i] = pad + lines[i];
      modifiedLines++;
    }
    return {
      nextText: lines.join('\n'),
      nextStart: selStart + pad.length,
      nextEnd: selEnd + modifiedLines * pad.length,
      modifiedLines,
    };
  }

  // mode === 'outdent' (Shift+Tab: 현재 줄 맨 앞에서 최대 indentSpaces개의 띄어쓰기 삭제, 없으면 생략)
  let modifiedLines = 0;
  let firstLineRemoved = 0;
  let totalRemoved = 0;
  const startCol = Math.max(0, selStart - startLineOffset);

  for (let i = startLineIdx; i <= endLineIdx; i++) {
    const line = lines[i];
    let removeLen = 0;
    if (line.startsWith('\t')) {
      removeLen = 1;
    } else {
      while (removeLen < spacesCount && line[removeLen] === ' ') {
        removeLen++;
      }
    }
    if (removeLen > 0) {
      lines[i] = line.slice(removeLen);
      modifiedLines++;
      totalRemoved += removeLen;
      if (i === startLineIdx) {
        firstLineRemoved = Math.min(removeLen, startCol);
      }
    }
  }

  if (modifiedLines === 0) {
    return {
      nextText: text,
      nextStart: selStart,
      nextEnd: selEnd,
      modifiedLines: 0,
    };
  }

  const nextStart = Math.max(0, selStart - firstLineRemoved);
  const nextEnd =
    selStart === selEnd
      ? nextStart
      : Math.max(nextStart, selEnd - totalRemoved);

  return {
    nextText: lines.join('\n'),
    nextStart,
    nextEnd,
    modifiedLines,
  };
}
