-- =============================================
-- Migration: couple NeedsDepartTime to NeedsTicketBooking for AP-17 "การเดินทาง" tab
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/055_acc_travel_vehicle_time_follows_ticket.sql
-- The separate "ระบุเวลา" toggle is removed from the UI; a vehicle that needs Admin
-- ticket booking now always requires a depart time. Sync existing rows to the rule.
-- =============================================

UPDATE [dbo].[AccTravelVehicleOption] SET NeedsDepartTime = NeedsTicketBooking;
GO

PRINT '=== Migration 055 complete ===';
GO
