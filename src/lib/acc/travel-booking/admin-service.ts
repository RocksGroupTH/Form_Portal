import { getAccPool, sql } from "@/lib/acc/pool";
import type { Actor } from "@/lib/acc/approval-engine";
import { getTravelBookingRequest } from "@/lib/acc/travel-booking/request-service";
import { deleteStoredFiles, type StoredFileRef } from "@/lib/acc/stored-file";
import { AccConflictError } from "@/lib/acc/request-errors";
import { loadPerDiemDependencies } from "@/lib/acc/travel-booking/perdiem-dependency-load";
import type { PerDiemDependency } from "@/lib/acc/travel-booking/perdiem-dependency";
import {
  bookingBrandScope,
  type BookingBrandAccess,
} from "@/lib/acc/travel-booking/booking-brand-access-shared";
import { bookingBrandScopeSql } from "@/lib/acc/travel-booking/booking-approver-brands";
import { recomputeBookingBaht } from "@/lib/acc/travel-booking/booking-baht";
import { AP17_FORM_CODE, BOOKING_TYPE_REFTYPE } from "@/features/travel-booking/constants";
import { sanitizeBookingAmount } from "@/features/travel-booking/lib/booking-amounts";
import { sanitizeBookingNo } from "@/features/travel-booking/lib/booking-no";
import {
  BOOKING_CURRENCY_STALE_ERROR,
  BOOKING_FX_UNAVAILABLE_ERROR,
  effectiveBookingCurrency,
} from "@/features/travel-booking/lib/booking-currency";
import { THB, toBaht, type BrandCurrencyEntry } from "@/lib/acc/currency";
import { rateAsOfYmd } from "@/lib/acc/currency-display";
import { needsRate, resolveRate } from "@/lib/acc/fx";
import { listBrandRegistry } from "@/lib/brand-registry";
import type { BookingType, TravelBookingRequest } from "@/features/travel-booking/types";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;

/**
 * AP-17 Admin work queue + booking fill-in (spec §7, §8.1). Admin fills
 * `AccTravelBookingDetail` for whatever the request flagged as needed
 * (room/ticket/rent), attaches files (handled separately by Task 8's file
 * route), then closes the request once every required booking is complete.
 */

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Date column → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ─────────────────────────── admin queue ─────────────────────────── */

export interface AdminQueueItem {
  id: number;
  requestNo: string | null;
  /** `AccRequest.BrandCode` — per trip, so two rows of one group can differ. */
  brandCode: string | null;
  requesterFullName: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  provinceName: string | null;
  /**
   * ข้อ9 — every work location on the trip, joined with " · ".
   *
   * What the booking desk actually works against: a hotel is booked near the
   * place somebody is going to, not near the province. The province stays on
   * the row because the report filters on it.
   */
  workLocationNames: string | null;
  departDate: string | null;
  returnDate: string | null;
  /** ข้อ10.1 — a room booking is required for this request. */
  needsRoomBooking: boolean;
  /** ข้อ12.2 (go OR return) — a ticket booking is required for this request. */
  needsTicketBooking: boolean;
  /** ข้อ15.1 — a rent-vehicle booking is required for this request. */
  needsRentBooking: boolean;
  paymentDate: string | null;
  updatedAt: string;
}

/**
 * AP-17 requests that finished Manager approval and are waiting on Admin to
 * fill bookings — `ManagerApproved` / `CurrentStepCode='ADMIN'`.
 *
 * The `CurrentStepCode` filter is load-bearing, not decorative: before the
 * accounting step existed, `completeRequest` moved a finished request straight
 * to `Status='Completed'`, so `Status='ManagerApproved'` alone already named
 * the ADMIN stage exactly. Commit cb8e47e changed that hand-off to
 * `CurrentStepCode='ACCOUNT'` (`Status` stays `ManagerApproved`) without
 * updating this query in the same file — so without the filter this list also
 * shows work Admin has already finished and handed to accounting, and Admin's
 * เสร็จสิ้น button 400s on those rows (`completeRequest` itself guards on
 * `CurrentStepCode='ADMIN'`). See `listAccountQueue` below for the sibling
 * query this pairs with.
 */
/**
 * `access` is REQUIRED and has no default. An optional parameter defaulting to
 * unrestricted is exactly how a caller added later gets an unscoped queue with
 * no error and no test failure.
 *
 * The filter is pushed into SQL rather than applied afterwards, which matters
 * for listAccountQueue below: its per-diem batch and dependency loader run over
 * the id set this query returns, so scoping here means they never fetch rows
 * that are about to be discarded.
 */
export async function listAdminQueue(access: BookingBrandAccess): Promise<AdminQueueItem[]> {
  const scope = bookingBrandScope(access);
  // Nothing in scope means nothing to show — and returning early is what keeps
  // the empty case from ever reaching SQL as `IN ()`.
  if (scope.kind === "none") return [];
  const pool = await getAccPool();
  const req0 = pool.request().input("form", sql.NVarChar, AP17_FORM_CODE);
  const brandFilter = bookingBrandScopeSql(scope, req0, "r.BrandCode");
  const res = await req0
    .query(`
      SELECT r.Id, r.RequestNo, r.BrandCode, r.RequesterFullName, r.RequesterPosition, r.RequesterDepartmentName,
             r.PaymentDate, r.UpdatedAt,
             t.ProvinceName, t.DepartDate, t.ReturnDate,
             (SELECT STRING_AGG(wl.Name, N' · ') WITHIN GROUP (ORDER BY wl.SortOrder, wl.Id)
              FROM [dbo].[AccTravelWorkLocation] wl
              WHERE wl.TravelBookingId = t.Id) AS WorkLocationNames,
             t.NeedsRoomBooking, t.GoNeedsTicketBooking, t.ReturnNeedsTicketBooking, t.NeedsRentBooking
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
      WHERE r.FormCode = @form AND r.Status = 'ManagerApproved' AND r.CurrentStepCode = 'ADMIN'
        ${brandFilter ? `AND ${brandFilter}` : ""}
      ORDER BY r.UpdatedAt ASC
    `);
  return (res.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    requestNo: (x.RequestNo as string) ?? null,
    brandCode: (x.BrandCode as string) ?? null,
    requesterFullName: (x.RequesterFullName as string) ?? null,
    requesterPosition: (x.RequesterPosition as string) ?? null,
    requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
    provinceName: (x.ProvinceName as string) ?? null,
    // What the desk is actually booking against — the place, not the province.
    // A trip can carry more than one, joined here rather than in the page so
    // both queues render it identically.
    workLocationNames: (x.WorkLocationNames as string) ?? null,
    departDate: x.DepartDate ? toYmd(x.DepartDate as Date) : null,
    returnDate: x.ReturnDate ? toYmd(x.ReturnDate as Date) : null,
    needsRoomBooking: !!x.NeedsRoomBooking,
    needsTicketBooking: !!x.GoNeedsTicketBooking || !!x.ReturnNeedsTicketBooking,
    needsRentBooking: !!x.NeedsRentBooking,
    paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
    updatedAt: x.UpdatedAt ? (x.UpdatedAt as Date).toISOString() : "",
  }));
}

/* ─────────────────────────── accounting queue ─────────────────────────── */

export interface AccountQueueItem {
  id: number;
  requestNo: string | null;
  /** `AccRequest.BrandCode` — per trip, so two rows of one group can differ. */
  brandCode: string | null;
  requesterFullName: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  provinceName: string | null;
  /**
   * ข้อ9 — every work location on the trip, joined with " · ".
   *
   * What the booking desk actually works against: a hotel is booked near the
   * place somebody is going to, not near the province. The province stays on
   * the row because the report filters on it.
   */
  workLocationNames: string | null;
  departDate: string | null;
  returnDate: string | null;
  perDiemDays: number;
  perDiemTotal: number;
  /** The payout month/date currently scheduled — set at Manager approval, editable here. */
  paymentDate: string | null;
  updatedAt: string;
  /**
   * `AccActivityLog.Note` for every `perdiem_recalculated` row against this
   * request, oldest first — already the human-readable Thai sentence
   * `recomputeGroupPerDiem` writes, so nothing here re-derives it from
   * `MetadataJson`. Empty when the figure never moved.
   */
  perDiemHistory: string[];
  /**
   * The trip in this request's `GroupKey` group whose fate this figure still
   * hangs on — see `perdiem-dependency.ts`. Null when nothing can move it.
   * `settled: false` is the one that blocks: the queue names it and disables the
   * row's controls, and `approveByAccount` refuses it server-side.
   */
  perDiemDependency: PerDiemDependency | null;
}

/**
 * AP-17 requests Admin has finished booking and handed to accounting —
 * `ManagerApproved` / `CurrentStepCode='ACCOUNT'` (set by `completeRequest`,
 * closed by `approveByAccount` in `approval.ts`). Unlike `listAdminQueue`,
 * this filters on `CurrentStepCode` as well as `Status`: the two queues sit on
 * the same status and must not show each other's rows.
 */
/** Required `access`, for the reason on `listAdminQueue`. */
export async function listAccountQueue(access: BookingBrandAccess): Promise<AccountQueueItem[]> {
  const scope = bookingBrandScope(access);
  if (scope.kind === "none") return [];
  const pool = await getAccPool();
  const req0 = pool.request().input("form", sql.NVarChar, AP17_FORM_CODE);
  const brandFilter = bookingBrandScopeSql(scope, req0, "r.BrandCode");
  const res = await req0
    .query(`
      SELECT r.Id, r.RequestNo, r.BrandCode, r.RequesterFullName, r.RequesterPosition, r.RequesterDepartmentName,
             r.PaymentDate, r.UpdatedAt,
             t.ProvinceName, t.DepartDate, t.ReturnDate, t.PerDiemDays, t.PerDiemTotal,
             (SELECT STRING_AGG(wl.Name, N' · ') WITHIN GROUP (ORDER BY wl.SortOrder, wl.Id)
              FROM [dbo].[AccTravelWorkLocation] wl
              WHERE wl.TravelBookingId = t.Id) AS WorkLocationNames
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
      WHERE r.FormCode = @form AND r.Status = 'ManagerApproved' AND r.CurrentStepCode = 'ACCOUNT'
        ${brandFilter ? `AND ${brandFilter}` : ""}
      ORDER BY r.UpdatedAt ASC
    `);
  const rows = res.recordset as Record<string, unknown>[];
  const ids = rows.map((x) => x.Id as number);

  // Batch-loaded rather than a correlated subquery: STRING_AGG would need every
  // note squeezed through one delimiter and split back apart on the way out,
  // for no fewer round trips once the queue holds more than a handful of rows.
  const historyByRequest = new Map<number, string[]>();
  if (ids.length > 0) {
    const histReq = pool.request();
    const placeholders = ids.map((id, i) => {
      histReq.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    });
    const histRes = await histReq
      .input("action", sql.NVarChar(50), "perdiem_recalculated")
      .query(`
        SELECT RequestId, Note FROM [dbo].[AccActivityLog]
        WHERE Action = @action AND RequestId IN (${placeholders.join(", ")})
        ORDER BY CreatedAt ASC
      `);
    for (const h of histRes.recordset as { RequestId: number; Note: string | null }[]) {
      if (!h.Note) continue;
      const list = historyByRequest.get(h.RequestId) ?? [];
      list.push(h.Note);
      historyByRequest.set(h.RequestId, list);
    }
  }

  // Batched for the same reason the history above is, and it matters more here:
  // this one needs every *sibling* of every queued request's group, which a
  // per-row query would fetch over and over for rows that share a group. One
  // round trip whatever the queue holds — see `loadPerDiemDependencies`.
  const dependencies = await loadPerDiemDependencies(pool, ids);

  return rows.map((x) => ({
    id: x.Id as number,
    requestNo: (x.RequestNo as string) ?? null,
    brandCode: (x.BrandCode as string) ?? null,
    requesterFullName: (x.RequesterFullName as string) ?? null,
    requesterPosition: (x.RequesterPosition as string) ?? null,
    requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
    provinceName: (x.ProvinceName as string) ?? null,
    workLocationNames: (x.WorkLocationNames as string) ?? null,
    departDate: x.DepartDate ? toYmd(x.DepartDate as Date) : null,
    returnDate: x.ReturnDate ? toYmd(x.ReturnDate as Date) : null,
    perDiemDays: (x.PerDiemDays as number) ?? 0,
    perDiemTotal: Number(x.PerDiemTotal) || 0,
    paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
    updatedAt: x.UpdatedAt ? (x.UpdatedAt as Date).toISOString() : "",
    perDiemHistory: historyByRequest.get(x.Id as number) ?? [],
    perDiemDependency: dependencies.get(x.Id as number) ?? null,
  }));
}

/* ─────────────────────────── currency ─────────────────────────── */

/**
 * What this request's booking figures are recorded in, and what one unit is
 * worth in baht.
 *
 * `currency === null` means baht, and a baht request stores **both** columns as
 * NULL: nobody recorded a currency, and writing `'THB'` would claim somebody
 * had. That is also what keeps a brand with no currency configured writing
 * byte-identical rows to the ones it wrote before this feature existed.
 */
interface BookingFx {
  currency: string | null;
  /** THB per 1 unit. Null only alongside a null currency. */
  rate: number | null;
  /**
   * **Which day's rate that is**, `YYYY-MM-DD`, and who published it (migration
   * 130). Null alongside a null currency, for the same reason the rate is:
   * nothing was fetched and there is no conversion to describe.
   *
   * The source publishes on working days only, so a booking saved on a Saturday
   * records Friday's rate. That is correct — there is no rate for a day the
   * market did not trade — but without the date nobody can tell afterwards
   * which day the desk's figures were priced at.
   */
  asOf: string | null;
  source: string | null;
}

const BAHT_FX: BookingFx = { currency: null, rate: null, asOf: null, source: null };

/**
 * The request's currency — the union of its **brand's** configured currencies
 * and its **destination's** — with today's rate fetched for it.
 *
 * **`posted` is the desk's opt-in, not merely an opt-out.** Absent means baht,
 * so a client that posts nothing records exactly what an unconfigured request
 * always recorded. Only a currency on one of the two arms moves it off baht,
 * and nothing can widen that: anything else resolves back to THB.
 *
 * **Re-derived here from the row, never trusted from the client.** The panel
 * builds the same list from the same two codes, but a posted currency is a
 * claim about what a request may hold and this is the only place that decides
 * it. Both call one function, `effectiveBookingCurrency`, so the offer and the
 * acceptance cannot be two rules that drift apart.
 *
 * ── The registry read, and when it is skipped ──
 *
 * `listBrandRegistry()` opens `getProductionFormPool()` — `BrandCurrency` has
 * no row in `Rocks_Portal_Form_UAT`, so a `getAccPool()` read of it throws
 * `Invalid object name` for every UAT tester and for nobody else. This file
 * must therefore never name that table itself; `currency-pool-guard.test.ts`
 * enforces exactly that, per file, and this one imports `getAccPool` on line 1.
 *
 * **Baht and blank both skip the read entirely.** `effectiveBookingCurrency`
 * answers baht for either whatever the two arms say, so the registry could not
 * change the outcome — and since baht is the **default** rather than the opt-out,
 * that short-circuit now covers the ordinary case rather than the unusual one:
 * the desk posts `THB` unless it deliberately picks otherwise, so almost no
 * booking save opens the second pool at all. Blank is in the guard for the same
 * reason and not merely for speed — without it an absent currency paid two pools
 * and three whole-table queries to be told baht, and a baht save failed outright
 * whenever Fast_Core was down.
 *
 * ── A pick the union rejects RAISES; only an absent one means baht ──
 *
 * The panel reads the brand once at mount and this re-reads it on every save, so
 * an admin switching a currency off in between leaves the desk posting a code
 * the union no longer holds. Resolving that to baht would **succeed**, write a
 * NULL currency and rate, and have `recomputeBookingBaht` store the foreign
 * figure as baht unconverted. See `BOOKING_CURRENCY_STALE_ERROR`. It is an
 * `AccConflictError`, so the route answers 409 rather than 400's retry
 * affordance — the desk must reload, because retrying the same body fails the
 * same way.
 *
 * Called **outside** the transaction, deliberately: it reaches two databases
 * and the network, and holding the `AccRequest` row lock across an 8-second FX
 * timeout is how a booking save turns into a deadlock against
 * `completeRequest`.
 */
async function resolveBookingFx(
  scope: BookingScope,
  posted: string | null | undefined,
): Promise<BookingFx> {
  const want = (posted ?? "").trim().toUpperCase();
  if (want === THB || want === "") return BAHT_FX;

  let brand: { currencies: BrandCurrencyEntry[] } | null = null;
  if (scope.brandCode) {
    const brands = await listBrandRegistry();
    for (const b of brands) {
      if (b.code === scope.brandCode) {
        brand = { currencies: b.currencies };
        break;
      }
    }
  }

  const currency = effectiveBookingCurrency(posted, brand, scope.countryCode);
  // `want` is neither blank nor THB by here, so baht can only mean the union
  // refused it. Raise rather than record the figures at 1:1.
  if (currency === THB) throw new AccConflictError(BOOKING_CURRENCY_STALE_ERROR);
  if (!needsRate(currency)) return BAHT_FX;

  const fx = await resolveRate(currency);
  // Fail closed. Recording a foreign currency with no rate would leave every
  // screen showing MYR figures with no way to express them in baht, on the
  // request accounting is about to sign off.
  if (!fx) throw new Error(BOOKING_FX_UNAVAILABLE_ERROR);
  // `rateAsOfYmd` refuses anything that is not a real `YYYY-MM-DD`, so a
  // provider answering an empty or malformed date records nothing rather than a
  // date nobody can trust.
  return { currency, rate: fx.rate, asOf: rateAsOfYmd(fx.asOf), source: (fx.source ?? "").trim().slice(0, 20) || null };
}

/**
 * Refuse the save unless every figure on the row can actually be stated in baht
 * at the rate about to be recorded.
 *
 * **`toBaht` returning null is a refusal, never a fallback to the unconverted
 * figure.** AP-17 stores no converted column of its own — the four figures stay
 * in the request's own currency, exactly as AP-1's per-day
 * `AccTravelExpense.TotalAmount` does — so what this protects is the *pair* the
 * screens multiply: `Currency` plus `ExchangeRate`. Committing a rate that
 * cannot convert these figures would put an unusable pair on the request and
 * leave the desk with nothing on screen saying so.
 *
 * A baht request never reaches the loop: `fx.currency` is null and there is
 * nothing to convert.
 */
function assertConvertible(fx: BookingFx, amounts: (number | null)[]): void {
  if (fx.currency === null) return;
  for (const amount of amounts) {
    if (amount === null) continue;
    if (toBaht(amount, fx.rate) === null) throw new Error(BOOKING_FX_UNAVAILABLE_ERROR);
  }
}

/** The two codes that between them decide what a booking may be recorded in. */
interface BookingScope {
  brandCode: string | null;
  countryCode: string | null;
}

/**
 * Whose books this request is on and where it goes, read before the transaction
 * opens so the FX lookup can happen outside it.
 *
 * **One query, because both codes are columns of the same row.** Reading them
 * separately would be two round trips for one fact, and worse, could see the two
 * halves of a request that changed in between.
 *
 * Deliberately not taken from the client: the currency is derived from these
 * two, so posting either would let a caller pick the currency after all.
 */
async function loadBookingScope(pool: AccPool, requestId: number): Promise<BookingScope> {
  const res = await pool.request()
    .input("rid", sql.Int, requestId)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`SELECT BrandCode, CountryCode FROM [dbo].[AccRequest] WHERE Id=@rid AND FormCode=@form`);
  const row = res.recordset[0] as { BrandCode: string | null; CountryCode: string | null } | undefined;
  return {
    brandCode: ((row?.BrandCode ?? "").trim().toUpperCase()) || null,
    countryCode: ((row?.CountryCode ?? "").trim().toUpperCase()) || null,
  };
}

/* ─────────────────────────── booking fill-in ─────────────────────────── */

export interface SavedBookingDetail {
  id: number;
  travelBookingId: number;
  bookingType: BookingType;
  bookingNo: string | null;
  priceExVat: number | null;
  vatAmount: number | null;
  discountAmount: number | null;
  totalAmount: number | null;
}

interface SavedRow {
  Id: number; TravelBookingId: number; BookingType: string; BookingNo: string | null; PriceExVat: number | null;
  VatAmount: number | null; DiscountAmount: number | null; TotalAmount: number | null;
}

function mapSavedRow(row: SavedRow): SavedBookingDetail {
  return {
    id: row.Id,
    travelBookingId: row.TravelBookingId,
    bookingType: row.BookingType as BookingType,
    bookingNo: row.BookingNo ?? null,
    priceExVat: num(row.PriceExVat),
    vatAmount: num(row.VatAmount),
    discountAmount: num(row.DiscountAmount),
    totalAmount: num(row.TotalAmount),
  };
}

type AccTx = ReturnType<AccPool["transaction"]>;

/** Either a pool or a transaction — both expose `request()`. */
type SqlRunner = Pick<AccPool, "request"> | Pick<AccTx, "request">;

/**
 * Resolve the request's `AccTravelBooking` id, guarding that Admin may still
 * edit its bookings, and — inside a transaction — holding the parent row until
 * that transaction ends.
 *
 * `UPDLOCK, HOLDLOCK` on `AccRequest` is what serialises a booking mutation
 * against completion. `completeRequest` used to validate the booking children
 * with a read taken before its transaction even opened, while `saveBookingDetail`
 * and `deleteBookingDetail` ran with no transaction at all: a delete landing
 * between that read and the commit produced a `Completed` request missing the
 * booking number, price and attachment its own rules require it to have. Both
 * sides now contend for the same row lock, so one of them waits and then sees
 * the other's outcome.
 *
 * On a pool (no transaction) the hint is harmless — the lock is released with
 * the statement — so the signature stays usable for the read-only callers.
 */
async function requireEditableBooking(runner: SqlRunner, requestId: number): Promise<number> {
  const tbRes = await runner.request().input("rid", sql.Int, requestId)
    .query(`SELECT t.Id AS TravelBookingId, r.Status, r.CurrentStepCode
            FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r WITH (UPDLOCK, HOLDLOCK) ON r.Id = t.RequestId
            WHERE t.RequestId = @rid`);
  const tbRow = tbRes.recordset[0] as { TravelBookingId: number; Status: string; CurrentStepCode: string | null } | undefined;
  if (!tbRow) throw new Error("ไม่พบคำขอนี้");
  // `Status` alone used to name the Admin stage exactly (see `listAdminQueue`'s
  // own note) — since the accounting step split it in two, a request can be
  // `ManagerApproved` while already handed to accounting (`CurrentStepCode =
  // 'ACCOUNT'`), and without this check Admin could still save, delete or
  // re-attach evidence on a request accounting is signing off.
  if (tbRow.Status !== "ManagerApproved" || tbRow.CurrentStepCode !== "ADMIN") {
    throw new Error("คำขอนี้ไม่อยู่ในขั้นตอนที่ Admin สามารถกรอกข้อมูลการจองได้");
  }
  return tbRow.TravelBookingId;
}

/**
 * Create or update one `AccTravelBookingDetail` row. A request may hold SEVERAL rows of the
 * same `bookingType` (e.g. two hotels for one trip), so rows are keyed by `Id`, not by type:
 * pass `detailId` to edit an existing row, omit it to add another one. **Every** field may be
 * null — Admin can create an empty row just to hang attachments on it, and fill the fields in
 * afterwards. Attachments are handled separately (the file route), which needs this row's `Id`
 * as `AccRequestFile.RefId` — hence the full saved row is returned.
 *
 * Five fields since migration 123, and **this is the gate on the four figures**, not the panel:
 * every one goes through `sanitizeBookingAmount`, so a value out of range or non-numeric is
 * stored as NULL rather than as itself. The client applies the same function, which makes the
 * field behave predictably as it is typed — it does not make the client the authority. The
 * total is stored as entered and never reconciled against the other three here: a supplier's
 * own total is a fact about the transaction, and `totalMismatch` flags a disagreement for a
 * person to judge rather than correcting it (see `features/travel-booking/lib/booking-amounts.ts`).
 *
 * ── Currency ──
 *
 * The four figures are stored **in the request's own currency, unconverted** —
 * the same treatment AP-1 gives its per-day `AccTravelExpense.TotalAmount`.
 * What this save also records, on the request header, is *which* currency and
 * at *what* rate, so every screen can state the baht equivalent beside them.
 *
 * The currency is bounded by the request's stored destination and re-derived
 * here whatever the client posted (`resolveBookingFx`); `input.currency` can
 * only ever say "the desk says this invoice is in the destination's currency",
 * and everything else lands on baht. The rate is fetched **server-side** — the
 * client never posts one, which is the single part of AP-2's approach this
 * feature deliberately does not reuse.
 *
 * **`AccRequest.TotalAmount` is not touched, and must not be.** For AP-17 it
 * holds the *per-diem total alone* — the booking cost has never reached the
 * header — so summing this row into it would double the figure on My Requests,
 * My Work and the header for **every** AP-17 request including baht ones, and
 * `recomputeGroupPerDiem` would silently rewrite it back from the per diem
 * anyway (`perdiem-recompute.ts`, asserted by its own test). Per diem is always
 * baht: `EmployeeAllowanceLog` has no currency column.
 */
export async function saveBookingDetail(
  requestId: number,
  bookingType: BookingType,
  input: {
    detailId?: number | null;
    bookingNo: string | null;
    priceExVat: number | null;
    vatAmount?: number | null;
    discountAmount?: number | null;
    totalAmount?: number | null;
    /**
     * What the desk's toggle held. **Not a choice of rate, and not really a
     * choice of currency** — anything other than `'THB'` resolves to the
     * brand's own currency, so this can only opt out, never widen.
     */
    currency?: string | null;
  },
  actor: Actor,
): Promise<SavedBookingDetail> {
  const pool = await getAccPool();

  // Both before the transaction: this reads the production form pool and, for a
  // foreign request, the FX provider. A brand with no currency configured makes
  // no FX call at all and writes NULL into both columns, exactly as before.
  const fx = await resolveBookingFx(await loadBookingScope(pool, requestId), input.currency ?? null);
  const amounts = [
    sanitizeBookingAmount(input.priceExVat),
    sanitizeBookingAmount(input.vatAmount),
    sanitizeBookingAmount(input.discountAmount),
    sanitizeBookingAmount(input.totalAmount),
  ];
  // Refuses before anything is written, rather than committing a currency and a
  // rate that cannot express the figures beside them.
  assertConvertible(fx, amounts);

  const tx = pool.transaction();
  await tx.begin();
  try {
    // The guard takes an UPDLOCK on the parent inside this transaction, so a
    // concurrent `completeRequest` either waits for this row or finds the
    // request no longer at the Admin step.
    const travelBookingId = await requireEditableBooking(tx, requestId);

    const bind = (r: ReturnType<typeof tx.request>) =>
      r.input("tbid", sql.Int, travelBookingId)
        .input("type", sql.NVarChar(20), bookingType)
        // Refused, not truncated: `sql.NVarChar(100)` binds a longer string
        // silently, which would store the first hundred characters of the wrong
        // thing as a booking reference.
        .input("no", sql.NVarChar(100), sanitizeBookingNo(input.bookingNo))
        // The figures stay in the request's own currency — `Currency` and
        // `ExchangeRate` on the header say which, and the screens convert.
        .input("price", sql.Decimal(18, 2), amounts[0])
        .input("vat", sql.Decimal(18, 2), amounts[1])
        .input("disc", sql.Decimal(18, 2), amounts[2])
        .input("total", sql.Decimal(18, 2), amounts[3]);

    const OUTPUT_COLS = `OUTPUT inserted.Id AS Id, inserted.TravelBookingId AS TravelBookingId,
               inserted.BookingType AS BookingType, inserted.BookingNo AS BookingNo, inserted.PriceExVat AS PriceExVat,
               inserted.VatAmount AS VatAmount, inserted.DiscountAmount AS DiscountAmount, inserted.TotalAmount AS TotalAmount`;

    let saved: SavedRow | undefined;
    if (input.detailId != null) {
      const upd = await bind(tx.request()).input("did", sql.Int, input.detailId)
        .query(`UPDATE [dbo].[AccTravelBookingDetail]
                SET BookingNo = @no, PriceExVat = @price,
                    VatAmount = @vat, DiscountAmount = @disc, TotalAmount = @total
                ${OUTPUT_COLS}
                WHERE Id = @did AND TravelBookingId = @tbid AND BookingType = @type`);
      saved = upd.recordset[0] as SavedRow | undefined;
      if (!saved) throw new Error("ไม่พบรายการจองที่ระบุ");
    } else {
      const ins = await bind(tx.request()).input("user", sql.Int, actor.userId || null)
        .query(`INSERT INTO [dbo].[AccTravelBookingDetail]
                  (TravelBookingId, BookingType, BookingNo, PriceExVat, VatAmount, DiscountAmount, TotalAmount, CreatedBy)
                ${OUTPUT_COLS}
                VALUES (@tbid, @type, @no, @price, @vat, @disc, @total, @user)`);
      saved = ins.recordset[0] as SavedRow;
    }

    /* The two header columns, in the same transaction as the row whose figures
       they describe — a committed figure with no currency beside it is a number
       every screen would read as baht.

       `TotalAmount` is deliberately absent: for AP-17 it is the per-diem total
       alone and this feature does not change what it means. `ForeignAmount` is
       absent too, and that is not an oversight — AP-1 documents it as "the claim's
       own figure, of which TotalAmount is the conversion", and here TotalAmount is
       a *different* quantity in a *different* currency, so filling it in would
       assert a relationship that does not hold.

       `UpdatedAt` is not touched either: `listAdminQueue` and `listAccountQueue`
       both `ORDER BY r.UpdatedAt ASC`, so bumping it would send a request to the
       back of the work queue every time the desk saved a row. */
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("currency", sql.Char(3), fx.currency)
      .input("fxRate", sql.Decimal(18, 6), fx.currency === null ? null : fx.rate)
      // Migration 130, and in the same statement as the rate they qualify — a
      // rate whose day nobody recorded is exactly what this replaces, and a date
      // that could arrive a commit later than the rate would describe a figure
      // that is not there. `sql.Date` takes the `YYYY-MM-DD` string directly.
      .input("rateAsOf", sql.Date, fx.currency === null ? null : fx.asOf)
      .input("rateSource", sql.NVarChar(20), fx.currency === null ? null : fx.source)
      .query(`UPDATE [dbo].[AccRequest] SET Currency=@currency, ExchangeRate=@fxRate,
                  RateAsOf=@rateAsOf, RateSource=@rateSource
              WHERE Id=@rid`);

    // Migration 136's stored baht figure, rewritten for EVERY row of the
    // request in the same transaction as the rate above. Not just the row just
    // saved: one rate is recorded per request and re-fetched on each save, so
    // the siblings would otherwise go on quoting a rate the header no longer
    // holds. `recomputeBookingBaht` is the only statement that writes the
    // column, shared with `applyRateOverride`, so the two rate writers cannot
    // disagree about what a booking cost.
    await recomputeBookingBaht(tx, requestId, fx.currency === null ? null : fx.rate);

    await tx.commit();
    return mapSavedRow(saved);
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/**
 * Remove one booking row and everything hanging off it — its `AccRequestFile` rows plus the
 * stored bytes (best-effort; a storage failure must not leave the DB row behind).
 */
export async function deleteBookingDetail(requestId: number, detailId: number): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  let storedFiles: StoredFileRef[] = [];
  await tx.begin();
  try {
    // Same parent lock as `saveBookingDetail`, for the same reason: a delete
    // must not land between `completeRequest`'s evidence check and its commit.
    const travelBookingId = await requireEditableBooking(tx, requestId);

    const detRes = await tx.request()
      .input("did", sql.Int, detailId)
      .input("tbid", sql.Int, travelBookingId)
      .query(`SELECT BookingType FROM [dbo].[AccTravelBookingDetail] WHERE Id = @did AND TravelBookingId = @tbid`);
    const detRow = detRes.recordset[0] as { BookingType: string } | undefined;
    if (!detRow) throw new Error("ไม่พบรายการจองที่ระบุ");
    const refType = BOOKING_TYPE_REFTYPE[detRow.BookingType as BookingType];

    const fileRes = await tx.request()
      .input("rid", sql.Int, requestId)
      .input("ref", sql.NVarChar(50), refType)
      .input("did", sql.Int, detailId)
      .query(`SELECT Id, StoragePath, StorageBackend FROM [dbo].[AccRequestFile]
              WHERE RequestId = @rid AND RefType = @ref AND RefId = @did`);
    storedFiles = (fileRes.recordset as { StoragePath: string; StorageBackend: string | null }[]).map(
      (f) => ({ storagePath: f.StoragePath, storageBackend: f.StorageBackend }),
    );

    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("ref", sql.NVarChar(50), refType)
      .input("did", sql.Int, detailId)
      .query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId = @rid AND RefType = @ref AND RefId = @did`);
    await tx.request().input("did", sql.Int, detailId)
      .query(`DELETE FROM [dbo].[AccTravelBookingDetail] WHERE Id = @did`);

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  // Storage after the commit, and never before it: removing the bytes first
  // meant a rolled-back delete left a row pointing at nothing.
  await deleteStoredFiles(storedFiles, `AP-17 deleteBookingDetail request ${requestId} detail ${detailId}`);
}

/* ─────────────────────────── completion ─────────────────────────── */

/** Which `Needs*Booking` flag (spec §2.x) gates each `AccTravelBookingDetail.BookingType`. */
const REQUIRED_BOOKINGS: { type: BookingType; label: string; needed: (req: TravelBookingRequest) => boolean }[] = [
  { type: "room", label: "การจองห้องพัก", needed: (req) => req.needsRoomBooking },
  { type: "ticket", label: "การจองตั๋วโดยสาร", needed: (req) => req.goNeedsTicketBooking || req.returnNeedsTicketBooking },
  { type: "rent", label: "การจองรถเช่า", needed: (req) => req.needsRentBooking },
];

/**
 * Which required booking types are not yet complete.
 *
 * `runner` is a transaction when this is the safe re-check inside
 * `completeRequest`, and the flags come from the request header that was read
 * before it — those are server-derived (`@/lib/acc/travel-booking/derive-flags`)
 * and the locked UPDATE has already proved the header did not move.
 *
 * A type is complete when it has at least one row and *every* row carries a
 * booking number, a price and at least one file. A half-filled extra row blocks
 * completion on purpose: Admin either finishes it or removes it.
 */
async function missingRequiredBookings(
  runner: SqlRunner,
  requestId: number,
  req: TravelBookingRequest,
): Promise<string[]> {
  const needed = REQUIRED_BOOKINGS.filter((rule) => rule.needed(req));
  if (needed.length === 0) return [];

  // The BookingType -> RefType mapping is bound from `BOOKING_TYPE_REFTYPE`
  // rather than spelled out in SQL, so the constant stays the only place it
  // lives — the file routes already key their inserts off it.
  const sqlReq = runner.request().input("rid", sql.Int, requestId);
  const cases: string[] = [];
  // `Array.from` rather than spreading the iterator — ES5 target (see CLAUDE.md).
  Array.from(Object.entries(BOOKING_TYPE_REFTYPE)).forEach(([type, refType], index) => {
    sqlReq.input(`type${index}`, sql.NVarChar(20), type);
    sqlReq.input(`ref${index}`, sql.NVarChar(50), refType);
    cases.push(`WHEN @type${index} THEN @ref${index}`);
  });

  const res = await sqlReq.query(`
    SELECT d.Id, d.BookingType, d.BookingNo, d.PriceExVat,
           (SELECT COUNT(*) FROM [dbo].[AccRequestFile] f
             WHERE f.RequestId = @rid AND f.RefId = d.Id
               AND f.RefType = CASE d.BookingType ${cases.join(" ")} END) AS FileCount
    FROM [dbo].[AccTravelBookingDetail] d
    INNER JOIN [dbo].[AccTravelBooking] t ON t.Id = d.TravelBookingId
    WHERE t.RequestId = @rid
  `);
  const rows = res.recordset as {
    BookingType: string; BookingNo: string | null; PriceExVat: number | null; FileCount: number;
  }[];

  const missing: string[] = [];
  for (const rule of needed) {
    const forType = rows.filter((r) => r.BookingType === rule.type);
    const complete =
      forType.length > 0 &&
      forType.every((r) => !!r.BookingNo?.trim() && r.PriceExVat != null && r.FileCount > 0);
    if (!complete) missing.push(rule.label);
  }
  return missing;
}

/**
 * Admin hands the request on to accounting — ManagerApproved/ADMIN → ManagerApproved/ACCOUNT —
 * once every required booking type (per `REQUIRED_BOOKINGS`) has at least one row and EVERY one
 * of its rows carries a saved `BookingNo` + `PriceExVat` and at least one attached file. A type
 * may hold several rows (two hotels, two tickets, …), and a half-filled extra row blocks
 * completion on purpose — Admin either finishes it or removes it. `getTravelBookingRequest`
 * already joins `AccTravelBookingDetail` with its `AccRequestFile` rows (by RefType/RefId), so
 * the gate is checked against that shape directly rather than re-deriving the RefType↔BookingType
 * mapping.
 *
 * This no longer closes the request — `Status` stays `ManagerApproved` and only
 * `CurrentStepCode` moves, to `'ACCOUNT'`. Closing it to `Completed` is now
 * `approveByAccount`'s job (`approval.ts`).
 */
export async function completeRequest(requestId: number, actor: Actor): Promise<TravelBookingRequest> {
  const req = await getTravelBookingRequest(requestId);
  if (!req) throw new Error("ไม่พบคำขอ");
  if (req.status !== "ManagerApproved") {
    throw new Error("คำขอนี้ไม่อยู่ในขั้นตอนที่สามารถปิดงานได้");
  }

  const missing: string[] = [];
  for (const rule of REQUIRED_BOOKINGS) {
    if (!rule.needed(req)) continue;
    const rows = req.bookingDetails.filter((d) => d.bookingType === rule.type);
    const complete =
      rows.length > 0 &&
      rows.every((d) => !!d.bookingNo?.trim() && d.priceExVat != null && d.files.length > 0);
    if (!complete) missing.push(rule.label);
  }
  if (missing.length > 0) {
    throw new Error(`กรุณากรอกข้อมูลการจองให้ครบก่อนปิดงาน: ${missing.join(", ")}`);
  }

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest] SET CurrentStepCode='ACCOUNT', UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode='ADMIN' AND Status='ManagerApproved';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นตอนที่สามารถปิดงานได้ หรือถูกดำเนินการไปแล้ว");
    }

    // Re-check the evidence with the parent row now exclusively locked by the
    // UPDATE above. The check before the transaction is kept because it gives
    // the operator the useful "which booking is missing" message; this one is
    // the one that is actually safe. Without it, a `deleteBookingDetail` landing
    // between the two produced a Completed request with no booking number, no
    // price and no attachment — the exact state the rules exist to prevent.
    const stillMissing = await missingRequiredBookings(tx, requestId, req);
    if (stillMissing.length > 0) {
      await tx.rollback();
      throw new Error(
        `ข้อมูลการจองถูกแก้ไขระหว่างปิดงาน — กรุณาตรวจสอบแล้วลองใหม่: ${stillMissing.join(", ")}`,
      );
    }
    // Not 'completed' — the request is not finished, it is handed to accounting.
    // No email fires here either: nothing in `TravelBookingTrigger` says "arranged,
    // awaiting accounting" (the closest is `Completed`, which would tell the
    // requester the wrong thing), and `approveByAccount` is where the real
    // "finished" email now belongs — see `approval.ts`.
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'sent_to_account', N'ส่งต่อให้บัญชีตรวจสอบ')`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const updated = await getTravelBookingRequest(requestId);
  if (!updated) throw new Error("ไม่พบคำขอหลังส่งต่อให้บัญชี");
  return updated;
}
