# Acceptance Criteria — v0.2.0-beta

1. **Backward Compatibility**: All 22 existing v0.1 unit tests continue passing without weakening assertions; DDL board, `.ics` export, Prompt copy, local overrides, and demo mode remain intact.
2. **Unified Data Model**: `Course`, `CourseMaterial`, `Assignment`, `Exam`, `Announcement`, `CourseResourceIndex`, `DownloadRecord`, `ExportManifest`, and `CourseProvider` are cleanly typed with `schemaVersion: '0.2.0'` and zero credential leakage.
3. **API Research & Adapter**: `docs/agent-workflow/reports/API_RESEARCH.md` documents open-source references (`powercess/yuketang-mcp`, `siye4366/xxt-Tool`, `onethu.github.io/docs/`), licenses, verified vs experimental endpoints, pagination, retry/timeout/cancel, and sanitized fixtures.
4. **Download & Packaging**: Single download, batch download, progress, retry, cancel, safe cross-platform Chinese filenames, path-traversal defense, slide image → PDF merging (preserving order & quality), and ZIP packaging all verified by automated tests.
5. **AI-Ready Exports**: Knowledge Base ZIP, NotebookLM-friendly pack, AI Context Pack (`course_overview.md`, `upcoming_deadlines.md`, `material_index.md`, `context.json`, `study_prompt.md`), JSON-only, and Markdown-only exports verified with no fake/empty placeholder files.
6. **Incremental Index**: Stable `resourceKey`, SHA-256 checksum deduplication, new/updated detection, failed download tracking, and skip-already-downloaded support verified by tests.
7. **UI & Demo Mode**: Shadow DOM isolated `课程资源` and `AI 工作流` views in light/dark themes with loading/empty/error/progress states and full Demo Mode support.
8. **Security & Independent Review**: Agent D completes `TEST_PLAN.md`, `SECURITY_REVIEW.md`, and QA/security test suite; Agent E completes independent `FINAL_REVIEW.md`; all P0/P1 findings fixed.
9. **Build & Package**: `npm run typecheck`, `npm test`, `npm run build`, `npm run package` all pass cleanly, producing `release/yuketang-ddl-helper-v0.2.0-beta.zip`.
