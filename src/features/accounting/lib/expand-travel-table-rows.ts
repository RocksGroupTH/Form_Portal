import { fmtReportTravelDate, fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { fmtReportVehicleNames } from "@/features/accounting/lib/travel-sections";
import type { ReportTravelDayLine, ReportTravelVehicleLine } from "@/lib/acc/report-service";

export interface TravelTableSourceRow {
  id: number;
  dayCount?: number;
  travelDayLines?: ReportTravelDayLine[];
  travelDate?: string | null;
  vehicleName?: string | null;
  workDetail?: string | null;
  totalAmount?: number | null;
}

export interface TravelDisplayRow<T extends TravelTableSourceRow> {
  key: string;
  row: T;
  dayLine: ReportTravelDayLine | null;
  vehicleLine: ReportTravelVehicleLine | null;
}

export interface GroupedTravelDisplayRow<T extends TravelTableSourceRow>
  extends TravelDisplayRow<T> {
  requestGroupSize: number;
  requestGroupIndex: number;
  dayGroupSize: number;
  dayGroupIndex: number;
}

function vehiclesForDayLine(dayLine: ReportTravelDayLine): ReportTravelVehicleLine[] {
  if (dayLine.vehicles.length > 0) return dayLine.vehicles;
  if (dayLine.vehicleNames.length === 0) return [];
  return dayLine.vehicleNames.map((name) => ({
    vehicleName: name,
    amount: dayLine.vehicleNames.length === 1 ? dayLine.totalAmount : 0,
  }));
}

/** One table row per vehicle within each travel day. */
export function expandTravelDisplayRows<T extends TravelTableSourceRow>(
  rows: T[],
): TravelDisplayRow<T>[] {
  const out: TravelDisplayRow<T>[] = [];
  for (const row of rows) {
    const lines = row.travelDayLines;
    if (lines && lines.length > 0) {
      for (const line of lines) {
        const vehicles = vehiclesForDayLine(line);
        if (vehicles.length === 0) {
          out.push({ key: `${row.id}-${line.travelDate}`, row, dayLine: line, vehicleLine: null });
          continue;
        }
        for (let vi = 0; vi < vehicles.length; vi++) {
          const vehicleLine = vehicles[vi];
          out.push({
            key: `${row.id}-${line.travelDate}-${vi}-${vehicleLine.vehicleName}`,
            row,
            dayLine: line,
            vehicleLine,
          });
        }
      }
    } else {
      out.push({ key: String(row.id), row, dayLine: null, vehicleLine: null });
    }
  }
  return out;
}

export function withTravelGroupMeta<T extends TravelTableSourceRow>(
  rows: TravelDisplayRow<T>[],
): GroupedTravelDisplayRow<T>[] {
  const out: GroupedTravelDisplayRow<T>[] = [];
  let i = 0;
  while (i < rows.length) {
    const requestId = rows[i].row.id;
    let reqEnd = i + 1;
    while (reqEnd < rows.length && rows[reqEnd].row.id === requestId) reqEnd += 1;
    const requestGroupSize = reqEnd - i;

    let j = i;
    while (j < reqEnd) {
      const travelDate = rows[j].dayLine?.travelDate ?? "";
      let dayEnd = j + 1;
      while (dayEnd < reqEnd && (rows[dayEnd].dayLine?.travelDate ?? "") === travelDate) dayEnd += 1;
      const dayGroupSize = dayEnd - j;

      for (let k = j; k < dayEnd; k++) {
        out.push({
          ...rows[k],
          requestGroupSize,
          requestGroupIndex: k - i,
          dayGroupSize,
          dayGroupIndex: k - j,
        });
      }
      j = dayEnd;
    }
    i = reqEnd;
  }
  return out;
}

export function displayTravelDateCell<T extends TravelTableSourceRow>(
  row: T,
  dayLine: ReportTravelDayLine | null,
): string {
  if (dayLine) return fmtYmdDisplay(dayLine.travelDate);
  return fmtReportTravelDate({
    travelDate: row.travelDate ?? null,
    dayCount: row.dayCount,
  });
}

export function displayDayAmountCell<T extends TravelTableSourceRow>(
  row: T,
  dayLine: ReportTravelDayLine | null,
  vehicleLine: ReportTravelVehicleLine | null,
): number | null {
  if (vehicleLine) return vehicleLine.amount;
  if (dayLine) return dayLine.totalAmount;
  return row.totalAmount ?? null;
}

export function displayRowVehicleCell<T extends TravelTableSourceRow>(
  row: T,
  dayLine: ReportTravelDayLine | null,
  vehicleLine: ReportTravelVehicleLine | null,
): string {
  if (vehicleLine?.vehicleName) return vehicleLine.vehicleName;
  if (dayLine?.vehicleNames?.length) return dayLine.vehicleNames.join(", ");
  return fmtReportVehicleNames({
    vehicleName: row.vehicleName ?? null,
  });
}

export function displayDayWorkDetailCell<T extends TravelTableSourceRow>(
  row: T,
  dayLine: ReportTravelDayLine | null,
): string | null {
  if (dayLine?.workDetail?.trim()) return dayLine.workDetail.trim();
  return row.workDetail?.trim() || null;
}
