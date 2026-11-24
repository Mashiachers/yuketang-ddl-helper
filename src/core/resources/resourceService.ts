import type {
  Assignment, ChangesSinceReport, CourseMaterial, CourseProvider, CourseResourceIndex,
  Exam, ResourceDiscoveryResult, SyncStatusReport,
} from '../../types/resources';
import { HOUR_MS } from '../utils/time';
import { loadResourceIndex, reconcileMaterialsWithIndex, saveResourceIndex } from './indexStore';

export interface ResourceSyncOptions {
  signal?: AbortSignal;
  courseIds?: string[];
  onProgress?: (completed: number, total: number) => void;
}

export interface ResourceServiceOptions {
  origin: string;
  sourcePlatform: string;
  discoverFn: (options: ResourceSyncOptions) => Promise<ResourceDiscoveryResult>;
  loadIndex?: typeof loadResourceIndex;
  saveIndex?: typeof saveResourceIndex;
  now?: () => number;
}

export interface ResourceService extends CourseProvider {
  syncResources(options?: ResourceSyncOptions): Promise<ResourceDiscoveryResult>;
  getUpcomingDeadlines(withinHours?: number, signal?: AbortSignal): Promise<Array<Assignment | Exam>>;
  getSyncStatus(): Promise<SyncStatusReport>;
  getChangesSince(since: string, signal?: AbortSignal): Promise<ChangesSinceReport>;
}

type MaterialHistory = Pick<CourseMaterial, 'updatedAt' | 'size' | 'checksum'> & { firstSeenAt: string; changedAt?: string };
type IndexedHistory = CourseResourceIndex & { materialHistory?: Record<string, MaterialHistory> };

export function createResourceService(options: ResourceServiceOptions): ResourceService {
  const {
    discoverFn, sourcePlatform, loadIndex = loadResourceIndex, saveIndex = saveResourceIndex, now = Date.now,
  } = options;
  const origin = new URL(options.origin).origin;
  let current: ResourceDiscoveryResult | undefined;
  let pending: Promise<ResourceDiscoveryResult> | undefined;
  let syncQueue = Promise.resolve();

  function syncResources(syncOptions: ResourceSyncOptions = {}): Promise<ResourceDiscoveryResult> {
    const result = syncQueue.then(async () => {
      syncOptions.signal?.throwIfAborted();
      const discovered = await discoverFn(syncOptions);
      syncOptions.signal?.throwIfAborted();
      if (discovered.error) return discovered;
      if (new URL(discovered.origin).origin !== origin || discovered.sourcePlatform !== sourcePlatform) {
        throw new Error('Resource discovery returned a different origin or platform');
      }
      const index: IndexedHistory = await loadIndex(origin, sourcePlatform);
      syncOptions.signal?.throwIfAborted();
      const reconciled = reconcileMaterialsWithIndex(discovered.materials, index);
      const known = new Set(index.knownResourceKeys);
      const history = new Map(Object.entries(index.materialHistory ?? {}));
      for (const material of discovered.materials) {
        const previous = history.get(material.resourceKey);
        const changed = previous && (
          (material.updatedAt !== undefined && previous.updatedAt !== material.updatedAt) ||
          (material.size !== undefined && previous.size !== material.size) ||
          (material.checksum !== undefined && previous.checksum !== material.checksum)
        );
        history.set(material.resourceKey, {
          firstSeenAt: previous?.firstSeenAt ?? (known.has(material.resourceKey) && index.lastSyncedAt || discovered.syncedAt),
          changedAt: changed ? discovered.syncedAt : previous?.changedAt,
          updatedAt: material.updatedAt ?? previous?.updatedAt,
          size: material.size ?? previous?.size,
          checksum: material.checksum ?? previous?.checksum,
        });
        known.add(material.resourceKey);
      }
      const nextIndex: IndexedHistory = {
        ...index, lastSyncedAt: discovered.syncedAt, knownResourceKeys: [...known],
        materialHistory: Object.fromEntries(history),
      };
      await saveIndex(nextIndex);
      const snapshot = {
        ...discovered, materials: discovered.materials.map((material, i) => ({ ...material, isNew: reconciled.materials[i].isNew })),
      };
      const mergeBy = <T>(previous: readonly T[], incoming: readonly T[], key: (item: T) => string, courseId: (item: T) => string) => {
        const refreshed = new Set(discovered.courses.map(course => course.id));
        const items = new Map(previous.filter(item => !refreshed.has(courseId(item))).map(item => [key(item), item]));
        for (const item of incoming) items.set(key(item), item);
        return [...items.values()];
      };
      if (current && (syncOptions.courseIds?.length || discovered.failedCourses > 0)) {
        const preserveMissing = discovered.failedCourses > 0;
        const courseOf = (item: { courseId: string }) => item.courseId;
        const keyOf = (item: { resourceKey: string }) => item.resourceKey;
        const scope = preserveMissing ? () => '' : courseOf;
        current = {
          ...snapshot,
          courses: mergeBy(current.courses, snapshot.courses, item => item.id, item => preserveMissing ? '' : item.id),
          materials: mergeBy(current.materials, snapshot.materials, keyOf, scope),
          assignments: mergeBy(current.assignments, snapshot.assignments, keyOf, scope),
          exams: mergeBy(current.exams, snapshot.exams, keyOf, scope),
          announcements: mergeBy(current.announcements, snapshot.announcements, keyOf, scope),
        };
      } else {
        current = snapshot;
      }
      return structuredClone({ ...snapshot, materials: reconciled.materials });
    });
    syncQueue = result.then(() => {}, () => {});
    pending = result;
    const clear = () => { if (pending === result) pending = undefined; };
    void result.then(clear, clear);
    return result;
  }

  async function getSnapshot(signal?: AbortSignal): Promise<ResourceDiscoveryResult> {
    signal?.throwIfAborted();
    const snapshot = current ?? await (pending ?? syncResources({ signal }));
    signal?.throwIfAborted();
    if (snapshot.error) throw new Error('Resource discovery failed: ' + snapshot.error);
    return structuredClone(snapshot);
  }

  function deadlines<T extends Assignment | Exam>(items: T[], from: number, to = Infinity): T[] {
    return items.filter(item => {
      const deadline = Date.parse(item.deadline ?? '');
      return item.status === 'pending' && deadline >= from && deadline <= to;
    }).sort((a, b) => Date.parse(a.deadline!) - Date.parse(b.deadline!));
  }

  return {
    syncResources,
    async listCourses(signal) { return (await getSnapshot(signal)).courses; },
    async getCourse(courseId, signal) { return (await getSnapshot(signal)).courses.find(course => course.id === courseId) ?? null; },
    async listMaterials(courseId, signal) {
      const snapshot = await getSnapshot(signal);
      const index = await loadIndex(origin, sourcePlatform);
      signal?.throwIfAborted();
      const materials = snapshot.materials.filter(item => item.courseId === courseId);
      return reconcileMaterialsWithIndex(materials, index).materials.map((material, i) => ({
        ...material, isNew: materials[i].isNew && !Object.hasOwn(index.records, material.resourceKey),
      }));
    },
    async listAssignments(courseId, signal) { return (await getSnapshot(signal)).assignments.filter(item => item.courseId === courseId); },
    async listExams(courseId, signal) { return (await getSnapshot(signal)).exams.filter(item => item.courseId === courseId); },
    async listAnnouncements(courseId, signal) { return (await getSnapshot(signal)).announcements.filter(item => item.courseId === courseId); },
    async getUpcomingDeadlines(withinHours = 168, signal) {
      const from = now();
      const snapshot = await getSnapshot(signal);
      return deadlines([...snapshot.assignments, ...snapshot.exams], from, from + withinHours * HOUR_MS);
    },
    async getSyncStatus() {
      const index = await loadIndex(origin, sourcePlatform);
      const records = Object.values(index.records);
      return {
        origin, sourcePlatform, lastSyncedAt: index.lastSyncedAt || null,
        knownMaterials: index.knownResourceKeys.length,
        downloadedMaterials: records.filter(record => record.status === 'downloaded').length,
        failedMaterials: records.filter(record => record.status === 'failed').length,
      };
    },
    async getChangesSince(since, signal) {
      const cutoff = Date.parse(since);
      if (!Number.isFinite(cutoff)) throw new RangeError('Invalid changes timestamp');
      const snapshot = await getSnapshot(signal);
      const index: IndexedHistory = await loadIndex(origin, sourcePlatform);
      signal?.throwIfAborted();
      const isAfter = (value?: string) => Date.parse(value ?? '') > cutoff;
      const history = new Map(Object.entries(index.materialHistory ?? {}));
      const isNew = (material: CourseMaterial) => isAfter(history.get(material.resourceKey)?.firstSeenAt ?? material.publishedAt);
      return {
        since,
        newMaterials: snapshot.materials.filter(isNew),
        updatedMaterials: snapshot.materials.filter(material => !isNew(material) &&
          (isAfter(history.get(material.resourceKey)?.changedAt) || isAfter(material.updatedAt))),
        upcomingAssignments: deadlines(snapshot.assignments, now()),
        upcomingExams: deadlines(snapshot.exams, now()),
      };
    },
  };
}
