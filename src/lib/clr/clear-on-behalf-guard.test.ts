import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Every route that takes a chosen person gates it with `assertMayClearFor`.**
 *
 * เคลียร์แทน lets one person raise an AP-3 clearing for a colleague, and two
 * places accept the colleague's `StaffId`: the draft save, which decides whose
 * claim it becomes, and the approved-advance dropdown, which reads that
 * person's money — number, amount, purpose and payee.
 *
 * Neither is protected by the picker. `resolveRequesterForActor` accepts **any**
 * active employee on purpose ("Widening this was asked for directly"), so the
 * same-department list the picker shows is presentation; `assertMayClearFor` is
 * the rule. A `?staffId=` with nothing in front of it would answer for anyone in
 * the company.
 *
 * Pinned over both call sites rather than in each one's own test, for the reason
 * the running-number and on-behalf-notification bugs found the same day both
 * share: a rule that lives in one line per site is invisible until somebody
 * counts the sites. A third route that takes a person joins this list or fails.
 */

const SRC = path.join(process.cwd(), "src");

/** Everything that accepts somebody else's StaffId for an AP-3 clearing. */
const TAKES_A_PERSON = [
  "app/api/request/clear-advance/pending-advances/route.ts",
  "lib/clr/clear-advance-request-service.ts",
];

/** Line endings are the machine's, not the repo's -- see adc-link-guard.test.ts. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

for (const file of TAKES_A_PERSON) {
  test(`${file} gates the chosen person with assertMayClearFor`, () => {
    const src = code(file);
    assert.ok(
      src.indexOf("assertMayClearFor(") !== -1,
      `${file} accepts somebody else's StaffId without calling assertMayClearFor. ` +
        "The picker offering one department is not a check — resolveRequesterForActor " +
        "answers for any active employee in the company",
    );
  });
}

test("the dropdown does not resolve a person it has not gated", () => {
  // Order matters and the compiler cannot see it: reading first and checking
  // afterwards would still have answered with the rows.
  const src = code(TAKES_A_PERSON[0]);
  const gate = src.indexOf("assertMayClearFor(");
  const read = src.indexOf("listPendingAdvances(");
  assert.notEqual(gate, -1, "no assertMayClearFor in the dropdown route");
  assert.notEqual(read, -1, "the dropdown route no longer calls listPendingAdvances");
  assert.ok(
    gate < read,
    "the dropdown route reads somebody's advances before it checks it may — " +
      "the refusal has to come first, or the answer is already out",
  );
});

test("the draft save gates before it resolves the requester", () => {
  const src = code(TAKES_A_PERSON[1]);
  const gate = src.indexOf("assertMayClearFor(");
  const resolve = src.indexOf("resolveRequesterForActor(loginEmail, input.staffId");
  assert.notEqual(gate, -1, "no assertMayClearFor in the draft save");
  assert.notEqual(resolve, -1, "saveDraft no longer resolves the chosen person");
  assert.ok(
    gate < resolve,
    "saveDraft resolves the chosen person before checking it may name them",
  );
});
