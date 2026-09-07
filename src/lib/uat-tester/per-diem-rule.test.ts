import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UatPerDiemInputError,
  parseUatPerDiemInput,
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
    isActive: true,
    ...over,
  };
}

test("no rows is null, never an empty array", () => {
  // [] handed to rateForDay prices every day at 0, which is a different claim
  // from "this tester has no override".
  assert.equal(uatPerDiemLogFrom([]), null);
});

test("only-inactive rows is null", () => {
  assert.equal(uatPerDiemLogFrom([row({ isActive: false })]), null);
});

test("inactive rows are dropped and the rest survive", () => {
  const log = uatPerDiemLogFrom([
    row({ id: 1, effectiveDate: "2026-01-01", amount: 500 }),
    row({ id: 2, effectiveDate: "2026-06-01", amount: 800, isActive: false }),
  ]);
  assert.deepEqual(log, [{ effectiveDate: "2026-01-01", amount: 500 }]);
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
for (const amount of [0, -1, "", " ", null, undefined, [], false, "abc", NaN, Infinity]) {
  test(`amount ${JSON.stringify(amount)} is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId: 100, effectiveDate: "2026-09-07", amount }),
      (e: unknown) =>
        e instanceof UatPerDiemInputError && e.message === "จำนวนเงินต่อวันต้องมากกว่า 0",
    );
  });
}

for (const effectiveDate of ["", "   ", "2026-9-7", "07/09/2026", "2026-13-01", "2026-02-30", null, 20260907]) {
  test(`effective date ${JSON.stringify(effectiveDate)} is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId: 100, effectiveDate, amount: 800 }),
      (e: unknown) =>
        e instanceof UatPerDiemInputError && e.message === "กรุณาเลือกวันที่เริ่มมีผล",
    );
  });
}

for (const staffId of [0, -1, 1.5, "", "abc", null, undefined]) {
  test(`staffId ${JSON.stringify(staffId)} is refused`, () => {
    assert.throws(
      () => parseUatPerDiemInput({ staffId, effectiveDate: "2026-09-07", amount: 800 }),
      (e: unknown) => e instanceof UatPerDiemInputError && e.message === "ไม่พบผู้ทดสอบรายนี้",
    );
  });
}
