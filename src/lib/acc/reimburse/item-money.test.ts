import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBlankItemRow,
  prepareReimburseItemsForSave,
  rowLabel,
  validateItemMoney,
} from "./item-money";
import type { ReimburseItem } from "@/features/reimburse/types";

/**
 * The invariant under test: the server never persists or pays less than the
 * requester entered. A row is dropped only when there is nothing in it at all;
 * anything else is either stored faithfully or refused by name.
 *
 * The runtime values here are deliberately wider than `ReimburseItem` declares
 * — `amount` is typed `number`, but these functions sit behind a JSON route
 * where it can arrive as `null`, `""` or `"abc"`, and that is exactly what they
 * exist to catch. `item()` does the cast once so each test reads as data.
 */
function item(partial: Record<string, unknown>): ReimburseItem {
  return { sortOrder: 0, expenseDate: null, description: "", amount: 0, ...partial } as ReimburseItem;
}

const DATE = "2026-08-19";

/* ─────────────── which rows are real rows ─────────────── */

test("a fully blank row is dropped silently", () => {
  assert.deepEqual(prepareReimburseItemsForSave([item({})]), []);
  assert.equal(isBlankItemRow(item({})), true);
});

test("blank-looking cells are still blank: null, empty string, whitespace, a plain zero", () => {
  assert.equal(isBlankItemRow(item({ amount: null, description: "  ", expenseDate: "  " })), true);
  assert.equal(isBlankItemRow(item({ amount: "" })), true);
  assert.equal(isBlankItemRow(item({ amount: "   " })), true);
  assert.equal(isBlankItemRow(item({ amount: 0 })), true);
  assert.equal(isBlankItemRow(item({ amount: "0.00" })), true);
  assert.deepEqual(prepareReimburseItemsForSave([item({ amount: "" }), item({ amount: 0 })]), []);
});

test("any content at all makes the row real", () => {
  assert.equal(isBlankItemRow(item({ description: "แท็กซี่" })), false);
  assert.equal(isBlankItemRow(item({ amount: 250 })), false);
  assert.equal(isBlankItemRow(item({ amount: "1234.50" })), false);
  assert.equal(isBlankItemRow(item({ expenseDate: DATE })), false);
  assert.equal(isBlankItemRow(item({ vatAmount: 7 })), false);
  assert.equal(isBlankItemRow(item({ whtAmount: 30 })), false);
  // A typo is content the requester meant to be money, not emptiness.
  assert.equal(isBlankItemRow(item({ amount: "abc" })), false);
  assert.equal(isBlankItemRow(item({ amount: Number.NaN })), false);
});

/* ─────────────── finding 1: an undated row with content is refused, never dropped ─────────────── */

test("a row with an amount but no date is refused, not discarded", () => {
  assert.throws(
    () => prepareReimburseItemsForSave([item({ amount: 500 })]),
    /^Error: กรุณาระบุวันที่ของรายการ$/,
  );
});

test("a row with only a description and no date is refused too", () => {
  assert.throws(
    () => prepareReimburseItemsForSave([item({ description: "ค่าที่จอดรถ" })]),
    /กรุณาระบุวันที่ของรายการ/,
  );
});

test("a whitespace-only date is not a date", () => {
  assert.throws(
    () => prepareReimburseItemsForSave([item({ expenseDate: "   ", amount: 500 })]),
    /กรุณาระบุวันที่ของรายการ/,
  );
});

test("the undated row is named by its row number when there is more than one", () => {
  assert.throws(
    () =>
      prepareReimburseItemsForSave([
        item({ expenseDate: DATE, amount: 100 }),
        item({ amount: 200 }),
      ]),
    /กรุณาระบุวันที่ของรายการ \(แถวที่ 2\)/,
  );
});

test("the money that survives is the money that went in — no row lost to a missing date", () => {
  // The failure this whole rule exists to prevent: 100 + 200 must never quietly
  // become 100 because the second row had no date.
  const items = [item({ expenseDate: DATE, amount: 100 }), item({ amount: 200 })];
  assert.throws(() => prepareReimburseItemsForSave(items));

  const dated = [item({ expenseDate: DATE, amount: 100 }), item({ expenseDate: DATE, amount: 200 })];
  const prepared = prepareReimburseItemsForSave(dated);
  assert.equal(prepared.length, 2);
  assert.equal(
    prepared.reduce((t, it) => t + it.amount, 0),
    300,
  );
});

/* ─────────────── finding 3: nothing Number() would turn into a silent zero ─────────────── */

const MALFORMED_AMOUNTS: Array<[string, unknown]> = [
  ["null", null],
  ['""', ""],
  ['"  "', "  "],
  ['"abc"', "abc"],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["[]", []],
  ["false", false],
];

for (const [name, bad] of MALFORMED_AMOUNTS) {
  test(`an amount of ${name} is malformed, not zero`, () => {
    assert.throws(
      () => prepareReimburseItemsForSave([item({ expenseDate: DATE, amount: bad })]),
      /^Error: จำนวนเงินไม่ถูกต้อง$/,
      `${name} was accepted`,
    );
  });
}

test("undefined is malformed as well", () => {
  assert.throws(
    () => prepareReimburseItemsForSave([item({ expenseDate: DATE, amount: undefined })]),
    /จำนวนเงินไม่ถูกต้อง/,
  );
});

test("a numeric string is accepted and stored as a number", () => {
  const [row] = prepareReimburseItemsForSave([item({ expenseDate: DATE, amount: "1234.50" })]);
  assert.equal(row.amount, 1234.5);
  assert.equal(typeof row.amount, "number");
});

test("a padded numeric string is trimmed, not rejected", () => {
  const [row] = prepareReimburseItemsForSave([item({ expenseDate: DATE, amount: " 42 " })]);
  assert.equal(row.amount, 42);
});

test("a draft may hold zero or a negative amount — that floor is a submit rule", () => {
  const rows = prepareReimburseItemsForSave([
    item({ expenseDate: DATE, amount: 0 }),
    item({ expenseDate: DATE, amount: -1 }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.amount),
    [0, -1],
  );
});

test("the date is normalised and the row keeps its own sortOrder", () => {
  const [row] = prepareReimburseItemsForSave([
    item({ expenseDate: " 2026-08-19 ", amount: 10, sortOrder: 7 }),
  ]);
  assert.equal(row.expenseDate, DATE);
  assert.equal(row.sortOrder, 7);
});

/* ─────────────── vat / wht: only when present, and only well-formed ─────────────── */

test("absent VAT and WHT normalise to null rather than zero", () => {
  const [row] = prepareReimburseItemsForSave([item({ expenseDate: DATE, amount: 100 })]);
  assert.equal(row.vatAmount, null);
  assert.equal(row.whtAmount, null);
});

test("a blank or malformed VAT is refused by its own message", () => {
  for (const bad of ["", "  ", "abc", Number.NaN]) {
    assert.throws(
      () => prepareReimburseItemsForSave([item({ expenseDate: DATE, amount: 100, vatAmount: bad })]),
      /จำนวนภาษีมูลค่าเพิ่ม \(VAT\) ไม่ถูกต้อง/,
      `vatAmount ${JSON.stringify(bad)} was accepted`,
    );
  }
});

test("a blank or malformed WHT is refused by its own message", () => {
  for (const bad of ["", "  ", "abc", Number.NaN]) {
    assert.throws(
      () => prepareReimburseItemsForSave([item({ expenseDate: DATE, amount: 100, whtAmount: bad })]),
      /จำนวนหัก ณ ที่จ่ายไม่ถูกต้อง/,
      `whtAmount ${JSON.stringify(bad)} was accepted`,
    );
  }
});

test("a real VAT and WHT come through as numbers", () => {
  const [row] = prepareReimburseItemsForSave([
    item({ expenseDate: DATE, amount: 1070, vatAmount: "70", whtAmount: 30 }),
  ]);
  assert.equal(row.vatAmount, 70);
  assert.equal(row.whtAmount, 30);
});

/* ─────────────── layer 2: the persisted rows, at submit ─────────────── */

test("a persisted row must be worth more than nothing", () => {
  assert.deepEqual(validateItemMoney([item({ expenseDate: DATE, amount: 100 })]), []);
  for (const bad of [0, -1, null, "", "  ", "abc", Number.NaN]) {
    assert.deepEqual(
      validateItemMoney([item({ expenseDate: DATE, amount: bad })]),
      ["กรุณาระบุจำนวนเงินให้ถูกต้อง (มากกว่า 0)"],
      `amount ${JSON.stringify(bad)} passed submit validation`,
    );
  }
});

test("submit validation accumulates every bad row rather than stopping at the first", () => {
  const errs = validateItemMoney([
    item({ expenseDate: DATE, amount: 0 }),
    item({ expenseDate: DATE, amount: 100 }),
    item({ expenseDate: DATE, amount: -5 }),
  ]);
  assert.deepEqual(errs, [
    "กรุณาระบุจำนวนเงินให้ถูกต้อง (มากกว่า 0) (แถวที่ 1)",
    "กรุณาระบุจำนวนเงินให้ถูกต้อง (มากกว่า 0) (แถวที่ 3)",
  ]);
});

test("a non-finite VAT or WHT on a persisted row is reported", () => {
  assert.deepEqual(validateItemMoney([item({ expenseDate: DATE, amount: 100, vatAmount: "abc" })]), [
    "จำนวนภาษีมูลค่าเพิ่ม (VAT) ไม่ถูกต้อง",
  ]);
  assert.deepEqual(validateItemMoney([item({ expenseDate: DATE, amount: 100, whtAmount: "abc" })]), [
    "จำนวนหัก ณ ที่จ่ายไม่ถูกต้อง",
  ]);
});

test("no items is not this function's complaint to make", () => {
  assert.deepEqual(validateItemMoney([]), []);
});

/* ─────────────── the label ─────────────── */

test("a single row is not numbered, several rows are", () => {
  assert.equal(rowLabel(0, 1), "");
  assert.equal(rowLabel(0, 3), " (แถวที่ 1)");
  assert.equal(rowLabel(2, 3), " (แถวที่ 3)");
});
