import type { CourseInfo, HomeworkItem, HomeworkType } from '../../types';
import { compareByDeadline } from '../utils/time';

type Row = Record<string, unknown>;
const record = (value: unknown): Row | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;

function value(row: Row, ...keys: string[]): string | number | undefined {
  for (const key of keys) {
    const field = row[key];
    if (typeof field === 'string' && field.trim()) return field.trim();
    if (typeof field === 'number' && Number.isFinite(field)) return field;
  }
}
const str = (row: Row, ...keys: string[]) => String(value(row, ...keys) ?? '');

export function parseTimestamp(input: unknown): number | undefined {
  if (typeof input !== 'string' && typeof input !== 'number') return;
  const text = String(input).trim();
  if (!text) return;
  const num = Number(text);
  const timestamp = Number.isFinite(num) ? (Math.abs(num) < 1e11 ? num * 1000 : num) : Date.parse(text);
  if (timestamp > 0 && Number.isFinite(new Date(timestamp).getTime())) return timestamp;
}

const wrappers = ['data', 'body', 'result', 'items', 'list', 'results', 'rows', 'records', 'activities', 'activity_list', 'news', 'news_list', 'courses', 'course_list', 'classrooms', 'classroom_list', 'product_list', 'logs', 'learn_logs', 'homeworks', 'homework_list', 'tasks', 'quizzes', 'exams'];

const DEADLINE_KEYS = [
  'deadline', 'deadline_at', 'deadline_time', 'end_time', 'end_at', 'endTime',
  'due_at', 'dueDate', 'due_time', 'close_time', 'submit_deadline', 'expired_at',
];

const START_TIME_KEYS = [
  'start_time', 'start_at', 'startTime', 'begin_time', 'publish_time', 'publish_at',
  'pub_time', 'create_time', 'created_at', 'create_at', 'created', 'issue_time', 'time',
];

const TASK_HINT_KEYS = [
  'homework_id', 'exam_id', 'quiz_id', 'paper_id', 'exercise_id',
  'problem_count', 'question_count', 'exercise_count', 'total_score',
];

const SUBMITTED_BOOL_KEYS = [
  'is_submitted', 'submitted', 'is_finished', 'finished', 'is_submit',
  'is_completed', 'completed', 'is_done', 'done', 'has_submitted', 'has_finished',
  'is_handed_in', 'handed_in', 'paper_submitted', 'exam_submitted',
  'is_answered', 'is_graded', 'graded',
];

const SUBMITTED_STATUS_KEYS = [
  'submission_status', 'submit_status', 'exam_status', 'paper_status',
  'homework_status', 'finish_status', 'user_status', 'student_status',
  'answer_status', 'status',
];

const SUBMITTED_TIME_KEYS = [
  'submitted_at', 'submit_time', 'submit_at', 'submitted_time',
  'hand_in_time', 'finish_time', 'finished_at', 'completed_at',
];

const SUBMITTED_STATE_REGEX = /^(submitted|finished|completed|graded|done|handed_in|answered|marked|已提交|已交卷|已完成|已批改|待批改|批改中|已作答|已答完)$/;

const HINT_KEY_REGEX = /(status|submit|finish|complete|done|hand|grade|score|type|time|deadline|end|start|create|publish|expire|answer)/i;

export function unwrapRows(input: unknown): Row[] | undefined {
  if (Array.isArray(input)) return input.map(record).filter((row): row is Row => row !== undefined);
  const row = record(input);
  if (!row) return;
  let found = false;
  const rows: Row[] = [];
  for (const key of wrappers) {
    const nested = unwrapRows(row[key]);
    if (!nested) continue;
    found = true;
    rows.push(...nested);
  }
  if (found) return rows;
}

function safeUrl(raw: string, origin: string): string | undefined {
  try {
    const url = new URL(raw, origin);
    if (url.origin === new URL(origin).origin && /^https?:$/.test(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Invalid link */ }
}

export function normalizeCourses(input: unknown, origin: string): CourseInfo[] {
  const courses = new Map<string, CourseInfo>();
  for (const entry of unwrapRows(input) ?? []) {
    const row = { ...entry, ...(record(entry.course) ?? record(entry.course_info)) };
    const classroomId = str(entry, 'classroomId', 'classroom_id', 'class_id', 'classroomid') || str(record(entry.classroom) ?? {}, 'id');
    const id = str(row, 'courseId', 'course_id', 'courseid', 'id') || classroomId;
    const name = str(row, 'courseName', 'course_name', 'name', 'title', 'classroom_name', 'sku_name');
    if (!id || !name) continue;
    const path = str(row, 'url', 'course_url') || (classroomId ? `/v2/web/studentLog/${encodeURIComponent(classroomId)}` : '');
    courses.set(classroomId || id, {
      id, name, classroomId: classroomId || undefined,
      teacher: str(row, 'teacher', 'teacher_name') || undefined,
      term: str(row, 'term', 'semester') || undefined,
      url: path ? safeUrl(path, origin) : undefined,
    });
  }
  return [...courses.values()];
}

function mapType(raw: string | number | undefined, fallback: HomeworkType): HomeworkType {
  if (raw === 4 || raw === '4') return 'homework';
  if (raw === 5 || raw === '5') return 'exam';
  if (raw === 6 || raw === '6' || raw === 9 || raw === '9' || raw === 15 || raw === '15') return 'announcement';
  const text = String(raw ?? '');
  if (/homework|assignment|作业/i.test(text)) return 'homework';
  if (/exam|paper|考试|试卷/i.test(text)) return 'exam';
  if (/quiz|test|exercise|测验|练习|习题/i.test(text)) return 'quiz';
  if (/announcement|notice|公告|通知/i.test(text)) return 'announcement';
  return fallback;
}

function hasTaskHintField(row: Row): boolean {
  return TASK_HINT_KEYS.some(key => row[key] !== undefined && row[key] !== null && row[key] !== '');
}

function isTruthyFlag(field: unknown): boolean {
  return field === true || field === 1 || field === '1' || field === 'true';
}

function detectSubmitted(sources: Row[], rawType?: string | number): boolean {
  const isYuketangLogTask =
    rawType === 4 || rawType === '4' ||
    rawType === 5 || rawType === '5' ||
    rawType === 15 || rawType === '15' ||
    sources.some(src => 'total_score' in src || 'unfinished' in src);

  for (const src of sources) {
    if (SUBMITTED_BOOL_KEYS.some(key => isTruthyFlag(src[key]))) return true;
    for (const key of SUBMITTED_STATUS_KEYS) {
      const raw = src[key];
      if (typeof raw === 'string' && SUBMITTED_STATE_REGEX.test(raw.trim().toLowerCase())) return true;
      // In Yuketang v2 learn logs (type 4 homework / type 5 exam):
      // status 0/1 = not submitted / in progress, status 2 = submitted awaiting grading, status 3 = graded/completed.
      if (isYuketangLogTask && (raw === 2 || raw === 3 || raw === '2' || raw === '3')) return true;
    }
    if (isYuketangLogTask && typeof src.score === 'number' && Number.isFinite(src.score)) return true;
    if (parseTimestamp(value(src, ...SUBMITTED_TIME_KEYS)) !== undefined) return true;
  }
  return false;
}

function extractRawStatusHint(sources: Row[]): Record<string, string | number | boolean | null> | undefined {
  const hint: Record<string, string | number | boolean | null> = {};
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (!HINT_KEY_REGEX.test(k) || k in hint) continue;
      if (v === null || typeof v === 'boolean' || typeof v === 'number') {
        hint[k] = v;
      } else if (typeof v === 'string' && v.length <= 48) {
        hint[k] = v;
      }
    }
  }
  return Object.keys(hint).length ? hint : undefined;
}

function normalizeRow(entry: Row, origin: string, course: CourseInfo | undefined, now: number): HomeworkItem | undefined {
  const payload = record(entry.homework) ?? record(entry.object) ?? record(entry.activity) ?? record(entry.content) ?? record(entry.data) ?? record(entry.exam) ?? record(entry.quiz);
  const row = { ...entry, ...payload };
  const nestedStatusSources = [
    row,
    record(row.ext),
    record(row.extra),
    record(row.submission),
    record(row.my_submission),
    record(row.student_info),
    record(row.user_info),
    record(row.user_status),
  ].filter((obj): obj is Row => obj !== undefined);

  const context = record(row.course) ?? record(row.course_info) ?? {};
  const id = str(row, 'homework_id', 'exam_id', 'quiz_id', 'paper_id', 'activity_id', 'object_id', 'id', 'log_id');
  const classroomId = str(row, 'classroomId', 'classroom_id', 'classroomid', 'class_id') || course?.classroomId;
  const courseId = str(row, 'courseId', 'course_id', 'courseid') || str(context, 'id', 'course_id') || course?.id || classroomId || 'unknown';
  const title = str(row, 'title', 'name', 'homework_name', 'activity_name', 'activity_title', 'object_name', 'subject');
  if (!id || !title) return;

  const parsedDeadline = parseTimestamp(value(row, ...DEADLINE_KEYS));
  const rawType = value(row, 'type', 'activity_type', 'actype', 'log_type', 'object_type');
  const type = mapType(
    rawType,
    entry.exam || row.exam_id || row.paper_id
      ? 'exam'
      : entry.quiz || row.quiz_id || row.exercise_id
        ? 'quiz'
        : entry.homework || row.homework_id
          ? 'homework'
          : 'other',
  );

  // Keep tasks without a deadline only when they are clearly homework/exam/quiz or carry graded task hint fields.
  if (parsedDeadline === undefined) {
    const isTaskWithoutDeadline =
      type === 'homework' ||
      type === 'exam' ||
      type === 'quiz' ||
      hasTaskHintField(row);
    if (!isTaskWithoutDeadline) return;
  }

  const deadline = parsedDeadline ?? null;
  const startTime = parseTimestamp(value(row, ...START_TIME_KEYS));
  const state = str(row, ...SUBMITTED_STATUS_KEYS).toLowerCase();
  const submitted = detectSubmitted(nestedStatusSources, rawType);

  const classroom = encodeURIComponent(classroomId || courseId);
  const path = `/v2/web/studentLog/${classroom}`;

  const rawSummary = str(row, 'summary', 'description', 'intro', 'content');
  const scoreSummary =
    submitted && typeof row.score === 'number' && Number.isFinite(row.score)
      ? typeof row.total_score === 'number' && Number.isFinite(row.total_score)
        ? `得分：${row.score} / ${row.total_score}`
        : `得分：${row.score}`
      : '';

  return {
    id, courseId, classroomId, title, deadline, startTime, rawType, type,
    courseName: str(row, 'courseName', 'course_name', 'classroom_name') || str(context, 'name', 'course_name') || course?.name || '未知课程',
    status: submitted ? 'submitted' : (deadline !== null && deadline <= now) || state === 'expired' ? 'expired' : 'pending',
    url: safeUrl(str(row, 'url', 'link', 'detail_url', 'homework_url') || path, origin) ?? safeUrl(path, origin) ?? '',
    summary: rawSummary || scoreSummary || undefined,
    updatedAt: parseTimestamp(value(row, 'updatedAt', 'updated_at', 'update_time')),
    rawStatusHint: extractRawStatusHint(nestedStatusSources),
  };
}

export function deduplicateItems(items: readonly HomeworkItem[]): HomeworkItem[] {
  const courses = new Map<string, Map<string, HomeworkItem>>();
  for (const item of items) {
    let course = courses.get(item.courseId);
    if (!course) {
      course = new Map();
      courses.set(item.courseId, course);
    }
    const previous = course.get(item.id);
    if (
      !previous ||
      (item.updatedAt ?? 0) > (previous.updatedAt ?? 0) ||
      ((item.updatedAt ?? 0) === (previous.updatedAt ?? 0) &&
        (item.status === 'submitted' || (previous.deadline === null && item.deadline !== null)))
    ) {
      course.set(item.id, item);
    }
  }
  return [...courses.values()].flatMap(course => [...course.values()]).sort(compareByDeadline);
}

export function normalizeHomework(input: unknown, origin: string, course?: CourseInfo, now = Date.now()): HomeworkItem[] {
  const rows = unwrapRows(input) ?? (record(input) ? [record(input)!] : []);
  return deduplicateItems(rows.flatMap(row => normalizeRow(row, origin, course, now) ?? []));
}

export function parseImportedJson(rawJson: string | unknown, origin: string, now = Date.now()): HomeworkItem[] {
  const data: unknown = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const items: HomeworkItem[] = [];
  const visited = new WeakSet<object>();
  function visit(input: unknown, inherited?: CourseInfo) {
    if (!input || typeof input !== 'object' || visited.has(input)) return;
    visited.add(input);
    if (Array.isArray(input)) {
      for (const entry of input) visit(entry, inherited);
      return;
    }
    const row = input as Row;
    const item = normalizeRow(row, origin, inherited, now);
    if (item) {
      items.push(item);
      return;
    }
    const course = str(row, 'courseId', 'course_id') || (wrappers.some(key => Array.isArray(row[key])) ? str(row, 'id') : '');
    const context = course ? {
      id: course,
      name: str(row, 'courseName', 'course_name', 'name', 'title') || inherited?.name || '未知课程',
      classroomId: str(row, 'classroomId', 'classroom_id') || inherited?.classroomId,
    } : inherited;
    for (const child of Object.values(row)) visit(child, context);
  }
  visit(data);
  return deduplicateItems(items);
}
