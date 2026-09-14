import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  clearGlCompanyRule,
  listGlAccountsForCompany,
  setGlAccountNames,
  setGlCompanyRule,
  upsertGlAccount,
} from "@/lib/clr/clear-advance-admin-service";
import { isDimensionType } from "@/lib/clr/gl-dimension";

/**
 * AP-3.2's G/L categories, as one company sees them — AP-4's door onto them.
 *
 * **The same rows AP-3's own route serves**, and the same service: the
 * categories are a fact about a company's books, not about a form. The path is
 * AP-4's because  classifies by path and these rows are read
 * through , so a tester with AP-4 in UAT and AP-3 in production
 * must not edit production's rows from a UAT screen — the same reason the
 * bu-gl-map pair exists twice.
 *
 * **`?company=` is required and there is no default here**, even though the
 * screen opens on PCTH. A default in the route would answer PCTH's rules to a
 * caller who forgot the parameter — the failure being that an edit lands on the
 * wrong company's books with nothing on screen to say so. The screen names the
 * company it is showing; the route insists on being told.
 *
 * GET  ?company=PCTH — every category, with that company's dimension and
 *                      on/off switch, and `dimensionType: null` where it has no
 *                      rule yet.
 * POST { mode: "clear", company, glAccountNo } — remove this company's rule,
 *        which is what unticking the last Dimension box means.
 * POST { mode: "names", glAccountNo, nameTh, nameEn } — rename a category.
 *        The names are SHARED by every company; only the rules are per company.
 * POST { company, glAccountNo, dimensionType, isActive, nameTh } — set one
 *        company's rule. `nameTh` is Business Central's name and is used only
 *        when the account has no register row yet, which is what the first tick
 *        on one of the company's own chart accounts creates.
 */
export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const company = req.nextUrl.searchParams.get("company") ?? "";
  if (!company.trim()) {
    return NextResponse.json({ ok: false, error: "ต้องระบุบริษัท" }, { status: 400 });
  }
  try {
    const data = await listGlAccountsForCompany(company);
    return NextResponse.json({ ok: true, data });
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
    const body = (await req.json()) as {
      mode?: "rule" | "create" | "names" | "clear";
      company?: string;
      glAccountNo?: string;
      nameTh?: string | null;
      nameEn?: string | null;
      dimensionType?: string;
      isActive?: boolean;
      id?: number;
      sortOrder?: number;
    };

    // Clearing carries no dimension either — it is the absence of one — so it
    // is answered before the narrowing below, which would refuse it outright.
    if (body.mode === "clear") {
      await clearGlCompanyRule(body.company ?? "", body.glAccountNo ?? "");
      return NextResponse.json({ ok: true });
    }

    // Renaming carries no dimension, so it is answered before the narrowing
    // below — which exists for the rule write and would refuse this outright.
    if (body.mode === "names") {
      await setGlAccountNames({
        glAccountNo: body.glAccountNo ?? "",
        nameTh: body.nameTh ?? null,
        nameEn: body.nameEn ?? null,
      });
      return NextResponse.json({ ok: true });
    }

    // Narrowed here rather than trusted: `DimensionType` has a CHECK, so a bad
    // value would otherwise reach the driver and come back as an untranslated
    // constraint violation instead of a Thai message.
    if (!isDimensionType(body.dimensionType)) {
      return NextResponse.json(
        { ok: false, error: "ประเภท Dimension ไม่ถูกต้อง" },
        { status: 400 },
      );
    }

    // Kept for the one caller that still edits a category's own names; there
    // is no "add a category" path any more — every postable account is already
    // on the screen, and ticking one is what makes it a category.
    if (body.mode === "create" || body.id) {
      // The category itself — its number and its two names, shared by every
      // company. `upsertGlAccount` fans a NEW one out to all four.
      await upsertGlAccount({
        id: body.id,
        glAccountNo: body.glAccountNo ?? "",
        nameTh: body.nameTh ?? null,
        nameEn: body.nameEn ?? null,
        dimensionType: body.dimensionType,
        sortOrder: body.sortOrder,
        company: body.company ?? null,
      });
      return NextResponse.json({ ok: true });
    }

    await setGlCompanyRule({
      company: body.company ?? "",
      glAccountNo: body.glAccountNo ?? "",
      dimensionType: body.dimensionType,
      isActive: body.isActive !== false,
      // Only used when this account has no register row yet — the first tick on
      // one of the company's own chart accounts. The screen has the name on
      // screen already; the service does not read Business Central.
      nameTh: body.nameTh ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
