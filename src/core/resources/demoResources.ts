import type { Course, CourseMaterial, ResourceDiscoveryResult, SlidePageAsset } from '../../types/resources';
import { DAY_MS } from '../utils/time';
import { buildPdfFromJpegPages } from './pdf';

// Two small, independently decodable baseline JPEGs with distinct dimensions.
const jpegPages = [
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAbADABAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKAAAAAAAB//2Q==',
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAASACABAREA/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAA/AKuAAAD/2Q==',
];

export function createDemoResourceDiscovery(now = Date.now(), origin = 'https://demo.yuketang.cn'): ResourceDiscoveryResult {
  const iso = (days: number) => new Date(now + days * DAY_MS).toISOString();
  const sourcePlatform = 'demo';
  const makeCourse = (id: string, name: string, teacher: string, description: string): Course => ({
    id, classroomId: id, name, teacher, description, term: '演示学期',
    sourceOrigin: origin, sourcePlatform, sourceUrl: new URL('/v2/web/studentLog/' + id, origin).href, updatedAt: iso(-1),
  });
  const signals = makeCourse('demo-signals', '数字信号处理', '陈老师', '从离散信号到频域分析与数字滤波。');
  const systems = makeCourse('demo-systems', '计算机组成原理', '周老师', '用 RISC-V 指令和流水线实例学习处理器设计。');
  const assetUrl = (path: string) => new URL('/demo-assets/' + path, origin).href;
  const makeMaterial = (course: Course, id: string, type: CourseMaterial['type'], title: string,
    chapterTitle: string, extra: Partial<CourseMaterial> = {}): CourseMaterial => ({
    id, resourceKey: [course.id, type, id].join(':'), courseId: course.id, classroomId: course.classroomId, courseName: course.name,
    title, chapterTitle, type, sourcePlatform, sourceUrl: course.sourceUrl, publishedAt: iso(-7), updatedAt: iso(-1),
    downloadStatus: 'not_downloaded', ...extra,
  });
  const attachment = makeMaterial(systems, 'lab-note', 'announcement_attachment', '实验提交清单', '流水线',
    { filename: '实验提交清单.md', mimeType: 'text/markdown', downloadUrl: assetUrl('lab-note.md') });
  const makeTask = (course: Course, id: string, kind: string, title: string, days: number, summary: string) => ({
    id, resourceKey: [course.id, kind, id].join(':'), courseId: course.id, courseName: course.name,
    title, deadline: iso(days), publishedAt: iso(-5), updatedAt: iso(-1), status: 'pending' as const, sourcePlatform, summary,
  });

  return {
    origin, sourcePlatform, source: 'demo', syncedAt: iso(0),
    diagnostics: [
      { endpoint: '/demo/resources', scope: 'materials', outcome: 'ok', experimental: false, status: 200, itemCount: 6, durationMs: 1, note: 'demo-offline-dataset' },
    ],
    failedCourses: 0,
    courses: [signals, systems],
    materials: [
      makeMaterial(signals, 'spectrum', 'slides', '离散信号频谱', '频域分析',
        { filename: '离散信号频谱.pdf', mimeType: 'application/pdf', downloadUrl: assetUrl('spectrum.pdf') }),
      makeMaterial(signals, 'slide-pages', 'image_slides', '采样与量化图示', '采样',
        { slideImages: [
          { index: 0, url: assetUrl('sample-1.jpg'), width: 48, height: 27, mimeType: 'image/jpeg' },
          { index: 1, url: assetUrl('sample-2.jpg'), width: 32, height: 18, mimeType: 'image/jpeg' },
        ] }),
      makeMaterial(systems, 'pipeline', 'document', '流水线复习提纲', '流水线',
        { filename: '流水线复习提纲.md', mimeType: 'text/markdown', downloadUrl: assetUrl('pipeline.md') }),
      makeMaterial(signals, 'exercise', 'attachment', 'DFT 自习题', '频域分析',
        { filename: 'DFT 自习题.md', mimeType: 'text/markdown', downloadUrl: assetUrl('exercise.md') }),
      makeMaterial(systems, 'lecture', 'video_meta', '流水线冒险讲解', '流水线',
        { downloadStatus: 'unavailable', metadata: { durationSeconds: 840 } }),
      attachment,
    ],
    assignments: [
      { ...makeTask(signals, 'dft', 'homework', 'DFT 仿真实验', 2, '比较 8 点直接 DFT 与 FFT 的结果。'), kind: 'homework' },
      { ...makeTask(systems, 'hazards', 'quiz', '流水线冒险测验', 4, '复习旁路、停顿与控制冒险。'), kind: 'quiz' },
    ],
    exams: [makeTask(signals, 'midterm', 'exam', '信号处理期中考试', 8, '复习采样定理、频谱和 DFT。')],
    announcements: [{
      id: 'lab', resourceKey: systems.id + ':announcement:lab', courseId: systems.id, courseName: systems.name,
      title: '下次实验安排', content: '请准备好能复现流水线停顿的最小程序，并查阅提交清单。',
      publishedAt: iso(-2), sourcePlatform, attachments: [attachment],
    }],
  };
}

export function createDemoFileBytes(material: CourseMaterial, page?: SlidePageAsset): { bytes: Uint8Array; mimeType: string } {
  if (material.type === 'image_slides') {
    const encoded = jpegPages[page?.index ?? 0];
    if (!encoded) throw new RangeError('Unknown demo slide page');
    return { bytes: Uint8Array.from(atob(encoded), character => character.charCodeAt(0)), mimeType: 'image/jpeg' };
  }
  if (material.mimeType === 'application/pdf' || material.type === 'pdf') {
    const bytes = Uint8Array.from(atob(jpegPages[0]), character => character.charCodeAt(0));
    return { bytes: buildPdfFromJpegPages([{ bytes }]), mimeType: 'application/pdf' };
  }
  if (material.type === 'video_meta') throw new Error('Demo video has metadata only');
  const notes: Record<string, string> = {
    pipeline: '画出五级流水线时序图，标记每一拍中各阶段的指令。找出 RAW 冒险，判断何时需要停顿。',
    'lab-note': '提交最小测试程序、带周期标记的波形，以及对旁路与停顿位置的解释。',
    exercise: '用公式计算长度为 4 的序列 [1, 0, -1, 0] 的离散傅里叶变换，再用 FFT 核对。',
  };
  const title = material.title.replace(/[\r\n]/g, ' ');
  const notesText = notes[material.id] ?? '记录本章的主要定义，并写下一个有待验证的问题。';
  return { bytes: new TextEncoder().encode('# ' + title + '\n\n' + notesText + '\n'), mimeType: 'text/markdown' };
}
