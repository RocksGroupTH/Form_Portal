import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import {
  isSharePointConfigured,
  uploadFileToSharePoint,
  deleteFileFromSharePoint,
} from "@/lib/sharepoint";
import { buildAccFolderPath, buildAccFileName } from "@/lib/acc/sharepoint-path";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { checkAttachment, checkAttachmentBatch } from "@/lib/acc/attachment-guard";
import { deleteStoredFile } from "@/lib/acc/stored-file";
import {
  AP11_FORM_CODE,
  REWARD_ALLOWED_ATTACHMENT_KINDS,
  REWARD_FILE_REFTYPE,
} from "@/features/reward/constants";

/* ── POST /api/request/reward/requests/[id]/files — attach evidence ── */

/**
 * Brief §5: a screenshot of the activity or the token redemption. AP-11 takes
 * images and PDF — the same pair AP-17 accepts, and wider than AP-1, whose
 * attachments are receipt photographs only.
 *
 * `File.type` is a hint and nothing more; the magic bytes decide, via
 * `checkAttachment`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const requestId = Number((await params).id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // Creator, Draft/Returned only — before a single byte is read off the wire.
  const gate = await authorizeAccRequest(session, requestId, "mutate", AP11_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }

    const batchRejection = checkAttachmentBatch([file]);
    if (batchRejection) {
      return NextResponse.json(
        { ok: false, error: batchRejection.error },
        { status: batchRejection.status },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const check = checkAttachment({
      fileName: file.name,
      declaredType: file.type,
      bytes: buffer,
      allowedKinds: [...REWARD_ALLOWED_ATTACHMENT_KINDS],
    });
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
    }
    const contentType = check.type.contentType;

    const pool = await getAccPool();
    const requestNo: string | null = await pool
      .request()
      .input("id", sql.Int, requestId)
      .query(`SELECT RequestNo FROM [dbo].[AccRequest] WHERE Id = @id`)
      .then((r) => r.recordset[0]?.RequestNo ?? null);

    // 1) Placeholder row, to allocate the file id used in the stored filename.
    const insertRes = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("refType", sql.NVarChar(50), REWARD_FILE_REFTYPE)
      .input("fileName", sql.NVarChar(500), file.name)
      .input("fileSize", sql.Int, buffer.length)
      .input("contentType", sql.NVarChar(200), contentType)
      .input("uploadedBy", sql.Int, userId)
      .query(
        `INSERT INTO [dbo].[AccRequestFile]
           (RequestId, RefType, RefId, FileName, FileSize, ContentType,
            StoragePath, StorageBackend, UploadedBy, UploadedAt)
         VALUES (@requestId, @refType, NULL, @fileName, @fileSize, @contentType,
                 '', 'pending', @uploadedBy, SYSDATETIME());
         SELECT SCOPE_IDENTITY() AS Id;`,
      );
    const newId = Number(insertRes.recordset[0].Id);

    // 2) Store the bytes. No local fallback — files must be reachable from every
    //    web deployment, so a missing SharePoint configuration fails loudly.
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
        typeLabel: "เอกสารเบิกของรางวัล",
        requestNo,
        requestId,
        fileId: newId,
        originalName: file.name,
        extension: check.type.extension,
      });
      const { itemId } = await uploadFileToSharePoint(folderPath, filename, buffer, contentType);
      storagePath = itemId;
    } catch (storageErr) {
      await pool
        .request()
        .input("id", sql.Int, newId)
        .query(`DELETE FROM [dbo].[AccRequestFile] WHERE Id = @id`)
        .catch(() => {});
      console.error("[api/request/reward/.../files] storage error", storageErr);
      return NextResponse.json(
        { ok: false, error: "อัปโหลดไฟล์ขึ้น SharePoint ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
        { status: 502 },
      );
    }

    // 3) Finalize. A failure here would leave a stored object nothing points at,
    //    so the object goes before the error is reported.
    try {
      await pool
        .request()
        .input("id", sql.Int, newId)
        .input("storagePath", sql.NVarChar(1000), storagePath)
        .query(
          `UPDATE [dbo].[AccRequestFile]
              SET StoragePath = @storagePath, StorageBackend = 'sharepoint'
            WHERE Id = @id`,
        );
    } catch (finalizeErr) {
      await deleteFileFromSharePoint(storagePath).catch(() => {});
      await pool
        .request()
        .input("id", sql.Int, newId)
        .query(`DELETE FROM [dbo].[AccRequestFile] WHERE Id = @id`)
        .catch(() => {});
      throw finalizeErr;
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: newId,
        fileName: file.name,
        fileSize: buffer.length,
        contentType,
        url: `/api/request/reward/files/${newId}`,
      },
    });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]/files] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/* ── DELETE /api/request/reward/requests/[id]/files?fileId= ── */

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const requestId = Number((await params).id);
  const fileId = Number(new URL(req.url).searchParams.get("fileId"));
  if (!Number.isInteger(requestId) || requestId <= 0 || !Number.isInteger(fileId) || fileId <= 0) {
    return NextResponse.json({ ok: false, error: "fileId is required" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, requestId, "mutate", AP11_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const pool = await getAccPool();
    // Joined to the parent and to AP-11's RefType: a file id from another
    // request, or from another form, matches nothing.
    const result = await pool
      .request()
      .input("id", sql.Int, fileId)
      .input("requestId", sql.Int, requestId)
      .input("ref", sql.NVarChar, REWARD_FILE_REFTYPE)
      .query(
        `SELECT Id, StoragePath, StorageBackend FROM [dbo].[AccRequestFile]
          WHERE Id = @id AND RequestId = @requestId AND RefType = @ref`,
      );
    if (result.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const row = result.recordset[0] as { StoragePath: string; StorageBackend: string };

    // Backend-dispatching, so a SharePoint driveItem id is never handed to
    // `fs.unlink` — and the row is kept if the bytes could not be removed, so a
    // failure leaves something pointing at the orphan.
    const failure = await deleteStoredFile({
      storagePath: row.StoragePath,
      storageBackend: row.StorageBackend,
    });
    if (failure) {
      return NextResponse.json(
        { ok: false, error: "ลบไฟล์จากที่จัดเก็บไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
        { status: 502 },
      );
    }

    await pool
      .request()
      .input("id", sql.Int, fileId)
      .query(`DELETE FROM [dbo].[AccRequestFile] WHERE Id = @id`);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]/files] DELETE", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
