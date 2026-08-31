import { test } from "node:test";
import assert from "node:assert/strict";
import { exportCurrencyCells } from "./export-currency-cells";

/**
 * The Excel export's three currency columns: สกุลเงิน, ยอดตามสกุลเงิน,
 * อัตราอ้างอิง.
 *
 * This is the surface that matters most to get right and mattered least to the
 * code: a spreadsheet leaves the application. Nobody reading it can click
 * through to the detail page that would correct it, and it is forwarded,
 * filtered and archived. Until 2026-08-31 the first column printed the literal
 * "THB" for every ringgit claim — AP-1 stopped writing the request-level
 * currency when currency moved to the line (migration 129), so `isBaht(null)`
 * was true for all of them. A filter on `สกุลเงิน = THB` therefore returned a
 * clean-looking list that silently contained every foreign claim.
 */

const row = (o: Partial<Parameters<typeof exportCurrencyCells>[0]> = {}) => ({
  currency: null,
  exchangeRate: null,
  foreignAmount: null,
  lineCurrency: null,
  lineForeignAmount: null,
  lineExchangeRate: null,
  ...o,
});

test("an ordinary baht claim reads THB, with no figure and no rate", () => {
  assert.deepEqual(exportCurrencyCells(row()), ["THB", null, null]);
});

test("THE BUG: a claim whose LINES are ringgit no longer reads THB", () => {
  const cells = exportCurrencyCells(
    row({ lineCurrency: "MYR", lineForeignAmount: 40, lineExchangeRate: 8.1856 }),
  );
  assert.deepEqual(cells, ["MYR", 40, 8.1856]);
  assert.notEqual(cells[0], "THB");
});

/** Migration 125's claims, saved before currency moved to the line. */
test("a legacy header-level foreign claim still reports itself", () => {
  assert.deepEqual(
    exportCurrencyCells(row({ currency: "MYR", foreignAmount: 25, exchangeRate: 8.1 })),
    ["MYR", 25, 8.1],
  );
});

/**
 * The double-conversion guard, in unit form. A claim that has been re-saved
 * carries both, and the lines are the newer truth.
 */
test("when both are present the lines win", () => {
  assert.deepEqual(
    exportCurrencyCells(
      row({
        currency: "MYR", foreignAmount: 25, exchangeRate: 8.1,
        lineCurrency: "MYR", lineForeignAmount: 40, lineExchangeRate: 8.1856,
      }),
    ),
    ["MYR", 40, 8.1856],
  );
});

/**
 * A claim mixing a ringgit fare with a baht toll IS the normal foreign claim —
 * a Malaysian trip books Grab in ringgit and pays a Thai toll in baht the same
 * day. The SQL sums the ringgit lines alone and reports them, because the
 * column's question is "was any of this filed in a foreign currency, and how
 * much of it". The baht lines' money is in ยอดรวม (บาท) where it belongs.
 *
 * Answering THB here is what the original bug did, for a different reason and
 * with the same output — so this case is the one to keep an eye on.
 */
test("a mixed claim reports the foreign lines' own total, not THB", () => {
  assert.deepEqual(
    exportCurrencyCells(row({ lineCurrency: "MYR", lineForeignAmount: 60, lineExchangeRate: 8.1856 })),
    ["MYR", 60, 8.1856],
  );
});

/** Only a claim with no foreign line at all reports baht. */
test("a claim with no foreign line reports THB and nothing else", () => {
  assert.deepEqual(exportCurrencyCells(row({ lineCurrency: null, lineForeignAmount: null })), [
    "THB", null, null,
  ]);
});

/** One claim can legitimately hold two rates — a draft saved across two days. */
test("a foreign claim with no single rate still names its currency and figure", () => {
  assert.deepEqual(
    exportCurrencyCells(row({ lineCurrency: "MYR", lineForeignAmount: 40, lineExchangeRate: null })),
    ["MYR", 40, null],
  );
});

test("the currency cell is never blank, which is what a filter relies on", () => {
  for (const r of [
    row(),
    row({ lineCurrency: "MYR", lineForeignAmount: 40 }),
    row({ currency: "THB" }),
    row({ currency: "" }),
  ]) {
    const [code] = exportCurrencyCells(r);
    assert.equal(typeof code, "string");
    assert.ok((code as string).length > 0);
  }
});

test("a code is normalised the way every other currency comparison normalises", () => {
  assert.deepEqual(
    exportCurrencyCells(row({ lineCurrency: " myr ", lineForeignAmount: 40 })),
    ["MYR", 40, null],
  );
});
