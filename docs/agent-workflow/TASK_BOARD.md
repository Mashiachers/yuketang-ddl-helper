# Task Board — v0.2.0-beta

| Agent | Role | Model / Provider | Branch / Isolation | Owned Paths | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Agent 0 | Main Agent / Chief Architect | Antigravity (`gemini-4-neon`) | `develop/v0.2-resource-export` | `AGENTS.md`, `GEMINI.md`, `docs/agent-workflow/*`, `src/types/resources.ts`, `src/core/index.ts`, integration & release docs | in_progress |
| Agent A | API Research & Platform Adapter | Antigravity (`gemini-4-neon`) | worktree (`feat/api-resource-adapter`) | `docs/agent-workflow/reports/API_RESEARCH.md`, `src/core/resources/endpoints.ts`, `src/core/resources/adapter.ts`, `tests/fixtures/yuketang-resources.ts`, `tests/resource-adapter.test.ts` | pending |
| Agent B | Core & Resource Export | Codex (`gpt-6.2-sol`, high) | worktree (`feat/core-resource-export`) | `src/core/resources/{naming,zip,pdf,indexStore,downloadService,exportService,resourceService,demoResources}.ts`, `tests/resource-export.test.ts` | pending |
| Agent C | Frontend & Product Experience | Antigravity (`gemini-4-neon`) | worktree (`feat/resource-center-ui`) | `src/ui/hooks/useResourceCenter.ts`, `src/ui/components/{ResourceCenterPanel,AiWorkflowPanel,DdlDrawer,SettingsPanel,Icons}.tsx`, `src/ui/styles/drawer.css` | pending |
| Agent D | QA & Security | Codex (`gpt-6.2-sol`, high) | worktree (`test/resource-export-qa`) | `docs/agent-workflow/reports/{TEST_PLAN,SECURITY_REVIEW}.md`, `tests/qa-security.test.ts` | pending (Stage 4) |
| Agent E | Independent Reviewer / Red Team | Antigravity (`gemini-4-neon`) | read-only review | `docs/agent-workflow/reports/FINAL_REVIEW.md` | pending (Stage 4) |
