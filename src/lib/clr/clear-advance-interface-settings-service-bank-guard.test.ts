import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Pins whose bank rows the AP-3 Interface ERP settings tab reads.
 *
 * `listClrInterfaceConfigView` calls `listBrandAccounts("bank", null, AP3_FORM_CODE)`
 * exactly once, and that one call decides which form's rows the tab shows as
 * AP-3's own. Changing the third argument to `AP2_FORM_CODE` (or any other
 * form code, or a bare string literal) still type-checks, `listBrandAccounts`
 * still returns rows, and `clear-advance-interface-bank-core.test.ts` still
 * passes in full — its tests start from rows already fetched and never touch
 * this call at all. The tab would then display AP-2's banks labelled as
 * AP-3's own: a display-versus-send divergence with nothing else to catch it,
 * because the send-time reader (`clear-advance-bank-account.ts`) reads
 * `AP3_FORM_CODE` from the same constants module independently and would
 * keep sending correctly while this screen lied about it.
 *
 * A source scan, not a behavioural test — same reasoning as
 * `gl-company-guard.test.ts` and ACC Portal's `ported-imports.test.ts`:
 * importing `clear-advance-interface-settings-service.ts` from a test throws
 * at import (it reaches `@/env` through `@/lib/acc/brand-account-service` →
 * `getAccPool`), and this repo's `node:test` runner has no working module
 * mock to substitute the fetch instead (`scripts/run-tests.ts` does not pass
 * `--experimental-test-module-mocks`).
 */
const SERVICE_PATH = "src/lib/clr/clear-advance-interface-settings-service.ts";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

/** The one call this guard cares about, wherever whitespace falls inside it. */
const BANK_READ_CALL = /listBrandAccounts\(\s*"bank"\s*,\s*null\s*,\s*AP3_FORM_CODE\s*\)/;

test("the settings view reads AP-3's own bank rows, not AP-2's or a literal", () => {
  const src = read(SERVICE_PATH);
  assert.match(
    src,
    BANK_READ_CALL,
    `${SERVICE_PATH} must call listBrandAccounts("bank", null, AP3_FORM_CODE) exactly — found something else`,
  );
});

test("AP3_FORM_CODE used above is the real one, imported from the clear-advance constants", () => {
  const src = read(SERVICE_PATH);
  assert.match(
    src,
    /import\s*\{[^}]*\bAP3_FORM_CODE\b[^}]*\}\s*from\s*"@\/features\/clear-advance\/constants"/,
    `${SERVICE_PATH} must import AP3_FORM_CODE from "@/features/clear-advance/constants"`,
  );
});

test("is not vacuous — the pattern catches AP-2's form code substituted in, and the reverse", () => {
  assert.match(
    'listBrandAccounts("bank", null, AP3_FORM_CODE)',
    BANK_READ_CALL,
  );
  // The exact defect this guard exists to catch: AP-2's constant, quietly
  // showing AP-2's banks on AP-3's own settings screen.
  assert.doesNotMatch(
    'listBrandAccounts("bank", null, AP2_FORM_CODE)',
    BANK_READ_CALL,
  );
  // A hard-coded form code would also read the wrong (or merely accidentally
  // right, and un-refactorable) rows.
  assert.doesNotMatch(
    'listBrandAccounts("bank", null, "AP-3")',
    BANK_READ_CALL,
  );
});
