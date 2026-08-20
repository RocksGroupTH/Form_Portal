# AP-11 — แลกของรางวัล (Reward) — Design

> Written 2026-08-20, before implementation. Source brief: `docs/AP-11.txt`.
> Read this as history: it records what was decided and why, not necessarily
> what the code looks like today.

## What it is

A third Accounting form beside AP-1 (travel expense) and AP-17 (travel
booking). An OP-team member picks a reward from a catalogue, states how many
they want, attaches evidence of the activity, and the request runs
**Manager → Assist AP** before the goods are prepared and handed over.

Form code `AP-11`, group `Accounting`, running prefix **`TOP`** →
`TOP26-00001`, resetting each calendar year. Thai name `แลกของรางวัล`,
English `Reward`.

Header message, shown on the form:

> ใช้สำหรับเบิกของรางวัลสำหรับทีม OP
> ตัดรอบการเบิก (คำขอที่ผ่านการอนุมัติ) ทุกวันศุกร์ 16.00
> รับของรางวัลที่บัญชีทุกวันจันทร์ หลัง 13.00 เป็นต้นไป

The cut-off and pickup times are **copy, not logic**. Nothing computes a
pickup date; the sentences exist to set expectations. This was decided
deliberately — see "Decisions" below.

## What makes AP-11 different from the two forms before it

Everything else on the Accounting backbone is a claim about money that has
already been spent. AP-11 is a claim on **stock that has not been handed out
yet**, and stock can be oversold. That single fact drives most of this design:
the `AccReward` counters, the conditional-`UPDATE` lock at submit, the CHECK
constraint, and the reconciliation script all exist to make "two people
requesting the last item" resolve to one winner and one clean 409.

## Reuse

Unchanged, from the shared backbone:

| Concern | Reused from |
|---|---|
| Request header | `AccRequest` (`FormCode='AP-11'`) |
| Approval rows | `AccApproval`, step codes `MANAGER` then `REWARD` |
| Audit trail | `AccActivityLog` |
| Running number | `allocateRequestNo("TOP", when, tx)` — `src/lib/acc/sequence.ts` |
| Attachments | `AccRequestFile`, SharePoint via `buildAccFolderPath` |
| Mail | `AccEmailQueue` + `queueEmail`/`processQueue` |
| Requester + manager identity | `resolveEmployeeForActor()` — `src/lib/hr/employee-lookup.ts`, UAT-aware |
| Object ACL | `authorizeAccRequest()` — `src/lib/acc/request-acl.ts` |
| Attachment admission | `checkAttachmentBatch()` / `attachmentResponseHeaders()` |
| Errors → status | `AccConflictError` (409) / `AccForbiddenError` (403) |

**No Business Central.** AP-11 posts nothing to ERP; the `ErpInterface*`
columns on its rows stay NULL, and it gets no ERP-prep entry.

## Data model

### `AccReward` — the reward master, brand-scoped

| Column | Type | Notes |
|---|---|---|
| `Id` | int identity | |
| `BrandCode` | nvarchar(20) | rewards are per company brand |
| `Code`, `Name` | nvarchar | unique on `(BrandCode, Code)` |
| `Qty` | int | stock received — entered by hand (brief §3) |
| `LockedQty` | int | held by in-flight requests — never edited by hand |
| `IssuedQty` | int | handed over — never edited by hand |
| `UnitActualValue` | decimal(18,2) | brief §7 มูลค่าจริงตาม Reward ต่อหน่วย |
| `UnitBookValue` | decimal(18,2) | brief §9 มูลค่าตามบัญชีต่อหน่วย |
| `TotalActualValue` | computed | brief §8 — `Qty * UnitActualValue` |
| `TotalBookValue` | computed | brief §10 — `Qty * UnitBookValue` |
| `StartDate`, `ExpireDate` | date | brief §11-12 |
| `PoNo`, `PinNo`, `PrepaymentNo` | nvarchar(100) | brief §12-14 |
| `IsActive` | bit | brief §15 สถานะใช้งาน/ปิด |

`CK_AccReward_Stock`: `LockedQty >= 0 AND IssuedQty >= 0 AND LockedQty +
IssuedQty <= Qty`. The database refuses an oversell even when a code path is
wrong. The two totals are **SQL computed columns** so they cannot drift from
the per-unit values they are derived from.

### `AccRewardRequest` — one row per request

One reward per request (decided), so this is 1:1 with `AccRequest`, not a line
table. `RequestId`, `RewardId`, `Qty`, plus a **snapshot** of
`RewardCode`/`RewardName`/`UnitActualValue`/`UnitBookValue` taken at submit —
so editing the master later does not rewrite history — plus `ReadyAt`/`ReadyBy`
and `ReceivedAt`/`ReceivedBy` for the Assist AP work page (brief §"หน้าทำงาน
ของ Assist AP").

**And a second pair of quantity columns, `LockedQty` / `LockedRewardId`,**
separate from `Qty` / `RewardId`. The distinction is intent versus commitment:

- `RewardId` / `Qty` — what the request is **asking for**. Editable on a draft
  and on a `Returned` request.
- `LockedRewardId` / `LockedQty` — what it is **actually holding** in
  `AccReward.LockedQty` right now.

They are equal immediately after a submit and diverge whenever a `Returned`
request is edited, because a Return keeps its hold. Collapsing them — reading
the held amount back out of `Qty` — is a real bug that was written and then
caught during implementation: it makes the two always equal, so a resubmit that
changed 5 to 8 adjusts the lock by zero and leaves the reward **under-locked by
3**. `CK_AccReward_Stock` cannot see that, because the counters stay internally
consistent while no longer describing the requests they came from; only the
reconciliation script would catch it, after the fact. Changing the *reward* on a
Returned request has the same shape, which is why the reward id is tracked
alongside the quantity: the old hold is released in full and the new one taken
in full, because the two counters live on different rows.

### `AccRewardOfficer` — the Assist AP roster

`StaffId`, `Email`, `DisplayName`, `IsActive`. Same shape as `AccApprover`, and
deliberately **not** the same list: the people who prepare rewards are not the
people who approve travel claims.

## The three derived numbers (brief §4-6)

One pure function — `src/lib/acc/reward/stock.ts`, unit-tested without a
database:

```
requestQty = LockedQty + IssuedQty
expiredQty = (ExpireDate != null && ExpireDate < today)
               ? Qty − LockedQty − IssuedQty
               : 0
balanceQty = Qty − LockedQty − IssuedQty − expiredQty
```

`balanceQty` is one number with one meaning: what a person may still ask for.
It is what the reward card shows, what the quantity input is capped at, and
what the `Balance` column on the settings page reads — so brief §4's "Balance
Qty (จำนวนคงเหลือ − กับจำนวนที่ถูกล๊อก)" and brief §6's `Balance` are the same
figure rather than two that have to be reconciled by eye.

Expiry needs no scheduled job. Past `ExpireDate` the remaining stock counts as
expired, the balance is 0, and the reward drops out of the picker on its own.

## Status flow

`CK_AccRequest_Status` gains `'Ready'` and `'Received'` (migration 067,
modelled on `050_acc_request_status_completed.sql`).

```
Draft ──submit──► Submitted ──Manager──► ManagerApproved ──Assist AP──► Approved
                                                                           │
                                                          Ready ◄──กด Ready┘
                                                            │
                                                          Received  (terminal)
```

- Reject and Return branch off either approval step; both **require a reason**
  (brief §"Step การ Approve" says so for both steps).
- `Ready` and `Received` are real `AccRequest.Status` values rather than flags
  on the detail row, so `/my-request` and `/my-work` show the truth instead of
  freezing at "อนุมัติแล้ว".
- Step codes: `MANAGER`, then `REWARD`.

**No self-cancel.** AP-1 lets a requester cancel within 24h of submitting;
AP-11 deliberately does not, because Cancel does not release stock (see
Decisions). An unwanted request is released by an approver rejecting it.

## The lock

At submit, inside one transaction, in this order:

1. **Claim the draft** — `UPDATE AccRequest SET Status='Submitted' … WHERE
   Id=@id AND Status IN ('Draft','Returned')`, check `rowsAffected`. Never
   read-then-write.
2. **Take the stock** — one conditional UPDATE:

   ```sql
   UPDATE dbo.AccReward SET LockedQty = LockedQty + @qty
    WHERE Id = @rewardId AND IsActive = 1
      AND (StartDate  IS NULL OR StartDate  <= CAST(SYSDATETIME() AS date))
      AND (ExpireDate IS NULL OR ExpireDate >= CAST(SYSDATETIME() AS date))
      AND Qty - LockedQty - IssuedQty >= @qty;
   ```

   0 rows → rollback → `AccConflictError` → **409**
   `ของรางวัลคงเหลือไม่พอ`. Two people racing for the last item: one wins,
   one gets a clean, non-retryable answer.
3. **Only then** `allocateRequestNo("TOP", …, tx)` — per the repo rule that a
   number is issued after the claim, so a lost race never burns one and leaves
   a gap in a sequence people read as a ledger.

Afterwards:

| Event | Stock effect |
|---|---|
| Reject (Manager or Assist AP) | `LockedQty -= held`, then the request's own `LockedQty` is zeroed |
| Received | `LockedQty -= held; IssuedQty += held` in one statement; the request's `LockedQty` stays, now recording what was issued |
| Returned | **no change** — the request is still alive and keeps its hold |
| Resubmit of a Returned request | `moveHold` — delta on the same reward, or full release + full take on a different one |

All of these read the *held* pair, never the *asking-for* pair. `writeHold`
rewrites the request's record of its hold in the same transaction as the
`AccReward` counter it describes, so the two can never disagree.

Lowering `Qty` on the settings page below `LockedQty + IssuedQty` is refused
with a 409 naming the shortfall, rather than letting the CHECK surface as a raw
SQL error.

`scripts/checks/verify-reward-stock.ts` re-derives both counters from
`AccRewardRequest` and reports drift — the role `verify-master-alignment.ts`
plays for the shared masters.

## Pages

| Path | Who | What |
|---|---|---|
| `/request/reward` | any staff | Fill / resume draft. Reward **cards** showing balance and value; picking one fills the quantity section, capped at balance. Attachment required. |
| `/request/reward/[id]` | ACL | Detail + timeline. Manager and Assist AP action buttons render here when it is that person's step. |
| `/request/accounting/reward` | officer / admin | Assist AP work queue — Approve/Reject, then **Ready** and **Received**, each stamping a date and time. |
| `/request/accounting/reward-report` | officer / admin | All requests with filters + Excel export. |
| `/request/accounting/reward-settings` | officer / admin | Reward master (brief §"หน้า Setting Reward") and the Assist AP roster. |

The three back-office pages sit under `/request/accounting/` the way AP-17's
do, which is why each needs its own `ROUTE_RULES` entry — see below.

## UAT and routing

- `FormCode` union and `FORM_CODES` in
  `src/lib/form-environment/classify-path.ts` gain `"AP-11"`.
- `ROUTE_RULES` gains, longest-prefix first:
  `/request/accounting/reward`, `/request/accounting/reward-report`,
  `/request/accounting/reward-settings` → `AP-11`; then
  `/api/request/reward` and `/request/reward` → `AP-11`.
  Listed individually rather than by a separator trick, exactly as the AP-17
  entries are, so `/request/accounting-anything` cannot match.
- A `FormEnvironment` row makes AP-11 pilotable in UAT independently of the
  other two forms.
- `assertFormWritable()` is called at `saveDraft` and at `submit` — bringing
  its call sites from four to six.
- `AccRewardRequest` is transactional, so it joins the identity-floor set:
  migration 068 reseeds it to 900000 and adds `CHECK (Id >= 900000)`, `_UAT`
  only, matching 061/064.
- `AccReward` and `AccRewardOfficer` get **no** identity floor and are **not**
  dual-written — see Decisions.

## Authorization

`decideRequestRead` / `decideRequestMutate` are unchanged. The viewer's
`isAccountArea` flag is computed per form in `request-acl.ts`: for AP-11 it
means *admin role or active `AccRewardOfficer`*, for AP-1 and AP-17 it keeps
its current meaning. The pure policy stays pure and the UAT tester barrier
applies to AP-11 for free.

Attachments are admitted by `checkAttachmentBatch()` with
`allowedKinds: ["image", "pdf"]` — the brief's examples are screenshots, and
PDF is accepted the way AP-17 accepts it — and served through
`attachmentResponseHeaders()`.

## Decisions

Recorded with their reasons, because several are not the obvious choice.

1. **Manager step reads HR, not a configured list.** The brief left this open
   ("`ManagerStaffId` ?? OR Setting user approve"). Reading
   `Rocks_Portal_HR.Employee.ManagerStaffId` reuses `resolveEmployeeForActor()`
   whole, including the UAT manager override, and adds no settings page.
2. **One reward per request.** Simplest model that satisfies the brief; a
   person needing three rewards files three requests and gets three running
   numbers.
3. **Stock is released on Reject only** — not on Return, not on Cancel, not on
   expiry. Consequence, accepted deliberately: because Cancel does not release,
   **AP-11 has no self-cancel button at all**. Releasing an unwanted request is
   an approver's Reject. Without that, a submit-then-cancel loop would burn
   stock permanently.
4. **The Friday 16:00 / Monday 13:00 cycle is copy, not logic.** No computed
   pickup date, no calendar shifting. If a pickup date is wanted later it can
   be added the way AP-1's `PaymentDate` was.
5. **`Request = LockedQty + IssuedQty`**, so `Balance` is directly "what you
   can still ask for". The alternative — `Request = IssuedQty` with a separate
   Locked column — puts two subtractions in front of the reader for no gain.
6. **Assist AP is its own roster (`AccRewardOfficer`), not `AccApprover`.** The
   people who hand out rewards are not the people who approve travel claims,
   and folding them together would silently give every AP-1 approver the reward
   queue.
7. **Per-unit values are typed, totals are computed.** Brief §8 and §10 are
   `unit × Qty`.
8. **Attachment required at submit.** Brief §5 is the evidence the whole claim
   rests on; a request with no screenshot cannot be assessed.
9. **`AccReward` and `AccRewardOfficer` are per-database, not dual-written.**
   The 19 dual-written masters are settings; `Qty` is inventory. Mirroring it
   means either a UAT test drains the production count or a production edit
   resets a tester's stock, and the stock CHECK would make some legitimate
   production edits fail because of test data. Cost: an admin seeds a couple of
   test rewards in UAT by hand, which is what UAT is for.

## Testing

Pure units, no database (the repo convention — `@/env` validates the whole
environment at import time, so anything reachable from a pool drags live
configuration into the test run):

- `src/lib/acc/reward/stock.test.ts` — the three derived numbers, including
  the expiry boundary, a fully locked reward, and `Qty` reduced below what is
  already committed.
- `src/lib/form-environment/classify-path.test.ts` — the five new prefixes,
  and that `/request/accounting/reward-report` does not fall through to AP-1.

Verified by hand against the live schema before the migrations are called done:
`AccReward` CHECK rejects an oversell; a concurrent double-submit for the last
item yields one success and one 409.
