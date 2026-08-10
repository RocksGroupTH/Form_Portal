import { requireAuth } from "@/lib/api-auth";
import { getBrandDashboardReadiness } from "@/lib/brand-config";
import { jsonResponse, errorResponse } from "@/lib/intelligence/api-helpers";

export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;
    const data = await getBrandDashboardReadiness();
    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/readiness] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
