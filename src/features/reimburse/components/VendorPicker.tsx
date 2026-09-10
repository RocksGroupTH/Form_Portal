"use client";

import { useMemo } from "react";
import { CodeNamePicker } from "@/components/ui/CodeNamePicker";
import type { TaxVendorCandidate } from "@/lib/clr/tax-vendor-service";

/**
 * The `Vendor` cell: which Business Central vendor card this expense line posts
 * against, chosen by accounting on คิวอนุมัติ (บัญชี).
 *
 * **Not the seller already on the row.** `AccReimburseItem` carries
 * `VendorName` / `VendorTaxId` / `VendorAddress` (migration 118) — the seller as
 * printed on the receipt, read by the AI and owned by the requester. This is a
 * different fact with a different owner, and both are kept: the pair is what
 * lets somebody check that the right card was chosen.
 *
 * **Chosen, never derived.** One tax id maps to many vendor cards — Central
 * Pattana has 24 under one number, one per mall, told apart only by a prefix in
 * the name — so a tax id narrows the list and a person picks from it. Blank is
 * ordinary and legitimate: a one-off purchase from a seller who is not a vendor
 * of ours.
 *
 * The searchable list is the whole company's cards, filtered in the browser.
 * That is not an optimisation — `listTaxVendors`' own docblock records that
 * `DisplayName` is `Thai_CI_AS`, where SQL `LIKE` compares collation elements
 * and a substring pattern failed to match the very name it came from.
 *
 * `TaxVendorCandidate.taxRegistrationNumber` is deliberately not shown here.
 * The row already prints the seller's tax id from the receipt beside this cell,
 * and a second tax id in a 190px control would compete with the name for width
 * — the name being the half that tells a reader whether the card is right.
 */
export function VendorPicker({
  value,
  onChange,
  vendors,
  loading,
  brandChosen,
  ariaLabel,
}: {
  /** `ErpVendors.VendorNo`, or null when no card has been chosen. */
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  vendors: TaxVendorCandidate[];
  loading?: boolean;
  /** False before a brand is picked — ErpVendors is keyed by Company. */
  brandChosen: boolean;
  ariaLabel: string;
}) {
  const options = useMemo(
    // A card with no DisplayName falls back to its number rather than rendering
    // a blank second line: 101 ADV cards and 155 trade vendors in PCTH have no
    // tax registration number, and a missing name is the same class of gap.
    () => vendors.map((v) => ({ code: v.vendorNo, name: v.displayName ?? v.vendorNo })),
    [vendors],
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
        placeholder: "เลือก Vendor...",
        noBrand: "เลือกแบรนด์ก่อน",
        loading: "กำลังโหลด...",
        search: "ค้นหารหัสหรือชื่อผู้ขาย...",
        empty: "ไม่มี Vendor ให้เลือก",
        noMatch: "ไม่พบ Vendor ที่ค้นหา",
        clear: "ล้างค่า",
      }}
    />
  );
}
