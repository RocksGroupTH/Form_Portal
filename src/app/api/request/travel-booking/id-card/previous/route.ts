import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { getSetting } from "@/lib/acc/settings-service";
import { AP17_FORM_CODE, FILE_REFTYPES, idCardReuseConsentKey } from "@/features/travel-booking/constants";

/**
 * GET /api/request/travel-booking/id-card/previous?requesterStaffId=&excludeRequestId=
 * For the requester (ผู้ขอเบิก — self, or a same-department colleague via requesterStaffId),
 * returns their reuse-consent state and — only when consent was granted — the most recent ID-card
 * file from an earlier AP-17 request (so a brand-new trip can reuse it before it's ever saved).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const params = new URL(req.url).searchParams;
    const requesterStaffIdRaw = params.get("requesterStaffId");
    const requesterStaffId = requesterStaffIdRaw ? Number(requesterStaffIdRaw) : null;
    const excludeRequestId = Number(params.get("excludeRequestId")) || 0;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) return NextResponse.json({ ok: true, data: { consent: null, card: null } });

    // Resolves self (requesterStaffId null) or a same-department colleague; throws if not authorized.
    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId);
    const staffId = emp.staffId; // HR StaffId (matches AccRequest.StaffId) — NOT emp.id (Employee GUID)

    const consentRaw = await getSetting(idCardReuseConsentKey(staffId));
    const consent = consentRaw === "true" ? true : consentRaw === "false" ? false : null;

    let card: { fileId: number; requestId: number; fileName: string; contentType: string; uploadedAt: string } | null = null;
    if (consent === true) {
      const pool = await getAccPool();
      const prev = await pool
        .request()
        .input("staff", sql.Int, staffId)
        .input("exclude", sql.Int, excludeRequestId)
        .input("form", sql.NVarChar, AP17_FORM_CODE)
        .input("reftype", sql.NVarChar, FILE_REFTYPES.ID_CARD)
        .query(`
          SELECT TOP 1 f.Id, f.RequestId, f.FileName, f.ContentType, f.UploadedAt
          FROM [dbo].[AccRequestFile] f
          INNER JOIN [dbo].[AccRequest] r ON r.Id = f.RequestId
          WHERE f.RefType = @reftype AND r.StaffId = @staff AND r.FormCode = @form AND f.RequestId <> @exclude
          ORDER BY f.UploadedAt DESC
        `);
      const p = prev.recordset[0] as
        | { Id: number; RequestId: number; FileName: string; ContentType: string | null; UploadedAt: Date }
        | undefined;
      if (p) {
        card = {
          fileId: Number(p.Id),
          requestId: Number(p.RequestId),
          fileName: p.FileName,
          contentType: p.ContentType ?? "application/octet-stream",
          uploadedAt: new Date(p.UploadedAt).toISOString(),
        };
      }
    }

    return NextResponse.json({ ok: true, data: { consent, card } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[id-card/previous] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
