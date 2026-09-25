import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **A4 landscape, and ten column widths that must add up to the sheet.**
 *
 * AP-3's print sheet was portrait until 2026-09-25. A tester's claim with seven
 * lines wrapped in three different columns at once — รายการ on every row, สาขา
 * on two, เลขที่เอกสาร on one — which is what the request was about:
 * "ข้อมูลเยอะแล้วตกบรรทัดหลายคอลัม". Measured on the same claim after the
 * change, only รายการ wraps.
 *
 * Nothing renders this page in a test, so nothing here fails on its own. Three
 * things are pinned, and only three:
 *
 * 1. `@page` still says landscape. This is the whole change — a revert to
 *    portrait prints ten columns into 186mm again and the widths below, which
 *    are sized for 273mm, make it worse than it was before the change rather
 *    than merely as bad.
 * 2. The on-screen sheet is still 297mm wide. It is the preview; if it and
 *    `@page` disagree, what somebody approves on screen is not what prints.
 * 3. The ten `<col>` widths still total 100%. This is the one that earns its
 *    keep: percentages are edited one at a time, a table over 100% is silently
 *    rescaled by the browser, and the result is not a failure anywhere — it is
 *    every column slightly narrower than the measurement it was given, which
 *    reads as "the wrapping came back" months later with no obvious cause.
 *
 * Deliberately NOT pinned: the individual widths. They are a judgement about
 * what the longest value in each column is, recorded in the page's own comment,
 * and the next person with a longer vendor code should be able to change one
 * without arguing with a test — as long as the ten still add up.
 */

const PAGE = path.join(
  process.cwd(),
  "src/app/(dashboard)/request/clear-advance/[id]/print/page.tsx",
);

/** CRLF on a Windows checkout, LF in the blob — see adc-link-guard.test.ts. */
function source(): string {
  return fs.readFileSync(PAGE, "utf8").replace(/\r\n/g, "\n");
}

/** Comments must not satisfy a check that scans for code. */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the printed page is A4 landscape", () => {
  const src = code();
  assert.match(
    src,
    /@page\s*\{[^}]*size:\s*A4\s+landscape/,
    "@page no longer asks for A4 landscape — ten columns are back in 186mm",
  );
  assert.doesNotMatch(src, /size:\s*A4\s+portrait/, "a portrait @page rule survived");
});

test("the on-screen sheet is the same way round as the paper", () => {
  const src = code();
  const sheet = /#ap31-sheet\s*\{([^}]*)\}/.exec(src)?.[1] ?? "";
  assert.ok(sheet.length > 0, "#ap31-sheet rule not found — the guard is scanning nothing");
  assert.match(sheet, /width:\s*297mm/, "the preview sheet is not 297mm wide");
  assert.match(sheet, /min-height:\s*210mm/, "the preview sheet is not 210mm tall");
});

test("the ten item-table column widths still add up to the sheet", () => {
  const src = code();
  const group = /<colgroup>([\s\S]*?)<\/colgroup>/.exec(src)?.[1];
  assert.ok(group, "no <colgroup> found — the guard is scanning nothing");

  const widths: number[] = [];
  const re = /width:\s*"([\d.]+)%"/g;
  let m: RegExpExecArray | null;
  // exec/while, not matchAll: this repo's tsconfig target predates the iterator
  // protocol on RegExpStringIterator.
  while ((m = re.exec(group as string)) !== null) widths.push(Number(m[1]));

  assert.equal(widths.length, 10, `expected ten column widths, read ${widths.length}`);

  const total = widths.reduce((a, b) => a + b, 0);
  // Rounded: the widths carry two decimals, so the sum carries floating-point dust.
  assert.equal(
    Math.round(total * 100) / 100,
    100,
    `the ten columns total ${total}%, not 100% — over 100 the browser rescales every ` +
      `column narrower than its measurement and the wrapping comes back`,
  );
});
