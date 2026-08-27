# AP-2 Dr → Vendor + LLM Vendor Matching (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post the AP-2 (Advance) debit line to a real BC vendor (`accountType=Vendor`) chosen by Haiku matching the payee name to `ErpVendors.DisplayName`, confirmed by the Accounting Officer, editable at the ERP interface, and blocked from sending until confirmed.

**Architecture:** A token-economical matcher (SQL prefilter → skip LLM on 0/1 clear candidates → Haiku only on ambiguity) writes a suggestion onto new `AccAdvance` columns. The ACC_OFFICER approval step gates on a *confirmed* vendor; the ERP interface queue allows a last-chance override; the journal builder emits a Vendor debit line and refuses to build without a vendor.

**Tech Stack:** Next.js (App Router) on Node, TypeScript, `mssql` (T-SQL), `@anthropic-ai/sdk` (Haiku), `node:test` + `node:assert/strict`, `tsx` runner. Vendor master lives in `Rocks_ERP_Data.dbo.ErpVendors` (data-layer WIP on this branch); app tables in `Rocks_Portal_Form` / `_UAT`.

**Spec:** `docs/superpowers/specs/2026-08-26-ap2-dr-vendor-design.md`

**Branch:** `feat/erp-vendors-sync` (already has the ErpVendors sync). Run all commands from `R:\Form_Portal`.

**Key conventions discovered (follow exactly):**
- LLM: `resolveApiKey("ANTHROPIC_API_KEY")` → `const { default: Anthropic } = await import("@anthropic-ai/sdk")` → `new Anthropic({ apiKey })` → `client.messages.create(...)`; parse JSON with `/\{[\s\S]*\}/`. Default model `claude-haiku-4-5-20251001`. See `src/lib/clr/ai-receipt.ts`.
- ErpVendors reads: `getAppPool(process.env.MSSQL_ERP_DATA_DATABASE || "Rocks_ERP_Data")`, filter `IsActive=1 AND (IsBlocked=0 OR IsBlocked IS NULL)`. See `src/lib/adv/advance-erp-master-service.ts`.
- Portal-form reads/writes: `getAccPool()` from `@/lib/adv/pool`. AP-2 rows are `AccRequest.FormCode='AP-2'`; advance detail is `AccAdvance` keyed by `RequestId`.
- Tests: `*.test.ts` under `src/`, run with `npm test` (all) or `npm test -- <file>` (one). Use `node:test` + `node:assert/strict`.
- Migrations: shared numbered `/migrations` folder; guard target DB with `DB_NAME()`. Apply with `npm run apply-sql -- --db <DB> --file migrations/<file>`.

**Confirmed model shapes used across tasks:**
- `VendorMatchStatus`: `"pending" | "suggested" | "confirmed" | "none"`
- `VendorMatchConfidence`: `"high" | "medium" | "low"`
- `AdvErpVendorOption`: `{ vendorNo: string; displayName: string | null }`

---

## File Structure

**Create:**
- `migrations/119_acc_advance_vendor_match.sql` — 7 columns on `AccAdvance` (portal-form DB).
- `src/lib/adv/vendor-match-normalize.ts` — pure name normalise + candidate ranking + decision.
- `src/lib/adv/vendor-match-normalize.test.ts` — unit tests for the above.
- `src/lib/adv/vendor-match-service.ts` — IO orchestration: prefilter → decide → Haiku → persist; confirm.
- `src/lib/adv/vendor-match-service.test.ts` — orchestration tests with a fake LLM.
- `src/app/api/request/advance/vendor-match/[id]/route.ts` — auto-run match (idempotent) + return state.
- `src/app/api/request/advance/vendor-confirm/route.ts` — confirm/override at the ACC_OFFICER step.
- `src/app/api/request/advance/erp-queue/vendor/route.ts` — override at the interface queue.

**Modify:**
- `src/features/advance/types.ts` — add match fields to `AdvanceDetail`.
- `src/lib/adv/advance-request-service.ts` — map new `AccAdvance` columns; reset match on payee-name change.
- `src/lib/adv/advance-erp-master-service.ts` — add `listVendors` + `vendors` in master + a prefilter query.
- `src/lib/adv/advance-erp-payload.ts` — Dr → Vendor; guard when no vendor.
- `src/lib/adv/advance-erp-payload.test.ts` — (create if absent) payload tests.
- `src/lib/adv/advance-erp-send.ts` — per-item vendor guard; expose vendor in preview item.
- `src/lib/adv/advance-approval-engine.ts` — ACC_OFFICER vendor-confirmed gate.
- `src/app/api/request/advance/requests/[id]/approve/route.ts` — (no body change needed; gate reads DB).
- `src/app/(dashboard)/request/advance/[id]/page.tsx` — auto-match + vendor dropdown + gate on approve.
- `src/features/advance/components/AdvanceErpQueue.tsx` — vendor column + editable dropdown + handler.

---

## Task 1: Migration — vendor-match columns on AccAdvance

**Files:**
- Create: `migrations/119_acc_advance_vendor_match.sql`

- [ ] **Step 1: Confirm 119 is free**

Run: `git -C R:/Form_Portal ls-files migrations | Sort-Object | Select-Object -Last 5` (PowerShell) or `ls migrations | tail`.
Expected: highest is `118_erp_vendors_remove_source_ids.sql`; `119_*` does not exist. If 119 is taken, use the next free number and keep it consistent everywhere below.

- [ ] **Step 2: Write the migration**

```sql
-- Vendor-match result for AP-2 advances. Portal-form DB ONLY (Rocks_Portal_Form
-- and its _UAT twin) -- never Rocks_ERP_Data, never Fast_*.
-- Apply:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/119_acc_advance_vendor_match.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/119_acc_advance_vendor_match.sql

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'Rocks_Portal_Form', N'Rocks_Portal_Form_UAT')
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR('Migration 119 targets Rocks_Portal_Form / _UAT only. Current: %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.AccAdvance', 'U') IS NULL
BEGIN
  RAISERROR('Migration 119 requires dbo.AccAdvance.', 16, 1);
END
ELSE
BEGIN
  BEGIN TRANSACTION;

  IF COL_LENGTH('dbo.AccAdvance', 'MatchedVendorNo') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [MatchedVendorNo] NVARCHAR(50) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'MatchedVendorName') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [MatchedVendorName] NVARCHAR(200) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchStatus') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchStatus] NVARCHAR(20) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchConfidence') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchConfidence] NVARCHAR(10) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchReason') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchReason] NVARCHAR(500) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchedAt') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchedAt] DATETIME2(7) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorConfirmedBy') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorConfirmedBy] INT NULL;

  COMMIT TRANSACTION;
  PRINT 'AccAdvance vendor-match columns present.';
END
GO
```

- [ ] **Step 3: Apply to UAT and verify**

Run:
```
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/119_acc_advance_vendor_match.sql
```
Expected: prints `AccAdvance vendor-match columns present.` with no error. (Apply to `Rocks_Portal_Form` prod at deploy time — note it in the PR, do not gate this task on prod.)

- [ ] **Step 4: Commit**

```
git add migrations/119_acc_advance_vendor_match.sql
git commit -m "feat(ap2): migration 119 - vendor-match columns on AccAdvance"
```

---

## Task 2: AdvanceDetail type + request-service mapping

**Files:**
- Modify: `src/features/advance/types.ts`
- Modify: `src/lib/adv/advance-request-service.ts` (mapping near lines 67-70; save near lines 315-328)

- [ ] **Step 1: Add fields to `AdvanceDetail`**

In `src/features/advance/types.ts`, in the `AdvanceDetail` interface, after the payee block (after `payeeBankCode`), add:

```typescript
  // Vendor match (AP-2 Dr = Vendor). Written by the matcher / officer.
  matchedVendorNo: string | null;
  matchedVendorName: string | null;
  vendorMatchStatus: "pending" | "suggested" | "confirmed" | "none" | null;
  vendorMatchConfidence: "high" | "medium" | "low" | null;
  vendorMatchReason: string | null;
```

- [ ] **Step 2: Map the columns in `getRequest`**

In `src/lib/adv/advance-request-service.ts`, find the `AccAdvance` SELECT used by `getRequest` (the query that reads `PayeeType, PayeeName, PayeeBankAccount, PayeeBankCode, ...`). Add the new columns to that SELECT list:

```sql
        , a.MatchedVendorNo, a.MatchedVendorName, a.VendorMatchStatus,
          a.VendorMatchConfidence, a.VendorMatchReason
```

Then in the object built from that row (near lines 67-70, alongside `payeeName`), add:

```typescript
    matchedVendorNo: (r.MatchedVendorNo as string) ?? null,
    matchedVendorName: (r.MatchedVendorName as string) ?? null,
    vendorMatchStatus: (r.VendorMatchStatus as AdvanceDetail["vendorMatchStatus"]) ?? null,
    vendorMatchConfidence: (r.VendorMatchConfidence as AdvanceDetail["vendorMatchConfidence"]) ?? null,
    vendorMatchReason: (r.VendorMatchReason as string) ?? null,
```

- [ ] **Step 3: Reset the match when the payee name changes**

In the `saveAdvance` UPDATE branch (the `UPDATE [dbo].[AccAdvance] SET PayeeType=@payeeType, ...` near line 316), append to the SET list so an edited payee re-triggers matching:

```sql
        , VendorMatchStatus = CASE WHEN ISNULL(PayeeName,'') <> ISNULL(@payeeName,'')
                                   THEN 'pending' ELSE VendorMatchStatus END
```

(Insert branch needs nothing — new rows have NULL status, which the matcher treats as pending.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If other constructors of `AdvanceDetail` exist, they must set the new fields — fix any errors the compiler flags by adding the five fields as `null`.)

- [ ] **Step 5: Commit**

```
git add src/features/advance/types.ts src/lib/adv/advance-request-service.ts
git commit -m "feat(ap2): carry vendor-match fields on AdvanceDetail"
```

---

## Task 3: Pure normalise + candidate ranking + decision (TDD)

**Files:**
- Create: `src/lib/adv/vendor-match-normalize.ts`
- Test: `src/lib/adv/vendor-match-normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePayeeName, rankCandidates, decideMatch } from "./vendor-match-normalize";

test("normalize strips company suffixes, punctuation, case and spacing", () => {
  assert.equal(normalizePayeeName("  บริษัท  ทดสอบ  จำกัด "), "ทดสอบ");
  assert.equal(normalizePayeeName("ACME Co., Ltd."), "acme");
  assert.equal(normalizePayeeName("A.C.M.E"), "acme");
});

test("rankCandidates returns exact normalized match first", () => {
  const ranked = rankCandidates("acme", [
    { vendorNo: "V2", displayName: "Beta" },
    { vendorNo: "V1", displayName: "ACME Co., Ltd." },
  ]);
  assert.equal(ranked[0].vendorNo, "V1");
});

test("decideMatch: zero candidates => none", () => {
  assert.deepEqual(decideMatch("acme", []), { mode: "none" });
});

test("decideMatch: single normalized-equal candidate => exact (no LLM)", () => {
  assert.deepEqual(
    decideMatch("acme", [{ vendorNo: "V1", displayName: "ACME Co., Ltd." }]),
    { mode: "exact", vendorNo: "V1", displayName: "ACME Co., Ltd." },
  );
});

test("decideMatch: several candidates => ambiguous (LLM needed)", () => {
  const d = decideMatch("acme", [
    { vendorNo: "V1", displayName: "ACME Bangkok" },
    { vendorNo: "V2", displayName: "ACME Chiang Mai" },
  ]);
  assert.equal(d.mode, "ambiguous");
});

test("decideMatch: one candidate but not equal => ambiguous (let LLM judge)", () => {
  const d = decideMatch("acme", [{ vendorNo: "V1", displayName: "ACME Bangkok" }]);
  assert.equal(d.mode, "ambiguous");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/adv/vendor-match-normalize.test.ts`
Expected: FAIL — `Cannot find module './vendor-match-normalize'`.

- [ ] **Step 3: Write the implementation**

```typescript
/** Pure helpers for AP-2 vendor matching — no IO, unit-tested. */

export interface VendorCandidate {
  vendorNo: string;
  displayName: string | null;
}

const TH_SUFFIXES = ["บริษัท", "จำกัด", "มหาชน", "หจก", "ห้างหุ้นส่วนจำกัด", "ห้างหุ้นส่วน"];
const EN_SUFFIXES = ["co ltd", "co", "ltd", "limited", "company", "corporation", "corp", "inc", "plc"];

/** Lower-case, strip punctuation, collapse spaces, drop common company suffixes. */
export function normalizePayeeName(raw: string | null | undefined): string {
  let s = (raw ?? "").toLowerCase();
  s = s.replace(/[.,()"'`/\\-]+/g, " ");          // punctuation → space
  s = s.replace(/\s+/g, " ").trim();
  for (const suf of TH_SUFFIXES) s = s.split(suf).join(" ");
  for (const suf of EN_SUFFIXES) {
    s = s.replace(new RegExp(`(^|\\s)${suf}(\\s|$)`, "g"), " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Sort candidates: exact normalized match first, then by normalized-substring, then name. */
export function rankCandidates(normalizedPayee: string, candidates: VendorCandidate[]): VendorCandidate[] {
  const score = (c: VendorCandidate): number => {
    const n = normalizePayeeName(c.displayName);
    if (n && n === normalizedPayee) return 0;
    if (n && (n.includes(normalizedPayee) || normalizedPayee.includes(n))) return 1;
    return 2;
  };
  return [...candidates].sort((a, b) => {
    const s = score(a) - score(b);
    if (s !== 0) return s;
    return (a.displayName ?? a.vendorNo).localeCompare(b.displayName ?? b.vendorNo);
  });
}

export type MatchDecision =
  | { mode: "none" }
  | { mode: "exact"; vendorNo: string; displayName: string | null }
  | { mode: "ambiguous" };

/**
 * Decide without the LLM where possible (token economy):
 *  - 0 candidates → none
 *  - exactly one candidate AND it is normalized-equal → exact
 *  - otherwise → ambiguous (caller asks Haiku)
 */
export function decideMatch(normalizedPayee: string, candidates: VendorCandidate[]): MatchDecision {
  if (candidates.length === 0) return { mode: "none" };
  if (candidates.length === 1) {
    const c = candidates[0];
    if (normalizePayeeName(c.displayName) === normalizedPayee && normalizedPayee.length > 0) {
      return { mode: "exact", vendorNo: c.vendorNo, displayName: c.displayName };
    }
    return { mode: "ambiguous" };
  }
  return { mode: "ambiguous" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/adv/vendor-match-normalize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```
git add src/lib/adv/vendor-match-normalize.ts src/lib/adv/vendor-match-normalize.test.ts
git commit -m "feat(ap2): pure vendor-match normalise/rank/decide + tests"
```

---

## Task 4: Vendor list + prefilter query in erp-master-service

**Files:**
- Modify: `src/lib/adv/advance-erp-master-service.ts`

- [ ] **Step 1: Add the option type**

After `AdvErpBatchOption` (line 20), add:

```typescript
export interface AdvErpVendorOption { vendorNo: string; displayName: string | null }
```

Add `vendors: AdvErpVendorOption[];` to the `AdvErpCompanyMaster` interface.

- [ ] **Step 2: Add `listVendors` and a prefilter query**

After `listBatch` (line 86), add:

```typescript
export async function listVendors(company: string): Promise<AdvErpVendorOption[]> {
  const c = company.trim().toUpperCase();
  if (!c) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, c).query(`
    SELECT VendorNo, DisplayName FROM [dbo].[ErpVendors]
    WHERE BrandCode = @c
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
    ORDER BY DisplayName`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    vendorNo: x.VendorNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

/** Prefilter candidates for the matcher: active vendors whose name shares a token
 *  with the payee. Caps the set so the LLM prompt stays small. */
export async function prefilterVendors(company: string, payeeName: string, limit = 10): Promise<AdvErpVendorOption[]> {
  const c = company.trim().toUpperCase();
  const term = (payeeName ?? "").trim();
  if (!c || !term) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("c", sql.NVarChar, c)
    .input("t", sql.NVarChar, `%${term}%`)
    .input("lim", sql.Int, limit)
    .query(`
      SELECT TOP (@lim) VendorNo, DisplayName FROM [dbo].[ErpVendors]
      WHERE BrandCode = @c
        AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
        AND (DisplayName LIKE @t OR @t LIKE '%' + DisplayName + '%')
      ORDER BY LEN(DisplayName)`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    vendorNo: x.VendorNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

/** Is this vendor still selectable (active + not blocked) for the company? */
export async function isVendorSelectable(company: string, vendorNo: string): Promise<boolean> {
  const c = company.trim().toUpperCase();
  const v = (vendorNo ?? "").trim();
  if (!c || !v) return false;
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, c).input("v", sql.NVarChar, v).query(`
    SELECT TOP 1 1 AS Ok FROM [dbo].[ErpVendors]
    WHERE BrandCode = @c AND VendorNo = @v
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)`);
  return r.recordset.length > 0;
}
```

> The prefilter's `LIKE %term%` is a coarse first cut; `prefilterVendors` results are re-ranked by the pure `rankCandidates` in the matcher (Task 5). When the coarse `LIKE` returns nothing, the matcher falls back to `listVendors` capped to `limit` so an odd-spelling payee still gets candidates for the LLM.

- [ ] **Step 3: Return vendors from `listAdvErpMaster`**

Change the empty return and the `Promise.all` in `listAdvErpMaster` (lines 90-95) to:

```typescript
  if (!c) return { gl: [], bank: [], branch: [], journalBatch: [], vendors: [] };
  const [gl, bank, branch, journalBatch, vendors] = await Promise.all([
    listGl(c), listBank(c), listBranch(c), listBatch(c), listVendors(c),
  ]);
  return { gl, bank, branch, journalBatch, vendors };
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the `erp-master` route returns `listAdvErpMaster` verbatim, so it now includes `vendors`).

- [ ] **Step 5: Commit**

```
git add src/lib/adv/advance-erp-master-service.ts
git commit -m "feat(ap2): ErpVendors list + prefilter + selectable check"
```

---

## Task 5: Matching service (orchestration, TDD with a fake LLM)

**Files:**
- Create: `src/lib/adv/vendor-match-service.ts`
- Test: `src/lib/adv/vendor-match-service.test.ts`

**Design:** keep the network/DB at the edges. `runVendorMatch` takes the payee, a `fetchCandidates` fn and an `askLlm` fn, so the branching is unit-testable. Thin DB wrappers (`matchAdvanceVendor`, `confirmAdvanceVendor`) compose it with real IO.

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { runVendorMatch } from "./vendor-match-service";

const cands = [
  { vendorNo: "V1", displayName: "ACME Bangkok" },
  { vendorNo: "V2", displayName: "ACME Chiang Mai" },
];
const failLlm = async () => { throw new Error("LLM must not be called"); };

test("zero candidates → none, no LLM", async () => {
  const r = await runVendorMatch("ACME", async () => [], failLlm);
  assert.deepEqual(r, { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null });
});

test("single exact candidate → suggested high, no LLM", async () => {
  const r = await runVendorMatch("ACME Co., Ltd.", async () => [{ vendorNo: "V1", displayName: "ACME Co., Ltd." }], failLlm);
  assert.equal(r.status, "suggested");
  assert.equal(r.vendorNo, "V1");
  assert.equal(r.confidence, "high");
});

test("ambiguous → LLM picks", async () => {
  const r = await runVendorMatch("ACME BKK", async () => cands,
    async () => ({ vendorNo: "V1", confidence: "medium", reason: "bangkok" }));
  assert.equal(r.status, "suggested");
  assert.equal(r.vendorNo, "V1");
  assert.equal(r.confidence, "medium");
});

test("ambiguous but LLM returns unknown vendorNo → none", async () => {
  const r = await runVendorMatch("ACME BKK", async () => cands,
    async () => ({ vendorNo: "V9", confidence: "high", reason: "x" }));
  assert.equal(r.status, "none");
});

test("LLM throws → pending (officer picks manually)", async () => {
  const r = await runVendorMatch("ACME BKK", async () => cands, failLlm);
  assert.equal(r.status, "pending");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/adv/vendor-match-service.test.ts`
Expected: FAIL — `Cannot find module './vendor-match-service'`.

- [ ] **Step 3: Write the implementation**

```typescript
import "server-only";
import { resolveApiKey } from "@/lib/api-keys/service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getRequest } from "@/lib/adv/advance-request-service";
import {
  prefilterVendors, listVendors, isVendorSelectable, type AdvErpVendorOption,
} from "@/lib/adv/advance-erp-master-service";
import {
  normalizePayeeName, rankCandidates, decideMatch, type VendorCandidate,
} from "@/lib/adv/vendor-match-normalize";

const MODEL = process.env.ANTHROPIC_VENDOR_MATCH_MODEL || "claude-haiku-4-5-20251001";

export type VendorMatchStatus = "pending" | "suggested" | "confirmed" | "none";
export type VendorMatchConfidence = "high" | "medium" | "low";

export interface VendorMatchResult {
  status: Exclude<VendorMatchStatus, "confirmed">;   // matcher never auto-confirms
  vendorNo: string | null;
  vendorName: string | null;
  confidence: VendorMatchConfidence | null;
  reason: string | null;
}

export interface LlmPick { vendorNo: string; confidence: VendorMatchConfidence; reason: string }
type FetchCandidates = (payeeName: string) => Promise<VendorCandidate[]>;
type AskLlm = (payeeName: string, candidates: VendorCandidate[]) => Promise<LlmPick | null>;

/** Pure-ish orchestration (IO injected) — token-economical branching. */
export async function runVendorMatch(
  payeeName: string,
  fetchCandidates: FetchCandidates,
  askLlm: AskLlm,
): Promise<VendorMatchResult> {
  const normalized = normalizePayeeName(payeeName);
  const raw = await fetchCandidates(payeeName);
  const candidates = rankCandidates(normalized, raw);
  const decision = decideMatch(normalized, candidates);

  if (decision.mode === "none") {
    return { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  if (decision.mode === "exact") {
    return { status: "suggested", vendorNo: decision.vendorNo, vendorName: decision.displayName,
      confidence: "high", reason: "ชื่อตรงกับ vendor" };
  }
  // ambiguous → Haiku
  let pick: LlmPick | null;
  try {
    pick = await askLlm(payeeName, candidates);
  } catch {
    return { status: "pending", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  if (!pick) {
    return { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  const chosen = candidates.find((c) => c.vendorNo === pick!.vendorNo);
  if (!chosen) {
    return { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  return { status: "suggested", vendorNo: chosen.vendorNo, vendorName: chosen.displayName,
    confidence: pick.confidence, reason: (pick.reason ?? "").slice(0, 500) };
}

/** Real candidate fetch: coarse SQL prefilter, fall back to a capped full list. */
function makeFetchCandidates(company: string): FetchCandidates {
  return async (payeeName: string) => {
    const pre = await prefilterVendors(company, payeeName, 10);
    if (pre.length > 0) return pre;
    return (await listVendors(company)).slice(0, 10);
  };
}

/** Real Haiku call. Compact prompt/output; returns null on unusable output. */
async function askHaiku(payeeName: string, candidates: VendorCandidate[]): Promise<LlmPick | null> {
  const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("no ANTHROPIC_API_KEY"); // → runVendorMatch treats as pending
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const list = candidates.map((c) => `${c.vendorNo}\t${c.displayName ?? ""}`).join("\n");
  const system = [
    "You match a Thai/English payee name to ONE vendor from a list.",
    "Return ONE JSON object only, no prose: {\"vendorNo\":\"..\",\"confidence\":\"high|medium|low\",\"reason\":\"<=12 words\"}.",
    "If none is a plausible match, return {\"vendorNo\":null,\"confidence\":\"low\",\"reason\":\"no match\"}.",
  ].join("\n");
  const user = `Payee: ${payeeName}\nVendors (VendorNo<TAB>DisplayName):\n${list}`;
  const res = await client.messages.create({
    model: MODEL, max_tokens: 200, system,
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
  });
  const textPart = res.content.find((c) => c.type === "text");
  const rawText = textPart && "text" in textPart ? textPart.text : "";
  const m = rawText.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]) as { vendorNo?: string | null; confidence?: string; reason?: string };
  if (!j.vendorNo) return null;
  const confidence: VendorMatchConfidence =
    j.confidence === "high" || j.confidence === "medium" || j.confidence === "low" ? j.confidence : "low";
  return { vendorNo: String(j.vendorNo).trim(), confidence, reason: String(j.reason ?? "") };
}

async function writeMatch(requestId: number, r: VendorMatchResult): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("status", sql.NVarChar, r.status)
    .input("no", sql.NVarChar, r.vendorNo)
    .input("name", sql.NVarChar, r.vendorName)
    .input("conf", sql.NVarChar, r.confidence)
    .input("reason", sql.NVarChar, r.reason)
    .query(`
      UPDATE [dbo].[AccAdvance]
      SET MatchedVendorNo = @no, MatchedVendorName = @name,
          VendorMatchStatus = @status, VendorMatchConfidence = @conf,
          VendorMatchReason = @reason, VendorMatchedAt = SYSDATETIME()
      WHERE RequestId = @rid`);
}

/**
 * Run matching for one advance if it is still pending/NULL, persist and return
 * the result. Idempotent: already-suggested/confirmed rows are returned untouched.
 */
export async function matchAdvanceVendor(requestId: number): Promise<VendorMatchResult | null> {
  const req = await getRequest(requestId);
  if (!req?.advance || !req.brandCode) return null;
  const st = req.advance.vendorMatchStatus;
  if (st === "suggested" || st === "confirmed" || st === "none") {
    return {
      status: st === "confirmed" ? "suggested" : st,   // never widen 'confirmed' back out
      vendorNo: req.advance.matchedVendorNo,
      vendorName: req.advance.matchedVendorName,
      confidence: req.advance.vendorMatchConfidence,
      reason: req.advance.vendorMatchReason,
    };
  }
  const result = await runVendorMatch(
    req.advance.payeeName ?? "",
    makeFetchCandidates(req.brandCode),
    askHaiku,
  );
  await writeMatch(requestId, result);
  return result;
}

/** Officer confirms/overrides. Validates the vendor is still selectable. */
export async function confirmAdvanceVendor(
  requestId: number, company: string, vendorNo: string, userId: number,
): Promise<void> {
  const ok = await isVendorSelectable(company, vendorNo);
  if (!ok) throw new Error("Vendor นี้ถูกระงับหรือไม่มีอยู่แล้ว — เลือกใหม่");
  const vendors = await listVendors(company);
  const picked = vendors.find((v: AdvErpVendorOption) => v.vendorNo === vendorNo);
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("no", sql.NVarChar, vendorNo)
    .input("name", sql.NVarChar, picked?.displayName ?? null)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[AccAdvance]
      SET MatchedVendorNo = @no, MatchedVendorName = @name,
          VendorMatchStatus = 'confirmed', VendorConfirmedBy = @by,
          VendorMatchedAt = SYSDATETIME()
      WHERE RequestId = @rid`);
}
```

> **Model note:** before implementing `askHaiku`, read the `claude-api` skill to confirm the current Haiku model id, `messages.create` params, and error semantics. `claude-haiku-4-5-20251001` is the id already used by `src/lib/clr/ai-receipt.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/adv/vendor-match-service.test.ts`
Expected: PASS (5 tests). Then `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```
git add src/lib/adv/vendor-match-service.ts src/lib/adv/vendor-match-service.test.ts
git commit -m "feat(ap2): vendor-match orchestration + Haiku + persistence"
```

---

## Task 6: Journal payload — Dr becomes a Vendor line (TDD)

**Files:**
- Modify: `src/lib/adv/advance-erp-payload.ts`
- Test: `src/lib/adv/advance-erp-payload.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdvanceJournalPayload } from "./advance-erp-payload";
import type { AdvanceRequest, AdvanceDetail } from "@/features/advance/types";

const cfg = { glAccountNo: "115010", bankAccountNo: "101010", journalBatchName: "PAY", branchCode: "BR1" } as never;
const req = { requestNo: "ADV26-00001", paymentDate: "2026-08-28", requesterFullName: "Somchai" } as unknown as AdvanceRequest;
const baseAdv = { amount: 1000, baseAmount: 1000, purpose: "x", payeeName: "ACME",
  matchedVendorNo: "V1", matchedVendorName: "ACME", vendorMatchStatus: "confirmed" } as unknown as AdvanceDetail;

test("Dr line posts to the matched Vendor, Cr to Bank", () => {
  const p = buildAdvanceJournalPayload(req, baseAdv, cfg, "DEPT1");
  const dr = p.lines[0];
  assert.equal(dr.accountType, "Vendor");
  assert.equal(dr.accountNo, "V1");
  assert.equal(dr.amount, 1000);
  assert.equal(dr.balAccountType, undefined);   // two explicit lines; no bal on Dr
  const cr = p.lines[1];
  assert.equal(cr.accountType, "Bank Account");
  assert.equal(cr.amount, -1000);
});

test("build refuses when no vendor is confirmed", () => {
  const noVendor = { ...baseAdv, matchedVendorNo: null } as unknown as AdvanceDetail;
  assert.throws(() => buildAdvanceJournalPayload(req, noVendor, cfg, "DEPT1"), /Vendor/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/adv/advance-erp-payload.test.ts`
Expected: FAIL — Dr `accountType` is `"G/L Account"`, and the no-vendor case does not throw.

- [ ] **Step 3: Edit `buildAdvanceJournalPayload`**

In `src/lib/adv/advance-erp-payload.ts`, replace the guards block (lines 18-22) and the first (Dr) line object (lines 42-55).

Add a vendor guard after the existing guards:

```typescript
  if (!advance.matchedVendorNo) throw new Error("ยังไม่ได้เลือก Vendor สำหรับรายการนี้ (แก้ที่ขั้น Accounting Officer)");
```

Replace the Dr line object with:

```typescript
      {
        groupNo: "G1",
        postingDate,
        documentType: "Payment",
        accountType: "Vendor",
        accountNo: advance.matchedVendorNo,
        description,
        paymentMethodCode: "BANK",
        amount,
        employeeCode,
        branchCode: branch,
        departmentCode,
      },
```

(Leave the Cr Bank line unchanged. `glAccountNo` guard can stay — it is now unused for posting but keeping it avoids churn per the spec; if `noUnusedLocals`/lint complains, keep the guard since it still validates config presence.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/adv/advance-erp-payload.test.ts`
Expected: PASS (2 tests). Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```
git add src/lib/adv/advance-erp-payload.ts src/lib/adv/advance-erp-payload.test.ts
git commit -m "feat(ap2): journal Dr posts to matched Vendor + no-vendor guard"
```

> **VERIFY IN SANDBOX (carry into Task 11):** CU 50263 (PPAP `CreateFromJson`) must accept a `Vendor` account type on the Dr line of a two-line Payment group with `Bank Account` as the paired Cr. Confirm the posted document hits the vendor ledger. If the CU needs `balAccountType` set on the Dr line, adjust here — this is the one BC-side unknown in the plan.

---

## Task 7: Send guard — refuse unmatched at interface send

**Files:**
- Modify: `src/lib/adv/advance-erp-send.ts`

- [ ] **Step 1: Add the per-item guard**

In `sendAdvanceErpBatch`, in the per-id loop, after the existing `if (!req.paymentDate) throw ...` (line 266), add:

```typescript
      if (req.advance.vendorMatchStatus !== "confirmed" || !req.advance.matchedVendorNo) {
        throw new Error("ยังไม่ได้ยืนยัน Vendor — แก้ที่ขั้น Accounting Officer ก่อนส่ง");
      }
```

- [ ] **Step 2: Surface vendor in the preview item**

In `AdvanceJournalPreviewItem` (lines 28-39) add:

```typescript
  matchedVendorNo: string | null;
  matchedVendorName: string | null;
```

In `previewAdvanceErpJournal`, in the success `out.push({...})` (lines 56-79), add:

```typescript
        matchedVendorNo: req.advance.matchedVendorNo,
        matchedVendorName: req.advance.matchedVendorName,
```

and add `matchedVendorNo: null, matchedVendorName: null` to both error `out.push` objects (lines 51 and 81) to satisfy the type.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add src/lib/adv/advance-erp-send.ts
git commit -m "feat(ap2): refuse ERP send until vendor confirmed; expose vendor in preview"
```

---

## Task 8: Auto-match route + confirm route

**Files:**
- Create: `src/app/api/request/advance/vendor-match/[id]/route.ts`
- Create: `src/app/api/request/advance/vendor-confirm/route.ts`

- [ ] **Step 1: Auto-match route (idempotent, runs on ACC_OFFICER page open)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { matchAdvanceVendor } from "@/lib/adv/vendor-match-service";

/** POST /api/request/advance/vendor-match/[id] — run vendor matching for one
 *  advance if still pending; returns the current match state. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const [h, o, d] = await Promise.all([
      isAdvanceApprover(actor.email, "HEAD_ACC"),
      isAdvanceApprover(actor.email, "ACC_OFFICER"),
      isAdvanceApprover(actor.email, "DIRECTOR"),
    ]);
    if (!h && !o && !d) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "id ไม่ถูกต้อง" }, { status: 400 });

  try {
    const result = await matchAdvanceVendor(id);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    console.error("[api/request/advance/vendor-match] POST", err);
    return NextResponse.json({ ok: false, error: "จับคู่ Vendor ไม่สำเร็จ" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Confirm route (ACC_OFFICER dropdown change)**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getRequest } from "@/lib/adv/advance-request-service";
import { confirmAdvanceVendor } from "@/lib/adv/vendor-match-service";

/** POST { id, vendorNo } — confirm/override the vendor at the ACC_OFFICER step. */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const ok = await isAdvanceApprover(actor.email, "ACC_OFFICER");
    if (!ok) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number; vendorNo?: string };
  const id = Number(body.id);
  const vendorNo = typeof body.vendorNo === "string" ? body.vendorNo.trim() : "";
  if (!Number.isFinite(id) || !vendorNo) {
    return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const reqRow = await getRequest(id);
  if (!reqRow?.brandCode) return NextResponse.json({ ok: false, error: "ไม่พบคำขอ" }, { status: 404 });

  try {
    await confirmAdvanceVendor(id, reqRow.brandCode, vendorNo, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ยืนยัน Vendor ไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Adjust the `params` shape to match the repo's other `[id]` routes — confirm whether they use `Promise<{id}>` or `{id}` by opening `src/app/api/request/advance/requests/[id]/approve/route.ts`.)

- [ ] **Step 4: Commit**

```
git add src/app/api/request/advance/vendor-match src/app/api/request/advance/vendor-confirm
git commit -m "feat(ap2): vendor auto-match + confirm API routes"
```

---

## Task 9: ACC_OFFICER approval gate

**Files:**
- Modify: `src/lib/adv/advance-approval-engine.ts` (`approveCurrentStep`, gate after the `needsPayment` block ~line 78)

- [ ] **Step 1: Add the vendor-confirmed gate**

In `approveCurrentStep`, inside the `if (needsPayment(step.stepType)) { ... }` block, after the payment-date validation, add a read of the advance's match status and block if not confirmed:

```typescript
    // AP-2: the debit posts to a Vendor, so the Accounting Officer must have a
    // confirmed vendor before this step can complete. (Belt: the send guard and
    // the payload builder also refuse, but the gate lives here so the queue only
    // ever receives complete rows.)
    const pool = await getAccPool();
    const vr = await pool.request().input("rid", sql.Int, requestId)
      .query(`SELECT MatchedVendorNo, VendorMatchStatus FROM [dbo].[AccAdvance] WHERE RequestId=@rid`);
    const vrow = vr.recordset[0] as { MatchedVendorNo?: string | null; VendorMatchStatus?: string | null } | undefined;
    if (!vrow?.MatchedVendorNo || vrow.VendorMatchStatus !== "confirmed") {
      throw new Error("ต้องยืนยัน Vendor ก่อนอนุมัติ (เลือก Vendor ในหน้ารายละเอียด)");
    }
```

Ensure `getAccPool` and `sql` are imported at the top of the file (`import { getAccPool, sql } from "@/lib/adv/pool";`) — add the import if missing.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual check the approve route needs no body change**

Open `src/app/api/request/advance/requests/[id]/approve/route.ts`. The gate reads the DB, so the body stays `{ paymentDate?, isChecked? }`. Confirm no change is needed; if the route strips unknown fields, that's fine.

- [ ] **Step 4: Commit**

```
git add src/lib/adv/advance-approval-engine.ts
git commit -m "feat(ap2): block ACC_OFFICER approval until vendor confirmed"
```

---

## Task 10: UI — ACC_OFFICER detail page + interface queue

**Files:**
- Modify: `src/app/(dashboard)/request/advance/[id]/page.tsx`
- Modify: `src/features/advance/components/AdvanceErpQueue.tsx`
- Create: `src/app/api/request/advance/erp-queue/vendor/route.ts`

- [ ] **Step 1: Interface-queue override route (mirror payment-date route)**

Create `src/app/api/request/advance/erp-queue/vendor/route.ts` — copy `erp-queue/payment-date/route.ts` and swap the validation for a vendor:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getRequest } from "@/lib/adv/advance-request-service";
import { confirmAdvanceVendor } from "@/lib/adv/vendor-match-service";

/** POST { id, vendorNo } — override the vendor on an Approved, not-yet-Sent
 *  AP-2 advance (the "รอส่ง" queue). Mirrors erp-queue/payment-date. */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const [h, o, d] = await Promise.all([
      isAdvanceApprover(actor.email, "HEAD_ACC"),
      isAdvanceApprover(actor.email, "ACC_OFFICER"),
      isAdvanceApprover(actor.email, "DIRECTOR"),
    ]);
    if (!h && !o && !d) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number; vendorNo?: string };
  const id = Number(body.id);
  const vendorNo = typeof body.vendorNo === "string" ? body.vendorNo.trim() : "";
  if (!Number.isFinite(id) || !vendorNo) {
    return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const pool = await getAccPool();
  const st = await pool.request().input("id", sql.Int, id)
    .query(`SELECT Status, ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='AP-2'`);
  const row = st.recordset[0] as { Status?: string; ErpInterfaceStatus?: string | null } | undefined;
  if (!row || row.Status !== "Approved" || row.ErpInterfaceStatus === "Sent") {
    return NextResponse.json({ ok: false, error: "แก้ Vendor ได้เฉพาะรายการที่อนุมัติแล้วและยังไม่ได้ส่ง" }, { status: 400 });
  }

  const reqRow = await getRequest(id);
  if (!reqRow?.brandCode) return NextResponse.json({ ok: false, error: "ไม่พบคำขอ" }, { status: 404 });

  try {
    await confirmAdvanceVendor(id, reqRow.brandCode, vendorNo, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "แก้ Vendor ไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 2: ACC_OFFICER detail page — state + fetch vendors + auto-match**

In `src/app/(dashboard)/request/advance/[id]/page.tsx`, near the payment-date state (lines 39-43) add:

```typescript
  const [vendors, setVendors] = useState<{ vendorNo: string; displayName: string | null }[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [vendorMatch, setVendorMatch] = useState<{ status: string | null; confidence: string | null; reason: string | null }>({ status: null, confidence: null, reason: null });
```

Add an effect (mirror the payment-dates effect at lines 67-78) that, when the current step is `ACC_OFFICER`, loads the company vendor list and runs the auto-match:

```typescript
  useEffect(() => {
    if (request?.currentStepCode !== "ACC_OFFICER" || !request?.brandCode) return;
    fetch(`/api/request/advance/settings/erp-master?company=${encodeURIComponent(request.brandCode)}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { vendors?: { vendorNo: string; displayName: string | null }[] } }) => {
        if (j.ok && j.data?.vendors) setVendors(j.data.vendors);
      })
      .catch(() => {});
    fetch(`/api/request/advance/vendor-match/${requestId}`, { method: "POST" })
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { status: string | null; vendorNo: string | null; confidence: string | null; reason: string | null } }) => {
        if (j.ok && j.data) {
          setVendorMatch({ status: j.data.status, confidence: j.data.confidence, reason: j.data.reason });
          if (j.data.vendorNo) setSelectedVendor(j.data.vendorNo);
        }
      })
      .catch(() => {});
  }, [request?.currentStepCode, request?.brandCode, requestId]);
```

- [ ] **Step 3: Detail page — render the Vendor field beside the payment-date picker**

Inside the `{currentStep === "ACC_OFFICER" && (...)}` block (lines 203-214), add after the Check checkbox:

```tsx
    <div className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
      Vendor:
      <select
        value={selectedVendor}
        onChange={(e) => {
          const v = e.target.value;
          setSelectedVendor(v);
          if (!v) return;
          fetch("/api/request/advance/vendor-confirm", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: requestId, vendorNo: v }),
          })
            .then((r) => r.json())
            .then((j: { ok: boolean; error?: string }) => {
              if (!j.ok) toast.error(j.error ?? "ยืนยัน Vendor ไม่สำเร็จ");
              else { setVendorMatch((m) => ({ ...m, status: "confirmed" })); toast.success("ยืนยัน Vendor แล้ว"); }
            })
            .catch(() => toast.error("ยืนยัน Vendor ไม่สำเร็จ"));
        }}
        className="border rounded px-2 py-1"
      >
        <option value="">— เลือก Vendor —</option>
        {vendors.map((v) => (
          <option key={v.vendorNo} value={v.vendorNo}>{v.displayName ?? v.vendorNo} ({v.vendorNo})</option>
        ))}
      </select>
      {vendorMatch.status === "suggested" && vendorMatch.confidence && (
        <span title={vendorMatch.reason ?? ""} className="text-[11px] opacity-70">AI: {vendorMatch.confidence}</span>
      )}
    </div>
```

- [ ] **Step 4: Detail page — gate the approve click**

In `handleApprove` (lines 99-107), inside the `ACC_OFFICER` branch, before `act("approve", ...)`, add:

```typescript
    if (!selectedVendor) return toast.error("กรุณาเลือก Vendor");
```

(The server gate in Task 9 is authoritative; this is a fast client-side message.)

- [ ] **Step 5: Interface queue — row type + column + handler**

In `src/features/advance/components/AdvanceErpQueue.tsx`:

Add to the `ErpRow` interface (lines 15-29): `matchedVendorNo: string | null; matchedVendorName: string | null;` (ensure the queue's data source — `advance-queue-service.ts` / the queue API — selects `MatchedVendorNo, MatchedVendorName` from `AccAdvance`; add them to that SELECT and row mapping if missing).

Add vendor-options state near `paymentDateOpts` (line ~64):

```typescript
  const [vendorOpts, setVendorOpts] = useState<Record<string, { vendorNo: string; displayName: string | null }[]>>({});
```

Load per-company vendor lists (near the payment-dates effect ~line 90). Fetch the master for each company present in the rows, storing `data.vendors` keyed by company. Then add the change handler mirroring `changePaymentDate` (lines 216-229):

```typescript
  async function changeVendor(id: number, vendorNo: string) {
    try {
      const res = await fetch("/api/request/advance/erp-queue/vendor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, vendorNo }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "แก้ Vendor ไม่สำเร็จ"); return; }
      toast.success("อัปเดต Vendor แล้ว");
      load();
    } catch { toast.error("แก้ Vendor ไม่สำเร็จ"); }
  }
```

Add a `"Vendor"` header after `"จำนวน"` (lines 375-378) and a `<td>` after the amount cell (near lines 395-405) rendering a `<select>` of that row's company vendors, value `row.matchedVendorNo ?? ""`, `onChange` → `changeVendor(row.id, e.target.value)`; fall back to `{row.matchedVendorName ?? row.matchedVendorNo ?? "—"}` when the company has no options loaded.

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck`
Expected: no errors. (Then `npm run build` in Task 11.)

- [ ] **Step 7: Commit**

```
git add src/app/(dashboard)/request/advance/[id]/page.tsx src/features/advance/components/AdvanceErpQueue.tsx src/app/api/request/advance/erp-queue/vendor
git commit -m "feat(ap2): vendor UI at ACC_OFFICER step + editable at interface queue"
```

---

## Task 11: Verify end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Full test + typecheck + build**

Run:
```
npm test
npm run typecheck
npm run build
```
Expected: all tests pass; no type errors; build succeeds.

- [ ] **Step 2: UAT smoke (dev server on :3081)**

Run `npm run dev` and, as an ACC_OFFICER approver, walk one AP-2 through: HEAD_ACC → DIRECTOR → ACC_OFFICER. At ACC_OFFICER confirm:
- the vendor auto-suggests (or shows `— เลือก Vendor —` when nothing matched),
- approve is blocked until a vendor is chosen,
- after approve, the item appears in the "รอส่ง" interface queue with the vendor shown and editable.

- [ ] **Step 3: Sandbox send (the BC-side unknown from Task 6)**

Send one advance to BC Sandbox and confirm the posted document's Dr line hit the **vendor ledger** (accountType Vendor), Cr the bank, `Failed: 0`. If CU 50263 rejects the Vendor Dr line, revisit Task 6 (`balAccountType`) before touching prod.

- [ ] **Step 4: Prod migration note**

Confirm the PR description states migration 119 must be applied to `Rocks_Portal_Form` (prod) at deploy: `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/119_acc_advance_vendor_match.sql`.

- [ ] **Step 5: Final commit (if any verification fixes)**

```
git add -A
git commit -m "test(ap2): verify Dr->Vendor + matching end-to-end"
```

---

## Self-Review Notes (author)

- **Spec coverage:** §3 data model → Task 1/2; §4 matcher (Haiku, prefilter, skip-LLM, cache, re-match) → Tasks 3/4/5 (+ reset on payee change in Task 2); §5.1 ACC_OFFICER UI+gate → Tasks 8/9/10; §5.2 interface override → Task 10; §6 payload → Task 6; §7 error handling (LLM fail→pending, blocked vendor re-select, send guard) → Tasks 5/7; §8 testing → Tasks 3/5/6 + Task 11.
- **Deferred correctly:** Phase 2 auto-create vendor and WHT are untouched.
- **One real unknown, flagged twice (Task 6 + Task 11):** whether CU 50263 accepts a `Vendor` Dr line in the two-line payment group — must be proven in Sandbox before prod.
- **Type consistency:** `VendorMatchStatus`/`Confidence` unions and `AdvErpVendorOption` are defined once (Tasks 4/5) and reused; `matchedVendorNo`/`matchedVendorName` names are consistent across type, mapping, payload, send, and UI.
