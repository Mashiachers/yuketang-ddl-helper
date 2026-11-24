import type {
  Announcement,
  Assignment,
  Course,
  CourseInfo,
  CourseMaterial,
  DownloadStatus,
  Exam,
  HomeworkItem,
  MaterialType,
  PlatformInfo,
  ResourceDiscoveryResult,
  ResourceEndpointDiagnostic,
  ResourceErrorCode,
  SlidePageAsset,
} from '../../types';
import { normalizeCourses, normalizeHomework, parseTimestamp, unwrapRows } from '../normalizer/normalizer';
import { buildRequestHeaders, detectPlatform } from '../platform/detector';
import { runRateLimitedQueue } from '../queue/rateLimitedQueue';
import {
  announcementEndpoints,
  chapterEndpoints,
  courseResourceEndpoints,
  learnLogEndpoint,
  lessonSummaryEndpoint,
  presentationSlidesEndpoint,
  RESOURCE_ENDPOINT_SPECS,
  type ResourceEndpointCandidate,
} from './endpoints';

export { RESOURCE_ENDPOINT_SPECS };

type Row = Record<string, unknown>;

const SENSITIVE_KEY_REGEX =
  /(cookie|csrftoken|csrf|sessionid|session_id|token|authorization|password|passwd|secret|jwt|auth|credential|api_?key)/i;
const SENSITIVE_VALUE_REGEX =
  /(sessionid\s*=|csrftoken\s*=|bearer\s+[a-z0-9._-]+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i;

const AUTH_BUSINESS_CODES = new Set<string>(['401', '403', '50000', '401002', '10005']);
const NOT_FOUND_BUSINESS_CODES = new Set<string>(['404', '80019', '20007', '20009']);

const METADATA_ALLOWLIST = new Set<string>([
  'rawType',
  'leafType',
  'coursewareId',
  'lessonId',
  'presentationId',
  'slidesCount',
  'pageCount',
  'duration',
  'isLocked',
  'status',
  'fileExt',
]);

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  middot: '·',
  laquo: '«',
  raquo: '»',
};

const BLOCK_TAG_REGEX =
  /<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|blockquote|pre|hr)\b[^>]*\/?>/gi;

const DANGEROUS_SCHEME_REGEX = /^\s*(?:javascript|data|vbscript|file|blob|about|ftp):/i;
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;

export interface ResourceDiscoveryOptions {
  cookie?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  courseIds?: string[];
  maxPages?: number;
  timeoutMs?: number;
  maxRetries?: number;
  onProgress?: (completed: number, total: number) => void;
  existingCourses?: CourseInfo[];
  existingHomework?: HomeworkItem[];
  concurrency?: number;
  intervalMs?: number;
  retryBaseDelayMs?: number;
  pageSize?: number;
}

export type FetchJsonResult =
  | {
      ok: true;
      data: unknown;
      status: number;
      outcome: 'ok';
      durationMs: number;
      attempts: number;
      note?: string;
    }
  | {
      ok: false;
      data?: undefined;
      status?: number;
      outcome: ResourceErrorCode;
      durationMs: number;
      attempts: number;
      note?: string;
    };

export interface FetchWithRetryOptions {
  headers: HeadersInit;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

function asRecord(value: unknown): Row | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : undefined;
}

function firstValue(row: Row, ...keys: string[]): string | number | undefined {
  for (const key of keys) {
    const field = row[key];
    if (typeof field === 'string' && field.trim()) return field.trim();
    if (typeof field === 'number' && Number.isFinite(field)) return field;
  }
  return undefined;
}

function firstString(row: Row, ...keys: string[]): string {
  const found = firstValue(row, ...keys);
  return found === undefined ? '' : String(found);
}

function firstNumber(row: Row, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const field = row[key];
    if (typeof field === 'number' && Number.isFinite(field)) return field;
    if (typeof field === 'string' && field.trim() !== '') {
      const parsed = Number(field.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function toIsoTimestamp(input: unknown): string | undefined {
  if (input === 0 || input === '0' || input === null || input === undefined) return undefined;
  const ms = parseTimestamp(input);
  if (ms === undefined || ms <= 0) return undefined;
  return new Date(ms).toISOString();
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return '';
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return '';
      if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) return '';
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return '';
      }
    }
    const mapped = NAMED_ENTITIES[entity.toLowerCase()];
    return mapped !== undefined ? mapped : full;
  });
}

/**
 * Pure TypeScript HTML-to-plain-text sanitizer.
 * Never touches DOM / innerHTML / DOMParser.
 */
export function stripHtmlToText(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';

  let text = raw
    // Remove HTML comments completely.
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove executable / non-content containers including their body.
    .replace(/<(script|style|noscript|template|iframe|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    // Remove unclosed script/style tags running to end-of-string.
    .replace(/<(script|style|noscript|template|iframe)\b[^>]*>[\s\S]*$/gi, '')
    // Preserve logical line breaks for block elements.
    .replace(BLOCK_TAG_REGEX, '\n');

  // Iteratively strip any remaining or nested HTML tags until fixed point.
  let previous: string;
  let guard = 0;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, '');
    guard++;
  } while (text !== previous && guard < 16);

  // Strip stray unclosed opening/closing tags at the end.
  text = text.replace(/<\/?[a-zA-Z!?][^>]*$/g, '');

  text = decodeHtmlEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * Validates and normalizes resource URLs.
 * Rejects non-http(s) protocols (javascript:, data:, file:, etc.), control characters,
 * and embedded credentials (user:pass@host). External URLs are permitted only when
 * allowExternalHttps is true and the resolved protocol is https:.
 */
export function sanitizeResourceUrl(
  raw: unknown,
  origin: string,
  allowExternalHttps = false,
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (CONTROL_CHAR_REGEX.test(trimmed)) return undefined;
  if (DANGEROUS_SCHEME_REGEX.test(trimmed)) return undefined;

  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, base);
  } catch {
    return undefined;
  }

  if (parsed.username || parsed.password) return undefined;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;

  if (parsed.origin === base.origin) {
    return parsed.href;
  }

  if (allowExternalHttps && parsed.protocol === 'https:') {
    return parsed.href;
  }

  return undefined;
}

export function buildMaterialKey(courseId: string, type: MaterialType, id: string): string {
  return `${courseId.trim()}:${type}:${id.trim()}`;
}

function buildEntityKey(courseId: string, kind: 'assignment' | 'exam' | 'announcement', id: string): string {
  return `${courseId.trim()}:${kind}:${id.trim()}`;
}

export function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!input) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!METADATA_ALLOWLIST.has(key)) continue;
    if (SENSITIVE_KEY_REGEX.test(key)) continue;
    if (value === undefined) continue;
    if (value === null || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'string') {
      const cleaned = value.trim();
      if (!cleaned || cleaned.length > 160) continue;
      if (SENSITIVE_VALUE_REGEX.test(cleaned)) continue;
      out[key] = cleaned;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDiagnosticNote(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const cleaned = note
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(SENSITIVE_VALUE_REGEX, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

function extractExtension(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutQuery = value.split(/[?#]/)[0] ?? '';
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(withoutQuery.trim());
  return match ? match[1].toLowerCase() : undefined;
}

function inferMimeFromExtension(ext: string | undefined): string | undefined {
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'md':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'zip':
      return 'application/zip';
    default:
      return undefined;
  }
}

export function cleanDisplayTitle(raw: string): string {
  return raw
    .replace(/\+-+\+/g, ' - ')
    .replace(/(?<=\p{Script=Han})\+(?=[\p{L}\p{N}])|(?<=[\p{L}\p{N}])\+(?=\p{Script=Han})/gu, ' ')
    .trim();
}

function inferMaterialType(input: {
  explicitType?: unknown;
  rawType?: string | number;
  leafType?: number;
  mimeType?: string;
  filename?: string;
  downloadUrl?: string;
  hasSlideImages?: boolean;
  defaultType?: MaterialType;
}): MaterialType {
  if (input.defaultType === 'announcement_attachment') return 'announcement_attachment';
  if (input.hasSlideImages) return 'image_slides';
  if (input.leafType === 8) return 'slides';

  const explicit = typeof input.explicitType === 'string' ? input.explicitType.trim().toLowerCase() : '';
  if (explicit === 'announcement_attachment') return 'announcement_attachment';
  if (explicit === 'image_slides') return 'image_slides';
  if (explicit === 'pdf') return 'pdf';
  if (explicit === 'ppt' || explicit === 'pptx') return 'ppt';
  if (explicit === 'slides' || explicit === 'presentation' || explicit === 'courseware') return 'slides';
  if (explicit === 'document' || explicit === 'doc' || explicit === 'docx' || explicit === 'word') return 'document';
  if (explicit === 'video_meta' || explicit === 'video') return 'video_meta';
  if (explicit === 'attachment' || explicit === 'file') return 'attachment';

  const ext = extractExtension(input.filename) ?? extractExtension(input.downloadUrl);
  const mime = (input.mimeType ?? '').toLowerCase();

  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'ppt' || ext === 'pptx' || mime.includes('powerpoint') || mime.includes('presentationml')) {
    return 'ppt';
  }
  if (
    ext === 'doc' ||
    ext === 'docx' ||
    ext === 'md' ||
    ext === 'txt' ||
    ext === 'rtf' ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv' ||
    mime.includes('msword') ||
    mime.includes('wordprocessingml') ||
    mime.includes('spreadsheetml') ||
    mime.startsWith('text/')
  ) {
    return 'document';
  }
  if (
    ext === 'zip' ||
    ext === 'rar' ||
    ext === '7z' ||
    ext === 'tar' ||
    ext === 'gz' ||
    ext === 'py' ||
    ext === 'c' ||
    ext === 'cpp' ||
    ext === 'java' ||
    ext === 'ipynb' ||
    ext === 'json' ||
    ext === 'xml'
  ) {
    return 'attachment';
  }

  if (input.rawType === 17 || input.rawType === '17' || input.leafType === 0) return 'video_meta';
  if (input.rawType === 2 || input.rawType === '2' || input.rawType === 14 || input.rawType === '14') {
    return 'slides';
  }
  if (input.leafType === 3 || input.leafType === 7) return 'document';
  if (
    input.rawType === 10 ||
    input.rawType === '10' ||
    input.rawType === 11 ||
    input.rawType === '11' ||
    input.rawType === 12 ||
    input.rawType === '12'
  ) {
    return 'attachment';
  }

  if (/slide|ppt|课件|讲义/i.test(explicit)) return 'slides';
  if (/pdf/i.test(explicit)) return 'pdf';
  if (/doc|word|文档|阅读|图文/i.test(explicit)) return 'document';
  if (/attach|file|资料|附件/i.test(explicit)) return 'attachment';
  if (/video|回放|视频/i.test(explicit)) return 'video_meta';

  return input.defaultType ?? 'other';
}

function buildFallbackCourseUrl(course: Pick<Course, 'id' | 'classroomId'>, origin: string): string | undefined {
  const target = course.classroomId || course.id;
  if (!target) return undefined;
  return sanitizeResourceUrl(`/v2/web/studentLog/${encodeURIComponent(target)}`, origin, false);
}

/**
 * Normalizes course list payloads into unified v0.2 Course models.
 */
export function normalizeResourceCourses(input: unknown, platform: PlatformInfo): Course[] {
  const courses = new Map<string, Course>();

  // Seed with v0.1 course normalizer for backward-compatible field extraction.
  for (const base of normalizeCourses(input, platform.origin)) {
    const key = base.classroomId || base.id;
    courses.set(key, {
      id: base.id,
      classroomId: base.classroomId,
      name: stripHtmlToText(base.name) || base.name,
      teacher: base.teacher ? stripHtmlToText(base.teacher) : undefined,
      term: base.term,
      sourcePlatform: platform.label,
      sourceOrigin: platform.origin,
      sourceUrl: sanitizeResourceUrl(base.url, platform.origin, false),
    });
  }

  // Enrich with nested teacher objects, descriptions, and updatedAt from v2/v3/mooc payloads.
  for (const entry of unwrapRows(input) ?? []) {
    const nestedCourse = asRecord(entry.course) ?? asRecord(entry.course_info);
    const nestedClassroom = asRecord(entry.classroom);
    const row: Row = { ...entry, ...nestedCourse };

    const classroomId =
      firstString(entry, 'classroomId', 'classroom_id', 'class_id', 'classroomid') ||
      firstString(nestedClassroom ?? {}, 'id', 'classroom_id');
    const id = firstString(row, 'courseId', 'course_id', 'courseid', 'id') || classroomId;
    const rawName = firstString(row, 'courseName', 'course_name', 'name', 'title', 'classroom_name', 'sku_name');
    const name = stripHtmlToText(rawName);
    if (!id || !name) continue;

    const teacherObj = asRecord(entry.teacher) ?? asRecord(row.teacher);
    const teacherName = stripHtmlToText(
      firstString(row, 'teacher_name', 'teacherName', 'instructor') ||
        (typeof entry.teacher === 'string' ? entry.teacher : '') ||
        (teacherObj ? firstString(teacherObj, 'name', 'teacher_name', 'nickname') : ''),
    );
    const term = firstString(entry, 'term', 'semester', 'term_name') || firstString(row, 'term', 'semester', 'term_name');
    const rawDesc = firstString(row, 'description', 'intro', 'brief', 'course_intro');
    const description = rawDesc ? stripHtmlToText(rawDesc) : undefined;
    const updatedAt = toIsoTimestamp(firstValue(row, 'updatedAt', 'updated_at', 'update_time', 'modify_time'));
    const rawUrl =
      firstString(row, 'sourceUrl', 'source_url', 'url', 'course_url') ||
      (classroomId ? `/v2/web/studentLog/${encodeURIComponent(classroomId)}` : '');

    const key = classroomId || id;
    const existing = courses.get(key);
    courses.set(key, {
      id: existing?.id || id,
      classroomId: existing?.classroomId || classroomId || undefined,
      name: existing?.name || name,
      teacher: teacherName || existing?.teacher || undefined,
      term: term || existing?.term || undefined,
      description: description || existing?.description || undefined,
      sourcePlatform: platform.label,
      sourceOrigin: platform.origin,
      sourceUrl: sanitizeResourceUrl(rawUrl, platform.origin, false) || existing?.sourceUrl,
      updatedAt: updatedAt || existing?.updatedAt,
    });
  }

  return [...courses.values()];
}

/**
 * Normalizes slide/presentation payloads into an ordered list of sanitized SlidePageAsset entries.
 */
export function normalizeSlidePages(input: unknown, origin: string): SlidePageAsset[] {
  const candidates: unknown[] = [];

  function collect(node: unknown, depth = 0): void {
    if (depth > 4 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) candidates.push(item);
      return;
    }
    const obj = asRecord(node);
    if (!obj) return;
    const arrayKeys = ['slides', 'slide_list', 'pages', 'images', 'list', 'items', 'cards', 'results'];
    let matched = false;
    for (const key of arrayKeys) {
      if (Array.isArray(obj[key])) {
        matched = true;
        for (const item of obj[key] as unknown[]) candidates.push(item);
      }
    }
    if (!matched && obj.data !== undefined) {
      collect(obj.data, depth + 1);
    }
  }

  collect(input);

  const byIndex = new Map<number, SlidePageAsset>();
  const seenUrls = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (typeof item === 'string') {
      const url = sanitizeResourceUrl(item, origin, true);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      const index = i + 1;
      byIndex.set(index, {
        index,
        url,
        mimeType: inferMimeFromExtension(extractExtension(url)) ?? 'image/jpeg',
      });
      continue;
    }

    const row = asRecord(item);
    if (!row) continue;

    const rawUrl = firstString(
      row,
      'cover',
      'cover_url',
      'image',
      'image_url',
      'imageUrl',
      'img',
      'pic',
      'url',
      'src',
      'thumbnail',
    );
    const url = sanitizeResourceUrl(rawUrl, origin, true);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const rawIndex = firstNumber(row, 'index', 'page', 'page_num', 'pageIndex', 'order', 'sort');
    const index = rawIndex !== undefined && rawIndex > 0 ? Math.floor(rawIndex) : i + 1;
    const width = firstNumber(row, 'width', 'w');
    const height = firstNumber(row, 'height', 'h');
    const mimeType =
      firstString(row, 'mimeType', 'mime_type', 'content_type') ||
      inferMimeFromExtension(extractExtension(url)) ||
      'image/jpeg';
    const rawNote = firstString(row, 'note', 'remark', 'caption', 'text');
    const note = rawNote ? stripHtmlToText(rawNote) : undefined;

    if (!byIndex.has(index)) {
      byIndex.set(index, {
        index,
        url,
        width: width && width > 0 ? Math.round(width) : undefined,
        height: height && height > 0 ? Math.round(height) : undefined,
        mimeType,
        note: note || undefined,
      });
    }
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function isAnnouncementRow(row: Row, rawType: string | number | undefined): boolean {
  if (rawType === 6 || rawType === '6' || rawType === 9 || rawType === '9' || rawType === 15 || rawType === '15') {
    return true;
  }
  const typeText = firstString(row, 'type', 'kind', 'activity_type', 'object_type');
  return /^(?:announcement|notice|公告|通知)$/i.test(typeText);
}

function isHomeworkOnlyRow(row: Row, rawType: string | number | undefined): boolean {
  if (rawType === 4 || rawType === '4' || rawType === 5 || rawType === '5' || rawType === 19 || rawType === '19') {
    return true;
  }
  const leafType = firstNumber(row, 'leaf_type', 'leafType');
  if (leafType === 4 || leafType === 6) return true;
  const typeText = firstString(row, 'type', 'kind', 'activity_type');
  return /^(?:homework|exam|quiz|paper|assignment|discussion)$/i.test(typeText);
}

function extractAttachmentsFromRow(
  row: Row,
  course: Course,
  origin: string,
  opts: {
    parentId: string;
    experimental?: boolean;
    chapterId?: string;
    chapterTitle?: string;
    defaultType?: MaterialType;
    publishedAt?: string;
  },
): CourseMaterial[] {
  const lists = [row.attachments, row.files, row.file_list, row.enclosures, asRecord(row.content)?.attachments, asRecord(row.content)?.files];
  const materials: CourseMaterial[] = [];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (let idx = 0; idx < list.length; idx++) {
      const entry = asRecord(list[idx]);
      if (!entry) continue;
      const rawDownload = firstString(entry, 'downloadUrl', 'download_url', 'file_url', 'url', 'href', 'link', 'src');
      const downloadUrl = sanitizeResourceUrl(rawDownload, origin, true);
      const filename = firstString(entry, 'filename', 'file_name', 'name', 'title') || undefined;
      const title = stripHtmlToText(firstString(entry, 'title', 'name', 'filename', 'file_name')) || filename || `附件 ${idx + 1}`;
      const id = firstString(entry, 'id', 'file_id', 'attachment_id') || `${opts.parentId}-att-${idx + 1}`;
      const mimeType =
        firstString(entry, 'mimeType', 'mime_type', 'content_type') ||
        inferMimeFromExtension(extractExtension(filename) ?? extractExtension(downloadUrl));
      const type = inferMaterialType({
        explicitType: entry.type,
        mimeType,
        filename,
        downloadUrl,
        defaultType: opts.defaultType ?? 'attachment',
      });
      const size = firstNumber(entry, 'size', 'file_size', 'filesize');
      const downloadStatus: DownloadStatus = downloadUrl ? 'not_downloaded' : 'unavailable';

      materials.push({
        id,
        resourceKey: buildMaterialKey(course.id, type, id),
        courseId: course.id,
        classroomId: course.classroomId,
        courseName: course.name,
        chapterId: opts.chapterId,
        chapterTitle: opts.chapterTitle,
        title,
        type,
        sourcePlatform: course.sourcePlatform,
        sourceUrl: sanitizeResourceUrl(firstString(entry, 'sourceUrl', 'source_url'), origin, false) ?? buildFallbackCourseUrl(course, origin),
        downloadUrl,
        publishedAt: toIsoTimestamp(firstValue(entry, 'publishedAt', 'publish_time', 'create_time', 'created_at')) ?? opts.publishedAt,
        updatedAt: toIsoTimestamp(firstValue(entry, 'updatedAt', 'updated_at', 'update_time')),
        mimeType,
        filename,
        size: size !== undefined && size > 0 ? Math.round(size) : undefined,
        downloadStatus,
        experimental: opts.experimental,
        metadata: sanitizeMetadata({
          fileExt: extractExtension(filename) ?? extractExtension(downloadUrl),
        }),
      });
    }
  }

  return materials;
}

function mergeMaterials(existing: CourseMaterial, incoming: CourseMaterial): CourseMaterial {
  const slideImages =
    incoming.slideImages && incoming.slideImages.length > (existing.slideImages?.length ?? 0)
      ? incoming.slideImages
      : existing.slideImages;
  const downloadUrl = incoming.downloadUrl || existing.downloadUrl;
  const type = slideImages?.length ? 'image_slides' : existing.type === 'other' ? incoming.type : existing.type;
  const downloadStatus: DownloadStatus =
    downloadUrl || (slideImages && slideImages.length > 0)
      ? existing.downloadStatus === 'downloaded'
        ? 'downloaded'
        : 'not_downloaded'
      : existing.downloadStatus;

  return {
    ...existing,
    chapterId: existing.chapterId || incoming.chapterId,
    chapterTitle: existing.chapterTitle || incoming.chapterTitle,
    title: existing.title || incoming.title,
    type,
    sourceUrl: existing.sourceUrl || incoming.sourceUrl,
    downloadUrl,
    slideImages,
    publishedAt: existing.publishedAt || incoming.publishedAt,
    updatedAt: incoming.updatedAt || existing.updatedAt,
    mimeType: existing.mimeType || incoming.mimeType,
    filename: existing.filename || incoming.filename,
    size: existing.size ?? incoming.size,
    downloadStatus,
    experimental:
      (incoming.experimental && (Boolean(incoming.downloadUrl) || Boolean(incoming.slideImages?.length))) ||
      (existing.experimental && (Boolean(existing.downloadUrl) || Boolean(existing.slideImages?.length)))
        ? true
        : existing.experimental === false || incoming.experimental === false
          ? false
          : existing.experimental ?? incoming.experimental,
    metadata: sanitizeMetadata({ ...existing.metadata, ...incoming.metadata }),
  };
}

function normalizeMaterialRow(
  entry: Row,
  course: Course,
  origin: string,
  options: { experimental?: boolean; chapterId?: string; chapterTitle?: string },
): CourseMaterial[] {
  const contentObj = asRecord(entry.content);
  const payload = asRecord(entry.material) ?? asRecord(entry.courseware) ?? asRecord(entry.object) ?? asRecord(entry.file);
  const row: Row = { ...entry, ...payload };

  const id = firstString(
    row,
    'id',
    'material_id',
    'file_id',
    'leaf_id',
    'presentation_id',
    'courseware_id',
    'lesson_id',
    'activity_id',
    'log_id',
  );
  const rawTitle = firstString(row, 'title', 'name', 'file_name', 'filename', 'courseware_name', 'lesson_name', 'activity_name');
  const title = stripHtmlToText(rawTitle);
  const rawType = firstValue(row, 'type', 'activity_type', 'actype', 'log_type', 'object_type');
  const leafType = firstNumber(row, 'leaf_type', 'leafType');
  const chapterId = firstString(row, 'chapterId', 'chapter_id', 'section_id') || options.chapterId;
  const chapterTitleRaw = firstString(row, 'chapterTitle', 'chapter_title', 'section_name', 'chapter_name') || options.chapterTitle || '';
  const chapterTitle = chapterTitleRaw ? stripHtmlToText(chapterTitleRaw) : undefined;
  const publishedAt = toIsoTimestamp(
    firstValue(row, 'publishedAt', 'publish_time', 'pub_time', 'create_time', 'created_at', 'start_time', 'time'),
  );
  const updatedAt = toIsoTimestamp(firstValue(row, 'updatedAt', 'updated_at', 'update_time', 'modify_time'));

  const announcement = isAnnouncementRow(row, rawType);
  const attachments = extractAttachmentsFromRow(row, course, origin, {
    parentId: id || 'item',
    experimental: options.experimental,
    chapterId,
    chapterTitle,
    defaultType: announcement ? 'announcement_attachment' : 'attachment',
    publishedAt,
  });

  // Announcements themselves are handled by normalizeAnnouncements; only surface their attachments here.
  if (announcement) {
    return attachments;
  }

  // Homework/exam/discussion rows are surfaced as materials only via their downloadable attachments.
  if (isHomeworkOnlyRow(row, rawType) && !firstString(row, 'downloadUrl', 'download_url', 'file_url')) {
    return attachments;
  }

  if (!id || !title) {
    return attachments;
  }

  const slideSource =
    row.slideImages ??
    row.slide_images ??
    row.slides ??
    row.pages ??
    contentObj?.slides ??
    contentObj?.pages;
  const slideImages = slideSource ? normalizeSlidePages(slideSource, origin) : [];

  const rawDownload =
    firstString(row, 'downloadUrl', 'download_url', 'file_url', 'pdf_url', 'ppt_url', 'doc_url', 'attachment_url') ||
    firstString(contentObj ?? {}, 'download_url', 'file_url', 'pdf_url', 'url');
  const downloadUrl = sanitizeResourceUrl(rawDownload, origin, true);

  const rawSourceUrl = firstString(row, 'sourceUrl', 'source_url', 'url', 'link', 'detail_url');
  const sourceUrl = sanitizeResourceUrl(rawSourceUrl, origin, false) ?? buildFallbackCourseUrl(course, origin);

  const filename = firstString(row, 'filename', 'file_name') || undefined;
  const mimeType =
    firstString(row, 'mimeType', 'mime_type', 'content_type') ||
    inferMimeFromExtension(extractExtension(filename) ?? extractExtension(downloadUrl));

  const type = inferMaterialType({
    explicitType: firstString(row, 'material_type', 'file_type', 'kind') || (typeof rawType === 'string' ? rawType : undefined),
    rawType,
    leafType,
    mimeType,
    filename,
    downloadUrl,
    hasSlideImages: slideImages.length > 0,
  });

  const size = firstNumber(row, 'size', 'file_size', 'filesize');
  const slidesCount = firstNumber(row, 'slidesCount', 'slides_count', 'page_count', 'pages_count') ?? (slideImages.length || undefined);
  const isLocked = row.is_locked === true || row.locked === true;
  const downloadStatus: DownloadStatus =
    !isLocked && (downloadUrl || slideImages.length > 0) ? 'not_downloaded' : 'unavailable';

  const coursewareId = firstString(row, 'courseware_id', 'coursewareId') || firstString(contentObj ?? {}, 'courseware_id');
  const leafLessonId = leafType === 8 ? String(firstValue(row, 'leafinfo_id') || id) : '';
  const metadata = sanitizeMetadata({
    rawType: rawType !== undefined ? rawType : undefined,
    leafType,
    coursewareId: coursewareId || undefined,
    lessonId:
      leafLessonId || firstString(row, 'lesson_id', 'lessonId') ||
      (rawType === 14 || rawType === '14' ? coursewareId || id : '') ||
      undefined,
    presentationId: firstString(row, 'presentation_id', 'presentationId') || undefined,
    slidesCount,
    duration: firstNumber(row, 'duration', 'video_duration'),
    isLocked: isLocked ? true : undefined,
    status: firstValue(asRecord(row.progress) ?? row, 'status'),
    fileExt: extractExtension(filename) ?? extractExtension(downloadUrl),
  });

  const primary: CourseMaterial = {
    id,
    resourceKey: buildMaterialKey(course.id, type, id),
    courseId: course.id,
    classroomId: course.classroomId,
    courseName: course.name,
    chapterId,
    chapterTitle,
    title,
    type,
    sourcePlatform: course.sourcePlatform,
    sourceUrl,
    downloadUrl,
    slideImages: slideImages.length > 0 ? slideImages : undefined,
    publishedAt,
    updatedAt,
    mimeType,
    filename,
    size: size !== undefined && size > 0 ? Math.round(size) : undefined,
    downloadStatus,
    experimental: options.experimental,
    metadata,
  };

  return [primary, ...attachments];
}

/**
 * Normalizes heterogeneous Yuketang resource payloads (learn logs, chapter progress trees,
 * presentations, and file/attachment arrays) into deduplicated CourseMaterial[].
 */
export function normalizeCourseMaterials(
  input: unknown,
  course: Course,
  origin: string,
  options: { experimental?: boolean; chapterId?: string; chapterTitle?: string } = {},
): CourseMaterial[] {
  const collected = new Map<string, CourseMaterial>();

  function addMaterial(mat: CourseMaterial): void {
    const existing = collected.get(mat.resourceKey);
    collected.set(mat.resourceKey, existing ? mergeMaterials(existing, mat) : mat);
  }

  function walkChapterTree(node: unknown, inheritedChapterId?: string, inheritedChapterTitle?: string, depth = 0): boolean {
    if (depth > 5 || node === null || node === undefined) return false;
    if (Array.isArray(node)) {
      let handled = false;
      for (const item of node) {
        if (walkChapterTree(item, inheritedChapterId, inheritedChapterTitle, depth + 1)) handled = true;
      }
      return handled;
    }

    const obj = asRecord(node);
    if (!obj) return false;

    // Unwrap top-level data wrapper if it contains chapter/progress trees.
    if (obj.data !== undefined && (asRecord(obj.data) || Array.isArray(obj.data))) {
      const inner = asRecord(obj.data);
      if (
        inner &&
        (Array.isArray(inner.course_progress) ||
          Array.isArray(inner.course_chapter) ||
          Array.isArray(inner.chapters) ||
          Array.isArray(inner.presentations))
      ) {
        return walkChapterTree(inner, inheritedChapterId, inheritedChapterTitle, depth + 1);
      }
    }

    // Handle lesson-summary presentations[].
    if (Array.isArray(obj.presentations)) {
      const lessonId = firstString(asRecord(obj.lesson) ?? obj, 'id', 'lesson_id', 'lessonId') || undefined;
      for (const rawPres of obj.presentations) {
        const pres = asRecord(rawPres);
        if (!pres) continue;
        const enriched: Row = {
          ...pres,
          presentation_id: firstString(pres, 'presentation_id', 'id'),
          lesson_id: lessonId,
          material_type: 'slides',
        };
        for (const mat of normalizeMaterialRow(enriched, course, origin, {
          experimental: options.experimental,
          chapterId: inheritedChapterId ?? options.chapterId,
          chapterTitle: inheritedChapterTitle ?? options.chapterTitle,
        })) {
          addMaterial(mat);
        }
      }
      return true;
    }

    const chapterContainerKeys = ['course_progress', 'course_chapter', 'chapters', 'sections'];
    let foundTree = false;
    for (const key of chapterContainerKeys) {
      if (!Array.isArray(obj[key])) continue;
      foundTree = true;
      for (const rawChapter of obj[key] as unknown[]) {
        const chapter = asRecord(rawChapter);
        if (!chapter) continue;
        const chapterId = firstString(chapter, 'id', 'chapter_id', 'section_id') || inheritedChapterId || options.chapterId;
        const chapterTitleRaw = firstString(chapter, 'name', 'title', 'chapter_name', 'section_name');
        const chapterTitle = chapterTitleRaw ? stripHtmlToText(chapterTitleRaw) : inheritedChapterTitle ?? options.chapterTitle;

        // Recurse if chapter contains nested sections.
        if (Array.isArray(chapter.sections) || Array.isArray(chapter.chapters)) {
          walkChapterTree(chapter, chapterId, chapterTitle, depth + 1);
        }

        const leafListKeys = ['section_leaf_list', 'leaf_list', 'leaves', 'materials', 'items', 'files'];
        for (const leafKey of leafListKeys) {
          if (!Array.isArray(chapter[leafKey])) continue;
          for (const rawLeaf of chapter[leafKey] as unknown[]) {
            const leaf = asRecord(rawLeaf);
            if (!leaf) continue;
            // Some MOOC chapter trees nest one extra `leaf_list` level inside a section node.
            if (Array.isArray(leaf.leaf_list)) {
              const subId = firstString(leaf, 'id', 'section_id') || chapterId;
              const subTitle = stripHtmlToText(firstString(leaf, 'name', 'title')) || chapterTitle;
              for (const subLeaf of leaf.leaf_list as unknown[]) {
                const subRow = asRecord(subLeaf);
                if (!subRow) continue;
                for (const mat of normalizeMaterialRow(subRow, course, origin, {
                  experimental: options.experimental,
                  chapterId: subId,
                  chapterTitle: subTitle,
                })) {
                  addMaterial(mat);
                }
              }
              continue;
            }
            for (const mat of normalizeMaterialRow(leaf, course, origin, {
              experimental: options.experimental,
              chapterId,
              chapterTitle,
            })) {
              addMaterial(mat);
            }
          }
        }
      }
    }

    return foundTree;
  }

  const handledAsTree = walkChapterTree(input, options.chapterId, options.chapterTitle);
  if (!handledAsTree) {
    const rows = unwrapRows(input) ?? (asRecord(input) ? [asRecord(input)!] : []);
    for (const row of rows) {
      for (const mat of normalizeMaterialRow(row, course, origin, options)) {
        addMaterial(mat);
      }
    }
  }

  return [...collected.values()];
}

/**
 * Normalizes announcement payloads (both discussion announcements API and learn log notices)
 * into sanitized plain-text Announcement[] without raw HTML.
 */
export function normalizeAnnouncements(
  input: unknown,
  course: Course,
  origin: string,
  options: { experimental?: boolean } = {},
): Announcement[] {
  const announcements = new Map<string, Announcement>();

  // Handle nested { data: { data: [...] } } from /v/discussion/v2/announcements/ as well as standard wrappers.
  const rows: Row[] = [];
  const root = asRecord(input);
  const rootData = asRecord(root?.data);
  if (rootData && Array.isArray(rootData.announcements)) {
    for (const item of rootData.announcements) {
      const r = asRecord(item);
      if (r) rows.push(r);
    }
  } else if (root && Array.isArray(root.announcements)) {
    for (const item of root.announcements) {
      const r = asRecord(item);
      if (r) rows.push(r);
    }
  } else {
    rows.push(...(unwrapRows(input) ?? (root ? [root] : [])));
  }

  for (const entry of rows) {
    const payload = asRecord(entry.announcement) ?? asRecord(entry.notice) ?? asRecord(entry.object);
    const row: Row = { ...entry, ...payload };
    const rawType = firstValue(row, 'type', 'activity_type', 'actype', 'log_type');

    // If this row came from mixed learn logs, only accept announcement-typed entries.
    if (
      rawType !== undefined &&
      !isAnnouncementRow(row, rawType) &&
      !('announcement_id' in row) &&
      !('notice_id' in row) &&
      !('bulletin_id' in row)
    ) {
      continue;
    }

    const id = firstString(row, 'announcement_id', 'notice_id', 'bulletin_id', 'id', 'activity_id', 'log_id');
    const rawTitle = firstString(row, 'title', 'subject', 'name', 'activity_name');
    const title = stripHtmlToText(rawTitle);
    if (!id || !title) continue;

    const contentField =
      typeof row.content === 'string'
        ? row.content
        : firstString(asRecord(row.content) ?? {}, 'text', 'body', 'html', 'content', 'description') ||
          firstString(row, 'body', 'text', 'detail', 'description', 'html', 'summary');
    const content = contentField ? stripHtmlToText(contentField) : undefined;

    const publishedAt = toIsoTimestamp(
      firstValue(row, 'publishedAt', 'publish_time', 'pub_time', 'create_time', 'created_at', 'time'),
    );
    const updatedAt = toIsoTimestamp(firstValue(row, 'updatedAt', 'updated_at', 'update_time'));
    const sourceUrl =
      sanitizeResourceUrl(firstString(row, 'sourceUrl', 'source_url', 'url', 'link'), origin, false) ??
      buildFallbackCourseUrl(course, origin);

    const attachments = extractAttachmentsFromRow(row, course, origin, {
      parentId: id,
      defaultType: 'announcement_attachment',
      publishedAt,
      experimental: options.experimental,
    });

    const resourceKey = buildEntityKey(course.id, 'announcement', id);
    announcements.set(resourceKey, {
      id,
      resourceKey,
      courseId: course.id,
      courseName: course.name,
      title,
      content: content || undefined,
      publishedAt,
      updatedAt,
      sourcePlatform: course.sourcePlatform,
      sourceUrl,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  }

  return [...announcements.values()].sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });
}

function parseScorePair(item: HomeworkItem): { score?: number | null; totalScore?: number | null } {
  const hint = item.rawStatusHint;
  const score =
    hint && typeof hint.score === 'number' && Number.isFinite(hint.score) ? hint.score : undefined;
  const totalScore =
    hint && typeof hint.total_score === 'number' && Number.isFinite(hint.total_score)
      ? hint.total_score
      : undefined;
  return { score, totalScore };
}

/**
 * Maps v0.1 HomeworkItem[] into v0.2 Assignment[] and Exam[] domain models.
 */
export function mapHomeworkToDomain(
  items: readonly HomeworkItem[],
  platform: PlatformInfo,
): { assignments: Assignment[]; exams: Exam[] } {
  const assignments = new Map<string, Assignment>();
  const exams = new Map<string, Exam>();

  for (const item of items) {
    if (item.type === 'announcement') continue;
    const deadline =
      item.deadline !== null && Number.isFinite(item.deadline) && item.deadline > 0
        ? new Date(item.deadline).toISOString()
        : null;
    const publishedAt =
      item.startTime !== undefined && Number.isFinite(item.startTime) && item.startTime > 0
        ? new Date(item.startTime).toISOString()
        : undefined;
    const updatedAt =
      item.updatedAt !== undefined && Number.isFinite(item.updatedAt) && item.updatedAt > 0
        ? new Date(item.updatedAt).toISOString()
        : undefined;
    const sourceUrl = sanitizeResourceUrl(item.url, platform.origin, false);
    const title = stripHtmlToText(item.title) || item.title;
    const summary = item.summary ? stripHtmlToText(item.summary) || undefined : undefined;
    const { score, totalScore } = parseScorePair(item);

    if (item.type === 'exam') {
      const resourceKey = buildEntityKey(item.courseId, 'exam', item.id);
      exams.set(resourceKey, {
        id: item.id,
        resourceKey,
        courseId: item.courseId,
        courseName: stripHtmlToText(item.courseName) || item.courseName,
        title,
        status: item.status,
        deadline,
        publishedAt,
        updatedAt,
        isCustomDeadline: item.isCustomDeadline,
        sourcePlatform: platform.label,
        sourceUrl,
        summary,
        score,
        totalScore,
      });
    } else {
      const kind: Assignment['kind'] =
        item.type === 'homework' || item.type === 'quiz' ? item.type : 'other';
      const resourceKey = buildEntityKey(item.courseId, 'assignment', item.id);
      assignments.set(resourceKey, {
        id: item.id,
        resourceKey,
        courseId: item.courseId,
        courseName: stripHtmlToText(item.courseName) || item.courseName,
        title,
        kind,
        status: item.status,
        deadline,
        publishedAt,
        updatedAt,
        isCustomDeadline: item.isCustomDeadline,
        sourcePlatform: platform.label,
        sourceUrl,
        summary,
        score,
        totalScore,
      });
    }
  }

  return {
    assignments: [...assignments.values()],
    exams: [...exams.values()],
  };
}

function normalizeType19HomeworkRows(
  rows: readonly Row[],
  course: Course,
  platform: PlatformInfo,
  now = Date.now(),
): Assignment[] {
  const out: Assignment[] = [];
  for (const row of rows) {
    const rawType = firstValue(row, 'type', 'activity_type', 'actype');
    if (rawType !== 19 && rawType !== '19') continue;
    const id = firstString(row, 'id', 'homework_id', 'activity_id', 'log_id');
    const title = stripHtmlToText(firstString(row, 'title', 'name', 'activity_name'));
    if (!id || !title) continue;
    const content = asRecord(row.content);
    const deadlineMs = parseTimestamp(firstValue(content ?? {}, 'score_d', 'deadline') ?? firstValue(row, 'deadline'));
    const publishedAt = toIsoTimestamp(firstValue(row, 'create_time', 'created_at', 'publish_time'));
    const assessed = row.is_finished === true || content?.is_assessed === true;
    const status: Assignment['status'] = assessed
      ? 'submitted'
      : deadlineMs !== undefined && deadlineMs > 0 && deadlineMs <= now
        ? 'expired'
        : 'pending';
    out.push({
      id,
      resourceKey: buildEntityKey(course.id, 'assignment', id),
      courseId: course.id,
      courseName: course.name,
      title,
      kind: 'homework',
      status,
      deadline: deadlineMs && deadlineMs > 0 ? new Date(deadlineMs).toISOString() : null,
      publishedAt,
      sourcePlatform: platform.label,
      sourceUrl: buildFallbackCourseUrl(course, platform.origin),
    });
  }
  return out;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function inspectBusinessStatus(data: unknown): { outcome: 'ok' | ResourceErrorCode; note?: string } {
  const obj = asRecord(data);
  if (!obj) {
    return Array.isArray(data) ? { outcome: 'ok' } : { outcome: 'invalid-response', note: 'non-object-json' };
  }

  // Family 1: { success: boolean, error_code?: ... }
  if (typeof obj.success === 'boolean') {
    if (obj.success) return { outcome: 'ok' };
    const code = String(obj.error_code ?? obj.sub_code ?? obj.code ?? '');
    if (AUTH_BUSINESS_CODES.has(code)) return { outcome: 'unauthorized', note: `business-code-${code}` };
    if (NOT_FOUND_BUSINESS_CODES.has(code)) return { outcome: 'not-found', note: `business-code-${code}` };
    return { outcome: 'invalid-response', note: code ? 'business-code-unrecognized' : 'success-false' };
  }

  // Family 2: { errcode: number | string }
  if (obj.errcode !== undefined && obj.errcode !== null) {
    const code = String(obj.errcode);
    if (code === '0') return { outcome: 'ok' };
    if (AUTH_BUSINESS_CODES.has(code)) return { outcome: 'unauthorized', note: `errcode-${code}` };
    if (NOT_FOUND_BUSINESS_CODES.has(code)) return { outcome: 'not-found', note: `errcode-${code}` };
    return { outcome: 'invalid-response', note: 'errcode-unrecognized' };
  }

  // Family 3: { code: number | string }
  if (obj.code !== undefined && obj.code !== null) {
    const code = String(obj.code);
    if (code === '0' || code === '200') return { outcome: 'ok' };
    if (AUTH_BUSINESS_CODES.has(code)) return { outcome: 'unauthorized', note: `code-${code}` };
    if (NOT_FOUND_BUSINESS_CODES.has(code)) return { outcome: 'not-found', note: `code-${code}` };
    return { outcome: 'invalid-response', note: 'code-unrecognized' };
  }

  return { outcome: 'ok' };
}

/**
 * Fetches a same-origin JSON endpoint with per-attempt timeout, AbortSignal cancellation,
 * and bounded retries on transient failures ONLY (network errors, timeouts, 429, 5xx).
 * Never retries 401/403/404, non-JSON responses, or cancellations.
 */
export async function fetchWithTimeoutAndRetry(
  url: URL,
  options: FetchWithRetryOptions,
): Promise<FetchJsonResult> {
  const { headers, fetchImpl, signal, timeoutMs, maxRetries, retryBaseDelayMs } = options;
  const started = performance.now();
  const boundedRetries = clampInt(maxRetries, 2, 0, 5);
  const boundedTimeout = clampInt(timeoutMs, 12_000, 100, 60_000);

  let lastResult: FetchJsonResult = {
    ok: false,
    outcome: 'network-error',
    durationMs: 0,
    attempts: 0,
  };

  for (let attempt = 0; attempt <= boundedRetries; attempt++) {
    if (signal?.aborted) {
      return {
        ok: false,
        outcome: 'cancelled',
        durationMs: Math.round(performance.now() - started),
        attempts: attempt,
      };
    }

    const attemptController = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => attemptController.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, boundedTimeout);

    try {
      const response = await fetchImpl(url, {
        credentials: 'include',
        mode: 'same-origin',
        redirect: 'manual',
        headers,
        signal: attemptController.signal,
      });

      const status = response.status;
      if (status === 401 || status === 403 || response.type === 'opaqueredirect') {
        return {
          ok: false,
          status,
          outcome: 'unauthorized',
          durationMs: Math.round(performance.now() - started),
          attempts: attempt + 1,
        };
      }
      if (status === 404) {
        return {
          ok: false,
          status,
          outcome: 'not-found',
          durationMs: Math.round(performance.now() - started),
          attempts: attempt + 1,
        };
      }
      if (!response.ok) {
        const retryable = status >= 500 || status === 429;
        lastResult = {
          ok: false,
          status,
          outcome: 'http-error',
          durationMs: Math.round(performance.now() - started),
          attempts: attempt + 1,
          note: `http-${status}`,
        };
        if (!retryable || attempt === boundedRetries) return lastResult;
      } else {
        const text = await response.text();
        if (!text.trim()) {
          return {
            ok: false,
            status,
            outcome: 'invalid-response',
            durationMs: Math.round(performance.now() - started),
            attempts: attempt + 1,
            note: 'empty-body',
          };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          const looksLikeHtmlLogin = /<!doctype\s+html|<html\b/i.test(text) && /login|signin|登录/i.test(text);
          return {
            ok: false,
            status,
            outcome: looksLikeHtmlLogin ? 'unauthorized' : 'invalid-response',
            durationMs: Math.round(performance.now() - started),
            attempts: attempt + 1,
            note: looksLikeHtmlLogin ? 'html-login-page' : 'non-json-response',
          };
        }

        const biz = inspectBusinessStatus(parsed);
        if (biz.outcome !== 'ok') {
          return {
            ok: false,
            status,
            outcome: biz.outcome,
            durationMs: Math.round(performance.now() - started),
            attempts: attempt + 1,
            note: biz.note,
          };
        }

        return {
          ok: true,
          data: parsed,
          status,
          outcome: 'ok',
          durationMs: Math.round(performance.now() - started),
          attempts: attempt + 1,
        };
      }
    } catch {
      if (signal?.aborted) {
        return {
          ok: false,
          outcome: 'cancelled',
          durationMs: Math.round(performance.now() - started),
          attempts: attempt + 1,
        };
      }
      lastResult = {
        ok: false,
        outcome: timedOut ? 'timeout' : 'network-error',
        durationMs: Math.round(performance.now() - started),
        attempts: attempt + 1,
      };
      if (attempt === boundedRetries) return lastResult;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }

    const backoffMs = Math.min(3000, Math.max(0, retryBaseDelayMs) * 2 ** attempt);
    try {
      await sleepWithAbort(backoffMs, signal);
    } catch {
      return {
        ok: false,
        outcome: 'cancelled',
        durationMs: Math.round(performance.now() - started),
        attempts: attempt + 1,
      };
    }
  }

  return lastResult;
}

function pageSignature(rows: readonly Row[]): string {
  return rows
    .map((row, idx) => {
      const id = firstString(row, 'id', 'activity_id', 'log_id', 'courseware_id', 'homework_id');
      const title = firstString(row, 'title', 'name');
      return id || `${idx}:${title}`;
    })
    .join('|');
}

function recordDiagnostic(
  diagnostics: ResourceEndpointDiagnostic[],
  candidate: ResourceEndpointCandidate,
  res: FetchJsonResult,
  itemCount?: number,
  extraNote?: string,
): void {
  const combinedNote = [res.note, extraNote].filter(Boolean).join('; ');
  diagnostics.push({
    endpoint: candidate.label,
    scope: candidate.scope,
    outcome: res.outcome,
    experimental: candidate.experimental,
    status: res.status,
    itemCount,
    durationMs: res.durationMs,
    note: sanitizeDiagnosticNote(combinedNote || undefined),
  });
}

function mapExistingCourses(courses: readonly CourseInfo[], platform: PlatformInfo): Course[] {
  return courses.map(c => ({
    id: c.id,
    classroomId: c.classroomId,
    name: stripHtmlToText(c.name) || c.name,
    teacher: c.teacher ? stripHtmlToText(c.teacher) : undefined,
    term: c.term,
    sourcePlatform: platform.label,
    sourceOrigin: platform.origin,
    sourceUrl: sanitizeResourceUrl(c.url, platform.origin, false) ?? buildFallbackCourseUrl(c, platform.origin),
  }));
}

/**
 * Orchestrates read-only course, material, chapter, slide, announcement, and assignment/exam
 * discovery with pagination, rate-limited concurrency, timeouts, bounded retries,
 * AbortSignal cancellation, and credential-free diagnostics.
 */
export async function discoverCourseResources(
  platform: PlatformInfo,
  options: ResourceDiscoveryOptions = {},
): Promise<ResourceDiscoveryResult> {
  if (!detectPlatform(platform.origin)) {
    throw new Error('无效的雨课堂来源');
  }

  const syncedAt = new Date().toISOString();
  const hostname = new URL(platform.origin).hostname;
  const diagnostics: ResourceEndpointDiagnostic[] = [];

  if (options.signal?.aborted) {
    return {
      origin: platform.origin,
      sourcePlatform: platform.label,
      source: 'live',
      syncedAt,
      courses: [],
      materials: [],
      assignments: [],
      exams: [],
      announcements: [],
      diagnostics,
      failedCourses: 0,
      error: 'cancelled',
    };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const cookie = options.cookie ?? '';
  const signal = options.signal;
  const maxPages = clampInt(options.maxPages, 5, 1, 50);
  const pageSize = clampInt(options.pageSize, 50, 1, 200);
  const timeoutMs = clampInt(options.timeoutMs, 12_000, 100, 60_000);
  const maxRetries = clampInt(options.maxRetries, 2, 0, 5);
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 200;
  const concurrency = clampInt(options.concurrency, 2, 1, 4);
  const intervalMs = options.intervalMs ?? 250;

  // Step 1: Resolve course list.
  let courses: Course[] = [];
  if (options.existingCourses && options.existingCourses.length > 0) {
    courses = mapExistingCourses(options.existingCourses, platform);
  } else {
    let courseError: ResourceErrorCode = 'not-found';
    let courseEndpointSucceeded = false;

    for (const candidate of courseResourceEndpoints(hostname)) {
      const res = await fetchWithTimeoutAndRetry(new URL(candidate.path, platform.origin), {
        headers: buildRequestHeaders(platform, cookie),
        fetchImpl,
        signal,
        timeoutMs,
        maxRetries,
        retryBaseDelayMs,
      });

      if (res.ok) {
        const normalized = normalizeResourceCourses(res.data, platform);
        recordDiagnostic(diagnostics, candidate, res, normalized.length);
        courses = normalized;
        courseEndpointSucceeded = true;
        if (normalized.length > 0) break;
      } else {
        recordDiagnostic(diagnostics, candidate, res);
        if (res.outcome === 'cancelled') {
          return {
            origin: platform.origin,
            sourcePlatform: platform.label,
            source: 'live',
            syncedAt,
            courses: [],
            materials: [],
            assignments: [],
            exams: [],
            announcements: [],
            diagnostics,
            failedCourses: 0,
            error: 'cancelled',
          };
        }
        if (
          res.outcome === 'unauthorized' ||
          (res.outcome !== 'not-found' && courseError !== 'unauthorized')
        ) {
          courseError = res.outcome;
        }
      }
    }

    if (!courseEndpointSucceeded) {
      return {
        origin: platform.origin,
        sourcePlatform: platform.label,
        source: 'live',
        syncedAt,
        courses: [],
        materials: [],
        assignments: [],
        exams: [],
        announcements: [],
        diagnostics,
        failedCourses: 0,
        error: courseError,
      };
    }
  }

  // Optional course filter.
  if (options.courseIds && options.courseIds.length > 0) {
    const allowed = new Set(options.courseIds.map(id => id.trim()));
    courses = courses.filter(c => allowed.has(c.id) || (c.classroomId !== undefined && allowed.has(c.classroomId)));
  }

  const materialsMap = new Map<string, CourseMaterial>();
  const assignmentsMap = new Map<string, Assignment>();
  const examsMap = new Map<string, Exam>();
  const announcementsMap = new Map<string, Announcement>();
  let failedCourses = 0;
  let sawUnauthorized = false;
  let sawCancelled = false;

  // Seed existing homework if provided by v0.1 DDL board.
  if (options.existingHomework && options.existingHomework.length > 0) {
    const mapped = mapHomeworkToDomain(options.existingHomework, platform);
    for (const a of mapped.assignments) assignmentsMap.set(a.resourceKey, a);
    for (const e of mapped.exams) examsMap.set(e.resourceKey, e);
  }

  const courseTasks = courses.map(course => async (taskSignal?: AbortSignal) => {
    const classroomId = course.classroomId || course.id;
    const headers = buildRequestHeaders(platform, cookie, classroomId);
    let anyCourseSuccess = false;
    const logLessonKeys = new Map<string, string>();

    // 2A. Paginated learn logs.
    const allLogRows: Row[] = [];
    const seenPageSignatures = new Set<string>();
    let logUnauthorized = false;
    const firstLogCandidate = learnLogEndpoint(classroomId, 0, pageSize, hostname);

    for (let page = 0; page < maxPages; page++) {
      const candidate = page === 0 ? firstLogCandidate : learnLogEndpoint(classroomId, page, pageSize, hostname);
      const res = await fetchWithTimeoutAndRetry(new URL(candidate.path, platform.origin), {
        headers,
        fetchImpl,
        signal: taskSignal,
        timeoutMs,
        maxRetries,
        retryBaseDelayMs,
      });

      if (!res.ok) {
        recordDiagnostic(diagnostics, candidate, res, undefined, page > 0 ? `page=${page}` : undefined);
        if (res.outcome === 'cancelled') {
          sawCancelled = true;
          return;
        }
        if (res.outcome === 'unauthorized') {
          logUnauthorized = true;
          sawUnauthorized = true;
        }
        break;
      }

      anyCourseSuccess = true;
      const rows = unwrapRows(res.data) ?? [];
      const sig = pageSignature(rows);

      if (page > 0 && rows.length > 0 && seenPageSignatures.has(sig)) {
        recordDiagnostic(diagnostics, candidate, res, 0, `page=${page}; duplicate-page-stopped`);
        break;
      }

      recordDiagnostic(diagnostics, candidate, res, rows.length, page > 0 ? `page=${page}` : undefined);
      if (sig) seenPageSignatures.add(sig);
      allLogRows.push(...rows);

      if (rows.length < pageSize) break;
    }

    if (allLogRows.length > 0) {
      const courseMaterials = normalizeCourseMaterials(allLogRows, course, platform.origin, {
        experimental: firstLogCandidate.experimental,
      });
      for (const mat of courseMaterials) {
        const prev = materialsMap.get(mat.resourceKey);
        materialsMap.set(mat.resourceKey, prev ? mergeMaterials(prev, mat) : mat);
        if ((mat.type === 'slides' || mat.type === 'image_slides') && String(mat.metadata?.rawType) === '14') {
          for (const id of [mat.metadata?.lessonId, mat.metadata?.coursewareId]) {
            if (typeof id === 'string' && !logLessonKeys.has(id)) logLessonKeys.set(id, mat.resourceKey);
          }
        }
      }

      for (const ann of normalizeAnnouncements(allLogRows, course, platform.origin)) {
        announcementsMap.set(ann.resourceKey, ann);
      }

      const courseInfo: CourseInfo = {
        id: course.id,
        classroomId: course.classroomId,
        name: course.name,
        teacher: course.teacher,
        term: course.term,
        url: course.sourceUrl,
      };
      const homeworkItems = normalizeHomework(allLogRows, platform.origin, courseInfo);
      const mapped = mapHomeworkToDomain(homeworkItems, platform);
      for (const a of mapped.assignments) assignmentsMap.set(a.resourceKey, a);
      for (const e of mapped.exams) examsMap.set(e.resourceKey, e);
      for (const a19 of normalizeType19HomeworkRows(allLogRows, course, platform)) {
        if (!assignmentsMap.has(a19.resourceKey)) assignmentsMap.set(a19.resourceKey, a19);
      }
    }

    if (taskSignal?.aborted || sawCancelled) return;

    // 2B. Chapter / progress tree discovery (non-fatal).
    if (!logUnauthorized) {
      for (const candidate of chapterEndpoints(classroomId, course.id, hostname)) {
        const res = await fetchWithTimeoutAndRetry(new URL(candidate.path, platform.origin), {
          headers,
          fetchImpl,
          signal: taskSignal,
          timeoutMs,
          maxRetries,
          retryBaseDelayMs,
        });

        if (res.ok) {
          anyCourseSuccess = true;
          const chapterMaterials = normalizeCourseMaterials(res.data, course, platform.origin, {
            experimental: candidate.experimental,
          });
          recordDiagnostic(diagnostics, candidate, res, chapterMaterials.length);
          for (const mat of chapterMaterials) {
            const lessonId = mat.metadata?.lessonId;
            const logKey = mat.metadata?.leafType === 8 && typeof lessonId === 'string'
              ? logLessonKeys.get(lessonId)
              : undefined;
            const key = logKey ?? mat.resourceKey;
            const prev = materialsMap.get(key);
            const merged = prev ? mergeMaterials(prev, mat) : mat;
            if (logKey && merged.metadata && prev?.metadata?.lessonId !== undefined) {
              merged.metadata.lessonId = prev.metadata.lessonId;
            }
            materialsMap.set(key, merged);
          }
          break;
        }

        recordDiagnostic(diagnostics, candidate, res);
        if (res.outcome === 'cancelled') {
          sawCancelled = true;
          return;
        }
        if (res.outcome === 'unauthorized') {
          sawUnauthorized = true;
          break;
        }
      }
    }

    if (taskSignal?.aborted || sawCancelled) return;

    // 2C. Announcements discovery (non-fatal).
    if (!logUnauthorized) {
      for (const candidate of announcementEndpoints(classroomId, 20, 0, hostname)) {
        const res = await fetchWithTimeoutAndRetry(new URL(candidate.path, platform.origin), {
          headers,
          fetchImpl,
          signal: taskSignal,
          timeoutMs,
          maxRetries,
          retryBaseDelayMs,
        });

        if (res.ok) {
          anyCourseSuccess = true;
          const anns = normalizeAnnouncements(res.data, course, platform.origin, {
            experimental: candidate.experimental,
          });
          recordDiagnostic(diagnostics, candidate, res, anns.length);
          for (const ann of anns) {
            announcementsMap.set(ann.resourceKey, ann);
            for (const att of ann.attachments ?? []) {
              const prev = materialsMap.get(att.resourceKey);
              materialsMap.set(att.resourceKey, prev ? mergeMaterials(prev, att) : att);
            }
          }
          break;
        }

        recordDiagnostic(diagnostics, candidate, res);
        if (res.outcome === 'cancelled') {
          sawCancelled = true;
          return;
        }
      }
    }

    if (taskSignal?.aborted || sawCancelled) return;

    // 2D. Slide page hydration for discovered presentations/lessons lacking slideImages.
    if (!logUnauthorized) {
      const courseSlidesNeedingHydration = [...materialsMap.values()].filter(
        m =>
          m.courseId === course.id &&
          !m.downloadUrl &&
          (!m.slideImages || m.slideImages.length === 0) &&
          (m.type === 'slides' || m.type === 'image_slides') &&
          (typeof m.metadata?.presentationId === 'string' || typeof m.metadata?.lessonId === 'string'),
      );

      for (const mat of courseSlidesNeedingHydration.slice(0, 20)) {
        if (taskSignal?.aborted || sawCancelled) return;
        const explicitPresentationId =
          typeof mat.metadata?.presentationId === 'string' ? mat.metadata.presentationId : undefined;
        const lessonId =
          typeof mat.metadata?.lessonId === 'string' ? mat.metadata.lessonId : undefined;

        const presentationIds: Array<{ id: string; title?: string }> = [];
        if (explicitPresentationId) {
          presentationIds.push({ id: explicitPresentationId });
        } else if (lessonId) {
          const summaryCandidate = lessonSummaryEndpoint(lessonId, hostname);
          const summaryRes = await fetchWithTimeoutAndRetry(new URL(summaryCandidate.path, platform.origin), {
            headers,
            fetchImpl,
            signal: taskSignal,
            timeoutMs,
            maxRetries,
            retryBaseDelayMs,
          });
          if (summaryRes.ok) {
            const summaryData = asRecord(asRecord(summaryRes.data)?.data) ?? asRecord(summaryRes.data);
            const presentations = Array.isArray(summaryData?.presentations) ? summaryData.presentations : [];
            recordDiagnostic(diagnostics, summaryCandidate, summaryRes, presentations.length);
            for (const item of presentations) {
              const pres = asRecord(item);
              const pid = pres ? firstString(pres, 'id', 'presentation_id') : '';
              if (pid) presentationIds.push({ id: pid, title: pres ? firstString(pres, 'title', 'name') || undefined : undefined });
            }
          } else {
            recordDiagnostic(diagnostics, summaryCandidate, summaryRes);
            if (summaryRes.outcome === 'cancelled') {
              sawCancelled = true;
              return;
            }
          }
        }

        let upgradedLesson = false;
        for (let idx = 0; idx < presentationIds.length; idx++) {
          if (taskSignal?.aborted || sawCancelled) return;
          const presEntry = presentationIds[idx];
          const slideCandidate = presentationSlidesEndpoint(presEntry.id, lessonId, hostname);
          const slideRes = await fetchWithTimeoutAndRetry(new URL(slideCandidate.path, platform.origin), {
            headers,
            fetchImpl,
            signal: taskSignal,
            timeoutMs,
            maxRetries,
            retryBaseDelayMs,
          });
          if (slideRes.ok) {
            const pages = normalizeSlidePages(slideRes.data, platform.origin);
            recordDiagnostic(diagnostics, slideCandidate, slideRes, pages.length);
            if (pages.length > 0) {
              const itemId = upgradedLesson ? `${mat.id}-p${presEntry.id}` : mat.id;
              const nextKey = buildMaterialKey(mat.courseId, 'image_slides', itemId);
              const lessonTitle = cleanDisplayTitle(mat.title);
              const presentationTitle = cleanDisplayTitle(stripHtmlToText(presEntry.title ?? ''));
              const upgraded: CourseMaterial = {
                ...mat,
                id: itemId,
                resourceKey: nextKey,
                title: presentationTitle || (upgradedLesson ? `${lessonTitle} (${idx + 1})` : lessonTitle),
                chapterTitle: mat.chapterTitle || (presentationTitle && !presentationTitle.includes(lessonTitle) ? lessonTitle : undefined),
                type: 'image_slides',
                slideImages: pages,
                downloadStatus: 'not_downloaded',
                experimental: slideCandidate.experimental,
                metadata: sanitizeMetadata({ ...mat.metadata, presentationId: presEntry.id, slidesCount: pages.length }),
              };
              if (!upgradedLesson) materialsMap.delete(mat.resourceKey);
              materialsMap.set(nextKey, upgraded);
              upgradedLesson = true;
            }
          } else {
            recordDiagnostic(diagnostics, slideCandidate, slideRes);
            if (slideRes.outcome === 'cancelled') {
              sawCancelled = true;
              return;
            }
          }
        }
      }
    }

    if (!anyCourseSuccess) {
      failedCourses++;
    }
  });

  if (courseTasks.length > 0) {
    await runRateLimitedQueue(courseTasks, {
      concurrency,
      intervalMs,
      signal,
      onProgress: options.onProgress,
    });
  }

  let topError: ResourceErrorCode | undefined;
  if (signal?.aborted || sawCancelled) {
    topError = 'cancelled';
  } else if (courses.length > 0 && failedCourses === courses.length) {
    topError = sawUnauthorized ? 'unauthorized' : 'network-error';
  }

  return {
    origin: platform.origin,
    sourcePlatform: platform.label,
    source: 'live',
    syncedAt,
    courses,
    materials: [...materialsMap.values()],
    assignments: [...assignmentsMap.values()],
    exams: [...examsMap.values()],
    announcements: [...announcementsMap.values()],
    diagnostics,
    failedCourses,
    error: topError,
  };
}
