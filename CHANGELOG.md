# Changelog

All notable changes to **Yuketang DDL Helper** are documented in this file.

## [0.2.0-beta] — 2026-11-24

### Added
- **Unified Course Resource Data Model (`schemaVersion: "0.2.0"`)**: Added API-decoupled domain entities (`Course`, `CourseMaterial`, `Assignment`, `Exam`, `Announcement`, `CourseResourceIndex`, `DownloadRecord`, `ExportManifest`, `CourseProvider`) ready for future MCP Servers and CLIs.
- **Course Resource Discovery Adapter (`src/core/resources/adapter.ts`, `endpoints.ts`)**:
  - Added paginated learn-log scanning with duplicate-page cycle detection, per-attempt timeout, bounded transient retries, rate-limited concurrency, and `AbortSignal` cancellation.
  - Added chapter/courseware, slide page, attachment, and announcement extractors with pure-TS HTML stripping, strict URL validation, and explicit `experimental: true` flags for endpoints not yet verified against a live account.
  - Added sanitized endpoint diagnostics (never echoes cookies, tokens, student IDs, or unrecognized server error text).
- **Zero-Dependency Download & Packaging Engine (`src/core/resources/`)**:
  - Cross-platform safe filename/path sanitizer (Chinese-friendly, path traversal protection, Windows reserved device name guard, collision deduplication, active/executable extension neutralization).
  - Pure-TS UTF-8 STORE ZIP archive builder with IEEE CRC32.
  - Pure-TS PDF 1.4 slide image merger preserving original JPEG clarity (magic-byte sniffing + canvas conversion fallback for PNG/WebP) and page order.
  - Local SHA-256 incremental index (`CourseResourceIndex`) with new/updated detection, duplicate content tracking, and failed download persistence.
- **AI-Ready Course Knowledge Base Exports (`exportService.ts`)**:
  - **Knowledge Base (`.zip`)**: Structured `Yuketang/{term}/{course}/` directory with `manifest.json`, `README.md`, `course.json`, `materials.json`, `assignments.json`, `assignments.md`, `deadlines.ics`, and non-empty resource folders.
  - **NotebookLM Pack (`.zip`)**: Flattened per-course PDFs & Markdown docs with chapter prefixes and zero duplicate files.
  - **AI Context Pack (`.zip`)**: Lightweight text/JSON context (`course_overview.md`, `upcoming_deadlines.md`, `material_index.md`, `context.json`, `study_prompt.md` with prompt-injection & academic-integrity guardrails).
  - **Structured JSON (`.json`)** and **Course Index Markdown (`.md`)** single-file exports.
- **UI Upgrade (Shadow DOM isolated, Light/Dark)**:
  - Upgraded drawer to 4 tabs: **待办看板** / **课程资源** / **AI 工作流** / **设置**.
  - Added **Course Resource Center** (course selector, type filters, search, new/download status badges, single/batch download, live progress, cancel, retry failed, and announcements view).
  - Added **AI Workflow Center** (3-step export flow + embedded v0.1 Prompt Panel).
  - Expanded Settings diagnostics with resource index status and `experimental` endpoint badges.
  - Upgraded offline Demo Mode to support end-to-end resource browsing, PDF merging, and all 5 export modes without login.
- **Testing & Multi-Agent Engineering Docs**:
  - Added 87 new unit, adapter, export, and adversarial QA/security tests (109 total tests).
  - Added `AGENTS.md`, `GEMINI.md`, architecture/contracts/ADR docs, `API_RESEARCH.md`, `TEST_PLAN.md`, `SECURITY_REVIEW.md`, `FINAL_REVIEW.md`, `docs/JSON_SCHEMA.md`, and `docs/RESOURCE_EXPORT_GUIDE.md`.

### Security & Privacy
- Maintained minimal MV3 permissions (`storage`, `clipboardWrite`, `https://*.yuketang.cn/*`) with zero new runtime dependencies.
- Redacted credentials, signed query parameters (AWS/OSS/COS), and labeled student identifiers across JSON, Markdown, ICS, and diagnostics.
- Neutralized active/executable file extensions (`.exe`, `.bat`, `.cmd`, `.html`, `.svg`, etc.) across direct downloads, batch ZIPs, and exports.

## [0.1.0-beta] — 2026-11-24

### Added
- Initial Chrome / Edge MV3 extension with Shadow DOM DDL drawer & draggable floating dock.
- Changjiang Yuketang (`changjiang.yuketang.cn`) live verification for course & task aggregation (`type: 4/5`, `status: 0/1/2/3`).
- No-deadline (`截止待定`) support with personal target DDL & teacher-added DDL change detection.
- Configurable stale overdue / TBD age filtering (default 100 days).
- RFC 5545 `.ics` export with 3-stage `VALARM` reminders and stable deduplication UIDs.
- Structured AI Prompt presets, custom placeholder templates, and sanitized status sample export.
