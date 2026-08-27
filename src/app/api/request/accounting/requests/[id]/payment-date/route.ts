import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessAccountArea } from "@/lib/acc/access";
import { isAdminRole } from "@/lib/roles";
import { getPaymentDates } from "@/lib/acc/payment-calendar";
import { getAccPool, sql } from "@/lib/acc/pool";
import { buildAccActor } from "@/lib/acc/actor-context";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/**
 * POST /api/request/accounting/requests/[id]/payment-date
 * Body: `{ paymentDate: "YYYY-MM-DD" }`
 *
 * Set which payment round an AP-1 claim goes out on. ACC Portal's twin — this
 * page had no way to set it per row, only one date for a whole batch at the
 * moment of approving.
 *
 * **Two acts behind one route, carrying different rights:**
 *
 * - `ManagerApproved` — the claim is being prepared, and choosing its round is
 *   part of approving it. Any account-area approver may: it is the same person
 *   about to press approve, and the approval confirms the value.
 * - `Approved` — a correction after the fact, with a payout possibly already
 *   scheduled around it. Admins only.
 *
 * The date is checked against the real calendar either way, so neither path can
 * write a day that is not a payment round. The window looks six months back as
 * well as forward, because a correction may need a round that has been and
 * gone; a requester's own picker asks for no history and is unaffected.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/accounting` prefix already
 * classifies `AP-1`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { paymentDate?: unknown };
    const paymentDate = typeof body.paymentDate === "string" ? body.paymentDate.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return NextResponse.json(
        { ok: false, error: "รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)" },
        { status: 400 },
      );
    }

    const valid = await getPaymentDates(new Date(), 6, 6);
    if (valid.indexOf(paymentDate) === -1) {
      return NextResponse.json(
        { ok: false, error: "วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 2 หรือ 4)" },
        { status: 400 },
      );
    }

    const admin = isAdminRole(session.user.role);
    if (!admin && !(await canAccessAccountArea(session.user.email, session.user.role))) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงคำขอนี้" }, { status: 403 });
    }

    // The status set is the authorization, applied in the UPDATE's own
    // predicate rather than by reading first and writing after — a read-then-write
    // lets an approval land in between and a correction be written over a claim
    // that has since gone out.
    const statusList = admin ? "'Approved', 'ManagerApproved'" : "'ManagerApproved'";

    const pool = await getAccPool();
    const r = await pool
      .request()
      .input("id", sql.Int, id)
      .input("pd", sql.Date, paymentDate)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .query(`UPDATE [dbo].[AccRequest] SET PaymentDate=@pd, UpdatedAt=SYSDATETIME()
              WHERE Id=@id AND FormCode=@form AND Status IN (${statusList})`);

    if ((r.rowsAffected[0] ?? 0) === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: admin
            ? "ไม่พบคำขอ หรือคำขอไม่ได้อยู่สถานะที่แก้ไขวันจ่ายได้"
            : "ไม่พบคำขอ หรือคำขอนี้อนุมัติไปแล้ว — ต้องเป็นผู้ดูแลระบบจึงจะแก้ได้",
        },
        { status: 400 },
      );
    }

    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    await pool
      .request()
      .input("rid", sql.Int, id)
      .input("by", sql.Int, actor.staffId ?? null)
      .input("note", sql.NVarChar, `แก้ไขวันจ่ายเป็น ${paymentDate}`)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'payment_date_edited', @note)`);

    return NextResponse.json({ ok: true, data: { id, paymentDate } });
  } catch (e) {
    console.error(
      "[api/request/accounting/requests/[id]/payment-date] POST",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ ok: false, error: "แก้ไขวันจ่ายไม่สำเร็จ" }, { status: 400 });
  }
}
