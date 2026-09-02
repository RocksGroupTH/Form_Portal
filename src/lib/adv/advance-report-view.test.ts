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
    ...overrides,
  };
}

test("DEFAULT_VISIBLE_KEYS has exactly the 11 columns the design specifies", () => {
  assert.equal(DEFAULT_VISIBLE_KEYS.length, 11);
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

test("isAwaitingApproval / isAwaitingErp partition the Submitted rows", () => {
  const atManager = row({ overallStatus: STATUS_INPROCESS, pendingOn: "Head Accounting" });
  const atOfficer = row({ overallStatus: STATUS_INPROCESS, pendingOn: "Accounting Officer" });
  assert.equal(isAwaitingApproval(atManager), true);
  assert.equal(isAwaitingErp(atManager), false);
  assert.equal(isAwaitingApproval(atOfficer), false);
  assert.equal(isAwaitingErp(atOfficer), true);
});

test("computeTileCounts matches a known small dataset", () => {
  const rows: Row[] = [
    row({ id: 1, overallStatus: STATUS_INPROCESS, pendingOn: "Head Accounting" }),
    row({ id: 2, overallStatus: STATUS_INPROCESS, pendingOn: "ผู้บริหาร" }),
    row({ id: 3, overallStatus: STATUS_INPROCESS, pendingOn: "Accounting Officer" }),
    row({ id: 4, overallStatus: STATUS_APPROVED, advanceStatus: null, expectedClearDate: "2026-01-01" }), // overdue
    row({ id: 5, overallStatus: STATUS_APPROVED, advanceStatus: CLEAR_STATUS_CLEARED, expectedClearDate: "2026-01-01" }), // cleared, not overdue
    row({ id: 6, overallStatus: "ไม่อนุมัติ (Rejected)" }),
  ];
  const counts = computeTileCounts(rows, "2026-06-01");
  assert.deepEqual(counts, { awaitingApproval: 2, awaitingErp: 1, overdue: 1 });
});

test("totalAmountThb sums baseAmount over exactly the rows passed in", () => {
  const rows: Row[] = [row({ baseAmount: 1000 }), row({ baseAmount: 2500.5 }), row({ baseAmount: null })];
  assert.equal(totalAmountThb(rows), 3500.5);
});
