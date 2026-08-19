/*
  058 — Reclaim Acc requests whose CreatedBy was never written.

  Users who logged in without a Fast_Core.TeamMember row got an empty session id, so
  `saveDraft` stored `CreatedBy = NULL` (the binding is `userId || null`). Those requests then
  match nobody: they vanish from the draft picker (`WHERE CreatedBy = @uid`) and every edit /
  submit / cancel guard (`CreatedBy !== userId`) rejects the owner with "ไม่มีสิทธิ์แก้ไขคำขอนี้".

  Login now provisions the TeamMember row (see `provisionTeamMember` in team-member-lookup.ts),
  so new requests are fine. This backfills the ones already stranded, matching the request's
  StaffId to the HR employee's email and then to that person's TeamMember row.

  Idempotent — only touches rows that are still NULL. Requests whose owner has no TeamMember
  row yet are left alone; re-run after they log in once.

  Apply:  npm run apply-sql -- --db Fast_Form --file migrations/058_acc_backfill_null_createdby.sql

  ── HISTORICAL — already applied. DO NOT RE-RUN after migration 066. ──

  The "re-run after they log in" instruction above, and the matching note further down, were
  written while identity lived in Fast_Core. Since 066 it lives in
  [Rocks_Portal_Form].[dbo].[TeamMember], and the two rosters share only the 17 rows 066 copied:
  this app allocates new ids from 100001, Fast_Core carries on from 2009, so an id minted in one is
  absent from the other. Re-running would therefore write a Fast_Core id into
  AccRequest.CreatedBy that matches no row here — which still locks the owner out, and does it
  worse than NULL did, because the guard above only rescues rows that are still NULL. A wrong id
  is invisible to every later attempt to fix it.

  If requests are still stranded, write a new migration that joins
  [Rocks_Portal_Form].[dbo].[TeamMember] instead.
*/

SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#Fix') IS NOT NULL DROP TABLE #Fix;

SELECT r.Id AS RequestId, tm.Id AS TeamMemberId
INTO #Fix
FROM [dbo].[AccRequest] r
INNER JOIN [Rocks_Portal_HR].[dbo].[Employee] e
        ON e.StaffId = r.StaffId
INNER JOIN [Fast_Core].[dbo].[TeamMember] tm
        ON LOWER(LTRIM(RTRIM(tm.Email))) IN (
             LOWER(LTRIM(RTRIM(e.Email))),
             LOWER(LTRIM(RTRIM(e.EmailCompBr)))
           )
WHERE r.CreatedBy IS NULL
  AND r.StaffId IS NOT NULL;

SELECT CONCAT('Requests to backfill: ', COUNT(*)) AS Info FROM #Fix;

UPDATE r
   SET r.CreatedBy = f.TeamMemberId,
       r.UpdatedAt = SYSDATETIME()
FROM [dbo].[AccRequest] r
INNER JOIN #Fix f ON f.RequestId = r.Id;

SELECT CONCAT('Backfilled: ', @@ROWCOUNT) AS Info;

-- Anything still stranded (owner had no TeamMember row when this ran). Do NOT re-run this file
-- to pick them up — see the HISTORICAL note in the header.
SELECT r.Id, r.FormCode, r.Status, r.StaffId, r.RequesterFullName
FROM [dbo].[AccRequest] r
WHERE r.CreatedBy IS NULL;

DROP TABLE #Fix;
GO
