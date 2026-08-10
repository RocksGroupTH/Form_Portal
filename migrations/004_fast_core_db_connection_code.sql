-- =============================================
-- Migration: Fast_Core - DbConnection.Code (unique)
-- Database: Fast_Core
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.DbConnection') AND name = N'Code'
)
BEGIN
    ALTER TABLE [dbo].[DbConnection] ADD [Code] NVARCHAR(50) NULL;

    UPDATE [dbo].[DbConnection]
    SET [Code] = N'CONN_' + CAST([Id] AS NVARCHAR(20))
    WHERE [Code] IS NULL;

    ALTER TABLE [dbo].[DbConnection] ALTER COLUMN [Code] NVARCHAR(50) NOT NULL;

    IF NOT EXISTS (
        SELECT 1 FROM sys.indexes
        WHERE name = N'UQ_DbConnection_Code' AND object_id = OBJECT_ID(N'dbo.DbConnection')
    )
        ALTER TABLE [dbo].[DbConnection]
            ADD CONSTRAINT [UQ_DbConnection_Code] UNIQUE ([Code]);

    PRINT 'Added DbConnection.Code with unique constraint';
END
ELSE
    PRINT 'DbConnection.Code already exists — skipping';
GO
