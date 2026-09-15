import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Three rules about the seller cells that no unit test can reach — the logic
 * sits inside a React component and this repository has no DOM harness — and
 * that a reasonable edit undoes silently.
 *
 * The first two look like alternatives and are not. Asked on 2026-09-15 in two
 * passes, they compose: a newly entered tax id **replaces** the seller name,
 * and the registered name stays **on offer** for as long as the box disagrees
 * with it. Removing either because the other exists is precisely the edit these
 * assertions are here to stop — the file's own docblock says so, and the first
 * version of this test pinned "the offer button is gone and stays gone", which
 * is now the wrong answer.
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

test("a newly entered tax id writes the registered name into the row", () => {
  assert.ok(
    /onChangeRef\.current\(\{ vendorName: name \}\)/.test(SRC),
    "the lookup no longer writes the registered name — it is back to only asking",
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

test("a row loaded with its tax id already set is not overwritten", () => {
  // The lookup fires on mount for any 13-digit number, so without this gate
  // reopening a draft rewrites a seller name somebody deliberately corrected,
  // on a row nobody touched. The offer button is what that row gets instead.
  assert.ok(
    /mountDigitsRef/.test(SRC),
    "the mount-digits gate is gone — reopening a draft now rewrites its seller name",
  );
  assert.ok(
    /const isLoadedRow = digits === mountDigitsRef\.current;/.test(SRC),
    "the gate no longer compares the current tax id with the one the row loaded with",
  );
  assert.ok(
    /shouldWrite = !isLoadedRow/.test(SRC),
    "the write is no longer gated on the tax id having changed since load",
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
