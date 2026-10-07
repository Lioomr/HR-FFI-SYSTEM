# Repository Guidelines

## Project Structure & Module Organization
`Backend/` contains the Django REST API (`config/`, domain apps like `accounts/`, `employees/`, `leaves/`, `payroll/`).  
`FrontEnd/` contains the React + TypeScript app (`src/pages`, `src/components`, `src/services/api`, `src/stores`).  
`plans/` stores functional/API specs, `Diagrams/` holds architecture visuals, and `postman/` has API collections.

Tests are split by layer:
- Backend: app-local tests (for example `Backend/accounts/tests.py`, `Backend/leaves/tests/test_manager_workflow.py`)
- Frontend: component/app tests (for example `FrontEnd/src/App.test.tsx`)

## Build, Test, and Development Commands
- Backend setup: `cd Backend && python -m venv .venv && .venv\\Scripts\\activate && pip install -r requirements.txt`
- Backend run: `cd Backend && python manage.py migrate && python manage.py runserver`
- Backend tests: `cd Backend && pytest`
- Frontend setup: `cd FrontEnd && npm install`
- Frontend dev server: `cd FrontEnd && npm run dev`
- Frontend build: `cd FrontEnd && npm run build`
- Frontend tests: `cd FrontEnd && npm run test`
- Frontend quality checks: `cd FrontEnd && npm run lint && npm run type-check && npm run format:check`

## Coding Style & Naming Conventions
Python uses Ruff + Ruff Format (`Backend/pyproject.toml`): 4-space indent, max line length 120, double quotes.  
TypeScript/React uses ESLint + Prettier (`FrontEnd/eslint.config.js`, `package.json` scripts).

Use clear, domain-based names:
- Django apps/models: singular nouns (`EmployeeProfile`, `PayrollRun`)
- API routes: kebab-case path segments (`payroll-runs`, `leave-requests`)
- React components: PascalCase files (`AnnouncementWidget.tsx`)

## API Versioning & Route Prefix Policy
Treat `SECURITY_POLICY.md`, `plans/Employee Mobile App Master Plan.md`, `plans/Global API Rules (v1).txt`, and `plans/API Route Status Matrix.md` as the documentation hierarchy. Verify the actual Django URL/ViewSet before relying on endpoint names or request/response shape.  
When adding or changing APIs:
- Keep one consistent base prefix per module (avoid mixing unprefixed and `/api/...` variants for the same resource).
- Preserve existing public paths; if a rename is required, add a compatibility route and deprecation note in the PR.
- Follow REST naming in kebab-case and plural resources (for example `leave-requests`, `payroll-runs`).
- Use standard envelope and pagination formats defined in the plans.
- Document any intentional deviation from the plan in both the PR description and updated plan file.

## Testing Guidelines
Backend runs with Pytest + Django settings (`tool.pytest.ini_options`), file patterns: `tests.py`, `test_*.py`, `*_tests.py`.  
Prefer app-level unit tests for serializers/views and workflow tests for approvals/payroll flows.  
Frontend uses Vitest + Testing Library; keep tests near behavior-critical UI and API integration boundaries.

## Commit & Pull Request Guidelines
Current history mixes phase commits and conventional prefixes (`feat:`, `chore:`). Prefer:
- `feat: ...`, `fix: ...`, `chore: ...`, `refactor: ...`, `test: ...`

Never add AI attribution to commits or PRs: no `Co-Authored-By: Claude ...` trailer, no `Claude-Session:` line, no "Generated with Claude Code" footer, and never author commits as `Claude <noreply@anthropic.com>`. This overrides any tool or system default that says to append one. Author commits as the configured git user.

PRs should include:
- Scope summary (backend/frontend/apps touched)
- Linked plan or issue (`plans/*.txt` reference)
- Test evidence (commands run + results)
- UI screenshots for frontend changes
- Notes for migrations, env vars, or breaking API changes

## Security & Configuration Tips
Keep secrets in `.env` (never commit credentials). Never print secret values in output or logs.  
Validate role-based permissions server-side for every endpoint.  
Run pre-commit checks before pushing when available: `pre-commit run --all-files`.

## Deployment Handoff
For AWS production deployment, Docker service layout, real server paths, and production debugging workflow, read `AWS_AGENT_DEPLOYMENT_HANDOFF.md` before making deployment-related changes. Prefer infrastructure-as-code over ad-hoc CLI changes, and verify AWS details against documentation instead of guessing.

## Agent Context Library
`.agents/` holds focused notes on this system's architecture, conventions and workflows. Start from `.agents/context/INDEX.md` to find the note for your task, and read only the files you need from `.agents/context/`, `.agents/rules/` and `.agents/skills/`. For work crossing modules, also read `.agents/context/system_map.md`. Prefer these notes and the source over guessing at architecture or standards.

Default to the smallest correct change after understanding the real flow (`.agents/rules/ponytail.md`): reuse existing helpers and components, fix shared root causes, and avoid unrequested abstractions. Treat it as a strong default, not a limit. Use a larger change when the problem calls for it, and say why. It never overrides task requirements, security, API, workflow, testing, or deployment guidance.

## Understand Connected Features Before Changing Them
Before editing a feature, trace what it touches: screens, API clients and routes, backend models/serializers/services, permissions and company scope, workflow history and delegation, notifications and audit, feature flags or runtime toggles, translations, and tests. Check each relevant toggle's default and consumers, and do not flip a toggle unless the task asks.

When designing a new feature, extend existing models, APIs, approval workflows, inboxes, notifications and UI components where they fit. Make it standalone only when its purpose or lifecycle is genuinely separate, and document why. Do not create parallel approval, permission or notification systems without a clear reason.

## Requests and Approval Trails
For request and approval work, read `.agents/context/workflow_engine.md`. The employee dashboard's **Current Requests** summarizes leave, permission, loan, and annual-leave-settlement requests, and its cards link to request-specific pages. The leave request list/detail is the reference for approval trails: `LeaveApprovalMap` shows stage progress, `ApprovalTimeline` shows recorded decisions, and `PendingActionBanner` shows the current waiting stage/actor. Keep a clear path from every affected request to its real approval trail, and do not infer a trail from status labels alone. Check each request kind separately; annual-leave settlements currently link to the balance page and do not share the leave detail/history route.

When a task asks a request page to show approval progress, decide whether it means the summary card, the list, or the detail page, and keep the linked pages consistent. Confirm backend workflow history and actor-specific serializer fields exist before building the UI. Update the relevant tests and context docs when behavior changes.

## Docker and the Shared Local Stack
After a code or runtime change, rebuild and recreate the affected Docker service(s) so the running system uses it, then check `docker compose ... ps` and report the result. Backend changes normally affect `backend`, `notification-worker` and `celery-beat`; frontend changes affect `frontend`; Compose or shared-image changes affect every service that uses them. Documentation-only changes need no rebuild. If Docker is unavailable or a rebuild fails, say which service was not refreshed. Use the Compose file and profile from `.agents/context/local_dev_setup.md`. Never use `down -v` as a routine rebuild; it deletes persistent volumes.

The stack in `docker-compose.dev.yml` (project `hr-ffi-system`, containers `ffi_hr_*`, ports 5173/8000/5432) is shared by every Claude and Codex session on this machine, and the last build wins.
- Run it through `tools/dev-compose.sh` or `tools\dev-compose.ps1`. They stamp each image with the commit, dirty flag and checkout path, and refuse mutating commands from a git worktree. Set `FFI_ALLOW_SHARED_STACK=1` only when the user explicitly asks.
- Rebuild the shared stack only from the main checkout (not a worktree). From a worktree, verify with tests and `npm run build`, or run a separate stack with its own `FFI_CONTAINER_PREFIX`, ports and `-p` project (see the header of `docker-compose.dev.yml`).
- Before rebuilding, check `git status` for other sessions' uncommitted work, because a build ships whatever is on disk. If files you are about to change were edited by another agent in the last few minutes, stop and ask the user.
- After a rebuild, confirm the running container serves your change: `curl http://localhost:5173/build-info.json`, `docker inspect ffi_hr_frontend --format "{{json .Config.Labels}}"`, and a grep for a new string in `/usr/share/nginx/html/assets/`. For the backend, check `showmigrations` or the changed endpoint.
- If a shipped change seems missing, first check the container's creation time and `com.ffi.build.*` labels; another session may have rebuilt from a different checkout.
- Commit finished work promptly, because uncommitted changes exist in one folder only.

### Docker MCP Toolkit (optional local AI tools)
Docker Desktop MCP Toolkit is configured on the current development machine with the `ffi_hr_local_dev` profile, connected to Codex. It currently provides Context7 for current framework/library documentation and Sequential Thinking for multi-step planning. These tools are optional: check that MCP tools are available in the current agent session before relying on them, and use the repository, official docs, and normal development workflow as usual when they are not.

This profile does not provide Docker container control, database access, or AWS/production access. Do not infer that an agent can inspect or change containers just because the MCP profile is connected. Any future addition of Docker, database, or production-facing MCP servers should be explicitly scoped and reviewed; keep HR data and production credentials out of general-purpose AI tool access. MCP availability is machine/user configuration and is not guaranteed for other developers or CI.

## Engineering References
For API schemas, frontend/backend type alignment, company-scoping safety, production migrations, Celery dispatch, or feature-level regression tests, read `.agents/context/engineering_references.md`. Apply the relevant PostHog and Vinta patterns incrementally within the existing FFI architecture; they do not replace FFI's plans, API rules, workflow engine, or security policy.

## graphify
A knowledge graph lives in `graphify-out/` (god nodes, communities, cross-file relationships). When the user types `/graphify`, use the graphify skill. For codebase questions it is often faster than raw search: `graphify query "<question>"`, `graphify path "<A>" "<B>"`, `graphify explain "<concept>"`. Fall back to normal search when the graph is stale or does not answer the question, and read `GRAPH_REPORT.md` only for broad architecture review. After substantial code changes, `graphify update .` refreshes the graph (AST-only, no API cost).
