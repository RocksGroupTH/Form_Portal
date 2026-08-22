-- 095: A batch is identified by Template + Name (e.g. PAYMENTS/DEFAULT vs
-- GENERAL/DEFAULT), so the unique key must include TemplateName — otherwise two
-- batches named DEFAULT under different templates collide.
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

UPDATE dbo.AccErpJournalBatch SET TemplateName = '' WHERE TemplateName IS NULL;
GO
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_AccErpJournalBatch')
  ALTER TABLE dbo.AccErpJournalBatch DROP CONSTRAINT UQ_AccErpJournalBatch;
GO
ALTER TABLE dbo.AccErpJournalBatch
  ADD CONSTRAINT UQ_AccErpJournalBatch UNIQUE (Company, Environment, TemplateName, BatchName);
GO
PRINT '=== Migration 095 complete (batch unique = Company+Env+Template+Name) ===';
GO
