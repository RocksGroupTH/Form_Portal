import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * What AP-1's **request detail page** must go on saying about a filed claim.
 *
 * This is the screen an approver reads immediately before deciding to pay, and
 * the two things it was asked to show are both the kind a later edit undoes by
 * accident: an itemised breakdown that has to agree with the total printed above
 * it, and an exchange rate that has to be the **stored** one rather than
 * today's. Neither is reachable from a unit test — both are which helper a
 * component calls — so this reads the source, in the shape
 * `currency-surface-guard.test.ts` and `rate-provenance-guard.test.ts` already
 * use.
 *
 * If one of these goes red the fix is to restore the property, never to relax
 * the check.
 */

const ROOT = path.resolve(process.cwd(), "src");
const DETAIL = "features/accounting/components/RequestDetail.tsx";

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so a comment quoting a rule cannot satisfy it. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** A named declaration's body, ending where the next top-level one begins. */
function block(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `${decl} not found`);
  const next = src.indexOf("\nfunction ", start + 1);
  const alt = src.indexOf("\nexport function ", start + 1);
  const end = next === -1 ? alt : alt === -1 ? next : Math.min(next, alt);
  assert.notEqual(end, -1, `no declaration follows ${decl}`);
  return src.slice(start, end);
}

/** Every argument list passed to `name(`, paren-balanced so nesting is safe. */
function callArgs(src: string, name: string): string[] {
  const out: string[] = [];
  const needle = name + "(";
  let at = src.indexOf(needle);
  while (at !== -1) {
    let depth = 0;
    let i = at + needle.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(at + needle.length, i));
    at = src.indexOf(needle, i);
  }
  return out;
}

/* ── The breakdown agrees with the total ── */

/**
 * `dayCostBreakdown` is built branch-for-branch alongside `computeTotalAmount`
 * and `calc.test.ts` asserts the parts sum to it. A second implementation on
 * this page would be a second answer to what a day cost, and the first thing
 * anybody does with two disagreeing figures is trust the wrong one.
 */
test("the detail page itemises days from the shared breakdown, not its own", () => {
  const src = code(DETAIL);
  assert.ok(
    /import \{[^}]*dayCostBreakdown[^}]*\} from "@\/lib\/acc\/calc"/.test(src),
    "the breakdown must come from calc.ts, where the sum invariant is tested",
  );
  const body = block(src, "function DayCostParts");
  assert.equal(
    callArgs(body, "dayCostBreakdown").length,
    1,
    "DayCostParts must take its parts from exactly one dayCostBreakdown call",
  );
  // No arithmetic of its own — that is how a re-derivation creeps back in.
  assert.equal(
    /[*+]\s*(?:rate|ratePerKm|km)\b/.test(body),
    false,
    "DayCostParts must not recompute a part; it renders what calc.ts returned",
  );
});

/** The per-day list is where the itemisation was asked for. */
test("each day in the summary card renders its own breakdown", () => {
  assert.ok(
    /<DayCostParts day=\{d\}/.test(code(DETAIL)),
    "the per-day summary rows must render DayCostParts",
  );
});

/* ── The rate is the stored one, dated ── */

/**
 * The whole reason migration 130 exists. A rate fetched on render would print
 * today's number beside a figure converted weeks ago, and nothing on screen
 * would say the two were different questions.
 */
test("the detail page never fetches an exchange rate", () => {
  const src = code(DETAIL);
  for (const forbidden of ["@/lib/acc/fx", "bot-fx", "/api/acc/fx"]) {
    assert.equal(
      src.indexOf(forbidden) !== -1,
      false,
      `the detail page reaches a rate provider (${forbidden}); it must read the stored rate`,
    );
  }
});

/**
 * **Every** rate caption on this page carries the day the rate is from. This was
 * the one `referenceRateNote` call in the application still passing two
 * arguments, so this screen alone showed a rate with no date against it — which
 * reads as more certain than it is.
 */
test("every reference-rate caption on the page passes its as-of date", () => {
  const calls = callArgs(code(DETAIL), "referenceRateNote");
  assert.ok(calls.length >= 2, `expected the legacy and per-line captions, found ${calls.length}`);
  for (const args of calls) {
    assert.equal(
      args.split(",").length,
      3,
      `a rate caption omits its date: referenceRateNote(${args})`,
    );
    assert.ok(
      /asOf|rateAsOf/i.test(args),
      `a rate caption's third argument is not an as-of date: referenceRateNote(${args})`,
    );
  }
});

/** The caption itself is never retyped — one sentence to be right about. */
test("the page writes no rate sentence of its own", () => {
  const src = code(DETAIL);
  assert.equal(
    src.indexOf("ธนาคารแห่งประเทศไทย") !== -1,
    false,
    "every rate here is an ECB mid-market reference rate, never a Bank of Thailand one",
  );
  assert.equal(
    /อัตราอ้างอิง 1 /.test(src),
    false,
    "the reference-rate sentence belongs to referenceRateNote, not to this page",
  );
});

/**
 * A hand-corrected rate is one person's figure, reproducible from no feed at
 * all. It must never be shown as though a provider had published it.
 */
test("an overridden rate names itself on the detail page too", () => {
  const body = block(code(DETAIL), "function ClaimRateNotes");
  assert.ok(
    /isOverriddenRate\(/.test(body),
    "a corrected rate must be marked, not shown as a published one",
  );
});

/* ── A baht claim gains nothing ── */

/**
 * The promise the whole currency feature is held to, and the one most easily
 * broken. One predicate is what keeps it checkable rather than hoped for: a
 * condition retyped per branch is how the third copy comes to disagree.
 */
test("all currency markup on the page hangs off a single predicate", () => {
  const src = code(DETAIL);
  assert.ok(
    /const showsRateStrip = claimIsForeign \|\| rateFacts\.length > 0;/.test(src),
    "the one test for 'does this claim show a rate' must stay one test",
  );
  const uses = src.match(/showsRateStrip/g) ?? [];
  assert.ok(uses.length >= 3, `expected the strip and the total row to share it, found ${uses.length}`);
  // And the facts it is built from are empty for a baht claim, which
  // `claim-rates.test.ts` asserts directly.
  assert.ok(
    /claimRateFacts\(travelDays\)/.test(src),
    "the per-line rates must come from the tested helper",
  );
});

/** Tokens only, in the two components this work added. */
test("the new blocks use theme tokens, never a raw colour", () => {
  const src = code(DETAIL);
  for (const decl of ["function DayCostParts", "function ClaimRateNotes"]) {
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(block(src, decl)),
      false,
      `${decl} contains a raw colour; use var(--token)`,
    );
  }
});
