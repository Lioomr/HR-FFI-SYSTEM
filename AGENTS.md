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
Treat `plans/Global API Rules (v1).txt` as the source contract for endpoint names and request/response shape.  
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
