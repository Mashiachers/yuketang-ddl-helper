# Task Board — v0.2.0-beta

| Agent | Role | Model / Provider | Mode / Isolation | Owned Paths | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Agent 0 | Main Agent / Chief Architect | Antigravity (`gemini-4-neon`) | `develop/v0.2-resource-export` | `AGENTS.md`, `GEMINI.md`, `docs/agent-workflow/*`, `src/types/resources.ts`, `src/core/index.ts`, `src/ui/adapters/resourceBackend.ts`, Stage 3 integration, Stage 5 fixes & release docs | completed |
| Agent A | API Research & Platform Adapter | Antigravity (`gemini-4-neon`) | delegated (`shared`, disjoint ownership) | `docs/agent-workflow/reports/API_RESEARCH.md`, `src/core/resources/endpoints.ts`, `src/core/resources/adapter.ts`, `tests/fixtures/yuketang-resources.ts`, `tests/resource-adapter.test.ts` | completed |
| Agent B | Core & Resource Export | Codex (`gpt-6.2-sol`, high) | delegated (`shared`, disjoint ownership) | `src/core/resources/{naming,zip,pdf,indexStore,downloadService,exportService,resourceService,demoResources}.ts`, `tests/resource-export.test.ts` | completed |
| Agent C | Frontend & Product Experience | Antigravity (`gemini-4-neon`) | delegated (`shared`, disjoint ownership) | `src/ui/hooks/useResourceCenter.ts`, `src/ui/components/{ResourceCenterPanel,AiWorkflowPanel,DdlDrawer,SettingsPanel,Icons}.tsx`, `src/ui/styles/drawer.css`, `src/ui/hooks/useDdlApp.ts` (1 line) | completed |
| Agent D | QA & Security | Codex (`gpt-6.2-sol`, high) | delegated (Stage 4 audit) | `docs/agent-workflow/reports/{TEST_PLAN,SECURITY_REVIEW}.md`, `tests/qa-security.test.ts` | completed |
| Agent E | Independent Reviewer / Red Team | Antigravity (`gemini-4-neon`) | delegated (Stage 4 read-only review) | `docs/agent-workflow/reports/FINAL_REVIEW.md` | completed |
