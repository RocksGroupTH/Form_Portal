# AP-2 Dr → Vendor + LLM Vendor Matching (Phase 1) — Design

**Date:** 2026-08-26
**Status:** Design (pending user review)
**Branch:** `feat/erp-vendors-sync` (builds on the ErpVendors data-layer WIP)
**Depends on:** `Rocks_ERP_Data.dbo.ErpVendors` sync (migrations 117/118, `vendor-sync.ts`)

## 1. Problem & Goal

Today every AP-2 (Advance) journal posts its debit line to a fixed G/L advance
account regardless of who is paid:

```
Dr  G/L Account = config.glAccountNo (เงินทดรองจ่าย)   +amount
Cr  Bank Account = config.bankAccountNo                 -amount
```

(see `src/lib/adv/advance-erp-payload.ts` → `buildAdvanceJournalPayload`.)

AP-2 already records the payee (`AccAdvance.PayeeType` = `employee|vendor`,
`AccAdvance.PayeeName` free text). The goal is to post the **debit line against a
real Business Central vendor** so advances land in the vendor AP subledger:

```
Dr  Vendor = MatchedVendorNo    +amount
Cr  Bank Account = bankAccountNo -amount
```

The confirmed vendor is chosen by **LLM matching** of the free-text `PayeeName`
against `ErpVendors.DisplayName`, pre-selected for the Accounting Officer, who
confirms or overrides it. This applies to **all payees** — employees also have a
BC vendor card, so their name matches a vendor too.

### Scope

**In (Phase 1):**
- New Dr line = `accountType: "Vendor"` for all AP-2 advances.
- LLM (Haiku) matching PayeeName → ErpVendors, run at the ACC_OFFICER step.
- Vendor confirmation gate at the ACC_OFFICER approval step.
- Editable vendor dropdown at the ERP Interface stage (last-chance override).

**Out (later phases / untouched):**
- **Auto-create vendor in ERP when no match** — Phase 2.
- **WHT** — unchanged (AP-2 posts no WHT today; not in scope).
- Applying the advance against a later vendor invoice in BC (BC-side process).

## 2. Flow

AP-2 approval chain (from `approval-steps.ts`): `HEAD_ACC → DIRECTOR →
ACC_OFFICER`. `ACC_OFFICER` ("Accounting Officer") is the final step and already
picks the payment date (`needsPayment`). Vendor matching + confirmation attaches
here so the record reaches the Interface queue **already complete**.

```
Request submitted
   → HEAD_ACC approve
   → DIRECTOR approve
   → ACC_OFFICER step:
        • auto-run LLM match (if not yet matched) → suggested vendor shown
        • officer picks payment date + confirms/edits Vendor  ← GATE
        • cannot complete step until VendorMatchStatus=confirmed
   → Approved
   → ERP Interface queue:
        • vendor pre-filled (confirmed); editable dropdown (last-chance)
        • send → journal Dr=Vendor / Cr=Bank
```

## 3. Data Model

### 3.1 Source (reuse — already WIP)
`Rocks_ERP_Data.dbo.ErpVendors` — candidate source + picker. Filter
`BrandCode = <company>` AND `IsActive = 1` AND `IsBlocked = 0`. Columns used:
`VendorNo`, `DisplayName`.

### 3.2 New columns on `Rocks_Portal_Form.dbo.AccAdvance`
Stored in the portal DB (Rocks_Portal_Form / _UAT), never in Fast_* or
Rocks_ERP_Data (per DB-scope rule). One row per RequestId.

| Column | Type | Purpose |
|---|---|---|
| `MatchedVendorNo` | NVARCHAR(50) | Vendor to post (the confirmed choice) |
| `MatchedVendorName` | NVARCHAR(200) | DisplayName snapshot at confirm time |
| `VendorMatchStatus` | NVARCHAR(20) | `pending` / `suggested` / `confirmed` / `none` |
| `VendorMatchConfidence` | NVARCHAR(10) | `high` / `medium` / `low` (LLM) |
| `VendorMatchReason` | NVARCHAR(500) | short LLM rationale (audit) |
| `VendorMatchedAt` | DATETIME2 | when the LLM/auto match last ran |
| `VendorConfirmedBy` | INT | user id who confirmed/overrode |

Posting always uses the `MatchedVendorNo` snapshot — never re-resolved at send —
so the choice is auditable and stable.

Migration: the `/migrations` folder is one shared numbered sequence (117/118 are
the Rocks_ERP_Data vendor migrations), so this file takes the **next free number
119**, but it **targets `Rocks_Portal_Form`** (guard with a `DB_NAME()` check as
116 does). Applied to both `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`.

## 4. Matching Service — token-economical (Haiku)

New module `src/lib/adv/vendor-match-service.ts`.

**Model:** Claude Haiku (`claude-haiku-4-5`). Model id / API key / error handling
to be confirmed against the `claude-api` skill at build time.

**Algorithm (minimise LLM calls):**
1. **SQL prefilter** — normalise `PayeeName` (trim, collapse whitespace, case-
   fold, strip common company suffixes บริษัท/จำกัด/Co./Ltd where helpful) and
   query `ErpVendors` for the request's company; take top ~10 candidates by
   `contains` / similarity on `DisplayName`.
2. **0 candidates** → write `VendorMatchStatus='none'`. **No LLM call.**
3. **Exactly 1 normalized-equal candidate** → auto-suggest it directly,
   `VendorMatchStatus='suggested'`, confidence `high`. **No LLM call.**
4. **≥2 ambiguous candidates** → call Haiku with a compact prompt: the
   `PayeeName` + `[{vendorNo, displayName}]` only (no address/bank). Expect
   `{ vendorNo, confidence, reason }` (or none). Write `status='suggested'`.

**Caching:** result persists on `AccAdvance`. The matcher only runs for rows
where `VendorMatchStatus IS NULL` or `pending`. Rows already `suggested` /
`confirmed` display the cache.

**Re-match:** if `PayeeName` changes, reset `VendorMatchStatus='pending'` so the
next open re-runs matching.

**Auto-run trigger:** when the Accounting Officer opens the ACC_OFFICER approval
view for an item, the service runs match for that item if still pending (async;
row shows a spinner). Not run on Interface open.

## 5. UI

### 5.1 ACC_OFFICER approval screen (primary — the gate)
- Add a **Vendor** field beside the existing payment-date picker.
- Show the suggested vendor + a confidence badge (สูง/กลาง/ต่ำ) + tooltip with
  the LLM reason; spinner while auto-match runs.
- **Searchable dropdown** over `ErpVendors` (this company, active, not blocked);
  changing it sets `VendorMatchStatus='confirmed'`, `VendorConfirmedBy`,
  `MatchedVendorName` snapshot.
- **Gate:** the officer cannot complete/approve the ACC_OFFICER step until
  `VendorMatchStatus='confirmed'` and `MatchedVendorNo` is set — same treatment
  as the payment-date requirement. Thai message prompts to pick a vendor.

### 5.2 ERP Interface queue (last-chance override)
- Vendor arrives pre-filled/confirmed from ACC_OFFICER.
- Same **searchable dropdown**, editable here too (mirrors payment-date being
  editable at the interface). An edit updates `MatchedVendorNo` + audit fields.
- **Defensive guard:** if `MatchedVendorNo` is empty (should not happen), refuse
  send and point back to the ACC_OFFICER step.

## 6. Journal Payload

Change `buildAdvanceJournalPayload` (and the batch builder) in
`src/lib/adv/advance-erp-payload.ts`:
- Dr line: `accountType: "Vendor"`, `accountNo: MatchedVendorNo` (was
  `"G/L Account"` + `glAccountNo`).
- Adjust `balAccountType` to suit the new Dr account type.
- Cr = Bank unchanged; batch stays single-group G1 (each advance carries its own
  VendorNo).
- **Guard:** throw a Thai error if `MatchedVendorNo` is missing at build time
  (belt-and-braces behind the UI gate).
- `config.glAccountNo` is no longer used for the Dr line; keep the config field
  for now (avoid unrelated churn) — revisit removal later.

## 7. Error Handling

- **LLM failure / timeout:** do not block the screen; leave
  `VendorMatchStatus='pending'` so the officer picks manually. Log the error.
- **Confirmed vendor later blocked/removed in master:** on screen open, if the
  stored `MatchedVendorNo` is no longer active/unblocked in `ErpVendors`, warn
  and force re-selection (clears `confirmed`).
- **Send-time guard:** empty `MatchedVendorNo` → refuse with a Thai message.

## 8. Testing

- **Unit — normalize/prefilter:** Thai/English normalisation, suffix stripping,
  candidate ranking.
- **Unit — matching service (mock LLM):** 0 candidates → `none`; 1 exact →
  `suggested` no LLM; ≥2 → LLM path; LLM failure → `pending`.
- **Unit — payload:** Dr=Vendor with MatchedVendorNo; batch multi-vendor; guard
  throws when VendorNo empty.
- **Gate:** ACC_OFFICER step cannot complete when vendor not confirmed.
- **Interface:** override updates MatchedVendorNo; empty → refuse send.
- Follow the pipeline's TDD (RED → GREEN → REFACTOR).

## 9. Open Questions / Assumptions

- **A1:** Employees are assumed to have BC vendor cards so `PayeeName` matches a
  vendor. If an employee has no vendor card, Phase 1 blocks at the gate (officer
  must pick manually or wait for Phase 2 auto-create).
- **A2:** Prefilter cap ~10 candidates and the normalisation rules are starting
  values; tune during build against real `ErpVendors` data.
- **A3:** The existing `config.glAccountNo` (AP-2 advance G/L) is retained in
  config but unused for posting in Phase 1.
