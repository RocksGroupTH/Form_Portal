import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClearAdvanceJournalPayload, isPriorPeriod, type ClrJournalInput } from "./clear-advance-erp-payload";

const cfg = {
  advanceVendorNo: "ADV0001", bankAccountNo: "BBL-CA6332",
  vatInputGlAccountNo: "115030", whtPayableGlAccountNo: "213050",
  journalBatchName: "PPAP",
};
const base = (over: Partial<ClrJournalInput>): ClrJournalInput => ({
  requestNo: "ADC26-09005", staffId: 10177, postingDate: "2026-08-20", advanceAmount: 2000,
  departmentCode: "DEPT01", config: cfg,
  items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" }],
  ...over,
});
const sum = (p: { lines: { amount: number }[] }) => Math.round(p.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

test("refund=0, no VAT/WHT -> expense + zeroed vendor line", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  assert.equal(p.journalBatchName, "PPAP");
  assert.equal(p.lines.length, 2);
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.amount, 2000);
  const adv = p.lines.find((l) => l.accountType === "Vendor")!;
  assert.equal(adv.accountNo, "ADV0001");
  // Spec §3.2: the vendor line is present but always 0 — accounting clears it by hand.
  assert.equal(adv.amount, 0);
  // Unbalanced by exactly the zeroed advance.
  assert.equal(sum(p), 2000);
  // → BC External Document No.: the staff id, not the request no. (§5.2).
  assert.equal(exp.employeeCode, "10177");
});

test("refund>0 -> Dr Bank for the returned amount", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, 500);
});

test("pay-extra -> Cr Bank for the excess", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, -500);
});

test("VAT + WHT -> both lines emitted, WHT at 0", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 1000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.amount, 70);
  // WHT line present, zeroed.
  assert.equal(p.lines.find((l) => l.accountNo === "213050")!.amount, 0);
  assert.equal(p.lines.find((l) => l.accountType === "Vendor")!.amount, 0);
  // The bank difference is real cash and still nets VAT and WHT.
  assert.equal(p.lines.find((l) => l.accountType === "Bank Account")!.amount, -40);
});

test("VAT present but no VAT account configured -> throws", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    config: { ...cfg, vatInputGlAccountNo: null },
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: null }],
  })), /VAT/);
});

test("the clear-advance line points at the Vendor with no balAccountType", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  const adv = p.lines.find((l) => l.accountType === "Vendor")!;
  assert.equal(adv.accountNo, "ADV0001");
  assert.equal(adv.amount, 0);
  // AP-2's proven BC shape: two explicit lines, no bal account on the vendor line.
  assert.equal(adv.balAccountType, undefined);
  assert.equal(adv.employeeCode, "10177");
});

test("exactly one Vendor line, and no G/L line carries the advance amount", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 1000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.equal(p.lines.filter((l) => l.accountType === "Vendor").length, 1);
  // Unbalanced by the zeroed WHT and vendor lines: 1000 + 70 + 0 + 0 - 40.
  assert.equal(sum(p), 1030);
  assert.ok(!p.lines.some((l) => l.accountType === "G/L Account" && l.amount === -1000));
});

test("description carries the ADV no, the employee and the detail", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceRequestNo: "ADV26-00026",
    requesterName: "ภาสพงษ์ พิษณุพจน์",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", description: "ค่าแท็กซี่" }],
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.description, "ADV26-00026 เบิก เคลียร์เงินทดลอง ภาสพงษ์ พิษณุพจน์ ค่าแท็กซี่");
  assert.ok(exp.description.length <= 100);
});

test("description falls back to the AP-3 no when there is no ADV no", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.ok(exp.description.startsWith("ADC26-09005 เบิก เคลียร์เงินทดลอง"));
});

test("money returned to the company -> Refund on every line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  assert.ok(p.lines.every((l) => l.documentType === "Refund"));
});

test("company pays extra -> Payment on every line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  assert.ok(p.lines.every((l) => l.documentType === "Payment"));
});

test("spent exactly the advance -> Payment", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  assert.ok(p.lines.every((l) => l.documentType === "Payment"));
});

test("no vendor on the cleared advance -> throws", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    config: { ...cfg, advanceVendorNo: "" },
  })), /Vendor/);
});

/* ── isPriorPeriod — the Z-ADJ marker rule (spec §4.1) ────────────────────
 *
 * A receipt belonging to an earlier accounting month than the journal it lands
 * in is an adjustment, and BC wants it tagged on Z-ADJ. Months, not days: two
 * dates inside the same month are the same period however far apart they are.
 */

test("a receipt from an earlier month is a prior period", () => {
  assert.equal(isPriorPeriod("2026-07-31", "2026-08-01"), true);
});

test("same month is not a prior period, whatever the day", () => {
  assert.equal(isPriorPeriod("2026-08-01", "2026-08-31"), false);
  assert.equal(isPriorPeriod("2026-08-31", "2026-08-01"), false);
});

test("a later month is not a prior period", () => {
  assert.equal(isPriorPeriod("2026-09-01", "2026-08-31"), false);
});

test("December against January crosses the year correctly", () => {
  assert.equal(isPriorPeriod("2025-12-31", "2026-01-01"), true);
});

test("no receipt date means the rule cannot be true", () => {
  assert.equal(isPriorPeriod(null, "2026-08-01"), false);
  assert.equal(isPriorPeriod("", "2026-08-01"), false);
  assert.equal(isPriorPeriod("2026-07-01", ""), false);
});

test("an expense line from an earlier month carries the Z-ADJ marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-07-15" }],
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.adjCode, "M-ADJ");
});

test("an expense line from the posting month carries no marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-08-02" }],
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.adjCode, undefined);
});

test("an expense line with no receipt date carries no marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" }],
  }));
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.adjCode, undefined);
});

test("each expense line is judged on its own date", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    advanceAmount: 3000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-07-15" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-08-15" },
    ],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.adjCode, "M-ADJ");
  assert.equal(p.lines.find((l) => l.accountNo === "610319001")!.adjCode, undefined);
});

/* The VAT, WHT, vendor and bank lines have no document date of their own, so a
 * marker on them would be derived from someone else's receipt (spec §4.1). */
test("only expense lines are ever marked", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    advanceAmount: 5000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01", expenseDate: "2026-07-15" }],
  }));
  for (const l of p.lines) {
    const isExpense = l.accountNo === "610322005";
    assert.equal(l.adjCode, isExpense ? "M-ADJ" : undefined, `line ${l.accountType} ${l.accountNo}`);
  }
});

/* ── External Document No. (spec §5.2, sheet row 25: "รหัสพนักงาน") ──────
 *
 * The field was populated from the start, which is why this read as done until
 * someone looked at the value: ADC26-09008 reached BC with an External Document
 * No. of "ADC26-09008" rather than the requester's 10177.
 */

test("External Document No. is the requester's staff id", () => {
  const p = buildClearAdvanceJournalPayload(base({ staffId: 10177 }));
  for (const l of p.lines) assert.equal(l.employeeCode, "10177");
});

test("every line carries it, not just the expense line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    staffId: 10177,
    advanceAmount: 5000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.ok(p.lines.length >= 4, "expected expense, VAT, WHT, vendor and bank lines");
  assert.deepEqual(new Set(p.lines.map((l) => l.employeeCode)), new Set(["10177"]));
});

/* Without a staff id there is nothing true to send. The request number is not a
 * substitute — it is what made this wrong in the first place — so the field goes
 * out empty rather than carrying a value that means something else. */
test("no staff id leaves External Document No. empty", () => {
  const p = buildClearAdvanceJournalPayload(base({ staffId: null }));
  for (const l of p.lines) assert.equal(l.employeeCode, "");
});

/* ── Business Unit (spec §5.1, sheet row 8) ────────────────────────────────
 *
 * Codeunit 50263 wrote a constant COCO into the BU dimension of every AP-2 and
 * AP-3 line, because nothing here knew what a Location was bound to. Of PCTH's
 * 240 Locations only 130 are COCO.
 */

const bu = (m: Record<string, string | null>): ReadonlyMap<string, { buCode: string | null; isBlocked: boolean }> =>
  new Map(Object.entries(m).map(([k, v]) => [k, { buCode: v, isBlocked: false }]));

test("a line's BU comes from the Location its branch is bound to", () => {
  const p = buildClearAdvanceJournalPayload(base({ branchBu: bu({ HQ01: "DODO-M" }) }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.buCode, "DODO-M");
});

/* Sending nothing is what makes the codeunit fall back to COCO. An explicit
 * "COCO" would be indistinguishable from a real answer, and a branch we have no
 * Location for has no answer to give. */
test("a branch with no Location sends no buCode at all", () => {
  const p = buildClearAdvanceJournalPayload(base({ branchBu: bu({}) }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.buCode, undefined);
});

/* Same absence, different cause: the Location exists but carries no BU. */
test("a Location with no BU also sends nothing", () => {
  const p = buildClearAdvanceJournalPayload(base({ branchBu: bu({ HQ01: null }) }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.buCode, undefined);
});

/* Passing no map at all is the state before the sync has ever run, and every
 * line must serialise exactly as it did before this feature existed. */
test("no map leaves the payload as it was", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  for (const l of p.lines) assert.equal("buCode" in l, false);
});

test("each line resolves from its own branch", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 3000,
    branchBu: bu({ HQ01: "COCO", PC1057: "DODO-M" }),
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "PC1057" },
    ],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.buCode, "COCO");
  assert.equal(p.lines.find((l) => l.accountNo === "610319001")!.buCode, "DODO-M");
});

/* The branch on an expense line comes from a picker and the map from BC; a case
 * mismatch would quietly resolve to nothing and land back on COCO — the exact
 * bug this replaces. */
test("the branch matches whatever its case", () => {
  const p = buildClearAdvanceJournalPayload(base({
    branchBu: bu({ HQ01: "CTPS" }),
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: " hq01 " }],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "610322005")!.buCode, "CTPS");
});

/* VAT, WHT, vendor and bank lines have no branch of their own and fall back to
 * the request's default branch — so their BU has to follow it too, or the
 * clearing would post its expense to one BU and its bank leg to another. */
test("the lines with no branch of their own follow the default branch", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    defaultBranchCode: "PC1057",
    branchBu: bu({ HQ01: "COCO", PC1057: "DODO-M" }),
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.buCode, "DODO-M");
  assert.equal(p.lines.find((l) => l.accountType === "Vendor")!.buCode, "DODO-M");
  assert.equal(p.lines.find((l) => l.accountType === "Bank Account")!.buCode, "DODO-M");
});
