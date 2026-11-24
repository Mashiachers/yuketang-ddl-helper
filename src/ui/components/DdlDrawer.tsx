import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime, getItemKey, getUrgencyLevel } from '../../core';
import type { HomeworkItem, UrgencyLevel } from '../../types';
import type { DdlAppController } from '../hooks/useDdlApp';
import { EXPORT_MODE_OPTIONS, useResourceCenter } from '../hooks/useResourceCenter';
import { estimateTokens, formatRelativeTime } from '../utils/format';
import { AiWorkflowPanel, type AiWorkflowSubTab } from './AiWorkflowPanel';
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  LayersIcon,
  MoonIcon,
  PackageIcon,
  RefreshIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  StopCircleIcon,
  SunIcon,
} from './Icons';
import { ResourceCenterPanel } from './ResourceCenterPanel';
import { SettingsPanel } from './SettingsPanel';
import { TaskCard } from './TaskCard';

const URGENCY_GROUP_META: Record<UrgencyLevel, { title: string; color: string; order: number }> = {
  critical: { title: '24 小时内高危预警', color: 'var(--critical)', order: 0 },
  warning: { title: '3 天内即将截止', color: 'var(--warning-bar)', order: 1 },
  normal: { title: '近期计划任务', color: 'var(--normal-bar)', order: 2 },
  tbd: { title: '暂未设截止时间（老师后续可能补设）', color: 'var(--tbd-bar)', order: 3 },
  overdue: { title: '已逾期（请确认是否可补交）', color: 'var(--overdue)', order: 4 },
  submitted: { title: '已提交 / 本地已划掉', color: 'var(--success-bar)', order: 5 },
};

const PAGE_SIZE = 40;

export function DdlDrawer({ app }: { app: DdlAppController }) {
  const rc = useResourceCenter(app);
  const [aiSubTab, setAiSubTab] = useState<AiWorkflowSubTab>('export');
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!app.isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') app.setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [app]);

  // Reset pagination when filter/search/grouping changes
  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [app.filterTab, app.courseFilter, app.searchQuery, app.groupBy]);

  const totalFiltered = app.filteredItems.length;
  const visibleItems = useMemo(
    () => app.filteredItems.slice(0, visibleLimit),
    [app.filteredItems, visibleLimit],
  );
  const hasMore = visibleLimit < totalFiltered;

  useEffect(() => {
    if (!hasMore || !loadMoreRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisibleLimit(prev => Math.min(totalFiltered, prev + PAGE_SIZE));
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, totalFiltered]);

  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; title: string; color: string; order: number; items: HomeworkItem[] }>();
    for (const item of visibleItems) {
      if (app.groupBy === 'course') {
        const key = item.courseId;
        const existing = map.get(key);
        if (existing) existing.items.push(item);
        else map.set(key, { key, title: item.courseName, color: 'var(--accent)', order: 0, items: [item] });
      } else {
        const u = getUrgencyLevel(item, app.now);
        const meta = URGENCY_GROUP_META[u];
        const existing = map.get(u);
        if (existing) existing.items.push(item);
        else map.set(u, { key: u, title: meta.title, color: meta.color, order: meta.order, items: [item] });
      }
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  }, [visibleItems, app.groupBy, app.now]);

  const sourcePill =
    app.syncResult?.source === 'demo'
      ? { text: '演示模式', cls: 'demo' }
      : app.syncResult?.source === 'import'
        ? { text: 'JSON 导入', cls: 'import' }
        : { text: app.platform.label, cls: '' };

  const progressPct =
    app.progress && app.progress.total > 0
      ? Math.min(100, Math.round((app.progress.completed / app.progress.total) * 100))
      : 15;

  const selectedCount = app.selectedItems.length;
  const actionCount = selectedCount || app.filteredItems.length;
  const promptChars = app.promptPreviewText.length;
  const promptTokens = useMemo(() => estimateTokens(app.promptPreviewText), [app.promptPreviewText]);
  const deadlineChangeMap = useMemo(
    () => new Map(app.deadlineChanges.map(change => [change.key, change])),
    [app.deadlineChanges],
  );

  const otherItemsCount = app.effectiveItems.length - app.filteredItems.length;
  const showGentleFooterHint =
    !app.loading &&
    app.filteredItems.length > 0 &&
    app.filteredItems.length <= 4 &&
    app.filterTab !== 'all' &&
    otherItemsCount > 0;

  const isHeaderRefreshing =
    app.view === 'resources'
      ? rc.loading
      : app.view === 'prompt'
        ? app.loading || rc.loading
        : app.loading;

  const handleHeaderRefresh = () => {
    if (app.view === 'resources') {
      void rc.refreshResources(true);
    } else if (app.view === 'prompt') {
      void Promise.all([app.syncNow({ force: true }), rc.refreshResources(true)]);
    } else {
      void app.syncNow({ force: true });
    }
  };

  const activeExportModeMeta =
    EXPORT_MODE_OPTIONS.find(m => m.id === rc.exportMode) ?? EXPORT_MODE_OPTIONS[0];
  const resourceNewCount = rc.stats.newCount + rc.stats.updatedCount;

  return (
    <>
      <div
        className={`ykt-backdrop${app.isOpen ? ' open' : ''}`}
        onClick={() => app.setIsOpen(false)}
      />

      <aside
        className={`ykt-drawer${app.isOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="雨课堂 DDL 助手面板"
      >
        <header className="ykt-header">
          <div className="ykt-brand">
            <div className="ykt-brand-mark">
              <CalendarIcon size={16} />
            </div>
            <div className="ykt-brand-text">
              <div className="ykt-brand-title">
                <span>雨课堂 DDL 助手</span>
                <span className={`ykt-platform-pill ${sourcePill.cls}`}>
                  <span className="ykt-status-dot" aria-hidden="true" />
                  {sourcePill.text}
                </span>
              </div>
              <div
                className="ykt-brand-meta tabular"
                title={app.syncResult ? `完整更新时间：${formatDateTime(app.syncResult.syncedAt)}` : undefined}
              >
                {app.syncResult
                  ? formatRelativeTime(app.syncResult.syncedAt, app.now)
                  : '本地运行 · 零密码托管'}
              </div>
            </div>
          </div>

          <div className="ykt-header-actions">
            <button
              type="button"
              className="ykt-icon-btn"
              title={app.resolvedTheme === 'dark' ? '切换浅色外观' : '切换深色外观'}
              aria-label={app.resolvedTheme === 'dark' ? '切换浅色外观' : '切换深色外观'}
              onClick={() => void app.cycleTheme()}
            >
              {app.resolvedTheme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
            </button>
            <button
              type="button"
              className="ykt-icon-btn"
              title={
                isHeaderRefreshing
                  ? '正在同步课程数据…'
                  : app.view === 'resources'
                    ? '强制刷新课程资源'
                    : '强制刷新课程作业与资源'
              }
              aria-label="强制刷新课程数据"
              aria-busy={isHeaderRefreshing}
              disabled={isHeaderRefreshing}
              onClick={handleHeaderRefresh}
            >
              <RefreshIcon size={15} className={isHeaderRefreshing ? 'ykt-spin' : undefined} />
            </button>
            <button
              type="button"
              className="ykt-icon-btn"
              title="关闭面板 (Esc)"
              aria-label="关闭面板"
              onClick={() => app.setIsOpen(false)}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </header>

        <nav className="ykt-tabs" aria-label="视图切换">
          <button
            type="button"
            className={`ykt-tab${app.view === 'board' ? ' active' : ''}`}
            onClick={() => app.setView('board')}
          >
            <CalendarIcon size={14} /> 待办看板
          </button>
          <button
            type="button"
            className={`ykt-tab${app.view === 'resources' ? ' active' : ''}`}
            onClick={() => app.setView('resources')}
          >
            <FolderIcon size={14} /> 课程资源
            {resourceNewCount > 0 && (
              <span className="ykt-tab-badge tabular" aria-label={`${resourceNewCount} 项新增或更新`}>
                {resourceNewCount > 99 ? '99+' : resourceNewCount}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`ykt-tab${app.view === 'prompt' ? ' active' : ''}`}
            onClick={() => app.setView('prompt')}
          >
            <SparklesIcon size={14} /> AI 工作流
          </button>
          <button
            type="button"
            className={`ykt-tab${app.view === 'settings' ? ' active' : ''}`}
            onClick={() => app.setView('settings')}
          >
            <SettingsIcon size={14} /> 设置
          </button>
        </nav>

        <div className="ykt-body">
          {app.view === 'board' && (
            <>
              <div className="ykt-stats" role="group" aria-label="按任务状态筛选">
                <button
                  type="button"
                  aria-pressed={app.filterTab === 'urgent'}
                  className={`ykt-stat-card critical${app.filterTab === 'urgent' ? ' active' : ''}`}
                  onClick={() => app.setFilterTab(app.filterTab === 'urgent' ? 'pending' : 'urgent')}
                >
                  <span className="ykt-stat-dot" style={{ background: 'var(--critical)' }} aria-hidden="true" />
                  <div className="ykt-stat-num critical tabular">{app.stats.urgent}</div>
                  <div className="ykt-stat-label">24h 紧急</div>
                </button>
                <button
                  type="button"
                  aria-pressed={app.filterTab === 'pending'}
                  className={`ykt-stat-card${app.filterTab === 'pending' ? ' active' : ''}`}
                  onClick={() => app.setFilterTab('pending')}
                >
                  <span className="ykt-stat-dot" style={{ background: 'var(--accent)' }} aria-hidden="true" />
                  <div className="ykt-stat-num accent tabular">{app.stats.pending}</div>
                  <div className="ykt-stat-label">全部未交</div>
                </button>
                <button
                  type="button"
                  aria-pressed={app.filterTab === 'overdue'}
                  className={`ykt-stat-card overdue${app.filterTab === 'overdue' ? ' active' : ''}`}
                  onClick={() => app.setFilterTab(app.filterTab === 'overdue' ? 'pending' : 'overdue')}
                >
                  <span className="ykt-stat-dot" style={{ background: 'var(--overdue)' }} aria-hidden="true" />
                  <div className="ykt-stat-num overdue tabular">{app.stats.expired}</div>
                  <div className="ykt-stat-label">已逾期</div>
                </button>
                <button
                  type="button"
                  aria-pressed={app.filterTab === 'submitted'}
                  className={`ykt-stat-card submitted${app.filterTab === 'submitted' ? ' active' : ''}`}
                  onClick={() => app.setFilterTab(app.filterTab === 'submitted' ? 'pending' : 'submitted')}
                >
                  <span className="ykt-stat-dot" style={{ background: 'var(--success-bar)' }} aria-hidden="true" />
                  <div className="ykt-stat-num success tabular">{app.stats.submitted}</div>
                  <div className="ykt-stat-label">已完成</div>
                </button>
              </div>

              {app.loading && app.progress && (
                <div className="ykt-banner info">
                  <div className="ykt-banner-row tabular">
                    <span>
                      {app.progress.stage === 'courses'
                        ? '正在拉取当前学期课程列表…'
                        : `正在低并发扫描课程作业 (${app.progress.completed}/${app.progress.total})…`}
                    </span>
                    <span>{progressPct}%</span>
                  </div>
                  <div className="ykt-progress-bar">
                    <div className="ykt-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}

              {app.deadlineChanges.length > 0 && (
                <div className="ykt-banner info">
                  <div className="ykt-banner-row">
                    <strong>发现 {app.deadlineChanges.length} 项任务截止时间变动</strong>
                    <button type="button" className="ykt-link-btn" onClick={app.dismissDeadlineChanges}>
                      知道了
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {app.deadlineChanges.slice(0, 4).map(change => (
                      <div key={change.key} className="tabular">
                        · {change.courseName}「{change.title}」
                        {change.kind === 'newly-set' ? '新设截止：' : '调整为：'}
                        {formatDateTime(change.newDeadline)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {app.syncError && (
                <div className="ykt-banner error">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <AlertTriangleIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{app.syncError}</span>
                  </div>
                  <div className="ykt-banner-actions">
                    <button
                      type="button"
                      className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                      disabled={app.loading}
                      onClick={() => void app.syncNow({ force: true })}
                    >
                      重试同步
                    </button>
                    {!app.settings.useDemoMode && (
                      <button
                        type="button"
                        className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                        onClick={() => void app.toggleDemoMode()}
                      >
                        切换演示模式
                      </button>
                    )}
                    <button
                      type="button"
                      className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                      onClick={app.openDiagnostics}
                    >
                      查看诊断
                    </button>
                  </div>
                </div>
              )}

              <div className="ykt-filters">
                <div className="ykt-search-row">
                  <div className="ykt-search-box">
                    <span className="ykt-search-icon">
                      <SearchIcon size={13} />
                    </span>
                    <input
                      type="search"
                      className="ykt-input"
                      aria-label="搜索课程名或作业标题"
                      placeholder="搜索课程名或作业标题…"
                      value={app.searchQuery}
                      onChange={e => app.setSearchQuery(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="按课程筛选"
                    className="ykt-select"
                    value={app.courseFilter}
                    onChange={e => app.setCourseFilter(e.target.value)}
                  >
                    <option value="all">全部课程 ({app.courses.length})</option>
                    {app.courses.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="ykt-toolbar-row">
                  <button
                    type="button"
                    className={`ykt-pill-btn tabular${app.filterTab === 'all' ? ' active' : ''}`}
                    aria-pressed={app.filterTab === 'all'}
                    onClick={() => app.setFilterTab(app.filterTab === 'all' ? 'pending' : 'all')}
                  >
                    显示全部 ({app.effectiveItems.length})
                  </button>

                  <button
                    type="button"
                    className="ykt-link-btn"
                    title="切换按紧急度或按课程分组"
                    onClick={() => app.setGroupBy(app.groupBy === 'urgency' ? 'course' : 'urgency')}
                  >
                    <LayersIcon size={12} />
                    {app.groupBy === 'urgency' ? '按课程分组' : '按紧急度分组'}
                  </button>
                </div>
              </div>

              {app.loading && !app.syncResult ? (
                <div className="ykt-group" aria-label="正在加载任务列表">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="ykt-skeleton-card">
                      <div className="ykt-skeleton-line" style={{ width: '42%' }} />
                      <div className="ykt-skeleton-line" style={{ width: '82%', height: 15 }} />
                      <div className="ykt-skeleton-line" style={{ width: '56%' }} />
                    </div>
                  ))}
                </div>
              ) : grouped.length === 0 ? (
                <div className="ykt-empty">
                  <CalendarIcon size={28} style={{ color: 'var(--text-muted)' }} />
                  <div className="ykt-empty-title">当前筛选下没有任务</div>
                  <div style={{ fontSize: 12 }}>
                    {app.effectiveItems.length === 0
                      ? '可点击右上角刷新，或在设置中开启演示模式预览。'
                      : '尝试点击上方统计卡片，或切换「显示全部」查看更多任务。'}
                  </div>
                  {app.effectiveItems.length > 0 && app.filterTab !== 'all' && (
                    <button
                      type="button"
                      className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                      onClick={() => {
                        app.setFilterTab('all');
                        app.setCourseFilter('all');
                        app.setSearchQuery('');
                      }}
                    >
                      查看全部 {app.effectiveItems.length} 项任务
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {grouped.map(group => (
                    <section key={group.key} className="ykt-group">
                      <div className="ykt-group-header">
                        <span>
                          <span className="ykt-group-dot" style={{ background: group.color }} />
                          {group.title}
                        </span>
                        <span className="tabular">{group.items.length} 项</span>
                      </div>
                      {group.items.map(item => {
                        const key = getItemKey(item);
                        return (
                          <TaskCard
                            key={key}
                            item={item}
                            now={app.now}
                            selected={app.selectedKeys.has(key)}
                            isLocallyCompleted={app.overrides.completedIds.includes(key)}
                            deadlineChange={deadlineChangeMap.get(key)}
                            onToggleSelect={app.toggleSelect}
                            onToggleComplete={i => void app.toggleComplete(i)}
                            onToggleIgnore={i => void app.toggleIgnore(i)}
                            onSetCustomDeadline={(i, d) => void app.setCustomDeadline(i, d)}
                          />
                        );
                      })}
                    </section>
                  ))}

                  {hasMore && (
                    <div ref={loadMoreRef} className="ykt-list-end">
                      <span className="tabular">
                        已渲染 {visibleItems.length} / {totalFiltered} 项
                      </span>
                      <button
                        type="button"
                        className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                        onClick={() => setVisibleLimit(prev => prev + PAGE_SIZE)}
                      >
                        加载更多（剩余 {totalFiltered - visibleItems.length} 项）
                      </button>
                    </div>
                  )}

                  {showGentleFooterHint && (
                    <div className="ykt-list-end">
                      <span>
                        已显示当前分类全部 {app.filteredItems.length} 项任务
                      </span>
                      <button
                        type="button"
                        className="ykt-link-btn"
                        onClick={() => app.setFilterTab('all')}
                      >
                        切换到「全部 ({app.effectiveItems.length})」查看更多
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {app.view === 'resources' && <ResourceCenterPanel app={app} rc={rc} />}
          {app.view === 'prompt' && (
            <AiWorkflowPanel app={app} rc={rc} subTab={aiSubTab} onSubTabChange={setAiSubTab} />
          )}
          {app.view === 'settings' && <SettingsPanel app={app} rc={rc} />}
        </div>

        {app.view === 'board' && (
          <footer className="ykt-footer">
            <div className="ykt-footer-meta">
              <span className="tabular">
                {selectedCount > 0
                  ? `已勾选 ${selectedCount} 项任务`
                  : `未单独勾选（将作用于当前 ${actionCount} 项）`}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ykt-link-btn" onClick={app.selectPendingOnly}>
                  全选未交
                </button>
                <button type="button" className="ykt-link-btn" onClick={app.selectAllVisible}>
                  全选当前
                </button>
                {selectedCount > 0 && (
                  <button type="button" className="ykt-link-btn" onClick={app.clearSelection}>
                    清空
                  </button>
                )}
              </div>
            </div>

            <div className="ykt-footer-buttons">
              <button
                type="button"
                className="ykt-btn ykt-btn-secondary"
                disabled={actionCount === 0}
                onClick={() => void app.exportSelectedIcs()}
              >
                <DownloadIcon size={14} /> 导出日历 .ics
              </button>
              <button
                type="button"
                className={`ykt-btn ykt-btn-primary${app.copiedPrompt ? ' copied' : ''}`}
                disabled={actionCount === 0}
                onClick={() => void app.copySelectedPrompt()}
              >
                {app.copiedPrompt ? (
                  <>
                    <CheckIcon size={15} /> 已复制
                  </>
                ) : (
                  <>
                    <SparklesIcon size={14} /> 一键打包给 AI
                  </>
                )}
              </button>
            </div>
          </footer>
        )}

        {app.view === 'prompt' && aiSubTab === 'export' && (
          <footer className="ykt-footer">
            <div className="ykt-footer-meta tabular">
              <span>已选 {rc.exportCourseIds.length} 门课</span>
              <span>
                {activeExportModeMeta.name} ({activeExportModeMeta.extension})
              </span>
            </div>
            {rc.busyMode === 'export' ? (
              <button
                type="button"
                className="ykt-btn ykt-btn-secondary ykt-btn-full"
                onClick={rc.cancelActiveTask}
              >
                <StopCircleIcon size={14} /> 取消导出
              </button>
            ) : (
              <button
                type="button"
                className="ykt-btn ykt-btn-primary ykt-btn-full"
                disabled={rc.busyMode !== null || rc.exportCourseIds.length === 0 || !rc.discovery}
                onClick={() => void rc.exportBundle()}
              >
                <PackageIcon size={14} /> 一键导出{activeExportModeMeta.name}
              </button>
            )}
          </footer>
        )}

        {app.view === 'prompt' && aiSubTab === 'prompt' && (
          <footer className="ykt-footer">
            <div className="ykt-footer-meta tabular">
              <span>已包含 {actionCount} 项任务</span>
              <span>
                {promptChars} 字 · 约 {promptTokens} tokens
              </span>
            </div>
            <button
              type="button"
              className={`ykt-btn ykt-btn-primary ykt-btn-full${app.copiedPrompt ? ' copied' : ''}`}
              disabled={actionCount === 0}
              onClick={() => void app.copySelectedPrompt()}
            >
              {app.copiedPrompt ? (
                <>
                  <CheckIcon size={15} /> 已复制到剪贴板
                </>
              ) : (
                <>
                  <CopyIcon size={14} /> 复制 Prompt 给 AI
                </>
              )}
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
