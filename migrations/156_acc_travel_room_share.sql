-- 156_acc_travel_room_share.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before
-- the code deploys:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/156_acc_travel_room_share.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/156_acc_travel_room_share.sql
--
-- NUMBERED 156. `ls migrations/` stops at 152 on this branch; 153 is taken on
-- the unmerged feat/all-requests-report branch
-- (migrations/153_acc_report_access.sql, confirmed with
-- `git ls-tree -r --name-only feat/all-requests-report -- migrations/`), 154
-- by package C (154_travel_option_requires_id_card.sql) and 155 by the
-- AccTravelPerDiemCountry UAT id realign (155_uat_perdiem_country_id_realign.sql)
-- — both of those already on master. CLAUDE.md already records eleven
-- duplicated migration numbers; this does not add a twelfth. 156 and 157 (its
-- sibling, below) were confirmed free on both master and
-- feat/all-requests-report before this file was written.
--
-- Design: docs/superpowers/specs/2026-09-21-ap17-e-share-a-room.md §3.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS.
--
-- AP-17's พักห้องเดียวกับ ("share a room"): a requester (the GUEST) can attach
-- their own AP-17 request to a colleague's (the HOST) instead of booking
-- anything themselves, and still draw per diem. One row per attachment, one
-- hop deep — see src/lib/acc/travel-booking/room-share-policy.ts (a later
-- task on this branch) for the chain/cycle refusal. Nothing in this migration
-- enforces the one-hop rule beyond what a FOREIGN KEY can express; see "WHAT
-- IS DELIBERATELY NOT HERE" below.
--
-- ---------------------------------------------------------------------------
-- APPLY BEFORE THE CODE REACHES EITHER DATABASE.
--
-- SQL Server binds object names at compile time, so a table missing from one
-- side is 'Invalid object name', not an empty result.
--
-- ---------------------------------------------------------------------------
-- TRANSACTIONAL, NOT SHARED CONFIGURATION.
--
-- Per-request data — who is attached to whose booking — so this table is
-- deliberately NOT dual-written and NOT in MASTER_TABLES. `npm run
-- check:alignment` must still read **30** afterwards; 31 would mean this
-- table was wrongly added to the shared list.
--
-- Being transactional is also why it DOES need the UAT identity floor
-- (>= 900000) that a dual-written master table such as AccTravelPerDiemCountry
-- (133) deliberately goes without. 061/064's own header states the inclusion
-- test structurally: "everything reachable from AccRequest by foreign key,
-- plus the queue". This table's two FKs (GuestRequestId, HostRequestId) point
-- straight at AccRequest.Id — one hop away, the closest possible case of that
-- test — so it belongs in the same floor as AccApproval and AccActivityLog.
-- The floor and its CHECK are NOT in this file: 061 and 064 both refuse any
-- database whose name does not end in _UAT, and this file has to succeed
-- against Rocks_Portal_Form itself (the table lives in both databases), so
-- the two guards cannot share one file honestly. They are in
-- 157_uat_room_share_identity.sql instead — see that file's header for the
-- rest of this reasoning, including why "an id never appears in a URL" (the
-- argument CLAUDE.md gives for why AccReimburseItem needs no floor) does not
-- apply here.
--
-- ---------------------------------------------------------------------------
-- UQ_AccTravelRoomShare_Guest IS THE RULE, NOT AN OPTIMISATION.
--
-- "A guest has at most one host" (spec §3) is not merely a service-layer
-- convention — it is this unique index, on GuestRequestId alone. Without it, a
-- requester who reopens the picker, or changes their mind mid-save, can leave
-- two host rows for the same guest with nothing in the schema to say which one
-- is real. room-share-policy.ts's canAttach() (a later task) refuses a second
-- attach before the INSERT is attempted, but this index is the backstop that
-- holds even if a caller skips that check or two requests race.
--
-- ---------------------------------------------------------------------------
-- IX_AccTravelRoomShare_Host IS NOT DECORATION.
--
-- Every cancellation cascade (spec §4) looks up "who are this host's guests"
-- BY HOST, inside the transaction that is already cancelling or re-dating the
-- host request and is already holding its locks. An unindexed scan there is a
-- table scan run while other rows sit locked — exactly where a missing index
-- is most expensive. This index is what keeps that lookup a seek.
--
-- ---------------------------------------------------------------------------
-- HostStaffId IS DISPLAY ONLY. THE HOST'S IDENTITY IS HostRequestId.
--
-- HostStaffId is stored purely so a list can show "sharing with <name>"
-- without a join back to AccRequest for every row. It does NOT identify the
-- host: AP-17 already allows filing on behalf of somebody else (documented
-- throughout CLAUDE.md's Auth and AP-17 sections), so a request's requester
-- and its nominal StaffId can already differ, and the same person can have
-- more than one live request. A reader who joins on HostStaffId instead of
-- HostRequestId gets the wrong answer the moment the host's booking was filed
-- on behalf of somebody else. Every cascade and every read in this feature
-- must key on HostRequestId; HostStaffId exists for a label and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE.
--
-- No CHECK forbidding GuestRequestId = HostRequestId, and nothing here can
-- forbid a chain (a request that is already somebody's host also becoming a
-- guest, or the reverse) — both are real rules (spec §3) but neither is
-- expressible as a constraint against this table alone: the cycle test needs
-- to walk the graph, which is exactly what room-share-policy.ts's canHost()
-- and canAttach() do, called server-side from the database inside the same
-- transaction that inserts (a later task on this branch). The unique index
-- above is the one rule this migration can and does enforce unassisted.
--
-- No ON DELETE CASCADE on either FK, and the reason first written here was
-- WRONG. It said "AccRequest rows are never hard-deleted in this application --
-- every removal is a status transition, not a DELETE". They are:
-- `collectAndDeleteRequestArtifacts` (request-service.ts:791) runs
-- `DELETE FROM [dbo].[AccRequest] WHERE Id=@rid` for a Draft or Returned AP-17
-- request that its owner discards. Corrected 2026-09-22, before this migration
-- was applied anywhere.
--
-- The FKs stay NO ACTION deliberately, but that is now a decision with a
-- consequence rather than a free one: the delete path must clear
-- AccTravelRoomShare rows itself FIRST, which it does, or the discard raises a
-- raw FK error. ON DELETE CASCADE was rejected because a silent row
-- disappearance is exactly what this feature must not do -- a guest losing its
-- host has to be something code decided and logged, not something the database
-- did on the way past.
--
-- **Deployment consequence, and it is not confined to this feature**: the code
-- that clears those rows ships with package E. Deploy it before this migration
-- and AP-17 DRAFT DELETION breaks for everyone, because the DELETE names a
-- table that does not exist. 156 goes to both form databases before the code.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
  THROW 50000, 'dbo.AccRequest is missing — apply 059 first.', 1;
GO

IF OBJECT_ID('dbo.AccTravelRoomShare', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccTravelRoomShare] (
    [Id]             INT IDENTITY(1,1) NOT NULL
                     CONSTRAINT [PK_AccTravelRoomShare] PRIMARY KEY,
    [GuestRequestId] INT NOT NULL
                     CONSTRAINT [FK_AccTravelRoomShare_Guest] REFERENCES [dbo].[AccRequest]([Id]),
    [HostRequestId]  INT NOT NULL
                     CONSTRAINT [FK_AccTravelRoomShare_Host]  REFERENCES [dbo].[AccRequest]([Id]),
    [HostStaffId]    INT NULL,
    [CreatedAt]      DATETIME2 NOT NULL
                     CONSTRAINT [DF_AccTravelRoomShare_CreatedAt] DEFAULT (SYSDATETIME()),
    [CreatedBy]      INT NULL
  );
  PRINT 'AccTravelRoomShare created.';
END
ELSE
  PRINT 'AccTravelRoomShare already exists — nothing to do.';
GO

-- Scoped to the object, not database-wide — see 133's note: an index name is
-- unique only within its own table, so an unscoped EXISTS could be satisfied
-- by a same-named index on a different table and skip creating this one
-- without saying so.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccTravelRoomShare_Guest'
    AND object_id = OBJECT_ID('dbo.AccTravelRoomShare')
)
  CREATE UNIQUE INDEX [UQ_AccTravelRoomShare_Guest]
    ON [dbo].[AccTravelRoomShare]([GuestRequestId]);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccTravelRoomShare_Host'
    AND object_id = OBJECT_ID('dbo.AccTravelRoomShare')
)
  CREATE INDEX [IX_AccTravelRoomShare_Host]
    ON [dbo].[AccTravelRoomShare]([HostRequestId]);
GO

-- Post-apply, on BOTH databases: 0 rows, identity unallocated (or, in
-- Rocks_Portal_Form_UAT once 157 has also run, floored at 900000 with no rows
-- yet).
SELECT DB_NAME() AS db,
       COUNT(*) AS [Rows],
       IDENT_CURRENT('dbo.AccTravelRoomShare') AS IdentCurrent
FROM dbo.AccTravelRoomShare;
GO
