"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { BRANDS, getBrandById } from "@/lib/brand";
import { useBrand } from "./BrandProvider";
import { Dialog } from "@/components/ui/Dialog";

interface BrandSwitcherProps {
  compact?: boolean;
}

export function BrandSwitcher({ compact = false }: BrandSwitcherProps) {
  const { brand, setBrand } = useBrand();
  const [open, setOpen] = useState(false);
  const current = getBrandById(brand);

  if (!current) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
        style={{ background: "var(--bg-badge)" }}
        title="Switch brand"
        aria-label={`Current brand: ${current.name}. Click to switch.`}
      >
        <img src={current.logo} alt="" width={compact ? 16 : 18} height={compact ? 16 : 18} className="rounded shrink-0" />
        {!compact && (
          <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
            {current.name}
          </span>
        )}
        <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
      </button>

      <Dialog open={open} onOpenChange={setOpen} title="Switch Brand" contentClassName="max-w-2xl">
        <p className="text-[13px] mb-4" style={{ color: "var(--text-muted)" }}>
          Choose a brand workspace. Your selection is remembered across sessions.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {BRANDS.map((b) => {
            const isDisabled = !b.enabled;
            const isCurrent = b.id === brand;
            return (
              <button
                key={b.id}
                type="button"
                onClick={async () => {
                  if (isDisabled || isCurrent) {
                    setOpen(false);
                    return;
                  }
                  await setBrand(b.id);
                  setOpen(false);
                }}
                disabled={isDisabled}
                className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 transition-transform hover:scale-[1.03]"
                style={{
                  background: isCurrent ? "var(--nav-active-bg)" : "var(--bg-card)",
                  border: isCurrent
                    ? "2px solid var(--nav-active-text)"
                    : "1px solid var(--border-card)",
                }}
              >
                <img
                  src={b.logo}
                  alt={b.name}
                  width={56}
                  height={56}
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
                {isCurrent && !isDisabled && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--nav-active-text)", color: "var(--nav-active-bg)" }}
                  >
                    CURRENT
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}
