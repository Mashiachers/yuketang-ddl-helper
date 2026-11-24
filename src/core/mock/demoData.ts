import type { CourseInfo, HomeworkItem, HomeworkType } from '../../types';
import { compareByDeadline, HOUR_MS } from '../utils/time';

export function createDemoData(now = Date.now(), origin = 'https://www.yuketang.cn'): { courses: CourseInfo[]; items: HomeworkItem[] } {
  const courses = ['数字信号处理', '计算机组成原理', '概率论与数理统计', '操作系统', '工程伦理'].map((name, index) => ({
    id: `demo-${index + 1}`, name, classroomId: `demo-class-${index + 1}`,
  }));
  const tasks: [number, string, HomeworkType, number | null, string, boolean?, number?][] = [
    [0, '离散傅里叶变换实验报告', 'homework', 2.5, '整理三种 DFT 实现的输出并分析误差。'],
    [1, '流水线与数据冒险测验', 'quiz', 16, '复习前递、停顿与分支冲刷。'],
    [2, '条件概率与随机变量习题', 'homework', 48, '提交推导过程与数值结果。'],
    [3, '进程调度与同步期中考试', 'exam', 108, '覆盖调度策略、信号量与死锁。'],
    [4, '工程责任案例分析', 'homework', 60, '提交 800 字案例分析。', true],
    [3, '内存管理课后练习', 'quiz', -13, '练习页表转换及缺页处理。'],
    [4, '课程论文选题公告', 'announcement', 150, '查看选题范围与提交要求。'],
    [0, 'DSPch6 课后综合测验', 'exam', null, '共 3 道大题、5 道习题，不限时（老师暂未设置截止时间）。', false, -4],
  ];
  const items = tasks.map(([index, title, type, hours, summary, submitted, startOffsetHours], i): HomeworkItem => {
    const course = courses[index];
    const deadline = hours === null ? null : now + hours * HOUR_MS;
    return {
      id: `demo-task-${i + 1}`, courseId: course.id, courseName: course.name,
      classroomId: course.classroomId, title, type, deadline,
      startTime: startOffsetHours !== undefined ? now + startOffsetHours * HOUR_MS : undefined,
      status: submitted ? 'submitted' : deadline !== null && deadline <= now ? 'expired' : 'pending',
      url: new URL('/', origin).href, summary,
    };
  });
  return { courses, items: items.sort(compareByDeadline) };
}
