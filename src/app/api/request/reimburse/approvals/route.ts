import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveReimburseTabsByEmail } from "@/lib/acc/reimburse/access-tabs";
import { decideReimburseMenuAccess } from "@/lib/acc/reimburse/settings-tabs";
import { listReimburseAccountQueue } from "@/lib/acc/reimburse/queue-service";
import { getReimbursePaymentOptions } from "@/lib/acc/reimburse/approval-service";

/**
 * GET /api/request/reimburse/approvals — the accounting queue AP-4's ACCOUNT
 * step is worked from: every claim at `(ManagerApproved, ACCOUNT)`, plus the
 * payment-date rounds the queue's date control opens on.
 *
 * **This gate is sight of the screen, not authority to act.** `approvalQueue`
 * decides whether this viewer may open the page at all —
 * `decideReimburseMenuAccess`, backed by `AccReimburseAccess` /
 * `AccReimburseAccessTab`. Whether a *row* may be acted on is re-decided per
 * action by the approval service against `AccReimburseApprover`
 * (`resolveReimburseApprover`, `approval-service.ts`), inside the same
 * transaction that writes. A viewer with the menu tick and no approver row
 * therefore sees every row here and gets a 403 from every action — that is
 * correct, not a bug to special-case: `AccReimburseAccess` exists precisely so
 * "may edit the payment rules" and "may approve a payment" are not the same
 * tick (see `settings-tabs.ts`'s own docblock).
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const admin = isAdminRole(session.user.role);
  const granted = await resolveReimburseTabsByEmail(session.user.email ?? null);
  if (!decideReimburseMenuAccess(admin, granted, "approvalQueue")) {
    return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }

  try {
    const [rows, options] = await Promise.all([
      listReimburseAccountQueue(),
      getReimbursePaymentOptions(),
    ]);
    return NextResponse.json({
      ok: true,
      data: { rows, paymentOptions: options.dates, suggested: options.defaultDate },
    });
  } catch (err) {
    console.error("[api/request/reimburse/approvals] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
