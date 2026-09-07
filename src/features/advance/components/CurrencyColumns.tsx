"use client";

import { AP2_DEFAULT_CURRENCY, isForeignCurrency } from "@/features/advance/constants";

/**
 * The currency conversion as four table columns instead of one packed cell.
 *
 * An advance entered in a foreign currency reaches the journal as baht, and an
 * officer approving or posting it needs to see how it got there — so currency,
 * the amount in it, the rate, and the resulting baht each get their own column
 * and line up down the table where the arithmetic can be checked at a glance.
 *
 * Shared by the approval queue and the ERP interface queue, which show the same
 * four columns; each passes its own cell padding so it keeps its table's rhythm.
 */

/** Just the conversion fields — any queue row satisfies this. */
export interface CurrencyRow {
  currency: string | null;
  amount: number | null;
  exchangeRate: number | null;
  baseAmount: number | null;
}

/** Header labels, in the same order as the cells CurrencyCells renders. */
export const CURRENCY_HEADERS = ["สกุลเงิน", "จำนวน (สกุลเงิน)", "อัตราแลกเปลี่ยน", "จำนวน (บาท)"] as const;

function money(n: number): string {
  return Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Four places, because that is what BOT quotes and what the request stored. */
function rate(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/**
 * A baht request has nothing to convert, so its foreign amount and rate read
 * "—" rather than repeating the baht and printing a rate of 1 that was never
 * actually applied.
 */
export function CurrencyCells({ row, cellClass = "px-2.5 py-2" }: { row: CurrencyRow; cellClass?: string }) {
  const foreign = isForeignCurrency(row.currency);
  const faint = { color: "var(--text-faint)" };
  const num = `${cellClass} whitespace-nowrap text-right tabular-nums`;
  return (
    <>
      <td className={`${cellClass} whitespace-nowrap font-mono text-[11px]`}
        style={{ color: foreign ? "var(--nav-active-text)" : "var(--text-muted)" }}>
        {row.currency ?? AP2_DEFAULT_CURRENCY}
      </td>
      <td className={num} style={foreign ? { color: "var(--text-secondary)" } : faint}>
        {foreign && row.amount != null ? money(row.amount) : "—"}
      </td>
      <td className={num} style={foreign ? { color: "var(--text-muted)" } : faint}>
        {foreign && row.exchangeRate != null ? rate(row.exchangeRate) : "—"}
      </td>
      <td className={`${num} font-semibold`} style={{ color: "var(--text-secondary)" }}>
        {money(row.baseAmount ?? 0)}
      </td>
    </>
  );
}
