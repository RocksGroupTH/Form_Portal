import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Every path that decides the MANAGER step asks HR who the manager is **today**.
 *
 * ## Why source-reading, and what it is worth
 *
 * The rename from `canActManagerStep` / `canActManagerApi` to
 * `mayActOnManagerStep` / `mayActOnManagerStepApi` turned all thirteen call
 * sites into compile errors, which is what made the conversion safe to do in
 * one pass — the tactic `erp-interface-brand-source-guard.test.ts` records for
 * `isErpInterfaceBrand`, applied for the same reason: a silently-unchanged call
 * site on a money path.
 *
 * **What the typechecker cannot catch is the value.** `current` is
 * `CurrentManagerRef | null | undefined`, so `current: null` compiles perfectly
 * and restores the old snapshot-only behaviour on that one route, in silence —
 * no test fails, because none of these routes is reachable from a unit test
 * (each reaches `@/env` through a pool). This file is the only defence there
 * is, so it pins the value and not merely the call.
 *
 * It is a **source-text** check and therefore the weaker of two layers, exactly
 * as `queue-service-guard.test.ts`'s docblock argues for its own half: it
 * cannot prove the resolver returns the right person. `manager-auth.test.ts`
 * covers the rule itself, and the live behaviour was measured against both form
 * databases when this landed.
 *
 * Mutation-verified when written: `current: null` on any one of the ten shared
 * routes reds it, and so does dropping `currentManager?.staffId ??` from any of
 * AP-17's three.
 */

const API = path.resolve(process.cwd(), "src/app/api/request");

function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The ten routes that share `mayActOnManagerStep(Api)`.
 *
 * AP-1, AP-3 and AP-4 each have approve / reject / return; AP-4 has a fourth,
 * `approval-context`, which decides whether the page draws the buttons at all
 * and must therefore answer the same question the actions will.
 *
 * **AP-2 is absent and that is correct** — its chain is HEAD_ACC / DIRECTOR /
 * ACC_OFFICER off an amount matrix, with its own `HEAD_DEPT` retired, so it has
 * no manager step to decide.
 */
const SHARED_ROUTES = [
  "accounting/requests/[id]/approve",
  "accounting/requests/[id]/reject",
  "accounting/requests/[id]/return",
  "clear-advance/requests/[id]/approve",
  "clear-advance/requests/[id]/reject",
  "clear-advance/requests/[id]/return",
  "reimburse/requests/[id]/approve",
  "reimburse/requests/[id]/reject",
  "reimburse/requests/[id]/return",
  "reimburse/requests/[id]/approval-context",
];

/** AP-17 gates the step inline rather than through the shared helper. */
const AP17_ROUTES = [
  "travel-booking/requests/[id]/approve",
  "travel-booking/requests/[id]/reject",
  "travel-booking/requests/[id]/return",
];

test("every shared manager-step route hands the rule a LIVE manager, never null", () => {
  for (const route of SHARED_ROUTES) {
    const src = code(path.join(API, route, "route.ts"));

    assert.ok(
      /mayActOnManagerStep(Api)?\(/.test(src),
      `${route}: decides the manager step without the shared rule`,
    );

    // Every `current:` this file passes must read it off the record the detail
    // service resolved — `<rec>.currentManager`, directly or through a local.
    const currents = Array.from(src.matchAll(/\bcurrent:\s*([^,\n]+)/g)).map((m) =>
      m[1].trim(),
    );
    assert.ok(currents.length > 0, `${route}: passes no \`current\` at all`);
    for (const value of currents) {
      assert.notEqual(
        value,
        "null",
        `${route}: passes \`current: null\`, which silently restores the submit-time snapshot ` +
          "as the only answer — a manager replaced in HR would keep the step and the new one " +
          "would never get it",
      );
      assert.ok(
        /\bcurrentManager\b/.test(value),
        `${route}: \`current: ${value}\` does not come from the record's own \`currentManager\``,
      );
    }

    // A local alias must be the record's field, not a fresh resolve: resolving
    // twice can answer differently from the payload the page was drawn with.
    const alias = src.match(/const currentManager = ([^;\n]+);/);
    if (alias) {
      assert.ok(
        /\.currentManager$/.test(alias[1].trim()),
        `${route}: \`currentManager\` is ${alias[1].trim()} rather than the record's own field`,
      );
    }
  }
});

test("AP-17's three routes prefer the live manager over the stamped one", () => {
  for (const route of AP17_ROUTES) {
    const src = code(path.join(API, route, "route.ts"));

    assert.ok(
      src.includes("resolveCurrentManagerForRequest("),
      `${route}: never asks HR who the manager is`,
    );
    // `managerStaffId` is the effective answer these routes compare against, so
    // `isManager`, the on-behalf record and the dev-bypass fallback all follow
    // it without restating the rule. Losing the `??` here is the whole defect.
    assert.ok(
      /const managerStaffId = currentManager\?\.staffId \?\? snapshotManagerStaffId;/.test(src),
      `${route}: \`managerStaffId\` is no longer the live answer with the snapshot as fallback`,
    );
    // The requester has to be read, or the resolver cannot answer at all.
    assert.ok(
      /SELECT ManagerStaffId, StaffId, RequesterEmail/.test(src),
      `${route}: its AccRequest read no longer selects the requester the manager is resolved from`,
    );
  }
});

test("the detail reads that feed those routes resolve the manager themselves", () => {
  // The routes read `<rec>.currentManager` rather than resolving it, so the
  // resolution has to happen in the service. One HR round trip per detail read,
  // shared by the route, the ACL and the page's own button gate.
  const services = [
    "src/lib/acc/request-service.ts",
    "src/lib/acc/reimburse/request-service.ts",
    "src/lib/clr/clear-advance-request-service.ts",
    "src/lib/acc/travel-booking/request-service.ts",
  ];
  for (const file of services) {
    const src = code(path.resolve(process.cwd(), file));
    assert.ok(
      src.includes("resolveCurrentManagerForRequest("),
      `${file}: its detail read no longer resolves the current manager, so every consumer of ` +
        "`currentManager` silently falls back to the submit-time snapshot",
    );
  }
});
