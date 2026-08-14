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

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "No file provided" },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { ok: false, error: "แนบได้เฉพาะไฟล์รูปภาพเท่านั้น" },
        { status: 400 },
      );
    }

    const refIdRaw = formData.get("refId") as string | null;
    const refId = refIdRaw ? Number(refIdRaw) || null : null;

    // Verify the AccRequest row exists
    const pool = await getAccPool();
    const reqCheck = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .query(`SELECT Id, RequestNo FROM AccRequest WHERE Id = @requestId`);

    if (reqCheck.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Request not found" },
        { status: 404 },
      );
    }

    const requestNo: string | null = reqCheck.recordset[0].RequestNo ?? null;

    // Resolve the expense type label for the filename (best-effort).
    let typeLabel = "เอกสาร";
    if (refId != null) {
      const itemRes = await pool
        .request()
        .input("itemId", sql.Int, refId)
        .query(`SELECT ItemType FROM AccTravelExpenseItem WHERE Id = @itemId`);
      const it = itemRes.recordset[0]?.ItemType as TravelItemType | undefined;
      if (it && TRAVEL_ITEM_TYPE_LABEL_TH[it])
        typeLabel = TRAVEL_ITEM_TYPE_LABEL_TH[it];
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    // 1) Insert a placeholder row to allocate the file id (used in the SharePoint filename).
    const insertRes = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("refType", sql.NVarChar(50), "travel_item")
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
    await pool
      .request()
      .input("id", sql.Int, newId)
      .input("storagePath", sql.NVarChar(1000), storagePath)
      .query(
        `UPDATE AccRequestFile SET StoragePath = @storagePath, StorageBackend = 'sharepoint' WHERE Id = @id`,
      );

    const meta: AccFileMeta = {
      id: newId,
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || "application/octet-stream",
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

  try {
    const pool = await getAccPool();

    // Files may only be removed while the request is still editable (Draft/Returned).
    const statusCheck = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .query(`SELECT Status FROM AccRequest WHERE Id = @requestId`);
    if (statusCheck.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Request not found" },
        { status: 404 },
      );
    }
    const status = statusCheck.recordset[0].Status as string;
    if (status !== "Draft" && status !== "Returned") {
      return NextResponse.json(
        { ok: false, error: "ลบรูปได้เฉพาะคำขอที่เป็นฉบับร่างเท่านั้น" },
        { status: 400 },
      );
    }

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
