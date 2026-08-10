"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { LegValue } from "@/features/accounting/hooks/useTravelExpenseForm";

const GoogleRoutePicker = dynamic(() => import("./GoogleRoutePicker"), { ssr: false });

interface Props {
  value: LegValue | null;
  onChange: (next: LegValue | null) => void;
  hqEnd?: "origin" | "destination";
  allowWaypoints?: boolean;
}

/** AP-1 route picker — Google Maps. */
export default function RouteMapPicker({ value, onChange, hqEnd, allowWaypoints = true }: Props) {
  return <GoogleRoutePicker value={value} onChange={onChange} hqEnd={hqEnd} allowWaypoints={allowWaypoints} />;
}
