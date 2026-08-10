import type { BookingType, TravelBookingRequest } from "@/features/travel-booking/types";

/**
 * Which `Needs*Booking` flag (spec §2.x / §7) requires each `AccTravelBookingDetail.BookingType`
 * — a client-safe mirror of `REQUIRED_BOOKINGS` in `src/lib/acc/travel-booking/admin-service.ts`
 * (that file is server-only, importing `getAccPool`, so it can't be imported directly from
 * `"use client"` components). Keep the two in sync by hand if the Needs* gating ever changes.
 */
export const REQUIRED_BOOKING_RULES: {
  type: BookingType;
  label: string;
  needed: (req: TravelBookingRequest) => boolean;
}[] = [
  { type: "room", label: "การจองห้องพัก", needed: (req) => req.needsRoomBooking },
  {
    type: "ticket",
    label: "การจองตั๋วโดยสาร",
    needed: (req) => req.goNeedsTicketBooking || req.returnNeedsTicketBooking,
  },
  { type: "rent", label: "การจองรถเช่า", needed: (req) => req.needsRentBooking },
];
