import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { getSetting } from "@/lib/acc/settings-service";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";
import {
  decideIdCardRead,
  parseConsentSetting,
} from "@/lib/acc/travel-booking/id-card-access";
import { AP17_FORM_CODE, FILE_REFTYPES, idCardReuseConsentKey } from "@/features/travel-booking/constants";

/**
 * GET /api/request/travel-booking/id-card/previous/download?requesterStaffId=&fileId=
 *
 * Streams the bytes of the caller's own previously-stored ID card so it can be
 * re-attached to a brand-new trip.
 *
 * Two things changed here. It is self-only — it used to accept any
 * `requesterStaffId` in the caller's department and stream that colleague's
 * national-ID scan. And it checks the consent flag itself: it previously relied
 * on the caller having gone through `id-card/previous` first, which is not a
 * control, so a known or guessed file id worked whatever the subject had
 * answered. See `@/lib/acc/travel-booking/id-card-access`.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const params = new URL(req.url).searchParams;
    const requesterStaffIdRaw = params.get("requesterStaffId");
    const requesterStaffId = requesterStaffIdRaw ? Number(requesterStaffIdRaw) : null;
    const fileId = Number(params.get("fileId"));
    if (!fileId) return NextResponse.json({ ok: false, error: "fileId is required" }, { status: 400 });

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) return NextResponse.json({ ok: false, error: "No login email" }, { status: 400 });

    const actor = (await findActiveEmployeeByEmail(loginEmail)).employee;
    const staffId = actor?.staffId ?? null; // HR StaffId (matches AccRequest.StaffId)

    const consent =
      staffId == null ? null : parseConsentSetting(await getSetting(idCardReuseConsentKey(staffId)));

    // `requesterStaffId ?? staffId`: the form omits it when filing for
    // yourself, and naming anyone else is refused rather than resolved.
    const verdict = decideIdCardRead({
      actorStaffId: staffId,
      subjectStaffId: requesterStaffId ?? staffId,
      consent,
    });
    if (!verdict.ok) {
      return NextResponse.json({ ok: false, error: verdict.error }, { status: verdict.status });
    }

    const pool = await getAccPool();
    const res = await pool
      .request()
      .input("fid", sql.Int, fileId)
      .input("staff", sql.Int, staffId)
      .input("reftype", sql.NVarChar, FILE_REFTYPES.ID_CARD)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(`SELECT f.StoragePath, f.StorageBackend, f.FileName, f.ContentType
              FROM [dbo].[AccRequestFile] f
              INNER JOIN [dbo].[AccRequest] r ON r.Id = f.RequestId
              WHERE f.Id = @fid AND f.RefType = @reftype AND r.FormCode = @form AND r.StaffId = @staff`);
    const row = res.recordset[0] as
      | { StoragePath: string; StorageBackend: string; FileName: string; ContentType: string | null }
      | undefined;
    if (!row) {
      return NextResponse.json({ ok: false, error: "ไม่พบบัตรของผู้ขอเบิกคนนี้" }, { status: 404 });
    }

    const buffer =
      row.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(row.StoragePath)
        : await downloadFile(row.StoragePath);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: attachmentResponseHeaders({ bytes: buffer, fileName: row.FileName }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[id-card/previous/download] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
