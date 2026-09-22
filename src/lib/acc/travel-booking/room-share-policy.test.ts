import { test } from "node:test";
import assert from "node:assert/strict";
import { canHost, canAttach, type ShareCandidate } from "./room-share-policy";

const candidate = (over: Partial<ShareCandidate> = {}): ShareCandidate => ({
  requestId: 100,
  requestNo: "TRL26-00100",
  status: "ManagerApproved",
  needsRoomBooking: true,
  isGuest: false,
  hostsFor: [],
  ...over,
});

// ---------------------------------------------------------------------------
// canHost — may this request be offered as a room to share?
// ---------------------------------------------------------------------------

test("a live host with a room and no existing host may host", () => {
  assert.equal(canHost(candidate()), null);
});

test("a host with no room booking is refused — sharing it gives the guest no bed", () => {
  const r = canHost(candidate({ needsRoomBooking: false }));
  assert.ok(r);
  assert.equal(r.code, "host_no_room");
  assert.ok(r.message.includes("TRL26-00100"));
});

test("a Cancelled host is refused", () => {
  const r = canHost(candidate({ status: "Cancelled" }));
  assert.ok(r);
  assert.equal(r.code, "host_not_alive");
});

test("a Rejected host is refused", () => {
  const r = canHost(candidate({ status: "Rejected" }));
  assert.ok(r);
  assert.equal(r.code, "host_not_alive");
});

test("every other status is alive — Draft, Submitted, Completed, Returned may all host", () => {
  // The alive test is the same exclusion `continuation-chain.ts`,
  // `date-overlap.ts`, `requester-trips.ts` and `perdiem-dependency.ts` use:
  // dead is exactly Cancelled/Rejected, and nothing else. A status this module
  // has never heard of must not be refused by accident.
  for (const status of ["Draft", "Submitted", "ManagerApproved", "Completed", "Returned"]) {
    assert.equal(canHost(candidate({ status })), null, `${status} should be able to host`);
  }
});

test("a host that is itself a guest is refused — chains are one hop only", () => {
  const r = canHost(candidate({ isGuest: true }));
  assert.ok(r);
  assert.equal(r.code, "host_is_guest");
  // The message must name the request that is already a guest — here, the
  // candidate itself, since `canHost` is asked about exactly one request.
  assert.ok(r.message.includes("TRL26-00100"), `message lacks the request: ${r.message}`);
});

test("a host-is-guest refusal on a Draft names it without leaking the word null", () => {
  const r = canHost(candidate({ isGuest: true, requestNo: null }));
  assert.ok(r);
  assert.ok(!r.message.includes("null"), `message leaks null: ${r.message}`);
});

// ---------------------------------------------------------------------------
// canAttach — may this guest attach to this host?
// ---------------------------------------------------------------------------

test("a valid guest may attach to a valid host", () => {
  const guest = candidate({ requestId: 1, requestNo: "TRL26-00001" });
  const host = candidate({ requestId: 2, requestNo: "TRL26-00002" });
  assert.equal(canAttach(guest, host), null);
});

test("a guest attaching to itself is refused", () => {
  const self = candidate();
  const r = canAttach(self, self);
  assert.ok(r);
  assert.equal(r.code, "self_attach");
});

test("a guest that already has a host is refused — the unique index is the backstop, not this message", () => {
  const guest = candidate({ requestId: 1, requestNo: "TRL26-00001", isGuest: true });
  const host = candidate({ requestId: 2, requestNo: "TRL26-00002" });
  const r = canAttach(guest, host);
  assert.ok(r);
  assert.equal(r.code, "guest_has_host");
});

test("a cycle is refused: A hosting B while B hosts A would make cancellation non-terminating", () => {
  // Existing state: A (guest below) already hosts B (host below) — so A.hostsFor
  // includes B's id. The attempted action is B hosting A, i.e. A attaching to B.
  const a = candidate({ requestId: 1, requestNo: "TRL26-00001", hostsFor: [2] });
  const b = candidate({ requestId: 2, requestNo: "TRL26-00002" });
  const r = canAttach(a, b);
  assert.ok(r);
  assert.equal(r.code, "guest_already_hosts");
});

test("a request that hosts someone else entirely may also not become a guest", () => {
  // Not the mirror-image cycle above — A hosts an unrelated third request, and
  // now tries to attach to a completely different host. Spec §3: "a guest's
  // request may not itself be a host" is unconditional, not scoped to the
  // specific host being attached to.
  const a = candidate({ requestId: 1, requestNo: "TRL26-00001", hostsFor: [999] });
  const host = candidate({ requestId: 2, requestNo: "TRL26-00002" });
  const r = canAttach(a, host);
  assert.ok(r);
  assert.equal(r.code, "guest_already_hosts");
});

test("canAttach refuses a dead host the same way canHost does", () => {
  const guest = candidate({ requestId: 1, requestNo: "TRL26-00001" });
  const host = candidate({ requestId: 2, requestNo: "TRL26-00002", status: "Cancelled" });
  const r = canAttach(guest, host);
  assert.ok(r);
  assert.equal(r.code, "host_not_alive");
});

test("canAttach refuses a roomless host the same way canHost does", () => {
  const guest = candidate({ requestId: 1, requestNo: "TRL26-00001" });
  const host = candidate({ requestId: 2, requestNo: "TRL26-00002", needsRoomBooking: false });
  const r = canAttach(guest, host);
  assert.ok(r);
  assert.equal(r.code, "host_no_room");
});

test("canAttach refuses a host that is itself a guest, one hop only", () => {
  const guest = candidate({ requestId: 1, requestNo: "TRL26-00001" });
  const host = candidate({ requestId: 2, requestNo: "TRL26-00002", isGuest: true });
  const r = canAttach(guest, host);
  assert.ok(r);
  assert.equal(r.code, "host_is_guest");
});

test("the self-attach check runs before the host-eligibility delegate", () => {
  // A request attaching to itself is nonsensical regardless of whether that
  // same request would otherwise be a valid host — the self-check must not be
  // shadowed by a coincidentally-passing canHost(host) delegate order-wise,
  // nor should a coincidentally-failing canHost mask the real reason (self).
  const self = candidate({ needsRoomBooking: false });
  const r = canAttach(self, self);
  assert.ok(r);
  assert.equal(r.code, "self_attach");
});
