import type { HomeworkItem, ReminderConfig } from '../../types';
import { deduplicateItems } from '../normalizer/normalizer';
import { DEFAULT_REMINDERS } from '../storage/storage';
import { TYPE_LABELS } from '../utils/time';

export interface IcsOptions {
  reminders?: readonly ReminderConfig[];
  now?: number;
}

const encoder = new TextEncoder();
export function foldIcsLine(line: string): string {
  let bytes = 0;
  let folded = '';
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (bytes + width > 75) {
      folded += '\r\n ';
      bytes = 1;
    }
    folded += character;
    bytes += width;
  }
  return folded;
}

export function escapeIcsText(value: string): string {
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function formatUtc(time: number): string {
  return new Date(time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Escape the delimiter as well, so separate course/item pairs cannot share a UID.
const sanitizedId = (id: string) => encodeURIComponent(id.toWellFormed()).replace(/-/g, '%2D');
export const isValidReminderTrigger = (value: string) =>
  /^-P(?:\d+W|\d+D(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?|T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)$/.test(value) && /[1-9]/.test(value);

function webUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Item has no usable link */ }
  return '';
}

export function buildIcsContent(items: readonly HomeworkItem[], options: IcsOptions = {}): string {
  const stamp = formatUtc(options.now ?? Date.now());
  const reminders = (options.reminders ?? DEFAULT_REMINDERS).filter(reminder => reminder.enabled && isValidReminderTrigger(reminder.trigger));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yuketang DDL Helper//ZH-CN', 'CALSCALE:GREGORIAN'];
  for (const item of deduplicateItems(items)) {
    if (item.deadline === null) continue;
    const link = webUrl(item.url);
    const description = [
      item.courseName,
      TYPE_LABELS[item.type],
      item.isCustomDeadline ? '（个人目标截止时间，老师暂未在雨课堂设置正式截止时间）' : '',
      item.summary,
      link,
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:ykt-${sanitizedId(item.courseId)}-${sanitizedId(item.id)}@ddl-helper`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatUtc(item.deadline - 30 * 60_000)}`,
      `DTEND:${formatUtc(item.deadline)}`,
      `SUMMARY:${escapeIcsText(item.title)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
    );
    if (link) lines.push(`URL:${link}`);
    for (const reminder of reminders) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER;RELATED=END:${reminder.trigger}`,
        `DESCRIPTION:${escapeIcsText(item.title)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

export function downloadIcsFile(content: string, filename = 'yuketang-ddl.ics'): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
