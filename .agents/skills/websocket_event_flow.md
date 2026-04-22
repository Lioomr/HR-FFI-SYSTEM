# Websocket Event Flow Skill

Use for websocket or event-driven UI changes.

Design notes:
- Define event names and payload shapes.
- Include entity IDs and version/timestamp where needed.
- Make handlers idempotent.
- Re-fetch authoritative data after critical events if correctness matters.
- Handle disconnect, reconnect, and duplicate events.

Document any new event contract in plans or API docs.
