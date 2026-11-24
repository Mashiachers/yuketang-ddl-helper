# Independent Final Review & Red-Team Audit (`v0.2.0-beta`)

- **Reviewer**: Agent E (Independent Reviewer / Red Team)
- **Target Repo & Commit**: `W:\yuketang` · branch `develop/v0.2-resource-export` · commit `e749b55`
- **Review Date**: 2026-11-24
- **Baseline Checks (Read-Only Verified)**: `npm run typecheck` 通过（0 errors）；`npm test` 全部通过（3 个测试文件，82 tests：v0.1 `core.test.ts` 22/22、`resource-adapter.test.ts` 25/25、`resource-export.test.ts` 35/35）。
- **Overall Verdict**: **Needs Stage 5 Triage Before Release（存在 4 项 P0 阻断项与 8 项 P1 高优先级缺陷）**。核心领域层（`zip.ts` / `naming.ts` / `exportService.ts` / `adapter.ts`）的基础安全边界与零依赖实现质量较高，但在 **UI ↔ Backend 集成层**（`resourceBackend.ts`、`useResourceCenter.ts`）、**演示模式残留死代码**、**多班级课程 ID 碰撞** 以及 **发布元数据版本** 上存在明确可复现的真实故障。

---

## 1. Executive Summary（分级总览）

| 严重级别 | 数量 | 核心问题摘要 |
| :--- | :---: | :--- |
| **P0 (Release Blocker)** | 4 | `exportBundle` 把 `video_meta`/`unavailable` 写入 `failed` 导致无限重试循环；同课多班级 `course.id` 碰撞致 ZIP 导出崩溃；`package.json` / `manifest.json` 仍停留在 `0.1.0`；`resourceBackend.ts` 每次同步都重建 `ResourceService` 导致队列与增量快照彻底失效 |
| **P1 (High)** | 8 | `useResourceCenter.ts` 残留 703 行死代码且违背契约的 Fallback Demo Backend；取消下载被标为 `failed`；`autoSync` 依赖每 30 秒变动的 `effectiveItems` 导致慢同步/出错时无限中止重试；`exportBundle` 不回写 UI 状态且 `downloadSingle`/`downloadBatch` 猜测 `origin`；`URL.parse()` 破坏 Node 20 LTS 与旧版 Chromium；`pdf.ts` 误信任 MIME 跳过 PNG/WebP 转换；`adapter.ts` 实验接口漏标与多 PPT 截断；`indexStore.ts` 键名与状态机脆弱 |
| **P2 (Medium)** | 6 | 实时同步覆盖 v0.1 `LocalOverrides`（自定义 DDL/已划掉）；COS/AWS 签名 URL 参数脱敏漏网与 v0.1 Prompt 缺少防注入边界；Content Script 跨子域 CORS 与 `no-referrer` 防盗链风险；`indexStore` 并发读写竞态；UI/UX 摩擦（`AiWorkflowPanel` 展示 `0/6`、4-Tab 宽度、Windows 深色 `<select>` 白底白字）；Node MCP Server 接入摩擦 |
| **P3 (Low / Polish)** | 4 | `endpoints.ts` 死代码与未引用端点规格；`demoResources.ts` 与 `ARCHITECTURE.md` 轻微契约漂移；`pdf.ts` 未接受 SOF1 JPEG；部分课程失败无提示及导出后 AI 引导缺失 |

---

## 2. Detailed Findings（按优先级详述）

### P0 — Release Blockers（发布前必须修复）

#### [P0-1] `exportBundle` 将 `unavailable` / `video_meta` 传给 `downloadBatch` 并持久化为 `failed`，污染索引并制造无限重试死循环
- **位置**:
  - `src/ui/adapters/resourceBackend.ts:193-209`
  - `src/core/resources/downloadService.ts:246-248`
  - `src/core/resources/indexStore.ts:78,115`
  - `src/ui/hooks/useResourceCenter.ts:1157-1161`
- **具体复现场景（Demo 模式一键必现）**:
  1. 开启演示模式，点击「AI 工作流 → 一键导出完整课程知识库」（或在资源中心点击「导出全部」）。
  2. `resourceBackend.ts:193-195` 仅按 `courseId` 过滤，将不可下载的 `demo-systems:video_meta:lecture`（`downloadStatus: 'unavailable'`）一并传入 `downloader.downloadBatch(selectedMaterials, { forceRedownload: true })`。
  3. `downloadService.ts:246-248` 抛出 `DownloadError('unsupported-format')`，返回 `{ status: 'failed', errorCode: 'unsupported-format' }`；同时 `exportService.ts:344` 将 `manifest.stats.failedCount` 计为 `1`（即使整个导出并无任何真实下载失败）。
  4. `resourceBackend.ts:209` 对全量 `batch.items` 调用 `persistOutcomes`，`indexStore.ts:115` 将该 `video_meta` 记录持久化为 `status: 'failed'`！
  5. 下次刷新同步时，`reconcileMaterialsWithIndex`（`indexStore.ts:78`）把 `video_meta` 的 `downloadStatus` 从 `'unavailable'` 覆盖为 `'failed'`。
  6. `useResourceCenter.ts:1159-1161` 收集 `failedMaterials` 时未校验 `isMaterialDownloadable(m)`，导致 UI 显示「失败 1 份」并出现「重试 (1)」按钮；用户每次点击重试都会 100% 失败并递增 `retryCount`，陷入死循环。
- **修复建议**:
  1. 在 `resourceBackend.ts:193` 中，仅对真正可下载的资料调用 `downloadBatch`（排除 `downloadStatus === 'unavailable'`、`type === 'video_meta'`、既无 `downloadUrl` 也无 `slideImages` 的条目；并在 `mode === 'notebooklm'` 时预先跳过 `notebookExt` 不支持的格式，避免白白下载 `.pptx`/`.zip` 后再被 `exportService` 丢弃）。
  2. 在 `indexStore.ts:94` 中，对原本 `material.downloadStatus === 'unavailable'` 或 `material.type === 'video_meta'` 的条目不写入 `failed` 记录。
  3. 在 `useResourceCenter.ts:1160` 增加 `&& isMaterialDownloadable(m)` 保护。

---

#### [P0-2] 同课程多班级（相同 `course.id`、不同 `classroomId`）导致 ZIP 导出抛出 `Conflicting ZIP path` 直接崩溃
- **位置**:
  - `src/core/resources/adapter.ts:460,482,501-514`
  - `src/core/resources/exportService.ts:116,203,218-228,241-257`
  - `src/core/resources/zip.ts:46`
  - `src/ui/components/ResourceCenterPanel.tsx:477` / `src/ui/components/AiWorkflowPanel.tsx:238`
- **具体反例与失败场景**:
  - 在真实雨课堂中，重修/合班/实验班+理论班/跨学期选修同一门课程时，接口会返回两条 `course_id` 相同（如 `"10086"`）但 `classroom_id` 不同（如 `"20001"` 与 `"20002"`）的记录。
  - `normalizeResourceCourses`（`adapter.ts:460,501`）按 `key = classroomId || id` 去重，因此输出 **2 个 `Course` 对象，且两者的 `course.id` 均为 `"10086"`**。
  - `exportService.ts:203` 构造 `folders = new Map(data.courses.map(course => [course.id, ...]))`，第二条记录覆盖第一条记录的目录映射。
  - 随后 `addKnowledgeFiles`（`exportService.ts:241-257`）遍历 `for (const course of data.courses)`，对同一 `prefix` 写入两次 `README.md`、`course.json` 等文件；`buildNotebookLmFiles`（`line 218`）同理。
  - 最终 `buildZipArchive`（`zip.ts:46`）检测到重复路径，直接抛出 **`Error('Conflicting ZIP path')`**，整包导出彻底失败。同时 React 列表 `key={c.id}` 碰撞，勾选一门课会联动勾选两门。
- **修复建议**:
  - 明确 `Course.id` 在单个 `ResourceDiscoveryResult` 中的全局唯一性：当存在 `classroomId` 且多班级共享同一 `course_id` 时，将 `Course.id` 规范化为唯一标识（或在 `exportService.ts` / `adapter.ts` 统一使用 `courseKey = course.classroomId || course.id` 并在 `exportService` 内对 `courses` 按唯一键去重）。

---

#### [P0-3] `package.json` 与 `public/manifest.json` 仍停留在 `0.1.0`，违背 v0.2 发布与打包验收标准
- **位置**:
  - `package.json:3` (`"version": "0.1.0"`)
  - `public/manifest.json:4-5` (`"version": "0.1.0"`, v0.1 描述文案)
  - `scripts/package.mjs:9-10`
  - `src/core/resources/exportService.ts:360` (`generatorVersion: '0.2.0-beta'`)
- **失败场景**:
  - 执行 `npm run package` 时，`scripts/package.mjs:9` 读取 `package.json` 版本号，实际生成 `release/yuketang-ddl-helper-v0.1.0.zip`，无法满足 `ACCEPTANCE_CRITERIA.md:11` 要求的 `release/yuketang-ddl-helper-v0.2.0-beta.zip`。
  - 浏览器加载扩展后显示版本 `0.1.0` 和旧描述，却在导出产物 `manifest.json` 中宣称 `generatorVersion: '0.2.0-beta'`。
- **修复建议**:
  - `package.json`: `"version": "0.2.0-beta"`。
  - `public/manifest.json`: `"version": "0.2.0"`、`"version_name": "0.2.0-beta"`（符合 Chrome MV3 数值型 `version` 规范），并更新 `description` 覆盖课程资源导出与 AI 工作流能力（切勿扩大 `permissions` / `host_permissions`）。

---

#### [P0-4] `resourceBackend.ts:67` 导致 `ResourceService` 每次同步都被销毁重建，队列序列化与部分失败兜底彻底失效
- **位置**:
  - `src/ui/adapters/resourceBackend.ts:63-89,115`
  - `src/core/resources/resourceService.ts:38-40,86-101`
- **具体反例**:
  - `resourceBackend.ts:67` 写的是：`if (existing && !req) return existing;`。
  - 但唯一调用 `getService` 的地方 `syncResources`（`line 115`）每次都传入 `req`（非空对象），因此 `existing && !req` **恒为 `false`**！
  - 每次触发 `syncResources`，都会创建全新的 `ResourceService` 实例并覆盖 `services.set(key, service)`，导致 `resourceService.ts` 内部精心实现的：
    1. `syncQueue` 串行保护失效（并发同步彼此不受队列约束）；
    2. `current` 历史快照被清空，部分课程失败（`discovered.failedCourses > 0`）时无法保留上次成功的课程资料（`resourceService.ts:86-98` 成为死逻辑）。
- **修复建议**:
  - 按 `key` 复用同一个 `ResourceService` 实例，将易变的 `existingCourses` / `existingHomework` 存入每 `key` 的可变上下文引用或扩展 `ResourceSyncOptions` 传入 `discoverFn`，避免重复实例化。

---

### P1 — High Priority（高影响缺陷、严重代码膨胀与兼容性风险）

#### [P1-1] `useResourceCenter.ts` 残留 703 行死代码与重复 Demo 数据集，且违背多项 v0.2 契约
- **位置**: `src/ui/hooks/useResourceCenter.ts:208-910`（占该文件 1545 行的 **45.5%**）对比 `src/core/resources/{demoResources,naming,downloadService,exportService}.ts` 与 `src/ui/components/ContentApp.tsx:11-13`
- **问题分析**:
  1. **生产环境 100% 死代码但被打包进产物**：`ContentApp.tsx:11-13` 在模块加载时即注册 `createBrowserResourceBackend()`，因此 `DEFAULT_FALLBACK_BACKEND` 在生产环境中永远不会被走到，却因为被 `resolveBackend` 静态引用而被 Vite 完整打包进 `content.js` 和 `preview`。
  2. **三套割裂的 Demo 数据集**：`demoData.ts`（5 门课）、`demoResources.ts`（2 门课）、`useResourceCenter.ts:250-540`（3 门完全不同的课：`操作系统原理`/`机器学习导论`/`计算机网络`）。
  3. **多处重复造轮子且安全降级**：`sanitizeSafeDownloadName`（`line 208`）重复 `naming.ts` 但未防护 Windows 保留设备名（`CON`/`NUL`/`LPT9`）；`triggerLocalBlobDownload`（`line 217`）重复 `downloadService.ts:98`。
  4. **直接违背 `CONTRACTS.md` 与 `ACCEPTANCE_CRITERIA.md`**：
     - `buildDemoBytes`（`lines 545-568`）把纯文本 Markdown 字节保存为 `.pdf` 后缀假文件；
     - `exportBundle`（`line 852`）对 `knowledge-base`/`notebooklm`/`ai-context` 导出 `.json` 而非 `.zip`，且无 `sanitizeData` 与 `study_prompt.md`；
     - 诊断中把 `/v2/api/web/logs/learn/{classroom_id}` 错标为 `experimental: true`（`line 599`），与 `RESOURCE_ENDPOINT_SPECS` 矛盾；把 `/c27/online_courseware/xty/kls/pub_news/{courseware_id}/` 错标为 `scope: 'chapters'`（`line 517`）。
- **修复建议**: 彻底删除 `useResourceCenter.ts:208-910`，让 `resolveBackend` 默认直接使用 `createBrowserResourceBackend()`（或懒加载单实例），消除约 700 行冗余代码与包体积膨胀。

---

#### [P1-2] 取消单文件或批量下载时，UI 将已取消任务误标为 `failed` 并加入「重试失败项」
- **位置**:
  - `src/core/resources/downloadService.ts:273,297-299`
  - `src/ui/hooks/useResourceCenter.ts:1257-1264,1328-1330`
  - `src/ui/components/ResourceCenterPanel.tsx:367-405`
- **失败场景**:
  - `downloadService.ts:273` 捕获 `AbortSignal` 后并不抛出 `AbortError`，而是返回 `{ status: 'failed', errorCode: 'cancelled' }`；在 `downloadBatch` 中（`lines 297-299`），队列中被中止的剩余 4 个未开始任务也被计入 `failed++`。
  - `useResourceCenter.ts:1257-1260`（`downloadSingle`）和 `lines 1328-1330`（`runBatchDownload`）没有判断 `errorCode === 'cancelled'`：
    - `downloadSingle` 的 `catch (AbortError)` 分支实际成为死代码，取消后卡片被标成红色「失败」而非恢复原状态；
    - `runBatchDownload` 取消后，红色错误横幅显示 `批量下载已取消 · 成功 1 · 跳过 0 · 失败 4` 并展示「重试失败项 (4)」，而 `indexStore.ts:94` 实际跳过了 `cancelled` 记录，造成 UI 状态与本地索引不一致。
- **修复建议**:
  - 在 `useResourceCenter.ts` 中显式处理 `res.errorCode === 'cancelled'`（`downloadSingle` 恢复原 `material.downloadStatus`，`runBatchDownload` 跳过对 `errorCode === 'cancelled'` 项的 `failed` 状态覆写）；在 `downloadService.ts:284,297` 中不把 `cancelled` 项计入 `failed` 计数。

---

#### [P1-3] `useResourceCenter.ts` 的 `autoSync` 依赖每 30 秒重建的 `app.effectiveItems`，导致慢同步或初始报错时每 30 秒被强行中止并死循环重拉
- **位置**:
  - `src/ui/hooks/useResourceCenter.ts:1035,1039-1059`
  - `src/ui/hooks/useDdlApp.ts:128,206-214`
- **失败场景**:
  1. `useDdlApp.ts:128` 每 30 秒执行 `setNow(Date.now())`，使 `app.effectiveItems` 每 30 秒生成新数组引用。
  2. `useResourceCenter.ts:1035` 将 `app.effectiveItems` 放入 `refreshResources` 依赖数组，导致 `refreshResources` 每 30 秒重建；进而触发 `autoSync` `useEffect`（`line 1058`）。
  3. 当真实环境课程较多导致首次资源同步耗时超过 30 秒（并发 2 × 间隔 250ms × 每课多端点 + 幻灯片拉取非常容易超过 30 秒），或首次同步抛出异常导致 `discovery === null` 时：`line 1046` 的守卫 `if (syncedKeyRef.current === syncKey && discovery) return;` 为 **`false`**！
  4. `refreshResources(false)` 被再次调用，`syncAbortRef.current?.abort()` 直接杀掉正在进行的首次同步并从头重启，形成每 30 秒无限中止-重试死循环（在用户勾选任意 DDL 任务时甚至会立刻中止资源同步）。
- **修复建议**:
  - 将 `app.syncResult?.courses` 与 `app.effectiveItems` 存入 `useRef` 供 `refreshResources` 读取，移出 `refreshResources` 依赖列表；并将 `autoSync` 守卫改为仅在 `syncKey` 变化时触发（`if (syncedKeyRef.current === syncKey) return;`），不要在 `discovery === null` 时自动重入。

---

#### [P1-4] `exportBundle` 后未同步刷新 UI 状态与 `syncStatus`，且 `downloadSingle`/`downloadBatch` 猜测 `origin` 存在串键风险
- **位置**:
  - `src/ui/adapters/resourceBackend.ts:60-61,122-125,144-147,187-219`
  - `src/ui/hooks/useResourceCenter.ts:1229-1260,1306-1345,1418-1437`
- **问题分析**:
  1. `exportBundle` 内部拉取了所有附件并调用 `persistOutcomes` 写入 `CourseResourceIndex`，但 `useResourceCenter.ts:1418-1437` 完全没有更新内存中的 `discovery.materials` 状态，也没有刷新 `syncStatus`；`downloadSingle` / `runBatchDownload` 同样未刷新 `syncStatus`（设置页「已下载 X 份」长期滞后）。
  2. `ResourceDownloadSingleRequest` 与 `ResourceDownloadBatchRequest` 缺少显式的 `origin` / `sourcePlatform` 字段，`resourceBackend.ts:123,145` 退化为 `resolveOrigin(req.material.sourceUrl ?? lastOrigin)`：
     - `demoResources.ts` 生成的资料全部**没有 `sourceUrl`**；
     - 在 `PreviewApp` 切换模拟分支或存在多实例共享全局单例 `registeredBackend` 时，易写入错误的 `origin` 索引键。
- **修复建议**:
  - 在 `ResourceDownloadSingleRequest` / `ResourceDownloadBatchRequest` 显式传入 `origin` 和 `sourcePlatform`（来自 `discovery.origin` / `app.platform`）。
  - 让 `exportBundle` 返回本次实际下载的 `items`（或状态变更摘要），并在 `downloadSingle` / `runBatchDownload` / `exportBundle` 完成后同步更新 `discovery.materials` 与 `syncStatus`。

---

#### [P1-5] `downloadService.ts` 与 `exportService.ts` 调用 ES2024 `URL.parse()`，破坏 Node 20 LTS 与 Chrome/Edge < 126
- **位置**:
  - `src/core/resources/downloadService.ts:65`
  - `src/core/resources/exportService.ts:60`
  - `tsconfig.json:1`（`target: "ES2022"`, `lib: ["ES2024", ...]`）
- **失败场景**:
  - `URL.parse()` 直到 **Chrome 126**（2024-06）和 **Node 22.1.0** 才支持。在仍在广泛使用的 **Node 20 LTS**（未来 MCP Server 常见运行环境）或校内机房旧版 Chromium/Edge 浏览器中运行会直接抛出 `TypeError: URL.parse is not a function`。
  - `package.json` 未声明 `engines`，`public/manifest.json` 未声明 `minimum_chrome_version`。
- **修复建议**: 将两处 `URL.parse(value)` 替换为标准 `try { return new URL(value); } catch { return null; }`，零成本兼容 Node 20 LTS 与更低版本浏览器。

---

#### [P1-6] `pdf.ts` 的 `mergeSlideImagesToPdf` 优先信任 `mimeType` 而非魔数，导致 CDN 返回 WebP/PNG 但带默认 `image/jpeg` 时合成失败
- **位置**:
  - `src/core/resources/pdf.ts:146-158`
  - `src/core/resources/adapter.ts:594`
  - `src/core/resources/downloadService.ts:190`
- **具体反例**:
  1. `adapter.ts:594` 在无法从扩展名判断时默认赋予 `mimeType: 'image/jpeg'`。
  2. 国内对象存储 CDN（COS/OSS/七牛）经常对无后缀或 `.jpg` 链接返回 `Content-Type: application/octet-stream`（甚至自适应 WebP），此时 `downloadService.ts:190` 回退采用 `expected = 'image/jpeg'`。
  3. 传入 `pdf.ts:148`：`if (jpeg || /^image\/(?:jpeg|jpg)$/.test(mime))` — 即使 `bytes` 开头是 PNG（`89 50 4E 47`）或 WebP（`RIFF....WEBP`），因 `||` 右侧命中 MIME 而直接跳过 `converter`，送入 `jpegInfo()` 触发 `unsupported-format` 报错！
- **修复建议**: 按文件头魔数优先分类：`FF D8` → 直接 JPEG 嵌入；`89 50 4E 47`（PNG）或 `52 49 46 46 ... 57 45 42 50`（WebP）→ 交给 `converter`（无论 `mimeType` 是什么），仅在非 JPEG 魔数且无法识别格式时抛 `unsupported-format`。

---

#### [P1-7] `adapter.ts` 的实验接口标注诚实度缺口、多 PPT 静默丢弃与 `resourceKey` 漂移
- **位置**: `src/core/resources/adapter.ts:706,729,848,1069-1073,1759,1792,1813-1814,1839-1850`
- **具体问题（4 处）**:
  1. **实验接口漏标（违背 ADR-004）**：Step 2C 调用实验性接口 `discussion-announcements-v2`（`experimental: true`），但 `normalizeAnnouncements`（`line 1069`）未接收和透传 `experimental` 参数，导致由此拉取的 `announcement_attachment` 全部缺少 `experimental: true` 标记，UI 不会展示「实验接口」徽标。
  2. **合并时洗白实验标记**：`mergeMaterials`（`line 729`）逻辑为 `existing.experimental === false || incoming.experimental === false ? false : ...`。若某条资料先在 `learn-logs` 中仅作为无链接占位出现（`experimental: false`），后由实验性章节接口补齐 `downloadUrl`（`experimental: true`），合并后仍被标为 `experimental: false`。
  3. **多 PPT 静默丢失与硬截断**：Step 2D（`line 1813`）面对一节课多个课件（`presentations.length > 1`）只取 `presentations[0]`，其余课件被静默忽略；且 `line 1792` 硬截断 `.slice(0, 10)`，常规 16 周课程的第 11 讲及以后将全部静默停留在 `unavailable`，且诊断信息中无任何截断告警。
  4. **`resourceKey` 含 `type` 导致跨同步不稳定**：Step 2D 水合成功后把 `resourceKey` 从 `${courseId}:slides:${id}` 改写为 `${courseId}:image_slides:${id}`（`lines 1839-1850`）。一旦后续同步时 `lesson-presentation-v3` 偶发超时，同一课件的 `resourceKey` 会退回 `:slides:`，导致去重失效、`knownResourceKeys` 留下孤儿键、旧资料被误判为「新增」；同样，若 `learn-logs` 推断 `slides` 而 `chapters` 推断 `pdf`，同一 `id` 会产生两条重复资料。
- **修复建议**:
  - 为 `normalizeAnnouncements` 增加 `options?: { experimental?: boolean }` 并透传；当 `downloadUrl`/`slideImages` 来源为实验接口时保留 `experimental: true`。
  - Step 2D 遍历全部 `presentations`（按 `${lessonId}-${presentationId}` 区分）并在触发上限时写入明确诊断 `note`（如 `truncated-hydration`）。
  - 评估在 v0.2/v0.3 中让同一 `courseId + id` 的合并识别跨类型升级，或不在水合阶段突变已入库的 `resourceKey`。

---

#### [P1-8] `indexStore.ts` 的存储键与 `sourcePlatform` 展示名耦合过紧，且 `sourceChanged` 存在误判
- **位置**:
  - `src/core/resources/indexStore.ts:6-7,36-38,57-65,76-84`
  - `src/core/platform/detector.ts:4` vs `src/ui/hooks/useDdlApp.ts:48`
- **具体反例**:
  1. `detector.ts:4` 对 `www.yuketang.cn` 的 `label` 是 `'雨课堂'`，而 `useDdlApp.ts:48` 的 `FALLBACK_PLATFORM.label` 是 `'雨课堂主站'`。两者生成的 `storageKey` 完全相同（`ykt-ddl:resource-index:https://www.yuketang.cn`），但 `loadResourceIndex`（`line 37`）校验 `index.sourcePlatform !== sourcePlatform` 失败后直接丢弃整个已下载索引！未来只要修改文案也会全量清零用户索引。
  2. `reconcileMaterialsWithIndex`（`line 78`）：若某资料上次下载 `failed`（从未成功下载），下次同步其 `updatedAt` 变动时，`sourceChanged` 为 `true`，状态会被错误标为 `'updated'`（"有更新"通常语义指本地已下载副本落后于远端）。
  3. `sourceChanged`（`lines 62-63`）直接比较接口申报的 `material.size` 与实测下载字节数 `record.size`；若雨课堂接口返回近似字节数（如取整或压缩前大小），该资料在下载后每次同步都会永久卡在 `'updated'` 状态。
- **修复建议**:
  - 索引校验放宽或改用稳定 `variant`（而非本地化显示名），或对非 demo 键也包含规范化平台标识。
  - 仅在 `record.status === 'downloaded'` 时才将 `sourceChanged` 映射为 `'updated'`；当仅 `material.size` 与 `record.size` 略有差异且 `updatedAt` 未变时，优先信任 `sourceUpdatedAt` 与 `checksum`（可将 `sourceSize` 与 `downloadedSize` 拆开记录）。

---

### P2 — Medium Priority（体验摩擦、安全加固、并发与 MCP 适配）

#### [P2-1] 实时资源同步覆盖了 v0.1 `LocalOverrides`（自定义 DDL、本地已完成、已隐藏）
- **位置**: `src/core/resources/adapter.ts:1620-1624,1695-1698`、`src/ui/hooks/useResourceCenter.ts:983`
- **问题**: `useResourceCenter` 传入了包含用户本地覆盖的 `existingHomework: app.effectiveItems`，`adapter.ts:1620` 先将其写入 `assignmentsMap`/`examsMap`，但随后在 `lines 1697-1698` 用原始 `allLogRows` 无条件 `set()` 覆盖，导致：
  - 用户为「截止待定」任务设置的 `customDeadlines`（`isCustomDeadline: true`）从导出的 `deadlines.ics`、`assignments.md`、`upcoming_deadlines.md` 中凭空消失；
  - 用户本地划掉的 `completedIds` 在导出中恢复为 `pending`，`ignoredIds` 重新出现。
- **修复建议**: 合并 `allLogRows` 与 `existingHomework` 时，若 `existing` 存在 `isCustomDeadline: true`（且服务端仍无 DDL）或 `status === 'submitted'`，保留用户本地覆盖；或直接由上层对导出任务再套用一次 `LocalOverrides`。

---

#### [P2-2] 签名 CDN URL 参数脱敏存在漏网项，且 v0.1 `formatAiPrompt` 缺少防 Prompt Injection 边界
- **位置**: `src/core/resources/exportService.ts:52-69`、`src/core/prompt/formatter.ts:12-61`
- **具体反例**:
  1. `exportService.ts:55` 中 `signature` / `sig` 使用了全字锚定 `^...$`，因此腾讯云 COS / AWS 常见预签名参数 `q-signature`、`x-cos-signature`、`q-ak`、`q-sign-time`、`aws_signature` 不会命中 `sensitiveKey`，其查询串会原样进入导出的 `materials.json` 与 `context.json`。
  2. `exportService.ts:158-172`（`study_prompt.md`）对 Prompt Injection 防护非常到位，但同一「AI 工作流」标签页下的「快捷 Prompt」（`src/core/prompt/formatter.ts`）未附带不可信外部数据边界声明（改动时需注意兼容 `tests/core.test.ts` 的既有断言）。
- **修复建议**: 放宽 `exportService.ts:55` 对 `*signature*` / `q-ak` / `q-sign-*` / `x-cos-*` 的匹配，或在导出 JSON 的 `downloadUrl` 中默认剥离查询参数（仅保留下载时内存中的原始 URL）。

---

#### [P2-3] Content Script 跨子域 CORS 与 `referrerPolicy: 'no-referrer'` 的真实环境下载风险
- **位置**: `src/core/resources/downloadService.ts:167-175`、`docs/agent-workflow/DECISIONS.md` (ADR-001/ADR-002)
- **问题**:
  - Chrome MV3 中 **Content Script 不享有 `host_permissions` 的跨域豁免**（仅 Background Service Worker / 扩展页享有）。因此即使下载目标位于 `https://*.yuketang.cn` 下的兄弟子域（如 `files.yuketang.cn`、`cdn.yuketang.cn`），在 `changjiang.yuketang.cn` 页面内发起 `fetch()` 仍受严格 CORS 约束。
  - `referrerPolicy: 'no-referrer'` 在国内 OSS/COS/七牛 防盗链校验（校验 `Referer: *.yuketang.cn`）下可能触发 HTTP 403 `unauthorized`。
- **修复建议**: 在 README / Beta 测试指南中诚实说明真实 CDN 下载尚未在全部雨课堂分支实测；对 `*.yuketang.cn` 同域链考虑在实测时验证 `referrerPolicy: 'strict-origin-when-cross-origin'` 是否必要；若后续实测发现 `*.yuketang.cn` 兄弟子域普遍无 CORS 头，可通过扩展页或消息代理（仅限 `https://*.yuketang.cn/*`）中转，无需扩大 `host_permissions`。

---

#### [P2-4] `indexStore` 并发读写竞态与未入契约的 `materialHistory` 字段
- **位置**: `src/core/resources/resourceService.ts:31,51-76`、`src/ui/adapters/resourceBackend.ts:91-102`
- **问题**:
  - `syncResources` 与 `persistOutcomes` 并发读写同一个 `CourseResourceIndex` 键却没有串行锁（对比 `ddlService.ts:122` 的 `serialize()`），同步与下载重叠时会后写覆盖前写。
  - `resourceService.ts:31,74` 在 `CourseResourceIndex` 上持久化了未在 `src/types/resources.ts` 和 `CONTRACTS.md` 中声明的 `materialHistory` 字段；且 `lines 58-62` 在某字段首次从 `undefined` 变为有值时会误判 `changed = true`。
- **修复建议**: 在 `indexStore.ts` 内为按 `key` 的 `updateResourceIndex(origin, sourcePlatform, updater)` 提供串行队列锁；将 `materialHistory` 正式纳入类型定义（或独立存储键）并修正 `previous.updatedAt !== undefined` 比较条件。

---

#### [P2-5] UI / UX 摩擦与 Windows 深色模式可读性问题
- **位置**:
  - `src/ui/components/AiWorkflowPanel.tsx:77-102,378-389`
  - `src/ui/components/DdlDrawer.tsx:227-261`
  - `src/ui/styles/drawer.css:90-147,500-552,723-752,2127-2136`
  - `src/core/resources/demoResources.ts:14-62`
- **具体问题**:
  1. **非二进制导出显示 `0/6 份资料`**：导出 `AI Context Pack` / `JSON` / `Markdown` 时，`exportService.ts:315` 不打包二进制附件，`includedMaterialCount` 恒为 `0`，但 `AiWorkflowPanel.tsx:385` 仍展示 `0/6 份资料`，极易被误解为全部下载失败！且存在 `failedCount > 0` 时，`.ykt-ai-last-export` 依然使用绿色成功卡片样式，并隐藏了具体缺失文件名与原因（用户需解压手动查 `manifest.json`）。
  2. **NotebookLM 覆盖预览不准确**：选择 `NotebookLM 资料包` 时，第 3 步仍把 `.pptx`/`.zip` 计入「可打包资料」，未提前提示这些格式会被跳过。
  3. **4-Tab 宽度拥挤**：抽屉宽 `456px`（`drawer.css:352`），4 个 Tab 使用等宽 `flex: 1`（各 ~106px）；当「课程资源」带两位数或 `99+` 徽标时所需宽度 ~108px 发生挤压，而「设置」右侧存在大量空白。建议改用 `flex: 1 1 auto`。
  4. **Windows 深色模式 `<select>` 不可读**：`drawer.css` 未在 `.ykt-root[data-theme='dark']` 设置 `color-scheme: dark`（及浅色 `color-scheme: light`）。在 Windows Chrome/Edge 深色主题下，原生 `<select className="ykt-select">` 展开的 `<option>` 弹出框可能出现浅底浅字（`#f1f5f9` 文字在白色系统弹窗上几乎不可见）。
  5. **真实 Demo 数据展示残缺**：`demoResources.ts` 缺少 `sourceUrl`、`size`、`experimental: true` 示例条目及 `diagnostics`，导致在演示模式下「外链按钮」「已知大小（始终显示 `—`）」「实验接口徽标」「v0.2 诊断表」全部无法在 UI 中看到。

---

#### [P2-6] 未来独立 Node/TS MCP Server 复用 `src/core/resources/*` 的接入成本评估
- **总体评估**: **中低成本（架构分层良好，无 React/DOM 顶层强耦合，但存在 5 个具体 Node 运行时摩擦点需要修补后才能开箱即用）**。
- **可直接复用的部分**: `endpoints.ts`、`naming.ts`、`zip.ts`、`exportService.ts`、`resourceService.ts`、`demoResources.ts`、`adapter.ts`（`stripHtmlToText` 无 DOM 依赖、`computeSha256Hex` 使用 Node 20+ 原生 `crypto.subtle`）。
- **需解决的 5 个具体阻塞/摩擦点**:
  1. **Cookie 认证头在 Node 中丢失（高）**：`discoverCourseResources(platform, { cookie })` 调用 `buildRequestHeaders`（`src/core/platform/detector.ts:46-59`），后者仅解析 `csrftoken`/`xtbz`，**从未设置 `Cookie` 请求头**（依赖浏览器 `credentials: 'include'`）。在 Node `fetch` 中无 Cookie Jar，直接调用将全部返回 401，MCP Server 不得不包一层自定义 `fetchImpl` 注入 `Cookie`（`downloadService.ts:168` 同理）。
  2. **Node `fetch` 302 重定向误分类（高）**：`adapter.ts:1335` 仅判断浏览器的 `response.type === 'opaqueredirect'`；Node undici `fetch` 在 `redirect: 'manual'` 下返回 `status: 302, type: 'default'`，会被 `line 1353` 误归类为 `http-error` 而非 `unauthorized`。
  3. **`URL.parse()` 要求 Node 22.1+（中）**：见 `[P1-5]`，替换为 `new URL` 后立即支持 Node 20 LTS。
  4. **默认索引存储易失（中）**：`indexStore.ts:23-55` 在 Node 中回退至进程内 `memory` Map，重启即丢；虽然 `createResourceService` 支持注入 `loadIndex`/`saveIndex`，但 `downloadService` 未集成持久化接口，MCP Server 需自行提供文件/SQLite 存储适配器及写锁。
  5. **非 JPEG 课件转 PDF 依赖 DOM Canvas（低-中）**：`convertSlideImageWithCanvas`（`pdf.ts:118-136`）依赖 `document` + `createImageBitmap`，在 Node 中处理 PNG/WebP 幻灯片时需由 MCP Server 注入基于 `sharp`/`@napi-rs/canvas` 的 `SlideImageConverter`（JPEG 幻灯片可直接零依赖运行）。

---

### P3 — Low Priority（清理与打磨）

1. **[P3-1] `endpoints.ts` 存在 5 个未引用端点与 1 个未调用的导出函数**
   - `src/core/resources/endpoints.ts:55-64,99-119,143-152,165-174,240-245`：`coursewareCardsEndpoint` 导出但全库零调用；`classroom-detail-v2`、`courseware-pub-news`、`leaf-info-mooc`、`cards-detlist-v2`、`course-homework-v2` 仅存在于 `RESOURCE_ENDPOINT_SPECS` 中从未被 `adapter.ts` 触发。建议注明 `status: 'documented-only'` 或移除无用导出，避免误导维护者以为已接入探测。
2. **[P3-2] 轻微契约/文档漂移**
   - `src/core/resources/demoResources.ts:29,53-54` 生成的作业 `resourceKey` 使用 `:homework:`/`:quiz:`，而 `adapter.ts:1160` 使用 `:assignment:`；
   - `demoResources.ts:41-42,67` 使用 0-based 幻灯片 `index`，而 `adapter.ts:588` 与 `API_RESEARCH.md:55` 使用 1-based `index`；
   - `exportService.ts:349` 对 NotebookLM 所有资料统一使用 `01_` 前缀，与 `ARCHITECTURE.md:72-73`（`01_` PDF / `02_` 文本）略有差异；
   - `ARCHITECTURE.md:96,98` 提及 `listMaterials(courseId, filter)` 与 `buildExportPackage`，与实际导出名 `listMaterials(courseId, signal)`、`buildExportFiles`/`exportAsZip` 略有出入。
3. **[P3-3] `pdf.ts:39` 仅支持 SOF0 (`0xc0`) 与 SOF2 (`0xc2`)**
   - 少数编码器输出的 Extended Sequential DCT JPEG 使用 SOF1（`0xc1`），PDF `/DCTDecode` 原生支持，放开 `0xc1` 可减少误拒。
4. **[P3-4] 部分课程拉取失败无提示，且导出完成后缺少「交给 AI」一步引导**
   - `useResourceCenter.ts:1012-1024` 在 `result.failedCourses > 0` 但 `result.error === undefined` 时无任何用户提示（对比 `useDdlApp.ts:162`）；
   - `AiWorkflowPanel.tsx:378-389` 导出完成后可增加一行简短操作提示（如解压后将 `Yuketang_NotebookLM/` 拖入 NotebookLM，或将 `AI_Context/` 连同 `study_prompt.md` 发给任意 AI），让「选择课程 → 选择导出模式 → 下载资料包 → 交给 AI」闭环更丝滑。

---

## 3. Principle Fidelity & Contract Scorecard（原则与契约核查）

| 维度 | 评估 | 关键事实与证据 |
| :--- | :---: | :--- |
| **Local-first & Privacy-first** | **Pass (with P2-2)** | `public/manifest.json` 权限保持最小（`storage`, `clipboardWrite`, `https://*.yuketang.cn/*`）；零第三方服务器上传；全库零 `dangerouslySetInnerHTML` / `eval` / `new Function`；需补齐 COS/AWS 签名参数脱敏（`P2-2`） |
| **Strictly Read-only** | **Pass** | 全库零 `POST`/`PUT`/`DELETE`/`PATCH`；无签到/刷课/答题/提交/DRM 绕过逻辑 |
| **AI-agnostic & Minimal Deps** | **Pass** | `package.json` 仅依赖 `react` 与 `react-dom`；零 BYOK/模型绑定；纯 TS 实现 ZIP/PDF/ICS/SHA-256/HTML 清洗 |
| **Backward Compatibility (v0.1)** | **Pass (with P2-1)** | 22/22 v0.1 单元测试通过，看板/`.ics`/PromptPanel/Popup 无回归；仅 v0.2 导出未继承 v0.1 `LocalOverrides`（`P2-1`） |
| **Compatibility Honesty (ADR-004)** | **Partial (P1-7)** | `API_RESEARCH.md` 与 `RESOURCE_ENDPOINT_SPECS` 区分了实测与实验接口，但 `adapter.ts` 公告附件漏标 `experimental: true`、合并逻辑可能洗白实验标记，且死代码 Fallback 标注错误 |
| **Contract Alignment (`CONTRACTS.md`)** | **Partial (P0-2, P1-1, P1-8)** | 核心模块签名与 `schemaVersion: '0.2.0'` 基本对齐，但 Fallback 死代码违背契约、多班级 `course.id` 冲突、`materialHistory` 未入 schema |

---

## 4. Recommended Stage 5 Triage Order（建议修复顺序）

1. **立即修复全部 P0（发布硬阻断）**：
   - `P0-1`（过滤 `unavailable`/`video_meta` + 保护 `recordDownloadOutcome` & `failedMaterials`）
   - `P0-2`（解决多班级重复 `course.id` 导致 ZIP 冲突）
   - `P0-3`（升级 `package.json` & `public/manifest.json` 至 `0.2.0-beta` / `0.2.0`）
   - `P0-4`（修复 `resourceBackend.ts:67` `ResourceService` 复用）
2. **集中清理并修复核心 P1（高价值/低风险）**：
   - `P1-1`（删除 `useResourceCenter.ts` 703 行死代码 Fallback）
   - `P1-2`（正确处理 `cancelled` 状态，不污染 `failed`）
   - `P1-3`（修复 `autoSync` 每 30 秒依赖抖动循环）
   - `P1-4`（显式传递 `origin`/`sourcePlatform`，`exportBundle` 回写 UI 与 `syncStatus`，NotebookLM 预过滤格式）
   - `P1-5`（替换 `URL.parse`）
   - `P1-6`（`pdf.ts` 魔数优先判断）
   - `P1-7`（公告附件透传 `experimental: true`、修复多 PPT 截断与合并实验标记）
   - `P1-8`（稳定 `indexStore` 键与 `sourceChanged` 判定）
3. **择优纳入 P2 体验与安全修复**：
   - `P2-1`（保留 `LocalOverrides`）、`P2-2`（补齐签名参数脱敏）、`P2-5`（`AiWorkflowPanel` 缺失明细与 `0/6` 修复、4-Tab `flex: 1 1 auto`、深色 `color-scheme: dark`、完善 `demoResources.ts` 字段）。
