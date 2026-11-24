import { useRef, useState } from 'react';
import { formatRemainingTime, getUrgencyLevel } from '../../core';
import type { HomeworkItem, StatsSummary } from '../../types';
import { CalendarIcon, GripIcon } from './Icons';

interface FloatingDockProps {
  stats: StatsSummary;
  nextUpcoming: HomeworkItem | null;
  now: number;
  loading: boolean;
  initialBottom?: number;
  onPositionChange?: (bottom: number) => void;
  onOpen: () => void;
}

export function FloatingDock({
  stats,
  nextUpcoming,
  now,
  loading,
  initialBottom,
  onPositionChange,
  onOpen,
}: FloatingDockProps) {
  const [bottom, setBottom] = useState<number>(initialBottom ?? 24);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ startY: number; startBottom: number; moved: boolean } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = { startY: e.clientY, startBottom: bottom, moved: false };
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    const deltaY = state.startY - e.clientY;
    if (Math.abs(deltaY) > 4) state.moved = true;
    const maxBottom = Math.max(80, window.innerHeight - 90);
    const clamped = Math.min(maxBottom, Math.max(16, state.startBottom + deltaY));
    setBottom(clamped);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    dragStateRef.current = null;
    setDragging(false);
    if (!state) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (state.moved) {
      onPositionChange?.(Math.round(bottom));
    } else {
      onOpen();
    }
  };

  const nextUrgency = nextUpcoming ? getUrgencyLevel(nextUpcoming, now) : null;
  const subText = loading
    ? '正在扫描各课程待办…'
    : nextUpcoming
      ? `${nextUpcoming.courseName} · ${formatRemainingTime(nextUpcoming.deadline, now)}`
      : stats.pending === 0
        ? '太棒了，当前无未交任务'
        : `${stats.pending} 项待办任务`;

  const badgeCount = stats.urgent > 0 ? stats.urgent : stats.pending;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="打开雨课堂 DDL 助手"
      className={`ykt-dock${dragging ? ' dragging' : ''}`}
      style={{ bottom: `${bottom}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="ykt-dock-grip" title="按住可上下拖动位置">
        <GripIcon size={13} />
      </span>

      <span className="ykt-dock-icon-wrap">
        <CalendarIcon size={16} />
        {badgeCount > 0 && (
          <span
            className={`ykt-dock-badge tabular${stats.urgent > 0 ? ' pulse' : ''}`}
            style={stats.urgent === 0 ? { background: '#2563eb' } : undefined}
          >
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </span>

      <span className="ykt-dock-body">
        <span className="ykt-dock-title">
          DDL 助手
          {stats.urgent > 0 && (
            <span className="ykt-tag urgency-critical tabular">{stats.urgent} 项 24h 内</span>
          )}
        </span>
        <span className={`ykt-dock-sub tabular${nextUrgency === 'critical' ? ' urgent' : ''}`}>
          {subText}
        </span>
      </span>
    </div>
  );
}
