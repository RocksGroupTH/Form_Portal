import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { typedLineFigure, lineCurrencyOptions } from "./claim-currency";

/**
 * The client and the server must agree on **which stored field holds the figure
 * the requester typed**. They did not, and the disagreement silently changed a
 * claim's money.
 *
 * `typedLineFigure` (client, `claim-currency.ts`) resolves the line's effective
 * currency first: a baht-resolved line reads `amount`, a foreign one reads
 * `foreignAmount`.
 *
 * `typedFigure` (server, `request-service.ts`) used to ignore the currency and
 * return `foreignAmount` whenever it was non-null.
 *
 * They agreed everywhere except when a line's stored currency is no longer on
 * offer — a claim switched back to Thailand, or a brand whose foreign currency
 * was turned off. `resolveLineCurrency` answers `THB` there, so:
 *
 *   stored: amount 163.71, currency 'MYR', foreignAmount 20
 *   client shows 163.71 · server re-saved it as **20**
 *
 * The requester watched a figure change on save with only a "บันทึกร่างแล้ว"
 * toast to explain it, and submit did the same without pausing.
 *
 * `typedLineFigure` is the correct one: a converted baht figure is money that
 * was really worked out, and the line's own `amount` is where it lives.
 */

/** Every case where the two could differ, answered once. */
const CASES: ReadonlyArray<{
  name: string;
  item: { amount: number; currency: string | null; foreignAmount: number | null };
  options: readonly string[];
  expected: number;
}> = [
  {
    name: "a foreign line while its currency is offered reads the typed foreign figure",
    item: { amount: 163.71, currency: "MYR", foreignAmount: 20 },
    options: ["MYR", "THB"],
    expected: 20,
  },
  {
    name: "THE REGRESSION: a foreign line whose currency is no longer offered keeps its baht",
    item: { amount: 163.71, currency: "MYR", foreignAmount: 20 },
    options: [],
    expected: 163.71,
  },
  {
    name: "a baht line reads its amount even with a stray foreignAmount",
    item: { amount: 50, currency: "THB", foreignAmount: 999 },
    options: ["MYR", "THB"],
    expected: 50,
  },
  {
    name: "a plain baht line",
    item: { amount: 50, currency: null, foreignAmount: null },
    options: [],
    expected: 50,
  },
  {
    name: "an unanswered line falls back to what was typed",
    item: { amount: 0, currency: null, foreignAmount: 20 },
    options: ["MYR", "THB"],
    expected: 20,
  },
];

for (const c of CASES) {
  test(`client: ${c.name}`, () => {
    assert.equal(typedLineFigure(c.item, c.options), c.expected);
  });
}

/**
 * The server half needs a pool to import, so it is checked by reading its
 * source: `typedFigure` must consult the line's effective currency rather than
 * branching on `foreignAmount` alone. A signature that takes no currency cannot
 * possibly agree with the table above.
 */
test("the server's typedFigure decides on the currency, not on foreignAmount alone", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/acc/request-service.ts"),
    "utf8",
  );
  const start = src.indexOf("function typedFigure(");
  assert.notEqual(start, -1, "typedFigure has been renamed — update this guard");
  const body = src.slice(start, src.indexOf("\n}", start));

  assert.ok(
    /currency/i.test(body),
    "typedFigure must take the line's effective currency into account; without it a line " +
      "whose currency is no longer offered is re-saved at its foreign figure as though it were baht",
  );
});

test("lineCurrencyOptions is empty for Thailand, which is what triggers the case above", () => {
  assert.deepEqual(lineCurrencyOptions("TH"), []);
});
