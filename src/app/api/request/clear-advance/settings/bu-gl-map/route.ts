import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listBranchGlMap,
  listBuGlMap,
  listCompanyBus,
  upsertBranchGlMap,
  upsertBuGlMap,
} from "@/lib/clr/clr-bu-gl-map-service";

/**
 * GET  ?company=PCTH — the BU → G/L rules for one BC company, and every BU its
 *                      Locations actually carry, so the screen can offer the
 *                      ones a rule could apply to instead of a free-text box.
 * POST { company, buCode, glAccountNo, note } — set one rule. A blank account
 *      deletes it, which returns that BU to "บัญชีตาม คชจ" — the same state as
 *      never having had a rule, rather than a rule that means nothing.
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const company = req.nextUrl.searchParams.get("company") ?? "";
  if (!company.trim()) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ Company" }, { status: 400 });
  }
  try {
    const [rules, bus, branchRules] = await Promise.all([
      listBuGlMap(company),
      listCompanyBus(company),
      listBranchGlMap(company),
    ]);
    return NextResponse.json({ ok: true, data: { rules, bus, branchRules } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    // One endpoint, two kinds of rule: a body naming a branch sets a branch rule,
    // one naming a BU sets a BU rule. They are the same screen and the same
    // decision — which account this expense posts to — so they share a door.
    const body = (await req.json()) as {
      company: string; buCode?: string; branchCode?: string; glAccountNo: string; note?: string | null;
    };
    if (body.branchCode) {
      await upsertBranchGlMap({
        company: body.company, branchCode: body.branchCode,
        glAccountNo: body.glAccountNo, note: body.note ?? null,
      });
    } else {
      await upsertBuGlMap(body as Parameters<typeof upsertBuGlMap>[0]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
