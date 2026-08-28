import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClearAdvanceJournalPayload, type ClrJournalInput } from "./clear-advance-erp-payload";

const cfg = {
  advanceVendorNo: "ADV0001", bankAccountNo: "BBL-CA6332",
  vatInputGlAccountNo: "115030", whtPayableGlAccountNo: "213050",
  journalBatchName: "PPAP",
};
const base = (over: Partial<ClrJournalInput>): ClrJournalInput => ({
  requestNo: "ADC26-09005", postingDate: "2026-08-20", advanceAmount: 2000,
  departmentCode: "DEPT01", config: cfg,
  items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" }],
  ...over,
});
const sum = (p: { lines: { amount: number }[] }) => Math.round(p.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

test("refund=0, no VAT/WHT -> 2 balanced lines", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  assert.equal(p.journalBatchName, "PPAP");
  assert.equal(p.lines.length, 2);
  assert.equal(sum(p), 0);
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.amount, 2000);
  const adv = p.lines.find((l) => l.accountType === "Vendor")!;
  assert.equal(adv.accountNo, "ADV0001");
  assert.equal(adv.amount, -2000);
  assert.equal(exp.documentType, "Payment");
  assert.equal(exp.employeeCode, "ADC26-09005");
});

test("refund>0 -> Dr Bank for the returned amount", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  assert.equal(sum(p), 0);
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, 500);
});

test("pay-extra -> Cr Bank for the excess", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  assert.equal(sum(p), 0);
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, -500);
});

test("VAT + WHT -> aggregate lines, still balanced", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 1000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.equal(sum(p), 0);
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.amount, 70);
  assert.equal(p.lines.find((l) => l.accountNo === "213050")!.amount, -30);
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, -40);
});

test("VAT present but no VAT account configured -> throws", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    config: { ...cfg, vatInputGlAccountNo: null },
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: null }],
  })), /VAT/);
});

test("advance reversal credits the Vendor with no balAccountType", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  const adv = p.lines.find((l) => l.accountType === "Vendor")!;
  assert.equal(adv.accountNo, "ADV0001");
  assert.equal(adv.amount, -2000);
  // AP-2's proven BC shape: two explicit lines, no bal account on the vendor line.
  assert.equal(adv.balAccountType, undefined);
  assert.equal(adv.documentType, "Payment");
  assert.equal(adv.employeeCode, "ADC26-09005");
});

test("exactly one Vendor line, and no G/L line carries the advance amount", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 1000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.equal(p.lines.filter((l) => l.accountType === "Vendor").length, 1);
  assert.equal(sum(p), 0);
});

test("no vendor on the cleared advance -> throws", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    config: { ...cfg, advanceVendorNo: "" },
  })), /Vendor/);
});
