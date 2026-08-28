-- A brand's country and the currency a claim against it may be entered in,
-- plus the audit trail for changing them.
--
-- Apply with (PRODUCTION form database ONLY — there is no UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/124_brand_setting_currency.sql
--
-- NUMBERED 124. Read the highest number on *master* before picking one and
-- re-read it before merging. (124 was briefly occupied by an untracked file,
-- 124_acc_booking_approver_areas.sql, committed by accident in 035f116 and
-- removed in 2fb19f0 — the number is free.)
--
-- ---------------------------------------------------------------------------
-- PRODUCTION ONLY, like the rest of BrandSetting (122). Not dual-written, not
-- in MASTER_TABLES. Rocks_Portal_Form_UAT has no BrandSetting object at all
-- (measured 2026-08-28: USER_TABLE with 6 rows in production, ABSENT in UAT),
-- which is exactly why every reader must go through brand-registry.ts and its
-- getProductionFormPool(). A getFormPool() read throws `Invalid object name`
-- for every UAT tester, on the amount-entry path of both forms — the same
-- hazard CLAUDE.md records for DepartmentErpMap.
--
-- CurrencyEnabled IS NOT IsEnabled. IsEnabled answers "may a user pick this
-- company at all" and is read only by BrandGate (via listSelectableBrands).
-- This answers "may a claim against it be entered in a foreign currency".
-- Conflating them would make turning on a currency also change who can see the
-- brand.
--
-- ALL THREE NULLABLE / DEFAULT 0, so every existing row keeps behaving exactly
-- as it does today: no currency, no dropdown, baht.
--
-- WHY BrandSettingLog EXISTS AND AccActivityLog CANNOT BE USED
--
-- The spec requires every currency change to be recorded, because the value is
-- stored once per brand while the permission to change it is per form — an
-- AP-17 approver holding the `brands` tab grant can change what an AP-1 travel
-- claim converts at. That cannot be constrained away, so it is made traceable
-- instead.
--
-- AccActivityLog cannot hold it: RequestId is int NOT NULL with
-- FK_AccActivity_Request referencing AccRequest(Id) (verified in the live
-- database). A brand-currency change has no request — there is no id to supply
-- and no nullable column to omit. Shape below is copied from ApiKeyLog
-- (Id, ApiKeyId, Code, Action, Detail, ChangedBy, ChangedAt).

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form'
  THROW 50000, 'Run this against Rocks_Portal_Form only — BrandSetting has no UAT twin.', 1;
GO

IF OBJECT_ID('dbo.BrandSetting', 'U') IS NULL
  THROW 50000, 'dbo.BrandSetting is missing — apply 122 first.', 1;
GO

-- The three ALTERs, one batch, one transaction: they change one table and
-- either all land or none do.
BEGIN TRANSACTION;

IF COL_LENGTH('dbo.BrandSetting', 'CountryCode') IS NULL
  ALTER TABLE [dbo].[BrandSetting] ADD [CountryCode] CHAR(2) NULL;

IF COL_LENGTH('dbo.BrandSetting', 'CurrencyCode') IS NULL
  ALTER TABLE [dbo].[BrandSetting] ADD [CurrencyCode] CHAR(3) NULL;

IF COL_LENGTH('dbo.BrandSetting', 'CurrencyEnabled') IS NULL
  ALTER TABLE [dbo].[BrandSetting] ADD [CurrencyEnabled] BIT NOT NULL
    CONSTRAINT [DF_BrandSetting_CurrencyEnabled] DEFAULT (0);

COMMIT TRANSACTION;
GO

-- Its own batch. CREATE INDEX below cannot parse against a table created in the
-- same batch, and each statement here is individually atomic and re-runnable,
-- so no transaction is needed or wanted across the GO.
IF OBJECT_ID('dbo.BrandSettingLog', 'U') IS NULL
CREATE TABLE [dbo].[BrandSettingLog] (
  [Id]        int IDENTITY(1,1) NOT NULL CONSTRAINT [PK_BrandSettingLog] PRIMARY KEY,
  [BrandCode] nvarchar(40)  NOT NULL,
  [Field]     nvarchar(40)  NOT NULL,   -- 'CountryCode' | 'CurrencyCode' | 'CurrencyEnabled'
  [OldValue]  nvarchar(100) NULL,
  [NewValue]  nvarchar(100) NULL,
  [FormCode]  nvarchar(20)  NULL,       -- which form's settings tab it was changed from
  [ChangedBy] int           NULL,
  [ChangedAt] datetime2(7)  NOT NULL
    CONSTRAINT [DF_BrandSettingLog_ChangedAt] DEFAULT (sysdatetime())
);
GO

IF OBJECT_ID('dbo.BrandSettingLog', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_BrandSettingLog_Brand'
                     AND object_id = OBJECT_ID('dbo.BrandSettingLog'))
  CREATE INDEX [IX_BrandSettingLog_Brand]
    ON [dbo].[BrandSettingLog] ([BrandCode], [ChangedAt] DESC);
GO

-- Post-apply checks. All three lengths non-NULL; every existing row still
-- disabled (nothing is switched on by this migration); the log table readable.
SELECT
  COL_LENGTH('dbo.BrandSetting','CountryCode')     AS CountryCode,
  COL_LENGTH('dbo.BrandSetting','CurrencyCode')    AS CurrencyCode,
  COL_LENGTH('dbo.BrandSetting','CurrencyEnabled') AS CurrencyEnabled;
GO
SELECT BrandCode, CountryCode, CurrencyCode, CurrencyEnabled
FROM dbo.BrandSetting ORDER BY BrandCode;
GO
SELECT COUNT(*) AS BrandSettingLogRows FROM dbo.BrandSettingLog;
GO
