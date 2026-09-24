import { test } from "node:test";
import assert from "node:assert/strict";
import { countHomeStats, monthRange, type HomeStatRow } from "./home-stats";

/**
 * What each tile on the front page counts.
 *
 * These numbers are the kind that are wrong in silence: nothing on screen says
 * what a tile measured, so an off-by-one class of row just sits there looking
 * plausible. Each tile also links to My Requests with the matching filter, so a
 * wrong count is a front page that contradicts the page it sends you to.
 */

const AUG = new Date(2026, 7, 15, 10, 0, 0); // 15 Aug 2026, local

function row(status: string, submittedAt: string | null = "2026-08-10T09:00:00"): HomeStatRow {
  return { status, submittedAt };
}

test("total counts every row it is given, whatever the status", () => {
  const rows = [row("Submitted"), row("Rejected"), row("Cancelled"), row("Returned")];
  assert.equal(countHomeStats(rows, AUG).total, 4);
});

test("an empty list is all zeroes, not a missing tile", () => {
  assert.deepEqual(countHomeStats([], AUG), {
    total: 0,
    month: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
  });
});

/* ── the approval chain ── */

test("both approval steps count as pending, and nothing else does", () => {
  const rows = [
    row("Submitted"),
    row("ManagerApproved"),
    row("Approved"),
    row("Rejected"),
    row("Returned"),
    row("Cancelled"),
  ];
  assert.equal(countHomeStats(rows, AUG).pending, 2);
});

test("Completed counts as approved — AP-17's spelling of the same state", () => {
  // `approveByAccount` writes `Status='Completed'`; every other form writes
  // `Approved`. Counting only the second under-reports AP-17 silently, and the
  // อนุมัติแล้ว filter this tile links to matches both for the same reason.
  const rows = [row("Approved"), row("Completed"), row("Approved")];
  assert.equal(countHomeStats(rows, AUG).approved, 3);
});

test("each terminal status lands in exactly one tile", () => {
  const stats = countHomeStats(
    [row("Approved"), row("Rejected"), row("Rejected"), row("Cancelled")],
    AUG,
  );
  assert.equal(stats.approved, 1);
  assert.equal(stats.rejected, 2);
  assert.equal(stats.cancelled, 1);
});

test("Returned is in total but in no status tile — it has its own", () => {
  // It is a filed request AND something its owner can still edit, so it belongs
  // to `total` and to the ร่าง / ตีกลับ tile the hook counts separately. The
  // strip answers different questions; it is not a partition.
  const stats = countHomeStats([row("Returned")], AUG);
  assert.equal(stats.total, 1);
  assert.equal(stats.pending + stats.approved + stats.rejected + stats.cancelled, 0);
});

test("a status this app has never heard of is counted in total and nowhere else", () => {
  // Measured 2026-09-24: `AccRequest` holds `Ready` and `Received` rows on a
  // form code this app does not serve. Silently folding them into a tile would
  // be worse than leaving them out of the status breakdown.
  const stats = countHomeStats([row("Ready"), row("Received"), row("")], AUG);
  assert.equal(stats.total, 3);
  assert.equal(stats.pending + stats.approved + stats.rejected + stats.cancelled, 0);
});

test("a row with no status at all does not throw", () => {
  assert.equal(countHomeStats([{ submittedAt: "2026-08-01T00:00:00" }], AUG).total, 1);
});

/* ── the month ── */

test("this month counts by the local calendar, not by UTC", () => {
  // Thai wall clock: a row written at 23:30 on 31 July is July. Converting to
  // UTC first would move it into August for seven hours of every day — and only
  // for rows filed in the evening, which nobody would report.
  const rows = [
    row("Approved", "2026-07-31T23:30:00"),
    row("Approved", "2026-08-01T00:30:00"),
    row("Approved", "2026-08-31T23:30:00"),
    row("Approved", "2026-09-01T00:30:00"),
  ];
  assert.equal(countHomeStats(rows, AUG).month, 2);
});

test("the same day in a different YEAR is not this month", () => {
  const rows = [row("Approved", "2025-08-15T10:00:00"), row("Approved", "2026-08-15T10:00:00")];
  assert.equal(countHomeStats(rows, AUG).month, 1);
});

test("a null or unparseable submittedAt is not counted as this month", () => {
  const rows = [row("Approved", null), row("Approved", "not a date"), row("Approved")];
  assert.equal(countHomeStats(rows, AUG).month, 1);
  assert.equal(countHomeStats(rows, AUG).total, 3);
});

/* ── the month's own link ── */

test("monthRange spans the first to the last day of the month", () => {
  assert.deepEqual(monthRange(AUG), { from: "2026-08-01", to: "2026-08-31" });
});

test("February is 28 or 29 days without being told which", () => {
  assert.equal(monthRange(new Date(2026, 1, 10)).to, "2026-02-28");
  assert.equal(monthRange(new Date(2028, 1, 10)).to, "2028-02-29");
});

test("December rolls into the next year on its own", () => {
  assert.deepEqual(monthRange(new Date(2026, 11, 3)), { from: "2026-12-01", to: "2026-12-31" });
});

test("the range is zero-padded, because inDateRange compares the strings", () => {
  assert.deepEqual(monthRange(new Date(2026, 0, 5)), { from: "2026-01-01", to: "2026-01-31" });
});

test("every row the range covers is counted by month, and none outside it", () => {
  // The tile and its link must agree: `countHomeStats` measures `submittedAt`
  // and `inDateRange` filters the same field against these bounds.
  const { from, to } = monthRange(AUG);
  const rows = [
    row("Approved", "2026-08-01T00:00:00"),
    row("Approved", "2026-08-31T23:59:59"),
    row("Approved", "2026-07-31T23:59:59"),
    row("Approved", "2026-09-01T00:00:00"),
  ];
  const inRange = rows.filter((r) => {
    const day = (r.submittedAt ?? "").slice(0, 10);
    return day >= from && day <= to;
  }).length;
  assert.equal(countHomeStats(rows, AUG).month, inRange);
  assert.equal(inRange, 2);
});
