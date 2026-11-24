import { RESOURCE_SCHEMA_VERSION } from '../../types/resources';
import type { CourseMaterial, CourseResourceIndex, DownloadItemResult, DownloadRecord } from '../../types/resources';
import { buildSafeRelativePath, redactCredentialText, sanitizeFilename } from './naming';

const memory = new Map<string, string>();
const storageKey = (origin: string, sourcePlatform: string) =>
  'ykt-ddl:resource-index:' + new URL(origin).origin + (sourcePlatform === 'demo' ? ':demo' : '');

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : bytes.slice();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function loadResourceIndex(origin: string, sourcePlatform: string): Promise<CourseResourceIndex> {
  const key = storageKey(origin, sourcePlatform);
  const empty: CourseResourceIndex = {
    schemaVersion: RESOURCE_SCHEMA_VERSION, origin: new URL(origin).origin, sourcePlatform,
    lastSyncedAt: '', knownResourceKeys: [], records: {},
  };
  const area = globalThis.chrome?.storage?.local;
  let index: CourseResourceIndex | undefined;
  if (area) {
    index = (await area.get(key))[key];
  } else {
    let raw = memory.get(key);
    if (raw === undefined) {
      try { raw = globalThis.localStorage?.getItem(key) ?? undefined; } catch { /* Storage unavailable */ }
    }
    if (raw !== undefined) {
      try { index = JSON.parse(raw); } catch { /* Discard invalid JSON */ }
    }
  }
  if (index?.schemaVersion !== RESOURCE_SCHEMA_VERSION || index.origin !== empty.origin ||
      index.sourcePlatform !== sourcePlatform || !Array.isArray(index.knownResourceKeys) ||
      !index.records || Array.isArray(index.records) || typeof index.records !== 'object') return empty;
  return index;
}

export async function saveResourceIndex(index: CourseResourceIndex): Promise<void> {
  const key = storageKey(index.origin, index.sourcePlatform);
  const area = globalThis.chrome?.storage?.local;
  if (area) return area.set({ [key]: index });
  const value = JSON.stringify(index);
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(key, value);
      memory.delete(key);
      return;
    }
  } catch { /* Storage unavailable */ }
  memory.set(key, value);
}

function sourceChanged(material: CourseMaterial, record: DownloadRecord): boolean {
  return Boolean(
    (material.updatedAt && material.updatedAt !== record.sourceUpdatedAt) ||
    (material.checksum && record.checksum && material.checksum !== record.checksum) ||
    // A merged PDF's byte length is not a source image size.
    (material.type !== 'image_slides' && material.size !== undefined &&
      record.size !== undefined && material.size !== record.size)
  );
}

export function reconcileMaterialsWithIndex(materials: readonly CourseMaterial[], index: CourseResourceIndex) {
  const known = new Set(index.knownResourceKeys);
  let newCount = 0;
  let updatedCount = 0;
  const reconciled = materials.map(material => {
    const record = Object.hasOwn(index.records, material.resourceKey) ? index.records[material.resourceKey] : undefined;
    const isNew = !known.has(material.resourceKey) && !record;
    if (isNew) newCount++;
    if (!record) return { ...material, isNew };
    const updated = sourceChanged(material, record);
    if (updated) updatedCount++;
    const downloadStatus = updated ? 'updated' : record.status;
    const reconciled: CourseMaterial = { ...material, isNew, downloadStatus };
    if (downloadStatus === 'downloaded') {
      reconciled.checksum = record.checksum;
      reconciled.localPath = record.relativePath;
    }
    return reconciled;
  });
  return { materials: reconciled, newCount, updatedCount };
}

export function recordDownloadOutcome(
  index: CourseResourceIndex,
  result: DownloadItemResult,
  nowIso = new Date().toISOString(),
): CourseResourceIndex {
  if (result.status === 'skipped' || result.errorCode === 'cancelled') return index;
  const material = result.material;
  const key = material.resourceKey;
  const previous = Object.hasOwn(index.records, key) ? index.records[key] : undefined;
  const filename = sanitizeFilename(result.filename ?? material.filename ?? material.title);
  let relativePath = filename;
  if (result.relativePath && redactCredentialText(result.relativePath) === result.relativePath) {
    try { relativePath = buildSafeRelativePath(result.relativePath.split('/')); } catch { /* Use safe filename */ }
  }
  const succeeded = result.status === 'downloaded';
  const sameContent = succeeded && previous?.status === 'downloaded' && !!result.checksum &&
    previous.checksum === result.checksum && previous.size === result.size &&
    previous.sourceUpdatedAt === material.updatedAt;
  return {
    ...index,
    knownResourceKeys: index.knownResourceKeys.includes(key) ? index.knownResourceKeys : [...index.knownResourceKeys, key],
    records: {
      ...index.records,
      [key]: {
        resourceKey: key, courseId: material.courseId, materialId: material.id,
        filename, relativePath,
        status: succeeded ? 'downloaded' : 'failed',
        sourceUpdatedAt: material.updatedAt,
        size: succeeded ? result.size : undefined,
        checksum: succeeded ? result.checksum : undefined,
        downloadedAt: sameContent ? previous.downloadedAt : succeeded ? nowIso : undefined,
        lastAttemptAt: nowIso,
        errorCode: succeeded ? undefined : result.errorCode,
        retryCount: succeeded ? 0 : previous?.status === 'failed' ? previous.retryCount + 1 : 0,
      },
    },
  };
}
