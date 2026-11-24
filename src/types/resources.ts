import type { HomeworkStatus } from './index';

export const RESOURCE_SCHEMA_VERSION = '0.2.0';

export type MaterialType =
  | 'slides'
  | 'pdf'
  | 'ppt'
  | 'document'
  | 'attachment'
  | 'image_slides'
  | 'video_meta'
  | 'announcement_attachment'
  | 'other';

export type DownloadStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'downloaded'
  | 'updated'
  | 'failed'
  | 'unavailable';

export type ResourceErrorCode =
  | 'unauthorized'
  | 'not-found'
  | 'http-error'
  | 'network-error'
  | 'invalid-response'
  | 'cors-blocked'
  | 'timeout'
  | 'cancelled'
  | 'size-limit-exceeded'
  | 'unsupported-format';

export interface Course {
  id: string;
  classroomId?: string;
  name: string;
  teacher?: string;
  term?: string;
  description?: string;
  sourcePlatform: string;
  sourceOrigin: string;
  sourceUrl?: string;
  updatedAt?: string;
}

export interface SlidePageAsset {
  index: number;
  url: string;
  width?: number;
  height?: number;
  mimeType?: string;
  note?: string;
}

export interface CourseMaterial {
  id: string;
  resourceKey: string;
  courseId: string;
  classroomId?: string;
  courseName?: string;
  chapterId?: string;
  chapterTitle?: string;
  title: string;
  type: MaterialType;
  sourcePlatform: string;
  sourceUrl?: string;
  downloadUrl?: string;
  slideImages?: SlidePageAsset[];
  publishedAt?: string;
  updatedAt?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
  checksum?: string;
  localPath?: string;
  downloadStatus: DownloadStatus;
  experimental?: boolean;
  isNew?: boolean;
  /** Non-sensitive metadata only; must never contain cookies, tokens, or session IDs */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface Assignment {
  id: string;
  resourceKey: string;
  courseId: string;
  courseName: string;
  title: string;
  kind: 'homework' | 'quiz' | 'other';
  status: HomeworkStatus;
  deadline: string | null;
  publishedAt?: string;
  updatedAt?: string;
  isCustomDeadline?: boolean;
  sourcePlatform: string;
  sourceUrl?: string;
  summary?: string;
  score?: number | null;
  totalScore?: number | null;
}

export interface Exam {
  id: string;
  resourceKey: string;
  courseId: string;
  courseName: string;
  title: string;
  status: HomeworkStatus;
  deadline: string | null;
  publishedAt?: string;
  updatedAt?: string;
  isCustomDeadline?: boolean;
  sourcePlatform: string;
  sourceUrl?: string;
  summary?: string;
  score?: number | null;
  totalScore?: number | null;
}

export interface Announcement {
  id: string;
  resourceKey: string;
  courseId: string;
  courseName: string;
  title: string;
  /** Sanitized plain text content (raw HTML stripped) */
  content?: string;
  publishedAt?: string;
  updatedAt?: string;
  sourcePlatform: string;
  sourceUrl?: string;
  attachments?: CourseMaterial[];
}

export interface DownloadRecord {
  resourceKey: string;
  courseId: string;
  materialId: string;
  filename: string;
  relativePath: string;
  status: DownloadStatus;
  size?: number;
  /** SHA-256 hex digest computed when file bytes are reliably retrieved */
  checksum?: string;
  sourceUpdatedAt?: string;
  downloadedAt?: string;
  lastAttemptAt: string;
  errorCode?: ResourceErrorCode;
  errorMessage?: string;
  retryCount: number;
}

export interface CourseResourceIndex {
  schemaVersion: string;
  origin: string;
  sourcePlatform: string;
  lastSyncedAt: string;
  knownResourceKeys: string[];
  records: Record<string, DownloadRecord>;
}

export type ExportMode = 'knowledge-base' | 'notebooklm' | 'ai-context' | 'json-only' | 'markdown-only';

export interface ExportedFileEntry {
  relativePath: string;
  kind: 'manifest' | 'readme' | 'json' | 'markdown' | 'ics' | 'material' | 'prompt';
  courseId?: string;
  resourceKey?: string;
  mimeType: string;
  size: number;
  checksum?: string;
  status: 'included' | 'skipped' | 'failed';
  note?: string;
}

export interface ExportManifest {
  schemaVersion: string;
  generator: 'yuketang-ddl-helper';
  generatorVersion: string;
  mode: ExportMode;
  sourcePlatform: string;
  sourceOrigin: string;
  exportedAt: string;
  courses: Course[];
  files: ExportedFileEntry[];
  missingItems: Array<{
    courseId: string;
    resourceKey?: string;
    title: string;
    reason: string;
  }>;
  stats: {
    courseCount: number;
    materialCount: number;
    includedMaterialCount: number;
    assignmentCount: number;
    examCount: number;
    announcementCount: number;
    failedCount: number;
  };
}

export interface ResourceEndpointDiagnostic {
  endpoint: string;
  scope: 'courses' | 'chapters' | 'materials' | 'slides' | 'announcements' | 'download';
  outcome: 'ok' | ResourceErrorCode;
  experimental: boolean;
  status?: number;
  itemCount?: number;
  durationMs: number;
  note?: string;
}

export interface ResourceDiscoveryResult {
  origin: string;
  sourcePlatform: string;
  source: 'live' | 'demo';
  syncedAt: string;
  courses: Course[];
  materials: CourseMaterial[];
  assignments: Assignment[];
  exams: Exam[];
  announcements: Announcement[];
  diagnostics: ResourceEndpointDiagnostic[];
  failedCourses: number;
  error?: ResourceErrorCode;
}

export interface DownloadProgress {
  phase: 'fetching' | 'converting-pdf' | 'packaging-zip' | 'done' | 'cancelled';
  completed: number;
  total: number;
  currentTitle?: string;
  bytesProcessed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface DownloadBatchOptions {
  mergeSlideImagesToPdf?: boolean;
  skipAlreadyDownloaded?: boolean;
  forceRedownload?: boolean;
  concurrency?: number;
  intervalMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  maxTotalBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface DownloadItemResult {
  material: CourseMaterial;
  status: 'downloaded' | 'skipped' | 'failed';
  filename?: string;
  relativePath?: string;
  mimeType?: string;
  size?: number;
  checksum?: string;
  bytes?: Uint8Array;
  errorCode?: ResourceErrorCode;
  errorMessage?: string;
}

export interface DownloadBatchResult {
  items: DownloadItemResult[];
  succeeded: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  totalBytes: number;
}

export interface CourseProvider {
  listCourses(signal?: AbortSignal): Promise<Course[]>;
  getCourse(courseId: string, signal?: AbortSignal): Promise<Course | null>;
  listMaterials(courseId: string, signal?: AbortSignal): Promise<CourseMaterial[]>;
  listAssignments(courseId: string, signal?: AbortSignal): Promise<Assignment[]>;
  listExams(courseId: string, signal?: AbortSignal): Promise<Exam[]>;
  listAnnouncements(courseId: string, signal?: AbortSignal): Promise<Announcement[]>;
}

export interface SyncStatusReport {
  origin: string;
  sourcePlatform: string;
  lastSyncedAt: string | null;
  knownMaterials: number;
  downloadedMaterials: number;
  failedMaterials: number;
}

export interface ChangesSinceReport {
  since: string;
  newMaterials: CourseMaterial[];
  updatedMaterials: CourseMaterial[];
  upcomingAssignments: Assignment[];
  upcomingExams: Exam[];
}
