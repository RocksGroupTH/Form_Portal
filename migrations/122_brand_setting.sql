-- Per-brand settings this application owns: whether a brand may be selected,
-- and the logo shown for it.
--
-- Apply with (PRODUCTION form database only, before the code deploy):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/122_brand_setting.sql
--
-- NUMBERED 122. Read the highest number on *master* before picking one and
-- re-read it before merging.
--
-- ---------------------------------------------------------------------------
-- WHY THIS TABLE EXISTS AT ALL. Which brands this app offers was a four-entry
-- array literal in src/lib/brand.ts, and every brand's logo was a file in
-- public/brandlogo/. Both are wrong for a list the business grows: the company
-- brand master (Rocks_Codex.dbo.Brand) gained Paloma and SANMAI and neither
-- could appear here without a code change and a deploy.
--
-- WHY NOT public/brandlogo/. Uploading to disk cannot work in this deployment:
-- .AutoDeploy.bat runs `git reset --hard origin/master` on every release, so an
-- uploaded file that is not committed is deleted on the next deploy. The bytes
-- have to live somewhere the deploy does not touch.
--
-- WHY NOT Fast_Core.dbo.BrandConfig, which already has an IsActive column. That
-- table is shared with the Rocks Fast and ACC Portal siblings, and IsEnabled
-- here means "this app offers the brand in its picker" -- a statement about
-- Form Portal, not about the shared BC/ERP configuration those rows carry.
-- Writing our own meaning into a shared column is how two applications end up
-- disagreeing about what a flag means.
--
-- PRODUCTION ONLY. No Rocks_Portal_Form_UAT twin, and deliberately not in
-- MASTER_TABLES / dual-write. A brand's logo and whether the company uses that
-- brand are not properties of a test environment, and a tester picking a brand
-- is picking the same real brand a production user picks. This follows
-- TeamMember (066) and DepartmentErpMap (099), not the AccBrand* configuration
-- tables.
--
-- THE BRAND MASTER IS STILL THE REGISTRY. This table holds no brand name and no
-- code of its own beyond the key: Rocks_Codex.dbo.Brand decides which brands
-- exist and what they are called, and a row here only decorates one. A row for
-- a code the master does not have is inert -- the read joins from the master,
-- never from here -- which is what makes deleting a brand over there safe.
--
-- ABSENT MEANS ENABLED. There is no backfill and none is wanted: a brand with
-- no row is offered, exactly as every brand in the master is offered today, so
-- applying this migration changes nothing until an admin turns something off.
-- The DEFAULT is on the column for the same reason.
--
-- THE BYTES ARE THE FILE, NOT A PATH. Rocks_Codex.dbo.Brand.Logo holds a path
-- on the Codex server (/uploads/brands/brand-7-....png) and that server serves
-- the newer ones only behind a login -- measured 2026-08-26: brand-1 through
-- brand-5 answer 200 on the static path, brand-7 and brand-8 answer 404, and
-- /api/photo/brand/{id} answers 307 to /login with or without an api key. So a
-- path is not something this app can render, and the upload stores the bytes.
--
-- IDEMPOTENT. Guarded on sys.tables, so a re-run is a no-op.
-- ---------------------------------------------------------------------------

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

-- The name test is what keeps a mistyped --db out of Fast_Form, which belongs
-- to the live sibling, and out of the UAT twin, which must not have this table.
IF DB_NAME() <> 'Rocks_Portal_Form'
BEGIN
  RAISERROR('This migration targets Rocks_Portal_Form only (production). Check --db.', 16, 1);
END
GO

IF OBJECT_ID('dbo.BrandSetting', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[BrandSetting] (
    -- The company brand master's Code. Not a foreign key: the master lives in
    -- another database, and a row for a code that master no longer has is
    -- already inert because every read starts from the master.
    [BrandCode]        NVARCHAR(40)   NOT NULL
                       CONSTRAINT [PK_BrandSetting] PRIMARY KEY,
    [IsEnabled]        BIT            NOT NULL
                       CONSTRAINT [DF_BrandSetting_IsEnabled] DEFAULT (1),
    -- NULL together or set together. Nothing enforces that in the schema
    -- because the read treats a NULL LogoBytes as "no logo" and ignores the
    -- rest, so a half-written row degrades to the no-logo case rather than to
    -- an error.
    [LogoBytes]        VARBINARY(MAX) NULL,
    [LogoContentType]  NVARCHAR(100)  NULL,
    [LogoFileName]     NVARCHAR(260)  NULL,
    -- The cache buster in the served URL. Distinct from UpdatedAt so that
    -- toggling IsEnabled does not invalidate every viewer's cached image.
    [LogoUpdatedAt]    DATETIME2      NULL,
    [UpdatedAt]        DATETIME2      NOT NULL
                       CONSTRAINT [DF_BrandSetting_UpdatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedBy]        INT            NULL
  );
  PRINT 'Created BrandSetting';
END
ELSE PRINT 'BrandSetting already present - skipped';
GO

-- Post-apply check: the table, its default, and that it is empty (absent means
-- enabled, so an empty table is the correct starting state).
SELECT
  (SELECT COUNT(*) FROM sys.tables WHERE name = 'BrandSetting')                  AS tablePresent,
  (SELECT COUNT(*) FROM sys.default_constraints
    WHERE name = 'DF_BrandSetting_IsEnabled')                                    AS defaultPresent,
  (SELECT COUNT(*) FROM [dbo].[BrandSetting])                                    AS rowCountShouldBeZero;
GO
