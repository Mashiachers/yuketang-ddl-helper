---
agent_id: agent-e
role: Independent Reviewer / Red Team
model_preference: Antigravity (gemini-4-neon)
task_id: independent-final-review
status: waiting_for_stage_3
dependencies:
  - stage-3-integration
allowed_paths:
  - docs/agent-workflow/reports/FINAL_REVIEW.md
forbidden_paths:
  - src/
  - tests/
  - public/
  - scripts/
deliverables:
  - docs/agent-workflow/reports/FINAL_REVIEW.md
acceptance_criteria:
  - Independent read-only review of final integrated codebase (not developer summaries).
  - Audits over-engineering, hidden assumptions, contract alignment, duplication, UX friction, Local-first/Read-only/AI-agnostic fidelity, compatibility claim honesty, and future MCP adoption cost.
  - Concrete counterexamples, edge cases, and P0/P1/P2/P3 prioritized recommendations.
---

# Agent E Handoff Brief — Independent Reviewer / Red Team (Stage 4)

Read-only independent reviewer launched after Stage 3 integration. Inspect actual code in `src/`, `tests/`, `public/manifest.json`, and `docs/` directly and produce `docs/agent-workflow/reports/FINAL_REVIEW.md`. Do NOT edit production code.
