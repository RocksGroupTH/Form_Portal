/**
 * How close an API key is to the expiry date somebody typed for it.
 * Pure — imports nothing, so it is unit-tested without a database.
 *
 * **Nothing here blocks a key from being used.** `resolveApiKey` hands back the
 * value whatever this says, and that is the decision, not an oversight: the
 * date is a human's note, unconnected to whatever the provider actually
 * enforces. Refusing a key on our own typed date would, on AP-17 — which
 * refuses an ID card it cannot verify — close the form for the whole company
 * while the real credential was still working. The tone drives colour and copy,
 * and that is all it drives.
 */

export type ExpiryTone =
  /** No date recorded — the "Non expiry" tick. Not a warning. */
  | "none"
  /** More than a month out. */
  | "ok"
  /** A month or less. */
  | "warn"
  /** A week or less, today included. */
  | "danger"
  /** The date has passed. */
  | "expired";

export interface ExpiryStatus {
  tone: ExpiryTone;
  /** Whole days from today to the date; negative once past; null with no date. */
  daysLeft: number | null;
}

/** Yellow from here in. */
const WARN_DAYS = 30;
/** Red from here in. */
const DANGER_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const NO_DATE: ExpiryStatus = { tone: "none", daysLeft: null };

/**
 * `YYYY-MM-DD` (what a DATE column and a `<input type="date">` both give) to a
 * local midnight. Built from the parts rather than `new Date(string)`, which
 * reads a bare date as UTC and lands on the previous day east of Greenwich —
 * the same trap `CLAUDE.md` names about `toISOString`.
 */
function localMidnightFromYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  // Rejects 2026-13-45 and friends: `new Date` rolls those over silently, so
  // compare the parts back. Garbage must read as "no date", never as "expired"
  // — painting a working key red is worse than saying nothing about it.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function describeExpiry(
  expiresAt: string | null | undefined,
  today: Date,
): ExpiryStatus {
  if (!expiresAt) return NO_DATE;
  const end = localMidnightFromYmd(expiresAt);
  if (!end) return NO_DATE;

  // Both ends at local midnight, so the answer does not change over the course
  // of a day — a morning check and an evening check of the same key agree.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysLeft = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);

  if (daysLeft < 0) return { tone: "expired", daysLeft };
  if (daysLeft <= DANGER_DAYS) return { tone: "danger", daysLeft };
  if (daysLeft <= WARN_DAYS) return { tone: "warn", daysLeft };
  return { tone: "ok", daysLeft };
}

/** Thai copy for the chip beside a key. */
export function expiryLabel(status: ExpiryStatus): string {
  switch (status.tone) {
    case "none":
      return "ไม่มีวันหมดอายุ";
    case "expired":
      return `หมดอายุแล้ว ${Math.abs(status.daysLeft ?? 0)} วัน`;
    case "danger":
    case "warn":
      return status.daysLeft === 0 ? "หมดอายุวันนี้" : `เหลือ ${status.daysLeft} วัน`;
    case "ok":
      return `เหลือ ${status.daysLeft} วัน`;
  }
}
