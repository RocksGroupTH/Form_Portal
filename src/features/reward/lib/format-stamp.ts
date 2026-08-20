/**
 * Rendering an AP-11 timestamp without moving it seven hours.
 *
 * The server runs Thai time and `SYSDATETIME()` writes a bare wall clock into
 * `DATETIME2` — no offset is stored, because there is nothing in the column to
 * store one in. The driver reads that column as UTC (tedious' default), so the
 * `Date` that reaches `.toISOString()` carries the Thai wall clock in its **UTC**
 * fields: a row written at 17:13 in the office serialises as
 * `2026-08-20T17:13:00.000Z`.
 *
 * Read that back with `getHours()` in a UTC+7 browser and you get 00:13 the
 * next day — the office clock plus the offset, applied to a value that never
 * had one. `submitted at 2026-08-21 00:13` for something submitted on the
 * afternoon of the 20th.
 *
 * So the UTC accessors are the correct ones here, and they are not a timezone
 * conversion: they are how you read back the fields the wall clock was put
 * into. The value is a local Thai time from end to end, and this renders it
 * unchanged on any machine — which is what an internal Thai portal wants, and
 * why nothing here calls `toLocaleString`.
 *
 * This does not contradict CLAUDE.md's "use local getters, never toISOString()"
 * rule. That one is about a `DATE` column — a travel date, a payment date —
 * where midnight-UTC shifted by a negative offset lands on the previous day.
 * These are timestamps that have already been through `toISOString()` on the
 * way out of the API.
 *
 * The AP-1 and AP-17 detail pages have the same +7 shift for the same reason
 * (`fmtDate` in `RequestDetail.tsx`, `fmtDateTime` in `ApprovalQueueFilters.tsx`
 * — both `.toISOString()` on the server, both local getters on the client). They
 * are deliberately left alone here; fixing them is a separate, wider change.
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD HH:mm`, or `—`. */
export function fmtStamp(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** `DD/MM/YYYY HH:mm`, or `—` — the draft picker's shape. */
export function fmtStampShort(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** `YYYY-MM-DD`, or `—`. The day the timestamp fell on in the office. */
export function fmtDay(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
