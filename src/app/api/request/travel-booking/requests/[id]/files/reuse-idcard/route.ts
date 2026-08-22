import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { getSetting } from "@/lib/acc/settings-service";
import {
  decideIdCardRead,
  parseConsentSetting,
} from "@/lib/acc/travel-booking/id-card-access";
import { downloadFile } from "@/lib/storage";
import {
  isSharePointConfigured,
  uploadFileToSharePoint,
  downloadFileFromSharePoint,
} from "@/lib/sharepoint";
import { buildAccFolderPath, buildAccFileName } from "@/lib/acc/sharepoint-path";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { AP17_FORM_CODE, FILE_REFTYPES, idCardReuseConsentKey } from "@/features/travel-booking/constants";
import type { TravelBookingFileMeta } from "@/features/travel-booking/types";

/**
 * POST /api/request/travel-booking/requests/[id]/files/reuse-idcard   body: { sourceFileId }
 *
 * Copies the caller's own previously-uploaded ID card onto the current draft.
 * The file is duplicated independently in storage — the current request never
 * shares the source's storage item.
 *
 * Four conditions, all server-side: the caller owns the current (Draft/Returned)
 * request; the current request's requester is the caller themself; the source is
 * an ID-card file of that same requester; and the requester has granted reuse
 * consent.
 *
 * The last two are new. The route checked only that the source's StaffId matched
 * the *current request's* StaffId — and an on-behalf draft carries the
 * colleague's StaffId, so anyone in the same department could open a draft for
 * a colleague and copy that colleague's stored national-ID scan onto it, with
 * no consent check anywhere on the path. See
 * `@/lib/acc/travel-booking/id-card-access` for why department membership is
 * not consent.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  // Tester-only on a UAT record, before any of it is read. See `uatActorGate`.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;
  const userId = Number(session.user.id);

  const { id } = await params;
  const requestId = Number(id);
  if (Number.isNaN(requestId)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = (await req.json()) as { sourceFileId?: number };
    const sourceFileId = Number(body.sourceFileId);
    if (!sourceFileId) {
      return NextResponse.json({ ok: false, error: "sourceFileId is required" }, { status: 400 });
    }

    const pool = await getAccPool();

    // Current request — owner + editable draft, and its requester StaffId.
    const curRes = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(`SELECT r.Status, r.CreatedBy, r.RequestNo, r.StaffId
              FROM [dbo].[AccRequest] r
              INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
              WHERE r.Id = @requestId AND r.FormCode = @form`);
    if (curRes.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
    }
    const cur = curRes.recordset[0] as {
      Status: string; CreatedBy: number | null; RequestNo: string | null; StaffId: number | null;
    };
    if (cur.CreatedBy !== userId) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์แก้ไขคำขอนี้" }, { status: 403 });
    }
    if (cur.Status !== "Draft" && cur.Status !== "Returned") {
      return NextResponse.json(
        { ok: false, error: "แนบไฟล์ได้เฉพาะคำขอที่เป็นฉบับร่างเท่านั้น" },
        { status: 400 },
      );
    }
    if (!cur.StaffId) {
      return NextResponse.json({ ok: false, error: "คำขอนี้ยังไม่มีผู้ขอเบิก" }, { status: 400 });
    }

    // The requester on this draft must be the caller, and they must have said
    // yes. Owning the draft is not enough — an on-behalf draft names somebody
    // else as requester, which is exactly the case this closes.
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const actor = loginEmail ? (await findActiveEmployeeByEmail(loginEmail)).employee : null;
    const actorStaffId = actor?.staffId ?? null;
    const consent =
      actorStaffId == null
        ? null
        : parseConsentSetting(await getSetting(idCardReuseConsentKey(actorStaffId)));
    const verdict = decideIdCardRead({
      actorStaffId,
      subjectStaffId: cur.StaffId,
      consent,
    });
    if (!verdict.ok) {
      return NextResponse.json({ ok: false, error: verdict.error }, { status: verdict.status });
    }

    // Source file — must be an ID card belonging to the same requester (StaffId).
    const srcRes = await pool
      .request()
      .input("fid", sql.Int, sourceFileId)
      .input("reftype", sql.NVarChar, FILE_REFTYPES.ID_CARD)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(`SELECT f.StoragePath, f.StorageBackend, f.FileName, f.FileSize, f.ContentType, r.StaffId AS SrcStaffId
              FROM [dbo].[AccRequestFile] f
              INNER JOIN [dbo].[AccRequest] r ON r.Id = f.RequestId
              WHERE f.Id = @fid AND f.RefType = @reftype AND r.FormCode = @form`);
    if (srcRes.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "ไม่พบบัตรที่เลือก" }, { status: 404 });
    }
    const src = srcRes.recordset[0] as {
      StoragePath: string; StorageBackend: string; FileName: string; FileSize: number | null;
      ContentType: string | null; SrcStaffId: number | null;
    };
    if (src.SrcStaffId !== cur.StaffId) {
      return NextResponse.json(
        { ok: false, error: "บัตรที่เลือกไม่ใช่ของผู้ขอเบิกคนนี้" },
        { status: 403 },
      );
    }

    // Read the source bytes.
    const buffer =
      src.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(src.StoragePath)
        : await downloadFile(src.StoragePath);
    const contentType = src.ContentType || "application/octet-stream";

    // 1) Placeholder row to allocate the new file id.
    const insertRes = await pool
      .request()
      .input("requestId", sql.Int, requestId)
      .input("refType", sql.NVarChar(50), FILE_REFTYPES.ID_CARD)
      .input("refId", sql.Int, requestId)
      .input("fileName", sql.NVarChar(500), src.FileName)
      .input("fileSize", sql.Int, src.FileSize ?? buffer.length)
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

    // 2) Store the copy in SharePoint (no local fallback — must be shared across deployments).
    let storagePath: string;
    try {
      if (!isSharePointConfigured()) {
        throw new Error("SharePoint storage is not configured");
      }
      const folderPath = buildAccFolderPath({
        requestNo: cur.RequestNo ?? null, requestId, year: null, formCode: AP17_FORM_CODE,
        // Matches the sibling upload route. Without it a UAT request's ID-card
        // copy was written into the live SharePoint tree while its
        // AccRequestFile row went to Rocks_Portal_Form_UAT.
        environment: await resolveFormEnvironment(),
      });
      const filename = buildAccFileName({
        typeLabel: FILE_REFTYPES.ID_CARD, requestNo: cur.RequestNo ?? null, requestId,
        fileId: newId, originalName: src.FileName,
      });
      const { itemId } = await uploadFileToSharePoint(folderPath, filename, buffer, contentType);
      storagePath = itemId;
    } catch (storageErr) {
      await pool.request().input("id", sql.Int, newId)
        .query(`DELETE FROM AccRequestFile WHERE Id = @id`).catch(() => {});
      console.error("[reuse-idcard] storage error:", storageErr);
      return NextResponse.json(
        { ok: false, error: "คัดลอกไฟล์บัตรไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
        { status: 502 },
      );
    }

    // 3) Finalize the row.
    await pool
      .request()
      .input("id", sql.Int, newId)
      .input("storagePath", sql.NVarChar(1000), storagePath)
      .query(`UPDATE AccRequestFile SET StoragePath = @storagePath, StorageBackend = 'sharepoint' WHERE Id = @id`);

    const created: TravelBookingFileMeta = {
      id: newId,
      refType: FILE_REFTYPES.ID_CARD,
      refId: requestId,
      fileName: src.FileName,
      fileSize: src.FileSize ?? buffer.length,
      contentType,
    };
    return NextResponse.json({ ok: true, data: created });
  } catch (err) {
    console.error("[reuse-idcard] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
