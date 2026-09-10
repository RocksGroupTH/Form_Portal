import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The G/L picker and the vendor picker are one component, not two.
 *
 * Both cells on คิวอนุมัติ (บัญชี) need the same machinery: a filter-as-you-type
 * list too long to scroll (around 280 G/L accounts per brand, up to 1,604
 * vendor cards), a portalled dropdown that stays on screen next to a cell
 * mid-row, "no brand chosen yet", and — the one most easily lost — "the stored
 * value is not in the list", which happens to a claim filed before that column
 * meant an ERP account and to a vendor since blocked in BC.
 *
 * `ExpenseAccountPicker` already solved all of it, so the vendor picker is that
 * component with different copy rather than a second copy of 280 lines that
 * drifts the first time somebody fixes one of them.
 *
 * The risk of an extraction is a silent behaviour change in the OLD caller, so
 * what this pins is the shape: exactly one module owns the dropdown, and both
 * wrappers go through it. There is no DOM harness here, so it reads the source
 * the way `currency-surface-guard.test.ts` does.
 */

const ROOT = path.resolve(process.cwd(), "src");

const SHARED = "components/ui/CodeNamePicker.tsx";
const GL = "features/reimburse/components/ExpenseAccountPicker.tsx";
const VENDOR = "features/reimburse/components/VendorPicker.tsx";

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the shared picker owns the dropdown machinery", () => {
  const src = code(SHARED);
  assert.match(src, /createPortal/, "the shared picker must be the one that portals the panel");
  assert.match(src, /export function CodeNamePicker/, "CodeNamePicker is not exported from here");
});

for (const [label, rel] of [
  ["the G/L picker", GL],
  ["the vendor picker", VENDOR],
] as const) {
  test(`${label} renders the shared one and keeps no dropdown of its own`, () => {
    const src = code(rel);
    assert.match(
      src,
      /<CodeNamePicker/,
      `${label} does not render CodeNamePicker — a second dropdown implementation is exactly ` +
        "what this file exists to prevent",
    );
    assert.equal(
      /createPortal/.test(src),
      false,
      `${label} portals a panel itself. The machinery belongs to CodeNamePicker; two copies ` +
        "drift the first time one of them is fixed",
    );
  });
}

test("the value that is not in the list survives in the shared picker", () => {
  // The half most easily dropped in a rewrite, and the one with a real cost: a
  // claim carrying free text like "AP-4.2", or a vendor blocked in BC since it
  // was chosen, must still show what is stored rather than reading as empty.
  const src = code(SHARED);
  assert.match(
    src,
    /value \|\| placeholder/,
    "the trigger no longer falls back to the raw stored value. Blanking a field somebody " +
      "filled in, because the current list no longer offers it, loses the only record of it " +
      "on screen",
  );
});
