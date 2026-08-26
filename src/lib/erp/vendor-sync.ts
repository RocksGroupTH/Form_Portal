/** Sync Business Central Standard API v2.0 vendors into Rocks_ERP_Data.ErpVendors. */

import type { Transaction } from "mssql";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  buildBcApiV2CompanyEntityUrl,
  fetchBcApiV2Collection,
} from "@/lib/bc/bc-odata";
import { getBcConnectionById } from "@/lib/bc/bc-connection";
import { getBrandConfig } from "@/lib/brand-config";
import { getErpDataPool, sql } from "@/lib/db/mssql";
import {
  normalizeVendorSnapshot,
  type BcVendorRow,
  type NormalizedVendor,
} from "@/lib/erp/vendor-normalization";

export const ERP_VENDOR_SYNC_TYPE = "VENDORS";
export const ERP_VENDOR_SOURCE_ENVIRONMENT = "Production";

const VENDOR_SELECT = [
  "id", "number", "displayName", "addressLine1", "addressLine2", "city",
  "state", "country", "postalCode", "phoneNumber", "email", "website",
  "taxRegistrationNumber", "currencyId", "currencyCode", "taxLiable", "blocked",
  "lastModifiedDateTime",
].join(",");

interface BrandVendorSyncContext {
  brandCode: string;
  bcCompanyId: string;
  bcCompanyName: string;
  bcConnectionId: number;
  vendorsUrl: string;
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

  const url = new URL(buildBcApiV2CompanyEntityUrl(
    connection.BaseUrl,
    brand.bcId,
    "vendors",
    ERP_VENDOR_SOURCE_ENVIRONMENT,
  ));
  url.searchParams.set("$select", VENDOR_SELECT);

  return {
    brandCode: code,
    bcCompanyId: brand.bcId.trim(),
    bcCompanyName: brand.bcName.trim(),
    bcConnectionId: brand.bcConnectionId,
    vendorsUrl: url.toString(),
  };
}

async function writeVendor(
  transaction: Transaction,
  ctx: BrandVendorSyncContext,
  vendor: NormalizedVendor,
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
    .input("address2", sql.NVarChar, vendor.addressLine2)
    .input("city", sql.NVarChar, vendor.city)
    .input("state", sql.NVarChar, vendor.state)
    .input("country", sql.NVarChar, vendor.countryCode)
    .input("postal", sql.NVarChar, vendor.postalCode)
    .input("phone", sql.NVarChar, vendor.phoneNumber)
    .input("email", sql.NVarChar, vendor.email)
    .input("website", sql.NVarChar, vendor.website)
    .input("taxRegistration", sql.NVarChar, vendor.taxRegistrationNumber)
    .input("currencyId", sql.UniqueIdentifier, vendor.currencyId)
    .input("currencyCode", sql.NVarChar, vendor.currencyCode)
    .input("taxLiable", sql.Bit, vendor.taxLiable ? 1 : 0)
    .input("blockedStatus", sql.NVarChar, vendor.blockedStatus)
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
        AddressLine2 = @address2,
        City = @city,
        State = @state,
        CountryCode = @country,
        PostalCode = @postal,
        PhoneNumber = @phone,
        Email = @email,
        Website = @website,
        TaxRegistrationNumber = @taxRegistration,
        CurrencyId = @currencyId,
        CurrencyCode = @currencyCode,
        TaxLiable = @taxLiable,
        BlockedStatus = @blockedStatus,
        IsBlocked = @isBlocked,
        BcLastModified = @bcLastModified,
        IsActive = 1,
        SourceDeletedAt = NULL,
        SyncedAt = @snapshotAt
      WHEN NOT MATCHED THEN INSERT (
        SourceEnvironment, BrandCode, BcCompanyId, BcCompanyName, BcConnectionId,
        VendorNo, DisplayName, AddressLine1, AddressLine2, City, State,
        CountryCode, PostalCode, PhoneNumber, Email, Website, TaxRegistrationNumber,
        CurrencyId, CurrencyCode, TaxLiable, BlockedStatus, IsBlocked, BcLastModified, IsActive,
        SourceDeletedAt, SyncedAt
      ) VALUES (
        @environment, @brand, @companyId, @companyName, @connectionId,
        @vendorNo, @displayName, @address1, @address2, @city, @state,
        @country, @postal, @phone, @email, @website, @taxRegistration,
        @currencyId, @currencyCode, @taxLiable, @blockedStatus, @isBlocked, @bcLastModified, 1,
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
    // No target row is touched until every BC page has succeeded.
    const rawRows = await fetchBcApiV2Collection<BcVendorRow>(ctx.bcConnectionId, ctx.vendorsUrl);
    const vendors = normalizeVendorSnapshot(rawRows);
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
  } catch (error) {
    if (transactionOpen) await transaction.rollback().catch(() => undefined);
    const message = error instanceof Error ? error.message : "Vendor sync failed";
    await insertVendorSyncLog(ctx.brandCode, "failed", vendorRows, message, triggeredBy, startedAt)
      .catch(() => undefined);
    throw error;
  }

  await insertVendorSyncLog(ctx.brandCode, "success", vendorRows, null, triggeredBy, startedAt)
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
