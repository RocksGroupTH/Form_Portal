import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import {
  loadInterfaceBrandsByApproverIds,
  setApproverInterfaceBrands,
} from "@/lib/acc/approver-interface-access";
import type {
  AccApproverRow,
  AccVehicle,
  AccSameDayBrandRow,
} from "@/features/accounting/types";

/* ---- Vehicles ---- */
export async function listVehicles(activeOnly = false): Promise<AccVehicle[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, Name, RatePerKm, IsManualEntry, IsActive, SortOrder, Icon
    FROM [dbo].[AccVehicle] ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY SortOrder, Name
  `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    name: x.Name as string,
    ratePerKm: (x.RatePerKm as number) ?? null,
    isManualEntry: !!x.IsManualEntry,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
    icon: (x.Icon as string) ?? null,
  }));
}

export async function upsertVehicle(
  v: Partial<AccVehicle> & { name: string; isManualEntry: boolean },
  userId: number,
): Promise<void> {
  if (!v.isManualEntry && (v.ratePerKm == null || v.ratePerKm < 1)) {
    throw new Error("RatePerKm must be >= 1 when not manual entry");
  }
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("name", sql.NVarChar, v.name)
      .input("rate", sql.Decimal(18, 2), v.isManualEntry ? null : v.ratePerKm)
      .input("manual", sql.Bit, v.isManualEntry ? 1 : 0)
      .input("active", sql.Bit, v.isActive === false ? 0 : 1)
      .input("sort", sql.Int, v.sortOrder ?? 0)
      .input("icon", sql.NVarChar, v.icon ?? null)
      .input("user", sql.Int, userId || null);
    if (v.id) {
      req.input("id", sql.Int, v.id);
      await req.query(`UPDATE [dbo].[AccVehicle] SET Name=@name, RatePerKm=@rate,
        IsManualEntry=@manual, IsActive=@active, SortOrder=@sort, Icon=@icon, UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`INSERT INTO [dbo].[AccVehicle] (Name,RatePerKm,IsManualEntry,IsActive,SortOrder,Icon,CreatedBy)
        VALUES (@name,@rate,@manual,@active,@sort,@icon,@user)`);
    }
  });
}

/** Persist a new vehicle display order (SortOrder = position in the array). */
export async function reorderVehicles(orderedIds: number[]): Promise<void> {
  if (!orderedIds.length) return;
  await writeBothPools(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .request()
        .input("id", sql.Int, orderedIds[i])
        .input("sort", sql.Int, i)
        .query(
          `UPDATE [dbo].[AccVehicle] SET SortOrder=@sort, UpdatedAt=SYSDATETIME() WHERE Id=@id`,
        );
    }
  });
}

/* ---- Approvers ---- */
export async function listApprovers(
  activeOnly = false,
): Promise<AccApproverRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive, PhotoUrl FROM [dbo].[AccApprover]
    ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY DisplayName, Email
  `);
  const rows = r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    staffId: (x.StaffId as number) ?? null,
    email: x.Email as string,
    displayName: (x.DisplayName as string) ?? null,
    isActive: !!x.IsActive,
    photoUrl: (x.PhotoUrl as string) ?? null,
  }));
  const brandMap = await loadInterfaceBrandsByApproverIds(
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    ...row,
    interfaceBrandCodes: brandMap.get(row.id) ?? null,
  }));
}

export async function getApproverIdByEmail(
  email: string,
): Promise<number | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(`SELECT Id FROM [dbo].[AccApprover] WHERE Email = @email`);
  const id = r.recordset[0]?.Id as number | undefined;
  return id ?? null;
}

export { setApproverInterfaceBrands };

export async function upsertApprover(
  a: {
    id?: number;
    staffId?: number | null;
    email?: string;
    displayName?: string | null;
    isActive?: boolean;
    photoUrl?: string | null;
  },
  userId: number,
): Promise<void> {
  await writeBothPools(async (tx) => {
    // COALESCE preserves existing values when a field is omitted (e.g. an
    // active-toggle sends only { id, isActive } — Email must NOT be nulled out).
    const req = tx
      .request()
      .input("staff", sql.Int, a.staffId ?? null)
      .input("email", sql.NVarChar, a.email ?? null)
      .input("name", sql.NVarChar, a.displayName ?? null)
      .input("photo", sql.NVarChar, a.photoUrl ?? null)
      .input(
        "active",
        sql.Bit,
        a.isActive === undefined ? null : a.isActive ? 1 : 0,
      )
      .input("user", sql.Int, userId || null);
    if (a.id) {
      req.input("id", sql.Int, a.id);
      await req.query(`UPDATE [dbo].[AccApprover] SET
        StaffId = COALESCE(@staff, StaffId),
        Email = COALESCE(@email, Email),
        DisplayName = COALESCE(@name, DisplayName),
        PhotoUrl = COALESCE(@photo, PhotoUrl),
        IsActive = COALESCE(@active, IsActive),
        UpdatedAt = SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`MERGE [dbo].[AccApprover] AS t USING (SELECT @email AS Email) AS s ON t.Email=s.Email
        WHEN MATCHED THEN UPDATE SET StaffId=COALESCE(@staff,t.StaffId), DisplayName=COALESCE(@name,t.DisplayName),
          PhotoUrl=COALESCE(@photo,t.PhotoUrl), IsActive=COALESCE(@active,t.IsActive), UpdatedAt=SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (StaffId,Email,DisplayName,PhotoUrl,IsActive,CreatedBy)
        VALUES (@staff,@email,@name,@photo,COALESCE(@active,1),@user);`);
    }
  });
}

/* ---- Form brands ---- */
export async function listFormBrands(
  formCode: string,
): Promise<
  { id: number; brandCode: string; isActive: boolean; sortOrder: number }[]
> {
  const pool = await getAccPool();
  const r = await pool.request().input("form", sql.NVarChar, formCode).query(`
    SELECT Id, BrandCode, IsActive, SortOrder FROM [dbo].[AccFormBrand]
    WHERE FormCode = @form ORDER BY SortOrder, BrandCode
  `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
  }));
}

export async function setFormBrands(
  formCode: string,
  brandCodes: string[],
): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("form", sql.NVarChar, formCode)
      .query(
        `UPDATE [dbo].[AccFormBrand] SET IsActive = 0 WHERE FormCode = @form`,
      );
    for (let i = 0; i < brandCodes.length; i++) {
      await tx
        .request()
        .input("form", sql.NVarChar, formCode)
        .input("brand", sql.NVarChar, brandCodes[i])
        .input("sort", sql.Int, i).query(`MERGE [dbo].[AccFormBrand] AS t
          USING (SELECT @form AS FormCode, @brand AS BrandCode) AS s
          ON t.FormCode=s.FormCode AND t.BrandCode=s.BrandCode
          WHEN MATCHED THEN UPDATE SET IsActive=1, SortOrder=@sort
          WHEN NOT MATCHED THEN INSERT (FormCode,BrandCode,IsActive,SortOrder)
          VALUES (@form,@brand,1,@sort);`);
    }
  });
}

/* ---- Generic key-value settings (AccSetting) ---- */
export async function getSetting(key: string): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("key", sql.NVarChar, key)
    .query(
      `SELECT SettingValue FROM [dbo].[AccSetting] WHERE SettingKey = @key`,
    );
  const v = r.recordset[0]?.SettingValue as string | null | undefined;
  return v ?? null;
}

const MERGE_ACC_SETTING = `MERGE [dbo].[AccSetting] AS t USING (SELECT @key AS SettingKey) AS s
            ON t.SettingKey = s.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue=@value, UpdatedBy=@user, UpdatedAt=SYSDATETIME()
            WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy)
            VALUES (@key, @value, @user);`;

/**
 * Keys that are per-database by design and must never be dual-written.
 *
 * ERP_INTERFACE_ENV is a leftover: nothing reads AccSetting's copy any more —
 * the BC environment comes from the form's Form Environment flag
 * (src/lib/acc/erp-environment.ts). The guard stays so a stale value cannot
 * start propagating between the two databases if something reads it again.
 */
const ENVIRONMENT_SPECIFIC_KEYS = new Set(["ERP_INTERFACE_ENV"]);

export async function setSetting(
  key: string,
  value: string | null,
  userId: number,
): Promise<void> {
  if (ENVIRONMENT_SPECIFIC_KEYS.has(key)) {
    const pool = await getAccPool();
    await pool
      .request()
      .input("key", sql.NVarChar, key)
      .input("value", sql.NVarChar, value)
      .input("user", sql.Int, userId || null)
      .query(MERGE_ACC_SETTING);
    return;
  }
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("key", sql.NVarChar, key)
      .input("value", sql.NVarChar, value)
      .input("user", sql.Int, userId || null)
      .query(MERGE_ACC_SETTING);
  });
}

/* ---- Same-day multi-brand allowlist ---- */
export async function listSameDayBrandStaff(): Promise<AccSameDayBrandRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive
    FROM [dbo].[AccSameDayBrandStaff] ORDER BY DisplayName, Email
  `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    staffId: (x.StaffId as number) ?? null,
    email: (x.Email as string) ?? null,
    displayName: (x.DisplayName as string) ?? null,
    isActive: !!x.IsActive,
  }));
}

export async function upsertSameDayBrandStaff(
  a: {
    id?: number;
    staffId?: number | null;
    email?: string | null;
    displayName?: string | null;
    isActive?: boolean;
  },
  userId: number,
): Promise<void> {
  if (!a.id && a.staffId == null) {
    throw new Error("staffId is required to add a same-day-brand entry");
  }
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("staff", sql.Int, a.staffId ?? null)
      .input("email", sql.NVarChar, a.email ?? null)
      .input("name", sql.NVarChar, a.displayName ?? null)
      .input(
        "active",
        sql.Bit,
        a.isActive === undefined ? null : a.isActive ? 1 : 0,
      )
      .input("user", sql.Int, userId || null);
    if (a.id) {
      req.input("id", sql.Int, a.id);
      await req.query(`UPDATE [dbo].[AccSameDayBrandStaff] SET
        StaffId = COALESCE(@staff, StaffId),
        Email = COALESCE(@email, Email),
        DisplayName = COALESCE(@name, DisplayName),
        IsActive = COALESCE(@active, IsActive),
        UpdatedAt = SYSDATETIME() WHERE Id=@id`);
    } else {
      await req.query(`MERGE [dbo].[AccSameDayBrandStaff] AS t USING (SELECT @staff AS StaffId) AS s ON t.StaffId=s.StaffId
        WHEN MATCHED THEN UPDATE SET Email=COALESCE(@email,t.Email), DisplayName=COALESCE(@name,t.DisplayName),
          IsActive=COALESCE(@active,t.IsActive), UpdatedAt=SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT (StaffId,Email,DisplayName,IsActive,CreatedBy)
        VALUES (@staff,@email,@name,COALESCE(@active,1),@user);`);
    }
  });
}

export async function removeSameDayBrandStaff(id: number): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccSameDayBrandStaff] WHERE Id = @id`);
  });
}
