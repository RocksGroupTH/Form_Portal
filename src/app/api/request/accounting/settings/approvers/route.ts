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
import { setApproverSettingsTabs } from "@/lib/acc/approver-settings-tabs";

/*
 * **Admin only, and never opened by a settings-tab grant.**
 *
 * Every other route under `settings/` moved to `requireSettingsTab` so a
 * granted approver can use the tab they were given. This one cannot: it is the
 * สิทธิ์เข้าถึง tab, the place the grants are handed out. A non-admin who could
 * POST here would grant themselves every other tab, which is why `approvers` is
 * absent from `GRANTABLE_SETTINGS_TABS` and why `decideSettingsTabAccess`
 * refuses it for a non-admin even if a row for it exists. Recorded in
 * `SETTINGS_ROUTE_TABS` (`@/lib/acc/settings-tabs`).
 */

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
 * Body: { id?, staffId?, email, displayName?, isActive?, interfaceBrandCodes?,
 *         settingsTabs? }
 * interfaceBrandCodes: null | omitted = all groups; string[] = explicit subset
 * settingsTabs: omitted = leave the grants alone; string[] = the granted set,
 *   so [] revokes everything. Unknown keys — `approvers` above all — are
 *   dropped by setApproverSettingsTabs, never stored.
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

    if (Array.isArray(body.settingsTabs)) {
      const approverId =
        typeof body.id === "number"
          ? body.id
          : await getApproverIdByEmail(String(body.email ?? ""));
      if (approverId) {
        await setApproverSettingsTabs(
          approverId,
          (body.settingsTabs as unknown[]).map((k) => String(k)),
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/accounting/settings/approvers] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
