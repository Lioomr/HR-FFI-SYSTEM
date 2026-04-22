# Frontend Design System Context

Use the existing React, Ant Design, and project CSS patterns first.

UI expectations:
- Forms use consistent labels, validation, submit states, and server error display.
- Tables expose common HR operations: search, filters, sorting where supported, status visibility, and row actions.
- Buttons should clearly distinguish primary, secondary, danger, and disabled states.
- Keep layouts responsive for desktop admin usage and reasonable tablet/mobile access.
- Avoid large decorative sections inside operational HR screens.

For frontend work, run:
- `cd FrontEnd && npm run type-check`
- `cd FrontEnd && npm run lint`
- `cd FrontEnd && npm run build` when the change affects bundling or routes.
