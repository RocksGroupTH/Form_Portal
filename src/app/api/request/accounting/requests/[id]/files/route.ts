import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
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
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { checkAttachment, checkAttachmentBatch } from "@/lib/acc/attachment-guard";
import {
  TRAVEL_ITEM_TYPE_LABEL_TH,
  type TravelItemType,
} from "@/features/accounting/constants";
import type { AccFileMeta } from "@/features/accounting/types";

/* ── POST /api/request/accounting/requests/[id]/files ── */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { id } = await params;
  const requestId = Number(id);

  // Owner + editable state, before anything is read off the wire. The route
  // used to check only that the AccRequest row existed, so any authenticated
  // session could attach a file to anyone's request in any status.
  const gate = await authorizeAccRequest(session, requestId, "mutate");
  if (gate instanceof Response) return gate;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No file provided" },
        { status: 400 },
      );
    }

    const batchRejection = checkAttachmentBatch([file]);
    if (batchRejection) {
      return NextResponse.json(
        { ok: false, error: batchRejection.error },
        { status: batchRejection.status },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // The bytes still decide, not `file.type` — see `attachment-guard`. What
    // changed on 2026-08-26 is that this slot takes **any** file: a claim's
    // evidence is not always a photo, and refusing a PDF invoice or a scanned
    // contract sent people to attach a screenshot of it instead.
    //
    // `"any"` switches off the *kind* check and nothing else. The size and
    // empty-file limits still apply, the bytes are still sniffed — so a real
    // photo is still identified as one and keeps its inline preview — and
    // anything unrecognised becomes `application/octet-stream` with
    // `inlineSafe: false`. `attachmentResponseHeaders` re-sniffs on download and
    // reaches the same verdict, serving it as `attachment` with `nosniff` and a
    // `default-src 'none'; sandbox` CSP, which is what stops a stored SVG or
    // HTML file executing on this origin. **That header logic is the control
    // here — do not relax it.**
    //
    // AP-17's ID-card slot and AP-4's workbook slot keep their narrow lists
    // deliberately: those two read the file rather than merely storing it.
    const check = checkAttachment({
      fileName: file.name,
      declaredType: file.type,
      bytes: buffer,
      allowedKinds: "any",
    });
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
    }
    const contentType = check.type.contentType;

    const refIdRaw = formData.get("refId") as string | null;
    const refId = refIdRaw ? Number(refIdRaw) || null : null;

    const pool = await getAccPool();
    const requestNo: string | null = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .query(`SELECT RequestNo FROM AccRequest WHERE Id = @requestId`)
      .then((r) => r.recordset[0]?.RequestNo ?? null);

    // Resolve the expense type label for the filename — and, more importantly,
    // prove the item belongs to *this* request. The old query looked the item
    // up by id alone, so a refId from someone else's claim was accepted and
    // stored on the row, silently filing the attachment against a foreign item.
    let typeLabel = "เอกสาร";
    if (refId != null) {
      const itemRes = await pool
        .request()
        .input("itemId", sql.Int, refId)
        .input("requestId", sql.Int, requestId)
        .query(`SELECT i.ItemType
                FROM [dbo].[AccTravelExpenseItem] i
                INNER JOIN [dbo].[AccTravelExpense] e ON e.Id = i.TravelExpenseId
                WHERE i.Id = @itemId AND e.RequestId = @requestId`);
      if (itemRes.recordset.length === 0) {
        return NextResponse.json(
          { ok: false, error: "ไม่พบรายการค่าใช้จ่ายในคำขอนี้" },
          { status: 400 },
        );
      }
      const it = itemRes.recordset[0]?.ItemType as TravelItemType | undefined;
      if (it && TRAVEL_ITEM_TYPE_LABEL_TH[it])
        typeLabel = TRAVEL_ITEM_TYPE_LABEL_TH[it];
    }

    // 1) Insert a placeholder row to allocate the file id (used in the SharePoint filename).
    const insertRes = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("refType", sql.NVarChar(50), "travel_item")
      .input("refId", sql.Int, refId)
      .input("fileName", sql.NVarChar(500), file.name)
      .input("fileSize", sql.Int, buffer.length)
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
        environment: await resolveFormEnvironment(),
      });
      const filename = buildAccFileName({
        typeLabel,
        requestNo,
        requestId,
        fileId: newId,
        originalName: file.name,
        extension: check.type.extension,
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
      console.error("POST .../files storage error:", storageErr);
      return NextResponse.json(
        {
          ok: false,
          error: "อัปโหลดไฟล์ขึ้น SharePoint ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        },
        { status: 502 },
      );
    }

    // 3) Finalize the row (SharePoint backend, StoragePath = Graph driveItem id).
    //    A failure here would leave a stored object no row points at, so the
    //    object is removed before the error is reported.
    try {
      await pool
        .request()
        .input("id", sql.Int, newId)
        .input("storagePath", sql.NVarChar(1000), storagePath)
        .query(
          `UPDATE AccRequestFile SET StoragePath = @storagePath, StorageBackend = 'sharepoint' WHERE Id = @id`,
        );
    } catch (finalizeErr) {
      await deleteFileFromSharePoint(storagePath).catch(() => {});
      await pool
        .request()
        .input("id", sql.Int, newId)
        .query(`DELETE FROM AccRequestFile WHERE Id = @id`)
        .catch(() => {});
      throw finalizeErr;
    }

    const meta: AccFileMeta = {
      id: newId,
      fileName: file.name,
      fileSize: buffer.length,
      contentType,
      url: `/api/request/accounting/files/${newId}`,
    };

    return NextResponse.json({ ok: true, data: meta });
  } catch (err) {
    console.error(
      "POST /api/request/accounting/requests/[id]/files error:",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── DELETE /api/request/accounting/requests/[id]/files?fileId= ── */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id } = await params;
  const requestId = Number(id);

  const { searchParams } = new URL(req.url);
  const fileId = Number(searchParams.get("fileId"));

  if (!fileId) {
    return NextResponse.json(
      { ok: false, error: "fileId is required" },
      { status: 400 },
    );
  }

  // Editable state was already checked here; ownership was not, so anyone could
  // delete the attachments off anyone else's draft.
  const gate = await authorizeAccRequest(session, requestId, "mutate");
  if (gate instanceof Response) return gate;

  try {
    const pool = await getAccPool();

    const result = await pool
      .request()
      .input("id", sql.Int, fileId)
      .input("requestId", sql.Int, requestId)
      .query(
        `SELECT Id, StoragePath, StorageBackend FROM AccRequestFile WHERE Id = @id AND RequestId = @requestId`,
      );

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "File not found" },
        { status: 404 },
      );
    }

    const row = result.recordset[0];

    // Remove from storage (best-effort)
    if (row.StorageBackend === "sharepoint") {
      await deleteFileFromSharePoint(row.StoragePath);
    } else {
      await deleteFile(row.StoragePath);
    }

    // Remove DB row
    await pool
      .request()
      .input("id", sql.Int, fileId)
      .query(`DELETE FROM AccRequestFile WHERE Id = @id`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "DELETE /api/request/accounting/requests/[id]/files error:",
      err,
    );
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
