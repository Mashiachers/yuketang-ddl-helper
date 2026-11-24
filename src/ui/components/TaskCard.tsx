import { useState } from 'react';
import { formatDateTime, formatRemainingTime, getUrgencyLevel, TYPE_LABELS, URGENCY_LABELS } from '../../core';
import type { DeadlineChangeNotice, HomeworkItem } from '../../types';
import { CalendarIcon, CheckCircleIcon, CheckIcon, ClockIcon, ExternalLinkIcon, EyeOffIcon } from './Icons';

interface TaskCardProps {
  item: HomeworkItem;
  now: number;
  selected: boolean;
  isLocallyCompleted: boolean;
  deadlineChange?: DeadlineChangeNotice;
  onToggleSelect: (item: HomeworkItem) => void;
  onToggleComplete: (item: HomeworkItem) => void;
  onToggleIgnore: (item: HomeworkItem) => void;
  onSetCustomDeadline: (item: HomeworkItem, deadline: number | null) => void;
}

function toDateTimeLocalValue(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getDefaultTargetValue(now: number): string {
  const target = new Date(now + 3 * 24 * 3_600_000);
  target.setHours(23, 59, 0, 0);
  return toDateTimeLocalValue(target.getTime());
}

export function TaskCard({
  item,
  now,
  selected,
  isLocallyCompleted,
  deadlineChange,
  onToggleSelect,
  onToggleComplete,
  onToggleIgnore,
  onSetCustomDeadline,
}: TaskCardProps) {
  const [editingTarget, setEditingTarget] = useState(false);
  const [draftDate, setDraftDate] = useState('');

  const urgency = getUrgencyLevel(item, now);
  const remainingText = urgency === 'submitted' ? '已完成' : formatRemainingTime(item.deadline, now);

  const showTypeTag = item.type !== 'other';
  const showUrgencyTag = urgency !== 'normal' || isLocallyCompleted;
  const canSetPersonalTarget = (item.deadline === null || item.isCustomDeadline) && urgency !== 'submitted';

  const openEditor = () => {
    setDraftDate(item.deadline !== null ? toDateTimeLocalValue(item.deadline) : getDefaultTargetValue(now));
    setEditingTarget(true);
  };

  const handleSaveTarget = () => {
    const parsed = Date.parse(draftDate);
    if (!Number.isFinite(parsed)) return;
    onSetCustomDeadline(item, parsed);
    setEditingTarget(false);
  };

  const handleClearTarget = () => {
    onSetCustomDeadline(item, null);
    setEditingTarget(false);
  };

  return (
    <article className={`ykt-card urgency-${urgency}${selected ? ' selected' : ''}`}>
      <button
        type="button"
        className={`ykt-checkbox${selected ? ' checked' : ''}`}
        aria-label={selected ? `取消勾选「${item.title}」` : `勾选「${item.title}」`}
        aria-pressed={selected}
        onClick={() => onToggleSelect(item)}
      >
        {selected && <CheckIcon size={11} strokeWidth={2.8} />}
      </button>

      <div className="ykt-card-main">
        <div className="ykt-card-tags">
          <span className="ykt-tag course" title={item.courseName}>
            {item.courseName}
          </span>
          {showTypeTag && <span className="ykt-tag">{TYPE_LABELS[item.type]}</span>}
          {showUrgencyTag && (
            <span className={`ykt-tag urgency-${urgency}`}>
              {isLocallyCompleted ? '本地已划掉' : URGENCY_LABELS[urgency]}
            </span>
          )}
          {item.isCustomDeadline && (
            <span className="ykt-tag custom-ddl" title="老师暂未在雨课堂设置正式截止时间，当前显示为你自己设定的目标时间">
              个人目标
            </span>
          )}
          {deadlineChange && (
            <span
              className="ykt-tag deadline-new"
              title={
                deadlineChange.kind === 'newly-set'
                  ? `老师刚刚补充了截止时间：${formatDateTime(deadlineChange.newDeadline)}`
                  : `截止时间从 ${formatDateTime(deadlineChange.oldDeadline)} 变更为 ${formatDateTime(deadlineChange.newDeadline)}`
              }
            >
              {deadlineChange.kind === 'newly-set' ? '老师新设 DDL' : 'DDL 已调整'}
            </span>
          )}
        </div>

        <div className="ykt-card-title">{item.title}</div>

        {item.summary && <div className="ykt-card-summary">{item.summary}</div>}

        <div className="ykt-card-footer">
          <div className="ykt-deadline-box tabular">
            <span className={`ykt-remaining-pill urgency-${urgency}`}>
              <ClockIcon size={12} />
              <span>{remainingText}</span>
            </span>
            {item.deadline !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatDateTime(item.deadline)}</span>
              </>
            ) : item.startTime ? (
              <>
                <span aria-hidden="true">·</span>
                <span>开始于 {formatDateTime(item.startTime)}</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <span>老师后续可能补设</span>
              </>
            )}
          </div>

          <div className="ykt-card-ops">
            {canSetPersonalTarget && (
              <button
                type="button"
                className="ykt-op-btn"
                title={item.isCustomDeadline ? '修改或清除个人目标截止时间' : '老师暂未设截止时间，点此设置个人目标 DDL（可导入日历）'}
                aria-label={item.isCustomDeadline ? `修改「${item.title}」的个人目标截止时间` : `为「${item.title}」设置个人目标截止时间`}
                onClick={openEditor}
              >
                <CalendarIcon size={14} />
              </button>
            )}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ykt-op-btn"
                title="在新标签页打开雨课堂任务"
                aria-label={`前往雨课堂查看「${item.title}」`}
              >
                <ExternalLinkIcon size={14} />
              </a>
            )}
            <button
              type="button"
              className={`ykt-op-btn${isLocallyCompleted ? ' active' : ''}`}
              title={isLocallyCompleted ? '撤销本地已完成标记' : '标记为已处理'}
              aria-label={isLocallyCompleted ? `撤销「${item.title}」已完成标记` : `将「${item.title}」标记为已处理`}
              onClick={() => onToggleComplete(item)}
            >
              <CheckCircleIcon size={14} />
            </button>
            <button
              type="button"
              className="ykt-op-btn"
              title="隐藏此任务（支持撤销）"
              aria-label={`隐藏任务「${item.title}」`}
              onClick={() => onToggleIgnore(item)}
            >
              <EyeOffIcon size={14} />
            </button>
          </div>
        </div>

        {editingTarget && (
          <div className="ykt-custom-ddl-editor">
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
              设置个人目标截止时间（若老师后续补设正式截止时间，将自动切换并提醒你）
            </div>
            <div className="ykt-custom-ddl-row">
              <input
                type="datetime-local"
                className="ykt-input tabular"
                style={{ flex: 1, minWidth: 170 }}
                aria-label="选择个人目标截止时间"
                value={draftDate}
                onChange={e => setDraftDate(e.target.value)}
              />
              <button type="button" className="ykt-btn ykt-btn-primary ykt-btn-sm" onClick={handleSaveTarget}>
                保存
              </button>
              {item.isCustomDeadline && (
                <button type="button" className="ykt-btn ykt-btn-secondary ykt-btn-sm" onClick={handleClearTarget}>
                  清除
                </button>
              )}
              <button type="button" className="ykt-btn ykt-btn-secondary ykt-btn-sm" onClick={() => setEditingTarget(false)}>
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
