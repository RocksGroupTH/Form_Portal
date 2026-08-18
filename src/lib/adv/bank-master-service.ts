import { getAccPool, sql } from "@/lib/adv/pool";

export interface BankOption {
  bankCode: string;
  bankName: string;
}

export interface BankMasterRow {
  id: number;
  bankCode: string;
  bankName: string;
  isActive: boolean;
  sortOrder: number;
}

/** Active banks from AccBankMaster (AP2.1) for the payee-bank dropdown. */
export async function listBanks(): Promise<BankOption[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT BankCode, BankName FROM [dbo].[AccBankMaster]
    WHERE IsActive = 1
    ORDER BY SortOrder, BankName`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    bankCode: x.BankCode as string,
    bankName: x.BankName as string,
  }));
}

/** All banks (including inactive) for the Master setup page. */
export async function listAllBanks(): Promise<BankMasterRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, BankCode, BankName, IsActive, SortOrder FROM [dbo].[AccBankMaster]
    ORDER BY SortOrder, BankName`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    bankCode: x.BankCode as string,
    bankName: x.BankName as string,
    isActive: !!x.IsActive,
    sortOrder: (x.SortOrder as number) ?? 0,
  }));
}

/**
 * Add or update a bank. Keyed on Id when given, else on BankCode (idempotent).
 * COALESCE preserves omitted fields so an active-toggle can send just
 * { id, isActive }.
 */
export async function upsertBank(b: {
  id?: number;
  bankCode?: string;
  bankName?: string;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<void> {
  const pool = await getAccPool();
  const req = pool
    .request()
    .input("code", sql.NVarChar, b.bankCode ?? null)
    .input("name", sql.NVarChar, b.bankName ?? null)
    .input("active", sql.Bit, b.isActive === undefined ? null : b.isActive ? 1 : 0)
    .input("sort", sql.Int, b.sortOrder ?? null);
  if (b.id) {
    req.input("id", sql.Int, b.id);
    await req.query(`UPDATE [dbo].[AccBankMaster] SET
      BankCode = COALESCE(@code, BankCode),
      BankName = COALESCE(@name, BankName),
      IsActive = COALESCE(@active, IsActive),
      SortOrder = COALESCE(@sort, SortOrder),
      UpdatedAt = SYSDATETIME() WHERE Id=@id`);
  } else {
    await req.query(`MERGE [dbo].[AccBankMaster] AS t USING (SELECT @code AS BankCode) AS s ON t.BankCode=s.BankCode
      WHEN MATCHED THEN UPDATE SET BankName=COALESCE(@name,t.BankName), IsActive=COALESCE(@active,t.IsActive),
        SortOrder=COALESCE(@sort,t.SortOrder), UpdatedAt=SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (BankCode,BankName,IsActive,SortOrder)
      VALUES (@code,@name,COALESCE(@active,1),COALESCE(@sort,999));`);
  }
}

/** Hard-remove a bank row. */
export async function deleteBank(id: number): Promise<void> {
  const pool = await getAccPool();
  await pool.request().input("id", sql.Int, id)
    .query(`DELETE FROM [dbo].[AccBankMaster] WHERE Id=@id`);
}
