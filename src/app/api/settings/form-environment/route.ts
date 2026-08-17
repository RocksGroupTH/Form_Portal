import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import {
  listFormEnvironments,
  setFormEnvironment,
} from "@/lib/form-environment/service";
import {
  getCorePool,
  getProductionFormPool,
  getUatFormPool,
  sql,
} from "@/lib/db/mssql";

type FormPool = Awaited<ReturnType<typeof getProductionFormPool>>;

/** Request counts per form code in one database. */
async function countByForm(pool: FormPool): Promise<{ FormCode: string; N: number }[]> {
  const r = await pool.request().query<{ FormCode: string; N: number }>(
    `SELECT FormCode, COUNT(*) AS N FROM [dbo].[AccRequest] GROUP BY FormCode`,
  );
  return r.recordset;
}

/** Display names for the TeamMember ids that last flipped a flag. */
async function resolveNames(ids: number[]): Promise<Record<number, string>> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  if (unique.length === 0) return {};
  const pool = await getCorePool();
  const req = pool.request();
  const params = unique.map((id, i) => {
    req.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const r = await req.query<{ Id: number; FullName: string | null; Nickname: string | null }>(
    `SELECT Id, FullName, Nickname FROM [dbo].[TeamMember] WHERE Id IN (${params.join(", ")})`,
  );
  const out: Record<number, string> = {};
  for (const row of r.recordset) out[row.Id] = row.Nickname || row.FullName || `#${row.Id}`;
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

/** POST { formCode, environment } — flip one form. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    if (body.environment !== "Production" && body.environment !== "UAT") {
      return NextResponse.json({ ok: false, error: "Invalid environment" }, { status: 400 });
    }
    await setFormEnvironment(String(body.formCode), body.environment, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings/form-environment] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
