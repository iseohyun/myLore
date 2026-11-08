/**
 * @file ActivityBar.tsx
 * @description 왼쪽 액티비티 바(Activity Bar) 컴포넌트.
 * - 상단 기본(14개): 결제 · Project · 통화 · 문자 · 카톡 · 녹음 · 사진 · 연락처 · PC로그 · M로그 · 헬스 · GPS · finance · Diary
 * - 하단 기본(3개): 설정 · 로그인 · 단축키
 * - 우클릭 컨텍스트 메뉴: 특정 액티비티 켜기/끄기(표시/숨김) 및 기본값 복원
 * - 드래그 앤 드롭: 액티비티 아이콘 순서 자유 변경
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityBarItemId } from '../../types/mylore';

export interface ActivityBarItemDef {
  id: ActivityBarItemId;
  label: string;
  icon: string;
  title: string;
}

export const ACTIVITY_BAR_TOP_ITEMS: ActivityBarItemDef[] = [
  { id: 'approval', label: '결제', icon: '✅', title: '결제 (AI 작업 승인 · 요청)' },
  { id: 'projects', label: 'Project', icon: '⭐', title: 'Project (프로젝트 · 아카이브 · Git)' },
  { id: 'call', label: '통화', icon: '📞', title: '통화 로그 및 녹음 스크립트' },
  { id: 'sms', label: '문자', icon: '✉️', title: '문자 (SMS / MMS)' },
  { id: 'kakaotalk', label: '카톡', icon: '💬', title: '카카오톡 대화 로그' },
  { id: 'recording', label: '녹음', icon: '🎙️', title: '음성 녹음 보관함' },
  { id: 'media', label: '사진', icon: '🖼️', title: '사진 / 영상 미디어' },
  { id: 'contacts', label: '연락처', icon: '📇', title: '모바일 연락처 및 관계 컨텍스트' },
  { id: 'pc_log', label: 'PC로그', icon: '💻', title: 'PC 활동 로그 (ActivityWatch)' },
  { id: 'notification', label: 'M로그', icon: '📱', title: '모바일 앱 사용 로그' },
  { id: 'health', label: '헬스', icon: '❤️', title: '헬스 케어 데이터' },
  { id: 'location', label: 'GPS', icon: '📍', title: 'GPS · Wi-Fi 이동 동선' },
  { id: 'finance', label: 'finance', icon: '💳', title: '가계부 (Finance)' },
  { id: 'diary', label: 'Diary', icon: '📅', title: '일기 및 캘린더 (Diary)' },
];

export const ACTIVITY_BAR_BOTTOM_ITEMS: ActivityBarItemDef[] = [
  { id: 'settings', label: '설정', icon: '⚙️', title: '환경 설정' },
  { id: 'login', label: '로그인', icon: '🔐', title: '계정 로그인 · AI API 키 · Sync QR 연결' },
  { id: 'help', label: '단축키', icon: '⌨️', title: '단축키 및 도움말 대시보드' },
];

export const DEFAULT_ACTIVITY_BAR_TOP_ORDER: ActivityBarItemId[] =
  ACTIVITY_BAR_TOP_ITEMS.map((item) => item.id);

export const DEFAULT_ACTIVITY_BAR_BOTTOM_ORDER: ActivityBarItemId[] =
  ACTIVITY_BAR_BOTTOM_ITEMS.map((item) => item.id);

const ALL_ACTIVITY_ITEMS: ActivityBarItemDef[] = [
  ...ACTIVITY_BAR_TOP_ITEMS,
  ...ACTIVITY_BAR_BOTTOM_ITEMS,
];

const ACTIVITY_ITEM_MAP = new Map<ActivityBarItemId, ActivityBarItemDef>(
  ALL_ACTIVITY_ITEMS.map((item) => [item.id, item])
);

export interface ActivityBarConfigPatch {
  activityBarHiddenItems?: ActivityBarItemId[];
  activityBarTopOrder?: ActivityBarItemId[];
  activityBarBottomOrder?: ActivityBarItemId[];
}

export interface ActivityBarProps {
  activeItem: ActivityBarItemId;
  onSelectItem: (item: ActivityBarItemId) => void;
  totalApprovalPendingCount?: number;
  hiddenItems?: ActivityBarItemId[];
  topOrder?: ActivityBarItemId[];
  bottomOrder?: ActivityBarItemId[];
  onChangeActivityBarConfig?: (patch: ActivityBarConfigPatch) => void;
}

interface DropIndicatorState {
  targetId: ActivityBarItemId;
  position: 'before' | 'after';
}

interface ContextMenuState {
  x: number;
  y: number;
  targetId: ActivityBarItemId | null;
}

export function ActivityBar({
  activeItem,
  onSelectItem,
  totalApprovalPendingCount = 0,
  hiddenItems = [],
  topOrder,
  bottomOrder,
  onChangeActivityBarConfig,
}: ActivityBarProps) {
  const barRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 정규화된 상단/하단 순서 계산 (누락된 기본 아이템 자동 보충 및 중복 제거)
  const { resolvedTopIds, resolvedBottomIds } = useMemo(() => {
    const seen = new Set<ActivityBarItemId>();
    const top: ActivityBarItemId[] = [];
    const bottom: ActivityBarItemId[] = [];

    const rawTop =
      topOrder && topOrder.length > 0 ? topOrder : DEFAULT_ACTIVITY_BAR_TOP_ORDER;
    const rawBottom =
      bottomOrder && bottomOrder.length > 0
        ? bottomOrder
        : DEFAULT_ACTIVITY_BAR_BOTTOM_ORDER;

    for (const id of rawTop) {
      if (ACTIVITY_ITEM_MAP.has(id) && !seen.has(id)) {
        seen.add(id);
        top.push(id);
      }
    }
    for (const id of rawBottom) {
      if (ACTIVITY_ITEM_MAP.has(id) && !seen.has(id)) {
        seen.add(id);
        bottom.push(id);
      }
    }
    for (const def of ACTIVITY_BAR_TOP_ITEMS) {
      if (!seen.has(def.id)) {
        seen.add(def.id);
        top.push(def.id);
      }
    }
    for (const def of ACTIVITY_BAR_BOTTOM_ITEMS) {
      if (!seen.has(def.id)) {
        seen.add(def.id);
        bottom.push(def.id);
      }
    }
    return { resolvedTopIds: top, resolvedBottomIds: bottom };
  }, [topOrder, bottomOrder]);

  const hiddenSet = useMemo(() => new Set<ActivityBarItemId>(hiddenItems), [hiddenItems]);

  const visibleTopItems = useMemo(
    () =>
      resolvedTopIds
        .filter((id) => !hiddenSet.has(id))
        .map((id) => ACTIVITY_ITEM_MAP.get(id)!)
        .filter(Boolean),
    [resolvedTopIds, hiddenSet]
  );

  const visibleBottomItems = useMemo(
    () =>
      resolvedBottomIds
        .filter((id) => !hiddenSet.has(id))
        .map((id) => ACTIVITY_ITEM_MAP.get(id)!)
        .filter(Boolean),
    [resolvedBottomIds, hiddenSet]
  );

  // 드래그 앤 드롭 상태
  const [draggingId, setDraggingId] = useState<ActivityBarItemId | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState | null>(null);
  const dragSessionRef = useRef<{
    id: ActivityBarItemId;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const dropIndicatorRef = useRef<DropIndicatorState | null>(null);
  const suppressNextClickRef = useRef(false);

  // 우클릭 컨텍스트 메뉴 상태
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // 우클릭 메뉴 바깥 클릭 / Esc 닫기
  useEffect(() => {
    if (!contextMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        return;
      }
      setContextMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [contextMenu]);

  // 포인터 기반 드래그 앤 드롭 이벤트 처리
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session) return;

      if (!session.started) {
        const dist = Math.hypot(e.clientX - session.startX, e.clientY - session.startY);
        if (dist < 4) return;
        session.started = true;
        suppressNextClickRef.current = true;
        setDraggingId(session.id);
        setContextMenu(null);
      }

      if (!barRef.current) return;
      const itemNodes = Array.from(
        barRef.current.querySelectorAll<HTMLElement>('.activity-bar-item[data-activity-id]')
      );
      if (itemNodes.length === 0) return;

      let bestTargetId: ActivityBarItemId | null = null;
      let bestPosition: 'before' | 'after' = 'after';
      let minDistance = Number.POSITIVE_INFINITY;

      for (const el of itemNodes) {
        const attrId = el.getAttribute('data-activity-id') as ActivityBarItemId | null;
        if (!attrId) continue;
        const rect = el.getBoundingClientRect();
        const midY = (rect.top + rect.bottom) / 2;

        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          bestTargetId = attrId;
          bestPosition = e.clientY < midY ? 'before' : 'after';
          minDistance = 0;
          break;
        }

        const dist = Math.abs(e.clientY - midY);
        if (dist < minDistance) {
          minDistance = dist;
          bestTargetId = attrId;
          bestPosition = e.clientY < midY ? 'before' : 'after';
        }
      }

      if (bestTargetId && bestTargetId !== session.id) {
        const nextIndicator: DropIndicatorState = {
          targetId: bestTargetId,
          position: bestPosition,
        };
        dropIndicatorRef.current = nextIndicator;
        setDropIndicator(nextIndicator);
      } else {
        dropIndicatorRef.current = null;
        setDropIndicator(null);
      }
    };

    const handlePointerUp = () => {
      const session = dragSessionRef.current;
      if (!session) return;
      const indicator = dropIndicatorRef.current;

      if (session.started && indicator && indicator.targetId !== session.id) {
        const draggedId = session.id;
        const nextTop = resolvedTopIds.filter((id) => id !== draggedId);
        const nextBottom = resolvedBottomIds.filter((id) => id !== draggedId);

        const topTargetIdx = nextTop.indexOf(indicator.targetId);
        if (topTargetIdx !== -1) {
          const insertIdx =
            indicator.position === 'before' ? topTargetIdx : topTargetIdx + 1;
          nextTop.splice(insertIdx, 0, draggedId);
        } else {
          const bottomTargetIdx = nextBottom.indexOf(indicator.targetId);
          if (bottomTargetIdx !== -1) {
            const insertIdx =
              indicator.position === 'before' ? bottomTargetIdx : bottomTargetIdx + 1;
            nextBottom.splice(insertIdx, 0, draggedId);
          } else {
            nextTop.push(draggedId);
          }
        }

        onChangeActivityBarConfig?.({
          activityBarTopOrder: nextTop,
          activityBarBottomOrder: nextBottom,
        });
      }

      dragSessionRef.current = null;
      dropIndicatorRef.current = null;
      setDraggingId(null);
      setDropIndicator(null);

      if (suppressNextClickRef.current) {
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 60);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [resolvedTopIds, resolvedBottomIds, onChangeActivityBarConfig]);

  const handleToggleItemVisibility = (itemId: ActivityBarItemId) => {
    const nextHidden = new Set(hiddenSet);
    if (nextHidden.has(itemId)) {
      nextHidden.delete(itemId);
    } else {
      nextHidden.add(itemId);
    }
    onChangeActivityBarConfig?.({
      activityBarHiddenItems: Array.from(nextHidden),
    });
  };

  const handleShowAllItems = () => {
    onChangeActivityBarConfig?.({
      activityBarHiddenItems: [],
    });
    setContextMenu(null);
  };

  const handleResetActivityBar = () => {
    onChangeActivityBarConfig?.({
      activityBarHiddenItems: [],
      activityBarTopOrder: DEFAULT_ACTIVITY_BAR_TOP_ORDER,
      activityBarBottomOrder: DEFAULT_ACTIVITY_BAR_BOTTOM_ORDER,
    });
    setContextMenu(null);
  };

  const openContextMenu = (
    e: React.MouseEvent,
    targetId: ActivityBarItemId | null
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const estWidth = 230;
    const estHeight = Math.min(window.innerHeight - 20, 540);
    const clampedX = Math.max(8, Math.min(e.clientX, window.innerWidth - estWidth - 8));
    const clampedY = Math.max(8, Math.min(e.clientY, window.innerHeight - estHeight - 8));
    setContextMenu({
      x: clampedX,
      y: clampedY,
      targetId,
    });
  };

  const renderActivityButton = (item: ActivityBarItemDef) => {
    const isActive = activeItem === item.id;
    const isDragging = draggingId === item.id;
    const isDropBefore =
      dropIndicator?.targetId === item.id && dropIndicator.position === 'before';
    const isDropAfter =
      dropIndicator?.targetId === item.id && dropIndicator.position === 'after';
    const showBadge = item.id === 'approval' && totalApprovalPendingCount > 0;

    return (
      <button
        key={item.id}
        type="button"
        data-activity-id={item.id}
        className={[
          'activity-bar-item',
          isActive ? 'active' : '',
          isDragging ? 'dragging' : '',
          isDropBefore ? 'drop-before' : '',
          isDropAfter ? 'drop-after' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragSessionRef.current = {
            id: item.id,
            startX: e.clientX,
            startY: e.clientY,
            started: false,
          };
        }}
        onClick={() => {
          if (suppressNextClickRef.current) return;
          onSelectItem(item.id);
        }}
        onContextMenu={(e) => openContextMenu(e, item.id)}
        title={`${item.title}\n(드래그: 순서 변경 | 우클릭: 액티비티 표시 설정)`}
      >
        <span className="activity-bar-icon">{item.icon}</span>
        <span className="activity-bar-label">{item.label}</span>
        {showBadge && (
          <span className="activity-bar-badge">
            {totalApprovalPendingCount > 99 ? '99+' : totalApprovalPendingCount}
          </span>
        )}
      </button>
    );
  };

  const targetItemDef = contextMenu?.targetId
    ? ACTIVITY_ITEM_MAP.get(contextMenu.targetId) || null
    : null;

  return (
    <aside
      ref={barRef}
      className={`activity-bar ${draggingId ? 'is-dragging' : ''}`}
      aria-label="왼쪽 액티비티 바"
      onContextMenu={(e) => openContextMenu(e, null)}
    >
      <div className="activity-bar-group top">
        {visibleTopItems.map(renderActivityButton)}
      </div>

      <div className="activity-bar-group bottom">
        {visibleBottomItems.map(renderActivityButton)}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="activity-bar-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="activity-bar-menu-header">
            액티비티 바 표시 · 순서 관리
          </div>

          {targetItemDef && (
            <>
              <button
                type="button"
                className="activity-bar-menu-item quick-toggle"
                onClick={() => {
                  handleToggleItemVisibility(targetItemDef.id);
                  setContextMenu(null);
                }}
              >
                <span className="activity-bar-menu-check">
                  {hiddenSet.has(targetItemDef.id) ? '➕' : '👁️‍🗨️'}
                </span>
                <span className="activity-bar-menu-icon">{targetItemDef.icon}</span>
                <span className="activity-bar-menu-label">
                  '{targetItemDef.label}' 액티비티{' '}
                  {hiddenSet.has(targetItemDef.id) ? '켜기' : '끄기'}
                </span>
              </button>
              <div className="activity-bar-menu-divider" />
            </>
          )}

          <div className="activity-bar-menu-scroll">
            <div className="activity-bar-menu-section-title">상단 액티비티</div>
            {resolvedTopIds.map((id) => {
              const def = ACTIVITY_ITEM_MAP.get(id);
              if (!def) return null;
              const isVisible = !hiddenSet.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`activity-bar-menu-item ${isVisible ? 'checked' : 'unchecked'}`}
                  onClick={() => handleToggleItemVisibility(id)}
                >
                  <span className="activity-bar-menu-check">
                    {isVisible ? '☑' : '☐'}
                  </span>
                  <span className="activity-bar-menu-icon">{def.icon}</span>
                  <span className="activity-bar-menu-label">{def.label}</span>
                </button>
              );
            })}

            <div className="activity-bar-menu-divider" />
            <div className="activity-bar-menu-section-title">하단 액티비티</div>
            {resolvedBottomIds.map((id) => {
              const def = ACTIVITY_ITEM_MAP.get(id);
              if (!def) return null;
              const isVisible = !hiddenSet.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`activity-bar-menu-item ${isVisible ? 'checked' : 'unchecked'}`}
                  onClick={() => handleToggleItemVisibility(id)}
                >
                  <span className="activity-bar-menu-check">
                    {isVisible ? '☑' : '☐'}
                  </span>
                  <span className="activity-bar-menu-icon">{def.icon}</span>
                  <span className="activity-bar-menu-label">{def.label}</span>
                </button>
              );
            })}
          </div>

          <div className="activity-bar-menu-divider" />
          {hiddenSet.size > 0 && (
            <button
              type="button"
              className="activity-bar-menu-item action"
              onClick={handleShowAllItems}
            >
              <span className="activity-bar-menu-check">👁️</span>
              <span className="activity-bar-menu-label">
                숨긴 액티비티 모두 켜기 ({hiddenSet.size}개)
              </span>
            </button>
          )}
          <button
            type="button"
            className="activity-bar-menu-item action"
            onClick={handleResetActivityBar}
          >
            <span className="activity-bar-menu-check">🔄</span>
            <span className="activity-bar-menu-label">
              기본 순서 및 표시 초기화
            </span>
          </button>
        </div>
      )}
    </aside>
  );
}
