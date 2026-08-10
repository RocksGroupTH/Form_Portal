-- =============================================
-- Align BrandConfig to final schema (run on existing Fast_Core)
-- BrandCode, BcId, BcName, DbConnectionId, DatabaseName, IsActive, audit
-- Requires: DbConnection table (migration 003)
-- =============================================

USE [Fast_Core];
GO

-- ---------------------------------------------------------------------------
-- 1) Create table if missing (new environment)
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BrandConfig')
BEGIN
    CREATE TABLE [dbo].[BrandConfig] (
        [BrandCode]        NVARCHAR(20)   NOT NULL,
        [BcId]             NVARCHAR(MAX)  NULL,
        [BcName]           NVARCHAR(MAX)  NULL,
        [DbConnectionId]   INT            NULL,
        [DatabaseName]     NVARCHAR(128)  NULL,
        [IsActive]         BIT            NOT NULL CONSTRAINT [DF_BrandConfig_IsActive] DEFAULT (1),
        [CreatedBy]        INT            NULL,
        [UpdatedBy]        INT            NULL,
        [CreatedAt]        DATETIME2(7)   NOT NULL CONSTRAINT [DF_BrandConfig_CreatedAt] DEFAULT (SYSDATETIME()),
        [UpdatedAt]        DATETIME2(7)   NOT NULL CONSTRAINT [DF_BrandConfig_UpdatedAt] DEFAULT (SYSDATETIME()),

        CONSTRAINT [PK_BrandConfig] PRIMARY KEY CLUSTERED ([BrandCode] ASC)
    );

    PRINT 'Created BrandConfig table';
END
GO

-- ---------------------------------------------------------------------------
-- 2) Add BcId / BcName
-- ---------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'BcId'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] ADD [BcId] NVARCHAR(MAX) NULL;
    PRINT 'Added BcId';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'BcName'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] ADD [BcName] NVARCHAR(MAX) NULL;
    PRINT 'Added BcName';
END
GO

-- ---------------------------------------------------------------------------
-- 3) Migrate legacy columns (if any)
-- ---------------------------------------------------------------------------
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'CompanyId'
)
BEGIN
    UPDATE [dbo].[BrandConfig]
    SET [BcId] = COALESCE(NULLIF(LTRIM(RTRIM([BcId])), N''), [CompanyId])
    WHERE [CompanyId] IS NOT NULL;
    ALTER TABLE [dbo].[BrandConfig] DROP COLUMN [CompanyId];
    PRINT 'Migrated CompanyId -> BcId';
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'CompanyName'
)
BEGIN
    UPDATE [dbo].[BrandConfig]
    SET [BcName] = COALESCE(NULLIF(LTRIM(RTRIM([BcName])), N''), [CompanyName])
    WHERE [CompanyName] IS NOT NULL;
    ALTER TABLE [dbo].[BrandConfig] DROP COLUMN [CompanyName];
    PRINT 'Migrated CompanyName -> BcName';
END
GO

-- Drop BcConnectionId link (BC config is BcId/BcName per brand, not FK)
IF EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_BrandConfig_Bc' AND parent_object_id = OBJECT_ID(N'dbo.BrandConfig')
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] DROP CONSTRAINT [FK_BrandConfig_Bc];
    PRINT 'Dropped FK_BrandConfig_Bc';
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'BcConnectionId'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] DROP COLUMN [BcConnectionId];
    PRINT 'Dropped BcConnectionId';
END
GO

-- ---------------------------------------------------------------------------
-- 4) Ensure DbConnection FK + index
-- ---------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_BrandConfig_Db' AND parent_object_id = OBJECT_ID(N'dbo.BrandConfig')
)
AND EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DbConnection')
BEGIN
    ALTER TABLE [dbo].[BrandConfig] WITH CHECK
    ADD CONSTRAINT [FK_BrandConfig_Db] FOREIGN KEY ([DbConnectionId])
        REFERENCES [dbo].[DbConnection]([Id]);
    PRINT 'Added FK_BrandConfig_Db';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BrandConfig_DbConnectionId' AND object_id = OBJECT_ID(N'dbo.BrandConfig')
)
BEGIN
    CREATE INDEX [IX_BrandConfig_DbConnectionId] ON [dbo].[BrandConfig]([DbConnectionId]);
    PRINT 'Created IX_BrandConfig_DbConnectionId';
END
GO

-- ---------------------------------------------------------------------------
-- 5) Seed brand rows (PCTH, KSI, PCMY, UNO)
-- ---------------------------------------------------------------------------
MERGE [dbo].[BrandConfig] AS t
USING (
    VALUES (N'PCTH'), (N'KSI'), (N'PCMY'), (N'UNO')
) AS s([BrandCode])
ON t.[BrandCode] = s.[BrandCode]
WHEN NOT MATCHED BY TARGET THEN
    INSERT ([BrandCode], [IsActive], [CreatedAt], [UpdatedAt])
    VALUES (s.[BrandCode], 1, SYSDATETIME(), SYSDATETIME());
GO

PRINT 'BrandConfig align complete';
GO

-- Verify
SELECT
    c.name AS ColumnName,
    t.name AS DataType,
    c.max_length,
    c.is_nullable
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.BrandConfig')
ORDER BY c.column_id;
GO
