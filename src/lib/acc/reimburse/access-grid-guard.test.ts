import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_REIMBURSE_TABS, GRANTABLE_REIMBURSE_TABS } from "./settings-tabs";

/**
 * Which tabs AP-4's สิทธิ์เข้าถึง grid gives a CHECKBOX to, read out of its
 * source.
 *
 * The counterpart of `@/lib/adv/access-grid-guard`, and here for the same
 * reason: `ReimburseAccessSettings.tsx` is a `"use client"` module — importing
 * it drags `useSWR`, `sonner` and the AD search modal in — so its rendering
 * cannot be exercised here. What CAN be pinned is which list it maps, and that
 * is exactly the failure to guard against, because it is invisible: a grid that
 * maps one array instead of another renders perfectly and simply shows the
 * wrong columns.
 *
 * **It is here rather than beside the component** because `src/lib/acc/reimburse`
 * is where AP-4's source-reading guards already live
 * (`approvals-route-authz-guard`, `erp-queue-service-guard`, …), and because
 * importing `settings-tabs` from a test beside a `.tsx` file buys nothing.
 *
 * **Written 2026-09-22 after a measured gap.** The user asked for the
 * ungrantable column to come off the grid (*"ตัดช่อง สิทธิ์เข้าถึง ออก"*), and
 * mutating the filter back to the full list left the entire 2,307-test suite
 * GREEN. AP-2 / AP-3's grid had the same hole, from the commit that changed it
 * two days earlier; both are closed now.
 */

const SRC = readFileSync(
  join(
    process.cwd(),
    "src/features/reimburse/components/settings/ReimburseAccessSettings.tsx",
  ),
  "utf8",
);

test("the column list is DERIVED by filtering on adminOnly, not retyped", () => {
  // Filtering rather than naming keys is what let Interface ERP, หมวดบัญชี G/L
  // and Fix G/L by BU or Branch reappear as real columns on the day they became
  // grantable, with no edit to the component — and what will take a future tab
  // back out again if it stops being grantable. A hand-kept list would need
  // remembering in both directions and would be remembered in neither.
  assert.match(
    SRC,
    /const TAB_COLUMNS = ALL_REIMBURSE_TABS\.filter\(\(t\) => !t\.adminOnly\);/,
    "TAB_COLUMNS is no longer the grantable tabs filtered out of ALL_REIMBURSE_TABS",
  );
  assert.match(
    SRC,
    /const ADMIN_ONLY_TABS = ALL_REIMBURSE_TABS\.filter\(\(t\) => t\.adminOnly\);/,
    "the ungrantable tabs are no longer collected for the line under the table",
  );
  assert.match(
    SRC,
    /const TAB_NOTES = TAB_COLUMNS\.filter\(\(t\) => t\.note\);/,
    "the reach warnings are no longer collected",
  );
});

test("the header and the body both map TAB_COLUMNS, and nothing maps the full list", () => {
  // Two call sites — the `<th>` row and the `<td>` row — and they must agree,
  // or a checkbox lands under the wrong heading. `colSpan` is the third: it
  // spans the group above them and would leave the table a column short.
  const mapped = SRC.match(/\{TAB_COLUMNS\.map\(\(tab, idx\) => \(/g) ?? [];
  assert.equal(mapped.length, 2, `TAB_COLUMNS is mapped ${mapped.length} time(s), expected 2`);
  assert.match(SRC, /colSpan=\{TAB_COLUMNS\.length\}/, "the group heading no longer spans the columns");
  assert.equal(
    (SRC.match(/\{ALL_REIMBURSE_TABS\.map\(/g) ?? []).length,
    0,
    "something still renders the FULL tab list — an ungrantable tab is back as a dead column",
  );
  assert.equal(
    (SRC.match(/colSpan=\{ALL_REIMBURSE_TABS\.length\}/g) ?? []).length,
    0,
    "the group heading spans the full tab list again",
  );
});

test("the tabs that lost their column are still named under the table", () => {
  // Removing the column must not remove the ANSWER. An admin looking for "who
  // may open สิทธิ์เข้าถึง?" should find a line saying it is admin-only, not an
  // absence — which is the complaint that put every tab in the header on
  // 2026-09-14 and is still valid.
  assert.match(SRC, /\{ADMIN_ONLY_TABS\.length > 0 && \(/, "the admin-only line is not rendered");
  assert.match(SRC, /\{TAB_NOTES\.length > 0 && \(/, "the reach warnings are not rendered");
});

test("the rendered columns and the saved payload cannot disagree", () => {
  // The screen maps `TAB_COLUMNS` and the POST is built from
  // `GRANTABLE_REIMBURSE_TABS`; a column with no counterpart in the payload is
  // a checkbox whose tick is dropped on save — the exact bug AP-17's menu keys
  // shipped with. Both come from `REIMBURSE_SETTINGS_TAB_ORDER`, so this holds
  // by construction; it is asserted because "by construction" is a property of
  // today's code.
  assert.deepEqual(
    TAB_COLUMNS_KEYS(),
    GRANTABLE_REIMBURSE_TABS.map((t) => t.key as string),
    "the grid's columns and the saved payload name different tabs",
  );
  assert.match(
    SRC,
    /GRANTABLE_REIMBURSE_TABS\.filter\(\(t\) => next\.has\(t\.key\)\)\.map\(\(t\) => t\.key\)/,
    "the saved settingsTabs list is no longer built from GRANTABLE_REIMBURSE_TABS",
  );
});

/** What `TAB_COLUMNS` resolves to, computed the way the component computes it. */
function TAB_COLUMNS_KEYS(): string[] {
  return ALL_REIMBURSE_TABS.filter((t) => !t.adminOnly).map((t) => t.key as string);
}
