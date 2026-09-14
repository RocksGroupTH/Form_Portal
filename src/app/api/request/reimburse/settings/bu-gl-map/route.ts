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
 * AP-4's door onto the BU → G/L and BRANCH → G/L rules.
 *
 * **The same rows AP-3 edits** (`AccClrBuGlMap`, `AccClrBranchGlMap`), on
 * purpose and with no `FormCode` column: a store the company owns books its
 * expense to the account it was coded to, and a franchised or managed one books
 * it to a receivable because the money is charged back. That is a fact about a
 * shop, not about the form the expense arrived on, so a second per-form copy
 * would be a second answer to one question — and the two would drift on the one
 * screen nobody thinks to check twice.
 *
 * **So why a second route at all, rather than pointing AP-4's tab at AP-3's?**
 * Because `ROUTE_RULES` classifies by path: `/api/request/clear-advance`
 * resolves **AP-3's** environment, and these rows are read through
 * `getAccPool()`. A tester with AP-4 in UAT and AP-3 in production would edit
 * production's rules from AP-4's settings page and see none of their own. This
 * path classifies `AP-4` — the `/api/request/reimburse` prefix already does —
 * so the tab reads and writes whichever database AP-4 itself resolves.
 *
 * `requireRole` on both handlers, matching AP-3's, and the tab is deliberately
 * absent from `GRANTABLE_REIMBURSE_TABS`: it decides which account money lands
 * in and is not brand-scoped, the same argument that keeps `erpInterface`
 * ungrantable.
 *
 * GET  ?company=PCTH — the rules for one BC company, plus every BU its
 *                      Locations actually carry, so the screen offers the ones
 *                      a rule could apply to instead of a free-text box.
 * POST { company, buCode | branchCode, glAccountNo, note } — set one rule. A
 *      blank account deletes it, returning that BU to "บัญชีตาม คชจ" — the same
 *      state as never having had a rule.
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
    // One endpoint, two kinds of rule: a body naming a branch sets a branch
    // rule, one naming a BU sets a BU rule. Same screen, same decision — which
    // account this expense posts to — so they share a door.
    const body = (await req.json()) as {
      company: string;
      buCode?: string;
      branchCode?: string;
      glAccountNo: string;
      note?: string | null;
    };
    if (body.branchCode) {
      await upsertBranchGlMap({
        company: body.company,
        branchCode: body.branchCode,
        glAccountNo: body.glAccountNo,
        note: body.note ?? null,
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
