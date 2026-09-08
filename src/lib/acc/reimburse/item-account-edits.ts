/**
 * Parsing and bounding the body of
 * `PATCH /api/request/reimburse/requests/[id]/items` — accounting correcting
 * the AI-proposed G/L account (`AccReimburseItem.Category`) on one or more
 * lines of a claim it currently owns.
 *
 * Pure and import-free, like `./item-money.ts` beside it and for the same
 * reason: `@/lib/acc/pool` reaches `@/env`, which validates the whole
 * environment at import time, so a test importing anything on that chain
 * fails before its first assertion outside a real Next.js request. The route
 * and the service are the two halves that need a pool.
 *
 * **The length bound is not decoration.** `Category` is `NVARCHAR(50)`
 * (migration 088/117), and CLAUDE.md records the same trap for
 * `ApiKey.Name`: an over-long value that reaches the driver unchecked comes
 * back as an untranslated SQL truncation error rather than a Thai 400. In
 * practice every value on offer is a short `ErpAccounts.AccountNo`, but this
 * route also accepts whatever the caller posts — refuse rather than let the
 * column truncate it into a different account number than the one somebody
 * meant to save.
 */

export const CATEGORY_MAX_LEN = 50;

export const ITEM_ACCOUNT_EDITS_EMPTY_ERROR = "ไม่มีรายการที่จะบันทึก";
export const ITEM_ACCOUNT_EDIT_INVALID_ERROR = "ข้อมูลที่ส่งมาไม่ถูกต้อง";
export const ITEM_ACCOUNT_TOO_LONG_ERROR = `รหัสบัญชียาวเกิน ${CATEGORY_MAX_LEN} ตัวอักษร`;

/** One line's new `Category` — trimmed; `null` clears the stored value. */
export interface ItemAccountEdit {
  id: number;
  category: string | null;
}

export type ItemAccountEditsResult =
  | { edits: ItemAccountEdit[]; error: null }
  | { edits: null; error: string };

/**
 * `raw` off the wire → a validated, deduplicated edit list, or the Thai
 * message refusing it. Never both, and never a partial list silently missing
 * the entries that failed — one bad entry refuses the whole body, because a
 * caller who sees "3 of 4 saved" with no indication of which one failed has
 * no way to know which line still holds the wrong account.
 *
 * A repeated `id` keeps its **first** occurrence and drops the rest — a
 * client sending the same line twice is a bug in the client, not a reason to
 * apply its second answer over its first.
 */
export function parseItemAccountEdits(raw: unknown): ItemAccountEditsResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { edits: null, error: ITEM_ACCOUNT_EDITS_EMPTY_ERROR };
  }

  const out: ItemAccountEdit[] = [];
  const seen = new Set<number>();

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { edits: null, error: ITEM_ACCOUNT_EDIT_INVALID_ERROR };
    }
    const idRaw = (entry as { id?: unknown }).id;
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) {
      return { edits: null, error: ITEM_ACCOUNT_EDIT_INVALID_ERROR };
    }

    const categoryRaw = (entry as { category?: unknown }).category;
    if (categoryRaw !== null && categoryRaw !== undefined && typeof categoryRaw !== "string") {
      return { edits: null, error: ITEM_ACCOUNT_EDIT_INVALID_ERROR };
    }
    const trimmed = typeof categoryRaw === "string" ? categoryRaw.trim() : "";
    if (trimmed.length > CATEGORY_MAX_LEN) {
      return { edits: null, error: ITEM_ACCOUNT_TOO_LONG_ERROR };
    }

    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, category: trimmed === "" ? null : trimmed });
  }

  if (out.length === 0) return { edits: null, error: ITEM_ACCOUNT_EDITS_EMPTY_ERROR };
  return { edits: out, error: null };
}
