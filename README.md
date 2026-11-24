# 雨课堂 DDL 助手（Yuketang DDL Helper）

**An open-source, local-first, AI-ready connector for Yuketang.**

一款开源、纯本地、零外部服务器依赖的 Chrome / Edge Manifest V3 浏览器插件。帮助你一站式聚合雨课堂全课程待办作业与课程资源，打通 **RFC 5545 多级提醒日历（`.ics`）**、**课程知识库 / NotebookLM / AI Context Pack 导出** 与 **结构化 AI Prompt 工作流**。

> **当前版本**：`v0.2.0-beta`（Resource Export & AI-Ready Data Foundation）。截至 2026-11-25，已在**长江雨课堂**实测 7 个接口，涵盖课程、学习日志、章节进度、课件和公告，并完成 104 页图片课件的 PDF 合并。

---

## 核心功能

### 1. 全课程 DDL 聚合看板（v0.1 完整保留）
- **多分支探测 & Shadow DOM 样式隔离**：自动复用当前同源登录态，页面右下角可拖拽悬浮胶囊实时显示 24h 高危预警数与最近 DDL 倒计时。
- **截止待定 & 个人目标 DDL**：保留老师暂未设截止时间的作业/考试，支持设置个人目标 DDL 并参与日历导出；老师后续补设时自动切换并提示。
- **历史旧任务过滤**：默认屏蔽逾期或发布超过 100 天的陈旧记录（可在设置调整或关闭）。
- **RFC 5545 多级提醒日历（`.ics`）**：默认三级闹钟（`-P3D` / `-P1D` / `-PT3H`），稳定 `UID` 去重，重复导入 Google / Apple 日历自动更新不重复。

### 2. 课程资源中心（v0.2 新增）
- **统一资源发现**：分页扫描学习日志并尝试发现章节结构、课件（PDF / PPT / 图片幻灯片）、课程文档、附件与课程公告（未实盘验证端点均显式标注 `实验接口`）。
- **单文件与批量下载**：支持按课程/类型筛选、搜索、实时进度显示、随时取消与失败重试；多文件批量下载自动打包为安全 ZIP。
- **图片课件无损合并 PDF**：纯 TypeScript PDF 1.4 引擎，按原始幻灯片页序直接嵌入原图 JPEG（零依赖、不降低清晰度）。
- **安全命名与增量索引**：跨平台中文安全文件名、路径穿越防护、Windows 保留设备名防护、可执行/脚本后缀惰性化（`.download`），并通过本地 `SHA-256` 索引实现新增标记、变更提示与跳过已下载。
- **换账号时清理索引**：打开「设置 → 高级与诊断 → 课程资源索引与接口诊断」，点击「清空资源索引」。此操作清除当前站点及当前模式的本地索引和下载记录，已保存的文件会保留。

### 3. AI 工作流中心（v0.2 新增）
选择课程 → 选择导出模式 → 下载资料包 → 交给任意大模型 / NotebookLM / Obsidian / AI Agent：
- **完整课程知识库（`.zip`）**：标准分层目录（`manifest.json`、`README.md`、`course.json`、`materials.json`、`assignments.json`、`assignments.md`、`deadlines.ics` 及按真实内容生成的资料目录）。
- **NotebookLM 资料包（`.zip`）**：扁平化章节命名，优先提供可直接导入的 PDF 与 Markdown 文件，避免重复。
- **AI Context Pack（`.zip`）**：轻量纯文本/JSON 包（`course_overview.md`、`upcoming_deadlines.md`、`material_index.md`、`context.json`、`study_prompt.md`），内置提示词注入防护与学术诚信边界。
- **结构化 JSON / 课程索引 Markdown**：单文件导出，Schema 版本 `0.2.0`。
- **快捷 Prompt 复制**：完整保留 v0.1 全部提示词预设、空闲时段备注与自定义模板。

---

## 雨课堂分支兼容性状态

| 雨课堂分支 | 域名 | 课程与作业 DDL | 课程资源发现（章节/幻灯片/公告） |
| :--- | :--- | :--- | :--- |
| 长江雨课堂 | `changjiang.yuketang.cn` | 已实盘验证 | 已实测章节进度、课次摘要、幻灯片明细及公告 |
| 雨课堂主站 | `www.yuketang.cn` | 兼容探测（待实测） | `experimental`（欢迎内测反馈） |
| 荷塘雨课堂 | `pro.yuketang.cn` | 兼容探测（待实测） | `experimental`（欢迎内测反馈） |
| 黄河雨课堂 | `huanghe.yuketang.cn` | 兼容探测（待实测） | `experimental`（欢迎内测反馈） |
| 其他高校定制分支 | `*.yuketang.cn` | 兼容探测（待实测） | `experimental`（欢迎提 Issue 附脱敏样本） |

长江雨课堂已实测 `courses-v2-list`、`classroom-detail-v2`、`learn-logs-v2`、`course-progress-c27`、`lesson-summary-v3`、`lesson-presentation-v3` 与 `discussion-announcements-v2`。实测中，`yangtse-pri-ups.yuketang.cn` 通过 CORS 返回 `200 OK` 和 JPEG 原图。

`courses-mooc-user`、`course-chapter-mooc`、`courseware-pub-news`、`leaf-info-mooc`、`cards-detlist-v2` 和 `course-homework-v2` 仍标记为 `experimental: true`。其中 MOOC 章节接口在长江雨课堂返回 HTTP 400。详见 [API_RESEARCH.md](docs/agent-workflow/reports/API_RESEARCH.md)。

---

## 安装与使用（Chrome / Edge）

### 方式一：直接下载 Release 安装包（推荐，无需 Node 环境）
1. 前往 **Releases** 下载 `yuketang-ddl-helper-v0.2.0-beta.zip` 并解压到固定目录。
2. 浏览器打开 `chrome://extensions/`（Edge 为 `edge://extensions/`），开启右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择解压后的目录（目录内应直接包含 `manifest.json`）。
4. 登录任意雨课堂页面即可在右下角看到悬浮入口；未登录时也可在「设置」中开启 **演示模式** 完整体验 DDL、课件合并 PDF 与 5 种 AI 导出模式。

### 方式二：从源码构建
```bash
npm install
npm run typecheck
npm test
npm run build
npm run package   # 输出 release/yuketang-ddl-helper-v0.2.0-beta.zip
```

---

## 文档导航

- [课程资源导出与 AI 工作流使用指南](docs/RESOURCE_EXPORT_GUIDE.md)
- [JSON Schema (`0.2.0`) 与未来 MCP Server 接入指南](docs/JSON_SCHEMA.md)
- [架构设计文档](docs/agent-workflow/ARCHITECTURE.md) & [架构决策记录（ADRs）](docs/agent-workflow/DECISIONS.md)
- [雨课堂接口调研报告](docs/agent-workflow/reports/API_RESEARCH.md)
- [测试计划](docs/agent-workflow/reports/TEST_PLAN.md) & [安全与隐私审查报告](docs/agent-workflow/reports/SECURITY_REVIEW.md)
- [变更日志 CHANGELOG](CHANGELOG.md)

---

## 路线图（Roadmap）

- **v0.1**：全课程 DDL 聚合看板 + 截止待定/个人目标 DDL + RFC 5545 `.ics` + 快捷 Prompt 打包。
- **v0.2（当前）**：统一课程资源数据模型（`schemaVersion: 0.2.0`）+ 资源发现与批量下载 + 图片课件合 PDF + AI-Ready 知识库 / NotebookLM / AI Context Pack 导出 + 本地 SHA-256 增量索引 + MCP-ready 领域服务解耦。
- **v0.3（规划中）**：独立 **MCP Server & CLI**（直接复用 `src/core/resources/` 的 `CourseProvider` 与导出引擎，对接 Claude Code / Cursor / Antigravity / 个人 Agent 工作流）。

---

## 隐私与合规声明

- **100% 纯本地运行 & 权限最小化**：仅申请 `storage`、`clipboardWrite` 与 `https://*.yuketang.cn/*` 权限；不连接任何开发者服务器，不上传账号、Cookie、Token 或课程文件。
- **严格只读边界**：仅读取当前已登录学生本人正常授权可访问的课程与资料元数据，**绝不包含任何自动签到、自动刷课、自动答题、自动提交或绕过 DRM/下载限制的功能**。
- **脱敏导出**：所有导出 JSON / Markdown / ICS 与接口诊断均自动过滤凭据、签名参数与标注学号，不执行课程内容中的原始 HTML 或提示词指令。

## License

[MIT](./LICENSE)
