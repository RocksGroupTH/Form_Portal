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
-- `WHERE NotifiedAt IS NULL` makes it idempotent and makes it impossible for a
-- re-run to overwrite a genuine send with a CreatedAt.
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
  ALTER TABLE [dbo].[AccTravelRoomShare] ADD [NotifiedAt] DATETIME2(7) NULL;
  PRINT 'Added AccTravelRoomShare.NotifiedAt.';
END
ELSE
  PRINT 'AccTravelRoomShare.NotifiedAt already present — skipped.';
GO

-- A SEPARATE BATCH, and it has to be: SQL Server binds column names when it
-- compiles a batch, so a statement naming NotifiedAt in the same batch as the
-- ALTER above would fail to compile even though the column is about to exist.
UPDATE [dbo].[AccTravelRoomShare]
   SET [NotifiedAt] = [CreatedAt]
 WHERE [NotifiedAt] IS NULL;
PRINT CONCAT('Backfilled NotifiedAt = CreatedAt on ', @@ROWCOUNT, ' pre-existing binding(s).');
GO

-- Post-apply, on BOTH databases: every EXISTING row stamped, no row left NULL.
-- From here on a NULL means "a binding written since this migration, whose
-- guest has not been submitted yet" — which is exactly the state that earns a
-- mail at submit.
SELECT DB_NAME()                                          AS db,
       COUNT(*)                                           AS [Rows],
       SUM(CASE WHEN [NotifiedAt] IS NULL THEN 1 ELSE 0 END) AS NotYetNotified
FROM [dbo].[AccTravelRoomShare];
GO
