import { test } from "node:test";
import assert from "node:assert/strict";
import type { TravelBookingRequest } from "@/features/travel-booking/types";

/**
 * `email-templates.ts` imports `@/env`, which validates the whole environment
 * at import time and throws when it cannot. These templates read only
 * `NEXT_PUBLIC_APP_URL` from it, so these four placeholders exist purely to get
 * past that import — set before the dynamic import below, because a static
 * import would already have run.
 */
process.env.AUTH_SECRET ??= "test";
process.env.MSSQL_DATABASE ??= "test";
process.env.MSSQL_USER ??= "test";
process.env.MSSQL_PASSWORD ??= "test";

// Awaited inside each test, not at the top level: tsx compiles these to CJS,
// where top-level await is a build error.
const load = () => import("./email-templates");

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

test("no manager mail tells the recipient their own name", async () => {
  const { buildTravelBookingEmail } = await load();
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

test("every manager mail says which trip it is about", async () => {
  const { buildTravelBookingEmail } = await load();
  // A person with several requests open cannot tell them apart from a running
  // number alone, and the point of a notification is not having to open the app.
  for (const trigger of MANAGER_TRIGGERS) {
    const { html } = buildTravelBookingEmail(trigger, req(), "note");
    assert.ok(html.includes("วันเดินทาง"), `${trigger} has no วันเดินทาง row`);
    assert.ok(html.includes("สถานที่ปฏิบัติงาน"), `${trigger} has no สถานที่ row`);
    assert.ok(html.includes("โรงงานระยอง"), `${trigger} renders the สถานที่ label but no place`);
  }
});

const ACTOR_ROW_LABEL: Record<(typeof MANAGER_TRIGGERS)[number], string> = {
  Approved: "อนุมัติโดย",
  Rejected: "ไม่อนุมัติโดย",
  Returned: "ส่งกลับโดย",
};

test("who acted is shown when supplied, and omitted cleanly when not — all three manager triggers", async () => {
  const { buildTravelBookingEmail } = await load();
  // Pinned per trigger: deleting the ไม่อนุมัติโดย or ส่งกลับโดย row must red
  // this the same way removing อนุมัติโดย would.
  for (const trigger of MANAGER_TRIGGERS) {
    const withActor = buildTravelBookingEmail(trigger, req(), "note", "boss@rocksgroup.com");
    assert.ok(withActor.html.includes("boss@rocksgroup.com"), `${trigger} does not render the actor`);
    assert.ok(
      withActor.html.includes(ACTOR_ROW_LABEL[trigger]),
      `${trigger} does not render its "${ACTOR_ROW_LABEL[trigger]}" row`,
    );

    const withoutActor = buildTravelBookingEmail(trigger, req(), "note");
    assert.ok(!withoutActor.html.includes("undefined"), `${trigger} renders "undefined" with no actor`);
    assert.ok(!withoutActor.html.includes("null"), `${trigger} renders "null" with no actor`);
    assert.ok(withoutActor.html.includes("TRL26-00123"), `${trigger} fails to render with no actor`);
  }
});

test("Approved names the next step, because its subject reads as finished", async () => {
  const { buildTravelBookingEmail, APPROVED_NEXT_STEP_TEXT } = await load();
  const { subject, html } = buildTravelBookingEmail("Approved", req());
  assert.ok(subject.includes("อนุมัติแล้ว"));
  // A requester who thinks it is done does not chase a booking nobody made.
  // Asserted on the copy constant, not a prose fragment, so rewording the
  // sentence does not red this test for no reason.
  assert.ok(html.includes(APPROVED_NEXT_STEP_TEXT), "Approved does not say the booking desk is next");
});

test("Returned tells the requester what to do, not just what happened", async () => {
  const { buildTravelBookingEmail, RETURNED_ACTION_TEXT } = await load();
  const { subject, html } = buildTravelBookingEmail("Returned", req(), "แก้วันเดินทาง");
  assert.ok(subject.includes("ส่งกลับแก้ไข"));
  assert.ok(html.includes("แก้วันเดินทาง"), "the note is missing");
  assert.ok(html.includes(RETURNED_ACTION_TEXT), "Returned does not say to submit again");
});

test("Rejected still carries its reason", async () => {
  const { buildTravelBookingEmail } = await load();
  const { html } = buildTravelBookingEmail("Rejected", req(), "งบไม่พอ");
  assert.ok(html.includes("เหตุผล"));
  assert.ok(html.includes("งบไม่พอ"));
});

test("the three untouched triggers still build", async () => {
  const { buildTravelBookingEmail } = await load();
  // Submitted / ReadyForAdmin / Completed are out of scope; this pins that the
  // new optional parameter did not break their switch arms.
  for (const trigger of ["Submitted", "ReadyForAdmin", "Completed"] as const) {
    const { subject, html } = buildTravelBookingEmail(trigger, req());
    assert.ok(subject.length > 0);
    assert.ok(html.includes("TRL26-00123"));
  }
});

/* ───────────────── AP-17 package E — the room-share notifications ───────────────── */

/**
 * Spec §5, and these carry more weight than "three emails". §2 declined to
 * ask the host for consent, cancels a guest even after its per diem has been
 * paid, and moves a guest's dates with no manager re-reviewing them —
 * **notification is the entire mitigation for all three.** So each case below
 * asserts the fields that make the mail *useful*, not merely that it renders:
 * a host mail that omits the guest's name, or an accounting mail that omits
 * the figure, is the protection silently not performed.
 *
 * Copy is asserted against the exported constants, package A's precedent, so
 * rewording a sentence does not red the suite for no reason.
 */

const HOST = {
  requestId: 7,
  requestNo: "TRL26-00123",
  personName: "Somchai Jaidee",
  departDate: "2026-09-20",
  returnDate: "2026-09-24",
  workLocation: "โรงงานระยอง",
  perDiemDays: 5,
  perDiemTotal: 1500,
};

const GUEST = {
  requestId: 99,
  requestNo: "TRL26-00456",
  personName: "Malee Rakdee",
  departDate: "2026-09-20",
  returnDate: "2026-09-24",
  workLocation: "โรงงานระยอง",
  perDiemDays: 5,
  perDiemTotal: 1200,
};

test("the host mail names the guest, their number and their dates", async () => {
  const { buildRoomShareEmail } = await load();
  const { subject, html } = buildRoomShareEmail({
    kind: "RoomShareAttached",
    subjectOf: HOST,
    counterpart: GUEST,
  });
  // Spec §5: "so an unexpected one is visible immediately rather than at
  // check-in". A mail that says only "somebody attached" does not do that.
  assert.ok(subject.includes("TRL26-00123"), "the subject does not name the host's own request");
  assert.ok(html.includes("Malee Rakdee"), "the host mail does not name the guest");
  assert.ok(html.includes("TRL26-00456"), "the host mail does not carry the guest's running number");
  assert.ok(html.includes("2026-09-20"), "the host mail does not carry the dates");
  // A host with several trips open cannot tell which room this is about from a
  // running number alone — the same reason the manager mails carry it.
  assert.ok(html.includes("โรงงานระยอง"), "the host mail does not say which trip it is about");
});

test("the host mail's CTA opens the HOST's request, never the guest's", async () => {
  const { buildRoomShareEmail } = await load();
  const { html } = buildRoomShareEmail({
    kind: "RoomShareAttached",
    subjectOf: HOST,
    counterpart: GUEST,
  });
  // Not cosmetic: `decideRequestRead` refuses the host the guest's record, so
  // linking the guest hands the recipient a 404 on the one mail that exists
  // because they were never asked.
  assert.ok(
    html.includes("/request/travel-booking/7"),
    "the host mail does not link the host's own request",
  );
  assert.ok(
    !html.includes("/request/travel-booking/99"),
    "the host mail links the GUEST's request — a record decideRequestRead refuses the host",
  );
});

test("the host mail says they were not asked, and what their own actions will do", async () => {
  const { buildRoomShareEmail, ROOM_SHARE_HOST_NOTICE_TEXT } = await load();
  const { html } = buildRoomShareEmail({
    kind: "RoomShareAttached",
    subjectOf: HOST,
    counterpart: GUEST,
  });
  // The whole of spec §2's "no consent" mitigation is this one line.
  assert.ok(
    html.includes(ROOM_SHARE_HOST_NOTICE_TEXT),
    "the host mail no longer states that no consent was asked and that the guest follows them",
  );
});

test("the cancelled guest is told why, by whom, and what state it was in", async () => {
  const { buildRoomShareEmail, ROOM_SHARE_GUEST_CANCELLED_TEXT } = await load();
  const { html } = buildRoomShareEmail({
    kind: "RoomShareGuestCancelled",
    subjectOf: GUEST,
    counterpart: HOST,
    previousStatus: "ManagerApproved",
  });
  assert.ok(html.includes("TRL26-00456"), "the guest's own number is missing");
  assert.ok(html.includes("TRL26-00123"), "the host request that caused it is not named");
  assert.ok(html.includes("ManagerApproved"), "the previous status is missing");
  assert.ok(html.includes(ROOM_SHARE_GUEST_CANCELLED_TEXT), "the guest is not told what to do next");
  assert.ok(
    html.includes("/request/travel-booking/99"),
    "the guest mail does not link the guest's own request",
  );
});

test("the re-dated guest sees BOTH ranges, not just the new one", async () => {
  const { buildRoomShareEmail, ROOM_SHARE_GUEST_REDATED_TEXT } = await load();
  const { html } = buildRoomShareEmail({
    kind: "RoomShareGuestRedated",
    subjectOf: { ...GUEST, departDate: "2026-09-25", returnDate: "2026-09-30" },
    counterpart: HOST,
    previousDates: { depart: "2026-09-20", return: "2026-09-24" },
  });
  // The point of the mail is the CHANGE — the same reason the
  // `dates_followed_room_share_host` activity row records both ranges. A mail
  // showing only 25–30 tells a requester nothing they can act on.
  assert.ok(html.includes("2026-09-20"), "the OLD depart date is missing");
  assert.ok(html.includes("2026-09-24"), "the OLD return date is missing");
  assert.ok(html.includes("2026-09-25"), "the NEW depart date is missing");
  assert.ok(html.includes("2026-09-30"), "the NEW return date is missing");
  assert.ok(html.includes(ROOM_SHARE_GUEST_REDATED_TEXT), "the guest is not told what to do next");
});

test("accounting's cancellation mail carries the claim, the payer and the figure", async () => {
  const { buildRoomShareEmail, ROOM_SHARE_ACCOUNTING_CANCELLED_TEXT } = await load();
  const { subject, html } = buildRoomShareEmail({
    kind: "RoomShareAccountingCancelled",
    subjectOf: GUEST,
    counterpart: HOST,
    previousStatus: "Completed",
  });
  assert.ok(subject.includes("TRL26-00456"), "the subject does not name the claim");
  // `ผู้ขอ` is WANTED here. Package A removed that row from the three mails
  // sent TO the requester, where it told somebody their own name; this one
  // goes to accounting, who have to know whose claim it is.
  assert.ok(html.includes("ผู้ขอ"), "accounting is not told whose claim this is");
  assert.ok(html.includes("Malee Rakdee"), "the requester is not named");
  assert.ok(html.includes("Completed"), "the status it was cancelled out of is missing");
  assert.ok(html.includes("1200.00"), "the per-diem figure that may already be paid is missing");
  assert.ok(
    html.includes(ROOM_SHARE_ACCOUNTING_CANCELLED_TEXT),
    "accounting is not told to check whether the money went out",
  );
});

test("accounting's re-date mail says the dates moved and the money did not", async () => {
  const { buildRoomShareEmail, ROOM_SHARE_ACCOUNTING_REDATED_TEXT } = await load();
  const { html } = buildRoomShareEmail({
    kind: "RoomShareAccountingRedated",
    subjectOf: { ...GUEST, departDate: "2026-09-25", returnDate: "2026-09-30" },
    counterpart: HOST,
    previousDates: { depart: "2026-09-20", return: "2026-09-24" },
  });
  // The user's 2026-09-22 ruling: `perDiemWritable` refuses to reprice a
  // Completed guest, so the record reads 25–30 while the payment was computed
  // on 20–24. Both ranges AND the frozen figure have to be on the page or the
  // discrepancy is not legible.
  assert.ok(html.includes("2026-09-20"), "the range the money was computed on is missing");
  assert.ok(html.includes("2026-09-30"), "the range the record now reads is missing");
  assert.ok(html.includes("1200.00"), "the frozen figure is missing");
  assert.ok(html.includes("ผู้ขอ"), "accounting is not told whose claim this is");
  assert.ok(
    html.includes(ROOM_SHARE_ACCOUNTING_REDATED_TEXT),
    "accounting is not told the amount was deliberately left alone",
  );
});

test("the two accounting mails are distinguishable from their subjects alone", async () => {
  const { buildRoomShareEmail } = await load();
  // They are two different accounting problems — money out for a trip that is
  // not happening, versus a figure that no longer matches the dates beside it
  // — and a desk triaging an inbox must be able to tell them apart.
  const cancelled = buildRoomShareEmail({
    kind: "RoomShareAccountingCancelled",
    subjectOf: GUEST,
    counterpart: HOST,
    previousStatus: "Completed",
  }).subject;
  const redated = buildRoomShareEmail({
    kind: "RoomShareAccountingRedated",
    subjectOf: GUEST,
    counterpart: HOST,
    previousDates: { depart: "2026-09-20", return: "2026-09-24" },
  }).subject;
  assert.notEqual(cancelled, redated);
});

const ROOM_SHARE_KINDS = [
  "RoomShareAttached",
  "RoomShareGuestCancelled",
  "RoomShareGuestRedated",
  "RoomShareAccountingCancelled",
  "RoomShareAccountingRedated",
] as const;

test("every room-share mail renders with everything absent, and never prints undefined/null", async () => {
  const { buildRoomShareEmail } = await load();
  const blank = {
    requestId: null,
    requestNo: null,
    personName: null,
    departDate: null,
    returnDate: null,
    workLocation: null,
    perDiemDays: null,
    perDiemTotal: null,
  };
  for (const kind of ROOM_SHARE_KINDS) {
    const { subject, html } = buildRoomShareEmail({ kind, subjectOf: blank, counterpart: blank });
    assert.ok(subject.length > 0, `${kind} produced an empty subject`);
    assert.ok(!html.includes("undefined"), `${kind} renders "undefined"`);
    assert.ok(!html.includes("null"), `${kind} renders "null"`);
  }
});

test("every room-share mail escapes what it interpolates", async () => {
  const { buildRoomShareEmail } = await load();
  // A requester's HR display name reaches these unfiltered, and the guest
  // mails carry a name the recipient did not choose.
  const nasty = { ...GUEST, personName: "<script>alert(1)</script>", requestNo: "A&B\"'" };
  for (const kind of ROOM_SHARE_KINDS) {
    const { html } = buildRoomShareEmail({
      kind,
      subjectOf: nasty,
      counterpart: nasty,
      previousStatus: "<b>x</b>",
      previousDates: { depart: "<i>", return: "</i>" },
    });
    assert.ok(!html.includes("<script>"), `${kind} did not escape a name`);
    assert.ok(html.includes("&lt;script&gt;"), `${kind} did not render the escaped name at all`);
  }
});
