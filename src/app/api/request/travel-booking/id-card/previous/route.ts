import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { getSetting } from "@/lib/acc/settings-service";
import {
  decideIdCardRead,
  parseConsentSetting,
} from "@/lib/acc/travel-booking/id-card-access";
import { AP17_FORM_CODE, FILE_REFTYPES, idCardReuseConsentKey } from "@/features/travel-booking/constants";

/**
 * GET /api/request/travel-booking/id-card/previous?requesterStaffId=&excludeRequestId=
 *
 * The signed-in employee's own reuse-consent state and — only when they granted
 * it — the most recent ID-card file from an earlier AP-17 request of theirs, so
 * a brand-new trip can reuse it before it is ever saved.
 *
 * Self only. This used to resolve `requesterStaffId` through
 * `resolveEmployeeForActor`, which lets anyone in the same department name
 * anyone else, and then handed back that colleague's card id. See
 * `@/lib/acc/travel-booking/id-card-access`.
 *
 * Filing on behalf of a colleague still works; it just comes back with nothing
 * to reuse, and the panel offers a fresh upload instead of a stranger's card.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const empty = { consent: null as boolean | null, card: null };

  try {
    const params = new URL(req.url).searchParams;
    const requesterStaffIdRaw = params.get("requesterStaffId");
    const requesterStaffId = requesterStaffIdRaw ? Number(requesterStaffIdRaw) : null;
    const excludeRequestId = Number(params.get("excludeRequestId")) || 0;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) return NextResponse.json({ ok: true, data: empty });

    const actor = (await findActiveEmployeeByEmail(loginEmail)).employee;
    const staffId = actor?.staffId ?? null; // HR StaffId (matches AccRequest.StaffId)
    if (staffId == null) return NextResponse.json({ ok: true, data: empty });

    // Naming somebody else is answered as "nothing here" rather than a
    // refusal — the panel simply shows no reuse option, and the response
    // confirms nothing about whether that colleague has a stored card.
    if (requesterStaffId != null && requesterStaffId !== staffId) {
      return NextResponse.json({ ok: true, data: empty });
    }

    const consent = parseConsentSetting(await getSetting(idCardReuseConsentKey(staffId)));

    let card: { fileId: number; requestId: number; fileName: string; contentType: string; uploadedAt: string } | null = null;
    if (decideIdCardRead({ actorStaffId: staffId, subjectStaffId: staffId, consent }).ok) {
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
