import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RESOURCE_SCHEMA_VERSION,
  type Announcement,
  type Assignment,
  type Course,
  type CourseInfo,
  type CourseMaterial,
  type DownloadBatchOptions,
  type DownloadBatchResult,
  type DownloadItemResult,
  type DownloadProgress,
  type DownloadStatus,
  type Exam,
  type ExportManifest,
  type ExportMode,
  type HomeworkItem,
  type MaterialType,
  type PlatformInfo,
  type ResourceDiscoveryResult,
  type ResourceEndpointDiagnostic,
  type SyncStatusReport,
} from '../../types';
import { useDebouncedValue } from '../utils/format';
import type { DdlAppController } from './useDdlApp';

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  slides: '课件',
  image_slides: '图片课件',
  pdf: 'PDF',
  ppt: 'PPT',
  document: '文档',
  attachment: '附件',
  announcement_attachment: '公告附件',
  video_meta: '视频元信息',
  other: '其他',
};

export const DOWNLOAD_STATUS_LABELS: Record<DownloadStatus, string> = {
  not_downloaded: '未下载',
  downloading: '下载中',
  downloaded: '已下载',
  updated: '有更新',
  failed: '失败',
  unavailable: '仅链接',
};

export interface ExportModeOption {
  id: ExportMode;
  name: string;
  extension: string;
  hint: string;
  includesBinaries: boolean;
}

export const EXPORT_MODE_OPTIONS: readonly ExportModeOption[] = [
  {
    id: 'knowledge-base',
    name: '完整课程知识库',
    extension: '.zip',
    hint: '按学期与课程目录归档课件、作业、公告、deadlines.ics 与 manifest.json',
    includesBinaries: true,
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM 资料包',
    extension: '.zip',
    hint: '扁平化章节命名，图片课件合 PDF + 课程概览 Markdown，直接拖入 NotebookLM',
    includesBinaries: true,
  },
  {
    id: 'ai-context',
    name: 'AI Context Pack',
    extension: '.zip',
    hint: '轻量纯文本上下文（课程概览、DDL、资料索引、context.json 与安全 study_prompt.md）',
    includesBinaries: false,
  },
  {
    id: 'json-only',
    name: '结构化 JSON',
    extension: '.json',
    hint: '标准 schemaVersion 0.2.0 课程与资源数据，适合脚本或 Agent 直接读取',
    includesBinaries: false,
  },
  {
    id: 'markdown-only',
    name: '课程索引 Markdown',
    extension: '.md',
    hint: '单文件课程与资料总览，可直接复制粘贴进任意大模型对话',
    includesBinaries: false,
  },
];

export interface ResourceSyncRequest {
  platform: PlatformInfo;
  useDemoMode: boolean;
  force?: boolean;
  existingCourses?: CourseInfo[];
  existingHomework?: HomeworkItem[];
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface ResourceDownloadSingleRequest {
  material: CourseMaterial;
  useDemoMode: boolean;
  mergeSlideImagesToPdf: boolean;
  forceRedownload?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface ResourceDownloadBatchRequest {
  materials: CourseMaterial[];
  useDemoMode: boolean;
  options: DownloadBatchOptions;
}

export interface ResourceExportRequest {
  mode: ExportMode;
  courseIds: string[];
  discovery: ResourceDiscoveryResult;
  useDemoMode: boolean;
  mergeSlideImagesToPdf: boolean;
  includeAssignments?: boolean;
  includeAnnouncements?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

export interface ResourceExportResponse {
  filename: string;
  manifest: ExportManifest;
  bytesLength: number;
}

export interface ResourceCenterBackend {
  syncResources(req: ResourceSyncRequest): Promise<ResourceDiscoveryResult>;
  downloadSingle(req: ResourceDownloadSingleRequest): Promise<DownloadItemResult>;
  downloadBatch(req: ResourceDownloadBatchRequest): Promise<DownloadBatchResult>;
  exportBundle(req: ResourceExportRequest): Promise<ResourceExportResponse>;
  getSyncStatus?(platform: PlatformInfo, useDemoMode: boolean): Promise<SyncStatusReport | null>;
}

export interface ResourceNotice {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export interface ResourceStats {
  totalCount: number;
  newCount: number;
  updatedCount: number;
  downloadedCount: number;
  failedCount: number;
  unavailableCount: number;
  downloadableCount: number;
  knownTotalBytes: number;
}

export interface UseResourceCenterOptions {
  backend?: ResourceCenterBackend;
  autoSync?: boolean;
}

let registeredBackend: ResourceCenterBackend | null = null;

/**
 * Registers the live+demo ResourceCenterBackend (wired in Stage 3 by Main Agent).
 */
export function registerResourceCenterBackend(backend: ResourceCenterBackend | null): void {
  registeredBackend = backend;
}

export function getRegisteredResourceCenterBackend(): ResourceCenterBackend | null {
  return registeredBackend;
}

export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function isSafeHttpUrl(raw?: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

export function isMaterialDownloadable(material: CourseMaterial): boolean {
  if (material.downloadStatus === 'unavailable' || material.type === 'video_meta') return false;
  return Boolean(material.downloadUrl || (material.slideImages && material.slideImages.length > 0));
}

function sanitizeSafeDownloadName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function triggerLocalBlobDownload(content: BlobPart, filename: string, mimeType: string): number {
  const blob = new Blob([content], { type: mimeType });
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeSafeDownloadName(filename, 'yuketang-export.txt');
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return blob.size;
}

function waitWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('已取消', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createDemoDiscoveryData(platform: PlatformInfo): ResourceDiscoveryResult {
  const now = Date.now();
  const iso = (offsetHours: number) => new Date(now + offsetHours * 3_600_000).toISOString();
  const origin = platform.origin || 'https://www.yuketang.cn';

  const courses: Course[] = [
    {
      id: 'demo-cs101',
      classroomId: 'demo-cs101',
      name: '操作系统原理',
      teacher: '张教授',
      term: '2026-春',
      description: '进程调度、内存管理、文件系统与并发控制',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceOrigin: origin,
      sourceUrl: `${origin}/v2/web/studentLog/demo-cs101`,
      updatedAt: iso(-2),
    },
    {
      id: 'demo-ai202',
      classroomId: 'demo-ai202',
      name: '机器学习导论',
      teacher: '李副教授',
      term: '2026-春',
      description: '监督学习、神经网络基础与概率图模型',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceOrigin: origin,
      sourceUrl: `${origin}/v2/web/studentLog/demo-ai202`,
      updatedAt: iso(-5),
    },
    {
      id: 'demo-net301',
      classroomId: 'demo-net301',
      name: '计算机网络',
      teacher: '王老师',
      term: '2026-春',
      description: 'TCP/IP 协议栈、拥塞控制与网络安全',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceOrigin: origin,
      sourceUrl: `${origin}/v2/web/studentLog/demo-net301`,
      updatedAt: iso(-12),
    },
  ];

  const materials: CourseMaterial[] = [
    {
      id: 'mat-os-01',
      resourceKey: 'demo-cs101:image_slides:mat-os-01',
      courseId: 'demo-cs101',
      classroomId: 'demo-cs101',
      courseName: '操作系统原理',
      chapterId: 'ch-04',
      chapterTitle: '第 4 章 · 虚拟内存与页面置换',
      title: '第 4 讲 虚拟内存与 TLB 加速（图片课件）',
      type: 'image_slides',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-cs101`,
      slideImages: [
        { index: 1, url: `${origin}/demo/slides/os-04-p1.jpg`, width: 1280, height: 720, mimeType: 'image/jpeg' },
        { index: 2, url: `${origin}/demo/slides/os-04-p2.jpg`, width: 1280, height: 720, mimeType: 'image/jpeg' },
        { index: 3, url: `${origin}/demo/slides/os-04-p3.jpg`, width: 1280, height: 720, mimeType: 'image/jpeg' },
      ],
      publishedAt: iso(-18),
      updatedAt: iso(-2),
      mimeType: 'application/pdf',
      filename: '第4讲_虚拟内存与TLB加速.pdf',
      size: 2_480_000,
      downloadStatus: 'not_downloaded',
      isNew: true,
    },
    {
      id: 'mat-os-02',
      resourceKey: 'demo-cs101:pdf:mat-os-02',
      courseId: 'demo-cs101',
      classroomId: 'demo-cs101',
      courseName: '操作系统原理',
      chapterId: 'ch-03',
      chapterTitle: '第 3 章 · 进程同步与死锁',
      title: 'Lab 3 信号量与哲学家就餐实验指导书.pdf',
      type: 'pdf',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-cs101`,
      downloadUrl: `${origin}/demo/files/os-lab3.pdf`,
      publishedAt: iso(-72),
      updatedAt: iso(-48),
      mimeType: 'application/pdf',
      filename: 'Lab3_信号量与死锁实验指导书.pdf',
      size: 1_320_000,
      downloadStatus: 'downloaded',
    },
    {
      id: 'mat-ai-01',
      resourceKey: 'demo-ai202:ppt:mat-ai-01',
      courseId: 'demo-ai202',
      classroomId: 'demo-ai202',
      courseName: '机器学习导论',
      chapterId: 'ch-06',
      chapterTitle: '第 6 章 · 反向传播与优化器',
      title: 'Lecture 06 Backpropagation & Adam Optimizer.pptx',
      type: 'ppt',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-ai202`,
      downloadUrl: `${origin}/demo/files/ml-lec06.pptx`,
      publishedAt: iso(-30),
      updatedAt: iso(-4),
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename: 'Lecture06_Backpropagation_Adam.pptx',
      size: 4_850_000,
      downloadStatus: 'updated',
      isNew: true,
    },
    {
      id: 'mat-ai-02',
      resourceKey: 'demo-ai202:document:mat-ai-02',
      courseId: 'demo-ai202',
      classroomId: 'demo-ai202',
      courseName: '机器学习导论',
      chapterId: 'ch-05',
      chapterTitle: '第 5 章 · 支持向量机与核方法',
      title: 'SVM 推导补充讲义与习题提示.md',
      type: 'document',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-ai202`,
      downloadUrl: `${origin}/demo/files/svm-notes.md`,
      publishedAt: iso(-96),
      updatedAt: iso(-90),
      mimeType: 'text/markdown',
      filename: 'SVM推导补充讲义.md',
      size: 46_200,
      downloadStatus: 'not_downloaded',
      experimental: true,
    },
    {
      id: 'mat-net-01',
      resourceKey: 'demo-net301:announcement_attachment:mat-net-01',
      courseId: 'demo-net301',
      classroomId: 'demo-net301',
      courseName: '计算机网络',
      chapterId: 'ch-midterm',
      chapterTitle: '期中复习公告附件',
      title: '期中闭卷考试大纲与重点抓包题样例.pdf',
      type: 'announcement_attachment',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-net301`,
      downloadUrl: `${origin}/demo/files/net-midterm-outline.pdf`,
      publishedAt: iso(-8),
      updatedAt: iso(-8),
      mimeType: 'application/pdf',
      filename: '期中考试大纲与抓包题样例.pdf',
      size: 780_400,
      downloadStatus: 'not_downloaded',
      isNew: true,
    },
    {
      id: 'mat-net-02',
      resourceKey: 'demo-net301:video_meta:mat-net-02',
      courseId: 'demo-net301',
      classroomId: 'demo-net301',
      courseName: '计算机网络',
      chapterId: 'ch-05',
      chapterTitle: '第 5 章 · TCP 拥塞控制',
      title: 'TCP Reno 与 BBR 对比录播回放（仅元信息链接）',
      type: 'video_meta',
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-net301`,
      publishedAt: iso(-40),
      updatedAt: iso(-40),
      downloadStatus: 'unavailable',
      metadata: { durationMinutes: 46, note: '受版权/流媒体限制，仅保留已授权原页面链接' },
    },
  ];

  const assignments: Assignment[] = [
    {
      id: 'asg-os-01',
      resourceKey: 'demo-cs101:assignment:asg-os-01',
      courseId: 'demo-cs101',
      courseName: '操作系统原理',
      title: 'Lab 3 进程同步实验报告提交',
      kind: 'homework',
      status: 'pending',
      deadline: iso(18),
      publishedAt: iso(-72),
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-cs101`,
      summary: '实现无死锁的哲学家就餐问题并附测试截图',
    },
    {
      id: 'asg-ai-01',
      resourceKey: 'demo-ai202:assignment:asg-ai-01',
      courseId: 'demo-ai202',
      courseName: '机器学习导论',
      title: '作业 4：手写 MLP 反向传播与梯度检验',
      kind: 'homework',
      status: 'pending',
      deadline: iso(54),
      publishedAt: iso(-30),
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-ai202`,
      summary: '提交 Python Notebook 与误差分析报告',
    },
  ];

  const exams: Exam[] = [
    {
      id: 'exam-net-01',
      resourceKey: 'demo-net301:exam:exam-net-01',
      courseId: 'demo-net301',
      courseName: '计算机网络',
      title: '期中随堂测验（传输层与网络层）',
      status: 'pending',
      deadline: iso(96),
      publishedAt: iso(-10),
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-net301`,
      summary: '闭卷 45 分钟，覆盖 IPv4 子网划分与 TCP 状态机',
    },
  ];

  const announcements: Announcement[] = [
    {
      id: 'ann-net-01',
      resourceKey: 'demo-net301:announcement:ann-net-01',
      courseId: 'demo-net301',
      courseName: '计算机网络',
      title: '关于本周五期中测验范围与答疑时间通知',
      content: '请同学们重点复习第 3~5 章内容，周四晚 19:00-21:00 助教将在教学楼 B204 进行考前答疑。',
      publishedAt: iso(-8),
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-net301`,
    },
    {
      id: 'ann-os-01',
      resourceKey: 'demo-cs101:announcement:ann-os-01',
      courseId: 'demo-cs101',
      courseName: '操作系统原理',
      title: 'Lab 3 评测脚本已更新（v1.2）',
      content: '修复了边界并发测试偶发超时问题，请重新拉取最新实验指导书确认测试用例说明。',
      publishedAt: iso(-20),
      sourcePlatform: platform.label || '雨课堂主站',
      sourceUrl: `${origin}/v2/web/studentLog/demo-cs101`,
    },
  ];

  const diagnostics: ResourceEndpointDiagnostic[] = [
    {
      endpoint: '/v2/api/web/courses/list',
      scope: 'courses',
      outcome: 'ok',
      experimental: false,
      status: 200,
      itemCount: courses.length,
      durationMs: 42,
      note: 'Demo 模式内置样本（未发起网络请求）',
    },
    {
      endpoint: '/v2/api/web/logs/learn/{classroom_id}',
      scope: 'materials',
      outcome: 'ok',
      experimental: false,
      status: 200,
      itemCount: materials.length,
      durationMs: 68,
      note: 'Demo 模式内置样本',
    },
    {
      endpoint: '/c27/online_courseware/xty/kls/pub_news/{courseware_id}/',
      scope: 'chapters',
      outcome: 'ok',
      experimental: true,
      status: 200,
      itemCount: 4,
      durationMs: 55,
      note: '实验接口（Demo 模拟）',
    },
  ];

  return {
    origin,
    sourcePlatform: platform.label || '雨课堂主站',
    source: 'demo',
    syncedAt: new Date(now).toISOString(),
    courses,
    materials,
    assignments,
    exams,
    announcements,
    diagnostics,
    failedCourses: 0,
  };
}

export function createFallbackDemoResourceBackend(): ResourceCenterBackend {
  const buildDemoBytes = (material: CourseMaterial, mergeSlides: boolean): { filename: string; mimeType: string; bytes: Uint8Array } => {
    const encoder = new TextEncoder();
    const ext =
      material.type === 'image_slides' && mergeSlides
        ? '.pdf'
        : material.type === 'pdf' || material.type === 'announcement_attachment'
          ? '.pdf'
          : '.md';
    const baseName = sanitizeSafeDownloadName(material.filename || `${material.title}${ext}`, `material${ext}`);
    const finalName = material.type === 'image_slides' && mergeSlides && !baseName.endsWith('.pdf') ? `${baseName}.pdf` : baseName;
    const body = [
      `# ${material.title}`,
      '',
      `- 课程: ${material.courseName ?? material.courseId}`,
      `- 章节: ${material.chapterTitle ?? '未分章'}`,
      `- 类型: ${MATERIAL_TYPE_LABELS[material.type]}`,
      `- Schema: ${RESOURCE_SCHEMA_VERSION}`,
      '',
      '> 本文件由 Yuketang DDL Helper 演示模式生成，用于验证本地下载与导出工作流。',
    ].join('\n');
    const bytes = encoder.encode(body);
    return {
      filename: finalName,
      mimeType: finalName.endsWith('.md') ? 'text/markdown;charset=utf-8' : 'application/octet-stream',
      bytes,
    };
  };

  return {
    async syncResources(req) {
      if (req.signal?.aborted) throw new DOMException('已取消', 'AbortError');
      if (!req.useDemoMode) {
        return {
          origin: req.platform.origin,
          sourcePlatform: req.platform.label,
          source: 'live',
          syncedAt: new Date().toISOString(),
          courses: (req.existingCourses ?? []).map(c => ({
            id: c.id,
            classroomId: c.classroomId,
            name: c.name,
            teacher: c.teacher,
            term: c.term,
            sourcePlatform: req.platform.label,
            sourceOrigin: req.platform.origin,
            sourceUrl: c.url,
          })),
          materials: [],
          assignments: [],
          exams: [],
          announcements: [],
          diagnostics: [
            {
              endpoint: '/v2/api/web/logs/learn/{classroom_id}',
              scope: 'materials',
              outcome: 'not-found',
              experimental: true,
              durationMs: 0,
              note: '资源核心服务尚未接入当前环境，可开启「演示模式」完整体验课程资源与导出流程',
            },
          ],
          failedCourses: 0,
        };
      }

      req.onProgress?.(1, 3);
      await waitWithSignal(120, req.signal);
      req.onProgress?.(3, 3);
      return createDemoDiscoveryData(req.platform);
    },

    async downloadSingle(req) {
      if (!isMaterialDownloadable(req.material)) {
        return {
          material: req.material,
          status: 'failed',
          errorCode: 'unsupported-format',
          errorMessage: '该资源仅提供已授权原页面链接，无法直接下载文件',
        };
      }
      req.onProgress?.({
        phase: req.material.type === 'image_slides' && req.mergeSlideImagesToPdf ? 'converting-pdf' : 'fetching',
        completed: 0,
        total: 1,
        currentTitle: req.material.title,
        bytesProcessed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });
      await waitWithSignal(200, req.signal);
      const demoFile = buildDemoBytes(req.material, req.mergeSlideImagesToPdf);
      const size = triggerLocalBlobDownload(demoFile.bytes, demoFile.filename, demoFile.mimeType);
      req.onProgress?.({
        phase: 'done',
        completed: 1,
        total: 1,
        currentTitle: req.material.title,
        bytesProcessed: size,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      });
      return {
        material: { ...req.material, downloadStatus: 'downloaded', isNew: false },
        status: 'downloaded',
        filename: demoFile.filename,
        relativePath: demoFile.filename,
        mimeType: demoFile.mimeType,
        size,
      };
    },

    async downloadBatch(req) {
      const items: DownloadItemResult[] = [];
      let succeeded = 0;
      let skipped = 0;
      let failed = 0;
      let totalBytes = 0;
      const total = req.materials.length;

      for (let i = 0; i < total; i++) {
        const material = req.materials[i];
        if (req.options.signal?.aborted) {
          req.options.onProgress?.({
            phase: 'cancelled',
            completed: i,
            total,
            currentTitle: material.title,
            bytesProcessed: totalBytes,
            succeeded,
            failed,
            skipped,
          });
          return { items, succeeded, skipped, failed, cancelled: true, totalBytes };
        }

        if (req.options.skipAlreadyDownloaded && material.downloadStatus === 'downloaded' && !req.options.forceRedownload) {
          skipped++;
          items.push({ material, status: 'skipped', filename: material.filename });
          req.options.onProgress?.({
            phase: 'fetching',
            completed: i + 1,
            total,
            currentTitle: material.title,
            bytesProcessed: totalBytes,
            succeeded,
            failed,
            skipped,
          });
          continue;
        }

        if (!isMaterialDownloadable(material)) {
          failed++;
          items.push({
            material,
            status: 'failed',
            errorCode: 'unsupported-format',
            errorMessage: '该资源仅支持在雨课堂页面查看',
          });
          req.options.onProgress?.({
            phase: 'fetching',
            completed: i + 1,
            total,
            currentTitle: material.title,
            bytesProcessed: totalBytes,
            succeeded,
            failed,
            skipped,
          });
          continue;
        }

        req.options.onProgress?.({
          phase: material.type === 'image_slides' && req.options.mergeSlideImagesToPdf ? 'converting-pdf' : 'fetching',
          completed: i,
          total,
          currentTitle: material.title,
          bytesProcessed: totalBytes,
          succeeded,
          failed,
          skipped,
        });

        try {
          await waitWithSignal(180, req.options.signal);
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') {
            req.options.onProgress?.({
              phase: 'cancelled',
              completed: i,
              total,
              currentTitle: material.title,
              bytesProcessed: totalBytes,
              succeeded,
              failed,
              skipped,
            });
            return { items, succeeded, skipped, failed, cancelled: true, totalBytes };
          }
          throw err;
        }

        const demoFile = buildDemoBytes(material, Boolean(req.options.mergeSlideImagesToPdf));
        const size = triggerLocalBlobDownload(demoFile.bytes, demoFile.filename, demoFile.mimeType);
        succeeded++;
        totalBytes += size;
        items.push({
          material: { ...material, downloadStatus: 'downloaded', isNew: false },
          status: 'downloaded',
          filename: demoFile.filename,
          relativePath: demoFile.filename,
          mimeType: demoFile.mimeType,
          size,
        });
        req.options.onProgress?.({
          phase: 'fetching',
          completed: i + 1,
          total,
          currentTitle: material.title,
          bytesProcessed: totalBytes,
          succeeded,
          failed,
          skipped,
        });
      }

      req.options.onProgress?.({
        phase: 'done',
        completed: total,
        total,
        bytesProcessed: totalBytes,
        succeeded,
        failed,
        skipped,
      });

      return { items, succeeded, skipped, failed, cancelled: false, totalBytes };
    },

    async exportBundle(req) {
      const courseSet = new Set(req.courseIds);
      const selectedCourses = req.discovery.courses.filter(c => courseSet.size === 0 || courseSet.has(c.id));
      const selectedMaterials = req.discovery.materials.filter(m => courseSet.size === 0 || courseSet.has(m.courseId));
      const selectedAssignments = req.discovery.assignments.filter(a => courseSet.size === 0 || courseSet.has(a.courseId));
      const selectedExams = req.discovery.exams.filter(e => courseSet.size === 0 || courseSet.has(e.courseId));
      const selectedAnnouncements = req.discovery.announcements.filter(a => courseSet.size === 0 || courseSet.has(a.courseId));

      req.onProgress?.({
        phase: 'packaging-zip',
        completed: 1,
        total: 2,
        currentTitle: `正在生成 ${EXPORT_MODE_OPTIONS.find(m => m.id === req.mode)?.name ?? req.mode}…`,
        bytesProcessed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });
      await waitWithSignal(220, req.signal);

      const missingItems = selectedMaterials
        .filter(m => !isMaterialDownloadable(m))
        .map(m => ({
          courseId: m.courseId,
          resourceKey: m.resourceKey,
          title: m.title,
          reason: m.type === 'video_meta' ? '视频仅保留元信息与授权页面链接' : '资源不可直接抓取',
        }));

      const includedMaterials = selectedMaterials.filter(isMaterialDownloadable);
      const exportedAt = new Date().toISOString();
      const stamp = exportedAt.slice(0, 10);

      const manifest: ExportManifest = {
        schemaVersion: RESOURCE_SCHEMA_VERSION,
        generator: 'yuketang-ddl-helper',
        generatorVersion: '0.2.0-beta',
        mode: req.mode,
        sourcePlatform: req.discovery.sourcePlatform,
        sourceOrigin: req.discovery.origin,
        exportedAt,
        courses: selectedCourses,
        files: [
          {
            relativePath: req.mode === 'markdown-only' ? 'course_index.md' : 'manifest.json',
            kind: req.mode === 'markdown-only' ? 'markdown' : 'manifest',
            mimeType: req.mode === 'markdown-only' ? 'text/markdown' : 'application/json',
            size: 0,
            status: 'included',
          },
        ],
        missingItems,
        stats: {
          courseCount: selectedCourses.length,
          materialCount: selectedMaterials.length,
          includedMaterialCount: includedMaterials.length,
          assignmentCount: selectedAssignments.length,
          examCount: selectedExams.length,
          announcementCount: selectedAnnouncements.length,
          failedCount: missingItems.length,
        },
      };

      const isMarkdown = req.mode === 'markdown-only';
      const filename = isMarkdown
        ? `yuketang-course-index-${stamp}.md`
        : req.mode === 'json-only'
          ? `yuketang-resources-${stamp}.json`
          : `yuketang-${req.mode}-${stamp}.json`;

      const payload = isMarkdown
        ? [
            `# 雨课堂课程资料索引 (${stamp})`,
            '',
            `- 来源平台：${req.discovery.sourcePlatform}`,
            `- 同步时间：${req.discovery.syncedAt}`,
            `- 覆盖课程：${selectedCourses.length} 门 · 资料：${selectedMaterials.length} 份 · 作业/考试：${selectedAssignments.length + selectedExams.length} 项`,
            '',
            ...selectedCourses.flatMap(c => {
              const mats = selectedMaterials.filter(m => m.courseId === c.id);
              return [
                `## ${c.name}`,
                ...(mats.length
                  ? mats.map(m => `- [${MATERIAL_TYPE_LABELS[m.type]}] ${m.title}${m.chapterTitle ? `（${m.chapterTitle}）` : ''}`)
                  : ['- 暂无已发现资料']),
                '',
              ];
            }),
          ].join('\n')
        : JSON.stringify(
            {
              schemaVersion: RESOURCE_SCHEMA_VERSION,
              manifest,
              courses: selectedCourses,
              materials: selectedMaterials,
              assignments: selectedAssignments,
              exams: selectedExams,
              announcements: selectedAnnouncements,
            },
            null,
            2,
          );

      const bytesLength = triggerLocalBlobDownload(
        payload,
        filename,
        isMarkdown ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
      );
      manifest.files[0].size = bytesLength;

      req.onProgress?.({
        phase: 'done',
        completed: 2,
        total: 2,
        currentTitle: filename,
        bytesProcessed: bytesLength,
        succeeded: includedMaterials.length,
        failed: missingItems.length,
        skipped: 0,
      });

      return { filename, manifest, bytesLength };
    },
  };
}

const DEFAULT_FALLBACK_BACKEND = createFallbackDemoResourceBackend();

export function useResourceCenter(app: DdlAppController, options: UseResourceCenterOptions = {}) {
  const { backend: propBackend, autoSync = true } = options;

  const [discovery, setDiscovery] = useState<ResourceDiscoveryResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters & selection
  const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | MaterialType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 180);
  const [onlyNewOrUndownloaded, setOnlyNewOrUndownloaded] = useState(false);
  const [selectedResourceKeys, setSelectedResourceKeys] = useState<Set<string>>(new Set());

  // Download & export options / states
  const [mergeSlidesToPdf, setMergeSlidesToPdf] = useState(true);
  const [skipDownloaded, setSkipDownloaded] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [busyMode, setBusyMode] = useState<'download' | 'export' | null>(null);
  const [activeMaterialKey, setActiveMaterialKey] = useState<string | null>(null);
  const [lastBatchResult, setLastBatchResult] = useState<DownloadBatchResult | null>(null);
  const [lastExportManifest, setLastExportManifest] = useState<ExportManifest | null>(null);
  const [lastExportFilename, setLastExportFilename] = useState<string | null>(null);
  const [notice, setNotice] = useState<ResourceNotice | null>(null);

  // AI Workflow export selection state (kept here so switching tabs preserves selections)
  const [exportMode, setExportMode] = useState<ExportMode>('knowledge-base');
  const [exportCourseIds, setExportCourseIds] = useState<string[]>([]);

  const syncAbortRef = useRef<AbortController | null>(null);
  const taskAbortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const syncedKeyRef = useRef<string | null>(null);

  const resolveBackend = useCallback((): ResourceCenterBackend => {
    return propBackend ?? registeredBackend ?? DEFAULT_FALLBACK_BACKEND;
  }, [propBackend]);

  const showNotice = useCallback((text: string, tone: 'info' | 'error' = 'info', durationMs = 4000) => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice({ id: Date.now(), text, tone });
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), durationMs);
  }, []);

  const clearNotice = useCallback(() => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice(null);
  }, []);

  const refreshResources = useCallback(
    async (force = false) => {
      syncAbortRef.current?.abort();
      const controller = new AbortController();
      syncAbortRef.current = controller;

      setLoading(true);
      setError(null);
      setSyncProgress({ completed: 0, total: 1 });

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || app.syncResult?.source === 'demo';

      try {
        const result = await backend.syncResources({
          platform: app.platform,
          useDemoMode,
          force,
          existingCourses: app.syncResult?.courses,
          existingHomework: app.effectiveItems,
          signal: controller.signal,
          onProgress: (completed, total) => setSyncProgress({ completed, total }),
        });

        if (controller.signal.aborted) return;

        setDiscovery(result);
        setSelectedResourceKeys(new Set());
        setExportCourseIds(prev => {
          const validIds = new Set(result.courses.map(c => c.id));
          const kept = prev.filter(id => validIds.has(id));
          return kept.length > 0 ? kept : result.courses.map(c => c.id);
        });

        if (backend.getSyncStatus) {
          const status = await backend.getSyncStatus(app.platform, useDemoMode).catch(() => null);
          if (!controller.signal.aborted) setSyncStatus(status);
        } else {
          setSyncStatus({
            origin: result.origin,
            sourcePlatform: result.sourcePlatform,
            lastSyncedAt: result.syncedAt,
            knownMaterials: result.materials.length,
            downloadedMaterials: result.materials.filter(m => m.downloadStatus === 'downloaded').length,
            failedMaterials: result.materials.filter(m => m.downloadStatus === 'failed').length,
          });
        }

        if (result.error) {
          const msg =
            result.error === 'unauthorized'
              ? '未检测到雨课堂登录态，请先登录或切换至演示模式体验资源中心'
              : `课程资源同步遇到问题（${result.error}），可重试或在设置中查看诊断`;
          setError(msg);
        } else if (force) {
          showNotice(
            result.source === 'demo'
              ? `已刷新演示课程资源（共 ${result.materials.length} 份）`
              : `已同步 ${result.courses.length} 门课，发现 ${result.materials.length} 份课程资料`,
          );
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setError((err as Error)?.message || '拉取课程资源失败，请稍后重试');
      } finally {
        if (syncAbortRef.current === controller) {
          setLoading(false);
          setSyncProgress(null);
        }
      }
    },
    [app.effectiveItems, app.platform, app.settings.useDemoMode, app.syncResult, resolveBackend, showNotice],
  );

  // Auto-sync lazily when user opens resources / AI workflow / diagnostics, or when demo mode/origin changes
  useEffect(() => {
    if (!autoSync || !app.isOpen) return;
    const isRelevantView = app.view === 'resources' || app.view === 'prompt' || (app.view === 'settings' && app.advancedOpen);
    if (!isRelevantView) return;

    const effectiveDemo = app.settings.useDemoMode || app.syncResult?.source === 'demo';
    const syncKey = `${app.platform.origin}|${effectiveDemo ? 'demo' : 'live'}`;
    if (syncedKeyRef.current === syncKey && discovery) return;
    syncedKeyRef.current = syncKey;
    void refreshResources(false);
  }, [
    autoSync,
    app.isOpen,
    app.view,
    app.advancedOpen,
    app.platform.origin,
    app.settings.useDemoMode,
    app.syncResult?.source,
    discovery,
    refreshResources,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      syncAbortRef.current?.abort();
      taskAbortRef.current?.abort();
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const courses = discovery?.courses ?? [];
  const materials = discovery?.materials ?? [];
  const assignments = discovery?.assignments ?? [];
  const exams = discovery?.exams ?? [];
  const announcements = discovery?.announcements ?? [];
  const diagnostics = discovery?.diagnostics ?? [];
  const syncedAt = discovery?.syncedAt ?? null;

  // Keep selectedCourseId valid if course list changes
  useEffect(() => {
    if (selectedCourseId !== 'all' && courses.length > 0 && !courses.some(c => c.id === selectedCourseId)) {
      setSelectedCourseId('all');
    }
  }, [courses, selectedCourseId]);

  const filteredMaterials = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return materials.filter(mat => {
      if (selectedCourseId !== 'all' && mat.courseId !== selectedCourseId) return false;
      if (typeFilter !== 'all' && mat.type !== typeFilter) return false;
      if (onlyNewOrUndownloaded) {
        const isPending =
          mat.isNew ||
          mat.downloadStatus === 'not_downloaded' ||
          mat.downloadStatus === 'updated' ||
          mat.downloadStatus === 'failed';
        if (!isPending) return false;
      }
      if (q) {
        const hay = `${mat.courseName ?? ''} ${mat.chapterTitle ?? ''} ${mat.title} ${mat.filename ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [materials, selectedCourseId, typeFilter, onlyNewOrUndownloaded, debouncedSearch]);

  const filteredAnnouncements = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return announcements.filter(ann => {
      if (selectedCourseId !== 'all' && ann.courseId !== selectedCourseId) return false;
      if (q) {
        const hay = `${ann.courseName} ${ann.title} ${ann.content ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [announcements, selectedCourseId, debouncedSearch]);

  const stats = useMemo<ResourceStats>(() => {
    const pool = selectedCourseId === 'all' ? materials : materials.filter(m => m.courseId === selectedCourseId);
    let newCount = 0;
    let updatedCount = 0;
    let downloadedCount = 0;
    let failedCount = 0;
    let unavailableCount = 0;
    let downloadableCount = 0;
    let knownTotalBytes = 0;

    for (const m of pool) {
      if (m.isNew) newCount++;
      if (m.downloadStatus === 'updated') updatedCount++;
      if (m.downloadStatus === 'downloaded') downloadedCount++;
      if (m.downloadStatus === 'failed') failedCount++;
      if (m.downloadStatus === 'unavailable') unavailableCount++;
      if (isMaterialDownloadable(m)) downloadableCount++;
      if (typeof m.size === 'number' && Number.isFinite(m.size) && m.size > 0) {
        knownTotalBytes += m.size;
      }
    }

    return {
      totalCount: pool.length,
      newCount,
      updatedCount,
      downloadedCount,
      failedCount,
      unavailableCount,
      downloadableCount,
      knownTotalBytes,
    };
  }, [materials, selectedCourseId]);

  const selectedMaterials = useMemo(
    () => materials.filter(m => selectedResourceKeys.has(m.resourceKey)),
    [materials, selectedResourceKeys],
  );

  const failedMaterials = useMemo(() => {
    const map = new Map<string, CourseMaterial>();
    for (const m of materials) {
      if (m.downloadStatus === 'failed') map.set(m.resourceKey, m);
    }
    if (lastBatchResult) {
      for (const item of lastBatchResult.items) {
        if (item.status === 'failed' && isMaterialDownloadable(item.material)) {
          map.set(item.material.resourceKey, item.material);
        }
      }
    }
    return [...map.values()];
  }, [materials, lastBatchResult]);

  const applyMaterialUpdates = useCallback((updates: Map<string, Partial<CourseMaterial>>) => {
    if (updates.size === 0) return;
    setDiscovery(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        materials: prev.materials.map(m => {
          const patch = updates.get(m.resourceKey);
          return patch ? { ...m, ...patch } : m;
        }),
      };
    });
  }, []);

  const toggleSelectResource = useCallback((resourceKey: string) => {
    setSelectedResourceKeys(prev => {
      const next = new Set(prev);
      if (next.has(resourceKey)) next.delete(resourceKey);
      else next.add(resourceKey);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedResourceKeys(new Set(filteredMaterials.filter(isMaterialDownloadable).map(m => m.resourceKey)));
  }, [filteredMaterials]);

  const clearSelection = useCallback(() => {
    setSelectedResourceKeys(new Set());
  }, []);

  const cancelActiveTask = useCallback(() => {
    if (taskAbortRef.current) {
      taskAbortRef.current.abort();
      taskAbortRef.current = null;
      showNotice('已请求取消当前任务');
    }
  }, [showNotice]);

  const downloadSingle = useCallback(
    async (material: CourseMaterial) => {
      if (busyMode) return;
      if (!isMaterialDownloadable(material)) {
        showNotice('该资源不支持直接下载，请点击右侧链接在雨课堂打开', 'error');
        return;
      }

      const controller = new AbortController();
      taskAbortRef.current = controller;
      setBusyMode('download');
      setActiveMaterialKey(material.resourceKey);
      applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'downloading' }]]));

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || discovery?.source === 'demo';

      try {
        const res = await backend.downloadSingle({
          material,
          useDemoMode,
          mergeSlideImagesToPdf: mergeSlidesToPdf,
          forceRedownload: material.downloadStatus === 'downloaded',
          signal: controller.signal,
          onProgress: p => setDownloadProgress(p),
        });

        if (res.status === 'downloaded') {
          applyMaterialUpdates(
            new Map([
              [
                material.resourceKey,
                {
                  downloadStatus: 'downloaded',
                  isNew: false,
                  size: res.size ?? material.size,
                  checksum: res.checksum ?? material.checksum,
                  localPath: res.relativePath ?? material.localPath,
                },
              ],
            ]),
          );
          showNotice(`已下载「${res.filename ?? material.title}」`);
        } else if (res.status === 'skipped') {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'downloaded' }]]));
          showNotice(`已跳过已下载文件「${material.title}」`);
        } else {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'failed' }]]));
          showNotice(res.errorMessage || `下载「${material.title}」失败`, 'error', 5000);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: material.downloadStatus }]]));
          showNotice('已取消下载');
        } else {
          applyMaterialUpdates(new Map([[material.resourceKey, { downloadStatus: 'failed' }]]));
          showNotice((err as Error)?.message || `下载「${material.title}」失败`, 'error', 5000);
        }
      } finally {
        if (taskAbortRef.current === controller) taskAbortRef.current = null;
        setBusyMode(null);
        setActiveMaterialKey(null);
        setDownloadProgress(null);
      }
    },
    [app.settings.useDemoMode, applyMaterialUpdates, busyMode, discovery?.source, mergeSlidesToPdf, resolveBackend, showNotice],
  );

  const runBatchDownload = useCallback(
    async (targets: CourseMaterial[], forceRedownload = false) => {
      if (busyMode) return;
      if (targets.length === 0) {
        showNotice('没有可下载的课程资源', 'error');
        return;
      }

      const controller = new AbortController();
      taskAbortRef.current = controller;
      setBusyMode('download');
      setLastBatchResult(null);
      setDownloadProgress({
        phase: 'fetching',
        completed: 0,
        total: targets.length,
        currentTitle: targets[0]?.title,
        bytesProcessed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || discovery?.source === 'demo';

      try {
        const result = await backend.downloadBatch({
          materials: targets,
          useDemoMode,
          options: {
            mergeSlideImagesToPdf: mergeSlidesToPdf,
            skipAlreadyDownloaded: forceRedownload ? false : skipDownloaded,
            forceRedownload,
            signal: controller.signal,
            onProgress: p => setDownloadProgress(p),
          },
        });

        const updates = new Map<string, Partial<CourseMaterial>>();
        for (const item of result.items) {
          if (item.status === 'downloaded') {
            updates.set(item.material.resourceKey, {
              downloadStatus: 'downloaded',
              isNew: false,
              size: item.size ?? item.material.size,
              checksum: item.checksum ?? item.material.checksum,
              localPath: item.relativePath ?? item.material.localPath,
            });
          } else if (item.status === 'failed') {
            updates.set(item.material.resourceKey, { downloadStatus: 'failed' });
          }
        }
        applyMaterialUpdates(updates);
        setLastBatchResult(result);

        if (result.cancelled) {
          showNotice(`批量下载已取消（已完成 ${result.succeeded} 份，跳过 ${result.skipped} 份）`);
        } else if (result.failed > 0) {
          showNotice(
            `批量下载完成：成功 ${result.succeeded}，跳过 ${result.skipped}，失败 ${result.failed}`,
            'error',
            5000,
          );
        } else {
          showNotice(`批量下载完成：成功 ${result.succeeded} 份${result.skipped > 0 ? `，跳过已下载 ${result.skipped} 份` : ''}`);
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          showNotice('已取消批量下载');
        } else {
          showNotice((err as Error)?.message || '批量下载失败，请稍后重试', 'error', 5000);
        }
      } finally {
        if (taskAbortRef.current === controller) taskAbortRef.current = null;
        setBusyMode(null);
        setDownloadProgress(null);
      }
    },
    [
      app.settings.useDemoMode,
      applyMaterialUpdates,
      busyMode,
      discovery?.source,
      mergeSlidesToPdf,
      resolveBackend,
      showNotice,
      skipDownloaded,
    ],
  );

  const downloadSelected = useCallback(async () => {
    const targets =
      selectedMaterials.length > 0
        ? selectedMaterials
        : filteredMaterials.filter(isMaterialDownloadable);
    await runBatchDownload(targets, false);
  }, [filteredMaterials, runBatchDownload, selectedMaterials]);

  const retryFailed = useCallback(async () => {
    if (failedMaterials.length === 0) return;
    await runBatchDownload(failedMaterials, true);
  }, [failedMaterials, runBatchDownload]);

  const exportBundle = useCallback(
    async (modeOverride?: ExportMode, courseIdsOverride?: string[]): Promise<ExportManifest | null> => {
      if (busyMode) return null;
      if (!discovery) {
        showNotice('请先同步课程资源后再导出', 'error');
        return null;
      }

      const targetMode = modeOverride ?? exportMode;
      const targetCourseIds =
        courseIdsOverride ?? (exportCourseIds.length > 0 ? exportCourseIds : courses.map(c => c.id));

      if (targetCourseIds.length === 0) {
        showNotice('请至少选择 1 门课程进行导出', 'error');
        return null;
      }

      const controller = new AbortController();
      taskAbortRef.current = controller;
      setBusyMode('export');
      setDownloadProgress({
        phase: 'packaging-zip',
        completed: 0,
        total: Math.max(1, targetCourseIds.length),
        currentTitle: '正在整理课程结构与资料…',
        bytesProcessed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });

      const backend = resolveBackend();
      const useDemoMode = app.settings.useDemoMode || discovery.source === 'demo';

      try {
        const res = await backend.exportBundle({
          mode: targetMode,
          courseIds: targetCourseIds,
          discovery,
          useDemoMode,
          mergeSlideImagesToPdf: mergeSlidesToPdf,
          includeAssignments: true,
          includeAnnouncements: true,
          signal: controller.signal,
          onProgress: p => setDownloadProgress(p),
        });

        setLastExportManifest(res.manifest);
        setLastExportFilename(res.filename);
        const missingTip =
          res.manifest.missingItems.length > 0
            ? `（含 ${res.manifest.missingItems.length} 项仅链接/缺失提醒，已写入 manifest）`
            : '';
        showNotice(`已导出「${res.filename}」${missingTip}`, 'info', 4800);
        return res.manifest;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          showNotice('已取消资料包导出');
        } else {
          showNotice((err as Error)?.message || '导出资料包失败，请稍后重试', 'error', 5000);
        }
        return null;
      } finally {
        if (taskAbortRef.current === controller) taskAbortRef.current = null;
        setBusyMode(null);
        setDownloadProgress(null);
      }
    },
    [
      app.settings.useDemoMode,
      busyMode,
      courses,
      discovery,
      exportCourseIds,
      exportMode,
      mergeSlidesToPdf,
      resolveBackend,
      showNotice,
    ],
  );

  const toggleExportCourse = useCallback((courseId: string) => {
    setExportCourseIds(prev => (prev.includes(courseId) ? prev.filter(id => id !== courseId) : [...prev, courseId]));
  }, []);

  const selectAllExportCourses = useCallback(() => {
    setExportCourseIds(courses.map(c => c.id));
  }, [courses]);

  const clearExportCourses = useCallback(() => {
    setExportCourseIds([]);
  }, []);

  const clearLastBatchResult = useCallback(() => {
    setLastBatchResult(null);
  }, []);

  return {
    discovery,
    courses,
    materials,
    assignments,
    exams,
    announcements,
    diagnostics,
    syncedAt,
    syncStatus,
    loading,
    syncProgress,
    error,

    selectedCourseId,
    setSelectedCourseId,
    typeFilter,
    setTypeFilter,
    searchQuery,
    setSearchQuery,
    onlyNewOrUndownloaded,
    setOnlyNewOrUndownloaded,

    selectedResourceKeys,
    selectedMaterials,
    toggleSelectResource,
    selectAllVisible,
    clearSelection,

    mergeSlidesToPdf,
    setMergeSlidesToPdf,
    skipDownloaded,
    setSkipDownloaded,

    downloadProgress,
    busyMode,
    activeMaterialKey,
    lastBatchResult,
    clearLastBatchResult,
    lastExportManifest,
    lastExportFilename,
    notice,
    clearNotice,

    exportMode,
    setExportMode,
    exportCourseIds,
    toggleExportCourse,
    selectAllExportCourses,
    clearExportCourses,

    filteredMaterials,
    filteredAnnouncements,
    stats,
    failedMaterials,

    refreshResources,
    downloadSingle,
    downloadSelected,
    retryFailed,
    cancelActiveTask,
    exportBundle,
  };
}

export type ResourceCenterController = ReturnType<typeof useResourceCenter>;
