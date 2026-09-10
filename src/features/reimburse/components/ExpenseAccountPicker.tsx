"use client";

import { useMemo } from "react";
import { CodeNamePicker } from "@/components/ui/CodeNamePicker";
import type { ExpenseAccount } from "@/lib/acc/reimburse/expense-account-service";

/**
 * The `รายการ` cell: which G/L account this expense line is booked to.
 *
 * **The stored value is the account number**, not the name — that is what
 * Business Central posts against, and a display name can change on the next
 * sync while the number does not.
 *
 * Everything this used to do itself now lives in `CodeNamePicker`, which was
 * extracted from this file when AP-4's accounting queue needed the same cell
 * for a Business Central vendor. The behaviour is unchanged and deliberately so:
 * the searchable list, the portalled panel, the two-line code-above-name
 * layout, "เลือกแบรนด์ก่อน", and the raw stored value shown when it is not in
 * the list at all — a claim filed before this column meant an ERP account holds
 * free text like "AP-4.2", and an account used last year may since have been
 * blocked in BC.
 *
 * This wrapper survives rather than callers moving to `CodeNamePicker` directly
 * because the mapping and the Thai copy are the part that is about G/L
 * accounts, and a caller should not have to restate either.
 */
export function ExpenseAccountPicker({
  value,
  onChange,
  accounts,
  loading,
  brandChosen,
  ariaLabel,
}: {
  /** `ErpAccounts.AccountNo`, or free text on an older row, or null. */
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  accounts: ExpenseAccount[];
  loading?: boolean;
  /** False before a brand is picked — the list cannot be loaded at all yet. */
  brandChosen: boolean;
  ariaLabel: string;
}) {
  const options = useMemo(
    () => accounts.map((a) => ({ code: a.accountNo, name: a.displayName })),
    [accounts],
  );

  return (
    <CodeNamePicker
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      brandChosen={brandChosen}
      ariaLabel={ariaLabel}
      labels={{
        placeholder: "เลือกบัญชี...",
        noBrand: "เลือกแบรนด์ก่อน",
        loading: "กำลังโหลด...",
        search: "ค้นหาเลขบัญชีหรือชื่อ...",
        empty: "ไม่มีบัญชีให้เลือก",
        noMatch: "ไม่พบบัญชีที่ค้นหา",
        clear: "ล้างค่า",
      }}
    />
  );
}
