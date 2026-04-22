# Admin Dashboard Design Context

The admin dashboard should prioritize fast HR operations over marketing-style presentation.

Expected qualities:
- Dense, scannable data tables for employees, attendance, leaves, payroll, loans, assets, and rents.
- Clear filters, search, status chips, and date ranges.
- Role-aware actions with disabled or hidden controls when the current user lacks permission.
- Strong empty, loading, error, and success states.
- Support Arabic/English i18n where existing frontend patterns support it.

Use existing Ant Design components and project styles before introducing new UI primitives.
