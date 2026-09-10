-- 148_uat_brand_config_id_realign.sql
-- Target: Rocks_Portal_Form_UAT ONLY. It refuses any other database.
--
-- Realigns the Ids of four dual-written configuration tables to production's,
-- closing the `npm run check:alignment` failure measured on 2026-09-10.
--
-- WHAT DRIFTED, MEASURED THAT DAY. Nine rows across four tables. Every business
-- column agrees on every row and neither side holds a row the other lacks —
-- only `Id` differs:
--
--   AccFormBrand          3 rows   prod 1025-1027   uat 2024-2026
--   AccBrandBankAccount   2 rows   prod 21-22       uat 1014-1015
--   AccBrandBranchCode    2 rows   prod 15-16       uat 1008-1009
--   AccBrandJournalBatch  2 rows   prod 19-20       uat 1012-1013
--
-- A divergent Id IS the signature of a direct SQL edit against one database, or
-- of a `writeBothPools` transaction that failed after production's INSERT had
-- already advanced its identity counter — SQL Server allocates identity outside
-- the transaction, so the rollback restores the rows and not the counter.
-- CLAUDE.md records that hazard under "Shared configuration is dual-written".
--
-- WHY IT MATTERS. These tables are dual-written and listed in MASTER_TABLES, and
-- every later dual-write runs the SAME statement against both databases while
-- reading no id back — so the two copies only ever agree because their counters
-- do. Once drifted, they stay drifted, and the cost lands wherever an id is
-- stored: CLAUDE.md's own example is `AccReimburseRuleAck`, which records which
-- rule a requester ticked BY ID, so drifted counters re-point an acknowledgement
-- at different rule text.
--
-- HOW. Delete every row and reinsert production's wholesale, under
-- IDENTITY_INSERT, inside one transaction — the same operation migration 103
-- used for AccFormBrand and for the same reason: no per-row UPDATE can be
-- sequenced safely, because `Id` is an identity column and cannot be updated at
-- all, and target ids may be occupied by rows that have not moved yet.
--
-- Safe to delete and reinsert because NOTHING REFERENCES THESE IDS. Measured
-- 2026-09-10 against both databases: zero foreign keys point at any of the four.
--
-- GUARDED SO IT CAN ONLY EVER CHANGE IDS. Each table refuses unless both sides
-- hold the same number of rows AND every business column matches row for row in
-- both directions. Real configuration drift therefore still REPORTS through
-- check:alignment rather than being silently overwritten by production, which
-- is the whole point of the verifier this exists to satisfy.
--
-- check:alignment must read 28 tables before and after: this changes ids, not
-- the list.

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccFormBrand', 'U') IS NULL
BEGIN
  -- Through a variable: RAISERROR takes arguments, not function calls.
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 148 may only be applied to the UAT form database: the name must end in _UAT and dbo.AccFormBrand must exist. Current database is %s.',
    16, 1, @wrongDb
  );
END
GO

BEGIN TRANSACTION;

/* ─────────────── AccFormBrand ─────────────── */

IF (SELECT COUNT(*) FROM [dbo].[AccFormBrand])
   <> (SELECT COUNT(*) FROM [Rocks_Portal_Form].[dbo].[AccFormBrand])
  RAISERROR ('AccFormBrand: row counts differ — this is real drift, not an id realign. Refusing.', 16, 1);

IF EXISTS (
  SELECT FormCode, BrandCode, IsActive, SortOrder FROM [dbo].[AccFormBrand]
  EXCEPT
  SELECT FormCode, BrandCode, IsActive, SortOrder FROM [Rocks_Portal_Form].[dbo].[AccFormBrand]
) OR EXISTS (
  SELECT FormCode, BrandCode, IsActive, SortOrder FROM [Rocks_Portal_Form].[dbo].[AccFormBrand]
  EXCEPT
  SELECT FormCode, BrandCode, IsActive, SortOrder FROM [dbo].[AccFormBrand]
)
  RAISERROR ('AccFormBrand: business columns differ between the databases. Refusing.', 16, 1);

DELETE FROM [dbo].[AccFormBrand];
SET IDENTITY_INSERT [dbo].[AccFormBrand] ON;
INSERT INTO [dbo].[AccFormBrand] (Id, FormCode, BrandCode, IsActive, SortOrder)
SELECT Id, FormCode, BrandCode, IsActive, SortOrder
FROM [Rocks_Portal_Form].[dbo].[AccFormBrand];
SET IDENTITY_INSERT [dbo].[AccFormBrand] OFF;

/* ─────────────── AccBrandBankAccount ─────────────── */

IF (SELECT COUNT(*) FROM [dbo].[AccBrandBankAccount])
   <> (SELECT COUNT(*) FROM [Rocks_Portal_Form].[dbo].[AccBrandBankAccount])
  RAISERROR ('AccBrandBankAccount: row counts differ. Refusing.', 16, 1);

IF EXISTS (
  SELECT BrandCode, AccountNo, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [dbo].[AccBrandBankAccount]
  EXCEPT
  SELECT BrandCode, AccountNo, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [Rocks_Portal_Form].[dbo].[AccBrandBankAccount]
) OR EXISTS (
  SELECT BrandCode, AccountNo, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [Rocks_Portal_Form].[dbo].[AccBrandBankAccount]
  EXCEPT
  SELECT BrandCode, AccountNo, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [dbo].[AccBrandBankAccount]
)
  RAISERROR ('AccBrandBankAccount: business columns differ. Refusing.', 16, 1);

DELETE FROM [dbo].[AccBrandBankAccount];
SET IDENTITY_INSERT [dbo].[AccBrandBankAccount] ON;
INSERT INTO [dbo].[AccBrandBankAccount] (Id, BrandCode, AccountNo, DisplayName, IsActive, SortOrder, CreatedBy, CreatedAt, FormCode)
SELECT Id, BrandCode, AccountNo, DisplayName, IsActive, SortOrder, CreatedBy, CreatedAt, FormCode
FROM [Rocks_Portal_Form].[dbo].[AccBrandBankAccount];
SET IDENTITY_INSERT [dbo].[AccBrandBankAccount] OFF;

/* ─────────────── AccBrandBranchCode ─────────────── */

IF (SELECT COUNT(*) FROM [dbo].[AccBrandBranchCode])
   <> (SELECT COUNT(*) FROM [Rocks_Portal_Form].[dbo].[AccBrandBranchCode])
  RAISERROR ('AccBrandBranchCode: row counts differ. Refusing.', 16, 1);

IF EXISTS (
  SELECT BrandCode, BranchCode, DisplayName, IsActive, SortOrder, CreatedBy, DeptAsBranch, FixedErpDeptCode, FormCode FROM [dbo].[AccBrandBranchCode]
  EXCEPT
  SELECT BrandCode, BranchCode, DisplayName, IsActive, SortOrder, CreatedBy, DeptAsBranch, FixedErpDeptCode, FormCode FROM [Rocks_Portal_Form].[dbo].[AccBrandBranchCode]
) OR EXISTS (
  SELECT BrandCode, BranchCode, DisplayName, IsActive, SortOrder, CreatedBy, DeptAsBranch, FixedErpDeptCode, FormCode FROM [Rocks_Portal_Form].[dbo].[AccBrandBranchCode]
  EXCEPT
  SELECT BrandCode, BranchCode, DisplayName, IsActive, SortOrder, CreatedBy, DeptAsBranch, FixedErpDeptCode, FormCode FROM [dbo].[AccBrandBranchCode]
)
  RAISERROR ('AccBrandBranchCode: business columns differ. Refusing.', 16, 1);

DELETE FROM [dbo].[AccBrandBranchCode];
SET IDENTITY_INSERT [dbo].[AccBrandBranchCode] ON;
INSERT INTO [dbo].[AccBrandBranchCode] (Id, BrandCode, BranchCode, DisplayName, IsActive, SortOrder, CreatedBy, CreatedAt, DeptAsBranch, FixedErpDeptCode, FormCode)
SELECT Id, BrandCode, BranchCode, DisplayName, IsActive, SortOrder, CreatedBy, CreatedAt, DeptAsBranch, FixedErpDeptCode, FormCode
FROM [Rocks_Portal_Form].[dbo].[AccBrandBranchCode];
SET IDENTITY_INSERT [dbo].[AccBrandBranchCode] OFF;

/* ─────────────── AccBrandJournalBatch ─────────────── */

IF (SELECT COUNT(*) FROM [dbo].[AccBrandJournalBatch])
   <> (SELECT COUNT(*) FROM [Rocks_Portal_Form].[dbo].[AccBrandJournalBatch])
  RAISERROR ('AccBrandJournalBatch: row counts differ. Refusing.', 16, 1);

IF EXISTS (
  SELECT BrandCode, BatchName, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [dbo].[AccBrandJournalBatch]
  EXCEPT
  SELECT BrandCode, BatchName, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [Rocks_Portal_Form].[dbo].[AccBrandJournalBatch]
) OR EXISTS (
  SELECT BrandCode, BatchName, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [Rocks_Portal_Form].[dbo].[AccBrandJournalBatch]
  EXCEPT
  SELECT BrandCode, BatchName, DisplayName, IsActive, SortOrder, CreatedBy, FormCode FROM [dbo].[AccBrandJournalBatch]
)
  RAISERROR ('AccBrandJournalBatch: business columns differ. Refusing.', 16, 1);

DELETE FROM [dbo].[AccBrandJournalBatch];
SET IDENTITY_INSERT [dbo].[AccBrandJournalBatch] ON;
INSERT INTO [dbo].[AccBrandJournalBatch] (Id, BrandCode, BatchName, DisplayName, IsActive, SortOrder, CreatedBy, CreatedAt, FormCode)
SELECT Id, BrandCode, BatchName, DisplayName, IsActive, SortOrder, CreatedBy, CreatedAt, FormCode
FROM [Rocks_Portal_Form].[dbo].[AccBrandJournalBatch];
SET IDENTITY_INSERT [dbo].[AccBrandJournalBatch] OFF;

COMMIT TRANSACTION;
GO

-- Reseed each counter to production's, so the NEXT row allocated on either side
-- gets the same id. Without this the realign fixes today's rows and the very
-- next insert drifts again — which is the failure this migration exists to end,
-- not merely to clean up after.
DECLARE @t SYSNAME, @n INT;
DECLARE reseed CURSOR LOCAL FAST_FORWARD FOR
  SELECT 'AccFormBrand' UNION ALL SELECT 'AccBrandBankAccount'
  UNION ALL SELECT 'AccBrandBranchCode' UNION ALL SELECT 'AccBrandJournalBatch';
OPEN reseed;
FETCH NEXT FROM reseed INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  DECLARE @sql NVARCHAR(MAX) =
    N'SELECT @out = CONVERT(INT, IDENT_CURRENT(''[Rocks_Portal_Form].[dbo].' + @t + '''))';
  EXEC sp_executesql @sql, N'@out INT OUTPUT', @out = @n OUTPUT;
  DBCC CHECKIDENT (@t, RESEED, @n) WITH NO_INFOMSGS;
  PRINT 'Reseeded ' + @t + ' to ' + CONVERT(NVARCHAR(20), @n);
  FETCH NEXT FROM reseed INTO @t;
END
CLOSE reseed;
DEALLOCATE reseed;
GO
