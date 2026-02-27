# 🔐 HR-FFI-SYSTEM — Security Governance Policy

Version: 1.0  
Status: Enforced  
Applies To: Backend (Django), Frontend (React), DevOps  
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
- Tokens must only be accessed through `tokenStorage.ts`.
- Logout must purge all storage layers.
- Idle timeout must remain active.

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
- Files must never be executed.
- Files must be served as `application/octet-stream`.
- No inline rendering of uploaded content.

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
- Short-lived access tokens
- Refresh token rotation enforcement
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
