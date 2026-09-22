-- 157_uat_room_share_identity.sql
-- Target: Rocks_Portal_Form_UAT ONLY — refuses any other database, exactly
-- like 061 and 064.
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/157_uat_room_share_identity.sql
--
-- Apply AFTER 156_acc_travel_room_share.sql has created AccTravelRoomShare in
-- BOTH databases, and before any UAT write can reach the table — the same
-- ordering rule 061's own header states for itself ("061 must precede any UAT
-- write", CLAUDE.md's deployment checklist).
--
-- NUMBERED 157, the sibling of 156 — see that file's header for why 156 and
-- 157 were free.
--
-- ---------------------------------------------------------------------------
-- WHY TWO FILES, NOT ONE.
--
-- 156 must succeed against Rocks_Portal_Form itself, because the table lives
-- in both form databases. 061 and 064 both refuse to run anywhere except a
-- database whose name ends in _UAT (`IF DB_NAME() NOT LIKE '%[_]UAT'`),
-- because reseeding or flooring production's identity would destroy the very
-- id space those two migrations exist to protect — production ids start at 1,
-- so a floor of >= 900000 there would reject every insert. One file cannot
-- both "succeed on Rocks_Portal_Form" and "refuse anything but
-- Rocks_Portal_Form_UAT" at the same time, so this repeats 061/064's split
-- rather than inventing a new shape: 156 creates the table everywhere, 157
-- floors it in UAT alone. No cleaner precedent for combining the two was
-- found while writing this — every migration touching both a real table body
-- and a UAT-only identity rule in this repository (061 vs. 064, and now this
-- pair) keeps them in separate files.
--
-- ---------------------------------------------------------------------------
-- WHY THIS TABLE GETS THE FLOOR AT ALL.
--
-- AccTravelRoomShare is transactional, not shared configuration — see 156's
-- header for the contrast with AccTravelPerDiemCountry (133), which is
-- dual-written and therefore MUST NOT carry this floor. 061/064's own
-- inclusion test is structural: "everything reachable from AccRequest by
-- foreign key, plus the queue". This table's two FKs (GuestRequestId,
-- HostRequestId) point straight at AccRequest.Id — the closest possible case
-- of that test, one hop away — so it belongs in the same 900000 floor as
-- AccApproval and AccActivityLog, even though, unlike those two, its own row
-- id is never carried in a URL. That narrower argument — "is this id ever used
-- to route a request to a database" — is the one CLAUDE.md gives for why
-- AccReimburseItem needs no floor despite being transactional; it does not
-- apply here, because this table's qualification rests on FK reachability
-- from AccRequest, not on its own id appearing anywhere client-facing.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES, AND WHY IT IS SAFE TO RE-RUN.
--
-- Two steps, each guarded to be a no-op on a second run:
--
--   1. Reseed the identity to 900000, but ONLY while IDENT_CURRENT is still
--      below 900000. A brand-new empty table's IDENT_CURRENT reads its seed
--      (1), so the first run reseeds; after that, IDENT_CURRENT reads 900000
--      and the guard skips. If rows were ever inserted before this migration
--      lands — it should not happen, since 156 runs first and this runs
--      before any code deploy that could write to the table —
--      IDENT_CURRENT would already read above 900000 and the guard would
--      still skip, rather than reseeding backward underneath live rows the
--      way an unconditional RESEED would.
--   2. Add CK_AccTravelRoomShare_UatIdFloor (CHECK Id >= 900000), guarded by
--      the same sys.check_constraints existence test 064 uses, added
--      WITH CHECK so a violating row (there should be none) would be caught
--      rather than silently grandfathered in by NOCHECK.
--
-- Do not weaken step 2 to WITH NOCHECK — see 064's own header for why.

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT'
BEGIN
  DECLARE @wrong NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 157 may only be applied to the UAT form database. Current database is %s.',
    16, 1, @wrong
  );
END
ELSE IF OBJECT_ID('dbo.AccTravelRoomShare', 'U') IS NULL
BEGIN
  RAISERROR (
    'dbo.AccTravelRoomShare is missing — apply 156 first. Nothing was changed.',
    16, 1
  );
END
ELSE
BEGIN
  IF IDENT_CURRENT('dbo.AccTravelRoomShare') < 900000
  BEGIN
    DBCC CHECKIDENT ('dbo.AccTravelRoomShare', RESEED, 900000) WITH NO_INFOMSGS;
    PRINT 'AccTravelRoomShare identity reseeded to 900000.';
  END
  ELSE
    PRINT 'AccTravelRoomShare identity already at or beyond 900000 — reseed skipped.';

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.AccTravelRoomShare')
      AND name = N'CK_AccTravelRoomShare_UatIdFloor'
  )
  BEGIN
    ALTER TABLE [dbo].[AccTravelRoomShare] WITH CHECK
      ADD CONSTRAINT [CK_AccTravelRoomShare_UatIdFloor] CHECK ([Id] >= 900000);
    PRINT 'Added identity floor CHECK (>= 900000) to AccTravelRoomShare.';
  END
  ELSE
    PRINT 'AccTravelRoomShare already carries CK_AccTravelRoomShare_UatIdFloor — nothing to do.';
END
GO

-- Post-apply: identity at or above 900000, and the CHECK present.
SELECT
  IDENT_CURRENT('dbo.AccTravelRoomShare') AS IdentCurrent,
  (SELECT COUNT(*) FROM sys.check_constraints
   WHERE parent_object_id = OBJECT_ID('dbo.AccTravelRoomShare')
     AND name = N'CK_AccTravelRoomShare_UatIdFloor') AS HasFloorCheck;
GO
