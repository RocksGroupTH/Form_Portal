-- The payee's bank BRANCH code, beside the account number and the bank.
--
-- Apply to BOTH form databases, before the code:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/137_acc_advance_payee_bank_branch.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/137_acc_advance_payee_bank_branch.sql
--
-- NUMBERED 137. Read `ls migrations/` before picking a number rather than
-- counting files: eleven earlier numbers (088, 089, 090, 091, 094, 103, 117,
-- 118, 119, 120, 124) each exist twice, from parallel branches.
--
-- ---------------------------------------------------------------------------
-- WHICH BRANCH THIS IS, BECAUSE THE WORD IS OVERLOADED HERE
--
-- A **bank** branch — the four-digit code that identifies which branch holds the
-- payee's account, spec §1.1. It has nothing to do with the ERP BRANCH dimension
-- (`HQ01`, `PC1057`) that `AccBrandBranchCode` configures and the journal posts
-- against. The two were confused once already: §1.1 was read as the ERP
-- dimension and dismissed as "already correct", which is why this arrives late.
--
-- It sits with `PayeeBankAccount` and `PayeeBankCode` because the three are one
-- fact — where the money goes — and finance reads them together to make the
-- transfer. Nothing here reaches Business Central: the AP-2 journal debits the
-- matched vendor and credits the *company's* bank account, never the payee's, so
-- these three columns are for the humans who move the money, not for the posting.
--
-- ---------------------------------------------------------------------------
-- SHAPE
--
-- `nvarchar(4)`, not an integer. Bank branch codes are identifiers, not
-- quantities: `0123` is a different branch from `123`, and an INT would lose the
-- leading zero on the first save. The form keeps it to digits, and the column is
-- wide enough for exactly four of them and no more.
--
-- NULL for every existing row, and for every employee-payee request forever —
-- those transfer to the requester's own HR-held account and never carry payee
-- bank details at all. NULL therefore means "not applicable or not yet given",
-- which is why there is no default and no backfill.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccAdvance') AND name = 'PayeeBankBranch'
)
BEGIN
  ALTER TABLE dbo.AccAdvance ADD PayeeBankBranch NVARCHAR(4) NULL;
  PRINT 'AccAdvance.PayeeBankBranch added';
END
ELSE
  PRINT 'AccAdvance.PayeeBankBranch already present — nothing to do';
