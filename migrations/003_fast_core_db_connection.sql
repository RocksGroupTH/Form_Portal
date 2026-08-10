-- =============================================
-- Migration: Fast_Core - DbConnection table
-- Database: Fast_Core
-- Stores external MSSQL server connection configs
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DbConnection')
BEGIN
    CREATE TABLE [dbo].[DbConnection] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [Code]            NVARCHAR(50)   NOT NULL,
        [Name]            NVARCHAR(100)  NOT NULL,
        [Host]            NVARCHAR(255)  NOT NULL,
        [Port]            INT            NOT NULL DEFAULT 1433,
        [DatabaseName]    NVARCHAR(128)  NULL,
        [Username]        NVARCHAR(128)  NOT NULL,
        [PasswordEnc]     NVARCHAR(MAX)  NOT NULL,
        [Encrypt]         BIT            NOT NULL DEFAULT 1,
        [TrustServerCert] BIT            NOT NULL DEFAULT 1,
        [Purpose]         NVARCHAR(50)   NULL,
        [IsActive]        BIT            NOT NULL DEFAULT 1,
        [LastTestAt]      DATETIME2      NULL,
        [LastTestOk]      BIT            NULL,
        [LastTestMessage] NVARCHAR(500)  NULL,
        [CreatedBy]       INT            NULL,
        [UpdatedBy]       INT            NULL,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [UpdatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT [UQ_DbConnection_Code] UNIQUE ([Code]),
        CONSTRAINT [UQ_DbConnection_Name] UNIQUE ([Name])
    );

    CREATE INDEX [IX_DbConnection_IsActive] ON [DbConnection]([IsActive]);

    PRINT 'Created DbConnection table';
END
ELSE
    PRINT 'DbConnection table already exists — skipping';
GO
