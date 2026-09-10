import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveClrPaymentDate } from "./clear-advance-payment-date";

/** Two real rounds: the 2nd and 4th Fridays of September 2026. */
const ROUNDS = ["2026-09-11", "2026-09-25"];

function ask(patch: Partial<Parameters<typeof resolveClrPaymentDate>[0]>) {
  return resolveClrPaymentDate({
    refundToCompany: -500,
    refundTransferDate: null,
    submitted: "2026-09-11",
    allowedRounds: ROUNDS,
    ...patch,
  });
}

/* ── the company pays the employee: treasury's own run ── */

test("an allowed round is taken as given", () => {
  assert.deepEqual(ask({ submitted: "2026-09-25" }), { ok: true, paymentDate: "2026-09-25" });
});

test("no date at all is refused, because the company has to pay on some day", () => {
  const r = ask({ submitted: null });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /กรุณาระบุวันจ่าย/);
});

test("a Wednesday is refused even though it is a real date", () => {
  const r = ask({ submitted: "2026-09-09" });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /ไม่อยู่ในรอบที่กำหนด/);
});

test("the 3rd Friday is refused — being a Friday is not the rule", () => {
  assert.equal(ask({ submitted: "2026-09-18" }).ok, false);
});

test("a round that has already passed is refused, because it is not in the list", () => {
  // getPaymentDates never returns past rounds, so this is how the past is refused.
  assert.equal(ask({ submitted: "2026-08-28" }).ok, false);
});

/* ── the employee transfers money back: the day their transfer cleared ── */

test("the transfer date is taken, whatever day of the week it fell on", () => {
  assert.deepEqual(
    ask({ refundToCompany: 500, refundTransferDate: "2026-09-08", submitted: null }),
    { ok: true, paymentDate: "2026-09-08" },
  );
});

test("the round rule is not applied to a refund — a Tuesday transfer is fine", () => {
  const r = ask({ refundToCompany: 500, refundTransferDate: "2026-09-08", submitted: null, allowedRounds: [] });
  assert.deepEqual(r, { ok: true, paymentDate: "2026-09-08" });
});

test("what the browser sent is ignored on a refund; the stored transfer date wins", () => {
  assert.deepEqual(
    ask({ refundToCompany: 500, refundTransferDate: "2026-09-08", submitted: "2026-09-25" }),
    { ok: true, paymentDate: "2026-09-08" },
  );
});

/* ── nothing moves ── */

test("an exactly settled clearing keeps whatever was stored, and is not round-checked", () => {
  assert.deepEqual(
    ask({ refundToCompany: 0, submitted: "2026-09-09", allowedRounds: [] }),
    { ok: true, paymentDate: "2026-09-09" },
  );
  assert.deepEqual(ask({ refundToCompany: 0, submitted: null, allowedRounds: [] }), { ok: true, paymentDate: null });
});

/* ── shape ── */

test("a blank string is not a date", () => {
  const r = ask({ submitted: "   " });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /กรุณาระบุวันจ่าย/);
});

test("a missing refund figure is read as nothing moving", () => {
  assert.deepEqual(
    ask({ refundToCompany: null, submitted: null, allowedRounds: [] }),
    { ok: true, paymentDate: null },
  );
});
