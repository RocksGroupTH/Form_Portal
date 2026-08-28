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
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { checkAttachment, checkAttachmentBatch } from "@/lib/acc/attachment-guard";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";
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

  // Owner + editable state, before anything is read off the wire. The route
  // used to check only that the AccRequest row existed, so any authenticated
  // session could attach a file to anyone's request in any status. "mutate"
  // matches what the form already does on the client — `FileArea` is read-only
  // once the claim leaves Draft/Returned.
  const gate = await authorizeAccRequest(session, requestId, "mutate", AP3_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }
    // Kept as the first-pass message for somebody who picked the wrong thing in
    // the file dialog. It is **not** the admission decision — `file.type` is a
    // string the caller writes — and it is deliberately not narrowed either,
    // since it is what this slot has accepted for months.
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
    if (!isImage && !isPdf) {
      return NextResponse.json(
        { ok: false, error: "แนบได้เฉพาะไฟล์รูปภาพหรือ PDF" },
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

    // The bytes decide, not `file.type`. `"any"` switches off the *kind* check
    // and nothing else — this slot has taken whatever the browser labelled
    // `image/*` since it shipped, and narrowing it to the sniff allowlist would
    // start refusing real work (a BMP or TIFF receipt, a phone's HEIC). The
    // empty-file and size limits still apply, the bytes are still sniffed, and
    // it is the **sniffed** type that gets stored, so an HTML or SVG payload is
    // `application/octet-stream` with `inlineSafe: false`.
    // `attachmentResponseHeaders` re-sniffs on download and reaches the same
    // verdict, serving it as `attachment` under `nosniff` and a
    // `default-src 'none'; sandbox` CSP. **That is the control here.**
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
      // The sniffed type, matching what was stored and what the download route
      // will re-derive — not the browser's claim.
      contentType,
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

  // Creator + Draft/Returned, in one place and pinned to AP-3. The old check was
  // the status alone, so any authenticated session could delete the evidence off
  // a draft that was not theirs.
  const gate = await authorizeAccRequest(session, requestId, "mutate", AP3_FORM_CODE);
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
