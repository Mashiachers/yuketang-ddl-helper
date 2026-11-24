import { describe, expect, it, vi } from 'vitest';
import type { Course, HomeworkItem } from '../src/types';
import { detectPlatform } from '../src/core/platform/detector';
import {
  buildMaterialKey,
  cleanDisplayTitle,
  discoverCourseResources,
  fetchWithTimeoutAndRetry,
  mapHomeworkToDomain,
  normalizeAnnouncements,
  normalizeCourseMaterials,
  normalizeResourceCourses,
  normalizeSlidePages,
  RESOURCE_ENDPOINT_SPECS,
  sanitizeResourceUrl,
  stripHtmlToText,
} from '../src/core/resources/adapter';
import { presentationSlidesEndpoint } from '../src/core/resources/endpoints';
import {
  MOCK_ANNOUNCEMENTS_V2_PAYLOAD,
  MOCK_CHAPTER_MOOC_PAYLOAD,
  MOCK_CHAPTER_PROGRESS_C27_PAYLOAD,
  MOCK_COURSES_V2_PAYLOAD,
  MOCK_LEARN_LOGS_PAGE_0,
  MOCK_LEARN_LOGS_PAGE_1,
  MOCK_LESSON_SUMMARY_V3_PAYLOAD,
  MOCK_PRESENTATION_SLIDES_V3_PAYLOAD,
  TEST_CDN_ORIGIN,
  TEST_ORIGIN,
} from './fixtures/yuketang-resources';

const platform = detectPlatform(TEST_ORIGIN)!;

const sampleCourse: Course = {
  id: 'course-1001',
  classroomId: 'cls-1001',
  name: '数据结构与算法',
  teacher: '林教授',
  term: '2026-2027-1',
  sourcePlatform: platform.label,
  sourceOrigin: platform.origin,
  sourceUrl: `${TEST_ORIGIN}/v2/web/studentLog/cls-1001`,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('RESOURCE_ENDPOINT_SPECS metadata', () => {
  it('marks the seven Changjiang live-verified endpoints and keeps all labels free of private IDs', () => {
    const verified = RESOURCE_ENDPOINT_SPECS.filter(spec => !spec.experimental);
    const experimental = RESOURCE_ENDPOINT_SPECS.filter(spec => spec.experimental);

    expect(verified.map(spec => spec.id).sort()).toEqual([
      'classroom-detail-v2', 'course-progress-c27', 'courses-v2-list', 'discussion-announcements-v2',
      'learn-logs-v2', 'lesson-presentation-v3', 'lesson-summary-v3',
    ]);
    expect(verified.map(spec => spec.verifiedOn)).toEqual(verified.map(() => ['changjiang.yuketang.cn']));
    expect(experimental.map(spec => spec.id).sort()).toEqual([
      'cards-detlist-v2', 'course-chapter-mooc', 'course-homework-v2',
      'courses-mooc-user', 'courseware-pub-news', 'leaf-info-mooc',
    ]);
    expect(experimental.every(spec => spec.verifiedOn.length === 0)).toBe(true);
    expect(RESOURCE_ENDPOINT_SPECS.every(spec => spec.method === 'GET')).toBe(true);
    expect(RESOURCE_ENDPOINT_SPECS.every(spec => !/\d{4,}/.test(spec.label))).toBe(true);
  });

  it('keeps presentation probes experimental on hosts without live verification', () => {
    expect(presentationSlidesEndpoint('presentation', 'lesson', 'changjiang.yuketang.cn').experimental).toBe(false);
    expect(presentationSlidesEndpoint('presentation', 'lesson', 'www.yuketang.cn').experimental).toBe(true);
  });
});

describe('cleanDisplayTitle', () => {
  it.each([
    ['计算机体系结构+-+第五章V1.1', '计算机体系结构 - 第五章V1.1'],
    ['第一章+绪论+V1.0', '第一章 绪论 V1.0'],
    ['C+++-+A+B', 'C++ - A+B'],
    ['C++', 'C++'],
  ])('cleans %s into %s', (raw, expected) => {
    expect(cleanDisplayTitle(raw)).toBe(expected);
  });
});

describe('stripHtmlToText & sanitizeResourceUrl & buildMaterialKey', () => {
  it('strips HTML tags, scripts, styles, comments, and decodes entities safely without DOM', () => {
    const raw =
      '<!-- secret --><script>alert("xss")</script><style>body{display:none}</style>' +
      '<p>Hello &amp; <b>World</b></p><div>Line 2 &mdash; &#x1F4DA; &nbsp; &#0;</div>' +
      '<<script>evil()</script>><iframe src="https://evil.test">drop</iframe>';
    const text = stripHtmlToText(raw);
    expect(text).toBe('Hello & World\n\nLine 2 — 📚');
    expect(text).not.toMatch(/script|alert|style|iframe|secret|evil/i);
  });

  it('validates resource URLs strictly against protocols, credentials, and external HTTPS policy', () => {
    expect(sanitizeResourceUrl('/v2/web/studentLog/1001', TEST_ORIGIN)).toBe(
      `${TEST_ORIGIN}/v2/web/studentLog/1001`,
    );
    expect(sanitizeResourceUrl(`${TEST_ORIGIN}/files/a.pdf`, TEST_ORIGIN, false)).toBe(
      `${TEST_ORIGIN}/files/a.pdf`,
    );
    // External HTTPS denied by default, allowed when allowExternalHttps = true
    expect(sanitizeResourceUrl(`${TEST_CDN_ORIGIN}/slides/1.jpg`, TEST_ORIGIN, false)).toBeUndefined();
    expect(sanitizeResourceUrl(`${TEST_CDN_ORIGIN}/slides/1.jpg`, TEST_ORIGIN, true)).toBe(
      `${TEST_CDN_ORIGIN}/slides/1.jpg`,
    );
    // Reject dangerous schemes, plaintext external HTTP, embedded credentials, and control chars
    expect(sanitizeResourceUrl('javascript:alert(1)', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl('data:text/html,<script>alert(1)</script>', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl('file:///etc/passwd', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl('vbscript:msgbox(1)', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl('http://cdn.example.com/a.pdf', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl('https://user:pass@changjiang.yuketang.cn/a.pdf', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl('https://user@cdn-mock.yuketang.cn/a.jpg', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl('https://cdn-mock.yuketang.cn/a\nb.pdf', TEST_ORIGIN, true)).toBeUndefined();
    expect(sanitizeResourceUrl(null, TEST_ORIGIN, true)).toBeUndefined();
  });

  it('builds stable normalized material keys', () => {
    expect(buildMaterialKey(' course-1 ', 'pdf', ' mat-9 ')).toBe('course-1:pdf:mat-9');
  });
});

describe('pure normalizers', () => {
  it('normalizes courses including nested teacher objects and HTML-stripped descriptions', () => {
    const courses = normalizeResourceCourses(MOCK_COURSES_V2_PAYLOAD, platform);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({
      id: 'course-1001',
      classroomId: 'cls-1001',
      name: '数据结构与算法',
      teacher: '林教授',
      term: '2026-2027-1',
      description: '核心课程：树、图与动态规划',
      sourcePlatform: '长江雨课堂',
      sourceOrigin: TEST_ORIGIN,
      sourceUrl: `${TEST_ORIGIN}/v2/web/studentLog/cls-1001`,
    });
    expect(courses[0].updatedAt).toBe(new Date(1763800000 * 1000).toISOString());
    expect(courses[1].teacher).toBe('陈老师');
  });

  it('normalizes slide pages in ascending index order and filters unsafe URLs', () => {
    const pages = normalizeSlidePages(MOCK_PRESENTATION_SLIDES_V3_PAYLOAD, TEST_ORIGIN);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      index: 1,
      url: `${TEST_CDN_ORIGIN}/slides/pres-201/page1.jpg`,
      width: 1920,
      height: 1080,
      mimeType: 'image/jpeg',
    });
    expect(pages[1]).toMatchObject({
      index: 2,
      url: `${TEST_CDN_ORIGIN}/slides/pres-201/page2.jpg`,
      note: '第2页要点：状态转移方程',
    });
  });

  it('normalizes slides, PDF, PPT, Word, attachments, announcement attachments, unknown types, and strips sensitive metadata', () => {
    const combined = [
      ...MOCK_LEARN_LOGS_PAGE_0.data.activities,
      ...MOCK_LEARN_LOGS_PAGE_1.data.activities,
    ];
    const materials = normalizeCourseMaterials(combined, sampleCourse, TEST_ORIGIN);

    const byId = new Map(materials.map(m => [m.id, m]));
    expect(byId.get('act-slide-1')).toMatchObject({
      type: 'slides',
      resourceKey: 'course-1001:slides:act-slide-1',
      downloadStatus: 'unavailable',
      metadata: { rawType: 2, coursewareId: 'cw-101', presentationId: 'pres-201' },
    });
    // Sensitive decoy keys must never appear in material metadata or serialized output
    expect(JSON.stringify(byId.get('act-slide-1'))).not.toMatch(/decoy|cookie|token|authorization|sessionid/i);

    expect(byId.get('act-pdf-1')).toMatchObject({
      type: 'pdf',
      mimeType: 'application/pdf',
      downloadStatus: 'not_downloaded',
      size: 1048576,
    });
    expect(byId.get('act-ppt-1')).toMatchObject({
      type: 'ppt',
      downloadStatus: 'not_downloaded',
    });
    expect(byId.get('act-doc-1')).toMatchObject({
      type: 'document',
      downloadStatus: 'not_downloaded',
    });
    expect(byId.get('act-att-1')).toMatchObject({
      type: 'attachment',
      downloadStatus: 'not_downloaded',
    });
    // Homework row itself is excluded, while its attachment is preserved
    expect(byId.has('act-hw-1')).toBe(false);
    expect(byId.get('hw-att-1')).toMatchObject({
      type: 'document',
      downloadUrl: `${TEST_CDN_ORIGIN}/files/hw1-tests.md`,
    });
    // Announcement row itself is excluded from materials, while its attachment is typed as announcement_attachment
    expect(byId.has('act-ann-1')).toBe(false);
    expect(byId.get('ann-att-1')).toMatchObject({
      type: 'announcement_attachment',
      downloadUrl: `${TEST_CDN_ORIGIN}/files/reschedule.pdf`,
    });
    // Unknown activity type falls back gracefully to 'other'
    expect(byId.get('act-unknown-99')).toMatchObject({
      type: 'other',
      downloadStatus: 'unavailable',
    });
  });

  it('normalizes c27 chapter progress trees, MOOC nested chapters, and lesson presentations', () => {
    const c27 = normalizeCourseMaterials(MOCK_CHAPTER_PROGRESS_C27_PAYLOAD, sampleCourse, TEST_ORIGIN, {
      experimental: true,
    });
    expect(c27).toHaveLength(3); // skips leaf_type: 6 homework
    expect(c27.find(m => m.id === 'leaf-video-1')).toMatchObject({
      type: 'video_meta',
      chapterId: 'ch-1',
      chapterTitle: '第一章：线性表与树',
      downloadStatus: 'unavailable',
      experimental: true,
    });
    expect(c27.find(m => m.id === 'leaf-doc-1')).toMatchObject({
      type: 'pdf',
      chapterTitle: '第一章：线性表与树',
      downloadStatus: 'not_downloaded',
    });
    expect(c27.find(m => m.id === 'leaf-locked-1')).toMatchObject({
      downloadStatus: 'unavailable',
      metadata: { isLocked: true },
    });

    const mooc = normalizeCourseMaterials(MOCK_CHAPTER_MOOC_PAYLOAD, sampleCourse, TEST_ORIGIN, {
      experimental: true,
    });
    expect(mooc).toHaveLength(1);
    expect(mooc[0]).toMatchObject({
      id: 'mooc-leaf-201',
      type: 'document',
      chapterId: 'mooc-sec-2-1',
      chapterTitle: '2.1 深度与广度优先搜索',
    });

    const summary = normalizeCourseMaterials(MOCK_LESSON_SUMMARY_V3_PAYLOAD, sampleCourse, TEST_ORIGIN, {
      experimental: true,
    });
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      id: 'pres-301',
      type: 'slides',
      metadata: { lessonId: 'lesson-301', presentationId: 'pres-301', slidesCount: 2 },
    });
  });

  it('normalizes announcements from both learn logs and discussion API with HTML stripped', () => {
    const fromLogs = normalizeAnnouncements(MOCK_LEARN_LOGS_PAGE_1, sampleCourse, TEST_ORIGIN);
    expect(fromLogs).toHaveLength(1);
    expect(fromLogs[0]).toMatchObject({
      id: 'act-ann-1',
      resourceKey: 'course-1001:announcement:act-ann-1',
      title: '重要：本周五实验课调课通知',
      content: '各位同学好：\n\n本周五实验课调整至周六 14:00 & 机房 302。',
    });
    expect(fromLogs[0].content).not.toMatch(/<script|alert|<style/i);
    expect(fromLogs[0].attachments).toHaveLength(1);
    expect(fromLogs[0].attachments?.[0].type).toBe('announcement_attachment');

    const fromDiscussion = normalizeAnnouncements(MOCK_ANNOUNCEMENTS_V2_PAYLOAD, sampleCourse, TEST_ORIGIN);
    expect(fromDiscussion).toHaveLength(1);
    expect(fromDiscussion[0].content).toBe('答疑时间：\n周一 19:00 — 21:00');
    expect(fromDiscussion[0].attachments?.[0]).toMatchObject({
      id: 'disc-att-1',
      type: 'announcement_attachment',
      filename: '复习提纲.pdf',
    });
  });

  it('maps v0.1 HomeworkItem[] into Assignment[] and Exam[] cleanly', () => {
    const items: HomeworkItem[] = [
      {
        id: 'hw-1',
        courseId: 'course-1001',
        courseName: '数据结构与算法',
        title: '<b>作业一</b>',
        type: 'homework',
        deadline: 1765000000000,
        startTime: 1763850000000,
        status: 'pending',
        url: `${TEST_ORIGIN}/v2/web/studentLog/cls-1001`,
        summary: '<p>实现红黑树插入</p>',
      },
      {
        id: 'exam-1',
        courseId: 'course-1001',
        courseName: '数据结构与算法',
        title: '期中考试',
        type: 'exam',
        deadline: null,
        status: 'submitted',
        url: `${TEST_ORIGIN}/v2/web/studentLog/cls-1001`,
        rawStatusHint: { score: 92, total_score: 100 },
      },
      {
        id: 'ann-skip',
        courseId: 'course-1001',
        courseName: '数据结构与算法',
        title: '公告不进入作业',
        type: 'announcement',
        deadline: null,
        status: 'pending',
        url: `${TEST_ORIGIN}/v2/web/studentLog/cls-1001`,
      },
    ];

    const { assignments, exams } = mapHomeworkToDomain(items, platform);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      id: 'hw-1',
      resourceKey: 'course-1001:assignment:hw-1',
      title: '作业一',
      kind: 'homework',
      summary: '实现红黑树插入',
      deadline: new Date(1765000000000).toISOString(),
    });
    expect(exams).toHaveLength(1);
    expect(exams[0]).toMatchObject({
      id: 'exam-1',
      resourceKey: 'course-1001:exam:exam-1',
      deadline: null,
      score: 92,
      totalScore: 100,
    });
  });
});

describe('fetchWithTimeoutAndRetry error classification, retry, timeout, and cancellation', () => {
  const endpoint = new URL('/v2/api/web/courses/list?identity=2', TEST_ORIGIN);

  it('retries transient 5xx and network errors up to maxRetries and succeeds on recovery', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network blip'))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { list: [] } }, 200));

    const res = await fetchWithTimeoutAndRetry(endpoint, {
      headers: { Accept: 'application/json' },
      fetchImpl,
      timeoutMs: 1000,
      maxRetries: 2,
      retryBaseDelayMs: 0,
    });

    expect(res.ok).toBe(true);
    expect(res.outcome).toBe('ok');
    expect(res.attempts).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['HTTP 401', 'unauthorized', () => jsonResponse({}, 401)],
    ['HTTP 403', 'unauthorized', () => jsonResponse({}, 403)],
    ['HTTP 404', 'not-found', () => jsonResponse({}, 404)],
    ['business code 50000', 'unauthorized', () => jsonResponse({ code: 50000, msg: 'not login' }, 200)],
    ['business errcode 401002', 'unauthorized', () => jsonResponse({ errcode: 401002, errmsg: 'expired' }, 200)],
    ['business code 80019', 'not-found', () => jsonResponse({ code: 80019, msg: 'deprecated' }, 200)],
    [
      'HTTP 200 HTML login page',
      'unauthorized',
      () => new Response('<!DOCTYPE html><html><body>请登录雨课堂</body></html>', { status: 200 }),
    ],
    ['non-JSON plain text', 'invalid-response', () => new Response('upstream bad body', { status: 200 })],
  ])('never retries %s and classifies outcome as %s', async (_label, expectedOutcome, makeResponse) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => makeResponse());

    const res = await fetchWithTimeoutAndRetry(endpoint, {
      headers: { Accept: 'application/json' },
      fetchImpl,
      timeoutMs: 1000,
      maxRetries: 3,
      retryBaseDelayMs: 0,
    });

    expect(res.ok).toBe(false);
    expect(res.outcome).toBe(expectedOutcome);
    expect(res.attempts).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies per-attempt timeouts and retries within bounded maxRetries', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const res = await fetchWithTimeoutAndRetry(endpoint, {
      headers: { Accept: 'application/json' },
      fetchImpl,
      timeoutMs: 100,
      maxRetries: 1,
      retryBaseDelayMs: 0,
    });

    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('timeout');
    expect(res.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops immediately on AbortSignal cancellation without retrying', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
        setTimeout(() => controller.abort(), 15);
      });
    });

    const res = await fetchWithTimeoutAndRetry(endpoint, {
      headers: { Accept: 'application/json' },
      fetchImpl,
      signal: controller.signal,
      timeoutMs: 5000,
      maxRetries: 3,
      retryBaseDelayMs: 0,
    });

    expect(res.ok).toBe(false);
    expect(res.outcome).toBe('cancelled');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('discoverCourseResources end-to-end discovery', () => {
  it('discovers paginated learn logs, fallback chapters, announcements, hydrated slides, and sanitizes diagnostics', async () => {
    const requestedUrls: string[] = [];

    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requestedUrls.push(url);

      if (url.includes('/v2/api/web/courses/list')) {
        return jsonResponse(MOCK_COURSES_V2_PAYLOAD);
      }
      if (url.includes('/v2/api/web/logs/learn/cls-1001') && url.includes('page=0')) {
        return jsonResponse(MOCK_LEARN_LOGS_PAGE_0);
      }
      if (url.includes('/v2/api/web/logs/learn/cls-1001') && url.includes('page=1')) {
        return jsonResponse(MOCK_LEARN_LOGS_PAGE_1);
      }
      if (url.includes('/c27/online_courseware/schedule/course/progress/')) {
        // Simulate 80019 / unavailable on c27 to verify fallback to mooc chapter endpoint
        return jsonResponse({ code: 80019, msg: 'not supported' });
      }
      if (url.includes('/mooc-api/v1/lms/learn/course/chapter')) {
        return jsonResponse(MOCK_CHAPTER_MOOC_PAYLOAD);
      }
      if (url.includes('/v/discussion/v2/announcements/')) {
        return jsonResponse(MOCK_ANNOUNCEMENTS_V2_PAYLOAD);
      }
      if (url.includes('/api/v3/lesson-summary/student/presentation')) {
        return jsonResponse(MOCK_PRESENTATION_SLIDES_V3_PAYLOAD);
      }
      return jsonResponse({}, 404);
    });

    const onProgress = vi.fn();
    const result = await discoverCourseResources(platform, {
      cookie: 'sessionid=top-secret-session; csrftoken=top-secret-csrf; xtbz=ykt',
      fetchImpl,
      courseIds: ['course-1001'],
      maxPages: 4,
      pageSize: 5, // Matches MOCK_LEARN_LOGS_PAGE_0 length so page 1 is also requested
      maxRetries: 1,
      retryBaseDelayMs: 0,
      intervalMs: 0,
      onProgress,
    });

    expect(result.error).toBeUndefined();
    expect(result.failedCourses).toBe(0);
    expect(result.courses).toHaveLength(1);
    expect(onProgress).toHaveBeenCalledWith(1, 1);

    // Verified pagination fetched page 0 and page 1 (and stopped because page 2 wasn't needed or max reached)
    expect(requestedUrls.some(u => u.includes('page=0&offset=5'))).toBe(true);
    expect(requestedUrls.some(u => u.includes('page=1&offset=5'))).toBe(true);

    // Hydrated slide material upgraded from 'slides' to 'image_slides' with consistent resourceKey
    const hydratedSlide = result.materials.find(m => m.id === 'act-slide-1');
    expect(hydratedSlide).toMatchObject({
      type: 'image_slides',
      resourceKey: 'course-1001:image_slides:act-slide-1',
      downloadStatus: 'not_downloaded',
      experimental: false,
    });
    expect(hydratedSlide?.slideImages).toHaveLength(2);

    // Fallback MOOC chapter material included with chapterTitle
    expect(result.materials.find(m => m.id === 'mooc-leaf-201')).toMatchObject({
      type: 'document',
      chapterTitle: '2.1 深度与广度优先搜索',
      experimental: true,
    });

    // Assignments include both type 4 and type 19 homework; exams include type 5
    expect(result.assignments.map(a => a.id).sort()).toEqual(['act-hw-1', 'act-hw-19']);
    expect(result.exams.map(e => e.id)).toEqual(['act-exam-1']);

    // Announcements merged from both learn logs and discussion API (with HTML stripped)
    expect(result.announcements.map(a => a.id).sort()).toEqual(['act-ann-1', 'disc-ann-1']);

    // Strict diagnostic sanitization: zero cookies, tokens, or private IDs
    const diagJson = JSON.stringify(result.diagnostics);
    expect(diagJson).not.toMatch(/top-secret-session|top-secret-csrf|cls-1001|course-1001|pres-201/);
    expect(result.diagnostics.some(d => d.endpoint === '/v2/api/web/logs/learn/{classroom_id}' && !d.experimental)).toBe(true);
    expect(result.diagnostics.some(d => d.endpoint === '/api/v3/lesson-summary/student/presentation' && !d.experimental)).toBe(true);
  });

  it.each(['lesson_id', 'courseware_id'] as const)(
    'merges a c27 classroom leaf into the learn-log lesson via %s before hydrating its slides',
    async matchField => {
      const leaf = { id: 8100, leafinfo_id: 1414, leaf_type: 8, name: '9月10日授课（2）' };
      const chapterPayload = {
        success: true,
        data: { course_progress: [{ id: 'chapter-1', name: '计算机体系结构', section_leaf_list: [leaf] }] },
      };
      expect(normalizeCourseMaterials(chapterPayload, sampleCourse, TEST_ORIGIN)).toEqual([
        expect.objectContaining({ type: 'slides', metadata: expect.objectContaining({ lessonId: '1414' }) }),
      ]);
      expect(normalizeCourseMaterials([{ ...leaf, leafinfo_id: 0 }], sampleCourse, TEST_ORIGIN)[0].metadata?.lessonId)
        .toBe('8100');

      const pathRequests: string[] = [];
      const fetchImpl = vi.fn<typeof fetch>(async input => {
        const url = new URL(String(input));
        pathRequests.push(url.pathname + url.search);
        switch (url.pathname) {
          case '/v2/api/web/courses/list':
            return jsonResponse(MOCK_COURSES_V2_PAYLOAD);
          case '/v2/api/web/logs/learn/cls-1001':
            return jsonResponse({ errcode: 0, data: { rows: [
              { id: 1400, type: 14, title: '通信原理', [matchField]: 1414 },
            ] } });
          case '/c27/online_courseware/schedule/course/progress/':
            return jsonResponse(chapterPayload);
          case '/api/v3/lesson-summary/student':
            return jsonResponse({ code: 0, data: { presentations: [
              { id: 'empty-presentation', title: '空课件' },
              { id: 'pres-201', title: '计算机体系结构+-+第五章V1.1' },
            ] } });
          case '/api/v3/lesson-summary/student/presentation':
            return jsonResponse(url.searchParams.get('presentation_id') === 'pres-201'
              ? MOCK_PRESENTATION_SLIDES_V3_PAYLOAD
              : { code: 0, data: { slides: [] } });
          default:
            return jsonResponse({}, 404);
        }
      });

      const result = await discoverCourseResources(platform, {
        fetchImpl, courseIds: [sampleCourse.id], intervalMs: 0, maxRetries: 0,
      });
      expect(result.materials).toEqual([expect.objectContaining({
        id: '1400',
        resourceKey: 'course-1001:image_slides:1400',
        title: '计算机体系结构 - 第五章V1.1',
        chapterTitle: '计算机体系结构',
        type: 'image_slides',
        experimental: false,
        downloadStatus: 'not_downloaded',
        metadata: expect.objectContaining({ lessonId: '1414', presentationId: 'pres-201' }),
      })]);
      expect(pathRequests.filter(path => path.startsWith('/api/v3/lesson-summary/student?')))
        .toEqual(['/api/v3/lesson-summary/student?lesson_id=1414']);
    },
  );

  it('stops pagination cleanly when the server returns a duplicate page loop', async () => {
    let pageCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/v2/api/web/logs/learn/')) {
        pageCalls++;
        // Always return identical 5-item page despite pageSize=5
        return jsonResponse(MOCK_LEARN_LOGS_PAGE_0);
      }
      return jsonResponse({}, 404);
    });

    const result = await discoverCourseResources(platform, {
      existingCourses: [
        { id: 'course-1001', classroomId: 'cls-1001', name: '数据结构与算法' },
      ],
      fetchImpl,
      maxPages: 10,
      pageSize: 5,
      maxRetries: 0,
      retryBaseDelayMs: 0,
      intervalMs: 0,
    });

    expect(pageCalls).toBe(2); // page 0 + page 1 detected duplicate and stopped immediately
    expect(result.diagnostics.some(d => d.note?.includes('duplicate-page-stopped'))).toBe(true);
  });

  it('returns cancelled immediately when AbortSignal is already aborted and rejects non-Yuketang origins', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();

    const cancelled = await discoverCourseResources(platform, {
      signal: controller.signal,
      fetchImpl,
    });
    expect(cancelled.error).toBe('cancelled');
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      discoverCourseResources(
        { origin: 'https://evil.example.com', host: 'evil.example.com', variant: 'custom', label: 'evil', xtbz: 'ykt' },
        { fetchImpl },
      ),
    ).rejects.toThrow('无效的雨课堂来源');
  });

  it('surfaces unauthorized error when all course endpoints return 401', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 401));
    const result = await discoverCourseResources(platform, {
      fetchImpl,
      maxRetries: 2,
      retryBaseDelayMs: 0,
    });
    expect(result.error).toBe('unauthorized');
    expect(result.courses).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 2 course endpoint candidates, 1 attempt each (no retry on 401)
  });
});
