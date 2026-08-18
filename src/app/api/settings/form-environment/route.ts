import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listFormEnvironments,
  setFormFlag,
} from "@/lib/form-environment/service";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";
import { resolveNames as resolveMemberNames } from "@/lib/team-member/service";

type FormPool = Awaited<ReturnType<typeof getProductionFormPool>>;

/** Request counts per form code in one database. */
async function countByForm(pool: FormPool): Promise<{ FormCode: string; N: number }[]> {
  const r = await pool.request().query<{ FormCode: string; N: number }>(
    `SELECT FormCode, COUNT(*) AS N FROM [dbo].[AccRequest] GROUP BY FormCode`,
  );
  return r.recordset;
}

/**
 * Display names for the TeamMember ids that last flipped a flag.
 *
 * The ids come from Fast_Core.FormEnvironment.UpdatedBy, but they are resolved
 * against this app's own roster — migration 066 copied it across with the ids
 * preserved, so the same number still names the same person.
 */
async function resolveNames(ids: number[]): Promise<Record<number, string>> {
  const members = await resolveMemberNames(ids);
  const out: Record<number, string> = {};
  members.forEach((m, id) => {
    // Nickname first: this is a compact "last changed by" column. The service
    // trims nulls to "", so a blank falls through to the next candidate.
    out[id] = m.nickname || m.fullName || `#${id}`;
  });
  return out;
}

/** GET — every form with its flag and its request count in each database. */
export async function GET() {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  try {
    const forms = await listFormEnvironments();
    const [prod, uat] = await Promise.all([getProductionFormPool(), getUatFormPool()]);
    const [pc, uc, names] = await Promise.all([
      countByForm(prod),
      countByForm(uat),
      resolveNames(forms.map((f) => f.updatedBy ?? 0)),
    ]);
    const byCode = (rows: { FormCode: string; N: number }[], code: string) =>
      rows.find((r) => r.FormCode === code)?.N ?? 0;
    return NextResponse.json({
      ok: true,
      data: forms.map((f) => ({
        ...f,
        updatedByName: f.updatedBy ? names[f.updatedBy] ?? null : null,
        productionCount: byCode(pc, f.formCode),
        uatCount: byCode(uc, f.formCode),
      })),
    });
  } catch (err) {
    console.error("[api/settings/form-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST { formCode, field, value } — flip one switch on one form.
 *
 * One field at a time on purpose: the two switches are independent, and a
 * whole-row write would let a stale copy of the switch the admin did not touch
 * travel back with the one they did.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    const formCode = typeof body.formCode === "string" ? body.formCode.trim() : "";
    if (!formCode) {
      return NextResponse.json({ ok: false, error: "formCode is required" }, { status: 400 });
    }
    if (body.field !== "production" && body.field !== "uat") {
      return NextResponse.json({ ok: false, error: "Invalid field" }, { status: 400 });
    }
    if (typeof body.value !== "boolean") {
      return NextResponse.json({ ok: false, error: "Invalid value" }, { status: 400 });
    }
    await setFormFlag(formCode, body.field, body.value, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings/form-environment] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
