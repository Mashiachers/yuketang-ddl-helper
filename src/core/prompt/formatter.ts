import type { HomeworkItem, PromptPresetId } from '../../types';
import { compareByDeadline, formatDateTime, getUrgencyLevel, HOUR_MS, TYPE_LABELS, URGENCY_LABELS } from '../utils/time';

export interface PromptOptions {
  preset?: PromptPresetId;
  customTemplate?: string;
  freeTimeNotes?: string;
  now?: number;
  timeZone?: string;
}

export const PROMPT_PRESETS = {
  'weekly-plan': '请规划未来一周。先按紧急程度、重要性和依赖关系分级，估算每项耗时并标明假设。结合可用时段安排每日计划，把长任务放进连续时段，把预习、检查等放进碎片时段。为主观题或大作业给出 Markdown 答题框架，保留需要我自行研究和完成的内容。',
  'emergency-48h': '请制定未来 48 小时的应急计划。优先安排尚未提交且即将截止的任务，标明预估耗时、最小可交付内容和首个行动。单独列出已逾期但需要确认补交的任务。',
  'concise-checklist': '请给出简明 Markdown 待办清单。按截止时间与紧急程度排序，每项写一条可立即执行的下一步。',
} satisfies Record<Exclude<PromptPresetId, 'custom'>, string>;

const cell = (value: string) => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');

export function formatAiPrompt(items: readonly HomeworkItem[], options: PromptOptions = {}): string {
  const { preset = 'weekly-plan', now = Date.now(), timeZone } = options;
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hasTbd = items.some(item => item.deadline === null && item.status !== 'submitted');
  const taskTable = [
    '| 课程 | 作业 | 类型 | 截止时间 | 剩余小时数 | 紧急程度 | 摘要 |',
    '| --- | --- | --- | --- | ---: | --- | --- |',
    ...[...items].sort(compareByDeadline).map(item => {
      const deadlineLabel =
        item.deadline === null
          ? '暂未设置（后续可能补设）'
          : `${formatDateTime(item.deadline, zone)}${item.isCustomDeadline ? '（个人目标）' : ''}`;
      const remainingHours = item.deadline === null ? '待定' : ((item.deadline - now) / HOUR_MS).toFixed(1);
      return '| ' + [
        item.courseName,
        item.title,
        TYPE_LABELS[item.type],
        deadlineLabel,
        remainingHours,
        URGENCY_LABELS[getUrgencyLevel(item, now)],
        item.summary || '—',
      ].map(cell).join(' | ') + ' |';
    }),
  ].join('\n');
  const freeTime = options.freeTimeNotes?.trim();
  const nowLabel = `${formatDateTime(now, zone)}（${zone}）`;
  const template = preset === 'custom'
    ? options.customTemplate?.trim() || PROMPT_PRESETS['weekly-plan']
    : PROMPT_PRESETS[preset];
  const output = template.replace(/{{\s*(tasks|freeTimeNotes|now)\s*}}/g, (_, key: string) => {
    if (key === 'tasks') return taskTable;
    if (key === 'now') return nowLabel;
    return freeTime ?? '未提供';
  });
  return [
    output,
    hasTbd ? '补充说明：表格中标为「截止待定」的任务老师暂未设置截止时间，但后续随时可能补设，请在排期中为其预留弹性推进时段，避免临近才发现突击截止。' : '',
    /{{\s*now\s*}}/.test(template) ? '' : `当前时间 ${nowLabel}`,
    /{{\s*tasks\s*}}/.test(template) ? '' : `## 任务资料\n\n${taskTable}`,
    freeTime && !/{{\s*freeTimeNotes\s*}}/.test(template) ? `## 可用时段\n\n${freeTime}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    if (globalThis.navigator?.clipboard) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* Try the browser command fallback */ }
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  const previous = document.activeElement;
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('无法写入剪贴板');
  } finally {
    input.remove();
    if (previous instanceof HTMLElement) previous.focus();
  }
}
