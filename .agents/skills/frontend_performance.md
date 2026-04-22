# Frontend Performance Skill

Use for slow screens, large tables, expensive renders, and bundle concerns.

Checklist:
- Avoid unnecessary global state updates.
- Memoize expensive derived data only where profiling or code shape justifies it.
- Paginate server-side for large HR data sets.
- Debounce search/filter calls when appropriate.
- Keep route-level code splitting if the project already uses it.

Validate with build output and targeted browser checks for user-visible issues.
