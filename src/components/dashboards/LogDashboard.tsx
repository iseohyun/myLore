/**
 * @file LogDashboard.tsx
 * @description `Ctrl + \`` 단축키 또는 상단/하단 메뉴로 여는 로그 기록 조회 대시보드 (`mylore://dashboard/logs`).
 * 통신(`comm`), 버전(`version`), 시스템(`system`), AI(`ai`) 4대 분야별 `{분야}_{YYYYMMDD}.log` 로그를 실시간 스트리밍·필터링·정리합니다.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { MyLoreAppSettings, ServiceLogEntry } from '../../types/mylore';
import {
  clearServiceLogs,
  getServiceLogs,
  pruneExpiredServiceLogs,
  showInExplorer,
} from '../../services/tauriClient';

export interface LogDashboardProps {
  appSettings: MyLoreAppSettings;
  openDashboardTab: (
    dashType: 'lifelog' | 'finance' | 'diary' | 'settings' | 'logs'
  ) => void;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

type LogDomainTab = 'all' | 'comm' | 'version' | 'system' | 'ai';
type LogLevelFilter = 'ALL' | 'INFO' | 'WARN' | 'ERROR';

const DOMAIN_META: Record<
  LogDomainTab,
  {
    label: string;
    shortLabel: string;
    filePattern: string;
    badgeColor: string;
    desc: string;
  }
> = {
  all: {
    label: '📋 전체 분야',
    shortLabel: 'ALL',
    filePattern: '{분야}_YYYYMMDD.log',
    badgeColor: '#94a3b8',
    desc: '통신 · 버전 · 시스템 · AI 통합 로그 스트림',
  },
  comm: {
    label: '📡 통신 (comm)',
    shortLabel: '통신',
    filePattern: 'comm_YYYYMMDD.log',
    badgeColor: '#38bdf8',
    desc: '모바일 HTTP/UDP 핸드셰이크, 세션 플랜, 파일/메시지 수신 및 ACK 통신 로그',
  },
  version: {
    label: '🏷️ 버전 (version)',
    shortLabel: '버전',
    filePattern: 'version_YYYYMMDD.log',
    badgeColor: '#4ade80',
    desc: '앱/프로토콜 버전, 대화방·도메인 워터마크 백필 및 버전 정합성 로그',
  },
  system: {
    label: '🖥️ 시스템 (system)',
    shortLabel: '시스템',
    filePattern: 'system_YYYYMMDD.log',
    badgeColor: '#a78bfa',
    desc: '서버 기동, NAT Wi-Fi SSID 자동 탐지, DB/볼트/설정 시스템 로그',
  },
  ai: {
    label: '🤖 AI (ai)',
    shortLabel: 'AI',
    filePattern: 'ai_YYYYMMDD.log',
    badgeColor: '#fbbf24',
    desc: 'Gemini API 통화/음성 녹음 스크립트 변환, 토큰 사용량 및 쿼터 로그',
  },
};

export function LogDashboard({
  appSettings,
  openDashboardTab,
  setStatusMessage,
}: LogDashboardProps) {
  const [activeDomain, setActiveDomain] = useState<LogDomainTab>('all');
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [entries, setEntries] = useState<ServiceLogEntry[]>([]);
  const [logFiles, setLogFiles] = useState<string[]>([]);
  const [logDirPath, setLogDirPath] = useState('');
  const [retentions, setRetentions] = useState({
    comm: appSettings.logRetentionCommDays ?? 7,
    version: appSettings.logRetentionVersionDays ?? 30,
    system: appSettings.logRetentionSystemDays ?? 30,
    ai: appSettings.logRetentionAiDays ?? 30,
  });
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const loadLogs = async () => {
    try {
      const res = await getServiceLogs({
        serviceFilter: null,
        limit: 1000,
      });
      setEntries(res.entries || []);
      setLogFiles(res.logFiles || []);
      setLogDirPath(res.logDirPath || '');
      setRetentions({
        comm: res.retentionCommDays ?? appSettings.logRetentionCommDays ?? 7,
        version:
          res.retentionVersionDays ?? appSettings.logRetentionVersionDays ?? 30,
        system:
          res.retentionSystemDays ?? appSettings.logRetentionSystemDays ?? 30,
        ai: res.retentionAiDays ?? appSettings.logRetentionAiDays ?? 30,
      });
    } catch {
      // ignore in non-tauri preview
    }
  };

  useEffect(() => {
    void loadLogs();
  }, [
    appSettings.logRetentionCommDays,
    appSettings.logRetentionVersionDays,
    appSettings.logRetentionSystemDays,
    appSettings.logRetentionAiDays,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const isTauri =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (isTauri) {
      listen<ServiceLogEntry>('mylore-log-entry', (event) => {
        if (!event.payload) return;
        setEntries((prev) => {
          const svc = event.payload.service;
          const domainCount = prev.filter((e) => e.service === svc).length;
          if (domainCount >= 250) {
            const firstIdx = prev.findIndex((e) => e.service === svc);
            if (firstIdx >= 0) {
              return [
                ...prev.slice(0, firstIdx),
                ...prev.slice(firstIdx + 1),
                event.payload,
              ];
            }
          }
          return [...prev, event.payload];
        });
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const domainCounts = useMemo(() => {
    const counts = {
      all: entries.length,
      comm: 0,
      version: 0,
      system: 0,
      ai: 0,
    };
    for (const item of entries) {
      const svc = item.service.toLowerCase();
      if (svc === 'comm' || svc === 'sync') counts.comm += 1;
      else if (svc === 'version') counts.version += 1;
      else if (svc === 'ai' || svc === 'gemini') counts.ai += 1;
      else counts.system += 1;
    }
    return counts;
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((item) => {
      const svc = item.service.toLowerCase();
      const normSvc =
        svc === 'sync' ? 'comm' : svc === 'gemini' ? 'ai' : svc;
      if (activeDomain !== 'all' && normSvc !== activeDomain) {
        return false;
      }
      if (
        levelFilter !== 'ALL' &&
        item.level.toUpperCase() !== levelFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.message.toLowerCase().includes(q) ||
        normSvc.includes(q) ||
        item.level.toLowerCase().includes(q) ||
        item.timestamp.toLowerCase().includes(q)
      );
    });
  }, [entries, activeDomain, levelFilter, searchQuery]);

  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [filteredEntries, autoScroll]);

  const getRetentionLabel = (tab: LogDomainTab): string => {
    switch (tab) {
      case 'comm':
        return `${retentions.comm}일 보관`;
      case 'version':
        return `${retentions.version}일 보관`;
      case 'system':
        return `${retentions.system}일 보관`;
      case 'ai':
        return `${retentions.ai}일 보관`;
      default:
        return `통신 ${retentions.comm}일 / 기타 30일`;
    }
  };

  return (
    <div
      className="dashboard-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '18px 22px',
        gap: '14px',
        overflow: 'hidden',
      }}
    >
      {/* 상단 헤더 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '18px' }}>
            📋 로그 기록 조회 대시보드 (<kbd>Ctrl+`</kbd>)
          </h2>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}
          >
            통신(<code>comm</code>) · 버전(<code>version</code>) · 시스템(
            <code>system</code>) · AI(<code>ai</code>) 4대 분야별{' '}
            <code>&#123;분야&#125;_&#123;날짜YYYYMMDD&#125;.log</code> 파일로
            수집되며, 보관일 경과 시 자동 삭제됩니다.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            className={`toolbar-btn ${autoScroll ? 'primary' : ''}`}
            onClick={() => setAutoScroll((v) => !v)}
            title="새 로그 수신 시 하단으로 자동 스크롤"
          >
            {autoScroll ? '⬇ 자동스크롤 ON' : '⬇ 자동스크롤 OFF'}
          </button>
          <button
            className="toolbar-btn"
            onClick={() => void loadLogs()}
            title="디스크 로그 다시 불러오기"
          >
            🔄 새로고침
          </button>
          <button
            className="toolbar-btn"
            onClick={async () => {
              const target = activeDomain === 'all' ? null : activeDomain;
              const res = await clearServiceLogs(target);
              setEntries(res.entries || []);
              setLogFiles(res.logFiles || []);
              setStatusMessage(
                `🧹 ${
                  target ? `[${target}] 분야 금일` : '전체 분야 금일'
                } 로그가 비워졌습니다.`
              );
            }}
            title="현재 선택된 분야의 금일 로그 비우기"
          >
            🧹 로그 비우기
          </button>
          <button
            className="toolbar-btn"
            onClick={async () => {
              const removed = await pruneExpiredServiceLogs();
              await loadLogs();
              setStatusMessage(
                `🗑️ 보관 주기가 만료된 로그 파일 ${removed}개를 정리했습니다.`
              );
            }}
            title="설정된 보관 주기가 지난 로그 파일 즉시 삭제"
          >
            🗑️ 만료 로그 정리
          </button>
          {logDirPath && (
            <button
              className="toolbar-btn"
              onClick={() => void showInExplorer(logDirPath)}
              title={`탐색기에서 열기: ${logDirPath}`}
            >
              📂 log 폴더 열기
            </button>
          )}
          <button
            className="toolbar-btn"
            onClick={() => openDashboardTab('settings')}
            title="설정 대시보드에서 분야별 로그 보관일 변경"
          >
            ⚙️ 보관일 설정
          </button>
        </div>
      </div>

      {/* 4대 분야 선택 카드 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
          gap: '10px',
          flexShrink: 0,
        }}
      >
        {(['all', 'comm', 'version', 'system', 'ai'] as LogDomainTab[]).map(
          (tab) => {
            const meta = DOMAIN_META[tab];
            const isSelected = activeDomain === tab;
            const count = domainCounts[tab];
            return (
              <div
                key={tab}
                onClick={() => setActiveDomain(tab)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: isSelected
                    ? 'rgba(99, 102, 241, 0.14)'
                    : 'var(--bg-secondary)',
                  border: isSelected
                    ? `1.5px solid ${meta.badgeColor}`
                    : '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <strong style={{ fontSize: '13px', color: meta.badgeColor }}>
                    {meta.label}
                  </strong>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '999px',
                      backgroundColor: 'rgba(148, 163, 184, 0.15)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {count}건
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <code>{meta.filePattern}</code>
                  <span>{getRetentionLabel(tab)}</span>
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={meta.desc}
                >
                  {meta.desc}
                </div>
              </div>
            );
          }
        )}
      </div>

      {/* 검색어 · 레벨 필터 · 수집 파일 목록 바 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          padding: '8px 12px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <input
            className="input-field"
            style={{ width: '260px', height: '28px', fontSize: '12px' }}
            placeholder="메시지 / 시각 / 키워드 검색 (예: session-plan, ack, kakaotalk)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['ALL', 'INFO', 'WARN', 'ERROR'] as LogLevelFilter[]).map(
              (lvl) => (
                <button
                  key={lvl}
                  className={`toolbar-btn ${
                    levelFilter === lvl ? 'primary' : ''
                  }`}
                  style={{ padding: '3px 8px', fontSize: '11.5px' }}
                  onClick={() => setLevelFilter(lvl)}
                >
                  {lvl === 'ALL' ? '모든 레벨' : lvl}
                </button>
              )
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            fontSize: '11.5px',
            color: 'var(--text-secondary)',
          }}
        >
          <span>수집 파일({logFiles.length}):</span>
          {logFiles.slice(0, 6).map((f) => (
            <code
              key={f}
              style={{
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                fontSize: '11px',
              }}
            >
              {f}
            </code>
          ))}
          {logFiles.length > 6 && <span>외 {logFiles.length - 6}개</span>}
        </div>
      </div>

      {/* 로그 스트림 본문 */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '10px 14px',
          backgroundColor: '#090d16',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          fontFamily:
            "'JetBrains Mono', 'Cascadia Code', 'D2Coding', Consolas, monospace",
          fontSize: '12px',
          lineHeight: 1.6,
        }}
      >
        {filteredEntries.length === 0 ? (
          <div
            style={{
              color: '#64748b',
              padding: '32px 0',
              textAlign: 'center',
            }}
          >
            표시할 로그 레코드가 없습니다. (모바일 동기화, 버전 백필, 시스템 기동
            또는 Gemini 작업 시 실시간으로 기록됩니다)
          </div>
        ) : (
          filteredEntries.map((item, idx) => {
            const rawSvc = item.service.toLowerCase();
            const normSvc: LogDomainTab =
              rawSvc === 'comm' || rawSvc === 'sync'
                ? 'comm'
                : rawSvc === 'version'
                  ? 'version'
                  : rawSvc === 'ai' || rawSvc === 'gemini'
                    ? 'ai'
                    : 'system';
            const meta = DOMAIN_META[normSvc];
            const lvlColor =
              item.level === 'ERROR'
                ? '#f87171'
                : item.level === 'WARN'
                  ? '#fbbf24'
                  : '#94a3b8';

            return (
              <div
                key={item.id ?? `${item.timestamp}-${idx}`}
                style={{
                  display: 'flex',
                  gap: '8px',
                  padding: '2px 0',
                  borderBottom: '1px dashed rgba(51, 65, 85, 0.35)',
                  wordBreak: 'break-all',
                }}
              >
                <span style={{ color: '#64748b', flexShrink: 0 }}>
                  [{item.timestamp}]
                </span>
                <span
                  style={{
                    color: meta.badgeColor,
                    fontWeight: 700,
                    flexShrink: 0,
                    minWidth: '68px',
                  }}
                >
                  [{normSvc}]
                </span>
                <span
                  style={{
                    color: lvlColor,
                    fontWeight: 700,
                    flexShrink: 0,
                    minWidth: '48px',
                  }}
                >
                  [{item.level}]
                </span>
                <span
                  style={{
                    color:
                      item.level === 'ERROR'
                        ? '#fca5a5'
                        : item.level === 'WARN'
                          ? '#fde68a'
                          : '#e2e8f0',
                  }}
                >
                  {item.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
