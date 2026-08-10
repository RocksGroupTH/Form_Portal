-- =============================================
-- Migration: per-accommodation "Admin books the room" flag for AP-17 "ที่พัก" tab
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/053_acc_travel_accommodation_room_booking.sql
-- Mirrors the per-vehicle config pattern (migration 052): moves NeedsRoomBooking from a
-- per-request manual toggle to a per-accommodation admin setting that drives the form.
-- =============================================

IF COL_LENGTH('dbo.AccTravelAccommodation', 'NeedsRoomBooking') IS NULL
  ALTER TABLE [dbo].[AccTravelAccommodation] ADD [NeedsRoomBooking] BIT NOT NULL DEFAULT 0;
GO

-- Seed sensible defaults for the originally-seeded accommodations (only if still 0/unset).
UPDATE [dbo].[AccTravelAccommodation] SET NeedsRoomBooking = 1 WHERE Name = N'โรงแรม';
UPDATE [dbo].[AccTravelAccommodation] SET NeedsRoomBooking = 1 WHERE Name = N'อพาร์ทเม้น/หอพัก';
GO

PRINT '=== Migration 053 complete ===';
GO
