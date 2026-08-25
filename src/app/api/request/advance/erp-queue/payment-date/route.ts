import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getPaymentDates } from "@/lib/acc/payment-calendar";

/** POST { id, paymentDate } — re-target the payment cycle for an Approved,
 *  not-yet-Sent AP-2 advance (used on the "รอส่ง" queue before re-sending). */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const [h, o, d] = await Promise.all([
      isAdvanceApprover(actor.email, "HEAD_ACC"),
      isAdvanceApprover(actor.email, "ACC_OFFICER"),
      isAdvanceApprover(actor.email, "DIRECTOR"),
    ]);
    if (!h && !o && !d) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number; paymentDate?: string };
  const id = Number(body.id);
  const paymentDate = typeof body.paymentDate === "string" ? body.paymentDate : "";
  if (!Number.isFinite(id) || !paymentDate) {
    return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const valid = await getPaymentDates();
  if (!valid.includes(paymentDate)) {
    return NextResponse.json({ ok: false, error: "วันจ่ายไม่ถูกต้อง" }, { status: 400 });
  }

  const pool = await getAccPool();
  const st = await pool.request().input("id", sql.Int, id)
    .query(`SELECT Status, ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='AP-2'`);
  const row = st.recordset[0] as { Status?: string; ErpInterfaceStatus?: string | null } | undefined;
  if (!row || row.Status !== "Approved" || row.ErpInterfaceStatus === "Sent") {
    return NextResponse.json(
      { ok: false, error: "แก้วันจ่ายได้เฉพาะรายการที่อนุมัติแล้วและยังไม่ได้ส่ง" }, { status: 400 });
  }

  await pool.request().input("rid", sql.Int, id).input("pd", sql.Date, paymentDate)
    .query(`UPDATE [dbo].[AccRequest] SET PaymentDate=@pd, UpdatedAt=SYSDATETIME()
            WHERE Id=@rid AND FormCode='AP-2'`);

  return NextResponse.json({ ok: true });
}
