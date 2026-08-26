"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setBrandCookieAction } from "@/lib/brand-actions";
import { safeRefresh, safeReplace } from "@/lib/safe-router";

/** A brand a user may pick, as `/api/brands` returns it. */
export interface SelectableBrand {
  id: string;
  name: string;
  logo: string | null;
}

interface BrandContextValue {
  brand: string | null;
  setBrand: (id: string, opts?: { syncUrl?: boolean; refresh?: boolean }) => Promise<void>;
  /**
   * The brands on offer, from `/api/brands` — the company brand master minus
   * anything an admin has switched off at Settings → Brand Configuration.
   *
   * Fetched here rather than in `BrandGate` and `BrandSwitcher` separately: they
   * are both mounted on every dashboard page and would otherwise ask twice for
   * the same list on every navigation.
   */
  brands: SelectableBrand[];
  /**
   * True until the list has been answered.
   *
   * **The distinction matters and is not cosmetic.** `brands` is empty both
   * before the fetch lands and when it fails, and `BrandGate` must not force
   * the picker on a signed-in user because a request was in flight or the
   * server was briefly unreachable — that would lock the whole app behind a
   * modal with nothing in it.
   */
  brandsLoading: boolean;
}

const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider({
  initialBrand,
  children,
}: {
  initialBrand: string | null;
  children: React.ReactNode;
}) {
  const [brand, setBrandState] = useState<string | null>(initialBrand);
  const [brands, setBrands] = useState<SelectableBrand[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // A local `let`, fresh on every run of the effect. React strict mode runs
    // effects twice in development, and a ref cleared by the first cleanup
    // stays cleared for the component's life.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/brands");
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (json?.ok && Array.isArray(json.data)) setBrands(json.data as SelectableBrand[]);
      } catch {
        // Leave the list empty; `brandsLoading` going false with nothing in it
        // is what tells BrandGate to trust the cookie rather than force a pick.
      } finally {
        if (!cancelled) setBrandsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setBrand = useCallback(
    async (id: string, opts?: { syncUrl?: boolean; refresh?: boolean }) => {
      const syncUrl = opts?.syncUrl ?? true;
      const refresh = opts?.refresh ?? true;

      await setBrandCookieAction(id);
      setBrandState(id);

      if (typeof window !== "undefined" && syncUrl) {
        const url = new URL(window.location.href);
        const cur = url.searchParams.get("brand");
        if (cur !== id) {
          url.searchParams.set("brand", id);
          safeReplace(router, url.pathname + url.search);
          return;
        }
      }

      if (refresh) safeRefresh(router);
    },
    [router],
  );

  return (
    <BrandContext.Provider value={{ brand, setBrand, brands, brandsLoading }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand(): BrandContextValue {
  const v = useContext(BrandContext);
  if (!v) throw new Error("useBrand must be used inside <BrandProvider>");
  return v;
}
