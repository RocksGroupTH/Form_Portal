import { getAccPool, sql } from "@/lib/acc/pool";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { allocateRequestNo } from "@/lib/acc/sequence";
import { deleteStoredFiles, type StoredFileRef } from "@/lib/acc/stored-file";
import { computeTotalAmount, computeTotalDistance, computeRequestTotalAmount, computeRequestTotalDistance, allDayItems } from "@/lib/acc/calc";
import {
  normalizeTravelDay,
  normalizeTravelDays as normalizeTravelDaySections,
  hasRateVehicle,
} from "@/features/accounting/lib/travel-sections";
import {
  parseRouteWaypoints,
  serializeRouteWaypoints,
} from "@/features/accounting/lib/route-waypoints";
import { resolveManagerEmail, resolveRequesterForActor, type RequesterSnapshot } from "@/lib/acc/employee-context";
import {
  assertFormWritable,
  isUatRequest,
  UAT_MANAGER_MISSING_ERROR,
} from "@/lib/uat-tester/guards";
import { queueEmail } from "@/lib/acc/email-queue";
import { AccConflictError, SUBMIT_ALREADY_CLAIMED } from "@/lib/acc/request-errors";
import { buildEmail } from "@/lib/acc/email-templates";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { isBaht, toBaht, THB, type BrandCurrencyEntry } from "@/lib/acc/currency";
import { resolveRate } from "@/lib/acc/fx";
import { listBrandRegistry } from "@/lib/brand-registry";
import {
  DEFAULT_COUNTRY,
  effectiveClaimCountry,
  effectiveLineCurrency,
  lineCurrencyOptions,
  lineNeedsCurrency,
  LINE_CURRENCY_MISSING_ERROR,
} from "@/features/accounting/lib/claim-currency";
import type {
  AccApproval,
  AccFileMeta,
  AccRequest,
  TravelDraftSummary,
  TravelExpenseDetail,
  TravelExpenseItem,
  TravelVehicleSection,
} from "@/features/accounting/types";

export interface SaveInput {
  id?: number;
  brandCode: string | null;
  /** Preferred — multiple travel days per request. */
  travelDays?: TravelExpenseDetail[];
  /** @deprecated Single day — wrapped as one-element travelDays. */
  travel?: TravelExpenseDetail;
  /** Optional: open on behalf of a same-department colleague (their HR StaffId). */
  requesterStaffId?: number | null;
  /**
   * ISO-3166-1 alpha-2 — the country the trip was to, as the form's picker has
   * it. Absent, empty or unknown all mean Thailand.
   *
   * It is the **only** currency-shaped thing the client posts at the request
   * level, and it is re-checked against the brand here (`resolveClaimCountry`)
   * so a hand-shaped body cannot file from a country the brand does not offer.
   * Each line then posts its own `currency`, and **no rate is ever posted** —
   * the server fetches its own, which is the one part of AP-2's approach
   * deliberately not reused: its stored rate is whatever the browser sent.
   */
  countryCode?: string | null;
}

/* ─────────────────────────── currency ─────────────────────────── */

/**
 * The rate could not be had, so nothing may be written.
 *
 * Fail-closed is the whole design: the alternative is an `Amount` column in baht
 * that is really a foreign figure, which no screen would ever reveal. A baht
 * line never reaches this — `lineFxOrThrow` takes its identity branch — so an FX
 * outage cannot stop the ordinary Thai claims that are almost all of them.
 */
const FX_UNAVAILABLE_ERROR =
  "ไม่สามารถดึงอัตราแลกเปลี่ยนได้ในขณะนี้ — กรุณาลองใหม่อีกครั้ง หรือเปลี่ยนสกุลเงินของรายการเป็นบาท";

/**
 * The line's own money, already converted, exactly as it is written.
 *
 * `amount` is the baht that reaches `AccTravelExpenseItem.Amount`; the other
 * three are the record of where it came from. On a **Thai** claim's baht line
 * all three are null together — nobody recorded a currency for it, and writing
 * `'THB'` would claim somebody had — which is what keeps such a claim writing
 * byte-identical rows to the ones it wrote before this feature existed.
 *
 * On a claim that *offers* a choice they are not, and cannot be. There a
 * missing `Currency` is how an **unanswered** line is written down, so a baht
 * line has to record `'THB'` or the two become indistinguishable and the submit
 * would refuse a currency the requester had positively chosen.
 */
interface LineFx {
  amount: number;
  currency: string | null;
  rate: number | null;
  foreignAmount: number | null;
}

/**
 * One line's figure turned into the baht its `Amount` column must hold — **or
 * an exception**.
 *
 * There is no fallback branch on purpose. `toBaht` returns null when it cannot
 * know, and the one thing that must never happen is falling back to the
 * unconverted figure: that writes a foreign number into a baht column, on the
 * path that feeds `AccRequest.TotalAmount`, every report, every export and every
 * Business Central journal, and it leaves no trace on any screen.
 *
 * **A `null` currency is a line nobody has priced**, and it is written rather
 * than refused: `Amount` 0, `Currency` NULL, the typed figure kept in
 * `ForeignAmount`. That has to be *savable* — a draft is where the question is
 * asked and answered — while being unsubmittable, which `validateForSubmit`
 * enforces on exactly the same predicate. Zero baht is the truth for it, not a
 * guess: nobody knows what the line is worth, so it is worth nothing to every
 * total until somebody says.
 *
 * `recordBaht` is `lineCurrencyOptions(country).length > 0` — see `LineFx`.
 */
function lineFxOrThrow(
  typed: number,
  currency: string | null,
  rate: number | null,
  recordBaht: boolean,
): LineFx {
  if (currency === null) {
    return { amount: 0, currency: null, rate: null, foreignAmount: typed };
  }
  if (isBaht(currency)) {
    // The identity branch. No rate is consulted and no rounding is applied, so
    // a Thai line's arithmetic is bit-identical to what it was before migration
    // 129 — which is the promise the whole per-line design rests on.
    return { amount: typed, currency: recordBaht ? THB : null, rate: null, foreignAmount: null };
  }
  const baht = toBaht(typed, rate);
  if (baht === null) throw new Error(FX_UNAVAILABLE_ERROR);
  return { amount: baht, currency, rate, foreignAmount: typed };
}

/** The figure the requester actually typed, wherever the client put it. */
function typedFigure(it: TravelExpenseItem): number {
  const raw = it.foreignAmount === null || it.foreignAmount === undefined
    ? it.amount
    : it.foreignAmount;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The country a claim is filed from, checked against what the brand actually
 * offers.
 *
 * Reads the brand through `listBrandRegistry()`, which opens
 * `getProductionFormPool()` — `BrandCurrency` has no row in
 * `Rocks_Portal_Form_UAT` and a `getAccPool()` read of it throws
 * `Invalid object name` for every UAT tester. This file must therefore never
 * name that table itself; `currency-pool-guard.test.ts` enforces exactly that,
 * per file, and `request-service.ts` imports `getAccPool` on line 1.
 *
 * **Anything the brand does not offer resolves to Thailand rather than
 * throwing.** `effectiveClaimCountry` is the same function the form applies
 * before it posts, so the two agree: an admin switching a `BrandCurrency` row
 * off — or removing it — leaves a draft holding `MY` savable, as a Thai claim,
 * instead of stranding it behind a picker that no longer offers it.
 *
 * Thailand short-circuits before any pool is opened, so an ordinary Thai claim
 * makes no extra call at all.
 */
async function resolveClaimCountry(
  brandCode: string | null,
  posted: string | null | undefined,
): Promise<string> {
  const want = (posted ?? "").trim().toUpperCase();
  if (want === "" || want === DEFAULT_COUNTRY) return DEFAULT_COUNTRY;
  if (!brandCode) return DEFAULT_COUNTRY;

  let brand: { currencies: BrandCurrencyEntry[] } | null = null;
  const brands = await listBrandRegistry();
  for (const b of brands) {
    if (b.code === brandCode) {
      brand = { currencies: b.currencies };
      break;
    }
  }
  return effectiveClaimCountry(want, brand);
}

/**
 * Every expense line converted to baht, before anything is written.
 *
 * Converting the whole payload up front rather than line by line inside the
 * transaction is what keeps the rest of this file unaware that a currency
 * exists: `computeTotalAmount`, `computeRequestTotalAmount`, `bindTravel` and
 * `persistTravelItems` all then operate on baht, and both `TotalAmount` columns
 * — the per-day one and the header — come out in baht with no conversion step
 * of their own.
 *
 * **One rate is enough, and it is fetched only if a line actually needs it.**
 * `effectiveLineCurrency` can only ever answer the country's own currency, baht,
 * or nothing at all, so every foreign line on a claim is in the same currency —
 * a second lookup could only ask for the same code again. And a trip to Malaysia
 * whose every line happens to be in baht makes no FX call at all, so an outage
 * at the provider cannot stop work that does not depend on it (the point
 * `needsRate` in `@/lib/acc/fx` makes for the whole feature). A fetch that fails
 * **throws**: the claim is not saved at a rate we guessed.
 *
 * A line whose currency is still unanswered needs no rate either — there is
 * nothing to convert from — so a draft full of blanks saves without touching the
 * provider, which is what makes answering them a calm job rather than one that
 * can fail.
 *
 * Called **outside** the transaction, deliberately: this reaches the network,
 * and holding row locks across an 8-second FX timeout is how a save turns into a
 * deadlock.
 */
async function toBahtDays(
  days: TravelExpenseDetail[],
  country: string,
): Promise<TravelExpenseDetail[]> {
  const currencyOf = (it: TravelExpenseItem) => effectiveLineCurrency(it.currency, country);
  // True exactly where the form renders a line-currency dropdown, and the one
  // thing that decides whether a baht line records `'THB'` — see `LineFx`.
  const recordBaht = lineCurrencyOptions(country).length > 0;

  // One pass to find out whether any rate is needed at all. `isBaht(null)` is
  // true, so an unanswered line is skipped here as well as a baht one: neither
  // has a figure this rate would convert.
  let foreign: string | null = null;
  for (const day of days) {
    for (const it of allDayItems(day)) {
      const cur = currencyOf(it);
      if (cur !== null && !isBaht(cur)) { foreign = cur; break; }
    }
    if (foreign) break;
  }

  let rate: number | null = null;
  if (foreign) {
    const fx = await resolveRate(foreign);
    if (!fx) throw new Error(FX_UNAVAILABLE_ERROR);
    rate = fx.rate;
  }

  const convert = (it: TravelExpenseItem): TravelExpenseItem => {
    const fx = lineFxOrThrow(typedFigure(it), currencyOf(it), rate, recordBaht);
    return {
      ...it,
      amount: fx.amount,
      currency: fx.currency,
      exchangeRate: fx.rate,
      foreignAmount: fx.foreignAmount,
    };
  };

  return days.map((day) => ({
    ...day,
    items: (day.items ?? []).map(convert),
    sections: (day.sections ?? []).map((sec) => ({
      ...sec,
      items: (sec.items ?? []).map(convert),
    })),
  }));
}

/**
 * AP-1 records no request-level currency any more.
 *
 * 125 put `Currency` / `ExchangeRate` / `ForeignAmount` on `AccRequest`; 129
 * moved the currency to the line, and every AP-1 write of that header now clears
 * all three. Clearing rather than merely not writing is deliberate and it is the
 * one place this code still names those columns: a draft saved under the old
 * design carries `Currency='MYR'` there, and leaving it beside per-line baht
 * amounts would have every display surface convert an already-converted figure a
 * second time — `report-service.ts`, `erp-prep-service.ts` and `RequestDetail`
 * all read the header currency to decide what a day figure is denominated in.
 *
 * Literals, not parameters: there is no value to bind, and nothing to
 * interpolate.
 *
 * AP-17 still writes those two columns for its booking desk, which is why they
 * cannot simply be dropped.
 */
const FX_CLEAR = `Currency=NULL, ExchangeRate=NULL, ForeignAmount=NULL`;

/* ─────────────────────────── helpers ─────────────────────────── */

function emptyTravel(): TravelExpenseDetail {
  return {
    sortOrder: 0,
    travelDate: null, workDetail: null, vehicleId: null, vehicleName: null,
    ratePerKm: null, isManualEntry: false, direction: null,
    onwardOrigin: null, onwardOriginLat: null, onwardOriginLng: null,
    onwardDestination: null, onwardDestLat: null, onwardDestLng: null, onwardDistanceKm: null,
    onwardWaypoints: null,
    returnOrigin: null, returnOriginLat: null, returnOriginLng: null,
    returnDestination: null, returnDestLat: null, returnDestLng: null, returnDistanceKm: null,
    returnWaypoints: null,
    totalDistanceKm: null, totalAmount: null, sections: [], items: [],
  };
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function mapRequestRow(r: Record<string, unknown>): AccRequest {
  return {
    id: r.Id as number,
    requestNo: (r.RequestNo as string) ?? null,
    formCode: r.FormCode as string,
    brandCode: (r.BrandCode as string) ?? null,
    status: r.Status as AccRequest["status"],
    currentStepCode: (r.CurrentStepCode as AccRequest["currentStepCode"]) ?? null,
    staffId: (r.StaffId as number) ?? null,
    requesterFullName: (r.RequesterFullName as string) ?? null,
    requesterEmail: (r.RequesterEmail as string) ?? null,
    requesterPosition: (r.RequesterPosition as string) ?? null,
    requesterDepartmentName: (r.RequesterDepartmentName as string) ?? null,
    managerStaffId: (r.ManagerStaffId as number) ?? null,
    managerEmail: (r.ManagerEmail as string) ?? null,
    companyName: (r.CompanyName as string) ?? null,
    totalAmount: num(r.TotalAmount),
    // Null means Thailand — every claim written before migration 129, and every
    // one filed from here since, unless the requester named somewhere else.
    countryCode: ((r.CountryCode as string | null) ?? "").trim().toUpperCase() || null,
    // Legacy, and NULL on anything AP-1 has written since the currency moved to
    // the line. Kept so a claim filed under 125's design still prints the right
    // money on its detail page. See `types.ts`.
    currency: ((r.Currency as string | null) ?? "").trim() || null,
    exchangeRate: num(r.ExchangeRate),
    foreignAmount: num(r.ForeignAmount),
    paymentDate: r.PaymentDate ? toYmd(r.PaymentDate as Date) : null,
    submittedBy: (r.SubmittedBy as number) ?? null,
    submittedAt: r.SubmittedAt ? (r.SubmittedAt as Date).toISOString() : null,
    createdAt: r.CreatedAt ? (r.CreatedAt as Date).toISOString() : "",
    updatedAt: r.UpdatedAt ? (r.UpdatedAt as Date).toISOString() : "",
  };
}

/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Normalize save payload to a non-empty travelDays array. */
export function normalizeTravelDays(input: Pick<SaveInput, "travelDays" | "travel">): TravelExpenseDetail[] {
  let days: TravelExpenseDetail[];
  if (input.travelDays && input.travelDays.length > 0) {
    days = input.travelDays.map((d, i) => ({ ...emptyTravel(), ...d, sortOrder: d.sortOrder ?? i }));
  } else if (input.travel) {
    days = [{ ...emptyTravel(), ...input.travel, sortOrder: input.travel.sortOrder ?? 0 }];
  } else {
    days = [{ ...emptyTravel(), travelDate: null }];
  }
  return normalizeTravelDaySections(days);
}

function mapTravelRow(
  t: Record<string, unknown>,
  items: TravelExpenseItem[],
): TravelExpenseDetail {
  return {
    id: t.Id as number,
    sortOrder: (t.SortOrder as number) ?? 0,
    travelDate: t.TravelDate ? toYmd(t.TravelDate as Date) : null,
    workDetail: (t.WorkDetail as string) ?? null,
    vehicleId: (t.VehicleId as number) ?? null,
    vehicleName: (t.VehicleName as string) ?? null,
    ratePerKm: num(t.RatePerKm),
    isManualEntry: !!t.IsManualEntry,
    direction: (t.Direction as TravelExpenseDetail["direction"]) ?? null,
    onwardOrigin: (t.OnwardOrigin as string) ?? null,
    onwardOriginLat: num(t.OnwardOriginLat), onwardOriginLng: num(t.OnwardOriginLng),
    onwardDestination: (t.OnwardDestination as string) ?? null,
    onwardDestLat: num(t.OnwardDestLat), onwardDestLng: num(t.OnwardDestLng),
    onwardDistanceKm: num(t.OnwardDistanceKm),
    onwardWaypoints: parseRouteWaypoints(t.OnwardWaypoints),
    returnOrigin: (t.ReturnOrigin as string) ?? null,
    returnOriginLat: num(t.ReturnOriginLat), returnOriginLng: num(t.ReturnOriginLng),
    returnDestination: (t.ReturnDestination as string) ?? null,
    returnDestLat: num(t.ReturnDestLat), returnDestLng: num(t.ReturnDestLng),
    returnDistanceKm: num(t.ReturnDistanceKm),
    returnWaypoints: parseRouteWaypoints(t.ReturnWaypoints),
    totalDistanceKm: num(t.TotalDistanceKm),
    totalAmount: num(t.TotalAmount),
    sections: [],
    items,
  };
}

function mapItemRow(x: Record<string, unknown>, filesByItem: Map<number, AccFileMeta[]>): TravelExpenseItem {
  return {
    id: x.Id as number,
    itemType: x.ItemType as TravelExpenseItem["itemType"],
    amount: Number(x.Amount) || 0,
    sortOrder: x.SortOrder as number,
    vehicleSectionId: (x.VehicleSectionId as number) ?? null,
    // Migration 129. Absent on the legacy SELECT below and on every row written
    // before it, which reads as a baht line — the truth, since nobody recorded a
    // currency for it and every one of them was in baht.
    currency: ((x.Currency as string | null) ?? "").trim() || null,
    exchangeRate: num(x.ExchangeRate),
    foreignAmount: num(x.ForeignAmount),
    files: filesByItem.get(x.Id as number) ?? [],
  };
}

/**
 * Every travel day of a request, with its sections, its items and their files.
 *
 * **Takes anything that can issue a request** — the pool, or an open
 * transaction. `AccTx` is that structural shape and `ConnectionPool` satisfies
 * it, which is what lets `line-rate-override.ts` recompute a claim's stored
 * totals from the same day objects `getRequest` builds, inside the transaction
 * that changed a line. A second loader there would be a second answer to "what
 * is on this claim", on the path that decides what it is worth.
 */
export async function loadTravelDays(pool: AccTx, requestId: number): Promise<TravelExpenseDetail[]> {
  const tRes = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT * FROM [dbo].[AccTravelExpense] WHERE RequestId = @id ORDER BY SortOrder, TravelDate, Id`);
  if (tRes.recordset.length === 0) return [];

  const travelIds = (tRes.recordset as Record<string, unknown>[]).map((r) => r.Id as number);

  const filesRes = await pool.request().input("rid", sql.Int, requestId)
    .query(`SELECT Id, RefId, FileName, FileSize, ContentType, StoragePath
            FROM [dbo].[AccRequestFile] WHERE RequestId = @rid AND RefType = 'travel_item'`);
  const filesByItem = new Map<number, AccFileMeta[]>();
  for (const f of filesRes.recordset as Record<string, unknown>[]) {
    const refId = f.RefId as number;
    const meta: AccFileMeta = {
      id: f.Id as number, fileName: f.FileName as string,
      fileSize: (f.FileSize as number) ?? null, contentType: (f.ContentType as string) ?? null,
      url: `/api/request/accounting/files/${f.Id as number}`,
    };
    if (!filesByItem.has(refId)) filesByItem.set(refId, []);
    filesByItem.get(refId)!.push(meta);
  }

  const sectionsByTravel = new Map<number, TravelVehicleSection[]>();
  try {
    const secRes = await pool.request().input("rid", sql.Int, requestId)
      .query(`SELECT s.* FROM [dbo].[AccTravelVehicleSection] s
              INNER JOIN [dbo].[AccTravelExpense] t ON t.Id = s.TravelExpenseId
              WHERE t.RequestId = @rid
              ORDER BY s.TravelExpenseId, s.SortOrder, s.Id`);
    for (const row of secRes.recordset as Record<string, unknown>[]) {
      const teid = row.TravelExpenseId as number;
      const sec: TravelVehicleSection = {
        id: row.Id as number,
        sortOrder: (row.SortOrder as number) ?? 0,
        vehicleId: (row.VehicleId as number) ?? null,
        vehicleName: (row.VehicleName as string) ?? null,
        ratePerKm: num(row.RatePerKm),
        isManualEntry: !!row.IsManualEntry,
        items: [],
      };
      if (!sectionsByTravel.has(teid)) sectionsByTravel.set(teid, []);
      sectionsByTravel.get(teid)!.push(sec);
    }
  } catch {
    // Table may not exist before migration 026 — legacy single-vehicle rows still load.
  }

  const itemsByTravel = new Map<number, TravelExpenseItem[]>();
  if (travelIds.length > 0) {
    const idList = travelIds.join(",");
    let legacyItems = false;
    try {
      const itemsRes = await pool.request().query(
        `SELECT Id, TravelExpenseId, ItemType, Amount, SortOrder, VehicleSectionId,
                Currency, ExchangeRate, ForeignAmount
         FROM [dbo].[AccTravelExpenseItem]
         WHERE TravelExpenseId IN (${idList})
         ORDER BY TravelExpenseId, SortOrder, Id`,
      );
      for (const x of itemsRes.recordset as Record<string, unknown>[]) {
        const teid = x.TravelExpenseId as number;
        const item = mapItemRow(x, filesByItem);
        if (!itemsByTravel.has(teid)) itemsByTravel.set(teid, []);
        itemsByTravel.get(teid)!.push(item);
      }
    } catch {
      legacyItems = true;
    }
    if (legacyItems) {
      const itemsRes = await pool.request().query(
        `SELECT Id, TravelExpenseId, ItemType, Amount, SortOrder
         FROM [dbo].[AccTravelExpenseItem]
         WHERE TravelExpenseId IN (${idList})
         ORDER BY TravelExpenseId, SortOrder, Id`,
      );
      for (const x of itemsRes.recordset as Record<string, unknown>[]) {
        const teid = x.TravelExpenseId as number;
        const item = mapItemRow({ ...x, VehicleSectionId: null }, filesByItem);
        if (!itemsByTravel.has(teid)) itemsByTravel.set(teid, []);
        itemsByTravel.get(teid)!.push(item);
      }
    }
  }

  const days: TravelExpenseDetail[] = [];
  for (const row of tRes.recordset as Record<string, unknown>[]) {
    const travelExpenseId = row.Id as number;
    const allItems = itemsByTravel.get(travelExpenseId) ?? [];
    const sections = sectionsByTravel.get(travelExpenseId) ?? [];
    const dayItems: TravelExpenseItem[] = [];
    for (const it of allItems) {
      if (it.vehicleSectionId) {
        const sec = sections.find((s) => s.id === it.vehicleSectionId);
        if (sec) sec.items.push(it);
      } else {
        dayItems.push(it);
      }
    }
    const day = mapTravelRow(row, dayItems);
    day.sections = sections;
    days.push(normalizeTravelDay(day));
  }
  return days;
}

function attachTravelToRequest(req: AccRequest, days: TravelExpenseDetail[]): void {
  req.travelDays = days;
  req.travel = days[0];
}

/* ─────────────────────────── reads ─────────────────────────── */

/** Full request: header + travel detail + items (with files) + approvals. */
export async function getRequest(id: number): Promise<AccRequest | null> {
  const pool = await getAccPool();
  const head = await pool.request().input("id", sql.Int, id)
    .query(`SELECT * FROM [dbo].[AccRequest] WHERE Id = @id`);
  if (head.recordset.length === 0) return null;
  const req = mapRequestRow(head.recordset[0] as Record<string, unknown>);

  const days = await loadTravelDays(pool, id);
  if (days.length > 0) attachTravelToRequest(req, days);

  const aRes = await pool.request().input("id", sql.Int, id)
    .query(`SELECT a.*,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_action.FirstName, N' ', e_action.LastName))), N''), e_action.FullName) AS ActionedByHrName,
              COALESCE(e_action.Email, e_action.EmailCompBr) AS ActionedByHrEmail,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_assign.FirstName, N' ', e_assign.LastName))), N''), e_assign.FullName) AS AssignedToHrName,
              COALESCE(e_assign.Email, e_assign.EmailCompBr) AS AssignedToHrEmail
            FROM [dbo].[AccApproval] a
            LEFT JOIN ${hrEmployeeTable()} e_action ON e_action.StaffId = a.ActionedByStaffId AND e_action.Status = N'Active'
            LEFT JOIN ${hrEmployeeTable()} e_assign ON e_assign.StaffId = a.AssignedTo AND e_assign.Status = N'Active'
            WHERE a.RequestId = @id
            ORDER BY a.StepOrder, a.Id`);
  req.approvals = (aRes.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number, requestId: x.RequestId as number,
    stepCode: x.StepCode as AccApproval["stepCode"], stepOrder: x.StepOrder as number,
    assignedTo: (x.AssignedTo as number) ?? null, assignedEmail: (x.AssignedEmail as string) ?? null,
    status: x.Status as AccApproval["status"], comment: (x.Comment as string) ?? null,
    isChecked: x.IsChecked === null || x.IsChecked === undefined ? null : !!x.IsChecked,
    actionedByStaffId: (x.ActionedByStaffId as number) ?? null,
    actionedAt: x.ActionedAt ? (x.ActionedAt as Date).toISOString() : null,
    createdAt: x.CreatedAt ? (x.CreatedAt as Date).toISOString() : "",
    actionedByHrName: (x.ActionedByHrName as string) ?? null,
    actionedByHrEmail: (x.ActionedByHrEmail as string) ?? null,
    assignedToHrName: (x.AssignedToHrName as string) ?? null,
    assignedToHrEmail: (x.AssignedToHrEmail as string) ?? null,
  }));

  return req;
}

/** Requester's own requests (including drafts), newest first. */
export async function listMyRequests(submittedByOrCreator: number): Promise<AccRequest[]> {
  const pool = await getAccPool();
  const res = await pool.request().input("uid", sql.Int, submittedByOrCreator)
    .query(`SELECT * FROM [dbo].[AccRequest]
            WHERE (SubmittedBy = @uid OR CreatedBy = @uid)
              AND FormCode <> 'AP-2'   -- AP-2 มีหน้า/รายงานของตัวเอง ไม่ปนกับ AP-1
            ORDER BY CreatedAt DESC`);
  return (res.recordset as Record<string, unknown>[]).map(mapRequestRow);
}

/** Editable travel-expense drafts for the current user (by CreatedBy or SubmittedBy — the creator, not the on-behalf requester). */
export async function listMyTravelDrafts(
  userId: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for call-site compatibility; drafts now key on creator only
  staffId: number | null,
): Promise<TravelDraftSummary[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP1_FORM_CODE)
    .query(`
      SELECT r.Id, r.BrandCode, r.Status, r.UpdatedAt, r.TotalAmount,
             MIN(t.TravelDate) AS TravelDate,
             MAX(t.TravelDate) AS TravelDateTo,
             COUNT(t.Id) AS DayCount,
             (SELECT TOP 1 te.WorkDetail FROM [dbo].[AccTravelExpense] te
              WHERE te.RequestId = r.Id ORDER BY te.SortOrder, te.TravelDate, te.Id) AS WorkDetail
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
      WHERE r.FormCode = @form
        AND r.Status IN ('Draft', 'Returned')
        AND (r.CreatedBy = @uid OR r.SubmittedBy = @uid)
      GROUP BY r.Id, r.BrandCode, r.Status, r.UpdatedAt, r.TotalAmount
      ORDER BY r.UpdatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => ({
    id: row.Id as number,
    brandCode: (row.BrandCode as string) ?? null,
    status: row.Status as TravelDraftSummary["status"],
    travelDate: row.TravelDate ? toYmd(row.TravelDate as Date) : null,
    travelDateTo: row.TravelDateTo ? toYmd(row.TravelDateTo as Date) : null,
    dayCount: Number(row.DayCount) || 0,
    workDetail: (row.WorkDetail as string) ?? null,
    totalAmount: num(row.TotalAmount),
    updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
  }));
}

/* ─────────────────────────── validation ─────────────────────────── */

/** True if this StaffId may claim the same travel date across different brands. */
export async function isSameDayMultiBrandStaff(staffId: number): Promise<boolean> {
  const pool = await getAccPool();
  const r = await pool.request()
    .input("staff", sql.Int, staffId)
    .query(`SELECT TOP 1 1 FROM [dbo].[AccSameDayBrandStaff] WHERE StaffId = @staff AND IsActive = 1`);
  return r.recordset.length > 0;
}

/**
 * Travel-date duplicate check. Normally blocks same StaffId + same date
 * (status != Rejected, different request). For allowlisted staff with a brand,
 * blocks only when the brand also matches (same date, different brand is allowed).
 */
export async function isDuplicateTravelDate(
  staffId: number, travelDate: string, excludeRequestId: number | null,
  brandCode?: string | null,
): Promise<boolean> {
  const pool = await getAccPool();
  const allowMultiBrand = !!brandCode && (await isSameDayMultiBrandStaff(staffId));
  const r = await pool.request()
    .input("staff", sql.Int, staffId)
    .input("date", sql.Date, travelDate)
    .input("exclude", sql.Int, excludeRequestId ?? 0)
    .input("brand", sql.NVarChar(20), brandCode ?? null)
    .query(`
      SELECT TOP 1 1 AS dup FROM [dbo].[AccRequest] r
      JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
      WHERE r.StaffId = @staff AND t.TravelDate = @date
        AND r.Status <> 'Rejected' AND r.Id <> @exclude
        ${allowMultiBrand ? "AND r.BrandCode = @brand" : ""}
    `);
  return r.recordset.length > 0;
}

/**
 * Travel dates already used by **this requester** in another non-rejected request.
 *
 * Keyed on `StaffId` alone, and deliberately: this list is what greys days out in
 * the picker, and `isDuplicateTravelDate` is what actually refuses a submit. The
 * two must agree, or the picker lies. It used to also match `CreatedBy` and
 * `SubmittedBy`, so filing on behalf of a colleague blocked that day in the
 * filer's **own** calendar — a day the submit rule would have accepted, because
 * the filer did not travel on it.
 *
 * Dropping those two arms cannot loosen anything. The picker is an affordance;
 * the rule is enforced server-side on every submit regardless of what the
 * calendar offered.
 */
export async function listBlockedTravelDates(
  staffId: number | null,
  excludeRequestId: number | null,
  brandCode?: string | null,
): Promise<string[]> {
  const pool = await getAccPool();
  const allowMultiBrand =
    !!brandCode && staffId != null && (await isSameDayMultiBrandStaff(staffId));
  // No staff id means nobody to compare against — an empty list, never every
  // row this session's user happens to have touched.
  if (staffId == null) return [];
  const res = await pool.request()
    .input("staff", sql.Int, staffId)
    .input("exclude", sql.Int, excludeRequestId ?? 0)
    .input("brand", sql.NVarChar(20), brandCode ?? null)
    .query(`
      SELECT DISTINCT t.TravelDate
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelExpense] t ON t.RequestId = r.Id
      WHERE r.Status <> N'Rejected'
        AND r.Id <> @exclude
        AND t.TravelDate IS NOT NULL
        AND r.StaffId = @staff
        ${allowMultiBrand ? "AND r.BrandCode = @brand" : ""}
      ORDER BY t.TravelDate
    `);
  const out: string[] = [];
  for (let i = 0; i < res.recordset.length; i++) {
    const row = res.recordset[i] as { TravelDate: Date };
    out.push(toYmd(row.TravelDate));
  }
  return out;
}

export async function validateForSubmit(
  input: SaveInput,
  staffId: number | null,
  managerStaffId: number | null,
): Promise<string[]> {
  const errs: string[] = [];
  const days = normalizeTravelDays(input);
  const dayLabel = (i: number) => (days.length > 1 ? ` (วันที่ ${i + 1})` : "");
  /**
   * What a line on this claim may be entered in — `[]` for Thailand, where none
   * of the currency rules below can fire at all.
   *
   * Re-derived against the brand through the same `resolveClaimCountry` the save
   * uses, not read off the posted body: a claim's country is not the client's to
   * assert at submit any more than it is at save. Thailand short-circuits before
   * any pool is opened, so the ordinary claim pays nothing for this.
   */
  const lineCurrencies = lineCurrencyOptions(
    await resolveClaimCountry(input.brandCode ?? null, input.countryCode ?? null),
  );
  /**
   * The figure the requester typed, whichever field holds it.
   *
   * Every money rule below asks about this rather than about `amount`, because
   * `amount` is **baht** and is legitimately 0 on two kinds of line that do
   * carry a figure: one whose currency is still unanswered, and one typed while
   * the rate lookup was down. Asking about the baht would have told somebody
   * they had not entered a fare they had plainly entered.
   */
  const typedOf = (it: TravelExpenseItem) => typedFigure(it);
  // A rate-based vehicle used to be refused on a foreign claim, because the
  // whole claim was in one currency and `km × บาท/กม.` would have been a baht
  // product called ringgit. Per line (migration 129) that reason is gone rather
  // than relaxed: the product is baht, `AccTravelExpenseItem.Amount` is baht,
  // and a trip to Malaysia may perfectly well include the drive to the airport.

  // In UAT a missing manager is a UAT-list problem, not an HR one — pointing at
  // HR would invite somebody to attach a real manager to test data.
  const uat = await isUatRequest();
  if (!managerStaffId) {
    errs.push(uat ? UAT_MANAGER_MISSING_ERROR : "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR");
  } else {
    const mgrEmail = await resolveManagerEmail(managerStaffId);
    if (!mgrEmail) {
      errs.push(uat ? UAT_MANAGER_MISSING_ERROR : "ไม่พบอีเมลผู้จัดการในระบบ HR — ไม่สามารถส่งอนุมัติได้");
    }
  }
  if (!input.brandCode) errs.push("กรุณาเลือกแบรนด์ที่ต้องการเบิก");

  const datesInRequest = days.map((d) => d.travelDate).filter(Boolean) as string[];
  if (new Set(datesInRequest).size !== datesInRequest.length) {
    errs.push("วันที่เดินทางซ้ำกันภายในคำขอเดียวกัน");
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1);

  for (let i = 0; i < days.length; i++) {
    const t = days[i];
    const lbl = dayLabel(i);
    if (!t.travelDate) {
      errs.push(`กรุณาเลือกวันที่เดินทาง${lbl}`);
    } else {
      const td = new Date(t.travelDate + "T00:00:00");
      if (td > today) errs.push(`วันที่เดินทางต้องไม่เป็นอนาคต${lbl}`);
      if (td < monthAgo) errs.push(`วันที่เดินทางย้อนหลังได้ไม่เกิน 1 เดือน${lbl}`);
      if (staffId && (await isDuplicateTravelDate(staffId, t.travelDate, input.id ?? null, input.brandCode ?? null)))
        errs.push(`วันที่เดินทางซ้ำกับคำขอก่อนหน้า${lbl}`);
    }
    if (!t.workDetail?.trim()) errs.push(`กรุณากรอกรายละเอียดการไปปฏิบัติงาน${lbl}`);
    const day = normalizeTravelDay(t);
    const hasVehicle =
      hasRateVehicle(day) ||
      (day.sections?.length ?? 0) > 0 ||
      !!(day.vehicleId && day.isManualEntry);
    if (!hasVehicle) errs.push(`กรุณาเลือกพาหนะ${lbl}`);
    if (allDayItems(day).some((it) => typedOf(it) > 0 && !(it.files && it.files.length > 0))) {
      errs.push(`กรุณาแนบรูปใบเสร็จสำหรับรายการค่าใช้จ่ายที่กรอกจำนวนเงิน${lbl}`);
    }
    // A claim may not be filed carrying a figure nobody has said the currency
    // of: its worth in baht is not a number anybody has, so `Amount` is 0 and
    // every total, report and journal downstream would quietly be short by it.
    // The receipt read leaves exactly this state behind when a document's total
    // is legible and its currency is not — deliberately, rather than guessing —
    // and this is the other half of that decision. Thailand offers no choice, so
    // `lineCurrencies` is empty there and this can never fire.
    if (allDayItems(day).some((it) => lineNeedsCurrency(it, lineCurrencies))) {
      errs.push(`${LINE_CURRENCY_MISSING_ERROR}${lbl}`);
    }
    if (hasRateVehicle(day)) {
      if (!day.direction) errs.push(`กรุณาเลือกทิศทางการเดินทาง${lbl}`);
      if (day.direction !== "return" && !day.onwardDistanceKm) errs.push(`กรุณาระบุระยะทางขาไป${lbl}`);
      if (day.direction !== "onward" && !day.returnDistanceKm) errs.push(`กรุณาระบุระยะทางขากลับ${lbl}`);
    }
    for (const sec of day.sections ?? []) {
      if (!sec.items.some((it) => it.itemType === "fare" && typedOf(it) > 0)) {
        errs.push(`กรุณากรอกค่าเดินทาง (${sec.vehicleName ?? "พาหนะ"})${lbl}`);
      }
    }
    if (
      !hasRateVehicle(day) &&
      day.isManualEntry &&
      (!day.sections || day.sections.length === 0) &&
      !day.items.some((it) => it.itemType === "fare" && typedOf(it) > 0)
    ) {
      errs.push(`กรุณากรอกค่าเดินทาง${lbl}`);
    }
  }
  return errs;
}

/* ─────────────────────────── writes ─────────────────────────── */

/** Bind every AccTravelExpense column on a request for insert/update. */
function bindTravel(req: ReturnType<Awaited<ReturnType<typeof getAccPool>>["request"]>, t: TravelExpenseDetail) {
  const day = normalizeTravelDay(t);
  return req
    .input("sortOrder", sql.Int, day.sortOrder ?? 0)
    .input("travelDate", sql.Date, day.travelDate || null)
    .input("workDetail", sql.NVarChar, day.workDetail ?? null)
    .input("vehicleId", sql.Int, day.vehicleId ?? null)
    .input("vehicleName", sql.NVarChar, day.vehicleName ?? null)
    .input("ratePerKm", sql.Decimal(18, 2), day.ratePerKm ?? null)
    .input("isManual", sql.Bit, day.isManualEntry ? 1 : 0)
    .input("direction", sql.NVarChar, day.direction ?? null)
    .input("oOrigin", sql.NVarChar, day.onwardOrigin ?? null)
    .input("oOriginLat", sql.Decimal(10, 7), day.onwardOriginLat ?? null)
    .input("oOriginLng", sql.Decimal(10, 7), day.onwardOriginLng ?? null)
    .input("oDest", sql.NVarChar, day.onwardDestination ?? null)
    .input("oDestLat", sql.Decimal(10, 7), day.onwardDestLat ?? null)
    .input("oDestLng", sql.Decimal(10, 7), day.onwardDestLng ?? null)
    .input("oDist", sql.Decimal(18, 2), day.onwardDistanceKm ?? null)
    .input("oWaypoints", sql.NVarChar(sql.MAX), serializeRouteWaypoints(day.onwardWaypoints))
    .input("rOrigin", sql.NVarChar, day.returnOrigin ?? null)
    .input("rOriginLat", sql.Decimal(10, 7), day.returnOriginLat ?? null)
    .input("rOriginLng", sql.Decimal(10, 7), day.returnOriginLng ?? null)
    .input("rDest", sql.NVarChar, day.returnDestination ?? null)
    .input("rDestLat", sql.Decimal(10, 7), day.returnDestLat ?? null)
    .input("rDestLng", sql.Decimal(10, 7), day.returnDestLng ?? null)
    .input("rDist", sql.Decimal(18, 2), day.returnDistanceKm ?? null)
    .input("rWaypoints", sql.NVarChar(sql.MAX), serializeRouteWaypoints(day.returnWaypoints))
    .input("totalDist", sql.Decimal(18, 2), computeTotalDistance(day))
    .input("totalAmt", sql.Decimal(18, 2), computeTotalAmount(day));
}

const TRAVEL_COLUMNS = `TravelDate, WorkDetail, VehicleId, VehicleName, RatePerKm, IsManualEntry, Direction,
  OnwardOrigin, OnwardOriginLat, OnwardOriginLng, OnwardDestination, OnwardDestLat, OnwardDestLng, OnwardDistanceKm, OnwardWaypoints,
  ReturnOrigin, ReturnOriginLat, ReturnOriginLng, ReturnDestination, ReturnDestLat, ReturnDestLng, ReturnDistanceKm, ReturnWaypoints,
  TotalDistanceKm, TotalAmount`;
const TRAVEL_VALUES = `@travelDate, @workDetail, @vehicleId, @vehicleName, @ratePerKm, @isManual, @direction,
  @oOrigin, @oOriginLat, @oOriginLng, @oDest, @oDestLat, @oDestLng, @oDist, @oWaypoints,
  @rOrigin, @rOriginLat, @rOriginLng, @rDest, @rDestLat, @rDestLng, @rDist, @rWaypoints,
  @totalDist, @totalAmt`;
const TRAVEL_SET = `SortOrder=@sortOrder, TravelDate=@travelDate, WorkDetail=@workDetail, VehicleId=@vehicleId, VehicleName=@vehicleName,
  RatePerKm=@ratePerKm, IsManualEntry=@isManual, Direction=@direction,
  OnwardOrigin=@oOrigin, OnwardOriginLat=@oOriginLat, OnwardOriginLng=@oOriginLng,
  OnwardDestination=@oDest, OnwardDestLat=@oDestLat, OnwardDestLng=@oDestLng, OnwardDistanceKm=@oDist, OnwardWaypoints=@oWaypoints,
  ReturnOrigin=@rOrigin, ReturnOriginLat=@rOriginLat, ReturnOriginLng=@rOriginLng,
  ReturnDestination=@rDest, ReturnDestLat=@rDestLat, ReturnDestLng=@rDestLng, ReturnDistanceKm=@rDist, ReturnWaypoints=@rWaypoints,
  TotalDistanceKm=@totalDist, TotalAmount=@totalAmt`;

type AccTx = {
  request: () => ReturnType<Awaited<ReturnType<typeof getAccPool>>["request"]>;
};

/**
 * A line's money, bound the same way at both of `persistTravelItems`' writers.
 *
 * `@amount` is **baht** and comes off the item `toBahtDays` has already
 * converted — there is no conversion here and there must never be one, because a
 * second copy of the rule is how the insert and the update come to disagree.
 * The other three are the record of what was typed.
 *
 * **`ForeignAmount` survives a null `Currency`; the rate does not.** That pair
 * is exactly how an unanswered line is stored — a figure whose currency nobody
 * has stated — so dropping the figure with the currency would lose the number
 * the requester is being asked about. A rate is a different matter: without a
 * currency there is nothing it could be a rate *of*, and a stored one would be
 * a claim that a conversion happened.
 */
function bindLineFx(
  req: ReturnType<Awaited<ReturnType<typeof getAccPool>>["request"]>,
  it: TravelExpenseItem,
) {
  const currency = (it.currency ?? "").trim().toUpperCase() || null;
  const foreign = it.foreignAmount ?? null;
  const rate = currency === null ? null : it.exchangeRate ?? null;
  return req
    .input("amount", sql.Decimal(18, 2), it.amount || 0)
    .input("lineCur", sql.Char(3), currency)
    .input("lineRate", sql.Decimal(18, 6), rate)
    .input("lineForeign", sql.Decimal(18, 2), foreign);
}

const LINE_FX_COLUMNS = `Currency, ExchangeRate, ForeignAmount`;
const LINE_FX_VALUES = `@lineCur, @lineRate, @lineForeign`;
const LINE_FX_SET = `Currency=@lineCur, ExchangeRate=@lineRate, ForeignAmount=@lineForeign`;

async function persistTravelItems(
  tx: AccTx,
  requestId: number,
  travelExpenseId: number,
  items: TravelExpenseItem[],
  vehicleSectionId: number | null,
): Promise<void> {
  const existingItemsRes = await tx.request()
    .input("teid", sql.Int, travelExpenseId)
    .input("sid", sql.Int, vehicleSectionId)
    .query(`SELECT Id FROM [dbo].[AccTravelExpenseItem]
            WHERE TravelExpenseId = @teid
              AND ((@sid IS NULL AND VehicleSectionId IS NULL) OR VehicleSectionId = @sid)`);
  const existingIds = new Set<number>(
    (existingItemsRes.recordset as { Id: number }[]).map((r) => r.Id),
  );
  const keptIds = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.id && existingIds.has(it.id)) {
      keptIds.add(it.id);
      await bindLineFx(tx.request(), it)
        .input("id", sql.Int, it.id)
        .input("type", sql.NVarChar, it.itemType)
        .input("sort", sql.Int, it.sortOrder ?? i)
        .input("sid", sql.Int, vehicleSectionId)
        .query(`UPDATE [dbo].[AccTravelExpenseItem]
                SET ItemType=@type, Amount=@amount, SortOrder=@sort, VehicleSectionId=@sid, ${LINE_FX_SET}
                WHERE Id=@id`);
    } else {
      await bindLineFx(tx.request(), it)
        .input("teid", sql.Int, travelExpenseId)
        .input("type", sql.NVarChar, it.itemType)
        .input("sort", sql.Int, it.sortOrder ?? i)
        .input("sid", sql.Int, vehicleSectionId)
        .query(`INSERT INTO [dbo].[AccTravelExpenseItem]
                  (TravelExpenseId, ItemType, Amount, SortOrder, VehicleSectionId, ${LINE_FX_COLUMNS})
                VALUES (@teid, @type, @amount, @sort, @sid, ${LINE_FX_VALUES})`);
    }
  }
  for (const oldId of Array.from(existingIds)) {
    if (keptIds.has(oldId)) continue;
    await tx.request().input("rid", sql.Int, requestId).input("oldId", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId=@rid AND RefType='travel_item' AND RefId=@oldId`);
    await tx.request().input("oldId", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem] WHERE Id=@oldId`);
  }
}

async function persistTravelSections(
  tx: AccTx,
  requestId: number,
  travelExpenseId: number,
  sections: TravelVehicleSection[],
): Promise<void> {
  let existingIds = new Set<number>();
  try {
    const existingRes = await tx.request().input("teid", sql.Int, travelExpenseId)
      .query(`SELECT Id FROM [dbo].[AccTravelVehicleSection] WHERE TravelExpenseId = @teid`);
    existingIds = new Set<number>(
      (existingRes.recordset as { Id: number }[]).map((r) => r.Id),
    );
  } catch {
    return;
  }

  const keptIds = new Set<number>();
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.id && existingIds.has(sec.id)) {
      keptIds.add(sec.id);
      await tx.request()
        .input("id", sql.Int, sec.id)
        .input("sort", sql.Int, sec.sortOrder ?? i)
        .input("vid", sql.Int, sec.vehicleId ?? null)
        .input("vname", sql.NVarChar, sec.vehicleName ?? null)
        .input("rate", sql.Decimal(18, 2), sec.ratePerKm ?? null)
        .input("manual", sql.Bit, sec.isManualEntry ? 1 : 0)
        .query(`UPDATE [dbo].[AccTravelVehicleSection]
                SET SortOrder=@sort, VehicleId=@vid, VehicleName=@vname, RatePerKm=@rate, IsManualEntry=@manual
                WHERE Id=@id`);
      await persistTravelItems(tx, requestId, travelExpenseId, sec.items ?? [], sec.id);
    } else {
      const ins = await tx.request()
        .input("teid", sql.Int, travelExpenseId)
        .input("sort", sql.Int, sec.sortOrder ?? i)
        .input("vid", sql.Int, sec.vehicleId ?? null)
        .input("vname", sql.NVarChar, sec.vehicleName ?? null)
        .input("rate", sql.Decimal(18, 2), sec.ratePerKm ?? null)
        .input("manual", sql.Bit, sec.isManualEntry ? 1 : 0)
        .query(`INSERT INTO [dbo].[AccTravelVehicleSection]
                (TravelExpenseId, SortOrder, VehicleId, VehicleName, RatePerKm, IsManualEntry)
                OUTPUT inserted.Id AS Id
                VALUES (@teid, @sort, @vid, @vname, @rate, @manual)`);
      const sectionId = ins.recordset[0].Id as number;
      keptIds.add(sectionId);
      await persistTravelItems(tx, requestId, travelExpenseId, sec.items ?? [], sectionId);
    }
  }

  for (const oldId of Array.from(existingIds)) {
    if (keptIds.has(oldId)) continue;
    await tx.request().input("rid", sql.Int, requestId).input("sid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccRequestFile]
              WHERE RequestId=@rid AND RefType='travel_item'
                AND RefId IN (SELECT Id FROM [dbo].[AccTravelExpenseItem] WHERE VehicleSectionId=@sid)`);
    await tx.request().input("sid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelVehicleSection] WHERE Id=@sid`);
  }
}

/**
 * **Every figure written here is Thai baht**, at both levels — the per-day
 * `AccTravelExpense.TotalAmount` and the header `AccRequest.TotalAmount`.
 *
 * `days` arrives already converted by `toBahtDays`, so no conversion happens
 * inside the transaction and neither `computeTotalAmount` nor
 * `computeRequestTotalAmount` has to learn what a currency is. That is what
 * keeps `calc.ts`, the T-SQL `TRAVEL_DAYS_CSV_SELECT` that feeds the ERP prep
 * queue, the journal builder and the approval queue's per-vehicle cell summing
 * exactly what they summed before migration 129 — a per-day column in the
 * claim's own currency, which is what the request-level design left them, was
 * the thing every one of those surfaces had to be taught about.
 */
async function persistTravelDays(
  tx: AccTx,
  requestId: number,
  days: TravelExpenseDetail[],
): Promise<void> {
  const existingRes = await tx.request().input("rid", sql.Int, requestId)
    .query(`SELECT Id FROM [dbo].[AccTravelExpense] WHERE RequestId = @rid`);
  const existingIds = new Set<number>(
    (existingRes.recordset as { Id: number }[]).map((r) => r.Id),
  );
  const keptIds = new Set<number>();

  for (let i = 0; i < days.length; i++) {
    const day: TravelExpenseDetail = normalizeTravelDay({ ...days[i], sortOrder: days[i].sortOrder ?? i });
    if (day.id && existingIds.has(day.id)) {
      keptIds.add(day.id);
      const r = bindTravel(tx.request().input("teid", sql.Int, day.id), day);
      await r.query(`UPDATE [dbo].[AccTravelExpense] SET ${TRAVEL_SET} WHERE Id=@teid`);
      await persistTravelItems(tx, requestId, day.id, day.items, null);
      await persistTravelSections(tx, requestId, day.id, day.sections ?? []);
    } else {
      const r = bindTravel(tx.request().input("rid", sql.Int, requestId), day);
      const insT = await r.query(`INSERT INTO [dbo].[AccTravelExpense] (RequestId, SortOrder, ${TRAVEL_COLUMNS})
        OUTPUT inserted.Id AS Id VALUES (@rid, @sortOrder, ${TRAVEL_VALUES})`);
      const travelExpenseId = insT.recordset[0].Id as number;
      keptIds.add(travelExpenseId);
      await persistTravelItems(tx, requestId, travelExpenseId, day.items, null);
      await persistTravelSections(tx, requestId, travelExpenseId, day.sections ?? []);
    }
  }

  for (const oldId of Array.from(existingIds)) {
    if (keptIds.has(oldId)) continue;
    await tx.request().input("rid", sql.Int, requestId).input("teid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccRequestFile]
              WHERE RequestId=@rid AND RefType='travel_item'
                AND RefId IN (SELECT Id FROM [dbo].[AccTravelExpenseItem] WHERE TravelExpenseId=@teid)`);
    await tx.request().input("teid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem] WHERE TravelExpenseId=@teid`);
    await tx.request().input("teid", sql.Int, oldId)
      .query(`DELETE FROM [dbo].[AccTravelExpense] WHERE Id=@teid`);
  }

  // Writer 1 of 3. A plain sum, because every line it adds is already baht —
  // `toBahtDays` converted them before this transaction opened, and refused the
  // save rather than let an unconverted figure through.
  await tx.request()
    .input("rid", sql.Int, requestId)
    .input("total", sql.Decimal(18, 2), computeRequestTotalAmount(days))
    .query(`UPDATE [dbo].[AccRequest]
            SET TotalAmount=@total, ${FX_CLEAR}, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
}

/**
 * Create or update a draft (lenient — no strict validation).
 * Persists header (Status stays Draft unless already submitted), travel detail (upsert),
 * and replaces non-file expense item rows. Returns the request id.
 */
export async function saveDraft(
  input: SaveInput,
  userId: number,
  loginEmail: string,
): Promise<number> {
  await assertFormWritable();
  const pool = await getAccPool();
  const requester = await resolveRequesterForActor(loginEmail, input.requesterStaffId ?? null);
  // Both before the transaction: the first reads the production form pool, the
  // second the FX provider. A Thai claim short-circuits out of both and makes no
  // extra call at all — nor does a foreign trip whose every line is in baht.
  const countryCode = await resolveClaimCountry(input.brandCode ?? null, input.countryCode ?? null);
  const days = await toBahtDays(normalizeTravelDays(input), countryCode);
  const tx = pool.transaction();
  await tx.begin();
  try {
    let requestId = input.id ?? 0;

    if (!requestId) {
      const ins = await tx.request()
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("user", sql.Int, userId || null)
        .input("form", sql.NVarChar, AP1_FORM_CODE)
        .input("empId", sql.UniqueIdentifier, requester.employeeId)
        .input("staffId", sql.Int, requester.staffId)
        .input("rFirst", sql.NVarChar, requester.firstName)
        .input("rLast", sql.NVarChar, requester.lastName)
        .input("rFull", sql.NVarChar, requester.fullName)
        .input("rEmail", sql.NVarChar, requester.email)
        .input("rPos", sql.NVarChar, requester.position)
        .input("rDeptId", sql.Int, requester.departmentId)
        .input("rDeptName", sql.NVarChar, requester.departmentName)
        .input("rDeptCode", sql.NVarChar, requester.departmentCode)
        .input("mgrStaff", sql.Int, requester.managerStaffId)
        .input("country", sql.Char(2), countryCode)
        .query(`INSERT INTO [dbo].[AccRequest]
                  (FormCode, BrandCode, Status, CreatedBy,
                   EmployeeId, StaffId, RequesterFirstName, RequesterLastName, RequesterFullName,
                   RequesterEmail, RequesterPosition, RequesterDepartmentId, RequesterDepartmentName,
                   RequesterDepartmentCode, ManagerStaffId, CountryCode)
                OUTPUT inserted.Id AS Id
                VALUES (@form, @brand, 'Draft', @user,
                   @empId, @staffId, @rFirst, @rLast, @rFull,
                   @rEmail, @rPos, @rDeptId, @rDeptName, @rDeptCode, @mgrStaff, @country)`);
      requestId = ins.recordset[0].Id as number;
    } else {
      // `AND FormCode=@form` pins this to AP-1. `AccRequest` holds every form's
      // header, and without it a Draft the caller created under another form —
      // an AP-4 claim, say — passes the creator and status checks below and has
      // its requester, brand and manager snapshot rewritten from AP-1's
      // `resolveRequesterForActor`, with `TotalAmount` clobbered by AP-1's own
      // sum. A tautology on AP-1's rows: `FormCode` is NOT NULL with an FK to
      // `AccFormMaster`, and the insert branch above binds `AP1_FORM_CODE`, so
      // every row this branch can legitimately reach already matches.
      const own = await tx.request().input("id", sql.Int, requestId)
        .input("form", sql.NVarChar, AP1_FORM_CODE)
        .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
      if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
      const ownerRow = own.recordset[0] as { CreatedBy: number | null; Status: string };
      if (ownerRow.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์แก้ไขคำขอนี้");
      if (ownerRow.Status !== "Draft" && ownerRow.Status !== "Returned") {
        throw new Error("คำขอนี้ไม่สามารถแก้ไขได้ในสถานะปัจจุบัน");
      }
      await tx.request()
        .input("id", sql.Int, requestId)
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("empId", sql.UniqueIdentifier, requester.employeeId)
        .input("staffId", sql.Int, requester.staffId)
        .input("rFirst", sql.NVarChar, requester.firstName)
        .input("rLast", sql.NVarChar, requester.lastName)
        .input("rFull", sql.NVarChar, requester.fullName)
        .input("rEmail", sql.NVarChar, requester.email)
        .input("rPos", sql.NVarChar, requester.position)
        .input("rDeptId", sql.Int, requester.departmentId)
        .input("rDeptName", sql.NVarChar, requester.departmentName)
        .input("rDeptCode", sql.NVarChar, requester.departmentCode)
        .input("mgrStaff", sql.Int, requester.managerStaffId)
        .input("country", sql.Char(2), countryCode)
        .query(`UPDATE [dbo].[AccRequest] SET BrandCode=@brand,
                  EmployeeId=@empId, StaffId=@staffId,
                  RequesterFirstName=@rFirst, RequesterLastName=@rLast, RequesterFullName=@rFull,
                  RequesterEmail=@rEmail, RequesterPosition=@rPos,
                  RequesterDepartmentId=@rDeptId, RequesterDepartmentName=@rDeptName,
                  RequesterDepartmentCode=@rDeptCode, ManagerStaffId=@mgrStaff,
                  CountryCode=@country,
                  UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    }

    await persistTravelDays(tx, requestId, days);

    await tx.commit();
    return requestId;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/**
 * Permanently delete an editable draft (Draft or Returned) owned by the user,
 * along with its travel detail, expense items, attachment rows, approvals and
 * activity log. Ownership + status guarded. One transaction.
 */
export async function deleteDraft(id: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  let storedFiles: StoredFileRef[] = [];
  await tx.begin();
  try {
    // Pinned to AP-1 for the same reason `saveDraft` is, and with a sharper
    // consequence: the `DELETE FROM AccRequest` at the end of this function
    // takes `AccReimburse` and `AccReimburseItem` with it through their
    // `ON DELETE CASCADE`, so an AP-4 draft reaching here is destroyed outright
    // and logged as an AP-1 delete. AP-4 has its own delete
    // (`@/lib/acc/reimburse/delete-service`).
    const own = await tx.request().input("id", sql.Int, id)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
    if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
    const row = own.recordset[0] as { CreatedBy: number | null; Status: string };
    if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์ลบคำขอนี้");
    if (row.Status !== "Draft" && row.Status !== "Returned") {
      throw new Error("คำขอนี้ไม่สามารถลบได้ในสถานะปัจจุบัน");
    }

    // Read the storage references before the rows go: after this DELETE nothing
    // records where the bytes are. `deleteDraft` used to skip storage entirely,
    // so every attachment on a discarded draft stayed in SharePoint with no
    // pointer left to find it by.
    const filesRes = await tx.request().input("id", sql.Int, id)
      .query(`SELECT StoragePath, StorageBackend FROM [dbo].[AccRequestFile] WHERE RequestId=@id`);
    storedFiles = (
      filesRes.recordset as { StoragePath: string; StorageBackend: string | null }[]
    ).map((r) => ({ storagePath: r.StoragePath, storageBackend: r.StorageBackend }));

    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem]
              WHERE TravelExpenseId IN (SELECT Id FROM [dbo].[AccTravelExpense] WHERE RequestId=@id)`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccTravelExpense] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccActivityLog] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccRequest] WHERE Id=@id`);

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  // After the commit: the draft is gone either way, and a storage failure must
  // not resurrect it. Reported, not swallowed.
  await deleteStoredFiles(storedFiles, `AP-1 deleteDraft request ${id}`);
}

/**
 * Delete a single expense item (and its attachment files) from an editable draft
 * immediately — no save step required. Recomputes the stored totals afterward.
 * Ownership + status guarded.
 */
export async function deleteItem(requestId: number, itemId: number, userId: number): Promise<void> {
  const pool = await getAccPool();

  // Pinned like `saveDraft` and `deleteDraft`, and for uniformity rather than
  // for a live hole: every statement below is already scoped to
  // `RefType='travel_item'` or to `AccTravelExpense` rows, of which a non-AP-1
  // request has none, so this is a no-op on one today. Leaving the one
  // ownership read in this file that does not name the form would make the
  // invariant untestable and the next statement added here a real one.
  const own = await pool.request().input("id", sql.Int, requestId)
    .input("form", sql.NVarChar, AP1_FORM_CODE)
    .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
  if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
  const row = own.recordset[0] as { CreatedBy: number | null; Status: string };
  if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์แก้ไขคำขอนี้");
  if (row.Status !== "Draft" && row.Status !== "Returned") {
    throw new Error("ลบรายการได้เฉพาะคำขอที่เป็นฉบับร่างเท่านั้น");
  }

  // No rate is read, and none is fetched. The recompute at the foot of this
  // function sums `AccTravelExpenseItem.Amount`, which is already baht on every
  // surviving line, so removing a receipt row cannot re-price the claim — which
  // is exactly what a re-fetch on an ordinary edit would have done.

  // Collect attachment storage references for this item before deleting the
  // rows — backend included, because these are SharePoint driveItem ids and the
  // local `deleteFile` cannot remove them.
  const filesRes = await pool.request()
    .input("rid", sql.Int, requestId)
    .input("refId", sql.Int, itemId)
    .query(`SELECT StoragePath, StorageBackend FROM [dbo].[AccRequestFile]
            WHERE RequestId=@rid AND RefType='travel_item' AND RefId=@refId`);
  const storagePaths = (
    filesRes.recordset as { StoragePath: string; StorageBackend: string | null }[]
  ).map((r) => ({ storagePath: r.StoragePath, storageBackend: r.StorageBackend }));

  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input("rid", sql.Int, requestId).input("refId", sql.Int, itemId)
      .query(`DELETE FROM [dbo].[AccRequestFile]
              WHERE RequestId=@rid AND RefType='travel_item' AND RefId=@refId`);
    await tx.request().input("rid", sql.Int, requestId).input("itemId", sql.Int, itemId)
      .query(`DELETE FROM [dbo].[AccTravelExpenseItem]
              WHERE Id=@itemId AND TravelExpenseId IN (SELECT Id FROM [dbo].[AccTravelExpense] WHERE RequestId=@rid)`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  await deleteStoredFiles(storagePaths, `AP-1 deleteItem request ${requestId} item ${itemId}`);

  // Recompute stored totals so drafts (and the draft picker) stay accurate.
  const updated = await getRequest(requestId);
  if (updated?.travelDays?.length) {
    for (const day of updated.travelDays) {
      if (!day.id) continue;
      const total = computeTotalAmount(day);
      const dist = computeTotalDistance(day);
      await pool.request()
        .input("teid", sql.Int, day.id)
        .input("total", sql.Decimal(18, 2), total)
        .input("dist", sql.Decimal(18, 2), dist)
        .query(`UPDATE [dbo].[AccTravelExpense] SET TotalAmount=@total, TotalDistanceKm=@dist WHERE Id=@teid`);
    }
    // Writer 2 of 3, and the one that gets missed — it is a recompute on an
    // ordinary edit rather than a save or a submit, and it runs outside a
    // transaction. It sums what `getRequest` just read back, which is the stored
    // `Amount` column: baht on every line, so the sum is baht.
    await pool.request()
      .input("rid", sql.Int, requestId)
      .input("total", sql.Decimal(18, 2), computeRequestTotalAmount(updated.travelDays))
      .query(`UPDATE [dbo].[AccRequest]
              SET TotalAmount=@total, ${FX_CLEAR}, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
  }
}

/**
 * Submit a request: re-validate, allocate RequestNo, snapshot requester + manager,
 * set totals, create the MANAGER approval, queue the manager email. One transaction.
 */
export async function submitRequest(
  id: number, requester: RequesterSnapshot, userId: number,
): Promise<AccRequest> {
  await assertFormWritable();
  // Persist latest edits first (lenient), then validate.
  const current = await getRequest(id);
  if (!current) throw new Error("ไม่พบคำขอ");
  if (current.status !== "Draft" && current.status !== "Returned") {
    throw new Error("คำขอนี้ถูกส่งไปแล้ว");
  }
  const travelDays = current.travelDays?.length
    ? current.travelDays
    : current.travel
      ? [current.travel]
      : [emptyTravel()];
  // No rate is fetched here, and none is needed: every line's `Amount` was
  // already converted to baht by the save that wrote it, so the total below is a
  // plain sum. The rate a claim is settled at is therefore the one recorded at
  // its **last save**, and the form always re-saves immediately before
  // submitting — a draft that has sat for weeks is re-priced by that save, not
  // silently by this submit.
  const errors = await validateForSubmit(
    { id, brandCode: current.brandCode, countryCode: current.countryCode, travelDays },
    requester.staffId,
    requester.managerStaffId ?? null,
  );
  if (errors.length) throw new Error(errors.join("\n"));

  const managerEmail = await resolveManagerEmail(requester.managerStaffId);
  if (!managerEmail) {
    throw new Error(
      (await isUatRequest())
        ? UAT_MANAGER_MISSING_ERROR
        : "ไม่พบอีเมลผู้จัดการ (ManagerStaffId) — ไม่สามารถส่งอนุมัติได้",
    );
  }

  // Baht, because every line it sums is baht. See the note above.
  const totalAmount = computeRequestTotalAmount(travelDays);

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Claim the row first: owner, and still in a status that may be submitted,
    // asserted by the UPDATE itself rather than by the `getRequest` read above.
    //
    // The read-then-write it replaces let two clicks — two tabs, a double
    // submit, a retry after a slow response — both pass the status check, both
    // allocate a running number, and both write a full submit: two TOF numbers
    // burned, two MANAGER approvals, two activity-log lines and two emails for
    // one claim. Only the row that changes state here proceeds, and the number
    // is allocated after the claim, so the loser never consumes one.
    const claim = await tx.request()
      .input("id", sql.Int, id)
      .input("uid", sql.Int, userId || null)
      .query(`UPDATE [dbo].[AccRequest]
              SET Status='Submitted', CurrentStepCode='MANAGER', UpdatedAt=SYSDATETIME()
              OUTPUT INSERTED.RequestNo AS RequestNo
              WHERE Id=@id AND CreatedBy=@uid AND Status IN ('Draft','Returned')`);
    if (claim.rowsAffected[0] !== 1) {
      throw new AccConflictError(SUBMIT_ALREADY_CLAIMED);
    }

    // A returned request keeps the number it was already given.
    //
    // This is the same row: the claim above accepts `Returned` as well as
    // `Draft`, so a request sent back for revision is edited and resubmitted in
    // place. Allocating unconditionally renumbered it every time — TOF26-09004
    // came back as TOF26-09005 — which breaks the one thing a running number is
    // for. Everyone who has already seen the request (the approver who returned
    // it, the requester's own email, anything written down) is holding the old
    // number, and the old one is then attached to nothing at all.
    //
    // Only a first submit allocates, and it still allocates inside the claim's
    // transaction so a tab that lost the race never consumes one. `AccSequence`'s
    // MERGE takes HOLDLOCK; holding it to commit serialises concurrent submits
    // of the same prefix, which is what the running number needs anyway.
    const existingNo = ((claim.recordset?.[0]?.RequestNo as string | null) ?? "").trim();
    const requestNo = existingNo || (await allocateRequestNo("TOF", new Date(), tx));

    // Writer 3 of 3. `@total` is baht — a plain sum of baht lines.
    await tx.request()
      .input("id", sql.Int, id)
      .input("no", sql.NVarChar, requestNo)
      .input("empId", sql.UniqueIdentifier, requester.employeeId ?? null)
      .input("staffId", sql.Int, requester.staffId ?? null)
      .input("fname", sql.NVarChar, requester.firstName ?? null)
      .input("lname", sql.NVarChar, requester.lastName ?? null)
      .input("full", sql.NVarChar, requester.fullName ?? null)
      .input("email", sql.NVarChar, requester.email ?? null)
      .input("pos", sql.NVarChar, requester.position ?? null)
      .input("deptId", sql.Int, requester.departmentId ?? null)
      .input("deptName", sql.NVarChar, requester.departmentName ?? null)
      .input("deptCode", sql.NVarChar, requester.departmentCode ?? null)
      .input("mgrStaff", sql.Int, requester.managerStaffId ?? null)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .input("company", sql.NVarChar, requester.companyName ?? null)
      .input("total", sql.Decimal(18, 2), totalAmount)
      .input("by", sql.Int, userId || null)
      .query(`UPDATE [dbo].[AccRequest] SET
        RequestNo=@no,
        EmployeeId=@empId, StaffId=@staffId, RequesterFirstName=@fname, RequesterLastName=@lname,
        RequesterFullName=@full, RequesterEmail=@email, RequesterPosition=@pos,
        RequesterDepartmentId=@deptId, RequesterDepartmentName=@deptName, RequesterDepartmentCode=@deptCode,
        ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, CompanyName=@company,
        TotalAmount=@total, ${FX_CLEAR},
        SubmittedBy=@by, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
        WHERE Id=@id`);

    // Reset any prior approvals (e.g. resubmit after Return), then create MANAGER step.
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@id`);
    await tx.request()
      .input("id", sql.Int, id)
      .input("mgrStaff", sql.Int, requester.managerStaffId ?? null)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .query(`INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedTo, AssignedEmail, Status)
              VALUES (@id, 'MANAGER', 1, @mgrStaff, @mgrEmail, 'Pending')`);

    await tx.request().input("id", sql.Int, id).input("by", sql.Int, userId || null)
      .input("no", sql.NVarChar, requestNo)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@id, @by, 'submitted', @no)`);

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  const updated = await getRequest(id);
  if (updated) {
    const mail = buildEmail("Submitted", updated);
    await queueEmail({
      requestId: id, toEmail: managerEmail,
      subject: mail.subject, bodyHtml: mail.html, triggerType: "Submitted",
    });
  }
  return updated!;
}
