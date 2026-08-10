import { getCorePool, sql } from "@/lib/db/mssql";

/** Read a system-wide setting value from Fast_Core.AppSetting. */
export async function getAppSetting(key: string): Promise<string | null> {
  const pool = await getCorePool();
  const r = await pool.request().input("key", sql.NVarChar, key)
    .query(`SELECT SettingValue FROM [dbo].[AppSetting] WHERE SettingKey = @key`);
  const v = r.recordset[0]?.SettingValue as string | null | undefined;
  return v ?? null;
}

/** Upsert a system-wide setting value into Fast_Core.AppSetting. */
export async function setAppSetting(key: string, value: string | null, userId: number): Promise<void> {
  const pool = await getCorePool();
  await pool.request()
    .input("key", sql.NVarChar, key)
    .input("value", sql.NVarChar, value)
    .input("user", sql.Int, userId || null)
    .query(`MERGE [dbo].[AppSetting] AS t USING (SELECT @key AS SettingKey) AS s
            ON t.SettingKey = s.SettingKey
            WHEN MATCHED THEN UPDATE SET SettingValue=@value, UpdatedBy=@user, UpdatedAt=SYSDATETIME()
            WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy)
            VALUES (@key, @value, @user);`);
}
