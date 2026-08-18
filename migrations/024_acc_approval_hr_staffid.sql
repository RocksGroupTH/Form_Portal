-- =============================================
-- Migration: HR StaffId semantics for AccApproval
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/024_acc_approval_hr_staffid.sql
-- AssignedTo / ActionedByStaffId = HR Employee.StaffId
-- =============================================
--
-- HISTORICAL -- already applied. DO NOT RE-RUN after migration 066.
--
-- Two things below are no longer true of this app. It targets Fast_Form, which
-- belongs to Rocks Fast and Form Portal must not touch; and the second UPDATE
-- joins [Fast_Core].[dbo].[TeamMember], which since 066 is the Rocks Fast
-- roster rather than this one. The two rosters share only the 17 rows 066
-- copied -- everyone provisioned since exists in one and not the other (this
-- app allocates ids from 100001, Fast_Core from 2009) -- so a re-run would
-- silently skip every approval actioned by someone added after the cut, while
-- reporting success. If AccApproval ever needs this backfill again, write a new
-- migration against [Rocks_Portal_Form].[dbo].[TeamMember].

-- Backfill manager assignment (HR StaffId)
UPDATE a
SET AssignedTo = r.ManagerStaffId
FROM [dbo].[AccApproval] a
INNER JOIN [dbo].[AccRequest] r ON r.Id = a.RequestId
WHERE a.StepCode = N'MANAGER'
  AND a.AssignedTo IS NULL
  AND r.ManagerStaffId IS NOT NULL;

-- Backfill actioned HR StaffId from legacy TeamMember.ActionedBy
UPDATE a
SET ActionedByStaffId = e.StaffId
FROM [dbo].[AccApproval] a
INNER JOIN [Fast_Core].[dbo].[TeamMember] tm ON tm.Id = a.ActionedBy
INNER JOIN [Rocks_Portal_HR].[dbo].[Employee] e
  ON e.Status = N'Active'
  AND (
    (tm.Email IS NOT NULL AND LTRIM(RTRIM(tm.Email)) <> '' AND (e.Email = tm.Email OR e.EmailCompBr = tm.Email))
  )
WHERE a.ActionedByStaffId IS NULL
  AND a.ActionedBy IS NOT NULL;

PRINT '=== Migration 024 complete ===';
GO
