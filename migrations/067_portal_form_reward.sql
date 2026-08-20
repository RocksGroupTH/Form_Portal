-- AP-11 "แลกของรางวัล" (Reward) -- reward master, request detail, Assist AP roster.
--
-- Database: Rocks_Portal_Form  AND  Rocks_Portal_Form_UAT
-- Apply with:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/067_portal_form_reward.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/067_portal_form_reward.sql
--
-- Unlike 066, this one belongs in BOTH form databases: it creates Acc* tables,
-- and AP-11 is meant to be pilotable in UAT the way AP-1 and AP-17 are. Run
-- 068 against the UAT database afterwards to give AccRewardRequest the 900000
-- identity floor that 061/064 gave every other transactional table.
--
-- Three tables and one constraint change:
--
--   AccReward         the reward catalogue, brand-scoped. Carries the stock
--                     counters, which is what makes AP-11 different from every
--                     other form on this backbone -- see CK_AccReward_Stock.
--   AccRewardRequest  one row per request (AP-11 is one reward per request),
--                     with the value snapshot and the Ready/Received stamps.
--   AccRewardOfficer  the Assist AP roster. Deliberately NOT AccApprover: the
--                     people who hand out rewards are not the people who
--                     approve travel claims.
--
--   CK_AccRequest_Status gains 'Ready' and 'Received'.
--
-- Idempotent throughout -- safe to re-run, and safe to run against a database
-- where a previous attempt got part way.

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Guard. Both form databases are legitimate targets, so the test is on the name
-- prefix rather than 061's _UAT suffix. It exists to keep a mistyped --db out of
-- Fast_Form -- the live Rocks Fast database, which also has dbo.AccRequest and
-- would silently accept every statement below. Requiring the NAME as well as the
-- table is what tells the two apart.
IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 067 may only be applied to Rocks_Portal_Form or Rocks_Portal_Form_UAT. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @noAcc NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 067 expects the Accounting backbone (dbo.AccRequest) to exist. Apply 059 first. Current database is %s.',
    16, 1, @noAcc
  );
END
GO

-- 1. AccReward -- the catalogue ---------------------------------------------
--
-- Qty is stock received and is entered by hand. LockedQty and IssuedQty are
-- counters the application maintains and nobody edits: LockedQty is held by
-- in-flight requests from submit until the request is rejected or the goods are
-- handed over, IssuedQty is what has actually gone out of the door.
--
-- The two Total* columns are computed rather than stored so they cannot drift
-- from the per-unit figures they are derived from (brief §8 and §10 are
-- "unit × Qty"). They are not PERSISTED -- nothing indexes or filters on them,
-- and leaving them virtual means a change to Qty or a unit value can never
-- leave a stale total behind.
IF OBJECT_ID('dbo.AccReward', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccReward] (
    [Id]               INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]        NVARCHAR(20)   NOT NULL,
    [Code]             NVARCHAR(50)   NOT NULL,
    [Name]             NVARCHAR(200)  NOT NULL,

    [Qty]              INT            NOT NULL CONSTRAINT [DF_AccReward_Qty]       DEFAULT (0),
    [LockedQty]        INT            NOT NULL CONSTRAINT [DF_AccReward_Locked]    DEFAULT (0),
    [IssuedQty]        INT            NOT NULL CONSTRAINT [DF_AccReward_Issued]    DEFAULT (0),

    [UnitActualValue]  DECIMAL(18,2)  NULL,
    [UnitBookValue]    DECIMAL(18,2)  NULL,
    [TotalActualValue] AS (CONVERT(DECIMAL(18,2), [Qty] * [UnitActualValue])),
    [TotalBookValue]   AS (CONVERT(DECIMAL(18,2), [Qty] * [UnitBookValue])),

    [StartDate]        DATE           NULL,
    [ExpireDate]       DATE           NULL,
    [PoNo]             NVARCHAR(100)  NULL,
    [PinNo]            NVARCHAR(100)  NULL,
    [PrepaymentNo]     NVARCHAR(100)  NULL,

    [IsActive]         BIT            NOT NULL CONSTRAINT [DF_AccReward_IsActive]  DEFAULT (1),
    [SortOrder]        INT            NOT NULL CONSTRAINT [DF_AccReward_SortOrder] DEFAULT (0),
    [CreatedBy]        INT            NULL,
    [CreatedAt]        DATETIME2(7)   NOT NULL CONSTRAINT [DF_AccReward_CreatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedBy]        INT            NULL,
    [UpdatedAt]        DATETIME2(7)   NOT NULL CONSTRAINT [DF_AccReward_UpdatedAt] DEFAULT (SYSDATETIME()),

    CONSTRAINT [PK_AccReward] PRIMARY KEY CLUSTERED ([Id]),

    -- The oversell guard, and the reason it lives in the schema rather than only
    -- in the service: AP-11 is the first form on this backbone whose submit
    -- consumes a finite resource, so a bug in the lock would not surface as a
    -- wrong number on a report -- it would surface as goods promised twice and
    -- one person turned away at the counter. The application takes stock with a
    -- conditional UPDATE that cannot oversell; this makes it true regardless.
    CONSTRAINT [CK_AccReward_Stock] CHECK (
      [Qty] >= 0 AND [LockedQty] >= 0 AND [IssuedQty] >= 0
      AND [LockedQty] + [IssuedQty] <= [Qty]
    )
  );
  PRINT 'Created AccReward';
END
ELSE PRINT 'AccReward already exists -- skipping';
GO

IF OBJECT_ID('dbo.AccReward', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'UX_AccReward_Brand_Code'
                     AND object_id = OBJECT_ID('dbo.AccReward'))
BEGIN
  CREATE UNIQUE INDEX [UX_AccReward_Brand_Code] ON [dbo].[AccReward] ([BrandCode], [Code]);
  PRINT 'Created UX_AccReward_Brand_Code';
END
GO

-- 2. AccRewardRequest -- the per-request detail ------------------------------
--
-- One row per AccRequest, because AP-11 is one reward per request. The four
-- Reward* snapshot columns are copied from AccReward at submit and never
-- updated: a settings edit six months later must not rewrite what somebody was
-- issued, and the report reads the snapshot rather than joining back to a row
-- whose Name or value may have moved on.
--
-- ReadyAt/ReceivedAt are the two stamps the Assist AP work page writes (brief
-- §"หน้าทำงานของ Assist AP": press Ready when the goods are prepared, Received
-- when the requester has collected them).
IF OBJECT_ID('dbo.AccRewardRequest', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccRewardRequest] (
    [Id]                INT            IDENTITY(1,1) NOT NULL,
    [RequestId]         INT            NOT NULL,
    [RewardId]          INT            NULL,

    [RewardCode]        NVARCHAR(50)   NULL,
    [RewardName]        NVARCHAR(200)  NULL,
    [UnitActualValue]   DECIMAL(18,2)  NULL,
    [UnitBookValue]     DECIMAL(18,2)  NULL,

    -- What is being ASKED FOR. Editable on a draft, and on a Returned request.
    [Qty]               INT            NOT NULL CONSTRAINT [DF_AccRewardRequest_Qty] DEFAULT (0),

    -- What this request is actually HOLDING in AccReward.LockedQty right now.
    --
    -- Deliberately separate from Qty, and the separation is load-bearing: a
    -- Returned request keeps its hold while the requester edits, and they may
    -- edit the quantity. Reading the held amount back out of Qty would make the
    -- two always equal, so a resubmit that changed 5 to 8 would adjust the lock
    -- by zero and leave the reward under-locked by 3 -- an oversell that
    -- CK_AccReward_Stock cannot see, because the counters stay internally
    -- consistent while no longer describing the requests.
    --
    -- Written only by the submit path and the approval engine, alongside the
    -- matching AccReward counter change and inside the same transaction.
    [LockedQty]         INT            NOT NULL CONSTRAINT [DF_AccRewardRequest_Locked] DEFAULT (0),

    -- The reward the hold is against, which can differ from RewardId after a
    -- Returned request is pointed at a different reward. Release the old, take
    -- the new.
    [LockedRewardId]    INT            NULL,

    [Note]              NVARCHAR(1000) NULL,

    [ReadyAt]           DATETIME2(7)   NULL,
    [ReadyBy]           INT            NULL,
    [ReceivedAt]        DATETIME2(7)   NULL,
    [ReceivedBy]        INT            NULL,

    [CreatedAt]         DATETIME2(7)   NOT NULL CONSTRAINT [DF_AccRewardRequest_CreatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedAt]         DATETIME2(7)   NOT NULL CONSTRAINT [DF_AccRewardRequest_UpdatedAt] DEFAULT (SYSDATETIME()),

    CONSTRAINT [PK_AccRewardRequest] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [CK_AccRewardRequest_Qty] CHECK ([Qty] >= 0 AND [LockedQty] >= 0)
  );
  PRINT 'Created AccRewardRequest';
END
ELSE PRINT 'AccRewardRequest already exists -- skipping';
GO

-- One detail row per request. A UNIQUE index rather than a comment, because the
-- stock lock is keyed on this being 1:1 -- a second row for the same request
-- would take stock twice and release it once.
IF OBJECT_ID('dbo.AccRewardRequest', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'UX_AccRewardRequest_RequestId'
                     AND object_id = OBJECT_ID('dbo.AccRewardRequest'))
BEGIN
  CREATE UNIQUE INDEX [UX_AccRewardRequest_RequestId] ON [dbo].[AccRewardRequest] ([RequestId]);
  PRINT 'Created UX_AccRewardRequest_RequestId';
END
GO

IF OBJECT_ID('dbo.AccRewardRequest', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_AccRewardRequest_RewardId'
                     AND object_id = OBJECT_ID('dbo.AccRewardRequest'))
BEGIN
  CREATE INDEX [IX_AccRewardRequest_RewardId] ON [dbo].[AccRewardRequest] ([RewardId]);
  PRINT 'Created IX_AccRewardRequest_RewardId';
END
GO

IF OBJECT_ID('dbo.AccRewardRequest', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccRewardRequest_Request')
BEGIN
  ALTER TABLE [dbo].[AccRewardRequest] WITH CHECK
    ADD CONSTRAINT [FK_AccRewardRequest_Request]
    FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest] ([Id]);
  PRINT 'Created FK_AccRewardRequest_Request';
END
GO

-- RewardId is nullable and has no FK on purpose: a reward that is retired from
-- the catalogue must not make historical requests unreadable, and the snapshot
-- columns already carry everything the detail page and the report need.
GO

-- 3. AccRewardOfficer -- the Assist AP roster --------------------------------
IF OBJECT_ID('dbo.AccRewardOfficer', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccRewardOfficer] (
    [Id]          INT            IDENTITY(1,1) NOT NULL,
    [StaffId]     INT            NULL,
    [Email]       NVARCHAR(200)  NOT NULL,
    [DisplayName] NVARCHAR(200)  NULL,
    [PhotoUrl]    NVARCHAR(MAX)  NULL,
    [IsActive]    BIT            NOT NULL CONSTRAINT [DF_AccRewardOfficer_IsActive]  DEFAULT (1),
    [CreatedBy]   INT            NULL,
    [CreatedAt]   DATETIME2(7)   NOT NULL CONSTRAINT [DF_AccRewardOfficer_CreatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedAt]   DATETIME2(7)   NOT NULL CONSTRAINT [DF_AccRewardOfficer_UpdatedAt] DEFAULT (SYSDATETIME()),

    CONSTRAINT [PK_AccRewardOfficer] PRIMARY KEY CLUSTERED ([Id])
  );
  PRINT 'Created AccRewardOfficer';
END
ELSE PRINT 'AccRewardOfficer already exists -- skipping';
GO

IF OBJECT_ID('dbo.AccRewardOfficer', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'UX_AccRewardOfficer_Email'
                     AND object_id = OBJECT_ID('dbo.AccRewardOfficer'))
BEGIN
  CREATE UNIQUE INDEX [UX_AccRewardOfficer_Email] ON [dbo].[AccRewardOfficer] ([Email]);
  PRINT 'Created UX_AccRewardOfficer_Email';
END
GO

-- 4. CK_AccRequest_Status gains 'Ready' and 'Received' -----------------------
--
-- Same shape as migration 050, which added 'Completed' for AP-17. AP-11's
-- fulfilment stages are real header statuses rather than flags on the detail
-- row so that /my-request and /my-work show where the request actually is
-- instead of freezing at "อนุมัติแล้ว" from Assist AP approval to collection.
IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_AccRequest_Status'
    AND parent_object_id = OBJECT_ID('dbo.AccRequest')
    AND definition LIKE '%Received%'
)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints
             WHERE name = 'CK_AccRequest_Status'
               AND parent_object_id = OBJECT_ID('dbo.AccRequest'))
    ALTER TABLE [dbo].[AccRequest] DROP CONSTRAINT [CK_AccRequest_Status];

  ALTER TABLE [dbo].[AccRequest] ADD CONSTRAINT [CK_AccRequest_Status] CHECK ([Status] IN
    ('Draft','Submitted','ManagerApproved','Approved','Rejected','Returned','Cancelled','Completed',
     'Ready','Received'));
  PRINT 'Recreated CK_AccRequest_Status to allow Ready + Received';
END
ELSE PRINT 'CK_AccRequest_Status already allows Received -- skipping';
GO

-- 5. Seed AccFormMaster AP-11 (table created in migration 013) ---------------
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormMaster] WHERE FormCode = 'AP-11')
  INSERT INTO [dbo].[AccFormMaster]
    (FormCode, GroupName, FormNameTh, FormNameEn, RunningPrefix, OwnerContact, SortOrder)
  VALUES
    ('AP-11', 'Accounting', N'แลกของรางวัล', N'Reward', 'TOP', NULL, 11);
GO

-- 6. Seed AccFormBrand for AP-11 --------------------------------------------
--
-- Without at least one row here the form is dead on arrival: rewards are
-- brand-scoped, `getAllowedBrands('AP-11')` returns nothing, and the requester
-- sees an empty brand strip and an empty catalogue with no way to proceed. No
-- migration seeds this table for AP-1 or AP-17 -- their rows were added through
-- the settings UI -- but that UI is hardcoded to AP-1
-- (src/app/api/request/accounting/settings/brands/route.ts), so AP-11 cannot
-- borrow it. AP-11 has its own endpoint for adjusting this afterwards; this
-- seed is only about the first run.
--
-- Mirrors whatever AP-1 is already open for, because that is the brand set
-- somebody has already curated for accounting forms in this database. Falls
-- back to every active brand in the company master when AP-1 has no rows --
-- which is the state of a freshly stood-up database.
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormBrand] WHERE FormCode = 'AP-11')
BEGIN
  IF EXISTS (SELECT 1 FROM [dbo].[AccFormBrand] WHERE FormCode = 'AP-1')
  BEGIN
    INSERT INTO [dbo].[AccFormBrand] (FormCode, BrandCode, IsActive, SortOrder)
    SELECT 'AP-11', BrandCode, IsActive, SortOrder
      FROM [dbo].[AccFormBrand] WHERE FormCode = 'AP-1';
    PRINT 'Seeded AccFormBrand for AP-11 from AP-1''s brand set';
  END
  ELSE
  BEGIN
    INSERT INTO [dbo].[AccFormBrand] (FormCode, BrandCode, IsActive, SortOrder)
    SELECT 'AP-11', Code, 1, Id
      FROM [Rocks_Codex].[dbo].[Brand]
     WHERE IsActive = 1 AND Code IS NOT NULL AND LTRIM(RTRIM(Code)) <> '';
    PRINT 'Seeded AccFormBrand for AP-11 from the Rocks_Codex brand master';
  END
END
ELSE PRINT 'AccFormBrand already has AP-11 rows -- skipping';
GO

PRINT '=== Migration 067 complete ===';
GO
