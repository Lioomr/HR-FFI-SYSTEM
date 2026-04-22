# Frontend Realtime UI Skill

Use for notifications, attendance updates, approval status changes, or websocket-like flows.

Rules:
- Keep realtime updates consistent with server authority.
- Reconcile optimistic updates with API responses.
- Show stale/loading states when reconnecting.
- Avoid duplicating events in lists.
- Fall back to polling if websocket support is unavailable.
