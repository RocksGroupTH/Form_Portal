import { getAccPool, sql } from "@/lib/acc/pool";
import type { Actor } from "@/lib/acc/approval-engine";
import { queueEmail, processQueue } from "@/lib/acc/email-queue";
import { buildTravelBookingEmail } from "@/lib/acc/travel-booking/email-templates";
import { getRequesterEmail } from "@/lib/acc/travel-booking/approval";
import { getTravelBookingRequest } from "@/lib/acc/travel-booking/request-service";
import { deleteStoredFiles, type StoredFileRef } from "@/lib/acc/stored-file";
import { AP17_FORM_CODE, BOOKING_TYPE_REFTYPE } from "@/features/travel-booking/constants";
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

/** AP-17 requests that finished Manager approval and are waiting on Admin to fill bookings. */
export async function listAdminQueue(): Promise<AdminQueueItem[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`
      SELECT r.Id, r.RequestNo, r.BrandCode, r.RequesterFullName, r.RequesterPosition, r.RequesterDepartmentName,
             r.PaymentDate, r.UpdatedAt,
             t.ProvinceName, t.DepartDate, t.ReturnDate,
             t.NeedsRoomBooking, t.GoNeedsTicketBooking, t.ReturnNeedsTicketBooking, t.NeedsRentBooking
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
      WHERE r.FormCode = @form AND r.Status = 'ManagerApproved'
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
    departDate: x.DepartDate ? toYmd(x.DepartDate as Date) : null,
    returnDate: x.ReturnDate ? toYmd(x.ReturnDate as Date) : null,
    needsRoomBooking: !!x.NeedsRoomBooking,
    needsTicketBooking: !!x.GoNeedsTicketBooking || !!x.ReturnNeedsTicketBooking,
    needsRentBooking: !!x.NeedsRentBooking,
    paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
    updatedAt: x.UpdatedAt ? (x.UpdatedAt as Date).toISOString() : "",
  }));
}

/* ─────────────────────────── booking fill-in ─────────────────────────── */

export interface SavedBookingDetail {
  id: number;
  travelBookingId: number;
  bookingType: BookingType;
  bookingNo: string | null;
  priceExVat: number | null;
}

interface SavedRow {
  Id: number; TravelBookingId: number; BookingType: string; BookingNo: string | null; PriceExVat: number | null;
}

function mapSavedRow(row: SavedRow): SavedBookingDetail {
  return {
    id: row.Id,
    travelBookingId: row.TravelBookingId,
    bookingType: row.BookingType as BookingType,
    bookingNo: row.BookingNo ?? null,
    priceExVat: num(row.PriceExVat),
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
    .query(`SELECT t.Id AS TravelBookingId, r.Status
            FROM [dbo].[AccTravelBooking] t
            INNER JOIN [dbo].[AccRequest] r WITH (UPDLOCK, HOLDLOCK) ON r.Id = t.RequestId
            WHERE t.RequestId = @rid`);
  const tbRow = tbRes.recordset[0] as { TravelBookingId: number; Status: string } | undefined;
  if (!tbRow) throw new Error("ไม่พบคำขอนี้");
  if (tbRow.Status !== "ManagerApproved") {
    throw new Error("คำขอนี้ไม่อยู่ในขั้นตอนที่ Admin สามารถกรอกข้อมูลการจองได้");
  }
  return tbRow.TravelBookingId;
}

/**
 * Create or update one `AccTravelBookingDetail` row. A request may hold SEVERAL rows of the
 * same `bookingType` (e.g. two hotels for one trip), so rows are keyed by `Id`, not by type:
 * pass `detailId` to edit an existing row, omit it to add another one. Both `bookingNo` and
 * `priceExVat` may be null — Admin can create an empty row just to hang attachments on it,
 * and fill the fields in afterwards. Attachments are handled separately (the file route),
 * which needs this row's `Id` as `AccRequestFile.RefId` — hence the full saved row is returned.
 */
export async function saveBookingDetail(
  requestId: number,
  bookingType: BookingType,
  input: { detailId?: number | null; bookingNo: string | null; priceExVat: number | null },
  actor: Actor,
): Promise<SavedBookingDetail> {
  const pool = await getAccPool();
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
        .input("no", sql.NVarChar(100), input.bookingNo?.trim() || null)
        .input("price", sql.Decimal(18, 2), input.priceExVat ?? null);

    const OUTPUT_COLS = `OUTPUT inserted.Id AS Id, inserted.TravelBookingId AS TravelBookingId,
               inserted.BookingType AS BookingType, inserted.BookingNo AS BookingNo, inserted.PriceExVat AS PriceExVat`;

    let saved: SavedRow | undefined;
    if (input.detailId != null) {
      const upd = await bind(tx.request()).input("did", sql.Int, input.detailId)
        .query(`UPDATE [dbo].[AccTravelBookingDetail] SET BookingNo = @no, PriceExVat = @price
                ${OUTPUT_COLS}
                WHERE Id = @did AND TravelBookingId = @tbid AND BookingType = @type`);
      saved = upd.recordset[0] as SavedRow | undefined;
      if (!saved) throw new Error("ไม่พบรายการจองที่ระบุ");
    } else {
      const ins = await bind(tx.request()).input("user", sql.Int, actor.userId || null)
        .query(`INSERT INTO [dbo].[AccTravelBookingDetail] (TravelBookingId, BookingType, BookingNo, PriceExVat, CreatedBy)
                ${OUTPUT_COLS}
                VALUES (@tbid, @type, @no, @price, @user)`);
      saved = ins.recordset[0] as SavedRow;
    }

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
 * Admin closes the request — ManagerApproved → Completed — once every required booking type
 * (per `REQUIRED_BOOKINGS`) has at least one row and EVERY one of its rows carries a saved
 * `BookingNo` + `PriceExVat` and at least one attached file. A type may hold several rows
 * (two hotels, two tickets, …), and a half-filled extra row blocks completion on purpose —
 * Admin either finishes it or removes it. `getTravelBookingRequest` already joins
 * `AccTravelBookingDetail` with its `AccRequestFile` rows (by RefType/RefId), so the gate is
 * checked against that shape directly rather than re-deriving the RefType↔BookingType mapping.
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
      .query(`UPDATE [dbo].[AccRequest] SET Status='Completed', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
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
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'completed')`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  try {
    const requesterEmail = await getRequesterEmail(requestId);
    const updated = requesterEmail ? await getTravelBookingRequest(requestId) : null;
    if (requesterEmail && updated) {
      const mail = buildTravelBookingEmail("Completed", updated);
      await queueEmail({ requestId, toEmail: requesterEmail, subject: mail.subject, bodyHtml: mail.html, triggerType: "Completed" });
    }
  } catch {
    // Notification failures must never fail the completion action itself.
  }
  void processQueue().catch(() => {});

  const updated = await getTravelBookingRequest(requestId);
  if (!updated) throw new Error("ไม่พบคำขอหลังปิดงาน");
  return updated;
}
