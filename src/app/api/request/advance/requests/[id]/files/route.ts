import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAccPool, sql } from "@/lib/adv/pool";
import { buildAccFolderPath, buildAccFileName } from "@/lib/acc/sharepoint-path";
import { isSharePointConfigured, uploadFileToSharePoint } from "@/lib/sharepoint";
import { uploadFile } from "@/lib/storage";
import { AP2_FORM_CODE } from "@/features/advance/constants";
import {
  AP2_FILE_REFTYPE,
  AP2_MAX_FILE_BYTES,
  listAdvanceFiles,
} from "@/lib/adv/advance-file-service";

/* ── GET /api/request/advance/requests/[id]/files — list attachments ── */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { id } = await params;
  const requestId = Number(id);
  if (Number.isNaN(requestId)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, data: await listAdvanceFiles(requestId) });
  } catch (e) {
    console.error("[advance/files] GET", e);
    return NextResponse.json({ ok: false, error: "error" }, { status: 500 });
  }
}

/* ── POST /api/request/advance/requests/[id]/files ──
   multipart "files" (image/* หรือ PDF, ≤4MB). Owner-only ขณะ Draft/Returned.
   3-step: placeholder row → SharePoint (fallback local) → finalize. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);

  const { id } = await params;
  const requestId = Number(id);
  if (Number.isNaN(requestId)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "ไม่พบไฟล์" }, { status: 400 });
  }
  for (const f of files) {
    if (!f.type.startsWith("image/") && f.type !== "application/pdf") {
      return NextResponse.json({ ok: false, error: "รองรับเฉพาะไฟล์รูปภาพหรือ PDF" }, { status: 400 });
    }
    if (f.size > AP2_MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: "ไฟล์ใหญ่เกิน 4MB" }, { status: 400 });
    }
  }

  const pool = await getAccPool();
  const reqCheck = await pool.request()
    .input("rid", sql.Int, requestId).input("form", sql.NVarChar, AP2_FORM_CODE)
    .query(`SELECT Status, CreatedBy, RequestNo FROM [dbo].[AccRequest] WHERE Id=@rid AND FormCode=@form`);
  if (reqCheck.recordset.length === 0) {
    return NextResponse.json({ ok: false, error: "ไม่พบคำขอ" }, { status: 404 });
  }
  const reqRow = reqCheck.recordset[0] as { Status: string; CreatedBy: number | null; RequestNo: string | null };
  if (reqRow.CreatedBy !== userId) {
    return NextResponse.json({ ok: false, error: "แนบไฟล์ได้เฉพาะเจ้าของคำขอ" }, { status: 403 });
  }
  if (reqRow.Status !== "Draft" && reqRow.Status !== "Returned") {
    return NextResponse.json({ ok: false, error: "แนบไฟล์ได้เฉพาะฉบับร่าง" }, { status: 400 });
  }

  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const contentType = file.type || "application/octet-stream";

      const ins = await pool.request()
        .input("rid", sql.Int, requestId).input("rt", sql.NVarChar(50), AP2_FILE_REFTYPE)
        .input("refId", sql.Int, requestId).input("name", sql.NVarChar(500), file.name)
        .input("size", sql.Int, file.size).input("ct", sql.NVarChar(200), contentType)
        .input("by", sql.Int, userId)
        .query(`INSERT INTO AccRequestFile
                  (RequestId, RefType, RefId, FileName, FileSize, ContentType, StoragePath, StorageBackend, UploadedBy, UploadedAt)
                VALUES (@rid, @rt, @refId, @name, @size, @ct, '', 'pending', @by, SYSDATETIME());
                SELECT SCOPE_IDENTITY() AS Id;`);
      const newId = Number(ins.recordset[0].Id);

      const folderPath = buildAccFolderPath({
        requestNo: reqRow.RequestNo, requestId, year: null, formCode: AP2_FORM_CODE, environment: "UAT",
      });
      const filename = buildAccFileName({
        typeLabel: AP2_FILE_REFTYPE, requestNo: reqRow.RequestNo, requestId, fileId: newId, originalName: file.name,
      });

      try {
        let storagePath: string;
        let backend: string;
        if (isSharePointConfigured()) {
          const { itemId } = await uploadFileToSharePoint(folderPath, filename, buffer, contentType);
          storagePath = itemId; backend = "sharepoint";
        } else {
          storagePath = await uploadFile(`${folderPath}/${filename}`, buffer); backend = "storage";
        }
        await pool.request().input("id", sql.Int, newId)
          .input("sp", sql.NVarChar(1000), storagePath).input("be", sql.NVarChar(20), backend)
          .query(`UPDATE AccRequestFile SET StoragePath=@sp, StorageBackend=@be WHERE Id=@id`);
      } catch (storageErr) {
        await pool.request().input("id", sql.Int, newId).query(`DELETE FROM AccRequestFile WHERE Id=@id`).catch(() => {});
        console.error("[advance/files] upload storage error", storageErr);
        return NextResponse.json({ ok: false, error: "อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่" }, { status: 502 });
      }
    }
    return NextResponse.json({ ok: true, data: await listAdvanceFiles(requestId) });
  } catch (e) {
    console.error("[advance/files] POST", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
