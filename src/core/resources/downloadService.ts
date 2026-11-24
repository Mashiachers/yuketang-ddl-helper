import type {
  CourseMaterial, DownloadBatchOptions, DownloadBatchResult, DownloadItemResult,
  DownloadProgress, ResourceErrorCode, SlidePageAsset,
} from '../../types/resources';
import { runRateLimitedQueue } from '../queue/rateLimitedQueue';
import { computeSha256Hex } from './indexStore';
import { buildSafeRelativePath, deduplicateFilename, neutralizeActiveExtension, sanitizeFilename } from './naming';
import { mergeSlideImagesToPdf } from './pdf';
import type { SlideImageConverter, SlideImageInput } from './pdf';

type FileBytes = { bytes: Uint8Array; mimeType: string };
export type DemoByteResolver = (material: CourseMaterial, page?: SlidePageAsset) =>
  FileBytes | undefined | Promise<FileBytes | undefined>;

export interface DownloadServiceDependencies {
  fetchImpl?: typeof fetch;
  imageConverter?: SlideImageConverter;
  demoByteResolver?: DemoByteResolver;
  maxTotalBytes?: number;
  origin?: string;
}

const errorMessages: Record<ResourceErrorCode, string> = {
  unauthorized: '需要登录或没有下载权限',
  'not-found': '资源或可下载文件不存在',
  'http-error': '服务器返回下载错误',
  'network-error': '下载请求失败',
  'invalid-response': '文件响应为空或格式不正确',
  'cors-blocked': '浏览器无法读取跨源文件响应',
  timeout: '下载超时',
  cancelled: '下载已取消',
  'size-limit-exceeded': '超出本批次下载大小限制',
  'unsupported-format': '不支持此课件格式',
};

class DownloadError extends Error {
  readonly code: ResourceErrorCode;
  readonly retryable: boolean;

  constructor(code: ResourceErrorCode, retryable = false) {
    super(errorMessages[code]);
    this.code = code;
    this.retryable = retryable;
  }
}

function failure(material: CourseMaterial, code: ResourceErrorCode): DownloadItemResult {
  return { material, status: 'failed', errorCode: code, errorMessage: errorMessages[code] };
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function downloadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DownloadError('invalid-response');
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new DownloadError('invalid-response');
  }
  return url;
}

function classifyStatus(response: Response): void {
  if (response.type === 'opaque' || response.type === 'opaqueredirect') throw new DownloadError('cors-blocked');
  if (response.status === 401 || response.status === 403) throw new DownloadError('unauthorized');
  if (response.status === 404 || response.status === 410) throw new DownloadError('not-found');
  if (!response.ok) throw new DownloadError('http-error', [408, 429, 500, 502, 503, 504].includes(response.status));
}

const mimeExtensions: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

function resultFilename(material: CourseMaterial, mimeType: string, merged: boolean): string {
  let base = material.filename || material.title;
  if (merged) base = base.replace(/\.[a-z0-9]{1,10}$/i, '');
  const extension = mimeExtensions[mimeType] ?? '';
  if (merged || (extension && !/\.[a-z0-9]{1,10}$/i.test(base))) base += extension;
  return neutralizeActiveExtension(sanitizeFilename(base));
}

export function triggerBrowserDownload(bytesOrBlob: Uint8Array | Blob, filename: string, mimeType = 'application/octet-stream'): void {
  const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob.slice()], { type: mimeType });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = neutralizeActiveExtension(sanitizeFilename(filename));
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function createDownloadService(deps: DownloadServiceDependencies = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const origin = deps.origin ? new URL(deps.origin).origin : globalThis.location?.origin;

  async function downloadBatch(materials: readonly CourseMaterial[], options: DownloadBatchOptions = {}): Promise<DownloadBatchResult> {
    const { signal, skipAlreadyDownloaded = true, forceRedownload = false, mergeSlideImagesToPdf: merge = true,
      timeoutMs = 20_000, concurrency = 2, intervalMs = 250 } = options;
    const maxTotal = options.maxTotalBytes ?? deps.maxTotalBytes ?? 150 * 1024 * 1024;
    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isSafeInteger(maxTotal) || maxTotal < 0 || !Number.isInteger(maxRetries) ||
        maxRetries < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new RangeError('Invalid download limits');
    }
    const retryLimit = Math.min(5, maxRetries);
    let reserved = 0;
    let totalBytes = 0;
    let completed = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const progress = (phase: DownloadProgress['phase'], currentTitle?: string) => options.onProgress?.({
      phase, currentTitle, completed, total: materials.length, bytesProcessed: totalBytes, succeeded, failed, skipped,
    });

    async function download(material: CourseMaterial): Promise<DownloadItemResult> {
      if (signal?.aborted) return failure(material, 'cancelled');
      if (skipAlreadyDownloaded && !forceRedownload && material.downloadStatus === 'downloaded') {
        return { material, status: 'skipped', checksum: material.checksum };
      }
      let held = 0;
      function reserve(amount: number) {
        if (amount > maxTotal - reserved) throw new DownloadError('size-limit-exceeded');
        reserved += amount;
        held += amount;
      }

      async function getFile(raw?: string, page?: SlidePageAsset): Promise<FileBytes> {
        for (let attempt = 0; ; attempt++) {
          signal?.throwIfAborted();
          const before = held;
          const timeout = new AbortController();
          const timer = setTimeout(() => timeout.abort(), timeoutMs);
          const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

          async function read(): Promise<FileBytes> {
            const demo = await deps.demoByteResolver?.(material, page);
            requestSignal.throwIfAborted();
            if (demo) {
              if (!demo.bytes.length) throw new DownloadError('invalid-response');
              reserve(demo.bytes.length);
              return demo;
            }
            if (!raw) throw new DownloadError('not-found');
            const url = downloadUrl(raw);
            let response: Response;
            try {
              response = await fetchImpl(url.href, {
                credentials: 'same-origin', mode: 'cors', signal: requestSignal, referrerPolicy: 'no-referrer',
              });
            } catch (error) {
              if (error instanceof TypeError && origin && origin !== url.origin) {
                throw new DownloadError('cors-blocked');
              }
              throw new DownloadError('network-error', true);
            }
            if (requestSignal.aborted) {
              void response.body?.cancel().catch(() => {});
              requestSignal.throwIfAborted();
            }
            try {
              classifyStatus(response);
              const contentLength = response.headers.get('Content-Length');
              if (contentLength && Number(contentLength) > maxTotal - reserved) throw new DownloadError('size-limit-exceeded');
              const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
              const expected = page?.mimeType ?? material.mimeType;
              if (contentType === 'text/html' || contentType === 'application/xhtml+xml' ||
                  (contentType === 'application/json' && expected && expected !== 'application/json')) {
                throw new DownloadError('invalid-response');
              }
              const mimeType = (contentType && contentType !== 'application/octet-stream' ? contentType : undefined) ??
                expected ?? 'application/octet-stream';
              const reader = response.body?.getReader();
              if (!reader) throw new DownloadError('invalid-response');
              const chunks: Uint8Array[] = [];
              let length = 0;
              try {
                for (;;) {
                  const { done, value } = await abortable(reader.read(), requestSignal);
                  requestSignal.throwIfAborted();
                  if (done) break;
                  reserve(value.length);
                  length += value.length;
                  chunks.push(value);
                }
              } catch (error) {
                void reader.cancel().catch(() => {});
                if (error instanceof DownloadError) throw error;
                throw new DownloadError('network-error', true);
              } finally {
                reader.releaseLock();
              }
              if (!length) throw new DownloadError('invalid-response');
              const bytes = new Uint8Array(length);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
              }
              return { bytes, mimeType };
            } catch (error) {
              void response.body?.cancel().catch(() => {});
              throw error;
            }
          }

          try {
            return await abortable(read(), requestSignal);
          } catch (error) {
            reserved -= held - before;
            held = before;
            if (signal?.aborted) throw new DownloadError('cancelled');
            const problem = timeout.signal.aborted ? new DownloadError('timeout', true) :
              error instanceof DownloadError ? error : new DownloadError('network-error', true);
            if (!problem.retryable || attempt >= retryLimit) throw problem;
          } finally {
            clearTimeout(timer);
          }
        }
      }

      try {
        progress('fetching', material.title);
        const pages = material.slideImages;
        let file: FileBytes;
        const merged = Boolean(merge && pages?.length);
        if (material.type === 'video_meta' && !material.downloadUrl && !pages?.length) {
          throw new DownloadError('unsupported-format');
        }
        if (merged && pages) {
          const images: SlideImageInput[] = [];
          for (const page of [...pages].sort((a, b) => a.index - b.index)) {
            images.push({ ...await getFile(page.url, page), width: page.width, height: page.height });
          }
          progress('converting-pdf', material.title);
          const bytes = await abortable(mergeSlideImagesToPdf(images, deps.imageConverter, {
            signal,
            onOutputSize: length => reserve(length - held),
          }), signal);
          file = { bytes, mimeType: 'application/pdf' };
        } else {
          if (!material.downloadUrl && pages?.length) throw new DownloadError('unsupported-format');
          file = await getFile(material.downloadUrl);
        }
        const checksum = await abortable(computeSha256Hex(file.bytes), signal);
        signal?.throwIfAborted();
        totalBytes += file.bytes.length;
        return {
          material, status: 'downloaded', filename: resultFilename(material, file.mimeType, merged), size: file.bytes.length,
          checksum, ...file,
        };
      } catch (error) {
        reserved -= held;
        const code = signal?.aborted ? 'cancelled' :
          error instanceof DownloadError ? error.code :
          (error as { code?: string } | undefined)?.code === 'unsupported-format' ? 'unsupported-format' : 'network-error';
        return failure(material, code);
      }
    }

    const outcomes = await runRateLimitedQueue(materials.map(material => async () => {
      const result = await download(material);
      if (result.status === 'downloaded') succeeded++;
      else if (result.status === 'skipped') skipped++;
      else failed++;
      completed++;
      progress(signal?.aborted ? 'cancelled' : 'fetching', material.title);
      return result;
    }), { signal, concurrency, intervalMs });
    const names = new Set<string>();
    const items = outcomes.map((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        const item = outcome.value;
        if (!item.filename) return item;
        const filename = neutralizeActiveExtension(deduplicateFilename(item.filename, names));
        return { ...item, filename, relativePath: buildSafeRelativePath([filename]) };
      }
      failed++;
      completed++;
      return failure(materials[index], signal?.aborted ? 'cancelled' : 'network-error');
    });
    const cancelled = signal?.aborted ?? false;
    progress(cancelled ? 'cancelled' : 'done');
    return { items, succeeded, failed, skipped, cancelled, totalBytes };
  }

  return {
    downloadBatch,
    async downloadMaterial(material: CourseMaterial, options?: DownloadBatchOptions): Promise<DownloadItemResult> {
      return (await downloadBatch([material], options)).items[0];
    },
    triggerBrowserDownload,
  };
}
