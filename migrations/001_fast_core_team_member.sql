-- =============================================
-- Migration: Fast_Core - TeamMember table
-- Database: Fast_Core
-- Run this on the Fast_Core database
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TeamMember')
BEGIN
    CREATE TABLE [dbo].[TeamMember] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [FullName]        NVARCHAR(200)  NOT NULL,
        [Nickname]        NVARCHAR(100)  NOT NULL,
        [Email]           NVARCHAR(200)  NOT NULL,
        [AppRole]         NVARCHAR(30)   NOT NULL DEFAULT 'Staff',
        [Position]        NVARCHAR(200)  NULL,
        [Color]           NVARCHAR(20)   NOT NULL DEFAULT '#6c757d',
        [Photo]           NVARCHAR(500)  NULL,
        [ManagerId]       INT            NULL,
        [IsActive]        BIT            NOT NULL DEFAULT 1,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [UpdatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT [UQ_TeamMember_Email] UNIQUE ([Email]),
        CONSTRAINT [FK_TeamMember_Manager] FOREIGN KEY ([ManagerId]) REFERENCES [TeamMember]([Id]),
        CONSTRAINT [CK_TeamMember_AppRole] CHECK ([AppRole] IN ('Staff', 'IT Admin', 'System Admin', 'Viewer'))
    );

    CREATE INDEX [IX_TeamMember_Email] ON [TeamMember]([Email]);
    CREATE INDEX [IX_TeamMember_IsActive] ON [TeamMember]([IsActive]);
    CREATE INDEX [IX_TeamMember_ManagerId] ON [TeamMember]([ManagerId]);

    PRINT 'Created TeamMember table';
END
ELSE
    PRINT 'TeamMember table already exists — skipping';
GO

-- Seed: Insert a default System Admin user (update email to match your Azure AD account)
IF NOT EXISTS (SELECT 1 FROM [dbo].[TeamMember] WHERE [Email] = 'jirayu.top@rocksgroup.com')
BEGIN
    INSERT INTO [dbo].[TeamMember] ([FullName], [Nickname], [Email], [AppRole], [Position], [Color])
    VALUES ('Jirayu Topphom', 'Topp', 'jirayu.top@rocksgroup.com', 'System Admin', 'IT Developer', '#2563eb');

    PRINT 'Seeded System Admin user';
END
GO
