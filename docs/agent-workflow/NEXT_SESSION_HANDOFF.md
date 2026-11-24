# Next Session Handoff (v0.2.0-beta → v0.3 MCP Server / CLI)

> Updated: 2026-11-25  
> Current released tag: **`v0.2.0-beta`** on `main` (`https://github.com/Mashiachers/yuketang-ddl-helper/releases/tag/v0.2.0-beta`)  
> Local repo root: `W:\yuketang` (registered in T3 Code as project `yuketang-ddl-helper`)

## 1. What Is Already Done & Verified

- **v0.1.0-beta** (all preserved with zero regression): DDL board, Shadow DOM isolation, RFC 5545 `.ics` export with 3-stage `VALARM` reminders & stable UIDs, TBD no-deadline tasks + personal targets + teacher-added DDL detection, stale task age filter (default 100d), structured AI Prompt copy.
- **v0.2.0-beta** (shipped & verified, **119/119 automated tests passing**, zero new runtime dependencies, minimal MV3 permissions `["storage", "clipboardWrite"]` + `["https://*.yuketang.cn/*"]`):
  - Unified API-decoupled domain schema `0.2.0` (`src/types/resources.ts`).
  - Resource discovery adapter (`src/core/resources/adapter.ts`, `endpoints.ts`), zero-dependency safe naming/ZIP/PDF 1.4 slide merger (`naming.ts`, `zip.ts`, `pdf.ts`), SHA-256 incremental index (`indexStore.ts`) + confirmed reset button, batch download (`downloadService.ts`), 5 AI-ready export modes (`exportService.ts`), UI-free `CourseProvider` (`resourceService.ts`).
  - **Live-verified on `changjiang.yuketang.cn` (2026-11-25)** across **7 endpoints**:
    `courses-v2-list`, `classroom-detail-v2`, `learn-logs-v2`, `course-progress-c27`, `lesson-summary-v3`, `lesson-presentation-v3`, `discussion-announcements-v2`, plus slide CDN `yangtse-pri-ups.yuketang.cn` (CORS `200 OK`, JPEG `ff d8 ff e0`, verified 104-page 19.2 MB PDF merge).
  - Remaining **6 cross-branch fallback endpoints** stay explicitly flagged `experimental: true` (`courses-mooc-user`, `course-chapter-mooc`, `courseware-pub-news`, `leaf-info-mooc`, `cards-detlist-v2`, `course-homework-v2`).
  - Security & red-team audit complete (`docs/agent-workflow/reports/SECURITY_REVIEW.md`, `TEST_PLAN.md`, `FINAL_REVIEW.md`); all P0 and P1 findings resolved.

## 2. Owner Preferences & Environment Constraints

- **Language**: Communicate in Simplified Chinese; keep code, identifiers, CLI commands, filenames, and standard technical terms in English.
- **Model Quota Preference**: Prefer **Codex / GPT** as the primary workhorse for implementation, architecture, and testing to conserve the owner's Gemini quota; use Gemini selectively for targeted review or research if needed.
- **Strict Non-Negotiable Boundaries**: Local-first, Privacy-first, Strictly Read-only, AI-agnostic. NEVER implement auto-attendance, auto video playback, auto answering, auto submission, or DRM/access-control bypass.
- **Git & Untracked Files**:
  - Local `.github/workflows/` (`ci.yml`, `release.yml`) currently stays untracked in `W:\yuketang` because the owner's `gh` OAuth token does not yet include the `workflow` scope (`gh auth refresh -h github.com -s workflow` will enable pushing them). Do NOT overwrite or delete `.github/workflows/`.
  - Never push `main` or publish a GitHub Release without explicit owner confirmation.
  - Because this new thread runs directly in `W:\yuketang`, parallel child agents can now use real `isolation: "worktree"`.

## 3. Recommended Next Milestones

### Option A — v0.3: Standalone MCP Server & CLI (Primary Roadmap Goal)
Reuse `src/core/resources/` directly (already UI-free and React-free) to expose the 9 planned MCP Tools (`list_courses`, `get_course`, `list_assignments`, `get_upcoming_deadlines`, `list_course_materials`, `download_material`, `export_course`, `get_sync_status`, `get_changes_since`).
Required Node.js adapter layer (detailed in `docs/JSON_SCHEMA.md` §2):
1. Injectable Node `fetchImpl` that attaches the user's local session `Cookie` header without leaking cookies into domain models.
2. Node `fetch` `redirect: 'manual'` 3xx-to-login classification as `unauthorized` (browsers return `opaqueredirect`).
3. File-backed `loadIndex` / `saveIndex` persistence (e.g., `~/.yuketang-connector/index.json`).
4. Injectable Node `SlideImageConverter` for non-JPEG PNG/WebP slides (e.g., optional `sharp` inside the MCP package only, keeping the browser extension zero-dependency).

### Option B — v0.2.1 Maintenance & Cross-Branch Hardening (Optional Quick Wins)
- Collect real-account feedback from `www.yuketang.cn` / `pro.yuketang.cn` / `huanghe.yuketang.cn` testers via the `branch-compat.md` Issue template.
- Address remaining P2 security backlog from `SECURITY_REVIEW.md` (strict external download redirect policy `P2-02`, global discovery call budget `P2-03`, evaluate upgrading dev-only `vitest` major version `P2-05`).
- Push `.github/workflows/` after `gh auth refresh -s workflow`.

## 4. Key Entry Files to Read First

1. `AGENTS.md`
2. `docs/agent-workflow/NEXT_SESSION_HANDOFF.md` (this file)
3. `docs/JSON_SCHEMA.md`
4. `docs/agent-workflow/ARCHITECTURE.md` & `docs/agent-workflow/CONTRACTS.md`
5. `docs/agent-workflow/reports/API_RESEARCH.md` & `docs/agent-workflow/reports/SECURITY_REVIEW.md`
