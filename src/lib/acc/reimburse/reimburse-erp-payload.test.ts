import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReimburseJournalPayload, type ReimburseJournalInput } from "./reimburse-erp-payload";

const CONFIG = {
  bankAccountNo: "K-CA6999",
  vatInputGlAccountNo: "115020001",
  whtPayableGlAccountNo: "213040001",
  journalBatchName: "Q",
};

const base = (over: Partial<ReimburseJournalInput> = {}): ReimburseJournalInput => ({
  requestNo: "RBM26-00042",
  postingDate: "2026-10-02",
  departmentCode: "OPS",
  defaultBranchCode: "HQ01",
  requesterName: "สมชาย ใจดี",
  staffId: 12345,
  config: CONFIG,
  items: [
    {
      glAccountNo: "510001010",
      amountBeforeVat: 100,
      vatAmount: 7,
      whtAmount: 0,
      branchCode: "HQ01",
      description: "ค่าวัตถุดิบ",
      docNo: "INV-1",
      taxId: "0105566077543",
      payeeName: "บริษัท ข้าว โซ อิ กรุ๊ป จำกัด",
      taxBranchCode: "00000",
      taxVendorNo: "V0001",
      expenseDate: "2026-10-01",
    },
  ],
  ...over,
});

const sum = (nums: number[]) => Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;

/* ── the shape of one claim ── */

test("expense, VAT, and bank — in that order, with the VAT line beside its own expense", () => {
  const p = buildReimburseJournalPayload(base());
  assert.equal(p.journalBatchName, "Q");
  assert.deepEqual(
    p.lines.map((l) => [l.accountNo, l.amount]),
    [
      ["510001010", 100],
      ["115020001", 7],
      ["K-CA6999", -107],
    ],
  );
});

test("the lines sum to zero", () => {
  // AP-3's deliberately do NOT: its WHT and advance-vendor lines carry 0 for
  // accounting to clear by hand. AP-4 has nothing to clear, so a non-zero sum
  // here is a missing or a doubled line.
  const p = buildReimburseJournalPayload(
    base({
      items: [
        { glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 7, whtAmount: 3, branchCode: "HQ01" },
        { glAccountNo: "5200", amountBeforeVat: 50, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" },
      ],
    }),
  );
  assert.equal(sum(p.lines.map((l) => l.amount)), 0);
});

test("money always leaves the company, so every line is a Payment", () => {
  // AP-3 chooses between Refund and Payment from the sign of its bank
  // difference, because an advance can come back. A reimbursement cannot.
  const p = buildReimburseJournalPayload(base());
  assert.ok(p.lines.every((l) => l.documentType === "Payment"));
});

test("the bank is credited the net actually paid, after withholding", () => {
  const p = buildReimburseJournalPayload(
    base({
      items: [
        { glAccountNo: "5100", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" },
      ],
    }),
  );
  const bank = p.lines.find((l) => l.accountNo === "K-CA6999");
  assert.equal(bank?.amount, -1040);
});

/* ── withholding ── */

test("withholding is one credit at the brand's WHT-payable account, carrying the real amount", () => {
  // AP-3 posts a VENDOR line at WHT-PND.3/53 for ZERO and refuses to build at
  // all without a ภ.ง.ด. type. AP-4 collects no ภ.ง.ด. type and has no payee
  // list, so copying that would make every claim with withholding unsendable.
  const p = buildReimburseJournalPayload(
    base({
      items: [
        { glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 3, branchCode: "HQ01" },
        { glAccountNo: "5200", amountBeforeVat: 200, vatAmount: 0, whtAmount: 6, branchCode: "HQ01" },
      ],
    }),
  );
  const wht = p.lines.filter((l) => l.accountNo === "213040001");
  assert.equal(wht.length, 1, "one line for the whole claim, not one per item");
  assert.equal(wht[0].amount, -9);
  assert.equal(wht[0].accountType, "G/L Account");
});

test("no withholding, no line", () => {
  const p = buildReimburseJournalPayload(base());
  assert.equal(p.lines.some((l) => l.accountNo === "213040001"), false);
});

test("withholding with no account configured is refused rather than dropped", () => {
  assert.throws(
    () =>
      buildReimburseJournalPayload(
        base({
          config: { ...CONFIG, whtPayableGlAccountNo: null },
          items: [{ glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 3, branchCode: null }],
        }),
      ),
    /หัก ณ ที่จ่าย/,
  );
});

/* ── the VAT line ── */

test("one VAT line per invoice, carrying that invoice's own keys", () => {
  const p = buildReimburseJournalPayload(base());
  const vat = p.lines.find((l) => l.accountNo === "115020001")!;
  assert.equal(vat.taxInvoiceNo, "INV-1");
  assert.equal(vat.taxInvoiceDate, "2026-10-01");
  assert.equal(vat.taxInvoiceBase, 100, "the base is what VAT was charged on, not the VAT");
  assert.equal(vat.taxInvoiceName, "บริษัท ข้าว โซ อิ กรุ๊ป จำกัด");
  assert.equal(vat.taxVatRegistrationNo, "0105566077543");
  assert.equal(vat.taxBranchCode, "00000");
  assert.equal(vat.taxVendorNo, "V0001");
  assert.equal(vat.genPostingType, "Purchase");
});

test("an unknown seller key is omitted, never blanked", () => {
  // The codeunit applies each key only when non-blank, so an absent key leaves
  // BC's field alone. Sending "" would overwrite what the vendor card holds.
  const p = buildReimburseJournalPayload(
    base({
      items: [
        { glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 7, whtAmount: 0, branchCode: "HQ01" },
      ],
    }),
  );
  const vat = p.lines.find((l) => l.accountNo === "115020001")!;
  assert.equal("taxVendorNo" in vat, false);
  assert.equal("taxInvoiceName" in vat, false);
  assert.equal("taxBranchCode" in vat, false);
});

test("VAT with no input account configured is refused", () => {
  assert.throws(
    () => buildReimburseJournalPayload(base({ config: { ...CONFIG, vatInputGlAccountNo: null } })),
    /ภาษีซื้อ/,
  );
});

/* ── where an expense lands ── */

test("a branch rule beats a BU rule, and both beat the coded account", () => {
  // Branch first because it names one shop where the BU names a kind of shop,
  // and because some branches have no BU at all.
  const withBranch = buildReimburseJournalPayload(
    base({
      branchGlAccounts: { CKK2: "999" },
      buGlAccounts: { FRAN: "888" },
      branchBu: new Map([["CKK2", { buCode: "FRAN", isBlocked: false }]]),
      items: [{ glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 0, branchCode: "CKK2" }],
    }),
  );
  assert.equal(withBranch.lines[0].accountNo, "999");

  const withBu = buildReimburseJournalPayload(
    base({
      buGlAccounts: { FRAN: "888" },
      branchBu: new Map([["CKK2", { buCode: "FRAN", isBlocked: false }]]),
      items: [{ glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 0, branchCode: "CKK2" }],
    }),
  );
  assert.equal(withBu.lines[0].accountNo, "888");

  const plain = buildReimburseJournalPayload(
    base({ items: [{ glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 0, branchCode: "CKK2" }] }),
  );
  assert.equal(plain.lines[0].accountNo, "5100");
});

test("the redirect applies to the expense line and to nothing else", () => {
  // Redirecting VAT, withholding or cash by BU would move input tax and the
  // bank into a receivable.
  const p = buildReimburseJournalPayload(
    base({
      buGlAccounts: { FRAN: "888" },
      branchBu: new Map([["HQ01", { buCode: "FRAN", isBlocked: false }]]),
      items: [{ glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 7, whtAmount: 3, branchCode: "HQ01" }],
    }),
  );
  assert.deepEqual(
    p.lines.map((l) => l.accountNo),
    ["888", "115020001", "213040001", "K-CA6999"],
  );
});

test("the BU travels on every line, from that line's own branch", () => {
  const p = buildReimburseJournalPayload(
    base({
      branchBu: new Map([["HQ01", { buCode: "COMPANY", isBlocked: false }]]),
    }),
  );
  assert.ok(p.lines.every((l) => l.buCode === "COMPANY"));
});

test("a branch with no Location sends no BU at all, rather than a blank one", () => {
  // Absence is what makes the codeunit apply its own COCO; an empty string
  // would be indistinguishable from a real answer.
  const p = buildReimburseJournalPayload(base({ branchBu: new Map() }));
  assert.ok(p.lines.every((l) => !("buCode" in l)));
});

test("the branch lookup is matched case-insensitively", () => {
  // The branch comes from a picker and the map from BC; a case mismatch would
  // silently land every line back on COCO.
  const p = buildReimburseJournalPayload(
    base({ branchBu: new Map([["HQ01", { buCode: "COMPANY", isBlocked: false }]]) , items: [
      { glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 0, branchCode: "hq01" },
    ] }),
  );
  assert.equal(p.lines[0].buCode, "COMPANY");
});

/* ── the rest of the line ── */

test("a receipt from an earlier accounting month is marked as an adjustment", () => {
  const p = buildReimburseJournalPayload(
    base({
      postingDate: "2026-10-02",
      items: [
        { glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 7, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-09-28" },
      ],
    }),
  );
  assert.equal(p.lines[0].adjCode, "M-ADJ");
  assert.equal(p.lines[1].adjCode, "M-ADJ", "the VAT on a prior-period receipt is part of the same adjustment");
});

test("a receipt from the posting month carries no marker", () => {
  const p = buildReimburseJournalPayload(base());
  assert.equal("adjCode" in p.lines[0], false);
});

test("External Document No. is the requester's staff id, not the request number", () => {
  // The interface layout's row 25 asks for รหัสพนักงาน. AP-3 carried its request
  // number here and it read as done until somebody looked at the value.
  const p = buildReimburseJournalPayload(base());
  assert.ok(p.lines.every((l) => l.employeeCode === "12345"));
});

test("no staff id sends the field empty rather than substituting something else", () => {
  const p = buildReimburseJournalPayload(base({ staffId: null }));
  assert.ok(p.lines.every((l) => l.employeeCode === ""));
});

test("the description names the claim and the person, and is cut to what BC accepts", () => {
  const p = buildReimburseJournalPayload(
    base({ items: [{ glAccountNo: "5100", amountBeforeVat: 1, vatAmount: 0, whtAmount: 0, branchCode: null, description: "ก".repeat(300) }] }),
  );
  assert.ok(p.lines[0].description.startsWith("RBM26-00042"));
  assert.ok(p.lines[0].description.includes("สมชาย ใจดี"));
  assert.equal(p.lines[0].description.length, 100);
});

test("a line with no branch of its own falls back to the claim's", () => {
  const p = buildReimburseJournalPayload(
    base({ items: [{ glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 0, branchCode: null }] }),
  );
  assert.equal(p.lines[0].branchCode, "HQ01");
});

/* ── refusals ── */

test("no batch, no bank and no lines are each refused by name", () => {
  assert.throws(() => buildReimburseJournalPayload(base({ config: { ...CONFIG, journalBatchName: "" } })), /Journal Batch/);
  assert.throws(() => buildReimburseJournalPayload(base({ config: { ...CONFIG, bankAccountNo: "" } })), /Bank Account/);
  assert.throws(() => buildReimburseJournalPayload(base({ items: [] })), /รายการ/);
});

test("a claim that nets to nothing is refused rather than sent as an empty payment", () => {
  // Every line withheld in full: there is no payment to make, and a bank line
  // of 0 posts a document that moves no money.
  assert.throws(
    () =>
      buildReimburseJournalPayload(
        base({ items: [{ glAccountNo: "5100", amountBeforeVat: 100, vatAmount: 0, whtAmount: 100, branchCode: null }] }),
      ),
    /ยอดจ่ายสุทธิ/,
  );
});
