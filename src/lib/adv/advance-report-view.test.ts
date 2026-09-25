import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLEAR_STATUS_CLEARED,
  DEFAULT_VISIBLE_KEYS,
  STATUS_APPROVED,
  STATUS_INPROCESS,
  TABLE_EXCLUDED_KEYS,
  clearingStatusLabel,
  clearingStatusTone,
  computeTileCounts,
  isAwaitingApproval,
  isAwaitingErp,
  isOverdueClearing,
  overallStatusTone,
  revisionReasonText,
  totalAmountThb,
  type Row,
} from "./advance-report-view";

/** A fully-populated row with sane defaults — tests override only the fields
 *  the case is about. */
function row(overrides: Partial<Row>): Row {
  return {
    id: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    requestNo: "ADV-0001",
    staffId: 1001,
    requesterName: "ทดสอบ ระบบ",
    position: null,
    department: null,
    payeeType: "พนักงาน",
    payeeName: "ผู้รับเงิน ทดสอบ",
    bankAccount: null,
    bankName: null,
    bankBranch: null,
    needByDate: null,
    expectedClearDate: "2026-08-15",
    purpose: null,
    currency: "THB",
    amount: 1000,
    exchangeRate: 1,
    baseAmount: 1000,
    approvedName: null,
    approvedDate: null,
    approvedRemark: null,
    actionedByName: null,
    actionedDate: null,
    actionedRemark: null,
    paymentDate: null,
    clearAdvanceNo: null,
    advanceStatus: null,
    pendingOn: null,
    overallStatus: STATUS_INPROCESS,
    erpInterfaceStatus: null,
    lastRevisionAction: null,
    lastRevisionReason: null,
    returnCount: 0,
    ...overrides,
  };
}

test("DEFAULT_VISIBLE_KEYS has exactly the 12 columns the design specifies", () => {
  assert.equal(DEFAULT_VISIBLE_KEYS.length, 12);
  assert.deepEqual(
    [...DEFAULT_VISIBLE_KEYS].sort(),
    [
      "advanceStatus",
      "baseAmount",
      "clearAdvanceNo",
      "expectedClearDate",
      "overallStatus",
      "paymentDate",
      "pendingOn",
      "revisionReason",
      "payeeName",
      "requestNo",
      "requesterName",
      "submittedAt",
    ].sort(),
  );
});

test("payeeType is excluded from the table entirely, not just hidden by default", () => {
  assert.equal(TABLE_EXCLUDED_KEYS.includes("payeeType"), true);
  assert.equal(DEFAULT_VISIBLE_KEYS.includes("payeeType"), false);
});

test("clearingStatusLabel: no AP-3 linked reads as ยังไม่เคลียร์, not blank", () => {
  assert.equal(clearingStatusLabel(null), "ยังไม่เคลียร์");
});

test("clearingStatusLabel: approved AP-3 reads as เคลียร์แล้ว", () => {
  assert.equal(clearingStatusLabel(CLEAR_STATUS_CLEARED), "เคลียร์แล้ว");
});

test("clearingStatusLabel: AP-3 in flight reads as กำลังเคลียร์", () => {
  assert.equal(clearingStatusLabel("กำลังเคลียร์"), "กำลังเคลียร์");
});

test("clearingStatusLabel: returned AP-3 reads as ส่งกลับแก้ไข", () => {
  assert.equal(clearingStatusLabel("ส่งกลับแก้ไข"), "ส่งกลับแก้ไข");
});

test("clearingStatusTone: cleared is ok, returned is bad, the rest are pending", () => {
  assert.equal(clearingStatusTone("เคลียร์แล้ว"), "ok");
  assert.equal(clearingStatusTone("ส่งกลับแก้ไข"), "bad");
  assert.equal(clearingStatusTone("ยังไม่เคลียร์"), "pending");
  assert.equal(clearingStatusTone("กำลังเคลียร์"), "pending");
});

test("overallStatusTone: approved ok, inprocess pending, everything else bad", () => {
  assert.equal(overallStatusTone(STATUS_APPROVED), "ok");
  assert.equal(overallStatusTone(STATUS_INPROCESS), "pending");
  assert.equal(overallStatusTone("ไม่อนุมัติ (Rejected)"), "bad");
  assert.equal(overallStatusTone("ยกเลิก (Canceled)"), "bad");
});

test("isOverdueClearing: approved, no clearing yet, past the promised date", () => {
  const r = row({ overallStatus: STATUS_APPROVED, advanceStatus: null, expectedClearDate: "2026-01-01" });
  assert.equal(isOverdueClearing(r, "2026-06-01"), true);
});

test("isOverdueClearing: not overdue once its AP-3 is cleared", () => {
  const r = row({ overallStatus: STATUS_APPROVED, advanceStatus: CLEAR_STATUS_CLEARED, expectedClearDate: "2026-01-01" });
  assert.equal(isOverdueClearing(r, "2026-06-01"), false);
});

test("isOverdueClearing: not overdue before the promised date", () => {
  const r = row({ overallStatus: STATUS_APPROVED, advanceStatus: null, expectedClearDate: "2026-12-01" });
  assert.equal(isOverdueClearing(r, "2026-06-01"), false);
});

test("isOverdueClearing: a request that was never approved owes nothing", () => {
  const r = row({ overallStatus: "ไม่อนุมัติ (Rejected)", advanceStatus: null, expectedClearDate: "2026-01-01" });
  assert.equal(isOverdueClearing(r, "2026-06-01"), false);
});

test("anything still in the chain is awaiting approval, whatever step it sits on", () => {
  const atManager = row({ overallStatus: STATUS_INPROCESS, pendingOn: "Head Accounting" });
  const atOfficer = row({ overallStatus: STATUS_INPROCESS, pendingOn: "Accounting Officer" });
  assert.equal(isAwaitingApproval(atManager), true);
  assert.equal(isAwaitingApproval(atOfficer), true);
  // Neither has been approved yet, so neither is waiting on the ERP send.
  assert.equal(isAwaitingErp(atManager), false);
  assert.equal(isAwaitingErp(atOfficer), false);
});

test("awaiting ERP is approved-and-not-Sent, which the approval status cannot tell apart", () => {
  const notSent = row({ overallStatus: STATUS_APPROVED, erpInterfaceStatus: null });
  const failed = row({ overallStatus: STATUS_APPROVED, erpInterfaceStatus: "Failed" });
  const sent = row({ overallStatus: STATUS_APPROVED, erpInterfaceStatus: "Sent" });
  assert.equal(isAwaitingErp(notSent), true);
  // Failed is retried from the same queue, so it is still outstanding work.
  assert.equal(isAwaitingErp(failed), true);
  assert.equal(isAwaitingErp(sent), false);
  // All three read identically on overallStatus alone — that is the trap.
  assert.equal(isAwaitingApproval(notSent), false);
});

test("computeTileCounts matches a known small dataset", () => {
  const rows: Row[] = [
    row({ id: 1, overallStatus: STATUS_INPROCESS, pendingOn: "Head Accounting" }),
    row({ id: 2, overallStatus: STATUS_INPROCESS, pendingOn: "ผู้บริหาร" }),
    row({ id: 3, overallStatus: STATUS_INPROCESS, pendingOn: "Accounting Officer" }),
    // Approved and never sent: overdue AND still waiting on the ERP send.
    row({ id: 4, overallStatus: STATUS_APPROVED, erpInterfaceStatus: null, advanceStatus: null, expectedClearDate: "2026-01-01" }),
    // Approved, already in BC, and cleared — counted by neither tile.
    row({ id: 5, overallStatus: STATUS_APPROVED, erpInterfaceStatus: "Sent", advanceStatus: CLEAR_STATUS_CLEARED, expectedClearDate: "2026-01-01" }),
    row({ id: 6, overallStatus: "ไม่อนุมัติ (Rejected)" }),
  ];
  const counts = computeTileCounts(rows, "2026-06-01");
  assert.deepEqual(counts, { awaitingApproval: 3, awaitingErp: 1, overdue: 1 });
});

test("totalAmountThb sums baseAmount over exactly the rows passed in", () => {
  const rows: Row[] = [row({ baseAmount: 1000 }), row({ baseAmount: 2500.5 }), row({ baseAmount: null })];
  assert.equal(totalAmountThb(rows), 3500.5);
});

/* ── สาเหตุที่แก้ไข/ยกเลิก ─────────────────────────────────────────────── */

test("a request nothing ever happened to shows nothing", () => {
  // Not "-", not "ไม่มี". Most rows in this report are ordinary approved
  // advances, and a column that prints something on every one of them buys
  // width from the columns that are always read.
  assert.equal(revisionReasonText(row({})), "");
});

test("each of the three actions is named, so the reason is not read as the wrong kind", () => {
  // A row can be Approved today and still carry the reason it was sent back
  // last week, so the cell cannot lean on the status column to say which
  // happened.
  const cases: [string, string][] = [
    ["returned", "ส่งกลับแก้ไข: แนบใบเสร็จไม่ครบ"],
    ["rejected", "ไม่อนุมัติ: แนบใบเสร็จไม่ครบ"],
    ["cancelled", "ยกเลิก: แนบใบเสร็จไม่ครบ"],
  ];
  for (const [action, expected] of cases) {
    const r = row({ lastRevisionAction: action, lastRevisionReason: "แนบใบเสร็จไม่ครบ" });
    assert.equal(revisionReasonText(r), expected, action);
  }
});

test("a missing reason is labelled, never left blank", () => {
  // The four cancellations already on UAT recorded no reason and never can.
  // A blank cell beside a cancelled request reads as a broken report.
  const r = row({ lastRevisionAction: "cancelled", lastRevisionReason: null });
  assert.equal(revisionReasonText(r), "ยกเลิก — ไม่ได้ระบุเหตุผล");
  // Whitespace is not a reason either.
  assert.equal(
    revisionReasonText(row({ lastRevisionAction: "cancelled", lastRevisionReason: "   " })),
    "ยกเลิก — ไม่ได้ระบุเหตุผล",
  );
});

test("the round count appears from the second return, not the first", () => {
  const once = row({ lastRevisionAction: "returned", lastRevisionReason: "แก้ยอด", returnCount: 1 });
  assert.equal(revisionReasonText(once), "ส่งกลับแก้ไข: แก้ยอด");

  const twice = row({ lastRevisionAction: "returned", lastRevisionReason: "แก้ยอด", returnCount: 2 });
  assert.equal(revisionReasonText(twice), "ส่งกลับแก้ไข: แก้ยอด (ส่งกลับ 2 ครั้ง)");
});

test("the count survives a later action of a different kind", () => {
  // ADV26-00060 on UAT: returned twice, then cancelled. The reason shown is
  // the cancellation's, and "sent back twice" is still the thing that explains
  // where the three weeks went.
  const r = row({ lastRevisionAction: "cancelled", lastRevisionReason: "ไม่ต้องใช้เงินแล้ว", returnCount: 2 });
  assert.equal(revisionReasonText(r), "ยกเลิก: ไม่ต้องใช้เงินแล้ว (ส่งกลับ 2 ครั้ง)");
});

test("an action nobody anticipated is shown raw rather than swallowed", () => {
  const r = row({ lastRevisionAction: "withdrawn", lastRevisionReason: "เหตุผล" });
  assert.equal(revisionReasonText(r), "withdrawn: เหตุผล");
});
