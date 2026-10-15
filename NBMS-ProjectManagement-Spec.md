# NBMS — Project Management Module Spec

Reverse-engineered from the live NBMS app (`https://ffi-aac.ncms.tech`, API `https://ffi-aac-api.ncms.tech`)
for rebuilding in the FFI HR System. Read-only inspection — no data was modified.

**Stack observed:** Angular 14.1.0 SPA · JWT auth (`access_token`/`refresh_token` in localStorage) ·
device binding via FingerprintJS (`deviceId`). Backend is a separate REST API.

---

## 1. Module structure (routes)

| Screen | Route | Purpose |
|---|---|---|
| Project List | `#/project-list` | Master list of projects + cost tracking |
| Project Scopes | `#/project-scopes` | Lookup table (scope names) |
| Tenders | `#/s-tenders` | Supplier bidding tied to an ISR |
| Project Collections | `#/collections` | Client billing / receivables per project |
| Subcontract Log | `#/subcontract-log` | Subcontract agreements (full lifecycle) |
| Subcontract Requests | `#/subcontract-request-log` | Requests to create subcontracts |
| Payment Certificates (PC) | `#/subcontract-pc-log` | Subcontractor payment certificates |
| Subcontract Variations | `#/subcontract-variation-log` | Change orders on subcontracts |

---

## 2. API conventions (apply to every list screen)

**List endpoint shape:**
```
PUT /{get-endpoint}/{userId}/{offset}/{limit}/{sortDir}/{sortCol}
Authorization: Bearer <access_token>
Content-Type: application/json
Body: { "<col>": [], "<col>": [], ... }   // per-column filter arrays; [] = no filter
```
- `sortDir` = `asc|desc`, `sortCol` = column name or `null`.
- Body holds one key per filterable column; values are arrays of selected filter values.

**Standard list response wrapper** (same envelope everywhere):
```json
{
  "pageSize", "currentPageNumber", "numberOfPages", "totalSize",
  "data": [ ...records... ],
  "filters",
  "totalAmount", "totalAmountWithin",
  "currenciesTotal", "filteredCurrenciesTotal",
  "currenciesBalanceTotal", "filteredCurrenciesBalanceTotal",
  "waitingCurrenciesTotal", "filteredWaitingCurrenciesTotal",
  "totalCredit", "totalDebit", "totalBalance", "openingBalance"
}
```

**Supporting endpoints used by every table:**
- `GET /get_column-table-preferences/{userId}/{TABLE_KEY}` — saved column show/hide + page size per user
  (keys seen: `PROJECT`, `PROJECTLISTTABLEPREFERENCES`, `STENDERLIST`, `SUBCONTRACTLOG`, `PAYMENTCERTIFICATE`, `SUBCONTRACTVARIATIONLOG`, …)
- `GET /get-hover-effects/user/{userId}/table/{tableName}` — per-row highlight colors (the green/purple rows)
- `GET /get-notifications/{userId}` — header notification badge
- `GET /get-all-project-scopes` — scope lookup

These three (table prefs, hover effects, notifications) are a **cross-cutting "data-table" framework** the
whole app reuses. If FFI doesn't have one, build it once and every log screen gets filtering, column
prefs, excel export, and row coloring for free.

---

## 3. Data models

### 3.1 Project — `PUT /get-new-projects/{u}/{off}/{lim}/{sort}/{col}`
```
id, name, projectValue, startDate, endDate, status,            // status: active/approved/...
clientName, subsidiary, subsidiaryId, subsidiaryLocalCurrency,
creatorId, comment,
contacts[]  { id, name, shippingTo, branchAddress, phoneNumber, email, role, status, addedByUserId, createdAt, updatedAt },
documentsName, variationOrders[], scopes[] { id, name }, building,
pettyCashWeeklyValue, systemGeneratedPettyCashWeeklyValue,     // weekly petty-cash budget
ended, currentCost, committedManpowerPercentage,
resourceManagers, assignedToAddResource, followedThePlan, resourcesAssigned,
// document attachments (stored paths, e.g. "Project/1/Contract/CONTRACT..._<ts>.pdf"):
contractFilePath, boqFilePath, drawingFilePath, circularFilePath,
ptcFilePath, specificationFilePath, projectBaselineFilePath
```
Example: *Sadia project factory-BRF Jeddah Greenfield*, value 243,750,000 SAR, 2025-09-01 → 2027-01-01,
client BRF Arabia Food Industry, currentCost 38,141,721.77.

### 3.2 Project Scope — `GET /get-all-project-scopes`
```
id, name          // simple CRUD lookup (add/edit/delete). e.g. "General"
```

### 3.3 Tender — `PUT /waiting-s-tenders/{u}/...`
UI columns: `subject, projectName, company, isrId, startingRate, lowestPrice, winner, date`.
Linked to an **ISR** (Internal Service Request); records bids and the winning supplier. "Create New Tender".

### 3.4 Project Collection — `PUT /get-project-payments/{u}/...`
UI columns: `id, grossValue, projectName, projectValue, collectedAmount, clientName, status,
expectedNetAmount, approved…`. Client-side receivables/invoicing per project.

### 3.5 Subcontract — `PUT /get-subcontracts/{u}/...`  (the core of the module — 121 live records)
```
id, reference,                         // e.g. "FFI-AAC/SCA/121"
projectId, projectName, subsidiaryName, division,
works, duration,                       // works = scope of work text
subcontractorName, agreementDate, agreementType,   // agreementType: "Re measurable" | "Lum Sum"
currency, type,                        // type: "Job Order" | ...
// money:
amount, amountWithoutVat, vatAmount, amountWithVariation, variation,
totalAmountPaid, totalPayments, printedNotReleasedAmount,
// advances & guarantees:
hasAdvance1, hasAdvance2, advance1Paid, advance2Paid, advancesValid,
guaranteeCheque, performanceCheque,
// payment certificate flags:
hasPaymentCertificate, hasPaymentCertificateOtherThanForAdvance, hasFinalPc,
// "outside system" reconciliation set:
totalAmountPaidToSubcontractorOutsideSystem, grossValueTotalOutsideSystem,
deductionTotalOutsideSystem, netValueTotalOutsideSystem, retentionValueTotalOutsideSystem,
advanceRepaymentTotalOutsideSystem, advanceTotalOutsideSystem,
// workflow / lifecycle:
status,                                // e.g. "waiting for pm"
closeSubcontractRequestStatus, reopenSubcontractRequestStatus, requestedToCancel,
emailSent, lpoId, jobOrderType,
canViewPdf, canViewClearanceForm, clearanceForm,
remark, comment
```

### 3.6 Payment Certificate (PC) — `PUT /get-payment-certificates/{u}/...`
```
id, requestedByName, projectName, requestedDate, status, subsidiary,
works, subcontractorName, subcontractReference,
amount, amountWithoutVat, vatAmount,
preparedDate, hardcopyReceivedDate, type,
markPcAsFinalPaymentRequest, comments, remark, division
```

### 3.7 Subcontract Variation (change order) — `PUT /get-subcontract-variations/{u}/...` (50 records)
```
id, status, type, reason, comment,
requestedDate, requestedByUserId, requestedByUserName,
requestedAmount, subcontractTotal, subcontractTotalAfterVariation,
subcontractId, subcontractReference, subcontractorName,
projectName, subsidiaryName, filePath
```

---

## 4. How the pieces relate (domain model)

```
Project (1) ──< Scope (lookup)
   │
   ├──< Contact (client contacts)
   ├──< Collection / Payment      (money IN — client invoicing/receivables)
   ├──< Tender ──> winning Supplier (via ISR)
   └──< Subcontract               (money OUT — to subcontractors)
            ├──< Subcontract Request   (approval to create it)
            ├──< Payment Certificate   (PC = release of payment, incl. final PC)
            ├──< Variation             (change orders, ± amount)
            └── Advances / Guarantee & Performance cheques / Clearance form
```

Everything is scoped by **subsidiary** and carries **workflow status** fields driving an approval chain
(e.g. subcontract `status: "waiting for pm"`, close/reopen/cancel request statuses).

---

## 5. Build notes for FFI

1. **Reuse the generic data-table backend** (list wrapper + `column-table-preferences` + `hover-effects`)
   as shared infrastructure before building any individual log. It's what gives every screen filtering,
   per-user column prefs, excel export, pagination and row coloring.
2. **Projects are the root aggregate.** Model file-attachment paths as a separate documents concern
   (contract/BOQ/drawing/spec/baseline/circular/ptc) rather than 7 columns if you want it cleaner.
3. **Subcontracts are the heavy part** — model the money breakdown (amount / VAT / advances / retention /
   variation / outside-system reconciliation) and the lifecycle (request → agreement → PC → variation →
   close/clearance) as explicit states.
4. **Currency + subsidiary are first-class** everywhere; the list wrapper aggregates totals per currency.
5. Auth: NBMS uses JWT in localStorage. For FFI, consider httpOnly cookies instead (localStorage tokens
   are readable by any script on the page — relevant since NBMS also loads some scripts from public CDNs).

---

---

## 6. Calculations (verified from UI definitions + compiled JS)

### 6.1 VAT  — *(exact, from code `calculateVat`)*
```
vatAmount    = amountWithoutVat × (vatPercentage / 100)
amount       = amountWithoutVat + vatAmount           // "amount" = total incl. VAT
```
`vatPercentage` is configurable per line/invoice (KSA = 15 → amount = base × 1.15).
Applied both at header level and per product/line item.

### 6.2 Project cost tracking — *(from the Project > Log "cost report" definitions)*
Three figures computed per project; foreign currencies converted at the **last exchange rate
entered when paying in that currency**:

| Metric | Definition |
|---|---|
| **Committed Cost** | Σ valid & signed **LPOs** + **Subcontracts** + **Cash Purchase Requests** + non-rejected **Petty Cash Invoices** |
| **Incurred Cost** | Σ **approved invoices** (payable & paid) covering LPOs + Subcontracts + Cash Purchase Requests + Petty Cash Invoices |
| **Paid Amount** | Σ **generated/released** amounts: LPOs + Subcontracts + Cash Purchase Requests + Petty Cash Invoices + **Manpower Cost (employee salaries)** |

`currentCost` on the project record is the running total used in the Project List.

### 6.3 Advance payments — *(from code)*
```
advancePercentage = totalAdvance / contractTotal          // fraction of the subcontract
advanceAmount     = Σ items( item.isPercentage ? value × percentage/100 : flatAmount )  // .toFixed(2)
```
Subcontracts support up to two advances (`hasAdvance1/2`, `advance1Paid/2Paid`), tracked until
`advancesValid`. Interim payments later **recover** the advance (`invoiceValueWithAdvanceRecovery`).

### 6.4 Interim Payment Certificate (PC) — *(from `interimPaymentDetails` in code)*
Fields: `originalContractValue`, `advancePercentage`, `retentionPercentage`, gross value this period.
Standard construction IPC math:
```
retention        = grossValue × (retentionPercentage / 100)     // held back
advanceRecovery  = grossValue × (advancePercentage  / 100)     // repays the advance
netBeforeVat     = grossValue − retention − advanceRecovery
vat              = netBeforeVat × (vatPercentage / 100)
netPayable       = netBeforeVat + vat
```
`markPcAsFinalPaymentRequest` flags the final PC (releases retention / closes the subcontract).

### 6.5 Variation (change order)
```
subcontractTotalAfterVariation = subcontractTotal + requestedAmount   // requestedAmount may be − or +
```
Reflected on the subcontract as `variation` and `amountWithVariation`.

### 6.6 Guarantee / Performance cheque rule — *(from `checkIfGuaranteeRequired`)*
```
guaranteeRequired = (total − discount) ≥ minLpoAmount        // threshold from system settings
// tender variant: tender.lowestPrice ≥ minLpoAmount
```

### 6.7 Petty-cash weekly budget
Each project carries `systemGeneratedPettyCashWeeklyValue` (auto-derived) and an editable
`pettyCashWeeklyValue` override. Example record: project value 243,750,000 → weekly 18,750.
(The exact derivation runs server-side; the client only displays system vs. manual values.)

---

## 7. Subcontract workflow (from the Request Dashboard)

A subcontract request moves through an approval + procurement pipeline. Dashboard actions observed:

```
Create Request → Approve / Reject / Send for Revision → Edit Request
   → Request Quotation → Attach Quotation → Generate Comparison Sheet
   → Select Subcontractor → Generate Job Order → Generate/Update Subcontract Agreement
   → (Advances) → Payment Certificates (interim … final) → Clearance Form → Close
```
Each request prints a PDF (FROM, Project, Requested Date, Subcontractor, Priority, Type=job order,
delivery date) with a QR code. Status field drives the gate (e.g. `waiting for pm`). Separate
"close" / "reopen" / "cancel" request sub-states exist.

---

*Captured 2026-10-14 via authenticated read-only inspection of the user's own NBMS instance.
Formulas in §6.1, §6.3, §6.4, §6.6 were read from the compiled Angular bundle; §6.2 from the in-app
cost-report definitions; §6.5/§6.7 inferred from field names + sample data (confirm server-side).*
