import { test } from "node:test";
import assert from "node:assert/strict";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";
import type { BrandAccountRow } from "@/lib/acc/brand-account-service";
import {
  groupClrBankAccountsByBrand,
  bankForBrand,
  deriveClrReady,
} from "./clear-advance-interface-bank-core";

/**
 * Pure decision logic behind the AP-3 Interface ERP settings screen's bank
 * column. No DB import — `BrandAccountRow` comes in via `import type` only,
 * for the same reason recorded in `gl-company-guard.test.ts`: the real
 * service reaches `@/env` through `getAccPool` and throws at import under
 * this repo's `node:test` runner.
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

test("AP-3's own row wins over a default row naming a different account", () => {
  const byBrand = groupClrBankAccountsByBrand([
    row({ formCode: null, accountNo: "K-CA6999" }),
    row({ formCode: AP3_FORM_CODE, accountNo: "UOB-2726" }),
  ]);

  assert.deepEqual(bankForBrand(byBrand, "pcmy"), {
    bankAccountNo: "UOB-2726",
    bankConflict: false,
  });
});

test("a brand with no AP-3 bank row at all answers null, not the default", () => {
  const byBrand = groupClrBankAccountsByBrand([row({ formCode: null, accountNo: "K-CA6999" })]);

  assert.deepEqual(bankForBrand(byBrand, "PCMY"), { bankAccountNo: null, bankConflict: false });
});

test("ready is false when there is no bank row, even with a batch and a complete profile", () => {
  const ready = deriveClrReady({
    journalBatchName: "GENJNL-AP3",
    bank: { bankAccountNo: null, bankConflict: false },
    profileComplete: true,
  });

  assert.equal(ready, false);
});

test("two active AP-3 rows for one brand is a conflict, not a pick", () => {
  const byBrand = groupClrBankAccountsByBrand([
    row({ accountNo: "UOB-2726" }),
    row({ accountNo: "K-CA6999" }),
  ]);

  assert.deepEqual(bankForBrand(byBrand, "PCMY"), { bankAccountNo: null, bankConflict: true });
});

test("a conflict forces ready false even if the caller still passes a batch and complete profile", () => {
  const ready = deriveClrReady({
    journalBatchName: "GENJNL-AP3",
    bank: { bankAccountNo: null, bankConflict: true },
    profileComplete: true,
  });

  assert.equal(ready, false);
});

test("one active row plus one inactive row is NOT a conflict", () => {
  const byBrand = groupClrBankAccountsByBrand([
    row({ accountNo: "UOB-2726", isActive: true }),
    row({ accountNo: "K-CA6999", isActive: false }),
  ]);

  assert.deepEqual(bankForBrand(byBrand, "PCMY"), {
    bankAccountNo: "UOB-2726",
    bankConflict: false,
  });
});

test("ready is true with a batch, exactly one bank row, and a complete profile", () => {
  const byBrand = groupClrBankAccountsByBrand([row({ accountNo: "UOB-2726" })]);

  const ready = deriveClrReady({
    journalBatchName: "GENJNL-AP3",
    bank: bankForBrand(byBrand, "PCMY"),
    profileComplete: true,
  });

  assert.equal(ready, true);
});
