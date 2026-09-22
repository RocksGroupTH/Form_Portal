import type { BrandAccountKind, BrandAccountRow } from "@/lib/acc/brand-account-service";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/** The shape of `listBrandAccounts` — real in production, faked in tests. */
export type FetchBrandAccounts = (
  kind: BrandAccountKind,
  brandCode: string,
  formCode: string,
) => Promise<BrandAccountRow[]>;

/**
 * Loaded only when actually called, and only via dynamic import.
 *
 * `@/lib/acc/brand-account-service` imports `@/lib/acc/pool` → `@/lib/db/mssql`
 * → `@/env`, which validates `MSSQL_*`/`AUTH_SECRET` at import and throws if
 * they are unset — confirmed by the identical note in
 * `src/lib/clr/gl-company-guard.test.ts`. This repo's tests run under
 * `node:test` via `tsx --test` (`scripts/run-tests.ts`) with no env file
 * loaded, so a static top-level import of that service would make importing
 * *this* file from a test throw before a single case runs. Keeping the import
 * inside this function, and only reaching it through the `fetchRows` default
 * below, keeps `clear-advance-bank-account.ts` itself DB-free to import while
 * every real caller still gets the real data.
 */
async function fetchRealBrandAccounts(
  kind: BrandAccountKind,
  brandCode: string,
  formCode: string,
): Promise<BrandAccountRow[]> {
  const { listBrandAccounts } = await import("@/lib/acc/brand-account-service");
  return listBrandAccounts(kind, brandCode, formCode);
}

/**
 * AP-3's Bank Account for one claim brand — **its own row, or nothing.**
 *
 * ## Why this does not fall back, when everything around it does
 *
 * `src/lib/acc/per-form-config.ts` states the house rule: a form's own row, and
 * otherwise the `FormCode IS NULL` default. Every other per-form setting
 * follows it, and this one deliberately does not (user, 2026-09-22).
 *
 * The cost of "tidying" this into the house rule is measurable, not
 * theoretical. On 2026-09-22 PCMY's default row read `K-CA6999` (a
 * PCTH/KBANK account) while the AP-2 row AP-3 borrowed until this change read
 * `UOB-2726`. Restoring the fallback would move that brand's clearing journal
 * to a different bank, with no error raised anywhere — the send would simply
 * post somewhere else.
 *
 * So: one function, one place to read, and `clear-advance-bank-account.test.ts`
 * fails the moment somebody adds the default arm back.
 *
 * ## Why not `rows[0]`
 *
 * `listBrandAccounts` (`src/lib/acc/brand-account-service.ts`) applies
 * `perFormPredicate` and reduces with `pickAllForForm`, which keys on
 * `(brand, accountNo)` — a default row with a DIFFERENT account number is not
 * overridden by AP-3's and survives the reduce, and `perFormOrderBy` sorts
 * within a key rather than across keys. Both rows come back and either may be
 * first.
 *
 * ## Why `fetchRows` is a parameter
 *
 * It is the seam `clear-advance-bank-account.test.ts` uses in place of
 * ACC Portal's `vi.mock` — this repo has no vitest and no working
 * `node:test` module-mock (see `fetchRealBrandAccounts` above). Every real
 * caller calls `clrBankAccountNo(brandCode)` with no second argument and gets
 * the real `listBrandAccounts`.
 *
 * Kept behaviourally identical to ACC Portal's
 * `src/lib/clr/clear-advance-bank-account.ts`. The two applications write the
 * same `AccBrandBankAccount` rows, so a difference here is a claim posting to
 * two different banks depending on which console sent it.
 */
export async function clrBankAccountNo(
  brandCode: string,
  fetchRows: FetchBrandAccounts = fetchRealBrandAccounts,
): Promise<string | null> {
  const brand = brandCode.trim().toUpperCase();
  // A blank brand must never reach fetchRows: brand-account-service.ts drops
  // the `BrandCode = @brand` predicate entirely when the brand is falsy, so an
  // empty string here would fetch AP-3's rows for every brand and this
  // function would then either throw the "more than one" error or, worse,
  // silently return another brand's bank account.
  if (!brand) return null;

  const rows = await fetchRows("bank", brand, AP3_FORM_CODE);
  const own = rows.filter((r) => r.formCode === AP3_FORM_CODE && r.isActive);
  if (own.length > 1) {
    throw new Error(
      `${brand} มีบัญชีธนาคารของ AP-3 มากกว่าหนึ่งรายการ — แก้ที่ AP-3 → ตั้งค่า → Interface ERP ก่อนส่ง`,
    );
  }
  return own[0]?.accountNo ?? null;
}
