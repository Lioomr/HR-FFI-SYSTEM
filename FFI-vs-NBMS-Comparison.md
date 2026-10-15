# FFI HR System  vs  NBMS — Deep Comparison Report

Two systems for the **same construction group (Al Attiyah / Fathi Fouad Itani Contracting – FFI-AAC)**:

- **FFI HR System** — `app.asecopro.com` — a focused **HR & Payroll** platform.
- **NBMS** — `ffi-aac.ncms.tech` — a full **Business Management ERP** (Ninova Business Management System)
  covering Finance, Procurement, **Projects**, Subcontracts, Warehouse, Fleet, Suppliers — *and* HR.

Goal of this report: show what each does, where they overlap, how the overlapping flows differ, and —
primarily — **what FFI is missing (Project Management)** and how to add it.

Captured 2026-10-14 by read-only inspection of both (logged in as HR Manager / Super Admin respectively).

---

## 1. Identity & scope at a glance

| | **FFI HR System** | **NBMS** |
|---|---|---|
| Purpose | HR & Payroll for the workforce | End-to-end business/ERP incl. project delivery |
| Primary users | HR managers, employees (self-service) | GM, Finance, Procurement, PMs, Warehouse, Fleet |
| Breadth | 1 domain (HR) done in depth | ~8 domains, HR is a small part |
| Scale seen | 53–61 employees, 3 payroll runs | 1 project, 121 subcontracts, full finance |
| Relationship | The **people/cost source** | The **project/commercial consumer** |

**They are complementary, not competitors.** FFI manages *who works and what they're paid*; NBMS manages
*what projects cost and how money moves*. Employees in FFI already carry a **"Projects Department"** and
construction roles (QS Engineer, Surveyor, Workshop Worker) — the project dimension exists in the data but
there is **no project module** in FFI today.

---

## 2. Architecture & tech stack

| | **FFI HR System** | **NBMS** |
|---|---|---|
| Frontend | **Vite SPA** (modern bundle `assets/index-*.js`) | **Angular 14.1.0** SPA |
| API | **Same-origin REST** `/api/...` (Django/DRF style: trailing slashes, `page`/`page_size`) | **Separate host** `ffi-aac-api.ncms.tech`, custom `PUT /get-x/{user}/{off}/{lim}/{sort}/{col}` with filter body |
| Auth | Session/token via same origin | JWT in `localStorage` + FingerprintJS device binding |
| List pattern | `GET /api/<resource>/?page=&page_size=` | `PUT` with per-column filter arrays; rich totals envelope |
| Infra | Cloudflare | — |
| Feel | Cleaner, modern, REST-conventional | Dense, feature-heavy, older patterns |

**Implication for building in FFI:** FFI's REST/DRF conventions are a *better* foundation to extend. You'd add
a `projects` app with standard REST endpoints rather than copy NBMS's bespoke PUT-filter style.

---

## 3. Feature inventory — what exists where

### Present in BOTH (overlap — HR domain)
| Feature | FFI | NBMS |
|---|---|---|
| Employees master | ✅ `/hr/employees` (iqama/contract expiry, nationality, position, dept) | ✅ `/employees` |
| Departments / positions | ✅ Organization Setup | ✅ `/departments`, `/positions` |
| Leave management | ✅ Leave Inbox + **Leave Settlements** | ✅ `/leave-requests` |
| Attendance | ✅ Records + **Attendance Policy** + BioTime | ✅ `/attendance-correction` |
| Penalties / warnings | ✅ Penalties | ✅ `/warning-letters` |
| Payroll | ✅ **Payroll Runs** (Draft→Completed→Paid) | ✅ `/payroll-log`, `/payslip` |
| Loans / advances | ✅ Loan Inbox | ✅ `/cash-advance-requests` |
| Delegation of approval | ✅ Alternates Setup | ✅ `/delegations-granted-to-me` |
| Assets issued to staff | ✅ Assets + **Rents** | ✅ `/assets` (procurement side) |
| Document templates / e-sign | ✅ Template Library + Verify-a-PDF | ✅ `/templates`, `/digital-sign` |
| Hiring / onboarding | ✅ Job Offers, Invites, Import | ✅ `/joining-forms` |

### Present ONLY in FFI (stronger HR depth)
- **BioTime Verifications** (biometric attendance device integration / start-work acknowledgments)
- **Attendance Policy** engine, **Leave Settlements** (annual-leave payout), **Contract Decisions & Ratings**
- **Profile-change request** workflow, **Rents** tracking, dedicated **employee self-service** portal
- Iqama / passport / work-license **expiry dashboards**

### Present ONLY in NBMS (the whole commercial/ERP side — **missing from FFI**)
| Domain | NBMS screens |
|---|---|
| **Project Management** | project-list, project-scopes, **cost tracking (Committed/Incurred/Paid)**, collections, tenders |
| **Subcontract Management** | subcontract-log (121), requests, payment certificates, variations, full approval pipeline |
| **Finance** | bank accounts/transfers, PDC/cheques, payments, SOA reports, wallets, settlements, guarantee cheques |
| **Procurement** | LPO, ISR, cash-purchase, materials, petty cash |
| **Suppliers** | supplier applications, suppliers log, tenders/bidding |
| **Warehouse** | stock, SIV, transfers, store log, fixed-asset materials |
| **Fleet** | vehicles, fuel, drivers, maintenance logs |
| **Multi-subsidiary** finance with multi-currency consolidation |

---

## 4. How the overlapping flows ACT — side by side

### 4.1 Approvals / request routing
- **FFI:** One unified **Pending Requests** inbox ("Needs your attention") with typed tabs
  (Contract Decision, Contract Rating, Leave, Loan, Permission, Profile Change). Each row → **Review** →
  approve/act. Delegation via **Alternates Setup**. Clean single-queue model.
- **NBMS:** Approvals are **per-module** — each dashboard card shows `Waiting(n)`; items carry explicit
  **status gates** (e.g. subcontract `waiting for pm`) and **multi-step pipelines**
  (approve → reject → send-for-revision → quotation → comparison → select → generate agreement).
- **Difference:** FFI = **flat, employee-centric** approval inbox. NBMS = **deep, document-centric**
  state machines per business object. Adding Projects to FFI means introducing NBMS-style **multi-stage
  status workflows** that FFI's current one-click Review model doesn't have yet.

### 4.2 Payroll ↔ cost
- **FFI:** Payroll Runs produce a **net total per period** (e.g. 10/2026 → 349,403.33 for 52 employees),
  statuses Draft → Completed → Paid. **Not allocated to any project.**
- **NBMS:** Project **Paid Amount** explicitly *includes* **"Manpower Cost (employee salaries)"** per project.
- **Gap:** NBMS expects salary cost **attributed to projects**; FFI payroll has no project cost-center
  dimension. This is the single most important integration point (see §6).

### 4.3 Employees ↔ resources
- **FFI:** Employees have position + department (incl. "Projects Department") but no project assignment.
- **NBMS:** Projects have `resourceManagers`, `resourcesAssigned`, `committedManpowerPercentage`.
- **Gap:** FFI has no concept of assigning an employee to a project as a resource.

### 4.4 Assets
- **FFI:** Assets = items **issued to employees** (+ Rents). HR view.
- **NBMS:** Assets = **procurement/warehouse** items, fixed-asset materials, tied to projects/stores.
- **Difference:** same word, different domain — FFI is custody, NBMS is inventory/capex.

---

## 5. What's MISSING in FFI (prioritized)

1. **Project Management module** (the ask) — projects, scopes, cost tracking, collections, tenders.
2. **Subcontract Management** — the heaviest NBMS area (agreements, PCs, variations, advances).
3. **Finance** — payments, cheques/PDC, bank, SOA, multi-currency.
4. **Procurement** — LPO/ISR/cash-purchase/petty-cash.
5. **Warehouse & Fleet** — inventory and vehicle logs.
6. **Supplier/Tender** management.
7. **Cross-cutting ERP primitives** NBMS has that FFI lacks: multi-subsidiary + multi-currency consolidation,
   document-centric multi-stage approval workflows, per-record reference numbering (e.g. `FFI-AAC/SCA/121`).

---

## 6. Adding Project Management to FFI — concrete plan

FFI's modern REST stack makes this cleaner to build than copying NBMS. Recommended slices:

**Phase 1 — Project core**
- `Project` entity (port the 33-field NBMS model: value, dates, client, subsidiary, scopes, contacts,
  document paths, petty-cash weekly, committed-manpower %). REST: `GET/POST /api/projects/`.
- `ProjectScope` lookup (`id,name`).
- Project list with the iqama-style filter/column UX FFI already uses.

**Phase 2 — Cost tracking (the valuable part)**
Implement the three NBMS metrics as computed fields over FFI + future finance data:
- **Committed** = signed LPOs + Subcontracts + Cash-Purchase + non-rejected Petty-Cash.
- **Incurred** = approved invoices across those.
- **Paid** = released amounts across those **+ Manpower Cost from Payroll**.
- **Key integration:** add a **project cost-center dimension to Payroll** so each payroll run (or line)
  can be allocated to a project → feeds "Manpower Cost". Without this, project cost is incomplete.
- Reuse the exact formulas from the Project Management spec (VAT, advances, IPC, variation).

**Phase 3 — Resourcing**
- Assign FFI employees to projects (`resourcesAssigned`, `resourceManagers`), set `committedManpowerPercentage`.
- Surface project assignment on the employee profile.

**Phase 4 — Subcontracts (if needed)**
- Port subcontract + payment-certificate + variation models and the **multi-stage approval pipeline**
  (request → quotation → comparison → select → job order → agreement → PC → clearance).
- This requires FFI to gain document-centric status-workflow infrastructure first.

**What you can reuse immediately:** the companion spec `NBMS-ProjectManagement-Spec.md` has every field,
endpoint, calculation (VAT, cost tracking, advances, interim payment certificates, variation, guarantee
rule) and the subcontract workflow.

---

## 7. One-line summary

> FFI is a clean, modern **HR & Payroll** system; NBMS is a sprawling **ERP** whose HR overlaps FFI but which
> additionally owns Projects, Subcontracts, Finance, Procurement, Warehouse and Fleet. To bring **Project
> Management** into FFI, port NBMS's Project + cost-tracking model onto FFI's REST stack, and — critically —
> **add a project cost-center dimension to FFI Payroll** so manpower cost can roll up per project.

---

*Both systems inspected read-only on 2026-10-14. No data in either system was created or modified.
Pair this with `NBMS-ProjectManagement-Spec.md` for the field/endpoint/formula detail.*
