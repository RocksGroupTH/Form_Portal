"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useBrand } from "./BrandProvider";
import { BrandMark } from "./BrandMark";
import { Dialog } from "@/components/ui/Dialog";

interface BrandSwitcherProps {
  compact?: boolean;
}

export function BrandSwitcher({ compact = false }: BrandSwitcherProps) {
  const { brand, setBrand, brands } = useBrand();
  const [open, setOpen] = useState(false);
  // From the fetched list, not a hardcoded array — a brand added to the company
  // brand master used to render nothing here at all.
  const current = brands.find((b) => b.id === brand);

  // Also covers the moment before the list has been answered, which is why the
  // switcher appears a beat after the rest of the navbar rather than flashing a
  // brand it cannot name.
  if (!current) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer border-none transition-colors shrink-0"
            : "flex items-center gap-2 h-9 pl-2 pr-2.5 rounded-lg cursor-pointer transition-colors shrink-0"
        }
        style={
          compact
            ? { background: "var(--bg-badge)" }
            : {
                // Bordered rather than filled, so it reads as the same control
                // as the UAT chip and the theme button beside it. The mobile bar
                // keeps the filled pill: there is no row of siblings there to
                // match, and a border on a 28px chip is mostly border.
                background: "var(--bg-card)",
                border: "1px solid var(--border-card)",
              }
        }
        title="Switch brand"
        aria-label={`Current brand: ${current.name}. Click to switch.`}
      >
        <BrandMark
          src={current.logo}
          alt=""
          code={current.id}
          size={compact ? 16 : 20}
          rounded="rounded"
        />
        {!compact && (
          <span className="flex flex-col items-start leading-none gap-0.5">
            {/* The caption is what makes a bare four-letter code legible as a
                company rather than a status. It is deliberately not a label
                element: the whole pill is one button. */}
            <span
              className="text-[9px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-faint)" }}
            >
              Brand
            </span>
            <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>
              {current.name}
            </span>
          </span>
        )}
        <ChevronRight size={13} style={{ color: "var(--text-muted)" }} className="shrink-0" />
      </button>

      <Dialog open={open} onOpenChange={setOpen} title="Switch Brand" contentClassName="max-w-2xl">
        <p className="text-[13px] mb-4" style={{ color: "var(--text-muted)" }}>
          Choose a brand workspace. Your selection is remembered across sessions.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* No disabled state: `/api/brands` returns what may be picked. The
              old "SOON" badge hung off a hardcoded `enabled` flag that was
              `true` on all four entries, so it never rendered. */}
          {brands.map((b) => {
            const isCurrent = b.id === brand;
            return (
              <button
                key={b.id}
                type="button"
                onClick={async () => {
                  if (isCurrent) {
                    setOpen(false);
                    return;
                  }
                  await setBrand(b.id);
                  setOpen(false);
                }}
                className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-transform hover:scale-[1.03]"
                style={{
                  background: isCurrent ? "var(--nav-active-bg)" : "var(--bg-card)",
                  border: isCurrent
                    ? "2px solid var(--nav-active-text)"
                    : "1px solid var(--border-card)",
                }}
              >
                <BrandMark src={b.logo} alt={b.name} code={b.id} size={56} />
                <span className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
                  {b.name}
                </span>
                {isCurrent && (
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
