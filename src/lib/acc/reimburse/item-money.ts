/**
 * AP-4 — the per-item money and date rules, and the Thai messages that name
 * them. Two layers, both of them here:
 *
 *   1. `prepareReimburseItemsForSave` — draft time. Decides which grid rows are
 *      real rows at all, and refuses to let a malformed amount enter storage.
 *   2. `validateItemMoney` — submit time. Re-checks whatever actually got
 *      persisted, right before the total that determines a payout is computed.
 *
 * Deliberately free of any runtime import (the only import is `import type`,
 * which is erased): `src/lib/acc/pool.ts` reaches `src/lib/db/mssql.ts`, which
 * reads `@/env` at module scope, so anything that statically imports the
 * request service — even just to reach one pure function — fails immediately
 * outside a Next.js request unless every MSSQL_* / AUTH_SECRET var is already
 * in process.env, which the test runner (tsx, no .env loading) never sets. This
 * is the same constraint Task 2 hit and solved the same way; see the header of
 * `src/lib/acc/payment-calendar-core.ts`. Keeping these functions here, with no
 * import chain back to the DB layer, is what lets `item-money.test.ts` run as a
 * plain unit test.
 *
 * Why any of this exists: `sumReimburseItems` (`./calc.ts`) is a pure sum with
 * no validation by its own brief — `Number(x) || 0` there cannot tell a coerced
 * typo from a genuine zero. Everything that stops malformed or missing money
 * reaching a payout figure has to live in front of it, which is here.
 */
import type { ReimburseItem } from "@/features/reimburse/types";

/* ─────────────────────────── messages ─────────────────────────── */

/** ` (แถวที่ n)`, or nothing at all when there is only one row to talk about. */
export function rowLabel(index: number, total: number): string {
  return total > 1 ? ` (แถวที่ ${index + 1})` : "";
}
export function amountMalformedMsg(lbl: string): string {
  return `จำนวนเงินไม่ถูกต้อง${lbl}`;
}
export function amountNotPositiveMsg(lbl: string): string {
  return `กรุณาระบุจำนวนเงินให้ถูกต้อง (มากกว่า 0)${lbl}`;
}
export function vatInvalidMsg(lbl: string): string {
  return `จำนวนภาษีมูลค่าเพิ่ม (VAT) ไม่ถูกต้อง${lbl}`;
}
export function whtInvalidMsg(lbl: string): string {
  return `จำนวนหัก ณ ที่จ่ายไม่ถูกต้อง${lbl}`;
}
/** A row the requester filled in but never dated. AP-1 says the same thing about its travel date. */
export function dateMissingMsg(lbl: string): string {
  return `กรุณาระบุวันที่ของรายการ${lbl}`;
}

/* ─────────────────────────── primitives ─────────────────────────── */

/** A usable YYYY-MM-DD, or null. Whitespace is not a date. */
function trimmedDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * The stored form of one of the AP-4.1 text columns — trimmed, or null.
 *
 * Null rather than `""` so "not filled in" has one representation in the
 * column instead of two that every later read would have to test for.
 */
function trimmedText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Did the requester put anything in one of those text cells? */
function textIsEntered(v: unknown): boolean {
  return trimmedText(v) !== null;
}

/**
 * Did the requester put anything in this money cell?
 *
 * Blank (`null`, `undefined`, `""`, whitespace) is nothing, and so is a plain
 * zero — the grid initialises a fresh row's amount to 0, so a 0 with nothing
 * else beside it is an untouched row, not a claim for nothing. Anything else,
 * including a typo like `"abc"`, counts as entered: it is content the requester
 * meant to be money, and it must be reported rather than quietly dropped.
 */
function moneyIsEntered(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return false;
    const n = Number(t);
    return !Number.isFinite(n) || n !== 0;
  }
  if (typeof v === "number") return !Number.isFinite(v) || v !== 0;
  return true;
}

/**
 * Coerce one money cell, refusing everything `Number()` would silently turn
 * into a finite zero.
 *
 * `Number()`'s own coercion table is the hazard: `null`, `""`, `" "`, `[]` and
 * `false` all become `0`, are accepted, and store as `0.00` — a total the
 * requester never entered, shown back to them on resume as if they had. So the
 * value must already be a number or a non-blank numeric string before
 * `Number()` is allowed near it.
 */
function requireMoney(v: unknown, message: string): number {
  const raw = typeof v === "string" ? v.trim() : v;
  if (raw === null || raw === undefined || raw === "") throw new Error(message);
  if (typeof raw !== "number" && typeof raw !== "string") throw new Error(message);
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(message);
  return n;
}

/**
 * Is this row entirely empty — no date, no description, no money anywhere?
 *
 * Only such a row may be dropped. A row carrying content is a row the requester
 * meant, and dropping it silently is how a claim comes to submit for less than
 * the person typed.
 */
export function isBlankItemRow(it: ReimburseItem): boolean {
  if (trimmedDate(it.expenseDate)) return false;
  if (typeof it.description === "string" && it.description.trim() !== "") return false;
  // The AP-4.1 columns count too. A row where the requester typed only the
  // document number is a row they meant; leaving these three out of the check
  // is how it would be dropped without a word.
  if (textIsEntered(it.documentNo)) return false;
  if (textIsEntered(it.category)) return false;
  if (textIsEntered(it.branchName)) return false;
  if (textIsEntered(it.vendorTaxId)) return false;
  if (textIsEntered(it.vendorName)) return false;
  if (textIsEntered(it.vendorAddress)) return false;
  if (moneyIsEntered(it.amount)) return false;
  if (moneyIsEntered(it.vatAmount)) return false;
  if (moneyIsEntered(it.whtAmount)) return false;
  return true;
}

/* ─────────────────────────── layer 1: draft ─────────────────────────── */

/**
 * Layer 1 — normalise the grid into the rows that will be persisted, and refuse
 * anything that cannot be stored honestly.
 *
 * Dropped: a completely empty row, which is the grid's own trailing placeholder
 * and never anything the requester entered.
 *
 * Refused, each with its own named Thai message:
 *
 * - **A row with content but no date.** `AccReimburseItem.ExpenseDate` is NOT
 *   NULL, so such a row cannot be stored — but it must not be discarded either,
 *   because the submit path then validates and totals only the survivors and
 *   the request goes through for a smaller amount than was typed. AP-1 does the
 *   same thing for a travel day with no date (`กรุณาเลือกวันที่เดินทาง`).
 * - **A malformed amount.** `Amount`/`VatAmount`/`WhtAmount` are DECIMAL(18,2)
 *   and cannot hold NaN or Infinity at all, so something has to reject or
 *   coerce before the SQL driver sees it. Rejecting is the only option that
 *   keeps the signal: once a coerced `0` is in storage it is indistinguishable
 *   from a deliberate zero forever after.
 *
 * Only *well-formedness* is enforced here. Zero and negative amounts are still
 * accepted — a draft is allowed to be incomplete — and the `> 0` floor is a
 * submit-time business rule, applied in `validateItemMoney`. `vatAmount` /
 * `whtAmount` are checked only when present, because null legitimately means
 * "not specified"; neither feeds the total (see `./calc.ts`), so that check is
 * about data integrity rather than payout.
 *
 * Rows are labelled by their position among the kept rows, which is the order
 * they are persisted and read back in, and matches how `validateItemMoney`
 * labels them.
 */
export function prepareReimburseItemsForSave(items: ReimburseItem[]): ReimburseItem[] {
  const filled = items.filter((it) => !isBlankItemRow(it));
  return filled.map((it, i) => {
    const lbl = rowLabel(i, filled.length);

    const expenseDate = trimmedDate(it.expenseDate);
    if (!expenseDate) throw new Error(dateMissingMsg(lbl));

    const amount = requireMoney(it.amount, amountMalformedMsg(lbl));

    let vatAmount: number | null = null;
    if (it.vatAmount !== null && it.vatAmount !== undefined) {
      vatAmount = requireMoney(it.vatAmount, vatInvalidMsg(lbl));
    }
    let whtAmount: number | null = null;
    if (it.whtAmount !== null && it.whtAmount !== undefined) {
      whtAmount = requireMoney(it.whtAmount, whtInvalidMsg(lbl));
    }

    return {
      ...it,
      sortOrder: it.sortOrder ?? i,
      expenseDate,
      amount,
      vatAmount,
      whtAmount,
      // Trimmed here rather than in the grid: the grid is one caller, and a
      // column that arrives padded from anywhere else would be stored padded
      // and then never match anything compared against it.
      documentNo: trimmedText(it.documentNo),
      category: trimmedText(it.category),
      branchName: trimmedText(it.branchName),
      vendorTaxId: trimmedText(it.vendorTaxId),
      vendorName: trimmedText(it.vendorName),
      vendorAddress: trimmedText(it.vendorAddress),
    };
  });
}

/* ─────────────────────────── layer 2: submit ─────────────────────────── */

/**
 * Layer 2 — re-check the persisted rows, right before the total that determines
 * payout is computed, so a row written by any other caller of the table is not
 * trusted either. `amount` must be a finite number greater than zero;
 * `vatAmount` / `whtAmount`, when present, must be finite. Accumulates rather
 * than throwing, because the submit path reports every failure at once.
 */
export function validateItemMoney(items: ReimburseItem[]): string[] {
  const errs: string[] = [];
  items.forEach((it, i) => {
    const lbl = rowLabel(i, items.length);
    const amount = Number(it.amount);
    if (!Number.isFinite(amount) || amount <= 0) errs.push(amountNotPositiveMsg(lbl));
    if (it.vatAmount !== null && it.vatAmount !== undefined && !Number.isFinite(Number(it.vatAmount))) {
      errs.push(vatInvalidMsg(lbl));
    }
    if (it.whtAmount !== null && it.whtAmount !== undefined && !Number.isFinite(Number(it.whtAmount))) {
      errs.push(whtInvalidMsg(lbl));
    }
  });
  return errs;
}
