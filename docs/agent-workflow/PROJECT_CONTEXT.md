# Project Context & Phase 0 Codebase Audit

## 1. Current Repository Architecture (v0.1.0-beta Baseline)

- **Extension Entrypoints**:
  - `public/manifest.json`: MV3 manifest with minimal permissions (`storage`, `clipboardWrite`) and `host_permissions: ["https://*.yuketang.cn/*"]`.
  - `src/content/index.tsx`: Injects `<ContentApp useShadowDom />` on verified `https://*.yuketang.cn` pages.
  - `src/background/index.ts`: Lightweight MV3 service worker handling `UPDATE_BADGE`, `GET_LATEST_SUMMARY`, and validated `OPEN_URL`.
  - `src/popup/`: Quick status popup reading latest badge summary from `chrome.storage.local`.
  - `src/preview/`: Standalone local sandbox (`preview.html`) running `<ContentApp defaultDemoMode />`.
- **Domain Core (`src/core/`)**:
  - `platform/detector.ts`: Strict HTTPS `*.yuketang.cn` validation, safe cookie parsing (`Object.create(null)`), and sanitized header builder (`x-csrftoken`, `xtbz`, `university-id`, `classroom-id`).
  - `queue/rateLimitedQueue.ts`: Concurrency-limited + start-interval-throttled async queue with `AbortSignal` support and per-task failure isolation (`PromiseSettledResult`).
  - `api/endpoints.ts` & `api/client.ts`: Multi-branch endpoint probing with `credentials: 'include'`, `mode: 'same-origin'`, `redirect: 'manual'`, and sanitized diagnostics (no cookies/tokens/IDs leaked).
  - `normalizer/normalizer.ts`: Unwraps heterogeneous course/task payloads, parses Changjiang v2 learn logs (`type: 4/5`, `status: 0/1/2/3`), filters non-task items without deadlines, maps fallback links to `/v2/web/studentLog/{classroomId}`.
  - `ics/builder.ts`: Zero-dependency RFC 5545 generator with UTF-8 75-octet folding, stable UIDs, and `VALARM` reminders.
  - `prompt/formatter.ts`: Markdown task table + preset/custom prompt templating + clipboard helper.
  - `storage/storage.ts`: Wrapper over `chrome.storage.local` with `localStorage`/in-memory fallback for tests and preview.
  - `service/ddlService.ts`: Orchestrates sync, TTL cache, deadline change detection, age filtering, and local overrides.
- **UI Layer (`src/ui/`)**:
  - `hooks/useDdlApp.ts`: React state controller for board, prompt, settings, selection, and toasts.
  - `components/`: `DdlDrawer`, `FloatingDock`, `TaskCard`, `PromptPanel`, `SettingsPanel`, `MarkdownPreview`, `Icons`.
  - `styles/drawer.css`: Self-contained light/dark theme tokens injected directly into Shadow DOM (`?inline`).
- **Tests**: `tests/core.test.ts` (22 unit tests passing via Vitest 3).

## 2. Directly Reusable Modules

- `detectPlatform`, `isYuketangHost`, `buildRequestHeaders` (`src/core/platform/detector.ts`)
- `runRateLimitedQueue` (`src/core/queue/rateLimitedQueue.ts`)
- `buildIcsContent` (`src/core/ics/builder.ts`) — directly reused for `deadlines.ics` inside exported course knowledge bases!
- `formatAiPrompt` (`src/core/prompt/formatter.ts`) — reused and extended for `AI_Context/study_prompt.md`
- `storage.ts` storage abstraction (`chrome.storage.local` + test fallback)
- `normalizeCourses`, `normalizeHomework`, `parseTimestamp`, `unwrapRows` (`src/core/normalizer/normalizer.ts`)
- Shadow DOM theming & component CSS variables (`src/ui/styles/drawer.css`)

## 3. Current Data Fetching Limitations

1. Only fetches 1 page (`page=0&offset=50`) of `/v2/api/web/logs/learn/{classroom_id}` — lacks pagination for large courses.
2. Filters out slides (`type: 2`), videos (`type: 17`), announcements (`type: 6/9/15`), and courseware chapters (`leaf_type`/chapter trees) because v0.1 only modeled `HomeworkItem`.
3. No timeout wrapper or bounded transient retry on `fetch`.
4. No binary download pipeline, SHA-256 checksum computation, or local download record tracking.

## 4. Potential Technical Debt Identified

- `src/core/storage/storage.ts` had module-scoped `memory` Map without a reset helper (fine if keys are origin-isolated, should expose clean index storage helpers for resources).
- `src/ui/hooks/useDdlApp.ts` is already ~580 lines — new Resource Center & AI Workflow Center state MUST live in a separate dedicated hook (`src/ui/hooks/useResourceCenter.ts`) instead of bloating `useDdlApp.ts`.
- `scripts/build.mjs` builds `preview.html` into `dist/` (harmless, keep build pipeline stable without breaking `npm run dev` / `npm run package`).

## 5. New Modules Required for v0.2

1. `src/types/resources.ts`: Unified, API-decoupled domain models (`Course`, `CourseMaterial`, `Assignment`, `Exam`, `Announcement`, `CourseResourceIndex`, `DownloadRecord`, `ExportManifest`, `CourseProvider`).
2. `src/core/resources/endpoints.ts` & `src/core/resources/adapter.ts`: Paginated resource discovery, chapter/slide/attachment/announcement extraction, explicit `experimental` tagging, safe HTML stripping, strict URL validation.
3. `src/core/resources/naming.ts`: Cross-platform safe filename & path sanitizer (Windows/macOS/Linux, Chinese-friendly, collision deduplication, path traversal prevention).
4. `src/core/resources/zip.ts`: Zero-dependency ZIP archive writer (UTF-8 filenames, CRC32, STORE/DEFLATE, safe relative paths).
5. `src/core/resources/pdf.ts`: Zero-dependency pure-TS PDF 1.4 slide-image merger (preserves original JPEG quality without downsampling, supports PNG/WebP via canvas when in browser, preserves page order).
6. `src/core/resources/indexStore.ts`: Versioned `CourseResourceIndex` storage, SHA-256 hashing (`crypto.subtle.digest`), new/updated/duplicate detection, failed download tracking.
7. `src/core/resources/resourceService.ts`, `downloadService.ts`, `exportService.ts`: MCP-ready domain services completely independent of React/UI.
8. `src/core/resources/demoResources.ts`: Rich demo materials/chapters/announcements/generated sample bytes so Demo Mode tests the full download & export pipeline without live login.
9. `src/ui/hooks/useResourceCenter.ts`, `src/ui/components/ResourceCenterPanel.tsx`, `src/ui/components/AiWorkflowPanel.tsx`: Shadow DOM UI integrated cleanly into `DdlDrawer`.

## 6. Manifest V3 Technical Constraints & Mitigations

- **Service Worker Ephemerality (30s idle kill)**: Do NOT run long batch fetches, PDF assembly, or ZIP packaging inside `background.js`. Execute them in the foreground tab/content-script context (or popup/preview) with `AbortController`, where downloads run continuously while the drawer is open and can be cancelled cleanly.
- **No Unnecessary Permission Creep**: Keep `permissions: ["storage", "clipboardWrite"]` and `host_permissions: ["https://*.yuketang.cn/*"]`. Use Blob + `<a download>` for single files and ZIP exports (universally supported across Chrome, Edge, and local preview without `downloads` permission).
- **CORS on External CDN Files**: Same-origin `*.yuketang.cn` and CORS-enabled CDNs fetch directly into memory for ZIP/PDF assembly. If a signed third-party CDN blocks CORS reads, never fabricate success: classify as `cors-blocked`, record in `missingItems` / failed stats, and offer a direct authorized link fallback.
- **Memory Bounds**: Enforce configurable `maxTotalBytes` guard (default 150 MB per ZIP batch), process files with bounded concurrency (`concurrency: 2`, `intervalMs: 250`), release intermediate buffers promptly, and allow per-course or filtered selection.

## 7. Minimal-Invasive Refactor Plan

- Keep ALL existing v0.1 files (`ddlService.ts`, `normalizer.ts`, `ics/builder.ts`, `prompt/formatter.ts`, `TaskCard.tsx`, `SettingsPanel.tsx`) backward compatible with zero breaking API changes.
- Add all v0.2 resource/export domain logic under `src/core/resources/` and re-export from `src/core/index.ts`.
- Add 2 clean tabs in `DdlDrawer.tsx` (`资源中心` and `AI 工作流`, keeping `待办看板` / `AI 打包` / `设置` intact — or integrating `AI 工作流` cleanly with existing `AI 打包` tab so navigation stays crisp and uncrowded; see `ARCHITECTURE.md`).
