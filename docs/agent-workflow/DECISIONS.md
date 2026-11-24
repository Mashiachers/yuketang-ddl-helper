# Architecture Decision Records (ADRs)

## ADR-001: Keep Manifest V3 Permissions Strictly Minimal
- **Status**: Accepted
- **Decision**: Retain `permissions: ["storage", "clipboardWrite"]` and `host_permissions: ["https://*.yuketang.cn/*"]`. Do not request `<all_urls>` or `downloads` permission in v0.2.
- **Rationale**: Minimizes privacy footprint and Chrome Web Store review risk. Blob + `<a download>` handles single files and ZIP archives reliably across Chrome, Edge, and local preview. Cross-origin files blocked by CORS are transparently reported (`cors-blocked`) with authorized direct-link fallback rather than widening permissions.

## ADR-002: Run Batch Fetch / PDF / ZIP Packaging in Foreground Context (Not Service Worker)
- **Status**: Accepted
- **Decision**: Execute batch downloads, slide-to-PDF conversion, and ZIP generation in the active extension UI context (content script / preview) with `AbortController`.
- **Rationale**: MV3 Service Workers terminate after ~30s of inactivity and lack `HTMLCanvasElement` / `URL.createObjectURL`. Running in foreground tab context avoids mid-download termination and provides responsive live progress & cancellation.

## ADR-003: Zero-Dependency Pure-TS ZIP and PDF Builders
- **Status**: Accepted
- **Decision**: Implement lightweight, standard-compliant ZIP (CRC32 + UTF-8 flag, STORE mode) and PDF 1.4 (DCTDecode raw JPEG embedding) builders in TypeScript without adding npm packages.
- **Rationale**: Obeys Minimal Dependencies and eliminates supply-chain / third-party license risk, keeps bundle size tiny, preserves original slide JPEG clarity without recompression, and makes every byte deterministic and unit-testable.

## ADR-004: Explicit `experimental` Tagging for Unverified Resource Endpoints
- **Status**: Accepted
- **Decision**: Mark every resource API endpoint not directly verified against a live Changjiang Yuketang session with `experimental: true` and expose sanitized diagnostics + fixtures.
- **Rationale**: Prevents silent fabrication of API behavior and gives beta testers across Main/Hetang/Huanghe/custom Yuketang branches clear visibility and one-click diagnostic reporting.

## ADR-005: Dedicated `useResourceCenter` Hook & 4-Tab Drawer Layout
- **Status**: Accepted
- **Decision**: Isolate resource/export React state into `src/ui/hooks/useResourceCenter.ts` and upgrade `DdlDrawer` to 4 tabs (`待办看板`, `课程资源`, `AI 工作流`, `设置`), embedding existing `PromptPanel` inside `AI 工作流`.
- **Rationale**: Avoids bloating `useDdlApp.ts` (already ~580 LOC), keeps v0.1 DDL workflows 100% intact, and achieves the 3-step UX ("选择课程 → 选择导出模式 → 下载资料包").

## ADR-006: Untrusted Course Content & Prompt Injection Guardrails
- **Status**: Accepted
- **Decision**: Strip HTML tags safely without DOM execution, sanitize all filenames/paths, never include credentials in domain objects, and frame exported `study_prompt.md` with explicit data-vs-instruction boundaries.
- **Rationale**: Course titles, announcements, and assignments originate from external users/teachers and must be treated as untrusted input for both XSS and AI prompt injection defense.
