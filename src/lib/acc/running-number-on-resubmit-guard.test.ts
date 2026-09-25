import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **A returned request keeps the number it was already given.**
 *
 * Every form's `submitRequest` accepts `Returned` as well as `Draft`, because a
 * request sent back for revision is edited and resubmitted *in place* — same
 * row, same claim. Allocating a running number unconditionally therefore
 * renumbers it on every round trip, and the old number is left attached to
 * nothing at all while everyone who saw the request — the approver who returned
 * it, the requester's email, the ERP journal description, anything written
 * down — is still holding it.
 *
 * This has now happened three times in three different forms, and the activity
 * log recorded each one:
 *
 * | Form | Request | Trail |
 * | --- | --- | --- |
 * | AP-1 | 900009 | TOF26-09003 → returned → 09004 → returned → 09005 |
 * | AP-3 | 901142 | ADC26-09033 → returned → 09034 (then sent to ERP as 09034) |
 * | AP-2 | 901192 | ADV26-00051 → returned → 00056 (00051 now belongs to nothing) |
 *
 * AP-1 was fixed, and AP-4 and travel-booking were written against that fix —
 * their comments say so in as many words. AP-2 and AP-3 were not, and nothing
 * anywhere would have said so: the rule lives in one expression per service, in
 * five services, and it is invisible until somebody returns a request.
 *
 * So the rule is pinned here, over **every** service that allocates one, rather
 * than in each service's own tests. A sixth form added tomorrow joins this list
 * or this test fails, which is the only reason it can catch the next one.
 *
 * Two properties, and the second is not decoration:
 *
 * 1. **The allocation is guarded** by the number the row already has.
 * 2. **It happens inside the caller's transaction.** Allocated on the pool, a
 *    submit that then rolls back — a lost claim, a failed validation, a dropped
 *    connection — has still consumed a number, leaving a gap in a sequence
 *    people read as a ledger. `allocateRequestNo`'s own docblock says this.
 *
 * Source-reading because neither property survives into anything a test can
 * call: both are shapes of one expression, and this repository runs no database
 * in tests.
 */

const SRC = path.join(process.cwd(), "src");

/** Every service that hands a request its running number. */
const SUBMITTERS: { form: string; file: string; fn: string }[] = [
  { form: "AP-1", file: "lib/acc/request-service.ts", fn: "allocateRequestNo" },
  { form: "AP-2", file: "lib/adv/advance-request-service.ts", fn: "allocateAdvanceRequestNo" },
  { form: "AP-3", file: "lib/clr/clear-advance-request-service.ts", fn: "allocateRequestNo" },
  { form: "AP-4", file: "lib/acc/reimburse/request-service.ts", fn: "allocateRequestNo" },
  { form: "Travel", file: "lib/acc/travel-booking/request-service.ts", fn: "allocateRequestNo" },
];

/** Line endings are the machine's, not the repo's -- see adc-link-guard.test.ts. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The whole statement that allocates -- from the `const` that opens it to the
 * `;` that closes it. Sliced rather than regex-matched across the call so the
 * guard reads the guard clause and the argument list together, which is what
 * the two properties are about.
 */
function allocationStatement(src: string, fn: string): string | null {
  const call = src.indexOf(fn + "(");
  if (call === -1) return null;
  const open = src.lastIndexOf("const ", call);
  const close = src.indexOf(";", call);
  if (open === -1 || close === -1) return null;
  return src.slice(open, close + 1);
}

for (const { form, file, fn } of SUBMITTERS) {
  test(`${form} keeps the running number a returned request already has`, () => {
    const stmt = allocationStatement(code(file), fn);
    assert.ok(stmt, `no \`const ... ${fn}(\` statement in ${file} -- rewrite this guard, do not delete it`);

    assert.ok(
      /\|\|/.test(stmt as string),
      `${form} (${file}) allocates a running number unconditionally:` +
        `\n    ${(stmt as string).replace(/\s+/g, " ")}\n` +
        "A resubmit after ส่งกลับแก้ไข hits this same line, so the request is renumbered and " +
        "its old number is left attached to nothing. Guard it with the number the row already has.",
    );
  });

  test(`${form} allocates its running number inside the transaction`, () => {
    const stmt = allocationStatement(code(file), fn) as string;
    assert.ok(
      /\btx\b/.test(stmt),
      `${form} (${file}) allocates on the pool, not in the caller's transaction:` +
        `\n    ${stmt.replace(/\s+/g, " ")}\n` +
        "A submit that then rolls back has still consumed a number, leaving a gap in a " +
        "sequence people read as a ledger. Pass the transaction.",
    );
  });
}
