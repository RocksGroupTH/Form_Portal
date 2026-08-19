-- Let AccApproval carry a third step.
--
-- CK_AccApproval_Step admits only MANAGER and ACCOUNT today. AP-4 has three
-- steps: line manager, accounting check (which sets the payment date), and a
-- final accounting approval by a different person. Widening a CHECK cannot
-- invalidate a stored row, so AP-1, AP-2 and AP-17 are untouched and no data
-- pass is needed.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/091_acc_approval_step_final.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/091_acc_approval_step_final.sql
IF EXISTS (SELECT 1 FROM sys.check_constraints
           WHERE name = 'CK_AccApproval_Step'
             AND parent_object_id = OBJECT_ID('dbo.AccApproval'))
  ALTER TABLE [dbo].[AccApproval] DROP CONSTRAINT [CK_AccApproval_Step];
GO
ALTER TABLE [dbo].[AccApproval] WITH CHECK
  ADD CONSTRAINT [CK_AccApproval_Step]
      CHECK ([StepCode] IN (N'MANAGER', N'ACCOUNT', N'ACCOUNT_FINAL'));
GO
