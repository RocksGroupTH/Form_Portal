import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Two rules about the seller cells that no unit test can reach — the logic sits
 * inside a React component and this repository has no DOM harness — and that a
 * reasonable edit undoes silently.
 *
 * 1. **A found tax id REPLACES the typed seller name outright** (user,
 *    2026-09-15). It used to offer the registered name on a yellow button, on
 *    the reasoning that a receipt can print a trading name the register has
 *    never heard of. That reasoning is still written down in the component, so
 *    somebody reading it could restore the button believing it was lost by
 *    accident.
 *
 * 2. **A row that ALREADY had its tax id when the form opened is looked up but
 *    never overwritten.** The lookup fires on mount for any 13-digit number, so
 *    without the gate, reopening a draft rewrites a seller name somebody had
 *    deliberately corrected — a change nobody asked for, on a row nobody
 *    touched. This is the half most likely to be dropped as redundant.
 */

const SRC = fs
  .readFileSync(
    path.resolve(process.cwd(), "src/features/reimburse/components/SellerCheckCells.tsx"),
    "utf8",
  )
  // Comments stripped: the component explains the behaviour it REPLACED, in
  // the words this test searches for.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("a found tax id writes the registered name into the row", () => {
  assert.ok(
    /onChangeRef\.current\(\{ vendorName: name \}\)/.test(SRC),
    "the lookup no longer writes the registered name — it is back to asking",
  );
});

test("the offer button is gone and stays gone", () => {
  assert.ok(
    !/ใช้ข้อมูลจากระบบ/.test(SRC),
    "the 'use the system's value' offer button is back — the name is replaced outright now",
  );
  assert.ok(
    !/mismatch/.test(SRC),
    "a mismatch state is back on this component; a replaced name cannot mismatch",
  );
});

test("a row loaded with its tax id already set is not overwritten", () => {
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
