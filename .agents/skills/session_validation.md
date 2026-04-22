# Session Validation Skill

Use for auth/session bugs and protected routes.

Checklist:
- Backend validates authentication and role/permission for every protected endpoint.
- Frontend route guards do not replace backend authorization.
- Token/session expiry is handled without trapping users in broken states.
- Logout clears local auth state and sensitive cached data.
- API clients consistently attach credentials/tokens according to existing config.
