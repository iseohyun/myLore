/**
 * @file appearancePresets.ts
 * @description 글꼴 프리셋(FONT_FAMILY_PRESETS), 5종 색상 테마 프리셋(THEME_PRESETS),
 * 기본 앱 설정(DEFAULT_APP_SETTINGS) 및 DOM CSS 변수 반영 헬퍼(applyAppSettingsToDocument).
 * (관련 컴포넌트: SettingsAppearanceSection.tsx, DetachedPreviewWindowView.tsx, useDetachedPreviewAndSettings.ts)
 */
import { MyLoreAppSettings, ThemePresetId } from '../types/mylore';

export const FONT_FAMILY_PRESETS: Array<{ label: string; value: string }> = [
  {
    label: 'Pretendard (기본 프리텐다드)',
    value:
      "'Pretendard', 'Malgun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    label: '맑은 고딕 (Malgun Gothic)',
    value: "'Malgun Gothic', '맑은 고딕', sans-serif",
  },
  {
    label: '나눔고딕 (NanumGothic)',
    value: "'NanumGothic', '나눔고딕', 'Malgun Gothic', sans-serif",
  },
  {
    label: '나눔명조 (NanumMyeongjo — 서적/명조풍)',
    value: "'NanumMyeongjo', '나눔명조', 'Batang', serif",
  },
  {
    label: '나눔스퀘어네오 (NanumSquareNeo)',
    value: "'NanumSquareNeo', '나눔스퀘어 네오', 'Malgun Gothic', sans-serif",
  },
  {
    label: '고운돋움 (Gowun Dodum)',
    value: "'Gowun Dodum', '고운돋움', 'Malgun Gothic', sans-serif",
  },
  {
    label: '리디바탕 (RIDIBatang — 이북/바탕체)',
    value: "'RIDIBatang', '리디바탕', 'Batang', serif",
  },
  {
    label: '바탕체 (Batang — 정통 세리프)',
    value: "'Batang', '바탕', Georgia, serif",
  },
  {
    label: 'D2Coding (개발/표 고정폭)',
    value: "'D2Coding', 'Consolas', monospace",
  },
  {
    label: 'JetBrains Mono / Cascadia Code (고정폭)',
    value: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  },
];

export const THEME_PRESETS: Record<
  Exclude<ThemePresetId, 'custom'>,
  {
    name: string;
    desc: string;
    bgPrimary: string;
    bgSecondary: string;
    textPrimary: string;
    textSecondary: string;
    headingColor: string;
    accentPrimary: string;
    tableHeaderBg: string;
    tableHeaderColor: string;
    borderColor: string;
  }
> = {
  dark_indigo: {
    name: '🌙 다크 인디고 (기본)',
    desc: '깊은 다크 네이비 배경과 인디고/보라 포인트 테마',
    bgPrimary: '#0f1117',
    bgSecondary: '#161922',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    headingColor: '#a5b4fc',
    accentPrimary: '#6366f1',
    tableHeaderBg: '#1e2230',
    tableHeaderColor: '#a5b4fc',
    borderColor: '#2b3040',
  },
  light_clean: {
    name: '☀️ 화이트 클린 (라이트)',
    desc: '밝고 선명한 문서 작업용 화이트/블루 라이트 테마',
    bgPrimary: '#ffffff',
    bgSecondary: '#f8fafc',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    headingColor: '#1d4ed8',
    accentPrimary: '#2563eb',
    tableHeaderBg: '#f1f5f9',
    tableHeaderColor: '#1e3a8a',
    borderColor: '#cbd5e1',
  },
  nord_slate: {
    name: '❄️ 노드 슬레이트 (눈 보호 다크)',
    desc: '대비를 낮춘 북유럽풍 차분한 블루그레이 다크 테마',
    bgPrimary: '#242933',
    bgSecondary: '#2e3440',
    textPrimary: '#eceff4',
    textSecondary: '#d8dee9',
    headingColor: '#88c0d0',
    accentPrimary: '#5e81ac',
    tableHeaderBg: '#3b4252',
    tableHeaderColor: '#88c0d0',
    borderColor: '#434c5e',
  },
  sepia_warm: {
    name: '📜 세피아 독서 (웜 라이트)',
    desc: '장시간 일기·집필에 적합한 따뜻한 미색 종이 질감 테마',
    bgPrimary: '#fbf7f0',
    bgSecondary: '#f3ece0',
    textPrimary: '#2c221e',
    textSecondary: '#6e5a4f',
    headingColor: '#8c3b1b',
    accentPrimary: '#b45309',
    tableHeaderBg: '#eaddc7',
    tableHeaderColor: '#78350f',
    borderColor: '#d6c7b2',
  },
  emerald_forest: {
    name: '🌲 에메랄드 포레스트 (다크)',
    desc: '차분한 딥 그린 & 민트 액센트 테마',
    bgPrimary: '#0b1512',
    bgSecondary: '#11221d',
    textPrimary: '#ecfdf5',
    textSecondary: '#86efac',
    headingColor: '#34d399',
    accentPrimary: '#10b981',
    tableHeaderBg: '#163029',
    tableHeaderColor: '#6ee7b7',
    borderColor: '#1f4238',
  },
};

export const DEFAULT_CALL_ANALYSIS_PROMPT = `다음 스마트폰 통화 녹음 음성을 듣고 한국어로 정확하게 분석하여 반드시 아래의 2개 마크다운 섹션(\`## 💡 요약\`, \`## 📜 스크립트\`) 구조로 작성해 주세요 (통화 상대방 이름: {contact_name} — 전화번호나 날짜 없이 순수 이름만 표시):

## 💡 요약
- (통화 목적, 주요 합의 사항, 일정/장소/금액 등 핵심 내용을 1~3줄 불릿 포인트로 명확히 요약)

## 📜 스크립트
- **[00:00:00] 나**: (실제 발화 내용)
- **[00:00:04] {contact_name}**: (실제 발화 내용)

[⏱️ 대화 시각(타임스탬프) 정밀 매칭 및 연락처 관계 열람 정책]
1. 초반 통화 연결음·침묵 구간을 정확히 계산하여 각 문장의 첫 음절이 실제로 들리는 오디오 재생 오프셋 시각을 \`[HH:MM:SS]\` 8자리 포맷으로 정확히 표기하세요 (문장과 대화 시각의 타이밍 일치 필수).
2. 대화 상대방 이름은 전화번호나 날짜 없이 \`{contact_name}\` 이름만 표시하여 시간 순서대로 빠짐없이 전사하세요.
3. 하단에 첨부된 [👤 사용자 개인화 참고 정보]와 [📇 연락처 당사자 관계 · 소속 모임 배경지식]을 열람하여 호칭, 인명, 모임 구성원, 직업/거주지 맥락을 기준으로 발음 오인식을 교정하되, 실제 녹음에서 발화되지 않은 사실은 임의로 지어내지 마세요.`;

export const DEFAULT_APP_SETTINGS: MyLoreAppSettings = {
  f11ViewerMode: 'detached',
  autoSaveEnabled: true,
  defaultEditorViewMode: 'split',
  defaultFileOpenPane: 'left',
  linkOpenPane: 'unfocused',
  defaultActivityBarOpen: true,
  activityBarHiddenItems: [],
  activityBarTopOrder: [
    'approval',
    'projects',
    'call',
    'sms',
    'kakaotalk',
    'recording',
    'media',
    'contacts',
    'pc_log',
    'notification',
    'health',
    'location',
    'finance',
    'diary',
  ],
  activityBarBottomOrder: ['settings', 'login', 'help'],
  defaultMenuBarExpanded: false,
  scrollSyncEnabled: true,
  tabIndentSpaces: 2,
  autoCallTranscription: true,
  aiUserProfile:
    '이름: 정서현, 출생년도: 1983, 거주지: 거제, 출생지: 서울, 취미: 수영',
  callAnalysisPrompt: DEFAULT_CALL_ANALYSIS_PROMPT,
  aiDailyTokenLimit: 1000000,
  statusBarShowAi: true,
  statusBarShowGemini: true,
  statusBarShowClaude: true,
  statusBarShowOpenai: true,
  statusBarShowGrok: true,
  statusBarShowTrash: true,
  statusBarShowAutoSave: true,
  statusBarShowPort: true,
  baseFontFamily: FONT_FAMILY_PRESETS[0].value,
  headingFontFamily: FONT_FAMILY_PRESETS[0].value,
  tableFontFamily: FONT_FAMILY_PRESETS[0].value,
  baseFontSize: 14,
  headingScale: 1.0,
  tableFontSize: 13,
  themePreset: 'dark_indigo',
  ...THEME_PRESETS.dark_indigo,
  failedCallTextColor: '#b91c1c',
  lifelogTimeFormat: 'MM-DD(ddd) hh:mm',
  callPlaybackSpeed: 1.75,
  logRetentionCommDays: 7,
  logRetentionVersionDays: 30,
  logRetentionSystemDays: 30,
  logRetentionAiDays: 30,
  topicFolderDocs: '',
  topicFolderProjects: 'Projects',
  topicFolderDiary: 'Diary',
  topicFolderMobile: 'Mobile',
  topicFolderGit: 'C:\\git',
  topicFolderPicture: '',
  settingsFilePath:
    '%USERPROFILE%\\Documents\\myLore\\Projects\\.myLore\\setting.json',
};

export function applyAppSettingsToDocument(settings: MyLoreAppSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--font-sans', settings.baseFontFamily);
  root.style.setProperty('--font-base', settings.baseFontFamily);
  root.style.setProperty('--font-heading', settings.headingFontFamily);
  root.style.setProperty('--font-table', settings.tableFontFamily);
  root.style.setProperty('--font-size-base', `${settings.baseFontSize}px`);
  root.style.setProperty('--font-size-table', `${settings.tableFontSize}px`);
  root.style.setProperty('--heading-scale', String(settings.headingScale));
  root.style.setProperty('--bg-primary', settings.bgPrimary);
  root.style.setProperty('--bg-secondary', settings.bgSecondary);
  root.style.setProperty('--bg-tertiary', settings.tableHeaderBg);
  root.style.setProperty('--bg-elevated', settings.bgSecondary);
  root.style.setProperty('--text-primary', settings.textPrimary);
  root.style.setProperty('--text-secondary', settings.textSecondary);
  root.style.setProperty('--heading-color', settings.headingColor);
  root.style.setProperty('--accent-primary', settings.accentPrimary);
  root.style.setProperty('--accent-hover', settings.accentPrimary);
  root.style.setProperty('--table-header-bg', settings.tableHeaderBg);
  root.style.setProperty('--table-header-color', settings.tableHeaderColor);
  root.style.setProperty('--border-color', settings.borderColor);
  root.style.setProperty(
    '--failed-call-text-color',
    settings.failedCallTextColor || '#b91c1c'
  );
}

/**
 * Gemini API 5시간 쿼터 락 해제 시각(`YYYY-MM-DD HH:MM:SS`)을 파싱하여
 * 현재 락이 유효한 경우 `{ isActive: true, shortText: 'MM-DD hh:mm', hhmm: 'hh:mm' }` 를 반환합니다.
 */
export function parseAiQuotaRetryInfo(
  retryAfterAt?: string,
  nowMs: number = Date.now()
): { isActive: boolean; shortText: string; hhmm: string } {
  if (!retryAfterAt) return { isActive: false, shortText: '', hhmm: '' };
  const trimmed = retryAfterAt.trim();
  if (!trimmed) return { isActive: false, shortText: '', hhmm: '' };
  const m = trimmed.match(
    /^(\d{4})-(\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?/
  );
  if (!m) return { isActive: false, shortText: '', hhmm: '' };
  const year = Number(m[1]);
  const [month, day] = m[2].split('-').map(Number);
  const [hour, minute] = m[3].split(':').map(Number);
  const second = Number(m[4] || '0');
  const targetMs = new Date(
    year,
    month - 1,
    day,
    hour,
    minute,
    second
  ).getTime();
  if (!Number.isFinite(targetMs) || nowMs >= targetMs) {
    return { isActive: false, shortText: '', hhmm: '' };
  }
  return {
    isActive: true,
    shortText: `${m[2]} ${m[3]}`,
    hhmm: m[3],
  };
}

/**
 * 일일 예상 토큰 한도(`dailyLimit`, 기본 1,000,000) 대비 오늘 사용량(`todayUsedTokens`)을 바탕으로
 * 잔여 백분율 문자열(예: `"93.1%"`)을 계산합니다.
 * 단, 5시간 쿼터 락(`retryAfterAt`)이 활성화된 경우에는 `%` 대신 재시도 시각(`MM-DD hh:mm`)을 반환합니다.
 */
export function calculateAiRemainingPercent(
  todayUsedTokens?: number,
  dailyLimit?: number,
  retryAfterAt?: string
): string {
  const retryInfo = parseAiQuotaRetryInfo(retryAfterAt);
  if (retryInfo.isActive) {
    return retryInfo.shortText;
  }
  const limit = dailyLimit && dailyLimit > 0 ? dailyLimit : 1000000;
  const used = todayUsedTokens && todayUsedTokens > 0 ? todayUsedTokens : 0;
  const pct = Math.max(0, Math.min(100, ((limit - used) / limit) * 100));
  return `${pct.toFixed(1)}%`;
}
