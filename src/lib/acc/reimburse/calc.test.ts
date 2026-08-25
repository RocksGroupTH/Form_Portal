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

test("withholding tax is deducted — the employee never paid it out", () => {
  // Changed on 2026-08-25, and it is a change to what gets paid.
  //
  // The rule used to be that WHT does not reduce the claim, on the reading
  // that it is the company's obligation to the revenue department rather than
  // a deduction from the person being paid back. That reads the money the
  // wrong way round for a *reimbursement*: the employee withheld it on the
  // company's behalf and handed the vendor only the net, so the net is what
  // they are out of pocket and the net is what they are owed. The withheld
  // part never left the employee's hands and the company remits it separately.
  //
  // The AP-4.1 sheet says so in its own last column (จำนวนจ่ายสุทธิ), and a
  // Thai tax invoice in its "จำนวนเงินที่ชำระ".
  assert.equal(sumReimburseItems([{ amount: 1070, whtAmount: 30 }]), 1040);
});

test("the worked example from the AP-4.1 sheet and a real tax invoice", () => {
  // 28,680 + 2,007.60 VAT = 30,687.60 total; less 860.40 withheld = 29,827.20,
  // which is the "จำนวนเงินที่ชำระ" printed on the invoice this came from.
  assert.equal(sumReimburseItems([{ amount: 30687.6, vatAmount: 2007.6, whtAmount: 860.4 }]), 29827.2);
  // And the two lines from the sheet: 1,000 with nothing withheld, 2,675 less 75.
  assert.equal(
    sumReimburseItems([
      { amount: 1000, vatAmount: null, whtAmount: null },
      { amount: 2675, vatAmount: 175, whtAmount: 75 },
    ]),
    3600,
  );
});

test("a missing or malformed withholding figure deducts nothing", () => {
  // Null is "not specified", not zero-with-certainty, and either way there is
  // nothing to take off. A malformed one must not turn the total into NaN.
  assert.equal(sumReimburseItems([{ amount: 1000 }]), 1000);
  assert.equal(sumReimburseItems([{ amount: 1000, whtAmount: null }]), 1000);
  assert.equal(sumReimburseItems([{ amount: 1000, whtAmount: Number.NaN }]), 1000);
  assert.equal(sumReimburseItems([{ amount: 1000, whtAmount: "abc" as never }]), 1000);
});

test("withholding is never allowed to push a line negative", () => {
  // A line cannot owe the company money. `sanitizeReceiptFields` already
  // refuses a withheld figure larger than its total, but a hand-typed one has
  // been through no such gate, and a negative line would silently reduce the
  // rest of the claim.
  assert.equal(sumReimburseItems([{ amount: 100, whtAmount: 150 }]), 0);
  assert.equal(sumReimburseItems([{ amount: 100, whtAmount: 150 }, { amount: 500 }]), 500);
});

test("money rounds to two places instead of drifting", () => {
  assert.equal(sumReimburseItems([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
});
