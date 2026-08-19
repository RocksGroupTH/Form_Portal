-- =============================================
-- Migration: Fast_Core - TeamMember table
-- Database: Fast_Core
-- Run this on the Fast_Core database
-- =============================================
--
-- HISTORICAL -- already applied. DO NOT RE-RUN after migration 066.
--
-- Since 066, Form Portal's roster is [Rocks_Portal_Form].[dbo].[TeamMember] and
-- nothing else. The table this file creates and seeds is Fast_Core's, which is
-- now the LIVE Rocks Fast roster: anything this file does lands in the sibling
-- app, not in this one.
--
-- It is more dangerous than the other two historical migrations (024, 058):
--
--   1. --db does not protect you. The first batch below is nothing but
--      USE [Fast_Core]. apply-sql.ts splits on GO and runs every batch on one
--      pool, so that USE carries into the later batches whenever the pool hands
--      back the same connection -- the normal case for sequential requests --
--      and whatever --db said is quietly ignored.
--   2. The last batch seeds a System Admin row into that shared roster. It is a
--      no-op today only because of the IF NOT EXISTS on one hard-coded email,
--      and the seed comment invites you to change exactly that email.
--
-- To create TeamMember for a NEW Form Portal database, use
-- 066_portal_form_team_member.sql instead. There is no supported reason to run
-- this file again.

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
