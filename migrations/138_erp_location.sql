-- Business Central Location master with the default dimensions each Location
-- carries. Source: RPCCodexStore_CodexGetLocations (codeunit RPC, same rail as
-- the vendor sync). Apply only to Rocks_ERP_Data.
--
-- Why it exists: codeunit 50263 wrote a constant 'COCO' into the BU dimension on
-- every journal line of both AP-2 and AP-3, because nothing on the portal side
-- knew what a Location was bound to. Of PCTH's 240 Locations only 130 are COCO,
-- so the constant was wrong for 46% of the estate. This table is what the
-- journal builder reads to send the real one.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 138 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE
BEGIN
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.ErpLocation', 'U') IS NULL
  CREATE TABLE [dbo].[ErpLocation] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [Code] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    -- BC returns `branch` alongside `code`. On every row seen so far the two are
    -- equal, which is why the journal line's own branchCode is the lookup key —
    -- but it is stored rather than assumed, so a divergence shows up in the data
    -- instead of silently changing which line gets which BU.
    [BranchCode] NVARCHAR(50) NULL,
    [BuCode] NVARCHAR(50) NULL,
    [DepartmentCode] NVARCHAR(50) NULL,
    -- A Location that stops coming back from BC is deactivated, never deleted:
    -- journals already sent reference it, and the history has to stay readable.
    [IsActive] BIT NOT NULL CONSTRAINT DF_ErpLocation_IsActive DEFAULT (1),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT DF_ErpLocation_SyncedAt DEFAULT (SYSDATETIME()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT PK_ErpLocation PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT UQ_ErpLocation_Brand_Code UNIQUE ([BrandCode], [Code])
  );

  -- The read path is always "this brand's active Locations, by branch" — the
  -- include carries the BU so that lookup never touches the base table.
  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ErpLocation_Brand_Branch' AND object_id = OBJECT_ID('dbo.ErpLocation')
  )
    CREATE INDEX IX_ErpLocation_Brand_Branch
      ON [dbo].[ErpLocation] ([BrandCode], [BranchCode])
      INCLUDE ([BuCode], [IsActive]);

  COMMIT TRANSACTION;
END
