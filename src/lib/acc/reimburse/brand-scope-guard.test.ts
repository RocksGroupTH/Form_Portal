import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Brand scoping is only a control if it holds on the paths that ACT, not
 * merely on the ones that list. Filtering a queue hides rows; a scoped
 * approver holding an id from a link, a bookmark, or a page loaded before
 * their scope narrowed still reaches the action. So both halves are required
 * and neither substitutes for the other — see `requireApproverScopeFor`'s own
 * docblock in `approval-service.ts` for the full argument.
 *
 * Shaped after `src/lib/acc/travel-booking/booking-brand-scope-guard.test.ts`,
 * AP-17's identical guard for its own five (there, route-level) act paths.
 * The difference here is where the five paths live: AP-4's are five SERVICE
 * functions in one file, not five API routes, so this file enumerates them by
 * name rather than walking a directory of `route.ts` files.
 *
 * **This is source-reading, and it is the WEAKER of two layers — say so.** It
 * can only prove `requireApproverScopeFor` is named, called, and awaited
 * inside each function's own body. It cannot prove the value passed in is the
 * request's OWN brand rather than a hardcoded one, and it cannot prove the
 * queues filter the RIGHT rows — a correctly-shaped call fed a wrong value, or
 * an accumulator whose predicate is subtly inverted, would satisfy every
 * assertion here. That is what the BEHAVIOURAL tests are for:
 * `queue-service.test.ts` and `erp-queue-service.test.ts` hand
 * `accumulateAccountQueueRows` / `accumulateErpQueueRows` (`queue-policy.ts`,
 * `erp-queue-policy.ts`) rows shaped exactly like the failure — an out-of-
 * scope brand, an unmapped brand, `scope === null` — and check what comes
 * back. A missing call is what this file catches; a wrong filter is what
 * those catch. Neither layer is sufficient alone, the same conclusion
 * `queue-service-guard.test.ts`'s own docblock reaches for the SQL-text half
 * of that queue's defence.
 */

const SERVICE_FILE = path.resolve(
  process.cwd(),
  "src/lib/acc/reimburse/approval-service.ts",
);

/** Comments quoting the rule must not satisfy it — matches every sibling guard file's own `code()`. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Slices one exported function's own body out of the whole (comment-stripped)
 * file, bounded by the next top-level function declaration — so a call
 * present ANYWHERE in the file cannot pass an assertion that is supposed to
 * be about one specific action alone.
 */
function bodyOf(src: string, name: string): string {
  const marker = `export async function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(
    start >= 0,
    `${name} not found in approval-service.ts (as \`export async function ${name}(\`) — has it been ` +
      "renamed or had its export dropped?",
  );
  const rest = src.slice(start + marker.length);
  const next = rest.search(/\n(?:export async function|async function|function) /);
  return next === -1 ? src.slice(start) : src.slice(start, start + marker.length + next);
}

/**
 * The five action paths the brief names, in file order. `setReimburseItemAccounts`
 * is not a state transition (`Status`/`CurrentStepCode` do not move) but it
 * repoints where a claim's money posts from the accounting queue, and is
 * authorized identically to `approveReimburseAccountCheck` — see its own
 * docblock.
 */
const ACTIONS = [
  "approveReimburseAccountCheck",
  "approveReimburseFinal",
  "rejectReimburse",
  "returnReimburse",
  "setReimburseItemAccounts",
];

test("every one of the five action paths calls requireApproverScopeFor", () => {
  const src = code(SERVICE_FILE);
  for (const name of ACTIONS) {
    const body = bodyOf(src, name);
    assert.ok(
      /requireApproverScopeFor\s*\(/.test(body),
      `${name} acts on an AP-4 claim without calling requireApproverScopeFor — a scoped approver ` +
        "holding this request's id (a link, a bookmark, a page loaded before their scope narrowed) " +
        "could act on a brand outside the Interface group they were granted",
    );
  }
});

test("every call to requireApproverScopeFor in the five action paths is awaited, not merely constructed", () => {
  const src = code(SERVICE_FILE);
  for (const name of ACTIONS) {
    const body = bodyOf(src, name);
    // Only meaningful once the presence test above is green; skipping here
    // avoids this test's failure message masking that one's during a drill.
    if (!/requireApproverScopeFor\s*\(/.test(body)) continue;
    assert.ok(
      /\bawait\s+requireApproverScopeFor\s*\(/.test(body),
      `${name} calls requireApproverScopeFor without awaiting it — a Promise built and dropped is a ` +
        "refusal that resolves after this function has already returned (worse, after the " +
        "transaction has already committed), so an out-of-scope action would still succeed",
    );
  }
});
