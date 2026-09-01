import type { ClearAdvanceItem } from "@/features/clear-advance/types";
import { allowedDimensionTypes } from "@/lib/clr/clear-advance-gl-filter";

/**
 * Server-side checks on the expense lines of the request being SAVED or
 * SUBMITTED — no IO, no server-only guard, so it can be unit-tested (see
 * clear-advance-line-validation.test.ts).
 *
 * Both rules were enforced in the browser only, which is no enforcement at all:
 * a stale tab or a hand-made request reached the writes untouched.
 *
 * Deliberately NOT applied when reading a request back: a stored line that
 * today's rules would refuse must still render on a historical or read-only
 * request. This is validation of an edit, not of the archive.
 */

/** DimensionType per G/L account no., from the AP-3 G/L master. */
export type GlDimensionTypes = ReadonlyMap<string, string>;

function n0(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

/**
 * A line the user actually filled in. Identical to the test persistClear writes
 * by — a line validation skipped but the writer keeps would reach the database
 * unchecked.
 */
export function isFilledLine(it: ClearAdvanceItem): boolean {
  return Boolean(it.glAccountNo || it.description?.trim() || n0(it.amountBeforeVat) > 0);
}

function label(it: ClearAdvanceItem, index: number): string {
  return `รายการที่ ${it.lineNo || index + 1}`;
}

function amount(v: unknown): string {
  const n = n0(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

/**
 * Money that cannot be what it claims to be. Only `amountBeforeVat > 0` was
 * checked, so `beforeVat 10 / vat 0 / wht 200` gave a net of −190: the clearing
 * total shrank, `bankAmount = advance − net` grew, and a typo turned into a
 * 290-baht return-to-company transfer.
 */
export function validateLineMoney(items: readonly ClearAdvanceItem[]): string[] {
  const errs: string[] = [];
  items.forEach((it, i) => {
    const before = n0(it.amountBeforeVat);
    const vat = n0(it.vatAmount);
    const wht = n0(it.whtAmount);
    if (!Number.isFinite(before) || !Number.isFinite(vat) || !Number.isFinite(wht)) {
      errs.push(`${label(it, i)}: จำนวนเงินไม่ถูกต้อง (ต้องเป็นตัวเลข)`);
      return; // the comparisons below would all pass on NaN
    }
    if (before < 0) errs.push(`${label(it, i)}: ค่าใช้จ่ายก่อน VAT ต้องไม่ติดลบ (${amount(before)})`);
    if (vat < 0) errs.push(`${label(it, i)}: ภาษีมูลค่าเพิ่ม (VAT) ต้องไม่ติดลบ (${amount(vat)})`);
    if (wht < 0) errs.push(`${label(it, i)}: ภาษีหัก ณ ที่จ่าย ต้องไม่ติดลบ (${amount(wht)})`);
    if (wht >= 0 && before >= 0 && vat >= 0 && wht > before + vat) {
      errs.push(
        `${label(it, i)}: ภาษีหัก ณ ที่จ่าย (${amount(wht)}) มากกว่ายอดค่าใช้จ่ายรวม VAT (${amount(before + vat)})`,
      );
    }
  });
  return errs;
}

/**
 * A G/L account the line's own branch is not allowed to charge. `listGlAccounts`
 * already narrows the picker by DimensionType; this is the same rule applied
 * where it binds — the line as it is about to be stored.
 */
export function validateLineGlBranch(
  items: readonly ClearAdvanceItem[],
  dimensionTypes: GlDimensionTypes,
): string[] {
  const errs: string[] = [];
  items.forEach((it, i) => {
    const no = it.glAccountNo?.trim();
    if (!no) return; // "not chosen yet" is a draft, not a violation — submit checks it
    const dim = dimensionTypes.get(no);
    const branch = it.branchCode?.trim() || "สำนักงานใหญ่";
    if (!dim) {
      errs.push(`${label(it, i)}: ไม่พบหมวดบัญชี ${no} ในผังบัญชีของ AP-3`);
      return;
    }
    if (!allowedDimensionTypes(it.branchCode).includes(dim)) {
      errs.push(`${label(it, i)}: หมวดบัญชี ${no} ใช้กับสาขา ${branch} ไม่ได้`);
    }
  });
  return errs;
}
