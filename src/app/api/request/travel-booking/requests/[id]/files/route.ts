import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { canAccessAccountArea } from "@/lib/acc/access";
import { deleteFile } from "@/lib/storage";
import {
  isSharePointConfigured,
  uploadFileToSharePoint,
  deleteFileFromSharePoint,
} from "@/lib/sharepoint";
import {
  buildAccFolderPath,
  buildAccFileName,
} from "@/lib/acc/sharepoint-path";
import { resolveFormEnvironment } from "@/lib/form-environment";
import {
  AP17_FORM_CODE,
  FILE_REFTYPES,
  BOOKING_TYPE_REFTYPE,
} from "@/features/travel-booking/constants";
import type {
  TravelBookingFileMeta,
  BookingType,
} from "@/features/travel-booking/types";

const REFTYPE_VALUES = new Set<string>(Object.values(FILE_REFTYPES));

/** refType ("booking_room"|...) → BookingType ("room"|...), the inverse of BOOKING_TYPE_REFTYPE. */
const BOOKING_TYPE_BY_REFTYPE: Partial<Record<string, BookingType>> =
  Object.fromEntries(
    (Object.entries(BOOKING_TYPE_REFTYPE) as [BookingType, string][]).map(
      ([type, ref]) => [ref, type],
    ),
  );

/* ── POST /api/request/travel-booking/requests/[id]/files ──
   multipart: refType (idcard|booking_room|booking_ticket|booking_rent), optional bookingDetailId
   (required for booking_* refTypes — the AccTravelBookingDetail row's Id, used as RefId), one or
   more "files" entries. idcard: owner-only while Draft/Returned. booking_*: account-area only while
   ManagerApproved. Each file goes through the AP-1 3-step (placeholder row → SharePoint upload →
   finalize row), formCode AP-17. */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { id } = await params;
  const requestId = Number(id);
  if (Number.isNaN(requestId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid id" },
      { status: 400 },
    );
  }

  try {
    const formData = await req.formData();

    const refType = formData.get("refType") as string | null;
    if (!refType || !REFTYPE_VALUES.has(refType)) {
      return NextResponse.json(
        { ok: false, error: "Invalid refType" },
        { status: 400 },
      );
    }

    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No file provided" },
        { status: 400 },
      );
    }
    for (const file of files) {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        return NextResponse.json(
          { ok: false, error: "รองรับเฉพาะไฟล์รูปภาพหรือ PDF" },
          { status: 400 },
        );
      }
    }

    const pool = await getAccPool();

    const reqCheck = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(`SELECT r.Status, r.CreatedBy, r.RequestNo, t.Id AS TravelBookingId
              FROM [dbo].[AccRequest] r
              INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
              WHERE r.Id = @requestId AND r.FormCode = @form`);
    if (reqCheck.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Request not found" },
        { status: 404 },
      );
    }
    const reqRow = reqCheck.recordset[0] as {
      Status: string;
      CreatedBy: number | null;
      RequestNo: string | null;
      TravelBookingId: number;
    };
    const requestNo = reqRow.RequestNo ?? null;

    let refId: number;
    let typeLabel: string;

    if (refType === FILE_REFTYPES.ID_CARD) {
      // Owner-only, while the request is still an editable draft.
      if (reqRow.CreatedBy !== userId) {
        return NextResponse.json(
          { ok: false, error: "ไม่มีสิทธิ์แก้ไขคำขอนี้" },
          { status: 403 },
        );
      }
      if (reqRow.Status !== "Draft" && reqRow.Status !== "Returned") {
        return NextResponse.json(
          { ok: false, error: "แนบไฟล์ได้เฉพาะคำขอที่เป็นฉบับร่างเท่านั้น" },
          { status: 400 },
        );
      }
      refId = requestId;
      typeLabel = refType;
    } else {
      // booking_room / booking_ticket / booking_rent — Admin fill-in, account-area only.
      const loginEmail = resolveLoginEmail(session.user, null, {
        email: session.user.email,
      });
      if (!(await canAccessAccountArea(loginEmail, session.user.role))) {
        return NextResponse.json(
          { ok: false, error: "Forbidden" },
          { status: 403 },
        );
      }
      if (reqRow.Status !== "ManagerApproved") {
        return NextResponse.json(
          {
            ok: false,
            error: "แนบไฟล์การจองได้เฉพาะคำขอที่ผู้จัดการอนุมัติแล้วเท่านั้น",
          },
          { status: 400 },
        );
      }
      const bookingDetailIdRaw = formData.get("bookingDetailId");
      const bookingDetailId = bookingDetailIdRaw
        ? Number(bookingDetailIdRaw)
        : NaN;
      if (!bookingDetailId || Number.isNaN(bookingDetailId)) {
        return NextResponse.json(
          { ok: false, error: "bookingDetailId is required" },
          { status: 400 },
        );
      }
      const detailCheck = await pool
        .request()
        .input("id", sql.Int, bookingDetailId)
        .input("tbid", sql.Int, reqRow.TravelBookingId)
        .query(
          `SELECT BookingType FROM [dbo].[AccTravelBookingDetail] WHERE Id=@id AND TravelBookingId=@tbid`,
        );
      if (detailCheck.recordset.length === 0) {
        return NextResponse.json(
          { ok: false, error: "ไม่พบรายการจองที่ระบุ" },
          { status: 400 },
        );
      }
      const bookingType = detailCheck.recordset[0].BookingType as BookingType;
      if (BOOKING_TYPE_BY_REFTYPE[refType] !== bookingType) {
        return NextResponse.json(
          { ok: false, error: "ประเภทไฟล์ไม่ตรงกับรายการจอง" },
          { status: 400 },
        );
      }
      refId = bookingDetailId;
      typeLabel = refType;
    }

    const created: TravelBookingFileMeta[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const contentType = file.type || "application/octet-stream";

      // 1) Insert a placeholder row to allocate the file id (used in the SharePoint filename).
      const insertRes = await pool
        .request()
        .input("requestId", sql.Int, requestId)
        .input("refType", sql.NVarChar(50), refType)
        .input("refId", sql.Int, refId)
        .input("fileName", sql.NVarChar(500), file.name)
        .input("fileSize", sql.Int, file.size)
        .input("contentType", sql.NVarChar(200), contentType)
        .input("uploadedBy", sql.Int, userId)
        .query(
          `INSERT INTO AccRequestFile
             (RequestId, RefType, RefId, FileName, FileSize, ContentType, StoragePath, StorageBackend, UploadedBy, UploadedAt)
           VALUES
             (@requestId, @refType, @refId, @fileName, @fileSize, @contentType, '', 'pending', @uploadedBy, GETDATE());
           SELECT SCOPE_IDENTITY() AS Id;`,
        );
      const newId = Number(insertRes.recordset[0].Id);

      // 2) Store the bytes in SharePoint — no local fallback (files must be shared
      //    across web deployments). Fail loudly if SharePoint is unavailable.
      let storagePath: string;
      try {
        if (!isSharePointConfigured()) {
          throw new Error(
            "SharePoint storage is not configured (set SHAREPOINT_ACC_SITE / SHAREPOINT_ACC_FOLDER)",
          );
        }
        const folderPath = buildAccFolderPath({
          requestNo,
          requestId,
          year: null,
          formCode: AP17_FORM_CODE,
          environment: await resolveFormEnvironment(),
        });
        const filename = buildAccFileName({
          typeLabel,
          requestNo,
          requestId,
          fileId: newId,
          originalName: file.name,
        });
        const { itemId } = await uploadFileToSharePoint(
          folderPath,
          filename,
          buffer,
          contentType,
        );
        storagePath = itemId;
      } catch (storageErr) {
        // Roll back the placeholder row so we never keep an orphan record.
        await pool
          .request()
          .input("id", sql.Int, newId)
          .query(`DELETE FROM AccRequestFile WHERE Id = @id`)
          .catch(() => {});
        console.error(
          "POST .../travel-booking/requests/[id]/files storage error:",
          storageErr,
        );
        return NextResponse.json(
          {
            ok: false,
            error: "อัปโหลดไฟล์ขึ้น SharePoint ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
          },
          { status: 502 },
        );
      }

      // 3) Finalize the row (SharePoint backend, StoragePath = Graph driveItem id).
      await pool
        .request()
        .input("id", sql.Int, newId)
        .input("storagePath", sql.NVarChar(1000), storagePath)
        .query(
          `UPDATE AccRequestFile SET StoragePath = @storagePath, StorageBackend = 'sharepoint' WHERE Id = @id`,
        );

      created.push({
        id: newId,
        refType,
        refId,
        fileName: file.name,
        fileSize: file.size,
        contentType,
      });
    }

    return NextResponse.json({ ok: true, data: created });
  } catch (err) {
    console.error(
      "POST /api/request/travel-booking/requests/[id]/files error:",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── DELETE /api/request/travel-booking/requests/[id]/files?fileId= ── */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { id } = await params;
  const requestId = Number(id);
  if (Number.isNaN(requestId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid id" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const fileId = Number(searchParams.get("fileId"));
  if (!fileId) {
    return NextResponse.json(
      { ok: false, error: "fileId is required" },
      { status: 400 },
    );
  }

  try {
    const pool = await getAccPool();

    const reqCheck = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(
        `SELECT Status, CreatedBy FROM AccRequest WHERE Id = @requestId AND FormCode = @form`,
      );
    if (reqCheck.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Request not found" },
        { status: 404 },
      );
    }
    const reqRow = reqCheck.recordset[0] as {
      Status: string;
      CreatedBy: number | null;
    };

    const fileRes = await pool
      .request()
      .input("id", sql.Int, fileId)
      .input("requestId", sql.Int, requestId)
      .query(
        `SELECT Id, RefType, StoragePath, StorageBackend FROM AccRequestFile WHERE Id = @id AND RequestId = @requestId`,
      );
    if (fileRes.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "File not found" },
        { status: 404 },
      );
    }
    const fileRow = fileRes.recordset[0] as {
      Id: number;
      RefType: string;
      StoragePath: string;
      StorageBackend: string;
    };

    if (fileRow.RefType === FILE_REFTYPES.ID_CARD) {
      if (reqRow.CreatedBy !== userId) {
        return NextResponse.json(
          { ok: false, error: "ไม่มีสิทธิ์แก้ไขคำขอนี้" },
          { status: 403 },
        );
      }
      if (reqRow.Status !== "Draft" && reqRow.Status !== "Returned") {
        return NextResponse.json(
          { ok: false, error: "ลบรูปได้เฉพาะคำขอที่เป็นฉบับร่างเท่านั้น" },
          { status: 400 },
        );
      }
    } else {
      const loginEmail = resolveLoginEmail(session.user, null, {
        email: session.user.email,
      });
      if (!(await canAccessAccountArea(loginEmail, session.user.role))) {
        return NextResponse.json(
          { ok: false, error: "Forbidden" },
          { status: 403 },
        );
      }
      if (reqRow.Status !== "ManagerApproved") {
        return NextResponse.json(
          {
            ok: false,
            error: "ลบไฟล์การจองได้เฉพาะคำขอที่ผู้จัดการอนุมัติแล้วเท่านั้น",
          },
          { status: 400 },
        );
      }
    }

    // Remove from storage (best-effort)
    if (fileRow.StorageBackend === "sharepoint") {
      await deleteFileFromSharePoint(fileRow.StoragePath);
    } else {
      await deleteFile(fileRow.StoragePath);
    }

    // Remove DB row
    await pool
      .request()
      .input("id", sql.Int, fileId)
      .query(`DELETE FROM AccRequestFile WHERE Id = @id`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "DELETE /api/request/travel-booking/requests/[id]/files error:",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
