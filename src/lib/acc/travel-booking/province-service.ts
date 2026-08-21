import { getProductionFormPool } from "@/lib/db/mssql";
import type { ProvinceOption } from "@/features/travel-booking/types";

/** Active Thai provinces (Rocks_Portal_Form.dbo.TravelProvince, migration 104), ordered by Thai name. */
export async function listProvinces(): Promise<ProvinceOption[]> {
  // TravelProvince moved to Rocks_Portal_Form in migrations 104/105; Fast_Data
  // keeps a synonym for the Rocks Fast and ACC Portal siblings. This app names
  // the new home directly. getProductionFormPool() and never getFormPool():
  // there is one physical copy, so the environment-varying pool has nothing to
  // choose between.
  const pool = await getProductionFormPool();
  const r = await pool.request().query(`
    SELECT Id, NameTh, NameEn
    FROM [dbo].[TravelProvince]
    WHERE IsActive = 1
    ORDER BY NameTh
  `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    nameTh: x.NameTh as string,
    nameEn: (x.NameEn as string) ?? null,
  }));
}
