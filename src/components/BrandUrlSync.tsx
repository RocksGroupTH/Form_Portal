"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useBrand } from "@/components/BrandProvider";
import {
  getBrandFromSearchParams,
  replaceSearchParams,
  setBrandInSearchParams,
} from "@/lib/brand-url";
import { safeReplace } from "@/lib/safe-router";

export function BrandUrlSync({ children }: { children: React.ReactNode }) {
  const { brand, setBrand } = useBrand();
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const spKey = sp.toString();
  const prevSpKey = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // URL changed (navigation, shared link, back/forward) → URL is source of truth.
  useEffect(() => {
    const urlBrand = getBrandFromSearchParams(new URLSearchParams(spKey));
    const spChanged = prevSpKey.current === null || spKey !== prevSpKey.current;
    prevSpKey.current = spKey;

    if (!urlBrand) return;
    if (spChanged && urlBrand !== brand) {
      void setBrand(urlBrand, { syncUrl: false, refresh: false });
    }
  }, [spKey, brand, setBrand]);

  // Context changed (navbar switcher, brand gate) → push into URL before sp catches up.
  // Do NOT read stale useSearchParams here — that caused reverting to the old brand.
  useEffect(() => {
    if (!hydrated || !brand) return;
    if (typeof window === "undefined") return;

    const current = new URLSearchParams(window.location.search);
    const urlBrand = getBrandFromSearchParams(current);
    if (urlBrand === brand) return;

    const next = setBrandInSearchParams(current, brand);
    const target = replaceSearchParams(pathname, next);
    const cur = pathname + (window.location.search || "");
    if (cur !== target) {
      safeReplace(router, target);
    }
  }, [hydrated, brand, pathname, router]);

  return <>{children}</>;
}
