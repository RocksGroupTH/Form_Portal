"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSWRConfig } from "swr";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";

/**
 * Full-screen loader shown while the dashboard's headline endpoint
 * (`/api/intelligence/dashboards/master/kpi`) is still fetching for a
 * newly-selected brand. We block the dashboard chrome behind a portal
 * so the user doesn't see stale charts from the previous brand mixed
 * with KSI/UNO numbers from a half-loaded swap.
 *
 * The overlay only appears on a brand CHANGE, never on the initial
 * mount — the per-chart skeletons handle the cold-load case fine and a
 * dashboard-wide curtain on first paint would feel like an extra delay.
 *
 * KPI is used as the gate because it's the smallest critical query: by
 * the time it resolves the per-brand cache key has been primed and the
 * Customised SWR fetches in every chart card will start their own work
 * with a populated network.
 */
const MIN_VISIBLE_MS = 350;

export function BrandSwitchOverlay({ brand }: { brand: string }) {
  const prevBrandRef = useRef<string | null>(null);
  const showStartRef = useRef<number>(0);
  const [switching, setSwitching] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, isLoading } = useMasterData<unknown[]>(
    "/api/intelligence/dashboards/master/kpi",
    apiQs,
  );
  const { mutate } = useSWRConfig();

  // Detect a brand change from the previous render. First mount only
  // seeds the ref so the overlay stays dormant on initial load.
  useEffect(() => {
    if (prevBrandRef.current === null) {
      prevBrandRef.current = brand;
      return;
    }
    if (prevBrandRef.current !== brand) {
      prevBrandRef.current = brand;
      showStartRef.current = performance.now();
      setSwitching(true);

      // Force re-validation of every Master Dashboard SWR entry, both
      // the old brand (so its cache doesn't linger and re-pollute on a
      // later swap) and the new brand (so the chart hooks that just
      // re-rendered with `brand={newBrand}` issue a fresh request
      // instead of silently re-using a stale cached body). Subscribed
      // hooks get re-fired with their current key thanks to
      // `revalidate: true`. Without this, dedupingInterval (30s) can
      // cause the second-visit-back swap to skip the fetch entirely
      // and leave the previous brand's numbers on screen under the
      // new brand chrome.
      mutate(
        (key) =>
          typeof key === "string" &&
          key.includes("/api/intelligence/dashboards/master"),
        undefined,
        { revalidate: true },
      );
    }
  }, [brand, mutate]);

  // Dismiss once the KPI fetch for the new brand has produced data, but
  // honour a tiny minimum-visible window so the overlay doesn't flash
  // for the (already cached) trip back to a previously-loaded brand.
  useEffect(() => {
    if (!switching) return;
    if (isLoading || !data) return;
    const elapsed = performance.now() - showStartRef.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const t = setTimeout(() => setSwitching(false), remaining);
    return () => clearTimeout(t);
  }, [switching, isLoading, data]);

  if (!mounted || !switching) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center"
      style={{ background: "rgba(15, 23, 42, 0.45)" }}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${brand} dashboard data`}
    >
      <div
        className="rounded-xl px-6 py-5 flex flex-col items-center gap-3 shadow-2xl"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          minWidth: 220,
        }}
      >
        <img
          src="/codexfamilylogo/logo_3_speed_128.png"
          alt=""
          width={64}
          height={64}
          className="animate-pulse"
        />
        <div
          className="text-[12px] text-center"
          style={{ color: "var(--text-secondary)" }}
        >
          กำลังโหลดข้อมูลของ{" "}
          <strong style={{ color: "var(--accent)" }}>{brand}</strong>…
        </div>
        <div
          className="w-40 h-1 rounded-full overflow-hidden"
          style={{ background: "var(--bg-badge)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: "var(--accent)",
              animation: "reportLoadBar 1.2s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
