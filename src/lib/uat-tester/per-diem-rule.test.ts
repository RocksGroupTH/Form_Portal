import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { rateForDay } from "@/lib/acc/travel-booking/perdiem";
import {
  UAT_PER_DIEM_NOTE_MAX,
  UatPerDiemInputError,
  inForcePerDiemDate,
  latestUatPerDiemRate,
  parseUatPerDiemInput,
  perDiemRateState,
  uatPerDiemLogFrom,
  type UatPerDiemRateRow,
} from "./per-diem-rule";

function row(over: Partial<UatPerDiemRateRow>): UatPerDiemRateRow {
  return {
    id: 1,
    staffId: 100,
    effectiveDate: "2026-01-01",
    amount: 500,
    note: null,
    ...over,
  };
}

test("no rows is null, never an empty array", () => {
  // [] handed to rateForDay prices every day at 0, which is a different claim
  // from "this tester has no override".
  assert.equal(uatPerDiemLogFrom([]), null);
});

test("every stored row counts — there is no flag left to switch one off", () => {
  // The rule this replaced skipped rows whose IsActive was 0, which is how a
  // tester with two rates and both switched off silently became a tester with
  // NO override, priced at their real HR salary. HR's own EmployeeAllowanceLog
  // has no such column and getAllowanceLog filters on nothing.
  const log = uatPerDiemLogFrom([
    row({ id: 1, effectiveDate: "2026-01-01", amount: 500 }),
    row({ id: 2, effectiveDate: "2026-06-01", amount: 800 }),
  ]);
  assert.deepEqual(log, [
    { effectiveDate: "2026-01-01", amount: 500 },
    { effectiveDate: "2026-06-01", amount: 800 },
  ]);
});

test("a rate that has not started yet is still in the log", () => {
  // rateForDay ignores an entry dated after the day it is asked about, so a
  // future rate costs nothing here — and it must survive, because the settings
  // grid prints exactly this row and an AP-17 trip cannot depart before
  // tomorrow. Dropping it at this layer would make tomorrow's trip price at
  // yesterday's figure.
  assert.deepEqual(uatPerDiemLogFrom([row({ effectiveDate: "2099-01-01", amount: 900 })]), [
    { effectiveDate: "2099-01-01", amount: 900 },
  ]);
});

test("the log is sorted by effective date ascending", () => {
  const log = uatPerDiemLogFrom([
    row({ id: 1, effectiveDate: "2026-06-01", amount: 800 }),
    row({ id: 2, effectiveDate: "2026-01-01", amount: 500 }),
    row({ id: 3, effectiveDate: "2026-03-01", amount: 650 }),
  ]);
  assert.deepEqual(log, [
    { effectiveDate: "2026-01-01", amount: 500 },
    { effectiveDate: "2026-03-01", amount: 650 },
    { effectiveDate: "2026-06-01", amount: 800 },
  ]);
});

test("the caller's array is not mutated", () => {
  const rows = [
    row({ id: 1, effectiveDate: "2026-06-01" }),
    row({ id: 2, effectiveDate: "2026-01-01" }),
  ];
  uatPerDiemLogFrom(rows);
  assert.equal(rows[0].effectiveDate, "2026-06-01");
});

/* ── latestUatPerDiemRate — what the UAT Users grid prints ── */

test("no rate for this tester is null", () => {
  assert.equal(latestUatPerDiemRate([], 100), null);
  assert.equal(latestUatPerDiemRate([row({ staffId: 999 })], 100), null);
});

test("the LATEST configured rate wins, including one that has not started", () => {
  // Not "the rate in force today": an AP-17 trip cannot depart before tomorrow,
  // so a rate dated tomorrow is the one that will price the next trip that can
  // exist. The old rule excluded it and left an admin who had just saved a rate
  // looking at the previous figure.
  //
  // The newer date is 2099 rather than "tomorrow". Written as 2026-09-07 and
  // 2026-09-08 this test PASSED UNDER THE OLD RULE TOO, because it was written
  // on 2026-09-08 and that "future" rate had already started — a test named for
  // the regression it cannot catch. A date no clock will reach keeps it honest.
  const rows = [
    row({ id: 1, effectiveDate: "2026-09-07", amount: 300 }),
    row({ id: 2, effectiveDate: "2099-01-01", amount: 400 }),
  ];
  assert.deepEqual(latestUatPerDiemRate(rows, 100), {
    amount: 400,
    effectiveDate: "2099-01-01",
  });
});

test("latestUatPerDiemRate and rateForDay are meant to DISAGREE", () => {
  // The whole point of the grid's rule, and the thing a later reader is most
  // likely to "fix". Only prose defended it until now: rateForDay is what
  // prices a trip and must ignore a rate that has not started, while the grid
  // must show that rate or an admin who just saved one sees no change.
  // rateForDay is import-free (perdiem.ts has no imports), so this costs no
  // database.
  const rows = [
    row({ id: 1, effectiveDate: "2026-01-01", amount: 300 }),
    row({ id: 2, effectiveDate: "2099-01-01", amount: 400 }),
  ];
  const log = uatPerDiemLogFrom(rows);
  assert.ok(log);
  assert.equal(rateForDay("2026-09-08", log), 300, "pricing must ignore a rate that has not started");
  assert.deepEqual(
    latestUatPerDiemRate(rows, 100),
    { amount: 400, effectiveDate: "2099-01-01" },
    "the grid must show the latest configured rate, started or not",
  );
});

test("another tester's rows are not borrowed", () => {
  const rows = [
    row({ id: 1, staffId: 100, effectiveDate: "2026-01-01", amount: 300 }),
    row({ id: 2, staffId: 200, effectiveDate: "2026-09-01", amount: 900 }),
  ];
  assert.deepEqual(latestUatPerDiemRate(rows, 100), {
    amount: 300,
    effectiveDate: "2026-01-01",
  });
});

test("input order does not decide the answer", () => {
  const asc = [
    row({ id: 1, effectiveDate: "2026-01-01", amount: 300 }),
    row({ id: 2, effectiveDate: "2026-06-01", amount: 800 }),
  ];
  assert.deepEqual(latestUatPerDiemRate(asc, 100), latestUatPerDiemRate(asc.slice().reverse(), 100));
});

/* ── perDiemRateState / inForcePerDiemDate — what the settings screen draws ── */

test("a rate effective TODAY has started — the one day the boundary matters", () => {
  // A `>=` here, or a Date comparison that drifts, labels today's own rate as
  // upcoming for exactly one day of its life. That is the whole reason this is
  // a function rather than an inline `>`.
  assert.equal(perDiemRateState({ effectiveDate: "2026-09-08" }, "2026-09-08"), "started");
  assert.equal(perDiemRateState({ effectiveDate: "2026-09-07" }, "2026-09-08"), "started");
  assert.equal(perDiemRateState({ effectiveDate: "2026-09-09" }, "2026-09-08"), "upcoming");
  assert.equal(perDiemRateState(null, "2026-09-08"), null);
});

test("inForcePerDiemDate is rateForDay's selection, answered as a date", () => {
  const rows = [
    row({ id: 1, effectiveDate: "2026-01-01" }),
    row({ id: 2, effectiveDate: "2026-09-08" }),
    row({ id: 3, effectiveDate: "2099-01-01" }),
  ];
  assert.equal(inForcePerDiemDate(rows, 100, "2026-09-08"), "2026-09-08");
  assert.equal(inForcePerDiemDate(rows, 100, "2026-06-01"), "2026-01-01");
});

test("every rate still ahead means nothing is in force — a real state, not an error", () => {
  // The tester is then priced at 0/day for those days rather than at their HR
  // rate, because uatPerDiemLogFrom answers a non-null log and rateForDay
  // answers 0 for an uncovered day. With no toggle and no delete the row cannot
  // be withdrawn, only superseded by an earlier-dated one.
  assert.equal(inForcePerDiemDate([row({ effectiveDate: "2099-01-01" })], 100, "2026-09-08"), null);
});

test("inForcePerDiemDate does not depend on input order, or on another tester", () => {
  const rows = [
    row({ id: 1, staffId: 100, effectiveDate: "2026-01-01" }),
    row({ id: 2, staffId: 100, effectiveDate: "2026-06-01" }),
    row({ id: 3, staffId: 200, effectiveDate: "2026-09-01" }),
  ];
  assert.equal(inForcePerDiemDate(rows, 100, "2026-09-08"), "2026-06-01");
  assert.equal(inForcePerDiemDate(rows.slice().reverse(), 100, "2026-09-08"), "2026-06-01");
});

/* ── the client bundle ──
   `UatUserSettings.tsx` is a "use client" component and imports this module for
   its type AND for `latestUatPerDiemRate`, so this module is bundled for the
   browser. That is safe only while it reaches nothing server-side, which no type
   error would ever tell us: `src/lib/api-keys/codes.ts` broke the build exactly
   this way, and the failure was a build break with a clean typecheck. Source
   reading, because the property is about what the file IMPORTS. */

test("per-diem-rule.ts imports nothing at runtime", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/uat-tester/per-diem-rule.ts"),
    "utf8",
  );
  const imports = (src.match(/^import[^\n]*/gm) ?? []).map((l) => l.trim());
  assert.ok(imports.length > 0, "expected at least one import line to check");
  for (const line of imports) {
    assert.ok(
      line.startsWith("import type"),
      `per-diem-rule.ts gained a runtime import: ${line}. A client component bundles ` +
        "this module, so anything reaching @/lib/db/mssql or @/env poisons that bundle " +
        "-- and no type error would say so.",
    );
  }
  // `import` at the start of a line is not the only way in. A re-export and a
  // dynamic import each pull a module in at runtime and neither begins with the
  // word the loop above matches, so that check would stay green while the
  // bundle filled up. `export type { … } from` is erased and is excluded.
  for (const line of src.split("\n").map((l) => l.trim())) {
    assert.ok(
      !(line.startsWith("export {") || line.startsWith("export *")) || !line.includes(" from "),
      `per-diem-rule.ts re-exports at runtime: ${line}. That bundles the source module.`,
    );
  }
  assert.ok(
    !/\bimport\s*\(/.test(src),
    "per-diem-rule.ts uses a dynamic import, which bundles the target for the client too",
  );
});

test("the settings page never imports the pool half", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/features/settings/UatUserSettings.tsx"),
    "utf8",
  );
  assert.ok(
    !src.includes('"@/lib/uat-tester/per-diem"'),
    'UatUserSettings.tsx imports "@/lib/uat-tester/per-diem", which opens a pool. ' +
      'Take the type and the rule from "@/lib/uat-tester/per-diem-rule" instead.',
  );
  assert.ok(
    src.includes('"@/lib/uat-tester/per-diem-rule"'),
    "UatUserSettings.tsx should take the row type and the latest-rate rule from the " +
      "pure module rather than re-declaring them -- the local copy it used to keep " +
      "still carried isActive after the column was gone.",
  );
  // Importing is not the property. Re-inlining a local "rate in force today"
  // helper beside the import leaves both assertions above green and restores
  // the exact bug this work removed, so pin the CALLS as well.
  for (const fn of ["latestUatPerDiemRate", "perDiemRateState", "inForcePerDiemDate"]) {
    assert.ok(
      new RegExp(`\\b${fn}\\s*\\(`).test(src),
      `UatUserSettings.tsx no longer CALLS ${fn}. Importing the module is not the ` +
        "property being guarded: the grid must print the LATEST CONFIGURED rate, not " +
        "the one in force today, and an inlined local rule would keep every import " +
        "assertion here green while putting the original bug back.",
    );
  }
});

test("the twin table still filters IsActive — this change must not have spread", () => {
  // The counterpart to every assertion above. AccTravelPerDiemCountry has the
  // same row shape, the same settings panel and a toggle of the same shape, and
  // ITS pricing genuinely does gate on the flag. A sweep for `isActive` or
  // "The soft delete" hits it, and since 143 those greps return the twin's
  // working code and nothing else — so the next person tidying up after this
  // change is aimed straight at it. Source-reading, because the failure is a
  // deletion and no behavioural test of this module would notice.
  const twin = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/acc/travel-booking/perdiem-source.ts"),
    "utf8",
  );
  assert.ok(
    twin.includes("IsActive = 1"),
    "perdiem-source.ts no longer filters IsActive = 1. That is AccTravelPerDiemCountry, " +
      "NOT the UAT per-diem table: its flag is read by pricing and must stay. Migration " +
      "143 dropped the column from TesterPerDiem only.",
  );
});

test("a valid input parses", () => {
  assert.deepEqual(
    parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount: 800, note: "  ทดสอบ  " }),
    { staffId: 100, effectiveDate: "2026-09-07", amount: 800, note: "ทดสอบ" },
  );
});

test("a blank note becomes null", () => {
  const parsed = parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount: 800, note: "   " });
  assert.equal(parsed.note, null);
});

test("a numeric string amount is accepted", () => {
  const parsed = parseUatPerDiemInput({ staffId: "100", effectiveDate: "2026-09-07", amount: " 800.50 " });
  assert.equal(parsed.amount, 800.5);
  assert.equal(parsed.staffId, 100);
});

// Every one of these is a finite 0 under Number(), which would look configured
// and pay nothing. They are listed individually because a single case would not
// prove the guard is on the value rather than on its type.
const AMOUNT_REFUSALS: unknown[] = [0, -1, "", " ", null, undefined, [], false, "abc", NaN, Infinity];
AMOUNT_REFUSALS.forEach((amount, i) => {
  test(`amount case ${i} (${String(amount)}) is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount }),
      (e: unknown) =>
        e instanceof UatPerDiemInputError && e.message === "จำนวนเงินต่อวันต้องมากกว่า 0",
    );
  });
});

const EFFECTIVE_DATE_REFUSALS: unknown[] = ["", "   ", "2026-9-7", "07/09/2026", "2026-13-01", "2026-02-30", null, 20260907];
EFFECTIVE_DATE_REFUSALS.forEach((effectiveDate, i) => {
  test(`effective date case ${i} (${String(effectiveDate)}) is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId: 100, effectiveDate, amount: 800 }),
      (e: unknown) =>
        e instanceof UatPerDiemInputError && e.message === "กรุณาเลือกวันที่เริ่มมีผล",
    );
  });
});

test(`a note of exactly ${UAT_PER_DIEM_NOTE_MAX} characters is accepted`, () => {
  const note = "a".repeat(UAT_PER_DIEM_NOTE_MAX);
  const parsed = parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount: 800, note });
  assert.equal(parsed.note, note);
});

test(`a note of ${UAT_PER_DIEM_NOTE_MAX + 1} characters is refused`, () => {
  const note = "a".repeat(UAT_PER_DIEM_NOTE_MAX + 1);
  assert.throws(
    () => parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount: 800, note }),
    (e: unknown) =>
      e instanceof UatPerDiemInputError &&
      e.message === `หมายเหตุยาวเกิน ${UAT_PER_DIEM_NOTE_MAX} ตัวอักษร`,
  );
});

const STAFF_ID_REFUSALS: unknown[] = [0, -1, 1.5, "", "abc", null, undefined];
STAFF_ID_REFUSALS.forEach((staffId, i) => {
  test(`staffId case ${i} (${String(staffId)}) is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId, effectiveDate: "2026-09-07", amount: 800 }),
      (e: unknown) => e instanceof UatPerDiemInputError && e.message === "ไม่พบผู้ทดสอบรายนี้",
    );
  });
});
