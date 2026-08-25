import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { deleteFile } from "@/lib/storage";
import {
  isSharePointConfigured,
  uploadFileToSharePoint,
  deleteFileFromSharePoint,
} from "@/lib/sharepoint";
import { buildAccFolderPath, buildAccFileName } from "@/lib/acc/sharepoint-path";
import { resolveFormEnvironment } from "@/lib/form-environment";
import type { AccFileMeta } from "@/features/accounting/types";

/* ── POST /api/request/clear-advance/requests/[id]/files — attach a receipt/tax invoice ── */

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
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
    if (!isImage && !isPdf) {
      return NextResponse.json(
        { ok: false, error: "แนบได้เฉพาะไฟล์รูปภาพหรือ PDF" },
        { status: 400 },
      );
    }

    // refType distinguishes receipts (clear_doc) from refund-transfer proof (refund_proof).
    const refTypeRaw = (formData.get("refType") as string | null) ?? "clear_doc";
    const refType = refTypeRaw === "refund_proof" ? "refund_proof" : "clear_doc";
    const typeLabel = refType === "refund_proof" ? "หลักฐานการโอนคืน" : "ใบเสร็จ";

    const pool = await getAccPool();
    const reqCheck = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .query(`SELECT Id, RequestNo FROM AccRequest WHERE Id = @requestId`);
    if (reqCheck.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
    }
    const requestNo: string | null = reqCheck.recordset[0].RequestNo ?? null;

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    const insertRes = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("refType", sql.NVarChar(50), refType)
      .input("refId", sql.Int, null)
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
      const { itemId } = await uploadFileToSharePoint(folderPath, filename, buffer, contentType);
      storagePath = itemId;
    } catch (storageErr) {
      await pool
        .request()
        .input("id", sql.Int, newId)
        .query(`DELETE FROM AccRequestFile WHERE Id = @id`)
        .catch(() => {});
      console.error("POST clear-advance/.../files storage error:", storageErr);
      return NextResponse.json(
        { ok: false, error: "อัปโหลดไฟล์ขึ้น SharePoint ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
        { status: 502 },
      );
    }

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
      url: `/api/request/clear-advance/files/${newId}`,
    };

    return NextResponse.json({ ok: true, data: meta });
  } catch (err) {
    console.error("POST /api/request/clear-advance/requests/[id]/files error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/* ── DELETE /api/request/clear-advance/requests/[id]/files?fileId= ── */

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
    return NextResponse.json({ ok: false, error: "fileId is required" }, { status: 400 });
  }

  try {
    const pool = await getAccPool();

    const statusCheck = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .query(`SELECT Status FROM AccRequest WHERE Id = @requestId`);
    if (statusCheck.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
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
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const row = result.recordset[0];
    if (row.StorageBackend === "sharepoint") {
      await deleteFileFromSharePoint(row.StoragePath);
    } else {
      await deleteFile(row.StoragePath);
    }

    await pool
      .request()
      .input("id", sql.Int, fileId)
      .query(`DELETE FROM AccRequestFile WHERE Id = @id`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/request/clear-advance/requests/[id]/files error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
