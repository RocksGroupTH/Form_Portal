import { test } from "node:test";
import assert from "node:assert/strict";
import { ACC_FORM_NAME_TH, formFilterLabel } from "@/lib/acc/form-names";
import { REQUEST_CARDS } from "@/lib/constants";

/**
 * The form filter's fallback name.
 *
 * Reported 2026-09-24: AP-2 and AP-3 showed as bare codes in the dropdown while
 * AP-1, AP-4 and AP-17 showed names. The cause was not missing data —
 * `AccFormMaster` carries a Thai name for all seven codes in both form
 * databases — but that the label came from a ROW, and the filter lists every
 * form the viewer could file, including ones they never have.
 */

test("the canonical name wins; the map is only the fallback", () => {
  /* `AccFormMaster.FormNameTh` travels on every row as `formName`. Where there
     is one it must be what shows, or the dropdown would disagree with the
     ชื่อฟอร์ม column beside it in the table. */
  assert.equal(
    formFilterLabel("AP-2", "แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)"),
    "AP-2 · แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)",
  );
  assert.equal(formFilterLabel("AP-2"), "AP-2 · เบิกเงินทดรองจ่าย");
});

test("a blank preferred name falls through rather than blanking the label", () => {
  // `formName` is nullable and a row for a form with no AccFormMaster entry
  // carries null — which must not produce "AP-2 · ".
  assert.equal(formFilterLabel("AP-2", null), "AP-2 · เบิกเงินทดรองจ่าย");
  assert.equal(formFilterLabel("AP-2", "   "), "AP-2 · เบิกเงินทดรองจ่าย");
});

test("a code nothing names renders as ITSELF, never as empty", () => {
  /* AP-11 and AP-15 are registered in AccFormMaster and have no card. An empty
     label would be an unselectable filter row, which silently excludes those
     rows from every filtered view. */
  assert.equal(formFilterLabel("AP-11"), "AP-11");
  assert.equal(formFilterLabel("AP-11", "แลกของรางวัล"), "AP-11 · แลกของรางวัล");
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
  }
});
