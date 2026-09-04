import type { Direction, RequestStatus, StepCode, TravelItemType } from "./constants";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

export interface TravelExpenseItem {
  id?: number;
  /**
   * A client-side identity for a row that has no `id` yet.
   *
   * **Not sent to the server and never stored.** It exists because
   * `ExpenseRows` used to key its rows on the array index while `addItem`
   * prepends: adding a row shifted every index, React kept each component
   * instance at its position, and an in-flight receipt read — which lives in
   * that component's state — ended up bound to a different row. The reading
   * indicator sat on one line while the file it was reading sat on another, and
   * the amount landed in the wrong place.
   */
  localId?: string;
  itemType: TravelItemType;
  /**
   * **Thai baht, always** — whatever currency the line was entered in.
   *
   * That is the whole trick of the per-line currency (migration 129), and it is
   * what left every existing summer untouched: `calc.ts`'s `sum()`, the T-SQL
   * `SUM(i.Amount)` in `TRAVEL_DAYS_CSV_SELECT` that feeds the ERP prep queue an
   * approver reads before pressing Send, the journal builder, and the approval
   * queue's per-vehicle cell. Not one of them has to learn what a currency is.
   *
   * The figure as it was typed is `foreignAmount`; `request-service.ts` is the
   * only thing that turns one into the other, and it refuses the write rather
   * than falling back to the unconverted figure.
   */
  amount: number;
  /**
   * The currency this line was entered in. **Null and `"THB"` both mean baht**,
   * and a baht line leaves all three of these null — nobody recorded a currency
   * on it, and writing `"THB"` would claim somebody had.
   */
  currency?: string | null;
  /** THB per 1 unit of `currency`, as the server fetched it. Null on a baht line. */
  exchangeRate?: number | null;
  /** The figure as typed, before conversion. `amount` is this × `exchangeRate`. */
  foreignAmount?: number | null;
  /**
   * **Which day's rate `exchangeRate` is** — `YYYY-MM-DD` (migration 130).
   *
   * Not the day the claim was saved. Both feeds publish on working days only,
   * so a line entered on a Saturday carries Friday's rate and one entered after
   * a long weekend can carry a three-day-old one. That is correct — there is no
   * rate for a day the market did not trade — but the two dates are different
   * facts and only this one says what the figure was actually converted at.
   *
   * Null on a baht line, on an unanswered one, and on every row written before
   * 130, which backfilled nothing: nobody recorded it, and inventing a date
   * would be worse than admitting there is none.
   */
  rateAsOf?: string | null;
  /**
   * Who said so — `"BOT"` since a `BOT_CURRENCY_RATE` key was registered on
   * 2026-09-04, `"ECB"` on everything written before it and whenever that key is
   * absent, `RATE_SOURCE_OVERRIDE` when accounting corrected it by hand.
   *
   * A hand-corrected rate must never be mistaken for a published one: it is one
   * person's figure and is not reproducible from the date beside it. And rows
   * either side of 2026-09-04 are converted on different bases — a mid-market
   * reference figure against the bank's selling rate — which this column is the
   * only thing that could distinguish.
   */
  rateSource?: string | null;
  sortOrder: number;
  /** AccTravelVehicleSection.Id — manual vehicle rows only. */
  vehicleSectionId?: number | null;
  files?: AccFileMeta[];
  /** Client-only: images chosen but not yet uploaded (uploaded on save/submit). */
  pendingFiles?: PendingFile[];
}

/** Manual vehicle block within a travel day (fare/toll rows). Rate vehicles use day-level route fields. */
export interface TravelVehicleSection {
  id?: number;
  sortOrder: number;
  vehicleId: number | null;
  vehicleName: string | null;
  ratePerKm: number | null;
  isManualEntry: boolean;
  items: TravelExpenseItem[];
}

export interface AccFileMeta {
  id: number; fileName: string; fileSize: number | null;
  contentType: string | null; url: string;
}

/** Client-only in-memory attachment awaiting upload. Never persisted as JSON. */
export interface PendingFile {
  localId: string;
  file: File;
  previewUrl: string;
}

/** Intermediate stop between origin and destination on a route leg. */
export interface RouteWaypoint {
  label: string;
  lat: number;
  lng: number;
}

export interface TravelExpenseDetail {
  /** AccTravelExpense.Id — present after save/load. */
  id?: number;
  sortOrder?: number;
  travelDate: string | null;
  workDetail: string | null;
  vehicleId: number | null;
  vehicleName: string | null;
  ratePerKm: number | null;
  isManualEntry: boolean;
  direction: Direction | null;
  onwardOrigin: string | null; onwardOriginLat: number | null; onwardOriginLng: number | null;
  onwardDestination: string | null; onwardDestLat: number | null; onwardDestLng: number | null;
  onwardDistanceKm: number | null;
  onwardWaypoints?: RouteWaypoint[] | null;
  returnOrigin: string | null; returnOriginLat: number | null; returnOriginLng: number | null;
  returnDestination: string | null; returnDestLat: number | null; returnDestLng: number | null;
  returnDistanceKm: number | null;
  returnWaypoints?: RouteWaypoint[] | null;
  totalDistanceKm: number | null;
  totalAmount: number | null;
  /** Manual vehicles (Grab, taxi, plane, etc.) — each with its own expense rows. */
  sections?: TravelVehicleSection[];
  /** Rate-vehicle toll/parking rows (VehicleSectionId null in DB). */
  items: TravelExpenseItem[];
}

export interface AccApproval {
  id: number; requestId: number; stepCode: StepCode; stepOrder: number;
  /** HR Employee.StaffId of the assigned approver (manager step). */
  assignedTo: number | null; assignedEmail: string | null;
  status: "Pending" | "Approved" | "Rejected" | "Returned";
  comment: string | null; isChecked: boolean | null;
  /** HR Employee.StaffId of the person who actioned this step. */
  actionedByStaffId: number | null; actionedAt: string | null; createdAt: string;
  actionedByHrName?: string | null; actionedByHrEmail?: string | null;
  assignedToHrName?: string | null; assignedToHrEmail?: string | null;
}

export interface AccRequest {
  id: number; requestNo: string | null; formCode: string; brandCode: string | null;
  status: RequestStatus; currentStepCode: StepCode | null;
  staffId: number | null; requesterFullName: string | null; requesterEmail: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null; managerStaffId: number | null; managerEmail: string | null;
  companyName: string | null;
  /**
   * **`totalAmount` is Thai baht, always** — whatever currency the claim was
   * entered in. Every summer, report, export and ERP journal reads it, and none
   * of them knows about currency; that is the whole point of converting on the
   * way in. See `src/lib/acc/currency.ts`.
   */
  totalAmount: number | null; paymentDate: string | null;
  /**
   * ISO-3166-1 alpha-2 — the country the trip was to, and the only thing that
   * decides which currencies an expense line may be entered in. **Null means
   * Thailand**, which is every claim written before migration 129 and every
   * claim filed from here since.
   */
  countryCode: string | null;
  /**
   * **Legacy. Read only, and only for AP-1 claims filed before the currency
   * moved to the line.**
   *
   * 125 put one currency on the request; 129 moved it to
   * `AccTravelExpenseItem`, and nothing on AP-1's write path records one any
   * more — all three of AP-1's `AccRequest` writers set these back to NULL, so a
   * resumed draft cannot keep a header currency beside per-line baht amounts.
   * They stay on this interface because a claim submitted under the old design
   * still carries them and its detail page still has to print the right money.
   *
   * AP-17 writes `AccRequest.Currency` / `.ExchangeRate` for its own booking
   * desk, which is why migration 130 cannot simply drop the columns.
   *
   * Null and `"THB"` both mean baht.
   */
  currency: string | null;
  /** THB per 1 unit of `currency`. Legacy — see above. */
  exchangeRate: number | null;
  /** The claim's own figure, before conversion. Legacy — see above. */
  foreignAmount: number | null;
  /**
   * Which day's rate `exchangeRate` is, `YYYY-MM-DD` (migration 130), and where
   * it came from.
   *
   * **Live for AP-17, always null for AP-1.** AP-17's booking desk records one
   * rate for a whole booking and `saveBookingDetail` writes these beside it;
   * AP-1's three header writers clear the whole group, because its currency
   * lives on the expense line and a header rate date beside a cleared currency
   * would assert a conversion that is not there. AP-1's own provenance is on
   * `TravelExpenseItem`.
   */
  rateAsOf: string | null;
  /** Where that rate came from — see `rateAsOf`. */
  rateSource: string | null;
  submittedBy: number | null; submittedAt: string | null;
  createdAt: string; updatedAt: string;
  /** One row per travel day (sorted by sortOrder). */
  travelDays?: TravelExpenseDetail[];
  /** @deprecated First day — use travelDays */
  travel?: TravelExpenseDetail;
  approvals?: AccApproval[];
}

/** Lightweight row for draft picker (no travel items / files). */
export interface TravelDraftSummary {
  id: number;
  brandCode: string | null;
  status: RequestStatus;
  travelDate: string | null;
  travelDateTo: string | null;
  dayCount: number;
  workDetail: string | null;
  totalAmount: number | null;
  updatedAt: string;
}

export interface AccVehicle {
  id: number; name: string; ratePerKm: number | null;
  isManualEntry: boolean; isActive: boolean; sortOrder: number;
  icon: string | null;
}
export interface AccApproverRow {
  id: number; staffId: number | null; email: string; displayName: string | null; isActive: boolean;
  photoUrl: string | null;
  /** null = all Interface ERP groups; string[] = explicit subset */
  interfaceBrandCodes: string[] | null;
  /**
   * Granted AP-1 settings tabs. The list IS the granted set — [] means none,
   * never all. Only keys in `GRANTABLE_SETTINGS_TABS` ever appear here.
   */
  settingsTabs: string[];
}
export interface AccSameDayBrandRow {
  id: number;
  staffId: number | null;
  email: string | null;
  displayName: string | null;
  isActive: boolean;
}
export interface AccBrandOption {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  /**
   * Every currency configured for this brand — **a list, not a code**.
   *
   * A brand may be claimed in several (`BrandCurrency`, migration 127): KSI
   * needs Thailand (THB) and England (GBP), and more later. Each row carries
   * its own `isEnabled`, so a currency can be configured and switched off
   * without losing the country beside it.
   *
   * Consumers never filter this by hand. `claimCurrencyOptions`,
   * `bookingCurrencyOptions` and `brandCurrencyState` are what decide "does
   * this brand offer a choice, and of what" — one definition of the rule, so
   * the picker and the server's own re-derivation cannot disagree.
   */
  currencies: BrandCurrencyEntry[];
}

export interface AccBrandAccountRow {
  id: number;
  brandCode: string;
  accountNo: string;
  displayName: string | null;
  erpDescription?: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AccBrandJournalBatchRow {
  id: number;
  brandCode: string;
  batchName: string;
  displayName: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AccBrandBranchRow {
  id: number;
  brandCode: string;
  branchCode: string;
  displayName: string | null;
  deptAsBranch: boolean;
  fixedErpDeptCode: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface AccBrandErpConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceBrandCode: string | null;
  interfaceBrandName: string | null;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
  interfaceMapped: boolean;
  bcProfileComplete: boolean;
  bcConfigComplete: boolean;
}

export interface AccErpTargetBrandOption {
  brandCode: string;
  brandName: string;
  bcId: string | null;
  bcName: string | null;
  bcConnectionCode: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
}
