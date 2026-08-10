"use client";

import React from "react";
import { DateFilter } from "@/features/intelligence/master/components/filters/DateFilter";
import { ModeProportion } from "@/features/intelligence/master/components/charts/ModeProportion";
import { HourHeatmap } from "@/features/intelligence/master/components/charts/HourHeatmap";
import { ExportButton } from "@/features/intelligence/master/components/export/ExportButton";
import { ColorByKey, ViewKey } from "@/features/intelligence/master/types";
import Image from "next/image";

interface Props {
  brand: string;
  view: ViewKey;
  colorBy: ColorByKey;
}

export function LeftRail({ brand, view, colorBy }: Props) {
  return (
    <>
      <Card className="shrink-0 flex items-center justify-center">
        {/* Brand logo — object-contain on a clean white chip so the whole
            mark fits (no crop) and stays identical across brands. The chip
            is always white because some brand marks are dark/black text
            (e.g. UNO) that would be invisible on the dark theme card; a
            white badge keeps every logo legible + consistent in both modes,
            framed by the theme border so it reads as intentional. */}
        <div
          className="relative w-full h-14 md:h-16 rounded-md overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid var(--border-subtle)" }}
        >
          <Image
            src={`/brandlogo/${brand.toLowerCase()}-200.png`}
            alt={brand}
            fill
            sizes="200px"
            priority
            quality={95}
            className="object-contain p-1"
          />
        </div>
      </Card>

      <Card className="shrink-0" data-tour="export-button">
        <ExportButton brand={brand} view={view} colorBy={colorBy} />
      </Card>

      <Card className="shrink-0" data-tour="date-filter">
        <Label>Date</Label>
        <DateFilter brand={brand} />
      </Card>

      <Card className="shrink-0" data-export-id="channel-proportion">
        <Label>Channel Proportion</Label>
        <ModeProportion brand={brand} />
      </Card>

      <Card
        className="flex-1 min-h-[160px] flex flex-col"
        data-export-id="hourly"
      >
        <Label>Average Ticket by Hour</Label>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin pr-1">
          <HourHeatmap brand={brand} />
        </div>
      </Card>
    </>
  );
}

function Card({
  children,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`card p-2 overflow-hidden ${className}`}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-1 font-display"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}
