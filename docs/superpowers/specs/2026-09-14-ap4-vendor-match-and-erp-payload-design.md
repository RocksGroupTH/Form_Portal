# AP-4 — vendor matching, the ERP payload, and BU→G/L

Design, 2026-09-14. Approved by the user the same day.

Three pieces of one job: fill in the last thing accounting still types by hand,
build the journal AP-4 will eventually post, and give AP-4 a screen for the
rule that decides which account an expense lands in.

> **This does not send anything to Business Central.** The user chose
> "เตรียมข้อมูล + payload ยังไม่ส่งจริง". There is a payload, tests for it, and a
> readiness state on screen; there is no send button, no batch claim and no
> `ErpInterfaceStatus` write. See §2.6 for what whoever builds the sender
> inherits.

---

## 1. AI vendor matching, and "no vendor" as an answer

### 1.1 The problem

`AccReimburseItem.VendorNo` is the Business Central vendor card an expense line
posts against, chosen by accounting on คิวอนุมัติ (บัญชี). Today the queue's
checkbox refuses to enable until **every** line has one
(`queue-readiness.ts`), and nothing helps the accountant find it — they open a
picker of every vendor card in the company and read.

Two things are wrong with that, and they compound:

- **The requirement contradicts the column.** `ReimburseItem.vendorNo`'s own
  docblock says "Null is ordinary: a one-off purchase from a seller who is not a
  vendor of ours". A claim containing one ร้านค้าริมทาง therefore can never be
  approved from the queue, and the only way out is for somebody to pick a vendor
  card that is not the seller.
- **Nothing narrows the search.** The line already carries the seller's
  thirteen-digit tax id, and every vendor card carries
  `taxRegistrationNumber`. That is an exact key nobody is using.

### 1.2 The ladder

Three steps, cheapest and most certain first. **The model is the third
resort, not the first.**

| | Step | Result |
|---|---|---|
| 1 | `vendorTaxId` matches exactly one card's `taxRegistrationNumber` | `auto` — no model call |
| 2 | No tax-id hit: filter the company's cards by the seller name's distinctive words (`buildVendorNameTerms`, AP-3's), then ask the model to pick **from that filtered list** | `auto` |
| 3 | Nothing survives the filter, or the model picks nothing in it | `none` |

**The model may only answer with a card the filter produced**, the same
constraint `pickSuggestedGl` applies to the G/L suggestion: anything else is
dropped. An accountant is never shown a vendor they could not have picked by
hand.

**A tax id matching *several* cards is not a hit.** One tax id genuinely maps to
many cards — a head office and its branches — and picking the first is a guess
that lands in a subledger. It falls through to step 2, where the name can
separate them, and to `none` if it cannot. This is the rule AP-2's matcher
already states for its own ambiguous case, and it was arrived at there the hard
way.

### 1.3 The state has to be stored

`migrations/150_reimburse_item_vendor_match.sql`, **both form databases, before
the code**: `VendorMatchStatus NVARCHAR(20) NULL` on `AccReimburseItem`.

| Value | Means |
|---|---|
| `NULL` | Nobody has looked yet |
| `none` | Looked, and this seller has no card in this company |
| `auto` | Filled by the ladder above |
| `manual` | An accountant picked it |

**`NULL` and `none` must not collapse.** Derived instead of stored, "no vendor
required" would be true of every line from the moment the claim arrived —
including the ones where a card exists and simply has not been looked for. The
checkbox would unlock before anyone had checked anything, which is the opposite
of the control it is supposed to be.

`auto` versus `manual` is the same distinction AP-2's `VendorConfirmedBy` makes:
a row a person chose stays distinguishable from one a machine chose, and the
re-match must not overwrite the first.

`AccReimburseItem` is transactional — not dual-written, not in `MASTER_TABLES`.
`check:alignment` must still read **28** afterwards; 29 means the wrong table
was altered.

### 1.4 The new readiness rule

A line needs a vendor **only when**:

```
vatAmount > 0  AND  vendorMatchStatus !== "none"
```

The first half is AP-3's rule, unchanged and already proven there
(`linesMissingTaxVendor`): **Tax Vendor No. travels on the VAT line and
nowhere else**, so a line with no VAT produces no VAT line at all and is
complete without one. The second half is this feature.

**The claim-level gap therefore becomes "ยังไม่ได้ตรวจ Vendor" rather than
"ยังเลือก Vendor ไม่ครบ"** where the blocker is `NULL` — the remedy is a button,
not a picker, and saying "choose one" sends somebody to a list of four hundred
cards to look for something that may not be there.

### 1.5 The route

`POST /api/request/reimburse/requests/[id]/match-vendors`, modelled on
`suggest-gl` line for line:

- **One claim per call, from a button.** Same argument: per-keystroke spends a
  model call per character, and doing the whole queue on open spends one per
  line before anybody has decided to look.
- **It only fills lines that have no vendor and no verdict** (`VendorNo` blank
  **and** `VendorMatchStatus` NULL). A line an accountant set is their answer; a
  line already marked `none` has been asked and answered. Clearing a line is how
  somebody asks again.
- **The write goes through `setReimburseItemAccounts`**, so it inherits the
  roster check, the state predicate claimed inside the transaction, the brand
  scope re-decided from the database, and the old→new activity row. A sibling
  writer would re-implement four guards and could only get one wrong.
- `authorizeAccRequest(session, id, "read", AP4_FORM_CODE)` — `"mutate"` is
  creator-and-Draft-only and would refuse every legitimate approver, exactly as
  `../items` and `suggest-gl` already record.

`setReimburseItemAccounts` gains `vendorMatchStatus` in its edit shape. It is
the **only** writer of the column, so the four guards are the only path to it.

---

## 2. The Interface ERP payload

### 2.1 What "same data as AP-3" resolves to

The user's instruction was: *ข้อมูลจำเป็นในการส่ง Interface ERP ใช้ข้อมูลเดียวกับของ
AP-3 แต่จะอ่าน Journal Batch จากของ AP-4.* Read against the code, that names
four sources and changes exactly one of them:

| Value | Source for AP-4 |
|---|---|
| VAT input G/L, WHT payable G/L | **AP-3's `AccClearAdvanceInterfaceConfig`** — the same rows. A company's input-tax account does not depend on which form asks. |
| Journal Batch | **AP-4's own** — `listBrandJournalBatches(claimBrand, "AP-4")`, preferring `formCode === "AP-4"` |
| Bank account, branch, ERP department, BC target | AP-4's per-form rows, falling back to the `FormCode IS NULL` default, exactly as `loadAdvanceErpContext` does for AP-2 |
| BU→G/L and Branch→G/L overrides | AP-3's `AccClrBuGlMap` / `AccClrBranchGlMap` — see §3 |

**The Journal Batch must not be read through `ctx.brandAccounts`.**
`resolveJournalBatchName` looks a claim brand's batch up by its *interface*
brand first, so a target-keyed row beats every claim-brand row including AP-4's
own override. That is the AP-2 failure this repository has already shipped once
— "the screen displayed `TRAVELING` while the payload correctly sent `BEE`" —
and CLAUDE.md names it as the rule AP-4's send must follow.

### 2.2 The journal

`Dr expense (per line) + Dr VAT input (per invoice) − Cr WHT payable − Cr bank`

- **Expense lines** carry the per-line G/L, redirected by the line's own branch
  first and its BU second (§3). Only the expense line is redirected: sending
  input tax or cash into a receivable is what a wider rule would do.
- **One VAT line per invoice, immediately after its own expense line**, carrying
  Tax Invoice No./Date/Base/Name, the seller's VAT registration, `taxBranchCode`
  from `VendorBranchCode` and `taxVendorNo` from `VendorNo`. Each of those keys
  is omitted rather than blanked when unknown, so BC keeps what the vendor card
  holds instead of being handed an empty string for a tax filing.
- **WHT is a G/L line at the brand's WHT-payable account, carrying the real
  amount** — decided by the user, 2026-09-14. AP-3 posts a *Vendor* line at
  `WHT-PND.3`/`WHT-PND.53` for **0** and refuses to build at all when the
  ภ.ง.ด. type is missing. AP-4 collects no ภ.ง.ด. type and has no payee list, so
  copying that would make every claim with withholding unsendable. There is no
  vendor line to clear by hand here.
- **The credit is the brand's bank account** for the net paid, and
  `documentType` is **always `Payment`** — money leaves the company every time.
  AP-3 has a signed bank difference and a Refund/Payment rule because an advance
  can come back; AP-4 has no advance.
- **Posting date is the payment date accounting set.** AP-3 chooses between the
  refund slip's date and the payment run; AP-4 has only the run.
- **External Document No. is the requester's staff id**, as in AP-3 and for the
  same documented reason: the layout asks for รหัสพนักงาน, and it once carried
  the request number instead.

### 2.3 It balances, and AP-3's does not

AP-3's lines deliberately do not sum to zero: its WHT and advance-vendor lines
carry 0 so accounting matches and clears them by hand in BC, and CU 50263 only
inserts. **AP-4's do sum to zero**, because every line carries its real amount
and there is nothing to clear by hand.

Written down because it looks like an incomplete copy of AP-3 and is not. A
reader who "fixes" AP-4 to match AP-3 turns real withholding into a zero.

### 2.4 Where it lives

- `src/lib/acc/reimburse/reimburse-erp-payload.ts` — pure. Takes plain values,
  returns `PpapJournalPayload`. No pool import, so it is unit-tested the way
  `clear-advance-erp-payload.test.ts` tests AP-3's.
- `src/lib/acc/reimburse/reimburse-erp-context.ts` — the IO half: resolves the
  config, the target, the ERP department and the two G/L maps for one claim.

### 2.5 Readiness

`erpReadiness` (`erp-queue-policy.ts`) currently checks the G/L account alone.
It gains the things the payload actually throws on, each named in Thai on the
row: a line with VAT but no VAT-input account configured, a claim with
withholding but no WHT-payable account, no bank account, no Journal Batch, no
ERP department for the requester's HR department.

**Readiness is a screen, not a gate** — the payload builder keeps every one of
its own refusals. A queue that says "ready" and a builder that then throws are
two answers to one question, and the builder's is the one that matters.

### 2.6 What the sender still has to do

Not built here, and it is more than a button: claiming the batch atomically
before any external I/O, classifying an unknown remote outcome as
`holdForReconciliation` rather than retrying it, and a readiness gate at
`ACCOUNT_FINAL` or a widened edit window — because `setReimburseItemAccounts`
claims `CurrentStepCode='ACCOUNT'`, so today a claim can reach the ERP queue
unready with no in-app way to correct it.

---

## 3. บัญชีตาม BU — a fifth settings tab

AP-4's settings page gains **บัญชีตาม BU**, reading and writing **the same rows
as AP-3**: `AccClrBuGlMap` (BU → G/L per BC company) and `AccClrBranchGlMap`
(branch → G/L, checked first, being the more specific).

There is **no new table, no `FormCode` column and no migration**. The rule is a
fact about a shop — a store the company owns books its expense to the account it
was coded to; a franchised or managed one books it to a receivable, because the
money is charged back — and that does not change with the form the expense
arrived on.

Two doors into one room, so the screen says so in Thai: a rule set here also
applies to AP-3, and the reverse.

- Route: `/api/request/reimburse/settings/bu-gl-map`, `requireRole(["IT Admin",
  "System Admin"])` on every handler, matching AP-3's. It is not in
  `GRANTABLE_REIMBURSE_TABS`: it decides which account money lands in and is not
  brand-scoped, the same argument that keeps `erpInterface` ungrantable.
- `ROUTE_RULES` needs no entry — `/api/request/reimburse` already classifies
  `AP-4`.
- The table is read through `getAccPool()`, so a UAT tester reads the UAT copy.
  It is not dual-written; that is AP-3's existing choice and AP-4 inherits it
  rather than changing it underneath AP-3.

---

## 4. Testing

Pure modules, tested without a database, because everything that reaches a pool
drags `@/env` into the run:

- `vendor-match-core.test.ts` — the ladder: exact tax id, ambiguous tax id,
  name-term fallback, a model answer outside the candidate list, nothing found.
- `queue-readiness.test.ts` — extended: VAT-free line needs no vendor, `none`
  needs no vendor, `NULL` still blocks, and the gap text says "ยังไม่ได้ตรวจ".
- `reimburse-erp-payload.test.ts` — line order, one VAT line per invoice, the
  WHT line's account and sign, the bank credit, `documentType` always `Payment`,
  the branch-then-BU redirect applying to expense lines and to nothing else, and
  that the lines sum to zero.
- Source guards where behaviour is unreachable from a unit test: that the
  payload's journal batch comes from the AP-4 lookup and never from
  `ctx.brandAccounts`, and that `match-vendors` writes through
  `setReimburseItemAccounts`.

## 5. Order of work

1. Migration 150, applied to **both** form databases before the code.
2. The vendor ladder, its route, the readiness rule, the queue button.
3. The payload, its context, the readiness detail.
4. The บัญชีตาม BU tab.

`npm test`, `npx next build` and `npm run check:alignment` (still 28) before the
commit.
