import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClearAdvanceJournalPayload,
  isPriorPeriod,
  journalDocumentType,
  type ClrJournalInput,
} from "./clear-advance-erp-payload";

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
    whtPayees: [{ pndType: "PND3" }],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.amount, 70);
  // WHT line present, zeroed — a Vendor line since spec §5.3, where it used to
  // be a G/L line at the configured WHT-payable account.
  assert.equal(p.lines.find((l) => l.accountNo === "WHT-PND.3")!.amount, 0);
  assert.equal(p.lines.find((l) => l.accountNo === "ADV0001")!.amount, 0);
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

test("exactly one advance Vendor line, and no G/L line carries the advance amount", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 1000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
    whtPayees: [{ pndType: "PND3" }],
  }));
  // The advance vendor appears once. Counted by account rather than by type:
  // since spec §5.3 the WHT line is a Vendor too, so counting Vendor lines no
  // longer answers the question this test is asking.
  assert.equal(p.lines.filter((l) => l.accountNo === "ADV0001").length, 1);
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

/* The direction of the money decides the type (user, 2026-09-09): the employee
 * returning what they did not spend is a Refund, the company paying the
 * shortfall is a Payment. The bank line's sign is the same fact stated twice. */
test("company pays extra -> Payment, with the bank line going out", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  assert.ok(p.lines.every((l) => l.documentType === "Payment"));
  assert.equal(p.lines.find((l) => l.accountType === "Bank Account")!.amount, -500);
});

/* Nothing was paid to anyone, so it is not a Payment. */
test("spent exactly the advance -> Refund", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  assert.ok(p.lines.every((l) => l.documentType === "Refund"));
});

test("the type is the sign of the bank amount, and nothing else", () => {
  assert.equal(journalDocumentType(1465.99), "Refund");
  assert.equal(journalDocumentType(0), "Refund");
  assert.equal(journalDocumentType(-0.01), "Payment");
  assert.equal(journalDocumentType(-500), "Payment");
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
/* The marker belongs to a receipt, so it reaches that receipt's expense line and
 * its VAT line — since spec §5.4 split the VAT per invoice, the VAT on a
 * prior-period receipt is part of the same adjustment. It must still not reach
 * the vendor or bank lines, which belong to the clearing rather than to any one
 * receipt. */
test("the marker reaches a receipt's own lines and no others", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-08-20",
    advanceAmount: 5000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01", expenseDate: "2026-07-15" }],
    whtPayees: [{ pndType: "PND3" }],
  }));
  for (const l of p.lines) {
    const belongsToTheReceipt = l.accountNo === "610322005" || l.accountNo === "115030";
    assert.equal(
      l.adjCode,
      belongsToTheReceipt ? "M-ADJ" : undefined,
      `line ${l.accountType} ${l.accountNo}`,
    );
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
    whtPayees: [{ pndType: "PND3" }],
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
    whtPayees: [{ pndType: "PND3" }],
  }));
  // Not the VAT line: since spec §5.4 it belongs to its own invoice and follows
  // that item's branch (HQ01 → COCO), so it is no longer one of the lines with
  // no branch of their own.
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.buCode, "COCO");
  // By account, not by type: the WHT line is a Vendor line too now, and comes
  // first, so finding "the Vendor line" would silently test the wrong one.
  assert.equal(p.lines.find((l) => l.accountNo === "ADV0001")!.buCode, "DODO-M");
  assert.equal(p.lines.find((l) => l.accountType === "Bank Account")!.buCode, "DODO-M");
});

/* ── The WHT line is a Vendor (spec §5.3, sheet rows 10-11) ────────────────
 *
 * What went before was a G/L line at the configured WHT-payable account: the
 * wrong kind of line pointing at the wrong kind of account. Accounting clears
 * these against the vendor, so the vendor is what has to be on the line.
 */

const withWht = (over: Partial<ClrJournalInput> = {}) => base({
  items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 30, branchCode: "HQ01" }],
  ...over,
});

test("WHT goes out as a Vendor line at the type's vendor", () => {
  const p = buildClearAdvanceJournalPayload(withWht({ whtPayees: [{ pndType: "PND53" }] }));
  const wht = p.lines.find((l) => l.accountNo === "WHT-PND.53")!;
  assert.equal(wht.accountType, "Vendor");
  // Spec §3.2: sent as 0 — accounting posts the real amount by hand.
  assert.equal(wht.amount, 0);
  // The old G/L account is gone from the payload entirely, not merely zeroed.
  assert.equal(p.lines.some((l) => l.accountNo === "213050"), false);
});

test("an individual payee clears against WHT-PND.3", () => {
  const p = buildClearAdvanceJournalPayload(withWht({ whtPayees: [{ pndType: "PND3" }] }));
  assert.ok(p.lines.some((l) => l.accountType === "Vendor" && l.accountNo === "WHT-PND.3"));
});

/* A vendor line carries no balAccountType — the two-explicit-lines shape BC
 * accepted for AP-2, and what the advance vendor line already uses. */
test("the WHT vendor line has no balancing account", () => {
  const p = buildClearAdvanceJournalPayload(withWht({ whtPayees: [{ pndType: "PND3" }] }));
  assert.equal(p.lines.find((l) => l.accountNo === "WHT-PND.3")!.balAccountType, undefined);
});

/* Every amount is 0, so a line's only content is which vendor account has to be
 * cleared. Two payees of one type would make two identical empty lines. */
test("two payees of one type make one line", () => {
  const p = buildClearAdvanceJournalPayload(withWht({
    whtPayees: [{ pndType: "PND3" }, { pndType: "PND3" }],
  }));
  assert.equal(p.lines.filter((l) => l.accountNo === "WHT-PND.3").length, 1);
});

test("two types make one line each", () => {
  const p = buildClearAdvanceJournalPayload(withWht({
    whtPayees: [{ pndType: "PND3" }, { pndType: "PND53" }],
  }));
  assert.equal(
    p.lines.filter((l) => l.accountType === "Vendor" && l.accountNo.startsWith("WHT-")).length,
    2,
  );
});

/* Refusing is the feature. Picking a vendor for accounting would put a guess
 * into their ledger under their name, and a 0-amount line is easy to miss. */
test("WHT with no decided type refuses the send", () => {
  assert.throws(
    () => buildClearAdvanceJournalPayload(withWht({ whtPayees: [{ pndType: null }] })),
    /ภ\.ง\.ด/,
  );
});

/* Same refusal, different cause: the amounts say withholding happened but no
 * payee row says who or of what kind. There is nothing to put on the line. */
test("WHT with no payee rows at all refuses the send", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(withWht({})), /ภ\.ง\.ด/);
});

test("no WHT at all sends no WHT line and no error", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  assert.equal(p.lines.some((l) => l.accountNo.startsWith("WHT-")), false);
});

/* The WHT vendor line has no branch of its own, so it follows the request's
 * default branch — and its BU with it, like every other footer line. */
test("the WHT vendor line follows the default branch and its BU", () => {
  const p = buildClearAdvanceJournalPayload(withWht({
    defaultBranchCode: "PCCT01",
    branchBu: new Map([["PCCT01", { buCode: "CTPS", isBlocked: false }]]),
    whtPayees: [{ pndType: "PND53" }],
  }));
  const wht = p.lines.find((l) => l.accountNo === "WHT-PND.53")!;
  assert.equal(wht.branchCode, "PCCT01");
  assert.equal(wht.buCode, "CTPS");
});

/* ── One VAT line per invoice (spec §5.4) ──────────────────────────────────
 *
 * It used to be a single G/L line carrying the sum of every item's VAT. Tax
 * Invoice No., Date, Base and Name each belong to one invoice, and a summed line
 * cannot carry them for two — so the shape has to change before the keys can go
 * on.
 */

test("two receipts with VAT make two VAT lines", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01", docNo: "INV-A" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, whtAmount: 0, branchCode: "HQ01", docNo: "INV-B" },
    ],
  }));
  const vat = p.lines.filter((l) => l.accountNo === "115030");
  assert.equal(vat.length, 2);
  assert.deepEqual(vat.map((l) => l.amount), [70, 140]);
});

test("an item with no VAT makes no VAT line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" },
    ],
  }));
  assert.equal(p.lines.filter((l) => l.accountNo === "115030").length, 1);
});

/* Each VAT line belongs to its own receipt, so it takes that line's branch —
 * and its BU with it — rather than the request's default. */
test("a VAT line follows its own item's branch and BU", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    branchBu: bu({ PCCT01: "CTPS", HQ01: "COCO" }),
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "PCCT01" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, whtAmount: 0, branchCode: "HQ01" },
    ],
  }));
  const vat = p.lines.filter((l) => l.accountNo === "115030");
  assert.deepEqual(vat.map((l) => l.branchCode), ["PCCT01", "HQ01"]);
  assert.deepEqual(vat.map((l) => l.buCode), ["CTPS", "COCO"]);
});

/* A prior-period receipt's VAT is part of that same adjustment. */
test("a VAT line inherits its item's Z-ADJ marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-09-08",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-07-15" }],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.adjCode, "M-ADJ");
});

test("the VAT total is unchanged by the split", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, whtAmount: 0, branchCode: "HQ01" },
    ],
  }));
  assert.equal(
    p.lines.filter((l) => l.accountNo === "115030").reduce((s, l) => s + l.amount, 0),
    210,
  );
});

/* Each invoice's expense and its VAT sit together, in the order the receipts
 * were entered — easier to read against the paper than every VAT line piled at
 * the end. */
test("each VAT line follows its own expense line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, whtAmount: 0, branchCode: "HQ01" },
    ],
  }));
  assert.deepEqual(
    p.lines.slice(0, 4).map((l) => l.accountNo),
    ["610322005", "115030", "610319001", "115030"],
  );
});

/* The account is still required, and still refuses before anything is built —
 * on the first invoice that carries VAT rather than once at the end. */
test("VAT with no configured input account still refuses", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    config: { ...cfg, vatInputGlAccountNo: null },
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" }],
  })), /ภาษีซื้อ/);
});

/* ── The tax block on the VAT line (spec §5.4, sheet row 8) ────────────────── */

const vatItem = (over: Record<string, unknown> = {}) => ({
  glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0,
  branchCode: "HQ01", ...over,
});

test("a VAT line carries the posting-group trio", () => {
  const p = buildClearAdvanceJournalPayload(base({ items: [vatItem()] }));
  const vat = p.lines.find((l) => l.accountNo === "115030")!;
  assert.equal(vat.genPostingType, "Purchase");
  assert.equal(vat.vatBusPostingGroup, "VATHO");
  assert.equal(vat.vatProdPostingGroup, "FVAT");
});

/* Only the VAT line (user, 2026-09-08). A posting group on an expense, vendor or
 * bank line would change how BC treats that line. */
test("no other line carries the tax block", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [vatItem({ docNo: "INV-A", taxId: "0105500000001", payeeName: "ผู้ขาย" })],
  }));
  for (const l of p.lines.filter((x) => x.accountNo !== "115030")) {
    const where = `${l.accountType} ${l.accountNo}`;
    assert.equal(l.genPostingType, undefined, where);
    assert.equal(l.vatBusPostingGroup, undefined, where);
    assert.equal(l.vatProdPostingGroup, undefined, where);
    assert.equal(l.taxInvoiceNo, undefined, where);
    assert.equal(l.taxInvoiceName, undefined, where);
  }
});

test("a VAT line carries its invoice's number, date, base and seller", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-09-08",
    items: [vatItem({
      docNo: "INV-A", expenseDate: "2026-09-02",
      taxId: "0105500000001", payeeName: "บริษัท ทดสอบ จำกัด",
    })],
  }));
  const vat = p.lines.find((l) => l.accountNo === "115030")!;
  assert.equal(vat.taxInvoiceNo, "INV-A");
  assert.equal(vat.taxInvoiceDate, "2026-09-02");
  // The base is the amount VAT was charged on, not the amount of VAT.
  assert.equal(vat.taxInvoiceBase, 1000);
  assert.equal(vat.taxInvoiceName, "บริษัท ทดสอบ จำกัด");
  assert.equal(vat.taxVatRegistrationNo, "0105500000001");
});

/* Absence stays absence, as everywhere else in this payload: a receipt whose
 * seller nobody has filled in sends no seller keys, so BC leaves those fields
 * alone instead of having them overwritten with nothing. */
test("a receipt with no seller sends no seller keys", () => {
  const p = buildClearAdvanceJournalPayload(base({ items: [vatItem({ docNo: "INV-A" })] }));
  const vat = p.lines.find((l) => l.accountNo === "115030")!;
  assert.equal("taxInvoiceName" in vat, false);
  assert.equal("taxVatRegistrationNo" in vat, false);
  // The invoice number does not depend on the seller and is still there.
  assert.equal(vat.taxInvoiceNo, "INV-A");
});

/* The tax invoice's date is the receipt's own, and differs from the journal's
 * exactly when the receipt is from another month — the case Step 1 marks. */
test("no expense date leaves the tax invoice date out", () => {
  const p = buildClearAdvanceJournalPayload(base({ items: [vatItem({ docNo: "INV-A" })] }));
  assert.equal("taxInvoiceDate" in p.lines.find((l) => l.accountNo === "115030")!, false);
});

test("two invoices each carry their own number and seller", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      vatItem({ docNo: "INV-A", payeeName: "ผู้ขาย ก" }),
      vatItem({ glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, docNo: "INV-B", payeeName: "ผู้ขาย ข" }),
    ],
  }));
  const vat = p.lines.filter((l) => l.accountNo === "115030");
  assert.deepEqual(vat.map((l) => l.taxInvoiceNo), ["INV-A", "INV-B"]);
  assert.deepEqual(vat.map((l) => l.taxInvoiceName), ["ผู้ขาย ก", "ผู้ขาย ข"]);
  assert.deepEqual(vat.map((l) => l.taxInvoiceBase), [1000, 2000]);
});

/* Tax Invoice No. is Code[35] and Tax Invoice Name Text[250] in BC. A value
 * longer than the field is truncated here rather than rejected there. */
test("values too long for their BC fields are cut, not sent whole", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [vatItem({ docNo: "X".repeat(50), payeeName: "ก".repeat(300) })],
  }));
  const vat = p.lines.find((l) => l.accountNo === "115030")!;
  assert.equal(vat.taxInvoiceNo!.length, 35);
  assert.equal(vat.taxInvoiceName!.length, 250);
});

/* The seller's branch — `Branch Code` on the VAT line, captioned Tax Branch Code
 * in the sheet. Five digits: 00000 is the head office. */
test("a VAT line carries the seller's branch when it is known", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [vatItem({ docNo: "INV-A", taxBranchCode: "00001" })],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.taxBranchCode, "00001");
});

/* Left out when unknown, so BC keeps the vendor card's own branch rather than
 * being handed a blank that would go onto a tax filing. */
test("an unknown seller branch sends no key", () => {
  const p = buildClearAdvanceJournalPayload(base({ items: [vatItem({ docNo: "INV-A" })] }));
  assert.equal("taxBranchCode" in p.lines.find((l) => l.accountNo === "115030")!, false);
});

test("no other line carries the seller's branch", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [vatItem({ docNo: "INV-A", taxBranchCode: "00001" })],
  }));
  for (const l of p.lines.filter((x) => x.accountNo !== "115030")) {
    assert.equal(l.taxBranchCode, undefined, `${l.accountType} ${l.accountNo}`);
  }
});

/* Tax Vendor No. — the seller's BC vendor, chosen by accounting. Its OnValidate
 * in the codeunit fills the name, branch and VAT registration from the card, so
 * the codeunit sets it before the explicit keys, which then win. */
test("a chosen vendor reaches the VAT line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [vatItem({ docNo: "INV-A", taxVendorNo: "VTD0030" })],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.taxVendorNo, "VTD0030");
});

/* Blank is the ordinary case: a one-off seller is not a vendor of ours, and no
 * key is sent rather than an empty one. */
test("no chosen vendor sends no key", () => {
  const p = buildClearAdvanceJournalPayload(base({ items: [vatItem({ docNo: "INV-A" })] }));
  assert.equal("taxVendorNo" in p.lines.find((l) => l.accountNo === "115030")!, false);
});

test("no other line carries the vendor key", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [vatItem({ docNo: "INV-A", taxVendorNo: "VTD0030" })],
  }));
  for (const l of p.lines.filter((x) => x.accountNo !== "115030")) {
    assert.equal(l.taxVendorNo, undefined, `${l.accountType} ${l.accountNo}`);
  }
});

/* ── BU decides the expense account (user, 2026-09-09) ── */

const buBase = (buGlAccounts: Record<string, string>, branch: string | null) =>
  base({
    branchBu: new Map([["PC1073", { buCode: "DOCO", isBlocked: false }],
                       ["PC0001", { buCode: "COCO", isBlocked: false }]]),
    buGlAccounts,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: branch }],
  });

test("a mapped BU redirects the expense line", () => {
  const p = buildClearAdvanceJournalPayload(buBase({ DOCO: "110721001" }, "PC1073"));
  assert.equal(p.lines[0].accountNo, "110721001");
});

/* COCO has no row on purpose: "บัญชีตาม คชจ" is the absence of a rule. */
test("an unmapped BU keeps the account the expense was coded to", () => {
  const p = buildClearAdvanceJournalPayload(buBase({ DOCO: "110721001" }, "PC0001"));
  assert.equal(p.lines[0].accountNo, "610322005");
});

test("no map at all changes nothing", () => {
  const p = buildClearAdvanceJournalPayload(buBase({}, "PC1073"));
  assert.equal(p.lines[0].accountNo, "610322005");
});

/* Redirecting these would move input tax and cash into a receivable. */
test("only the expense line moves — VAT, vendor and bank keep their accounts", () => {
  const p = buildClearAdvanceJournalPayload(buBase({ DOCO: "110721001" }, "PC1073"));
  assert.equal(p.lines.find((l) => l.vatProdPostingGroup)!.accountNo, "115030");
  assert.equal(p.lines.find((l) => l.accountType === "Bank Account")!.accountNo, "BBL-CA6332");
  assert.equal(p.lines.find((l) => l.accountType === "Vendor")!.accountNo, "ADV0001");
});

test("a blank mapping is not a mapping", () => {
  const p = buildClearAdvanceJournalPayload(buBase({ DOCO: "   " }, "PC1073"));
  assert.equal(p.lines[0].accountNo, "610322005");
});
