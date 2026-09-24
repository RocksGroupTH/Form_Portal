import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **An AP-1 approver with no ticks approves nothing.**
 *
 * It used to approve *everything*. `AccApproverInterfaceBrand` stores one row
 * per ticked interface target, and zero rows was read as unrestricted — so an
 * approver nobody had scoped could act on every brand, while the settings grid
 * showed their row with every box empty. Measured 2026-09-24: one of seven
 * active approvers was in exactly that state, and **nobody was scoped to KSI at
 * all**, so KSI claims were actionable only through that fail-open. The user
 * ruled it out that day — "ไม่ได้ติ๊ก brand ไหนเลย ต้องไม่ขึ้น" — accepting
 * that KSI then has no approver until somebody is ticked for it.
 *
 * **Nothing in this repository failed when the rule was inverted**, which is
 * the reason this file exists. `resolveApproverInterfaceAccess` reaches
 * `getAccPool` and cannot be called from a test at all, and the whole suite
 * stayed green through a change that took an approver from every brand to
 * none. A source pin is the only layer available.
 *
 * It is deliberately narrow: two literals, in one file. Restoring either is a
 * decision somebody has to argue for here, in front of the measurement above.
 */

const SRC = path.resolve(process.cwd(), "src/lib/acc/approver-interface-access.ts");

function code(): string {
  return fs
    .readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("zero ticked rows resolve to zero brands, never to a null that means 'all'", () => {
  const src = code();
  assert.match(
    src,
    /list && list\.length > 0 \? normalizeCodes\(list, known\) : \[\]/,
    "an approver with no rows must map to [] — `: null` is the fail-open that let them approve every brand",
  );
});

test("this resolver never grants allAccess", () => {
  /* AP-17's own resolver still grants it to an admin role and the two share a
     type, so the field stays; what must not come back is AP-1 handing it out
     from an empty scope — or from a failed read of the scope table, which is
     the `null` branch and is now the same answer. */
  const src = code();
  assert.doesNotMatch(
    src,
    /allAccess:\s*true/,
    "AP-1 scopes every approver by their ticks; nothing here may return allAccess: true",
  );
  assert.match(
    src,
    /return \{ allAccess: false, allowedCodes: codes \?\? \[\] \};/,
    "the final resolve must answer the ticks, and no brands when there are none or the table could not be read",
  );
});
