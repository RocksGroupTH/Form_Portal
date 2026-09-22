import type { BrandAccountRow } from "@/lib/acc/brand-account-service";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/**
 * Pure decision logic for the AP-3 Interface ERP settings screen's bank
 * column — no IO, so it can be unit-tested even though
 * `clear-advance-interface-settings-service.ts` cannot be (it reaches `@/env`
 * through `@/lib/acc/brand-account-service` → `getAccPool`, which throws at
 * import under this repo's `node:test` runner — see the note in
 * `gl-company-guard.test.ts`). `BrandAccountRow` is imported with `import
 * type` for that reason: it is erased before it can drag the real module in.
 *
 * Mirrors the no-fallback rule in `clear-advance-bank-account.ts` (the
 * reader): a brand's own active AP-3 row, or nothing — never the
 * `FormCode IS NULL` default. The two must agree, because this view's
 * "ready" is a promise that the reader will find exactly what the screen
 * shows.
 */
export interface ClrBankByBrand {
  /** The one active AP-3 bank row's account, or null if there isn't exactly one. */
  bankAccountNo: string | null;
  /** True when a brand has more than one active AP-3 row — a conflict, not a pick. */
  bankConflict: boolean;
}

const NO_BANK: ClrBankByBrand = { bankAccountNo: null, bankConflict: false };

/**
 * Group AP-3's own active bank rows per brand (uppercased).
 *
 * Never throws — unlike `clrBankAccountNo`, which is called once per brand at
 * send time and can refuse that one claim. This is called once for the whole
 * settings screen, and one brand's bad data must not blank every other
 * brand's row.
 */
export function groupClrBankAccountsByBrand(
  rows: readonly BrandAccountRow[],
): Map<string, ClrBankByBrand> {
  const own = rows.filter((r) => r.formCode === AP3_FORM_CODE && r.isActive);

  const byBrand = new Map<string, BrandAccountRow[]>();
  for (const row of own) {
    const key = row.brandCode.trim().toUpperCase();
    const bucket = byBrand.get(key);
    if (bucket) bucket.push(row);
    else byBrand.set(key, [row]);
  }

  const result = new Map<string, ClrBankByBrand>();
  for (const [brand, group] of Array.from(byBrand.entries())) {
    result.set(
      brand,
      group.length > 1
        ? { bankAccountNo: null, bankConflict: true }
        : { bankAccountNo: group[0].accountNo, bankConflict: false },
    );
  }
  return result;
}

/** What `groupClrBankAccountsByBrand` answers for a brand with no rows at all. */
export function bankForBrand(
  byBrand: ReadonlyMap<string, ClrBankByBrand>,
  brandCode: string,
): ClrBankByBrand {
  return byBrand.get(brandCode.trim().toUpperCase()) ?? NO_BANK;
}

/**
 * AP-3's readiness rule: a journal batch, exactly one bank account, and a
 * complete BC profile. A conflict never reaches the `bank` clause because
 * `groupClrBankAccountsByBrand` already nulls `bankAccountNo` for one — the
 * explicit `!bank.bankConflict` guard is belt-and-braces so this stays true
 * even if a future caller builds a `ClrBankByBrand` by hand.
 */
export function deriveClrReady(params: {
  journalBatchName: string | null;
  bank: ClrBankByBrand;
  profileComplete: boolean;
}): boolean {
  return (
    !!(params.journalBatchName && params.bank.bankAccountNo && params.profileComplete) &&
    !params.bank.bankConflict
  );
}
