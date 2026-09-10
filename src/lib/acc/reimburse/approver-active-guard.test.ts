import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Who may move `AccReimburseApprover.IsActive`, and in which direction.
 *
 * **Measured, not argued.** The final whole-branch review reverted each of the
 * two statements below in turn and ran the suite: **1387 pass, 0 fail, both
 * times.** The rule this file pins is the branch's own Critical finding, and
 * it was the one rule guarded by a docblock rather than by anything that
 * fails. Every other rule of this shape here — the queue predicates, the route
 * gates, the brand-scope call sites — already carries a source-text guard, for
 * the reason those files state: a missing or altered authorization step is not
 * something a behavioural test notices going away.
 *
 * **The rule.** `IsActive` on an EXISTING row moves only through
 * `setReimburseAccessAndApprovalActive` (`./access-service.ts`, the PATCH),
 * and only ever to a value the brand ticks support. `setReimburseApproverBrands`
 * (`./settings-service.ts`, the tick path) writes it exactly once, on
 * `WHEN NOT MATCHED` — a brand-new person, where there is no prior state.
 *
 * **Two earlier versions of the tick path got this wrong in opposite
 * directions, and each looks like the fix for the other:**
 *
 * 1. `IsActive = @active` reactivated a deactivated approver as a side effect
 *    of an ordinary tick edit — the badge kept reading ปิด while the person
 *    could approve real payments again.
 * 2. `IsActive = CASE WHEN @active = 0 THEN 0 ELSE t.IsActive END` closed that
 *    and opened its mirror: untick a lone brand, re-tick it, and the row is
 *    stuck inactive with a visible tick — two clicks, in the commissioning
 *    flow the screen exists for.
 *
 * **What this file can and cannot do.** It reads source text, so it catches a
 * statement being edited back into either shape. It cannot verify what the SQL
 * *means* — this repo has already established that (`queue-policy.ts`), and
 * the test that could, exercising deactivate → re-tick against a real
 * database, cannot exist here because importing either service reaches
 * `@/env`. Somebody has to walk that sequence once against a live database
 * before this reaches production; this guard is what stops it silently
 * regressing afterwards.
 */

const SETTINGS_FILE = path.resolve(process.cwd(), "src/lib/acc/reimburse/settings-service.ts");
const ACCESS_FILE = path.resolve(process.cwd(), "src/lib/acc/reimburse/access-service.ts");

/** Comments quoting a rule must not satisfy it — the `code()` every guard here uses. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function bodyOf(src: string, name: string): string {
  const marker = [`export async function ${name}(`, `async function ${name}(`].find(
    (m) => src.indexOf(m) >= 0,
  );
  assert.ok(marker != null, `${name} not found — has it been renamed?`);
  const start = src.indexOf(marker!);
  const rest = src.slice(start + marker!.length);
  const next = rest.search(/\n(?:export async function|async function|function) /);
  return next === -1 ? src.slice(start) : src.slice(start, start + marker!.length + next);
}

test("the tick path never writes IsActive on an existing approver row", () => {
  const body = bodyOf(code(SETTINGS_FILE), "setReimburseApproverBrands");

  const merge = /WHEN MATCHED THEN UPDATE SET([\s\S]*?)WHEN NOT MATCHED/.exec(body);
  assert.ok(
    merge,
    "setReimburseApproverBrands no longer MERGEs AccReimburseApprover with a WHEN MATCHED / " +
      "WHEN NOT MATCHED pair — this assertion reads that statement's own MATCHED branch, so if " +
      "the shape changed it must be rewritten rather than deleted",
  );
  assert.doesNotMatch(
    merge![1],
    /IsActive/,
    "setReimburseApproverBrands' WHEN MATCHED branch names IsActive again. Ticking is about SCOPE; " +
      "activation is about the PERSON, and mixing them has already shipped two bugs in opposite " +
      "directions — `IsActive = @active` reactivated somebody an admin had switched off, and the " +
      "`CASE WHEN @active = 0` that fixed it left a re-ticked row stuck inactive forever. Writing " +
      "nothing here is what makes both impossible. The OFF direction is NOT lost: an approver with " +
      "no ticks has an empty scope, and canActOnTarget refuses an empty scope for every target, so " +
      "all five action paths still refuse — IsActive was never what enforced that",
  );
  assert.match(
    body,
    /WHEN NOT MATCHED THEN\s*INSERT \(StaffId, Email, DisplayName, IsActive, CreatedBy\)/,
    "setReimburseApproverBrands no longer inserts IsActive for a brand-new approver. That branch is " +
      "the ONE place this function may set the flag — there is no prior state to preserve — and " +
      "without it a first-time tick creates a row nobody can activate from this screen",
  );
});

test("the PATCH raises IsActive only when a brand tick actually exists", () => {
  const body = bodyOf(code(ACCESS_FILE), "setReimburseAccessAndApprovalActive");

  assert.match(
    body,
    /WHEN\s+@active\s*=\s*0\s+THEN\s+0/,
    "setReimburseAccessAndApprovalActive no longer forces AccReimburseApprover.IsActive to 0 when " +
      "the admin switches a row off. Deactivating must always succeed, whatever the ticks say — " +
      "it is the one control on that screen an admin uses to stop somebody approving",
  );
  assert.match(
    body,
    /EXISTS\s*\(\s*\n?\s*SELECT\s+1\s+FROM\s+\[dbo\]\.\[AccReimburseApproverBrand\]/,
    "setReimburseAccessAndApprovalActive no longer checks live for a brand tick before raising " +
      "IsActive to 1. Without it, reactivating somebody whose ticks were cleared makes them an " +
      "active approver with an empty scope — which every action then refuses, so they read as " +
      "working on the grid and are not",
  );
});

test("nothing else in either file writes AccReimburseApprover.IsActive", () => {
  // The whole rule rests on there being exactly two writers. A third — a
  // helper, a repair script, a convenience upsert — would not be caught by
  // either assertion above, because both are scoped to one function's body.
  // Counts every MENTION of the table, reads included, and pins the total.
  //
  // Blunter than matching writing verbs, and deliberately so: the PATCH is an
  // aliased `UPDATE a … FROM [dbo].[AccReimburseApprover] a`, which a
  // verb-then-table regex does not match at all — the first version of this
  // assertion used one and reported the PATCH as zero writers. A regex that
  // has to recognise every SQL shape a writer can take will keep being wrong
  // in that direction, which is the dangerous one. Counting mentions cannot
  // miss; the cost is that adding a read also fails this, and the message says
  // so.
  //
  // settings-service.ts: the roster SELECT, the MERGE, and the MERGE's own id
  // re-select. access-service.ts: the PATCH's UPDATE … FROM.
  for (const [label, file, expected] of [
    ["settings-service.ts", SETTINGS_FILE, 3],
    ["access-service.ts", ACCESS_FILE, 1],
  ] as const) {
    const mentions = code(file).split("[dbo].[AccReimburseApprover]").length - 1;
    assert.equal(
      mentions,
      expected,
      `${label} names [dbo].[AccReimburseApprover] ${mentions} time(s), not ${expected}. If what ` +
        "you added is a READ, raise this number. If it WRITES, stop: the two assertions above each " +
        "read one specific function's body and neither would see a third writer, and the whole " +
        "IsActive rule rests on there being exactly two — the tick path's MERGE (insert only) and " +
        "the PATCH's UPDATE (both directions, gated on a live EXISTS). Decide which direction the " +
        "new statement may move the flag and pin it here first",
    );
  }
});
