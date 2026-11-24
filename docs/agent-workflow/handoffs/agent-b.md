---
agent_id: agent-b
role: Core & Resource Export
model_preference: Codex (gpt-6.2-sol, reasoningEffort=high)
task_id: core-resource-export
status: ready
dependencies:
  - stage-0-contracts
allowed_paths:
  - src/core/resources/naming.ts
  - src/core/resources/zip.ts
  - src/core/resources/pdf.ts
  - src/core/resources/indexStore.ts
  - src/core/resources/downloadService.ts
  - src/core/resources/exportService.ts
  - src/core/resources/resourceService.ts
  - src/core/resources/demoResources.ts
  - tests/resource-export.test.ts
forbidden_paths:
  - src/types/
  - src/ui/
  - public/manifest.json
  - src/core/resources/adapter.ts
  - src/core/resources/endpoints.ts
deliverables:
  - src/core/resources/naming.ts
  - src/core/resources/zip.ts
  - src/core/resources/pdf.ts
  - src/core/resources/indexStore.ts
  - src/core/resources/downloadService.ts
  - src/core/resources/exportService.ts
  - src/core/resources/resourceService.ts
  - src/core/resources/demoResources.ts
  - tests/resource-export.test.ts
acceptance_criteria:
  - Zero new npm dependencies; pure TypeScript ZIP (UTF-8, CRC32) and PDF 1.4 (DCTDecode JPEG slide merger preserving page order & clarity).
  - Safe cross-platform filename/path sanitization preventing traversal, Windows reserved names, control chars, and collisions while supporting Chinese filenames.
  - DownloadService supports single/batch download, concurrency limit, timeout, bounded retry, AbortSignal cancel, CORS/size-limit classification, SHA-256 checksum, and skip-already-downloaded.
  - ExportService supports knowledge-base, notebooklm, ai-context, json-only, and markdown-only modes with zero fake/empty files and explicit prompt-injection guardrails in study_prompt.md.
  - ResourceService implements CourseProvider and MCP-ready methods without touching DOM/React.
  - All unit tests pass alongside existing tests.
---

# Agent B Handoff Brief — Core & Resource Export Services

Read `AGENTS.md`, `docs/agent-workflow/PROJECT_CONTEXT.md`, `docs/agent-workflow/ARCHITECTURE.md`, and `docs/agent-workflow/CONTRACTS.md` first.

## Objectives
Implement the entire platform-agnostic, UI-free resource packaging, downloading, indexing, and AI-ready export engine under `src/core/resources/` strictly conforming to `src/types/resources.ts` and `docs/agent-workflow/CONTRACTS.md` Section 4.2:

1. **`naming.ts`**:
   - Cross-platform safe filename & path segment sanitizer (Windows/macOS/Linux), Chinese-safe, strips control chars / `< > : " / \ | ? *`, guards Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`), prevents `..` traversal and absolute paths, enforces sensible max length preserving file extension, and handles collision deduplication (`file.pdf`, `file (2).pdf`, ...).
2. **`zip.ts`**:
   - Zero-dependency pure-TS ZIP archive builder (`buildZipArchive`) with standard IEEE CRC32, UTF-8 general purpose bit flag (`0x0800`), valid DOS timestamps, STORE method (zero compression risk for PDFs/JPGs/PPTX and universally readable by Windows Explorer, macOS Archive Utility, Linux `unzip`, Python `zipfile`), path normalization/traversal rejection, and `readZipEntryNames` helper for verification.
3. **`pdf.ts`**:
   - Zero-dependency pure-TS PDF 1.4 generator (`buildPdfFromJpegPages` + `mergeSlideImagesToPdf`).
   - Preserves original slide page order and embeds JPEG bytes directly via `/DCTDecode` without downsampling!
   - Parse JPEG SOF0/SOF2 markers to extract exact `width`/`height` when not supplied.
   - Accept injectable `SlideImageConverter` for non-JPEG images (PNG/WebP → JPEG bytes via browser `createImageBitmap` + `canvas` when running in browser; fail cleanly with `unsupported-format` if no converter is available in Node tests).
4. **`indexStore.ts`**:
   - `computeSha256Hex` using Web Crypto `crypto.subtle.digest('SHA-256', ...)` (works in Chrome/Edge MV3 and Node 22!).
   - Persist `CourseResourceIndex` (with `schemaVersion: RESOURCE_SCHEMA_VERSION`) via `chrome.storage.local` with `localStorage` / memory fallback (matching `src/core/storage/storage.ts` pattern, origin-isolated key `ykt-ddl:resource-index:${origin}`).
   - `reconcileMaterialsWithIndex` marks `isNew`, `downloaded`, `updated` (comparing `sourceUpdatedAt` or `size`), or `failed`.
   - `recordDownloadOutcome` updates `DownloadRecord` and detects duplicate content by `resourceKey` AND `checksum` (never filename alone).
5. **`downloadService.ts`**:
   - `createDownloadService` with injectable `fetchImpl`, `imageConverter`, `maxTotalBytes` (default 150 MB), concurrency limit (reusing `runRateLimitedQueue`), timeout, bounded retries, and `AbortSignal`.
   - Distinguishes `unauthorized`, `not-found`, `http-error`, `cors-blocked`, `timeout`, `cancelled`, `size-limit-exceeded`, `unsupported-format`, `network-error`. Never fabricates success when bytes cannot be retrieved.
   - Supports merging `slideImages` into a single ordered PDF when `mergeSlideImagesToPdf` is enabled and no direct file `downloadUrl` exists (or user prefers PDF).
   - Supports `demoResources` synthetic byte fallback cleanly via an injected byte resolver so Demo Mode works offline!
   - `triggerBrowserDownload(bytesOrBlob, filename, mimeType)` using `Blob` + `<a download>`.
6. **`exportService.ts`**:
   - Implements all 5 `ExportMode`s:
     - `knowledge-base`: `Yuketang/manifest.json`, `Yuketang/README.md`, `Yuketang/{term}/{courseName}/{README.md, course.json, materials.json, assignments.json, assignments.md, deadlines.ics?, 01_课件/?, 02_课程资料/?, 03_作业与习题/?, 04_课程公告/?}` — ONLY emit folders/files that have real content!
     - `notebooklm`: `Yuketang_NotebookLM/manifest.json`, `00_课程资料清单.md`, flattened per-course PDFs & Markdown docs with clear chapter prefixes, zero duplicates.
     - `ai-context`: `AI_Context/{course_overview.md, upcoming_deadlines.md, material_index.md, context.json, study_prompt.md}` with strict prompt-injection guardrails, separation of facts/inferences/missing info, and academic integrity reminder.
     - `json-only` & `markdown-only`: clean single-file or multi-file outputs with schema version and sanitized fields (strip any credential-like metadata keys).
   - Reuses `buildIcsContent` from `../ics/builder` for `deadlines.ics`!
7. **`resourceService.ts`**:
   - Implements `CourseProvider` (`listCourses`, `getCourse`, `listMaterials`, `listAssignments`, `listExams`, `listAnnouncements`) plus `syncResources`, `getUpcomingDeadlines`, `getSyncStatus`, `getChangesSince`.
   - Accepts an injected `discoverFn` (so Main Agent wires Agent A's `discoverCourseResources` in Stage 3 without Agent B touching `adapter.ts`!).
8. **`demoResources.ts`**:
   - Generates rich realistic demo `Course`, `CourseMaterial` (including PDF, PPTX, Word doc, image slides, attachment, video metadata), `Assignment`, `Exam`, and `Announcement`, plus `createDemoFileBytes` returning REAL valid PDF bytes / minimal valid JPEG bytes / Markdown bytes so Demo Mode downloads and ZIP/PDF exports genuinely work!
9. **`tests/resource-export.test.ts`**:
   - Thorough unit tests for naming, ZIP validity, PDF magic bytes & page ordering, SHA-256 index dedup/update, batch download cancel/retry/failure, all 5 export modes, prompt-injection defense, sensitive-field stripping, and demo mode.
10. Run `npm run typecheck` and `npm test`, commit on your worktree branch, and return a structured 13-point Handoff Report.
