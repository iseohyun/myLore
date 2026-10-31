/**
 * @file markdownAutoFormat.ts
 * @description 마크다운 YAML Frontmatter 분리/결합, 할 일(Task) 우선순위 자동 정렬, 헤딩 목차(TOC) 추출 및 구글 캘린더 색상 맵.
 */
import {
  DocumentPayload,
  FileNode,
  ParsedTaskItem,
  TaskPriorityCode,
  TocHeading,
} from '../types/mylore';

export interface SplitMarkdownResult {
  hasYaml: boolean;
  yamlRaw: string;
  frontmatter: Record<string, string>;
  body: string;
}

/**
 * 마크다운 원문에서 최상단 YAML Frontmatter와 본문(Body)을 분리합니다.
 * 뷰어/에디터에서 YAML을 기본 숨김 처리하고 단축키(Ctrl + ;)로만 편집할 수 있게 지원합니다.
 */
export function splitYamlFrontmatter(raw: string): SplitMarkdownResult {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return {
      hasYaml: false,
      yamlRaw: '',
      frontmatter: {},
      body: normalized,
    };
  }

  const closingIdx = normalized.indexOf('\n---\n', 4);
  const closingEndIdx =
    closingIdx !== -1
      ? closingIdx
      : normalized.endsWith('\n---')
        ? normalized.length - 4
        : -1;

  if (closingEndIdx === -1) {
    return {
      hasYaml: false,
      yamlRaw: '',
      frontmatter: {},
      body: normalized,
    };
  }

  const yamlRaw = normalized.slice(4, closingEndIdx);
  const afterClosing =
    closingIdx !== -1 ? normalized.slice(closingIdx + 5) : '';

  const frontmatter: Record<string, string> = {};
  for (const line of yamlRaw.split('\n')) {
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^"(.*)"$/, '$1');
      frontmatter[key] = val;
    }
  }

  return {
    hasYaml: true,
    yamlRaw,
    frontmatter,
    body: afterClosing,
  };
}

/**
 * 분리된 YAML 원문과 본문(Body)을 다시 하나의 마크다운 문자열로 병합합니다.
 */
export function combineYamlAndBody(yamlRaw: string, body: string): string {
  const cleanYaml = yamlRaw.trim();
  if (!cleanYaml) {
    return body;
  }
  return `---\n${cleanYaml}\n---\n${body}`;
}

/**
 * 우선순위 가중치:
 * [!] 또는 [>] (오늘/내일 핵심 과제) = 1
 * [/] (진행중) = 2
 * [ ] (일반 대기) = 3
 * [-] (보류/관심 낮음) = 4
 * [x] 또는 [X] (완료) = 5
 */
function getTaskPriorityWeight(code: string): number {
  switch (code) {
    case '!':
    case '>':
      return 1;
    case '/':
      return 2;
    case ' ':
      return 3;
    case '-':
      return 4;
    case 'x':
    case 'X':
      return 5;
    default:
      return 3;
  }
}

export function normalizeTaskCode(code: string): TaskPriorityCode {
  if (code === '!' || code === '>') return '!';
  if (code === '/') return '/';
  if (code === '-') return '-';
  if (code === 'x' || code === 'X') return 'x';
  return ' ';
}

/**
 * 마크다운 본문 내 체크리스트 블록들을 찾아 관심도 순([!] -> [/] -> [ ] -> [-] -> [x])으로
 * 상하단 자동 재배치(Auto-Format)합니다. 하위 들여쓰기 줄(서브 노트)도 부모 항목과 함께 이동합니다.
 */
export function autoFormatMarkdownTasks(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];

  interface TaskBlock {
    weight: number;
    originalOrder: number;
    lines: string[];
  }

  let currentBlocks: TaskBlock[] = [];

  const flushTaskBlocks = () => {
    if (currentBlocks.length === 0) return;
    currentBlocks.sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      return a.originalOrder - b.originalOrder;
    });
    for (const block of currentBlocks) {
      result.push(...block.lines);
    }
    currentBlocks = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const taskMatch = line.match(/^(\s*[-*]\s+\[([!>/ \-xX])\]\s+.*)$/);

    if (taskMatch) {
      const topIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      const markerChar = taskMatch[2];
      const blockLines = [line];
      i++;

      // 하위 들여쓰기된 설명이나 서브 리스트는 부모 과제와 한 덩어리로 묶어 이동
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine.trim() === '') break;
        const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
        const isSameLevelTask =
          nextIndent <= topIndent &&
          /^(\s*[-*]\s+\[([!>/ \-xX])\]\s+.*)$/.test(nextLine);
        const isHeaderOrRule = /^(#{1,6}\s+|---+$)/.test(nextLine.trim());

        if (isSameLevelTask || isHeaderOrRule || nextIndent <= topIndent) {
          break;
        }
        blockLines.push(nextLine);
        i++;
      }

      currentBlocks.push({
        weight: getTaskPriorityWeight(markerChar),
        originalOrder: currentBlocks.length,
        lines: blockLines,
      });
    } else {
      flushTaskBlocks();
      result.push(line);
      i++;
    }
  }

  flushTaskBlocks();
  return result.join('\n');
}

function splitMdTableCellsSimple(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isMdTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = splitMdTableCellsSimple(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

/**
 * 서브미션 상세 문서({submission}.md)의 마크다운 원문에서 총 과제 수(total)와 완료 과제 수(done)를 집계합니다.
 * - 표 형식(|task ID|진행 사항|이름|내용|개선내용| 등): 데이터 행 수를 total로,
 *   `진행 사항` 컬럼에 완료 시각(YYYY-MM-DD...) 또는 완료 표시가 기입된 행 수를 done으로 집계합니다.
 * - 표가 없는 경우 체크박스(- [ ], - [x]) 목록을 집계합니다.
 */
export function countSubmissionDocProgress(rawContent: string): {
  total: number;
  done: number;
} {
  const { body } = splitYamlFrontmatter(rawContent);
  const lines = body.replace(/\r\n/g, '\n').split('\n');

  let tableTotal = 0;
  let tableDone = 0;

  let i = 0;
  while (i < lines.length) {
    if (
      lines[i].includes('|') &&
      i + 1 < lines.length &&
      isMdTableDelimiterLine(lines[i + 1])
    ) {
      const headers = splitMdTableCellsSimple(lines[i]).map((h) =>
        h.toLowerCase().replace(/\s+/g, '')
      );
      const statusColIdx = headers.findIndex(
        (h) =>
          h.includes('진행사항') ||
          h.includes('진행상태') ||
          h.includes('상태') ||
          h === 'status' ||
          h.includes('완료')
      );
      i += 2;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        lines[i].includes('|') &&
        !isMdTableDelimiterLine(lines[i])
      ) {
        const rowCells = splitMdTableCellsSimple(lines[i]);
        const isNonEmptyRow = rowCells.some((c) => c.trim() !== '');
        if (isNonEmptyRow) {
          tableTotal += 1;
          if (statusColIdx >= 0 && statusColIdx < rowCells.length) {
            const st = rowCells[statusColIdx].trim();
            const isTimestampDone = /\d{4}-\d{2}-\d{2}/.test(st);
            const isExplicitDone =
              /^(완료|100%|done|\[x\]|x)$/i.test(st) &&
              !st.includes('대기') &&
              !st.includes('수정중');
            if (isTimestampDone || isExplicitDone) {
              tableDone += 1;
            }
          }
        }
        i++;
      }
      continue;
    }
    i++;
  }

  if (tableTotal > 0) {
    return { total: tableTotal, done: tableDone };
  }

  // 폴백: 마크다운 체크박스(- [!], - [/], - [ ], - [-], - [x]) 집계
  let checkTotal = 0;
  let checkDone = 0;
  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s+\[([!>/ \-xX])\]\s+/);
    if (m) {
      checkTotal += 1;
      if (m[1] === 'x' || m[1] === 'X') {
        checkDone += 1;
      }
    }
  }
  return { total: checkTotal, done: checkDone };
}

/**
 * 프로젝트 main.md(예: Projects/myLore/main.md)에서 `Alt+Shift+F` 자동정렬 수행 시
 * `|미션|진행율|비고|링크|` 표의 각 링크 문서를 조회하여 서브미션 총 개수·수행 개수를 세고
 * `진행율` 컬럼(`pct%(done/total)`)을 자동으로 갱신합니다.
 */
export async function syncProjectSubmissionTableProgress(
  body: string,
  currentDocFullPath: string,
  flattenedFiles: FileNode[],
  readDocByPath: (fullPath: string) => Promise<DocumentPayload>,
  readDocByUuid: (uuid: string) => Promise<DocumentPayload>
): Promise<{ nextBody: string; updatedCount: number }> {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let updatedCount = 0;

  const normCurrentPath = currentDocFullPath.replace(/\//g, '\\');
  const lastSlash = normCurrentPath.lastIndexOf('\\');
  const currentDir =
    lastSlash >= 0 ? normCurrentPath.slice(0, lastSlash) : '';

  let i = 0;
  while (i < lines.length) {
    if (
      lines[i].includes('|') &&
      i + 1 < lines.length &&
      isMdTableDelimiterLine(lines[i + 1])
    ) {
      const headerCells = splitMdTableCellsSimple(lines[i]);
      const normHeaders = headerCells.map((h) =>
        h.toLowerCase().replace(/\s+/g, '')
      );
      const progressIdx = normHeaders.findIndex(
        (h) => h.includes('진행율') || h.includes('진행률') || h === 'progress'
      );
      const linkIdx = normHeaders.findIndex(
        (h) => h.includes('링크') || h === 'link' || h.includes('문서')
      );

      if (progressIdx >= 0 && linkIdx >= 0) {
        // 구분선 행(| :--- |)의 컬럼 수가 헤더 컬럼 수보다 부족한 경우 헤더 수에 맞춰 보정
        const delimCells = splitMdTableCellsSimple(lines[i + 1]);
        if (delimCells.length < headerCells.length) {
          while (delimCells.length < headerCells.length) {
            delimCells.push(':---');
          }
          lines[i + 1] = `| ${delimCells.join(' | ')} |`;
        }

        i += 2;
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          lines[i].includes('|') &&
          !isMdTableDelimiterLine(lines[i]) &&
          !/^(-\s*){3,}$/.test(lines[i].trim())
        ) {
          const rowCells = splitMdTableCellsSimple(lines[i]);
          while (rowCells.length < headerCells.length) {
            rowCells.push('');
          }
          const linkCell = rowCells[linkIdx] || '';

          let targetDoc: DocumentPayload | null = null;
          const uuidMatch = linkCell.match(
            /mylore:\/\/doc\/([a-fA-F0-9-]{36})/i
          );
          if (uuidMatch) {
            try {
              targetDoc = await readDocByUuid(uuidMatch[1]);
            } catch {
              targetDoc = null;
            }
          }

          if (!targetDoc) {
            // [[문서명]] 또는 [문서명.md] 또는 [문서명] 추출
            const wikiMatch = linkCell.match(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/);
            const bracketMatch = linkCell.match(/\[([^\]]+)\]/);
            const rawTargetName = (
              wikiMatch?.[1] ||
              bracketMatch?.[1] ||
              ''
            ).trim();

            if (rawTargetName) {
              const fileNameWithExt = rawTargetName.toLowerCase().endsWith('.md')
                ? rawTargetName
                : `${rawTargetName}.md`;

              // 1순위: 현재 main.md와 동일한 프로젝트 폴더 내 파일 조회
              if (currentDir) {
                const candidateSiblingPath = `${currentDir}\\${fileNameWithExt}`;
                try {
                  targetDoc = await readDocByPath(candidateSiblingPath);
                } catch {
                  targetDoc = null;
                }
              }

              // 2순위: 전체 파일 트리(flattenedFiles)에서 파일명/제목 매칭
              if (!targetDoc && flattenedFiles.length > 0) {
                const lowerTarget = rawTargetName.toLowerCase();
                const lowerWithExt = fileNameWithExt.toLowerCase();
                const matchedNode =
                  flattenedFiles.find(
                    (f) =>
                      currentDir &&
                      f.fullPath
                        .replace(/\//g, '\\')
                        .toLowerCase() ===
                        `${currentDir}\\${lowerWithExt}`.toLowerCase()
                  ) ||
                  flattenedFiles.find(
                    (f) =>
                      f.name.toLowerCase() === lowerWithExt ||
                      (f.title && f.title.toLowerCase() === lowerTarget)
                  );
                if (matchedNode) {
                  try {
                    targetDoc = await readDocByPath(matchedNode.fullPath);
                  } catch {
                    targetDoc = null;
                  }
                }
              }
            }
          }

          if (targetDoc) {
            const { total, done } = countSubmissionDocProgress(
              targetDoc.bodyContent || targetDoc.rawContent
            );
            if (total > 0) {
              const pct = Math.round((done / total) * 100);
              const nextProgressStr = `${pct}%(${done}/${total})`;
              if (rowCells[progressIdx] !== nextProgressStr) {
                rowCells[progressIdx] = nextProgressStr;
              }
              updatedCount += 1;
            }
          }

          // 파이프(|) 누락 등 행 포맷 정규화
          lines[i] = `|${rowCells.join('|')}|`;
          i++;
        }
        continue;
      }
    }
    i++;
  }

  return { nextBody: lines.join('\n'), updatedCount };
}

/**
 * 마크다운 본문에서 서브 미션(과제) 목록을 추출합니다.
 */
export function extractTasksFromBody(body: string): ParsedTaskItem[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const tasks: ParsedTaskItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*[-*]\s+\[([!>/ \-xX])\]\s+(.*)$/);
    if (match) {
      const code = normalizeTaskCode(match[1]);
      const text = match[2].trim();
      const subLines: string[] = [];
      const topIndent = lines[i].match(/^(\s*)/)?.[1].length ?? 0;

      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (nextLine.trim() === '') break;
        const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (nextIndent <= topIndent) break;
        subLines.push(nextLine.trim());
        j++;
      }

      tasks.push({
        lineIndex: i,
        code,
        text,
        subLines,
      });
    }
  }

  return tasks;
}

/**
 * 특정 줄(lineIndex)의 과제 상태 기호를 변경합니다.
 */
export function updateTaskStatusInBody(
  body: string,
  lineIndex: number,
  nextCode: TaskPriorityCode
): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return body;

  lines[lineIndex] = lines[lineIndex].replace(
    /^(\s*[-*]\s+\[)[!>/ \-xX](\]\s+.*)$/,
    `$1${nextCode}$2`
  );
  return lines.join('\n');
}

/**
 * 우측 사이드바 '문서 내 목차 (TOC)' 표시를 위해 헤딩(# ~ ######)을 추출합니다.
 */
export function extractTocFromBody(body: string): TocHeading[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const headings: TocHeading[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        lineIndex: i,
      });
    }
  }

  return headings;
}

/**
 * 구글 캘린더 카테고리별 colorId 자동 매핑 (기존 OneDrive\Diary 템플릿 100% 호환)
 */
export const GOOGLE_CALENDAR_COLOR_MAP: Record<
  string,
  { colorId: string; colorHex: string; textColor: string; bgColor: string; desc: string }
> = {
  개발: {
    colorId: '11',
    colorHex: '#dc2626',
    textColor: '#fca5a5',
    bgColor: 'rgba(220, 38, 38, 0.22)',
    desc: '개발내역, 일',
  },
  이벤트: {
    colorId: '6',
    colorHex: '#ea580c',
    textColor: '#fdba74',
    bgColor: 'rgba(234, 88, 12, 0.22)',
    desc: '루틴에 없는 외부 사건',
  },
  수영: {
    colorId: '10',
    colorHex: '#16a34a',
    textColor: '#86efac',
    bgColor: 'rgba(22, 163, 74, 0.22)',
    desc: '그날 훈련 내용',
  },
  기록: {
    colorId: '7',
    colorHex: '#0891b2',
    textColor: '#67e8f9',
    bgColor: 'rgba(8, 145, 178, 0.22)',
    desc: '메일, 카톡, 통화, 정보, 구매내역, 영수증',
  },
  식단: {
    colorId: '9',
    colorHex: '#2563eb',
    textColor: '#93c5fd',
    bgColor: 'rgba(37, 99, 235, 0.22)',
    desc: '그날 먹은 음식',
  },
  일상: {
    colorId: '3',
    colorHex: '#9333ea',
    textColor: '#d8b4fe',
    bgColor: 'rgba(147, 51, 234, 0.22)',
    desc: '루틴에 없는 내부 사건, 청소, 학습, 연주',
  },
  알림: {
    colorId: '1',
    colorHex: '#7c3aed',
    textColor: '#c4b5fd',
    bgColor: 'rgba(124, 58, 237, 0.22)',
    desc: '달력에 표시하기 위해 일부러 표시할 때',
  },
};

export const EXTRA_COLOR_ID_PALETTE: Record<
  string,
  { label: string; colorHex: string; textColor: string; bgColor: string }
> = {
  '2': {
    label: '2민트',
    colorHex: '#10b981',
    textColor: '#6ee7b7',
    bgColor: 'rgba(16, 185, 129, 0.22)',
  },
  '4': {
    label: '4연분홍',
    colorHex: '#f472b6',
    textColor: '#fbcfe8',
    bgColor: 'rgba(244, 114, 182, 0.22)',
  },
  '5': {
    label: '5노랑',
    colorHex: '#eab308',
    textColor: '#fde047',
    bgColor: 'rgba(234, 179, 8, 0.22)',
  },
  '8': {
    label: '8회색',
    colorHex: '#64748b',
    textColor: '#cbd5e1',
    bgColor: 'rgba(100, 116, 139, 0.25)',
  },
};

export const GOOGLE_CALENDAR_COLOR_ID_OPTIONS: Array<{
  colorId: string;
  label: string;
  category: string;
  colorHex: string;
  textColor: string;
  bgColor: string;
}> = [
  { colorId: '11', label: '11빨강(개발)', category: '개발', colorHex: '#dc2626', textColor: '#fca5a5', bgColor: 'rgba(220, 38, 38, 0.22)' },
  { colorId: '6', label: '6주황(이벤트)', category: '이벤트', colorHex: '#ea580c', textColor: '#fdba74', bgColor: 'rgba(234, 88, 12, 0.22)' },
  { colorId: '10', label: '10초록(수영)', category: '수영', colorHex: '#16a34a', textColor: '#86efac', bgColor: 'rgba(22, 163, 74, 0.22)' },
  { colorId: '7', label: '7청록(기록)', category: '기록', colorHex: '#0891b2', textColor: '#67e8f9', bgColor: 'rgba(8, 145, 178, 0.22)' },
  { colorId: '9', label: '9파랑(식단)', category: '식단', colorHex: '#2563eb', textColor: '#93c5fd', bgColor: 'rgba(37, 99, 235, 0.22)' },
  { colorId: '3', label: '3자주(일상)', category: '일상', colorHex: '#9333ea', textColor: '#d8b4fe', bgColor: 'rgba(147, 51, 234, 0.22)' },
  { colorId: '1', label: '1연보라(알림)', category: '알림', colorHex: '#7c3aed', textColor: '#c4b5fd', bgColor: 'rgba(124, 58, 237, 0.22)' },
  { colorId: '2', label: '2민트', category: '기타', colorHex: '#10b981', textColor: '#6ee7b7', bgColor: 'rgba(16, 185, 129, 0.22)' },
  { colorId: '4', label: '4연분홍', category: '기타', colorHex: '#f472b6', textColor: '#fbcfe8', bgColor: 'rgba(244, 114, 182, 0.22)' },
  { colorId: '5', label: '5노랑', category: '기타', colorHex: '#eab308', textColor: '#fde047', bgColor: 'rgba(234, 179, 8, 0.22)' },
  { colorId: '8', label: '8회색', category: '기타', colorHex: '#64748b', textColor: '#cbd5e1', bgColor: 'rgba(100, 116, 139, 0.25)' },
];

/**
 * 일기 템플릿(`Google Calendar Template.md` / `Google Calendar Template.origin.md`)에서 지정한
 * 11개 `colorId`(["11빨강(개발)","6주황(이벤트)","10초록(수영)","7청록(기록)","9파랑(식단)","3자주(일상)","1연보라(알림)","2민트","4연분홍","5노랑","8회색"])
 * 및 `calendar` 카테고리를 기준으로 달력 배지 색상을 반환합니다.
 */
export function getDiaryScheduleColorStyle(calendarCategory?: string): {
  backgroundColor: string;
  color: string;
  borderLeft: string;
} {
  const key = (calendarCategory || '8').trim();
  const byCategory =
    Object.values(GOOGLE_CALENDAR_COLOR_MAP).find((v) => v.colorId === key) ||
    GOOGLE_CALENDAR_COLOR_MAP[key];

  if (byCategory) {
    return {
      backgroundColor: byCategory.bgColor,
      color: byCategory.textColor,
      borderLeft: `3px solid ${byCategory.colorHex}`,
    };
  }

  const extra = EXTRA_COLOR_ID_PALETTE[key];
  if (extra) {
    return {
      backgroundColor: extra.bgColor,
      color: extra.textColor,
      borderLeft: `3px solid ${extra.colorHex}`,
    };
  }

  const def = EXTRA_COLOR_ID_PALETTE['8'];
  return {
    backgroundColor: def.bgColor,
    color: def.textColor,
    borderLeft: `3px solid ${def.colorHex}`,
  };
}
