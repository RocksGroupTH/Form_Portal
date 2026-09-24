import { test } from "node:test";
import assert from "node:assert/strict";
import { ACC_FORM_NAME_TH, formFilterLabel } from "@/lib/acc/form-names";
import { REQUEST_CARDS } from "@/lib/constants";
import { formNameEn } from "@/lib/form-names";

/**
 * The form filter's fallback name.
 *
 * Reported 2026-09-24: AP-2 and AP-3 showed as bare codes in the dropdown while
 * AP-1, AP-4 and AP-17 showed names. The cause was not missing data —
 * `AccFormMaster` carries a Thai name for all seven codes in both form
 * databases — but that the label came from a ROW, and the filter lists every
 * form the viewer could file, including ones they never have.
 */

test("the label is ชื่อไทย (English), with no form code", () => {
  /* The user's wording, 2026-09-24. The short Thai name is the vocabulary
     Home teaches, which is where most people meet a form first. */
  assert.equal(formFilterLabel("AP-2"), "เบิกเงินทดรองจ่าย (Advance)");
  assert.equal(formFilterLabel("AP-1"), "เบิกค่าเดินทาง (Travel Expense Reimbursement)");
  assert.equal(formFilterLabel("AP-17"), "จองที่พัก/ตั๋วโดยสาร (Travel Booking)");
});

test("the canonical name is now the FALLBACK, not the winner", () => {
  /* Inverted deliberately. `AccFormMaster.FormNameTh` is the long, form-ish
     name and already carries its own parenthesis, so appending an English one
     to it produces two brackets in a row — which is why the short map leads
     now. A code this map knows ignores `preferred` entirely. */
  assert.equal(
    formFilterLabel("AP-2", "แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)"),
    "เบิกเงินทดรองจ่าย (Advance)",
  );
});

test("a blank preferred name changes nothing for a code the map knows", () => {
  assert.equal(formFilterLabel("AP-2", null), "เบิกเงินทดรองจ่าย (Advance)");
  assert.equal(formFilterLabel("AP-2", "   "), "เบิกเงินทดรองจ่าย (Advance)");
});

test("a code the map does not know still shows its row name", () => {
  /* AP-11 and AP-15 are registered in AccFormMaster and have no card, so they
     reach the fallback — which is the case it was added for. No English name
     exists for them either, so the label is the Thai one alone rather than a
     trailing empty bracket. */
  assert.equal(formFilterLabel("AP-11", "แลกของรางวัล"), "แลกของรางวัล");
});

test("a code nothing names renders as ITSELF, never as empty", () => {
  /* An empty label would be an unselectable filter row, which silently
     excludes those rows from every filtered view. */
  assert.equal(formFilterLabel("AP-11"), "AP-11");
  assert.equal(formFilterLabel("AP-11", "   "), "AP-11");
});

test("every named form has an English name too, or the bracket would be empty", () => {
  /* The label appends `(en)` only when there is one, so a missing English
     name degrades rather than printing `ชื่อ ()`. This pins that the two
     tables actually cover the same five codes, which is the state the label
     was designed against. */
  for (const code of Object.keys(ACC_FORM_NAME_TH)) {
    assert.ok(formNameEn(code), `${code} has a Thai name here and no English one`);
    assert.ok(formFilterLabel(code).endsWith(`(${formNameEn(code)})`), code);
  }
});

test("every form with a card that this map claims to name, it names", () => {
  /* The failure this catches is a new form shipping with a card and no entry
     here — which is exactly how AP-2 and AP-3 came to sit unnamed. It asserts
     the map is a SUBSET of the badges rather than a superset: a name for a code
     no card offers is dead, and a card whose code is absent is the defect. */
  const badges = new Set(
    REQUEST_CARDS.map((c) => c.badge).filter((b): b is string => !!b),
  );
  for (const code of Object.keys(ACC_FORM_NAME_TH)) {
    assert.ok(badges.has(code), `${code} is named here but no card offers it`);
  }
});

test("the five forms a requester can file are all named", () => {
  /* Pinned explicitly rather than derived, because deriving it from the cards
     is what the test above does — and a list that derives its own expectation
     from the thing it checks proves nothing. */
  for (const code of ["AP-1", "AP-2", "AP-3", "AP-4", "AP-17"]) {
    assert.ok(ACC_FORM_NAME_TH[code], `${code} has no fallback name`);
    assert.notEqual(formFilterLabel(code), code, `${code} still renders as a bare code`);
    assert.ok(!formFilterLabel(code).includes(code), `${code} still prints its own form code`);
  }
});
