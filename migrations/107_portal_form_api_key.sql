-- API keys and their change log move into the Accounting database.
--
-- Apply with (Rocks_Portal_Form ONLY -- NOT the UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/107_portal_form_api_key.sql
--
-- NUMBERED 107, NOT 106. 106 (AccReimburseAccess) belongs to the unmerged
-- feat/ap-4-reimbursement branch, so master's highest applied number being 105
-- is not the number to reason from -- the same reason 095 was not 067. See the
-- AP-17 roster note in CLAUDE.md.
--
-- ---------------------------------------------------------------------------
-- SINGLE COPY, PRODUCTION ONLY. Not created in Rocks_Portal_Form_UAT, not
-- dual-written, not in MASTER_TABLES. A credential is not configuration that
-- differs by environment the way an approver roster does: there is one
-- Anthropic key, one Google Maps key, and a tester in UAT mode calls the same
-- providers a production user does. Reads go through getProductionFormPool(),
-- never getFormPool(), which would resolve Rocks_Portal_Form_UAT for a tester
-- and find no table at all.
--
-- WHAT IS STORED. SecretEnc holds an AES-256-GCM box produced by
-- src/lib/db/connection-crypto.ts under CONNECTION_ENCRYPTION_KEY -- the same
-- envelope DbConnection.PasswordEnc uses, deliberately, so there is one secret
-- to rotate rather than two. NOTHING WRITES PLAINTEXT HERE: the service refuses
-- to save at all when that env var is unset, rather than falling back to
-- storing the key as it stands.
--
-- ExpiresAt NULL IS "NO EXPIRY". There is deliberately no IsNonExpiring column
-- beside it. A flag plus a date can hold two contradictory states -- ticked
-- non-expiring while carrying a date -- which then has to be defended against
-- on every read and every write. One nullable column cannot.
--
-- THE DATE IS A HUMAN'S NOTE AND BLOCKS NOTHING. It is unconnected to whatever
-- the provider actually enforces, so resolveApiKey() hands back the value
-- however far past it is; src/lib/api-keys/expiry.ts turns it into colour and
-- copy and nothing else. Refusing a key on our own typed date would close AP-17
-- -- which cannot accept an ID card it fails to verify -- for the whole company
-- while the real credential was still working.
--
-- NO HARD DELETE. Removal is IsActive = 0, matching UatTester and AccApprover.
-- ApiKeyLog therefore has an ordinary NOT NULL FK with no cascade: a log row
-- can always name a key that still exists, and a key's history cannot be
-- destroyed by removing the key.
--
-- THE LOG NEVER HOLDS ANY PART OF A SECRET -- not the value, not the
-- ciphertext, not the last four characters. `secret_rotated` records that the
-- value changed, by whom and when, which is what an audit asks. An absolute
-- rule survives contact with future edits; "only a masked tail" does not.
-- ---------------------------------------------------------------------------

-- Batch 1 -- refuse the UAT twin outright.
IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  RAISERROR('107 must not be applied to a UAT database. API keys are production-only, single-copy.', 16, 1);
END
GO

-- Batch 2 -- the registry.
IF OBJECT_ID('dbo.ApiKey', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ApiKey] (
    [Id]         int IDENTITY(1,1) NOT NULL,
    -- Uppercase by convention AND by constraint: the page uppercases what is
    -- typed, and this stops anything else creating a near-duplicate that the
    -- unique index below would not catch on a case-sensitive collation.
    [Code]       nvarchar(64)  NOT NULL,
    [Name]       nvarchar(200) NOT NULL,
    [SecretEnc]  nvarchar(max) NOT NULL,
    -- NULL = no expiry. See the header.
    [ExpiresAt]  date NULL,
    [IsActive]   bit NOT NULL CONSTRAINT DF_ApiKey_IsActive DEFAULT (1),
    [CreatedBy]  int NULL,
    [CreatedAt]  datetime2(7) NOT NULL CONSTRAINT DF_ApiKey_CreatedAt DEFAULT (sysdatetime()),
    [UpdatedBy]  int NULL,
    [UpdatedAt]  datetime2(7) NOT NULL CONSTRAINT DF_ApiKey_UpdatedAt DEFAULT (sysdatetime()),
    CONSTRAINT PK_ApiKey PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT CK_ApiKey_CodeUpper CHECK ([Code] = UPPER([Code])),
    CONSTRAINT CK_ApiKey_CodeShape CHECK ([Code] NOT LIKE '%[^A-Z0-9_]%' AND LEN([Code]) > 0)
  );

  -- One row per code, including the inactive ones: reusing a retired code would
  -- make its log ambiguous about which key an entry belongs to.
  CREATE UNIQUE INDEX UQ_ApiKey_Code ON [dbo].[ApiKey] ([Code]);
END
GO

-- Batch 3 -- the change log.
IF OBJECT_ID('dbo.ApiKeyLog', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[ApiKeyLog] (
    [Id]        int IDENTITY(1,1) NOT NULL,
    [ApiKeyId]  int NOT NULL,
    -- Denormalised so the log reads without a join, and stays readable if a
    -- code is ever renamed.
    [Code]      nvarchar(64) NOT NULL,
    [Action]    nvarchar(20) NOT NULL,
    -- What changed, in words. NEVER any part of the secret -- see the header.
    [Detail]    nvarchar(1000) NULL,
    [ChangedBy] int NULL,
    [ChangedAt] datetime2(7) NOT NULL CONSTRAINT DF_ApiKeyLog_ChangedAt DEFAULT (sysdatetime()),
    CONSTRAINT PK_ApiKeyLog PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT FK_ApiKeyLog_ApiKey FOREIGN KEY ([ApiKeyId]) REFERENCES [dbo].[ApiKey] ([Id]),
    CONSTRAINT CK_ApiKeyLog_Action CHECK ([Action] IN
      ('created', 'renamed', 'expiry_changed', 'secret_rotated', 'deactivated', 'reactivated'))
  );

  -- The one query this table exists to answer: everything that happened to one
  -- key, newest first.
  CREATE INDEX IX_ApiKeyLog_Key ON [dbo].[ApiKeyLog] ([ApiKeyId], [ChangedAt] DESC);
END
GO
