/**
 * @file LifelogRecordsTab.tsx
 * @description 라이프로그 대시보드 [🗂️ 기록] 탭:
 * 녹음(`recording`), 사진/영상(`media`), 연락처(`contacts`) 3개 하위 분류 뷰 (우측 사이드바 탭과 동기화).
 * 연락처(`contacts`) 탭은 전용 `ContactsDashboardView`로 렌더링합니다.
 */
import React, { useMemo, useState } from 'react';
import { formatLifelogEventTime } from '../sidebar/MobileLifelogSidebar';
import { MediaOriginRegistryPanel } from './LifelogMilestonePanels';
import { ContactsDashboardView } from './ContactsDashboardView';
import {
  LifelogMessage,
  LifelogSourceType,
  MobileContextMenuState,
} from '../../types/mylore';

export type LifelogRecordSubTab = 'recording' | 'media' | 'contacts';

export interface LifelogRecordsTabProps {
  allLifelogMessages: LifelogMessage[];
  contactsMap: Record<string, string>;
  mobileSidebarTab?: LifelogSourceType;
  setMobileSidebarTab?: React.Dispatch<React.SetStateAction<LifelogSourceType>>;
  mobilePersonFilter?: string;
  setMobilePersonFilter?: React.Dispatch<React.SetStateAction<string>>;
  setMobileSourceFilter?: React.Dispatch<
    React.SetStateAction<'all' | LifelogSourceType>
  >;
  setLifelogDashboardTab?: React.Dispatch<
    React.SetStateAction<'settings' | 'chat' | 'records' | 'pc_activity'>
  >;
  openDashboardTab?: (dashType: any) => void;
  setStatusMessage?: React.Dispatch<React.SetStateAction<string>>;
  handleSelectLifelogSidebarItem: (m: LifelogMessage) => void;
  setMobileContextMenu: React.Dispatch<
    React.SetStateAction<MobileContextMenuState | null>
  >;
  resolveContactName: (rawNumberOrName: string) => string;
}

interface ExtractedMediaRecord {
  id: string;
  kind: 'photo' | 'video';
  fileName: string;
  mediaUrl: string;
  roomOrSender: string;
  sender: string;
  sentDate: string;
  sentTime: string;
  sourceMessage: LifelogMessage;
}

function extractBacktickFileNames(text: string): string[] {
  const results: string[] = [];
  const regex = /`([^`\r\n]+\.[a-zA-Z0-9]{2,5})`/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const fname = match[1].trim();
    if (fname && !results.includes(fname)) {
      results.push(fname);
    }
  }
  return results;
}

export function LifelogRecordsTab({
  allLifelogMessages,
  contactsMap,
  mobileSidebarTab,
  setMobileSidebarTab,
  mobilePersonFilter,
  setMobilePersonFilter,
  setMobileSourceFilter,
  setLifelogDashboardTab,
  openDashboardTab,
  setStatusMessage,
  handleSelectLifelogSidebarItem,
  setMobileContextMenu,
  resolveContactName,
}: LifelogRecordsTabProps) {
  const [localSubTab] = useState<LifelogRecordSubTab>('recording');
  const [searchQuery, setSearchQuery] = useState('');

  const subTab: LifelogRecordSubTab =
    mobileSidebarTab === 'recording' ||
    mobileSidebarTab === 'media' ||
    mobileSidebarTab === 'contacts'
      ? mobileSidebarTab
      : localSubTab;

  const mediaItems = useMemo(() => {
    const items: ExtractedMediaRecord[] = [];
    const seenKeys = new Set<string>();

    const isVideoExt = (lower: string) =>
      lower.endsWith('.mp4') ||
      lower.endsWith('.mov') ||
      lower.endsWith('.webm') ||
      lower.endsWith('.mkv') ||
      lower.endsWith('.m4v') ||
      lower.endsWith('.3gp') ||
      lower.endsWith('.avi');

    const isPhotoExt = (lower: string) =>
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.bmp') ||
      lower.endsWith('.heic');

    for (const m of allLifelogMessages) {
      if (m.source === 'media') {
        const fileName = (m.attachmentUuid || '').trim();
        if (!fileName || seenKeys.has(fileName)) continue;
        const lower = fileName.toLowerCase();
        if (!isVideoExt(lower) && !isPhotoExt(lower)) continue;
        seenKeys.add(fileName);
        const mediaUrl = `http://127.0.0.1:18443/api/v1/local-media?sub=extern&file=${encodeURIComponent(
          fileName
        )}`;
        items.push({
          id: `media_${m.id}_${fileName}`,
          kind: isVideoExt(lower) ? 'video' : 'photo',
          fileName,
          mediaUrl,
          roomOrSender: m.roomOrSender || 'SM-S901N',
          sender: m.sender || '사진첩',
          sentDate: m.sentDate,
          sentTime: m.sentTime,
          sourceMessage: m,
        });
        continue;
      }

      if (m.source !== 'kakaotalk') continue;
      const msg = m.message || '';
      const hasLinkedLocalMedia =
        msg.includes('로컬 미디어 연결됨') || msg.includes('로컬 동영상 연결됨');
      if (!hasLinkedLocalMedia) continue;

      const files = extractBacktickFileNames(msg);
      for (const fileName of files) {
        if (seenKeys.has(fileName)) continue;
        const lower = fileName.toLowerCase();
        const mediaUrl = `http://127.0.0.1:18443/api/v1/local-media?sub=kakao&file=${encodeURIComponent(
          fileName
        )}`;
        if (isVideoExt(lower)) {
          seenKeys.add(fileName);
          items.push({
            id: `${m.id}_${fileName}`,
            kind: 'video',
            fileName,
            mediaUrl,
            roomOrSender: resolveContactName(m.roomOrSender),
            sender: resolveContactName(m.sender),
            sentDate: m.sentDate,
            sentTime: m.sentTime,
            sourceMessage: m,
          });
        } else if (isPhotoExt(lower)) {
          seenKeys.add(fileName);
          items.push({
            id: `${m.id}_${fileName}`,
            kind: 'photo',
            fileName,
            mediaUrl,
            roomOrSender: resolveContactName(m.roomOrSender),
            sender: resolveContactName(m.sender),
            sentDate: m.sentDate,
            sentTime: m.sentTime,
            sourceMessage: m,
          });
        }
      }
    }
    return items.sort(
      (a, b) =>
        b.sentDate.localeCompare(a.sentDate) ||
        b.sentTime.localeCompare(a.sentTime)
    );
  }, [allLifelogMessages, resolveContactName]);

  const recordingItems = useMemo(() => {
    return allLifelogMessages.filter((m) => m.source === 'recording');
  }, [allLifelogMessages]);

  const q = searchQuery.trim().toLowerCase();

  const filteredMedia = useMemo(
    () =>
      !q
        ? mediaItems
        : mediaItems.filter(
            (item) =>
              item.fileName.toLowerCase().includes(q) ||
              item.roomOrSender.toLowerCase().includes(q) ||
              item.sender.toLowerCase().includes(q) ||
              item.sentDate.includes(q)
          ),
    [mediaItems, q]
  );

  const filteredRecordings = useMemo(
    () =>
      !q
        ? recordingItems
        : recordingItems.filter((r) => {
            const name = resolveContactName(
              r.roomOrSender || r.sender
            ).toLowerCase();
            return (
              name.includes(q) ||
              (r.message || '').toLowerCase().includes(q) ||
              r.sentDate.includes(q)
            );
          }),
    [recordingItems, q, resolveContactName]
  );

  const renderStageBadge = (stage?: number) => {
    switch (stage) {
      case 1:
        return '🔊 1단계 (대기)';
      case 2:
        return '❓ 2단계 (확인전)';
      case 3:
        return '❗ 3단계 (재요청)';
      case 4:
        return '📄 4단계 (확인됨)';
      default:
        return '🎙️ 녹음보유';
    }
  };

  if (subTab === 'contacts') {
    return (
      <ContactsDashboardView
        allLifelogMessages={allLifelogMessages}
        contactsMap={contactsMap}
        mobilePersonFilter={mobilePersonFilter}
        setMobilePersonFilter={setMobilePersonFilter}
        setMobileSidebarTab={setMobileSidebarTab}
        setMobileSourceFilter={setMobileSourceFilter}
        setLifelogDashboardTab={setLifelogDashboardTab}
        openDashboardTab={openDashboardTab}
        resolveContactName={resolveContactName}
        setStatusMessage={setStatusMessage}
      />
    );
  }

  return (
    <div className="lifelog-records-container">
      <div className="lifelog-records-subtabs">
        <div
          className="lifelog-records-subtab-group"
          style={{
            fontWeight: 700,
            fontSize: '13.5px',
            color: 'var(--heading-color)',
          }}
        >
          {subTab === 'recording' &&
            `🎙️ 음성 녹음 보관함 (${filteredRecordings.length}건)`}
          {subTab === 'media' &&
            `🖼️ 사진 / 영상 미디어 (${filteredMedia.length}건)`}
        </div>

        <input
          type="text"
          className="lifelog-records-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="이름·파일명·날짜 검색..."
        />
      </div>

      {subTab === 'media' && (
        <>
          <MediaOriginRegistryPanel />
          {filteredMedia.length === 0 ? (
            <div className="lifelog-phase3-banner">
              🖼️ 표시할 사진/영상 기록이 없습니다. 모바일 동기화로 수신된 이미지 및 동영상 파일이 이곳에 자동 분류됩니다.
            </div>
          ) : (
            <div className="lifelog-records-grid">
              {filteredMedia.map((item) => (
                <div
                  key={item.id}
                  className="lifelog-record-card"
                  onClick={() => {
                    if (item.sourceMessage.source === 'media') {
                      if (item.kind === 'photo') {
                        window.open(item.mediaUrl, '_blank');
                      }
                    } else if (item.kind === 'photo') {
                      handleSelectLifelogSidebarItem(item.sourceMessage);
                    }
                  }}
                  title={
                    item.sourceMessage.source === 'media'
                      ? `${item.fileName} (${item.roomOrSender})`
                      : '클릭하여 해당 사진/영상이 연결된 원본 마크다운 문서 열기'
                  }
                >
                  {item.kind === 'video' ? (
                    <video
                      src={item.mediaUrl}
                      controls
                      preload="metadata"
                      className="lifelog-record-video"
                    />
                  ) : (
                    <img
                      src={item.mediaUrl}
                      alt={item.fileName}
                      className="lifelog-record-thumb"
                      loading="lazy"
                    />
                  )}
                  <div
                    className="lifelog-record-meta"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.sourceMessage.source === 'media') {
                        window.open(item.mediaUrl, '_blank');
                      } else {
                        handleSelectLifelogSidebarItem(item.sourceMessage);
                      }
                    }}
                  >
                    <div className="lifelog-record-title">
                      {item.kind === 'video' ? '🎬' : '🖼️'} {item.fileName}
                    </div>
                    <div className="lifelog-record-sub">
                      <span>
                        {item.roomOrSender} · {item.sender}
                      </span>
                      <span>
                        {item.sentDate} {item.sentTime.slice(0, 5)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {subTab === 'recording' && (
        <div
          style={{
            padding: '16px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
          }}
        >
          <div style={{ maxHeight: '560px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>일시</th>
                  <th>대상 / 출처</th>
                  <th>스크립트 단계</th>
                  <th>요약 및 내용 미리보기</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecordings.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                      }}
                    >
                      수신된 음성녹음 파일이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filteredRecordings.map((m) => {
                    const displayPerson = resolveContactName(
                      m.roomOrSender || m.sender
                    );
                    const cleanMsg = (m.message || '')
                      .replace(/<br\s*\/?>/gi, ' ')
                      .replace(/\s+/g, ' ')
                      .trim();
                    return (
                      <tr
                        key={m.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleSelectLifelogSidebarItem(m)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMobileContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            personName: displayPerson,
                            sourceKey: m.source,
                            sourceLabel: '음성녹음',
                            messageItem: m,
                          });
                        }}
                        title="좌클릭: 스크립트 문서 열기 및 오디오 플레이어 로드 | 우클릭: AI 스크립트 단계/재추출 메뉴"
                      >
                        <td style={{ whiteSpace: 'nowrap' }}>음성녹음</td>
                        <td
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatLifelogEventTime(
                            m.sentDate,
                            m.sentTime,
                            'YYYYMMDD(ddd) hh:mm:ss'
                          )}
                        </td>
                        <td
                          style={{
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {displayPerson}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '12px' }}>
                          {renderStageBadge(m.transcriptStage)}
                        </td>
                        <td
                          style={{ fontSize: '12.5px', whiteSpace: 'nowrap' }}
                          title={cleanMsg}
                        >
                          {cleanMsg.length > 10
                            ? `${cleanMsg.slice(0, 10)}...`
                            : cleanMsg}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
