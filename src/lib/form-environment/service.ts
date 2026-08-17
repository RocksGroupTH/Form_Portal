import { cache } from "react";
import { getCorePool, getAppPool, sql } from "@/lib/db/mssql";
import { env } from "@/env";
import { PRODUCTION_ONLY, type FormSwitches } from "./pick-environment";

export type FormEnvironmentValue = "Production" | "UAT";

export interface FormEnvironmentRow {
  formCode: string;
  formNameEn: string;
  formNameTh: string;
  productionEnabled: boolean;
  uatEnabled: boolean;
  updatedBy: number | null;
  updatedAt: Date | null;
}

/** A row shape carrying the two switch columns, however the driver typed them. */
interface SwitchColumns {
  ProductionEnabled: boolean | number | null;
  UatEnabled: boolean | number | null;
}

/**
 * One BIT column as a boolean, falling back when the column is absent.
 *
 * Both columns are NOT NULL (migration 062), but a row written before that
 * migration ran — or a driver handing back 1/0 rather than true/false — must
 * still land on a definite answer rather than a coincidentally falsy one.
 */
function bit(value: boolean | number | null | undefined, fallback: boolean): boolean {
  return value === null || value === undefined ? fallback : !!value;
}

/** A FormEnvironment row's two switches; a missing row is PRODUCTION_ONLY. */
function toSwitches(row: SwitchColumns | undefined | null): FormSwitches {
  return {
    productionEnabled: bit(row?.ProductionEnabled, PRODUCTION_ONLY.productionEnabled),
    uatEnabled: bit(row?.UatEnabled, PRODUCTION_ONLY.uatEnabled),
  };
}

/**
 * Every configured form's two switches, keyed by form code. Forms with no row
 * are absent from the result, and callers treat a missing entry as
 * `PRODUCTION_ONLY` — live, and not open for testing.
 *
 * Reads Fast_Core, which never varies by environment — this is what breaks the
 * circular dependency that per-form routing would otherwise have.
 *
 * Wrapped in react `cache()` like `getActiveUatTester`: the resolver, the write
 * choke points and the merged-list filters all want it, so they share one read
 * per request instead of one each. Outside a request there is no dispatcher and
 * it simply reads through, which is what scripts want anyway.
 */
export const getFormSwitchMap = cache(async (): Promise<Record<string, FormSwitches>> => {
  const pool = await getCorePool();
  const r = await pool.request().query<{ FormCode: string } & SwitchColumns>(
    `SELECT FormCode, ProductionEnabled, UatEnabled FROM [dbo].[FormEnvironment]`,
  );
  const out: Record<string, FormSwitches> = {};
  for (const row of r.recordset) out[row.FormCode] = toSwitches(row);
  return out;
});

/**
 * Flip one switch on one form.
 *
 * Single-field on purpose: the two switches are independent, and a whole-row
 * write would let a stale copy of the other switch travel back with the one the
 * admin actually touched. `column` is picked from a two-value union, never
 * interpolated from caller input.
 *
 * `MERGE … WITH (HOLDLOCK)` makes the upsert atomic — the previous
 * UPDATE-then-INSERT could race two admins into a duplicate-key failure.
 *
 * The insert branch names `Environment` with a literal only because that legacy
 * column is still NOT NULL with no default (migrations/060_core_form_environment.sql:15)
 * and nothing reads it any more. `N'Production'` is one of the two values its
 * CK_FormEnvironment_Env check allows. **Delete `Environment` from this INSERT
 * list when migration 065 drops the column**, or the insert starts failing on a
 * column that no longer exists.
 */
export async function setFormFlag(
  formCode: string,
  field: "production" | "uat",
  value: boolean,
  userId: number,
): Promise<void> {
  const code = (formCode ?? "").trim();
  if (!code) throw new Error("formCode is required");
  const column = field === "production" ? "ProductionEnabled" : "UatEnabled";

  const pool = await getCorePool();
  await pool
    .request()
    .input("code", sql.NVarChar, code)
    .input("value", sql.Bit, value ? 1 : 0)
    .input("by", sql.Int, userId)
    .query(`
      MERGE [dbo].[FormEnvironment] WITH (HOLDLOCK) AS t
      USING (SELECT @code AS FormCode) AS s ON t.FormCode = s.FormCode
      WHEN MATCHED THEN UPDATE SET [${column}] = @value, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (FormCode, Environment, [${column}], UpdatedBy)
        VALUES (@code, N'Production', @value, @by);
    `);
}

/**
 * Every form in the catalogue with both of its switches.
 *
 * AccFormMaster lives in the form database, so this reads the production copy
 * explicitly rather than through getFormPool(): the settings page must show the
 * same catalogue no matter how the current route happens to route, and no
 * matter whether the admin looking at it is in UAT mode.
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

  const flags = await core.request().query<
    {
      FormCode: string;
      UpdatedBy: number | null;
      UpdatedAt: Date;
    } & SwitchColumns
  >(
    `SELECT FormCode, ProductionEnabled, UatEnabled, UpdatedBy, UpdatedAt FROM [dbo].[FormEnvironment]`,
  );

  const byCode = new Map(flags.recordset.map((f) => [f.FormCode, f]));

  return forms.recordset.map((f) => {
    const flag = byCode.get(f.FormCode);
    const switches = toSwitches(flag);
    return {
      formCode: f.FormCode,
      formNameEn: f.FormNameEn,
      formNameTh: f.FormNameTh,
      productionEnabled: switches.productionEnabled,
      uatEnabled: switches.uatEnabled,
      updatedBy: flag?.UpdatedBy ?? null,
      updatedAt: flag?.UpdatedAt ?? null,
    };
  });
}
