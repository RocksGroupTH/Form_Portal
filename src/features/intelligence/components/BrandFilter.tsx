"use client";
import React from "react";
import { BRAND_COLORS } from "@/features/intelligence/constants";

interface BrandFilterProps {
  value: string;
  onChange: (brand: string) => void;
  brands: string[];
}

export function BrandFilter({ value, onChange, brands }: BrandFilterProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {brands.map((brand) => {
        const isActive = value === brand;
        const dotColor = BRAND_COLORS[brand] ?? "var(--text-muted)";
        return (
          <button
            key={brand}
            onClick={() => onChange(brand)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full cursor-pointer transition-colors"
            style={{
              background: isActive
                ? "var(--nav-active-bg)"
                : "transparent",
              color: isActive
                ? "var(--nav-active-text)"
                : "var(--text-muted)",
              border: isActive
                ? "1px solid transparent"
                : "1px solid var(--border-card)",
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: dotColor }}
            />
            {brand}
          </button>
        );
      })}
    </div>
  );
}
