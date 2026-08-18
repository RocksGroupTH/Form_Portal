-- Form Portal's own TeamMember -- user identity and roles, copied out of Fast_Core.
--
-- Fast_Core.dbo.TeamMember is shared with the live Rocks Fast app: the same 17
-- rows carry both apps' user list and both apps' AppRole. Every role change in
-- one app therefore lands in the other. This migration gives Form Portal its own
-- copy in its own database so the two role lists can diverge from the cut onward,
-- which the owner has accepted.
--
-- Fast_Core is READ, never written. The only contact this migration has with it
-- is the single SELECT in batch 2, and that must stay true: Fast_Core's copy of
-- the table stays exactly as it is and stays in service for Rocks Fast. No
-- DELETE, DROP, TRUNCATE or ALTER against Fast_Core belongs in this file or any
-- follow-up. Both databases live on the same SQL Server instance, which is why
-- the copy can be a cross-database INSERT ... SELECT rather than an export
-- script. The core database is addressed by its literal name, [Fast_Core] --
-- the default of MSSQL_CORE_DATABASE, and what every other migration assumes.
--
-- The 17 rows keep their exact ids (1..2008) so every existing StaffId reference
-- -- AccRequest.CreatedBy, AccApproval.AssignedTo, the HR manager chain, and so
-- on -- keeps pointing at the same person without a rewrite. The identity is
-- then reseeded to 100000 (owner decision 2): Form Portal's new users get 100001
-- up while Fast_Core keeps allocating from 18, so an id says which app created
-- the row and the two lists can never collide.
--
-- Apply with:
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/066_portal_form_team_member.sql
--
-- Do NOT also apply it to Rocks_Portal_Form_UAT, unlike every other migration in
-- this folder. Identity lives in exactly one place (owner decision 1) and both
-- pools reach it three-part; a second copy in UAT would be a second role list to
-- keep in step, and the app would silently read whichever one the request's form
-- happened to route to. The _UAT guard below is 061's and 064's guard inverted:
-- those two may only run on UAT, this one may only run off it. A second guard
-- then requires the database to actually be a form database, so a mistyped --db
-- cannot reach Fast_Core; see the comment on it for why that one matters most.

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 066 must not be applied to the UAT form database. Identity lives only in production. Current database is %s.',
    16, 1, @wrongDb
  );
END
-- Second guard, and the reason it is a positive test rather than a blocklist:
-- every other statement in this migration no-ops when it is pointed at Fast_Core
-- -- the table, all four indexes and the FK are already there under exactly these
-- names, and the 17 rows make the copy skip -- but the reseed in batch 2 would
-- still fire and push the LIVE shared identity to 100001, inverting the very
-- collision-avoidance this migration exists to create. Requiring dbo.AccRequest,
-- which only a form database has, refuses Fast_Core, Fast_Data, master and plain
-- typos alike.
ELSE IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 066 may only be applied to a Form Portal form database (no dbo.AccRequest here). Current database is %s.',
    16, 1, @notForm
  );
END
ELSE
BEGIN
  -- All DDL sits inside the ELSE, exactly as 061 and 064 do: RAISERROR at
  -- severity 16 does not abort the batch, so a guard that only raised would let
  -- everything below it run anyway.
  IF OBJECT_ID('dbo.TeamMember', 'U') IS NULL
  BEGIN
    -- Column types, nullability and default values are Fast_Core's, verbatim.
    -- GETDATE() rather than the SYSDATETIME() used elsewhere in this database is
    -- deliberate: matching the original keeps a schema diff between the two
    -- copies clean, and precision on these two audit columns is not worth a
    -- silent divergence.
    --
    -- Only the constraint NAMES differ. Fast_Core's copy carries auto-generated
    -- ones (PK__TeamMemb__3214EC07F1D2705A and friends) that are unreproducible
    -- and unmentionable, so the primary key, the check and all five defaults are
    -- named explicitly here.
    --
    -- FK_TeamMember_Manager is deliberately absent: one row's ManagerId points at
    -- another row, and adding the self-FK before the copy would make the insert
    -- depend on row order. It goes on in batch 2, after the rows are in.
    CREATE TABLE [dbo].[TeamMember] (
      [Id]        INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_TeamMember] PRIMARY KEY,
      [FullName]  NVARCHAR(200) NOT NULL,
      [Nickname]  NVARCHAR(100) NOT NULL,
      [Email]     NVARCHAR(200) NOT NULL CONSTRAINT [UQ_TeamMember_Email] UNIQUE,
      [AppRole]   NVARCHAR(30)  NOT NULL
                    CONSTRAINT [DF_TeamMember_AppRole] DEFAULT ('Staff')
                    CONSTRAINT [CK_TeamMember_AppRole]
                      CHECK ([AppRole] IN ('Staff', 'IT Admin', 'System Admin', 'Viewer')),
      [Position]  NVARCHAR(200) NULL,
      [Color]     NVARCHAR(20)  NOT NULL CONSTRAINT [DF_TeamMember_Color] DEFAULT ('#6c757d'),
      [Photo]     NVARCHAR(500) NULL,
      [ManagerId] INT           NULL,
      [IsActive]  BIT           NOT NULL CONSTRAINT [DF_TeamMember_IsActive] DEFAULT (1),
      [CreatedAt] DATETIME2(7)  NOT NULL CONSTRAINT [DF_TeamMember_CreatedAt] DEFAULT (GETDATE()),
      [UpdatedAt] DATETIME2(7)  NOT NULL CONSTRAINT [DF_TeamMember_UpdatedAt] DEFAULT (GETDATE())
    );

    PRINT 'Created dbo.TeamMember.';
  END
  ELSE
    PRINT 'dbo.TeamMember already exists. Left untouched.';
END
GO

SET NOCOUNT ON;

-- The guard is repeated on every batch rather than stated once. apply-sql aborts
-- the run on the first failing batch, so one guard would be enough there -- but
-- the same file pasted into SSMS runs every batch regardless of a severity-16
-- error in an earlier one, and this batch is the one that copies live rows.
IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 066 must not be applied to the UAT form database. Identity lives only in production. Current database is %s.',
    16, 1, @wrongDb2
  );
END
ELSE IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm2 NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 066 may only be applied to a Form Portal form database (no dbo.AccRequest here). Current database is %s.',
    16, 1, @notForm2
  );
END
ELSE
BEGIN
  -- Everything below runs in one transaction. The copy gets exactly one attempt:
  -- the NOT EXISTS guard that makes it re-runnable also means a half-landed copy
  -- would be skipped forever on the next run, leaving the roster permanently
  -- short with nothing to signal it. XACT_ABORT plus an explicit transaction
  -- makes that unreachable -- anything that fails in here leaves the table
  -- exactly as empty as it found it, and the re-run copies the lot.
  -- 064_uat_identity_floor.sql wraps its ALTERs the same way, for the same
  -- reason: one error to read, and nothing half-applied to unpick.
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  -- Indexes are Fast_Core's four, reproduced as they are. IX_TeamMember_Email is
  -- redundant against the unique constraint on the same column and would not be
  -- created from scratch today, but the copy is meant to match the original
  -- rather than quietly improve on it -- and dropping it is a separate decision
  -- with its own query plans to check.
  IF NOT EXISTS (SELECT 1 FROM sys.indexes
                 WHERE name = 'IX_TeamMember_Email'
                   AND object_id = OBJECT_ID('dbo.TeamMember'))
    CREATE INDEX [IX_TeamMember_Email] ON [dbo].[TeamMember] ([Email]);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes
                 WHERE name = 'IX_TeamMember_IsActive'
                   AND object_id = OBJECT_ID('dbo.TeamMember'))
    CREATE INDEX [IX_TeamMember_IsActive] ON [dbo].[TeamMember] ([IsActive]);

  IF NOT EXISTS (SELECT 1 FROM sys.indexes
                 WHERE name = 'IX_TeamMember_ManagerId'
                   AND object_id = OBJECT_ID('dbo.TeamMember'))
    CREATE INDEX [IX_TeamMember_ManagerId] ON [dbo].[TeamMember] ([ManagerId]);

  -- Copy the roster, ids and all. Guarded on the table being empty so a re-run
  -- cannot double-insert -- and so a re-run after Form Portal has started
  -- managing its own roles cannot overwrite them with Fast_Core's.
  --
  -- One set-based INSERT, not a row loop: the self-reference from the one row
  -- with a ManagerId resolves inside the single statement, so there is no insert
  -- order to get wrong.
  IF NOT EXISTS (SELECT 1 FROM [dbo].[TeamMember])
  BEGIN
    DECLARE @copiedRows INT;

    SET IDENTITY_INSERT [dbo].[TeamMember] ON;

    INSERT INTO [dbo].[TeamMember]
      (Id, FullName, Nickname, Email, AppRole, Position, Color, Photo, ManagerId, IsActive, CreatedAt, UpdatedAt)
    SELECT Id, FullName, Nickname, Email, AppRole, Position, Color, Photo, ManagerId, IsActive, CreatedAt, UpdatedAt
    FROM [Fast_Core].[dbo].[TeamMember];

    -- Captured on the very next line because @@ROWCOUNT is reset by whatever
    -- statement runs after the INSERT -- including the SET IDENTITY_INSERT below.
    -- It is also the reason this is not a COUNT(*): PRINT takes a scalar
    -- expression and rejects an inline subquery at COMPILE time, which fails the
    -- whole batch rather than just the PRINT.
    SET @copiedRows = @@ROWCOUNT;

    SET IDENTITY_INSERT [dbo].[TeamMember] OFF;

    PRINT 'Copied ' + CAST(@copiedRows AS NVARCHAR(10))
        + ' row(s) from [Fast_Core].[dbo].[TeamMember].';
  END
  ELSE
    PRINT 'dbo.TeamMember already holds rows. Copy skipped.';

  -- Now that the rows are in, the self-FK can go on. WITH CHECK, not NOCHECK, so
  -- the copied rows are validated: if the one populated ManagerId did not come
  -- across, this fails with 547 instead of leaving a dangling reference behind an
  -- untrusted constraint.
  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys
                 WHERE name = 'FK_TeamMember_Manager'
                   AND parent_object_id = OBJECT_ID('dbo.TeamMember'))
    ALTER TABLE [dbo].[TeamMember] WITH CHECK
      ADD CONSTRAINT [FK_TeamMember_Manager] FOREIGN KEY ([ManagerId])
        REFERENCES [dbo].[TeamMember] ([Id]);

  -- Reseed into a range Fast_Core will not reach (owner decision 2). The guard
  -- makes this re-runnable: once the counter has moved past 100000 -- which it
  -- will, the moment a user is provisioned here -- the reseed is skipped rather
  -- than lowering a live counter back onto ids already handed out.
  --
  -- The scalar subquery is legal here, unlike in a PRINT: an IF predicate is one
  -- of the contexts that does accept one.
  IF (SELECT IDENT_CURRENT('dbo.TeamMember')) < 100000
    DBCC CHECKIDENT ('dbo.TeamMember', RESEED, 100000) WITH NO_INFOMSGS;

  COMMIT TRANSACTION;

  -- Reported after the COMMIT so it describes what is actually on disk.
  -- IDENT_CURRENT is a function call, not a subquery, so it is fine in a PRINT;
  -- it returns sql_variant, which the add operator rejects outright, hence the
  -- cast to BIGINT before the +1.
  PRINT 'dbo.TeamMember next id: '
      + CAST(CAST(IDENT_CURRENT('dbo.TeamMember') AS BIGINT) + 1 AS NVARCHAR(20)) + '.';
END
GO
