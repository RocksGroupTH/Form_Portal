import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { markResent } from "@/lib/adv/advance-erp-attempt-service";

/** POST { id } — pull a Sent AP-2 advance back to the "รอส่ง" queue for a corrected re-send. */
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
      return NextResponse.json(
        { ok: false, error: "เฉพาะผู้อนุมัติบัญชี/แอดมินเท่านั้น" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number };
  const id = Number(body.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 400 });
  }

  const pool = await getAccPool();
  const st = await pool.request().input("id", sql.Int, id)
    .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='AP-2'`);
  const cur = (st.recordset[0]?.ErpInterfaceStatus as string | null) ?? null;
  if (cur !== "Sent") {
    return NextResponse.json(
      { ok: false, error: "ดึงกลับได้เฉพาะรายการที่ส่งแล้ว (Sent)" }, { status: 400 });
  }

  await markResent(id, actor.userId);

  return NextResponse.json({ ok: true });
}
