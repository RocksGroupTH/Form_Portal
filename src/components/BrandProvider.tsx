"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { setBrandCookieAction } from "@/lib/brand-actions";
import { safeRefresh, safeReplace } from "@/lib/safe-router";

interface BrandContextValue {
  brand: string | null;
  setBrand: (id: string, opts?: { syncUrl?: boolean; refresh?: boolean }) => Promise<void>;
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
  const router = useRouter();

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
    <BrandContext.Provider value={{ brand, setBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand(): BrandContextValue {
  const v = useContext(BrandContext);
  if (!v) throw new Error("useBrand must be used inside <BrandProvider>");
  return v;
}
