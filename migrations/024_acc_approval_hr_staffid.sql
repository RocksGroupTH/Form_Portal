-- =============================================
-- Migration: HR StaffId semantics for AccApproval
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/024_acc_approval_hr_staffid.sql
-- AssignedTo / ActionedByStaffId = HR Employee.StaffId
-- =============================================

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
