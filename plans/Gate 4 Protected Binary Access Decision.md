# Gate 4 — Protected Binary Access Decision

**Date:** 2026-07-30
**Status:** Decision approved; Gate 4 overall is not passed.
**Scope:** Payslip PDFs, employee document PDFs/images, and announcement attachments in `MobileApp`.

## Approved first-release boundary

- `MobileApp` displays authenticated structured payslip details, employee document metadata, and announcement/attachment metadata only.
- Actual protected PDFs, images, and attachments remain accessible through the authenticated web application.
- `MobileApp` must not fetch, render, persist, share, export, open in a WebView, deep-link to, or use signed URLs for protected binary content.
- Mobile authentication, ownership/role authorization, active-company scoping, revocation, and audit controls remain server-authoritative.
- Existing Gate 2 and Gate 3 memory-only, token-handling, route, logging, and no-download invariants remain unchanged.

## Future mobile viewing

Any future mobile viewing of protected binary content requires a separate security-reviewed design before implementation. That review must define the viewer and decrypted-data lifecycle, screenshot and app-switcher protection, logout/revocation behavior, company-scope and IDOR tests, audit semantics, native/EAS impact, and Simulator/device acceptance matrix.

This decision approves the first-release product boundary only. It does not authorize protected binary implementation in `MobileApp` and does not mark Gate 4 passed.
