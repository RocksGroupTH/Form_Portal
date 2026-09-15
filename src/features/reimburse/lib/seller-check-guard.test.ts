import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Four rules about the seller cells that no unit test can reach — the logic
 * sits inside a React component and this repository has no DOM harness — and
 * that a reasonable edit undoes silently.
 *
 * The first two look like alternatives and are not. Asked over three passes on
 * 2026-09-15, they compose into one behaviour:
 *
 * - the **first** find on a row replaces the seller name outright, which is the
 *   receipt-read case — attaching the file fills the tax id and a transcribed
 *   name together, and the register's name is the one the ledger wants;
 * - **every disagreement after that** is an offer on a button — a tax id edited
 *   later, a name edited later, or a saved row opened with a name that never
 *   matched.
 *
 * Removing either because the other exists is precisely the edit these
 * assertions are here to stop. The first version of this file pinned "the offer
 * button is gone and stays gone", which one pass later was the wrong answer.
 */

const SRC = fs
  .readFileSync(
    path.resolve(process.cwd(), "src/features/reimburse/components/SellerCheckCells.tsx"),
    "utf8",
  )
  // Comments stripped: the component explains the behaviour it replaced, in
  // the words this test searches for.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("the FIRST find writes the registered name into the row", () => {
  assert.ok(
    /onChangeRef\.current\(\{ vendorName: name \}\)/.test(SRC),
    "the lookup no longer writes the registered name — it is back to only asking",
  );
  assert.ok(
    /const firstFind = !foundOnceRef\.current;/.test(SRC),
    "the first-find gate is gone",
  );
  assert.ok(
    /shouldWrite =\s*!arrivedWithTaxIdRef\.current && firstFind/.test(SRC),
    "the write is no longer gated on BOTH a fresh row and its first find",
  );
});

test("a tax id changed afterwards offers rather than overwrites", () => {
  // The receipt read fills the tax id and a name together, and that one event
  // is what the replacement is for. A number edited later is somebody working
  // the row deliberately — overwriting then would fight them thirteen digits at
  // a time — so the one replacement is spent on the first find and never
  // refunded.
  assert.ok(
    /if \(name !== ""\) foundOnceRef\.current = true;/.test(SRC),
    "the first find no longer spends the one replacement this row gets",
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

test("a row that arrived with a tax id is never overwritten", () => {
  // The lookup fires on mount for any 13-digit number, so without this gate
  // reopening a draft rewrites a seller name somebody deliberately corrected,
  // on a row nobody touched. That row gets the offer button instead.
  assert.ok(
    /const arrivedWithTaxIdRef = useRef\(digits !== ""\);/.test(SRC),
    "the arrived-with-a-tax-id gate is gone — reopening a draft now rewrites its seller name",
  );
  assert.ok(
    /!arrivedWithTaxIdRef\.current/.test(SRC),
    "the write no longer checks whether the row arrived with a tax id",
  );
});

test("the lookup reads the name through a ref, not the effect's closure", () => {
  // The effect keys on the tax id alone, so a `vendorName` captured when it ran
  // can be stale by the time the fetch lands — it would report "replaced" for a
  // row it did not touch, or stay quiet on one it did.
  assert.ok(
    /const had = \(nameRef\.current \?\? ""\)\.trim\(\);/.test(SRC),
    "the lookup compares against a captured vendorName again",
  );
});
