---
agent_id: agent-a
role: API Research & Platform Adapter
model_preference: Antigravity (gemini-4-neon)
task_id: resource-discovery-adapter
status: ready
dependencies: []
allowed_paths:
  - docs/agent-workflow/reports/API_RESEARCH.md
  - src/core/resources/endpoints.ts
  - src/core/resources/adapter.ts
  - tests/fixtures/yuketang-resources.ts
  - tests/resource-adapter.test.ts
forbidden_paths:
  - src/types/
  - src/ui/
  - public/manifest.json
  - src/core/ics/
  - src/core/prompt/
deliverables:
  - docs/agent-workflow/reports/API_RESEARCH.md
  - src/core/resources/endpoints.ts
  - src/core/resources/adapter.ts
  - tests/fixtures/yuketang-resources.ts
  - tests/resource-adapter.test.ts
acceptance_criteria:
  - Open-source references (powercess/yuketang-mcp, siye4366/xxt-Tool, onethu.github.io/docs/) audited for endpoints, licenses, and applicable Yuketang branches.
  - All unverified endpoints explicitly flagged experimental: true; no fabricated verified claims.
  - Supports pagination, timeout, bounded retry, rate-limited concurrency, AbortSignal cancellation, safe HTML stripping, strict URL validation, and sanitized diagnostics.
  - Unit tests cover courses, chapters, slides, PDF/PPT/Word/attachments, announcements, unknown types, error classification, and credential/HTML sanitization.
---

# Agent A Handoff Brief — API Research & Platform Adapter

Read `AGENTS.md`, `docs/agent-workflow/PROJECT_CONTEXT.md`, `docs/agent-workflow/ARCHITECTURE.md`, and `docs/agent-workflow/CONTRACTS.md` first.

## Objectives
1. Research public/open-source Yuketang read-only course resource APIs via web search, specifically auditing:
   - `https://github.com/powercess/yuketang-mcp`
   - `https://github.com/siye4366/xxt-Tool`
   - `https://onethu.github.io/docs/`
   Record exact findings, repository licenses, applicable Yuketang branches (Changjiang vs Main vs Hetang/Pro vs Huanghe), known limitations (signed CDN URLs, expiration, CORS, pagination), and clearly separate verified vs experimental endpoints in `docs/agent-workflow/reports/API_RESEARCH.md`.
2. Implement `src/core/resources/endpoints.ts` and `src/core/resources/adapter.ts` strictly matching `src/types/resources.ts` and `docs/agent-workflow/CONTRACTS.md` Section 4.1:
   - Reuse `detectPlatform`, `buildRequestHeaders` from `../platform/detector`, `runRateLimitedQueue` from `../queue/rateLimitedQueue`, and `unwrapRows`, `parseTimestamp`, `normalizeCourses`, `normalizeHomework` from `../normalizer/normalizer`.
   - Support pagination for `/v2/api/web/logs/learn/{classroom_id}` (with configurable `maxPages`, safe loop termination).
   - Extract courses, chapters/sections, slides (`type: 2`, PPT/PDF/image slides), courseware materials & attachments, announcements (`type: 6/9/15`), and map homework/exams cleanly into `Assignment` / `Exam`.
   - Implement `fetchWithTimeoutAndRetry` with bounded retries (transient network/5xx only, never retry 401/403/404), `AbortSignal` support, and clear error classification (`unauthorized`, `not-found`, `http-error`, `network-error`, `invalid-response`, `timeout`, `cancelled`).
   - Implement `stripHtmlToText` safely with pure string/regex parsing (never DOM `innerHTML`) and `sanitizeResourceUrl` (reject non-http(s), embedded credentials, `javascript:`, `data:`).
   - Never leak cookies/tokens/session IDs into `CourseMaterial.metadata`, `Announcement`, or `ResourceEndpointDiagnostic`.
3. Create sanitized test fixtures in `tests/fixtures/yuketang-resources.ts` and comprehensive unit tests in `tests/resource-adapter.test.ts`.
4. Verify with `npm run typecheck` and `npm test`, commit on your worktree branch, and return a structured 13-point Handoff Report.
