import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { statusForAccError } from "@/lib/acc/request-errors";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { resolveLoginEmail } from "@/lib/auth-email";
import { getAccPool, sql } from "@/lib/acc/pool";
import { submitTravelBookingGroup } from "@/lib/acc/travel-booking/request-service";
import { isBrandAllowedForForm } from "@/lib/acc/brand-options";
import { processQueue } from "@/lib/acc/email-queue";
import { isSharePointConfigured, moveSharePointFolder } from "@/lib/sharepoint";
import { buildAccFolderPath, yearFromRequestNo } from "@/lib/acc/sharepoint-path";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import { resolveFormEnvironment } from "@/lib/form-environment";

/** This tab's GroupKey — submit acts on the whole draft group, producing N documents. */
async function resolveGroupKey(requestId: number): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT GroupKey FROM [dbo].[AccTravelBooking] WHERE RequestId = @id`);
  return (r.recordset[0]?.GroupKey as string) ?? null;
}

/* ── POST /api/request/travel-booking/requests/[id]/submit — submits the whole group ── */

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // Tester-only on a UAT record. See `uatActorGate`.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  try {
    const groupKey = await resolveGroupKey(id);
    if (!groupKey) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    // The brand is checked here, against `AccFormBrand`, and not only in the
    // picker. A draft can hold a code the allowlist has since dropped — or one
    // that was never on it — and a client-enforced invariant is not one. AP-4's
    // submit does the same, for the same reason.
    //
    // `isBrandAllowedForForm` reads `AccFormBrand` alone; `getAllowedBrands`
    // would enrich each row from the brand master over `getCorePool()`, which
    // would fail an AP-17 submit on a Fast_Core outage over display data the
    // check never reads.
    // **Every trip in the group, not the first.** The brand is per trip — a
    // group is one AccRequest row per tab, each with its own BrandCode — so a
    // TOP 1 check would pass a group whose second journey names a brand that is
    // blank, or one the allowlist has since dropped.
    const pool = await getAccPool();
    const brandRows = await pool
      .request()
      .input("groupKey", sql.NVarChar, groupKey)
      .query(`SELECT r.Id, r.BrandCode FROM [dbo].[AccRequest] r
              INNER JOIN [dbo].[AccTravelBooking] b ON b.RequestId = r.Id
              WHERE b.GroupKey = @groupKey`);
    const codes: string[] = [];
    for (const row of brandRows.recordset as { BrandCode: string | null }[]) {
      const code = (row.BrandCode ?? "").trim();
      if (!code) {
        return NextResponse.json(
          { ok: false, error: "กรุณาเลือกแบรนด์ที่เบิกให้ครบทุกทริปก่อนส่งคำขอ" },
          { status: 400 },
        );
      }
      if (codes.indexOf(code) === -1) codes.push(code);
    }
    // De-duplicated first: two trips under one brand are the common case and
    // should not cost two round trips to answer the same question.
    for (const code of codes) {
      if (!(await isBrandAllowedForForm(AP17_FORM_CODE, code))) {
        return NextResponse.json(
          { ok: false, error: `แบรนด์ ${code} ไม่อยู่ในรายการที่เบิกได้แล้ว — กรุณาเลือกใหม่` },
          { status: 400 },
        );
      }
    }

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const submitted = await submitTravelBookingGroup(groupKey, Number(session.user.id), loginEmail);
    void processQueue().catch(() => {});

    // Move each submitted tab's draft SharePoint folder into {year}/{requestNo} (best-effort).
    // Both ends need the same environment: a UAT draft's files were uploaded
    // under `_UAT`, so a move computed against the production tree would look
    // for a folder that is not there and leave the draft folder behind.
    if (isSharePointConfigured()) {
      const environment = await resolveFormEnvironment();
      for (const req of submitted) {
        if (req.id == null || !req.requestNo) continue;
        const from = buildAccFolderPath({
          requestNo: null, requestId: req.id, year: null, formCode: AP17_FORM_CODE, environment,
        });
        const to = buildAccFolderPath({
          requestNo: req.requestNo, requestId: req.id, year: yearFromRequestNo(req.requestNo),
          formCode: AP17_FORM_CODE, environment,
        });
        void moveSharePointFolder(from, to);
      }
    }

    return NextResponse.json({ ok: true, data: submitted });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // 409 when the in-transaction claim found a tab already submitted, so the
    // client reloads instead of being offered a retry that cannot succeed.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
