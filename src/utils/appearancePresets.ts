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

export const DEFAULT_APP_SETTINGS: MyLoreAppSettings = {
  f11ViewerMode: 'detached',
  autoSaveEnabled: true,
  defaultEditorViewMode: 'split',
  defaultMenuBarExpanded: false,
  scrollSyncEnabled: true,
  autoCallTranscription: true,
  baseFontFamily: FONT_FAMILY_PRESETS[0].value,
  headingFontFamily: FONT_FAMILY_PRESETS[0].value,
  tableFontFamily: FONT_FAMILY_PRESETS[0].value,
  baseFontSize: 14,
  headingScale: 1.0,
  tableFontSize: 13,
  themePreset: 'dark_indigo',
  ...THEME_PRESETS.dark_indigo,
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
}
