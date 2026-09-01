/** Sync Business Central vendors into Rocks_ERP_Data.ErpVendors via RPCCodexStore_CodexGetVendors. */

import type { Transaction } from "mssql";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  postBcCodexStoreRpc,
  buildBcApiV2CompanyEntityUrl,
  fetchBcApiV2Collection,
} from "@/lib/bc/bc-odata";
import { getBcConnectionById } from "@/lib/bc/bc-connection";
import { getBrandConfig } from "@/lib/brand-config";
import { getErpDataPool, sql } from "@/lib/db/mssql";

/** Shape returned by RPCCodexStore_CodexGetVendors */
interface CodexVendorRow {
  no: string;
  name: string;
  searchName: string;
  address: string;
  city: string;
  postCode: string;
  phoneNo: string;
  contact: string;
  vendorPostingGroup: string;
  genBusPostingGroup: string;
  vatBusPostingGroup: string;
  paymentTermsCode: string;
  currencyCode: string;
  blocked: string;
  privacyBlocked: boolean;
  lastDateModified: string;
}

interface NormalizedCodexVendor {
  vendorNo: string;
  displayName: string | null;
  vendorPostingGroup: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  phoneNumber: string | null;
  currencyCode: string | null;
  isBlocked: boolean;
  bcLastModified: Date | null;
}

function normalizeCodexVendors(rows: CodexVendorRow[]): NormalizedCodexVendor[] {
  const byNo = new Map<string, NormalizedCodexVendor>();
  for (const r of rows) {
    const vendorNo = (r.no ?? "").trim();
    if (!vendorNo) continue;
    const t = (v: string | null | undefined): string | null => {
      const s = (v ?? "").trim();
      return s ? s : null;
    };
    let bcLastModified: Date | null = null;
    if (r.lastDateModified) {
      const d = new Date(r.lastDateModified);
      if (!Number.isNaN(d.getTime())) bcLastModified = d;
    }
    byNo.set(vendorNo.toUpperCase(), {
      vendorNo,
      displayName: t(r.name) ?? vendorNo,
      vendorPostingGroup: (r.vendorPostingGroup ?? "").trim().toUpperCase() || null,
      addressLine1: t(r.address),
      city: t(r.city),
      postalCode: t(r.postCode),
      phoneNumber: t(r.phoneNo),
      currencyCode: t(r.currencyCode),
      // Blocked in BC, or PDPA privacy-blocked → not selectable for payment.
      isBlocked: (r.blocked ?? "").trim() !== "" || r.privacyBlocked === true,
      bcLastModified,
    });
  }
  return Array.from(byNo.values());
}

export const ERP_VENDOR_SYNC_TYPE = "VENDORS";
export const ERP_VENDOR_SOURCE_ENVIRONMENT = "Production";

interface BrandVendorSyncContext {
  brandCode: string;
  bcCompanyId: string;
  bcCompanyName: string;
  bcConnectionId: number;
  baseUrl: string;
}

export interface VendorSyncResult {
  brandCode: string;
  vendorRows: number;
  syncedAt: string;
}

async function resolveBrandVendorSyncContext(brandCode: string): Promise<BrandVendorSyncContext> {
  const code = brandCode.trim().toUpperCase();
  const brand = await getBrandConfig(code);
  if (!brand) throw new Error(`Brand ${code} is not configured`);
  if (!brand.bcId?.trim()) throw new Error(`Brand ${code} has no BC company id`);
  if (!brand.bcName?.trim()) throw new Error(`Brand ${code} has no BC company name`);
  if (!brand.bcConnectionId) throw new Error(`Brand ${code} has no BC connection`);

  const connection = await getBcConnectionById(brand.bcConnectionId);
  if (!connection?.IsActive) throw new Error(`BC connection for ${code} is not active`);

  return {
    brandCode: code,
    bcCompanyId: brand.bcId.trim(),
    bcCompanyName: brand.bcName.trim(),
    bcConnectionId: brand.bcConnectionId,
    baseUrl: connection.BaseUrl,
  };
}

async function writeVendor(
  transaction: Transaction,
  ctx: BrandVendorSyncContext,
  vendor: NormalizedCodexVendor,
  snapshotAt: Date,
): Promise<void> {
  await new sql.Request(transaction)
    .input("environment", sql.NVarChar, ERP_VENDOR_SOURCE_ENVIRONMENT)
    .input("brand", sql.NVarChar, ctx.brandCode)
    .input("companyId", sql.NVarChar, ctx.bcCompanyId)
    .input("companyName", sql.NVarChar, ctx.bcCompanyName)
    .input("connectionId", sql.Int, ctx.bcConnectionId)
    .input("vendorNo", sql.NVarChar, vendor.vendorNo)
    .input("displayName", sql.NVarChar, vendor.displayName)
    .input("address1", sql.NVarChar, vendor.addressLine1)
    .input("city", sql.NVarChar, vendor.city)
    .input("postal", sql.NVarChar, vendor.postalCode)
    .input("phone", sql.NVarChar, vendor.phoneNumber)
    .input("currencyCode", sql.NVarChar, vendor.currencyCode)
    .input("vendorPostingGroup", sql.NVarChar, vendor.vendorPostingGroup)
    .input("isBlocked", sql.Bit, vendor.isBlocked ? 1 : 0)
    .input("bcLastModified", sql.DateTime2, vendor.bcLastModified)
    .input("snapshotAt", sql.DateTime2, snapshotAt)
    .query(`
      MERGE [dbo].[ErpVendors] WITH (HOLDLOCK) AS target
      USING (SELECT
        @environment AS SourceEnvironment,
        @brand AS BrandCode,
        @vendorNo AS VendorNo
      ) AS source
      ON target.SourceEnvironment = source.SourceEnvironment
        AND target.BrandCode = source.BrandCode
        AND target.VendorNo = source.VendorNo
      WHEN MATCHED THEN UPDATE SET
        BrandCode = @brand,
        BcCompanyId = @companyId,
        BcCompanyName = @companyName,
        BcConnectionId = @connectionId,
        VendorNo = @vendorNo,
        DisplayName = @displayName,
        AddressLine1 = @address1,
        City = @city,
        PostalCode = @postal,
        PhoneNumber = @phone,
        CurrencyCode = @currencyCode,
        VendorPostingGroup = @vendorPostingGroup,
        IsBlocked = @isBlocked,
        BcLastModified = @bcLastModified,
        IsActive = 1,
        SourceDeletedAt = NULL,
        SyncedAt = @snapshotAt
      WHEN NOT MATCHED THEN INSERT (
        SourceEnvironment, BrandCode, BcCompanyId, BcCompanyName, BcConnectionId,
        VendorNo, DisplayName, AddressLine1, City, PostalCode, PhoneNumber,
        CurrencyCode, VendorPostingGroup, IsBlocked, BcLastModified, IsActive,
        SourceDeletedAt, SyncedAt
      ) VALUES (
        @environment, @brand, @companyId, @companyName, @connectionId,
        @vendorNo, @displayName, @address1, @city, @postal, @phone,
        @currencyCode, @vendorPostingGroup, @isBlocked, @bcLastModified, 1,
        NULL, @snapshotAt
      );
    `);
}

async function insertVendorSyncLog(
  brandCode: string,
  status: "success" | "failed",
  rows: number,
  errorMessage: string | null,
  triggeredBy: number | null,
  startedAt: Date,
): Promise<void> {
  const pool = await getErpDataPool();
  await pool.request()
    .input("syncType", sql.NVarChar, ERP_VENDOR_SYNC_TYPE)
    .input("brand", sql.NVarChar, brandCode)
    .input("status", sql.NVarChar, status)
    .input("rows", sql.Int, rows)
    .input("error", sql.NVarChar, errorMessage?.slice(0, 1500) ?? null)
    .input("started", sql.DateTime2, startedAt)
    .input("triggeredBy", sql.Int, triggeredBy)
    .query(`
      INSERT INTO [dbo].[ErpSyncLog]
        (SyncType, BrandCode, Status, RowsUpserted, ErrorMessage, StartedAt, FinishedAt, TriggeredBy)
      VALUES
        (@syncType, @brand, @status, @rows, @error, @started, SYSDATETIME(), @triggeredBy)
    `);
}

/**
 * Copy each vendor's "Home Page" into `ErpVendors.Website`.
 *
 * Home Page is a standard BC Vendor field that Standard API v2.0 exposes as
 * `website`; accounting puts the employee's staff code there so AP-2 can match
 * an employee payee by code instead of by name. The custom RPC that drives the
 * rest of this sync does not return it, so this second, `$select`-narrowed call
 * fetches only what it needs and writes only that one column.
 *
 * Deliberately non-fatal: unlike the posting group, which the ADV filter cannot
 * work without, Home Page is an optional matching aid. A failure here leaves the
 * previous values in place and the sync still counts as a success.
 */
async function enrichVendorHomePages(ctx: BrandVendorSyncContext): Promise<number> {
  const url = `${buildBcApiV2CompanyEntityUrl(
    ctx.baseUrl,
    ctx.bcCompanyId,
    "vendors",
    ERP_VENDOR_SOURCE_ENVIRONMENT,
  )}?$select=number,website`;

  const rows = await fetchBcApiV2Collection<{ number?: string; website?: string }>(
    ctx.bcConnectionId,
    url,
  );

  // Report what BC actually returned, not just what changed. Without this an
  // update count of 0 is ambiguous: it reads the same whether nobody has filled
  // a Home Page in yet or the field is being read wrongly and always arrives
  // empty — and the skip-if-unchanged rule below hides the difference.
  const withHomePage = rows.filter((r) => (r.website ?? "").trim() !== "").length;
  console.info(
    `[vendor-sync] ${ctx.brandCode}: BC returned ${rows.length} vendor(s), ${withHomePage} with a Home Page`,
  );

  const pool = await getErpDataPool();
  const existing = await pool.request()
    .input("environment", sql.NVarChar, ERP_VENDOR_SOURCE_ENVIRONMENT)
    .input("brand", sql.NVarChar, ctx.brandCode)
    .query(`
      SELECT VendorNo, Website FROM [dbo].[ErpVendors]
      WHERE SourceEnvironment = @environment AND BrandCode = @brand
    `);
  const current = new Map<string, string | null>();
  for (const row of existing.recordset as { VendorNo: string; Website: string | null }[]) {
    current.set(row.VendorNo.trim().toUpperCase(), row.Website);
  }

  let updated = 0;
  for (const row of rows) {
    const vendorNo = (row.number ?? "").trim();
    if (!vendorNo) continue;
    const website = (row.website ?? "").trim() || null;
    const key = vendorNo.toUpperCase();
    // Only vendors this sync actually wrote, and only when the value moved.
    if (!current.has(key) || current.get(key) === website) continue;
    const res = await pool.request()
      .input("environment", sql.NVarChar, ERP_VENDOR_SOURCE_ENVIRONMENT)
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("no", sql.NVarChar, vendorNo)
      .input("website", sql.NVarChar, website)
      .query(`
        UPDATE [dbo].[ErpVendors]
        SET Website = @website
        WHERE SourceEnvironment = @environment AND BrandCode = @brand AND VendorNo = @no
      `);
    updated += res.rowsAffected[0] ?? 0;
  }
  return updated;
}

export async function syncBrandErpVendors(
  brandCode: string,
  triggeredBy: number | null,
): Promise<VendorSyncResult> {
  const startedAt = new Date();
  const ctx = await resolveBrandVendorSyncContext(brandCode);
  const pool = await getErpDataPool();
  const transaction = new sql.Transaction(pool);
  let transactionOpen = false;
  let vendorRows = 0;
  let homePageNote: string | null = null;
  let snapshotAt = startedAt;

  try {
    await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    transactionOpen = true;
    const lock = await new sql.Request(transaction)
      .input("resource", sql.NVarChar, `erp-vendors:${ERP_VENDOR_SOURCE_ENVIRONMENT}:${ctx.brandCode}`)
      .query(`
        DECLARE @lockResult INT;
        EXEC @lockResult = sys.sp_getapplock
          @Resource = @resource,
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 0;
        SELECT @lockResult AS LockResult;
      `);
    const lockResult = Number(lock.recordset[0]?.LockResult ?? -999);
    if (lockResult < 0) throw new Error(`Vendor sync for ${ctx.brandCode} is already running`);

    // Serialize before fetching so an older snapshot can never publish after a newer one.
    // No target row is touched until the single RPC call has succeeded.
    const rawRows = await postBcCodexStoreRpc<CodexVendorRow>(
      ctx.bcConnectionId,
      ctx.bcCompanyId,
      ERP_VENDOR_SOURCE_ENVIRONMENT,
      ctx.baseUrl,
      "RPCCodexStore_CodexGetVendors",
      [],
    );
    const vendors = normalizeCodexVendors(rawRows);
    const active = await new sql.Request(transaction)
      .input("environment", sql.NVarChar, ERP_VENDOR_SOURCE_ENVIRONMENT)
      .input("brand", sql.NVarChar, ctx.brandCode)
      .query(`
        SELECT COUNT_BIG(1) AS ActiveRows
        FROM [dbo].[ErpVendors]
        WHERE SourceEnvironment = @environment AND BrandCode = @brand AND IsActive = 1
      `);
    const activeRows = Number(active.recordset[0]?.ActiveRows ?? 0);
    if (vendors.length === 0 && activeRows > 0) {
      throw new Error(`BC returned an empty vendor snapshot for ${ctx.brandCode}; existing rows were preserved`);
    }

    snapshotAt = new Date();
    for (const vendor of vendors) await writeVendor(transaction, ctx, vendor, snapshotAt);
    vendorRows = vendors.length;

    await new sql.Request(transaction)
      .input("environment", sql.NVarChar, ERP_VENDOR_SOURCE_ENVIRONMENT)
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("snapshotAt", sql.DateTime2, snapshotAt)
      .query(`
        UPDATE [dbo].[ErpVendors]
        SET IsActive = 0,
            SourceDeletedAt = COALESCE(SourceDeletedAt, @snapshotAt),
            SyncedAt = @snapshotAt
        WHERE SourceEnvironment = @environment
          AND BrandCode = @brand
          AND IsActive = 1
          AND SyncedAt < @snapshotAt
      `);

    await transaction.commit();
    transactionOpen = false;

    // After the commit: the rows exist, so this only ever updates one column.
    // Non-fatal by design — see enrichVendorHomePages.
    try {
      const homePagesUpdated = await enrichVendorHomePages(ctx);
      console.info(`[vendor-sync] ${ctx.brandCode}: Home Page updated on ${homePagesUpdated} vendor(s)`);
    } catch (err) {
      console.error(`[vendor-sync] Home Page enrich failed for ${ctx.brandCode}`, err);
      // Staying non-fatal is right — the vendor snapshot itself committed. But
      // the run must not read as wholly clean: a failure here leaves Home Page
      // values from an earlier run in place, and a staff code that accounting
      // has since removed in BC still matches an employee with high confidence.
      // Console alone is not enough; the log row is what an operator looks at.
      homePageNote = `Home Page enrich failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } catch (error) {
    if (transactionOpen) await transaction.rollback().catch(() => undefined);
    const message = error instanceof Error ? error.message : "Vendor sync failed";
    await insertVendorSyncLog(ctx.brandCode, "failed", vendorRows, message, triggeredBy, startedAt)
      .catch(() => undefined);
    throw error;
  }

  await insertVendorSyncLog(ctx.brandCode, "success", vendorRows, homePageNote, triggeredBy, startedAt)
    .catch(() => undefined);
  return { brandCode: ctx.brandCode, vendorRows, syncedAt: snapshotAt.toISOString() };
}

export async function syncAllBrandErpVendors(triggeredBy: number | null): Promise<{
  results: VendorSyncResult[];
  errors: { brandCode: string; error: string }[];
}> {
  const results: VendorSyncResult[] = [];
  const errors: { brandCode: string; error: string }[] = [];
  for (const brand of ERP_INTERFACE_BRANDS) {
    try {
      results.push(await syncBrandErpVendors(brand.id, triggeredBy));
    } catch (error) {
      errors.push({
        brandCode: brand.id,
        error: error instanceof Error ? error.message : "Vendor sync failed",
      });
    }
  }
  return { results, errors };
}
