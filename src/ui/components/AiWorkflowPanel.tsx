import { useMemo, useState } from 'react';
import { formatDateTime } from '../../core';
import type { ExportMode } from '../../types';
import type { DdlAppController } from '../hooks/useDdlApp';
import {
  EXPORT_MODE_OPTIONS,
  formatFileSize,
  isMaterialDownloadable,
  type ResourceCenterController,
} from '../hooks/useResourceCenter';
import { formatRelativeTime } from '../utils/format';
import {
  AlertTriangleIcon,
  BookOpenIcon,
  CheckIcon,
  CodeIcon,
  FileTextIcon,
  PackageIcon,
  RefreshIcon,
  SparklesIcon,
  StopCircleIcon,
} from './Icons';
import { PromptPanel } from './PromptPanel';

export type AiWorkflowSubTab = 'export' | 'prompt';

interface AiWorkflowPanelProps {
  app: DdlAppController;
  rc: ResourceCenterController;
  subTab?: AiWorkflowSubTab;
  onSubTabChange?: (tab: AiWorkflowSubTab) => void;
}

function ModeIcon({ mode }: { mode: ExportMode }) {
  switch (mode) {
    case 'knowledge-base':
      return <PackageIcon size={14} />;
    case 'notebooklm':
      return <BookOpenIcon size={14} />;
    case 'ai-context':
      return <SparklesIcon size={14} />;
    case 'json-only':
      return <CodeIcon size={14} />;
    case 'markdown-only':
      return <FileTextIcon size={14} />;
  }
}

export function AiWorkflowPanel({ app, rc, subTab, onSubTabChange }: AiWorkflowPanelProps) {
  const [internalSubTab, setInternalSubTab] = useState<AiWorkflowSubTab>('export');
  const activeSubTab = subTab ?? internalSubTab;
  const setSubTab = onSubTabChange ?? setInternalSubTab;

  const selectedCourseSet = useMemo(() => new Set(rc.exportCourseIds), [rc.exportCourseIds]);

  const courseStats = useMemo(() => {
    const map = new Map<string, { materials: number; tasks: number }>();
    for (const c of rc.courses) map.set(c.id, { materials: 0, tasks: 0 });
    for (const m of rc.materials) {
      const entry = map.get(m.courseId) ?? { materials: 0, tasks: 0 };
      entry.materials++;
      map.set(m.courseId, entry);
    }
    for (const a of rc.assignments) {
      const entry = map.get(a.courseId) ?? { materials: 0, tasks: 0 };
      entry.tasks++;
      map.set(a.courseId, entry);
    }
    for (const e of rc.exams) {
      const entry = map.get(e.courseId) ?? { materials: 0, tasks: 0 };
      entry.tasks++;
      map.set(e.courseId, entry);
    }
    return map;
  }, [rc.courses, rc.materials, rc.assignments, rc.exams]);

  const coverage = useMemo(() => {
    const mats = rc.materials.filter(m => selectedCourseSet.has(m.courseId));
    const asgs = rc.assignments.filter(a => selectedCourseSet.has(a.courseId));
    const exams = rc.exams.filter(e => selectedCourseSet.has(e.courseId));
    const anns = rc.announcements.filter(a => selectedCourseSet.has(a.courseId));
    const downloadable = mats.filter(isMaterialDownloadable);
    const unavailable = mats.filter(m => !isMaterialDownloadable(m));
    const failed = mats.filter(m => m.downloadStatus === 'failed');
    const slidePackages = downloadable.filter(m => m.type === 'image_slides');
    const knownBytes = downloadable.reduce(
      (sum, m) => sum + (typeof m.size === 'number' && Number.isFinite(m.size) ? m.size : 0),
      0,
    );

    return {
      courseCount: rc.exportCourseIds.length,
      materialCount: mats.length,
      downloadableCount: downloadable.length,
      unavailableCount: unavailable.length,
      failedCount: failed.length,
      slidePackageCount: slidePackages.length,
      taskCount: asgs.length + exams.length,
      announcementCount: anns.length,
      knownBytes,
    };
  }, [rc.materials, rc.assignments, rc.exams, rc.announcements, rc.exportCourseIds.length, selectedCourseSet]);

  const activeModeMeta = useMemo(
    () => EXPORT_MODE_OPTIONS.find(m => m.id === rc.exportMode) ?? EXPORT_MODE_OPTIONS[0],
    [rc.exportMode],
  );

  const syncedTimestamp = rc.syncedAt ? Date.parse(rc.syncedAt) : Number.NaN;
  const syncTimeLabel = Number.isFinite(syncedTimestamp)
    ? `${formatRelativeTime(syncedTimestamp, app.now)}（${formatDateTime(syncedTimestamp)}）`
    : '尚未同步课程资源';

  const isBusy = rc.busyMode !== null;
  const exportPct =
    rc.downloadProgress && rc.downloadProgress.total > 0
      ? Math.min(100, Math.round((rc.downloadProgress.completed / rc.downloadProgress.total) * 100))
      : 20;

  return (
    <>
      {/* 2-Segment Sub-Tab Switch */}
      <div className="ykt-ai-segment" role="tablist" aria-label="AI 工作流子视图">
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'export'}
          className={`ykt-ai-segment-btn${activeSubTab === 'export' ? ' active' : ''}`}
          onClick={() => setSubTab('export')}
        >
          <PackageIcon size={13} /> 资料包导出
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'prompt'}
          className={`ykt-ai-segment-btn${activeSubTab === 'prompt' ? ' active' : ''}`}
          onClick={() => setSubTab('prompt')}
        >
          <SparklesIcon size={13} /> 快捷 Prompt
        </button>
      </div>

      {activeSubTab === 'prompt' ? (
        <PromptPanel app={app} />
      ) : (
        <>
          {/* Export Progress Banner */}
          {rc.downloadProgress && rc.busyMode === 'export' && (
            <div className="ykt-banner info">
              <div className="ykt-banner-row">
                <strong>正在打包导出 {activeModeMeta.name}…</strong>
                <button
                  type="button"
                  className="ykt-btn ykt-btn-secondary ykt-btn-xs"
                  onClick={rc.cancelActiveTask}
                >
                  <StopCircleIcon size={12} /> 取消
                </button>
              </div>
              {rc.downloadProgress.currentTitle && (
                <div className="ykt-res-progress-title">{rc.downloadProgress.currentTitle}</div>
              )}
              <div className="ykt-progress-bar">
                <div className="ykt-progress-fill" style={{ width: `${exportPct}%` }} />
              </div>
              <div className="ykt-banner-row tabular" style={{ fontSize: 11 }}>
                <span>
                  {rc.downloadProgress.completed}/{rc.downloadProgress.total} ({exportPct}%)
                </span>
                <span>{formatFileSize(rc.downloadProgress.bytesProcessed)}</span>
              </div>
            </div>
          )}

          {/* Inline Notice */}
          {rc.notice && (
            <div className={`ykt-banner ${rc.notice.tone === 'error' ? 'error' : 'info'}`} role="status">
              <div className="ykt-banner-row">
                <span>{rc.notice.text}</span>
                <button type="button" className="ykt-link-btn" onClick={rc.clearNotice}>
                  知道了
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Select Courses */}
          <section className="ykt-section">
            <div className="ykt-section-title">
              <span>1. 选择导出课程</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="ykt-tag tabular">
                  已选 {rc.exportCourseIds.length}/{rc.courses.length}
                </span>
                <button
                  type="button"
                  className="ykt-link-btn"
                  disabled={rc.courses.length === 0 || isBusy}
                  onClick={rc.selectAllExportCourses}
                >
                  全选
                </button>
                {rc.exportCourseIds.length > 0 && (
                  <button
                    type="button"
                    className="ykt-link-btn"
                    disabled={isBusy}
                    onClick={rc.clearExportCourses}
                  >
                    清空
                  </button>
                )}
              </div>
            </div>

            {rc.loading && !rc.discovery ? (
              <div className="ykt-skeleton-line" style={{ width: '75%', height: 26 }} />
            ) : rc.courses.length === 0 ? (
              <div className="ykt-ai-empty-inline">
                <span>暂无已同步的课程列表。</span>
                <button
                  type="button"
                  className="ykt-link-btn"
                  disabled={rc.loading}
                  onClick={() => void rc.refreshResources(true)}
                >
                  <RefreshIcon size={12} className={rc.loading ? 'ykt-spin' : undefined} /> 立即同步
                </button>
              </div>
            ) : (
              <div className="ykt-ai-course-chips" role="group" aria-label="选择要导出的课程">
                {rc.courses.map(course => {
                  const selected = selectedCourseSet.has(course.id);
                  const stat = courseStats.get(course.id);
                  return (
                    <button
                      key={course.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={isBusy}
                      className={`ykt-ai-course-chip${selected ? ' active' : ''}`}
                      onClick={() => rc.toggleExportCourse(course.id)}
                    >
                      <span className="ykt-ai-chip-check" aria-hidden="true">
                        {selected && <CheckIcon size={10} strokeWidth={3} />}
                      </span>
                      <span className="ykt-ai-chip-name">{course.name}</span>
                      {stat && (
                        <span className="ykt-ai-chip-count tabular">
                          {stat.materials} 资料
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Step 2: Select Export Mode */}
          <section className="ykt-section">
            <div className="ykt-section-title">
              <span>2. 选择导出模式</span>
              <span className="ykt-tag">{activeModeMeta.extension}</span>
            </div>

            <div className="ykt-ai-mode-list" role="radiogroup" aria-label="资料包导出模式">
              {EXPORT_MODE_OPTIONS.map(mode => {
                const active = rc.exportMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={isBusy}
                    className={`ykt-ai-mode-card${active ? ' active' : ''}`}
                    onClick={() => rc.setExportMode(mode.id)}
                  >
                    <span className="ykt-radio-dot" aria-hidden="true" />
                    <div className="ykt-ai-mode-body">
                      <div className="ykt-ai-mode-head">
                        <span className="ykt-ai-mode-name">
                          <ModeIcon mode={mode.id} />
                          {mode.name}
                        </span>
                        <span className="ykt-code-chip">{mode.extension}</span>
                      </div>
                      <div className="ykt-preset-hint">{mode.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {activeModeMeta.includesBinaries && (
              <div className="ykt-row" style={{ paddingTop: 2 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>图片课件自动合并为 PDF</div>
                  <div className="ykt-section-desc">
                    保留原始 JPEG 清晰度与页序，方便直接拖入 NotebookLM 或阅读器
                    {coverage.slidePackageCount > 0 ? `（含 ${coverage.slidePackageCount} 份图片课件）` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="切换图片课件自动合并为 PDF"
                  aria-checked={rc.mergeSlidesToPdf}
                  disabled={isBusy}
                  className={`ykt-toggle${rc.mergeSlidesToPdf ? ' on' : ''}`}
                  onClick={() => rc.setMergeSlidesToPdf(!rc.mergeSlidesToPdf)}
                />
              </div>
            )}
          </section>

          {/* Step 3: Coverage, Missing Notice & Last Sync */}
          <section className="ykt-section">
            <div className="ykt-section-title">
              <span>3. 覆盖范围与数据新鲜度</span>
              <button
                type="button"
                className="ykt-link-btn"
                disabled={rc.loading || isBusy}
                onClick={() => void rc.refreshResources(true)}
              >
                <RefreshIcon size={12} className={rc.loading ? 'ykt-spin' : undefined} /> 刷新数据
              </button>
            </div>

            <div className="ykt-ai-summary-grid tabular">
              <div className="ykt-ai-summary-cell">
                <span className="ykt-ai-summary-val">{coverage.courseCount}</span>
                <span className="ykt-ai-summary-key">门课程</span>
              </div>
              <div className="ykt-ai-summary-cell">
                <span className="ykt-ai-summary-val">{coverage.downloadableCount}</span>
                <span className="ykt-ai-summary-key">可打包资料</span>
              </div>
              <div className="ykt-ai-summary-cell">
                <span className="ykt-ai-summary-val">{coverage.taskCount}</span>
                <span className="ykt-ai-summary-key">作业/考试</span>
              </div>
              <div className="ykt-ai-summary-cell">
                <span className="ykt-ai-summary-val">{coverage.announcementCount}</span>
                <span className="ykt-ai-summary-key">课程公告</span>
              </div>
            </div>

            <div className="ykt-section-desc tabular">
              数据同步：{syncTimeLabel}
              {activeModeMeta.includesBinaries && coverage.knownBytes > 0 && (
                <> · 预估附件体积约 {formatFileSize(coverage.knownBytes)}</>
              )}
            </div>

            {(coverage.unavailableCount > 0 || coverage.failedCount > 0) && (
              <div className="ykt-ai-warning-box">
                <AlertTriangleIcon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  {coverage.unavailableCount > 0 && (
                    <div>
                      有 {coverage.unavailableCount} 项资源为仅链接/流媒体元信息（不会伪造空文件，将如实记录于{' '}
                      <span className="ykt-code-chip">manifest.json</span>）。
                    </div>
                  )}
                  {coverage.failedCount > 0 && (
                    <div>
                      另有 {coverage.failedCount} 项近期下载失败，导出时将尝试重新抓取或附带原页面授权链接。
                    </div>
                  )}
                </div>
              </div>
            )}

            {rc.lastExportManifest && rc.lastExportFilename && (
              <div className="ykt-ai-last-export tabular">
                <div style={{ fontWeight: 650, color: 'var(--text-primary)' }}>
                  最近导出：{rc.lastExportFilename}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}>
                  包含 {rc.lastExportManifest.stats.courseCount} 门课 ·{' '}
                  {rc.lastExportManifest.stats.includedMaterialCount}/{rc.lastExportManifest.stats.materialCount} 份资料 ·{' '}
                  {rc.lastExportManifest.missingItems.length} 项未抓取提醒
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
