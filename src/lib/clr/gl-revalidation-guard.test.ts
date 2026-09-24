import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Skipping the re-validation on the history path is invisible, and this
 * names the mistake at the point somebody makes it.**
 *
 * AP-3's suggest button fills a line's G/L account from one of two places:
 * history (the account an officer already chose for this same description at
 * this same kind of branch) or the model. Both are only an answer on the same
 * terms — matched against the very candidate list the picker offers that
 * line's branch — and `acceptedCandidate` in `gl-suggest-run.ts` is the one
 * gate both paths call. `gl-suggest-run.test.ts` already proves this
 * behaviourally: "a remembered account the branch may no longer charge falls
 * through to the model".
 *
 * That behavioural test is the real one, and this file does not repeat it —
 * a reader who finds both is meant to see WHY there are two, not delete one as
 * a duplicate. What a behavioural test cannot say is why the history path in
 * particular is the dangerous one to get wrong. The model path has an obvious
 * failure mode: an invented or out-of-branch account fails the same test the
 * very first time it is exercised, in an unfamiliar way an engineer would
 * chase down. The history path fails differently. The value came from the
 * database, it looks exactly like a real account, and it lands in a
 * spreadsheet nobody re-reads line by line — an account that was right once
 * can since have been deactivated, blocked, or moved out of this branch's
 * dimension type, and skipping the check there is silent for months, not
 * seconds. So this is a source scan for the shape of that specific mistake:
 * `acceptedCandidate` stops being exported (nothing outside the module could
 * pin it down any more, and the next edit inlines it), or one of its two call
 * sites is replaced with its own `candidates.find(...)` that a later change
 * can let drift from the other.
 *
 * Source-reading, not an import: `gl-suggest-run.ts` is importable on its own
 * (unlike its route), but the property here is about the SHAPE of the code —
 * exported or not, one gate or two — which a behavioural test cannot observe
 * even when the module is imported. A test can only ask "did this call
 * happen to check", never "is there exactly one function capable of checking
 * for anybody who calls it".
 */

const SRC = path.join(process.cwd(), "src");

const RUN = "lib/clr/gl-suggest-run.ts";

/**
 * One file's text, CRLF normalised away.
 *
 * This module is checked out with either line ending in this tree, and a
 * `\n`-anchored slice — which the brace count below effectively is, since it
 * walks the text index by index — silently matches nothing against `\r\n`,
 * so the guard would pass without having scanned anything. This has already
 * happened once in this work; normalise before anything else touches the text.
 */
function read(relative: string): string {
  const abs = path.join(SRC, relative);
  assert.ok(
    fs.existsSync(abs),
    `src/${relative} is not where this guard expects it. If the file moved, move ` +
      "the constant at the top of this file with it — a guard pointed at nothing " +
      "passes forever",
  );
  return fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n");
}

/** Comments naming the rule must not satisfy the check for it — this file's own header included. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The declaration this guard pins. If `export` is dropped this string stops matching. */
const DECLARATION = "export function acceptedCandidate(";

/**
 * `acceptedCandidate`'s own body: from its declaration to ITS OWN matching
 * closing brace, found by depth-counting braces rather than by looking for
 * the next top-level declaration — `runGlSuggestions` follows it in the file,
 * but nothing about that ordering is a contract, and depth-counting is
 * correct however the file is reordered.
 *
 * Slicing this out before counting is the whole method: without it, the
 * declaration's own "acceptedCandidate(" and its own internal
 * "candidates.find(" would be indistinguishable from a second call site or a
 * bypass, and every assertion below would be counting the wrong thing.
 */
function helperSpan(src: string): { start: number; end: number } {
  const start = src.indexOf(DECLARATION);
  assert.notEqual(
    start,
    -1,
    `${JSON.stringify(DECLARATION)} not found in src/${RUN} once comments are stripped. Either ` +
      "acceptedCandidate lost its export — which is exactly the regression this guard exists " +
      "to catch, so do not silently update this constant to match — or it was renamed, in which " +
      "case update DECLARATION here to match",
  );
  const openBrace = src.indexOf("{", start);
  assert.notEqual(openBrace, -1, `no "{" found after acceptedCandidate's declaration in src/${RUN}`);

  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  assert.fail(`acceptedCandidate's opening brace in src/${RUN} is never closed — unbalanced braces`);
}

/** `src` with `acceptedCandidate`'s own declaration and body cut out entirely. */
function withoutHelper(src: string, span: { start: number; end: number }): string {
  return src.slice(0, span.start) + src.slice(span.end);
}

test("acceptedCandidate is exported", () => {
  const src = code(RUN);
  // helperSpan already asserts the declaration is found; this test exists so
  // a failure here reads as "no longer exported" rather than as a side effect
  // of the call-count test below.
  helperSpan(src);
  assert.ok(
    src.includes(DECLARATION),
    `acceptedCandidate in src/${RUN} is no longer declared with export. A helper nothing outside ` +
      "the module can reach cannot be pinned from here, and the next likely edit is inlining it " +
      "into one call site and not the other — which is exactly the drift this function exists to " +
      "prevent",
  );
});

test("acceptedCandidate is called exactly twice outside its own declaration", () => {
  const full = code(RUN);
  const span = helperSpan(full);
  const outside = withoutHelper(full, span);

  const calls = outside.match(/\bacceptedCandidate\s*\(/g) ?? [];
  assert.equal(
    calls.length,
    2,
    `acceptedCandidate is called ${calls.length} time(s) outside its own declaration in ` +
      `src/${RUN}, not 2. The whole point of this function is that BOTH the remembered account ` +
      "and the model's answer are checked against the same candidate list before either is used " +
      "— one call means one of those two paths stopped going through the gate (most likely the " +
      "remembered-account path, since it is the one that fails silently: a deactivated, blocked, " +
      "or re-dimensioned account looks exactly like a live one until somebody tries to post it). " +
      "More than 2 is a new caller that needs the same scrutiny as the original two before it counts",
  );
});

test("nothing outside acceptedCandidate re-implements its own candidates.find", () => {
  const full = code(RUN);
  const span = helperSpan(full);
  const inside = full.slice(span.start, span.end);
  const outside = withoutHelper(full, span);

  // Proves the slice actually landed on the real implementation, not on
  // nothing: if the body no longer contains its own candidates.find, either
  // acceptedCandidate was rewritten to gate some other way (fine, but this
  // guard's premise moved with it and needs a look) or helperSpan sliced the
  // wrong range and the assertion below is checking an empty claim.
  assert.ok(
    inside.includes("candidates.find("),
    "sanity check failed: acceptedCandidate's own sliced body no longer contains " +
      "candidates.find( — either the helper was rewritten to check the candidate list a " +
      "different way (update this guard to match) or helperSpan is slicing the wrong range, " +
      "in which case the assertion below is checking nothing",
  );

  const bypass = /candidates\.find\(/.exec(outside);
  assert.equal(
    bypass,
    null,
    `src/${RUN} contains a candidates.find(...) outside acceptedCandidate's own body. That is ` +
      "what a bypass of the shared gate looks like: a remembered account or a model answer " +
      "checked by a hand-rolled lookup instead of acceptedCandidate is checked by code the other " +
      "call site does not share, and the two are free to drift apart. Route it through " +
      "acceptedCandidate instead",
  );
});
