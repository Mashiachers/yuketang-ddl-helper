import type {
  CourseMaterial,
  DownloadBatchResult,
  DownloadItemResult,
  PlatformInfo,
  ResourceDiscoveryResult,
  SyncStatusReport,
} from '../../types';
import {
  buildExportFiles,
  buildZipArchive,
  createDemoFileBytes,
  createDemoResourceDiscovery,
  createDownloadService,
  createResourceService,
  discoverCourseResources,
  exportAsZip,
  loadResourceIndex,
  recordDownloadOutcome,
  sanitizeFilename,
  saveResourceIndex,
  triggerBrowserDownload,
  type ResourceService,
} from '../../core/resources';
import type {
  ResourceCenterBackend,
  ResourceDownloadBatchRequest,
  ResourceDownloadSingleRequest,
  ResourceExportRequest,
  ResourceExportResponse,
  ResourceSyncRequest,
} from '../hooks/useResourceCenter';

const encoder = new TextEncoder();

function resolveOrigin(candidate?: string): string {
  if (candidate) {
    try {
      return new URL(candidate).origin;
    } catch { /* fallback below */ }
  }
  if (typeof globalThis.location?.origin === 'string' && /^https?:\/\//i.test(globalThis.location.origin)) {
    return globalThis.location.origin;
  }
  return 'https://www.yuketang.cn';
}

function getSameOriginCookie(origin: string): string {
  if (typeof globalThis.document === 'undefined') return '';
  try {
    if (globalThis.location?.origin === new URL(origin).origin) {
      return globalThis.document.cookie ?? '';
    }
  } catch { /* ignore */ }
  return '';
}

export function createBrowserResourceBackend(): ResourceCenterBackend {
  const services = new Map<string, ResourceService>();
  let lastOrigin = resolveOrigin();
  let lastPlatformLabel = '雨课堂';

  function getService(platform: PlatformInfo, useDemoMode: boolean, req?: ResourceSyncRequest): ResourceService {
    const sourcePlatform = useDemoMode ? 'demo' : platform.label;
    const key = `${platform.origin}::${sourcePlatform}`;
    const existing = services.get(key);
    if (existing && !req) return existing;

    const service = createResourceService({
      origin: platform.origin,
      sourcePlatform,
      discoverFn: async opts => {
        if (useDemoMode) {
          opts.onProgress?.(1, 1);
          return createDemoResourceDiscovery(Date.now(), platform.origin);
        }
        return discoverCourseResources(platform, {
          cookie: getSameOriginCookie(platform.origin),
          existingCourses: req?.existingCourses,
          existingHomework: req?.existingHomework,
          signal: opts.signal,
          courseIds: opts.courseIds,
          onProgress: opts.onProgress,
        });
      },
    });
    services.set(key, service);
    return service;
  }

  async function persistOutcomes(
    origin: string,
    sourcePlatform: string,
    items: readonly DownloadItemResult[],
  ): Promise<void> {
    let index = await loadResourceIndex(origin, sourcePlatform);
    const nowIso = new Date().toISOString();
    for (const item of items) {
      index = recordDownloadOutcome(index, item, nowIso);
    }
    await saveResourceIndex(index);
  }

  function makeDownloadService(origin: string, useDemoMode: boolean) {
    return createDownloadService({
      origin,
      demoByteResolver: useDemoMode ? createDemoFileBytes : undefined,
    });
  }

  return {
    async syncResources(req: ResourceSyncRequest): Promise<ResourceDiscoveryResult> {
      lastOrigin = resolveOrigin(req.platform.origin);
      lastPlatformLabel = req.platform.label;
      const service = getService(req.platform, req.useDemoMode, req);
      return service.syncResources({
        signal: req.signal,
        onProgress: req.onProgress,
      });
    },

    async downloadSingle(req: ResourceDownloadSingleRequest): Promise<DownloadItemResult> {
      const origin = resolveOrigin(req.material.sourceUrl ?? lastOrigin);
      const sourcePlatform = req.useDemoMode ? 'demo' : req.material.sourcePlatform || lastPlatformLabel;
      const downloader = makeDownloadService(origin, req.useDemoMode);
      const result = await downloader.downloadMaterial(req.material, {
        mergeSlideImagesToPdf: req.mergeSlideImagesToPdf,
        forceRedownload: req.forceRedownload,
        skipAlreadyDownloaded: !req.forceRedownload,
        signal: req.signal,
        onProgress: req.onProgress,
      });
      await persistOutcomes(origin, sourcePlatform, [result]);
      if (result.status === 'downloaded' && result.bytes && typeof document !== 'undefined') {
        triggerBrowserDownload(
          result.bytes,
          result.filename ?? sanitizeFilename(req.material.filename ?? req.material.title),
          result.mimeType ?? 'application/octet-stream',
        );
      }
      return result;
    },

    async downloadBatch(req: ResourceDownloadBatchRequest): Promise<DownloadBatchResult> {
      const origin = resolveOrigin(req.materials[0]?.sourceUrl ?? lastOrigin);
      const sourcePlatform = req.useDemoMode ? 'demo' : req.materials[0]?.sourcePlatform || lastPlatformLabel;
      const downloader = makeDownloadService(origin, req.useDemoMode);
      const batch = await downloader.downloadBatch(req.materials, req.options);
      await persistOutcomes(origin, sourcePlatform, batch.items);

      if (!batch.cancelled && typeof document !== 'undefined') {
        const downloaded = batch.items.filter(
          (item): item is DownloadItemResult & { bytes: Uint8Array } =>
            item.status === 'downloaded' && Boolean(item.bytes?.length),
        );
        if (downloaded.length === 1) {
          const single = downloaded[0];
          triggerBrowserDownload(
            single.bytes,
            single.filename ?? sanitizeFilename(single.material.title),
            single.mimeType ?? 'application/octet-stream',
          );
        } else if (downloaded.length > 1) {
          req.options.onProgress?.({
            phase: 'packaging-zip',
            completed: batch.items.length,
            total: batch.items.length,
            bytesProcessed: batch.totalBytes,
            succeeded: batch.succeeded,
            failed: batch.failed,
            skipped: batch.skipped,
          });
          const zipBytes = buildZipArchive(
            downloaded.map(item => ({
              path: item.relativePath ?? sanitizeFilename(item.filename ?? item.material.title),
              data: item.bytes,
            })),
          );
          const dateTag = new Date().toISOString().slice(0, 10);
          triggerBrowserDownload(zipBytes, `yuketang-resources-${dateTag}.zip`, 'application/zip');
        }
      }

      return batch;
    },

    async exportBundle(req: ResourceExportRequest): Promise<ResourceExportResponse> {
      const origin = resolveOrigin(req.discovery.origin || lastOrigin);
      const sourcePlatform = req.useDemoMode ? 'demo' : req.discovery.sourcePlatform || lastPlatformLabel;
      const selectedCourseSet = new Set(
        req.courseIds.length ? req.courseIds : req.discovery.courses.map(c => c.id),
      );
      const selectedMaterials: CourseMaterial[] = req.discovery.materials.filter(m =>
        selectedCourseSet.has(m.courseId),
      );

      let downloadedItems: DownloadItemResult[] = [];
      if (req.mode === 'knowledge-base' || req.mode === 'notebooklm') {
        const downloader = makeDownloadService(origin, req.useDemoMode);
        const batch = await downloader.downloadBatch(selectedMaterials, {
          mergeSlideImagesToPdf: req.mergeSlideImagesToPdf,
          skipAlreadyDownloaded: false,
          forceRedownload: true,
          signal: req.signal,
          onProgress: req.onProgress,
        });
        req.signal?.throwIfAborted();
        downloadedItems = batch.items;
        await persistOutcomes(origin, sourcePlatform, batch.items);
        req.onProgress?.({
          phase: 'packaging-zip',
          completed: batch.items.length,
          total: batch.items.length,
          bytesProcessed: batch.totalBytes,
          succeeded: batch.succeeded,
          failed: batch.failed,
          skipped: batch.skipped,
        });
      }

      const buildInput = {
        mode: req.mode,
        sourceOrigin: origin,
        sourcePlatform,
        courses: req.discovery.courses,
        materials: req.discovery.materials,
        assignments: req.discovery.assignments,
        exams: req.discovery.exams,
        announcements: req.discovery.announcements,
        downloadedItems,
        courseIds: [...selectedCourseSet],
        includeAssignments: req.includeAssignments ?? true,
        includeAnnouncements: req.includeAnnouncements ?? true,
        signal: req.signal,
      };

      if (req.mode === 'json-only' || req.mode === 'markdown-only') {
        const { files, manifest } = await buildExportFiles(buildInput);
        req.signal?.throwIfAborted();
        const primary = files[0];
        const rawBytes =
          typeof primary.data === 'string' ? encoder.encode(primary.data) : primary.data;
        const mimeType = req.mode === 'json-only' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8';
        const filename = primary.path;
        if (typeof document !== 'undefined') {
          triggerBrowserDownload(rawBytes, filename, mimeType);
        }
        return { filename, manifest, bytesLength: rawBytes.length };
      }

      const { zipBytes, filename, manifest } = await exportAsZip(buildInput);
      req.signal?.throwIfAborted();
      if (typeof document !== 'undefined') {
        triggerBrowserDownload(zipBytes, filename, 'application/zip');
      }
      return { filename, manifest, bytesLength: zipBytes.length };
    },

    async getSyncStatus(platform: PlatformInfo, useDemoMode: boolean): Promise<SyncStatusReport | null> {
      const origin = resolveOrigin(platform.origin);
      const sourcePlatform = useDemoMode ? 'demo' : platform.label;
      const index = await loadResourceIndex(origin, sourcePlatform);
      const records = Object.values(index.records);
      return {
        origin,
        sourcePlatform,
        lastSyncedAt: index.lastSyncedAt || null,
        knownMaterials: index.knownResourceKeys.length,
        downloadedMaterials: records.filter(r => r.status === 'downloaded').length,
        failedMaterials: records.filter(r => r.status === 'failed').length,
      };
    },
  };
}
