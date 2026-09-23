-- 158_room_share_notified_at.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before
-- the code deploys:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/158_room_share_notified_at.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/158_room_share_notified_at.sql
--
-- NUMBERED 158. `ls migrations/` stops at 157 on master, and 158 was confirmed
-- free on every local and remote branch before this file was written
-- (`git ls-tree -r --name-only <branch> -- migrations/` across all eleven,
-- 2026-09-23). CLAUDE.md records eleven duplicated migration numbers already;
-- this does not add a twelfth.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS.
--
-- One nullable column on AP-17's room-share binding: **when was the host told
-- about this binding, if ever.**
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMN EXISTS AT ALL — "ONCE PER BINDING", NOT "ONCE PER SUBMIT".
--
-- The user's instruction, 2026-09-23: *"เมลจะส่งเมื่อ ส่งคำขอเท่านั้น"* — the
-- host notice goes out on SUBMIT, never on a draft save. Until today
-- `applyRoomShareSelection` queued it inside `saveTravelBookingDraft`, so a
-- requester who picked a colleague, saved, and then changed their mind had
-- already mailed them.
--
-- Moving the call to the submit fixes the early mail but not the repeat one:
-- a `Returned` request is resubmitted through the very same code path, so a
-- submit-time send with no memory mails the host *"มีผู้ขอพักห้องร่วมกับคำขอ
-- ของคุณ"* a second time for one guest. Spec §2 declined to ask the host for
-- consent and §5 makes this notice the ENTIRE mitigation for that — and a
-- host who receives it twice may reasonably read it as TWO people having
-- attached. A notification that can be misread as a different event is worse
-- than a late one, so the send has to be exactly-once per binding.
--
-- This column is that memory, and it is on the binding row rather than on the
-- request for the reason the four cases below work out on their own:
--
--   * draft saved, never submitted     -> no submit, nothing stamped, nobody mailed
--   * host changed before submitting   -> applyRoomShareSelection DELETEs and
--                                         re-INSERTs, so the new row's
--                                         NotifiedAt is NULL and only the NEW
--                                         host is told
--   * Returned -> resubmitted, same host -> the row survived (the "unchanged"
--                                         early return writes nothing), it is
--                                         already stamped, no second mail
--   * Returned -> resubmitted, new host  -> new row, NULL again, new host told
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL IS "CreatedAt", AND IT IS EXACT RATHER THAN APPROXIMATE.
--
-- Every row that exists when this migration runs was written by the OLD code,
-- which queued the host's mail on the same transaction as the INSERT — so for
-- those rows the host was told at exactly `CreatedAt`, and stamping it is a
-- statement of fact, not a guess. Left NULL they would each earn the host a
-- SECOND copy of a mail they have already had, on the first submit after this
-- deploys — precisely the double-notification the column exists to prevent.
--
-- It does not under-notify: those hosts have the information, and nothing can
-- un-send what they were already sent.
--
-- *** THE BACKFILL RUNS ONLY WHEN THIS MIGRATION CREATES THE COLUMN, AND THAT
-- *** IS THE WHOLE REASON IT IS INSIDE THE `IF` AND WRITTEN AS DYNAMIC SQL.
--
-- `WHERE NotifiedAt IS NULL` alone would NOT be a safe idempotency guard here,
-- which is the trap: after the code is live, a NULL stops meaning "written by
-- the old code, host already told" and starts meaning "a guest picked a host
-- and has not submitted yet — tell them when they do". Re-run at that point, a
-- NULL-guarded backfill stamps exactly those rows with their CreatedAt and
-- **silently suppresses a notice that was owed**, which is the one failure
-- this whole change exists to prevent, arriving by the back door.
--
-- So the backfill is bound to the creation instead. `ALTER` and backfill sit
-- in ONE batch inside `IF COL_LENGTH(...) IS NULL`, and the backfill goes
-- through `sp_executesql` because SQL Server binds column names when it
-- COMPILES a batch — a plain `UPDATE` naming NotifiedAt beside the ALTER that
-- adds it cannot compile. Dynamic SQL compiles at execution, after the ALTER
-- has run. One explicit transaction under XACT_ABORT wraps both, so a failed
-- backfill takes the column with it and the migration stays re-runnable rather
-- than leaving a created column whose backfill is now permanently skipped.
--
-- ---------------------------------------------------------------------------
-- NULLABLE, NO DEFAULT, NO CHECK.
--
-- No DEFAULT: a row is created by the guest picking a host, which is precisely
-- the moment nobody has been told, so the useful value at INSERT is NULL. A
-- default of SYSDATETIME() would mean "told" from birth and suppress the mail
-- entirely.
--
-- No CHECK: there is nothing to constrain. It is a timestamp or it is absent,
-- and `claimRoomShareHostNotice` (room-share-service.ts) is its single writer.
--
-- DATETIME2(7) to match `CreatedAt` beside it, which migration 156 declared as
-- bare DATETIME2 — the same precision, spelled out. Written by SYSDATETIME(),
-- like every other audit timestamp here: these databases hold a Thai wall
-- clock and the driver runs `useUTC: false` (CLAUDE.md, Conventions → Dates).
--
-- ---------------------------------------------------------------------------
-- BOTH FORM DATABASES, BEFORE THE CODE.
--
-- SQL Server binds column names at COMPILE time, so the column missing from
-- EITHER database is "Invalid object name" — the whole statement fails rather
-- than answering NULL — and AP-17 resolves either database depending on who is
-- asking. The statement in question sits INSIDE `submitTravelBookingGroup`'s
-- transaction, so before this lands on a given side, **every AP-17 submit
-- against that database fails and rolls back** — not only a guest's. Same
-- hazard migrations 090, 120, 144, 147, 149 and 156 already carry.
--
-- `check:alignment` MUST STILL READ 30 TABLES afterwards. AccTravelRoomShare
-- is transactional: not dual-written, not in MASTER_TABLES. A count of 31
-- means the wrong table was altered.

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelRoomShare', 'U') IS NULL
  THROW 50000, 'dbo.AccTravelRoomShare is missing — apply 156 first.', 1;
GO

IF COL_LENGTH('dbo.AccTravelRoomShare', 'NotifiedAt') IS NULL
BEGIN
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[AccTravelRoomShare] ADD [NotifiedAt] DATETIME2(7) NULL;
  PRINT 'Added AccTravelRoomShare.NotifiedAt.';

  -- Dynamic, and not as a flourish: the ALTER above and this UPDATE are in the
  -- SAME batch on purpose (so the backfill can never run on a later re-run —
  -- see the header), and a batch binds its column names at compile time, so a
  -- plain UPDATE naming NotifiedAt here would fail to compile. sp_executesql
  -- compiles when it executes, by which time the column exists.
  --
  -- @@ROWCOUNT is read INSIDE the dynamic batch, immediately after its own
  -- UPDATE, rather than outside it after the EXEC — the only place it is
  -- unambiguous.
  EXEC sp_executesql N'
    UPDATE [dbo].[AccTravelRoomShare]
       SET [NotifiedAt] = [CreatedAt]
     WHERE [NotifiedAt] IS NULL;
    PRINT CONCAT(''Backfilled NotifiedAt = CreatedAt on '', @@ROWCOUNT, '' pre-existing binding(s).'');';

  COMMIT TRANSACTION;
END
ELSE
  PRINT 'AccTravelRoomShare.NotifiedAt already present — column and backfill both skipped (see header: the backfill is creation-only by design).';
GO

-- Post-apply, on a database this migration has just created the column in:
-- every EXISTING row stamped, NotYetNotified = 0. On a re-run, or once the
-- code has been live, NotYetNotified may legitimately be non-zero — a NULL
-- then means "a binding written since, whose guest has not submitted yet",
-- which is exactly the state that earns a mail at submit.
SELECT DB_NAME()                                          AS db,
       COUNT(*)                                           AS [Rows],
       SUM(CASE WHEN [NotifiedAt] IS NULL THEN 1 ELSE 0 END) AS NotYetNotified
FROM [dbo].[AccTravelRoomShare];
GO
