# FFI HR Web Frontend

The web app is built with React 19, TypeScript, Vite, Ant Design, React Router 7, and Zustand. The actual dependency versions and scripts are in `package.json`.

## Local development

From this directory:

```powershell
npm install
npm run dev
```

Set the API origin using the environment configuration documented by the project (`.env.example` when present). API calls should go through `src/services/api/apiClient.ts` and typed modules under `src/services/api/`.

## Quality checks

```powershell
npm run test -- --run
npm run type-check
npm run lint
npm run format:check
npm run build
```

## Where to start

- Routes and role guards: `src/routes/`
- Role and feature pages: `src/pages/`
- Shared UI: `src/components/`
- API clients: `src/services/api/`
- English/Arabic translations: `src/i18n/translations.ts`
- Tests: near their page/component or service

For repository rules, read `../AGENTS.md`. For the shared architecture map, start with `../.agents/context/INDEX.md`. Request workflow tasks must also read `../.agents/context/workflow_engine.md`: the employee dashboard's Current Requests panel is a summary, while leave list/detail pages show the approval-trail pattern. Trace linked screens, APIs, workflow history, permissions, toggles, notifications, and tests before making a change.
