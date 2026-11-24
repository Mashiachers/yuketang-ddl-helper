import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  compareByDeadline,
  copyTextToClipboard,
  DEFAULT_SETTINGS,
  ddlService,
  detectPlatform,
  formatAiPrompt,
  getItemKey,
  getStatsSummary,
  getUrgencyLevel,
  saveCachedResult,
} from '../../core';
import type {
  DeadlineChangeNotice,
  HomeworkItem,
  LocalOverrides,
  PlatformInfo,
  PromptPresetId,
  SyncProgress,
  SyncResult,
  UserSettings,
} from '../../types';
import { useDebouncedValue } from '../utils/format';

export type FilterTab = 'pending' | 'urgent' | 'all' | 'submitted' | 'overdue';
export type GroupByMode = 'urgency' | 'course';
export type DrawerView = 'board' | 'prompt' | 'settings';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'error';
  actionLabel?: string;
  onAction?: () => void;
}

export interface UseDdlAppOptions {
  originOverride?: string;
  defaultDemoMode?: boolean;
  defaultOpen?: boolean;
}

const FALLBACK_PLATFORM: PlatformInfo = {
  origin: 'https://www.yuketang.cn',
  host: 'www.yuketang.cn',
  variant: 'main',
  label: '雨课堂主站',
  xtbz: 'ykt',
};

export function useDdlApp(options: UseDdlAppOptions = {}) {
  const { originOverride, defaultDemoMode = false, defaultOpen = false } = options;

  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [view, setView] = useState<DrawerView>('board');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [overrides, setOverrides] = useState<LocalOverrides>({ completedIds: [], ignoredIds: [], customDeadlines: {} });
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [deadlineChanges, setDeadlineChanges] = useState<DeadlineChangeNotice[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [filterTab, setFilterTab] = useState<FilterTab>('pending');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 180);
  const [groupBy, setGroupBy] = useState<GroupByMode>('urgency');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  const platform = useMemo<PlatformInfo>(() => {
    const detected =
      detectPlatform(originOverride ?? '') ??
      detectPlatform(typeof window !== 'undefined' ? window.location.origin : '');
    return detected ?? FALLBACK_PLATFORM;
  }, [originOverride]);

  const resolvedTheme: 'light' | 'dark' =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  const showToast = useCallback(
    (
      text: string,
      opts: { tone?: 'info' | 'error'; actionLabel?: string; onAction?: () => void; durationMs?: number } = {},
    ) => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToast({
        id: Date.now(),
        text,
        tone: opts.tone ?? 'info',
        actionLabel: opts.actionLabel,
        onAction: opts.onAction,
      });
      toastTimerRef.current = window.setTimeout(() => setToast(null), opts.durationMs ?? (opts.onAction ? 5000 : 3200));
    },
    [],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const syncNow = useCallback(
    async (opts: { force?: boolean; useDemoMode?: boolean; silent?: boolean } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setSyncError(null);
      setProgress({ stage: 'courses', completed: 0, total: 1 });

      try {
        const res = await ddlService.syncTasks({
          origin: platform.origin,
          force: opts.force,
          useDemoMode: opts.useDemoMode,
          signal: controller.signal,
          onProgress: p => setProgress(p),
        });
        setSyncResult(res);
        setNow(Date.now());
        if (res.deadlineChanges?.length) {
          setDeadlineChanges(res.deadlineChanges);
        }

        if (res.diagnostics.error) {
          const msg =
            res.diagnostics.error === 'unauthorized'
              ? '未检测到有效雨课堂登录态，请先登录或切换至演示模式体验'
              : `同步遇到问题（${res.diagnostics.error}），可尝试重试或在设置中查看诊断`;
          setSyncError(msg);
        } else if (res.diagnostics.failedCourses > 0 && !opts.silent) {
          showToast(`已同步 ${res.items.length} 项任务（有 ${res.diagnostics.failedCourses} 门课拉取失败）`);
        } else if (opts.force && !opts.silent) {
          showToast(res.source === 'demo' ? '已刷新演示数据' : `同步完成，共 ${res.items.length} 项任务`);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setSyncError((err as Error)?.message || '同步失败，请稍后重试');
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
          setProgress(null);
        }
      }
    },
    [platform.origin, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [loadedSettings, loadedOverrides] = await Promise.all([
        ddlService.getSettings(),
        ddlService.getOverrides(),
      ]);
      if (cancelled) return;

      const effectiveDemo = defaultDemoMode || loadedSettings.useDemoMode;
      const mergedSettings =
        defaultDemoMode && !loadedSettings.useDemoMode
          ? { ...loadedSettings, useDemoMode: true }
          : loadedSettings;

      setSettings(mergedSettings);
      setOverrides(loadedOverrides);
      initializedRef.current = true;
      await syncNow({ useDemoMode: effectiveDemo, silent: true });
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [defaultDemoMode, platform.origin, syncNow]);

  const allActiveItems = useMemo<HomeworkItem[]>(() => {
    if (!syncResult) return [];
    return ddlService.getEffectiveItems(syncResult.items, overrides, now);
  }, [syncResult, overrides, now]);

  const effectiveItems = useMemo<HomeworkItem[]>(
    () => ddlService.filterItemsByAge(allActiveItems, settings, now),
    [allActiveItems, settings, now],
  );

  const hiddenByAgeCount = allActiveItems.length - effectiveItems.length;

  const stats = useMemo(() => getStatsSummary(effectiveItems, now), [effectiveItems, now]);

  useEffect(() => {
    if (!initializedRef.current) return;
    void ddlService.updateBadge(effectiveItems, platform.origin).catch(() => {});
  }, [effectiveItems, platform.origin]);

  useEffect(() => {
    if (!syncResult) return;
    const nowTs = Date.now();
    const pendingKeys = ddlService
      .getEffectiveItems(syncResult.items, overrides, nowTs)
      .filter(item => item.status === 'pending' && (item.deadline === null || item.deadline > nowTs))
      .map(getItemKey);
    setSelectedKeys(new Set(pendingKeys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncResult]);

  const courses = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of syncResult?.courses ?? []) map.set(c.id, c.name);
    for (const item of effectiveItems) {
      if (!map.has(item.courseId)) map.set(item.courseId, item.courseName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [syncResult?.courses, effectiveItems]);

  const filteredItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return effectiveItems
      .filter(item => {
        const urgency = getUrgencyLevel(item, now);
        if (filterTab === 'pending' && (urgency === 'submitted' || urgency === 'overdue')) return false;
        if (filterTab === 'urgent' && urgency !== 'critical') return false;
        if (filterTab === 'submitted' && urgency !== 'submitted') return false;
        if (filterTab === 'overdue' && urgency !== 'overdue') return false;
        if (courseFilter !== 'all' && item.courseId !== courseFilter) return false;
        if (q) {
          const hay = `${item.courseName} ${item.title} ${item.summary ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(compareByDeadline);
  }, [effectiveItems, filterTab, courseFilter, debouncedSearch, now]);

  const selectedItems = useMemo(
    () => effectiveItems.filter(item => selectedKeys.has(getItemKey(item))),
    [effectiveItems, selectedKeys],
  );

  const nextUpcoming = useMemo(() => {
    return (
      effectiveItems
        .filter(item => {
          const u = getUrgencyLevel(item, now);
          return u === 'critical' || u === 'warning' || u === 'normal' || u === 'tbd';
        })
        .sort(compareByDeadline)[0] ?? null
    );
  }, [effectiveItems, now]);

  const toggleSelect = useCallback((item: HomeworkItem) => {
    const key = getItemKey(item);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedKeys(new Set(filteredItems.map(getItemKey)));
  }, [filteredItems]);

  const selectPendingOnly = useCallback(() => {
    setSelectedKeys(
      new Set(
        effectiveItems
          .filter(item => {
            const u = getUrgencyLevel(item, now);
            return u === 'critical' || u === 'warning' || u === 'normal' || u === 'tbd';
          })
          .map(getItemKey),
      ),
    );
  }, [effectiveItems, now]);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const updateSettings = useCallback(async (patch: Partial<UserSettings>) => {
    const next = await ddlService.updateSettings(patch);
    setSettings(next);
    return next;
  }, []);

  const toggleDemoMode = useCallback(async () => {
    const nextDemo = !settings.useDemoMode;
    await updateSettings({ useDemoMode: nextDemo });
    await syncNow({ useDemoMode: nextDemo, force: true });
  }, [settings.useDemoMode, updateSettings, syncNow]);

  const toggleComplete = useCallback(
    async (item: HomeworkItem) => {
      const next = await ddlService.toggleItemComplete(item);
      setOverrides(next);
      const key = getItemKey(item);
      const isNowDone = next.completedIds.includes(key);
      if (isNowDone) {
        setSelectedKeys(prev => {
          const copy = new Set(prev);
          copy.delete(key);
          return copy;
        });
      }
      showToast(isNowDone ? `已标记「${item.title}」为已处理` : `已恢复「${item.title}」为待办`, {
        actionLabel: '撤销',
        onAction: () => {
          dismissToast();
          void ddlService.toggleItemComplete(item).then(setOverrides);
        },
      });
    },
    [showToast, dismissToast],
  );

  const toggleIgnore = useCallback(
    async (item: HomeworkItem) => {
      const next = await ddlService.toggleItemIgnore(item);
      setOverrides(next);
      const key = getItemKey(item);
      setSelectedKeys(prev => {
        const copy = new Set(prev);
        copy.delete(key);
        return copy;
      });
      showToast(`已隐藏「${item.title}」`, {
        actionLabel: '撤销',
        onAction: () => {
          dismissToast();
          void ddlService.toggleItemIgnore(item).then(restored => {
            setOverrides(restored);
            showToast(`已恢复显示「${item.title}」`);
          });
        },
      });
    },
    [showToast, dismissToast],
  );

  const clearIgnored = useCallback(async () => {
    let latest = overrides;
    for (const key of overrides.ignoredIds) {
      latest = await ddlService.toggleItemIgnore(key);
    }
    setOverrides(latest);
    showToast('已恢复全部隐藏任务');
  }, [overrides, showToast]);

  const setCustomDeadline = useCallback(
    async (item: HomeworkItem, deadline: number | null) => {
      const next = await ddlService.setCustomDeadline(item, deadline);
      setOverrides(next);
      showToast(
        deadline === null
          ? `已清除「${item.title}」的个人目标截止时间`
          : `已为「${item.title}」设置个人目标截止时间，现可参与倒计时与日历导出`,
      );
    },
    [showToast],
  );

  const dismissDeadlineChanges = useCallback(() => {
    setDeadlineChanges([]);
  }, []);

  const exportSelectedIcs = useCallback(async () => {
    const target = selectedItems.length ? selectedItems : filteredItems;
    if (!target.length) {
      showToast('当前没有可导出的任务', { tone: 'error' });
      return;
    }
    const exportable = target.filter(item => item.deadline !== null);
    const skipped = target.length - exportable.length;
    if (!exportable.length) {
      showToast('选中的任务均暂未设置截止时间，可先点击卡片「设目标 DDL」后再导出日历', { tone: 'error', durationMs: 4500 });
      return;
    }
    try {
      await ddlService.exportIcs(exportable, { reminders: settings.reminders });
      const msg = skipped > 0
        ? `已导出 ${exportable.length} 条日程 (.ics)，自动跳过 ${skipped} 条未设截止时间的任务`
        : `已导出 ${exportable.length} 条日程 (.ics)，可直接导入 Google / Apple 日历`;
      showToast(msg, { durationMs: skipped > 0 ? 4500 : 3200 });
    } catch (err) {
      showToast((err as Error)?.message || '日历导出失败', { tone: 'error' });
    }
  }, [selectedItems, filteredItems, settings.reminders, showToast]);

  const promptPreviewText = useMemo(() => {
    const target = selectedItems.length ? selectedItems : filteredItems;
    return formatAiPrompt(target, {
      preset: settings.promptPreset,
      customTemplate: settings.customPromptTemplate,
      freeTimeNotes: settings.freeTimeNotes,
      now,
    });
  }, [selectedItems, filteredItems, settings.promptPreset, settings.customPromptTemplate, settings.freeTimeNotes, now]);

  const copySelectedPrompt = useCallback(
    async (presetOverride?: PromptPresetId) => {
      const target = selectedItems.length ? selectedItems : filteredItems;
      if (!target.length) {
        showToast('当前没有可打包的任务', { tone: 'error' });
        return;
      }
      try {
        const text = formatAiPrompt(target, {
          preset: presetOverride ?? settings.promptPreset,
          customTemplate: settings.customPromptTemplate,
          freeTimeNotes: settings.freeTimeNotes,
          now,
        });
        await copyTextToClipboard(text);
        if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
        setCopiedPrompt(true);
        copyTimerRef.current = window.setTimeout(() => setCopiedPrompt(false), 2000);
        showToast(`已复制 ${target.length} 条任务的 AI 规划 Prompt`);
      } catch (err) {
        showToast((err as Error)?.message || '复制失败，请检查剪贴板权限', { tone: 'error' });
      }
    },
    [selectedItems, filteredItems, settings, now, showToast],
  );

  const importJson = useCallback(
    async (rawText: string) => {
      try {
        const parsed = JSON.parse(rawText);
        const imported = ddlService.importRawJson(parsed, platform.origin);
        if (!imported.items.length) {
          showToast('JSON 解析成功，但未识别到有效作业条目', { tone: 'error' });
          return false;
        }
        await saveCachedResult(imported);
        setSyncResult(imported);
        setSyncError(null);
        setView('board');
        showToast(`已导入 ${imported.items.length} 条任务数据`);
        return true;
      } catch (err) {
        showToast(`JSON 格式无效：${(err as Error)?.message ?? '请检查粘贴内容'}`, { tone: 'error' });
        return false;
      }
    },
    [platform.origin, showToast],
  );

  const copyStatusHintSample = useCallback(async () => {
    const pool = selectedItems.length ? selectedItems : filteredItems.length ? filteredItems : effectiveItems;
    const sample = pool
      .filter(item => item.rawStatusHint)
      .slice(0, 12)
      .map(item => {
        let urlPattern = '';
        if (item.url) {
          try {
            urlPattern = new URL(item.url).pathname.replace(/\d+/g, '{id}');
          } catch {
            urlPattern = '';
          }
        }
        return {
          title: item.title,
          status: item.status,
          type: item.type,
          rawType: item.rawType,
          urlPattern,
          deadline: item.deadline,
          startTime: item.startTime,
          rawStatusHint: item.rawStatusHint,
        };
      });
    if (!sample.length) {
      showToast('当前没有可复制的接口字段样本（请先在真实雨课堂页面刷新同步）', { tone: 'error' });
      return;
    }
    try {
      await copyTextToClipboard(JSON.stringify(sample, null, 2));
      const scopeLabel = selectedItems.length ? '已勾选的 ' : '';
      showToast(`已复制${scopeLabel}${sample.length} 条任务的脱敏状态字段样本，可直接发给开发者排查`);
    } catch {
      showToast('复制失败，请检查剪贴板权限', { tone: 'error' });
    }
  }, [selectedItems, filteredItems, effectiveItems, showToast]);

  const openDiagnostics = useCallback(() => {
    setAdvancedOpen(true);
    setView('settings');
  }, []);

  const cycleTheme = useCallback(async () => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark';
    await updateSettings({ theme: next });
  }, [resolvedTheme, updateSettings]);

  return {
    isOpen,
    setIsOpen,
    view,
    setView,
    advancedOpen,
    setAdvancedOpen,
    openDiagnostics,
    platform,
    resolvedTheme,
    settings,
    updateSettings,
    overrides,
    syncResult,
    deadlineChanges,
    dismissDeadlineChanges,
    setCustomDeadline,
    loading,
    progress,
    syncError,
    now,
    stats,
    courses,
    effectiveItems,
    hiddenByAgeCount,
    filteredItems,
    selectedKeys,
    selectedItems,
    nextUpcoming,
    filterTab,
    setFilterTab,
    courseFilter,
    setCourseFilter,
    searchQuery,
    setSearchQuery,
    groupBy,
    setGroupBy,
    toast,
    dismissToast,
    copiedPrompt,
    promptPreviewText,
    syncNow,
    toggleDemoMode,
    toggleSelect,
    selectAllVisible,
    selectPendingOnly,
    clearSelection,
    toggleComplete,
    toggleIgnore,
    clearIgnored,
    exportSelectedIcs,
    copySelectedPrompt,
    copyStatusHintSample,
    importJson,
    cycleTheme,
  };
}

export type DdlAppController = ReturnType<typeof useDdlApp>;
