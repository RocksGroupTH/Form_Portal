import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The document-lines panel fills the visible card, guarded at the source.
 *
 * `DETAIL_GRID`'s note in `ReimburseItemGrid.tsx` explains the arrangement: the
 * panel sits inside the horizontal scroller, `sticky left-0`, at the scroller's
 * own measured width, so it is readable without scrolling and cannot change the
 * scroller's content width. All of that depends on the measurement actually
 * happening.
 *
 * It did not. The scroller renders only under `items.length > 0`, a new AP-4
 * form seeds **zero** items (`seedItems`), and the measurement was a
 * `useLayoutEffect` with an empty dependency list reading `scrollerRef.current`
 * — null on that first render, so the effect returned early and the
 * ResizeObserver was never attached and never would be. `viewWidth` stayed 0
 * for the life of the component, the width fell back to `undefined`, and
 * `alignSelf: "flex-start"` then shrank the panel to its own text: a narrow box
 * beside a wide row, which is what a reader reports as "not full width".
 *
 * Both arms below are needed. The first is the fix; the second is what keeps an
 * unmeasured render from ever looking like that again.
 *
 * There is no DOM harness in this repository, so this reads the source, the way
 * `currency-surface-guard.test.ts` already does.
 */

const ROOT = path.resolve(process.cwd(), "src");
const GRID = "features/reimburse/components/ReimburseItemGrid.tsx";

/** Source with comments stripped, so a comment quoting a rule cannot satisfy it. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the scroller is measured as it mounts, not from a ref an effect read once", () => {
  const src = code(GRID);

  for (const hook of ["useLayoutEffect", "useEffect"]) {
    const re = new RegExp(`${hook}\(([\s\S]{0,600}?)\n\s*\}, \[\]\);`, "g");
    for (const m of Array.from(src.matchAll(re))) {
      assert.equal(
        /scrollerRef\s*\.\s*current/.test(m[1]),
        false,
        `a ${hook} with an empty dependency list reads scrollerRef.current. The scroller ` +
          "renders only once there is a row, so on a form that starts empty that ref is null " +
          "and the observer is never attached — measure through a callback ref instead",
      );
    }
  }

  assert.ok(
    /ref=\{measureScroller\}/.test(src),
    "the scroller must take the callback ref that attaches the ResizeObserver",
  );
});

test("a panel that has not been measured fills its container rather than its text", () => {
  const src = code(GRID);
  const width = src.split("\n").find((l) => /width:\s*viewWidth/.test(l));
  assert.ok(width, "no `width: viewWidth` line on the detail panel");
  assert.equal(
    /undefined/.test(width),
    false,
    'falling back to `undefined` leaves the panel with no width at all, and `alignSelf: ' +
      '"flex-start"` then shrinks it to its own text. Fall back to a full-width value',
  );
});
