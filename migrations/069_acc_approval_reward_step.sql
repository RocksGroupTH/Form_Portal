-- AP-11 -- CK_AccApproval_Step gains 'REWARD'.
--
-- Database: Rocks_Portal_Form  AND  Rocks_Portal_Form_UAT
-- Apply with:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/069_acc_approval_reward_step.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/069_acc_approval_reward_step.sql
--
-- What 067 missed.
--
-- 067 extended CK_AccRequest_Status with 'Ready' and 'Received' -- the two new
-- header statuses -- and stopped there. But AP-11 also introduces a new
-- *approval step*: after the manager approves, `approveReward`
-- (src/lib/acc/reward/approval.ts) inserts the Assist AP row
--
--   INSERT INTO dbo.AccApproval (RequestId, StepCode, StepOrder, AssignedEmail, Status)
--   VALUES (@rid, 'REWARD', 2, ..., 'Pending')
--
-- and CK_AccApproval_Step only ever allowed the three steps AP-1 and AP-17 use:
--
--   ([StepCode]=N'ACCOUNT_FINAL' OR [StepCode]=N'ACCOUNT' OR [StepCode]=N'MANAGER')
--
-- So every AP-11 request could be filed and could reach the manager, and every
-- one of them died the moment the manager pressed อนุมัติ:
--
--   The INSERT statement conflicted with the CHECK constraint
--   "CK_AccApproval_Step" ... column 'StepCode'.
--
-- Submitting worked because the submit inserts StepCode='MANAGER', which the
-- old constraint allowed -- which is why this surfaced one step later than the
-- feature that caused it. The approval runs inside a transaction, so the failed
-- INSERT rolls the whole approval back: no half-approved requests to repair,
-- and nothing to backfill here.
--
-- 'REWARD' is added rather than reusing 'ACCOUNT' on purpose. The step is
-- actioned by AccRewardOfficer, a deliberately different roster from
-- AccApprover (see authorizeRewardAction), and `approveReward` /
-- `rejectReward` select their pending row by StepCode -- sharing a code would
-- make an AP-1 account approver's pending row indistinguishable from an Assist
-- AP one in any query that does not also filter on FormCode.
--
-- Idempotent -- safe to re-run.

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Guard. Both form databases are legitimate targets, so the test is on the name
-- prefix rather than 061's _UAT suffix. It exists to keep a mistyped --db out of
-- Fast_Form -- the live Rocks Fast database, which also has dbo.AccApproval and
-- would silently accept the statements below.
IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 069 may only be applied to Rocks_Portal_Form or Rocks_Portal_Form_UAT. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.AccApproval', 'U') IS NULL
BEGIN
  DECLARE @noAcc NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 069 expects dbo.AccApproval to exist. Apply 059 first. Current database is %s.',
    16, 1, @noAcc
  );
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_AccApproval_Step'
    AND parent_object_id = OBJECT_ID('dbo.AccApproval')
    AND definition LIKE '%REWARD%'
)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.check_constraints
             WHERE name = 'CK_AccApproval_Step'
               AND parent_object_id = OBJECT_ID('dbo.AccApproval'))
    ALTER TABLE [dbo].[AccApproval] DROP CONSTRAINT [CK_AccApproval_Step];

  ALTER TABLE [dbo].[AccApproval] ADD CONSTRAINT [CK_AccApproval_Step] CHECK ([StepCode] IN
    (N'MANAGER', N'ACCOUNT', N'ACCOUNT_FINAL', N'REWARD'));
  PRINT 'Recreated CK_AccApproval_Step to allow REWARD';
END
ELSE PRINT 'CK_AccApproval_Step already allows REWARD -- skipping';
GO

-- Post-apply check:
--   SELECT definition FROM sys.check_constraints WHERE name = 'CK_AccApproval_Step';
-- expected:
--   ([StepCode]=N'REWARD' OR [StepCode]=N'ACCOUNT_FINAL' OR [StepCode]=N'ACCOUNT' OR [StepCode]=N'MANAGER')
