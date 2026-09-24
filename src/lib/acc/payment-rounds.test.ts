import { test } from "node:test";
import assert from "node:assert/strict";
import { everyFridayInMonth, ymd } from "./payment-calendar-core";
import { paydaysInMonth } from "./payment-rounds";

const days = (ds: Date[]) => ds.map(ymd);

/* September 2026 has four Fridays: 4, 11, 18, 25. */
test("a four-Friday month gives four", () => {
  assert.deepEqual(days(everyFridayInMonth(2026, 8)),
    ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
});

/* January 2027 has five: 1, 8, 15, 22, 29. */
test("a five-Friday month gives five", () => {
  assert.deepEqual(days(everyFridayInMonth(2027, 0)),
    ["2027-01-01", "2027-01-08", "2027-01-15", "2027-01-22", "2027-01-29"]);
});

/* The trap this function exists for. nthFridayOfMonth(2026, 8, 5) is raw date
   arithmetic — 1 + offset + 4*7 — and rolls into October, silently. Every date
   here must belong to the month asked for. */
test("no date escapes its month", () => {
  for (let m = 0; m < 12; m++) {
    for (const d of everyFridayInMonth(2026, m)) {
      assert.equal(d.getMonth(), m, `${ymd(d)} escaped month ${m}`);
      assert.equal(d.getDay(), 5, `${ymd(d)} is not a Friday`);
    }
  }
});

test("AP-2 pays every Friday", () => {
  assert.deepEqual(days(paydaysInMonth("AP-2", 2026, 8)),
    ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
});

test("AP-1 and AP-3 pay on the 2nd and 4th only", () => {
  assert.deepEqual(days(paydaysInMonth("AP-1", 2026, 8)), ["2026-09-11", "2026-09-25"]);
  assert.deepEqual(days(paydaysInMonth("AP-3", 2026, 8)), ["2026-09-11", "2026-09-25"]);
});

/* The property that makes this change safe to ship: no stored PaymentDate can
   become invalid, because AP-2's new set contains its old one. */
test("AP-2's days are a superset of what they were", () => {
  for (let m = 0; m < 12; m++) {
    const weekly = new Set(days(paydaysInMonth("AP-2", 2026, m)));
    for (const d of days(paydaysInMonth("AP-1", 2026, m))) {
      assert.ok(weekly.has(d), `${d} was payable before and is not now`);
    }
  }
});
