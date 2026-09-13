# External Engineering References

Use these sources to improve cross-cutting engineering quality in FFI HR. They are references for independently implementing compatible improvements, not software to install or replace FFI HR with.

## PostHog: product-scale application discipline

Upstream: <https://github.com/PostHog/posthog>

Consult PostHog when a task affects company isolation, feature boundaries, safe database migrations, or feature-level regression testing.

Apply these patterns in FFI HR:

- Keep a feature's backend behavior, typed API service, React UI, tests, and documentation consistent.
- Every new company-scoped model and query path must preserve FFI's `company` FK and `x-active-company-id` scoping model. Add cross-company negative tests proving that data cannot be read or mutated across companies.
- For production tables, assess locking and rollout risk before adding an index, constraint, non-null field, or data migration. Use phased migrations where required and retain a rollback path.

Useful upstream material:

- [Product boundaries and tenant scoping](https://github.com/PostHog/posthog/blob/master/products/README.md)
- [Agent instructions for API schemas and generated types](https://github.com/PostHog/posthog/blob/master/AGENTS.md)
- [Safe Django migration guidance](https://github.com/PostHog/posthog/blob/master/docs/published/handbook/engineering/developing-locally.md)

## Vinta Django React Boilerplate: API contract implementation

Upstream: <https://github.com/vintasoftware/django-react-boilerplate>

Consult Vinta when implementing or reviewing OpenAPI schemas, generated TypeScript API clients, pre-commit contract checks, Celery dispatch after database writes, or Sentry source maps.

Apply these patterns in FFI HR:

- Make the Django serializer and documented OpenAPI schema the backend contract. Generate TypeScript API types and client functions from that schema instead of duplicating response shapes by hand.
- Roll out generated API types incrementally. Preserve the existing API envelope, routes, React/Vite application, and hand-written service APIs until a compatible replacement is tested.
- When a Celery task depends on a database write in the current request, enqueue it through `transaction.on_commit(...)` so a worker cannot run before the database transaction commits.
- Make contract generation/checking part of the relevant local and CI checks only after the initial generated output is stable.

Useful upstream material:

- [OpenAPI schema and generated client workflow](https://github.com/vintasoftware/django-react-boilerplate#api-schema-and-client-generation)
- [Celery transaction and acknowledgement guidance](https://github.com/vintasoftware/django-react-boilerplate#opinionated-settings)

## FFI-specific application rules

- FFI's plans, API contract, security policy, shared workflow engine, company-scoping model, and Ant Design frontend conventions remain authoritative.
- Apply a pattern only when it improves the current system without unintentionally changing public behavior.
- Start with the smallest high-value change in the feature being touched: API-schema/type alignment, a company-scope regression test, or transaction-safe task dispatch.
- Validate with targeted backend and frontend tests, then the relevant CI checks.
