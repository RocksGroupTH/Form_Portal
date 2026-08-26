import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAdvanceJournalPayload } from "./advance-erp-payload";
import type { AdvanceRequest, AdvanceDetail } from "@/features/advance/types";

const cfg = { glAccountNo: "115010", bankAccountNo: "101010", journalBatchName: "PAY", branchCode: "BR1" } as never;
const req = { requestNo: "ADV26-00001", paymentDate: "2026-08-28", requesterFullName: "Somchai" } as unknown as AdvanceRequest;
const baseAdv = { amount: 1000, baseAmount: 1000, purpose: "x", payeeName: "ACME",
  matchedVendorNo: "V1", matchedVendorName: "ACME", vendorMatchStatus: "confirmed" } as unknown as AdvanceDetail;

test("Dr line posts to the matched Vendor, Cr to Bank", () => {
  const p = buildAdvanceJournalPayload(req, baseAdv, cfg, "DEPT1");
  const dr = p.lines[0];
  assert.equal(dr.accountType, "Vendor");
  assert.equal(dr.accountNo, "V1");
  assert.equal(dr.amount, 1000);
  assert.equal(dr.balAccountType, undefined);   // two explicit lines; no bal on Dr
  const cr = p.lines[1];
  assert.equal(cr.accountType, "Bank Account");
  assert.equal(cr.amount, -1000);
});

test("build refuses when no vendor is confirmed", () => {
  const noVendor = { ...baseAdv, matchedVendorNo: null } as unknown as AdvanceDetail;
  assert.throws(() => buildAdvanceJournalPayload(req, noVendor, cfg, "DEPT1"), /Vendor/);
});
