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

## Task 2: The sync

**Files:**
- Create: `src/lib/erp/location-sync.ts`

- [ ] **Step 1: Write it**

Model it on `src/lib/erp/vendor-sync.ts`: resolve the brand's BC connection and
company, call the RPC, MERGE each row, deactivate rows the sync did not touch,
write `ErpSyncLog`.

```ts
/** Sync Business Central Locations into Rocks_ERP_Data.ErpLocation via RPCCodexStore_CodexGetLocations. */

/** Shape returned by RPCCodexStore_CodexGetLocations. */
interface BcLocationRow {
  code?: string | null;
  name?: string | null;
  branch?: string | null;
  bu?: string | null;
  department?: string | null;
}
```

The upsert mirrors the dimension sync's MERGE — key on `(BrandCode, Code)`,
set `IsActive = 1` and `SyncedAt = SYSDATETIME()` on both branches — then:

```sql
UPDATE [dbo].[ErpLocation]
SET IsActive = 0
WHERE BrandCode = @brand AND SyncedAt < @cutoff
```

so a Location that disappears from BC stops being offered without its history
being deleted.

Export `syncBrandErpLocations(brandCode, triggeredBy)` and
`syncAllBrandErpLocations(triggeredBy)`, matching the vendor sync's pair.

- [ ] **Step 2: Run it for real against PCTH**

There is no unit test that can prove a sync; the proof is rows in the table.

```bash
npx tsx scripts/_probe-locations.ts PCTH   # already deleted by then — write a
                                           # one-off or call the route in Task 4
```

Prefer proving it through the route in Task 4 rather than adding a script that
then needs deleting.

- [ ] **Step 3: Commit**

```bash
git add src/lib/erp/location-sync.ts
git commit -m "feat(erp): sync BC Locations and the BU each one is bound to"
```

---

## Task 3: The read side

**Files:**
- Create: `src/lib/erp/location-lookup.ts`
- Test: `src/lib/erp/location-lookup.test.ts`

- [ ] **Step 1: Write the failing tests**

The lookup itself hits the database, so the tested part is the pure fold that
turns rows into a branch→BU map. Keep that separable.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBranchBuMap } from "./location-lookup";

test("maps a branch to its BU", () => {
  const m = buildBranchBuMap([{ branchCode: "PC1057", buCode: "DODO-M" }]);
  assert.equal(m.get("PC1057"), "DODO-M");
});

test("branch codes match case-insensitively", () => {
  const m = buildBranchBuMap([{ branchCode: "pc1057", buCode: "DOCO" }]);
  assert.equal(m.get("PC1057"), "DOCO");
});

/* A Location with no BU tells us nothing, and an entry mapping to "" would read
 * as an answer. Leave it out so the caller falls through to the codeunit's
 * fallback instead. */
test("a Location with no BU is not in the map", () => {
  const m = buildBranchBuMap([{ branchCode: "PC9999", buCode: null }]);
  assert.equal(m.has("PC9999"), false);
});

test("a row with no branch is skipped", () => {
  const m = buildBranchBuMap([{ branchCode: null, buCode: "COCO" }]);
  assert.equal(m.size, 0);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"`
Expected: `# fail 4`.

- [ ] **Step 3: Implement**

```ts
export interface LocationBuRow {
  branchCode: string | null;
  buCode: string | null;
}

/** Branch code (upper-cased) → the BU its Location is bound to. */
export function buildBranchBuMap(rows: readonly LocationBuRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    const branch = r.branchCode?.trim().toUpperCase();
    const bu = r.buCode?.trim();
    if (!branch || !bu) continue;
    map.set(branch, bu);
  }
  return map;
}
```

plus `loadBranchBuMap(brandCode)` reading `IsActive = 1` rows from `ErpLocation`
through `getErpDataPool()` and folding them with the function above.

- [ ] **Step 4: Run and watch them pass, then commit**

```bash
git add src/lib/erp/location-lookup.ts src/lib/erp/location-lookup.test.ts
git commit -m "feat(erp): branch → Business Unit, read from the synced Locations"
```

---

## Task 4: The Sync tab on the AP-3 settings page

**Files:**
- Create: `src/app/api/request/clear-advance/settings/locations/route.ts` (GET)
- Create: `src/app/api/request/clear-advance/settings/locations/sync/route.ts` (POST)
- Create: `src/features/clear-advance/components/settings/ClrLocationSyncPanel.tsx`
- Modify: `src/app/(dashboard)/request/clear-advance/settings/page.tsx:15-40`

- [ ] **Step 1: The routes**

Both follow `src/app/api/request/accounting/settings/erp-accounts/sync/route.ts`:
**`requireRole(["IT Admin", "System Admin"])`, not a tab grant.** `ErpLocation`
lives in `Rocks_ERP_Data` beside rows other applications read; a settings-tab
grant must not become write access to them. Copy that route's reasoning into a
comment rather than restating it thinly.

GET returns the rows for the brand plus the last sync from `ErpSyncLog`, so the
tab can show when it last ran without a second call.

- [ ] **Step 2: The panel**

A Sync button, the last-sync line, and a table of Code / Name / Branch / BU /
Dept. The button is hidden for a non-admin rather than shown and then refused —
the same choice the ERP accounts panel makes.

Show the BU spread as a summary line (`COCO 130 · DODO-M 36 · …`): it is the
one number that tells an accountant at a glance whether the sync brought back
what they expected.

- [ ] **Step 3: Register the tab**

In `settings/page.tsx`, add `"locations"` to `TabKey` and a `TABS` entry —
label "Location / BU", an icon consistent with the others.

- [ ] **Step 4: Verify on screen**

Open `/request/clear-advance/settings?tab=locations`, press Sync, and confirm
240 rows land with the BU spread above. Then:

```sql
SELECT BuCode, COUNT(*) FROM Rocks_ERP_Data.dbo.ErpLocation
WHERE BrandCode = 'PCTH' AND IsActive = 1 GROUP BY BuCode ORDER BY COUNT(*) DESC
```

Expected: COCO 130, DODO-M 36, DOCO 29, DODO 13, CTPS 11, DODO-A 9, LICNS 8,
EXPR 4.

- [ ] **Step 5: Commit**

---

## Task 5: The journal sends buCode

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.ts`
- Modify: `src/lib/clr/clear-advance-erp-send.ts`
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [ ] **Step 1: Write the failing tests**

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

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

`ClrJournalInput` gains `branchBu?: ReadonlyMap<string, string>`. `glLine` and
the vendor/bank line builders resolve
`branchBu?.get((branchCode ?? defaultBranch).trim().toUpperCase())` and spread
`buCode` in only when it is found — the same `...(x ? { x } : null)` shape
`adjCode` uses, so an unresolved branch leaves the payload byte-identical to
today's.

`PpapJournalLinePayload` gains `buCode?: string`.

- [ ] **Step 4: The sender loads the map**

In `clear-advance-erp-send.ts`, call `loadBranchBuMap(req.brandCode)` once per
request and pass it in. Once per clearing, not once per line.

- [ ] **Step 5: Run tests and typecheck, then commit**

---

## Task 6: Prove it in BC

- [ ] **Step 1: Send a clearing whose branch is not a COCO Location**

Pick a branch from the `DODO-M` or `DOCO` set so the line carries something the
constant never could. Drive it through submit, three approvals and the send.

The manager step needs `ACC_MANAGER_DEV_BYPASS=1` and a restart of `:3081`
unless you are the assigned manager — **take it back out afterwards.**

- [ ] **Step 2: Confirm what was sent**

The preview does not show `buCode`, and BC cannot be read back from here, so
confirm at the wire as Step 2b did: a temporary log of the payload at the send,
removed straight after.

Expected: the expense line's `buCode` is the branch's real BU; a line whose
branch has no Location carries no `buCode` at all.

- [ ] **Step 3: Record the document number.**

---

## Done

- `npm test` at or above baseline, `npx tsc --noEmit` clean of source errors.
- `ErpLocation` holding 240 PCTH rows with the BU spread above.
- A Sync tab that fills it.
- One BC document whose lines carry a BU the old constant could not produce.

**Blocked on nothing.** The AL half (`buCode` with the `COCO` fallback) is
already written; until it is published, sending the key is inert, which makes
this safe to ship in either order.
