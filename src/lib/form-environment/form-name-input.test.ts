import { test } from "node:test";
import assert from "node:assert/strict";
import { FORM_NAME_MAX, parseFormNames } from "./form-name-input";

/**
 * What a form may be renamed to.
 *
 * `AccFormMaster.FormNameTh` / `FormNameEn` are both `nvarchar(200) NOT NULL`
 * and nothing in this application wrote either until 2026-09-24 — they came
 * with the seed and moved only by hand-written SQL.
 */

test("both names are required, and a blank one is refused rather than stored", () => {
  /* The column is NOT NULL, and an empty English name is not a tidy empty
     state: `formNameEn` feeds the ฟอร์ม filter, which would read "ชื่อไทย ()". */
  for (const input of [
    { nameTh: "", nameEn: "Travel" },
    { nameTh: "   ", nameEn: "Travel" },
    { nameTh: "เบิกค่าเดินทาง", nameEn: "" },
    { nameTh: "เบิกค่าเดินทาง", nameEn: "  " },
    {},
    { nameTh: 5, nameEn: null },
  ]) {
    const r = parseFormNames(input);
    assert.equal(r.ok, false, `${JSON.stringify(input)} should be refused`);
  }
});

test("names are trimmed, so a stray space cannot become part of the name", () => {
  const r = parseFormNames({ nameTh: "  เบิกค่าเดินทาง  ", nameEn: "  Travel Expense " });
  assert.deepEqual(r, { ok: true, nameTh: "เบิกค่าเดินทาง", nameEn: "Travel Expense" });
});

test("over-long is REFUSED, never truncated", () => {
  /* A name cut at 200 characters is a name nobody chose, and the driver's own
     error is untranslated. Both halves are checked: one long name must not be
     hidden by the other being fine. */
  const long = "ก".repeat(FORM_NAME_MAX + 1);
  const okName = "Travel";
  assert.equal(parseFormNames({ nameTh: long, nameEn: okName }).ok, false);
  assert.equal(parseFormNames({ nameTh: "ชื่อไทย", nameEn: "e".repeat(FORM_NAME_MAX + 1) }).ok, false);
  // Exactly at the bound is fine — it is the column's own width.
  assert.equal(
    parseFormNames({ nameTh: "ก".repeat(FORM_NAME_MAX), nameEn: "e".repeat(FORM_NAME_MAX) }).ok,
    true,
  );
});

test("every refusal says which field, in Thai", () => {
  const th = parseFormNames({ nameTh: "", nameEn: "x" });
  const en = parseFormNames({ nameTh: "x", nameEn: "" });
  assert.equal(th.ok, false);
  assert.equal(en.ok, false);
  if (!th.ok && !en.ok) {
    assert.match(th.error, /ไทย/);
    assert.match(en.error, /อังกฤษ/);
    assert.notEqual(th.error, en.error, "a reader must be able to tell which box is wrong");
  }
});
