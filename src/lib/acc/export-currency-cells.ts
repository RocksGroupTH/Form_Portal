import { isBaht, THB } from "./currency";

/**
 * The Excel export's three currency columns, in order:
 * `สกุลเงิน`, `ยอดตามสกุลเงิน`, `อัตราอ้างอิง`.
 *
 * Pure and import-light on purpose. Written inline inside the `aoa.push`
 * literal, the "THB" bug below was untestable in place — which is most of why
 * it survived.
 *
 * ── Which currency a claim is in ──
 *
 * Two designs are live at once. Migration 125 put one currency on the request;
 * migration 129 moved it to the expense LINE and `FX_CLEAR` now nulls the
 * header's on every AP-1 write. So the lines are asked first and the header is
 * the fallback for claims saved before the move and never re-saved.
 *
 * **Lines win when both are present.** They are the newer truth, and the header
 * on such a row is a leftover. This ordering is also the double-conversion
 * guard: `mapRow`'s day branch divides by the *header* `exchangeRate`, so the
 * two sets of facts must never be merged into one.
 *
 * ── Why the currency cell is never blank ──
 *
 * A column of blanks beside a column of `MYR` reads as "not recorded" rather
 * than "baht", and a filter on it would silently drop every ordinary claim. So
 * a baht claim says `THB` explicitly. The other two columns *are* blank for
 * baht: the figure is already in `ยอดรวม (บาท)` and repeating it would invite
 * somebody to add the two columns together.
 *
 * ── The mixed claim ──
 *
 * A claim holding a ringgit fare and a baht toll has no single foreign figure.
 * The SQL that feeds `lineCurrency` answers null for exactly that case rather
 * than summing the ringgit rows alone, and this function then reports `THB` with
 * no figure — because `ยอดรวม (บาท)` beside it genuinely is baht, and a partial
 * sum presented as the claim's foreign total is the wrong number stated
 * confidently.
 */
export interface ExportCurrencyRow {
  /** Migration 125's request-level facts. Null on every modern AP-1 claim. */
  currency?: string | null;
  exchangeRate?: number | null;
  foreignAmount?: number | null;
  /** Migration 129's line-level facts, summed — null when they cannot be summed. */
  lineCurrency?: string | null;
  lineForeignAmount?: number | null;
  lineExchangeRate?: number | null;
}

function code(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  return v.length > 0 ? v : null;
}

export function exportCurrencyCells(
  r: ExportCurrencyRow,
): [string, number | null, number | null] {
  const line = code(r.lineCurrency);
  if (line && !isBaht(line)) {
    return [line, r.lineForeignAmount ?? null, r.lineExchangeRate ?? null];
  }
  const header = code(r.currency);
  if (header && !isBaht(header)) {
    return [header, r.foreignAmount ?? null, r.exchangeRate ?? null];
  }
  return [THB, null, null];
}
