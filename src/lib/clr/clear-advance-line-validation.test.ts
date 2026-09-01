import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFilledLine,
  validateLineGlBranch,
  validateLineMoney,
} from "./clear-advance-line-validation";
import type { ClearAdvanceItem } from "@/features/clear-advance/types";

function line(patch: Partial<ClearAdvanceItem>): ClearAdvanceItem {
  return {
    lineNo: 1,
    expenseDate: "2026-08-04",
    docNo: null,
    glAccountNo: null,
    glAccountName: null,
    description: null,
    branchCode: null,
    amountBeforeVat: 100,
    vatAmount: 7,
    totalInclVat: 107,
    whtAmount: 0,
    netAmount: 107,
    ...patch,
  };
}

/** HQ account, branch account, and one either side may charge. */
const DIMS = new Map([
  ["610101001", "Employee"],
  ["610322005", "Branch"],
  ["115030", "Both"],
]);

/* ── money ── */

test("a well-formed line raises nothing", () => {
  assert.deepEqual(validateLineMoney([line({})]), []);
});

test("WHT larger than the expense is refused", () => {
  // The QA case: 10 + 0 VAT with 200 WHT nets −190, which inflates the bank
  // amount and flips the clearing to a 290-baht Refund.
  const errs = validateLineMoney([line({ amountBeforeVat: 10, vatAmount: 0, whtAmount: 200 })]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /200\.00/);
  assert.match(errs[0], /10\.00/);
});

test("WHT exactly equal to the expense total is allowed", () => {
  assert.deepEqual(
    validateLineMoney([line({ amountBeforeVat: 100, vatAmount: 7, whtAmount: 107 })]),
    [],
  );
});

test("negative VAT, WHT or expense is refused", () => {
  assert.equal(validateLineMoney([line({ vatAmount: -7 })]).length, 1);
  assert.equal(validateLineMoney([line({ whtAmount: -3 })]).length, 1);
  assert.equal(validateLineMoney([line({ amountBeforeVat: -100 })]).length, 1);
});

test("an amount that is not a number is refused once, not compared", () => {
  const errs = validateLineMoney([
    line({ amountBeforeVat: "abc" as unknown as number }),
    line({ lineNo: 2, vatAmount: Number.POSITIVE_INFINITY }),
    line({ lineNo: 3, whtAmount: Number.NaN }),
  ]);
  assert.equal(errs.length, 3);
  assert.ok(errs.every((e) => e.includes("ต้องเป็นตัวเลข")));
});

test("an empty line is not money trouble", () => {
  assert.deepEqual(
    validateLineMoney([line({ amountBeforeVat: null, vatAmount: null, whtAmount: null })]),
    [],
  );
});

test("each offending line is named by its own line number", () => {
  const errs = validateLineMoney([
    line({ lineNo: 1 }),
    line({ lineNo: 4, amountBeforeVat: 10, vatAmount: 0, whtAmount: 200 }),
  ]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /รายการที่ 4/);
});

/* ── branch vs G/L ── */

test("HQ may charge an Employee account, a branch may not", () => {
  assert.deepEqual(
    validateLineGlBranch([line({ glAccountNo: "610101001", branchCode: "HQ01" })], DIMS),
    [],
  );
  const errs = validateLineGlBranch(
    [line({ glAccountNo: "610101001", branchCode: "PC1057" })],
    DIMS,
  );
  assert.equal(errs.length, 1);
  assert.match(errs[0], /610101001/);
  assert.match(errs[0], /PC1057/);
});

test("a branch may charge a Branch account, HQ may not", () => {
  assert.deepEqual(
    validateLineGlBranch([line({ glAccountNo: "610322005", branchCode: "PC1057" })], DIMS),
    [],
  );
  assert.equal(
    validateLineGlBranch([line({ glAccountNo: "610322005", branchCode: "HQ01" })], DIMS).length,
    1,
  );
});

test("a Both account is charged from either side", () => {
  assert.deepEqual(
    validateLineGlBranch(
      [
        line({ glAccountNo: "115030", branchCode: "HQ01" }),
        line({ lineNo: 2, glAccountNo: "115030", branchCode: "PC1057" }),
      ],
      DIMS,
    ),
    [],
  );
});

test("a line with no branch yet is judged as head office", () => {
  assert.deepEqual(
    validateLineGlBranch([line({ glAccountNo: "610101001", branchCode: null })], DIMS),
    [],
  );
  const errs = validateLineGlBranch([line({ glAccountNo: "610322005", branchCode: null })], DIMS);
  assert.match(errs[0], /สำนักงานใหญ่/);
});

test("an account that is not in the master at all is refused", () => {
  const errs = validateLineGlBranch([line({ glAccountNo: "610999999", branchCode: "HQ01" })], DIMS);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /610999999/);
});

test("a line with no account chosen is a draft, not a violation", () => {
  assert.deepEqual(validateLineGlBranch([line({ glAccountNo: null })], DIMS), []);
  assert.deepEqual(validateLineGlBranch([line({ glAccountNo: "  " })], DIMS), []);
});

/* ── which lines are checked ── */

test("a line counts as filled on exactly what the writer keeps", () => {
  assert.equal(isFilledLine(line({ glAccountNo: "115030", amountBeforeVat: null })), true);
  assert.equal(isFilledLine(line({ description: "ค่าแท็กซี่", amountBeforeVat: null })), true);
  assert.equal(isFilledLine(line({ amountBeforeVat: 100 })), true);
  assert.equal(
    isFilledLine(line({ glAccountNo: null, description: "   ", amountBeforeVat: null })),
    false,
  );
});
