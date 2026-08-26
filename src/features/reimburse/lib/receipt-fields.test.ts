import { test } from "node:test";
import assert from "node:assert/strict";
// Relative, not "@/": tsx does not resolve the alias for a bare test run.
import {
  sanitizeDetailLines,
  sanitizeReceiptFields,
  MAX_DETAIL_LINES,
  MAX_BRANCH_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_NO_LENGTH,
  MAX_VENDOR_ADDRESS_LENGTH,
  MAX_VENDOR_NAME_LENGTH,
} from "./receipt-fields";

const TODAY = "2026-08-25";

test("a clean answer comes through field for field", () => {
  const out = sanitizeReceiptFields(
    { expenseDate: "2026-08-20", description: "ค่าแท็กซี่ ไปสำนักงานใหญ่", amount: 428, vat: 28, withholdingTax: null },
    TODAY,
  );
  assert.deepEqual(out, {
    expenseDate: "2026-08-20",
    description: "ค่าแท็กซี่ ไปสำนักงานใหญ่",
    amount: 428,
    vat: 28,
    withholdingTax: null,
    documentNo: null,
    branchName: null,
    vendorTaxId: null,
    vendorName: null,
    vendorAddress: null,
  });
});

test("one bad field nulls only itself", () => {
  // The whole answer is not thrown away over one unreadable number — the
  // requester keeps the fields the model did get right.
  const out = sanitizeReceiptFields(
    { expenseDate: "2026-08-20", description: "ค่าอาหาร", amount: -5, vat: null, withholdingTax: null },
    TODAY,
  );
  assert.equal(out.amount, null);
  assert.equal(out.description, "ค่าอาหาร");
  assert.equal(out.expenseDate, "2026-08-20");
});

test("a 13-digit number is refused wherever it appears", () => {
  // Every Thai receipt prints a tax id, and it is the number most likely to
  // come back as the total. 13 digits is never a plausible baht amount here.
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: 1234567890123, vat: 1234567890123, withholdingTax: null },
    TODAY,
  );
  assert.equal(out.amount, null);
  assert.equal(out.vat, null);
});

test("an amount outside the plausible range is refused", () => {
  for (const bad of [0, -1, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      sanitizeReceiptFields({ expenseDate: null, description: null, amount: bad, vat: null, withholdingTax: null }, TODAY).amount,
      null,
      String(bad),
    );
  }
  assert.equal(
    sanitizeReceiptFields({ expenseDate: null, description: null, amount: 1_000_000, vat: null, withholdingTax: null }, TODAY).amount,
    1_000_000,
  );
});

test("VAT or withholding larger than the total is refused, not clamped", () => {
  // Bigger than the total means the model matched the wrong line. A clamped
  // figure would look deliberate on a form about to be submitted.
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: 100, vat: 150, withholdingTax: 999 },
    TODAY,
  );
  assert.equal(out.amount, 100);
  assert.equal(out.vat, null);
  assert.equal(out.withholdingTax, null);
});

test("VAT equal to the total is allowed, and zero is a real answer", () => {
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: 100, vat: 100, withholdingTax: 0 },
    TODAY,
  );
  assert.equal(out.vat, 100);
  assert.equal(out.withholdingTax, 0);
});

test("VAT is refused outright when the total was not read", () => {
  // With no total there is nothing to sanity-check it against, and a VAT
  // figure alone in a row with no amount helps nobody.
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: null, vat: 28, withholdingTax: 7 },
    TODAY,
  );
  assert.equal(out.vat, null);
  assert.equal(out.withholdingTax, null);
});

test("a future date is refused; today is not", () => {
  // A receipt cannot be for money not yet spent — a future date means the
  // model read an expiry or a due date.
  assert.equal(
    sanitizeReceiptFields({ expenseDate: "2026-08-26", description: null, amount: null, vat: null, withholdingTax: null }, TODAY).expenseDate,
    null,
  );
  assert.equal(
    sanitizeReceiptFields({ expenseDate: TODAY, description: null, amount: null, vat: null, withholdingTax: null }, TODAY).expenseDate,
    TODAY,
  );
});

test("a malformed or impossible date is refused", () => {
  for (const bad of ["", "25/08/2026", "2026-02-29", "not-a-date", "2569-08-25"]) {
    assert.equal(
      sanitizeReceiptFields({ expenseDate: bad, description: null, amount: null, vat: null, withholdingTax: null }, TODAY).expenseDate,
      null,
      bad,
    );
  }
});

test("the description is trimmed, and blank becomes null", () => {
  assert.equal(
    sanitizeReceiptFields({ expenseDate: null, description: "  ค่าน้ำมัน  ", amount: null, vat: null, withholdingTax: null }, TODAY).description,
    "ค่าน้ำมัน",
  );
  for (const blank of ["", "   ", "\n\t"]) {
    assert.equal(
      sanitizeReceiptFields({ expenseDate: null, description: blank, amount: null, vat: null, withholdingTax: null }, TODAY).description,
      null,
      JSON.stringify(blank),
    );
  }
});

test("an over-long description is cut to what the column takes", () => {
  // AccReimburseItem.Description is NVARCHAR(500); a longer string is a
  // failed INSERT at submit, long after the requester has stopped looking.
  const long = "ก".repeat(MAX_DESCRIPTION_LENGTH + 50);
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: long, amount: null, vat: null, withholdingTax: null },
    TODAY,
  );
  assert.equal(out.description?.length, MAX_DESCRIPTION_LENGTH);
});

test("a non-number where a number belongs is null, not NaN", () => {
  const out = sanitizeReceiptFields(
    // The route parses into this shape, but nothing stops a model from
    // answering with the wrong type through a hand-rolled client.
    { expenseDate: null, description: 42 as never, amount: "428" as never, vat: null, withholdingTax: null },
    TODAY,
  );
  assert.equal(out.amount, null);
  assert.equal(out.description, null);
});

test("everything null in gives everything null out", () => {
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null },
    TODAY,
  );
  assert.deepEqual(out, {
    expenseDate: null,
    description: null,
    amount: null,
    vat: null,
    withholdingTax: null,
    documentNo: null,
    branchName: null,
    vendorTaxId: null,
    vendorName: null,
    vendorAddress: null,
  });
});

/* ── the AP-4.1 identifying columns ── */

test("a document number and a branch come through trimmed", () => {
  const out = sanitizeReceiptFields(
    {
      expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null,
      documentNo: "  ABC1234 ", branchName: " สาขาลาดพร้าว ",
    },
    TODAY,
  );
  assert.equal(out.documentNo, "ABC1234");
  assert.equal(out.branchName, "สาขาลาดพร้าว");
});

test("blank or non-string identifiers are null, never empty strings", () => {
  const out = sanitizeReceiptFields(
    {
      expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null,
      documentNo: "   ", branchName: 42 as never,
    },
    TODAY,
  );
  assert.equal(out.documentNo, null);
  assert.equal(out.branchName, null);
});

test("an over-long document number or branch is cut to what its column takes", () => {
  const out = sanitizeReceiptFields(
    {
      expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null,
      documentNo: "A".repeat(MAX_DOCUMENT_NO_LENGTH + 20),
      branchName: "ก".repeat(MAX_BRANCH_LENGTH + 20),
    },
    TODAY,
  );
  assert.equal(out.documentNo?.length, MAX_DOCUMENT_NO_LENGTH);
  assert.equal(out.branchName?.length, MAX_BRANCH_LENGTH);
});

test("`category` is never read off a receipt", () => {
  // รายการ ("AP-4.2") is this company's own internal code. It is not printed on
  // any vendor's receipt, so a model asked for it could only invent one — and
  // an invented category on a claim is a miscategorised payment.
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null },
    TODAY,
  );
  assert.equal("category" in out, false);
});

/* ── the vendor block: เลขที่ผู้เสียภาษี · ชื่อ · ที่อยู่ ── */

test("a tax id keeps its 13 digits — the rule that guards the money columns is inverted here", () => {
  // `looksLikeTaxId` refuses 13-digit values in amount/vat/wht precisely
  // because that is what a Thai receipt prints. This field is the one place
  // the same shape is the correct answer, so it must not inherit that guard.
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null,
      vendorTaxId: "0105547161674" },
    TODAY,
  );
  assert.equal(out.vendorTaxId, "0105547161674");
});

test("separators a document prints between the groups are stripped", () => {
  for (const printed of ["0-1055-47161-67-4", "0 1055 47161 67 4", " 0105547161674 "]) {
    assert.equal(
      sanitizeReceiptFields(
        { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null, vendorTaxId: printed },
        TODAY,
      ).vendorTaxId,
      "0105547161674",
      printed,
    );
  }
});

test("anything that is not exactly 13 digits is refused", () => {
  // Not 13 digits means it is not a Thai tax id, and a wrong one on a claim is
  // worse than a blank the requester fills in.
  for (const bad of ["", "12345", "01055471616740", "010554716167X", "เลขที่ภาษี"]) {
    assert.equal(
      sanitizeReceiptFields(
        { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null, vendorTaxId: bad },
        TODAY,
      ).vendorTaxId,
      null,
      JSON.stringify(bad),
    );
  }
});

test("the vendor name and address are trimmed, capped and blank-to-null", () => {
  const out = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null,
      vendorName: "  บริษัท เดอะ 101 จำกัด  ", vendorAddress: " เลขที่ 36/3 หมู่ที่ 6 ไทรน้อย นนทบุรี 11150 " },
    TODAY,
  );
  assert.equal(out.vendorName, "บริษัท เดอะ 101 จำกัด");
  assert.equal(out.vendorAddress, "เลขที่ 36/3 หมู่ที่ 6 ไทรน้อย นนทบุรี 11150");

  const blank = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null,
      vendorName: "   ", vendorAddress: "" },
    TODAY,
  );
  assert.equal(blank.vendorName, null);
  assert.equal(blank.vendorAddress, null);

  const long = sanitizeReceiptFields(
    { expenseDate: null, description: null, amount: null, vat: null, withholdingTax: null,
      vendorName: "ก".repeat(MAX_VENDOR_NAME_LENGTH + 30),
      vendorAddress: "ข".repeat(MAX_VENDOR_ADDRESS_LENGTH + 30) },
    TODAY,
  );
  assert.equal(long.vendorName?.length, MAX_VENDOR_NAME_LENGTH);
  assert.equal(long.vendorAddress?.length, MAX_VENDOR_ADDRESS_LENGTH);
});

/* ── the lines inside one document ── */

test("each line keeps its own description, quantity, unit price and amount", () => {
  const out = sanitizeDetailLines([
    { description: "SN1 - LOGO ต้อง TOTO LIGHT BOX ขนาด 1,000 mm.", quantity: 1, unitPrice: 8000, amount: 8000 },
    { description: "SN6- กล่องไฟ Light Box (ถ้วยเฟรนช์ฟราย) 40x40 cm", quantity: 1, unitPrice: 5700, amount: 5700 },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    description: "SN1 - LOGO ต้อง TOTO LIGHT BOX ขนาด 1,000 mm.",
    quantity: 1,
    unitPrice: 8000,
    amount: 8000,
  });
});

test("a line with no description is dropped, not kept as a blank row", () => {
  // The description is the only thing that makes a line readable. A line that
  // is nothing but numbers tells a reader less than no line at all.
  const out = sanitizeDetailLines([
    { description: "  ", quantity: 1, unitPrice: 100, amount: 100 },
    { description: null, quantity: 2, unitPrice: 50, amount: 100 },
    { description: "ค่าบริการ", quantity: null, unitPrice: null, amount: 6500 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].description, "ค่าบริการ");
  assert.equal(out[0].amount, 6500);
});

test("a bad number on a line nulls only that number", () => {
  const [line] = sanitizeDetailLines([
    { description: "งานป้าย", quantity: Number.NaN, unitPrice: -5, amount: 380 },
  ]);
  assert.equal(line.quantity, null);
  assert.equal(line.unitPrice, null);
  assert.equal(line.amount, 380);
});

test("a 13-digit value is refused on a line too", () => {
  // Same reason as the row above it: the tax id is printed on the document and
  // is the number most likely to come back in place of money.
  const [line] = sanitizeDetailLines([
    { description: "งานพิมพ์", quantity: null, unitPrice: 1234567890123, amount: 500 },
  ]);
  assert.equal(line.unitPrice, null);
  assert.equal(line.amount, 500);
});

test("the list is capped, and anything that is not a list is empty", () => {
  const many = Array.from({ length: MAX_DETAIL_LINES + 20 }, (_, i) => ({
    description: "line " + i, quantity: null, unitPrice: null, amount: 1,
  }));
  assert.equal(sanitizeDetailLines(many).length, MAX_DETAIL_LINES);
  assert.deepEqual(sanitizeDetailLines(null as never), []);
  assert.deepEqual(sanitizeDetailLines(undefined), []);
  assert.deepEqual(sanitizeDetailLines("nope" as never), []);
});
