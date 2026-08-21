# AP-2 ERP Re-send (Pull-back → Resent → Re-issue) — Design

**Date:** 2026-08-21 · **Branch:** `feat/ap-2-advance` · **Form:** AP-2 (Advance)
**DBs:** Rocks_Portal_Form (prod) + Rocks_Portal_Form_UAT
**Status:** Approved (brainstorming) → ready for writing-plans

---

## 1. Problem

After an AP-2 advance is sent to BC (`ErpInterfaceStatus='Sent'`, a PV Document No. captured), the ACC_OFFICER may discover an **officer-side interface mistake** — wrong payment date / G/L / bank / branch / journal batch. Today `Sent` is final: there is no way to correct and re-send.

We want a controlled way to pull the sent advance back into the Interface queue, re-send it as a corrected PV, and keep an accurate mapping of the old (superseded) PV to the new one.

**Reference point:** AP-1 has **no** void/re-send pattern (Sent is final there too, and it does not even capture `ErpDocumentNo`). AP-2 sets the reference; AP-1 can backport later.

---

## 2. Scope (v1)

**In scope**
- Pull a `Sent` AP-2 advance back to the Interface "รอส่ง" queue (officer self-service, confirm dialog — no reason required).
- Mark the superseded PV attempt as `Resent`; keep the ADV↔PV mapping across re-sends.
- **Re-select Payment Date before re-sending** so the new PV lands in the current/future payment cycle (validated against `getPaymentDates()`). The payment date is the officer-side input most likely to need changing on a re-send.
- Re-send through the existing send path → new PV, new attempt (new `postingDate` = new Payment Date).
- Report/queue visibility so Accounting can identify which PV to skip when posting in BC.

**Out of scope (v1)**
- **No BC mutation.** The form never deletes, reverses, or annotates the BC journal line. Accounting handles the old unposted line in BC manually, guided by the report.
- **Already-posted case.** If Accounting already posted the old PV in BC, correcting it is a manual accounting reversal outside this feature. v1 does **not** read BC to detect posted state; "pull back only before BC posts" is a documented process constraint, surfaced via reason capture + report — not a programmatic guard.
- Requester data edits / re-approval. The correction is officer-side only; the request stays `Approved` and never re-enters the approval chain.

---

## 3. Key facts established

- **CU 50263 `PP_APJournalCreate.CreateFromJson` STAGES only** — it `GenJnlLine.Insert(true)` into the PAYMENTS template/batch and never posts. The PV Document No. is consumed from the batch No. Series (`NoSeries.GetNextNo(..., true)`), so re-sending yields a **new** PV number (a gap on the old one; acceptable).
- The ERP queue tabs are driven by `AccRequest.Status='Approved'` + `ErpInterfaceStatus`:
  - **"รอส่ง"** = not `Sent` (null / Failed).
  - **"ส่งแล้ว"** = `Sent`.
- Send happens in `erp-queue/send` route → `sendAdvanceErpBatch(ids)` (`advance-erp-send.ts`).
- **Payment Date** is stored on `AccAdvance.PaymentDate` (set at ACC_OFFICER approve) and is used directly as the journal `postingDate` in the send payload (`advance-erp-payload.ts`). Valid values come from `getPaymentDates()` (payment calendar). Changing `PaymentDate` before a (re-)send changes the resulting PV's posting date — no other wiring needed.

---

## 4. Data model

New table **`AccAdvanceErpAttempt`** (created in prod + UAT). One row per send attempt — the mapping/history.

| Column | Type | Notes |
|---|---|---|
| Id | int identity PK | |
| RequestId | int, FK→AccRequest.Id | the ADV (RequestNo is constant across attempts) |
| AttemptNo | int | 1, 2, 3… per request |
| ErpDocumentNo | nvarchar(20) | the PV for this attempt |
| Environment | nvarchar(20) | Sandbox / Production (as sent) |
| Company | nvarchar(100) | BC interface target |
| Status | nvarchar(20) | `Sent` (current active) or `Resent` (superseded) |
| SentAt | datetime2 | |
| SentBy | int | user id |
| ResentBy | int null | who pulled it back (audit) |
| ResentAt | datetime2 null | when pulled back (audit) |
| CreatedAt / UpdatedAt | datetime2 | |

Invariants:
- At most **one** attempt per `RequestId` has `Status='Sent'` at any time (the current active PV).
- `AccRequest.ErpDocumentNo` / `ErpInterfaceStatus` continue to reflect the **current** active attempt; the table holds full history.

**Backfill:** for every existing AP-2 request currently `ErpInterfaceStatus='Sent'`, seed `AttemptNo=1, Status='Sent'` from its current `ErpDocumentNo / ErpInterfaceSentAt / ErpInterfaceSentBy / ErpInterfaceEnvironment` so history is continuous from day one.

**Migration:** `101` (next number). Applied individually to UAT then Prod via `apply-sql` (bulk agent-selected prod migrations are blocked; individual applies are allowed).

---

## 5. Flow

```
Sent advance (ADV26-xxxxx ↔ PV DocX), in "ส่งแล้ว" tab
   │  ACC_OFFICER clicks "ดึงกลับเพื่อยิงใหม่" → confirm dialog (no reason)
   ▼
[Pull back]  (form/DB only — no BC call)
   • UPDATE current attempt (DocX): Status='Sent' → 'Resent' (+by/at, audit)
   • UPDATE AccRequest: ErpInterfaceStatus=NULL, ErpDocumentNo=NULL
   • row leaves "ส่งแล้ว", reappears in "รอส่ง"
   • AccActivityLog entry ("erp-pullback")
   │  officer re-selects a new Payment Date (current/future cycle) on the "รอส่ง" row,
   │    and fixes any interface config (GL/bank/branch/batch) as needed
   │  officer sends again via the normal queue send
   ▼
[Re-send]  sendAdvanceErpBatch → CU 50263 → new PV DocY
   • markInterfaceStatus('Sent', doc=DocY) as today
   • INSERT attempt (AttemptNo = max+1, ErpDocumentNo=DocY, Status='Sent', env/company/by/at)
   ▼
Mapping result:  ADV26-xxxxx → [ DocX = Resent (⚠ do not post), DocY = Sent (current) ]
```

**Integration point:** the send path (`sendAdvanceErpBatch` / `markInterfaceStatus` for `Sent`) must **insert an attempt row** on every successful send. This is where history is created — both first send and every re-send.

---

## 6. Components / changes

- **DB / migration 101:** `AccAdvanceErpAttempt` + backfill (prod + UAT).
- **`src/lib/adv/advance-erp-attempt-service.ts`** (new): `recordSentAttempt(requestId, docNo, env, company, userId)` and `markResent(requestId, userId)`; `listAttempts(requestId)` for report.
- **`src/lib/adv/advance-erp-send.ts`:** on successful send, call `recordSentAttempt(...)` (alongside `markInterfaceStatus('Sent', …)`).
- **`src/app/api/request/advance/erp-queue/pullback/route.ts`** (new): POST `{ id }` — auth = ACC_OFFICER; guard `ErpInterfaceStatus='Sent'`; runs `markResent` + resets request; logs activity.
- **`src/app/api/request/advance/erp-queue/payment-date/route.ts`** (new): POST `{ id, paymentDate }` — set `AccAdvance.PaymentDate` for an `Approved` + not-`Sent` request; validate against `getPaymentDates()` (400 otherwise). Reused by the "รอส่ง" row picker.
- **`src/features/advance/components/AdvanceErpQueue.tsx`:**
  - "ส่งแล้ว" tab: per-row "ดึงกลับเพื่อยิงใหม่" action → confirm dialog → pullback route → refresh; show attempt chain (DocX=Resent, DocY=Sent) inline / expander.
  - "รอส่ง" tab: per-row **Payment Date picker** (options from `getPaymentDates()`) → payment-date route; shown so the officer can re-target the cycle before re-sending (especially after a pull-back).
- **`advance-queue-service.ts` + Export Excel:** include Resent attempts so Accounting can see which PV to skip.

No AL / BC changes.

---

## 7. Edge cases & guards

- **Pull back only a `Sent` row.** Route rejects (400) if `ErpInterfaceStatus≠'Sent'` — prevents double pull-back / racing tabs.
- **Confirm dialog.** Pull-back is a deliberate action behind a confirm step (no reason text); `ResentBy`/`ResentAt` still recorded for audit.
- **Environment fidelity.** Attempt stores env; a Sandbox `Sent` pulled back re-sends in Sandbox (env comes from the request's current form-environment routing, unchanged).
- **Drift guard.** Existing `AdvanceQueueDriftError` pre-check on re-send still applies.
- **Already posted in BC.** Not detectable in v1 (no BC read). Mitigation: mandatory reason + report visibility + process rule "pull back before Accounting posts". Documented as a known limitation.
- **No. Series gap.** Re-send consumes a new number; the old one becomes a gap. Accepted (matches BC behaviour; no reuse).

---

## 8. Testing

**Unit / integration**
- `recordSentAttempt` inserts `AttemptNo=1, Status='Sent'` on first send; `AttemptNo=max+1` on re-send.
- `markResent` flips the current `Sent` attempt to `Resent` (+by/at) and resets `AccRequest` interface fields.
- Pull-back route rejects a non-`Sent` request.

- `payment-date` route sets `AccAdvance.PaymentDate` for an Approved+not-Sent request; rejects a date outside `getPaymentDates()`.

**E2E (Playwright, UAT mode)**
1. Send an approved AP-2 advance → `ErpInterfaceStatus='Sent'`, attempt#1 `Sent` (verify DB).
2. In "ส่งแล้ว" tab, "ดึงกลับเพื่อยิงใหม่" → confirm → row moves to "รอส่ง"; attempt#1 = `Resent` (verify DB).
3. On the "รอส่ง" row, change Payment Date to a later cycle → re-send → new PV DocY with the **new posting date**; attempt#2 = `Sent`; mapping shows ADV↔DocY, DocX=`Resent` (verify DB + Export Excel row).

---

## 9. Handoff note (governance)

This design is form/DB-only and does not touch BC — no Forge/Atlas AL work required for v1. The already-posted correction path (BC reversal) remains deferred; if it is ever activated, route to **Nova** (accounting policy) and **Scout/Atlas** (BC mechanism) before building, per the escalation rule. Related: `docs/forms/AP-2-ERP-resend-consideration.md`.
