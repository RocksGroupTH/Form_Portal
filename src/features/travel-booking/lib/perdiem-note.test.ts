import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configuredRateNote,
  historyToggleLabel,
  perDiemRateSummary,
  upcomingRateNote,
  hasUnratedDay,
  perDiemAttributionFootnote,
  perDiemAttributionNote,
} from "./perdiem-note";

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

/* ── Attribution: four states, because two could not say what the card must ── */

test("a configured country names itself", () => {
  assert.equal(
    perDiemAttributionNote({ kind: "country", countryCode: "GB" }, "อังกฤษ · United Kingdom"),
    "ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับ อังกฤษ · United Kingdom",
  );
});

/** Thailand and a country-less draft are the same answer and the settled one. */
test("home is the HR allowance, stated plainly", () => {
  assert.equal(perDiemAttributionNote({ kind: "home" }, null), "ใช้เบี้ยเลี้ยงตามข้อมูล HR ของผู้ขอเบิก");
});

/**
 * **A foreign country nobody has configured is not the same sentence as home.**
 * It prices at the requester's own Thai allowance — a London trip at ฿300 a day
 * — which is correct behaviour and reads as ordinary unless the country is
 * named. This is the sentence that says a rate is missing.
 */
test("an unconfigured foreign country says so, and names itself", () => {
  assert.equal(
    perDiemAttributionNote({ kind: "unconfigured", countryCode: "JP" }, "ญี่ปุ่น · Japan"),
    "ยังไม่ได้กำหนดเบี้ยเลี้ยงสำหรับ ญี่ปุ่น · Japan — ใช้เบี้ยเลี้ยงตามข้อมูล HR ของผู้ขอเบิก",
  );
});

/**
 * While the rates are in flight the money is already withheld
 * (`foreignPending`), and the note must not assert a source in the same breath.
 * Asserting HR there was the guard telling the truth and the sentence
 * contradicting it.
 */
test("pending says it is still checking, and claims nothing", () => {
  const note = perDiemAttributionNote({ kind: "pending", countryCode: "GB" }, "อังกฤษ");
  assert.ok(note.indexOf("HR") === -1, `pending must not claim HR: ${note}`);
  assert.ok(note.indexOf("กำลัง") === 0, note);
});

test("the footnote follows the attribution, and only a country rate drops HR", () => {
  assert.equal(perDiemAttributionFootnote({ kind: "country", countryCode: "GB" }).indexOf("HR"), -1);
  assert.ok(perDiemAttributionFootnote({ kind: "home" }).indexOf("HR") > 0);
  // Unconfigured really is priced from HR, so its footnote must still say HR.
  assert.ok(perDiemAttributionFootnote({ kind: "unconfigured", countryCode: "JP" }).indexOf("HR") > 0);
  assert.ok(perDiemAttributionFootnote({ kind: "pending", countryCode: "GB" }).indexOf("ส่งคำขอ") > 0);
});

/**
 * The rate is stated **before any date is typed** — the state the request was
 * about. `computePerDiem` needs dates; naming the rate does not.
 */
/* ── The rate in force, and everything else behind a click ── */

const RATES = [
  { effectiveDate: "2026-01-01", amount: 800 },
  { effectiveDate: "2026-09-01", amount: 1000 },
  { effectiveDate: "2026-09-04", amount: 1500 },
];

/**
 * **Current is decided against today, not by taking the newest row.** On
 * 2026-09-03 the ฿1,500 row dated 04/09 has not started; calling it current
 * would tell a requester they will be paid a figure nobody will pay them yet.
 */
test("current is the newest rate whose date has arrived", () => {
  const s = perDiemRateSummary(RATES, "2026-09-03");
  assert.equal(s?.current.amount, 1000);
  assert.equal(s?.current.effectiveDate, "2026-09-01");
});

test("a rate starting exactly today is already current", () => {
  assert.equal(perDiemRateSummary(RATES, "2026-09-04")?.current.amount, 1500);
});

/**
 * **A future rate is neither current nor ย้อนหลัง, and is never folded away.**
 * It may take effect during the very trip being booked, so it is surfaced beside
 * the current one; the fold is for the past alone.
 */
test("an upcoming rate is surfaced, not hidden in the history", () => {
  const s = perDiemRateSummary(RATES, "2026-09-03");
  assert.equal(s?.upcoming?.amount, 1500);
  assert.equal(s?.upcoming?.effectiveDate, "2026-09-04");
  assert.deepEqual(s?.past.map((p) => p.amount), [800]);
});

test("past rates are newest first, and exclude the current one", () => {
  const s = perDiemRateSummary(
    [
      { effectiveDate: "2026-01-01", amount: 800 },
      { effectiveDate: "2026-05-01", amount: 900 },
      { effectiveDate: "2026-09-01", amount: 1000 },
    ],
    "2026-09-03",
  );
  assert.equal(s?.current.amount, 1000);
  assert.deepEqual(s?.past.map((p) => p.amount), [900, 800]);
  assert.equal(s?.upcoming, null);
});

/**
 * Every rate still in the future: nothing is in force yet, and `rateForDay` pays
 * **0** for those days (`perdiem.ts:24-32`). Answering null rather than
 * pretending the earliest is current is what lets the card say so.
 */
test("nothing in force yet is null, not the earliest future rate", () => {
  assert.equal(perDiemRateSummary([{ effectiveDate: "2026-12-01", amount: 1500 }], "2026-09-03"), null);
});

test("an empty log is null", () => {
  assert.equal(perDiemRateSummary([], "2026-09-03"), null);
});

/** One line, the current rate alone — the span it replaced showed two. */
test("the line names the current rate and the day it started", () => {
  const s = perDiemRateSummary(RATES, "2026-09-03");
  assert.equal(configuredRateNote(s), "฿1,000.00 ต่อวัน (มีผล 01/09/2026)");
  assert.equal(configuredRateNote(null), null);
});

/** The upcoming change gets its own sentence, because it may land mid-trip. */
test("an upcoming change is stated in full", () => {
  const s = perDiemRateSummary(RATES, "2026-09-03");
  assert.equal(upcomingRateNote(s), "จะเปลี่ยนเป็น ฿1,500.00 ต่อวัน ตั้งแต่ 04/09/2026");
  assert.equal(upcomingRateNote(perDiemRateSummary([RATES[1]], "2026-09-03")), null);
});

/** The fold's label counts the PAST alone — upcoming is not history. */
test("the history label counts only past rates", () => {
  assert.equal(historyToggleLabel(perDiemRateSummary(RATES, "2026-09-03")), "ดูเรทย้อนหลัง (1)");
  assert.equal(historyToggleLabel(perDiemRateSummary([RATES[1], RATES[2]], "2026-09-03")), null);
});
