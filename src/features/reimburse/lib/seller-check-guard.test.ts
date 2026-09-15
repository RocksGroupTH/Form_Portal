import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Rules about the seller cells that no unit test can reach — the logic sits
 * inside a React component and this repository has no DOM harness — and that a
 * reasonable edit undoes silently.
 *
 * The first two look like alternatives and are not. Asked over four passes on
 * 2026-09-15, they compose into one behaviour:
 *
 * - the **first find on a row a document read created** replaces the seller
 *   name outright: attaching the file fills the tax id and a transcribed name
 *   together, and the register's name is the one the ledger wants;
 * - **every disagreement after that** is an offer on a button — a tax id edited
 *   later, a name edited later, or a saved row opened with a name that never
 *   matched.
 *
 * Removing either because the other exists is precisely the edit these
 * assertions are here to stop. An earlier version of this file pinned "the
 * offer button is gone and stays gone", which one pass later was the wrong
 * answer.
 */

const read = (rel: string) =>
  fs
    .readFileSync(path.resolve(process.cwd(), rel), "utf8")
    // Comments stripped: the component explains the behaviour it replaced, in
    // the words these tests search for.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SRC = read("src/features/reimburse/components/SellerCheckCells.tsx");
const GRID = read("src/features/reimburse/components/ReimburseItemGrid.tsx");

test("the FIRST find on a read's row writes the registered name", () => {
  assert.ok(
    /onChangeRef\.current\(\{ vendorName: name \}\)/.test(SRC),
    "the lookup no longer writes the registered name — it is back to only asking",
  );
  assert.ok(
    /const firstFind = !foundOnceRef\.current;/.test(SRC),
    "the first-find gate is gone",
  );
  assert.ok(
    /shouldWrite = !!fromDocumentRead && firstFind/.test(SRC),
    "the write is no longer gated on BOTH a read's own row and its first find",
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

test("only a document read's own unsaved row is ever overwritten", () => {
  // The lookup fires on mount for any 13-digit number, so a saved row would
  // otherwise have its seller name rewritten on open — a row nobody touched,
  // carrying a name somebody deliberately corrected. It gets the offer button.
  //
  // `fromDocumentRead` and NOT "did this row arrive with a tax id": a read
  // CREATES the row carrying both the tax id and a transcribed name, so its
  // cells' first render already holds 13 digits, and the arrival test caught
  // the one case the replacement exists for. That was the bug reported on
  // 2026-09-15 — a new attachment found the tax id and left the name alone.
  assert.ok(
    /fromDocumentRead\?: boolean;/.test(SRC),
    "the from-a-read flag is gone — every row is now a candidate for overwriting",
  );
  assert.ok(
    !/arrivedWithTaxIdRef/.test(SRC),
    "the arrival test is back; it skips the read's own row, the only one to write",
  );
});

test("the grid marks a read's row with its unsaved source id", () => {
  // `sourceDocId` is swapped for `sourceFileId` by `handleSaveDraft`, so it is
  // true exactly while the row came from a read and has not been saved.
  assert.ok(
    /fromDocumentRead=\{!!item\.sourceDocId\}/.test(GRID),
    "the grid no longer tells the cells which rows came from a document read",
  );
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
  // can be stale by the time the fetch lands — it would report "replaced" for a
  // row it did not touch, or stay quiet on one it did.
  assert.ok(
    /const had = \(nameRef\.current \?\? ""\)\.trim\(\);/.test(SRC),
    "the lookup compares against a captured vendorName again",
  );
});
