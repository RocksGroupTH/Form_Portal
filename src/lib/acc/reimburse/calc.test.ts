import { test } from "node:test";
import assert from "node:assert/strict";
import { sumReimburseItems } from "./calc";

test("an empty claim totals zero rather than NaN", () => {
  assert.equal(sumReimburseItems([]), 0);
});

test("the total is the VAT-inclusive amounts, and VAT is not added again", () => {
  // 1,070 already contains its 70 of VAT. Adding vatAmount would double-count.
  assert.equal(sumReimburseItems([{ amount: 1070, vatAmount: 70 }]), 1070);
});

test("withholding tax does not reduce what the employee is owed", () => {
  // WHT is the company's obligation to the revenue department, not a deduction
  // from the person being paid back.
  assert.equal(sumReimburseItems([{ amount: 1070, whtAmount: 30 }]), 1070);
});

test("money rounds to two places instead of drifting", () => {
  assert.equal(sumReimburseItems([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
});
