"use client";

import { Check } from "lucide-react";

/**
 * The brand chip strip, with logos — the same control AP-1 renders above its
 * travel details (`TravelExpenseForm.tsx`, "แบรนด์ที่เบิก").
 *
 * AP-11 had three copies of a text-only pill instead: the requester's picker,
 * the reward-catalogue filter and the allowed-brand toggle. The data was never
 * the problem — `getAllowedBrands()` and `listAllBrands()` have always returned
 * `brandLogo` — the local `BrandOption` interfaces simply stopped declaring it,
 * so the field arrived and was dropped. One component now owns the markup for
 * all three, which is also why the two settings strips look like the form.
 *
 * `brandLogo` stays optional and the `<img>` hides itself on error: the path is
 * derived (`/brandlogo/{code}-200.png`), not stored, so a brand added to
 * Rocks_Codex before anyone drops a logo in `public/brandlogo/` renders as a
 * plain chip rather than a broken-image icon.
 *
 * Selection is the caller's: `isActive` and `onSelect` cover single-select (the
 * form, the catalogue filter) and multi-select (the allowed-brand toggle)
 * without this component holding any state.
 */
export interface BrandChipOption {
  brandCode: string;
  brandName: string;
  brandLogo?: string | null;
}

interface BrandChipsProps {
  brands: BrandChipOption[];
  isActive: (brandCode: string) => boolean;
  onSelect: (brandCode: string) => void;
  className?: string;
}

export function BrandChips({ brands, isActive, onSelect, className }: BrandChipsProps) {
  return (
    <div className={className ?? "flex flex-wrap gap-2"}>
      {brands.map((b) => {
        const active = isActive(b.brandCode);
        return (
          <button
            key={b.brandCode}
            type="button"
            onClick={() => onSelect(b.brandCode)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-[14px] font-semibold transition-all"
            style={{
              borderWidth: 2,
              borderStyle: "solid",
              borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
              background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
              color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
            }}
          >
            {b.brandLogo && (
              <img
                src={b.brandLogo}
                alt=""
                className="h-5 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            {b.brandName}
            {active && <Check size={14} />}
          </button>
        );
      })}
    </div>
  );
}
