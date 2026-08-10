import { getDataPool } from "@/lib/db/mssql";
import type { ProvinceOption } from "@/features/travel-booking/types";

/** Active Thai provinces (Fast_Data.dbo.TravelProvince, migration 049), ordered by Thai name. */
export async function listProvinces(): Promise<ProvinceOption[]> {
  const pool = await getDataPool();
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
