import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Two properties of AP-2's and AP-3's grouped Interface ERP screens that no
 * type enforces and that a reasonable-looking edit removes silently. Spec:
 * `docs/superpowers/specs/2026-09-14-ap2-ap3-erp-interface-groups-design.md`.
 *
 * Source-reading because these are React screens: this repository has no
 * component test harness, and what has to hold is *which* body each save posts
 * — not what a render produces.
 *
 * ## 1. A group value is fanned out per claim brand, never stored on the target
 *
 * `resolveJournalBatchName` (`erp-journal-context.ts`) looks a claim brand's
 * batch up by its **interface** brand first, so a row keyed on the target beats
 * every per-brand row. This repository has already shipped that failure once,
 * on AP-2: the settings screen displayed `TRAVELING` while the payload
 * correctly sent `BEE`. Grouping the screen makes "save the group's batch once"
 * the obvious simplification, and it is exactly the bug.
 *
 * ## 2. AP-3 offers no membership control
 *
 * AP-2 owns `AccBrandErpInterface`; AP-3 inherits whatever it resolves to and
 * has no route that could change it. A control that looked editable there and
 * silently was not would be worse than not having one, so the failure to guard
 * against is a control appearing — not one disappearing.
 */

const read = (rel: string) =>
  fs
    .readFileSync(path.resolve(process.cwd(), rel), "utf8")
    // Comments stripped: both files NAME the hazards they avoid, so a guard
    // over the raw text would fail on the prose explaining them.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const AP2 = read("src/features/advance/components/settings/AdvanceErpInterfaceSettings.tsx");
const AP3 = read("src/features/clear-advance/components/admin/ClrErpInterfaceSettings.tsx");

test("AP-2's group save posts one body per member, keyed on the claim brand", () => {
  assert.ok(
    /for \(const m of shown\)[\s\S]{0,600}?brandCode: m\.brandCode/.test(AP2),
    "AP-2's group save no longer loops its members posting brandCode — a group-level write would be keyed on the target",
  );
  assert.ok(
    /interfaceBrandCode: target/.test(AP2),
    "AP-2's save no longer sends the group's target as interfaceBrandCode",
  );
});

test("AP-3's group save posts one body per member, keyed on the claim brand", () => {
  assert.ok(
    /for \(const m of members\)[\s\S]{0,600}?brandCode: m\.brandCode/.test(AP3),
    "AP-3's group save no longer loops its members posting brandCode",
  );
});

test("AP-3 renders no membership control", () => {
  // The three spellings such a control would arrive as: the picker AP-2 uses,
  // a state holding brands staged for a move, and the field that would carry
  // the new target to the route.
  assert.ok(!/เพิ่มแบรนด์/.test(AP3), "AP-3 has grown an 'add a brand' control — membership is AP-2's");
  assert.ok(!/setAdded|addOptions/.test(AP3), "AP-3 has grown a staged-membership control");
  assert.ok(
    !/interfaceBrandCode/.test(AP3),
    "AP-3 posts an interface target — its route does not set membership",
  );
});

test("both screens group through the shared, tested helper", () => {
  for (const [name, src] of [["AP-2", AP2], ["AP-3", AP3]] as const) {
    assert.ok(
      /groupByTargetIncludingEmpty\(/.test(src),
      `${name} no longer groups through groupByTargetIncludingEmpty — an empty card is the only place a company's first brand can be added`,
    );
    assert.ok(
      /groupValue\(/.test(src),
      `${name} no longer resolves its shared fields through groupValue — a blank-vs-set fill and a set-vs-set conflict are different answers`,
    );
  }
});
