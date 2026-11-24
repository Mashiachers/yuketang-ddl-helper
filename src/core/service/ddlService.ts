import type { DeadlineChangeNotice, HomeworkItem, HomeworkStatus, LocalOverrides, SyncDiagnostics, SyncProgress, SyncResult, UserSettings } from '../../types';
import { createYuketangClient, YuketangApiError } from '../api/client';
import { buildIcsContent, downloadIcsFile, type IcsOptions } from '../ics/builder';
import { createDemoData } from '../mock/demoData';
import { deduplicateItems, parseImportedJson } from '../normalizer/normalizer';
import { detectPlatform } from '../platform/detector';
import { formatAiPrompt, type PromptOptions } from '../prompt/formatter';
import { runRateLimitedQueue } from '../queue/rateLimitedQueue';
import * as storage from '../storage/storage';
import { DAY_MS, getItemKey, getStatsSummary, getUrgencyLevel } from '../utils/time';

export const DEFAULT_ORIGIN = 'https://www.yuketang.cn';
export interface SyncOptions {
  origin?: string;
  cookie?: string;
  fetchImpl?: typeof fetch;
  useDemoMode?: boolean;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}

const getPagePlatform = () => detectPlatform(globalThis.location?.origin ?? '');
const getOrigin = (origin?: string) => detectPlatform(origin ?? getPagePlatform()?.origin ?? DEFAULT_ORIGIN)?.origin;

export async function syncTasks(options: SyncOptions = {}): Promise<SyncResult> {
  const origin = getOrigin(options.origin);
  if (!origin) throw new Error('无效的雨课堂来源');
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const settings = await storage.getSettings();
  signal?.throwIfAborted();
  const now = Date.now();
  const diagnostics: SyncDiagnostics = { origin, startedAt: now, finishedAt: now, endpoints: [], failedCourses: 0 };
  if (options.useDemoMode ?? settings.useDemoMode) {
    const result: SyncResult = { origin, source: 'demo', syncedAt: now, ...createDemoData(now, origin), diagnostics };
    onProgress?.({ stage: 'done', completed: 1, total: 1 });
    return result;
  }
  if (!options.force) {
    const cached = await storage.getCachedResult(origin, settings.cacheTtlMinutes, now);
    signal?.throwIfAborted();
    if (cached?.source === 'live') {
      onProgress?.({ stage: 'done', completed: 1, total: 1 });
      return cached;
    }
  }

  if (!options.fetchImpl && origin !== getPagePlatform()?.origin) {
    throw new Error('请在已登录的雨课堂同源页面发起同步');
  }
  const cookie = options.cookie ?? (origin === getPagePlatform()?.origin ? globalThis.document?.cookie : '') ?? '';
  const platform = detectPlatform(origin, cookie)!;
  const client = createYuketangClient(platform, {
    cookie, fetchImpl: options.fetchImpl,
    onDiagnostic: entry => diagnostics.endpoints.push(entry),
  });
  onProgress?.({ stage: 'courses', completed: 0, total: 1 });
  const result: SyncResult = { origin, source: 'live', syncedAt: now, courses: [], items: [], diagnostics };
  try {
    result.courses = await client.listCourses(signal);
    onProgress?.({ stage: 'tasks', completed: 0, total: result.courses.length });
    const settled = await runRateLimitedQueue(result.courses.map(course => (taskSignal?: AbortSignal) => client.listTasks(course, taskSignal)), {
      signal,
      onProgress: (completed, total) => onProgress?.({ stage: 'tasks', completed, total }),
    });
    signal?.throwIfAborted();
    const failed = settled.filter(row => row.status === 'rejected');
    diagnostics.failedCourses = failed.length;
    if (failed.length && failed.length === settled.length) throw failed[0].reason;
    result.items = deduplicateItems(settled.flatMap(row => row.status === 'fulfilled' ? row.value : []));
  } catch (error) {
    signal?.throwIfAborted();
    diagnostics.error = error instanceof YuketangApiError ? error.outcome : 'network-error';
  }
  result.syncedAt = diagnostics.finishedAt = Date.now();
  if (!diagnostics.error && result.items.length > 0) {
    const previous = await storage.getDeadlineSnapshot(origin);
    const changes: DeadlineChangeNotice[] = [];
    const nextSnapshot: storage.DeadlineSnapshot = { ...previous };
    for (const item of result.items) {
      const key = getItemKey(item);
      if (Object.prototype.hasOwnProperty.call(previous, key)) {
        const oldDeadline = previous[key];
        if (item.deadline !== null && oldDeadline === null) {
          changes.push({
            key,
            courseName: item.courseName,
            title: item.title,
            kind: 'newly-set',
            oldDeadline: null,
            newDeadline: item.deadline,
            detectedAt: result.syncedAt,
          });
        } else if (item.deadline !== null && oldDeadline !== null && Math.abs(item.deadline - oldDeadline) >= 60_000) {
          changes.push({
            key,
            courseName: item.courseName,
            title: item.title,
            kind: 'changed',
            oldDeadline,
            newDeadline: item.deadline,
            detectedAt: result.syncedAt,
          });
        }
      }
      nextSnapshot[key] = item.deadline;
    }
    if (changes.length > 0) result.deadlineChanges = changes;
    await storage.saveDeadlineSnapshot(origin, nextSnapshot);
  }
  if (!diagnostics.error && !diagnostics.failedCourses) await storage.saveCachedResult(result);
  onProgress?.({ stage: 'done', completed: 1, total: 1 });
  return result;
}

export const getCachedResult = (origin = getPagePlatform()?.origin ?? DEFAULT_ORIGIN) => storage.getCachedResult(origin);
export const getSettings = storage.getSettings;
export const getOverrides = storage.getOverrides;

let mutation = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const current = mutation.then(operation);
  mutation = current.then(() => {}, () => {});
  return current;
}

export const updateSettings = (patch: Partial<UserSettings>) => serialize(async () => {
  const next = { ...await storage.getSettings(), ...patch };
  await storage.saveSettings(next);
  return next;
});

function toggleOverride(field: 'completedIds' | 'ignoredIds', item: HomeworkItem | string): Promise<LocalOverrides> {
  const key = typeof item === 'string' ? item : getItemKey(item);
  return serialize(async () => {
    const overrides = await storage.getOverrides();
    const keys = new Set(overrides[field]);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    overrides[field] = [...keys];
    await storage.saveOverrides(overrides);
    return overrides;
  });
}

export const toggleItemComplete = (item: HomeworkItem | string) => toggleOverride('completedIds', item);
export const toggleItemIgnore = (item: HomeworkItem | string) => toggleOverride('ignoredIds', item);

export function setCustomDeadline(item: HomeworkItem | string, deadline: number | null): Promise<LocalOverrides> {
  const key = typeof item === 'string' ? item : getItemKey(item);
  return serialize(async () => {
    const overrides = await storage.getOverrides();
    const nextMap = { ...(overrides.customDeadlines ?? {}) };
    if (deadline === null || !Number.isFinite(deadline)) {
      delete nextMap[key];
    } else {
      nextMap[key] = deadline;
    }
    const next: LocalOverrides = { ...overrides, customDeadlines: nextMap };
    await storage.saveOverrides(next);
    return next;
  });
}

export function getEffectiveStatus(item: HomeworkItem, overrides?: LocalOverrides, now = Date.now()): HomeworkStatus | 'ignored' {
  const key = getItemKey(item);
  if (overrides?.ignoredIds.includes(key)) return 'ignored';
  if (item.status === 'submitted' || overrides?.completedIds.includes(key)) return 'submitted';
  const effectiveDeadline = item.deadline ?? overrides?.customDeadlines?.[key] ?? null;
  if (effectiveDeadline === null) return item.status === 'expired' ? 'expired' : 'pending';
  return effectiveDeadline <= now ? 'expired' : item.status;
}

export function getEffectiveItems(items: readonly HomeworkItem[], overrides: LocalOverrides, now = Date.now()): HomeworkItem[] {
  return items.flatMap<HomeworkItem>(item => {
    const key = getItemKey(item);
    const status = getEffectiveStatus(item, overrides, now);
    if (status === 'ignored') return [];
    const customDeadline = item.deadline === null ? overrides.customDeadlines?.[key] : undefined;
    if (customDeadline !== undefined) {
      return [{ ...item, deadline: customDeadline, isCustomDeadline: true, status }];
    }
    return [{ ...item, isCustomDeadline: false, status }];
  });
}

export function filterItemsByAge(
  items: readonly HomeworkItem[],
  limits: Pick<UserSettings, 'maxOverdueDays' | 'maxTbdAgeDays'>,
  now = Date.now(),
): HomeworkItem[] {
  const maxOverdueMs = limits.maxOverdueDays > 0 ? limits.maxOverdueDays * DAY_MS : 0;
  const maxTbdAgeMs = limits.maxTbdAgeDays > 0 ? limits.maxTbdAgeDays * DAY_MS : 0;
  if (!maxOverdueMs && !maxTbdAgeMs) return [...items];

  return items.filter(item => {
    const urgency = getUrgencyLevel(item, now);
    if (urgency === 'overdue' && maxOverdueMs && item.deadline !== null && now - item.deadline > maxOverdueMs) {
      return false;
    }
    if (urgency === 'tbd' && maxTbdAgeMs) {
      const refTime = item.startTime ?? item.updatedAt;
      if (refTime !== undefined && now - refTime > maxTbdAgeMs) {
        return false;
      }
    }
    return true;
  });
}

export async function exportIcs(items: readonly HomeworkItem[], options: IcsOptions & { filename?: string; download?: boolean } = {}): Promise<string> {
  const settings = await getSettings();
  const content = buildIcsContent(items, { reminders: settings.reminders, ...options });
  if (options.download ?? typeof document !== 'undefined') downloadIcsFile(content, options.filename);
  return content;
}

export async function buildPrompt(items: readonly HomeworkItem[], options: PromptOptions = {}): Promise<string> {
  const settings = await getSettings();
  return formatAiPrompt(items, {
    preset: settings.promptPreset,
    customTemplate: settings.customPromptTemplate,
    freeTimeNotes: settings.freeTimeNotes,
    ...options,
  });
}

export function importRawJson(rawJson: unknown, origin = getPagePlatform()?.origin ?? DEFAULT_ORIGIN, now = Date.now()): SyncResult {
  const normalized = getOrigin(origin);
  if (!normalized) throw new Error('无效的雨课堂来源');
  const items = parseImportedJson(rawJson, normalized, now);
  const courses = [...new Map(items.map(item => [item.courseId, {
    id: item.courseId, name: item.courseName, classroomId: item.classroomId,
  }])).values()];
  return {
    origin: normalized, source: 'import', syncedAt: now, items, courses,
    diagnostics: { origin: normalized, startedAt: now, finishedAt: now, endpoints: [], failedCourses: 0 },
  };
}

export function updateBadge(items: readonly HomeworkItem[], origin?: string): Promise<unknown> {
  const summary = getStatsSummary(items);
  return globalThis.chrome?.runtime?.id
    ? chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: summary.urgent, summary, origin })
    : Promise.resolve();
}

export const ddlService = {
  syncTasks, getCachedResult, getSettings, updateSettings, getOverrides, toggleItemComplete,
  toggleItemIgnore, setCustomDeadline, exportIcs, buildPrompt, importRawJson, getEffectiveStatus, getEffectiveItems,
  filterItemsByAge, clearCache: storage.clearCache, updateBadge,
};
