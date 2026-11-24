import { useEffect, useMemo, useState } from 'react';
import {
  compareByDeadline,
  copyTextToClipboard,
  createDemoData,
  DEFAULT_SETTINGS,
  ddlService,
  formatDateTime,
  formatRemainingTime,
  getItemKey,
  getStatsSummary,
  getUrgencyLevel,
} from '../core';
import type { HomeworkItem, LocalOverrides, SyncResult, UserSettings } from '../types';
import { CalendarIcon, CheckIcon, DownloadIcon, ExternalLinkIcon, SparklesIcon } from '../ui/components/Icons';

const KNOWN_ORIGINS = [
  { label: '雨课堂主站', url: 'https://www.yuketang.cn/v2/web/index' },
  { label: '长江雨课堂', url: 'https://changjiang.yuketang.cn/v2/web/index' },
  { label: '荷塘雨课堂', url: 'https://pro.yuketang.cn/v2/web/index' },
];

export function PopupApp() {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [overrides, setOverrides] = useState<LocalOverrides>({ completedIds: [], ignoredIds: [] });
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [notice, setNotice] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    (async () => {
      const [loadedOverrides, loadedSettings] = await Promise.all([
        ddlService.getOverrides(),
        ddlService.getSettings(),
      ]);
      setOverrides(loadedOverrides);
      setSettings(loadedSettings);

      for (const site of KNOWN_ORIGINS) {
        const cached = await ddlService.getCachedResult(new URL(site.url).origin);
        if (cached) {
          setResult(cached);
          return;
        }
      }

      if (loadedSettings.useDemoMode) {
        const demo = createDemoData(Date.now(), 'https://www.yuketang.cn');
        setResult({
          origin: 'https://www.yuketang.cn',
          source: 'demo',
          syncedAt: Date.now(),
          ...demo,
          diagnostics: {
            origin: 'https://www.yuketang.cn',
            startedAt: Date.now(),
            finishedAt: Date.now(),
            endpoints: [],
            failedCourses: 0,
          },
        });
      }
    })();
  }, []);

  const effectiveItems = useMemo<HomeworkItem[]>(() => {
    if (!result) return [];
    return ddlService.filterItemsByAge(ddlService.getEffectiveItems(result.items, overrides, now), settings, now);
  }, [result, overrides, settings, now]);

  const stats = useMemo(() => getStatsSummary(effectiveItems, now), [effectiveItems, now]);

  const topPending = useMemo(() => {
    return effectiveItems
      .filter(i => {
        const u = getUrgencyLevel(i, now);
        return u === 'critical' || u === 'warning' || u === 'normal' || u === 'tbd';
      })
      .sort(compareByDeadline)
      .slice(0, 5);
  }, [effectiveItems, now]);

  const openUrl = (url: string) => {
    if (globalThis.chrome?.runtime?.id) {
      void chrome.runtime.sendMessage({ type: 'OPEN_URL', url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const loadDemoPreview = () => {
    const demo = createDemoData(Date.now(), 'https://www.yuketang.cn');
    setResult({
      origin: 'https://www.yuketang.cn',
      source: 'demo',
      syncedAt: Date.now(),
      ...demo,
      diagnostics: {
        origin: 'https://www.yuketang.cn',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        endpoints: [],
        failedCourses: 0,
      },
    });
    setNotice('已加载演示数据，可在雨课堂页面使用完整悬浮看板');
  };

  const handleExport = async () => {
    const target = topPending.length ? effectiveItems.filter(i => i.status === 'pending') : effectiveItems;
    const exportable = target.filter(i => i.deadline !== null);
    if (!exportable.length) {
      setNotice('当前任务均暂未设置截止时间，可在雨课堂页面中为其设置个人目标时间');
      return;
    }
    await ddlService.exportIcs(exportable);
    const skipped = target.length - exportable.length;
    setNotice(skipped > 0 ? `已导出 ${exportable.length} 条日历事件（跳过 ${skipped} 条未设截止任务）` : `已导出 ${exportable.length} 条日历事件 (.ics)`);
  };

  const handleCopyPrompt = async () => {
    const target = topPending.length ? effectiveItems.filter(i => i.status === 'pending') : effectiveItems;
    if (!target.length) return;
    const text = await ddlService.buildPrompt(target);
    await copyTextToClipboard(text);
    setNotice(`已复制 ${target.length} 条任务的 AI 排期 Prompt`);
  };

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div className="popup-brand">
          <div className="popup-logo">
            <CalendarIcon size={16} />
          </div>
          <div>
            <div className="popup-title">雨课堂 DDL 助手</div>
            <div className="popup-sub tabular">
              {result
                ? `${result.source === 'demo' ? '演示数据' : '最近同步'} · ${formatDateTime(result.syncedAt)}`
                : '打开任意雨课堂网页自动同步'}
            </div>
          </div>
        </div>
      </header>

      <div className="popup-stats tabular">
        <div className="popup-stat">
          <div className="popup-stat-num critical">{stats.urgent}</div>
          <div className="popup-stat-label">24h 紧急</div>
        </div>
        <div className="popup-stat">
          <div className="popup-stat-num accent">{stats.pending}</div>
          <div className="popup-stat-label">全部未交</div>
        </div>
        <div className="popup-stat">
          <div className="popup-stat-num success">{stats.submitted}</div>
          <div className="popup-stat-label">已完成</div>
        </div>
      </div>

      {notice && (
        <div className="popup-notice">
          <CheckIcon size={14} />
          <span>{notice}</span>
        </div>
      )}

      {topPending.length > 0 ? (
        <div className="popup-list">
          {topPending.map(item => {
            const urgency = getUrgencyLevel(item, now);
            return (
              <a
                key={getItemKey(item)}
                href={item.url}
                className="popup-item"
                onClick={e => {
                  e.preventDefault();
                  openUrl(item.url);
                }}
              >
                <div className="popup-item-main">
                  <div className="popup-item-course">{item.courseName}</div>
                  <div className="popup-item-title">{item.title}</div>
                  <div className="popup-item-time tabular">{formatDateTime(item.deadline)}</div>
                </div>
                <span className={`popup-pill tabular ${urgency === 'critical' ? 'critical' : urgency === 'warning' ? 'warning' : ''}`}>
                  {formatRemainingTime(item.deadline, now)}
                </span>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="popup-empty">
          <div>暂无已缓存的雨课堂未交作业</div>
          <div>请前往已登录的雨课堂页面，右下角将自动出现悬浮 DDL 助手。</div>
          <button type="button" className="popup-btn" onClick={loadDemoPreview}>
            加载演示数据预览
          </button>
        </div>
      )}

      <div className="popup-actions">
        <button
          type="button"
          className="popup-btn"
          disabled={effectiveItems.length === 0}
          onClick={() => void handleExport()}
        >
          <DownloadIcon size={14} /> 导出日历 .ics
        </button>
        <button
          type="button"
          className="popup-btn primary"
          disabled={effectiveItems.length === 0}
          onClick={() => void handleCopyPrompt()}
        >
          <SparklesIcon size={14} /> 复制给 AI
        </button>
      </div>

      <div className="popup-links">
        {KNOWN_ORIGINS.map(site => (
          <button key={site.url} type="button" className="popup-link-chip" onClick={() => openUrl(site.url)}>
            {site.label} <ExternalLinkIcon size={11} />
          </button>
        ))}
      </div>
    </div>
  );
}
