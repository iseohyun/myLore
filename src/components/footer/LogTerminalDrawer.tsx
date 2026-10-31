/**
 * @file LogTerminalDrawer.tsx
 * @description `Ctrl + \`` 단축키 또는 하단 상태바 버튼으로 여닫는 통합 로그 터미널 드로어.
 * `log/{service}_{YYYYMMDD}.log` 파일에 기록되는 통신(comm), 동기화(sync), 시스템(system), AI(gemini) 로그를 실시간 열람·검색·정리합니다.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ServiceLogEntry } from '../../types/mylore';
import {
  clearServiceLogs,
  getServiceLogs,
  pruneExpiredServiceLogs,
  showInExplorer,
} from '../../services/tauriClient';

export interface LogTerminalDrawerProps {
  logTerminalOpen: boolean;
  setLogTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>;
}

type LogServiceTab = 'all' | 'comm' | 'version' | 'system' | 'ai';

const SERVICE_META: Record<
  LogServiceTab,
  { label: string; badgeColor: string; desc: string }
> = {
  all: {
    label: '전체 로그',
    badgeColor: '#94a3b8',
    desc: '모든 분야 통합 로그',
  },
  comm: {
    label: '📡 통신 (comm)',
    badgeColor: '#38bdf8',
    desc: '모바일 HTTP/UDP 통신 및 동기화 세션 플랜/ACK 로그',
  },
  version: {
    label: '🏷️ 버전 (version)',
    badgeColor: '#4ade80',
    desc: '앱/프로토콜 버전 및 대화방·도메인 워터마크 백필 로그',
  },
  system: {
    label: '🖥️ 시스템 (system)',
    badgeColor: '#a78bfa',
    desc: '서버 기동, NAT Wi-Fi SSID 자동 탐지, DB/설정/볼트 로그',
  },
  ai: {
    label: '🤖 AI (ai)',
    badgeColor: '#fbbf24',
    desc: '통화/음성 녹음 Gemini API 스크립트 추출 및 쿼터 로그',
  },
};

export function LogTerminalDrawer({
  logTerminalOpen,
  setLogTerminalOpen,
  setStatusMessage,
}: LogTerminalDrawerProps) {
  const [activeService, setActiveService] = useState<LogServiceTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [entries, setEntries] = useState<ServiceLogEntry[]>([]);
  const [logDirPath, setLogDirPath] = useState('');
  const [retentions, setRetentions] = useState({
    comm: 7,
    version: 30,
    system: 30,
    ai: 30,
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
      setLogDirPath(res.logDirPath || '');
      setRetentions({
        comm: res.retentionCommDays ?? 7,
        version: res.retentionVersionDays ?? 30,
        system: res.retentionSystemDays ?? 30,
        ai: res.retentionAiDays ?? 30,
      });
    } catch {
      // ignore in non-tauri preview
    }
  };

  useEffect(() => {
    if (logTerminalOpen) {
      void loadLogs();
    }
  }, [logTerminalOpen]);

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

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((item) => {
      if (activeService !== 'all' && item.service !== activeService) {
        return false;
      }
      if (!q) return true;
      return (
        item.message.toLowerCase().includes(q) ||
        item.service.toLowerCase().includes(q) ||
        item.level.toLowerCase().includes(q) ||
        item.timestamp.toLowerCase().includes(q)
      );
    });
  }, [entries, activeService, searchQuery]);

  useEffect(() => {
    if (logTerminalOpen && autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [filteredEntries, logTerminalOpen, autoScroll]);

  if (!logTerminalOpen) return null;

  return (
    <section
      style={{
        height: '275px',
        backgroundColor: '#090d16',
        borderTop: '2px solid var(--accent-primary)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        zIndex: 40,
      }}
    >
      {/* 상단 툴바 */}
      <div
        style={{
          padding: '6px 12px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          <strong
            style={{
              fontSize: '12.5px',
              color: '#e2e8f0',
              marginRight: '4px',
            }}
          >
            🖥️ 통합 로그 터미널 (<kbd>Ctrl+`</kbd>)
          </strong>
          {(['all', 'comm', 'version', 'system', 'ai'] as LogServiceTab[]).map(
            (tab) => {
              const meta = SERVICE_META[tab];
              const isSelected = activeService === tab;
              const retDays =
                tab === 'comm'
                  ? `${retentions.comm}일`
                  : tab === 'version'
                    ? `${retentions.version}일`
                    : tab === 'system'
                      ? `${retentions.system}일`
                      : tab === 'ai'
                        ? `${retentions.ai}일`
                        : '';
              return (
                <button
                  key={tab}
                  className={`toolbar-btn ${isSelected ? 'primary' : ''}`}
                  style={{
                    padding: '2px 8px',
                    fontSize: '11.5px',
                  }}
                  onClick={() => setActiveService(tab)}
                  title={meta.desc}
                >
                  {meta.label}
                  {retDays ? ` (${retDays})` : ''}
                </button>
              );
            }
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          <input
            className="input-field"
            style={{
              width: '180px',
              padding: '3px 8px',
              fontSize: '11.5px',
              height: '24px',
            }}
            placeholder="로그 검색 (예: kakaotalk, GB, batch-init)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            className={`toolbar-btn ${autoScroll ? 'primary' : ''}`}
            style={{ padding: '2px 7px', fontSize: '11px' }}
            onClick={() => setAutoScroll((v) => !v)}
            title="새 로그 발생 시 하단 자동 스크롤"
          >
            {autoScroll ? '⬇ 자동스크롤 ON' : '⬇ 자동스크롤 OFF'}
          </button>
          <button
            className="toolbar-btn"
            style={{ padding: '2px 7px', fontSize: '11px' }}
            onClick={() => void loadLogs()}
            title="디스크 로그 파일에서 다시 불러오기"
          >
            🔄 새로고침
          </button>
          <button
            className="toolbar-btn"
            style={{ padding: '2px 7px', fontSize: '11px' }}
            onClick={async () => {
              const target = activeService === 'all' ? null : activeService;
              const res = await clearServiceLogs(target);
              setEntries(res.entries || []);
              setStatusMessage(
                `🧹 ${
                  target ? `[${target}] 당일` : '전체'
                } 로그가 초기화되었습니다.`
              );
            }}
            title="현재 탭의 로그 비우기"
          >
            🧹 비우기
          </button>
          <button
            className="toolbar-btn"
            style={{ padding: '2px 7px', fontSize: '11px' }}
            onClick={async () => {
              const removed = await pruneExpiredServiceLogs();
              await loadLogs();
              setStatusMessage(
                `🗑️ 보관 주기가 만료된 로그 파일 ${removed}개를 정리했습니다.`
              );
            }}
            title="설정된 보관일(통신 7일 / 동기화 14일 / 시스템 30일 / AI 30일)이 지난 로그 파일 즉시 정리"
          >
            🗑️ 만료 정리
          </button>
          {logDirPath && (
            <button
              className="toolbar-btn"
              style={{ padding: '2px 7px', fontSize: '11px' }}
              onClick={() => void showInExplorer(logDirPath)}
              title={`로그 폴더 열기: ${logDirPath}`}
            >
              📂 log 폴더
            </button>
          )}
          <button
            className="toolbar-btn"
            style={{ padding: '2px 7px', fontSize: '11px' }}
            onClick={() => setLogTerminalOpen(false)}
            title="통합 로그 터미널 닫기 (Ctrl+`)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 로그 출력 본문 */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11.5px',
          lineHeight: 1.55,
          color: '#cbd5e1',
          userSelect: 'text',
        }}
      >
        {filteredEntries.length === 0 ? (
          <div style={{ color: '#64748b', padding: '8px 0' }}>
            출력할 로그 기록이 없습니다. (수집 경로:{' '}
            <code>{logDirPath || 'Projects/.myLore/log'}/&#123;service&#125;_YYYYMMDD.log</code>)
          </div>
        ) : (
          filteredEntries.map((item, idx) => {
            const svcMeta =
              SERVICE_META[item.service as LogServiceTab] || SERVICE_META.system;
            const levelColor =
              item.level === 'ERROR'
                ? '#f87171'
                : item.level === 'WARN'
                  ? '#fbbf24'
                  : '#94a3b8';
            return (
              <div
                key={`${item.timestamp}-${idx}`}
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'baseline',
                  padding: '1px 0',
                  borderBottom: '1px dashed rgba(30, 41, 59, 0.5)',
                }}
              >
                <span style={{ color: '#64748b', flexShrink: 0 }}>
                  [{item.timestamp}]
                </span>
                <span
                  style={{
                    color: svcMeta.badgeColor,
                    fontWeight: 700,
                    minWidth: '58px',
                    flexShrink: 0,
                  }}
                >
                  [{item.service}]
                </span>
                <span
                  style={{
                    color: levelColor,
                    fontWeight: 600,
                    minWidth: '46px',
                    flexShrink: 0,
                  }}
                >
                  [{item.level}]
                </span>
                <span
                  style={{
                    color: '#e2e8f0',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {item.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
