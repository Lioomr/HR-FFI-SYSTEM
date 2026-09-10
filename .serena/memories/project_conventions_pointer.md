# Project knowledge lives outside Serena memories

This repo already maintains a curated, actively-audited agent context system — do not duplicate it here:

- `.agents/context/INDEX.md` — start here; routes to stack overview, auth, multi-company/tenant scoping, workflow engine, etc.
- `.agents/rules/` — coding conventions (API, backend, frontend).
- `.agents/skills/` — domain workflow guides (payroll, leave, approvals, ...).
- `AGENTS.md` (repo root) — project structure, commands, documentation authority hierarchy.
- Documentation authority order: `SECURITY_POLICY.md` -> `plans/Employee Mobile App Master Plan.md` -> `plans/Global API Rules (v1).txt` -> `plans/API Route Status Matrix.md` -> `.agents/context/` -> `.agents/rules/` -> `.agents/skills/` -> `.agents/tasks/`.

Do not run Serena's `onboarding` tool or write new memories re-deriving project conventions, architecture, or domain rules — read the files above instead. Only write a new memory for something none of those files cover (e.g. a Serena-specific workflow quirk discovered while navigating code), and keep it short.
