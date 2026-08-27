import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const { closeDatabasePools, getErpDataPool } = await import("@/lib/db/mssql");
  try {
    const pool = await getErpDataPool();
    const result = await pool.request().query(`
      WITH LatestSuccess AS (
        SELECT BrandCode, RowsUpserted, FinishedAt,
               ROW_NUMBER() OVER (PARTITION BY BrandCode ORDER BY FinishedAt DESC, Id DESC) AS rn
        FROM dbo.ErpSyncLog
        WHERE SyncType = N'VENDORS' AND Status = N'success'
      ), VendorCounts AS (
        SELECT BrandCode,
               COUNT_BIG(1) AS TotalRows,
               SUM(CASE WHEN IsActive = 1 THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END) AS ActiveRows,
               SUM(CASE WHEN IsActive = 1 AND IsBlocked = 1 THEN CONVERT(BIGINT, 1) ELSE CONVERT(BIGINT, 0) END) AS BlockedRows,
               COUNT_BIG(DISTINCT BcCompanyId) AS CompanyCount
        FROM dbo.ErpVendors
        WHERE SourceEnvironment = N'Production'
        GROUP BY BrandCode
      )
      SELECT c.BrandCode, c.TotalRows, c.ActiveRows, c.BlockedRows, c.CompanyCount,
             l.RowsUpserted AS LatestRowsUpserted, l.FinishedAt
      FROM VendorCounts c
      LEFT JOIN LatestSuccess l ON l.BrandCode = c.BrandCode AND l.rn = 1
      ORDER BY c.BrandCode;

      SELECT
        (SELECT COUNT_BIG(1) FROM (
          SELECT SourceEnvironment, BrandCode, VendorNo
          FROM dbo.ErpVendors
          GROUP BY SourceEnvironment, BrandCode, VendorNo
          HAVING COUNT_BIG(1) > 1
        ) d) AS DuplicateBusinessKeys,
        (SELECT COUNT_BIG(1)
         FROM dbo.ErpVendors
         WHERE SourceEnvironment = N'Production'
           AND (BrandCode = N'' OR BcCompanyId = N'' OR VendorNo = N'')) AS BlankRequiredKeys,
        (SELECT COUNT_BIG(1)
         FROM dbo.ErpVendors
         WHERE SourceEnvironment = N'Production'
           AND IsBlocked = 1 AND BlockedStatus = N'_x0020_') AS EncodedBlankBlockedRows,
        (SELECT COUNT_BIG(1)
         FROM sys.columns
         WHERE object_id = OBJECT_ID('dbo.ErpVendors')
           AND name IN (N'BcVendorId', N'Irs1099Code', N'PaymentTermsId', N'PaymentMethodId'))
          AS RemovedColumnsStillPresent;

      SELECT COALESCE(BlockedStatus, N'<NULL>') AS BlockedStatus, COUNT_BIG(1) AS Rows
      FROM dbo.ErpVendors
      WHERE SourceEnvironment = N'Production' AND IsActive = 1
      GROUP BY BlockedStatus
      ORDER BY Rows DESC;
    `);

    const recordsets = result.recordsets as unknown as Array<Array<Record<string, unknown>>>;
    const counts = recordsets[0];
    const integrity = recordsets[1][0];
    const blockedDistribution = recordsets[2];
    console.log(JSON.stringify({ counts, integrity, blockedDistribution }, null, 2));

    const countMismatch = counts.some((row) => Number(row.ActiveRows) !== Number(row.LatestRowsUpserted));
    const integrityFailed = Object.values(integrity).some((value) => Number(value) !== 0);
    if (countMismatch || integrityFailed) process.exitCode = 1;
  } finally {
    await closeDatabasePools();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "ErpVendors verification failed");
  process.exitCode = 1;
});
