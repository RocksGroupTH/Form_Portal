# AP-11 — what a Submit writes

Written 2026-08-20. Traced from `src/lib/acc/reward/request-service.ts`
(`submitRewardRequest`) and the ledger it calls.

Entry point: **`POST /api/request/reward/requests/[id]/submit`** →
`submitRewardRequest(id, userId, loginEmail)`.

## Which database

`getAccPool()` → `getFormPool()`, so it is **`Rocks_Portal_Form`** — or
**`Rocks_Portal_Form_UAT`** when the caller is an active `UatTester` with UAT
mode on and AP-11 has `UatEnabled`. Every table below lives in whichever one
answered; a submit never spans both. UAT ids start at 900000, so an id names its
own database.

## Before the transaction — refusals, in this order

Nothing is written until all of these pass. Each throws, and the route maps the
error to 400 / 409 through `statusForAccError`.

| Check | Fails with |
|---|---|
| `authorizeAccRequest(session, id, "mutate")` — creator only, `Draft`/`Returned` only | 403 / 404 |
| `assertFormWritable` — AP-11's switch for the resolved environment | 400 |
| `validateRequestedQty` — reward active, in date, `Qty − Locked − Issued ≥ qty` | **409** |
| At least one `AccRequestFile` with `RefType = 'reward_doc'` | 400 |
| `resolveEmployeeForActor(..., { forWrite: true })` → a manager StaffId. In UAT this is `UatTester.ManagerStaffId`, re-verified as an active tester; **it never falls back to HR** | 400 |
| `resolveManagerEmail(managerStaffId)` — the manager's HR email | 400 |

## The transaction — 6 tables, one commit

```
BEGIN TRAN
 1. AccRequest        UPDATE  ← claim
 2. AccReward         UPDATE  ← take stock
 3. AccRewardRequest  UPDATE  ← record the hold, then freeze the snapshot
 4. AccSequence       MERGE   ← allocate TOPyy-nnnnn  (+ UPDATE AccRequest.RequestNo)
 5. AccApproval       DELETE + INSERT
 6. AccActivityLog    INSERT
COMMIT
```

### 1. `AccRequest` — the claim

```sql
UPDATE dbo.AccRequest SET
    Status='Submitted', CurrentStepCode='MANAGER',
    ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, TotalAmount=@total,
    SubmittedBy=@uid, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
  WHERE Id=@id AND CreatedBy=@uid AND Status IN ('Draft','Returned');
SELECT @@ROWCOUNT AS n
```

`@@ROWCOUNT = 0` → `AccConflictError` → **409**. This is the conditional claim:
never read-then-write. `TotalAmount` is `unitActualValue × qty`, rounded to 2dp.

### 2. `AccReward` — the stock

`takeStock` on a first submit, `moveHold` on a resubmit after a Return
(`src/lib/acc/reward/stock-ledger.ts` — **the only file in `src/` that writes
these counters**):

```sql
UPDATE dbo.AccReward SET LockedQty = LockedQty + @qty
 WHERE Id=@id AND Qty - LockedQty - IssuedQty >= @qty
```

Zero rows → 409 with "ของรางวัลคงเหลือไม่พอ". `CK_AccReward_Stock`
(`Locked + Issued <= Qty`) makes an oversell impossible at the schema level even
if this predicate were ever wrong.

### 3. `AccRewardRequest` — the hold, then the snapshot

Two statements. `writeHold` records what the request is *actually holding*:

```sql
UPDATE dbo.AccRewardRequest SET LockedRewardId=@rid, LockedQty=@qty ...
```

then the value snapshot is frozen onto the row:

```sql
UPDATE dbo.AccRewardRequest
   SET RewardCode=@code, RewardName=@name,
       UnitActualValue=@ua, UnitBookValue=@ub, UpdatedAt=SYSDATETIME()
 WHERE RequestId=@rid
```

**`RewardId`/`Qty` and `LockedRewardId`/`LockedQty` are not interchangeable.**
The first pair is what the request *asks for* and stays editable on a draft or a
Returned request; the second is what it *holds*. They diverge the moment a
Returned request is edited, because a Return keeps its hold. Every release and
every issue reads the **held** pair.

The snapshot exists so a settings edit six months later cannot rewrite what
somebody was issued.

### 4. `AccSequence` — the running number

`allocateRequestNo('TOP', now, tx)` MERGEs `AccSequence` for `(Prefix, Year)` and
returns `TOPyy-nnnnn`, then:

```sql
UPDATE dbo.AccRequest SET RequestNo=@no WHERE Id=@id
```

Allocated **after** the claim and the stock, never before — a number must not
exist for a request that has no goods behind it. UAT's first number of a year is
`09001` (`UAT_SEQUENCE_FLOOR = 9000`), production's `00001`.

### 5. `AccApproval` — the chain

```sql
DELETE FROM dbo.AccApproval WHERE RequestId=@id;
INSERT INTO dbo.AccApproval (RequestId, StepCode, StepOrder, AssignedTo, AssignedEmail, Status)
VALUES (@id, 'MANAGER', 1, @mgrStaff, @mgrEmail, 'Pending')
```

The DELETE is what makes a resubmit after a Return run the chain from scratch
rather than stacking rows.

### 6. `AccActivityLog` — the trail

```sql
INSERT INTO dbo.AccActivityLog (RequestId, AuthorId, Action, Note)
VALUES (@id, @by, 'submitted', @requestNo)
```

## After the commit — `AccEmailQueue`

`queueEmail` INSERTs the manager's notification, then `processQueue` drains it.
**Outside the transaction on purpose**: a mail server refusing must not roll back
a submit that has already taken stock and issued a number. In UAT the recipient
is redirected unless they are an active tester, who gets it at their real address
with a `[UAT] ` subject prefix.

## Written earlier — not by Submit

| Table | When |
|---|---|
| `AccRequest`, `AccRewardRequest` | "บันทึกร่าง" — INSERT + MERGE (`saveRewardDraft`) |
| `AccRequestFile` | attaching evidence. Bytes go to SharePoint under `{SHAREPOINT_ACC_FOLDER}/[_UAT/]AP-11/...`; the row is a pointer. Submit only counts these rows |

A draft therefore exists in `AccRequest` with `Status='Draft'`, `RequestNo` NULL,
`SubmittedAt` NULL and `AccRewardRequest.LockedQty = 0`. **`LockedQty = 0` on a
row is proof the submit never ran** — step 2 and step 3 are in the same
transaction.

## Order is the design, not a preference

Claim → take stock → number. Two people racing for the last item both pass the
`Draft` check but only one passes the `Qty - LockedQty - IssuedQty >= @qty`
predicate; the loser's whole transaction rolls back and the route answers 409.
Reading the counters and writing them back would let both through.

## Where the stock comes back

- **Reject** — releases the hold. The only path that does.
- **Return** — does **not**. The request is still alive and keeps its hold; a
  resubmit adjusts by the delta through `moveHold`.
- **Expiry** — never touches `LockedQty`. It is derived from `ExpireDate` on
  read.

This is why AP-11 has no self-cancel button, unlike AP-1's ≤24h window: a
submit-then-cancel loop would burn stock permanently.

`npm run check:reward-stock` re-derives both counters from `AccRewardRequest` and
reports drift.
