import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `AccTravelBookingDetail.TotalAmountBaht` (migration 136) is a STORED
 * derivation, and a stored derivation is only true while everything that can
 * move its inputs moves it too. Two rules keep it true, neither of which a type
 * can express, and both of which look like tidying to somebody who has not read
 * migration 136:
 *
 * 1. **One writer.** `recomputeBookingBaht` is the only statement in `src/` that
 *    writes the column. A second, written for one row or one screen, is how the
 *    siblings start quoting a rate the header no longer holds.
 * 2. **Every writer of `AccRequest.ExchangeRate` calls it, in the same
 *    transaction.** There are two — `saveBookingDetail` and `applyRateOverride`
 *    — and the second is shared with AP-1, so it is easy to change without AP-17
 *    in mind. A third added later must call it or the column silently lies on
 *    the sign-off screen the rate was corrected from.
 *
 * Not unit-testable directly: both writers need a pool, and `@/env` validates
 * the whole environment at import. So this reads the source, the shape
 * `booking-currency-guard.test.ts` and `currency-pool-guard.test.ts` use.
 */

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** POSIX-shaped, so an assertion reads the same on Windows as it does in CI. */
function rel(file: string): string {
  return path.relative(SRC, file).split(path.sep).join("/");
}

/** Comments quoting a rule must not satisfy or trip the check for it. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

const RECOMPUTE = path.join(SRC, "lib/acc/travel-booking/booking-baht.ts");

test("recomputeBookingBaht is the only writer of TotalAmountBaht", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    if (file === RECOMPUTE) continue;
    const src = code(fs.readFileSync(file, "utf8"));
    // A write is the column appearing to the left of `=` in a SET clause. A
    // SELECT of it, and the `totalAmountBaht` camelCase field the read shape
    // carries, are both fine and are what every reader does.
    if (/\bTotalAmountBaht\s*\]?\s*=/.test(src)) offenders.push(rel(file));
  }
  assert.deepEqual(
    offenders,
    [],
    "these write TotalAmountBaht directly instead of calling recomputeBookingBaht: " +
      offenders.join(", "),
  );

  // A guard on the guard: a rename would leave the loop above passing by
  // finding nothing to reject.
  assert.ok(
    /TotalAmountBaht\s*\]?\s*=/.test(code(fs.readFileSync(RECOMPUTE, "utf8"))),
    "booking-baht.ts no longer writes TotalAmountBaht — has the column been renamed?",
  );
});

test("every writer of AccRequest.ExchangeRate recomputes the stored baht figure", () => {
  const writers: string[] = [];
  const missing: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const src = code(fs.readFileSync(file, "utf8"));
    // `ExchangeRate=` inside an UPDATE of AccRequest. `SELECT … ExchangeRate`
    // and the camelCase read field are not writes.
    if (!/UPDATE\s+\[dbo\]\.\[AccRequest\][\s\S]{0,400}?ExchangeRate\s*=/.test(src)) continue;
    writers.push(rel(file));
    if (!/recomputeBookingBaht\s*\(/.test(src)) missing.push(rel(file));
  }

  // Both known writers must be found, or this test is inspecting nothing: the
  // statements are spelled differently in the two files and a change to either
  // spelling would silently empty the list.
  assert.deepEqual(
    writers.sort(),
    ["lib/acc/rate-override.ts", "lib/acc/travel-booking/admin-service.ts"].sort(),
    "the set of AccRequest.ExchangeRate writers changed — a new one must call recomputeBookingBaht",
  );

  assert.deepEqual(
    missing,
    [],
    "these write AccRequest.ExchangeRate without recomputing AP-17's stored baht figure, " +
      "leaving every booking row of the request quoting the rate that was replaced: " +
      missing.join(", "),
  );
});

/**
 * The one defect this shape can produce. A reader that both multiplies by the
 * header rate and reads the stored column has two answers to one question, and
 * the stored one is already converted.
 *
 * `AdminBookingPanel` is the deliberate exception and is excluded by name: it
 * multiplies the figure the desk is TYPING, for a live preview a stored column
 * cannot give, and it never reads `totalAmountBaht`. The exclusion is by
 * filename rather than by a heuristic so that it stays a decision somebody took.
 */
test("no reader both converts and reads the stored baht figure", () => {
  const PREVIEW_EXCEPTION = path.join(SRC, "features/travel-booking/components/AdminBookingPanel.tsx");
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    if (file === PREVIEW_EXCEPTION) continue;
    const src = code(fs.readFileSync(file, "utf8"));
    if (!/totalAmountBaht|TotalAmountBaht/.test(src)) continue;
    if (/\b(toBaht|amountInBaht)\s*\(/.test(src)) offenders.push(rel(file));
  }

  assert.deepEqual(
    offenders,
    [],
    "these read the stored baht figure AND convert with a rate — one of the two is a " +
      "double conversion: " + offenders.join(", "),
  );

  assert.ok(
    /toBaht\s*\(/.test(code(fs.readFileSync(PREVIEW_EXCEPTION, "utf8"))),
    "AdminBookingPanel no longer converts — if its live preview now reads the stored " +
      "column, drop this exception rather than leaving a name excluded for nothing",
  );
});
