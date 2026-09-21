import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTravelBookingEmail } from "./email-templates";
// Type-only, so the alias erases and tsx never resolves it — the same shape
// calc.test.ts:4 uses. The type does NOT live beside this file.
import type { TravelBookingRequest } from "@/features/travel-booking/types";

// Minimal shape the templates read. Cast because TravelBookingRequest is wide
// and these six fields are all any of the three manager cases touches.
const req = (over: Record<string, unknown> = {}) =>
  ({
    id: 7,
    requestNo: "TRL26-00123",
    requesterFullName: "Somchai Jaidee",
    departDate: "2026-09-20",
    returnDate: "2026-09-24",
    paymentDate: "2026-09-30",
    perDiemDays: 5,
    perDiemTotal: 1500,
    workLocations: [{ name: "โรงงานระยอง" }],
    ...over,
  }) as unknown as TravelBookingRequest;

const MANAGER_TRIGGERS = ["Approved", "Rejected", "Returned"] as const;

test("no manager mail tells the recipient their own name", () => {
  // These templates were written from an approver's seat, where "ผู้ขอ" is the
  // useful column, then pointed at the requester. Pinned as an ABSENCE because
  // that is the defect and an absence is what a later edit silently restores.
  for (const trigger of MANAGER_TRIGGERS) {
    const { html } = buildTravelBookingEmail(trigger, req(), "note");
    assert.ok(!html.includes("ผู้ขอ"), `${trigger} still renders a ผู้ขอ row`);
    assert.ok(
      !html.includes("Somchai Jaidee"),
      `${trigger} still renders the recipient's own name`,
    );
  }
});

test("every manager mail says which trip it is about", () => {
  // A person with several requests open cannot tell them apart from a running
  // number alone, and the point of a notification is not having to open the app.
  for (const trigger of MANAGER_TRIGGERS) {
    const { html } = buildTravelBookingEmail(trigger, req(), "note");
    assert.ok(html.includes("วันเดินทาง"), `${trigger} has no วันเดินทาง row`);
    assert.ok(html.includes("สถานที่ปฏิบัติงาน"), `${trigger} has no สถานที่ row`);
    assert.ok(html.includes("โรงงานระยอง"), `${trigger} renders the สถานที่ label but no place`);
  }
});

test("who acted is shown when supplied, and omitted cleanly when not", () => {
  const withActor = buildTravelBookingEmail("Approved", req(), undefined, "boss@rocksgroup.com");
  assert.ok(withActor.html.includes("boss@rocksgroup.com"));

  const withoutActor = buildTravelBookingEmail("Approved", req());
  assert.ok(!withoutActor.html.includes("undefined"));
  assert.ok(!withoutActor.html.includes("null"));
  assert.ok(withoutActor.html.includes("TRL26-00123"));
});

test("Approved names the next step, because its subject reads as finished", () => {
  const { subject, html } = buildTravelBookingEmail("Approved", req());
  assert.ok(subject.includes("อนุมัติแล้ว"));
  // A requester who thinks it is done does not chase a booking nobody made.
  assert.ok(html.includes("Admin"), "Approved does not say the booking desk is next");
});

test("Returned tells the requester what to do, not just what happened", () => {
  const { subject, html } = buildTravelBookingEmail("Returned", req(), "แก้วันเดินทาง");
  assert.ok(subject.includes("ส่งกลับแก้ไข"));
  assert.ok(html.includes("แก้วันเดินทาง"), "the note is missing");
  assert.ok(html.includes("ส่งใหม่"), "Returned does not say to submit again");
});

test("Rejected still carries its reason", () => {
  const { html } = buildTravelBookingEmail("Rejected", req(), "งบไม่พอ");
  assert.ok(html.includes("เหตุผล"));
  assert.ok(html.includes("งบไม่พอ"));
});

test("the three untouched triggers still build", () => {
  // Submitted / ReadyForAdmin / Completed are out of scope; this pins that the
  // new optional parameter did not break their switch arms.
  for (const trigger of ["Submitted", "ReadyForAdmin", "Completed"] as const) {
    const { subject, html } = buildTravelBookingEmail(trigger, req());
    assert.ok(subject.length > 0);
    assert.ok(html.includes("TRL26-00123"));
  }
});
