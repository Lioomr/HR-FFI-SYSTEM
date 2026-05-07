# Frontend Agent Rules

Frontend lives in `FrontEnd/`. React 18 + TypeScript + Vite + Ant Design.

## Before Editing

1. Inspect the page/component, route config (`routes.tsx`), API service (`services/api/<domain>Api.ts`), store, and related types.
2. Check whether the page needs a `RequireRole` guard.
3. Confirm i18n: all user-facing strings must use `useI18n` — no hardcoded English.
4. Check whether text content needs Arabic translations added to `translations.ts`.
5. Read `.agents/context/frontend_architecture.md` for the full folder map.

## Implementation Rules

- API calls go in `services/api/<domain>Api.ts` only — never raw Axios in pages or components.
- Keep component state local unless shared state is needed (Zustand).
- Handle all four states: loading, empty/no data, error, and success.
- Handle the permission/unauthorized state for role-gated content.
- Keep forms accessible and show validation errors at field level.
- Wrap new role-specific pages with the correct `RequireRole` in `routes.tsx`.
- **Never probe role eligibility by calling a protected list endpoint** — it causes expected `403` responses to appear as browser errors for normal users. Add/use a lightweight access endpoint such as `manager/access` that returns `{ has_access: boolean }`, then call the protected list only after access is confirmed.

## i18n (Required)

- Use `const { t, language } = useI18n()` in every component with text.
- Add both `en` and `ar` to `translations.ts` for every new key.
- For bilingual backend fields (name_en/name_ar), select based on `language`.
- Read `.agents/context/i18n.md` for patterns.

## Multi-Company

- The active company header (`x-active-company-id`) is injected by `apiClient.ts` — do not add it manually.
- If adding a company switcher or company-aware filter, read `.agents/context/multi_company.md`.

## Validation

```bash
cd FrontEnd && npm run type-check
cd FrontEnd && npm run lint
cd FrontEnd && npm run build       # for route/import-impacting changes
cd FrontEnd && npm run test        # for component behavior changes
```
