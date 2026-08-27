import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { listVendors } from "@/lib/adv/advance-erp-master-service";
import { resolveAdvanceInterfaceCompany } from "@/lib/adv/advance-erp-context";

/**
 * GET /api/request/advance/vendors?company=PCTH
 * Returns the active, non-blocked vendor list for one ERP company.
 * Accessible to any advance approver (HEAD_ACC / ACC_OFFICER / DIRECTOR) and admins.
 */
export async function GET(req: NextRequest) {
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

  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  if (!company) return NextResponse.json({ ok: false, error: "ต้องระบุ company" }, { status: 400 });

  try {
    // The caller may pass a portal brand (detail page) or an already-resolved
    // interface Company (queue); resolve either to the BC Company that keys ErpVendors.
    const resolved = await resolveAdvanceInterfaceCompany(company);
    const vendors = await listVendors(resolved);
    return NextResponse.json({ ok: true, vendors });
  } catch (err) {
    console.error("[api/request/advance/vendors] GET", err);
    return NextResponse.json({ ok: false, error: "ดึง Vendor ไม่สำเร็จ" }, { status: 500 });
  }
}
