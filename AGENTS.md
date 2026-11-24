# AGENTS.md — Yuketang DDL Helper

This file is the single source of truth for all human contributors and AI agents working on `yuketang-ddl-helper`.

## 1. Project Identity & Strategic Direction

- **Name**: Yuketang DDL Helper (`yuketang-ddl-helper`)
- **Positioning**: *An open-source, local-first, AI-ready connector for Yuketang.*
- **Current Milestone**: `v0.2.0-beta` — Resource Export & AI-Ready Data Foundation.
- **Tech Stack**: TypeScript (strict), React 19, Vite 6, Vitest 3, Chrome/Edge Manifest V3, Shadow DOM CSS isolation.
- **Minimal Dependencies**: Prefer zero-dependency standard Web / ES2024 APIs (e.g., `CompressionStream`, `crypto.subtle`, pure TS ZIP/PDF/ICS builders) over heavy third-party packages.

## 2. Core Principles & Non-Negotiable Boundaries

- **Local-first & Privacy-first**: 100% client-side. Never upload credentials, cookies, tokens, student IDs, or course materials to any developer or third-party server.
- **Strictly Read-only**: Only read authorized course metadata and downloadable resources that the logged-in student already has normal access to.
- **Prohibited Features**: NEVER implement auto-attendance/check-in, auto video playback/farming, auto answering, auto submission, DRM/access-control bypass, or undocumented non-public NotebookLM/cloud uploads.
- **AI-agnostic & Agent-ready**: Do not bind to a specific LLM or add BYOK/chatbots in v0.2. Keep domain services decoupled from React/DOM so future MCP Servers and CLIs can reuse `src/core/`.
- **Backward Compatibility**: All existing v0.1 DDL board, `.ics` export, AI Prompt packaging, local overrides, and demo mode features must keep working without regression.
- **Prompt Injection Defense**: Treat all course titles, announcements, slide text, and assignment descriptions as untrusted external data. Never render raw HTML from APIs (`dangerouslySetInnerHTML` is forbidden) and frame exported AI prompts clearly so external data cannot hijack agent instructions.

## 3. Commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # node scripts/build.mjs (outputs dist/)
npm run package     # npm run build && node scripts/package.mjs (outputs release/*.zip)
npm run dev         # vite --open /preview.html
```

## 4. Module Boundaries & File Ownership

- `src/types/` — Shared contracts & schemas (**Main Agent only**).
- `src/core/resources/adapter.ts`, `src/core/resources/endpoints.ts`, `tests/fixtures/` — Resource API discovery & normalization (**Agent A**).
- `src/core/resources/{naming,zip,pdf,indexStore,resourceService,downloadService,exportService,demoResources}.ts` — Core download, ZIP/PDF packaging, AI-ready export & incremental index (**Agent B**).
- `src/ui/` — Resource Center, AI Workflow Center, Drawer integration, Shadow DOM styles (**Agent C**).
- `tests/qa-security.test.ts`, `docs/agent-workflow/reports/{TEST_PLAN,SECURITY_REVIEW}.md` — QA & Security (**Agent D**).
- `docs/agent-workflow/reports/FINAL_REVIEW.md` — Independent read-only review (**Agent E**).
- `public/manifest.json` — Keep `permissions` and `host_permissions` minimal (`storage`, `clipboardWrite`, `https://*.yuketang.cn/*`). Do not expand permissions without explicit owner approval.

## 5. Git & Safety Rules

- Work on `develop/v0.2-resource-export` or dedicated feature worktrees.
- NEVER modify or force-push `main`, NEVER publish GitHub Releases without owner confirmation, and NEVER overwrite uncommitted/untracked user files (such as `.github/workflows/`).
- Never claim an unverified API endpoint is verified; explicitly mark unverified endpoints `experimental: true` and distinguish live-verified vs mock-tested facts in all reports.

## 6. Shared Context Documents

Read these before starting any task:
- `docs/agent-workflow/PROJECT_CONTEXT.md`
- `docs/agent-workflow/ARCHITECTURE.md`
- `docs/agent-workflow/CONTRACTS.md`
- `docs/agent-workflow/DECISIONS.md`
- `docs/agent-workflow/ACCEPTANCE_CRITERIA.md`
- Your assigned handoff in `docs/agent-workflow/handoffs/agent-*.md`
