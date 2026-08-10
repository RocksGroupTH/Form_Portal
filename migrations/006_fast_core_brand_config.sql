-- =============================================
-- Migration: Fast_Core - BrandConfig table
-- Maps each brand to BC + SQL server/database
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BrandConfig')
BEGIN
    CREATE TABLE [dbo].[BrandConfig] (
        [BrandCode]        NVARCHAR(20)   NOT NULL,
        [BcId]             NVARCHAR(MAX)  NULL,
        [BcName]           NVARCHAR(MAX)  NULL,
        [DbConnectionId]   INT            NULL,
        [DatabaseName]     NVARCHAR(128)  NULL,
        [IsActive]         BIT            NOT NULL DEFAULT 1,
        [CreatedBy]        INT            NULL,
        [UpdatedBy]        INT            NULL,
        [CreatedAt]        DATETIME2      NOT NULL DEFAULT GETDATE(),
        [UpdatedAt]        DATETIME2      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT [PK_BrandConfig] PRIMARY KEY ([BrandCode]),
        CONSTRAINT [FK_BrandConfig_Db] FOREIGN KEY ([DbConnectionId])
            REFERENCES [dbo].[DbConnection]([Id])
    );

    CREATE INDEX [IX_BrandConfig_DbConnectionId] ON [BrandConfig]([DbConnectionId]);

    PRINT 'Created BrandConfig table';
END
ELSE
    PRINT 'BrandConfig table already exists — skipping';
GO
