import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getBrandErpConfigPage } from "@/lib/acc/brand-erp-config-service";
import { resolveEffectiveErpEnvironment } from "@/lib/acc/erp-environment";
import { resolveAllErpTargetProfiles } from "@/lib/acc/erp-target-profile";
import {
  listErpTargetSettings,
  upsertErpTargetUatSetting,
} from "@/lib/acc/erp-target-setting-service";
import { listBcConnections } from "@/lib/bc/bc-connection";

/**
 * GET /api/settings/erp-interface
 * System Admin: per-brand UAT profiles for the ERP Interface.
 */
export async function GET() {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;

  try {
    const [effectiveEnvironment, profiles, uatSettings, erpPage, bcConnections] =
      await Promise.all([
        resolveEffectiveErpEnvironment(),
        resolveAllErpTargetProfiles(),
        listErpTargetSettings(),
        getBrandErpConfigPage(),
        listBcConnections(),
      ]);

    return NextResponse.json({
      ok: true,
      data: {
        effectiveEnvironment,
        profiles,
        uatSettings,
        prodTargets: erpPage.targetBrands,
        bcConnections: bcConnections.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
        })),
      },
    });
  } catch (err) {
    console.error("[api/settings/erp-interface] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/settings/erp-interface
 * System Admin: set UAT company per interface brand.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;

  try {
    const body = await req.json();
    const userId = Number(session.user.id);

    const uatRows = body.uatSettings as
      | {
          brandCode: string;
          bcUatId?: string | null;
          bcUatName?: string | null;
          bcUatConnectionId?: number | null;
        }[]
      | undefined;

    if (Array.isArray(uatRows)) {
      for (const row of uatRows) {
        if (!row.brandCode?.trim()) continue;
        await upsertErpTargetUatSetting(
          row.brandCode,
          {
            bcUatId: row.bcUatId,
            bcUatName: row.bcUatName,
            bcUatConnectionId: row.bcUatConnectionId,
          },
          userId,
        );
      }
    }

    const [effectiveEnvironment, profiles, uatSettings] = await Promise.all([
      resolveEffectiveErpEnvironment(),
      resolveAllErpTargetProfiles(),
      listErpTargetSettings(),
    ]);

    return NextResponse.json({
      ok: true,
      data: {
        effectiveEnvironment,
        profiles,
        uatSettings,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[api/settings/erp-interface] POST", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
