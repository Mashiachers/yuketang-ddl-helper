import type { CourseInfo, EndpointDiagnostic, EndpointOutcome, HomeworkItem, PlatformInfo } from '../../types';
import { normalizeCourses, normalizeHomework, unwrapRows } from '../normalizer/normalizer';
import { buildRequestHeaders, detectPlatform } from '../platform/detector';
import { courseEndpoints, taskEndpoints, type EndpointCandidate } from './endpoints';

export class YuketangApiError extends Error {
  constructor(public readonly outcome: EndpointOutcome) {
    super(outcome);
    this.name = 'YuketangApiError';
  }
}

export interface ApiClientOptions {
  cookie?: string;
  fetchImpl?: typeof fetch;
  onDiagnostic?: (entry: EndpointDiagnostic) => void;
}

export function createYuketangClient(platform: PlatformInfo, options: ApiClientOptions = {}) {
  if (!detectPlatform(platform.origin)) throw new Error('无效的雨课堂来源');
  const { cookie = '', fetchImpl = globalThis.fetch.bind(globalThis), onDiagnostic } = options;

  async function probe<T>(
    candidates: EndpointCandidate[],
    scope: EndpointDiagnostic['scope'],
    normalize: (data: unknown) => T[],
    signal?: AbortSignal,
    classroomId?: string,
  ): Promise<T[]> {
    let empty = false;
    let failure: EndpointOutcome = 'not-found';
    for (const endpoint of candidates) {
      signal?.throwIfAborted();
      const started = performance.now();
      let status: number | undefined;
      let outcome: EndpointOutcome = 'network-error';
      try {
        const response = await fetchImpl(new URL(endpoint.path, platform.origin), {
          credentials: 'include',
          mode: 'same-origin',
          redirect: 'manual',
          headers: buildRequestHeaders(platform, cookie, classroomId),
          signal,
        });
        status = response.status;
        if (status === 401 || status === 403 || response.type === 'opaqueredirect') outcome = 'unauthorized';
        else if (status === 404) outcome = 'not-found';
        else if (!response.ok) outcome = 'http-error';
        else {
          outcome = 'invalid-response';
          const data: unknown = await response.json();
          if (data && typeof data === 'object' && 'code' in data && [401, 403, '401', '403'].includes(data.code as number | string)) {
            outcome = 'unauthorized';
          } else {
            const rows = unwrapRows(data);
            const normalized = normalize(data);
            if (normalized.length || (rows && (scope === 'tasks' || rows.length === 0))) {
              outcome = 'ok';
              if (normalized.length) return normalized;
              empty = true;
            }
          }
        }
      } catch {
        signal?.throwIfAborted();
      } finally {
        if (!signal?.aborted) onDiagnostic?.({ endpoint: endpoint.label, scope, outcome, status, durationMs: Math.round(performance.now() - started) });
      }
      // A branch can reject an endpoint while accepting another candidate.
      if (outcome === 'unauthorized' || (outcome !== 'ok' && outcome !== 'not-found' && failure !== 'unauthorized')) failure = outcome;
    }
    if (empty) return [];
    throw new YuketangApiError(failure);
  }

  return {
    listCourses(signal?: AbortSignal): Promise<CourseInfo[]> {
      return probe(courseEndpoints, 'courses', data => normalizeCourses(data, platform.origin), signal);
    },
    listTasks(course: CourseInfo, signal?: AbortSignal): Promise<HomeworkItem[]> {
      const classroomId = course.classroomId || course.id;
      return probe(taskEndpoints(classroomId, course.id), 'tasks', data => normalizeHomework(data, platform.origin, course), signal, classroomId);
    },
  };
}
