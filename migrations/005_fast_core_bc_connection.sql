-- =============================================
-- Migration: Fast_Core - BcConnection table
-- Database: Fast_Core
-- Business Central OAuth2 / API connection configs
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'BcConnection')
BEGIN
    CREATE TABLE [dbo].[BcConnection] (
        [Id]               INT            IDENTITY(1,1) PRIMARY KEY,
        [Code]             NVARCHAR(50)   NOT NULL,
        [Name]             NVARCHAR(100)  NOT NULL,
        [OAuthUrl]         NVARCHAR(500)  NOT NULL,
        [ClientId]         NVARCHAR(200)  NOT NULL,
        [ClientSecretEnc]  NVARCHAR(MAX)  NOT NULL,
        [Scope]            NVARCHAR(500)  NULL,
        [Username]         NVARCHAR(128)  NULL,
        [PasswordEnc]      NVARCHAR(MAX)  NULL,
        [BaseUrl]          NVARCHAR(500)  NOT NULL,
        [AccessTokenEnc]   NVARCHAR(MAX)  NULL,
        [RefreshTokenEnc]  NVARCHAR(MAX)  NULL,
        [TokenExpiresAt]   DATETIME2      NULL,
        [IsActive]         BIT            NOT NULL DEFAULT 1,
        [LastTestAt]       DATETIME2      NULL,
        [LastTestOk]       BIT            NULL,
        [LastTestMessage]  NVARCHAR(500)  NULL,
        [CreatedBy]        INT            NULL,
        [UpdatedBy]        INT            NULL,
        [CreatedAt]        DATETIME2      NOT NULL DEFAULT GETDATE(),
        [UpdatedAt]        DATETIME2      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT [UQ_BcConnection_Code] UNIQUE ([Code])
    );

    CREATE INDEX [IX_BcConnection_IsActive] ON [BcConnection]([IsActive]);

    PRINT 'Created BcConnection table';
END
ELSE
    PRINT 'BcConnection table already exists — skipping';
GO
