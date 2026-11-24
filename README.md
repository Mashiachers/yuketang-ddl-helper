# 雨课堂 DDL 助手（Yuketang DDL Helper）

一款开源、纯本地、零外部服务器依赖的 Chrome / Edge Manifest V3 浏览器插件。帮助你一站式聚合雨课堂全课程待办作业与考试，打通 **RFC 5545 多级提醒日历导出（`.ics`）** 与 **AI 学习规划 / 解题框架 Prompt 工作流**。

> **当前状态**：`v0.1.0-beta` 预览内测中。已在**长江雨课堂**实测可用，欢迎使用主站、荷塘、黄河及各高校分支的同学体验反馈。

---

## 核心特性

- **全课程 DDL 聚合看板（Shadow DOM 样式隔离）**
  - 自动探测并复用当前同源登录态，页面右下角可拖拽悬浮胶囊实时展示 24h 高危预警数与最近 DDL 倒计时。
  - 支持按紧急度 / 课程分组、关键词搜索、浅色/深色外观切换，以及本地「已处理」「隐藏」状态覆盖。
  - **无截止时间任务（截止待定）专门适配**：自动保留老师暂未设截止时间的作业/考试，支持设置**个人目标 DDL**（可参与倒计时与 `.ics` 导出），若老师后续补设正式截止时间会自动切换并高亮提醒。
  - **历史旧任务自动过滤**：默认自动屏蔽逾期或发布超过 100 天的往年旧记录（可在设置中自由调整天数或设为 `0` 关闭）。
- **一键导出多级提醒日历（`.ics`）**
  - 严格遵循 RFC 5545（CRLF 换行、UTF-8 安全的 75 字节行折叠、UTC 时间格式）。
  - 默认内置三级闹钟（提前 3 天 `-P3D`、提前 24 小时 `-P1D`、截止前 3 小时 `-PT3H`），支持在设置中独立开关。
  - 使用稳定去重 `UID`（`ykt-{courseId}-{id}@ddl-helper`），每周重复导出导入 Google Calendar / Apple 日历自动更新覆盖，不产生重复日程。
- **一键打包结构化 Prompt 给 AI**
  - 无需配置 API Key，内置「本周全盘规划」「48h 冲刺急救」「极简执行清单」及自定义模板（支持 `{{now}}`、`{{tasks}}`、`{{freeTimeNotes}}` 变量）。
  - 支持填写个人本周空闲时段，复制后可直接交给 ChatGPT / Gemini / DeepSeek / Claude 等任意大模型生成排期与大作业框架。
- **演示模式 & 脱敏接口诊断**
  - 内置高仿真演示数据，未登录雨课堂也可直接体验全部交互。
  - 内置脱敏接口探测诊断表、勾选任务「复制状态字段样本」及手动粘贴 JSON 兜底解析，方便快速排查高校分支差异。

---

## 分支兼容性状态

| 雨课堂分支 | 域名 | 当前状态 |
| :--- | :--- | :--- |
| 长江雨课堂 | `changjiang.yuketang.cn` | 已实测验证 |
| 雨课堂主站 | `www.yuketang.cn` | 兼容探测（欢迎内测反馈） |
| 荷塘雨课堂 | `pro.yuketang.cn` | 兼容探测（欢迎内测反馈） |
| 黄河雨课堂 | `huanghe.yuketang.cn` | 兼容探测（欢迎内测反馈） |
| 其他高校分支 | `*.yuketang.cn` | 兼容探测（欢迎提 Issue 附脱敏样本） |

---

## 安装与使用（Chrome / Edge）

### 方式一：直接下载 Release 安装包（推荐，无需 Node 环境）
1. 前往本仓库右侧 **Releases** 页面，下载最新版的 `yuketang-ddl-helper-v*.zip` 并解压到一个固定文件夹（例如 `Documents/yuketang-ddl-helper`）。
2. 在 Chrome 地址栏打开 `chrome://extensions/`（Edge 打开 `edge://extensions/`）。
3. 开启右上角 **开发者模式（Developer mode）**。
4. 点击 **加载已解压的扩展程序（Load unpacked）**，选择刚刚解压出来的文件夹（目录内应直接包含 `manifest.json`）。
5. 打开并登录你的雨课堂页面（如 `https://changjiang.yuketang.cn`），即可在右下角看到悬浮入口。

### 方式二：从源码本地构建（适合开发者）
```bash
npm install
npm run build
```
随后按方式一的第 2–5 步加载本项目的 `dist/` 目录即可。若需打包可直接分享的 `.zip` 发布包：
```bash
npm run package
# 输出至 release/yuketang-ddl-helper-v0.1.0.zip
```

---

## 遇到适配问题如何反馈？

不同学校的雨课堂接口字段可能存在细微差异。若遇到「已提交仍显示未交」「非作业条目误入看板」或同步异常：
1. 在看板中**勾选出问题的 1–3 条任务**。
2. 切到右上角「设置」→ 展开「高级与诊断」→ 点击 **「复制状态字段样本」**（仅含脱敏后的状态码、类型和路由模板，不含 Cookie、学号或课程真实 ID）。
3. 在 GitHub 提交 [分支适配 Issue](.github/ISSUE_TEMPLATE/branch-compat.md) 并粘贴样本即可。

---

## 本地开发与验证

```bash
# 启动本地沙盒预览（模拟雨课堂页面 + Shadow DOM 注入 + 演示数据）
npm run dev

# 类型检查
npm run typecheck

# 运行全部单元测试
npm test

# 构建生产扩展包至 dist/
npm run build

# 构建并打包发布用 zip 至 release/
npm run package
```

---

## 路线图（Roadmap）

- **v0.1（当前）**：只读 DDL 聚合看板 + 截止待定/个人目标 DDL + RFC 5545 多级提醒 `.ics` + 结构化 AI Prompt 打包 + 脱敏诊断。
- **v0.2（规划中）**：一键直达 ChatGPT / Gemini / DeepSeek 网页端 + BYOK（本地自带 DeepSeek / OpenAI 兼容 API Key）侧边栏直出周计划与复习框架。
- **v0.3（规划中）**：本地只读数据桥 / MCP Server，支持对接编程 Agent 与自动化学习工作流（Notion / Obsidian / 每日 DDL 提醒）。

---

## 隐私与合规声明

- **100% 纯本地运行**：不连接任何开发者服务器，不收集、上传或存储你的雨课堂账号、Cookie、Token 或课程内容。
- **严格只读边界**：仅读取当前已登录学生本人可见的课程与作业元数据，**绝不包含任何自动刷课、自动答题、自动提交或代签到功能**。

## License

[MIT](./LICENSE)
