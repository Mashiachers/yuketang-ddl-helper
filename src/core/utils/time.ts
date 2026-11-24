import type { HomeworkItem, HomeworkType, StatsSummary, UrgencyLevel } from '../../types';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const TYPE_LABELS: Record<HomeworkType, string> = {
  homework: '作业', exam: '考试', quiz: '测验', announcement: '公告', other: '其他',
};
export const URGENCY_LABELS: Record<UrgencyLevel, string> = {
  overdue: '已逾期', critical: '紧急', warning: '临近截止', normal: '普通', tbd: '截止待定', submitted: '已提交',
};

export const getItemKey = (item: Pick<HomeworkItem, 'courseId' | 'id'>) => `${item.courseId}:${item.id}`;

export function compareByDeadline(a: Pick<HomeworkItem, 'deadline' | 'startTime'>, b: Pick<HomeworkItem, 'deadline' | 'startTime'>): number {
  if (a.deadline !== null && b.deadline !== null) return a.deadline - b.deadline;
  if (a.deadline !== null) return -1;
  if (b.deadline !== null) return 1;
  return (b.startTime ?? 0) - (a.startTime ?? 0);
}

export function getUrgencyLevel(item: Pick<HomeworkItem, 'deadline' | 'status'>, now = Date.now()): UrgencyLevel {
  if (item.status === 'submitted') return 'submitted';
  if (item.deadline === null) return item.status === 'expired' ? 'overdue' : 'tbd';
  const remaining = item.deadline - now;
  if (item.status === 'expired' || remaining <= 0) return 'overdue';
  if (remaining <= DAY_MS) return 'critical';
  if (remaining <= 3 * DAY_MS) return 'warning';
  return 'normal';
}

export function formatRemainingTime(deadline: number | null, now = Date.now()): string {
  if (deadline === null) return '暂未设截止';
  const delta = deadline - now;
  const minutes = Math.floor(Math.abs(delta) / 60_000);
  if (minutes === 0) return delta <= 0 ? '已截止' : '不足 1 分钟';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const duration = days ? `${days} 天 ${hours} 小时` : hours ? `${hours} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
  return delta <= 0 ? `已逾期 ${duration}` : `剩余 ${duration}`;
}

export function formatDateTime(timestamp: number | null, timeZone?: string): string {
  if (timestamp === null || !Number.isFinite(new Date(timestamp).getTime())) return '暂未设置';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(timestamp);
}

export function getStatsSummary(items: readonly HomeworkItem[], now = Date.now()): StatsSummary {
  const summary = { total: items.length, pending: 0, submitted: 0, expired: 0, urgent: 0, tbd: 0 };
  for (const item of items) {
    const urgency = getUrgencyLevel(item, now);
    if (urgency === 'submitted') summary.submitted++;
    else if (urgency === 'overdue') summary.expired++;
    else {
      summary.pending++;
      if (urgency === 'critical') summary.urgent++;
      if (urgency === 'tbd') summary.tbd++;
    }
  }
  return summary;
}
