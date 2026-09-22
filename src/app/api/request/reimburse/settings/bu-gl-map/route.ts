import { NextRequest, NextResponse } from "next/server";
import { requireReimburseSettingsTab } from "@/lib/acc/reimburse/require-reimburse-settings-tab";
import {
  listBranchGlMap,
  listBuGlMap,
  listCompanyBus,
  upsertBranchGlMap,
  upsertBuGlMap,
} from "@/lib/clr/clr-bu-gl-map-service";
import {
  listClrErpBranchesForCompany,
  listClrErpGlOptionsForCompany,
} from "@/lib/clr/clear-advance-admin-service";

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
 * **Gated on the `buGlMap` grant since 2026-09-22, matching AP-3's twin.**
 * Both handlers were `requireRole` until that day and the tab was absent from
 * `GRANTABLE_REIMBURSE_TABS`, because it decides which account money lands in,
 * is not brand-scoped, and — sharper — edits rows that are **AP-3's as much as
 * AP-4's**, so a grant here is a grant over another form's posting rules. The
 * user was told that and opened it anyway; the สิทธิ์เข้าถึง grid prints a
 * Thai line under the tick saying the rules are shared. The admin arm is
 * unchanged, so nobody lost access.
 *
 * GET  ?company=PCTH — the rules for one BC company, plus the three lists the
 *                      screen picks from: every BU its Locations carry, its
 *                      BRANCH dimension values, and its G/L accounts. Every
 *                      one of them is a real list rather than a free-text box,
 *                      because a rule typed against a code that does not exist
 *                      never fires and nothing says so.
 *                      **The G/L list is NOT filtered to expense accounts**: a
 *                      rule points a franchised store's spend at a RECEIVABLE,
 *                      which is what every rule in use today does.
 * POST { company, buCode | branchCode, glAccountNo, note } — set one rule. A
 *      blank account deletes it, returning that BU to "บัญชีตาม คชจ" — the same
 *      state as never having had a rule.
 */
export async function GET(req: NextRequest) {
  const session = await requireReimburseSettingsTab("buGlMap");
  if (session instanceof Response) return session;

  const company = req.nextUrl.searchParams.get("company") ?? "";
  if (!company.trim()) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ Company" }, { status: 400 });
  }
  try {
    // Five reads, one round trip. AP-4's screen groups the rules by the
    // account they point at and adds members from real lists, so it needs the
    // Company's BRANCH dimension values and its G/L accounts as well — and a
    // second and third fetch would each re-resolve the same Company.
    const [rules, bus, branchRules, branches, glAccounts] = await Promise.all([
      listBuGlMap(company),
      listCompanyBus(company),
      listBranchGlMap(company),
      listClrErpBranchesForCompany(company),
      listClrErpGlOptionsForCompany(company),
    ]);
    return NextResponse.json({
      ok: true,
      data: { rules, bus, branchRules, branches, glAccounts },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await requireReimburseSettingsTab("buGlMap");
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
