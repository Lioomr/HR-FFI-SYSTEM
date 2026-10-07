# Frontend Design System Context

Use the existing React, Ant Design, and project CSS patterns first.

UI expectations:
- Forms use consistent labels, validation, submit states, and server error display.
- Tables expose common HR operations: search, filters, sorting where supported, status visibility, and row actions.
- Buttons should clearly distinguish primary, secondary, danger, and disabled states.
- Keep layouts responsive for desktop admin usage and reasonable tablet/mobile access.
- Avoid large decorative sections inside operational HR screens.

Names, links and flags (apply while building, not after):
- A person's name is an orange hyperlink to their profile whenever the viewer's role has one (`TeamMemberCell` + `profilePath`, or `<Link>` / `<Button type="link">`). Without a profile destination it is plain dark text (`#0f172a`), never gray and never orange.
- Link color is the theme's `colorLink` (`#f97316`) set in `FrontEnd/src/app/Providers.tsx`; do not hardcode colors for links, emails (`mailto:`) or phone numbers (`tel:`).
- Nationality flags use `components/ui/NationalityFlag` (flag-icons images), not emoji, so they render on Windows.
- Full rule list: `.agents/rules/frontend_rules.md`, section "Names, Links and Flags".

For frontend work, run:
- `cd FrontEnd && npm run type-check`
- `cd FrontEnd && npm run lint`
- `cd FrontEnd && npm run build` when the change affects bundling or routes.
