-- =============================================
-- Migration: per-rent-vehicle "Admin arranges the rental" flag for AP-17 "เช่ายานพาหนะ" tab
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/054_acc_travel_rent_vehicle_booking.sql
-- Mirrors migrations 052/053: moves NeedsRentBooking from a per-request manual toggle to a
-- per-rent-vehicle admin setting that drives the form.
-- =============================================

IF COL_LENGTH('dbo.AccTravelRentVehicle', 'NeedsRentBooking') IS NULL
  ALTER TABLE [dbo].[AccTravelRentVehicle] ADD [NeedsRentBooking] BIT NOT NULL DEFAULT 0;
GO

-- Seed defaults: everything except the "ไม่เช่า" sentinel gets Admin-arranged rental.
UPDATE [dbo].[AccTravelRentVehicle] SET NeedsRentBooking = 1 WHERE Name <> N'ไม่เช่า';
GO

PRINT '=== Migration 054 complete ===';
GO
