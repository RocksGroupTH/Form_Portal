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
import {
  checkAttachment,
  checkAttachmentBatch,
  type AttachmentKind,
} from "@/lib/acc/attachment-guard";
import { deleteStoredFiles } from "@/lib/acc/stored-file";
import { AP4_FORM_CODE, REIMBURSE_FILE_REFTYPES } from "@/features/reimburse/constants";
import type { ReimburseFileMeta } from "@/features/reimburse/types";

/* ── POST /api/request/reimburse/requests/[id]/files ──
   multipart: refType (reimburse_excel | reimburse_receipt), one or more "files"
   entries. Each file goes through AP-1's 3-step (placeholder row → SharePoint
   upload → finalize row), under formCode AP-4 so the bytes land in the AP-4
   tree rather than AP-1's.

   AP-4 has two slots and they take different things:

   - `reimburse_excel` — the AP-4.1 summary workbook. Exactly one, replacing
     whatever was there, and `AccReimburse.ExcelFileId` is the pointer the
     submit gate reads to decide the workbook exists at all.
   - `reimburse_receipt` — receipts and tax invoices. Many, images or PDFs.

   `RefId` is the request id for both: AP-4's attachments hang off the request,
   not off an expense line the way AP-1's receipts hang off an item. */

/** Which kinds each slot admits. The workbook kind exists nowhere else. */
const ALLOWED_KINDS_BY_REFTYPE: Record<string, readonly AttachmentKind[]> = {
  [REIMBURSE_FILE_REFTYPES.EXCEL]: ["spreadsheet"],
  [REIMBURSE_FILE_REFTYPES.RECEIPT]: ["image", "pdf"],
};

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
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // Owner + editable state, before anything is read off the wire, and before a
  // single byte is buffered. Pinned to AP-4 so an id belonging to another form
  // cannot have files filed against it through this URL.
  const gate = await authorizeAccRequest(session, requestId, "mutate", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const formData = await req.formData();

    const refType = formData.get("refType") as string | null;
    const allowedKinds = refType ? ALLOWED_KINDS_BY_REFTYPE[refType] : undefined;
    if (!refType || !allowedKinds) {
      return NextResponse.json({ ok: false, error: "Invalid refType" }, { status: 400 });
    }
    const isExcel = refType === REIMBURSE_FILE_REFTYPES.EXCEL;

    const files = formData.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }
    if (isExcel && files.length > 1) {
      return NextResponse.json(
        { ok: false, error: "แนบไฟล์ Excel สรุปรายการได้ครั้งละ 1 ไฟล์เท่านั้น" },
        { status: 400 },
      );
    }

    const batchRejection = checkAttachmentBatch(files);
    if (batchRejection) {
      return NextResponse.json(
        { ok: false, error: batchRejection.error },
        { status: batchRejection.status },
      );
    }

    // Read and validate every file before storing any of them, so a batch whose
    // second file is rejected does not leave the first one filed. The bytes
    // decide the type — `file.type` is caller-written — and the slot decides
    // which types are acceptable, so a workbook cannot be filed as a receipt
    // nor a photo as the summary sheet.
    const accepted: { file: File; buffer: Buffer; contentType: string; extension: string }[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const check = checkAttachment({
        fileName: file.name,
        declaredType: file.type,
        bytes: buffer,
        allowedKinds,
      });
      if (!check.ok) {
        return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
      }
      accepted.push({
        file,
        buffer,
        contentType: check.type.contentType,
        extension: check.type.extension,
      });
    }

    const pool = await getAccPool();
    const requestNo: string | null = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .query(`SELECT RequestNo FROM [dbo].[AccRequest] WHERE Id = @requestId`)
      .then((r) => r.recordset[0]?.RequestNo ?? null);

    // The workbook this upload replaces, read before anything is written. Its
    // bytes are removed only once the new one is stored and pointed at, so a
    // failure part-way leaves the request with its old workbook rather than
    // with none — which would fail the submit gate on a request that had one.
    let supersededExcel: { Id: number; StoragePath: string | null; StorageBackend: string | null }[] = [];
    if (isExcel) {
      const prior = await pool
        .request()
        .input("rid", sql.Int, requestId)
        .input("t", sql.NVarChar(50), REIMBURSE_FILE_REFTYPES.EXCEL)
        .query(
          `SELECT Id, StoragePath, StorageBackend
           FROM [dbo].[AccRequestFile] WHERE RequestId = @rid AND RefType = @t`,
        );
      supersededExcel = prior.recordset as typeof supersededExcel;
    }

    const created: ReimburseFileMeta[] = [];

    for (const { file, buffer, contentType, extension } of accepted) {
      // 1) Insert a placeholder row to allocate the file id (used in the SharePoint filename).
      const insertRes = await pool
        .request()
        .input("requestId", sql.Int, requestId)
        .input("refType", sql.NVarChar(50), refType)
        .input("refId", sql.Int, requestId)
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
          formCode: AP4_FORM_CODE,
          environment: await resolveFormEnvironment(),
        });
        const filename = buildAccFileName({
          typeLabel: refType,
          requestNo,
          requestId,
          fileId: newId,
          originalName: file.name,
          extension,
        });
        const { itemId } = await uploadFileToSharePoint(folderPath, filename, buffer, contentType);
        storagePath = itemId;
      } catch (storageErr) {
        // Roll back the placeholder row so we never keep an orphan record.
        await pool
          .request()
          .input("id", sql.Int, newId)
          .query(`DELETE FROM AccRequestFile WHERE Id = @id`)
          .catch(() => {});
        console.error("POST .../reimburse/requests/[id]/files storage error:", storageErr);
        return NextResponse.json(
          { ok: false, error: "อัปโหลดไฟล์ขึ้น SharePoint ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
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

      // 4) The workbook slot is a pointer, not just a row: `AccReimburse.ExcelFileId`
      //    is what the submit gate reads, and `getReimburseRequest` re-checks
      //    that it still belongs to this request. Point it at the new file
      //    before the old one is removed.
      if (isExcel) {
        await pool
          .request()
          .input("rid", sql.Int, requestId)
          .input("fid", sql.Int, newId)
          .query(`UPDATE [dbo].[AccReimburse] SET ExcelFileId = @fid WHERE RequestId = @rid`);

        const stale = supersededExcel.filter((r) => Number(r.Id) !== newId);
        if (stale.length > 0) {
          await pool
            .request()
            .input("rid", sql.Int, requestId)
            .input("t", sql.NVarChar(50), REIMBURSE_FILE_REFTYPES.EXCEL)
            .input("keep", sql.Int, newId)
            .query(
              `DELETE FROM AccRequestFile WHERE RequestId = @rid AND RefType = @t AND Id <> @keep`,
            );
          // After the rows are gone: `deleteStoredFile` dispatches on the
          // backend (a driveItem id is not a filesystem path) and reports what
          // it could not remove instead of swallowing it.
          await deleteStoredFiles(
            stale.map((r) => ({ storagePath: r.StoragePath, storageBackend: r.StorageBackend })),
            `AP-4 workbook replaced on request ${requestId}`,
          );
        }
      }

      created.push({
        id: newId,
        fileName: file.name,
        fileSize: buffer.length,
        contentType,
        url: `/api/request/reimburse/files/${newId}`,
      });
    }

    return NextResponse.json({ ok: true, data: created });
  } catch (err) {
    console.error("POST /api/request/reimburse/requests/[id]/files error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
