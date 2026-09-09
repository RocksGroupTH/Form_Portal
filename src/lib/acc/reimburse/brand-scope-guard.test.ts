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
 * cannot prove the queues filter the RIGHT rows — an accumulator whose
 * predicate is subtly inverted would satisfy every assertion here. That is
 * what the BEHAVIOURAL tests are for: `queue-service.test.ts` and
 * `erp-queue-service.test.ts` hand `accumulateAccountQueueRows` /
 * `accumulateErpQueueRows` (`queue-policy.ts`, `erp-queue-policy.ts`) rows
 * shaped exactly like the failure — an out-of-scope brand, an unmapped brand,
 * `scope === null` — and check what comes back. Neither layer is sufficient
 * alone, the same conclusion `queue-service-guard.test.ts`'s own docblock
 * reaches for the SQL-text half of that queue's defence.
 *
 * **Round 1 (2026-09-10): a source-shape presence check ("is
 * `requireApproverScopeFor(` called somewhere in this function") is not
 * enough, and review measured why with two mutations that both passed the
 * full suite:**
 *
 *  - `await requireApproverScopeFor(actor, "PCTH");` — a hardcoded brand.
 *    Loud for a KSI-only approver (refused everywhere); silent for a
 *    PCTH-scoped one (approves every brand's claims) — the exact hole this
 *    task exists to close.
 *  - `try { await requireApproverScopeFor(actor, await claimedBrandCode(tx,
 *    requestId)); } catch {}` — a swallowed refusal.
 *
 * Both are closed by pinning the WHOLE statement, not just the function name
 * — `CALL_STATEMENT` below, anchored to line start (`^\s*`) and line end
 * (`;$`) with the `m` flag, so `try {` on the same line cannot satisfy it.
 * (A `try` wrapped around the statement on ITS OWN separate lines is not
 * caught by this — an inherent limit of a source-text pin the file header
 * already names; catching that needs the transaction to actually roll back on
 * a thrown scope refusal, which is what the FIVE existing behavioural
 * `AccForbiddenError` shapes in `approval-service.ts` establish and nothing
 * in this file can re-prove without a database.)
 */

const SERVICE_FILE = path.resolve(
  process.cwd(),
  "src/lib/acc/reimburse/approval-service.ts",
);
const REPORT_SERVICE_FILE = path.resolve(process.cwd(), "src/lib/acc/report-service.ts");
const QUEUE_POLICY_FILE = path.resolve(process.cwd(), "src/lib/acc/reimburse/queue-policy.ts");
const ERP_QUEUE_POLICY_FILE = path.resolve(process.cwd(), "src/lib/acc/reimburse/erp-queue-policy.ts");

/** Comments quoting the rule must not satisfy it — matches every sibling guard file's own `code()`. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Slices one exported function's own body out of a whole (comment-stripped)
 * source string, bounded by the next top-level function declaration — so a
 * call present ANYWHERE in the file cannot pass an assertion that is supposed
 * to be about one specific function alone. Generic over both `name` and the
 * already-stripped `src` it is handed, so the same helper works for
 * `approval-service.ts` and, for the pairing sweep below, whatever exported
 * name it is asked about.
 */
function bodyOf(src: string, name: string): string {
  // Exported first, then the private form. Round 7 added assertions about
  // `claimedBrandCode` and `requireApproverScopeFor`, which are file-local —
  // the export-only version raised "has it been renamed?" on two functions
  // that were sitting right there, which is the wrong failure and would have
  // been read as a rename rather than as a helper limitation.
  const marker = [`export async function ${name}(`, `async function ${name}(`].find(
    (m) => src.indexOf(m) >= 0,
  );
  const start = marker == null ? -1 : src.indexOf(marker);
  assert.ok(
    start >= 0 && marker != null,
    `${name} not found (as \`async function ${name}(\`, exported or not) — has it been renamed?`,
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

/**
 * The exact statement every one of the five must contain, on its own line.
 * Not `requireApproverScopeFor\s*\(` — see the file header for the two
 * mutations that regex let through. Pins:
 *  - the call is present at all;
 *  - it is `await`ed (a dropped `await` fails to match `^\s*await`);
 *  - it is not wrapped in a same-line `try { … } catch {}` (fails to match
 *    `^\s*await`, since the line then starts with `try`);
 *  - the SECOND argument is `await claimedBrandCode(tx, requestId)` verbatim
 *    — not a hardcoded literal, not a variable that could hold anything else.
 */
const CALL_STATEMENT =
  /^\s*await requireApproverScopeFor\(actor, await claimedBrandCode\(tx, requestId\)\);$/m;

test("every one of the five action paths contains the exact, unguarded, awaited scope-check statement", () => {
  const src = code(SERVICE_FILE);
  for (const name of ACTIONS) {
    const body = bodyOf(src, name);
    assert.ok(
      CALL_STATEMENT.test(body),
      `${name} does not contain \`await requireApproverScopeFor(actor, await claimedBrandCode(tx, ` +
        "requestId));\` on its own line, unindented past leading whitespace and unwrapped. A scoped " +
        "approver holding this request's id (a link, a bookmark, a page loaded before their scope " +
        "narrowed) could act on a brand outside the Interface group they were granted — or, if the " +
        "call is present but its brand argument is not `await claimedBrandCode(tx, requestId)`, could " +
        "be checked against the wrong brand entirely",
    );
  }
});

/**
 * The pairing that makes `ACTIONS` maintainable, mirroring
 * `booking-brand-scope-guard.test.ts`'s own `offenders` sweep: every EXPORTED
 * function in the file is walked, and the predicate is exact — a function
 * calling `requireApproverStaffId` (the membership check) must also call
 * `requireApproverScopeFor` (the per-row check), and a function calling
 * NEITHER must not call the other either. A sixth accounting action added
 * later that asks "is this actor an approver" without also asking "of THIS
 * claim's brand" fails here without anybody remembering to extend `ACTIONS`.
 */
test("every exported function that checks approver membership also checks brand scope, and only those do", () => {
  const src = code(SERVICE_FILE);
  const names = Array.from(src.matchAll(/\nexport async function (\w+)\(/g)).map((m) => m[1]);
  assert.ok(names.length >= ACTIONS.length, "no exported functions found — has the file moved?");

  const offenders: string[] = [];
  for (const name of names) {
    const body = bodyOf(src, name);
    const callsStaffId = /requireApproverStaffId\s*\(/.test(body);
    const callsScope = /requireApproverScopeFor\s*\(/.test(body);
    if (callsStaffId !== callsScope) {
      offenders.push(`${name} (calls requireApproverStaffId=${callsStaffId}, requireApproverScopeFor=${callsScope})`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these exported functions disagree about calling requireApproverStaffId vs requireApproverScopeFor " +
      "— a function asking whether the actor is an approver at all but never asking whether THIS " +
      "claim's brand is in their scope (or the reverse, which should be impossible) is exactly the gap " +
      `ACTIONS above exists to catch by name: ${offenders.join(", ")}`,
  );
});

/**
 * The accumulators' `scope`/`claimTargets` parameters must be required, with
 * no default — mirrors `booking-brand-scope-guard.test.ts`'s identical pin on
 * AP-17's `access: BookingBrandAccess`. An optional parameter defaulting to
 * `[]` or an unrestricted stand-in is how a caller added later gets an
 * unscoped queue with no compile error and no red test — TypeScript would not
 * catch it, because a missing optional argument is valid.
 */
test("the two accumulators take REQUIRED scope and claimTargets parameters, with no default", () => {
  const targets: [string, string][] = [
    [QUEUE_POLICY_FILE, "accumulateAccountQueueRows"],
    [ERP_QUEUE_POLICY_FILE, "accumulateErpQueueRows"],
  ];
  for (const [file, fn] of targets) {
    const src = code(file);
    const m = new RegExp(`export function ${fn}\\s*\\(([^)]*)\\)`).exec(src);
    assert.ok(m, `${fn} not found in ${path.basename(file)} — has it been renamed?`);
    const params = m![1];
    assert.ok(
      /\bscope\s*:\s*readonly string\[\]\s*\|\s*null\b/.test(params),
      `${fn} must take a REQUIRED \`scope: readonly string[] | null\` parameter`,
    );
    assert.ok(
      !/\bscope\s*\?\s*:/.test(params) && !/\bscope\b[^,)]*=/.test(params),
      `${fn}'s scope parameter must have no \`?\` and no default value`,
    );
    assert.ok(
      /\bclaimTargets\s*:\s*ReadonlyMap</.test(params),
      `${fn} must take a REQUIRED \`claimTargets: ReadonlyMap<string, string>\` parameter`,
    );
    assert.ok(
      !/\bclaimTargets\s*\?\s*:/.test(params) && !/\bclaimTargets\b[^,)]*=/.test(params),
      `${fn}'s claimTargets parameter must have no \`?\` and no default value`,
    );
  }
});

/**
 * `listMyWorkRows`' AP-4 arm had NO guard of any kind until this round —
 * measured: deleting all ten lines of its `AND EXISTS (…
 * AccReimburseApproverBrand …)` block leaves `npm test` and `tsc --noEmit`
 * both green, because the orphaned `perFormPredicate`/`perFormOrderBy`
 * imports do not fail the build and nothing behavioural exercises
 * `listMyWorkRows` at all (it reaches `getAccPool` → `@/env`, so it cannot be
 * unit-tested with a plain array the way `queue-policy.ts`'s accumulators
 * can). This is the one surface of the three this task scopes — the two
 * queues and `/my-work` — that has no accumulator to hand a shaped row to, so
 * a source-shape pin is the only defence available at all, not merely the
 * outer layer beside a stronger inner one.
 */
test("listMyWorkRows' AP-4 arm still resolves brand scope through AccBrandErpInterface", () => {
  const src = code(REPORT_SERVICE_FILE);
  const marker = "export async function listMyWorkRows(";
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "listMyWorkRows not found in report-service.ts — has it been renamed?");
  const rest = src.slice(start + marker.length);
  const next = rest.search(/\nexport async function /);
  const body = next === -1 ? src.slice(start) : src.slice(start, start + marker.length + next);

  for (const marker2 of ["AccReimburseApproverBrand", "AccBrandErpInterface", "perFormPredicate("]) {
    assert.ok(
      body.includes(marker2),
      `listMyWorkRows no longer names ${marker2} — its AP-4 arm's brand-scope EXISTS clause has been ` +
        "weakened or removed. AccReimburseApprover roster membership alone is not enough since " +
        "migration 144: a roster row must ALSO map to one of the approver's ticked Interface targets, " +
        "through AccBrandErpInterface's per-form default/override (perFormPredicate/perFormOrderBy) " +
        "— removing any of the three silently widens /my-work back to pre-scoping behaviour for " +
        "every AP-4 approver",
    );
  }

  // **Token presence catches deletion and weakening; it does not catch
  // INVERSION.** A re-review changed `AND EXISTS (` to `AND NOT EXISTS (` —
  // one word — and all three tokens above stayed put while every AP-4
  // approver's My Work filled with exactly the claims OUTSIDE their scope and
  // none of the ones inside it. Measured green. This surface has no
  // behavioural test at all (the query needs a pool), so the polarity has to
  // be pinned here or nowhere.
  assert.ok(
    /AND\s+EXISTS\s*\(\s*\n?\s*SELECT\s+1\s+FROM\s+\[dbo\]\.\[AccReimburseApproverBrand\]/.test(body),
    "listMyWorkRows' AP-4 brand-scope clause is no longer `AND EXISTS (SELECT 1 FROM " +
      "[dbo].[AccReimburseApproverBrand] …`. A NOT EXISTS here inverts the whole control: every " +
      "approver sees precisely the claims they may NOT act on, and none of the ones they may — " +
      "while the three token assertions above stay green, because inversion removes nothing",
  );
});

/* ─────────── Round 7: what the CALL-SITE pin above cannot reach ───────────
 *
 * Every assertion above pins the five call sites. A re-review then moved each
 * of them one level away and measured 1384/1384 green each time. The four
 * below close the reachable ones. They are not a claim to have closed the
 * class — see this file's own closing note.
 */

test("claimedBrandCode really reads the claim's own BrandCode from the database", () => {
  const body = bodyOf(code(SERVICE_FILE), "claimedBrandCode");
  // The call-site pin says every path passes `await claimedBrandCode(tx,
  // requestId)`, and its failure message claims that stops a claim being
  // "checked against the wrong brand entirely". It does not: `return "PCTH";`
  // in here satisfies every one of those pins and checks every claim in the
  // system against PCTH. C1's mutation, relocated by one function.
  assert.ok(
    /\[dbo\]\.\[AccRequest\]/.test(body) && /BrandCode/.test(body) && /@id/.test(body),
    "claimedBrandCode no longer SELECTs BrandCode from [dbo].[AccRequest] by @id. Every scope check " +
      "in this file is only as good as what this function returns — a constant here is checked " +
      "against by all five paths and refuses nobody, while every call-site assertion above stays green",
  );
  assert.ok(
    /res\.recordset\[0\]\?\.BrandCode/.test(body),
    "claimedBrandCode no longer returns the row's own BrandCode — it queries and then answers " +
      "something else, which is the same hole with one more step in it",
  );
});

test("each action path opens exactly one transaction, so the check cannot be moved after the commit", () => {
  // A re-review lifted the pinned statement into a SECOND `inTransaction`
  // after the first: `tx` stays in scope so `tsc` is clean, the pinned line
  // stays byte-for-byte intact, and the approval — status transition, closed
  // approval row, activity log — COMMITS before the out-of-scope approver is
  // refused. Measured green. One transaction per path is the invariant that
  // makes "inside the transaction that claims the row" mean anything.
  const src = code(SERVICE_FILE);
  for (const name of ACTIONS) {
    const body = bodyOf(src, name);
    const opens = body.split("inTransaction(").length - 1;
    assert.equal(
      opens,
      1,
      `${name} opens ${opens} transactions, not 1. The scope check is only "inside the transaction ` +
        `that claims the row" while there is one transaction to be inside; a second one after the ` +
        `first lets the approval commit and refuses afterwards, with every call-site pin still green`,
    );
  }
});

test("requireApproverScopeFor still refuses on canActOnTarget's answer alone", () => {
  const body = bodyOf(code(SERVICE_FILE), "requireApproverScopeFor");
  // `canActOnTarget` is behaviourally tested in brand-scope.test.ts; that this
  // function GATES on it is not, and nothing else covers this body — the
  // loaders it calls reach a pool. `if (!canActOnTarget(...) && <anything>)`
  // was measured green.
  assert.ok(
    /if\s*\(\s*!canActOnTarget\(\s*scope\s*,\s*target\s*\)\s*\)\s*\{/.test(body),
    "requireApproverScopeFor no longer refuses on `if (!canActOnTarget(scope, target))` alone. An " +
      "extra conjunct there — `&& target === '__never__'` was the measured version — makes the throw " +
      "unreachable while every call site still calls this function and awaits it",
  );
  assert.ok(
    /if\s*\(\s*scope\s*==\s*null\s*\)\s*\{/.test(body),
    "requireApproverScopeFor no longer refuses a null scope. `null` means no active approver row at " +
      "all, and it must not fall through to canActOnTarget, whose contract is about an EMPTY scope",
  );
});
