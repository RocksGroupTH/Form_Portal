import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAccPool, sql } from "@/lib/acc/pool";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * GET /api/request/reimburse/requests/drafts — the caller's resumable AP-4
 * request, or null.
 *
 * One, not a list: AP-4 has no on-behalf submission and the form is a single
 * running claim, so "Continue where you left off" has at most one thing to
 * offer. Where AP-1 keys its drafts on `CreatedBy = @uid OR SubmittedBy = @uid`
 * — it can be filed for somebody else — AP-4 is always the signed-in user's
 * own, so the creator alone answers. The newest edit wins if an older draft is
 * somehow still open.
 */

interface ReimburseDraftSummary {
  id: number;
  brandCode: string | null;
  status: "Draft" | "Returned";
  purpose: string | null;
  itemCount: number;
  totalAmount: number | null;
  updatedAt: string;
}

export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const pool = await getAccPool();
    const res = await pool
      .request()
      .input("uid", sql.Int, Number(session.user.id))
      .input("form", sql.NVarChar, AP4_FORM_CODE)
      .query(`
        SELECT TOP 1 r.Id, r.BrandCode, r.Status, r.UpdatedAt, r.TotalAmount, x.Purpose,
               (SELECT COUNT(*) FROM [dbo].[AccReimburseItem] i WHERE i.RequestId = r.Id) AS ItemCount
        FROM [dbo].[AccRequest] r
        INNER JOIN [dbo].[AccReimburse] x ON x.RequestId = r.Id
        WHERE r.FormCode = @form
          AND r.Status IN ('Draft', 'Returned')
          AND r.CreatedBy = @uid
        ORDER BY r.UpdatedAt DESC
      `);

    const row = res.recordset[0] as Record<string, unknown> | undefined;
    if (!row) return NextResponse.json({ ok: true, data: null });

    const data: ReimburseDraftSummary = {
      id: row.Id as number,
      brandCode: (row.BrandCode as string) ?? null,
      status: row.Status as ReimburseDraftSummary["status"],
      purpose: (row.Purpose as string) ?? null,
      itemCount: Number(row.ItemCount) || 0,
      totalAmount: row.TotalAmount === null || row.TotalAmount === undefined ? null : Number(row.TotalAmount),
      updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
    };
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/reimburse/requests/drafts] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
