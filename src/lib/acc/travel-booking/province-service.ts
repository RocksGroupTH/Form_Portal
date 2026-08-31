import { getProductionFormPool, sql } from "@/lib/db/mssql";
import type { ProvinceOption } from "@/features/travel-booking/types";

/**
 * `Rocks_Portal_Form.dbo.TravelProvince` — AP-17's จังหวัด/เมือง master.
 *
 * ── One physical copy, and it is production's ──
 *
 * Migrations 104/105 moved this table out of `Fast_Data` into this app's own
 * database and left a permanent synonym behind, so the Rocks Fast and ACC Portal
 * siblings still reach the same rows two-part. `Rocks_Portal_Form_UAT` holds no
 * `TravelProvince` object **of any kind**, so every statement here opens
 * `getProductionFormPool()` and never `getFormPool()` / `getAccPool()` — the
 * latter resolve the UAT twin for a tester in UAT mode, where the object does
 * not exist and the read fails with `Invalid object name` rather than returning
 * nothing. `currency-pool-guard.test.ts` enforces that per file.
 *
 * For the same reason nothing here goes through `writeBothPools`: there is no
 * second side, and a dual write would fail against a database with no such
 * table.
 *
 * ── The rows are shared with Rocks Fast ──
 *
 * That sibling selects `Id, NameTh, NameEn ... WHERE IsActive = 1` with **no
 * country filter**, so a row added here appears in its own จังหวัด dropdown.
 * Migration 132's header carries the full account, the settings panel says so in
 * Thai, and the remedy — one `AND CountryCode = 'TH'` in that repository —
 * belongs to whoever owns it. Nothing in this repository can see or enforce it.
 */

/** ISO-3166-1 alpha-2 for Thailand — the country every pre-2026-08-31 row has. */
export const THAILAND = "TH";

export interface ProvinceAdminRow extends ProvinceOption {
  countryCode: string;
  isActive: boolean;
}

/** Active places, ordered by Thai name — the form and report pickers. */
export async function listProvinces(): Promise<ProvinceOption[]> {
  const pool = await getProductionFormPool();
  const r = await pool.request().query(`
    SELECT Id, NameTh, NameEn, CountryCode
    FROM [dbo].[TravelProvince]
    WHERE IsActive = 1
    ORDER BY NameTh
  `);
  return r.recordset.map(mapOption);
}

/** Every row, active or not — the admin grid. */
export async function listAllProvinces(): Promise<ProvinceAdminRow[]> {
  const pool = await getProductionFormPool();
  const r = await pool.request().query(`
    SELECT Id, NameTh, NameEn, CountryCode, IsActive
    FROM [dbo].[TravelProvince]
    ORDER BY CountryCode, NameTh
  `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    ...mapOption(x),
    isActive: !!x.IsActive,
  }));
}

/**
 * Insert or update one place.
 *
 * `NameTh` carries a unique constraint (`UQ_TravelProvince_NameTh`, migration
 * 104), which migration 132 deliberately did **not** widen to include the
 * country — so two cities in different countries cannot share a Thai name. That
 * is a real limit and it is caught here, as a named conflict rather than a
 * driver error, so the panel can say which row already holds the name.
 */
export async function upsertProvince(row: {
  id?: number | null;
  nameTh: string;
  nameEn?: string | null;
  countryCode: string;
  isActive?: boolean;
}): Promise<{ ok: true } | { ok: false; conflict: string }> {
  const pool = await getProductionFormPool();
  const nameTh = row.nameTh.trim();
  const nameEn = (row.nameEn ?? "").trim() || null;
  const country = row.countryCode.trim().toUpperCase();

  const dup = await pool
    .request()
    .input("nameTh", sql.NVarChar(100), nameTh)
    .input("id", sql.Int, row.id ?? null)
    .query(`SELECT TOP 1 Id FROM [dbo].[TravelProvince]
            WHERE NameTh = @nameTh AND (@id IS NULL OR Id <> @id)`);
  if (dup.recordset.length > 0) return { ok: false, conflict: nameTh };

  const req = pool
    .request()
    .input("nameTh", sql.NVarChar(100), nameTh)
    .input("nameEn", sql.NVarChar(100), nameEn)
    .input("country", sql.Char(2), country);

  if (row.id) {
    await req
      .input("id", sql.Int, row.id)
      .query(`UPDATE [dbo].[TravelProvince]
              SET NameTh = @nameTh, NameEn = @nameEn, CountryCode = @country
              WHERE Id = @id`);
  } else {
    await req
      .input("isActive", sql.Bit, row.isActive === false ? 0 : 1)
      .query(`INSERT INTO [dbo].[TravelProvince] (NameTh, NameEn, CountryCode, IsActive)
              VALUES (@nameTh, @nameEn, @country, @isActive)`);
  }
  return { ok: true };
}

/**
 * The soft delete. There is deliberately no hard one: a place is referenced by
 * `AccTravelBooking.ProvinceId` on every trip ever filed to it, and the report
 * filters on that id.
 */
export async function setProvinceActive(id: number, isActive: boolean): Promise<void> {
  const pool = await getProductionFormPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("isActive", sql.Bit, isActive ? 1 : 0)
    .query(`UPDATE [dbo].[TravelProvince] SET IsActive = @isActive WHERE Id = @id`);
}

/**
 * One place's Thai name, for stamping onto a booking.
 *
 * Moved here from `request-service.ts` on 2026-08-31. That file imports
 * `getAccPool`, so it held real SQL naming a production-only table inside a
 * module that also carries the environment-varying pool — the exact adjacency
 * `currency-pool-guard.test.ts` exists to prevent, and the one place it did not
 * cover. The caller's transaction may be the UAT twin; this always resolves
 * against production, which is where the single copy lives.
 */
export async function resolveProvinceName(id: number | null): Promise<string | null> {
  if (!id) return null;
  const pool = await getProductionFormPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT TOP 1 NameTh FROM [dbo].[TravelProvince] WHERE Id=@id`);
  return (r.recordset[0]?.NameTh as string) ?? null;
}

function mapOption(x: Record<string, unknown>): ProvinceOption & { countryCode: string } {
  return {
    id: x.Id as number,
    nameTh: x.NameTh as string,
    nameEn: (x.NameEn as string) ?? null,
    countryCode: ((x.CountryCode as string) ?? THAILAND).trim().toUpperCase(),
  };
}
