import { test } from "node:test";
import assert from "node:assert/strict";
import { perDiemSourceNote, perDiemFootnote, hasUnratedDay } from "./perdiem-note";

/**
 * What the form says about WHICH per-diem rate priced the trip.
 *
 * The figure was already right — `useTravelBookingForm` prices through
 * `perDiemLogFor`, and the card renders the `groups` breakdown as `N วัน × ฿rate`
 * — but nothing said where the rate came from, and the footnote said the wrong
 * thing outright: "ยอดจริงคำนวณจากอัตราเบี้ยเลี้ยงย้อนหลังตามวันที่ในระบบ HR",
 * which is false for every trip a configured country rate prices.
 *
 * `perdiem-country.ts` returns `source` for exactly this and says so in its
 * header: "the form's note, the report's rate column and the recompute's audit
 * row all have to state which rate applied". The form was the one that did not.
 */

test("a country rate is named, with the country", () => {
  assert.equal(
    perDiemSourceNote("country", "United Kingdom · อังกฤษ"),
    "ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับ United Kingdom · อังกฤษ",
  );
});

/** A country whose name the 25-entry list does not carry still gets a sentence. */
test("an unnamed country falls back to a sentence with no name", () => {
  assert.equal(
    perDiemSourceNote("country", null),
    "ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับประเทศปลายทาง",
  );
  assert.equal(perDiemSourceNote("country", "  "), "ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับประเทศปลายทาง");
});

/**
 * The employee case says so too rather than saying nothing. Silence was the old
 * behaviour and it is what let the HR footnote read as universal.
 */
test("the employee's own allowance is named as such", () => {
  assert.equal(perDiemSourceNote("employee", "อังกฤษ"), "ใช้เบี้ยเลี้ยงตามข้อมูล HR ของผู้ขอเบิก");
  assert.equal(perDiemSourceNote("employee", null), "ใช้เบี้ยเลี้ยงตามข้อมูล HR ของผู้ขอเบิก");
});

/**
 * The footnote promises where the FINAL figure comes from, and it must not name
 * HR for a trip a country rate prices — the server re-derives through the same
 * `perDiemLogFor`, so the source it lands on is the one stated here.
 */
test("the footnote follows the same source", () => {
  assert.ok(perDiemFootnote("employee").indexOf("HR") > 0);
  assert.equal(perDiemFootnote("country").indexOf("HR"), -1);
  assert.ok(perDiemFootnote("country").indexOf("ส่งคำขอ") > 0);
  assert.ok(perDiemFootnote("employee").indexOf("ส่งคำขอ") > 0);
});

/**
 * **A day the log cannot price is worth ฿0**, not the nearest rate:
 * `rateForDay` returns 0 when no entry's `effectiveDate` is `<= day`
 * (`perdiem.ts:24-32`). So a trip that starts before the country's earliest
 * configured date has those days counted and paid nothing — visible in the
 * breakdown as `1 วัน × ฿0.00`, which states the fact and explains none of it.
 */
test("a zero-rate group is detected so it can be explained", () => {
  assert.equal(hasUnratedDay([{ rate: 2500, days: 3 }]), false);
  assert.equal(hasUnratedDay([{ rate: 0, days: 1 }]), true);
  assert.equal(hasUnratedDay([{ rate: 0, days: 1 }, { rate: 2500, days: 2 }]), true);
  assert.equal(hasUnratedDay([]), false);
});

/** Negative is impossible from the table's CHECK, but zero is the test, not sign. */
test("only exactly zero counts as unrated", () => {
  assert.equal(hasUnratedDay([{ rate: 0.01, days: 1 }]), false);
});
