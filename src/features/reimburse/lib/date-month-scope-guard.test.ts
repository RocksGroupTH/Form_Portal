import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-4 alone spells the month short, guarded at the source.
 *
 * `SingleDatePicker` renders the date cell of AP-4's expense grid, where the
 * column is 148px and a spelled-out month clipped the year off the end — which
 * reads as a broken date rather than as a narrow box. Abbreviating fixes that
 * cell and must not travel: AP-1's and AP-17's dates are spelled out, and the
 * control is shared, so the moment either adopts it they would inherit AP-4's
 * abbreviation with no code change and nothing to notice.
 *
 * **The months are English since 2026-09-15** (user), on all three forms'
 * pickers — so the formatters this pins are `formatEnYmd` and
 * `formatEnYmdShort`. The Thai pair still formats every report filter and the
 * payment-date pickers, none of which was asked about; the rule here is about
 * ABBREVIATION, which is orthogonal to the language, and is why this file did
 * not simply go away with the change.
 *
 * That is not reachable from a behavioural test — it is which formatter a
 * component calls and which caller opted in — so this reads the sources, the
 * way `currency-surface-guard.test.ts` already does. The formatters themselves
 * are covered for real in `features/accounting/lib/thai-calendar.test.ts`.
 */

const ROOT = path.resolve(process.cwd(), "src");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so a comment quoting a rule cannot satisfy it. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PICKER = "features/accounting/components/SingleDatePicker.tsx";
const AP4_GRID = "features/reimburse/components/ReimburseItemGrid.tsx";

test("the picker chooses its month table from a prop, not from a hardcoded call", () => {
  const src = code(PICKER);
  const display = src.split("\n").find((l) => l.includes("const display"));
  assert.ok(display, "no `const display` line in SingleDatePicker");
  assert.ok(
    display.includes("monthFormat"),
    "the rendered date must branch on monthFormat, or every caller gets one spelling",
  );
  assert.ok(
    /formatEnYmd\s*\(/.test(display),
    "the unabbreviated formatter must stay reachable from the display line",
  );
  assert.ok(
    /formatEnYmdShort\s*\(/.test(display),
    "the abbreviated formatter must stay reachable from the display line",
  );
});

test("the default is the spelled-out month, so a new caller inherits AP-1's spelling", () => {
  const src = code(PICKER);
  assert.ok(
    /monthFormat\s*=\s*"full"/.test(src),
    'monthFormat must default to "full" where the props are destructured — an opt-out default ' +
      "would hand the abbreviation to the next form that adopts this control",
  );
});

test("AP-4's expense grid is the only surface that opts in", () => {
  assert.ok(
    /monthFormat=["{]?["']?short/.test(code(AP4_GRID)),
    "AP-4's expense grid must ask for the short month explicitly",
  );

  const optIns: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        if (/monthFormat=["{]?["']?short/.test(fs.readFileSync(full, "utf8"))) {
          optIns.push(path.relative(ROOT, full).split(path.sep).join("/"));
        }
      }
    }
  })(ROOT);

  assert.deepEqual(
    optIns,
    [AP4_GRID],
    "exactly one surface may abbreviate the month. A second entry here means another form " +
      "started spelling dates differently from the rest of the app — decide that deliberately, " +
      "then widen this list",
  );
});
