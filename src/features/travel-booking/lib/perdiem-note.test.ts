import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configuredRateNote,
  historyToggleLabel,
  perDiemRateSummary,
  upcomingRateNotes,
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
  assert.equal(s?.current?.amount, 1000);
  assert.equal(s?.current?.effectiveDate, "2026-09-01");
});

test("a rate starting exactly today is already current", () => {
  assert.equal(perDiemRateSummary(RATES, "2026-09-04")?.current?.amount, 1500);
});

/**
 * **A future rate is neither current nor ย้อนหลัง, and is never folded away.**
 * It may take effect during the very trip being booked, so it is surfaced beside
 * the current one; the fold is for the past alone.
 */
test("an upcoming rate is surfaced, not hidden in the history", () => {
  const s = perDiemRateSummary(RATES, "2026-09-03");
  assert.deepEqual(s?.upcoming.map((u) => u.amount), [1500]);
  assert.deepEqual(s?.past.map((p) => p.amount), [800]);
});

/**
 * **Every future rate, not just the next one.** `upcoming` was a single field,
 * and `past` is built downward from the current index — so a third rate landed
 * in neither and appeared nowhere at all: not on the card, not in the fold, not
 * in its count. `computePerDiem` charges it regardless, so the breakdown and the
 * rate block contradicted each other on the same card.
 */
test("every future rate is listed, earliest first", () => {
  const s = perDiemRateSummary(
    [
      { effectiveDate: "2026-09-01", amount: 1000 },
      { effectiveDate: "2026-09-04", amount: 1500 },
      { effectiveDate: "2026-09-20", amount: 1800 },
    ],
    "2026-09-03",
  );
  assert.equal(s?.current?.amount, 1000);
  assert.deepEqual(s?.upcoming.map((u) => u.amount), [1500, 1800]);
  assert.deepEqual(s?.past, []);
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
  assert.equal(s?.current?.amount, 1000);
  assert.deepEqual(s?.past.map((p) => p.amount), [900, 800]);
  assert.deepEqual(s?.upcoming, []);
});

/**
 * **Nothing in force yet is not nothing to say.** `rateForDay` pays 0 for those
 * days, so the earliest future rate must not be called current — but returning
 * null for the whole summary made the card render no figure at all, while the
 * line above it still said a rate was configured for that country. It now
 * answers a summary with no current and every rate upcoming.
 */
test("an all-future log has no current rate but still reports them", () => {
  const s = perDiemRateSummary([{ effectiveDate: "2026-12-01", amount: 1500 }], "2026-09-03");
  assert.equal(s?.current, null);
  assert.deepEqual(s?.upcoming.map((u) => u.amount), [1500]);
  assert.deepEqual(s?.past, []);
  assert.equal(configuredRateNote(s), null);
});

/** Only an empty log is null — there is genuinely nothing to say then. */
test("an empty log is null", () => {
  assert.equal(perDiemRateSummary([], "2026-09-03"), null);
});

/** One line, the current rate alone — the span it replaced showed two. */
test("the line names the current rate and the day it started", () => {
  const s = perDiemRateSummary(RATES, "2026-09-03");
  assert.equal(configuredRateNote(s), "฿1,000.00 ต่อวัน (มีผล 01/09/2026)");
  assert.equal(configuredRateNote(null), null);
});

/** Each upcoming change gets its own sentence, because one may land mid-trip. */
test("every upcoming change is stated in full", () => {
  assert.deepEqual(upcomingRateNotes(perDiemRateSummary(RATES, "2026-09-03")), [
    "จะเปลี่ยนเป็น ฿1,500.00 ต่อวัน ตั้งแต่ 04/09/2026",
  ]);
  assert.deepEqual(upcomingRateNotes(perDiemRateSummary([RATES[1]], "2026-09-03")), []);
});

/**
 * With nothing in force, the first future rate STARTS the rate rather than
 * changing it — there is nothing to change from, and saying so would imply a
 * figure is being paid today.
 */
test("with no current rate the first upcoming one starts rather than changes", () => {
  const s = perDiemRateSummary(
    [
      { effectiveDate: "2026-12-01", amount: 1500 },
      { effectiveDate: "2027-01-01", amount: 1600 },
    ],
    "2026-09-03",
  );
  assert.deepEqual(upcomingRateNotes(s), [
    "จะเริ่มใช้ ฿1,500.00 ต่อวัน ตั้งแต่ 01/12/2026",
    "จะเปลี่ยนเป็น ฿1,600.00 ต่อวัน ตั้งแต่ 01/01/2027",
  ]);
});

/** The fold's label counts the PAST alone — upcoming is not history. */
test("the history label counts only past rates", () => {
  assert.equal(historyToggleLabel(perDiemRateSummary(RATES, "2026-09-03")), "ดูเรทย้อนหลัง (1)");
  assert.equal(historyToggleLabel(perDiemRateSummary([RATES[1], RATES[2]], "2026-09-03")), null);
});
