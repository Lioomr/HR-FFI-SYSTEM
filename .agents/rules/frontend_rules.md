# Frontend Agent Rules

- Browser token storage follows `FrontEnd/src/services/api/tokenStorage.ts`; do not move tokens to long-lived localStorage.
- Mobile clients must use platform secure storage and must not reuse browser storage assumptions.
- UI role guards are for UX only; backend authorization is mandatory.

Frontend lives in `FrontEnd/`. React 19 + TypeScript + Vite + Ant Design + React Router v7.

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

## Names, Links and Flags (Required — build it in from the first version)

Do this while building the page, not in a later refactor pass. It is part of the definition of done.

- **Every person's name is an orange hyperlink** (employee, manager, approver, requester, rater, user — in tables, cards, headers, timelines and detail rows) whenever a profile destination exists for the viewer's role. Use `TeamMemberCell` with `profilePath` for table cells, or `<Link>` / `<Button type="link">` elsewhere.
- **Color comes from the theme, never hardcoded.** `Providers.tsx` sets `colorLink` to brand orange (`#f97316`, hover `#fb923c`, active `#ea580c`), so plain links, `mailto:`/`tel:` links and link buttons are already orange. Do not restyle a name gray, blue or black, and do not add a second orange.
- **No profile destination → plain text** in the primary text color (`#0f172a`). Do not render a name in orange unless it is clickable, and do not render it gray.
- **Destinations are role-aware.** HR/admin views link to the employee page (`/hr/employees/:id`), manager views to `/manager/team/:id`. Copy the `profilePath` pattern in `ManagerTeamRequestsPage.tsx` and `LoanRequestsTablePage.tsx`. If the API payload has no employee/profile id, add it to the backend serializer instead of leaving the name unlinked, and never expose an id the viewer cannot open.
- **Flags use `components/ui/NationalityFlag`, never a flag emoji.** Windows browsers draw flag emoji as plain letters ("IN").
- Never show a manager's company or any "cross-company" wording to employees; a manager is just "Manager".

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
