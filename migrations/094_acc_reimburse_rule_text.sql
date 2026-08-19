-- Correct the seeded checklist rule: it contradicted the notice above it.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/094_acc_reimburse_rule_text.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/094_acc_reimburse_rule_text.sql
--
-- 089 seeded one rule reading
--
--   ส่งเอกสารตัวจริงให้บัญชีภายในวันจันทร์ 12.00 เพื่อรับเงินวันศุกร์
--
-- and it disagreed with the compliance notice printed directly above the
-- checklist on the same page (REIMBURSE_NOTICE, paragraph 6) in two ways:
--
--   1. it put the Monday-noon clock on the **employee delivering the originals**
--      where the notice puts it on the **request being approved**;
--   2. it promised payment on "วันศุกร์" — any Friday — where AP-4 pays only the
--      1st and 3rd Friday of the month. That half is not a matter of the owner's
--      judgement: `src/lib/acc/reimburse/payment-calendar.ts` offers those two
--      rounds and `paymentDateError` refuses everything else, so the rule was
--      making a promise the code cannot keep, to a requester who has to tick it.
--
-- The replacement is the owner's own paragraph 6, so this reconciles the two
-- texts without inventing a third. It is not quite verbatim: the leading `**`
-- marker is dropped, and ¶6's space in `จ่ายเงิน ศุกร์ที่` is closed up to
-- `จ่ายเงินศุกร์ที่` — 88 characters against ¶6's 89. Both databases already
-- hold the closed-up form and 089's seed matches it, so this is recorded rather
-- than corrected: a 095 to insert one space would cost more than it buys.
--
-- Only a row still holding 089's exact text is touched. An administrator who has
-- already reworded it at Settings has said something deliberate, and a migration
-- overwriting that is worse than the disagreement it fixes.
UPDATE [dbo].[AccReimburseRule]
SET [RuleText] = N'ตัดรอบจ่ายจาก Request ที่อนุมัติแล้ววันจันทร์ 12.00 จ่ายเงินศุกร์ที่ 1 และ 3 ของทุกเดือน',
    [UpdatedAt] = SYSDATETIME()
WHERE [RuleText] = N'ส่งเอกสารตัวจริงให้บัญชีภายในวันจันทร์ 12.00 เพื่อรับเงินวันศุกร์';
-- Same batch as the UPDATE: @@ROWCOUNT is reset at the start of every batch, so
-- a GO in between would make this report zero every time it ran.
IF @@ROWCOUNT = 0
  PRINT 'No rule still holds 089''s seeded text — nothing to correct.';
ELSE
  PRINT 'Seeded checklist rule corrected to agree with the notice.';
GO
