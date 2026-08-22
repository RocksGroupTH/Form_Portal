-- =============================================
-- Migration: ERP dimension values (BC OData snapshot)
-- Database: Fast_Data
-- Apply: npm run apply-sql -- --db Fast_Data --file migrations/019_fast_data_erp_dimension.sql
-- =============================================
--
-- HISTORICAL -- already applied. DO NOT RE-RUN: the target moved to
-- Rocks_ERP_Data (migrations 101/102).
--
-- This file creates TWO of the five: ErpDimensionValue and ErpSyncLog. In
-- Fast_Data both names are now SYNONYMs for [Rocks_ERP_Data].[dbo].[...], and a
-- synonym does not appear in sys.tables -- so both guards below
-- (IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '...')) pass and the
-- CREATE TABLE then fails with Msg 2714, because the synonym already owns the
-- name. The guard cannot see the object it is guarding against. Measured
-- 2026-08-21 against the cut-over Fast_Data: batch 2 raised "There is already
-- an object named 'ErpDimensionValue' in the database" and batch 3 the same
-- for 'ErpSyncLog'. Nothing was created; the file simply cannot run.
--
-- The two tables here also predate the named-default-constraint convention the
-- later three use: their DEFAULTs are inline and auto-named, which is why 101
-- states that it renames all of them deterministically rather than reproducing
-- the source exactly.
--
-- If either table ever has to be created again, 101 is the file that does it,
-- against Rocks_ERP_Data.

USE [Fast_Data];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpDimensionValue')
BEGIN
  CREATE TABLE [dbo].[ErpDimensionValue] (
    [Id]              INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]       NVARCHAR(20)   NOT NULL,
    [DimensionCode]   NVARCHAR(50)   NOT NULL,
    [Code]            NVARCHAR(50)   NOT NULL,
    [DisplayName]     NVARCHAR(200)  NULL,
    [IsBlocked]       BIT            NOT NULL DEFAULT 0,
    [IsActive]        BIT            NOT NULL DEFAULT 1,
    [BcLastModified]  DATETIME2      NULL,
    [SyncedAt]        DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    [RawJson]         NVARCHAR(MAX)  NULL,
    CONSTRAINT [PK_ErpDimensionValue] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_ErpDimensionValue] UNIQUE ([BrandCode], [DimensionCode], [Code])
  );

  CREATE INDEX [IX_ErpDimensionValue_BrandDim]
    ON [dbo].[ErpDimensionValue]([BrandCode], [DimensionCode])
    INCLUDE ([Code], [DisplayName], [IsActive]);

  PRINT 'Created ErpDimensionValue';
END
ELSE PRINT 'ErpDimensionValue already exists — skipping';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpSyncLog')
BEGIN
  CREATE TABLE [dbo].[ErpSyncLog] (
    [Id]            INT            IDENTITY(1,1) NOT NULL,
    [SyncType]      NVARCHAR(50)   NOT NULL,
    [BrandCode]     NVARCHAR(20)   NOT NULL,
    [Status]        NVARCHAR(20)   NOT NULL,
    [RowsUpserted]  INT            NOT NULL DEFAULT 0,
    [ErrorMessage]  NVARCHAR(MAX)  NULL,
    [StartedAt]     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    [FinishedAt]    DATETIME2      NULL,
    [TriggeredBy]   INT            NULL,
    CONSTRAINT [PK_ErpSyncLog] PRIMARY KEY ([Id])
  );

  CREATE INDEX [IX_ErpSyncLog_BrandStarted]
    ON [dbo].[ErpSyncLog]([BrandCode], [StartedAt] DESC);

  PRINT 'Created ErpSyncLog';
END
ELSE PRINT 'ErpSyncLog already exists — skipping';
GO
