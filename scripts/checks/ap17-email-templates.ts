/* eslint-disable no-console */
/**
 * Smoke test for AP-17 email templates (Task 6). No DB. Imports `@/env`
 * (via `src/lib/acc/email-templates.ts`'s `esc()` chain / NEXT_PUBLIC_APP_URL),
 * so run with: SKIP_ENV_VALIDATION=1 npx tsx scripts/checks/ap17-email-templates.ts
 */
import assert from "node:assert";
import { buildTravelBookingEmail, type TravelBookingTrigger } from "@/lib/acc/travel-booking/email-templates";
import type { TravelBookingRequest } from "@/features/travel-booking/types";

const mockReq: TravelBookingRequest = {
  id: 123,
  requestNo: "TOF26-0007",
  status: "Submitted",
  currentStepCode: "MANAGER",
  brandCode: "PCTH",
  continuationFromRequestNo: null,
  continuationFromRequestId: null,
  staffId: 10176,
  requesterFullName: "สัตวัต ใจเย็น",
  requesterPhotoUrl: null,
  requesterEmail: "sattawat.c@rocksgroup.com",
  requesterPosition: "IT",
  requesterDepartmentName: "IT",
  phone: "0812345678",
  allowanceSnapshot: 500,
  reasonId: 1,
  reasonName: "ประชุมงาน",
  reasonCustomText: null,
  workDetail: "ประชุมสาขา",
  provinceId: 1,
  provinceName: "เชียงใหม่",
  workLocations: [],
  accommodationId: 1,
  accommodationName: "โรงแรม",
  accommodationCustomText: null,
  needsRoomBooking: true,
  departDate: "2026-07-20",
  returnDate: "2026-07-22",
  departTime: null,
  returnTime: null,
  goVehicleId: 1,
  goVehicleName: "เครื่องบิน",
  goVehicleCustomText: null,
  goNeedsDepartureLocations: false,
  goNeedsTicketBooking: true,
  goNeedsDepartTime: false,
  goNeedsVehicleRent: false,
  returnVehicleId: 1,
  returnVehicleName: "เครื่องบิน",
  returnVehicleCustomText: null,
  returnNeedsDepartureLocations: false,
  returnNeedsTicketBooking: true,
  returnNeedsDepartTime: false,
  returnNeedsVehicleRent: false,
  departureLocations: [],
  rentVehicleId: null,
  rentVehicleName: null,
  rentVehicleCustomText: null,
  needsRentBooking: false,
  rentStartDate: null,
  rentEndDate: null,
  notes: null,
  isContinuation: false,
  perDiemDays: 3,
  perDiemTotal: 1500,
  paymentDate: "2026-07-31",
  submittedAt: "2026-07-14T10:00:00.000Z",
  groupKey: "abc-123",
  sortOrder: 0,
  idCardFiles: [],
  bookingDetails: [],
  approvals: [],
};

const triggers: TravelBookingTrigger[] = [
  "Submitted",
  "Approved",
  "Rejected",
  "Returned",
  "ReadyForAdmin",
  "Completed",
];

const dangerousNote = `แก้ไข <script>alert('x')</script> & "quoted" 'value'`;

for (const trigger of triggers) {
  const { subject, html } = buildTravelBookingEmail(trigger, mockReq, dangerousNote);
  assert.ok(subject.length > 0, `${trigger}: subject should be non-empty`);
  assert.ok(html.length > 0, `${trigger}: html should be non-empty`);
  assert.ok(html.includes(mockReq.requestNo as string), `${trigger}: html should include request no`);
  assert.ok(html.includes("/request/travel-booking/123"), `${trigger}: html should include CTA link`);
  // Note is only rendered for Rejected/Returned — everywhere it appears it must be escaped.
  assert.ok(!html.includes("<script>"), `${trigger}: html must not contain raw <script> tag`);
  if (trigger === "Rejected" || trigger === "Returned") {
    assert.ok(html.includes("&lt;script&gt;"), `${trigger}: escaped note should appear in html`);
    assert.ok(html.includes("&amp;"), `${trigger}: escaped '&' should appear in html`);
    assert.ok(html.includes("&quot;quoted&quot;"), `${trigger}: escaped quotes should appear in html`);
  }
}

// Approved: payout month rendered from paymentDate.
const approved = buildTravelBookingEmail("Approved", mockReq);
assert.ok(approved.html.includes("กรกฎาคม 2026"), "Approved: payout month should be rendered");
assert.ok(approved.html.includes("1500.00"), "Approved: per-diem total should be rendered");

// Approved, null paymentDate: guarded, no throw, falls back to placeholder.
const noPaymentDate = buildTravelBookingEmail("Approved", { ...mockReq, paymentDate: null });
assert.ok(noPaymentDate.html.length > 0, "Approved w/ null paymentDate should not throw");
assert.ok(!noPaymentDate.html.includes("กรกฎาคม"), "Approved w/ null paymentDate should not render a month");

// Rejected/Returned without a note: no dangling empty row markup, still valid.
const rejectedNoNote = buildTravelBookingEmail("Rejected", mockReq);
assert.ok(rejectedNoNote.html.length > 0, "Rejected w/o note should not throw");

console.log("ap17-email-templates OK");
