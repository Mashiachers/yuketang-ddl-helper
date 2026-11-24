import { useState } from 'react';
import { ContentApp } from '../ui/components/ContentApp';

const SIMULATED_PLATFORMS = [
  { origin: 'https://www.yuketang.cn', label: '雨课堂主站 (www.yuketang.cn)' },
  { origin: 'https://changjiang.yuketang.cn', label: '长江雨课堂 (changjiang.yuketang.cn)' },
  { origin: 'https://pro.yuketang.cn', label: '荷塘雨课堂 (pro.yuketang.cn)' },
  { origin: 'https://huanghe.yuketang.cn', label: '黄河雨课堂 (huanghe.yuketang.cn)' },
];

const MOCK_COURSES = [
  { name: '数字信号处理', teacher: '张教授', term: '2026 秋', gradient: 'linear-gradient(135deg, #1d4ed8, #3b82f6)' },
  { name: '计算机组成原理', teacher: '李老师', term: '2026 秋', gradient: 'linear-gradient(135deg, #0f766e, #14b8a6)' },
  { name: '概率论与数理统计', teacher: '王老师', term: '2026 秋', gradient: 'linear-gradient(135deg, #4338ca, #6366f1)' },
  { name: '操作系统', teacher: '陈教授', term: '2026 秋', gradient: 'linear-gradient(135deg, #b45309, #f59e0b)' },
  { name: '工程伦理', teacher: '周老师', term: '2026 秋', gradient: 'linear-gradient(135deg, #475569, #64748b)' },
];

export function PreviewApp() {
  const [origin, setOrigin] = useState(SIMULATED_PLATFORMS[0].origin);

  return (
    <>
      <div className="sandbox-bar">
        <div className="sandbox-bar-left">
          <span className="sandbox-pill">本地沙盒预览</span>
          <span>当前正在使用 Shadow DOM 完整模拟雨课堂宿主页面注入效果</span>
        </div>
        <div className="sandbox-controls">
          <label htmlFor="platform-select">模拟分支：</label>
          <select
            id="platform-select"
            className="sandbox-select"
            value={origin}
            onChange={e => setOrigin(e.target.value)}
          >
            {SIMULATED_PLATFORMS.map(p => (
              <option key={p.origin} value={p.origin}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <header className="mock-ykt-header">
        <div className="mock-ykt-logo">雨课堂 · 模拟课程主页</div>
        <nav className="mock-ykt-nav">
          <span className="active">我听的课</span>
          <span>我教的课</span>
          <span>课程日志</span>
        </nav>
      </header>

      <main className="mock-ykt-main">
        <h1 className="mock-ykt-heading">当前学期课程</h1>
        <p className="mock-ykt-sub">
          插件已通过 Shadow DOM 挂载在右侧，点击关闭抽屉可体验右下角可拖拽悬浮胶囊入口。
        </p>

        <div className="mock-course-grid">
          {MOCK_COURSES.map(course => (
            <div key={course.name} className="mock-course-card">
              <div className="mock-course-cover" style={{ background: course.gradient }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{course.name}</div>
              </div>
              <div className="mock-course-body">
                <span>主讲：{course.teacher}</span>
                <span>{course.term}</span>
              </div>
            </div>
          ))}
        </div>
      </main>

      <ContentApp
        key={origin}
        useShadowDom
        defaultDemoMode
        defaultOpen
        originOverride={origin}
      />
    </>
  );
}
