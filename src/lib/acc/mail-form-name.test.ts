import { test } from "node:test";
import assert from "node:assert/strict";
import { mailFormName } from "./mail-form-name";
import { MAIL_FORM_NAMES } from "./mail-copy";

/**
 * `mailFormName` is the pure formatter behind the mail header's form name
 * (`mail-form-name-lookup.ts` is the pool-reaching half that feeds it). Every
 * case here is one `mail-form-name-lookup.ts` cannot exercise without a live
 * database, which is the point of splitting the two.
 */

test("canonical present — ชื่อไทย (English)", () => {
  const html = mailFormName("AP-1", {
    nameTh: "แบบฟอร์มเบิกค่าเดินทาง (ออฟฟิต)",
    nameEn: "Travel Expense Reimbursement",
  });
  assert.equal(html, "แบบฟอร์มเบิกค่าเดินทาง (ออฟฟิต) (Travel Expense Reimbursement)");
});

test("canonical missing (null) falls back to the hardcoded MAIL_FORM_NAMES label", () => {
  assert.equal(mailFormName("AP-1", null), MAIL_FORM_NAMES["AP-1"]);
  assert.equal(mailFormName("AP-17", undefined), MAIL_FORM_NAMES["AP-17"]);
});

test("one name missing falls back too — a lone name reads worse than the hardcoded label", () => {
  assert.equal(
    mailFormName("AP-4", { nameTh: "แบบฟอร์มขอเบิกเงินคืนพนักงาน", nameEn: "" }),
    MAIL_FORM_NAMES["AP-4"],
  );
  assert.equal(
    mailFormName("AP-4", { nameTh: "  ", nameEn: "Staff Reimbursement" }),
    MAIL_FORM_NAMES["AP-4"],
  );
});

test("code unknown, canonical missing — the bare code is what is left to print", () => {
  assert.equal(mailFormName("AP-99", null), "AP-99");
});

test("code unknown, canonical present — the pair still formats; the code only names the fallback", () => {
  assert.equal(
    mailFormName("AP-99", { nameTh: "แบบฟอร์มทดสอบ", nameEn: "Test Form" }),
    "แบบฟอร์มทดสอบ (Test Form)",
  );
});

test("every real form code still resolves through the fallback, all five", () => {
  for (const code of Object.keys(MAIL_FORM_NAMES)) {
    assert.equal(mailFormName(code, null), MAIL_FORM_NAMES[code as keyof typeof MAIL_FORM_NAMES]);
  }
});
