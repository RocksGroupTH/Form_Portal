-- 162_ap4_retire_account_final.sql
-- Target: BOTH form databases — Rocks_Portal_Form AND Rocks_Portal_Form_UAT.
-- Apply AFTER the code deploy. See "ORDER" below — this one is the other way
-- round from most of them, and running it early is the harmless direction.
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/162_ap4_retire_account_final.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/162_ap4_retire_account_final.sql
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS.
--
-- AP-4's THIRD approval step, ACCOUNT_FINAL, was retired on 2026-09-24:
-- accounting approves once and the claim is finished, which is what AP-1 has
-- always done. The code change is `STATE_AFTER_APPROVE.ACCOUNT`, which now
-- lands on `{ status: 'Approved', nextStep: null }` and no longer opens an
-- ACCOUNT_FINAL row.
--
-- This migration clears the claims that were ALREADY sitting at that step when
-- the change landed. Without it they sit there for ever: nothing advances a
-- step no code opens, and the two-person rule refuses the only person who
-- could.
--
-- ---------------------------------------------------------------------------
-- WHY, MEASURED.
--
-- In Rocks_Portal_Form_UAT on 2026-09-24:
--
--   RBM26-09001  status=ManagerApproved  currentStep=ACCOUNT_FINAL
--       MANAGER        Approved   actionedBy=10176
--       ACCOUNT        Approved   actionedBy=10176
--       ACCOUNT_FINAL  Pending    actionedBy=-
--   RBM26-09002  identical.
--
--   AccReimburseApprover: ONE active row — staff 10176.
--
-- `canActFinalStep(candidate, accountStepActor)` refuses a match, so the only
-- approver in the system could not take the step he had already made
-- unavailable to himself. Both claims were stuck permanently — the exact state
-- the settings page's amber banner existed to predict ("the one that looks fine
-- until it is tried"), reached in practice.
--
-- Rocks_Portal_Form held NO non-draft AP-4 rows at all when this was written,
-- so production is expected to report 0 rows changed. That is a pass, not a
-- skip — the guard below prints the count either way.
--
-- ---------------------------------------------------------------------------
-- ORDER: after the code, and being early is harmless.
--
-- Most migrations here must precede their deploy because a query names a column
-- that does not exist yet. This one is the opposite shape: it changes ROWS, not
-- schema, so an old build meets nothing new. Run early, the old code would
-- simply re-open an ACCOUNT_FINAL row on the next accounting approval, and this
-- file can be run again. Run late, two claims sit stuck a little longer.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT DONE.
--
-- `CK_AccApproval_Step` still permits 'ACCOUNT_FINAL' and is left alone, as is
-- every row of history naming it. The step is RETIRED, not deleted — the same
-- treatment AP-2 gives `HEAD_DEPT`, whose own note says the type stays valid so
-- legacy rows still parse. Dropping it from the CHECK would make this
-- migration's own audit trail unwritable.
--
-- Idempotent: re-running finds no rows at that step and changes nothing.

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 162 may only be applied to Rocks_Portal_Form or Rocks_Portal_Form_UAT. Current database is %s.',
    16, 1, @wrongDb
  );
END
GO

BEGIN TRANSACTION;

-- The claims to clear: AP-4, still open, parked on the retired step. Captured
-- first so the UPDATEs below and the audit rows all name the same set even
-- though each statement re-reads the table.
DECLARE @stuck TABLE (RequestId INT PRIMARY KEY);
INSERT INTO @stuck (RequestId)
SELECT r.Id
FROM [dbo].[AccRequest] r
WHERE r.FormCode = N'AP-4'
  AND r.Status = N'ManagerApproved'
  AND r.CurrentStepCode = N'ACCOUNT_FINAL';

DECLARE @n INT = (SELECT COUNT(*) FROM @stuck);
PRINT CONCAT('AP-4 claims parked at ACCOUNT_FINAL: ', @n);

IF @n > 0
BEGIN
  -- 1. Close the dangling approval row. `Approved` with no actor is the honest
  --    record: nobody took this step, it stopped existing. ActionedByStaffId
  --    stays NULL rather than being stamped with whoever runs the migration.
  UPDATE a
  SET a.Status = N'Approved',
      a.ActionedAt = SYSDATETIME(),
      a.Comment = N'ขั้นอนุมัติสุดท้ายถูกยกเลิก (migration 162) — บัญชีอนุมัติครั้งเดียวจบ'
  FROM [dbo].[AccApproval] a
  INNER JOIN @stuck s ON s.RequestId = a.RequestId
  WHERE a.StepCode = N'ACCOUNT_FINAL' AND a.Status = N'Pending';
  PRINT CONCAT('  approval rows closed: ', @@ROWCOUNT);

  -- 2. Land the request where the accounting step now lands it.
  UPDATE r
  SET r.Status = N'Approved',
      r.CurrentStepCode = NULL,
      r.UpdatedAt = SYSDATETIME()
  FROM [dbo].[AccRequest] r
  INNER JOIN @stuck s ON s.RequestId = r.Id;
  PRINT CONCAT('  requests moved to Approved: ', @@ROWCOUNT);

  -- 3. Say so in the timeline. AuthorId NULL for the reason
  --    `recomputeGroupPerDiem`'s own audit rows use it: nobody did this, a
  --    change of process did.
  -- The column is `Note`, not `Detail` — checked against 059's own CREATE
  -- rather than assumed from the service layer's parameter names.
  INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, CreatedAt)
  SELECT s.RequestId, NULL, N'account_final_retired',
         N'ขั้นอนุมัติสุดท้าย (บัญชี) ถูกยกเลิก — คำขอนี้ถือว่าอนุมัติแล้วตั้งแต่บัญชีตรวจสอบ',
         SYSDATETIME()
  FROM @stuck s;
  PRINT CONCAT('  activity rows written: ', @@ROWCOUNT);
END
ELSE
  PRINT '  nothing to do.';

COMMIT;
GO

-- == Post-apply =============================================================
-- Must be 0. Anything else means a claim is still parked on a step nothing can
-- advance, which is the whole condition this file exists to end.
SELECT COUNT(*) AS StillParkedAtAccountFinal
FROM [dbo].[AccRequest]
WHERE FormCode = N'AP-4' AND Status = N'ManagerApproved' AND CurrentStepCode = N'ACCOUNT_FINAL';
GO
