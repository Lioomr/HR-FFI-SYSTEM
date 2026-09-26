# System Design Context

> **TL;DR:** The backend is Django 6.1.1 + DRF (`Backend/requirements.txt`) with PostgreSQL as the production database. The web app uses React 19, TypeScript, Vite, Ant Design, React Router 7, and Zustand (`FrontEnd/package.json`). The employee app uses Expo SDK 57 (`MobileApp/package.json`). Backend authorization, request status, and company scope are enforced server-side. For approvals, read `workflow_engine.md`; for live routes, read `plans/API Route Status Matrix.md` and verify Django source.

## Current stack

| Layer | Technology | Source to verify |
|---|---|---|
| Backend/API | Django 6.1.1, Django REST Framework | `Backend/requirements.txt`, `Backend/config/settings.py` |
| Database | PostgreSQL in production; local/test overrides are configuration-dependent | `Backend/config/settings.py`, Docker Compose files |
| Web | React 19, TypeScript, Vite, Ant Design, React Router 7, Zustand | `FrontEnd/package.json`, `FrontEnd/src/routes/` |
| Mobile | Expo SDK 57, React Native 0.86, TypeScript, Expo Router | `MobileApp/package.json`, `MobileApp/README.md` |
| Tests | pytest + pytest-django; Vitest + Testing Library; mobile test scripts | Each project's package/config files |

Versions move. Do not copy them into new specs without checking the dependency files.

## Backend domain map

The Django project includes domain apps for accounts, organization, shared workflow/core services, employees, job offers, contract ratings, attendance, leave, permission requests, loans, payroll, assets, rents, HR reference data, notifications, audit, invitations, and administration. This is a navigation aid, not a complete or frozen app registry; verify `INSTALLED_APPS` and the app source before making assumptions.

## Cross-cutting rules

- **Feature design:** Map related features, users, data, workflows, and business rules before proposing a new feature. Extend shared system capabilities when they fit. Choose a standalone feature only for a genuinely separate purpose or lifecycle, document the reason and how users reach it, and avoid parallel workflow/permission/notification systems without a clear need. See `AGENTS.md` for the repository-wide rule.
- **Requests and approvals:** Domain services own request transitions; `core` projects workflow status/history and actor permissions. A request can also connect to a dashboard summary, role inbox, detail page, obligations, notifications, and audit. Trace all of these links before changing a request flow. Read `workflow_engine.md`.
- **Approval trail UX:** Employee Current Requests currently displays a summary and links to request-specific pages. Leave pages provide the reference experience through `LeaveApprovalMap` and `ApprovalTimeline`. Preserve access to the true approval history for each request kind; do not fabricate a timeline from a status label. Check whether a linked request kind (notably annual-leave settlements) actually has a dedicated detail/history route before claiming parity.
- **Feature toggles:** Locate a toggle's definition, default, server/client consumers, and tests before changing related behavior. Inspect the current setting first; do not flip a toggle unless requested.
- **Company scope:** Backend organization and permission services decide which companies and records a user can access. Models do not all share the same company-field shape. A company header/selector gives context only after backend authorization.
- **Authentication and roles:** Check current permission classes, role guards, and endpoint behavior. A hidden frontend button is not authorization.
- **Audit and notifications:** Preserve existing audit events and next-approver notifications when changing sensitive transitions. Check provider configuration rather than assuming delivery is active.
- **Files:** Follow private storage and authenticated download rules for sensitive employee documents and request attachments.
- **Bilingual UI:** Use the existing English/Arabic translation system and verify right-to-left behavior for visible changes.

## Source-of-truth map

- Repository workflow and agent rules: `AGENTS.md`
- Integrated feature navigation (cross-module tasks): `.agents/context/system_map.md`
- Security: `SECURITY_POLICY.md`
- API conventions: `plans/Global API Rules (v1).txt`
- Live route inventory/status: `plans/API Route Status Matrix.md` (then verify Django URL/ViewSet)
- Approval engine and UI links: `.agents/context/workflow_engine.md`
- Other focused architecture notes: `.agents/context/INDEX.md`
- Dated plans, audits, and handoffs describe their stated scope/date; confirm whether they were superseded or implemented before treating them as current instructions.

If a plan disagrees with the implementation, record the mismatch and confirm the intended behavior before changing an API or security contract.
