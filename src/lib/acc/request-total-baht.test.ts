import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **`AccRequest.TotalAmount` is Thai baht, always.**
 *
 * Every summer, report, Excel export and Business Central journal in this
 * application reads that column and none of them knows what a currency is. A
 * foreign figure written into it is therefore not a display bug — it is a wrong
 * number in a financial posting, and no screen anywhere would reveal it.
 *
 * AP-1 has **three** writers of that column and the middle one is the trap: it
 * is not a save and not a submit, it is the recompute after a requester deletes
 * a receipt row, it runs outside a transaction, and it fires on an ordinary edit
 * of a claim that was already correct. Two separate reviews of this plan listed
 * two writers.
 *
 * Neither the writers nor the conversion is unit-testable — `request-service.ts`
 * needs a pool, and `@/env` validates the whole environment at import. So this
 * reads the source, in the shape `blocked-dates-parity.test.ts` and
 * `currency-pool-guard.test.ts` already use.
 *
 * If this goes red the fix is to route the new writer through
 * `bahtTotalOrThrow`, never to relax the count.
 */

const SERVICE = path.join(process.cwd(), "src/lib/acc/request-service.ts");

function code(): string {
  return fs
    .readFileSync(SERVICE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("AP-1 has exactly three AccRequest.TotalAmount writers, and every one converts", () => {
  const src = code();

  // `[dbo].[AccRequest] SET ... TotalAmount=@total` — the header column. The
  // per-day `AccTravelExpense` writes are deliberately NOT matched: that column
  // holds the claim's own currency and must stay unconverted.
  const headerWrites = src.match(/\[dbo\]\.\[AccRequest\][\s\S]{0,600}?TotalAmount=@total/g) ?? [];
  assert.equal(
    headerWrites.length,
    3,
    `expected 3 AccRequest.TotalAmount writers (persistTravelDays, deleteItem, submitRequest), found ${headerWrites.length}. ` +
      "A new one must convert with bahtTotalOrThrow before it binds @total.",
  );

  const converted = src.match(/\.input\("total",\s*sql\.Decimal\(18,\s*2\),\s*bahtTotalOrThrow\(/g) ?? [];
  assert.equal(
    converted.length,
    3,
    `every AccRequest.TotalAmount writer must bind @total from bahtTotalOrThrow; found ${converted.length} of 3`,
  );
});

test("no writer binds the claim's raw figure straight to @total", () => {
  const src = code();
  // The exact shape this feature replaced, at all three sites.
  assert.equal(
    /\.input\("total",\s*sql\.Decimal\(18,\s*2\),\s*(requestTotal|totalAmount)\s*\)/.test(src),
    false,
    "an unconverted claim figure is being bound to AccRequest.TotalAmount",
  );
});

/**
 * `toBaht` returns null when it cannot know, and the one thing that must never
 * happen is a fallback to the unconverted figure — see `acc/currency.ts`.
 */
test("bahtTotalOrThrow has no fallback branch", () => {
  const src = code();
  const start = src.indexOf("function bahtTotalOrThrow");
  assert.notEqual(start, -1, "bahtTotalOrThrow not found");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(/if \(baht === null\) throw/.test(body), "must throw on null, not fall back");
  assert.ok(!/\?\?\s*amount/.test(body), "must never fall back to the unconverted amount");
});

/**
 * The per-day column is the other half of the rule, and it is the half a reader
 * "tidying up" would break: converting it too would double-convert the header
 * and put baht into rows the ERP prep breakdown reads as the claim's currency.
 */
test("the per-day AccTravelExpense.TotalAmount stays in the claim's own currency", () => {
  const src = code();
  assert.ok(
    /\.input\("totalAmt", sql\.Decimal\(18, 2\), computeTotalAmount\(day\)\)/.test(src),
    "bindTravel must bind the day's own figure unconverted",
  );
  assert.ok(
    /UPDATE \[dbo\]\.\[AccTravelExpense\] SET TotalAmount=@total, TotalDistanceKm=@dist/.test(src),
    "deleteItem's per-day recompute must stay unconverted",
  );
});

/**
 * The client picks a currency; it never picks a rate. AP-2 lets the browser post
 * one and nothing verifies it there, which is the single part of that design
 * this feature deliberately does not reuse.
 */
test("SaveInput carries a currency and no rate", () => {
  const src = code();
  const start = src.indexOf("export interface SaveInput");
  assert.notEqual(start, -1);
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.ok(/currency\?:/.test(body), "SaveInput must accept the chosen currency");
  assert.ok(
    !/exchangeRate|rate\?:/.test(body),
    "SaveInput must NOT accept a rate — the server fetches it",
  );
});
