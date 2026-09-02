# AP-2 Employee-Code Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an AP-2 payee is an employee, pick the BC vendor by the employee's staff code (read from the vendor's "Home Page" field) instead of guessing from the name; and restrict the คู่ค้า bank-account field to digits.

**Architecture:** "Home Page" is a standard BC Vendor field that Standard API v2.0 exposes as `website`. A small enrich pass fills `ErpVendors.Website` (the column already exists) after the existing RPC sync; a new lookup finds the selectable ADV vendor whose Home Page equals the staff code; the matcher tries that first for employee payees and otherwise falls through to today's LLM name matcher untouched. No BC/AL change, no migration.

**Tech Stack:** TypeScript, Next.js App Router, `mssql` (T-SQL), node:test. Verify with `npm run typecheck` + `npm test`. **Never run `npm run build`** — it shares `.next` with the running dev server.

**Spec:** `docs/superpowers/specs/2026-08-31-ap2-employee-code-match-design.md`
**Branch:** `feat/ap2-employee-code-match` (already checked out, cut from master)

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `src/features/advance/components/AdvanceForm.tsx` | The คู่ค้า bank-account input keeps digits only. |
| `src/lib/erp/vendor-sync.ts` | After the RPC sync, a non-fatal enrich pass writes `ErpVendors.Website` (Home Page) from BC Standard API v2.0. |
| `src/lib/adv/advance-erp-master-service.ts` | Owns `findVendorByEmployeeCode` — the staff-code → vendor lookup, with the same selectability rules as `listVendors`. |
| `src/lib/adv/vendor-match-service.ts` | Tries the code lookup for employee payees before falling through to the LLM name matcher. |
| `src/lib/adv/vendor-match-service.test.ts` | Covers the new branch: code hit wins, code miss falls through. |

Tasks 1 and 2 are independent of each other. Task 3 must land before Task 4 (Task 4 calls it). Each task commits on its own.

---

## Task 1: คู่ค้า bank account accepts digits only

**Files:**
- Modify: `src/features/advance/components/AdvanceForm.tsx`

- [ ] **Step 1: Restrict the input**

Find the `payeeBankAccount` input inside the `payeeType === "vendor"` block. It currently reads:

```tsx
            <Field label="เลขที่บัญชี *" error={errors.payeeBankAccount} errorId="err-payeeBankAccount">
              <input ref={payeeBankAccountRef} className={fieldClass} style={fieldStyle} value={payeeBankAccount} disabled={readOnly}
                aria-invalid={!!errors.payeeBankAccount} aria-describedby={errors.payeeBankAccount ? "err-payeeBankAccount" : undefined}
                onChange={(e) => { setPayeeBankAccount(e.target.value); clearError("payeeBankAccount"); }} />
            </Field>
```

Replace it with:

```tsx
            <Field label="เลขที่บัญชี *" error={errors.payeeBankAccount} errorId="err-payeeBankAccount">
              {/* Digits only: the account number is imported into ERP as a number,
                  so letters typed or pasted here are dropped rather than rejected. */}
              <input ref={payeeBankAccountRef} className={fieldClass} style={fieldStyle} value={payeeBankAccount} disabled={readOnly}
                inputMode="numeric"
                aria-invalid={!!errors.payeeBankAccount} aria-describedby={errors.payeeBankAccount ? "err-payeeBankAccount" : undefined}
                onChange={(e) => { setPayeeBankAccount(e.target.value.replace(/\D+/g, "")); clearError("payeeBankAccount"); }} />
            </Field>
```

Only `inputMode` and the `onChange` body change. Leave the required-field validation as it is.

- [ ] **Step 2: Verify**

Run: `cd /r/Form_Portal && npm run typecheck`
Expected: clean.

Run: `cd /r/Form_Portal && npm test`
Expected: all pass (baseline 692 on master).

- [ ] **Step 3: Commit**

```bash
cd /r/Form_Portal
git add src/features/advance/components/AdvanceForm.tsx
git commit -m "feat(ap-2): keep the คู่ค้า bank account numeric"
```

---

## Task 2: Fill `ErpVendors.Website` from the vendor's Home Page

**Files:**
- Modify: `src/lib/erp/vendor-sync.ts`

Background the implementer needs: `syncBrandErpVendors` opens a transaction, takes an app-lock, calls `postBcCodexStoreRpc` once, writes every vendor, deactivates rows older than the snapshot, then commits. The RPC does **not** return a home-page field. BC Standard API v2.0 `/vendors` exposes it as `website`. `ctx` (`BrandVendorSyncContext`) carries `brandCode`, `bcCompanyId`, `bcCompanyName`, `bcConnectionId`, `baseUrl`.

- [ ] **Step 1: Add the enrich function**

In `src/lib/erp/vendor-sync.ts`, add this function immediately **above** `export async function syncBrandErpVendors`:

```ts
/**
 * Copy each vendor's "Home Page" into `ErpVendors.Website`.
 *
 * Home Page is a standard BC Vendor field that Standard API v2.0 exposes as
 * `website`; accounting puts the employee's staff code there so AP-2 can match
 * an employee payee by code instead of by name. The custom RPC that drives the
 * rest of this sync does not return it, so this second, `$select`-narrowed call
 * fetches only what it needs and writes only that one column.
 *
 * Deliberately non-fatal: unlike the posting group, which the ADV filter cannot
 * work without, Home Page is an optional matching aid. A failure here leaves the
 * previous values in place and the sync still counts as a success.
 */
async function enrichVendorHomePages(ctx: BrandVendorSyncContext): Promise<number> {
  const url = new URL(buildBcApiV2CompanyEntityUrl(
    ctx.baseUrl,
    ctx.bcCompanyId,
    "vendors",
    ERP_VENDOR_SOURCE_ENVIRONMENT,
  ));
  url.searchParams.set("$select", "number,website");

  const rows = await fetchBcApiV2Collection<{ number?: string; website?: string }>(
    ctx.bcConnectionId,
    url.toString(),
  );

  const pool = await getErpDataPool();
  let updated = 0;
  for (const row of rows) {
    const vendorNo = (row.number ?? "").trim();
    if (!vendorNo) continue;
    const website = (row.website ?? "").trim() || null;
    const res = await pool.request()
      .input("environment", sql.NVarChar, ERP_VENDOR_SOURCE_ENVIRONMENT)
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("no", sql.NVarChar, vendorNo)
      .input("website", sql.NVarChar, website)
      .query(`
        UPDATE [dbo].[ErpVendors]
        SET Website = @website
        WHERE SourceEnvironment = @environment AND BrandCode = @brand AND VendorNo = @no
      `);
    updated += res.rowsAffected[0] ?? 0;
  }
  return updated;
}
```

- [ ] **Step 2: Import the two helpers**

At the top of the same file the import from `@/lib/bc/bc-odata` currently pulls in `postBcCodexStoreRpc`. Extend it so it reads:

```ts
import { buildBcApiV2CompanyEntityUrl, fetchBcApiV2Collection, postBcCodexStoreRpc } from "@/lib/bc/bc-odata";
```

Both are already exported from that module (`buildBcApiV2CompanyEntityUrl` and `fetchBcApiV2Collection`). If the existing import statement has a different shape, keep its shape and just add the two names.

- [ ] **Step 3: Call it after the transaction commits**

In `syncBrandErpVendors`, find these lines near the end:

```ts
    await transaction.commit();
    transactionOpen = false;
  } catch (error) {
```

Insert the call immediately after `transactionOpen = false;`, still inside the `try`:

```ts
    await transaction.commit();
    transactionOpen = false;

    // After the commit: the rows exist, so this only ever updates one column.
    // Non-fatal by design — see enrichVendorHomePages.
    try {
      await enrichVendorHomePages(ctx);
    } catch (err) {
      console.error(`[vendor-sync] Home Page enrich failed for ${ctx.brandCode}`, err);
    }
  } catch (error) {
```

It must run **after** the commit so it cannot roll back the vendor snapshot, and its own failure must not reach the outer `catch`.

- [ ] **Step 4: Verify**

Run: `cd /r/Form_Portal && npm run typecheck`
Expected: clean.

Run: `cd /r/Form_Portal && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /r/Form_Portal
git add src/lib/erp/vendor-sync.ts
git commit -m "feat(erp): sync the vendor Home Page into ErpVendors.Website

Home Page is where accounting records an employee's staff code, and AP-2
matches an employee payee by that code. The custom RPC does not return the
field, so a narrow Standard API v2.0 pass fills the (already existing)
Website column after the snapshot commits. Non-fatal: unlike the posting
group, a missing Home Page only costs a matching hint."
```

---

## Task 3: `findVendorByEmployeeCode`

**Files:**
- Modify: `src/lib/adv/advance-erp-master-service.ts`

- [ ] **Step 1: Add the lookup**

In `src/lib/adv/advance-erp-master-service.ts`, add this function immediately **after** `listVendors` (which ends with the `return (r.recordset …)` block and a closing `}`):

```ts
/**
 * The selectable ADV vendor whose Home Page holds this staff code.
 *
 * Accounting types the employee's code, plain, into the vendor's Home Page in
 * BC (synced into `Website`). Returns null when nothing matches — and also when
 * **more than one** vendor claims the same code: an ambiguous code must never
 * silently pick one, so the caller falls back to name matching instead.
 *
 * Same selectability rules as `listVendors`, so a blocked or non-ADV vendor is
 * never returned here either.
 */
export async function findVendorByEmployeeCode(
  company: string,
  staffId: number,
): Promise<AdvErpVendorOption | null> {
  const c = company.trim().toUpperCase();
  if (!c || !Number.isInteger(staffId) || staffId <= 0) return null;
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("c", sql.NVarChar, c)
    .input("pg", sql.NVarChar, ADVANCE_VENDOR_POSTING_GROUP)
    .input("code", sql.NVarChar, String(staffId))
    .query(`
    SELECT TOP 2 VendorNo, DisplayName FROM [dbo].[ErpVendors]
    WHERE BrandCode = @c
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
      AND VendorPostingGroup = @pg
      AND LTRIM(RTRIM(COALESCE(Website, ''))) = @code
    ORDER BY VendorNo`);
  const rows = r.recordset as Record<string, unknown>[];
  if (rows.length !== 1) return null;
  return {
    vendorNo: rows[0].VendorNo as string,
    displayName: (rows[0].DisplayName as string) ?? null,
  };
}
```

`TOP 2` is what makes the ambiguity check cheap: one row means a unique match, two mean the code is duplicated and we refuse it.

- [ ] **Step 2: Verify**

Run: `cd /r/Form_Portal && npm run typecheck`
Expected: clean. (`AdvErpVendorOption`, `getAppPool`, `ERP_DATA_DB`, `sql` and `ADVANCE_VENDOR_POSTING_GROUP` are all already in this file.)

- [ ] **Step 3: Commit**

```bash
cd /r/Form_Portal
git add src/lib/adv/advance-erp-master-service.ts
git commit -m "feat(ap-2): look a vendor up by the staff code on its Home Page"
```

---

## Task 4: Try the code before the LLM, for employee payees

**Files:**
- Modify: `src/lib/adv/vendor-match-service.ts`

- [ ] **Step 1: Import the lookup**

The file already imports several names from `@/lib/adv/advance-erp-master-service`:

```ts
  prefilterVendors, listVendors, findSelectableVendor, isVendorSelectable,
```

Add `findVendorByEmployeeCode` to that same import list.

- [ ] **Step 2: Insert the employee branch**

In `matchAdvanceVendor`, find this block:

```ts
  const result = await runVendorMatch(
    a.payeeName ?? "",
    makeFetchCandidates(company),
    askHaiku,
  );
  await writeMatch(requestId, result);
  return result;
}
```

Replace it with:

```ts
  // An employee payee IS the requester, and accounting records their staff code
  // on the vendor's Home Page — an exact key beats guessing at a name, and 175
  // of the 181 ADV vendors carry Thai names. Falls through to the name matcher
  // when no code is on file, which is every vendor until accounting fills the
  // field in, so nothing regresses on the day this ships.
  if (a.payeeType === "employee" && req.staffId != null) {
    const byCode = await findVendorByEmployeeCode(company, req.staffId);
    if (byCode) {
      const codeResult: VendorMatchResult = {
        status: "suggested",
        vendorNo: byCode.vendorNo,
        vendorName: byCode.displayName,
        confidence: "high",
        reason: `จับคู่จากรหัสพนักงาน ${req.staffId} (Home Page)`,
      };
      await writeMatch(requestId, codeResult);
      return codeResult;
    }
  }

  const result = await runVendorMatch(
    a.payeeName ?? "",
    makeFetchCandidates(company),
    askHaiku,
  );
  await writeMatch(requestId, result);
  return result;
}
```

`req`, `a` and `company` are all already in scope at that point. The status is `suggested`, never `confirmed`, so the existing "ACC_OFFICER must confirm a vendor before approving" gate is untouched.

- [ ] **Step 3: Verify types**

Run: `cd /r/Form_Portal && npm run typecheck`
Expected: clean. If `VendorMatchResult`'s `confidence` is a narrower union than `string`, use whichever member means high confidence — check the type in `src/lib/adv/vendor-match-core.ts` rather than guessing, and report what you used.

- [ ] **Step 4: Run the tests**

Run: `cd /r/Form_Portal && npm test`
Expected: all pass — no existing test covers an employee payee, so nothing should change yet.

- [ ] **Step 5: Commit**

```bash
cd /r/Form_Portal
git add src/lib/adv/vendor-match-service.ts
git commit -m "feat(ap-2): match an employee payee by staff code before asking the LLM"
```

---

## Task 5: Tests for the employee branch

**Files:**
- Modify: `src/lib/adv/vendor-match-service.test.ts`

- [ ] **Step 1: Read the existing test file first**

Run: `cd /r/Form_Portal && cat src/lib/adv/vendor-match-service.test.ts`

`matchAdvanceVendor` reaches the database through `getRequest` and the master-service helpers, so it is not directly unit-testable without mocks. Look at how the existing tests in this file handle that — they test `runVendorMatch` (the pure orchestration in `vendor-match-core.ts`) rather than the DB-bound service.

- [ ] **Step 2: Add tests at the level the file already uses**

Follow the file's existing style. If it tests `runVendorMatch` with injected `fetchCandidates` / `askLlm` functions, add a test proving the **fallback contract** the new branch depends on — that when no candidate is found the matcher still returns a `none`/`suggested` result rather than throwing:

```ts
test("no candidates -> falls through to a no-match result, never throws", async () => {
  const result = await runVendorMatch(
    "นาย ชยภัทร ทองเจริญ",
    async () => [],
    async () => null,
  );
  assert.equal(result.vendorNo, null);
});
```

Adjust the assertion to whatever `runVendorMatch` actually returns for the empty case — read `src/lib/adv/vendor-match-core.ts` and assert its real contract, not a guess.

If the file instead already mocks the service layer, add the two cases that matter: a code hit returns the code-matched vendor with `status: "suggested"` and never calls the LLM; a code miss calls the LLM exactly as before.

- [ ] **Step 3: Verify**

Run: `cd /r/Form_Portal && npm test`
Expected: all pass, count up by however many tests you added.

Run: `cd /r/Form_Portal && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /r/Form_Portal
git add src/lib/adv/vendor-match-service.test.ts
git commit -m "test(ap-2): cover the employee-code matching path"
```

---

## Final verification (after all tasks)

- [ ] `cd /r/Form_Portal && npm run typecheck` — clean.
- [ ] `cd /r/Form_Portal && npm test` — all pass.
- [ ] **Do NOT run `npm run build`.**
- [ ] Report to the user (do not perform BC writes without their say-so): the manual UAT check is to put a staff code such as `10177` into one PCTH ADV vendor's Home Page in BC, press **Sync Vendor** in AP-2 settings, then open an employee-payee advance at the ACC_OFFICER step and confirm the suggestion shows that vendor with the "จับคู่จากรหัสพนักงาน" reason; a คู่ค้า advance must still match by name; an employee whose code is absent must still get a name-based suggestion.

---

## Self-review notes

- **Spec coverage:** §1.1 numeric account → Task 1; Home Page into `ErpVendors` → Task 2; `findVendorByEmployeeCode` incl. the ambiguity rule → Task 3; the employee branch, `suggested` status and name fallback → Task 4; tests → Task 5. The three stated decisions (always fall back, never auto-confirm, ambiguous code matches nothing) are each implemented and commented at their site.
- **Type consistency:** `findVendorByEmployeeCode(company: string, staffId: number): Promise<AdvErpVendorOption | null>` is declared in Task 3 and called with exactly that shape in Task 4; `AdvErpVendorOption` is the existing return type of `listVendors` in the same file.
- **No migration, no BC/AL change, no new endpoint, nothing outside the four files.**
