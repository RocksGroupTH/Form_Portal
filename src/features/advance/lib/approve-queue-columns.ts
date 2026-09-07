/**
 * Column model for the AP-2 approval queue — which columns exist, how each one
 * reads as text, and how the reader's shown/hidden and dragged order survive a
 * reload. Same shape the AP-2-Control report uses, kept out of the component so
 * the table markup stays readable.
 *
 * The checkbox and the preview button are not here: they are controls, not data,
 * so they are never hidden, never reordered and never filtered on.
 */

export type QueueFilterKind = "text" | "select";

export interface ApproveQueueColumn {
  key: string;
  label: string;
  /** Right-align the cell and its header — numbers only. */
  numeric?: boolean;
  /** What kind of header filter the column offers, if any. */
  filter?: QueueFilterKind;
}

/**
 * Canonical order. Everything is offered; nothing is excluded, because unlike
 * the report this table has no export whose column positions other people's
 * spreadsheets depend on.
 */
export const APPROVE_QUEUE_COLUMNS: ApproveQueueColumn[] = [
  { key: "requestNo", label: "เลขที่", filter: "text" },
  { key: "company", label: "Company", filter: "select" },
  { key: "requester", label: "ผู้ขอ", filter: "text" },
  { key: "payee", label: "ผู้รับเงิน", filter: "text" },
  { key: "currency", label: "สกุลเงิน", filter: "select" },
  { key: "amount", label: "จำนวน (สกุลเงิน)", numeric: true },
  { key: "exchangeRate", label: "อัตราแลกเปลี่ยน", numeric: true },
  { key: "baseAmount", label: "จำนวน (บาท)", numeric: true },
  { key: "vendor", label: "Vendor", filter: "text" },
  { key: "step", label: "ขั้น", filter: "select" },
];

/** Shown on a first visit — the whole set; the reader trims from here. */
export const DEFAULT_VISIBLE: Record<string, boolean> = APPROVE_QUEUE_COLUMNS.reduce(
  (acc, c) => ({ ...acc, [c.key]: true }),
  {} as Record<string, boolean>,
);

export const COLS_STORAGE_KEY = "ap2-approve-cols";
/** Separate from the visibility key, so a reader who had hidden columns keeps
 *  that choice and simply starts from the canonical order. */
export const ORDER_STORAGE_KEY = "ap2-approve-col-order";

const CANONICAL = APPROVE_QUEUE_COLUMNS.map((c) => c.key);

/**
 * The reader's order, reconciled against the columns that exist today: stored
 * keys that no longer exist are dropped, and any column the stored list has
 * never seen is appended rather than lost — otherwise a column added in a later
 * release would be invisible to everyone who had ever dragged one, with nothing
 * on screen to explain why.
 */
export function mergeOrder(stored: string[]): string[] {
  const known = new Set(CANONICAL);
  const kept = stored.filter((k) => known.has(k));
  const seen = new Set(kept);
  return [...kept, ...CANONICAL.filter((k) => !seen.has(k))];
}

export function loadStoredOrder(): string[] {
  if (typeof window === "undefined") return CANONICAL;
  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    if (!raw) return CANONICAL;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some((k) => typeof k !== "string")) return CANONICAL;
    return mergeOrder(parsed as string[]);
  } catch {
    return CANONICAL;
  }
}

export function loadStoredVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return DEFAULT_VISIBLE;
  try {
    const raw = window.localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_VISIBLE;
    // Start from the defaults so a column added later is shown, not missing.
    return { ...DEFAULT_VISIBLE, ...(parsed as Record<string, boolean>) };
  } catch {
    return DEFAULT_VISIBLE;
  }
}
