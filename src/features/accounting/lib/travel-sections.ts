import type { AccVehicle, TravelExpenseDetail, TravelExpenseItem, TravelVehicleSection } from "@/features/accounting/types";

function emptySection(sortOrder: number): TravelVehicleSection {
  return {
    sortOrder,
    vehicleId: null,
    vehicleName: null,
    ratePerKm: null,
    isManualEntry: true,
    items: [],
  };
}

/** Create a manual vehicle section from master vehicle config. */
export function createManualSection(v: AccVehicle, sortOrder: number): TravelVehicleSection {
  return {
    sortOrder,
    vehicleId: v.id,
    vehicleName: v.name,
    ratePerKm: v.ratePerKm,
    isManualEntry: true,
    items: [],
  };
}

/** Split legacy single-vehicle rows into rate day fields + manual sections. */
export function normalizeTravelDay(day: TravelExpenseDetail): TravelExpenseDetail {
  const sections = Array.from(day.sections ?? []);
  let items = Array.from(day.items ?? []);

  if (sections.length === 0 && day.vehicleId && day.isManualEntry && items.length > 0) {
    sections.push({
      sortOrder: 0,
      vehicleId: day.vehicleId,
      vehicleName: day.vehicleName,
      ratePerKm: day.ratePerKm,
      isManualEntry: true,
      items,
    });
    items = [];
  }

  if (sections.length === 0 && day.vehicleId && day.isManualEntry) {
    sections.push({
      sortOrder: 0,
      vehicleId: day.vehicleId,
      vehicleName: day.vehicleName,
      ratePerKm: day.ratePerKm,
      isManualEntry: true,
      items: [],
    });
  }

  const manualSections = sections.filter((s) => s.isManualEntry);
  const hasRate = !!(day.vehicleId && !day.isManualEntry);

  if (!hasRate && manualSections.length > 0 && !day.isManualEntry) {
    const first = manualSections[0];
    return {
      ...day,
      sections: manualSections.map((s, i) => ({ ...s, sortOrder: i })),
      items,
      vehicleId: first.vehicleId,
      vehicleName: first.vehicleName,
      ratePerKm: first.ratePerKm,
      isManualEntry: true,
    };
  }

  return {
    ...day,
    sections: manualSections.map((s, i) => ({ ...s, sortOrder: i })),
    items,
  };
}

export function normalizeTravelDays(days: TravelExpenseDetail[]): TravelExpenseDetail[] {
  return days.map((d, i) => normalizeTravelDay({ ...d, sortOrder: d.sortOrder ?? i }));
}

export function hasRateVehicle(day: TravelExpenseDetail): boolean {
  return !!(day.vehicleId && !day.isManualEntry);
}

export function isVehicleSelected(day: TravelExpenseDetail, vehicleId: number): boolean {
  const d = normalizeTravelDay(day);
  if (hasRateVehicle(d) && d.vehicleId === vehicleId) return true;
  return (d.sections ?? []).some((s) => s.vehicleId === vehicleId);
}

export function selectedVehicleCount(day: TravelExpenseDetail): number {
  const d = normalizeTravelDay(day);
  let n = (d.sections ?? []).length;
  if (hasRateVehicle(d)) n += 1;
  return n;
}

/** Comma-separated vehicle names for summary display. */
export function formatDayVehicleNames(day: TravelExpenseDetail): string {
  const d = normalizeTravelDay(day);
  const names: string[] = [];
  if (hasRateVehicle(d) && d.vehicleName) names.push(d.vehicleName);
  for (const s of d.sections ?? []) {
    if (s.vehicleName && !names.includes(s.vehicleName)) names.push(s.vehicleName);
  }
  return names.join(", ");
}

/** Vehicle column for report / approval queues (all unique vehicles across days). */
export function reportVehicleNames(row: {
  vehicleName: string | null;
  vehicleNames?: string[];
}): string[] {
  if (row.vehicleNames && row.vehicleNames.length > 0) return row.vehicleNames;
  if (row.vehicleName) return [row.vehicleName];
  return [];
}

export function fmtReportVehicleNames(row: {
  vehicleName: string | null;
  vehicleNames?: string[];
}): string {
  const names = reportVehicleNames(row);
  if (names.length === 0) return "—";
  if (names.length === 1) return names[0];
  return `${names.length} พาหนะ · ${names.join(", ")}`;
}

export function allDayItems(day: TravelExpenseDetail): TravelExpenseItem[] {
  const d = normalizeTravelDay(day);
  const out = Array.from(d.items ?? []);
  for (const s of d.sections ?? []) {
    for (const it of s.items ?? []) out.push(it);
  }
  return out;
}

export function toggleVehicleOnDay(
  day: TravelExpenseDetail,
  vehicleId: number | null,
  vehicles: AccVehicle[],
): TravelExpenseDetail {
  if (!vehicleId) {
    return normalizeTravelDay({
      ...day,
      vehicleId: null,
      vehicleName: null,
      ratePerKm: null,
      isManualEntry: false,
      direction: null,
      items: [],
      sections: [],
    });
  }

  const v = vehicles.find((veh) => veh.id === vehicleId);
  if (!v) return day;

  const normalized = normalizeTravelDay(day);
  const sections = Array.from(normalized.sections ?? []);

  if (v.isManualEntry) {
    const idx = sections.findIndex((s) => s.vehicleId === vehicleId);
    if (idx >= 0) {
      sections.splice(idx, 1);
    } else {
      sections.push(createManualSection(v, sections.length));
    }
    const next: TravelExpenseDetail = { ...normalized, sections };
    if (!hasRateVehicle(normalized) && sections.length === 1) {
      const s = sections[0];
      next.vehicleId = s.vehicleId;
      next.vehicleName = s.vehicleName;
      next.ratePerKm = s.ratePerKm;
      next.isManualEntry = true;
      next.direction = null;
      next.items = [];
    } else if (!hasRateVehicle(normalized) && sections.length === 0) {
      next.vehicleId = null;
      next.vehicleName = null;
      next.ratePerKm = null;
      next.isManualEntry = false;
      next.items = [];
    }
    return normalizeTravelDay(next);
  }

  if (hasRateVehicle(normalized) && normalized.vehicleId === vehicleId) {
    return normalizeTravelDay({
      ...normalized,
      vehicleId: null,
      vehicleName: null,
      ratePerKm: null,
      isManualEntry: sections.length > 0,
      direction: null,
      onwardDestination: null,
      onwardDestLat: null,
      onwardDestLng: null,
      onwardDistanceKm: null,
      onwardWaypoints: null,
      returnOrigin: null,
      returnOriginLat: null,
      returnOriginLng: null,
      returnDistanceKm: null,
      items: [],
    });
  }

  return normalizeTravelDay({
    ...normalized,
    vehicleId: v.id,
    vehicleName: v.name,
    ratePerKm: v.ratePerKm,
    isManualEntry: false,
    direction: normalized.direction ?? "round",
    items: normalized.items ?? [],
  });
}

export function patchManualSection(
  day: TravelExpenseDetail,
  sectionIndex: number,
  patch: Partial<TravelVehicleSection>,
): TravelExpenseDetail {
  const normalized = normalizeTravelDay(day);
  const sections = Array.from(normalized.sections ?? []);
  if (sectionIndex < 0 || sectionIndex >= sections.length) return normalized;
  sections[sectionIndex] = { ...sections[sectionIndex], ...patch };
  return normalizeTravelDay({ ...normalized, sections });
}

export function addSectionItem(
  day: TravelExpenseDetail,
  sectionIndex: number,
  itemType: TravelExpenseItem["itemType"],
): TravelExpenseDetail {
  return patchManualSection(day, sectionIndex, {
    items: [
      { itemType, amount: 0, sortOrder: 0, files: [] },
      ...(normalizeTravelDay(day).sections?.[sectionIndex]?.items ?? []),
    ],
  });
}

export function updateSectionItem(
  day: TravelExpenseDetail,
  sectionIndex: number,
  itemIndex: number,
  patch: Partial<TravelExpenseItem>,
): TravelExpenseDetail {
  const normalized = normalizeTravelDay(day);
  const sections = Array.from(normalized.sections ?? []);
  const sec = sections[sectionIndex];
  if (!sec) return normalized;
  const items = Array.from(sec.items ?? []);
  items[itemIndex] = { ...items[itemIndex], ...patch };
  sections[sectionIndex] = { ...sec, items };
  return normalizeTravelDay({ ...normalized, sections });
}

export function removeSectionItem(
  day: TravelExpenseDetail,
  sectionIndex: number,
  itemIndex: number,
): TravelExpenseDetail {
  const normalized = normalizeTravelDay(day);
  const sections = Array.from(normalized.sections ?? []);
  const sec = sections[sectionIndex];
  if (!sec) return normalized;
  const items = Array.from(sec.items ?? []).filter((_, i) => i !== itemIndex);
  sections[sectionIndex] = { ...sec, items };
  return normalizeTravelDay({ ...normalized, sections });
}

export function cloneSectionsForDayCopy(sections: TravelVehicleSection[] | undefined): TravelVehicleSection[] {
  return (sections ?? []).map((sec, si) => ({
    sortOrder: si,
    vehicleId: sec.vehicleId,
    vehicleName: sec.vehicleName,
    ratePerKm: sec.ratePerKm,
    isManualEntry: sec.isManualEntry,
    // The line's money travels as a set. Copying `amount` alone would carry the
    // baht across while leaving the copy with no currency, which is now the
    // *unanswered* state (see `effectiveLineCurrency`) — so a copied line would
    // arrive holding a baht figure the form insists somebody name a currency
    // for, and the day it was copied from would be the only place to look it up.
    // Under the rule this replaced the same omission was worse still: a 164.47
    // baht line was re-read as 164.47 **ringgit** and converted a second time.
    // The files deliberately do not travel: a receipt belongs to the day it was
    // issued on.
    items: (sec.items ?? []).map((it, i) => ({
      itemType: it.itemType,
      amount: Number(it.amount) || 0,
      currency: it.currency ?? null,
      exchangeRate: it.exchangeRate ?? null,
      foreignAmount: it.foreignAmount ?? null,
      // The rate's provenance is part of the same set (migration 130). The next
      // save re-fetches and overwrites all five, so this is not what makes the
      // copy correct — it is what stops the copy from showing a rate with no
      // date beside it in the meantime.
      rateAsOf: it.rateAsOf ?? null,
      rateSource: it.rateSource ?? null,
      sortOrder: i,
      files: [],
      pendingFiles: [],
    })),
  }));
}
