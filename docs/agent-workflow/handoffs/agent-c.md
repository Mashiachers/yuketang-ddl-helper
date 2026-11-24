---
agent_id: agent-c
role: Frontend & Product Experience
model_preference: Antigravity (gemini-4-neon)
task_id: resource-center-ai-workflow-ui
status: ready
dependencies:
  - stage-0-contracts
allowed_paths:
  - src/ui/hooks/useResourceCenter.ts
  - src/ui/components/ResourceCenterPanel.tsx
  - src/ui/components/AiWorkflowPanel.tsx
  - src/ui/components/DdlDrawer.tsx
  - src/ui/components/SettingsPanel.tsx
  - src/ui/components/Icons.tsx
  - src/ui/styles/drawer.css
forbidden_paths:
  - src/types/
  - src/core/
  - public/manifest.json
deliverables:
  - src/ui/hooks/useResourceCenter.ts
  - src/ui/components/ResourceCenterPanel.tsx
  - src/ui/components/AiWorkflowPanel.tsx
  - Updated DdlDrawer.tsx, SettingsPanel.tsx, Icons.tsx, drawer.css
acceptance_criteria:
  - 4-tab DdlDrawer navigation (待办看板 / 课程资源 / AI 工作流 / 设置) preserving 100% of v0.1 DDL features.
  - Course Resource Center supports course selector, type filter, search, resource count & size, 新增 badges, download status, single download, batch download with live progress, cancel, retry failed, and course export button.
  - AI Workflow Center simplifies user flow to 选择课程 → 选择导出模式 → 下载资料包 / 复制 Prompt, showing missing items and last sync timestamp, while retaining PromptPanel.
  - Shadow DOM CSS isolation maintained, light & dark modes styled cleanly, zero dangerouslySetInnerHTML, zero heavy UI libraries.
  - Works seamlessly in Demo Mode and Preview sandbox (npm run build passes cleanly).
---

# Agent C Handoff Brief — Frontend & Product Experience

Read `AGENTS.md`, `docs/agent-workflow/PROJECT_CONTEXT.md`, `docs/agent-workflow/ARCHITECTURE.md`, and `docs/agent-workflow/CONTRACTS.md` first.

## Important Coordination Note
In Stage 2, Agent A (`adapter.ts`) and Agent B (`src/core/resources/*`) are working in parallel in separate worktrees, so `src/core/resources/*` files do not exist in your worktree yet.
- Define a clean, minimal `ResourceCenterBackend` adapter interface inside `src/ui/hooks/useResourceCenter.ts` (matching `src/types/resources.ts` types!) with a built-in lightweight Demo fallback adapter (using `src/types/resources.ts`) so your UI compiles (`npm run typecheck`), builds (`npm run build`), and runs in Demo Mode immediately in isolation!
- In Stage 3, Main Agent will wire `useResourceCenter.ts` directly to Agent A + Agent B's real `resourceService`, `downloadService`, `exportService`, and `demoResources` in ~10 lines!
- Do NOT touch `src/core/` or `src/types/`.

## Objectives
1. **`src/ui/hooks/useResourceCenter.ts`**:
   - State for discovered `courses`, `materials`, `assignments`, `exams`, `announcements`, `diagnostics`, `syncedAt`, `loading`, `error`.
   - Filters: `selectedCourseId` (`'all'` or courseId), `typeFilter` (`'all'` or `MaterialType`), `searchQuery`, `onlyNewOrUndownloaded`.
   - Selection: `selectedResourceKeys`, `toggleSelectResource`, `selectAllVisible`, `clearSelection`.
   - Download & Export state: `downloadProgress: DownloadProgress | null`, `busyMode: 'download' | 'export' | null`, `lastBatchResult: DownloadBatchResult | null`, `lastExportManifest: ExportManifest | null`, `mergeSlidesToPdf: boolean`, `skipDownloaded: boolean`.
   - Actions: `refreshResources(force?)`, `downloadSingle(material)`, `downloadSelected()`, `retryFailed()`, `cancelActiveTask()`, `exportBundle(mode: ExportMode, courseIds?: string[])`.
2. **`src/ui/components/ResourceCenterPanel.tsx`**:
   - Course selector dropdown + resource type pills (`全部` / `课件` / `PDF` / `PPT` / `文档` / `附件` / `公告`) + search box.
   - Resource stats strip (total count, new count, downloaded count, total known size).
   - Action bar: select all / clear, toggle「图片课件合并为 PDF」&「跳过已下载」, batch download button, retry failed button (when failures exist), and live progress bar with **取消** button during active download/export.
   - Clean resource cards showing course pill, chapter subtitle, type badge, `新增` badge, file size (when available), download status pill (`未下载` / `已下载` / `有更新` / `失败` / `仅链接`), experimental hint pill (when `experimental`), single download button, and direct authorized link button (`sourceUrl`).
   - Empty, loading skeleton, and error states matching v0.1's refined visual craft.
3. **`src/ui/components/AiWorkflowPanel.tsx`**:
   - Clean 2-segment toggle or stacked workflow:
     - **课程资料包导出**：
       1. Course multi-select chips (all courses or specific courses)
       2. Export mode cards:
          - `完整课程知识库 (.zip)` (`knowledge-base`)
          - `NotebookLM 资料包 (.zip)` (`notebooklm`)
          - `AI Context Pack (.zip)` (`ai-context`)
          - `结构化 JSON (.json)` (`json-only`)
          - `课程索引 Markdown (.md)` (`markdown-only`)
       3. Live summary showing included course count, material count, missing/unfetchable resource notice, and last sync time + primary export button + progress/cancel feedback.
     - **快捷 Prompt 复制**：embeds existing `<PromptPanel app={app} />` cleanly so zero v0.1 prompt features are lost!
4. **Update `DdlDrawer.tsx`, `SettingsPanel.tsx`, `Icons.tsx`, `drawer.css`**:
   - Upgrade drawer tabs cleanly to 4 tabs (`待办看板`, `课程资源`, `AI 工作流`, `设置`) with crisp icons and compact fit on 420–460px drawer width.
   - In `SettingsPanel.tsx`, show a compact resource index / endpoint diagnostic summary inside the existing collapsible「高级与诊断」section (with experimental endpoint badges!).
   - Keep Shadow DOM CSS tokens in `drawer.css` consistent across light and dark modes.
5. Run `npm run typecheck`, `npm test`, and `npm run build`, commit on your worktree branch, and return a structured 13-point Handoff Report.
