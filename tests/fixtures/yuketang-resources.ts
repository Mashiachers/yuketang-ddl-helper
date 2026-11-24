/**
 * Sanitized synthetic Yuketang API payloads for unit & integration testing.
 * Contains zero real student IDs, cookies, session tokens, or private university data.
 */

export const TEST_ORIGIN = 'https://changjiang.yuketang.cn';
export const TEST_CDN_ORIGIN = 'https://cdn-mock.yuketang.cn';

export const MOCK_COURSES_V2_PAYLOAD = {
  code: 0,
  msg: 'OK',
  data: {
    list: [
      {
        classroom_id: 'cls-1001',
        name: '2026秋-数据结构与算法-01班',
        term: '2026-2027-1',
        teacher: { name: '林教授' },
        course: {
          id: 'course-1001',
          name: '数据结构与算法',
          intro: '<p>核心课程：<b>树、图与动态规划</b></p>',
        },
        updated_at: 1763800000,
      },
      {
        classroom_id: 'cls-1002',
        name: '2026秋-计算机网络-02班',
        term: '2026-2027-1',
        teacher_name: '陈老师',
        course: {
          id: 'course-1002',
          name: '计算机网络',
        },
      },
    ],
  },
};

export const MOCK_LEARN_LOGS_PAGE_0 = {
  code: 0,
  msg: 'OK',
  data: {
    has_more: true,
    activities: [
      {
        id: 'act-slide-1',
        type: 2,
        title: '第01讲：红黑树与平衡查找',
        courseware_id: 'cw-101',
        presentation_id: 'pres-201',
        create_time: 1763810000,
        // Decoy sensitive fields that MUST be stripped from output metadata
        cookie: 'sessionid=decoy-cookie-value',
        token: 'decoy-bearer-token',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.decoypayload.decoysig',
      },
      {
        id: 'act-pdf-1',
        type: 10,
        title: '实验指导书（PDF）',
        filename: 'Lab01_红黑树实验指导.pdf',
        mime_type: 'application/pdf',
        download_url: `${TEST_CDN_ORIGIN}/files/lab01.pdf`,
        file_size: 1048576,
        create_time: 1763820000,
      },
      {
        id: 'act-ppt-1',
        type: 11,
        title: '第02讲：图论基础',
        filename: 'Lecture02_Graphs.pptx',
        download_url: `${TEST_CDN_ORIGIN}/files/lecture02.pptx`,
        file_size: 2097152,
        create_time: 1763830000,
      },
      {
        id: 'act-doc-1',
        type: 12,
        title: '课程大纲与评分说明',
        filename: '课程大纲.docx',
        download_url: `${TEST_CDN_ORIGIN}/files/syllabus.docx`,
        file_size: 45000,
        create_time: 1763840000,
      },
      {
        id: 'act-att-1',
        type: 10,
        title: '实验初始代码包',
        filename: 'lab01-starter.zip',
        download_url: `${TEST_CDN_ORIGIN}/files/lab01-starter.zip`,
        file_size: 32768,
        create_time: 1763845000,
      },
    ],
  },
};

export const MOCK_LEARN_LOGS_PAGE_1 = {
  code: 0,
  msg: 'OK',
  data: {
    has_more: false,
    activities: [
      {
        id: 'act-hw-1',
        type: 4,
        title: '作业一：平衡树实现',
        deadline: 1765000000,
        create_time: 1763850000,
        status: 0,
        total_score: 100,
        attachments: [
          {
            id: 'hw-att-1',
            name: '测试用例说明.md',
            download_url: `${TEST_CDN_ORIGIN}/files/hw1-tests.md`,
            file_size: 4096,
          },
        ],
      },
      {
        id: 'act-exam-1',
        type: 5,
        title: '期中随堂考试',
        deadline: 1765200000,
        create_time: 1763855000,
        status: 3,
        score: 92,
        total_score: 100,
      },
      {
        id: 'act-hw-19',
        type: 19,
        title: '章节习题：最短路径',
        create_time: 1763860000,
        content: {
          leaf_id: 'leaf-1901',
          score_d: 1765500000,
          is_assessed: false,
        },
      },
      {
        id: 'act-ann-1',
        type: 15,
        title: '<b>重要</b>：本周五实验课调课通知',
        content:
          '<script>alert("xss")</script><style>.x{color:red}</style><p>各位同学好：</p><p>本周五实验课调整至<strong>周六 14:00 &amp; 机房 302</strong>。</p>',
        create_time: 1763865000,
        attachments: [
          {
            id: 'ann-att-1',
            name: '调课安排表.pdf',
            download_url: `${TEST_CDN_ORIGIN}/files/reschedule.pdf`,
            file_size: 12000,
          },
        ],
      },
      {
        id: 'act-unknown-99',
        type: 99,
        title: '未知扩展教学卡片',
        create_time: 1763870000,
      },
    ],
  },
};

export const MOCK_CHAPTER_PROGRESS_C27_PAYLOAD = {
  code: 0,
  data: {
    sku_id: 7788,
    course_progress: [
      {
        id: 'ch-1',
        name: '第一章：线性表与树',
        section_leaf_list: [
          {
            id: 'leaf-video-1',
            name: '1.1 课程导论视频',
            leaf_type: 0,
            is_locked: false,
            duration: 1800,
            progress: { status: 'finished' },
          },
          {
            id: 'leaf-doc-1',
            name: '1.2 复杂度分析讲义.pdf',
            leaf_type: 3,
            is_locked: false,
            download_url: `${TEST_CDN_ORIGIN}/chapters/ch1-complexity.pdf`,
            file_size: 512000,
            progress: { status: 'not_started' },
          },
          {
            id: 'leaf-locked-1',
            name: '1.3 未解锁补充资料.pdf',
            leaf_type: 3,
            is_locked: true,
            download_url: `${TEST_CDN_ORIGIN}/chapters/locked.pdf`,
          },
          {
            id: 'leaf-hw-skip',
            name: '1.4 章节小测',
            leaf_type: 6,
            is_locked: false,
          },
        ],
      },
    ],
  },
};

export const MOCK_CHAPTER_MOOC_PAYLOAD = {
  success: true,
  data: {
    course_chapter: [
      {
        id: 'mooc-ch-2',
        name: '第二章：图算法',
        section_leaf_list: [
          {
            id: 'mooc-sec-2-1',
            name: '2.1 深度与广度优先搜索',
            leaf_list: [
              {
                id: 'mooc-leaf-201',
                name: 'DFS_BFS_笔记.docx',
                leaf_type: 7,
                download_url: `${TEST_CDN_ORIGIN}/mooc/dfs-bfs.docx`,
                file_size: 88000,
              },
            ],
          },
        ],
      },
    ],
  },
};

export const MOCK_LESSON_SUMMARY_V3_PAYLOAD = {
  code: 0,
  data: {
    lesson: { id: 'lesson-301', title: '第03讲：动态规划' },
    presentations: [
      {
        id: 'pres-301',
        title: '动态规划专题课件',
        slidesCount: 2,
      },
    ],
  },
};

export const MOCK_PRESENTATION_SLIDES_V3_PAYLOAD = {
  code: 0,
  data: {
    slides: [
      {
        id: 's-2',
        index: 2,
        cover: `${TEST_CDN_ORIGIN}/slides/pres-201/page2.jpg`,
        width: 1920,
        height: 1080,
        note: '<p>第2页要点：<i>状态转移方程</i></p>',
      },
      {
        id: 's-1',
        index: 1,
        cover: `${TEST_CDN_ORIGIN}/slides/pres-201/page1.jpg`,
        width: 1920,
        height: 1080,
      },
      // Malicious/invalid slide URLs that MUST be filtered out
      {
        id: 's-bad-1',
        index: 3,
        cover: 'javascript:alert(1)',
      },
      {
        id: 's-bad-2',
        index: 4,
        cover: 'https://user:pass@cdn-mock.yuketang.cn/slides/leak.jpg',
      },
      {
        id: 's-bad-3',
        index: 5,
        cover: 'http://insecure.example.com/slide.jpg',
      },
    ],
  },
};

export const MOCK_ANNOUNCEMENTS_V2_PAYLOAD = {
  code: 0,
  data: {
    data: [
      {
        id: 'disc-ann-1',
        type: 9,
        title: '期末答疑时间安排',
        content:
          '<div>答疑时间：<br/>周一 19:00 &mdash; 21:00<!-- hidden comment --><iframe src="https://evil.test">x</iframe></div>',
        create_time: 1763900000,
        attachments: [
          {
            id: 'disc-att-1',
            filename: '复习提纲.pdf',
            download_url: `${TEST_CDN_ORIGIN}/ann/review-guide.pdf`,
            size: 64000,
          },
        ],
      },
    ],
  },
};
