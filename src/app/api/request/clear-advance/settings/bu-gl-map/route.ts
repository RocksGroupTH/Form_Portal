import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listBuGlMap,
  listCompanyBus,
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
    const [rules, bus] = await Promise.all([listBuGlMap(company), listCompanyBus(company)]);
    return NextResponse.json({ ok: true, data: { rules, bus } });
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
    const body = (await req.json()) as Parameters<typeof upsertBuGlMap>[0];
    await upsertBuGlMap(body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
