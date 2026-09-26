-- 165_room_share_one_guest_per_host.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/165_room_share_one_guest_per_host.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/165_room_share_one_guest_per_host.sql
--
-- NUMBERED 165. `git ls-tree -r --name-only <branch> -- migrations/` was
-- checked against every local and remote branch before this file was written
-- (feat/*, fix/*, docs/*, master and origin/*) and none of them holds a
-- migrations/165_*.sql. The highest number anywhere is 164
-- (164_core_form_message.sql, on master).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, AND WHY IT NARROWS SPEC E RATHER THAN EXTENDING IT.
--
-- AP-17's พักห้องเดียวกับ (migration 156) let several guests attach to the
-- same host — `room-share-cascade-apply.ts`'s own `groupKeysOf` comment says
-- so outright: "a guest count of one is the common case but not the only one
-- (spec §8 deliberately does not cap how many attach to a host)". That was
-- the design as shipped.
--
-- The user has since asked for the opposite: a host already chosen by
-- somebody must not be choosable again, and the picker must say who took it.
-- This migration is the schema half of that reversal — CLAUDE.md's own
-- house style is to record a reversal rather than quietly overwrite the
-- reasoning that came before it, so this note says so instead of pretending
-- spec §8 was never decided.
--
-- ---------------------------------------------------------------------------
-- APPLY BEFORE THE CODE REACHES EITHER DATABASE.
--
-- SQL Server binds object names at compile time, but this migration only adds
-- an INDEX, not a column or a table — a query naming no new identifier does
-- not fail if the index is missing, it simply runs unprotected by the
-- backstop below. The application-level refusal (`canHost`'s new
-- "host_taken" code, and `applyRoomShareSelection`'s re-check inside its own
-- transaction) is what actually stops a second attach in the ordinary case;
-- this index is the one enforcement point that holds even if that code is
-- ever bypassed or two attaches race outside the lock discipline
-- `room-share-service.ts` already documents (see `room-share-response-shape-
-- guard.test.ts`'s mutation M13 for why the lock alone is not assumed to be
-- enough).
--
-- ---------------------------------------------------------------------------
-- TRANSACTIONAL, NOT SHARED CONFIGURATION — same as 156/157.
--
-- This migration only touches AccTravelRoomShare, which 156's own header
-- already establishes as per-request data: not dual-written, not in
-- MASTER_TABLES. `npm run check:alignment` must still read **30** afterwards;
-- 31 would mean this table was wrongly added to the shared list.
--
-- ---------------------------------------------------------------------------
-- UQ_AccTravelRoomShare_Host IS THE MIRROR OF UQ_AccTravelRoomShare_Guest,
-- AND IS THE RULE, NOT AN OPTIMISATION — same argument as 156's for the
-- guest-side index, applied to the other column.
--
-- "A host has at most one guest" is not merely a service-layer convention —
-- it is this unique index, on HostRequestId alone. Without it, two racing
-- saves that both pass `canHost`'s "host_taken" check before either commits
-- could both insert a row naming the same host, with nothing in the schema to
-- say which one is real. `room-share-policy.ts`'s `canHost` (a companion
-- change on this branch) refuses a second attach before the INSERT is
-- attempted, but this index is the backstop that holds even if a caller skips
-- that check or two requests race — the identical justification 156 gives for
-- the guest-side index, mirrored onto the host side.
--
-- IX_AccTravelRoomShare_Host, added by 156, is UNCHANGED and stays: this
-- migration does not replace it with the new unique index, because a
-- non-unique index and a unique index are not interchangeable ON THE SAME
-- COLUMN for query-optimizer purposes in every SQL Server version, and there
-- is no correctness reason to remove a working index while adding another —
-- doing so would also mean the cascade's "who are this host's guests" lookup
-- (`loadGuestsOf`) has no index to seek on for however long the drop and the
-- create are not atomic. Both indexes on HostRequestId coexisting costs one
-- small index on a table that measured zero rows on 2026-09-26; it is not
-- worth the risk of a window with neither.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT DO.
--
-- It does not touch UQ_AccTravelRoomShare_Guest, IX_AccTravelRoomShare_Host,
-- HostStaffId, or either foreign key. It adds exactly one index and nothing
-- else — see 156's own header for everything about this table that is
-- unchanged.
--
-- It does not backfill or repair existing data, because there is none to
-- repair: measured by hand on 2026-09-26 against both live databases,
-- Rocks_Portal_Form and Rocks_Portal_Form_UAT each hold ZERO rows in
-- AccTravelRoomShare, and — the more specific fact this migration's own
-- safety rests on — no HostRequestId anywhere carries more than one guest.
-- The defensive check below exists for the gap between that measurement and
-- whenever this file is actually applied, not because a violation is
-- expected.
--
-- ---------------------------------------------------------------------------
-- WHY THE CHECK RAISES BY NAME RATHER THAN LETTING CREATE UNIQUE INDEX FAIL.
--
-- `CREATE UNIQUE INDEX` on a table that already violates the constraint
-- raises Msg 1505 naming ONE duplicate key value and stops — useful, but it
-- forces whoever is watching the apply to go query the table themselves to
-- find every offending HostRequestId, on a table this migration's own
-- deployment note says nobody should be touching by hand. The guard below
-- runs first, lists every HostRequestId that currently has more than one live
-- guest row, and raises with the ids and counts spelled out in the message —
-- so the person applying this sees exactly what would need clearing before
-- retrying, in one error rather than a loop of "fix one, re-run, find the
-- next".
--
-- `DB_NAME()` is routed through a DECLAREd variable before RAISERROR, not
-- passed inline. RAISERROR's substitution arguments are constants or
-- variables and never expressions, so `RAISERROR('...%s...', 16, 1,
-- DB_NAME())` is a parse error — `Incorrect syntax near 'DB_NAME'` — which
-- broke migration 163's first apply for exactly this reason. Migrations 156,
-- 157, 161 and 163 (after its fix) all route it through a variable; this one
-- does too.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENT. Safe to re-run: the index is only created if it does not
-- already exist, and the duplicate-guard runs every time regardless (cheap —
-- one GROUP BY over a table with at most a few hundred rows) so a re-run
-- after a partial failure still checks before it creates.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR('165 targets Rocks_Portal_Form or Rocks_Portal_Form_UAT. Current database is %s — refusing.', 16, 1, @wrongDb);
  RETURN;
END
GO

IF OBJECT_ID('dbo.AccTravelRoomShare', 'U') IS NULL
BEGIN
  RAISERROR('dbo.AccTravelRoomShare is missing — apply 156 (and, in the UAT database, 157) first.', 16, 1);
  RETURN;
END
GO

-- Defensive: this should find nothing, per the 2026-09-26 measurement in this
-- file's header. If it finds something anyway, name it rather than letting
-- CREATE UNIQUE INDEX fail on the first duplicate it happens to hit.
IF EXISTS (
  SELECT 1 FROM [dbo].[AccTravelRoomShare]
  GROUP BY [HostRequestId]
  HAVING COUNT(*) > 1
)
BEGIN
  -- FOR XML PATH('') rather than STRING_AGG (SQL Server 2017+): no other
  -- migration in this repository assumes a STRING_AGG-capable server, and
  -- this classic concatenation idiom works on every version this app has
  -- ever targeted. STUFF(..., 1, 2, '') drops the leading ", " the trick
  -- always produces.
  DECLARE @offenders NVARCHAR(MAX) = STUFF((
    SELECT ', ' + CAST([HostRequestId] AS NVARCHAR(20)) + ' (' + CAST(COUNT(*) AS NVARCHAR(10)) + ' guests)'
      FROM [dbo].[AccTravelRoomShare]
     GROUP BY [HostRequestId]
    HAVING COUNT(*) > 1
    FOR XML PATH(''), TYPE
  ).value('.', 'NVARCHAR(MAX)'), 1, 2, '');
  RAISERROR('165 refuses: the following HostRequestId(s) already have more than one guest row and would violate UQ_AccTravelRoomShare_Host: %s. Resolve which guest keeps the host before re-running.', 16, 1, @offenders);
  RETURN;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccTravelRoomShare_Host'
    AND object_id = OBJECT_ID('dbo.AccTravelRoomShare')
)
  CREATE UNIQUE INDEX [UQ_AccTravelRoomShare_Host]
    ON [dbo].[AccTravelRoomShare]([HostRequestId]);
GO

-- Post-apply, on BOTH databases: the new unique index present, IX_AccTravelRoomShare_Host
-- (156) still present beside it, and (per the header) zero rows either way.
SELECT DB_NAME() AS db,
       COUNT(*) AS [Rows],
       (SELECT COUNT(*) FROM sys.indexes
         WHERE object_id = OBJECT_ID('dbo.AccTravelRoomShare')
           AND name = 'UQ_AccTravelRoomShare_Host') AS HasHostUniqueIndex,
       (SELECT COUNT(*) FROM sys.indexes
         WHERE object_id = OBJECT_ID('dbo.AccTravelRoomShare')
           AND name = 'IX_AccTravelRoomShare_Host') AS HasHostNonUniqueIndex
FROM dbo.AccTravelRoomShare;
GO
