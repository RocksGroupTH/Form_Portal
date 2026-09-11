"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export interface TaxVendorCandidate {
  vendorNo: string;
  displayName: string | null;
  taxRegistrationNumber: string | null;
}

/**
 * One fetch per Company per page, shared by every row on it.
 *
 * A clearing with six receipts needs the same list six times — to filter when a
 * cell is opened, and to show the name of a vendor already chosen rather than a
 * bare code. Without the cache that is six identical requests for 93KB on
 * mount, every time the account step opens. It outlives the component on
 * purpose: a remount must not re-ask.
 */
const vendorListCache = new Map<string, Promise<TaxVendorCandidate[]>>();

/**
 * The same list, for code that is not a component.
 *
 * The receipt read wants it once, mid-await, to name a seller from our own
 * books; it has no state to hold and nothing to render while it waits. Sharing
 * the cache means the account step opening afterwards does not fetch again.
 */
export function loadTaxVendors(brandCode: string | null): Promise<TaxVendorCandidate[]> {
  return fetchVendors(brandCode);
}

function fetchVendors(brandCode: string | null): Promise<TaxVendorCandidate[]> {
  const key = brandCode ?? "";
  const hit = vendorListCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(`/api/request/clear-advance/tax-vendors?brand=${encodeURIComponent(key)}`);
    const j = (await res.json()) as { ok: boolean; data?: TaxVendorCandidate[]; error?: string };
    if (!j.ok) {
      // Not cached: a failure now must not become this page's answer forever.
      vendorListCache.delete(key);
      throw new Error(j.error ?? "โหลดรายชื่อ Vendor ไม่สำเร็จ");
    }
    return j.data ?? [];
  })();
  vendorListCache.set(key, p);
  return p;
}

/**
 * The brand's vendor list, for the whole grid rather than one cell.
 *
 * `load` is called when a cell is first opened, and eagerly by the grid when any
 * line already carries a vendor — a stored `taxVendorNo` is a bare number, and
 * the list is what carries its name.
 */
export function useTaxVendors(brandCode: string | null) {
  const [vendors, setVendors] = useState<TaxVendorCandidate[] | "loading" | "failed" | null>(null);

  const load = useCallback(async () => {
    setVendors((prev) => (prev === null ? "loading" : prev));
    try {
      setVendors(await fetchVendors(brandCode));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดรายชื่อ Vendor ไม่สำเร็จ");
      /* "failed", not an empty list. One state now serves the whole grid, so an
         empty list would read as "this Company has no vendors" and, because a
         cell only loads while the state is null or failed, nothing would ever ask
         again — one blip and every row is stuck until reload. "failed" is
         distinct from null so the eager load does not retry in a loop, and a
         cell opening again does. */
      setVendors("failed");
    }
  }, [brandCode]);

  // A different brand is a different Company's vendors; the module cache keeps
  // the old list, so switching back is still free.
  useEffect(() => { setVendors(null); }, [brandCode]);

  return { vendors, list: Array.isArray(vendors) ? vendors : [], load };
}
