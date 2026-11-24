---
agent_id: agent-d
role: QA & Security
model_preference: Codex (gpt-6.2-sol, reasoningEffort=high)
task_id: qa-and-security-audit
status: waiting_for_stage_3
dependencies:
  - agent-a
  - agent-b
  - agent-c
  - stage-3-integration
allowed_paths:
  - docs/agent-workflow/reports/TEST_PLAN.md
  - docs/agent-workflow/reports/SECURITY_REVIEW.md
  - tests/qa-security.test.ts
forbidden_paths:
  - src/types/
  - public/manifest.json
deliverables:
  - docs/agent-workflow/reports/TEST_PLAN.md
  - docs/agent-workflow/reports/SECURITY_REVIEW.md
  - tests/qa-security.test.ts
acceptance_criteria:
  - Independent verification of all build/test/package commands and regression checks.
  - Security review covers MV3 permissions, credential leak prevention, XSS, path traversal, filename injection, untrusted URLs, AI Prompt Injection, rate limits, and third-party dependency audit.
  - Dedicated automated test suite tests adversarial inputs and edge cases.
  - Clear P0/P1/P2/P3 defect classification and release sign-off recommendation.
---

# Agent D Handoff Brief — QA & Security Audit (Stage 4)

Launched after Stage 3 integration on `develop/v0.2-resource-export`. Do NOT trust developer summaries; inspect code directly, write adversarial tests in `tests/qa-security.test.ts`, and author `TEST_PLAN.md` and `SECURITY_REVIEW.md`.
