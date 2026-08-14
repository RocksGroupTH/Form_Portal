import { getCorePool, getAppPool, sql } from "@/lib/db/mssql";
import { env } from "@/env";

export type FormEnvironmentValue = "Production" | "UAT";

export interface FormEnvironmentRow {
  formCode: string;
  formNameEn: string;
  formNameTh: string;
  environment: FormEnvironmentValue;
  updatedBy: number | null;
  updatedAt: Date | null;
}

function normalize(raw: string | null | undefined): FormEnvironmentValue {
  return raw === "UAT" ? "UAT" : "Production";
}

/**
 * Every configured flag, keyed by form code. Forms with no row are absent from
 * the result, and callers treat a missing entry as Production.
 *
 * Reads Fast_Core, which never varies by environment — this is what breaks the
 * circular dependency that per-form routing would otherwise have.
 */
export async function getFormEnvironmentMap(): Promise<Record<string, FormEnvironmentValue>> {
  const pool = await getCorePool();
  const r = await pool.request().query<{ FormCode: string; Environment: string }>(
    `SELECT FormCode, Environment FROM [dbo].[FormEnvironment]`,
  );
  const out: Record<string, FormEnvironmentValue> = {};
  for (const row of r.recordset) out[row.FormCode] = normalize(row.Environment);
  return out;
}

export async function setFormEnvironment(
  formCode: string,
  environment: FormEnvironmentValue,
  userId: number,
): Promise<void> {
  if (environment !== "Production" && environment !== "UAT") {
    throw new Error("Invalid environment");
  }
  const code = (formCode ?? "").trim();
  if (!code) throw new Error("formCode is required");

  const pool = await getCorePool();
  await pool
    .request()
    .input("code", sql.NVarChar, code)
    .input("env", sql.NVarChar, environment)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[FormEnvironment]
      SET Environment = @env, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE FormCode = @code;
      IF @@ROWCOUNT = 0
        INSERT INTO [dbo].[FormEnvironment] (FormCode, Environment, UpdatedBy)
        VALUES (@code, @env, @by);
    `);
}

/**
 * Every form in the catalogue with its flag.
 *
 * AccFormMaster lives in the form database, so this reads the production copy
 * explicitly rather than through getFormPool(): the settings page must show the
 * same catalogue no matter how the current route happens to route.
 */
export async function listFormEnvironments(): Promise<FormEnvironmentRow[]> {
  const [core, form] = await Promise.all([
    getCorePool(),
    getAppPool(env.MSSQL_FORM_DATABASE),
  ]);

  const forms = await form.request().query<{
    FormCode: string;
    FormNameEn: string;
    FormNameTh: string;
  }>(`SELECT FormCode, FormNameEn, FormNameTh FROM [dbo].[AccFormMaster] ORDER BY SortOrder`);

  const flags = await core.request().query<{
    FormCode: string;
    Environment: string;
    UpdatedBy: number | null;
    UpdatedAt: Date;
  }>(`SELECT FormCode, Environment, UpdatedBy, UpdatedAt FROM [dbo].[FormEnvironment]`);

  const byCode = new Map(flags.recordset.map((f) => [f.FormCode, f]));

  return forms.recordset.map((f) => {
    const flag = byCode.get(f.FormCode);
    return {
      formCode: f.FormCode,
      formNameEn: f.FormNameEn,
      formNameTh: f.FormNameTh,
      environment: normalize(flag?.Environment),
      updatedBy: flag?.UpdatedBy ?? null,
      updatedAt: flag?.UpdatedAt ?? null,
    };
  });
}
