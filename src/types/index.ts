export type HomeworkType = 'homework' | 'exam' | 'quiz' | 'announcement' | 'other';
export type HomeworkStatus = 'pending' | 'submitted' | 'expired';
export type UrgencyLevel = 'overdue' | 'critical' | 'warning' | 'normal' | 'tbd' | 'submitted';

export interface HomeworkItem {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  type: HomeworkType;
  /** Deadline timestamp in milliseconds, or null when the teacher has not set one yet */
  deadline: number | null;
  /** Optional start or publish timestamp in milliseconds */
  startTime?: number;
  /** True when the effective deadline comes from a user-defined personal target */
  isCustomDeadline?: boolean;
  status: HomeworkStatus;
  url: string;
  summary?: string;
  classroomId?: string;
  rawType?: string | number;
  updatedAt?: number;
  /** Sanitized raw status/time fields kept for troubleshooting unrecognized submission states */
  rawStatusHint?: Record<string, string | number | boolean | null>;
}

export interface CourseInfo {
  id: string;
  classroomId?: string;
  name: string;
  teacher?: string;
  term?: string;
  url?: string;
}

export interface PlatformInfo {
  origin: string;
  host: string;
  variant: 'main' | 'changjiang' | 'hetang' | 'huanghe' | 'custom';
  label: string;
  xtbz: string;
  universityId?: string;
}

export interface ReminderConfig {
  id: string;
  label: string;
  trigger: string;
  enabled: boolean;
}

export type PromptPresetId = 'weekly-plan' | 'emergency-48h' | 'concise-checklist' | 'custom';

export interface UserSettings {
  cacheTtlMinutes: number;
  reminders: ReminderConfig[];
  promptPreset: PromptPresetId;
  customPromptTemplate: string;
  freeTimeNotes: string;
  useDemoMode: boolean;
  showSubmitted: boolean;
  showExpired: boolean;
  /** Hide overdue items older than N days (0 disables filtering) */
  maxOverdueDays: number;
  /** Hide no-deadline items published more than N days ago (0 disables filtering) */
  maxTbdAgeDays: number;
  theme: 'system' | 'light' | 'dark';
  dockPosition?: { x: number; y: number };
}

export interface LocalOverrides {
  completedIds: string[];
  ignoredIds: string[];
  /** User-defined target deadline (ms) keyed by `${courseId}:${id}` for items without a teacher deadline */
  customDeadlines?: Record<string, number>;
}

export interface DeadlineChangeNotice {
  key: string;
  courseName: string;
  title: string;
  kind: 'newly-set' | 'changed';
  oldDeadline: number | null;
  newDeadline: number;
  detectedAt: number;
}

export type EndpointOutcome = 'ok' | 'unauthorized' | 'not-found' | 'network-error' | 'http-error' | 'invalid-response';
export interface EndpointDiagnostic {
  endpoint: string;
  scope: 'courses' | 'tasks';
  outcome: EndpointOutcome;
  status?: number;
  durationMs: number;
}

export interface SyncDiagnostics {
  origin: string;
  startedAt: number;
  finishedAt: number;
  endpoints: EndpointDiagnostic[];
  failedCourses: number;
  error?: EndpointOutcome;
}

export interface SyncProgress {
  stage: 'courses' | 'tasks' | 'done';
  completed: number;
  total: number;
}

export interface SyncResult {
  origin: string;
  source: 'live' | 'demo' | 'import';
  syncedAt: number;
  items: HomeworkItem[];
  courses: CourseInfo[];
  diagnostics: SyncDiagnostics;
  deadlineChanges?: DeadlineChangeNotice[];
}

export interface StatsSummary {
  total: number;
  pending: number;
  submitted: number;
  expired: number;
  urgent: number;
  tbd: number;
}

export type ExtensionMessage =
  | { type: 'UPDATE_BADGE'; count: number; summary?: StatsSummary; origin?: string }
  | { type: 'GET_LATEST_SUMMARY'; origin?: string }
  | { type: 'OPEN_URL'; url: string };

export type ExtensionResponse = { ok: true; summary?: StatsSummary; origin?: string } | { ok: false; error: string };
