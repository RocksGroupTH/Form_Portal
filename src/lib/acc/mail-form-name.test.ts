import { test } from "node:test";
import assert from "node:assert/strict";
import { mailFormName } from "./mail-form-name";
import { MAIL_FORM_NAMES } from "./mail-copy";

/**
 * `mailFormName` is the pure formatter behind the mail header's form name
 * (`mail-form-name-lookup.ts` is the pool-reaching half that feeds it). Every
 * case here is one `mail-form-name-lookup.ts` cannot exercise without a live
 * database, which is the point of splitting the two.
 *
 * **The append-only-when-missing rule (2026-09-26)**: the first cut appended
 * `(English)` unconditionally, which put a second English name in parentheses
 * onto a Thai name that already carried one — see `mail-form-name.ts`'s own
 * header for AP-2's exact case. These tests pin the corrected rule.
 */

test("canonical present, Thai has no English segment — appends", () => {
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

test("Thai name already carrying an ASCII letter suppresses the append — AP-2's exact shape", () => {
  // AP-2's real, seeded pair: the Thai already reads "…(Advance)"; the English
  // column is the different, fuller string "Advance Request Form" — a
  // substring test would find no match and still append, reproducing the bug
  // this rule exists to fix.
  assert.equal(
    mailFormName("AP-2", {
      nameTh: "แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)",
      nameEn: "Advance Request Form",
    }),
    "แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)",
  );
});

test("an ASCII letter anywhere in the Thai name suppresses the append, not only inside brackets", () => {
  assert.equal(
    mailFormName("AP-1", { nameTh: "แบบฟอร์มABCทดสอบ", nameEn: "Test Form" }),
    "แบบฟอร์มABCทดสอบ",
  );
  // A single stray Latin letter, no brackets at all.
  assert.equal(
    mailFormName("AP-1", { nameTh: "ฟอร์มxทดสอบ", nameEn: "Test Form" }),
    "ฟอร์มxทดสอบ",
  );
});

test("digits and punctuation in the Thai name do NOT count as carrying English", () => {
  assert.equal(
    mailFormName("AP-1", { nameTh: "ฟอร์ม 2024", nameEn: "Test Form" }),
    "ฟอร์ม 2024 (Test Form)",
  );
});

test("a Thai name with an ASCII letter suppresses the append even with no English name at all", () => {
  assert.equal(
    mailFormName("AP-4", { nameTh: "ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)", nameEn: "" }),
    "ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)",
  );
});

test("a missing English name never appends regardless — falls back when Thai has no English of its own", () => {
  assert.equal(
    mailFormName("AP-4", { nameTh: "ขอเบิกเงินคืนพนักงาน", nameEn: "" }),
    MAIL_FORM_NAMES["AP-4"],
  );
  assert.equal(
    mailFormName("AP-4", { nameTh: "ขอเบิกเงินคืนพนักงาน", nameEn: "   " }),
    MAIL_FORM_NAMES["AP-4"],
  );
});

test("Thai name blank falls back regardless of English", () => {
  assert.equal(
    mailFormName("AP-4", { nameTh: "  ", nameEn: "Staff Reimbursement" }),
    MAIL_FORM_NAMES["AP-4"],
  );
});

test("code unknown, canonical missing — the bare code is what is left to print", () => {
  assert.equal(mailFormName("AP-99", null), "AP-99");
});

test("code unknown, canonical present with no English segment — the pair still formats", () => {
  assert.equal(
    mailFormName("AP-99", { nameTh: "แบบฟอร์มทดสอบ", nameEn: "Test Form" }),
    "แบบฟอร์มทดสอบ (Test Form)",
  );
});

test("code unknown, Thai already has an English segment — no append, no fallback needed", () => {
  assert.equal(
    mailFormName("AP-99", { nameTh: "แบบฟอร์มทดสอบ (Test)", nameEn: "Test Form" }),
    "แบบฟอร์มทดสอบ (Test)",
  );
});

test("every real form code still resolves through the fallback when canonical is missing, all five", () => {
  for (const code of Object.keys(MAIL_FORM_NAMES)) {
    assert.equal(mailFormName(code, null), MAIL_FORM_NAMES[code as keyof typeof MAIL_FORM_NAMES]);
  }
});

test("the five forms' seeded AccFormMaster pairs render exactly as the user ruled", () => {
  const seeds: Record<string, { nameTh: string; nameEn: string }> = {
    "AP-1": {
      nameTh: "แบบฟอร์มเบิกค่าเดินทาง (ออฟฟิต)",
      nameEn: "Travel Expense Reimbursement Form (Office)",
    },
    "AP-2": {
      nameTh: "แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)",
      nameEn: "Advance Request Form",
    },
    "AP-3": {
      nameTh: "แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (Clear Advance)",
      nameEn: "Clear Advance Form",
    },
    "AP-4": {
      nameTh: "ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)",
      nameEn: "Staff Reimbursement",
    },
    "AP-17": {
      nameTh: "แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (ทำงานต่างจังหวัด)",
      nameEn: "Accommodation/Ticket Booking Request Form (for working out of town)",
    },
  };
  assert.equal(mailFormName("AP-1", seeds["AP-1"]), "แบบฟอร์มเบิกค่าเดินทาง (ออฟฟิต) (Travel Expense Reimbursement Form (Office))");
  assert.equal(mailFormName("AP-2", seeds["AP-2"]), "แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)");
  assert.equal(mailFormName("AP-3", seeds["AP-3"]), "แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (Clear Advance)");
  assert.equal(mailFormName("AP-4", seeds["AP-4"]), "ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)");
  assert.equal(
    mailFormName("AP-17", seeds["AP-17"]),
    "แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (ทำงานต่างจังหวัด) (Accommodation/Ticket Booking Request Form (for working out of town))",
  );
});
