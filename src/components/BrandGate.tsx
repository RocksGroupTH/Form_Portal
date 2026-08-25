"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BRANDS } from "@/lib/brand";
import { getBrandFromSearchParams } from "@/lib/brand-url";
import { useBrand } from "./BrandProvider";

/**
 * Blocks rendering of children with a non-dismissable modal until the user
 * picks a brand. Once a brand is selected (via the modal or BrandSwitcher),
 * the cookie is set and children render normally.
 *
 * Note: All enabled brands are selectable here. Per-feature access checks
 * (e.g. ERP sync, brand-scoped Accounting settings) happen at the API layer.
 */
export function BrandGate({ children }: { children: React.ReactNode }) {
  const { brand, setBrand } = useBrand();
  const sp = useSearchParams();
  const [isSyncing, setIsSyncing] = useState(false);

  // If the URL contains a valid ?brand=, adopt it (cookie + context) so the dashboard
  // can render without forcing the user through the picker modal.
  useEffect(() => {
    if (brand) return;
    const urlBrand = getBrandFromSearchParams(new URLSearchParams(sp.toString()));
    if (!urlBrand) return;

    setIsSyncing(true);
    void setBrand(urlBrand, { syncUrl: false, refresh: true }).finally(() => setIsSyncing(false));
  }, [brand, setBrand, sp]);

  if (brand) return <>{children}</>;
  if (isSyncing) return null;

  return (
    <>
      {/* Dimmed background — children are rendered for layout/skeleton but pointer events disabled */}
      <div
        className="fixed inset-0 z-[100] overflow-hidden pointer-events-none select-none"
        style={{ opacity: 0.25 }}
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Blocking modal — no close button, no overlay dismiss */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-gate-title"
        className="app-overlay fixed inset-0 z-[101] flex items-center justify-center p-4"
      >
        <div
          className="rounded-2xl p-6 sm:p-8 w-full max-w-2xl"
          style={{
            background: "var(--bg-modal)",
            border: "1px solid var(--border-main)",
            boxShadow: "var(--shadow-modal)",
            animation: "dialogIn 0.2s var(--ease-out-expo)",
          }}
        >
          <div className="text-center mb-6">
            {/* Square slot, so the 200×200 file rather than the 74×91 one —
                see the note in app/loading.tsx. */}
            <img
              src="/brandlogo/rocks-200.png"
              alt=""
              width={64}
              height={64}
              className="mx-auto mb-3 object-contain"
            />
            <h2
              id="brand-gate-title"
              className="text-[20px] sm:text-[22px] font-bold mb-1"
              style={{ color: "var(--text-heading)" }}
            >
              Welcome to Form Portal
            </h2>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              Choose a brand workspace to continue. You can switch any time from the navbar.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BRANDS.map((b) => {
              const isDisabled = !b.enabled;
              return (
                <button
                  key={b.id}
                  onClick={() => {
                    if (!isDisabled) void setBrand(b.id);
                  }}
                  disabled={isDisabled}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 transition-transform hover:scale-[1.03]"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-card)",
                  }}
                >
                  <img
                    src={b.logo}
                    alt={b.name}
                    width={64}
                    height={64}
                    className="rounded-lg object-contain"
                    style={{ filter: isDisabled ? "grayscale(1)" : undefined }}
                  />
                  <span className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
                    {b.name}
                  </span>
                  {isDisabled && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--color-warning-light)", color: "var(--text-inverse)" }}
                    >
                      SOON
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
