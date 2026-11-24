import { useMemo, useState } from 'react';
import { formatDateTime } from '../../core';
import type { CourseMaterial, DownloadProgress, MaterialType } from '../../types';
import type { DdlAppController } from '../hooks/useDdlApp';
import {
  DOWNLOAD_STATUS_LABELS,
  formatFileSize,
  isMaterialDownloadable,
  isSafeHttpUrl,
  MATERIAL_TYPE_LABELS,
  type ResourceCenterController,
} from '../hooks/useResourceCenter';
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FlaskIcon,
  FolderIcon,
  MegaphoneIcon,
  PackageIcon,
  PaperclipIcon,
  PresentationIcon,
  RefreshIcon,
  SearchIcon,
  StopCircleIcon,
  VideoIcon,
} from './Icons';

interface ResourceCenterPanelProps {
  app: DdlAppController;
  rc: ResourceCenterController;
}

const ORDERED_TYPE_PILLS: readonly MaterialType[] = [
  'image_slides',
  'slides',
  'pdf',
  'ppt',
  'document',
  'attachment',
  'announcement_attachment',
  'video_meta',
  'other',
];

function renderPhaseLabel(phase: DownloadProgress['phase']): string {
  switch (phase) {
    case 'fetching':
      return '正在拉取课程资源…';
    case 'converting-pdf':
      return '正在将图片课件合并为 PDF…';
    case 'packaging-zip':
      return '正在打包课程资料包…';
    case 'cancelled':
      return '任务已取消';
    case 'done':
      return '处理完成';
    default:
      return '正在处理…';
  }
}

function MaterialTypeIcon({ type }: { type: MaterialType }) {
  switch (type) {
    case 'slides':
    case 'image_slides':
    case 'ppt':
      return <PresentationIcon size={12} />;
    case 'pdf':
    case 'document':
      return <FileTextIcon size={12} />;
    case 'attachment':
    case 'announcement_attachment':
      return <PaperclipIcon size={12} />;
    case 'video_meta':
      return <VideoIcon size={12} />;
    default:
      return <FolderIcon size={12} />;
  }
}

function formatIsoTimeShort(iso?: string): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return formatDateTime(ts);
}

export function ResourceCenterPanel({ app, rc }: ResourceCenterPanelProps) {
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);

  const courseCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of rc.materials) {
      map.set(m.courseId, (map.get(m.courseId) ?? 0) + 1);
    }
    return map;
  }, [rc.materials]);

  const typeCounts = useMemo(() => {
    const pool =
      rc.selectedCourseId === 'all'
        ? rc.materials
        : rc.materials.filter(m => m.courseId === rc.selectedCourseId);
    const map = new Map<MaterialType, number>();
    for (const m of pool) {
      map.set(m.type, (map.get(m.type) ?? 0) + 1);
    }
    return map;
  }, [rc.materials, rc.selectedCourseId]);

  const visibleTypePills = useMemo(() => {
    const coreDefaults: MaterialType[] = ['image_slides', 'pdf', 'ppt', 'document', 'attachment'];
    return ORDERED_TYPE_PILLS.filter(t => (typeCounts.get(t) ?? 0) > 0 || coreDefaults.includes(t));
  }, [typeCounts]);

  const downloadableVisibleCount = useMemo(
    () => rc.filteredMaterials.filter(isMaterialDownloadable).length,
    [rc.filteredMaterials],
  );

  const selectedCount = rc.selectedResourceKeys.size;
  const batchTargetCount = selectedCount > 0 ? selectedCount : downloadableVisibleCount;
  const isBusy = rc.busyMode !== null;

  const progressPct = useMemo(() => {
    if (!rc.downloadProgress || rc.downloadProgress.total <= 0) return 15;
    return Math.min(100, Math.round((rc.downloadProgress.completed / rc.downloadProgress.total) * 100));
  }, [rc.downloadProgress]);

  const syncPct = useMemo(() => {
    if (!rc.syncProgress || rc.syncProgress.total <= 0) return 20;
    return Math.min(100, Math.round((rc.syncProgress.completed / rc.syncProgress.total) * 100));
  }, [rc.syncProgress]);

  const newOrUpdatedCount = rc.stats.newCount + rc.stats.updatedCount;

  const handleQuickExportCourse = () => {
    const targetCourses =
      rc.selectedCourseId !== 'all' ? [rc.selectedCourseId] : rc.courses.map(c => c.id);
    void rc.exportBundle('knowledge-base', targetCourses);
  };

  const renderMaterialCard = (material: CourseMaterial) => {
    const downloadable = isMaterialDownloadable(material);
    const selected = rc.selectedResourceKeys.has(material.resourceKey);
    const isDownloadingThis =
      rc.activeMaterialKey === material.resourceKey || material.downloadStatus === 'downloading';
    const safeLink = isSafeHttpUrl(material.sourceUrl) ? material.sourceUrl : undefined;
    const updatedLabel = formatIsoTimeShort(material.updatedAt ?? material.publishedAt);
    const slideCount = material.slideImages?.length ?? 0;

    return (
      <article
        key={material.resourceKey}
        className={`ykt-res-card status-${material.downloadStatus}${selected ? ' selected' : ''}`}
      >
        <button
          type="button"
          className={`ykt-checkbox${selected ? ' checked' : ''}`}
          disabled={!downloadable || isBusy}
          aria-label={selected ? `取消勾选「${material.title}」` : `勾选「${material.title}」`}
          aria-pressed={selected}
          title={downloadable ? '勾选用于批量下载' : '该资源仅支持在原页面查看'}
          onClick={() => rc.toggleSelectResource(material.resourceKey)}
        >
          {selected && <CheckIcon size={11} strokeWidth={2.8} />}
        </button>

        <div className="ykt-res-main">
          <div className="ykt-card-tags">
            {material.courseName && (
              <span className="ykt-tag course" title={material.courseName}>
                {material.courseName}
              </span>
            )}
            <span className="ykt-tag ykt-res-type-tag">
              <MaterialTypeIcon type={material.type} />
              {MATERIAL_TYPE_LABELS[material.type]}
            </span>
            {material.isNew && <span className="ykt-tag ykt-tag-new">新增</span>}
            {material.experimental && (
              <span
                className="ykt-tag ykt-tag-exp"
                title="来自尚未在全部高校分支实测验证的实验性接口，如结果异常可在设置中查看诊断"
              >
                <FlaskIcon size={10} /> 实验接口
              </span>
            )}
            <span className={`ykt-tag ykt-status-pill status-${material.downloadStatus}`}>
              {DOWNLOAD_STATUS_LABELS[material.downloadStatus]}
            </span>
          </div>

          <div className="ykt-card-title">{material.title}</div>

          {material.chapterTitle && <div className="ykt-res-chapter">{material.chapterTitle}</div>}

          <div className="ykt-res-footer">
            <div className="ykt-res-meta tabular">
              <span>
                {material.size !== undefined
                  ? formatFileSize(material.size)
                  : slideCount > 0
                    ? `${slideCount} 页图片课件`
                    : material.type === 'video_meta'
                      ? '流媒体元信息'
                      : '大小未知'}
              </span>
              {slideCount > 0 && material.size !== undefined && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{slideCount} 页</span>
                </>
              )}
              {updatedLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{updatedLabel}</span>
                </>
              )}
            </div>

            <div className="ykt-res-ops">
              {downloadable && (
                <button
                  type="button"
                  className="ykt-btn ykt-btn-secondary ykt-btn-xs"
                  disabled={isBusy}
                  title={
                    material.type === 'image_slides' && rc.mergeSlidesToPdf
                      ? '下载图片课件并合并为单个 PDF'
                      : material.downloadStatus === 'downloaded'
                        ? '重新下载此文件'
                        : '下载此文件到本地'
                  }
                  onClick={() => void rc.downloadSingle(material)}
                >
                  <DownloadIcon size={12} className={isDownloadingThis ? 'ykt-spin' : undefined} />
                  {isDownloadingThis
                    ? '下载中'
                    : material.type === 'image_slides' && rc.mergeSlidesToPdf
                      ? '合 PDF'
                      : material.downloadStatus === 'downloaded'
                        ? '重下'
                        : '下载'}
                </button>
              )}
              {safeLink && (
                <a
                  href={safeLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ykt-op-btn"
                  title="在新标签页打开雨课堂已授权原页面"
                  aria-label={`在雨课堂打开「${material.title}」`}
                >
                  <ExternalLinkIcon size={14} />
                </a>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  };

  return (
    <>
      {/* 4-column Resource Stats Strip */}
      <div className="ykt-stats" role="group" aria-label="课程资源统计概览">
        <button
          type="button"
          className={`ykt-stat-card${!rc.onlyNewOrUndownloaded && rc.typeFilter === 'all' ? ' active' : ''}`}
          onClick={() => {
            rc.setOnlyNewOrUndownloaded(false);
            rc.setTypeFilter('all');
          }}
        >
          <span className="ykt-stat-dot" style={{ background: 'var(--accent)' }} aria-hidden="true" />
          <div className="ykt-stat-num accent tabular">{rc.stats.totalCount}</div>
          <div className="ykt-stat-label">全部资源</div>
        </button>

        <button
          type="button"
          aria-pressed={rc.onlyNewOrUndownloaded}
          className={`ykt-stat-card${rc.onlyNewOrUndownloaded ? ' active' : ''}`}
          title="点击筛选新增、有更新或尚未下载的资源"
          onClick={() => rc.setOnlyNewOrUndownloaded(!rc.onlyNewOrUndownloaded)}
        >
          <span className="ykt-stat-dot" style={{ background: 'var(--warning-bar)' }} aria-hidden="true" />
          <div className="ykt-stat-num tabular" style={{ color: 'var(--warning)' }}>
            {newOrUpdatedCount}
          </div>
          <div className="ykt-stat-label">新增/更新</div>
        </button>

        <div className="ykt-stat-card ykt-stat-static">
          <span className="ykt-stat-dot" style={{ background: 'var(--success-bar)' }} aria-hidden="true" />
          <div className="ykt-stat-num success tabular">{rc.stats.downloadedCount}</div>
          <div className="ykt-stat-label">已下载</div>
        </div>

        <div className="ykt-stat-card ykt-stat-static" title="仅汇总接口返回了明确体积的资源">
          <span className="ykt-stat-dot" style={{ background: 'var(--tbd-bar)' }} aria-hidden="true" />
          <div className="ykt-stat-num ykt-stat-num-sm tabular" style={{ color: 'var(--tbd)' }}>
            {rc.stats.knownTotalBytes > 0 ? formatFileSize(rc.stats.knownTotalBytes) : '—'}
          </div>
          <div className="ykt-stat-label">已知大小</div>
        </div>
      </div>

      {/* Syncing Progress Banner */}
      {rc.loading && rc.syncProgress && (
        <div className="ykt-banner info">
          <div className="ykt-banner-row tabular">
            <span>
              正在扫描课程资料目录 ({rc.syncProgress.completed}/{rc.syncProgress.total})…
            </span>
            <span>{syncPct}%</span>
          </div>
          <div className="ykt-progress-bar">
            <div className="ykt-progress-fill" style={{ width: `${syncPct}%` }} />
          </div>
        </div>
      )}

      {/* Active Download / Export Progress Banner */}
      {rc.downloadProgress && isBusy && (
        <div className="ykt-banner info">
          <div className="ykt-banner-row">
            <strong style={{ fontSize: 12 }}>{renderPhaseLabel(rc.downloadProgress.phase)}</strong>
            <button
              type="button"
              className="ykt-btn ykt-btn-secondary ykt-btn-xs"
              onClick={rc.cancelActiveTask}
            >
              <StopCircleIcon size={12} /> 取消
            </button>
          </div>
          {rc.downloadProgress.currentTitle && (
            <div className="ykt-res-progress-title" title={rc.downloadProgress.currentTitle}>
              {rc.downloadProgress.currentTitle}
            </div>
          )}
          <div className="ykt-progress-bar">
            <div className="ykt-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="ykt-banner-row tabular" style={{ fontSize: 11 }}>
            <span>
              进度 {rc.downloadProgress.completed}/{rc.downloadProgress.total} ({progressPct}%)
            </span>
            <span>
              已处理 {formatFileSize(rc.downloadProgress.bytesProcessed)}
              {rc.downloadProgress.failed > 0 ? ` · 失败 ${rc.downloadProgress.failed}` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Batch Result Summary Banner */}
      {rc.lastBatchResult && !isBusy && (
        <div className={`ykt-banner ${rc.lastBatchResult.failed > 0 ? 'error' : 'info'}`}>
          <div className="ykt-banner-row">
            <strong>
              {rc.lastBatchResult.cancelled ? '批量下载已取消' : '批量下载完成'} · 成功 {rc.lastBatchResult.succeeded} · 跳过{' '}
              {rc.lastBatchResult.skipped} · 失败 {rc.lastBatchResult.failed}
            </strong>
            <button type="button" className="ykt-link-btn" onClick={rc.clearLastBatchResult}>
              收起
            </button>
          </div>
          {rc.lastBatchResult.totalBytes > 0 && (
            <div className="tabular" style={{ fontSize: 11.5 }}>
              本次合计下载 {formatFileSize(rc.lastBatchResult.totalBytes)}
            </div>
          )}
          {rc.lastBatchResult.failed > 0 && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5 }}>
                {rc.lastBatchResult.items
                  .filter(i => i.status === 'failed')
                  .slice(0, 3)
                  .map(i => (
                    <div key={i.material.resourceKey}>
                      · {i.material.title}：{i.errorMessage ?? i.errorCode ?? '下载失败'}
                    </div>
                  ))}
              </div>
              <div className="ykt-banner-actions">
                <button
                  type="button"
                  className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                  disabled={rc.failedMaterials.length === 0}
                  onClick={() => void rc.retryFailed()}
                >
                  <RefreshIcon size={12} /> 重试失败项 ({rc.failedMaterials.length})
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Inline Notice Banner */}
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

      {/* Sync Error Banner */}
      {rc.error && (
        <div className="ykt-banner error">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <AlertTriangleIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{rc.error}</span>
          </div>
          <div className="ykt-banner-actions">
            <button
              type="button"
              className="ykt-btn ykt-btn-secondary ykt-btn-sm"
              disabled={rc.loading}
              onClick={() => void rc.refreshResources(true)}
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
            <button type="button" className="ykt-btn ykt-btn-secondary ykt-btn-sm" onClick={app.openDiagnostics}>
              查看诊断
            </button>
          </div>
        </div>
      )}

      {/* Search + Course Selector + Type Pills */}
      <div className="ykt-filters">
        <div className="ykt-search-row">
          <div className="ykt-search-box">
            <span className="ykt-search-icon">
              <SearchIcon size={13} />
            </span>
            <input
              type="search"
              className="ykt-input"
              aria-label="搜索课件、章节或文件名"
              placeholder="搜索课件、章节或文件名…"
              value={rc.searchQuery}
              onChange={e => rc.setSearchQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="按课程筛选资源"
            className="ykt-select"
            value={rc.selectedCourseId}
            onChange={e => rc.setSelectedCourseId(e.target.value)}
          >
            <option value="all">全部课程 ({rc.courses.length})</option>
            {rc.courses.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} ({courseCounts.get(c.id) ?? 0})
              </option>
            ))}
          </select>
        </div>

        <div className="ykt-res-pills" role="group" aria-label="按资源类型筛选">
          <button
            type="button"
            className={`ykt-pill-btn tabular${rc.typeFilter === 'all' ? ' active' : ''}`}
            aria-pressed={rc.typeFilter === 'all'}
            onClick={() => rc.setTypeFilter('all')}
          >
            全部 ({rc.stats.totalCount})
          </button>
          {visibleTypePills.map(type => {
            const count = typeCounts.get(type) ?? 0;
            return (
              <button
                key={type}
                type="button"
                className={`ykt-pill-btn tabular${rc.typeFilter === type ? ' active' : ''}`}
                aria-pressed={rc.typeFilter === type}
                onClick={() => rc.setTypeFilter(rc.typeFilter === type ? 'all' : type)}
              >
                {MATERIAL_TYPE_LABELS[type]} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Selection & Download Options Bar */}
      <div className="ykt-res-toolbar">
        <div className="ykt-res-toolbar-top">
          <span className="tabular" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
            {selectedCount > 0
              ? `已勾选 ${selectedCount} 份资料`
              : `当前可下载 ${downloadableVisibleCount} / ${rc.filteredMaterials.length} 份`}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="ykt-link-btn"
              disabled={downloadableVisibleCount === 0 || isBusy}
              onClick={rc.selectAllVisible}
            >
              全选可下
            </button>
            {selectedCount > 0 && (
              <button type="button" className="ykt-link-btn" disabled={isBusy} onClick={rc.clearSelection}>
                清空
              </button>
            )}
          </div>
        </div>

        <div className="ykt-res-toggles">
          <label className="ykt-res-toggle-chip">
            <input
              type="checkbox"
              checked={rc.mergeSlidesToPdf}
              disabled={isBusy}
              onChange={e => rc.setMergeSlidesToPdf(e.target.checked)}
            />
            <span>图片课件合 PDF</span>
          </label>
          <label className="ykt-res-toggle-chip">
            <input
              type="checkbox"
              checked={rc.skipDownloaded}
              disabled={isBusy}
              onChange={e => rc.setSkipDownloaded(e.target.checked)}
            />
            <span>跳过已下载</span>
          </label>
          <label className="ykt-res-toggle-chip">
            <input
              type="checkbox"
              checked={rc.onlyNewOrUndownloaded}
              onChange={e => rc.setOnlyNewOrUndownloaded(e.target.checked)}
            />
            <span>仅看未下/新增</span>
          </label>
        </div>

        <div className="ykt-res-actions">
          <button
            type="button"
            className="ykt-btn ykt-btn-primary ykt-btn-sm"
            style={{ flex: 1 }}
            disabled={isBusy || batchTargetCount === 0}
            onClick={() => void rc.downloadSelected()}
          >
            <DownloadIcon size={13} />
            {selectedCount > 0 ? `批量下载 (${selectedCount})` : `下载当前 (${batchTargetCount})`}
          </button>

          <button
            type="button"
            className="ykt-btn ykt-btn-secondary ykt-btn-sm"
            disabled={isBusy || rc.courses.length === 0}
            title="将当前筛选课程快速打包为完整知识库资料包"
            onClick={handleQuickExportCourse}
          >
            <PackageIcon size={13} />
            {rc.selectedCourseId === 'all' ? '导出全部' : '导出本课'}
          </button>

          {rc.failedMaterials.length > 0 && !isBusy && (
            <button
              type="button"
              className="ykt-btn ykt-btn-secondary ykt-btn-sm"
              title="仅重试下载失败的资源"
              onClick={() => void rc.retryFailed()}
            >
              <RefreshIcon size={12} /> 重试 ({rc.failedMaterials.length})
            </button>
          )}
        </div>
      </div>

      {/* Resource List / Skeleton / Empty State */}
      {rc.loading && !rc.discovery ? (
        <div className="ykt-group" aria-label="正在加载课程资源">
          {[0, 1, 2].map(i => (
            <div key={i} className="ykt-skeleton-card">
              <div className="ykt-skeleton-line" style={{ width: '48%' }} />
              <div className="ykt-skeleton-line" style={{ width: '86%', height: 15 }} />
              <div className="ykt-skeleton-line" style={{ width: '58%' }} />
            </div>
          ))}
        </div>
      ) : rc.filteredMaterials.length === 0 ? (
        <div className="ykt-empty">
          <FolderIcon size={28} style={{ color: 'var(--text-muted)' }} />
          <div className="ykt-empty-title">
            {rc.materials.length === 0 ? '暂未发现可展示的课程资料' : '当前筛选条件下没有匹配资料'}
          </div>
          <div style={{ fontSize: 12 }}>
            {rc.materials.length === 0
              ? app.settings.useDemoMode
                ? '点击刷新以重新加载内置演示课程资料。'
                : '请确认当前已登录雨课堂并刷新同步，或在设置中开启演示模式体验。'
              : '可尝试切换课程、清空搜索关键词或取消「仅看未下/新增」。'}
          </div>
          <div className="ykt-banner-actions" style={{ justifyContent: 'center' }}>
            {rc.materials.length > 0 ? (
              <button
                type="button"
                className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                onClick={() => {
                  rc.setSelectedCourseId('all');
                  rc.setTypeFilter('all');
                  rc.setSearchQuery('');
                  rc.setOnlyNewOrUndownloaded(false);
                }}
              >
                重置全部筛选
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ykt-btn ykt-btn-secondary ykt-btn-sm"
                  disabled={rc.loading}
                  onClick={() => void rc.refreshResources(true)}
                >
                  <RefreshIcon size={12} /> 刷新资源
                </button>
                {!app.settings.useDemoMode && (
                  <button
                    type="button"
                    className="ykt-btn ykt-btn-primary ykt-btn-sm"
                    onClick={() => void app.toggleDemoMode()}
                  >
                    体验演示模式
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <section className="ykt-group" aria-label="课程资料列表">
          <div className="ykt-group-header">
            <span>
              <span className="ykt-group-dot" style={{ background: 'var(--accent)' }} />
              课程资料清单
            </span>
            <span className="tabular">{rc.filteredMaterials.length} 份</span>
          </div>
          {rc.filteredMaterials.map(renderMaterialCard)}
        </section>
      )}

      {/* Course Announcements Collapsible Section */}
      {rc.filteredAnnouncements.length > 0 && (
        <section className="ykt-section">
          <button
            type="button"
            className="ykt-collapsible-trigger"
            aria-expanded={announcementsOpen}
            onClick={() => setAnnouncementsOpen(prev => !prev)}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <MegaphoneIcon size={14} /> 课程公告（{rc.filteredAnnouncements.length}）
            </span>
            <ChevronDownIcon size={15} className={`ykt-chevron${announcementsOpen ? ' open' : ''}`} />
          </button>

          {announcementsOpen && (
            <div className="ykt-collapsible-body">
              {rc.filteredAnnouncements.map(ann => {
                const pubLabel = formatIsoTimeShort(ann.publishedAt);
                const safeAnnLink = isSafeHttpUrl(ann.sourceUrl) ? ann.sourceUrl : undefined;
                return (
                  <article key={ann.resourceKey} className="ykt-ann-item">
                    <div className="ykt-card-tags">
                      <span className="ykt-tag course">{ann.courseName}</span>
                      {pubLabel && <span className="ykt-tag tabular">{pubLabel}</span>}
                    </div>
                    <div className="ykt-ann-title">{ann.title}</div>
                    {ann.content && <div className="ykt-ann-content">{ann.content}</div>}
                    {safeAnnLink && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <a
                          href={safeAnnLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ykt-link-btn"
                        >
                          查看原公告 <ExternalLinkIcon size={11} />
                        </a>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}
