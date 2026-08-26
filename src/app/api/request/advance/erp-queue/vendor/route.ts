import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getRequest } from "@/lib/adv/advance-request-service";
import { confirmAdvanceVendor, VendorConfirmError } from "@/lib/adv/vendor-match-service";

/** POST { id, vendorNo } — override the vendor on an Approved, not-yet-Sent
 *  AP-2 advance (the "รอส่ง" queue). Mirrors erp-queue/payment-date. */
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
    if (!h && !o && !d) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number; vendorNo?: string };
  const id = Number(body.id);
  const vendorNo = typeof body.vendorNo === "string" ? body.vendorNo.trim() : "";
  if (!Number.isFinite(id) || !vendorNo) {
    return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const pool = await getAccPool();
  const st = await pool.request().input("id", sql.Int, id)
    .query(`SELECT Status, ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='AP-2'`);
  const row = st.recordset[0] as { Status?: string; ErpInterfaceStatus?: string | null } | undefined;
  if (!row || row.Status !== "Approved" || row.ErpInterfaceStatus === "Sent" || row.ErpInterfaceStatus === "Pending") {
    return NextResponse.json({ ok: false, error: "แก้ Vendor ได้เฉพาะรายการที่อนุมัติแล้วและยังไม่ได้ส่ง" }, { status: 400 });
  }

  const reqRow = await getRequest(id);
  if (!reqRow?.brandCode) return NextResponse.json({ ok: false, error: "ไม่พบคำขอ" }, { status: 404 });

  try {
    await confirmAdvanceVendor(id, reqRow.brandCode, vendorNo, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof VendorConfirmError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    console.error("[api/request/advance/erp-queue/vendor] POST", err);
    return NextResponse.json({ ok: false, error: "แก้ Vendor ไม่สำเร็จ" }, { status: 500 });
  }
}
