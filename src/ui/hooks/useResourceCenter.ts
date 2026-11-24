import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CourseInfo,
  type CourseMaterial,
  type DownloadBatchOptions,
  type DownloadBatchResult,
  type DownloadItemResult,
  type DownloadProgress,
  type DownloadStatus,
  type ExportManifest,
  type ExportMode,
  type HomeworkItem,
  type MaterialType,
  type PlatformInfo,
  type ResourceDiscoveryResult,
  type SyncStatusReport,
} from '../../types';
import { useDebouncedValue } from '../utils/format';
import type { DdlAppController } from './useDdlApp';

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  slides: '课件',
  image_slides: '图片课件',
  pdf: 'PDF',
  ppt: 'PPT',
  document: '文档',
  attachment: '附件',
  announcement_attachment: '公告附件',
  video_meta: '视频元信息',
  other: '其他',
};

export const DOWNLOAD_STATUS_LABELS: Record<DownloadStatus, string> = {
  not_downloaded: '未下载',
  downloading: '下载中',
  downloaded: '已下载',
  updated: '有更新',
  failed: '失败',
  unavailable: '仅链接',
};

export interface ExportModeOption {
  id: ExportMode;
  name: string;
  extension: string;
  hint: string;
  includesBinaries: boolean;
}

export const EXPORT_MODE_OPTIONS: readonly ExportModeOption[] = [
  {
    id: 'knowledge-base',
    name: '完整课程知识库',
    extension: '.zip',
    hint: '按学期与课程目录归档课件、作业、公告、deadlines.ics 与 manifest.json',
    includesBinaries: true,
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM 资料包',
    extension: '.zip',
    hint: '扁平化章节命名，图片课件合 PDF + 课程概览 Markdown，直接拖入 NotebookLM',
    includesBinaries: true,
  },
  {
    id: 'ai-context',
    name: 'AI Context Pack',
    extension: '.zip',
    hint: '轻量纯文本上下文（课程概览、DDL、资料索引、context.json 与安全 study_prompt.md）',
    includesBinaries: false,
  },
  {
    id: 'json-only',
    name: '结构化 JSON',
    extension: '.json',
    hint: '标准 schemaVersion 0.2.0 课程与资源数据，适合脚本或 Agent 直接读取',
    includesBinaries: false,
  },
  {
    id: 'markdown-only',
    name: '课程索引 Markdown',
    extension: '.md',
    hint: '单文件课程与资料总览，可直接复制粘贴进任意大模型对话',
    includesBinaries: false,
  },
];

export interface ResourceSyncRequest {
  platform: PlatformInfo;
  useDemoMode: boolean;
  force?: boolean;
  existingCourses?: CourseInfo[];
  existingHomework?: HomeworkItem[];
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface ResourceDownloadSingleRequest {
  material: CourseMaterial;
  useDemoMode: boolean;
  mergeSlideImagesToPdf: boolean;
  forceRedownload?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface ResourceDownloadBatchRequest {
  materials: CourseMaterial[];
  useDemoMode: boolean;
  options: DownloadBatchOptions;
}

export interface ResourceExportRequest {
  mode: ExportMode;
  courseIds: string[];
  discovery: ResourceDiscoveryResult;
  useDemoMode: boolean;
  mergeSlideImagesToPdf: boolean;
  includeAssignments?: boolean;
  includeAnnouncements?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface ResourceExportResponse {
  filename: string;
  manifest: ExportManifest;
  bytesLength: number;
}

export interface ResourceCenterBackend {
  syncResources(req: ResourceSyncRequest): Promise<ResourceDiscoveryResult>;
  downloadSingle(req: ResourceDownloadSingleRequest): Promise<DownloadItemResult>;
  downloadBatch(req: ResourceDownloadBatchRequest): Promise<DownloadBatchResult>;
  exportBundle(req: ResourceExportRequest): Promise<ResourceExportResponse>;
  getSyncStatus?(platform: PlatformInfo, useDemoMode: boolean): Promise<SyncStatusReport | null>;
}

export interface ResourceNotice {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export interface ResourceStats {
  totalCount: number;
  newCount: number;
  updatedCount: number;
  downloadedCount: number;
  failedCount: number;
  unavailableCount: number;
  downloadableCount: number;
  knownTotalBytes: number;
}

export interface UseResourceCenterOptions {
  backend?: ResourceCenterBackend;
  autoSync?: boolean;
}

let registeredBackend: ResourceCenterBackend | null = null;

export function registerResourceCenterBackend(backend: ResourceCenterBackend | null): void {
  registeredBackend = backend;
}

export function getRegisteredResourceCenterBackend(): ResourceCenterBackend | null {
  return registeredBackend;
}

export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function isSafeHttpUrl(raw?: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function isMaterialDownloadable(material: CourseMaterial): boolean {
  if (material.downloadStatus === 'unavailable' || material.type === 'video_meta') return false;
  return Boolean(material.downloadUrl || (material.slideImages && material.slideImages.length > 0));
}

const UNREGISTERED_BACKEND: ResourceCenterBackend = {
  async syncResources(req) {
    return {
      origin: req.platform.origin,
      sourcePlatform: req.useDemoMode ? 'demo' : req.platform.label,
      source: req.useDemoMode ? 'demo' : 'live',
      syncedAt: new Date().toISOString(),
      courses: [],
      materials: [],
      assignments: [],
      exams: [],
      announcements: [],
      diagnostics: [],
      failedCourses: 0,
      error: 'network-error',
    };
  },
  async downloadSingle(req) {
    return {
      material: req.material,
      status: 'failed',
      errorCode: 'network-error',
      errorMessage: '资源下载后端未初始化',
    };
  },
  async downloadBatch(req) {
    return {
      items: req.materials.map(material => ({
        material,
        status: 'failed' as const,
        errorCode: 'network-error' as const,
        errorMessage: '资源下载后端未初始化',
      })),
      succeeded: 0,
      skipped: 0,
      failed: req.materials.length,
      cancelled: false,
      totalBytes: 0,
    };
  },
  async exportBundle() {
    throw new Error('资源导出后端未初始化');
  },
};

export function useResourceCenter(app: DdlAppController, options: UseResourceCenterOptions = {}) {
  const { backend: propBackend, autoSync = true } = options;

  const [discovery, setDiscovery] = useState<ResourceDiscoveryResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters & selection
  const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | MaterialType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 180);
  const [onlyNewOrUndownloaded, setOnlyNewOrUndownloaded] = useState(false);
  const [selectedResourceKeys, setSelectedResourceKeys] = useState<Set<string>>(new Set());

  // Download & export options / states
  const [mergeSlidesToPdf, setMergeSlidesToPdf] = useState(true);
  const [skipDownloaded, setSkipDownloaded] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [busyMode, setBusyMode] = useState<'download' | 'export' | null>(null);
  const [activeMaterialKey, setActiveMaterialKey] = useState<string | null>(null);
  const [lastBatchResult, setLastBatchResult] = useState<DownloadBatchResult | null>(null);
  const [lastExportManifest, setLastExportManifest] = useState<ExportManifest | null>(null);
  const [lastExportFilename, setLastExportFilename] = useState<string | null>(null);
  const [notice, setNotice] = useState<ResourceNotice | null>(null);

  // AI Workflow export selection state
  const [exportMode, setExportMode] = useState<ExportMode>('knowledge-base');
  const [exportCourseIds, setExportCourseIds] = useState<string[]>([]);

  const syncAbortRef = useRef<AbortController | null>(null);
  const taskAbortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const syncedKeyRef = useRef<string | null>(null);

  // Keep latest v0.1 courses/effectiveItems in refs so 30s clock ticks never restart resource sync.
  const latestCoursesRef = useRef(app.syncResult?.courses);
  const latestHomeworkRef = useRef(app.effectiveItems);
  latestCoursesRef.current = app.syncResult?.courses;
  latestHomeworkRef.current = app.effectiveItems;

  const resolveBackend = useCallback((): ResourceCenterBackend => {
    return propBackend ?? registeredBackend ?? UNREGISTERED_BACKEND;
  }, [propBackend]);

  const showNotice = useCallback((text: string, tone: 'info' | 'error' = 'info', durationMs = 4000) => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice({ id: Date.now(), text, tone });
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), durationMs);
  }, []);

  const clearNotice = useCallback(() => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice(null);
  }, []);

  const refreshSyncStatus = useCallback(
    async (useDemoMode: boolean, signal?: AbortSignal) => {
      const backend = resolveBackend();
      if (!backend.getSyncStatus) return;
      const status = await backend.getSyncStatus(app.platform, useDemoMode).catch(() => null);
      if (!signal?.aborted && status) setSyncStatus(status);
    },
    [app.platform, resolveBackend],
  );

  const refreshResources = useCallback(
    async (force = false) => {
      syncAbortRef.current?.abort();
      const controller = new AbortController();
      syncAbortRef.current = controller;

      setLoading(true);
      setError(null);
      setSyncProgress({ completed: 0, total: 1 });

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || app.syncResult?.source === 'demo';

      try {
        const result = await backend.syncResources({
          platform: app.platform,
          useDemoMode,
          force,
          existingCourses: latestCoursesRef.current,
          existingHomework: latestHomeworkRef.current,
          signal: controller.signal,
          onProgress: (completed, total) => setSyncProgress({ completed, total }),
        });

        if (controller.signal.aborted) return;

        setDiscovery(result);
        setSelectedResourceKeys(new Set());
        setExportCourseIds(prev => {
          const validIds = new Set(result.courses.map(c => c.id));
          const kept = prev.filter(id => validIds.has(id));
          return kept.length > 0 ? kept : result.courses.map(c => c.id);
        });

        if (backend.getSyncStatus) {
          await refreshSyncStatus(useDemoMode, controller.signal);
        } else {
          setSyncStatus({
            origin: result.origin,
            sourcePlatform: result.sourcePlatform,
            lastSyncedAt: result.syncedAt,
            knownMaterials: result.materials.length,
            downloadedMaterials: result.materials.filter(m => m.downloadStatus === 'downloaded').length,
            failedMaterials: result.materials.filter(m => m.downloadStatus === 'failed').length,
          });
        }

        if (result.error) {
          const msg =
            result.error === 'unauthorized'
              ? '未检测到雨课堂登录态，请先登录或切换至演示模式体验资源中心'
              : `课程资源同步遇到问题（${result.error}），可重试或在设置中查看诊断`;
          setError(msg);
        } else if (force) {
          showNotice(
            result.source === 'demo'
              ? `已刷新演示课程资源（共 ${result.materials.length} 份）`
              : `已同步 ${result.courses.length} 门课，发现 ${result.materials.length} 份课程资料`,
          );
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setError((err as Error)?.message || '拉取课程资源失败，请稍后重试');
      } finally {
        if (syncAbortRef.current === controller) {
          setLoading(false);
          setSyncProgress(null);
        }
      }
    },
    [app.platform, app.settings.useDemoMode, app.syncResult?.source, refreshSyncStatus, resolveBackend, showNotice],
  );

  // Auto-sync lazily once per (origin, mode) when user opens resources / AI workflow / diagnostics
  useEffect(() => {
    if (!autoSync || !app.isOpen) return;
    const isRelevantView = app.view === 'resources' || app.view === 'prompt' || (app.view === 'settings' && app.advancedOpen);
    if (!isRelevantView) return;

    const effectiveDemo = app.settings.useDemoMode || app.syncResult?.source === 'demo';
    const syncKey = `${app.platform.origin}|${effectiveDemo ? 'demo' : 'live'}`;
    if (syncedKeyRef.current === syncKey) return;
    syncedKeyRef.current = syncKey;
    void refreshResources(false);
  }, [
    autoSync,
    app.isOpen,
    app.view,
    app.advancedOpen,
    app.platform.origin,
    app.settings.useDemoMode,
    app.syncResult?.source,
    refreshResources,
  ]);

  useEffect(() => {
    return () => {
      syncAbortRef.current?.abort();
      taskAbortRef.current?.abort();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const courses = discovery?.courses ?? [];
  const materials = discovery?.materials ?? [];
  const assignments = discovery?.assignments ?? [];
  const exams = discovery?.exams ?? [];
  const announcements = discovery?.announcements ?? [];
  const diagnostics = discovery?.diagnostics ?? [];
  const syncedAt = discovery?.syncedAt ?? null;

  const filteredMaterials = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return materials.filter(m => {
      if (selectedCourseId !== 'all' && m.courseId !== selectedCourseId) return false;
      if (typeFilter !== 'all') {
        if (typeFilter === 'slides') {
          if (m.type !== 'slides' && m.type !== 'image_slides') return false;
        } else if (m.type !== typeFilter) {
          return false;
        }
      }
      if (onlyNewOrUndownloaded) {
        if (m.downloadStatus === 'downloaded' && !m.isNew) return false;
      }
      if (q) {
        const hay = `${m.courseName ?? ''} ${m.chapterTitle ?? ''} ${m.title} ${m.filename ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [materials, selectedCourseId, typeFilter, onlyNewOrUndownloaded, debouncedSearch]);

  const filteredAnnouncements = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return announcements.filter(ann => {
      if (selectedCourseId !== 'all' && ann.courseId !== selectedCourseId) return false;
      if (q) {
        const hay = `${ann.courseName} ${ann.title} ${ann.content ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [announcements, selectedCourseId, debouncedSearch]);

  const stats = useMemo<ResourceStats>(() => {
    const pool = selectedCourseId === 'all' ? materials : materials.filter(m => m.courseId === selectedCourseId);
    let newCount = 0;
    let updatedCount = 0;
    let downloadedCount = 0;
    let failedCount = 0;
    let unavailableCount = 0;
    let downloadableCount = 0;
    let knownTotalBytes = 0;

    for (const m of pool) {
      if (m.isNew) newCount++;
      if (m.downloadStatus === 'updated') updatedCount++;
      if (m.downloadStatus === 'downloaded') downloadedCount++;
      if (m.downloadStatus === 'failed' && isMaterialDownloadable(m)) failedCount++;
      if (m.downloadStatus === 'unavailable' || !isMaterialDownloadable(m)) unavailableCount++;
      if (isMaterialDownloadable(m)) downloadableCount++;
      if (typeof m.size === 'number' && Number.isFinite(m.size) && m.size > 0) {
        knownTotalBytes += m.size;
      }
    }

    return {
      totalCount: pool.length,
      newCount,
      updatedCount,
      downloadedCount,
      failedCount,
      unavailableCount,
      downloadableCount,
      knownTotalBytes,
    };
  }, [materials, selectedCourseId]);

  const selectedMaterials = useMemo(
    () => materials.filter(m => selectedResourceKeys.has(m.resourceKey)),
    [materials, selectedResourceKeys],
  );

  const failedMaterials = useMemo(() => {
    const map = new Map<string, CourseMaterial>();
    for (const m of materials) {
      if (m.downloadStatus === 'failed' && isMaterialDownloadable(m)) map.set(m.resourceKey, m);
    }
    if (lastBatchResult) {
      for (const item of lastBatchResult.items) {
        if (item.status === 'failed' && item.errorCode !== 'cancelled' && isMaterialDownloadable(item.material)) {
          map.set(item.material.resourceKey, item.material);
        }
      }
    }
    return [...map.values()];
  }, [materials, lastBatchResult]);

  const applyMaterialUpdates = useCallback((updates: Map<string, Partial<CourseMaterial>>) => {
    if (updates.size === 0) return;
    setDiscovery(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        materials: prev.materials.map(m => {
          const patch = updates.get(m.resourceKey);
          return patch ? { ...m, ...patch } : m;
        }),
      };
    });
  }, []);

  const toggleSelectResource = useCallback((resourceKey: string) => {
    setSelectedResourceKeys(prev => {
      const next = new Set(prev);
      if (next.has(resourceKey)) next.delete(resourceKey);
      else next.add(resourceKey);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedResourceKeys(new Set(filteredMaterials.filter(isMaterialDownloadable).map(m => m.resourceKey)));
  }, [filteredMaterials]);

  const clearSelection = useCallback(() => {
    setSelectedResourceKeys(new Set());
  }, []);

  const cancelActiveTask = useCallback(() => {
    if (taskAbortRef.current) {
      taskAbortRef.current.abort();
      taskAbortRef.current = null;
      showNotice('已请求取消当前任务');
    }
  }, [showNotice]);

  const downloadSingle = useCallback(
    async (material: CourseMaterial) => {
      if (busyMode) return;
      if (!isMaterialDownloadable(material)) {
        showNotice('该资源不支持直接下载，请点击右侧链接在雨课堂打开', 'error');
        return;
      }

      const previousStatus = material.downloadStatus;
      const controller = new AbortController();
      taskAbortRef.current = controller;
      setBusyMode('download');
      setActiveMaterialKey(material.resourceKey);
      applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'downloading' }]]));

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || discovery?.source === 'demo';

      try {
        const res = await backend.downloadSingle({
          material,
          useDemoMode,
          mergeSlideImagesToPdf: mergeSlidesToPdf,
          forceRedownload: previousStatus === 'downloaded',
          signal: controller.signal,
          onProgress: p => setDownloadProgress(p),
        });

        if (res.errorCode === 'cancelled' || controller.signal.aborted) {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: previousStatus }]]));
          showNotice('已取消下载');
        } else if (res.status === 'downloaded') {
          applyMaterialUpdates(
            new Map([
              [
                material.resourceKey,
                {
                  downloadStatus: 'downloaded',
                  isNew: false,
                  size: res.size ?? material.size,
                  checksum: res.checksum ?? material.checksum,
                  localPath: res.relativePath ?? material.localPath,
                },
              ],
            ]),
          );
          showNotice(`已下载「${res.filename ?? material.title}」`);
        } else if (res.status === 'skipped') {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'downloaded' }]]));
          showNotice(`已跳过已下载文件「${material.title}」`);
        } else {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'failed' }]]));
          showNotice(res.errorMessage || `下载「${material.title}」失败`, 'error', 5000);
        }
        await refreshSyncStatus(useDemoMode);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: previousStatus }]]));
          showNotice('已取消下载');
        } else {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'failed' }]]));
          showNotice((err as Error)?.message || `下载「${material.title}」失败`, 'error', 5000);
        }
      } finally {
        if (taskAbortRef.current === controller) taskAbortRef.current = null;
        setBusyMode(null);
        setActiveMaterialKey(null);
        setDownloadProgress(null);
      }
    },
    [app.settings.useDemoMode, applyMaterialUpdates, busyMode, discovery?.source, mergeSlidesToPdf, refreshSyncStatus, resolveBackend, showNotice],
  );

  const runBatchDownload = useCallback(
    async (targets: CourseMaterial[], forceRedownload = false) => {
      if (busyMode) return;
      const downloadableTargets = targets.filter(isMaterialDownloadable);
      if (downloadableTargets.length === 0) {
        showNotice('没有可下载的课程资源', 'error');
        return;
      }

      const controller = new AbortController();
      taskAbortRef.current = controller;
      setBusyMode('download');
      setLastBatchResult(null);
      setDownloadProgress({
        phase: 'fetching',
        completed: 0,
        total: downloadableTargets.length,
        currentTitle: downloadableTargets[0]?.title,
        bytesProcessed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || discovery?.source === 'demo';

      try {
        const result = await backend.downloadBatch({
          materials: downloadableTargets,
          useDemoMode,
          options: {
            mergeSlideImagesToPdf: mergeSlidesToPdf,
            skipAlreadyDownloaded: forceRedownload ? false : skipDownloaded,
            forceRedownload,
            signal: controller.signal,
            onProgress: p => setDownloadProgress(p),
          },
        });

        const updates = new Map<string, Partial<CourseMaterial>>();
        for (const item of result.items) {
          if (item.errorCode === 'cancelled') continue;
          if (item.status === 'downloaded') {
            updates.set(item.material.resourceKey, {
              downloadStatus: 'downloaded',
              isNew: false,
              size: item.size ?? item.material.size,
              checksum: item.checksum ?? item.material.checksum,
              localPath: item.relativePath ?? item.material.localPath,
            });
          } else if (item.status === 'failed') {
            updates.set(item.material.resourceKey, { downloadStatus: 'failed' });
          }
        }
        applyMaterialUpdates(updates);
        setLastBatchResult(result);
        await refreshSyncStatus(useDemoMode);

        if (result.cancelled) {
          showNotice(`批量下载已取消（已完成 ${result.succeeded} 份，跳过 ${result.skipped} 份）`);
        } else if (result.failed > 0) {
          showNotice(
            `批量下载完成：成功 ${result.succeeded}，跳过 ${result.skipped}，失败 ${result.failed}`,
            'error',
            5000,
          );
        } else {
          showNotice(`批量下载完成：成功 ${result.succeeded} 份${result.skipped > 0 ? `，跳过已下载 ${result.skipped} 份` : ''}`);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          showNotice('已取消批量下载');
        } else {
          showNotice((err as Error)?.message || '批量下载失败，请稍后重试', 'error', 5000);
        }
      } finally {
        if (taskAbortRef.current === controller) taskAbortRef.current = null;
        setBusyMode(null);
        setDownloadProgress(null);
      }
    },
    [
      app.settings.useDemoMode,
      applyMaterialUpdates,
      busyMode,
      discovery?.source,
      mergeSlidesToPdf,
      refreshSyncStatus,
      resolveBackend,
      showNotice,
      skipDownloaded,
    ],
  );

  const downloadSelected = useCallback(async () => {
    const targets =
      selectedMaterials.length > 0
        ? selectedMaterials
        : filteredMaterials.filter(isMaterialDownloadable);
    await runBatchDownload(targets, false);
  }, [filteredMaterials, runBatchDownload, selectedMaterials]);

  const retryFailed = useCallback(async () => {
    if (failedMaterials.length === 0) return;
    await runBatchDownload(failedMaterials, true);
  }, [failedMaterials, runBatchDownload]);

  const exportBundle = useCallback(
    async (modeOverride?: ExportMode, courseIdsOverride?: string[]): Promise<ExportManifest | null> => {
      if (busyMode) return null;
      if (!discovery) {
        showNotice('请先同步课程资源后再导出', 'error');
        return null;
      }

      const targetMode = modeOverride ?? exportMode;
      const targetCourseIds =
        courseIdsOverride ?? (exportCourseIds.length > 0 ? exportCourseIds : courses.map(c => c.id));

      if (targetCourseIds.length === 0) {
        showNotice('请至少选择 1 门课程进行导出', 'error');
        return null;
      }

      const controller = new AbortController();
      taskAbortRef.current = controller;
      setBusyMode('export');
      setDownloadProgress({
        phase: 'packaging-zip',
        completed: 0,
        total: Math.max(1, targetCourseIds.length),
        currentTitle: '正在整理课程结构与资料…',
        bytesProcessed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || discovery.source === 'demo';

      try {
        const res = await backend.exportBundle({
          mode: targetMode,
          courseIds: targetCourseIds,
          discovery,
          useDemoMode,
          mergeSlideImagesToPdf: mergeSlidesToPdf,
          includeAssignments: true,
          includeAnnouncements: true,
          signal: controller.signal,
          onProgress: p => setDownloadProgress(p),
        });

        setLastExportManifest(res.manifest);
        setLastExportFilename(res.filename);

        // Reflect included materials as downloaded in UI state without touching unavailable items
        if (targetMode === 'knowledge-base' || targetMode === 'notebooklm') {
          const updates = new Map<string, Partial<CourseMaterial>>();
          for (const entry of res.manifest.files) {
            if (entry.kind === 'material' && entry.status === 'included' && entry.resourceKey) {
              updates.set(entry.resourceKey, {
                downloadStatus: 'downloaded',
                isNew: false,
                checksum: entry.checksum,
                localPath: entry.relativePath,
              });
            }
          }
          applyMaterialUpdates(updates);
          await refreshSyncStatus(useDemoMode);
        }

        const missingTip =
          res.manifest.missingItems.length > 0
            ? `（含 ${res.manifest.missingItems.length} 项仅链接/缺失提醒，已写入 manifest）`
            : '';
        showNotice(`已导出「${res.filename}」${missingTip}`, 'info', 4800);
        return res.manifest;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          showNotice('已取消资料包导出');
        } else {
          showNotice((err as Error)?.message || '导出资料包失败，请稍后重试', 'error', 5000);
        }
        return null;
      } finally {
        if (taskAbortRef.current === controller) taskAbortRef.current = null;
        setBusyMode(null);
        setDownloadProgress(null);
      }
    },
    [
      app.settings.useDemoMode,
      applyMaterialUpdates,
      busyMode,
      courses,
      discovery,
      exportCourseIds,
      exportMode,
      mergeSlidesToPdf,
      refreshSyncStatus,
      resolveBackend,
      showNotice,
    ],
  );

  const toggleExportCourse = useCallback((courseId: string) => {
    setExportCourseIds(prev => (prev.includes(courseId) ? prev.filter(id => id !== courseId) : [...prev, courseId]));
  }, []);

  const selectAllExportCourses = useCallback(() => {
    setExportCourseIds(courses.map(c => c.id));
  }, [courses]);

  const clearExportCourses = useCallback(() => {
    setExportCourseIds([]);
  }, []);

  const clearLastBatchResult = useCallback(() => {
    setLastBatchResult(null);
  }, []);

  return {
    discovery,
    courses,
    materials,
    assignments,
    exams,
    announcements,
    diagnostics,
    syncedAt,
    syncStatus,
    loading,
    syncProgress,
    error,

    selectedCourseId,
    setSelectedCourseId,
    typeFilter,
    setTypeFilter,
    searchQuery,
    setSearchQuery,
    onlyNewOrUndownloaded,
    setOnlyNewOrUndownloaded,

    selectedResourceKeys,
    selectedMaterials,
    toggleSelectResource,
    selectAllVisible,
    clearSelection,

    mergeSlidesToPdf,
    setMergeSlidesToPdf,
    skipDownloaded,
    setSkipDownloaded,

    downloadProgress,
    busyMode,
    activeMaterialKey,
    lastBatchResult,
    clearLastBatchResult,
    lastExportManifest,
    lastExportFilename,
    notice,
    clearNotice,

    exportMode,
    setExportMode,
    exportCourseIds,
    toggleExportCourse,
    selectAllExportCourses,
    clearExportCourses,

    filteredMaterials,
    filteredAnnouncements,
    stats,
    failedMaterials,

    refreshResources,
    downloadSingle,
    downloadSelected,
    retryFailed,
    cancelActiveTask,
    exportBundle,
  };
}

export type ResourceCenterController = ReturnType<typeof useResourceCenter>;
