"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getBrandFromSearchParams } from "@/lib/brand-url";
import { useBrand } from "./BrandProvider";
import { BrandMark } from "./BrandMark";

/**
 * Blocks rendering of children with a non-dismissable modal until the user
 * picks a brand. Once a brand is selected (via the modal or BrandSwitcher),
 * the cookie is set and children render normally.
 *
 * The list comes from `/api/brands` (the company brand master minus anything
 * switched off at Settings → Brand Configuration), not from a hardcoded array.
 * Per-feature access checks — ERP sync, brand-scoped Accounting settings —
 * still happen at the API layer.
 */
export function BrandGate({ children }: { children: React.ReactNode }) {
  const { brand, setBrand, brands, brandsLoading } = useBrand();
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

  // A cookie naming a brand that is no longer offered has to reopen the picker,
  // or switching a brand off would leave everyone already on it working under
  // it forever.
  //
  // **Only once the list has actually been answered, and only if it is not
  // empty.** `brands` is also empty while the fetch is in flight and after it
  // fails, and forcing a modal with nothing in it over a transient error would
  // lock the app shut. Trusting the cookie is the fail-safe direction: the
  // server re-checks the brand on every request that acts on one.
  const listUsable = !brandsLoading && brands.length > 0;
  const brandStillOffered = !listUsable || brands.some((b) => b.id === brand);

  if (brand && brandStillOffered) return <>{children}</>;
  if (isSyncing) return null;
  // Nothing to choose from yet — show the dimmed shell rather than an empty
  // grid that looks like a broken page.
  if (brandsLoading) return null;

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
            {/* No disabled state any more: `/api/brands` returns what may be
                picked, so a brand that is here is selectable. The old "SOON"
                badge came from a hardcoded `enabled` flag that was `true` on
                all four entries and so never rendered. */}
            {brands.map((b) => (
              <button
                key={b.id}
                onClick={() => void setBrand(b.id)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-transform hover:scale-[1.03]"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <BrandMark src={b.logo} alt={b.name} code={b.id} size={64} />
                <span className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
                  {b.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
