import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listGlAccountsForCompany,
  setGlCompanyRule,
  upsertGlAccount,
} from "@/lib/clr/clear-advance-admin-service";
import { isDimensionType } from "@/lib/clr/gl-dimension";

/**
 * AP-3.2's G/L categories, as one company sees them.
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
 * POST — two shapes, told apart by whether `glAccountNo` names a category that
 *        already exists:
 *          { company, glAccountNo, dimensionType, isActive }  set one rule
 *          { glAccountNo, nameTh, nameEn, dimensionType, company } create one
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
      mode?: "rule" | "create";
      company?: string;
      glAccountNo?: string;
      nameTh?: string | null;
      nameEn?: string | null;
      dimensionType?: string;
      isActive?: boolean;
      id?: number;
      sortOrder?: number;
    };

    // Narrowed here rather than trusted: `DimensionType` has a CHECK, so a bad
    // value would otherwise reach the driver and come back as an untranslated
    // constraint violation instead of a Thai message.
    if (!isDimensionType(body.dimensionType)) {
      return NextResponse.json(
        { ok: false, error: "ประเภท Dimension ไม่ถูกต้อง" },
        { status: 400 },
      );
    }

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
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 400 },
    );
  }
}
