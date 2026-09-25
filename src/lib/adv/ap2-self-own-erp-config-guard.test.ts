import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **AP-2 must not inherit AP-1's Bank Account or Journal Batch.**
 *
 * `FormCode NULL` in the brand-keyed ERP tables is not a house default. AP-1 has
 * no `FormCode = 'AP-1'` rows at all; its settings editor reads and writes the
 * NULL rows (`listBrandAccounts(kind, brand, undefined)`, and a write bounded by
 * `perFormWriteMatch(null)`). So a `?? rows[0]` here does not mean "fall back to
 * the shared value", it means "use whatever AP-1 last saved".
 *
 * That mattered twice over: the settings card marked a brand ready on AP-1's
 * account, and the payload built the payment line against it. Both read as
 * configured. The blast radius was zero only because every brand carrying a
 * NULL default also had its own AP-2 row on the day this was fixed.
 *
 * Nothing renders these modules and neither reaches a database in a test, so
 * this is a source scan -- the same trade the other `*-guard.test.ts` files make.
 * G/L is deliberately NOT pinned: AP-2's Dr posts to the matched Vendor and the
 * account comes from its posting group, so G/L inherits harmlessly.
 */

const SRC = path.join(process.cwd(), "src");

const CONTEXT = "lib/adv/advance-erp-context.ts";
const SETTINGS = "lib/adv/advance-interface-settings-service.ts";

/** Line endings are the machine's, not the repo's -- see adc-link-guard.test.ts. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the payload path takes only AP-2's own bank and batch rows", () => {
  const src = code(CONTEXT);

  for (const name of ["bank", "batch"]) {
    const m = new RegExp("const\\s+" + name + "\\s*=\\s*([^;]*);").exec(src);
    assert.ok(m, "no `const " + name + " =` binding in " + CONTEXT + " -- rewrite this guard, do not delete it");
    const rhs = (m as RegExpExecArray)[1];

    assert.ok(
      rhs.indexOf("pickOwnForForm(") !== -1,
      CONTEXT + ": `" + name + "` no longer goes through pickOwnForForm -- it reads \"" + rhs.trim() + "\". " +
        "Only an explicit AP-2 row may answer here; the NULL-default row is AP-1's account",
    );
    assert.equal(
      /\?\?\s*\w+Rows\[0\]/.test(rhs),
      false,
      CONTEXT + ": `" + name + "` fell back to a NULL-default row again (\"" + rhs.trim() + "\"). " +
        "That row is AP-1's configuration, so this pays out against another form's bank account",
    );
  }
});

test("the settings card shows only AP-2's own bank and batch", () => {
  const src = code(SETTINGS);

  for (const [name, map] of [
    ["bankAccountNo", "ap2BankByCode"],
    ["journalBatchName", "ap2BatchByCode"],
  ]) {
    const m = new RegExp("const\\s+" + name + "\\s*=\\s*([^;]*);").exec(src);
    assert.ok(m, "no `const " + name + " =` binding in " + SETTINGS + " -- rewrite this guard, do not delete it");
    const rhs = (m as RegExpExecArray)[1];

    assert.ok(
      rhs.indexOf(map) !== -1,
      SETTINGS + ": `" + name + "` stopped reading " + map + " -- it reads \"" + rhs.trim() + "\"",
    );
    assert.equal(
      rhs.indexOf("base?.") !== -1,
      false,
      SETTINGS + ": `" + name + "` fell back to the shared context again (\"" + rhs.trim() + "\"). " +
        "ctx.brandAccounts resolves the NULL-default row, which is AP-1's -- a brand " +
        "configured only for AP-1 would show as ready on AP-1's account",
    );
  }
});
