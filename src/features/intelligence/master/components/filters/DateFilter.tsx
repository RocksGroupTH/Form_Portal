"use client";

import { MultiSelect } from "./MultiSelect";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { formatMonthYearShort } from "@/features/intelligence/master/lib/format";

interface Props {
  brand: string;
}

export function DateFilter({ brand }: Props) {
  const { filters, setFilter } = useMasterFilters();
  return (
    <MultiSelect
      brand={brand}
      label="Month"
      col="ym"
      values={filters.ym ?? []}
      onChange={(v) => setFilter("ym", v)}
      formatLabel={formatMonthYearShort}
      // Chronological order (oldest → newest). Matches every chart on the page
      // so the user reads "Feb-26 → Mar-26 → Apr-26" everywhere.
      sortBy={(a, b) => a.localeCompare(b)}
      // Keep the trigger chip compact — selected months show as count, not
      // their inline names (which crowd the narrow left-rail card).
      hideSelectedInTrigger
    />
  );
}
