import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getAccPool, sql } from "@/lib/acc/pool";
import { getPaymentDates } from "@/lib/acc/payment-calendar";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/** POST { id, paymentDate } — re-target the payment cycle for an Approved,
 *  not-yet-Sent AP-3 clearing (used on the ERP "รอส่ง" queue before sending). */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

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
  const st = await pool.request().input("id", sql.Int, id).input("form", sql.NVarChar, AP3_FORM_CODE)
    .query(`SELECT Status, ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
  const row = st.recordset[0] as { Status?: string; ErpInterfaceStatus?: string | null } | undefined;
  if (!row || row.Status !== "Approved" || row.ErpInterfaceStatus === "Sent" || row.ErpInterfaceStatus === "Pending") {
    return NextResponse.json(
      { ok: false, error: "แก้วันจ่ายได้เฉพาะรายการที่อนุมัติแล้วและยังไม่ได้ส่ง" }, { status: 400 });
  }

  await pool.request().input("rid", sql.Int, id).input("pd", sql.Date, paymentDate)
    .query(`UPDATE [dbo].[AccClearAdvance] SET PaymentDate=@pd, UpdatedAt=SYSDATETIME()
            WHERE RequestId=@rid`);

  return NextResponse.json({ ok: true });
}
