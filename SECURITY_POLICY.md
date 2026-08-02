# 🔐 HR-FFI-SYSTEM — Security Governance Policy

Version: 2.0  
Status: Enforced  
Last Reviewed: 2026-07-20  
Review Owner: Project maintainers  
Applies To: Backend (Django), Web Frontend (React), Mobile Clients, DevOps  
Mandatory For: Codex, Antigravity, All Contributors  

---

# 🚨 Zero-Regression Rule

NO new feature, refactor, or enhancement may:

- Expose secrets
- Loosen authentication
- Weaken authorization
- Reintroduce client-side secret rendering
- Bypass validation layers
- Trust user input without strict validation
- Disable production security controls

If a change weakens security posture, it MUST be rejected.

---

# 🔴 CRITICAL SECURITY RULES (Non-Negotiable)

## 1️⃣ Secrets

- No real secrets in repository.
- `.env` must never contain production credentials.
- SECRET_KEY must not be weak in production.
- DEBUG must NEVER be True outside local environment.
- Application must fail-fast on insecure production configuration.

Violation Severity: CRITICAL

---

## 2️⃣ Authentication

- No plaintext passwords returned in API responses.
- No reset tokens returned to frontend.
- Tokens must never be logged.
- Web tokens must only be accessed through `FrontEnd/src/services/api/tokenStorage.ts`; the current web implementation uses `sessionStorage` and clears legacy localStorage keys on logout.
- Mobile tokens must use platform-protected Android Keystore/iOS Keychain storage, such as Expo SecureStore. Never use AsyncStorage, plain files, or browser localStorage for tokens.
- Logout must purge all storage layers.
- Idle timeout must remain active.
- Access tokens expire after 15 minutes. Refresh tokens expire after 14 days, rotate on use, and the used token is blacklisted.
- Login returns backward-compatible `token`/`access` values and a refresh token. Refresh, access, and audit payloads must never expose raw token details in errors or logs.
- Logout and password change revoke every prior access and refresh token for the account through the server-enforced `token_version` claim and refresh blacklist. Tokens without the required version claim are rejected.

Violation Severity: CRITICAL

---

## 3️⃣ Authorization (RBAC)

- Role enforcement must remain server-side.
- Only SystemAdmin can assign SystemAdmin.
- Frontend UI restrictions are supplementary only.
- No endpoint may rely on frontend validation alone.

Violation Severity: CRITICAL

---

## 4️⃣ File Uploads

- Extension allowlist required.
- Max file size required.
- Claimed MIME type and file signature/content validation are required for protected employee and announcement uploads.
- Files must never be executed.
- Files must be served as `application/octet-stream`.
- No inline rendering of uploaded content.
- Private downloads require authentication, ownership/role authorization, active-company scope, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, private no-store caching, and a successful-download audit where the domain is sensitive.
- Compatibility download links must never be anonymous by default. The deprecated announcement `attachment-public` route requires normal authentication, company scope, and its signed token.

Violation Severity: HIGH

---

## 5️⃣ IP & Throttling

- X-Forwarded-For must only be trusted from configured proxies.
- Login throttling must not be bypassable.
- Lockout logic must not be weakened.

Violation Severity: HIGH

---

# 🟡 REQUIRED DEFENSIVE CONTROLS (Must Be Preserved)

## Frontend

- CSP must remain enforced.
- Referrer policy must remain strict.
- No `dangerouslySetInnerHTML`.
- No `eval()`.
- No raw HTML injection.
- Safe error masking must remain active.
- Session tokens must not persist beyond session.

## Backend

- HSTS enabled in production.
- Secure cookies enabled in production.
- SSL redirect enforced.
- Password validators active.
- JWT rotation & blacklist enabled.

---

# 🧪 CHANGE APPROVAL REQUIREMENTS

Before merging any feature:

1. Does this introduce new storage of secrets?
2. Does this alter authentication flow?
3. Does this alter role assignment?
4. Does this alter file upload behavior?
5. Does this modify token handling?
6. Does this modify security headers?
7. Does this weaken validation?

If YES to any:
Security review REQUIRED before merge.

---

# 🚫 PROHIBITED CHANGES

The following are explicitly forbidden:

- Returning credentials in API responses
- Storing tokens in localStorage long-term
- Disabling CSP
- Enabling DEBUG in production
- Allowing client to choose privileged role freely
- Trusting spoofable headers without verification
- Removing rate limiting

---

# 🛡 DEFENSE-IN-DEPTH PRINCIPLE

All security controls must be layered:

Frontend restrictions ≠ security  
Backend validation = authority  

Every privilege-sensitive action must be validated server-side.

---

# 📋 FUTURE HARDENING TARGETS (Optional Enhancements)

These are allowed improvements:

- Migration to HttpOnly cookies
- CSP via HTTP header instead of meta
- Permissions-Policy header
- AV scanning for uploads

Enhancements must increase security posture, never decrease.

---

# 🏁 FINAL RULE

Security posture may only:

- Stay the same
- Improve

It may NEVER regress.

If a change introduces weaker protection,
the change must be rejected immediately.

---

Approved By: Security Lead  
Effective Immediately

## Mobile Security Addendum

- Mobile communicates with production APIs only over TLS.
- Server-side authentication, authorization, ownership, and company scoping remain authoritative.
- Do not put JWTs, salary, identity, medical, or document data in push payloads, URLs, analytics, logs, crash reports, or clipboard contents.
- Sensitive screens and payslip/document access require authenticated requests; biometric/local re-authentication may be added but never replaces server authorization.
- Do not expose sensitive content in screenshots, app-switcher previews, or uncontrolled public downloads where platform controls permit protection.
- Deep links must be allowlisted and must never carry access tokens.
- Avoid WebViews for authenticated HR content unless explicitly approved by security review.
- Root/jailbreak and tampering signals are risk controls, not the authorization boundary.
- Do not introduce JWTs in query strings. The notification WebSocket compatibility path is currently deferred and rejects every handshake pre-accept with code `4403`; it accepts no JWT or session authentication.
- Web and mobile notifications use authenticated REST polling until a reviewed opaque, one-time, short-lived, company-bound realtime credential can enforce token expiry, logout/password revocation, and organization-change disconnects.
- Push notifications must contain only privacy-safe summaries and must be revocable per device.

## Change history

- 2026-07-20: Added mobile scope, native secure storage, push privacy, realtime-token, and mobile platform controls; corrected web token-storage guidance.
- 2026-07-20: Gate 1 fixed the 15-minute access/14-day rotating refresh lifecycle, immediate global logout/password revocation, legacy-token rejection, private upload/download controls, and deferred URL-token WebSockets in favor of REST polling.
