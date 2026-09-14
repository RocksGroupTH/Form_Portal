import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listGlAccounts } from "@/lib/clr/clear-advance-request-service";
import { resolveClrCompany } from "@/lib/clr/clear-advance-admin-service";

/** GET /api/request/clear-advance/options/gl-accounts?brand=CODE&branch=CODE
 *  — the AP-3.2 categories this claim's company offers, narrowed to the ones
 *  this line's branch may charge. Both parameters matter: the brand decides
 *  WHICH rules, the branch decides which of them apply. */
export async function GET(req: Request) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const params = new URL(req.url).searchParams;
    const branch = params.get("branch");
    // The claim brand, resolved to the company whose rules apply — ROCKS reads
    // PCTH's. Without a brand there are no rules to read and the picker is
    // empty, which is the honest answer rather than every company's union.
    const company = await resolveClrCompany(params.get("brand"));
    const data = await listGlAccounts({ company, branchCode: branch });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
