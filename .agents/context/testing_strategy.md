# Testing Strategy Context

Backend:
- Test runner: `cd Backend && pytest`
- Pytest config lives in `Backend/pyproject.toml`.
- Test file patterns: `tests.py`, `test_*.py`, `*_tests.py`.
- Prefer app-level tests for serializers, views, permissions, and approval workflows.

Frontend:
- Test runner for one-shot agent verification: `cd FrontEnd && npm run test -- --run`; add test-file paths for focused runs. `npm run test` is interactive watch mode.
- Quality checks: `npm run lint`, `npm run type-check`, `npm run format:check`
- Add tests near behavior-critical UI and API integration boundaries.

Validation principle:
Run the narrowest useful command first, then broader checks when touching shared code, routes, permissions, or build config.
