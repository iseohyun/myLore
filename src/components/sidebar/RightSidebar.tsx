/**
 * @file RightSidebar.tsx
 * @description 우측 사이드바 컨테이너:
 * - 통합 탭바 전면 제거: 왼쪽 액티비티 바에서 선택된 현재 패널(`activeActivityItem`)의 내용만 단독 출력
 * - 페이지 내 목차(TOC) 기본 제공
 * - `Ctrl+F`(찾기), `Ctrl+H`(바꾸기), `Ctrl+Alt+Shift+F`(모든 파일에서 찾기) 시 `SidebarSearchPanel` 표시
 */
import React, { useState } from 'react';
import {
  ActivityBarItemId,
  ApprovalCategory,
  CallApprovalItem,
  DocumentPayload,
  FinanceTransaction,
  KeybindingConfig,
  LifelogMessage,
  SettingsCategory,
  TocHeading,
} from '../../types/mylore';
import { readDocument } from '../../services/tauriClient';
import { groupKeybindingsByCategory } from '../../hooks/useKeybindings';
import { ApprovalSidebarContent } from './ApprovalSidebarContent';
import { FileTreePanel, FileTreePanelProps } from './FileTreePanel';
import {
  MobileLifelogSidebar,
  MobileLifelogSidebarProps,
} from './MobileLifelogSidebar';
import {
  SidebarSearchPanel,
  SidebarSearchPanelProps,
} from './SidebarSearchPanel';

export interface RightSidebarProps
  extends FileTreePanelProps,
    MobileLifelogSidebarProps,
    SidebarSearchPanelProps {
  activeActivityItem?: ActivityBarItemId;
  rightSidebarOpen: boolean;
  isMobileDataSidebarMode: boolean;
  applyLoadedDocument: (
    doc: DocumentPayload,
    jumpTo?: {
      lineNumber?: number;
      charOffset?: number;
      highlightLength?: number;
    }
  ) => void;
  tocHeadings: TocHeading[];
  selectedDate: string;
  setSelectedDate: React.Dispatch<React.SetStateAction<string>>;
  loadLifelogForDate: (dateStr: string) => Promise<void>;
  dailyTransactions: FinanceTransaction[];
  dailyMessages: LifelogMessage[];
  insertIntoBody: (snippet: string) => void;
  activeTabPath?: string | null;
  settingsCategory?: SettingsCategory;
  setSettingsCategory?: React.Dispatch<React.SetStateAction<SettingsCategory>>;
  approvalCategory?: ApprovalCategory;
  setApprovalCategory?: React.Dispatch<React.SetStateAction<ApprovalCategory>>;
  approvalStageFilter?: 'pending' | 'revising' | 'verified' | 'all';
  setApprovalStageFilter?: React.Dispatch<
    React.SetStateAction<'pending' | 'revising' | 'verified' | 'all'>
  >;
  approvalItems?: CallApprovalItem[];
  selectedApprovalStem?: string | null;
  setSelectedApprovalStem?: React.Dispatch<React.SetStateAction<string | null>>;
  filterUnverifiedCallsOnly?: boolean;
  setFilterUnverifiedCallsOnly?: React.Dispatch<React.SetStateAction<boolean>>;
  filteredKeybindings?: KeybindingConfig[];
  collapsedHelpCategories?: Set<string>;
  activeHelpCategory?: string;
  scrollToHelpCategory?: (category: string) => void;
  expandAllHelpCategories?: () => void;
  collapseAllHelpCategories?: (categories: string[]) => void;
}

const SETTINGS_CATEGORY_GROUPS: Array<{
  groupLabel: string;
  items: Array<{
    id: SettingsCategory;
    icon: string;
    label: string;
    desc: string;
  }>;
}> = [
  {
    groupLabel: '🗂️ 기본 환경 · 외관',
    items: [
      { id: 'basic', icon: '⚙️', label: '기본 설정 (전체 트리 · 초기화)', desc: '전체 설정 트리 이동 · 기본값 복원 · 탐색기 열기' },
      { id: 'folders', icon: '📁', label: '저장소 · 베이스 폴더', desc: '볼트 베이스 폴더 · setting.json' },
      { id: 'appearance', icon: '🎨', label: '테마 · 글꼴 · 뷰어', desc: '5종 테마 · 폰트 · 분할 화면 열림 정책' },
      { id: 'shortcuts', icon: '⌨️', label: '단축키 설정', desc: '전체 단축키 검색 · 키 녹음 변경' },
    ],
  },
  {
    groupLabel: '📱 모바일 라이프로그 & 동기화',
    items: [
      { id: 'sync_setting', icon: '📲', label: 'Sync Setting (기기 연결)', desc: 'Wi-Fi 자동 포함 QR · 토큰 · 연결 기기' },
      { id: 'sync_status', icon: '🔄', label: 'Sync Status (동기화 현황)', desc: '실시간 수신 진행률 · 해시 DB · 동선 추적' },
    ],
  },
  {
    groupLabel: '🤖 AI & 시스템 로그',
    items: [
      { id: 'ai_setting', icon: '🤖', label: 'AI Setting (멀티 LLM)', desc: 'Gemini·Claude·OpenAI·Grok 키 & 프롬프트' },
      { id: 'ai_voiceprint', icon: '🎙️', label: '음성지문 작성 (Voiceprint)', desc: '서버·Sync 2종 오픈소스 교차검증 & Text 뷰어' },
      { id: 'ai_queue', icon: '🚥', label: 'AI Queue (큐 상태 관리)', desc: '독립 AI 큐 프로세스 · 병렬 워커 · 대기열' },
      { id: 'system_logs', icon: '📜', label: '시스템 로그 (Log)', desc: '4대 분야 실시간 로그 조회 · 보관일 설정' },
    ],
  },
];

const LOGIN_TOC_ITEMS = [
  { id: 'login-section-accounts', icon: '🌐', label: '1. 외부 계정 로그인 (Google·네이버·카카오·페북)' },
  { id: 'login-section-calendar', icon: '📅', label: 'Google 캘린더 OAuth 2.0 연동' },
  { id: 'login-section-ai', icon: '🤖', label: '2. AI API 키 등록 · 잔액 확인' },
  { id: 'login-section-sync', icon: '📲', label: '3. 모바일 Sync 페어링 (QR 연결)' },
];

export function RightSidebar(props: RightSidebarProps) {
  const {
    activeActivityItem = 'projects',
    rightSidebarOpen,
    setIsFolderPaneFocused,
    setStatusMessage,
    applyLoadedDocument,
    tocHeadings,
    currentDoc,
    selectedDate,
    setSelectedDate,
    loadLifelogForDate,
    dailyTransactions,
    insertIntoBody,
    activeTabPath,
    settingsCategory = 'basic',
    setSettingsCategory,
    approvalCategory = 'call_scripts',
    setApprovalCategory,
    approvalStageFilter = 'pending',
    setApprovalStageFilter,
    approvalItems = [],
    selectedApprovalStem,
    setSelectedApprovalStem,
    filteredKeybindings = [],
    collapsedHelpCategories = new Set(),
    activeHelpCategory = 'Function',
    scrollToHelpCategory,
    expandAllHelpCategories,
    collapseAllHelpCategories,
  } = props;

  const [tocOpen, setTocOpen] = useState(true);
  const [backlinksOpen, setBacklinksOpen] = useState(false);

  const isMarkdownDocActive =
    Boolean(currentDoc) && !activeTabPath?.startsWith('mylore://dashboard/');

  const helpCategoryGroups = groupKeybindingsByCategory(filteredKeybindings);

  // 페이지 내 목차(TOC) 기본 제공 섹션
  const renderDefaultTocSection = () => {
    if (!isMarkdownDocActive) return null;
    return (
      <div className="sidebar-toc-section">
        <div
          className="tree-group-header"
          style={{ cursor: 'pointer', marginBottom: tocOpen ? '6px' : 0 }}
          onClick={() => setTocOpen((v) => !v)}
          title="클릭하여 페이지 내 목차(TOC) 펼치기/접기"
        >
          <span>{tocOpen ? '▾' : '▸'} 📑 페이지 내 목차 (TOC)</span>
          <span className="tree-group-count">{tocHeadings.length}</span>
        </div>
        {tocOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {tocHeadings.length === 0 ? (
              <div className="tree-empty-hint">문서 내 마크다운 제목(#)이 없습니다.</div>
            ) : (
              tocHeadings.map((h, i) => (
                <div
                  key={i}
                  className="tree-node-row"
                  style={{
                    paddingLeft: `${(h.level - 1) * 12 + 8}px`,
                    fontSize: '12px',
                  }}
                  onClick={() => {
                    if (currentDoc) {
                      applyLoadedDocument(currentDoc, {
                        lineNumber: h.lineIndex + 1,
                      });
                    }
                  }}
                >
                  <span>{h.text}</span>
                </div>
              ))
            )}
          </div>
        )}

        {currentDoc && currentDoc.backlinks.length > 0 && (
          <div style={{ marginTop: '6px' }}>
            <div
              className="tree-group-header"
              style={{ cursor: 'pointer', marginBottom: backlinksOpen ? '4px' : 0 }}
              onClick={() => setBacklinksOpen((v) => !v)}
            >
              <span>{backlinksOpen ? '▾' : '▸'} 🔗 양방향 백링크</span>
              <span className="tree-group-count">{currentDoc.backlinks.length}</span>
            </div>
            {backlinksOpen &&
              currentDoc.backlinks.map((bl, idx) => (
                <div
                  key={idx}
                  className="tree-node-row"
                  onClick={async () => {
                    const doc = await readDocument(bl.sourcePath);
                    applyLoadedDocument(doc);
                  }}
                >
                  <span style={{ fontSize: '11.5px' }}>{bl.sourceTitle}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  };

  const isLifelogActivityItem =
    activeActivityItem === 'call' ||
    activeActivityItem === 'sms' ||
    activeActivityItem === 'kakaotalk' ||
    activeActivityItem === 'recording' ||
    activeActivityItem === 'media' ||
    activeActivityItem === 'contacts' ||
    activeActivityItem === 'pc_log' ||
    activeActivityItem === 'notification' ||
    activeActivityItem === 'health' ||
    activeActivityItem === 'location';

  return (
    <aside
      className={`right-sidebar ${rightSidebarOpen ? '' : 'collapsed'}`}
      onMouseDown={() => setIsFolderPaneFocused(true)}
    >
      <SidebarSearchPanel {...props} />

      {activeActivityItem === 'approval' ? (
        <ApprovalSidebarContent
          approvalCategory={approvalCategory}
          setApprovalCategory={setApprovalCategory}
          approvalStageFilter={approvalStageFilter}
          setApprovalStageFilter={setApprovalStageFilter}
          approvalItems={approvalItems}
          selectedApprovalStem={selectedApprovalStem}
          setSelectedApprovalStem={setSelectedApprovalStem}
          applyLoadedDocument={applyLoadedDocument}
          setStatusMessage={setStatusMessage}
        />
      ) : activeActivityItem === 'settings' ? (
        <div
          className="sidebar-content"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 10px' }}
        >
          <div className="sidebar-panel-title-box">
            <strong>⚙️ 설정 목차 (TOC)</strong>
            <span>클릭 시 전환</span>
          </div>
          {SETTINGS_CATEGORY_GROUPS.map((grp) => (
            <div key={grp.groupLabel} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="tree-group-header" style={{ marginBottom: '2px', fontSize: '11.5px' }}>
                <span>{grp.groupLabel}</span>
              </div>
              {grp.items.map((item) => {
                const isActive = settingsCategory === item.id;
                return (
                  <div
                    key={item.id}
                    data-sidebar-active={isActive ? 'true' : undefined}
                    className={`tree-node-row ${isActive ? 'active' : ''}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '7px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '2px',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSettingsCategory?.(item.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12.5px' }}>
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', paddingLeft: '20px' }}>
                      {item.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : activeActivityItem === 'login' ? (
        <div
          className="sidebar-content"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 10px' }}
        >
          <div className="sidebar-panel-title-box">
            <strong>🔐 로그인 · 연동 목차 (TOC)</strong>
            <span>섹션 이동</span>
          </div>
          {LOGIN_TOC_ITEMS.map((sec) => (
            <div
              key={sec.id}
              className="tree-node-row"
              style={{ padding: '8px 10px', fontWeight: 600, fontSize: '12.5px' }}
              onClick={() => {
                const el = document.getElementById(sec.id);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span>
                {sec.icon} {sec.label}
              </span>
            </div>
          ))}
        </div>
      ) : activeActivityItem === 'help' ? (
        <div
          className="sidebar-content"
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 10px' }}
        >
          <div className="sidebar-panel-title-box">
            <strong>⌨️ 단축키 분류 목차 (TOC)</strong>
            <span>클릭 시 스크롤</span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="toolbar-btn"
              style={{ flex: 1, justifyContent: 'center', fontSize: '11.5px', padding: '4px 8px' }}
              onClick={() => expandAllHelpCategories?.()}
            >
              ▾ 모두 펼치기
            </button>
            <button
              type="button"
              className="toolbar-btn"
              style={{ flex: 1, justifyContent: 'center', fontSize: '11.5px', padding: '4px 8px' }}
              onClick={() =>
                collapseAllHelpCategories?.(helpCategoryGroups.map((g) => g.category))
              }
            >
              ▸ 모두 접기
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {helpCategoryGroups.map((grp) => {
              const isActive = activeHelpCategory === grp.category;
              const isCollapsed = collapsedHelpCategories.has(grp.category);
              return (
                <div
                  key={grp.category}
                  data-sidebar-active={isActive ? 'true' : undefined}
                  className={`tree-node-row ${isActive ? 'active' : ''}`}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '7px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '2px',
                    cursor: 'pointer',
                  }}
                  onClick={() => scrollToHelpCategory?.(grp.category)}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12.5px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {isCollapsed ? '▸' : '▾'}
                      </span>
                      <span>{grp.icon}</span>
                      <span>{grp.label}</span>
                    </div>
                    <span className="help-category-badge">{grp.items.length}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeActivityItem === 'finance' ? (
        <div
          className="sidebar-content"
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px 10px' }}
        >
          {renderDefaultTocSection()}
          <div className="sidebar-panel-title-box">
            <strong>💳 당일 가계부 내역</strong>
            <span>{dailyTransactions.length}건</span>
          </div>
          <input
            type="date"
            className="input-field"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              void loadLifelogForDate(e.target.value);
            }}
          />
          {dailyTransactions.map((tx) => (
            <div
              key={tx.id}
              className="tree-node-row"
              onClick={() =>
                insertIntoBody(
                  `- 💳 [${tx.txTime}] **${tx.merchant}** (${tx.amount.toLocaleString()}원, ${tx.institution})`
                )
              }
            >
              <span>
                {tx.merchant} ({tx.amount.toLocaleString()}원)
              </span>
              <span style={{ fontSize: '11px', color: '#a5b4fc' }}>+삽입</span>
            </div>
          ))}
        </div>
      ) : isLifelogActivityItem ? (
        <>
          {isMarkdownDocActive && (
            <div style={{ padding: '8px 10px 0 10px' }}>
              {renderDefaultTocSection()}
            </div>
          )}
          <MobileLifelogSidebar
            {...props}
            mobileSidebarTab={activeActivityItem}
          />
        </>
      ) : (
        /* Project ('projects', 'data', 'git') 또는 Diary ('diary') */
        <div className="sidebar-content">
          {renderDefaultTocSection()}
          <FileTreePanel
            {...props}
            roles={
              activeActivityItem === 'diary'
                ? ['diary']
                : ['projects', 'data', 'git']
            }
          />
        </div>
      )}
    </aside>
  );
}
