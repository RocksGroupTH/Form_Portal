import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **A successful ส่งคำขอ must navigate to the detail page exactly once —
 * `handleSubmit`'s own `finally` block used to re-navigate right behind it.**
 *
 * Reported (2026-09-26): submitting AP-1 shows "ส่งคำขอแล้ว", then a centred
 * "กำลังโหลดแบบร่าง..." card flashes several times instead of settling once on
 * the detail page.
 *
 * `handleSubmit` (this file) saves the draft first when the form has never
 * been saved (`requestId` is still null), remembering the freshly minted id
 * as `justSavedId` so a *failed* submit can still send the URL to it — commit
 * `712e51e3`'s own words: "the draft EXISTS now even though the URL does not
 * say so … a failed submit would leave a saved draft the address bar cannot
 * return to". That commit's `finally` block called `onSaved?.(justSavedId)`
 * whenever `justSavedId !== null`, with a comment claiming it ran "only if
 * the submit did not navigate away" — but nothing in the code checked that.
 * `finally` runs on every path, including the one right after `onSubmitted?.
 * (id)` has *already* fired.
 *
 * `onSubmitted` (`travelExpenseDetailHref`, in the page) pushes to
 * `/request/travel-expense/{id}` — a different route segment from
 * `onSaved` (`travelExpenseFormHref`), which replaces to
 * `/request/travel-expense?id={id}`. Calling both, back to back with no
 * `await` between them, queues a `router.push` immediately followed by a
 * `router.replace` to a different segment. The replace wins the race, which
 * remounts `TravelExpensePage`/`TravelExpenseContent` on the FORM route with
 * `requestId` now read from the URL — whose `loading` state starts `true` on
 * that fresh mount, rendering exactly
 * `<TravelExpenseLoadingPopup label="กำลังโหลดแบบร่าง..." />` (the page's
 * default subtitle is "แบบฟอร์มเบิกค่าเดินทาง (AP-1)", matching the report
 * verbatim). That mount's own effect then fetches the (now `Submitted`, no
 * longer `EDITABLE_STATUSES`) request and immediately `router.replace`s BACK
 * to the detail page — a second segment bounce. Two navigations racing,
 * plus the page's own not-editable redirect, is what shows up as the loading
 * popup flashing rather than resolving once.
 *
 * `AdvanceForm.tsx`'s `handleSubmit` does not have this shape: `onSubmitted`
 * fires only in the success branch of its try, and `onSaved` only in the
 * `catch` — mutually exclusive by construction, never both in one pass.
 * `ClearAdvanceForm.tsx` and `ReimburseForm.tsx`'s own `handleSubmit`s are the
 * same shape (`onSubmitted` alone in `try`, no `onSaved` call in `finally` at
 * all). TravelExpenseForm's `handleSubmit` is the only one of the four that
 * calls `onSaved` from an unconditional `finally`.
 *
 * This is a source-shape guard rather than a rendered one: this repo has no
 * component test harness, `TravelExpenseForm.tsx` is a `"use client"`
 * component that reaches hooks needing a browser, and the failure is a
 * missing/wrong condition in a `useCallback` body — the same constraint every
 * other `*-guard.test.ts` in this codebase already works under (see e.g.
 * `room-share-control-guard.test.ts`). What it cannot cover is documented at
 * the end of the file this test lives beside — see the debugging report.
 */

const SRC = path.resolve(process.cwd(), "src");
const FORM = "features/accounting/components/TravelExpenseForm.tsx";

/** Source with comments stripped — this guard's own prose must never satisfy it. */
function code(rel: string): string {
  return fs
    .readFileSync(path.resolve(SRC, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The text of a balanced bracketed region that starts at the first `open`
 * after `marker`. Fail-closed: a marker not found, or a region that never
 * balances, is an assertion failure rather than an empty string that
 * satisfies everything asked of it.
 */
function balancedAfter(src: string, marker: string, open: "(" | "{"): string {
  const close = open === "(" ? ")" : "}";
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `${marker} not found — has it been renamed or removed?`);
  const start = src.indexOf(open, at + marker.length);
  assert.notEqual(start, -1, `no ${open} after ${marker}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail(`unbalanced ${open} after ${marker}`);
}

test("a successful submit records that it already navigated away", () => {
  const body = balancedAfter(
    code(FORM),
    "const handleSubmit = useCallback(async () => ",
    "{",
  );

  assert.match(
    body,
    /onSubmitted\?\.\(id\);\s*\n\s*[a-zA-Z_$][\w$]*\s*=\s*true;/,
    "onSubmitted?.(id) is no longer immediately followed by setting a flag to " +
      "true. Without one, the `finally` block below cannot tell a submit that " +
      "already navigated to the detail page from one that failed, and calling " +
      "onSaved unconditionally there fires a second, conflicting navigation " +
      "back to the form page — the flicker reported against ส่งคำขอ",
  );
});

test("handleSubmit's finally does not re-navigate after a successful submit already did", () => {
  const src = code(FORM);
  const body = balancedAfter(src, "const handleSubmit = useCallback(async () => ", "{");

  const flagMatch = body.match(/onSubmitted\?\.\(id\);\s*\n\s*([a-zA-Z_$][\w$]*)\s*=\s*true;/);
  assert.ok(
    flagMatch,
    "could not find the flag set immediately after onSubmitted?.(id) — see the " +
      "previous test for what that flag is for",
  );
  const flag = flagMatch![1];

  const finallyBlock = balancedAfter(body, "finally", "{");

  const guardedCatchup = new RegExp(
    `if\\s*\\(\\s*justSavedId\\s*!==\\s*null\\s*&&\\s*!${flag}\\s*\\)\\s*onSaved\\?\\.\\(justSavedId\\)`,
  );
  assert.match(
    finallyBlock,
    guardedCatchup,
    `the finally block's onSaved?.(justSavedId) call is not guarded on ` +
      `\`justSavedId !== null && !${flag}\`. Guarded on \`justSavedId !== null\` ` +
      "alone (the shape commit 712e51e3 shipped), it still fires after a " +
      "successful submit has already pushed the browser to the detail page — " +
      "queuing a second router.replace back to the form page's `?id=` route. " +
      "Because `/request/travel-expense` and `/request/travel-expense/[id]` are " +
      "different route segments, that second navigation remounts the form page " +
      "with a requestId read from the URL, which renders " +
      '`TravelExpenseLoadingPopup label="กำลังโหลดแบบร่าง..."` as its initial ' +
      "state — and that mount's own not-editable check then router.replaces " +
      "straight back to the detail page, bouncing between the two segments " +
      "instead of settling once. This is the reported flicker.",
  );

  // A regression that keeps the bare, unguarded call working alongside a
  // flag that is set but never read would satisfy the assertion above by
  // accident if the regex were loose; pin the specific failure shape away
  // directly too.
  assert.ok(
    !/if\s*\(\s*justSavedId\s*!==\s*null\s*\)\s*onSaved\?\.\(justSavedId\)/.test(finallyBlock),
    "the finally block calls onSaved?.(justSavedId) on `justSavedId !== null` " +
      "alone, with no check that the submit already navigated away",
  );
});
