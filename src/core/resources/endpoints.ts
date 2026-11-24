import type { PlatformInfo, ResourceEndpointDiagnostic } from '../../types';

export type ResourceEndpointScope = Exclude<ResourceEndpointDiagnostic['scope'], 'download'>;
export type YuketangBranch = PlatformInfo['variant'];

export interface ResourceEndpointSpec {
  id: string;
  /** Sanitized endpoint template (never contains real classroom/course/lesson IDs) */
  label: string;
  scope: ResourceEndpointScope;
  method: 'GET';
  branches: readonly YuketangBranch[];
  /** Live hosts verified directly in this repository; empty when unverified live */
  verifiedOn: readonly string[];
  /** True unless directly live-verified in this repository (ADR-004) */
  experimental: boolean;
  sourceRef: string;
  notes?: string;
}

export interface ResourceEndpointCandidate {
  specId: string;
  label: string;
  path: string;
  scope: ResourceEndpointScope;
  experimental: boolean;
}

const ALL_BRANCHES: readonly YuketangBranch[] = ['main', 'changjiang', 'hetang', 'huanghe', 'custom'];

export const RESOURCE_ENDPOINT_SPECS: readonly ResourceEndpointSpec[] = [
  {
    id: 'courses-v2-list',
    label: '/v2/api/web/courses/list',
    scope: 'courses',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: ['changjiang.yuketang.cn'],
    experimental: false,
    sourceRef: 'v0.1 baseline; confirmed in powercess/yuketang-mcp & siye4366/xxt-Tool',
    notes: 'Student course list with identity=2.',
  },
  {
    id: 'courses-mooc-user',
    label: '/mooc-api/v1/lms/user/user-courses/',
    scope: 'courses',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'v0.1 fallback candidate',
    notes: 'Requires xtbz: ykt header on MOOC/campus deployments.',
  },
  {
    id: 'classroom-detail-v2',
    label: '/v2/api/web/classrooms/{classroom_id}',
    scope: 'courses',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'powercess/yuketang-mcp & siye4366/xxt-Tool',
    notes: 'Returns course_id, free_sku_id, uv_id, and class_end (role=5).',
  },
  {
    id: 'learn-logs-v2',
    label: '/v2/api/web/logs/learn/{classroom_id}',
    scope: 'materials',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: ['changjiang.yuketang.cn'],
    experimental: false,
    sourceRef: 'v0.1 baseline; pagination & activity types audited via powercess/yuketang-mcp, siye4366/xxt-Tool, OneTHU',
    notes: '0-based page, offset=pageSize (1..200). has_more is unreliable; stop when rows < pageSize or duplicate page detected.',
  },
  {
    id: 'course-progress-c27',
    label: '/c27/online_courseware/schedule/course/progress/',
    scope: 'chapters',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'powercess/yuketang-mcp',
    notes: 'Preferred chapter/leaf progress tree (course_progress[].section_leaf_list[]); requires xtbz: ykt.',
  },
  {
    id: 'course-chapter-mooc',
    label: '/mooc-api/v1/lms/learn/course/chapter',
    scope: 'chapters',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'Public OSS MOOC chapter API',
    notes: 'Legacy chapter fallback; may return business code 80019 on newer branches; requires xtbz: ykt.',
  },
  {
    id: 'courseware-pub-news',
    label: '/c27/online_courseware/xty/kls/pub_news/{course_id}/',
    scope: 'materials',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'v0.1 fallback candidate',
    notes: 'Requires xtbz: ykt header.',
  },
  {
    id: 'leaf-info-mooc',
    label: '/mooc-api/v1/lms/learn/leaf_info/{classroom_id}/{leaf_id}/',
    scope: 'materials',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'siye4366/xxt-Tool',
    notes: 'Leaf metadata/assessment lookup; requires xtbz: ykt and classroom-id header.',
  },
  {
    id: 'lesson-summary-v3',
    label: '/api/v3/lesson-summary/student',
    scope: 'slides',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'powercess/yuketang-mcp',
    notes: 'Returns presentations[] list (id, title, cover, slidesCount) for a lesson_id.',
  },
  {
    id: 'lesson-presentation-v3',
    label: '/api/v3/lesson-summary/student/presentation',
    scope: 'slides',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'powercess/yuketang-mcp',
    notes: 'Returns full ordered slides[] with 1-based index and CDN cover image URL.',
  },
  {
    id: 'cards-detlist-v2',
    label: '/v2/api/web/cards/detlist/{courseware_id}',
    scope: 'slides',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'Public OSS Yuketang courseware scripts',
    notes: 'v2 courseware slide/card detail list.',
  },
  {
    id: 'discussion-announcements-v2',
    label: '/v/discussion/v2/announcements/',
    scope: 'announcements',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'powercess/yuketang-mcp',
    notes: 'Classroom announcements (cid, limit, offset, type=9).',
  },
  {
    id: 'course-homework-v2',
    label: '/v2/api/web/courses/{classroom_id}/homework',
    scope: 'materials',
    method: 'GET',
    branches: ALL_BRANCHES,
    verifiedOn: [],
    experimental: true,
    sourceRef: 'v0.1 fallback candidate',
    notes: 'Legacy classroom homework/attachment endpoint.',
  },
];

const SPEC_BY_ID = new Map<string, ResourceEndpointSpec>(
  RESOURCE_ENDPOINT_SPECS.map(spec => [spec.id, spec]),
);

function makeCandidate(specId: string, path: string): ResourceEndpointCandidate {
  const spec = SPEC_BY_ID.get(specId);
  if (!spec) throw new Error(`Unknown resource endpoint spec: ${specId}`);
  return {
    specId: spec.id,
    label: spec.label,
    path,
    scope: spec.scope,
    experimental: spec.experimental,
  };
}

export function courseResourceEndpoints(): ResourceEndpointCandidate[] {
  return [
    makeCandidate('courses-v2-list', '/v2/api/web/courses/list?identity=2'),
    makeCandidate('courses-mooc-user', '/mooc-api/v1/lms/user/user-courses/?status=1&page=1&page_size=50'),
  ];
}

export function learnLogEndpoint(classroomId: string, page = 0, pageSize = 50): ResourceEndpointCandidate {
  const safePage = Math.max(0, Math.floor(page));
  const safeSize = Math.min(200, Math.max(1, Math.floor(pageSize)));
  return makeCandidate(
    'learn-logs-v2',
    `/v2/api/web/logs/learn/${encodeURIComponent(classroomId)}?actype=-1&page=${safePage}&offset=${safeSize}&sort=-1`,
  );
}

export function chapterEndpoints(classroomId: string, courseId: string): ResourceEndpointCandidate[] {
  const cid = encodeURIComponent(courseId);
  const classId = encodeURIComponent(classroomId);
  return [
    makeCandidate(
      'course-progress-c27',
      `/c27/online_courseware/schedule/course/progress/?classroom_id=${classId}&course_id=${cid}`,
    ),
    makeCandidate(
      'course-chapter-mooc',
      `/mooc-api/v1/lms/learn/course/chapter?cid=${cid}&classroom_id=${classId}`,
    ),
  ];
}

export function lessonSummaryEndpoint(lessonId: string): ResourceEndpointCandidate {
  return makeCandidate(
    'lesson-summary-v3',
    `/api/v3/lesson-summary/student?lesson_id=${encodeURIComponent(lessonId)}`,
  );
}

export function presentationSlidesEndpoint(presentationId: string, lessonId?: string): ResourceEndpointCandidate {
  const params = new URLSearchParams({ presentation_id: presentationId });
  if (lessonId) params.set('lesson_id', lessonId);
  return makeCandidate(
    'lesson-presentation-v3',
    `/api/v3/lesson-summary/student/presentation?${params.toString()}`,
  );
}

export function coursewareCardsEndpoint(coursewareId: string, classroomId: string): ResourceEndpointCandidate {
  return makeCandidate(
    'cards-detlist-v2',
    `/v2/api/web/cards/detlist/${encodeURIComponent(coursewareId)}?classroom_id=${encodeURIComponent(classroomId)}`,
  );
}

export function announcementEndpoints(classroomId: string, limit = 20, offset = 0): ResourceEndpointCandidate[] {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  return [
    makeCandidate(
      'discussion-announcements-v2',
      `/v/discussion/v2/announcements/?cid=${encodeURIComponent(classroomId)}&limit=${safeLimit}&offset=${safeOffset}&type=9`,
    ),
  ];
}
