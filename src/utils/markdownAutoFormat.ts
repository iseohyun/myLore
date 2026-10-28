import { ParsedTaskItem, TaskPriorityCode, TocHeading } from '../types/mylore';

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
  { colorId: string; colorHex: string; desc: string }
> = {
  개발: { colorId: '11', colorHex: '#dc2626', desc: '개발내역, 일' },
  이벤트: { colorId: '6', colorHex: '#ea580c', desc: '루틴에 없는 외부 사건' },
  수영: { colorId: '10', colorHex: '#16a34a', desc: '그날 훈련 내용' },
  기록: {
    colorId: '7',
    colorHex: '#0891b2',
    desc: '메일, 카톡, 통화, 정보, 구매내역, 영수증',
  },
  식단: { colorId: '9', colorHex: '#2563eb', desc: '그날 먹은 음식' },
  일상: {
    colorId: '3',
    colorHex: '#9333ea',
    desc: '루틴에 없는 내부 사건, 청소, 학습, 연주',
  },
  알림: {
    colorId: '1',
    colorHex: '#7c3aed',
    desc: '달력에 표시하기 위해 일부러 표시할 때',
  },
};
