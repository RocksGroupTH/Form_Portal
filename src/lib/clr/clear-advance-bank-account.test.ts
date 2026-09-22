import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";
import type { BrandAccountRow } from "@/lib/acc/brand-account-service";
import {
  clrBankAccountNo,
  saveClrBankAccount,
  type FetchBrandAccounts,
  type MergeFormBrandAccount,
} from "./clear-advance-bank-account";

/**
 * AP-3's bank account, and the one rule that makes it different from every
 * other per-form read in this app: **there is no fallback**.
 *
 * `src/lib/acc/per-form-config.ts` says "a form's own row, else the default",
 * and every sibling setting follows it. AP-3's bank does not, by the user's
 * decision of 2026-09-22. The measured reason is in the live data: PCMY's
 * default row says `K-CA6999` while the row AP-3 effectively used until this
 * change said `UOB-2726`. A fallback restored here "for consistency" would
 * move that brand's money with no error anywhere.
 *
 * This repo has no vitest and `node:test` has no usable module mock here (see
 * `clear-advance-bank-account.ts`'s `fetchRealBrandAccounts`), so rows are
 * supplied through the `fetchRows` parameter rather than `vi.mock`. `calls`
 * stands in for a spy's `.mock.calls`.
 */
function row(over: Partial<BrandAccountRow>): BrandAccountRow {
  return {
    id: 1,
    brandCode: "PCMY",
    accountNo: "UOB-2726",
    displayName: null,
    isActive: true,
    sortOrder: 0,
    formCode: AP3_FORM_CODE,
    ...over,
  };
}

function fakeFetch(rows: BrandAccountRow[]): { fetch: FetchBrandAccounts; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fetch: FetchBrandAccounts = async (...args) => {
    calls.push(args);
    return rows;
  };
  return { fetch, calls };
}

test("asks for AP-3's rows, on the bank table", async () => {
  const { fetch, calls } = fakeFetch([row({})]);

  await clrBankAccountNo("pcmy", fetch);

  assert.deepEqual(calls[0], ["bank", "PCMY", AP3_FORM_CODE]);
});

test("trims surrounding whitespace before calling fetchRows", async () => {
  const { fetch, calls } = fakeFetch([row({})]);

  await clrBankAccountNo("  pcmy  ", fetch);

  assert.deepEqual(calls[0], ["bank", "PCMY", AP3_FORM_CODE]);
});

for (const blank of ["", "   "]) {
  test(`answers null and never calls fetchRows for blank brand ${JSON.stringify(blank)}`, async () => {
    const { fetch, calls } = fakeFetch([]);

    assert.equal(await clrBankAccountNo(blank, fetch), null);
    assert.equal(calls.length, 0);
  });
}

test("returns AP-3's own account", async () => {
  const { fetch } = fakeFetch([row({ formCode: AP3_FORM_CODE, accountNo: "UOB-2726", isActive: true })]);

  assert.equal(await clrBankAccountNo("PCMY", fetch), "UOB-2726");
});

test("returns null when only the default row exists — the no-fallback rule", async () => {
  const { fetch } = fakeFetch([row({ formCode: null, accountNo: "K-CA6999" })]);

  assert.equal(await clrBankAccountNo("PCMY", fetch), null);
});

test("ignores a default row that outsorts AP-3's own", async () => {
  // `pickAllForForm` keys on (brand, accountNo), so both survive and the
  // default can come first. Reading rows[0] is the bug this pins.
  const { fetch } = fakeFetch([
    row({ formCode: null, accountNo: "K-CA6999" }),
    row({ formCode: AP3_FORM_CODE, accountNo: "UOB-2726" }),
  ]);

  assert.equal(await clrBankAccountNo("PCMY", fetch), "UOB-2726");
});

test("ignores an inactive AP-3 row", async () => {
  const { fetch } = fakeFetch([row({ formCode: AP3_FORM_CODE, accountNo: "UOB-2726", isActive: false })]);

  assert.equal(await clrBankAccountNo("PCMY", fetch), null);
});

test("throws rather than choose when a brand has two active AP-3 rows", async () => {
  // The unique index is (FormCode, BrandCode, AccountNo) and permits this;
  // the settings writer deletes by (BrandCode, FormCode) before inserting, so
  // it never creates it. Two rows mean something else wrote them, and picking
  // one silently would decide where money posts by sort order.
  const { fetch } = fakeFetch([
    row({ formCode: AP3_FORM_CODE, accountNo: "UOB-2726" }),
    row({ formCode: AP3_FORM_CODE, accountNo: "K-CA6999" }),
  ]);

  await assert.rejects(clrBankAccountNo("PCMY", fetch), /PCMY/);
});

test("answers null for a brand with no rows at all", async () => {
  const { fetch } = fakeFetch([]);

  assert.equal(await clrBankAccountNo("KSI", fetch), null);
});

/**
 * `saveClrBankAccount` — the write half of the same no-fallback rule.
 *
 * Same seam as `fakeFetch` above stands in for `mergeFormBrandAccount`,
 * since this repo has no usable `node:test` module mock either.
 */
function fakeMerge(): { merge: MergeFormBrandAccount; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const merge: MergeFormBrandAccount = async (...args) => {
    calls.push(args);
  };
  return { merge, calls };
}

test("saveClrBankAccount merges AP-3's own bank row", async () => {
  const { merge, calls } = fakeMerge();

  await saveClrBankAccount("PCMY", "UOB-2726", 42, merge);

  assert.deepEqual(calls[0], ["bank", "PCMY", AP3_FORM_CODE, "UOB-2726", null, 42]);
});

/**
 * Source-level guard on `fetchRealBrandAccounts` and `mergeRealFormBrandAccount`
 * — the only two functions in this file that run in production. Every test
 * above hands `clrBankAccountNo`/`saveClrBankAccount` its own fake `fetchRows`/
 * `merge`, so neither real forwarder is ever called or asserted against.
 *
 * Both `listBrandAccounts` and `mergeFormBrandAccount` take several `string`
 * parameters back to back, so a positional swap inside either forwarder —
 * e.g. `mergeFormBrandAccount(kind, brandCode, accountNo, formCode, ...)` —
 * type-checks and stays green at every behavioural test here, while in
 * production it writes `AccountNo='AP-3'`, `FormCode=<the real account
 * number>` to both live databases. Behavioural coverage is blocked by the
 * env-at-import wall (see the docblocks on both real functions), so a source
 * scan is the honest tool, same reasoning as
 * `R:\Acc_Portal\src\lib\acc\ported-imports.test.ts`: "the defect type-checks
 * and survives every mocked-pool test."
 */
const SOURCE = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/clr/clear-advance-bank-account.ts"),
  "utf8",
);

test("fetchRealBrandAccounts forwards to listBrandAccounts in the right order", () => {
  assert.match(SOURCE, /return listBrandAccounts\(kind, brandCode, formCode\);/);
});

test("mergeRealFormBrandAccount forwards to mergeFormBrandAccount in the right order", () => {
  assert.match(
    SOURCE,
    /return mergeFormBrandAccount\(kind, brandCode, formCode, accountNo, erpDescription, userId\);/,
  );
});

test("the two guards above are not vacuous — each would catch its swap", () => {
  const fetchSwapped = SOURCE.replace(
    "listBrandAccounts(kind, brandCode, formCode)",
    "listBrandAccounts(kind, formCode, brandCode)",
  );
  assert.notEqual(fetchSwapped, SOURCE, "the replace must actually find something to swap");
  assert.doesNotMatch(fetchSwapped, /return listBrandAccounts\(kind, brandCode, formCode\);/);

  const mergeSwapped = SOURCE.replace(
    "mergeFormBrandAccount(kind, brandCode, formCode, accountNo, erpDescription, userId)",
    "mergeFormBrandAccount(kind, brandCode, accountNo, formCode, erpDescription, userId)",
  );
  assert.notEqual(mergeSwapped, SOURCE, "the replace must actually find something to swap");
  assert.doesNotMatch(
    mergeSwapped,
    /return mergeFormBrandAccount\(kind, brandCode, formCode, accountNo, erpDescription, userId\);/,
  );
});
