import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Rules about the seller cells that no unit test can reach — the logic sits
 * inside a React component and this repository has no DOM harness — and that a
 * reasonable edit undoes silently.
 *
 * The two behaviours look like alternatives and are not:
 *
 * - **a find replaces the seller name**, every time, because a lookup only runs
 *   when the tax id reaches thirteen digits and is therefore always an act on
 *   the number — the receipt read filling a new row, or somebody typing or
 *   correcting one;
 * - **the registered name stays on offer** while the box disagrees, which is
 *   how a name edited afterwards gets back. Editing the NAME starts no lookup,
 *   so the two never fight.
 *
 * Removing either because the other exists is precisely the edit these
 * assertions are here to stop. It has been asked for four ways over one day —
 * an earlier version of this file pinned "the offer button is gone and stays
 * gone", and a later one pinned two gates on the replacement that have since
 * been removed by request.
 */

const read = (rel: string) =>
  fs
    .readFileSync(path.resolve(process.cwd(), rel), "utf8")
    // Comments stripped: the component explains the behaviour it replaced, in
    // the words these tests search for.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SRC = read("src/features/reimburse/components/SellerCheckCells.tsx");

test("a find writes the registered name into the row", () => {
  assert.ok(
    /if \(name !== "" && had !== name\) onChangeRef\.current\(\{ vendorName: name \}\);/.test(SRC),
    "the lookup no longer writes the registered name — it is back to only asking",
  );
});

test("nothing gates the replacement any more", () => {
  // Both gates were asked for and then asked away again (2026-09-15). They are
  // gone rather than left in to contradict the plain rule quietly: a "first
  // find only" flag, and a "this row came from a document read" prop.
  assert.ok(!/foundOnceRef/.test(SRC), "a first-find gate is back on the replacement");
  assert.ok(!/fromDocumentRead/.test(SRC), "a came-from-a-read gate is back on the replacement");
  assert.ok(
    !/arrivedWithTaxIdRef/.test(SRC),
    "an arrived-with-a-tax-id gate is back on the replacement",
  );
});

test("the registered name stays on offer while the box disagrees", () => {
  assert.ok(
    /const offerAvailable = verdict === "mismatch" && offered !== "";/.test(SRC),
    "the offer condition is gone or narrowed — a name edited after the replacement has no way back",
  );
  assert.ok(
    /onClick=\{\(\) => onChange\(\{ vendorName: offered \}\)\}/.test(SRC),
    "the offer button no longer applies the registered name",
  );
});

test("the replacement runs on the tax id alone, so a name edit survives", () => {
  // `[digits]`, not `[digits, vendorName]`. Re-running the lookup when the name
  // changed would overwrite the edit the offer button exists to let somebody
  // make, the moment they made it.
  assert.ok(/\}, \[digits\]\);/.test(SRC), "the lookup effect no longer keys on the tax id alone");
});

test("the tax id box takes digits only, and no more than thirteen", () => {
  // The column is a 13-digit string. Filtering on the way in means the box
  // cannot hold something the column will not take, rather than accepting it
  // and reporting an error underneath.
  assert.ok(
    /maxLength=\{TAX_ID_LENGTH\}/.test(SRC),
    "the tax id box no longer caps at the real length",
  );
  assert.ok(
    /replace\(\/\[\^0-9\]\/g, ""\)\.slice\(0, TAX_ID_LENGTH\)/.test(SRC),
    "the tax id box no longer strips non-digits on the way in",
  );
});

test("the lookup reads the name through a ref, not the effect's closure", () => {
  // The effect keys on the tax id alone, so a `vendorName` captured when it ran
  // can be a keystroke stale by the time the fetch lands — the write would then
  // be judged against a value that is no longer in the box.
  assert.ok(
    /const had = \(nameRef\.current \?\? ""\)\.trim\(\);/.test(SRC),
    "the lookup compares against a captured vendorName again",
  );
});
