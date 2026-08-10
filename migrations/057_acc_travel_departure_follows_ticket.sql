-- =============================================
-- Migration: fold "กำหนดสถานที่/จุดขึ้น" into "ให้ Admin จองตั๋ว" for AP-17 "การเดินทาง" tab
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/057_acc_travel_departure_follows_ticket.sql
-- A vehicle whose tickets are booked by Admin always needs a pickup point + a depart time,
-- so the separate departure toggle is removed from the UI and follows NeedsTicketBooking.
-- =============================================

UPDATE [dbo].[AccTravelVehicleOption]
  SET NeedsDepartureLocations = NeedsTicketBooking,
      NeedsDepartTime = NeedsTicketBooking;
GO

PRINT '=== Migration 057 complete ===';
GO
