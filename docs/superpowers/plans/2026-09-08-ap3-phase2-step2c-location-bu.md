# AP-3 Phase 2 Step 2c — Location→BU sync and the buCode the portal sends

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the portal the Location→BU binding it has never had, so every journal line carries the Business Unit its Location is actually bound to instead of the constant `COCO` the codeunit has been writing.

**Architecture:** A fourth ERP master sync beside the three that already exist. BC already exposes exactly what is needed, so nothing changes in AL: `RPCCodexStore_CodexGetLocations` returns every Location with its `bu`, `branch` and `department`. A new `ErpLocation` table mirrors it, `location-sync.ts` fills it the way `vendor-sync.ts` fills `ErpVendors`, a Sync tab on the AP-3 settings page runs it, and the journal builder looks a line's branch up in it.

**Tech Stack:** TypeScript, `node:test` via `npm test`, MSSQL (`Rocks_ERP_Data`), Next.js route handlers and React for the settings tab.

**Spec:** `docs/superpowers/specs/2026-09-08-ap3-phase2-erp-fields-design.md` §5.1

---

## What the probe established

Run against PCTH Production before writing any of this:

- **The endpoint exists.** `RPCCodexStore_CodexGetLocations` returns **240 rows**,
  each `{ code, name, branch, bu, department }`.
- **Location is the branch.** `code === branch` on **all 240** rows, which is why
  the line's existing `branchCode` is the lookup key and no new field is needed
  on the expense line.
- **The constant is wrong for nearly half the estate.** Only **130 of 240**
  Locations are `COCO`. The rest: `DODO-M` 36, `DOCO` 29, `DODO` 13, `CTPS` 11,
  `DODO-A` 9, `LICNS` 8, `EXPR` 4. Every line of every AP-2 and AP-3 journal sent
  so far has carried `COCO` regardless.

That last number is the reason this is worth doing rather than a tidy-up.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `migrations/138_erp_location.sql` | `Rocks_ERP_Data.ErpLocation` | Create |
| `src/lib/erp/location-sync.ts` | Fetch from BC, upsert, deactivate, log | Create |
| `src/lib/erp/location-lookup.ts` | Read side: branch → BU, cached per request | Create |
| `src/app/api/request/clear-advance/settings/locations/sync/route.ts` | POST to run the sync | Create |
| `src/app/api/request/clear-advance/settings/locations/route.ts` | GET the current rows + last sync for the tab | Create |
| `src/features/clear-advance/components/settings/ClrLocationSyncPanel.tsx` | The tab | Create |
| `src/app/(dashboard)/request/clear-advance/settings/page.tsx` | Tab list | Add `locations` |
| `src/lib/clr/clear-advance-erp-payload.ts` | Journal builder | `buCode` per line |
| `src/lib/clr/clear-advance-erp-send.ts` | Sender | Resolve and pass the BU map |

---

## Task 1: The table

**Files:**
- Create: `migrations/138_erp_location.sql`

- [x] **Step 1: Write the migration**

Follow `117_erp_vendors.sql` exactly for the guard, the transaction and the
`IF OBJECT_ID(...) IS NULL` shape.

```sql
-- Business Central Location master with its default dimensions.
-- Source: RPCCodexStore_CodexGetLocations. Apply only to Rocks_ERP_Data.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 138 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE
BEGIN
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.ErpLocation', 'U') IS NULL
  CREATE TABLE [dbo].[ErpLocation] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [Code] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    -- BC returns `branch` alongside `code`; on every row seen so far they are
    -- equal, but it is stored rather than assumed so a divergence is visible
    -- in the data instead of silently changing which line gets which BU.
    [BranchCode] NVARCHAR(50) NULL,
    [BuCode] NVARCHAR(50) NULL,
    [DepartmentCode] NVARCHAR(50) NULL,
    [IsActive] BIT NOT NULL CONSTRAINT DF_ErpLocation_IsActive DEFAULT (1),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT DF_ErpLocation_SyncedAt DEFAULT (SYSDATETIME()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT PK_ErpLocation PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT UQ_ErpLocation_Brand_Code UNIQUE ([BrandCode], [Code])
  );

  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpLocation_Brand_Branch' AND object_id = OBJECT_ID('dbo.ErpLocation'))
    CREATE INDEX IX_ErpLocation_Brand_Branch ON [dbo].[ErpLocation] ([BrandCode], [BranchCode]) INCLUDE ([BuCode], [IsActive]);

  COMMIT TRANSACTION;
END
```

- [x] **Step 2: Apply it to Rocks_ERP_Data**

```bash
npm run apply-sql -- --db Rocks_ERP_Data --file migrations/138_erp_location.sql
```

- [x] **Step 3: Confirm** — *done 2026-09-08*

Ten columns as designed, and three indexes: `PK_ErpLocation`,
`UQ_ErpLocation_Brand_Code` and `IX_ErpLocation_Brand_Branch`.

Two things were checked beyond "it ran". Applying it a second time succeeds and
changes nothing, so a re-run during a later deploy is harmless. And pointing it
at `Rocks_Portal_Form_UAT` is **refused** — "Migration 138 may only be applied to
Rocks_ERP_Data" — with no table left behind in the form database afterwards,
which is the failure mode the guard exists for.

- [x] **Step 4: Commit**

---

## Task 2: The sync — *done 2026-09-08*

**Files:**
- Created: `src/lib/erp/location-sync-core.ts` (pure shaping) + `location-sync-core.test.ts`
- Created: `src/lib/erp/location-sync.ts` (BC call and writes)

- [x] **Step 1: Write it**

Split in two, which the plan did not anticipate: importing `location-sync.ts`
from a test drags in `@/lib/db/mssql` and `src/env.ts` validates at module load,
so the test run died on missing `AUTH_SECRET`/`MSSQL_*`. That is the reason this
repo already keeps `ai-receipt-core.ts` and `vendor-match-core.ts` separate, and
the same split applies here: `location-sync-core.ts` holds `normalizeLocationRow`
and nothing else, and is what the tests import.

Two guards worth naming. A row with no Location code is dropped — there is no
key to merge it on. And **an empty answer from BC is treated as a failure**, not
as "no Locations": the deactivate pass runs straight after the upserts, so
accepting an empty list would silently switch off the entire brand.

- [x] **Step 2: Run it for real against PCTH** — *done, and for every brand*

| Brand | Locations | COCO | other BU |
| --- | --- | --- | --- |
| PCTH | 240 | 130 | **110** |
| PCMY | 43 | 37 | 6 |
| UNO | 40 | 38 | 2 |
| KSI | 18 | 15 | 3 |

PCTH's spread matches the probe exactly — COCO 130, DODO-M 36, DOCO 29, DODO 13,
CTPS 11, DODO-A 9, LICNS 8, EXPR 4. Across all four brands **121 of 341
Locations carry a BU the constant could never produce**.

Also checked, rather than assumed: a second run leaves 240 rows and 240 active,
so the MERGE is not inserting duplicates; `Code = BranchCode` on all 240, which
is what makes the line's branch a valid lookup key; and `ErpSyncLog` has a
`LOCATIONS` row per run.

- [x] **Step 3: Commit**

---

## Task 3: The read side — *done 2026-09-08*

**Files:**
- Created: `src/lib/erp/location-lookup-core.ts` + `location-lookup-core.test.ts` (pure)
- Created: `src/lib/erp/location-lookup.ts` (the database read)

- [x] **Step 1-4: tests, then the fold, then the loader**

Six tests on `buildBranchBuMap`: the plain mapping, case-insensitive matching on
both sides, a Location with no BU left absent rather than mapped to blank, a row
with no branch skipped, whitespace trimmed, and a repeated branch resolving to
the first entry deterministically.

**A real bug the unit tests could not have caught.** `loadBranchBuMap` first read
zero branches for every brand against a table holding 341 rows. The cause was
`res.recordset as LocationBuRow[]` — a cast that type-checks and lies: the
recordset carries the SELECT's own PascalCase keys (`BranchCode`), the type
expects camelCase (`branchCode`), so every row read `undefined` and was skipped.
The failure mode is the quiet one — an empty map sends no `buCode`, every line
falls back to `COCO`, and the result looks exactly like the bug this whole step
exists to fix. The columns are now mapped across explicitly.

Verified against the real table afterwards: PCTH 240 branches with the expected
spread, KSI 18, UNO 40, PCMY 42, an unknown brand → empty map, an unknown branch
→ undefined, and a lower-case brand code resolving the same as upper.

**PCMY maps 42 branches from 43 Locations, and that is correct.** `INTRANSIT`
and `MW001` are both bound to branch `MW001` — the first case seen where a
Location's `code` differs from its `branch`, which is why Task 1 stored the two
separately instead of assuming them equal. Both carry `COCO`, so the collision
changes no answer today; the first-wins rule keeps it from changing by row order
if they ever diverge.

### Task 3b: the blocked branch (added on request, 2026-09-08)

The lookup returns `{ buCode, isBlocked }` per branch, not a bare BU string.

**Why it earns its place:** 27 of PCTH's BRANCH dimension values are blocked in
BC and 25 active Locations still point at them — closed stores like
อยุธยาซิตี้พาร์ค and เอ็มควอเทียร์. BC refuses a journal line carrying a blocked
dimension value, one line at a time, with a reason nothing on this side stores.
That is the same shape of silent per-line failure as the BRANCH≠DEPT bug: the
send reports partial success and the reason is only in BC.

**Blocked is joined, never stored.** It belongs to the BRANCH dimension value and
moves on the dimension sync's schedule; copying it into `ErpLocation` would make
a second truth that goes stale between two syncs. The join is `LEFT`, and a
missing dimension row counts as open — a brand whose dimension values have never
been synced has no rows at all, and reading that silence as "blocked" would flag
every branch it has. Absent data must not manufacture a warning.

**One inclusion rule changed.** The query no longer requires `BuCode IS NOT NULL`,
so a Location with no BU now yields an entry with `buCode: null` instead of
vanishing. The caller still sends no `buCode` key for it — absence is what makes
the codeunit apply its fallback — but the blocked flag stays visible either way.
Verified this added no rows: the branch counts are unchanged at 240 / 18 / 42 /
40, so every active Location currently has a BU.

Confirmed against the real tables — PCTH 25 blocked, KSI 1, UNO 1, PCMY 0,
matching a direct SQL count; `PC1021` reads `{ buCode: "COCO", isBlocked: true }`
and `HQ01` reads `{ buCode: "COCO", isBlocked: false }`.

**Decided 2026-09-08: warn, still allow the send.** Task 5 surfaces a blocked
branch in the preview and lets accounting send anyway. Refusing would rest on an
assumption nobody has tested — that BC rejects *every* blocked-dimension line —
and a wrong guess there would block work that actually posts. A warning is
useless if the send was going to succeed; a block is damaging. The flag is
recorded now and nothing reads it yet.

---

## Task 4: The Sync tab on the AP-3 settings page — *done 2026-09-08*

**Files:**
- Create: `src/app/api/request/clear-advance/settings/locations/route.ts` (GET)
- Create: `src/app/api/request/clear-advance/settings/locations/sync/route.ts` (POST)
- Create: `src/features/clear-advance/components/settings/ClrLocationSyncPanel.tsx`
- Modify: `src/app/(dashboard)/request/clear-advance/settings/page.tsx:15-40`

- [x] **Step 1: The routes**

Both follow `src/app/api/request/accounting/settings/erp-accounts/sync/route.ts`:
**`requireRole(["IT Admin", "System Admin"])`, not a tab grant.** `ErpLocation`
lives in `Rocks_ERP_Data` beside rows other applications read; a settings-tab
grant must not become write access to them. Copy that route's reasoning into a
comment rather than restating it thinly.

GET returns the rows for the brand plus the last sync from `ErpSyncLog`, so the
tab can show when it last ran without a second call.

- [x] **Step 2: The panel**

A Sync button, the last-sync line, and a table of Code / Name / Branch / BU /
Dept.

**The hide-for-non-admin rule turned out not to apply here.** The AP-2 panel
hides its button because that page is opened by a tab grant. The whole AP-3
settings page is already gated to IT Admin / System Admin
(`settings/page.tsx:60`), so a non-admin never reaches the panel to be refused.
The routes still carry `requireRole` — they are reachable on their own.

Built in `components/admin/`, not the `components/settings/` this plan named:
every other AP-3 settings panel lives in `admin/` and there is no `settings/`
directory to join.

The table also carries the blocked badge from Task 3b, with a count above it.
It is the one place the flag is visible today.

Show the BU spread as a summary line (`COCO 130 · DODO-M 36 · …`): it is the
one number that tells an accountant at a glance whether the sync brought back
what they expected.

- [x] **Step 3: Register the tab**

In `settings/page.tsx`, add `"locations"` to `TabKey` and a `TABS` entry —
label "Location / BU", an icon consistent with the others.

- [x] **Step 4: Verify on screen**

Open `/request/clear-advance/settings?tab=locations`, press Sync, and confirm
240 rows land with the BU spread above. Then:

```sql
SELECT BuCode, COUNT(*) FROM Rocks_ERP_Data.dbo.ErpLocation
WHERE BrandCode = 'PCTH' AND IsActive = 1 GROUP BY BuCode ORDER BY COUNT(*) DESC
```

Expected: COCO 130, DODO-M 36, DOCO 29, DODO 13, CTPS 11, DODO-A 9, LICNS 8,
EXPR 4.

**Confirmed on screen 2026-09-08.** The tab rendered exactly that spread over 240
rows, the Sync button ran (`ErpSyncLog` id 1006, PCTH, success, 240) and the
last-sync line moved from 14:53 to 15:19 once it finished. Switching to PCMY
refetched: 43 rows, `COCO 37 · DOCO 5 · CTPS 1`, and no blocked warning — correct,
PCMY has none.

**Two things worth knowing.**

The sync takes about twelve seconds for PCTH; the button holds its loading state
throughout, and a snapshot taken during it still shows the old timestamp. That is
the refresh being honest, not a stale read.

The tab lists 43 PCMY Locations where the journal lookup builds 42 branches — the
same `INTRANSIT` / `MW001` pair from Task 3. The two numbers count different
things and both are right: this tab shows Locations, the lookup keys by branch.

- [x] **Step 5: Commit**

---

## Task 5: The journal sends buCode — *done 2026-09-08*

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.ts`
- Modify: `src/lib/clr/clear-advance-erp-send.ts`
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [x] **Step 1: Write the failing tests**

```ts
test("a line's BU comes from its branch", () => {
  const p = buildClearAdvanceJournalPayload(base({
    branchBu: new Map([["HQ01", "DODO-M"]]),
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.buCode, "DODO-M");
});

/* Sending nothing is what makes the codeunit fall back to COCO. An explicit
 * "COCO" would be indistinguishable from a real answer, and a branch we have no
 * Location for has no answer. */
test("a branch with no Location sends no buCode at all", () => {
  const p = buildClearAdvanceJournalPayload(base({ branchBu: new Map() }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.buCode, undefined);
});

test("each line is resolved from its own branch", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 3000,
    branchBu: new Map([["HQ01", "COCO"], ["PC1057", "DODO-M"]]),
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "PC1057" },
    ],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.buCode, "COCO");
  assert.equal(p.lines.find((l) => l.accountNo === "610319001")!.buCode, "DODO-M");
});
```

- [x] **Step 2: Run and watch them fail**

- [x] **Step 3: Implement**

`ClrJournalInput` gains `branchBu?: ReadonlyMap<string, string>`. `glLine` and
the vendor/bank line builders resolve
`branchBu?.get((branchCode ?? defaultBranch).trim().toUpperCase())` and spread
`buCode` in only when it is found — the same `...(x ? { x } : null)` shape
`adjCode` uses, so an unresolved branch leaves the payload byte-identical to
today's.

`PpapJournalLinePayload` gains `buCode?: string`.

- [x] **Step 4: The sender loads the map**

In `clear-advance-erp-send.ts`, call `loadBranchLookup(...)` once per request and
pass it in. Once per clearing, not once per line.

**This plan named the wrong key, and following it would have shipped nothing.**
`req.brandCode` is the claim brand the requester picked — `ROCKS` on the one
request in the queue. Everything in `Rocks_ERP_Data` is keyed by the *Company*
the journal posts into: `loadBranchLookup("ROCKS")` returns 0 branches, no line
gets a `buCode`, and every one of them stays on the codeunit's COCO. The feature
would have looked complete and changed nothing — the same failure as Task 3's
cast bug, and again wearing the costume of the bug it was meant to fix.

The key is `target.interfaceTarget`, already loaded a few lines above. AP-2's own
branch and G/L pickers take the same argument, and it is named `company` there
(`clear-advance-admin-service.ts:78`).

**Verified at the wire, since no test can see this:** ROCKS resolves to PCTH;
the claim brand yields 0 branches and PCTH 240; `PCCT01` puts `buCode: "CTPS"` on
the line, `pcct01` resolves the same, `PC1021` carries COCO with the blocked flag
set, and an unknown branch produces a line with no `buCode` key at all.

- [x] **Step 5: Run tests and typecheck, then commit**

### What the preview shows (the "warn, still allow" half)

`ClrPreviewLine` gained `buCode` and `branchBlocked`. The queue shows the BU
beside the branch — it reads as part of the branch because that is what decides
it — a `BLOCKED` badge on the branch itself, and a count in the send-confirm
dialog, worded as a warning rather than a prohibition.

**How often that badge should appear, honestly:** rarely. The AP-3 branch picker
already filters blocked values out (`IsBlocked = 0 OR IsBlocked IS NULL`), so a
branch cannot normally be chosen while blocked. What the badge catches is a
branch blocked *after* its request was raised, and the default branch inherited
from AP-2's config, which no picker filters. That is a narrow case — but it is
also the one nobody would ever think to look for, and BC's refusal of it says
nothing this side can read.

---

## Task 6: Prove it in BC — *done 2026-09-08*

- [x] **Step 1: Send a clearing whose branch is not a COCO Location**

Pick a branch from the `DODO-M` or `DOCO` set so the line carries something the
constant never could. Drive it through submit, three approvals and the send.

The manager step needs `ACC_MANAGER_DEV_BYPASS=1` and a restart of `:3081`
unless you are the assigned manager — **take it back out afterwards.**

- [x] **Step 2: Confirm what was sent**

The preview does not show `buCode`, and BC cannot be read back from here, so
confirm at the wire as Step 2b did: a temporary log of the payload at the send,
removed straight after.

Expected: the expense line's `buCode` is the branch's real BU; a line whose
branch has no Location carries no `buCode` at all.

- [x] **Step 3: Record the document number.**

### What was sent — `ADC26-09012` → **`PVA2609-0013`**, Sent, 0 failed

Built deliberately with two branches on different BUs, which is stronger than the
single non-COCO line this plan asked for: a document carrying two different BUs
is something the old constant could not produce under any circumstances.

| Line | Branch | buCode |
| --- | --- | --- |
| G/L 610116003 · 1,500 | PCCT01 (Catering Set 1) | **CTPS** |
| G/L 610322005 · 1,000 | HQ01 | **COCO** |
| Vendor ADV0080 · 0 | PCCT01 (default branch) | **CTPS** |

Confirmed twice over: the preview rendered `PCCT01 · CTPS` and `HQ01 · COCO`, and
a temporary file log of the payload at the send — removed straight after, along
with the dev-bypass flag — showed `"buCode": "CTPS"` and `"buCode": "COCO"` on the
wire, beside `"employeeCode": "10177"` from Step 2b.

The clearing was built to land exactly on the advance (2,500 of 2,500) so no
refund leg was required, which kept the test to the thing under test.

### What this does **not** prove

**That BC stored CTPS.** "Sent" means the codeunit accepted the payload and
inserted the lines — and codeunit 50263 ignores JSON keys it does not know. A
still-deployed old build would read no `buCode`, write COCO, and answer Sent
exactly the same way. Nothing on the portal side can tell the two apart.

The codeunit exposes only `CreateFromJson`; there is no read-back, so this is the
boundary of what can be verified from here. The remaining check belongs in BC:
open batch `Q`, find document `PVA2609-0013`, and read Shortcut Dimension 2 / the
BU dimension on each line. Two different values across the three lines means the
1.0.0.205 build is live and doing its job; three COCOs means the old build is
still deployed.

A decisive probe from this side is possible — send a deliberately invalid
`buCode` and see whether it errors (new build) or silently inserts (old) — but it
writes a stray line into the Sandbox batch if the old build is live, so it was
not run unasked.

---

## Done

- `npm test` at or above baseline, `npx tsc --noEmit` clean of source errors.
- `ErpLocation` holding 240 PCTH rows with the BU spread above.
- A Sync tab that fills it.
- One BC document whose lines carry a BU the old constant could not produce.

**Blocked on nothing.** The AL half (`buCode` with the `COCO` fallback) is
already written; until it is published, sending the key is inert, which makes
this safe to ship in either order.
