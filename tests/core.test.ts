import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeworkItem, SyncResult } from '../src/types';
import {
  buildIcsContent, buildRequestHeaders, createDemoData, createYuketangClient, ddlService,
  detectPlatform, escapeIcsText, formatAiPrompt, getItemKey, getStatsSummary,
  isYuketangHost, normalizeCourses, normalizeHomework, parseCookies, parseImportedJson,
  parseTimestamp, runRateLimitedQueue,
} from '../src/core';
import * as storage from '../src/core/storage/storage';

const origin = 'https://www.yuketang.cn';
const now = Date.UTC(2026, 10, 24, 1);
const itemDeadline = now + 3_600_000;
const item: HomeworkItem = {
  id: '22', courseId: '101', courseName: '实验课', title: '中文😀'.repeat(24) + ',;\\\n换行',
  type: 'homework', deadline: itemDeadline, status: 'pending', url: origin + '/work/22',
};
const seconds = itemDeadline / 1000;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

afterEach(() => { vi.unstubAllGlobals(); });

describe('platform and live candidates', () => {
  it.each([
    ['www', 'main'], ['changjiang', 'changjiang'], ['pro', 'hetang'], ['huanghe', 'huanghe'], ['university', 'custom'],
  ])('detects %s', (host, variant) => {
    expect(detectPlatform(`https://${host}.yuketang.cn`)?.variant).toBe(variant);
  });

  it('rejects misleading hosts and parses cookie values safely', () => {
    expect(isYuketangHost('yuketang.cn.example.org')).toBe(false);
    expect(detectPlatform('http://www.yuketang.cn')).toBeNull();
    const cookie = 'csrftoken=a%3Db; university_id=42; xtbz=demo; broken=%Z; __proto__=ignored';
    expect(parseCookies(cookie).broken).toBe('%Z');
    const headers = buildRequestHeaders(detectPlatform(origin, cookie)!, cookie, '7');
    expect(Object.fromEntries(headers)).toEqual({
      accept: 'application/json', 'classroom-id': '7', 'university-id': '42', 'x-csrftoken': 'a=b', xtbz: 'demo',
    });
  });

  it('probes fallbacks and exposes endpoint labels without credentials or identifiers', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ data: { results: [{ id: '101', classroom_id: 'private-class', name: '实验课' }] } }))
      .mockResolvedValueOnce(json({}, 403))
      .mockResolvedValueOnce(json({ data: [{ homework_id: '22', title: '报告', deadline: seconds }] }));
    const diagnostics = vi.fn();
    const client = createYuketangClient(detectPlatform(origin)!, { cookie: 'csrftoken=secret', fetchImpl, onDiagnostic: diagnostics });
    const courses = await client.listCourses();
    expect(await client.listTasks(courses[0])).toMatchObject([{ id: '22', courseId: '101', type: 'homework' }]);
    expect(diagnostics.mock.calls.map(([entry]) => entry.outcome)).toEqual(['not-found', 'ok', 'unauthorized', 'ok']);
    expect(JSON.stringify(diagnostics.mock.calls)).not.toMatch(/secret|private-class/);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ credentials: 'include', mode: 'same-origin', redirect: 'manual' });
  });

  it('distinguishes authorization and network failures', async () => {
    const platform = detectPlatform(origin)!;
    const rejected = createYuketangClient(platform, { fetchImpl: vi.fn(async () => json({}, 401)) });
    await expect(rejected.listCourses()).rejects.toMatchObject({ outcome: 'unauthorized' });
    const offline = createYuketangClient(platform, { fetchImpl: vi.fn(async () => { throw new TypeError('offline'); }) });
    await expect(offline.listCourses()).rejects.toMatchObject({ outcome: 'network-error' });
  });
});

describe('rate-limited queue', () => {
  it('limits concurrency and start rate while isolating rejected tasks', async () => {
    const starts: number[] = [];
    let active = 0;
    let peak = 0;
    const onProgress = vi.fn();
    const tasks = Array.from({ length: 4 }, (_, i) => async () => {
      starts.push(performance.now());
      peak = Math.max(++active, peak);
      await new Promise(resolve => setTimeout(resolve, 45));
      active--;
      if (i === 1) throw new Error('expected failure');
      return i;
    });
    const result = await runRateLimitedQueue(tasks, { concurrency: 2, intervalMs: 20, onProgress });
    expect(result.map(row => row.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    expect(peak).toBe(2);
    expect(starts.slice(1).every((start, i) => start - starts[i] >= 18)).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
  });

  it('cancels queued work and passes the signal to active work', async () => {
    const controller = new AbortController();
    const next = vi.fn(async () => 2);
    const results = await runRateLimitedQueue([async signal => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return 1;
    }, next], { signal: controller.signal });
    expect(next).not.toHaveBeenCalled();
    expect(results[1].status).toBe('rejected');
  });
});

describe('normalization', () => {
  it('reads course and activity wrappers, infers status, and deduplicates by course and item', () => {
    const course = normalizeCourses({ data: { courses: [{ classroom_id: 5, course: { id: 101, name: '实验课' } }] } }, origin)[0];
    expect(course).toMatchObject({ id: '101', classroomId: '5' });
    const rows = { data: { logs: [
      { homework: { id: 22, title: '报告', deadline: seconds } },
      { homework: { id: 22, title: '报告', deadline: item.deadline, submitted: true } },
      { activity: { id: 15, title: '小测', type: 'quiz', end_time: new Date(now - 3600).toISOString() } },
    ] } };
    expect(normalizeHomework(rows, origin, course, now)).toMatchObject([
      { id: '15', status: 'expired', type: 'quiz' }, { id: '22', courseId: '101', status: 'submitted' },
    ]);
    expect(parseTimestamp(String(seconds))).toBe(item.deadline);
    expect(parseTimestamp('nonsense')).toBeUndefined();
  });

  it('imports nested course data and rejects improper origin links', () => {
    const input = { arbitrary: [{ course_id: 101, course_name: '数字信号处理', tasks: [
      { homework_id: 22, title: '报告', due_at: seconds, url: 'javascript:alert(1)' },
    ] }, { course_id: 102, id: 22, title: '简答', deadline: seconds }] };
    const tasks = parseImportedJson(JSON.stringify(input), origin, now);
    expect(tasks.map(getItemKey)).toEqual(['101:22', '102:22']);
    expect(tasks[0]).toMatchObject({ courseName: '数字信号处理', url: origin + '/v2/web/studentLog/101' });
    expect(() => parseImportedJson('{', origin)).toThrow(SyntaxError);
  });
});

describe('calendar and prompt', () => {
  it('writes CRLF, valid UTF-8 folds, stable UID, UTC times and deadline-relative alarms', () => {
    const ics = buildIcsContent([item, item], { now });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(ics.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75)).toBe(true);
    const unfolded = ics.replaceAll('\r\n ', '');
    expect(unfolded).toContain('SUMMARY:' + escapeIcsText(item.title));
    expect(unfolded).toContain('UID:ykt-101-22@ddl-helper\r\nDTSTAMP:20261124T010000Z\r\nDTSTART:20261124T013000Z\r\nDTEND:20261124T020000Z');
    expect(unfolded.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    for (const trigger of ['-P3D', '-P1D', '-PT3H']) expect(unfolded).toContain('TRIGGER;RELATED=END:' + trigger);
    expect(unfolded).toContain('URL:' + item.url);
    expect(buildIcsContent([item], { now: now + 5000, reminders: [] })).toContain('UID:ykt-101-22@ddl-helper');
    expect(buildIcsContent([item], { now, reminders: [{ id: 'x', label: 'x', enabled: true, trigger: '-P0D\r\nATTACK' }] })).not.toContain('VALARM');
  });

  it('escapes text fields and includes all prompt presets and optional schedule', () => {
    expect(escapeIcsText('a,b;c\\d\r\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(formatAiPrompt([item], { now })).toContain('Markdown 答题框架');
    expect(formatAiPrompt([item], { now, preset: 'emergency-48h' })).toContain('48 小时');
    expect(formatAiPrompt([item], { now, preset: 'concise-checklist' })).toContain('待办清单');
    const custom = formatAiPrompt([{ ...item, title: 'A|B\nC' }], {
      now, timeZone: 'Asia/Shanghai', preset: 'custom', customTemplate: '{{now}}\n{{tasks}}\n{{freeTimeNotes}}',
      freeTimeNotes: '周五 18:00',
    });
    expect(custom).toContain('Asia/Shanghai');
    expect(custom).toContain('A\\|B C');
    expect(custom).toContain('周五 18:00');
    expect(custom.match(/\| 课程 \|/g)).toHaveLength(1);
  });
});

describe('storage and service', () => {
  it('uses extension storage when available and persists concurrent settings edits', async () => {
    const entries = new Map<string, unknown>();
    const area = {
      get: vi.fn(async (key: string) => ({ [key]: entries.get(key) })),
      set: vi.fn(async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) entries.set(key, value);
      }),
    };
    vi.stubGlobal('chrome', { storage: { local: area } });
    expect(await ddlService.getSettings()).toMatchObject({ cacheTtlMinutes: 15, promptPreset: 'weekly-plan' });
    await Promise.all([ddlService.updateSettings({ showSubmitted: true }), ddlService.updateSettings({ theme: 'dark' })]);
    expect(await ddlService.getSettings()).toMatchObject({ showSubmitted: true, theme: 'dark' });
    expect(area.set).toHaveBeenCalledTimes(2);
  });

  it('reports partial course failures while preserving the healthy course', async () => {
    const branch = 'https://pro.yuketang.cn';
    const fetchImpl = vi.fn<typeof fetch>(async url => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/list')) return json({ data: { classroom_list: [
        { course_id: 101, classroom_id: '11', name: '实验课' },
        { course_id: 102, classroom_id: '22', name: '理论课' },
      ] } });
      if (path.endsWith('/learn/11')) return json({ data: [{ homework_id: 22, title: '报告', deadline: seconds }] });
      return json({}, 503);
    });
    const result = await ddlService.syncTasks({ origin: branch, fetchImpl, force: true });
    expect(result.items).toMatchObject([{ courseId: '101' }]);
    expect(result.diagnostics.failedCourses).toBe(1);
    expect(await ddlService.getCachedResult(branch)).toBeNull();
  });

  it('isolates cached results by origin, honors the exact TTL and clears the cache', async () => {
    const result: SyncResult = ddlService.importRawJson([item], origin, now);
    await storage.saveCachedResult(result);
    expect(await storage.getCachedResult(origin, 15, now + 899_999)).toEqual(result);
    expect(await storage.getCachedResult(origin, 15, now + 900_000)).toBeNull();
    expect(await storage.getCachedResult('https://pro.yuketang.cn', 15, now)).toBeNull();
    await storage.clearCache(origin);
    expect(await storage.getCachedResult(origin, 15, now)).toBeNull();
  });

  it('uses configured defaults, keeps demo isolated and applies local overrides', async () => {
    const demo = await ddlService.syncTasks({ origin, useDemoMode: true });
    expect(demo.source).toBe('demo');
    expect(getStatsSummary(createDemoData(now).items, now)).toMatchObject({ urgent: 2, expired: 1, submitted: 1 });
    expect(await ddlService.getCachedResult(origin)).toBeNull();
    await Promise.all([ddlService.toggleItemComplete(item), ddlService.toggleItemIgnore('another:id')]);
    const overrides = await ddlService.getOverrides();
    expect(ddlService.getEffectiveStatus(item, overrides, now)).toBe('submitted');
    expect(overrides.ignoredIds).toContain('another:id');
    expect(await ddlService.exportIcs([item], { download: false, now })).toContain('BEGIN:VALARM');
  });

  it('syncs live data, reuses cache and preserves it when a forced sync fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{ id: 101, classroom_id: 33, name: '实验课' }] }))
      .mockResolvedValueOnce(json({ data: [{ id: 22, title: '报告', deadline: seconds }] }))
      .mockResolvedValue(json({}, 401));
    const onProgress = vi.fn();
    const synced = await ddlService.syncTasks({ origin, fetchImpl, onProgress, force: true });
    expect(synced.items).toHaveLength(1);
    expect(onProgress).toHaveBeenLastCalledWith({ stage: 'done', completed: 1, total: 1 });
    expect(await ddlService.syncTasks({ origin, fetchImpl })).toEqual(synced);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await ddlService.syncTasks({ origin, fetchImpl, force: true })).diagnostics.error).toBe('unauthorized');
    expect(await ddlService.getCachedResult(origin)).toEqual(synced);
    await storage.clearCache(origin);
  });

  it('retains tasks without deadlines, supports personal targets, and detects teacher-added deadlines later', async () => {
    const tbdOrigin = 'https://changjiang.yuketang.cn';
    const rawLogs = {
      data: {
        activities: [
          { exam_id: 'dsp6', title: 'DSPch6', type: 'exam', start_time: now - 3_600_000, deadline: 0 },
          { id: 'ppt1', title: '第6章课件PPT', type: 'slide' },
        ],
      },
    };
    const normalized = normalizeHomework(rawLogs, tbdOrigin, { id: 'dsp', name: '数字信号处理' }, now);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ id: 'dsp6', deadline: null, status: 'pending', type: 'exam' });
    expect(getStatsSummary(normalized, now)).toMatchObject({ pending: 1, tbd: 1, expired: 0, urgent: 0 });

    // ICS safely skips no-deadline items; AI Prompt keeps them with clear guidance
    expect(buildIcsContent(normalized, { now })).not.toContain('BEGIN:VEVENT');
    const prompt = formatAiPrompt(normalized, { now });
    expect(prompt).toContain('暂未设置');
    expect(prompt).toContain('截止待定');

    // User sets a personal target deadline -> participates in ICS and countdown
    const targetTs = now + 48 * 3_600_000;
    const overrides = await ddlService.setCustomDeadline(normalized[0], targetTs);
    const effectiveWithTarget = ddlService.getEffectiveItems(normalized, overrides, now);
    expect(effectiveWithTarget[0]).toMatchObject({ deadline: targetTs, isCustomDeadline: true, status: 'pending' });
    expect(buildIcsContent(effectiveWithTarget, { now })).toContain('BEGIN:VEVENT');

    // Later live sync: teacher sets official deadline -> detected as newly-set and takes precedence over custom target
    const officialDeadline = now + 24 * 3_600_000;
    const fetch1 = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{ id: 'dsp', classroom_id: 'c1', name: '数字信号处理' }] }))
      .mockResolvedValueOnce(json({ data: [{ exam_id: 'dsp6', title: 'DSPch6', type: 'exam', deadline: 0 }] }));
    const first = await ddlService.syncTasks({ origin: tbdOrigin, fetchImpl: fetch1, force: true });
    expect(first.items[0].deadline).toBeNull();
    expect(first.deadlineChanges).toBeUndefined();

    const fetch2 = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{ id: 'dsp', classroom_id: 'c1', name: '数字信号处理' }] }))
      .mockResolvedValueOnce(json({ data: [{ exam_id: 'dsp6', title: 'DSPch6', type: 'exam', deadline: officialDeadline }] }));
    const second = await ddlService.syncTasks({ origin: tbdOrigin, fetchImpl: fetch2, force: true });
    expect(second.deadlineChanges).toHaveLength(1);
    expect(second.deadlineChanges?.[0]).toMatchObject({ kind: 'newly-set', oldDeadline: null, newDeadline: officialDeadline });

    const effectiveOfficial = ddlService.getEffectiveItems(second.items, overrides, now);
    expect(effectiveOfficial[0]).toMatchObject({ deadline: officialDeadline, isCustomDeadline: false });
    await ddlService.setCustomDeadline(normalized[0], null);
    await storage.clearCache(tbdOrigin);
  });

  it('filters stale overdue and stale no-deadline tasks by configurable day limits and recognizes rich submission fields', () => {
    const day = 24 * 3_600_000;
    const rows = [
      { id: 'old-overdue', title: '2024旧作业', type: 'homework', deadline: now - 150 * day },
      { id: 'recent-overdue', title: '上周作业', type: 'homework', deadline: now - 5 * day },
      { id: 'old-tbd', title: '2024无截止测验', type: 'exam', deadline: 0, time: now - 200 * day },
      { id: 'recent-tbd', title: '本周无截止测验', type: 'exam', deadline: 0, start_time: now - 2 * day },
      { id: 'handed-in', title: '实验四提交入口', type: 'exam', deadline: now - 2 * day, ext: { exam_status: '已交卷' } },
      { id: 'completed-flag', title: '已完成习题', type: 'quiz', deadline: now - 1 * day, is_completed: 1 },
    ];
    const items = normalizeHomework(rows, origin, { id: 'dsp', name: '数字信号处理' }, now);
    expect(items.find(i => i.id === 'handed-in')?.status).toBe('submitted');
    expect(items.find(i => i.id === 'completed-flag')?.status).toBe('submitted');

    const filtered = ddlService.filterItemsByAge(items, { maxOverdueDays: 100, maxTbdAgeDays: 100 }, now);
    expect(filtered.map(i => i.id)).not.toContain('old-overdue');
    expect(filtered.map(i => i.id)).not.toContain('old-tbd');
    expect(filtered.map(i => i.id)).toContain('recent-overdue');
    expect(filtered.map(i => i.id)).toContain('recent-tbd');
    expect(filtered.map(i => i.id)).toContain('handed-in');

    // Setting limits to 0 disables age filtering
    const unfiltered = ddlService.filterItemsByAge(items, { maxOverdueDays: 0, maxTbdAgeDays: 0 }, now);
    expect(unfiltered).toHaveLength(6);
  });

  it('recognizes Yuketang v2 learn-log numeric types (4=homework, 5=exam) and status codes (2=submitted, 3=graded, 0/1=pending)', () => {
    const cjOrigin = 'https://changjiang.yuketang.cn';
    const logs = [
      { id: '1', title: 'DSPch2', type: 5, status: 3, score: 55, total_score: 55, unfinished: 0, deadline: now - 3_600_000 },
      { id: '2', title: '期末考试', type: 5, status: 2, score: null, total_score: 100, unfinished: 0, deadline: now - 3_600_000 },
      { id: '3', title: '第三章作业', type: 4, status: 3, score: 99, total_score: 100, deadline: now - 3_600_000 },
      { id: '4', title: '第七章作业', type: 4, status: 1, score: null, total_score: 100, deadline: now + 3_600_000 },
      { id: '5', title: 'DSPch6', type: 5, status: 0, score: null, total_score: 15, unfinished: 5, deadline: 0 },
      { id: '6', title: 'Multisim学习-共射放大电路', type: 14, create_time: now - 3_600_000, deadline: 0 },
      { id: '7', title: '课程通知公告', type: 15, create_time: now - 3_600_000 },
      { id: '8', title: '自学视频资料', type: 19, create_time: now - 3_600_000, deadline: null },
      { id: '9', title: '带截止时间的学习任务', type: 19, create_time: now - 3_600_000, deadline: now + 7_200_000 },
    ];
    const items = normalizeHomework(logs, cjOrigin, { id: 'dsp', classroomId: '999', name: '数字信号处理' }, now);
    expect(items.find(i => i.id === '1')).toMatchObject({ type: 'exam', status: 'submitted', summary: '得分：55 / 55', url: cjOrigin + '/v2/web/studentLog/999' });
    expect(items.find(i => i.id === '2')).toMatchObject({ type: 'exam', status: 'submitted' });
    expect(items.find(i => i.id === '3')).toMatchObject({ type: 'homework', status: 'submitted', summary: '得分：99 / 100' });
    expect(items.find(i => i.id === '4')).toMatchObject({ type: 'homework', status: 'pending' });
    expect(items.find(i => i.id === '5')).toMatchObject({ type: 'exam', status: 'pending', deadline: null });
    expect(items.find(i => i.id === '6')).toBeUndefined();
    expect(items.find(i => i.id === '7')).toBeUndefined();
    expect(items.find(i => i.id === '8')).toBeUndefined();
    expect(items.find(i => i.id === '9')).toMatchObject({ status: 'pending', url: cjOrigin + '/v2/web/studentLog/999' });
  });
});
