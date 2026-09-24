import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Two decisions in the G/L-suggest feature that a later edit would undo while
 * believing it was tidying up, and that neither `tsc` nor a rendered component
 * can catch here.**
 *
 * Both are source scans. That is a weak form of test and it is chosen on
 * purpose in both cases — the reasons differ and are given at each one.
 *
 * ## 1 · The model calls stay sequential
 *
 * `runGlSuggestions` awaits one `suggest` at a time, and `gl-suggest-run.test.ts`
 * already proves it behaviourally: the descending-delay test fails if the calls
 * overlap. That test is the real one and this does not repeat it.
 *
 * What this adds is the name of the mistake at the point somebody makes it.
 * `Promise.all` over that loop reads like an obvious optimisation; whoever
 * writes it is not expecting to be wrong, and an event-order assertion failing
 * in another file leaves them to work out why from the outside. The line below
 * says it in the same breath as the edit: twenty lines on a claim is twenty
 * model calls at once, on a button an accountant presses repeatedly.
 *
 * The comment strip is not decoration here. `gl-suggest-run.ts` explains in
 * prose *why* it is not `Promise.all`, twice — a docblock section and the line
 * above the loop — so a scan of the raw text would fail on the very file that
 * is correct. Note which way that cuts: a stripper that stopped stripping makes
 * this guard fail loudly on good source, not pass quietly on bad.
 *
 * ## 2 · The suggest button does not appear where the server forces the account
 *
 * For a brand that is not the home company the server overwrites every line's
 * G/L with `FORCE_GL_NON_ROCKS_PC` on save, `GlCell` renders a read-only chip
 * instead of a picker, and the route refuses with 400. The button is hidden on
 * the same test, so all three agree.
 *
 * Neither repo can render a component in a test, so "the button is not shown"
 * is not assertable here at all. The honest substitute is the structural
 * property that makes it true: `isRocksPcBrand` is called **once** in the file,
 * one `glForced` is derived from it, and both the button's render guard and the
 * cell's prop read that one binding. They cannot then disagree about which
 * claim this is — which is the actual hazard, since a second brand test added
 * beside the first is exactly how the chip and the button would drift apart.
 *
 * **Not a veto.** Either decision can be reversed; it just has to be reversed
 * knowingly, and this file is where the next reader finds out what it cost.
 */

const SRC = path.join(process.cwd(), "src");

/** The loop that makes the model calls. */
const RUN = "lib/clr/gl-suggest-run.ts";
/** The shell around it — it reaches the model through `runGlSuggestions` too. */
const ROUTE = "app/api/request/clear-advance/requests/[id]/suggest-gl/route.ts";
/** The AP-3 account step: the button, and the cell it must agree with. */
const SCREEN = "features/clear-advance/components/ClearAdvanceDetail.tsx";

/**
 * One file's text, CRLF normalised away.
 *
 * Files in this tree are checked out with either ending, and a `\n`-anchored
 * pattern matches nothing at all against `\r\n` — silently, which for a guard
 * means a permanent pass. Normalise before anything reads the text.
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

/** Comments naming a rule must not satisfy the check for it — this file's header included. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * A string that must survive the strip, per file.
 *
 * A scan that finds nothing passes forever, and the way this one would come to
 * find nothing is the stripper eating the file rather than the file moving.
 * These are the lines that actually reach the model.
 */
const ANCHOR: Record<string, string> = {
  [RUN]: "await suggest(",
  [ROUTE]: "runGlSuggestions(",
};

for (const file of [RUN, ROUTE]) {
  test(`${file} asks the model one line at a time`, () => {
    const src = code(file);

    assert.ok(
      src.includes(ANCHOR[file]),
      `src/${file} no longer contains ${JSON.stringify(ANCHOR[file])} once comments ` +
        "are stripped, so this guard is scanning nothing and would pass whatever the " +
        "file said. Either the call moved — point ANCHOR at where it went — or the " +
        "comment stripper above is eating source",
    );

    /* The matched text, not the match object: `assert.equal` prints its actual
       value, and a RegExpExecArray carries the whole file in `input`, which
       buries the message below under a page of source. */
    const found = /\bPromise\s*\.\s*(all|allSettled)\b/.exec(src)?.[0] ?? null;
    assert.equal(
      found,
      null,
      `src/${file} runs its G/L suggestions through ${found} — these are model ` +
        "calls, one per line of the claim, and a twenty-line claim would fire twenty " +
        "at once behind a button an accountant presses repeatedly. That is a rate " +
        "limit, and there is nothing to win: the normal case is a handful of lines. " +
        "Keep the `for` loop awaiting one `suggest` at a time. The behaviour itself " +
        "is pinned by the descending-delay test in gl-suggest-run.test.ts; this line " +
        "exists to say why before you go and read it. If concurrency is genuinely " +
        "wanted it needs a bounded pool and a deliberate decision, not Promise.all",
    );
  });
}

test("the suggest button and the G/L cell read one and the same glForced", () => {
  const src = code(SCREEN);

  const brandTests = src.match(/\bisRocksPcBrand\s*\(/g) ?? [];
  assert.equal(
    brandTests.length,
    1,
    `src/${SCREEN} calls isRocksPcBrand ${brandTests.length} time(s); it must call it ` +
      "exactly once. A non-home brand has every line's G/L overwritten with " +
      "FORCE_GL_NON_ROCKS_PC on save, so the picker is a read-only chip, the route " +
      "answers 400, and the suggest button must not be offered. A second brand test " +
      "is how the chip and the button come to disagree about which claim this is — " +
      "compute `glForced` once and let both read it. Zero means the derivation was " +
      "renamed or removed and this guard has stopped guarding anything",
  );

  const decls = src.match(/\bconst\s+glForced\s*=/g) ?? [];
  assert.equal(
    decls.length,
    1,
    `src/${SCREEN} declares glForced ${decls.length} time(s). There is one brand and ` +
      "one answer to whether the server forces its account; two bindings is two " +
      "answers waiting to differ",
  );
  assert.match(
    src,
    /\bconst\s+glForced\s*=[^;]*\bisRocksPcBrand\s*\(/,
    `src/${SCREEN} declares glForced without deriving it from isRocksPcBrand. The one ` +
      "brand test and the one flag have to be the same statement, or the single call " +
      "asserted above is no longer the thing the button and the cell both read",
  );

  assert.match(
    src,
    /<GlCell\b[\s\S]{0,600}?\bglForced=\{glForced\}/,
    `src/${SCREEN} no longer passes glForced={glForced} to <GlCell>. The read-only chip ` +
      "and the suggest button have to be driven by the same value; if the prop was " +
      "renamed, rename it in the button's guard in the same commit, and here",
  );

  const at = src.indexOf("void suggestGl()");
  assert.ok(
    at > 0,
    `src/${SCREEN} has no onClick calling suggestGl() — this guard cannot find the ` +
      "button and is asserting nothing about it. If the handler was renamed, rename " +
      "it here too",
  );

  /* The innermost `{… && (` opened before the button's onClick: in JSX that is
     the conditional the element renders under. Brace-free by construction, so a
     match cannot straddle the stripped JSX comment or the `disabled={…}` between. */
  const openers = src.slice(0, at).match(/\{[^{}]{0,300}?&&\s*\(/g) ?? [];
  const guard = openers[openers.length - 1] ?? "";
  assert.match(
    guard,
    /!\s*glForced\b/,
    `the suggest button in src/${SCREEN} renders under ${JSON.stringify(guard)}, which ` +
      "does not test glForced. On a non-home brand every line's account is replaced " +
      "with FORCE_GL_NON_ROCKS_PC when the grid is saved and the route refuses with " +
      "400, so the button could only spend model calls on a value already thrown away " +
      "— and it would sit beside a picker that is a read-only chip, offering to fill " +
      "in something the officer can plainly see is not fillable. Put `!glForced &&` " +
      "back at the front of the guard, reading the same binding <GlCell> is handed",
  );
});
