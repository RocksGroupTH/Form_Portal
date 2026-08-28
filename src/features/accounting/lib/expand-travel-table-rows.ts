import { fmtReportTravelDate, fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { fmtReportVehicleNames } from "@/features/accounting/lib/travel-sections";
import { amountInBaht } from "@/lib/acc/currency-display";
import type { ReportTravelDayLine, ReportTravelVehicleLine } from "@/lib/acc/report-service";

export interface TravelTableSourceRow {
  id: number;
  dayCount?: number;
  travelDayLines?: ReportTravelDayLine[];
  travelDate?: string | null;
  vehicleName?: string | null;
  workDetail?: string | null;
  /** Baht. `ReportRow` and `ErpPrepRow` both guarantee it. */
  totalAmount?: number | null;
  /**
   * `AccRequest.Currency` / `.ExchangeRate` — what the *day* and *vehicle*
   * figures inside `travelDayLines` are denominated in, and what converts them.
   *
   * Optional so a caller with no currency in hand still compiles; absent reads
   * as baht, which is what every row written before migration 125 is.
   */
  currency?: string | null;
  exchangeRate?: number | null;
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

/**
 * The figure for this table row **in the claim's own currency**.
 *
 * On a baht claim that is baht, which is every claim written before migration
 * 125. On a foreign one it is ringgit, or whatever the brand is configured for,
 * because `travelDayLines[]` comes from `AccTravelExpense.TotalAmount` and only
 * `AccRequest.TotalAmount` is converted.
 *
 * **Do not print this next to a `บาท` caption or add it to a baht total.** Use
 * `displayDayAmountBaht` for that, and this one for the "and here is what the
 * claimant actually spent" line beside it.
 */
export function displayDayAmountCell<T extends TravelTableSourceRow>(
  row: T,
  dayLine: ReportTravelDayLine | null,
  vehicleLine: ReportTravelVehicleLine | null,
): number | null {
  if (vehicleLine) return vehicleLine.amount;
  if (dayLine) return dayLine.totalAmount;
  return row.totalAmount ?? null;
}

/**
 * The same figure in Thai baht — the currency every one of these tables sums,
 * totals and posts in.
 *
 * A baht claim takes `amountInBaht`'s identity branch, so its cells and its
 * footer are bit-identical to what they were before the currency shipped: no
 * rate is read and no rounding is applied.
 *
 * **Null means "cannot be known", never zero and never the raw figure.** A
 * foreign claim whose rate is missing has no baht value, and showing the
 * unconverted number under a baht heading — on the ERP prep queue, immediately
 * before Send — is the failure this whole feature exists to prevent. Callers
 * render a dash and the claim's own figure, and leave the row out of the total
 * rather than folding a foreign number into it.
 */
export function displayDayAmountBaht<T extends TravelTableSourceRow>(
  row: T,
  dayLine: ReportTravelDayLine | null,
  vehicleLine: ReportTravelVehicleLine | null,
): number | null {
  // The no-day-line branch is already `AccRequest.TotalAmount`, which is baht by
  // construction — converting it a second time would multiply by the rate twice.
  if (!dayLine && !vehicleLine) return row.totalAmount ?? null;
  return amountInBaht(
    displayDayAmountCell(row, dayLine, vehicleLine),
    row.currency,
    row.exchangeRate,
  );
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
