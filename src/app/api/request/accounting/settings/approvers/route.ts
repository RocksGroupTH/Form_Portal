import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  getApproverIdByEmail,
  listApprovers,
  setApproverInterfaceBrands,
  upsertApprover,
} from "@/lib/acc/settings-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";

/**
 * GET /api/request/accounting/settings/approvers
 * Returns the full list of approvers (including inactive).
 * Requires IT Admin or System Admin.
 */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const data = await listApprovers(false);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/settings/approvers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/request/accounting/settings/approvers
 * Upserts an approver record.
 * Body: { id?, staffId?, email, displayName?, isActive?, interfaceBrandCodes? }
 * interfaceBrandCodes: null | omitted = all groups; string[] = explicit subset
 * Requires IT Admin or System Admin.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    // Approvers are keyed on StaffId in practice — resolve it from HR by email
    // when adding (AD search only returns the Azure AD id, not the HR StaffId).
    if (!body.staffId && body.email) {
      try {
        const { employee } = await findActiveEmployeeByEmail(body.email);
        if (employee?.staffId) {
          body.staffId = employee.staffId;
          if (!body.displayName && employee.fullName) body.displayName = employee.fullName;
        }
      } catch {
        /* HR lookup is best-effort — don't block adding the approver */
      }
    }
    await upsertApprover(body, Number(session.user.id));

    if ("interfaceBrandCodes" in body) {
      const approverId =
        typeof body.id === "number"
          ? body.id
          : await getApproverIdByEmail(String(body.email ?? ""));
      if (approverId) {
        const raw = body.interfaceBrandCodes;
        if (raw === null) {
          await setApproverInterfaceBrands(approverId, null);
        } else if (Array.isArray(raw)) {
          const codes = raw
            .map((c: unknown) => String(c).trim().toUpperCase())
            .filter((c) => isErpInterfaceBrandCode(c));
          await setApproverInterfaceBrands(approverId, codes.length > 0 ? codes : []);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/accounting/settings/approvers] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
