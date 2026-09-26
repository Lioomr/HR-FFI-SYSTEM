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

PRs should include:
- Scope summary (backend/frontend/apps touched)
- Linked plan or issue (`plans/*.txt` reference)
- Test evidence (commands run + results)
- UI screenshots for frontend changes
- Notes for migrations, env vars, or breaking API changes

## Security & Configuration Tips
Keep secrets in `.env` (never commit credentials).  
Validate role-based permissions server-side for every endpoint.  
Run pre-commit checks before pushing: `pre-commit run --all-files`.

## Deployment Handoff
For AWS production deployment, Docker service layout, real server paths, and production debugging workflow, read `AWS_AGENT_DEPLOYMENT_HANDOFF.md` before making deployment-related changes.

## Agent Knowledge & Context Strategy
You have access to a rich context library in the `.agents/` directory. To maximize performance and keep token usage low:
- **Do not guess architecture, project standards, or workflows.** 
- **Start here:** Always read `.agents/context/INDEX.md` first to map your current task to the correct context file.
- **Lazy Load:** Only use `view_file` to read the specific files from `.agents/context/`, `.agents/rules/`, or `.agents/skills/` that are explicitly required for your task. Do NOT bulk-load the entire folder.
- **Cross-module map:** For architecture, feature planning, or work crossing modules, read `.agents/context/system_map.md` after the index. For a narrow task, skip it and load only the matching context note(s).

## Trace Linked Features Before Changes

Before editing a feature, identify its connected screens, API clients/routes, backend models/serializers/services, permissions and company scope, workflow history/delegation, notifications/audit, feature flags or runtime toggles, translations, and tests. Use source search and the repository's `graphify` map where available. Do this impact check before changing code or toggles; inspect each relevant toggle's default and consumers, and never flip a toggle unless the task explicitly asks.

## Design Features to Fit the Existing System

Before proposing a new feature, map the related features, shared data, users, workflows, and business rules. Prefer extending existing models, APIs, approval workflows, inboxes, notifications, and UI components when they fit. A feature may have its own pages and business rules while still using those shared capabilities. Make it standalone only when its purpose or lifecycle is genuinely separate; document why it is separate and how users reach it. Do not create parallel approval, permission, or notification systems without a clear reason.

## Refresh Docker After Runtime Changes

Before reporting a code or runtime change complete, rebuild and recreate the Docker service(s) that contain the changed files so the running system uses the new version. Backend code/dependency changes normally require `backend`, `notification-worker`, and `celery-beat`; frontend changes require `frontend`; Compose or shared-image changes require every affected service. Then check the selected Compose stack with `docker compose ... ps` and report the result. Use the correct Compose file/profile from `.agents/context/local_dev_setup.md`. Never use `down -v` as a routine rebuild because it deletes persistent volumes. Documentation-only changes do not need a container rebuild. If Docker is unavailable or rebuilding fails, state which service was not refreshed; do not claim it is updated.

For request and approval work, read `.agents/context/workflow_engine.md`. The employee dashboard's **Current Requests** is a summary of leave, permission, loan, and annual-leave-settlement requests. Its cards link to request-specific experiences. The leave request list/detail is the current approval-trail example: `LeaveApprovalMap` shows stage progress, `ApprovalTimeline` shows recorded decisions, and `PendingActionBanner` identifies the current waiting stage/actor. Preserve or add a clear path from every affected request to its real approval trail. Do not infer a trail from status labels alone. Verify each request kind separately; annual-leave settlements currently link to the balance page, so do not assume they have the same detail/history route as leave.

When a task asks for a request page to show approval progress, determine whether it means the summary card, request list, or request detail, then keep the linked experiences consistent. Confirm backend workflow history and actor-specific serializer fields are available before implementing the UI. Update the relevant tests and focused context docs with any behavior change.

## Engineering References

For work involving API schemas, frontend/backend type alignment, company-scoping safety, production migrations, Celery dispatch, or feature-level regression tests, read `.agents/context/engineering_references.md`. Apply the relevant PostHog and Vinta patterns incrementally in the existing FFI architecture; they do not replace FFI's plans, API rules, workflow engine, or security policy.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## AWS Guidance

- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed execution, observability, and audit logging. If unavailable, use the AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available. Load the skill with `retrieve_skill` and prefer its guidance over general knowledge.
- When uncertain about specific AWS details (API parameters, permissions, limits, error codes), verify against documentation rather than guessing. State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework principles.
- Do not use em dashes in AWS resource names or descriptions. Use hyphens instead.

### Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret, credential, API key, token, or password task. MUST NOT call `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST NOT hit the Secrets Manager Agent daemon directly. MUST use `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with `asm-exec` so the secret resolves at runtime without entering context.
