import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **The Revenue Department's address has to survive the trip to the form.**
 *
 * `RdVatRegistrant` has carried `address` since the lookup was written, and for
 * a year nothing read it: the AI-read path kept `registrantFullName(reg)` and
 * dropped the rest on the floor, so the หนังสือรับรองหัก ณ ที่จ่าย tab — which
 * needs the payee's address — had nowhere to get one.
 *
 * That is the failure this guards. It is not a bug anyone would see: the field
 * simply stays empty, which looks like the RD not knowing rather than like us
 * not asking. Both halves are one expression each, in two files, and a tidy-up
 * that "simplifies" either one puts the field back to blank in silence.
 *
 * The rule itself — blank against present, never one address against another —
 * is `registerHasAddressRowLacks`, unit-tested in `rd-vat-address.test.ts`.
 * This pins only that the wiring still reaches it.
 */

const SRC = path.join(process.cwd(), "src");

const FORM = "features/clear-advance/components/ClearAdvanceForm.tsx";
const CELL = "features/clear-advance/components/RdCell.tsx";

/** Line endings are the machine's, not the repo's -- see adc-link-guard.test.ts. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the AI read keeps the registered address, not just the name", () => {
  const src = code(FORM);
  assert.ok(
    /registeredAddress:\s*reg\.address/.test(src),
    `${FORM} no longer keeps reg.address when the registry answers. It is fetched ` +
      "either way — dropping it just means the WHT certificate has no address to show",
  );
});

test("the AI read puts that address on a row that has none", () => {
  const src = code(FORM);
  assert.ok(
    /registerHasAddressRowLacks\(\s*r\.payeeAddress/.test(src),
    `${FORM} keeps the registered address but never applies it — the field stays ` +
      "blank, which reads as the RD not knowing rather than as us not asking",
  );
});

test("the RD button offers the address too", () => {
  const src = code(CELL);
  assert.ok(
    /payeeAddress:\s*registerHasAddressRowLacks\(/.test(src),
    `${CELL}'s ใช้ข้อมูลจากสรรพากร no longer applies the address. This is the only ` +
      "path a hand-typed row has — it never goes through the AI read",
  );
  assert.ok(
    /registerHasAddressRowLacks\(item\.payeeAddress,\s*reg\?\.address\)/.test(src),
    `${CELL} no longer offers the button for a row that is merely MISSING an address. ` +
      "Without that arm the button appears only on a name or branch discrepancy, so a " +
      "hand-typed row whose name already matches can never pull the address",
  );
});

test("the register is never asked to match an address it did not write", () => {
  // The one shape that must not appear: comparing the read address against the
  // registered one. They are the same place written two ways on nearly every
  // row, so a textual comparison would report a discrepancy that means nothing.
  for (const file of [FORM, CELL]) {
    const src = code(file);
    assert.equal(
      /sameRegisteredName\([^)]*[Aa]ddress/.test(src),
      false,
      `${file} compares one address against another`,
    );
  }
});
