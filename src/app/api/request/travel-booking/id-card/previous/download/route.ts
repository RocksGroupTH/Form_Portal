import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { AP17_FORM_CODE, FILE_REFTYPES } from "@/features/travel-booking/constants";

/**
 * GET /api/request/travel-booking/id-card/previous/download?requesterStaffId=&fileId=
 * Streams the bytes of a previously-stored ID card so it can be re-attached to a brand-new trip
 * (held as a pending file, uploaded on save — same as picking a fresh card). Authorized by the
 * requester (ผู้ขอเบิก): the file must be an ID card belonging to that requester's own AP-17 request.
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

    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId);
    const staffId = emp.staffId; // HR StaffId (matches AccRequest.StaffId) — NOT emp.id (Employee GUID)

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
    const contentType = row.ContentType || "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(row.FileName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[id-card/previous/download] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
